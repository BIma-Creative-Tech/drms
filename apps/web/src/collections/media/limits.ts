/**
 * Accepted MIME types and byte caps of every media collection — pure (no node / sharp / payload import), so the server
 * (media/index.ts specs, factory.ts checks, payload.config.ts upload.limits) and the admin browser guard
 * (admin/components/media/upload-guard.ts, D2610) read the same numbers.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 // ADR 0004 §2 (upload.limits.fileSize)

export type MediaLimits = {
  mimeTypes: string[]
  /** Per-MIME size cap below the global 8 MiB (e.g. transfer-proof PDFs ≤ 2 MB). */
  maxBytesByMime?: Record<string, number>
}

export type MediaSlug =
  | 'media-receipts'
  | 'media-transfer-proofs'
  | 'media-selfies'
  | 'media-progress-photos'
  | 'media-signatures'
  | 'media-company'
  | 'media-attachments'

export const MEDIA_LIMITS: Readonly<Record<MediaSlug, MediaLimits>> = {
  // S3e (US-57): the input stays tolerant (≤ 8 MiB) — older APK builds and camera uploads from the web keep working
  'media-receipts': { mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
  'media-transfer-proofs': { mimeTypes: ['image/jpeg', 'image/png', 'application/pdf'], maxBytesByMime: { 'application/pdf': 2 * 1024 * 1024 } },
  'media-selfies': { mimeTypes: ['image/jpeg'] },
  'media-progress-photos': { mimeTypes: ['image/jpeg'] },
  // S3e: a drawn/scanned signature never needs more
  'media-signatures': { mimeTypes: ['image/png'], maxBytesByMime: { 'image/png': 2 * 1024 * 1024 } },
  // S3e (US-57, S-24): logo input ≤ 2 MB
  'media-company': { mimeTypes: ['image/png', 'image/jpeg'], maxBytesByMime: { 'image/png': 2 * 1024 * 1024, 'image/jpeg': 2 * 1024 * 1024 } },
  'media-attachments': { mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'], maxBytesByMime: { 'application/pdf': 5 * 1024 * 1024 } },
}

/** Byte cap of one file of `mime` in a collection. */
export function uploadCap(limits: Pick<MediaLimits, 'maxBytesByMime'>, mime: string): number {
  return limits.maxBytesByMime?.[mime] ?? MAX_UPLOAD_BYTES
}

/** "5 MB" / "512 KB" (whole units, as in the server's 413 message). */
export function capLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.floor(bytes / 1024 / 1024)} MB` : `${Math.floor(bytes / 1024)} KB`
}
