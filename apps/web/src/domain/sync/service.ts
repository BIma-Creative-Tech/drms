import { sql } from '@payloadcms/db-postgres'
import { APIError, ValidationError, type CollectionSlug, type PayloadRequest } from 'payload'
import type { z } from 'zod'

import { runUnderCompany } from '@/access/company-context'
import { companyContextOf, employeeIn, mappedCompanies, relId, userId, type Membership } from '@/access/roles'
import { companyOf } from '@/domain/companies'
import { FIELD_COLLECTIONS } from '@/domain/field/access'
import {
  SyncAttendancePayload,
  SyncDraftDeletePayload,
  SyncDraftUpsertPayload,
  SyncOnBehalfPayload,
  type SyncBatchIn,
  type SyncDraftCopyOut as SyncDraftCopy,
  type SyncDraftUpsert,
  type SyncItemIn,
  type SyncItemType,
  type SyncOnBehalf,
  type SyncResultOut,
} from '@/api/v1/schemas-sync'
import { writeAudit } from '@/audit/writer'
import { ids, loadRaw, loadVisible, lockRequest, settings, type RequestDoc } from '@/domain/expense/common'
import { payeeOf } from '@/domain/expense/types'
import { createDraft, updateDraft, type DraftInput, type LineInputApi } from '@/domain/expense/drafts'
import { addReceipt, editReceipt } from '@/domain/expense/receipts'
import { deleteDraft, discardDraft } from '@/domain/expense/workflow'
import { auditPrivacyDenied, PRIVACY_ACK_REQUIRED, PRIVACY_ACK_REQUIRED_DETAIL, privacyAckCheck } from '@/legal/privacy-enforcement'
import { isDbGuardError } from '@/lib/pg-error'
import { withReqTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { AttendanceReject, LOCATION_COLLECTION, locationOf, onBehalfActor, recordAttendance } from '@/domain/attendance/record'

import { attendanceTimeOf, employeeOfUser } from './attendance'
import { judgeTime, type TimeVerdict } from './clock'
import { applyFieldItem, FIELD_COPY_KEY, FIELD_SYNC_TYPES, fieldItemRef, FieldSyncReject } from './field'
import { applyProgressReport, ProgressSyncReject } from './progress'

/**
 * MC3-1 (ADR 0016 §8): every item is processed under ITS PT = `company_id` of the item (new APK), or
 * — for items WITHOUT `company_id` (released APK mobile-v0.2.0) — the caller's only active
 * membership; a caller with several PTs gets 409 `COMPANY_REQUIRED` for such a batch (nothing
 * processed, see processBatch). Per item: `company_id` must be an active membership of the caller
 * (else `COMPANY_NOT_ALLOWED`), the PT derived server-side from the references (project / cost
 * center / existing draft or report) must equal it (else `COMPANY_MISMATCH`); the domain services
 * check the role IN that PT (progress: PM/Direktur, on-behalf: PM → `FORBIDDEN`). The request's read selection
 * (`X-Company-Ids`) does not matter: the item runs with the selection narrowed to its PT (drafts
 * without project/cost center get that PT), feature flags and the timezone are that PT's, the own
 * employee is the membership employee of that PT. Idempotency (client_uuid) is unchanged.
 */
/**
 * POST /api/v1/sync/batch — offline queue replay (ADR 0010 "Sync contract").
 *
 * - Items are processed IN ORDER, each in its OWN DB transaction; one bad item never blocks the
 *   others. An advisory lock on the item's `client_uuid` serialises concurrent replays.
 * - Idempotency: every final result (applied / rejected / conflict) is stored in `sync_receipts`
 *   (30 days); a replayed `client_uuid` returns that result as `duplicate` without side effects.
 *   An applied result is stored in the SAME transaction as the business change; a rejection is
 *   stored in a new transaction after the business transaction rolled back.
 * - Server is authoritative: creator/status/totals/flags come from the domain services (the same
 *   ones as POST/PATCH /api/v1/expense-requests and …/receipts — no second write path). Device
 *   times are comparison values only (clock.ts).
 * - Conflicts: an edit of an existing draft must carry `base_rev` = the server `rev`; a stale or
 *   missing `base_rev` → `conflict` + `server_copy` (server wins, nothing changes).
 * - Drafts are edited only by their creator and only in status Draft (else `rejected
 *   NOT_EDITABLE`); delete = "Dibatalkan" of a never-submitted draft (requirements §1.2 #6; D2410 "Hapus draft": a
 *   numbered — withdrawn, never decided — draft is soft-deleted like on the web, flag DELETED).
 * - Attendance check-in/out + PM on-behalf (company-settings.syncAttendanceEnabled; checks in
 *   domain/attendance/record.ts): assigned project/cost center with a geofence, inside radius
 *   (+ capped GPS accuracy), not mocked, selfie uploaded by the caller, one check-in and one
 *   check-out per employee/location/local date; on-behalf = PM of the team location only (US-14).
 *   ADR 0018: while "Versi APK minimum" ≥ 0.3.3 the caller (on-behalf: the PM) must have acknowledged the
 *   current privacy notice, else `rejected PRIVACY_ACK_REQUIRED` (final, audited access_denied).
 * - Progress reports (E4, company-settings.syncProgressReportsEnabled): `progress_report.draft_upsert`
 *   creates a report through the same domain service as POST /api/v1/progress-reports, or edits one
 *   (reporter, ≤ 24 h, base_rev = server rev else conflict + server_report) — ./progress.ts.
 */

type SyncError = { code: string; field?: string; message: string }

/** Business rejection: rolls the item transaction back, then the result is stored. */
class SyncReject extends Error {
  constructor(
    readonly errors: SyncError[],
    readonly target: { id: number; copy: SyncDraftCopy | null } | null = null,
  ) {
    super(errors[0]?.message ?? 'rejected')
  }
}

/** Not processable yet (dependency missing): nothing is stored, the APK retries later. */
class SyncDefer extends Error {
  constructor(readonly errors: SyncError[]) {
    super(errors[0]?.message ?? 'deferred')
  }
}

type Outcome = {
  status: 'applied' | 'conflict'
  id: number
  rev: number | null
  copy: SyncDraftCopy | null
  flags: string[]
  errors: SyncError[]
}

type ItemCtx = { req: PayloadRequest; uid: number; item: SyncItemIn }

/** Server switches + company timezone of one PT (cached per batch). */
type Features = { drafts: boolean; attendance: boolean; progress: boolean; timezone: string }

async function featuresOf(req: PayloadRequest, companyId?: number | null): Promise<Features> {
  const s = (await settings(req, companyId)) as { syncExpenseDraftsEnabled?: boolean | null; syncAttendanceEnabled?: boolean | null; syncProgressReportsEnabled?: boolean | null; timezone?: string | null }
  return {
    drafts: s.syncExpenseDraftsEnabled !== false,
    attendance: s.syncAttendanceEnabled === true,
    progress: s.syncProgressReportsEnabled !== false,
    timezone: s.timezone || DEFAULT_TZ,
  }
}

const posId = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined)

/** PT of an item from its references (null = nothing to derive it from, e.g. an invalid payload). */
export async function itemCompany(req: PayloadRequest, item: SyncItemIn): Promise<number | null> {
  const p = (item.payload && typeof item.payload === 'object' ? item.payload : {}) as Record<string, unknown>
  const pid = posId(p.project_id)
  if (pid !== undefined) return (await companyOf(req, 'projects', pid)) ?? null
  const cc = posId(p.cost_center_id)
  if (cc !== undefined) return (await companyOf(req, 'cost-centers', cc)) ?? null
  const site = posId(p.site_id) // ADR 0023: attendance at a site
  if (site !== undefined) return (await companyOf(req, 'sites', site)) ?? null
  const byUuid = async (collection: CollectionSlug, uuid: unknown): Promise<number | null> => {
    if (typeof uuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(uuid)) return null
    const r = await req.payload.find({ collection, where: { clientUuid: { equals: uuid } }, depth: 0, limit: 1, pagination: false, overrideAccess: true /* SYSTEM-READ: PT of an offline id */, req })
    return relId((r.docs[0] as { company?: unknown } | undefined)?.company) ?? null
  }
  if (item.type === 'expense_request.draft_upsert' || item.type === 'expense_request.draft_delete') {
    const rid = posId(p.request_id)
    if (rid !== undefined) return (await companyOf(req, 'expense-requests', rid)) ?? null
    return byUuid('expense-requests', p.draft_client_uuid ?? (item.type === 'expense_request.draft_upsert' ? item.client_uuid : undefined))
  }
  if (item.type === 'progress_report.draft_upsert') {
    const rid = posId(p.report_id)
    if (rid !== undefined) return (await companyOf(req, 'progress-reports', rid)) ?? null
    return byUuid('progress-reports', p.report_client_uuid ?? item.client_uuid)
  }
  const fieldType = FIELD_SYNC_TYPES[item.type]
  if (fieldType) {
    const ref = fieldItemRef(fieldType, p)
    const rid = posId(ref.id)
    if (rid !== undefined) return (await companyOf(req, FIELD_COLLECTIONS[fieldType], rid)) ?? null
    return byUuid(FIELD_COLLECTIONS[fieldType], ref.uuid ?? item.client_uuid)
  }
  return null
}

/** PT the caller is mapped to (system requests: every PT). */
function isMapped(req: PayloadRequest, company: number | undefined): boolean {
  const mapped = mappedCompanies(req)
  return mapped === null || (company !== undefined && mapped.includes(company))
}

/** PT an item is processed under: its `company_id`, else the only membership (legacy APK), else null. */
function declaredCompany(item: SyncItemIn, memberships: readonly Membership[]): number | null {
  if (typeof item.company_id === 'number') return item.company_id
  return memberships.length === 1 ? memberships[0]!.company : null
}

const UNSUPPORTED: ReadonlySet<SyncItemType> = new Set<SyncItemType>([])
const ATTENDANCE: ReadonlySet<SyncItemType> = new Set<SyncItemType>(['attendance.check_in', 'attendance.check_out', 'attendance.on_behalf'])

const reject = (code: string, message: string, field?: string, target: SyncReject['target'] = null): never => {
  throw new SyncReject([{ code, message, ...(field ? { field } : {}) }], target)
}

function parsePayload<S extends z.ZodType>(schema: S, payload: unknown): z.infer<S> {
  const r = schema.safeParse(payload)
  if (!r.success) {
    throw new SyncReject(r.error.issues.map((i) => ({ code: 'VALIDATION', field: ['payload', ...i.path].join('.'), message: i.message })))
  }
  return r.data
}

// ------------------------------------------------------------------------------------ server copy

type ReceiptRow = {
  id: number
  clientUuid?: string | null
  lineId: string
  receiptNo?: string | null
  vendorName: string
  vendor?: unknown
  receiptDate: string
  receiptTime?: string | null
  amount: number
  taxAmount?: number | null
  image?: unknown
  status: string
  request?: unknown
}

async function receiptRows(req: PayloadRequest, requestId: number): Promise<ReceiptRow[]> {
  const res = await req.payload.find({
    collection: 'receipts',
    where: { request: { equals: requestId } },
    depth: 0,
    pagination: false,
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: receipts of the caller's own draft (creator checked before)
    req,
  })
  return res.docs as unknown as ReceiptRow[]
}

const revOf = (doc: RequestDoc): number => (typeof doc.syncRev === 'number' && doc.syncRev > 0 ? doc.syncRev : 1)

/** Compact server version of a request for the APK (`server_copy`). Caller must be its creator. */
export async function draftCopy(req: PayloadRequest, id: number): Promise<SyncDraftCopy> {
  const doc = (await loadRaw(req, id)) as RequestDoc & { uuid?: string | null }
  const receipts = await receiptRows(req, id)
  return {
    id: doc.id,
    uuid: doc.uuid ?? null,
    client_uuid: doc.clientUuid ?? null,
    rev: revOf(doc),
    status: doc.status,
    doc_no: doc.docNo ?? null,
    kind: doc.type,
    title: doc.title,
    project_id: relId(doc.project) ?? null,
    cost_center_id: relId(doc.costCenter) ?? null,
    needed_date: doc.neededDate ?? null,
    urgency_level_id: relId(doc.urgencyLevel) ?? null,
    notes: doc.notes ?? null,
    requester_ids: ids(doc.requesters),
    bank_account_id: relId(doc.bankAccount) ?? null,
    // ADR 0027
    payee_type: payeeOf(doc.payeeType),
    vendor_id: relId(doc.vendor) ?? null,
    vendor_bank_account_id: relId(doc.vendorBankAccount) ?? null,
    payee_company_id: relId(doc.payeeCompany) ?? null, // ADR 0028
    invoice_no: doc.invoiceNo ?? null,
    invoice_date: doc.invoiceDate ?? null,
    invoice_due_date: doc.invoiceDueDate ?? null,
    invoice_file_id: relId(doc.invoiceFile) ?? null,
    grand_total: doc.grandTotal ?? 0,
    updated_at: doc.updatedAt ?? null,
    lines: (doc.lines ?? []).map((l, i) => ({
      id: l.id,
      no: i + 1,
      description: l.description ?? null,
      qty: l.qty ?? null,
      uom_id: relId(l.uom) ?? null,
      unit_price: l.unitPrice ?? null,
      total: l.total ?? null,
      receipt_amount: l.receiptAmount ?? null,
      notes: l.notes ?? null,
      category_id: relId(l.category) ?? null,
      vehicle_id: relId(l.vehicle) ?? null,
      rap_item_id: relId(l.rapItem) ?? null,
    })),
    receipts: receipts.map((r) => ({
      id: r.id,
      client_uuid: r.clientUuid ?? null,
      line_id: r.lineId,
      receipt_no: r.receiptNo ?? null,
      vendor_name: r.vendorName,
      receipt_date: r.receiptDate,
      receipt_time: r.receiptTime ?? null,
      amount: r.amount,
      tax_amount: r.taxAmount ?? null,
      media_id: relId(r.image) ?? null,
      status: r.status,
    })),
  }
}

// ------------------------------------------------------------------------------------ drafts

/**
 * Finds the target draft (locked) by server id or APK draft id. Another user's draft: NOT_FOUND
 * when the caller cannot read it, else NOT_EDITABLE (no server copy for non-creators).
 */
async function resolveDraft(c: ItemCtx, requestId: number | undefined, draftUuid: string | undefined): Promise<RequestDoc | null> {
  const { req, uid } = c
  let id: number | undefined = requestId
  if (id === undefined && draftUuid) {
    const found = await req.payload.find({
      collection: 'expense-requests',
      where: { clientUuid: { equals: draftUuid } },
      depth: 0,
      limit: 1,
      pagination: false,
      overrideAccess: true, // SYSTEM-READ: offline id lookup (creator checked below)
      req,
    })
    id = (found.docs[0] as { id?: number } | undefined)?.id
    if (id === undefined) return null
  }
  if (id === undefined) return null
  await lockRequest(req, id)
  const doc = (await req.payload.findByID({ collection: 'expense-requests', id, depth: 0, overrideAccess: true /* SYSTEM-READ: creator checked below */, req, disableErrors: true })) as unknown as RequestDoc | null
  if (!doc) reject('NOT_FOUND', 'Pengajuan tidak ditemukan.', 'payload.request_id')
  if (relId(doc!.createdBy) !== uid) {
    const visible = await loadVisible(req, id).then(
      () => true,
      () => false,
    )
    if (!visible) reject('NOT_FOUND', 'Pengajuan tidak ditemukan.', requestId !== undefined ? 'payload.request_id' : 'payload.draft_client_uuid')
    reject('NOT_EDITABLE', 'Draft hanya dapat diubah oleh pembuatnya.')
  }
  return doc
}

async function requireDraft(c: ItemCtx, doc: RequestDoc): Promise<void> {
  if (doc.status !== 'draft') {
    reject('NOT_EDITABLE', 'Pengajuan sudah bukan draft; perubahan offline tidak dapat diterapkan.', undefined, { id: doc.id, copy: await draftCopy(c.req, doc.id) })
  }
}

function toDraftInput(p: SyncDraftUpsert): DraftInput {
  const input: DraftInput = {}
  if (p.kind !== undefined) input.type = p.kind
  if (p.title !== undefined) input.title = p.title
  if (p.project_id !== undefined) input.projectId = p.project_id
  if (p.cost_center_id !== undefined) input.costCenterId = p.cost_center_id
  if (p.needed_date !== undefined) input.neededDate = p.needed_date
  if (p.urgency_level_id !== undefined) input.urgencyLevelId = p.urgency_level_id
  // period_from / period_to (APK ≤ 0.3.x) are accepted and ignored since 2026-10-09
  if (p.notes !== undefined) input.notes = p.notes
  if (p.requester_ids !== undefined) input.requesterIds = p.requester_ids
  if (p.bank_account_id !== undefined) input.bankAccountId = p.bank_account_id
  // ADR 0027 vendor payment
  if (p.payee_type !== undefined) input.payeeType = p.payee_type
  if (p.vendor_id !== undefined) input.vendorId = p.vendor_id
  if (p.vendor_bank_account_id !== undefined) input.vendorBankAccountId = p.vendor_bank_account_id
  // ADR 0028 PT grup payment (an older app omits both → the stored payee type and receiving PT stay)
  if (p.payee_company_id !== undefined) input.payeeCompanyId = p.payee_company_id
  if (p.invoice_no !== undefined) input.invoiceNo = p.invoice_no
  if (p.invoice_date !== undefined) input.invoiceDate = p.invoice_date
  if (p.invoice_due_date !== undefined) input.invoiceDueDate = p.invoice_due_date
  if (p.invoice_file_id !== undefined) input.invoiceFileId = p.invoice_file_id
  // D2410 (point 6): the general attachments ("Lampiran") — replaces the list; omitted (APK ≤ 0.11) = unchanged
  if (p.attachment_ids !== undefined) input.attachmentIds = p.attachment_ids
  if (p.lines !== undefined) {
    input.lines = p.lines.map(
      (l): LineInputApi => ({
        ...(l.id ?? l.client_uuid ? { id: l.id ?? l.client_uuid } : {}),
        description: l.description,
        qty: l.qty ?? null,
        uomId: l.uom_id ?? null,
        unitPrice: l.unit_price ?? null,
        total: l.total ?? null,
        receiptAmount: l.receipt_amount ?? null,
        notes: l.notes ?? null,
        categoryId: l.category_id ?? null,
        vehicleId: l.vehicle_id ?? null,
        // D4: omitted by APK ≤ 0.7 → the line keeps its stored RAP item (updateDraft keepRapItems)
        ...(l.rap_item_id !== undefined ? { rapItemId: l.rap_item_id } : {}),
      }),
    )
  }
  return input
}

const ACTIVE_RECEIPT = new Set(['pending', 'valid', 'rejected'])

/** A line that still carries a receipt may not disappear (the receipt would point nowhere). */
async function guardLineRemoval(c: ItemCtx, requestId: number, p: SyncDraftUpsert): Promise<void> {
  if (p.lines === undefined) return
  const keep = new Set(p.lines.map((l) => l.id ?? l.client_uuid).filter(Boolean))
  const orphan = (await receiptRows(c.req, requestId)).filter((r) => ACTIVE_RECEIPT.has(r.status) && !keep.has(r.lineId))
  if (orphan.length > 0) {
    reject('VALIDATION', `Baris yang masih memiliki nota tidak dapat dihapus (nota #${orphan.map((r) => r.id).join(', #')}). Hapus notanya dulu.`, 'payload.lines')
  }
}

async function upsertReceipts(c: ItemCtx, requestId: number, p: SyncDraftUpsert): Promise<void> {
  const { req, uid } = c
  const wanted = (p.lines ?? []).flatMap((l, i) => (l.receipts ?? []).map((r, j) => ({ r, lineId: l.id ?? l.client_uuid, path: `payload.lines.${i}.receipts.${j}` })))
  if (wanted.length === 0) return
  const doc = await loadRaw(req, requestId)
  if (doc.type !== 'reimburse') reject('VALIDATION', 'Nota Pengajuan Baru diunggah setelah transfer (LPJ), bukan pada draft.', 'payload.lines')
  const seen = new Set<string>()
  for (const { r, lineId, path } of wanted) {
    if (!lineId) reject('VALIDATION', 'Baris dengan nota wajib punya id atau client_uuid.', path)
    if (seen.has(r.client_uuid)) reject('VALIDATION', 'client_uuid nota ganda.', `${path}.client_uuid`)
    seen.add(r.client_uuid)
    const found = await req.payload.find({
      collection: 'receipts',
      where: { clientUuid: { equals: r.client_uuid } },
      depth: 0,
      limit: 1,
      pagination: false,
      overrideAccess: true, // SYSTEM-READ: offline id lookup (request checked below)
      req,
    })
    const existing = found.docs[0] as unknown as ReceiptRow | undefined
    if (existing) {
      if (relId(existing.request) !== requestId) reject('CLIENT_UUID_CONFLICT', 'client_uuid nota sudah dipakai pengajuan lain.', `${path}.client_uuid`)
      if (existing.status === 'removed') continue // removed on the server: server wins
      if (relId(existing.image) !== r.media_id) reject('VALIDATION', 'Foto nota tidak dapat diganti; hapus nota lalu tambah nota baru.', `${path}.media_id`)
      const patch: Record<string, unknown> = {}
      const norm = (v: string | null | undefined) => (v ?? '').trim() || null
      if (existing.lineId !== lineId) patch.lineId = lineId
      if (norm(existing.receiptNo) !== norm(r.receipt_no)) patch.receiptNo = r.receipt_no ?? null
      if (existing.vendorName !== r.vendor_name.trim()) patch.vendorName = r.vendor_name
      if (r.vendor_id !== undefined && (relId(existing.vendor) ?? null) !== r.vendor_id) patch.vendorId = r.vendor_id
      if (existing.receiptDate !== r.receipt_date) patch.receiptDate = r.receipt_date
      if (r.receipt_time !== undefined && (existing.receiptTime ?? null) !== r.receipt_time) patch.receiptTime = r.receipt_time
      if (existing.amount !== r.amount) patch.amount = r.amount
      if (r.tax_amount !== undefined && (existing.taxAmount ?? null) !== r.tax_amount) patch.taxAmount = r.tax_amount
      if (Object.keys(patch).length > 0) await editReceipt(req, requestId, existing.id, patch)
      continue
    }
    const media = (await req.payload.findByID({ collection: 'media-receipts', id: r.media_id, depth: 0, overrideAccess: true /* SYSTEM-READ: existence + uploader */, req, disableErrors: true })) as {
      uploadedBy?: unknown
    } | null
    if (!media) reject('MEDIA_MISSING', 'Foto nota belum terunggah (POST /api/v1/media/receipts).', `${path}.media_id`)
    if (relId(media!.uploadedBy) !== uid) reject('FORBIDDEN', 'Foto nota bukan unggahan Anda.', `${path}.media_id`)
    await addReceipt(
      req,
      requestId,
      {
        lineId: lineId!,
        receiptNo: r.receipt_no ?? null,
        vendorName: r.vendor_name,
        vendorId: r.vendor_id ?? null,
        receiptDate: r.receipt_date,
        receiptTime: r.receipt_time ?? null,
        amount: r.amount,
        taxAmount: r.tax_amount ?? null,
        imageId: r.media_id,
      },
      { clientUuid: r.client_uuid },
    )
  }
}

async function applyDraftUpsert(c: ItemCtx): Promise<Outcome> {
  const { req, item } = c
  const p = parsePayload(SyncDraftUpsertPayload, item.payload)
  const existing = await resolveDraft(c, p.request_id, p.request_id === undefined ? (p.draft_client_uuid ?? item.client_uuid) : undefined)
  let id: number
  if (existing) {
    await requireDraft(c, existing)
    const rev = revOf(existing)
    if (item.base_rev === null || item.base_rev === undefined || item.base_rev < rev) {
      return {
        status: 'conflict',
        id: existing.id,
        rev,
        copy: await draftCopy(req, existing.id),
        flags: [],
        errors: [{ code: 'STALE_REV', field: 'base_rev', message: 'Draft sudah diubah di tempat lain; versi server yang berlaku (simpan salinan konflik).' }],
      }
    }
    if (item.base_rev > rev) reject('VALIDATION', `base_rev ${item.base_rev} lebih baru dari revisi server ${rev}.`, 'base_rev')
    await guardLineRemoval(c, existing.id, p)
    await updateDraft(req, existing.id, toDraftInput(p))
    id = existing.id
  } else {
    if (p.request_id !== undefined) reject('NOT_FOUND', 'Pengajuan tidak ditemukan.', 'payload.request_id')
    if (!p.kind) reject('VALIDATION', 'kind wajib untuk draft baru.', 'payload.kind')
    if (!p.title) reject('VALIDATION', 'title wajib untuk draft baru.', 'payload.title')
    const { doc } = await createDraft(req, { ...toDraftInput(p), type: p.kind!, title: p.title!, clientUuid: p.draft_client_uuid ?? item.client_uuid })
    id = doc.id
  }
  await upsertReceipts(c, id, p)
  const copy = await draftCopy(req, id)
  const flags: string[] = []
  if (p.client_grand_total !== undefined && p.client_grand_total !== null && p.client_grand_total !== copy.grand_total) flags.push('CLIENT_TOTAL_MISMATCH')
  return { status: 'applied', id, rev: copy.rev, copy, flags, errors: [] }
}

async function applyDraftDelete(c: ItemCtx): Promise<Outcome> {
  const { req, item } = c
  const p = parsePayload(SyncDraftDeletePayload, item.payload)
  if (p.request_id === undefined && !p.draft_client_uuid) reject('VALIDATION', 'request_id atau draft_client_uuid wajib.', 'payload')
  const doc = await resolveDraft(c, p.request_id, p.request_id === undefined ? p.draft_client_uuid : undefined)
  if (!doc) return reject('NOT_FOUND', 'Draft tidak ditemukan.', 'payload.draft_client_uuid')
  if (doc.status === 'cancelled') {
    const copy = await draftCopy(req, doc.id)
    return { status: 'applied', id: doc.id, rev: copy.rev, copy, flags: ['ALREADY_CANCELLED'], errors: [] }
  }
  await requireDraft(c, doc)
  const rev = revOf(doc)
  if (item.base_rev !== null && item.base_rev !== undefined && item.base_rev < rev) {
    return {
      status: 'conflict',
      id: doc.id,
      rev,
      copy: await draftCopy(req, doc.id),
      flags: [],
      errors: [{ code: 'STALE_REV', field: 'base_rev', message: 'Draft sudah diubah di tempat lain; versi server yang berlaku.' }],
    }
  }
  const reason = p.reason ?? 'Draft dihapus dari aplikasi'
  req.context.auditReason = reason
  try {
    // never submitted: closed as "Dibatalkan" (the outcome the APK always received); D2410 "Hapus draft": a draft
    // submitted before (withdrawn, numbered) and never decided is soft-deleted by the same rule as the web / REST
    // (deleteDraft: own Draft, no decision in any cycle, number never reused) — a decided one → 409 → rejected
    if (doc.docNo) await deleteDraft(req, doc.id, reason)
    else await discardDraft(req, doc.id, reason)
  } finally {
    delete req.context.auditReason
  }
  const copy = await draftCopy(req, doc.id)
  return { status: 'applied', id: doc.id, rev: copy.rev, copy, flags: doc.docNo ? ['DELETED'] : [], errors: [] }
}

// ------------------------------------------------------------------------------------ attendance

/** Sync adapter of domain/attendance/record.ts (the only attendance write path). */
async function applyAttendance(c: ItemCtx, verdict: TimeVerdict, receivedAt: Date, features: Features): Promise<Outcome> {
  const { req, uid, item } = c
  const onBehalf = item.type === 'attendance.on_behalf'
  const p = onBehalf ? parsePayload(SyncOnBehalfPayload, item.payload) : parsePayload(SyncAttendancePayload, item.payload)
  // ADR 0016 D1: the caller's employee IN THE LOCATION's PT (one employee per PT)
  // QA-MC4-14: a location of an unmapped PT is treated like a missing one (recordAttendance → NOT_FOUND)
  const location = locationOf(p)
  const locRaw = await companyOf(req, LOCATION_COLLECTION[location.type], location.id)
  const locCompany = isMapped(req, locRaw) ? locRaw : undefined
  const own = locCompany !== undefined ? employeeIn(req, locCompany) : await employeeOfUser(req, uid)
  let employee: number
  let user: number | null
  let source: 'self' | 'pm' | 'admin' = 'self'
  if (onBehalf) {
    // US-14: "diabsenkan oleh PM" — requirements §4 "Absensi": PM C (atas nama tim). Not an approval
    // (ADR 0013 covers expense decisions only), so the PM keeps this right. ADR 0032: an Admin Staff of the PT records
    // for ANY employee of it (source `admin`; wins over PM when the caller holds both).
    let actor: Awaited<ReturnType<typeof onBehalfActor>>
    try {
      actor = await onBehalfActor(req, { employeeId: (p as SyncOnBehalf).employee_id, locCompany, own, pmAllowed: true })
    } catch (err) {
      if (err instanceof AttendanceReject) return reject(err.code, err.message, err.field)
      throw err
    }
    employee = actor.employee
    user = actor.user
    source = actor.source
  } else {
    if (own === undefined) reject('VALIDATION', 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin.')
    employee = own!
    user = uid
  }
  const { time, flags: timeFlags } = attendanceTimeOf(verdict, item.device_time, receivedAt)
  const device = (req.user as { _pkDevice?: { id?: number } } | null)?._pkDevice?.id
  try {
    const { id } = await recordAttendance(req, {
      kind: onBehalf ? (p as SyncOnBehalf).kind : item.type === 'attendance.check_out' ? 'check_out' : 'check_in',
      employee,
      user,
      location,
      lat: p.lat,
      lng: p.lng,
      accuracyM: p.accuracy_m ?? null,
      isMocked: p.is_mocked,
      selfieId: p.selfie_media_id,
      uploader: uid,
      time,
      timeTrust: verdict.timeTrust,
      estimatedTime: verdict.estimatedTime,
      receivedAt,
      deviceTime: item.device_time,
      offline: item.offline,
      flags: [...verdict.flags, ...timeFlags],
      clientUuid: item.client_uuid,
      device: device ?? null,
      source,
      recordedBy: onBehalf ? uid : null,
      onBehalfReason: onBehalf ? (p as SyncOnBehalf).reason : null,
      timeZone: features.timezone,
    })
    return { status: 'applied', id, rev: null, copy: null, flags: timeFlags, errors: [] }
  } catch (err) {
    if (err instanceof AttendanceReject) return reject(err.code, err.message, err.field)
    throw err
  }
}

/**
 * ADR 0018 (owner 2026-10-05): while "Versi APK minimum" ≥ 0.3.3, an attendance capture (own check-in/out, and
 * on-behalf: the acting PM) of a user without the current privacy acknowledgement is rejected
 * `PRIVACY_ACK_REQUIRED` — a final rejection (stored, never retried); the attempt is audited `access_denied`.
 */
async function refuseWithoutPrivacyAck(c: ItemCtx, companyId: number | null): Promise<void> {
  const check = await privacyAckCheck(c.req, c.uid)
  if (!check.required) return
  await auditPrivacyDenied(c.req, check, { docType: 'attendance', field: c.item.type, companyId })
  reject(PRIVACY_ACK_REQUIRED, PRIVACY_ACK_REQUIRED_DETAIL)
}

// ------------------------------------------------------------------------------------ storage

type StoredRow = { user_id: number; status: 'applied' | 'rejected' | 'conflict'; result: SyncResultOut }

async function readStored(req: PayloadRequest, clientUuid: string): Promise<StoredRow | null> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT user_id, status, result FROM sync_receipts WHERE client_uuid = ${clientUuid}::uuid`)) as unknown as { rows: StoredRow[] }
  return r.rows[0] ?? null
}

async function lockItem(req: PayloadRequest, clientUuid: string): Promise<void> {
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sync:${clientUuid}`}, 0))`)
}

async function store(c: ItemCtx, batch: SyncBatchIn, deviceId: string, verdict: TimeVerdict, result: SyncResultOut, companyId: number | null): Promise<void> {
  const { req, uid, item } = c
  const tx = await getRequestTx(req)
  await tx.execute(sql`
    INSERT INTO sync_receipts (client_uuid, user_id, device_id, batch_id, item_type, status, server_id, rev, offline, device_time, elapsed_ms, estimated_time, time_trust, result)
    VALUES (${item.client_uuid}::uuid, ${uid}, ${deviceId}, ${batch.batch_id}::uuid, ${item.type}, ${result.status}, ${result.server_id}, ${result.rev},
            ${item.offline}, ${item.device_time}::timestamptz, ${item.elapsed_ms}, ${verdict.estimatedTime}::timestamptz, ${verdict.timeTrust}, ${JSON.stringify(result)}::jsonb)
    ON CONFLICT (client_uuid) DO NOTHING`)
  // Retention 30 days (ADR 0010): opportunistic purge, no separate job needed.
  if (Math.random() < 0.02) await tx.execute(sql`DELETE FROM sync_receipts WHERE expires_at < now()`)
  await writeAudit(req, [
    {
      action: 'sync_offline',
      docType: ATTENDANCE.has(item.type) ? 'attendance' : item.type === 'progress_report.draft_upsert' ? 'progress_report' : (FIELD_SYNC_TYPES[item.type] ?? 'expense_request'),
      docId: result.server_id ?? undefined,
      docNo: result.server_copy?.doc_no ?? result.server_report?.doc_no ?? result.server_service_report?.doc_no ?? result.server_daily_report?.doc_no ?? undefined,
      field: item.type,
      newValue: {
        client_uuid: item.client_uuid,
        batch_id: batch.batch_id,
        status: result.status,
        offline: item.offline,
        time_trust: verdict.timeTrust,
        estimated_time: verdict.estimatedTime,
        flags: result.flags,
        errors: result.errors.map((e) => e.code),
      },
      deviceTime: item.device_time,
      companyId, // MC3: audit row tagged with the item's PT
    },
  ])
}

async function checkDependencies(req: PayloadRequest, uid: number, item: SyncItemIn): Promise<void> {
  const deps = [...new Set(item.depends_on ?? [])].filter((d) => d !== item.client_uuid)
  if (deps.length === 0) return
  const tx = await getRequestTx(req)
  const list = sql.join(
    deps.map((d) => sql`${d}::uuid`),
    sql`, `,
  )
  const r = (await tx.execute(sql`SELECT client_uuid::text AS client_uuid, status FROM sync_receipts WHERE user_id = ${uid} AND client_uuid IN (${list})`)) as unknown as {
    rows: Array<{ client_uuid: string; status: string }>
  }
  const byId = new Map(r.rows.map((x) => [x.client_uuid, x.status]))
  const failed = deps.filter((d) => byId.has(d) && byId.get(d) !== 'applied')
  if (failed.length > 0) throw new SyncReject(failed.map((d) => ({ code: 'DEPENDENCY_FAILED', field: 'depends_on', message: `Item ${d} tidak diterapkan (${byId.get(d)}).` })))
  const missing = deps.filter((d) => !byId.has(d))
  if (missing.length > 0) throw new SyncDefer(missing.map((d) => ({ code: 'DEPENDENCY_PENDING', field: 'depends_on', message: `Item ${d} belum diterima server.` })))
}

// ------------------------------------------------------------------------------------ errors

/** Domain/DB error → sync error codes (never internals). null = unexpected (item deferred). */
function mapError(err: unknown): SyncError[] | null {
  if (err instanceof SyncReject || err instanceof ProgressSyncReject || err instanceof FieldSyncReject) return err.errors
  if (err instanceof APIError && err.status < 500) {
    const message = err.isPublic ? err.message : 'Ditolak.'
    const pkCode = (err as { pkCode?: unknown }).pkCode // E4 ProgressError: stable domain code
    const code =
      typeof pkCode === 'string'
        ? pkCode
        : err.status === 403 || err.status === 401
          ? 'FORBIDDEN'
          : err.status === 404
            ? 'NOT_FOUND'
            : err.status === 409
              ? 'STATE_CONFLICT'
              : 'VALIDATION'
    const list = (err.data as { errors?: Array<{ path?: string; field?: string; message?: string }> } | null | undefined)?.errors
    if (Array.isArray(list) && list.length > 0 && (err.isPublic || err instanceof ValidationError)) {
      return list.map((e) => ({ code, field: `payload.${toSnake(e.path ?? e.field ?? '')}`.replace(/\.$/, ''), message: e.message ?? message }))
    }
    return [{ code, message }]
  }
  // QA-05: drizzle wraps the pg error — the SQLSTATE is on `cause` (pgCode unwraps it)
  if (isDbGuardError(err)) {
    return [{ code: 'INTEGRITY', message: 'Ditolak oleh aturan integritas data.' }]
  }
  return null
}

/** API field paths (camelCase, `lines.0.uomId`) → sync payload paths (`lines.0.uom_id`). */
function toSnake(path: string): string {
  return path
    .replace(/^type$/, 'kind')
    .replace(/Ids?\b/g, (m) => (m === 'Ids' ? '_ids' : '_id'))
    .replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)
}

// ------------------------------------------------------------------------------------ batch

function baseResult(item: SyncItemIn, receivedAt: Date, verdict: TimeVerdict): SyncResultOut {
  return {
    client_uuid: item.client_uuid,
    status: 'rejected',
    original_status: null,
    server_id: null,
    rev: null,
    received_at: receivedAt.toISOString(),
    time_trust: verdict.timeTrust,
    flags: [...verdict.flags],
    errors: [],
    server_copy: null,
  }
}

function duplicateOf(stored: StoredRow, uid: number, fallback: SyncResultOut): SyncResultOut {
  if (stored.user_id !== uid) {
    return { ...fallback, status: 'rejected', errors: [{ code: 'CLIENT_UUID_CONFLICT', field: 'client_uuid', message: 'client_uuid sudah dipakai.' }] }
  }
  return { ...stored.result, status: 'duplicate', original_status: stored.status }
}

async function processItem(req: PayloadRequest, batch: SyncBatchIn, deviceId: string, uid: number, item: SyncItemIn, memberships: readonly Membership[]): Promise<SyncResultOut> {
  const receivedAt = new Date()
  const verdict = judgeTime(item, batch.clock, receivedAt)
  const base = baseResult(item, receivedAt, verdict)
  if (UNSUPPORTED.has(item.type)) {
    return { ...base, status: 'unsupported', errors: [{ code: 'UNSUPPORTED', message: 'Jenis data ini belum didukung server; tetap simpan di antrean.' }] }
  }
  const c: ItemCtx = { req, uid, item }
  // processBatch refused legacy items of multi-PT callers (409), so `declared` is null only for a
  // caller without any membership; such an item is rejected below.
  const declared = declaredCompany(item, memberships)
  const member = declared !== null && memberships.some((m) => m.company === declared)
  const withPt: SyncResultOut = { ...base, company_id: member ? declared : null }
  const run = <T,>(fn: () => Promise<T>): Promise<T> => (member ? runUnderCompany(req, declared!, fn) : fn())
  return run(() => processOwn(c, batch, deviceId, verdict, withPt, receivedAt, declared, member))
}

async function processOwn(c: ItemCtx, batch: SyncBatchIn, deviceId: string, verdict: TimeVerdict, base: SyncResultOut, receivedAt: Date, declared: number | null, member: boolean): Promise<SyncResultOut> {
  const { req, uid, item } = c
  try {
    return await withReqTransaction(req, async () => {
      await lockItem(req, item.client_uuid)
      const stored = await readStored(req, item.client_uuid)
      if (stored) return duplicateOf(stored, uid, base)
      // ADR 0016 §8 / MC3-1: the item's PT = company_id (membership), = the PT of its references
      if (!member) reject('COMPANY_NOT_ALLOWED', 'PT data ini bukan PT Anda.', 'company_id')
      const company = await itemCompany(req, item)
      // QA-MC4-14 (scope rule): COMPANY_MISMATCH only for a reference in a PT the caller is MAPPED to; a
      // reference of an unmapped PT runs on and is answered exactly like a missing one (no existence oracle)
      if (company !== null && company !== declared && isMapped(req, company)) reject('COMPANY_MISMATCH', 'Data ini milik PT lain dari company_id item ini.', typeof item.company_id === 'number' ? 'company_id' : 'payload')
      const features = await featuresOf(req, declared!)
      const isAttendance = ATTENDANCE.has(item.type)
      const isProgress = item.type === 'progress_report.draft_upsert'
      const fieldType = FIELD_SYNC_TYPES[item.type]
      if (isAttendance && !features.attendance) reject('FEATURE_DISABLED', 'Absensi dari aplikasi belum diaktifkan server (Setting perusahaan).')
      if (isProgress && !features.progress) reject('FEATURE_DISABLED', 'Laporan progress dari aplikasi sedang dinonaktifkan server (Setting perusahaan).')
      // FR1: the field-report flag (companies.fieldReportsEnabled) is enforced by the domain services (creates → FEATURE_DISABLED)
      if (!isAttendance && !isProgress && !fieldType && !features.drafts) reject('FEATURE_DISABLED', 'Sinkronisasi draft pengajuan sedang dinonaktifkan server.')
      if (isAttendance) await refuseWithoutPrivacyAck(c, declared)
      await checkDependencies(req, uid, item)
      if (fieldType) {
        const fo = await applyFieldItem(c, fieldType, verdict, receivedAt)
        const result: SyncResultOut = {
          ...base,
          status: fo.status,
          server_id: String(fo.id),
          rev: fo.rev,
          flags: [...base.flags, ...fo.flags],
          errors: fo.errors,
          server_copy: null,
          [FIELD_COPY_KEY[fieldType]]: fo.copy,
        }
        await store(c, batch, deviceId, verdict, result, declared)
        return result
      }
      if (isProgress) {
        const po = await applyProgressReport(c, verdict, receivedAt)
        const result: SyncResultOut = {
          ...base,
          status: po.status,
          server_id: String(po.id),
          rev: po.rev,
          flags: [...base.flags, ...po.flags],
          errors: po.errors,
          server_copy: null,
          server_report: po.copy,
        }
        await store(c, batch, deviceId, verdict, result, declared)
        return result
      }
      const out = isAttendance
        ? await applyAttendance(c, verdict, receivedAt, features)
        : item.type === 'expense_request.draft_delete'
          ? await applyDraftDelete(c)
          : await applyDraftUpsert(c)
      const result: SyncResultOut = {
        ...base,
        status: out.status,
        server_id: String(out.id),
        rev: out.rev,
        flags: [...base.flags, ...out.flags],
        errors: out.errors,
        server_copy: out.copy,
      }
      await store(c, batch, deviceId, verdict, result, declared)
      return result
    })
  } catch (err) {
    if (err instanceof SyncDefer) return { ...base, status: 'deferred', errors: err.errors }
    const errors = mapError(err)
    if (!errors) {
      req.payload.logger.error({ msg: 'sync item failed', type: item.type, err: (err as Error).message })
      return { ...base, status: 'deferred', errors: [{ code: 'INTERNAL', message: 'Server sedang bermasalah; item dikirim ulang nanti.' }] }
    }
    const target = err instanceof SyncReject ? err.target : null
    const report = err instanceof ProgressSyncReject ? err : null
    const field = err instanceof FieldSyncReject ? err : null
    const fieldType = FIELD_SYNC_TYPES[item.type]
    const rejected: SyncResultOut = {
      ...base,
      status: 'rejected',
      server_id: target ? String(target.id) : report?.id ? String(report.id) : field?.id ? String(field.id) : null,
      rev: target?.copy?.rev ?? report?.copy?.rev ?? field?.copy?.rev ?? null,
      errors,
      server_copy: target?.copy ?? null,
      ...(item.type === 'progress_report.draft_upsert' ? { server_report: report?.copy ?? null } : {}),
      ...(fieldType ? { [FIELD_COPY_KEY[fieldType]]: field?.copy ?? null } : {}),
    }
    return withReqTransaction(req, async () => {
      await lockItem(req, item.client_uuid)
      const stored = await readStored(req, item.client_uuid)
      if (stored) return duplicateOf(stored, uid, base)
      await store(c, batch, deviceId, verdict, rejected, member ? declared : null)
      return rejected
    })
  }
}

/** 409 of a batch with items WITHOUT `company_id` from a caller with ≠ 1 PT (MC3-1, released APK). */
export class CompanyRequiredError extends Error {
  constructor(readonly indexes: number[]) {
    super('COMPANY_REQUIRED')
  }
}

export async function processBatch(req: PayloadRequest, batch: SyncBatchIn, deviceId: string) {
  const uid = userId(req)
  if (uid === undefined) throw new APIError('Unauthorized', 401)
  const memberships = companyContextOf(req.user)?.memberships ?? []
  // MC3-1: an item without company_id is only unambiguous for a caller with exactly one PT
  if (memberships.length !== 1) {
    const legacy = batch.items.flatMap((it, i) => (typeof it.company_id === 'number' ? [] : [i]))
    if (legacy.length > 0) throw new CompanyRequiredError(legacy)
  }
  const results: SyncResultOut[] = []
  for (const item of batch.items) {
    results.push(await processItem(req, batch, deviceId, uid, item, memberships))
  }
  return { batch_id: batch.batch_id, server_time: new Date().toISOString(), results }
}
