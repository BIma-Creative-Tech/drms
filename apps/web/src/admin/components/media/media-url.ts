/**
 * D2510 image preview (web 0.21.1, user 2026-10-25: "untuk setiap link image … buatkan previewnya dan clickable dalam
 * popup"): pure URL helpers of the shared thumbnail (ImageThumb.tsx). Every URL is an EXISTING authorized endpoint —
 * the thumbnail requests exactly what the former link opened, nothing is made public:
 * - GET /api/v1/media/{kind}/{id}/file[?variant=thumb] (collection read access + owner-document fallbacks; transfer
 *   proofs and other people's selfies audited `view_sensitive`);
 * - GET /api/v1/attendance/{id}/selfie (attendance read access; other people's selfies audited).
 * No React import (also used by the Payload config through display-cells.ts).
 */
export type MediaKind = 'receipts' | 'transfer-proofs' | 'signatures' | 'attachments' | 'company' | 'progress-photos' | 'selfies'

/** Media collection slug → `kind` of the file endpoint (FileCollectionEnum, api/v1/schemas-flow.ts). */
export const MEDIA_KIND_OF: Readonly<Record<string, MediaKind>> = {
  'media-receipts': 'receipts',
  'media-transfer-proofs': 'transfer-proofs',
  'media-signatures': 'signatures',
  'media-attachments': 'attachments',
  'media-company': 'company',
  'media-progress-photos': 'progress-photos',
  'media-selfies': 'selfies',
}

/** Collections with a generated `thumb` size (collections/media: 320 px inside); the others serve the stored file. */
const HAS_THUMB: ReadonlySet<MediaKind> = new Set(['receipts', 'transfer-proofs', 'attachments', 'progress-photos'])

/**
 * Collections that also accept PDFs. A missing thumbnail there usually means "not an image": the preview then shows a
 * file link instead of loading the full file as an image (for transfer proofs that load would be an audited view of a
 * PDF nobody saw).
 */
const MAY_BE_PDF: ReadonlySet<MediaKind> = new Set(['transfer-proofs', 'attachments'])

export type ThumbSource = {
  /** Full file: the lightbox image and the "Buka di tab baru" / no-JS link. */
  href: string
  /** Small variant for the thumbnail (= href when the collection has none). */
  thumb: string
  /** On a failed thumbnail: retry with the full file ('full') or show a file link ('file'). */
  fallback: 'full' | 'file'
}

const validId = (id: number | string): boolean => /^\d{1,10}$/.test(String(id))

export function mediaFileUrl(kind: MediaKind, id: number | string): string {
  return `/api/v1/media/${kind}/${id}/file`
}

/** Thumbnail + full URL of one media row (null for a malformed id). */
export function mediaThumbSource(kind: MediaKind, id: number | string): ThumbSource | null {
  if (!validId(id)) return null
  const href = mediaFileUrl(kind, id)
  return { href, thumb: HAS_THUMB.has(kind) ? `${href}?variant=thumb` : href, fallback: MAY_BE_PDF.has(kind) ? 'file' : 'full' }
}

/** Selfie of an attendance (Q-33 visibility of the attendance; no separate thumbnail size). */
export function selfieSource(attendanceId: number | string): ThumbSource | null {
  if (!validId(attendanceId)) return null
  const href = `/api/v1/attendance/${attendanceId}/selfie`
  return { href, thumb: href, fallback: 'full' }
}

/** A stored file that is not an image (PDF): previewed as a file link, never in the lightbox. */
export function isNonImage(mimeType: string | null | undefined, filename?: string | null): boolean {
  if (mimeType) return !mimeType.startsWith('image/')
  return typeof filename === 'string' && /\.pdf$/i.test(filename)
}

/** Id of an upload value (id, `{ id }` populated doc or `{ value }` of a polymorphic relation), else null. */
export function uploadId(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null
  if (typeof v === 'string') return validId(v) ? Number(v) : null
  if (v && typeof v === 'object') {
    const o = v as { id?: unknown; value?: unknown }
    if (o.id !== undefined) return uploadId(o.id)
    if (o.value !== undefined) return uploadId(o.value)
  }
  return null
}

/** Ids of a has-one / has-many upload value, in order, without duplicates. */
export function uploadIds(v: unknown): number[] {
  const list = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]
  return [...new Set(list.map(uploadId).filter((x): x is number => x !== null))]
}

/** MIME type of a populated upload value (depth ≥ 1), else null. */
export function uploadMime(v: unknown): string | null {
  return v && typeof v === 'object' && typeof (v as { mimeType?: unknown }).mimeType === 'string' ? (v as { mimeType: string }).mimeType : null
}
