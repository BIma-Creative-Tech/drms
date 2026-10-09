import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import { downloadName, readLatestRelease, type AppRelease } from '@/lib/app-release'

// Reads the release manifest from the media volume on every request (content changes per release).
export const dynamic = 'force-dynamic'

/**
 * GET/HEAD /unduh/proyekkas.apk — public, no auth: the current production APK (arm64-v8a) named by
 * `${MEDIA_DIR}/app-release/latest.json` (src/lib/app-release.ts). Stable URL for
 * CompanySettings.appDownloadUrl → `Cache-Control: no-cache` + ETag = file SHA-256, so browsers and
 * proxies revalidate and never serve an old release. 404 (Indonesian text) while nothing is published.
 */
const NOT_FOUND = 'APK RR Teams belum tersedia di server ini. Hubungi admin perusahaan.\n'

function baseHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  }
}

function notFound(head: boolean): Response {
  return new Response(head ? null : NOT_FOUND, {
    status: 404,
    headers: { ...baseHeaders(), 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

function apkHeaders(r: AppRelease): Record<string, string> {
  return {
    ...baseHeaders(),
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': String(r.size),
    'Content-Disposition': `attachment; filename="${downloadName(r.manifest)}"`,
    ETag: `"${r.manifest.sha256}"`,
  }
}

function notModified(request: Request, r: AppRelease): boolean {
  const inm = request.headers.get('if-none-match')
  if (!inm) return false
  return inm.split(',').some((t) => t.trim().replace(/^W\//, '') === `"${r.manifest.sha256}"`)
}

async function serve(request: Request, head: boolean): Promise<Response> {
  const release = await readLatestRelease()
  if (!release) return notFound(head)
  const headers = apkHeaders(release)
  if (notModified(request, release)) {
    const { 'Content-Length': _len, 'Content-Disposition': _cd, ...rest } = headers
    return new Response(null, { status: 304, headers: rest })
  }
  if (head) return new Response(null, { status: 200, headers })
  const stream = Readable.toWeb(createReadStream(release.path)) as unknown as ReadableStream<Uint8Array>
  return new Response(stream, { status: 200, headers })
}

export function GET(request: Request): Promise<Response> {
  return serve(request, false)
}

export function HEAD(request: Request): Promise<Response> {
  return serve(request, true)
}
