import { readFile } from 'node:fs/promises'

import type { CollectionSlug, PayloadRequest } from 'payload'

import { mediaPath } from '@/lib/media-files'

/** JPEG / PNG bytes for @react-pdf `<Image>` (shared by the document PDF and the report PDF). */
export type PdfImage = { data: Buffer; format: 'jpg' | 'png' }

/** Images larger than this are skipped (RAM guard; stored receipts are ≤ 2000 px JPEG ≈ 0.5 MB). */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
/** ADR 0008 §2: ≤ 12 receipt images per on-demand PDF (more → worker batch job, later phase). */
export const MAX_RECEIPT_IMAGES = 12

type MediaRow = { id: number; filename?: string | null; mimeType?: string | null; filesize?: number | null }

/**
 * Stored image → PDF bytes (ADR 0008 §2 memory budget: passed through as stored, > 3 MiB skipped,
 * JPEG/PNG only). SYSTEM-READ: callers only pass media of a document / letterhead the caller may read.
 */
export async function loadImage(req: PayloadRequest, collection: CollectionSlug, id: number | undefined): Promise<PdfImage | null> {
  if (!id) return null
  const m = (await req.payload.findByID({ collection, id, depth: 0, overrideAccess: true /* SYSTEM-READ: image of a document the caller may read */, req }).catch(() => null)) as MediaRow | null
  if (!m) return null
  const format = m.mimeType === 'image/jpeg' ? 'jpg' : m.mimeType === 'image/png' ? 'png' : null
  if (!format) return null // WebP/PDF cannot be embedded (@react-pdf/image: JPEG/PNG/SVG only)
  if ((m.filesize ?? 0) > MAX_IMAGE_BYTES) return null
  const p = mediaPath(req.payload, collection, m.filename)
  if (!p) return null
  try {
    return { data: await readFile(p), format }
  } catch {
    return null
  }
}
