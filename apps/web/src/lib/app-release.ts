import { stat, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

/**
 * Public APK download (`/unduh`, `/unduh/proyekkas.apk`): the production APK is hosted on the DRMS
 * server itself, in the web container's media volume, directory `${MEDIA_DIR}/app-release/`
 * (backed up with the rest of the volume). The CURRENT release is named by the manifest
 * `latest.json`, written atomically by `scripts/publish-apk.mjs` (runbook
 * docs/proyekkas/runbooks/rilis-apk.md). The directory is not a Payload upload collection, so
 * nothing else serves it.
 *
 * The manifest is untrusted input from disk: parsed strictly, the file name is a fixed pattern
 * (no separators, no `..`) and the resolved path must stay inside the release directory.
 */
export const RELEASE_SUBDIR = 'app-release'
export const MANIFEST_NAME = 'latest.json'

export const APK_FILENAME_RE = /^proyekkas-[0-9]+\.[0-9]+\.[0-9]+-arm64\.apk$/
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/
const CERT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

/** Release notes limits — the same numbers are enforced by scripts/publish-apk.mjs (`--notes`). */
export const NOTES_MAX_ITEMS = 15
export const NOTE_MAX_CHARS = 300
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/

/** One release-note bullet: plain text (rendered as text, never HTML), single line, 1…300 chars. */
export const releaseNoteSchema = z
  .string()
  .min(1)
  .max(NOTE_MAX_CHARS)
  .refine((s) => s.trim() === s, 'no leading/trailing whitespace')
  .refine((s) => !CONTROL_RE.test(s), 'no control characters')

export const releaseManifestSchema = z
  .object({
    version: z.string().regex(VERSION_RE, 'x.y.z'),
    file: z.string().regex(APK_FILENAME_RE, 'proyekkas-x.y.z-arm64.apk'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, '64 lower-case hex'),
    /** SHA-256 of the signing certificate, `AA:BB:…` (32 bytes, upper case) — same format as ANDROID_APP_CERT_SHA256. */
    certSha256: z.string().regex(CERT_RE, 'AA:BB:… (32 bytes)'),
    /** Byte size written by the publish script; the download refuses a file whose size differs (partial copy). */
    size: z.number().int().positive(),
    publishedAt: z.iso.datetime({ offset: true }),
    /**
     * "Yang baru di versi …" — user-facing Indonesian bullets from docs/release-notes/apk/<version>.md
     * (`publish-apk.mjs --notes`). Optional: manifests written before the field existed stay valid.
     */
    notes: z.array(releaseNoteSchema).min(1).max(NOTES_MAX_ITEMS).optional(),
  })
  .strict()
  .refine((m) => m.file === `proyekkas-${m.version}-arm64.apk`, { path: ['file'], message: 'must match version' })

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>

export type AppRelease = { manifest: ReleaseManifest; path: string; size: number }

export function mediaDir(): string {
  return process.env.MEDIA_DIR || '/data/media'
}

export function releaseDir(media: string = mediaDir()): string {
  return path.join(path.resolve(media), RELEASE_SUBDIR)
}

/** Parsed manifest or null (missing, unreadable, invalid JSON or failing the schema). */
export function parseManifest(raw: string): ReleaseManifest | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const r = releaseManifestSchema.safeParse(json)
  return r.success ? r.data : null
}

/** Absolute path of an APK inside the release dir, or null when the name is not an allowed one. */
export function releaseFilePath(dir: string, file: string): string | null {
  if (!APK_FILENAME_RE.test(file)) return null
  const root = path.resolve(dir)
  const full = path.resolve(root, file)
  return path.dirname(full) === root ? full : null
}

/**
 * The current release, or null when there is none (no manifest, invalid manifest, missing file, or
 * the file size differs from the manifest — e.g. a copy still in progress).
 */
export async function readLatestRelease(media: string = mediaDir()): Promise<AppRelease | null> {
  const dir = releaseDir(media)
  let raw: string
  try {
    raw = await readFile(path.join(dir, MANIFEST_NAME), 'utf8')
  } catch {
    return null
  }
  const manifest = parseManifest(raw)
  if (!manifest) return null
  const file = releaseFilePath(dir, manifest.file)
  if (!file) return null
  try {
    const s = await stat(file)
    if (!s.isFile() || s.size !== manifest.size) return null
    return { manifest, path: file, size: s.size }
  } catch {
    return null
  }
}

/**
 * Release notes of `version` when it is the currently published (downloadable) release, else null — the
 * app-config endpoint only attaches notes that belong to the version it announces as latest.
 */
export async function releaseNotesFor(version: string | null, media: string = mediaDir()): Promise<string[] | null> {
  if (!version) return null
  const rel = await readLatestRelease(media)
  return rel && rel.manifest.version === version && rel.manifest.notes?.length ? rel.manifest.notes : null
}

/** Stable, human-facing download name: `ProyekKas-0.2.0.apk`. */
export function downloadName(m: ReleaseManifest): string {
  return `ProyekKas-${m.version}.apk`
}

/** "24,6 MB" (Indonesian decimal comma, 1 MB = 1 000 000 bytes like Android's file manager). */
export function formatSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`
  return `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB`
}

/** "27 September 2026, 21.20 WITA" in Asia/Makassar. */
export function formatPublishedAt(iso: string): string {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return `${date}, ${time} WITA`
}
