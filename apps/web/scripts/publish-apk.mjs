#!/usr/bin/env node
// Publishes a production APK for the public download page /unduh (src/lib/app-release.ts).
// Runbook: docs/proyekkas/runbooks/rilis-apk.md. Node built-ins only (runs in the web runner image,
// which has no npm/tsx): copies the APK into ${MEDIA_DIR}/app-release/proyekkas-<version>-arm64.apk,
// computes its SHA-256, writes latest.json atomically (tmp + rename) and keeps the previous 2 versions
// (older ones are deleted). The manifest format is validated by releaseManifestSchema (zod) when read.
// --notes: the user-facing release notes (docs/release-notes/apk/<version>.md, a markdown bullet list) are
// stored as plain-text `notes: string[]` — shown on /unduh and sent to the APK by GET /api/v1/app/config.
//
// Usage:
//   node apps/web/scripts/publish-apk.mjs --apk <path.apk> --version <x.y.z> --cert <AA:BB:…32 bytes>
//        [--notes <notes.md>] [--media-dir <dir>] [--keep <n>] [--force]
//   --notes      markdown bullet list ("- …" / "* …", indented lines continue a bullet, "#" headings and
//                blank lines ignored; inline **bold**, `code` and [text](url) are reduced to plain text);
//                1…15 bullets of ≤ 300 characters. Without it the manifest has no notes.
//   --media-dir  default $MEDIA_DIR or /data/media
//   --keep       previous versions to keep besides the current one (default 2)
//   --force      replace an already published file of the SAME version with different content
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RELEASE_SUBDIR = 'app-release'
export const MANIFEST_NAME = 'latest.json'
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/
const CERT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/
const APK_RE = /^proyekkas-([0-9]+)\.([0-9]+)\.([0-9]+)-arm64\.apk$/

// Same limits as releaseNoteSchema in src/lib/app-release.ts.
export const NOTES_MAX_ITEMS = 15
export const NOTE_MAX_CHARS = 300
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/

export class PublishError extends Error {}

/** Markdown inline → plain text: [text](url) → text, **bold** / __bold__ / `code` markers dropped. */
function plainInline(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parses a release-notes markdown file into plain-text bullets (see --notes above).
 * @param {string} text
 * @returns {string[]}
 */
export function parseNotesMarkdown(text) {
  const items = []
  for (const [i, raw] of String(text).replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '' || /^\s{0,3}#/.test(line)) continue
    const bullet = /^\s{0,3}[-*]\s+(.*)$/.exec(line)
    if (bullet) items.push(bullet[1])
    else if (/^\s+\S/.test(line) && items.length > 0) items[items.length - 1] += ` ${line.trim()}`
    else throw new PublishError(`--notes line ${i + 1}: expected "- " bullet, indented continuation, "#" title or blank line`)
  }
  const notes = items.map(plainInline)
  if (notes.length === 0) throw new PublishError('--notes: no bullet found')
  if (notes.length > NOTES_MAX_ITEMS) throw new PublishError(`--notes: ${notes.length} bullets, at most ${NOTES_MAX_ITEMS}`)
  notes.forEach((n, i) => {
    if (n.length === 0) throw new PublishError(`--notes bullet ${i + 1} is empty`)
    if (n.length > NOTE_MAX_CHARS) throw new PublishError(`--notes bullet ${i + 1} has ${n.length} characters, at most ${NOTE_MAX_CHARS}`)
    if (CONTROL_RE.test(n)) throw new PublishError(`--notes bullet ${i + 1} contains a control character`)
  })
  return notes
}

export function apkFileName(version) {
  return `proyekkas-${version}-arm64.apk`
}

export async function sha256File(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function isZip(file) {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(4)
    await fh.read(buf, 0, 4, 0)
    return buf.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  } finally {
    await fh.close()
  }
}

function compareVersionsDesc(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] - a[i]
  return 0
}

/** Writes `content` to `file` via a temp file in the same directory + rename (atomic for readers). */
async function writeAtomic(file, content) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}`)
  const fh = await open(tmp, 'w', 0o644)
  try {
    await fh.writeFile(content)
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmp, file)
}

/**
 * @param {{ apk: string, version: string, cert: string, mediaDir: string, notes?: string, keep?: number, force?: boolean, now?: Date }} o
 *   `notes` = path of the release-notes markdown file (optional)
 * @typedef {{ version: string, file: string, sha256: string, certSha256: string, size: number, publishedAt: string, notes?: string[] }} Manifest
 * @returns {Promise<{ manifest: Manifest, deleted: string[] }>}
 */
export async function publishApk(o) {
  const keep = o.keep ?? 2
  const version = String(o.version ?? '').trim()
  const cert = String(o.cert ?? '').trim().toUpperCase()
  if (!VERSION_RE.test(version)) throw new PublishError('--version must be x.y.z (the pubspec version of the tag mobile-vX.Y.Z)')
  if (!CERT_RE.test(cert)) throw new PublishError('--cert must be the signing certificate SHA-256 as AA:BB:… (32 bytes)')
  if (!Number.isInteger(keep) || keep < 0 || keep > 10) throw new PublishError('--keep must be an integer 0…10')
  if (!o.mediaDir || !path.isAbsolute(o.mediaDir)) throw new PublishError('--media-dir must be an absolute path')
  let notes
  if (o.notes !== undefined) {
    let text
    try {
      text = await readFile(path.resolve(o.notes), 'utf8')
    } catch {
      throw new PublishError(`notes file not found: ${path.resolve(o.notes)}`)
    }
    notes = parseNotesMarkdown(text)
  }

  const src = path.resolve(o.apk ?? '')
  let srcStat
  try {
    srcStat = await stat(src)
  } catch {
    throw new PublishError(`APK not found: ${src}`)
  }
  if (!srcStat.isFile() || srcStat.size === 0) throw new PublishError(`not a non-empty file: ${src}`)
  if (!(await isZip(src))) throw new PublishError(`not an APK (zip signature missing): ${src}`)

  const dir = path.join(path.resolve(o.mediaDir), RELEASE_SUBDIR)
  await mkdir(dir, { recursive: true, mode: 0o755 })
  const name = apkFileName(version)
  const dest = path.join(dir, name)
  const sha256 = await sha256File(src)

  if (src !== dest) {
    let existing = null
    try {
      if ((await stat(dest)).isFile()) existing = await sha256File(dest)
    } catch {
      existing = null
    }
    if (existing !== null && existing !== sha256 && !o.force) {
      throw new PublishError(`${name} is already published with different content (sha256 ${existing}); use a new version or --force`)
    }
    if (existing !== sha256) {
      // Copy under a hidden temp name first: readers only ever see the final name when it is complete.
      const tmp = path.join(dir, `.${name}.tmp-${process.pid}`)
      try {
        await copyFile(src, tmp)
        const fh = await open(tmp, 'r')
        try {
          await fh.sync()
        } finally {
          await fh.close()
        }
        if ((await sha256File(tmp)) !== sha256) throw new PublishError('copy verification failed (sha256 mismatch)')
        await rename(tmp, dest)
      } catch (e) {
        await rm(tmp, { force: true })
        throw e
      }
    }
  }

  const manifest = {
    version,
    file: name,
    sha256,
    certSha256: cert,
    size: srcStat.size,
    publishedAt: (o.now ?? new Date()).toISOString(),
    ...(notes ? { notes } : {}),
  }
  await writeAtomic(path.join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)

  // Retention: the current file + the `keep` highest other versions; everything else matching the
  // APK name pattern is deleted (never other files).
  const others = (await readdir(dir))
    .map((f) => ({ f, m: APK_RE.exec(f) }))
    .filter((x) => x.m && x.f !== name)
    .map((x) => ({ f: x.f, v: [Number(x.m[1]), Number(x.m[2]), Number(x.m[3])] }))
    .sort((a, b) => compareVersionsDesc(a.v, b.v))
  const deleted = []
  for (const { f } of others.slice(keep)) {
    await rm(path.join(dir, f), { force: true })
    deleted.push(f)
  }
  return { manifest, deleted }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--force') out.force = true
    else if (['--apk', '--version', '--cert', '--notes', '--media-dir', '--keep'].includes(a)) out[a.slice(2)] = argv[++i]
    else throw new PublishError(`unknown argument: ${a}`)
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = await publishApk({
    apk: args.apk,
    version: args.version,
    cert: args.cert,
    notes: args.notes,
    mediaDir: args['media-dir'] || process.env.MEDIA_DIR || '/data/media',
    keep: args.keep === undefined ? 2 : Number(args.keep),
    force: Boolean(args.force),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`publish-apk: ${e instanceof PublishError ? e.message : e?.stack || e}\n`)
    process.exit(1)
  })
}
