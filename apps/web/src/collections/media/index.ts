import type { Access, Where } from 'payload'

import { anyRole } from '@/access/roles'
import { anyOf, byRole, ownUser, rolesAllowed, type Rule } from '@/access/policies'
import { visibleRequestIds } from '@/domain/expense/access'
import { reportPhotoWhere } from '@/domain/progress/access'

import { mediaCollection } from './factory'

/**
 * Upload collections split by resize policy (ADR 0004 §2). Server re-encodes every raster image
 * (auto-orient, resize `inside`, EXIF/GPS stripped); the unprocessed original is discarded
 * (user decision 2026-09-23), only its SHA-256 + dimensions are kept. PDFs are stored as-is.
 *
 * Read access until the owning business documents exist (F2): Finance/Owner/Admin all, others
 * only what they uploaded themselves. F2 replaces this with owner-document-derived Where rules.
 */
const ownerRequestRule: Rule = async ({ req }) => {
  const ids = await visibleRequestIds(req)
  if (ids.length === 0) return false
  const where: Where = { and: [{ ownerDocType: { equals: 'expense_request' } }, { ownerDocId: { in: ids.map(String) } }] }
  return where
}

const ownOrOffice: Access = byRole({
  'pk-admin': true,
  'pk-owner': true,
  'pk-finance': true,
  'pk-pm': ownUser('uploadedBy'),
  'pk-staff': ownUser('uploadedBy'),
})

/**
 * F2a: files of business documents are also readable by everyone who may read the owning
 * expense request (owner link set by the domain service, immutable once set — DB trigger).
 */
const ownerLinked: Access = byRole({
  'pk-admin': true,
  'pk-owner': true,
  'pk-finance': true,
  'pk-pm': anyOf(ownUser('uploadedBy'), ownerRequestRule),
  'pk-staff': anyOf(ownUser('uploadedBy'), ownerRequestRule),
})

/**
 * E4: progress photos are readable by their uploader, office roles, and everyone who may read the
 * owning progress report (PM team; owner link set by the report service, immutable — DB trigger).
 */
const reportPhotoRule: Rule = async ({ req }) => reportPhotoWhere(req)
const progressPhotoRead: Access = byRole({
  'pk-admin': true,
  'pk-owner': true,
  'pk-finance': true,
  'pk-pm': anyOf(ownUser('uploadedBy'), reportPhotoRule),
  'pk-staff': ownUser('uploadedBy'),
})

const thumb = {
  name: 'thumb',
  width: 320,
  height: 320,
  fit: 'inside' as const,
  withoutEnlargement: true,
  formatOptions: { format: 'webp' as const, options: { quality: 70 } },
}

/**
 * JPEG thumbnail for collections whose `mimeTypes` do not include image/webp: Payload validates
 * every generated size against the collection's mimeTypes (`sizes.thumb.mimeType: Invalid file
 * type 'image/webp'` — found in F2a: image uploads of transfer proofs/attachments always failed).
 */
const thumbJpeg = { ...thumb, formatOptions: { format: 'jpeg' as const, options: { quality: 70 } } }

export const MediaReceipts = mediaCollection({
  slug: 'media-receipts',
  labels: { singular: 'Foto nota', plural: 'Foto nota' },
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  // S3e (US-57, requirements §9, S-24): stored receipt photo ≤ 1600 px (was 2000). The input stays
  // tolerant (≤ 8 MiB, ≤ MAX_INPUT_PIXELS) so older APK builds and camera uploads from the web keep
  // working; the ≤ 400 KB target is met by the device compression + this re-encode (q82 mozjpeg).
  resizeOptions: { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true },
  formatOptions: { format: 'jpeg', options: { quality: 82, mozjpeg: true } },
  imageSizes: [thumb],
  access: { read: ownerLinked, create: rolesAllowed('pk-staff', 'pk-pm', 'pk-finance', 'pk-admin') },
})

export const MediaTransferProofs = mediaCollection({
  slug: 'media-transfer-proofs',
  labels: { singular: 'Bukti transfer', plural: 'Bukti transfer' },
  mimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
  resizeOptions: { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true },
  formatOptions: { format: 'jpeg', options: { quality: 80, mozjpeg: true } },
  imageSizes: [thumbJpeg],
  maxBytesByMime: { 'application/pdf': 2 * 1024 * 1024 },
  disposition: 'attachment',
  access: { read: ownerLinked, create: rolesAllowed('pk-finance') },
})

export const MediaSelfies = mediaCollection({
  slug: 'media-selfies',
  labels: { singular: 'Selfie absensi', plural: 'Selfie absensi' },
  mimeTypes: ['image/jpeg'],
  resizeOptions: { width: 720, height: 720, fit: 'inside', withoutEnlargement: true },
  // F4b: was WebP, which Payload validates against mimeTypes ['image/jpeg'] → every selfie upload
  // failed ("Invalid file type: 'image/webp'", same cause as the F2a thumbnail finding). JPEG also
  // keeps selfies embeddable in PDF recaps (@react-pdf: JPEG/PNG only).
  formatOptions: { format: 'jpeg', options: { quality: 75, mozjpeg: true } },
  access: { read: ownOrOffice, create: rolesAllowed('pk-staff', 'pk-pm', 'pk-admin') },
  // E6 S2 (Q-33): set by the selfieRetention job when the file was deleted from the volume. The row
  // stays as a tombstone (attendances.selfie_id is NOT NULL and append-only), without the image.
  extraFields: [{ name: 'removedAt', type: 'date', label: 'File dihapus (retensi)', index: true, access: { update: () => false }, admin: { readOnly: true } }],
})

export const MediaProgressPhotos = mediaCollection({
  slug: 'media-progress-photos',
  labels: { singular: 'Foto progress', plural: 'Foto progress' },
  mimeTypes: ['image/jpeg'],
  resizeOptions: { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true },
  // JPEG so PDF reports can embed it (@react-pdf/image: JPEG/PNG/SVG only, ADR 0004 §Context).
  formatOptions: { format: 'jpeg', options: { quality: 78, mozjpeg: true } },
  imageSizes: [thumbJpeg],
  // E4 (US-10): PM / Direktur upload; ≤ 5 per report (report service); EXIF/GPS stripped by re-encode.
  access: { read: progressPhotoRead, create: rolesAllowed('pk-pm', 'pk-owner') },
})

export const MediaSignatures = mediaCollection({
  slug: 'media-signatures',
  labels: { singular: 'Tanda tangan', plural: 'Tanda tangan' },
  mimeTypes: ['image/png'],
  resizeOptions: { width: 800, height: 300, fit: 'inside', withoutEnlargement: true },
  maxBytesByMime: { 'image/png': 2 * 1024 * 1024 }, // S3e: a drawn/scanned signature never needs more
  formatOptions: { format: 'png', options: { palette: true, compressionLevel: 9 } },
  access: { read: ownOrOffice, create: anyRole },
})

export const MediaCompany = mediaCollection({
  slug: 'media-company',
  labels: { singular: 'Logo perusahaan', plural: 'Logo perusahaan' },
  mimeTypes: ['image/png', 'image/jpeg'],
  // S3e (US-57, S-24): logo ≤ 1024 px (was 600), input ≤ 2 MB.
  resizeOptions: { width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true },
  maxBytesByMime: { 'image/png': 2 * 1024 * 1024, 'image/jpeg': 2 * 1024 * 1024 },
  formatOptions: { format: 'png', options: { compressionLevel: 9 } },
  access: { read: anyRole, create: rolesAllowed('pk-admin', 'pk-owner') },
})

export const MediaAttachments = mediaCollection({
  slug: 'media-attachments',
  labels: { singular: 'Lampiran', plural: 'Lampiran' },
  mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  resizeOptions: { width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true },
  formatOptions: { format: 'jpeg', options: { quality: 82, mozjpeg: true } },
  imageSizes: [thumbJpeg],
  maxBytesByMime: { 'application/pdf': 5 * 1024 * 1024 },
  disposition: 'attachment',
  access: { read: ownerLinked, create: rolesAllowed('pk-staff', 'pk-pm', 'pk-finance', 'pk-admin') },
})

export const MEDIA_COLLECTIONS = [
  MediaReceipts,
  MediaTransferProofs,
  MediaSelfies,
  MediaProgressPhotos,
  MediaSignatures,
  MediaCompany,
  MediaAttachments,
]
