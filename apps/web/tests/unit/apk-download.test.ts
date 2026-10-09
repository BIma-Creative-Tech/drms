import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DownloadView } from '@/app/(public)/unduh/DownloadView'
import { GET, HEAD } from '@/app/(public)/unduh/proyekkas.apk/route'
import {
  formatPublishedAt,
  formatSize,
  parseManifest,
  readLatestRelease,
  releaseFilePath,
  releaseManifestSchema,
  releaseNotesFor,
} from '@/lib/app-release'

import { parseNotesMarkdown, publishApk } from '../../scripts/publish-apk.mjs'

/** Public APK download: manifest validation, /unduh/proyekkas.apk handler, publish script, page markup. */
const CERT = 'E3:09:A8:92:AE:7F:EB:C2:62:98:EA:4E:60:3F:6A:38:50:86:E5:AA:FF:47:9B:4F:A9:1D:70:18:01:17:02:53'
const SHA = 'a'.repeat(64)
const APK_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('fake apk body for tests')])

const valid = { version: '0.2.0', file: 'proyekkas-0.2.0-arm64.apk', sha256: SHA, certSha256: CERT, size: 10, publishedAt: '2026-09-27T13:20:00.000Z' }

let media: string
let tmpIn: string
beforeEach(() => {
  media = mkdtempSync(path.join(os.tmpdir(), 'pk-media-'))
  tmpIn = mkdtempSync(path.join(os.tmpdir(), 'pk-apk-in-'))
  vi.stubEnv('MEDIA_DIR', media)
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(media, { recursive: true, force: true })
  rmSync(tmpIn, { recursive: true, force: true })
})

function inputApk(name = 'app-arm64-v8a-prod-release.apk', bytes: Buffer = APK_BYTES): string {
  const p = path.join(tmpIn, name)
  writeFileSync(p, bytes)
  return p
}

const req = (headers: Record<string, string> = {}) => new Request('https://drms-kas.example.test/unduh/proyekkas.apk', { headers })

describe('release manifest schema', () => {
  it('accepts a well-formed manifest', () => {
    expect(releaseManifestSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    ['path traversal', { file: '../../etc/passwd' }],
    ['subdirectory', { file: 'x/proyekkas-0.2.0-arm64.apk' }],
    ['other extension', { file: 'proyekkas-0.2.0-arm64.apk.sh' }],
    ['file ≠ version', { file: 'proyekkas-0.1.0-arm64.apk' }],
    ['bad version', { version: '0.2', file: 'proyekkas-0.2-arm64.apk' }],
    ['short sha', { sha256: 'abc' }],
    ['upper-case sha', { sha256: 'A'.repeat(64) }],
    ['bad cert', { certSha256: 'E3:09' }],
    ['zero size', { size: 0 }],
    ['bad date', { publishedAt: 'kemarin' }],
    ['unknown key', { extra: 1 }],
  ])('rejects %s', (_n, over) => {
    expect(releaseManifestSchema.safeParse({ ...valid, ...over }).success).toBe(false)
  })

  it('notes: optional plain-text bullets, 1…15 × 1…300 chars, no control characters', () => {
    expect(releaseManifestSchema.safeParse({ ...valid, notes: ['Tampilan baru.', 'Mode gelap.'] }).success).toBe(true)
    expect(releaseManifestSchema.safeParse({ ...valid, notes: Array(15).fill('x'.repeat(300)) }).success).toBe(true)
    for (const notes of [[], Array(16).fill('x'), ['x'.repeat(301)], [''], [' spasi'], ['baris\nkedua'], ['tab\t'], [1], 'teks']) {
      expect(releaseManifestSchema.safeParse({ ...valid, notes }).success, JSON.stringify(notes)).toBe(false)
    }
  })

  it('parseManifest returns null on invalid JSON', () => {
    expect(parseManifest('{nope')).toBeNull()
    expect(parseManifest(JSON.stringify(valid))?.version).toBe('0.2.0')
  })

  it('releaseFilePath refuses names outside the pattern / directory', () => {
    expect(releaseFilePath('/data/media/app-release', '../x.apk')).toBeNull()
    expect(releaseFilePath('/data/media/app-release', '/etc/passwd')).toBeNull()
    expect(releaseFilePath('/data/media/app-release', 'proyekkas-1.2.3-arm64.apk')).toBe('/data/media/app-release/proyekkas-1.2.3-arm64.apk')
  })

  it('formats size and date for the page (id-ID, WITA)', () => {
    expect(formatSize(24_600_000)).toBe('24,6 MB')
    expect(formatSize(1500)).toBe('2 KB')
    expect(formatPublishedAt('2026-09-27T13:20:00.000Z')).toBe('27 September 2026, 21.20 WITA')
  })
})

describe('GET/HEAD /unduh/proyekkas.apk', () => {
  it('404 with an Indonesian message when nothing is published', async () => {
    const r = await GET(req())
    expect(r.status).toBe(404)
    expect(await r.text()).toContain('belum tersedia')
    expect(r.headers.get('cache-control')).toBe('no-store')
    const h = await HEAD(req())
    expect(h.status).toBe(404)
    expect(await h.text()).toBe('')
  })

  it('404 when the manifest points outside the release directory (traversal)', async () => {
    const dir = path.join(media, 'app-release')
    mkdirSync(dir)
    writeFileSync(path.join(media, 'secret.apk'), APK_BYTES)
    writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ ...valid, file: '../secret.apk', size: APK_BYTES.length }))
    expect((await GET(req())).status).toBe(404)
  })

  it('404 when the file size differs from the manifest (partial copy)', async () => {
    const { manifest } = await publishApk({ apk: inputApk(), version: '0.2.0', cert: CERT, mediaDir: media })
    writeFileSync(path.join(media, 'app-release', 'latest.json'), JSON.stringify({ ...manifest, size: manifest.size + 1 }))
    expect((await GET(req())).status).toBe(404)
  })

  it('streams the published APK with download headers; HEAD has the same headers and no body', async () => {
    const { manifest } = await publishApk({ apk: inputApk(), version: '0.2.0', cert: CERT, mediaDir: media })
    const r = await GET(req())
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/vnd.android.package-archive')
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="RR-Teams-0.2.0.apk"')
    expect(r.headers.get('content-length')).toBe(String(APK_BYTES.length))
    expect(r.headers.get('cache-control')).toBe('no-cache')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(r.headers.get('etag')).toBe(`"${manifest.sha256}"`)
    expect(Buffer.from(await r.arrayBuffer()).equals(APK_BYTES)).toBe(true)

    const h = await HEAD(req())
    expect(h.status).toBe(200)
    expect(h.headers.get('content-length')).toBe(String(APK_BYTES.length))
    expect(h.headers.get('content-disposition')).toBe('attachment; filename="RR-Teams-0.2.0.apk"')
    expect(await h.text()).toBe('')
  })

  it('304 on a matching If-None-Match', async () => {
    const { manifest } = await publishApk({ apk: inputApk(), version: '0.2.0', cert: CERT, mediaDir: media })
    const r = await GET(req({ 'if-none-match': `"${manifest.sha256}"` }))
    expect(r.status).toBe(304)
    expect(r.headers.get('content-length')).toBeNull()
  })
})

describe('scripts/publish-apk.mjs', () => {
  it('writes the APK + a manifest that the server schema accepts', async () => {
    const { manifest } = await publishApk({ apk: inputApk(), version: '0.2.0', cert: CERT.toLowerCase(), mediaDir: media, now: new Date('2026-09-27T13:20:00Z') })
    const onDisk = JSON.parse(readFileSync(path.join(media, 'app-release', 'latest.json'), 'utf8'))
    expect(onDisk).toEqual(manifest)
    expect(releaseManifestSchema.safeParse(onDisk).success).toBe(true)
    expect(onDisk.certSha256).toBe(CERT)
    const rel = await readLatestRelease(media)
    expect(rel?.manifest.file).toBe('proyekkas-0.2.0-arm64.apk')
    expect(readdirSync(path.join(media, 'app-release')).filter((f) => f.startsWith('.'))).toEqual([])
  })

  it('keeps the current + 2 previous versions and deletes older ones', async () => {
    for (const v of ['0.1.0', '0.1.1', '0.2.0', '0.10.0']) {
      await publishApk({ apk: inputApk(`in-${v}.apk`, Buffer.concat([APK_BYTES, Buffer.from(v)])), version: v, cert: CERT, mediaDir: media })
    }
    const files = readdirSync(path.join(media, 'app-release')).sort()
    expect(files).toEqual(['latest.json', 'proyekkas-0.1.1-arm64.apk', 'proyekkas-0.10.0-arm64.apk', 'proyekkas-0.2.0-arm64.apk'])
  })

  it('refuses bad input and a different file under an already published version', async () => {
    await expect(publishApk({ apk: inputApk(), version: '0.2', cert: CERT, mediaDir: media })).rejects.toThrow(/x\.y\.z/)
    await expect(publishApk({ apk: inputApk(), version: '0.2.0', cert: 'nope', mediaDir: media })).rejects.toThrow(/cert/)
    await expect(publishApk({ apk: inputApk('bad.apk', Buffer.from('not a zip')), version: '0.2.0', cert: CERT, mediaDir: media })).rejects.toThrow(/zip/)
    await publishApk({ apk: inputApk(), version: '0.2.0', cert: CERT, mediaDir: media })
    const other = inputApk('other.apk', Buffer.concat([APK_BYTES, Buffer.from('changed')]))
    await expect(publishApk({ apk: other, version: '0.2.0', cert: CERT, mediaDir: media })).rejects.toThrow(/already published/)
    // Re-publishing the identical file (e.g. to restore it as latest) is fine.
    await expect(publishApk({ apk: inputApk(), version: '0.2.0', cert: CERT, mediaDir: media })).resolves.toBeTruthy()
  })
})

describe('release notes (publish-apk --notes → manifest → app config)', () => {
  const NOTES_MD = [
    '# ProyekKas 0.2.1',
    '',
    '- Bisa masuk dengan **kode Authenticator**.',
    '* Pesan salah login lebih jelas,',
    '  termasuk bila kode salah.',
    '- Lihat [halaman unduh](https://drms-kas.example.test/unduh) dan `Profil`.',
    '',
  ].join('\n')
  const notesFile = (text: string) => {
    const p = path.join(tmpIn, 'notes.md')
    writeFileSync(p, text)
    return p
  }

  it('parses bullets, continuation lines, title and inline markdown into plain text', () => {
    expect(parseNotesMarkdown(NOTES_MD)).toEqual([
      'Bisa masuk dengan kode Authenticator.',
      'Pesan salah login lebih jelas, termasuk bila kode salah.',
      'Lihat halaman unduh dan Profil.',
    ])
    expect(parseNotesMarkdown('\uFEFF- a\r\n- b\r\n')).toEqual(['a', 'b'])
  })

  it.each([
    ['no bullet', '# Judul saja\n'],
    ['prose line', '- a\nParagraf biasa\n'],
    ['too many bullets', Array.from({ length: 16 }, (_, i) => `- ${i}`).join('\n')],
    ['too long bullet', `- ${'x'.repeat(301)}`],
    ['control char', '- a\u0007b'],
  ])('refuses %s', (_n, md) => {
    expect(() => parseNotesMarkdown(md)).toThrow(/--notes/)
  })

  it('stores notes in latest.json (schema-valid); without --notes the key is absent', async () => {
    const { manifest } = await publishApk({ apk: inputApk(), version: '0.2.1', cert: CERT, mediaDir: media, notes: notesFile(NOTES_MD) })
    const onDisk = JSON.parse(readFileSync(path.join(media, 'app-release', 'latest.json'), 'utf8'))
    expect(onDisk.notes).toEqual(manifest.notes)
    expect(onDisk.notes).toHaveLength(3)
    expect(releaseManifestSchema.safeParse(onDisk).success).toBe(true)

    const again = await publishApk({ apk: inputApk(), version: '0.2.1', cert: CERT, mediaDir: media })
    expect('notes' in again.manifest).toBe(false)
  })

  it('a bad notes file fails before anything is copied or written', async () => {
    await expect(publishApk({ apk: inputApk(), version: '0.2.1', cert: CERT, mediaDir: media, notes: notesFile('tanpa bullet') })).rejects.toThrow(/--notes/)
    await expect(publishApk({ apk: inputApk(), version: '0.2.1', cert: CERT, mediaDir: media, notes: path.join(tmpIn, 'nope.md') })).rejects.toThrow(/notes file not found/)
    expect(readdirSync(media)).toEqual([])
  })

  it('releaseNotesFor: notes only when the published release is that version and has notes', async () => {
    expect(await releaseNotesFor('0.2.1', media)).toBeNull()
    await publishApk({ apk: inputApk(), version: '0.2.1', cert: CERT, mediaDir: media, notes: notesFile(NOTES_MD) })
    expect(await releaseNotesFor('0.2.1', media)).toHaveLength(3)
    expect(await releaseNotesFor('0.2.2', media)).toBeNull()
    expect(await releaseNotesFor(null, media)).toBeNull()
    await publishApk({ apk: inputApk(), version: '0.2.1', cert: CERT, mediaDir: media })
    expect(await releaseNotesFor('0.2.1', media)).toBeNull()
  })
})

describe('/unduh page markup', () => {
  it('shows version, size, date, button, hashes, steps and the employees-only note', () => {
    const html = renderToStaticMarkup(React.createElement(DownloadView, { release: { manifest: { ...valid, size: 24_600_000 }, size: 24_600_000 } }))
    expect(html).toContain('RR Teams 0.2.0')
    expect(html).toContain('24,6 MB')
    expect(html).toContain('27 September 2026, 21.20 WITA')
    expect(html).toContain('href="/unduh/proyekkas.apk"')
    expect(html).toContain('Unduh APK')
    expect(html).toContain(SHA)
    expect(html).toContain(CERT)
    expect(html).toContain('Izinkan dari sumber ini')
    expect(html).toContain('Hanya untuk karyawan PT DRMS')
    expect(html).not.toContain('<script')
  })

  it('"Yang baru di versi" lists the notes as escaped text; no section without notes', () => {
    const notes = ['Tampilan baru selaras web.', '<script>alert(1)</script> & <b>tebal</b>']
    const html = renderToStaticMarkup(React.createElement(DownloadView, { release: { manifest: { ...valid, notes }, size: 10 } }))
    expect(html).toContain('Yang baru di versi 0.2.0')
    expect(html).toContain('<li>Tampilan baru selaras web.</li>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;tebal&lt;/b&gt;')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<b>')
    const plain = renderToStaticMarkup(React.createElement(DownloadView, { release: { manifest: valid, size: 10 } }))
    expect(plain).not.toContain('Yang baru')
  })

  it('without a release: no button, a clear message', () => {
    const html = renderToStaticMarkup(React.createElement(DownloadView, { release: null }))
    expect(html).toContain('APK belum tersedia')
    expect(html).not.toContain('/unduh/proyekkas.apk')
  })
})
