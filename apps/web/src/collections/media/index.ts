import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import type { Access, CollectionSlug, PayloadRequest, Where } from 'payload'

import { anyRole, companiesWithRole, hasRoleAny, isGroupAdmin, mappedCompanies, type Role } from '@/access/roles'
import { anyOf, byRoleAny, ownUser, rolesAllowedAny, type Rule } from '@/access/policies'
import { allCompanyIds } from '@/domain/companies'
import { visibleRequestIds } from '@/domain/expense/access'
import { FIELD_COLLECTIONS, fieldPhotoWhere, isFieldOwnerType, staffMayUploadFieldPhotos } from '@/domain/field/access'
import { reportPhotoWhere } from '@/domain/progress/access'
import { assertSelfieUploadAllowed } from '@/legal/privacy-enforcement'

import { mediaCollection } from './factory'

/**
 * Upload collections split by resize policy (ADR 0004 §2). Server re-encodes every raster image
 * (auto-orient, resize `inside`, EXIF/GPS stripped); the unprocessed original is discarded
 * (user decision 2026-09-23), only its SHA-256 + dimensions are kept. PDFs are stored as-is.
 *
 * Read access until the owning business documents exist (F2): Finance/Owner/Admin all, others
 * only what they uploaded themselves. F2 replaces this with owner-document-derived Where rules.
 */
/**
 * MC4 QA (QA-MC4-04, ADR 0016 MC2 note 4 measured with 3 PTs): reading ONE media row (findByID —
 * GET /api/v1/media/…/file, signed URLs — or a Payload static file by name) used to build the id lists
 * of EVERY owner document of the caller's PTs (1 year × 3 PTs: 31 200 attendances → 3.6–4 s and
 * > 400 MiB per selfie request, V8 heap OOM = web process crash at the 256 MiB heap of ADR 0002).
 * For a single row the rules below are evaluated against that row's owner document only ("focus"):
 * same answers, O(1) queries. Lists (no id / filename) keep the id-list rules.
 */
type Focus = { id: number; ownerDocType: string | null; ownerDocId: string | null }
const FOCUS = 'pkMediaFocus'
const focusOf = (req: PayloadRequest): Focus | undefined => req.context?.[FOCUS] as Focus | undefined

/** `[id]` when the caller may read owner document `id` (caller's own access), else []. */
async function visibleOwner(req: PayloadRequest, collection: CollectionSlug, id: string | null): Promise<string[]> {
  if (!id || !/^\d{1,10}$/.test(id)) return []
  const res = await req.payload
    .find({ collection, where: { id: { equals: Number(id) } }, depth: 0, limit: 1, pagination: false, select: { updatedAt: true }, user: req.user, overrideAccess: false, req })
    .catch((err: { status?: number }) => {
      if (err.status === 403) return { docs: [] }
      throw err
    })
  return res.docs.length > 0 ? [id] : []
}

function focused(slug: CollectionSlug, inner: Access, thumbs: boolean): Access {
  return async (args) => {
    const { req } = args
    const rawId = args.id
    const filename = (args as { isReadingStaticFile?: boolean }).isReadingStaticFile ? (args.data as { filename?: unknown } | undefined)?.filename : undefined
    let where: Where | null = null
    if (rawId !== undefined && rawId !== null && /^\d{1,10}$/.test(String(rawId))) where = { id: { equals: Number(rawId) } }
    else if (typeof filename === 'string' && filename.length > 0) where = thumbs ? { or: [{ filename: { equals: filename } }, { 'sizes.thumb.filename': { equals: filename } }] } : { filename: { equals: filename } }
    if (!where || focusOf(req)) return inner(args)
    const row = (
      await req.payload.find({
        collection: slug,
        where,
        depth: 0,
        limit: 1,
        pagination: false,
        select: { ownerDocType: true, ownerDocId: true } as never,
        overrideAccess: true, // SYSTEM-READ: owner link of the ONE row being read; access is then decided for that row only
        req,
      })
    ).docs[0] as { id: number; ownerDocType?: string | null; ownerDocId?: string | null } | undefined
    if (!row) return false
    req.context ??= {}
    req.context[FOCUS] = { id: row.id, ownerDocType: row.ownerDocType ?? null, ownerDocId: row.ownerDocId ?? null } satisfies Focus
    try {
      return await inner(args)
    } finally {
      delete req.context[FOCUS]
    }
  }
}

const ownerRequestRule: Rule = async ({ req }) => {
  const f = focusOf(req)
  // list path (QA-MC4-07): requests of the caller's office PTs are granted by `officeOwned` already
  const ids = f
    ? f.ownerDocType === 'expense_request'
      ? await visibleOwner(req, 'expense-requests', f.ownerDocId)
      : []
    : (await visibleRequestIds(req, { exceptCompanies: (await officeScope(req)).ids })).map(String)
  if (ids.length === 0) return false
  const where: Where = { and: [{ ownerDocType: { equals: 'expense_request' } }, { ownerDocId: { in: ids } }] }
  return where
}

/**
 * MC2 (ADR 0016 §4 "media: access follows the owning document"). An office role (Admin/Owner/Finance)
 * reads the files of THE PTs where it holds that role:
 * - holder in EVERY PT — active or deactivated (QA-MC4-05; always the case with one PT) → all rows;
 * - otherwise: own uploads + rows whose owning document belongs to one of those PTs
 *   (`ownerCompany`, QA-MC4-07: derived by DB trigger from the request / progress report / cash entry
 *   of the owner link, or the attendance of a selfie — was an `id IN (…)` list per PT, capped at
 *   65 535 bind parameters); signatures: uploads of ACTIVE members of those PTs (QA-MC4-12).
 * Scope rule 2026-10-02: a deactivated PT has no members in any company context, so its files are
 * readable by nobody but their uploaders (memberships of an inactive PT never count).
 * The GET /api/v1/media/…/file endpoint adds the owner-document fallbacks.
 */
const OFFICE: readonly Role[] = ['pk-admin', 'pk-owner', 'pk-finance']
type OfficeScope = { all: boolean; ids: number[] }

async function officeScope(req: PayloadRequest): Promise<OfficeScope> {
  const key = 'pkMediaOffice'
  req.context ??= {}
  const hit = req.context[key] as OfficeScope | undefined
  if (hit) return hit
  const ids = companiesWithRole(req, OFFICE)
  // QA-MC4-05: compare with ALL companies (was: active ones — deactivating PT B opened B's files to
  // the office users of the remaining PTs)
  const every = ids.length ? await allCompanyIds(req.payload, req) : []
  const scope = { all: ids.length > 0 && every.every((a) => ids.includes(a)), ids }
  req.context[key] = scope
  return scope
}

/** Users with an ACTIVE membership in `companyIds` (signature readers; SQL, cached per request). */
async function membersOf(req: PayloadRequest, companyIds: number[]): Promise<string[]> {
  if (companyIds.length === 0) return []
  const key = `pkMediaMembers:${companyIds.join(',')}`
  req.context ??= {}
  const hit = req.context[key] as string[] | undefined
  if (hit) return hit
  const ptList = sql.join(
    companyIds.map((c) => sql`${c}`),
    sql`, `,
  )
  const out = (await idRows(req, sql`SELECT DISTINCT user_id::text AS v FROM company_memberships WHERE active AND company_id IN (${ptList})`))
    .map((r) => r.v)
    .filter((v): v is string => v !== null)
  req.context[key] = out
  return out
}

/** Rows of a read on the request's transaction when there is one (sees its own writes), else the pool. */
async function idRows(req: PayloadRequest, query: ReturnType<typeof sql>): Promise<Array<{ v: string | null }>> {
  const adapter = req.payload.db as unknown as PostgresAdapter
  const txId = req.transactionID ? await req.transactionID : undefined
  const db = (txId !== undefined ? adapter.sessions[String(txId)]?.db : undefined) ?? adapter.drizzle
  return ((await db.execute(query)) as unknown as { rows: Array<{ v: string | null }> }).rows
}

/** Office rule of one media collection (true when office in every PT). */
function officeRule(where: (req: PayloadRequest, ids: number[]) => Promise<Where | false>): Rule {
  return async ({ req }) => {
    const s = await officeScope(req)
    if (s.all) return true
    const w = await where(req, s.ids)
    const own: Where = { uploadedBy: { equals: (req.user as { id?: number } | null)?.id ?? -1 } }
    return w ? ({ or: [w, own] } as Where) : own
  }
}

/** QA-MC4-07: one indexed predicate, whatever the number of owner documents. */
const officeOwned = officeRule(async (_req, ids) => (ids.length ? { ownerCompany: { in: ids } } : false))
const officeSignatures = officeRule(async (req, ids) => {
  const users = await membersOf(req, ids)
  return users.length ? { uploadedBy: { in: users } } : false
})

const ownOrOffice: Access = byRoleAny({
  'pk-admin': officeOwned,
  'pk-owner': officeOwned,
  'pk-finance': officeOwned,
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
  'pk-admin': anyOf(officeOwned, ownerRequestRule),
  'pk-owner': anyOf(officeOwned, ownerRequestRule),
  'pk-finance': anyOf(officeOwned, ownerRequestRule),
  'pk-pm': anyOf(ownUser('uploadedBy'), ownerRequestRule),
  'pk-staff': anyOf(ownUser('uploadedBy'), ownerRequestRule),
})

/**
 * E4: progress photos are readable by their uploader, office roles (of the report's PT), and
 * everyone who may read the owning progress report (PM team; owner link set by the report service,
 * immutable — DB trigger).
 */
const reportPhotoRule: Rule = async ({ req }) => {
  const f = focusOf(req)
  if (!f) return reportPhotoWhere(req, { exceptCompanies: (await officeScope(req)).ids }) // QA-MC4-07, see ownerRequestRule
  const ids = f.ownerDocType === 'progress_report' ? await visibleOwner(req, 'progress-reports', f.ownerDocId) : []
  return ids.length ? { and: [{ ownerDocType: { equals: 'progress_report' } }, { ownerDocId: { in: ids } }] } : false
}
/**
 * FR1 (ADR 0020): photos of field reports (service report / timesheet HM / aftersales activity, owner
 * types `service_report` | `unit_timesheet` | `aftersales_activity` | `daily_report`) are readable by everyone who may
 * read the owning report (Staff: assigned projects, PM: team) — same focus/list split as above.
 */
const fieldPhotoRule: Rule = async ({ req }) => {
  const f = focusOf(req)
  if (!f) return fieldPhotoWhere(req, { exceptCompanies: (await officeScope(req)).ids })
  if (!isFieldOwnerType(f.ownerDocType)) return false
  const ids = await visibleOwner(req, FIELD_COLLECTIONS[f.ownerDocType], f.ownerDocId)
  return ids.length ? { and: [{ ownerDocType: { equals: f.ownerDocType } }, { ownerDocId: { in: ids } }] } : false
}
const progressPhotoRead: Access = byRoleAny({
  'pk-admin': anyOf(officeOwned, reportPhotoRule, fieldPhotoRule),
  'pk-owner': anyOf(officeOwned, reportPhotoRule, fieldPhotoRule),
  'pk-finance': anyOf(officeOwned, reportPhotoRule, fieldPhotoRule),
  'pk-pm': anyOf(ownUser('uploadedBy'), reportPhotoRule, fieldPhotoRule),
  'pk-staff': anyOf(ownUser('uploadedBy'), fieldPhotoRule),
})

/** E4: PM / Direktur / Admin upload progress photos; FR1: Staff only in a PT with field reports switched on. */
const progressPhotoCreate: Access = async (args) => {
  if (hasRoleAny(args.req, 'pk-pm', 'pk-owner', 'pk-admin')) return true
  return hasRoleAny(args.req, 'pk-staff') && (await staffMayUploadFieldPhotos(args.req))
}

/**
 * QA-MC4-11 (scope rule 2026-10-02): a PT logo is readable by the users MAPPED to that PT (and the
 * group logo of the app-wide settings by everyone with a role); group admins read every logo; an
 * uploader reads their own upload (a logo being set up). PDFs load logos as SYSTEM-READ, so the
 * letterheads are unaffected. Was: any user read every PT's logo.
 */
const companyLogoRead: Access = async (args) => {
  const { req } = args
  if (!(await anyRole(args))) return false
  if (isGroupAdmin(req)) return true
  const mapped = mappedCompanies(req) ?? []
  const ids = await idRows(
    req,
    mapped.length
      ? sql`SELECT logo_id::text AS v FROM companies WHERE logo_id IS NOT NULL AND id IN (${sql.join(
          mapped.map((c) => sql`${c}`),
          sql`, `,
        )})
            UNION SELECT group_logo_id::text FROM company_settings WHERE group_logo_id IS NOT NULL`
      : sql`SELECT group_logo_id::text AS v FROM company_settings WHERE group_logo_id IS NOT NULL`,
  )
  const logos = ids.map((r) => r.v).filter((v): v is string => v !== null)
  const own: Where = { uploadedBy: { equals: (req.user as { id?: number } | null)?.id ?? -1 } }
  return logos.length ? { or: [{ id: { in: logos } }, own] } : own
}

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
  ownerCompany: true,
  access: { read: focused('media-receipts', ownerLinked, true), create: rolesAllowedAny('pk-staff', 'pk-pm', 'pk-finance', 'pk-admin', 'pk-owner') /* ADR 0024: Direktur's own requests */ },
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
  ownerCompany: true,
  access: { read: focused('media-transfer-proofs', ownerLinked, true), create: rolesAllowedAny('pk-finance') },
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
  ownerCompany: true,
  // Owner decision 2026-10-09: web self check-in/out is every role, so every role may upload a selfie
  // (previously staff/pm/admin only, from when only the APK captured attendance).
  access: { read: focused('media-selfies', ownOrOffice, false), create: rolesAllowedAny('pk-staff', 'pk-pm', 'pk-admin', 'pk-owner', 'pk-finance', 'pk-operator') },
  // ADR 0018 (owner 2026-10-05): no selfie of an uploader without the current privacy acknowledgement while
  // "Versi APK minimum" ≥ 0.3.3 (403 PRIVACY_ACK_REQUIRED, audited access_denied).
  createGuard: assertSelfieUploadAllowed,
  // E6 S2 (Q-33): set by the selfieRetention job when the file was deleted from the volume. The row
  // stays as a tombstone (attendances.selfie_id is NOT NULL and append-only), without the image.
  // D7 (DRMS 10/10, ADR 0010 addendum 2026-10-12): set once by the worker job `stampSelfie` when the timestamp
  // band (server time in the PT zone, GPS, location, employee, "RR Teams") was burnt into the stored file.
  extraFields: [
    { name: 'removedAt', type: 'date', label: 'File dihapus (retensi)', index: true, access: { update: () => false }, admin: { readOnly: true } },
    { name: 'stampedAt', type: 'date', label: 'Cap waktu dibubuhkan', access: { update: () => false }, admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
  ],
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
  // FR1: also the photos of field reports (≤ 10 service, 1 HM photo per timesheet, ≤ 5 per activity).
  ownerCompany: true,
  access: { read: focused('media-progress-photos', progressPhotoRead, true), create: progressPhotoCreate },
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
  access: { read: companyLogoRead, create: rolesAllowedAny('pk-admin', 'pk-owner') },
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
  ownerCompany: true,
  access: { read: focused('media-attachments', ownerLinked, true), create: rolesAllowedAny('pk-staff', 'pk-pm', 'pk-finance', 'pk-admin', 'pk-owner') /* ADR 0024: Direktur's own requests */ },
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
