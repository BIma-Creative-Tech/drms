import { capLabel, MAX_UPLOAD_BYTES, MEDIA_LIMITS, type MediaSlug, uploadCap } from '@/collections/media/limits'

/**
 * D2610 upload size guard (user 2026-10-26, prod Reimburse #125): a PDF over the 5 MB cap of the "Lampiran" was refused
 * by the server (413) AFTER the upload, and Payload's bulk-upload drawer then re-sent its form state WITH the whole file
 * to the admin Server Action to show that error — the WAF (CrowdSec CRS, "rce" anomaly on the PDF bytes) answered 403,
 * Payload swallowed it and the drawer closed as if saved: no file, no message. The admin now checks the size in the
 * browser before Payload sees the file (UploadSizeGuard.tsx), with the server's numbers (collections/media/limits.ts).
 * Pure module (no React, no DOM): unit-tested in tests/unit/d2610-upload-guard.test.ts.
 */

/** Collection of a Payload file input: its `accept` is the collection's `mimeTypes.join(', ')` (unique per collection). */
export function slugByAccept(accept: string | null | undefined): MediaSlug | null {
  if (!accept) return null
  for (const [slug, limits] of Object.entries(MEDIA_LIMITS) as Array<[MediaSlug, (typeof MEDIA_LIMITS)[MediaSlug]]>) {
    if (limits.mimeTypes.join(', ') === accept) return slug
  }
  return null
}

export function isMediaSlug(v: unknown): v is MediaSlug {
  return typeof v === 'string' && v in MEDIA_LIMITS
}

/**
 * Cap of one file: the collection's cap, or (collection unknown) the largest cap any media collection allows for that
 * type — never refuses what the server would accept; the server checks again either way. Null = a type no media
 * collection accepts (Payload / the server refuse it with their own message).
 */
export function capFor(slug: MediaSlug | null, mime: string): number | null {
  if (slug) return MEDIA_LIMITS[slug].mimeTypes.includes(mime) ? uploadCap(MEDIA_LIMITS[slug], mime) : null
  const caps = Object.values(MEDIA_LIMITS)
    .filter((l) => l.mimeTypes.includes(mime))
    .map((l) => uploadCap(l, mime))
  return caps.length > 0 ? Math.max(...caps) : null
}

export type Oversize = { name: string; bytes: number; cap: number }

/** Files above their cap (in order). */
export function oversizeFiles(files: ArrayLike<{ name: string; size: number; type: string }>, slug: MediaSlug | null): Oversize[] {
  const out: Oversize[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!
    const cap = capFor(slug, f.type) ?? (f.type ? null : MAX_UPLOAD_BYTES)
    if (cap !== null && f.size > cap) out.push({ name: f.name, bytes: f.size, cap })
  }
  return out
}

/** "6,9 MB" (one decimal, id-ID). */
export function sizeLabel(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB` : `${Math.ceil(bytes / 1024)} KB`
}

/** Text of the refusal popup. */
export function oversizeMessage(list: Oversize[]): string {
  const lines = list.map((o) => `• ${o.name} — ${sizeLabel(o.bytes)} (maks. ${capLabel(o.cap)} per file)`)
  return `${lines.join('\n')}\n\nFile belum diunggah. Kompres atau perkecil file (mis. scan ulang dengan resolusi lebih rendah), lalu unggah lagi.`
}

/** Field name of an upload field wrapper id (`field-attachments`, `field-representatives__0__signature`). */
export function fieldNameOfId(id: string | null | undefined): string | null {
  if (!id || !id.startsWith('field-')) return null
  const parts = id.slice('field-'.length).split('__').filter((p) => p !== '' && !/^\d+$/.test(p))
  return parts.at(-1) ?? null
}

type AnyField = { type?: unknown; name?: unknown; relationTo?: unknown; fields?: unknown; tabs?: unknown; blocks?: unknown }

/** Media collections of the upload fields named `name` in a (client) field tree — rows, groups, arrays, tabs, blocks. */
export function uploadTargets(fields: unknown, name: string, into: Set<MediaSlug> = new Set()): Set<MediaSlug> {
  if (!Array.isArray(fields)) return into
  for (const f of fields as AnyField[]) {
    if (!f || typeof f !== 'object') continue
    if (f.type === 'upload' && f.name === name && isMediaSlug(f.relationTo)) into.add(f.relationTo)
    uploadTargets(f.fields, name, into)
    if (Array.isArray(f.tabs)) for (const t of f.tabs as Array<{ fields?: unknown }>) uploadTargets(t?.fields, name, into)
    if (Array.isArray(f.blocks)) for (const b of f.blocks as Array<{ fields?: unknown }>) uploadTargets(b?.fields, name, into)
  }
  return into
}

/** The one media collection of a field name, looking at the current document's fields first, then every entity. */
export function slugOfField(name: string, current: { fields?: unknown } | null, all: ReadonlyArray<{ fields?: unknown }>): MediaSlug | null {
  const here = uploadTargets(current?.fields, name)
  if (here.size === 1) return [...here][0]!
  if (here.size > 1) return null
  const anywhere = new Set<MediaSlug>()
  for (const e of all) uploadTargets(e.fields, name, anywhere)
  return anywhere.size === 1 ? [...anywhere][0]! : null
}

/** `{ collectionSlug }` / `{ globalSlug }` of an admin URL path (`/admin/collections/expense-requests/125`). */
export function entityOfPath(pathname: string, adminRoute: string): { collectionSlug: string } | { globalSlug: string } | null {
  const base = adminRoute.replace(/\/$/, '')
  if (!pathname.startsWith(`${base}/`)) return null
  const [kind, slug] = pathname.slice(base.length + 1).split('/')
  if (!slug) return null
  if (kind === 'collections') return { collectionSlug: slug }
  if (kind === 'globals') return { globalSlug: slug }
  return null
}
