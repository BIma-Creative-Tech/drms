import type { Access, CollectionSlug, PayloadRequest, Where } from 'payload'

import { anyRole, companiesWithRole, type Role } from '@/access/roles'
import { anyOf, byRoleAny, ownUser, rolesAllowedAny, type Rule } from '@/access/policies'
import { activeCompanyIds } from '@/domain/companies'
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

/**
 * MC2 (ADR 0016 §4 "media: access follows the owning document"): media rows carry no company. An
 * office role (Admin/Owner/Finance) reads the files of THE PTs where it holds that role:
 * - holder in EVERY active PT (always the case with one PT) → all rows (as before, no id lists);
 * - otherwise: own uploads + files whose owner document (expense request / progress report) belongs
 *   to one of those PTs; selfies: those of attendances of those PTs; signatures: uploads of members
 *   of those PTs. The GET /api/v1/media/…/file endpoint adds the owner-document fallbacks.
 */
const OFFICE: readonly Role[] = ['pk-admin', 'pk-owner', 'pk-finance']
type OfficeScope = { all: boolean; ids: number[] }

async function officeScope(req: PayloadRequest): Promise<OfficeScope> {
  const key = 'pkMediaOffice'
  req.context ??= {}
  const hit = req.context[key] as OfficeScope | undefined
  if (hit) return hit
  const ids = companiesWithRole(req, OFFICE)
  const active = ids.length ? await activeCompanyIds(req.payload, req) : []
  const scope = { all: ids.length > 0 && active.every((a) => ids.includes(a)), ids }
  req.context[key] = scope
  return scope
}

/** Ids (as text) of `collection` rows of the PTs `companyIds` (SYSTEM-READ, cached per request). */
async function idsOfCompanies(req: PayloadRequest, collection: CollectionSlug, companyIds: number[], field = 'id'): Promise<string[]> {
  const key = `pkMediaIds:${collection}:${field}:${companyIds.join(',')}`
  req.context ??= {}
  const hit = req.context[key] as string[] | undefined
  if (hit) return hit
  const res = await req.payload.find({
    collection,
    where: { company: { in: companyIds } } as Where,
    depth: 0,
    pagination: false,
    select: field === 'id' ? { updatedAt: true } : { [field]: true },
    overrideAccess: true, // SYSTEM-READ: owner documents of the caller's office PTs (media access)
    req,
  })
  const out = res.docs.map((d) => (field === 'id' ? d.id : (d as Record<string, unknown>)[field])).filter((v) => v !== null && v !== undefined).map(String)
  req.context[key] = out
  return out
}

/** Office rule of one media collection (true when office in every active PT). */
function officeRule(where: (req: PayloadRequest, ids: number[]) => Promise<Where | false>): Rule {
  return async ({ req }) => {
    const s = await officeScope(req)
    if (s.all) return true
    const w = await where(req, s.ids)
    const own: Where = { uploadedBy: { equals: (req.user as { id?: number } | null)?.id ?? -1 } }
    return w ? ({ or: [w, own] } as Where) : own
  }
}

const idsWhere = (field: string, ids: string[], extra?: Where): Where | false => (ids.length ? (extra ? { and: [extra, { [field]: { in: ids } }] } : { [field]: { in: ids } }) : false)

const officeRequests = officeRule(async (req, ids) => idsWhere('ownerDocId', await idsOfCompanies(req, 'expense-requests', ids), { ownerDocType: { equals: 'expense_request' } }))
const officeReports = officeRule(async (req, ids) => idsWhere('ownerDocId', await idsOfCompanies(req, 'progress-reports', ids), { ownerDocType: { equals: 'progress_report' } }))
const officeSelfies = officeRule(async (req, ids) => idsWhere('id', await idsOfCompanies(req, 'attendances', ids, 'selfie')))
const officeSignatures = officeRule(async (req, ids) => idsWhere('uploadedBy', await idsOfCompanies(req, 'company-memberships', ids, 'user')))

const ownOrOffice: Access = byRoleAny({
  'pk-admin': officeSelfies,
  'pk-owner': officeSelfies,
  'pk-finance': officeSelfies,
  'pk-pm': ownUser('uploadedBy'),
  'pk-staff': ownUser('uploadedBy'),
})

const signatureRead: Access = byRoleAny({
  'pk-admin': officeSignatures,
  'pk-owner': officeSignatures,
  'pk-finance': officeSignatures,
  'pk-pm': ownUser('uploadedBy'),
  'pk-staff': ownUser('uploadedBy'),
})

/**
 * F2a: files of business documents are also readable by everyone who may read the owning
 * expense request (owner link set by the domain service, immutable once set — DB trigger).
 */
const ownerLinked: Access = byRoleAny({
  'pk-admin': anyOf(officeRequests, ownerRequestRule),
  'pk-owner': anyOf(officeRequests, ownerRequestRule),
  'pk-finance': anyOf(officeRequests, ownerRequestRule),
  'pk-pm': anyOf(ownUser('uploadedBy'), ownerRequestRule),
  'pk-staff': anyOf(ownUser('uploadedBy'), ownerRequestRule),
})

/**
 * E4: progress photos are readable by their uploader, office roles (of the report's PT), and
 * everyone who may read the owning progress report (PM team; owner link set by the report service,
 * immutable — DB trigger).
 */
const reportPhotoRule: Rule = async ({ req }) => reportPhotoWhere(req)
const progressPhotoRead: Access = byRoleAny({
  'pk-admin': anyOf(officeReports, reportPhotoRule),
  'pk-owner': anyOf(officeReports, reportPhotoRule),
  'pk-finance': anyOf(officeReports, reportPhotoRule),
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
  access: { read: ownerLinked, create: rolesAllowedAny('pk-staff', 'pk-pm', 'pk-finance', 'pk-admin') },
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
  access: { read: ownerLinked, create: rolesAllowedAny('pk-finance') },
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
  access: { read: ownOrOffice, create: rolesAllowedAny('pk-staff', 'pk-pm', 'pk-admin') },
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
  access: { read: progressPhotoRead, create: rolesAllowedAny('pk-pm', 'pk-owner') },
})

export const MediaSignatures = mediaCollection({
  slug: 'media-signatures',
  labels: { singular: 'Tanda tangan', plural: 'Tanda tangan' },
  mimeTypes: ['image/png'],
  resizeOptions: { width: 800, height: 300, fit: 'inside', withoutEnlargement: true },
  maxBytesByMime: { 'image/png': 2 * 1024 * 1024 }, // S3e: a drawn/scanned signature never needs more
  formatOptions: { format: 'png', options: { palette: true, compressionLevel: 9 } },
  access: { read: signatureRead, create: anyRole },
})

export const MediaCompany = mediaCollection({
  slug: 'media-company',
  labels: { singular: 'Logo perusahaan', plural: 'Logo perusahaan' },
  mimeTypes: ['image/png', 'image/jpeg'],
  // S3e (US-57, S-24): logo ≤ 1024 px (was 600), input ≤ 2 MB.
  resizeOptions: { width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true },
  maxBytesByMime: { 'image/png': 2 * 1024 * 1024, 'image/jpeg': 2 * 1024 * 1024 },
  formatOptions: { format: 'png', options: { compressionLevel: 9 } },
  access: { read: anyRole, create: rolesAllowedAny('pk-admin', 'pk-owner') },
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
  access: { read: ownerLinked, create: rolesAllowedAny('pk-staff', 'pk-pm', 'pk-finance', 'pk-admin') },
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
