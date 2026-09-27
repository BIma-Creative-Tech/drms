import { sql } from '@payloadcms/db-postgres'
import { APIError, ValidationError, type PayloadRequest } from 'payload'
import type { z } from 'zod'

import { hasRole, relId, userId } from '@/access/roles'
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
import { createDraft, updateDraft, type DraftInput, type LineInputApi } from '@/domain/expense/drafts'
import { addReceipt, editReceipt } from '@/domain/expense/receipts'
import { cancel } from '@/domain/expense/workflow'
import { withReqTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { AttendanceReject, recordAttendance, userOfEmployee } from '@/domain/attendance/record'

import { attendanceTimeOf, employeeOfUser } from './attendance'
import { judgeTime, type TimeVerdict } from './clock'
import { applyProgressReport, ProgressSyncReject } from './progress'

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
 *   NOT_EDITABLE`); delete = cancel (soft delete, requirements §1.2 #6).
 * - Attendance check-in/out + PM on-behalf (company-settings.syncAttendanceEnabled; checks in
 *   domain/attendance/record.ts): assigned project/cost center with a geofence, inside radius
 *   (+ capped GPS accuracy), not mocked, selfie uploaded by the caller, one check-in and one
 *   check-out per employee/location/local date; on-behalf = PM of the team location only (US-14).
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

/** Server switches + company timezone, read once per batch. */
type Features = { drafts: boolean; attendance: boolean; progress: boolean; timezone: string }

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
    period_from: doc.periodFrom ?? null,
    period_to: doc.periodTo ?? null,
    notes: doc.notes ?? null,
    requester_ids: ids(doc.requesters),
    bank_account_id: relId(doc.bankAccount) ?? null,
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
      notes: l.notes ?? null,
      category_id: relId(l.category) ?? null,
      vehicle_id: relId(l.vehicle) ?? null,
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
  if (p.period_from !== undefined) input.periodFrom = p.period_from
  if (p.period_to !== undefined) input.periodTo = p.period_to
  if (p.notes !== undefined) input.notes = p.notes
  if (p.requester_ids !== undefined) input.requesterIds = p.requester_ids
  if (p.bank_account_id !== undefined) input.bankAccountId = p.bank_account_id
  if (p.lines !== undefined) {
    input.lines = p.lines.map(
      (l): LineInputApi => ({
        ...(l.id ?? l.client_uuid ? { id: l.id ?? l.client_uuid } : {}),
        description: l.description,
        qty: l.qty ?? null,
        uomId: l.uom_id ?? null,
        unitPrice: l.unit_price ?? null,
        total: l.total ?? null,
        notes: l.notes ?? null,
        categoryId: l.category_id ?? null,
        vehicleId: l.vehicle_id ?? null,
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
  if (doc.type !== 'reimburse') reject('VALIDATION', 'Nota Uang Muka diunggah setelah transfer (LPJ), bukan pada draft.', 'payload.lines')
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
    await cancel(req, doc.id, reason)
  } finally {
    delete req.context.auditReason
  }
  const copy = await draftCopy(req, doc.id)
  return { status: 'applied', id: doc.id, rev: copy.rev, copy, flags: [], errors: [] }
}

// ------------------------------------------------------------------------------------ attendance

/** Sync adapter of domain/attendance/record.ts (the only attendance write path). */
async function applyAttendance(c: ItemCtx, verdict: TimeVerdict, receivedAt: Date, features: Features): Promise<Outcome> {
  const { req, uid, item } = c
  const onBehalf = item.type === 'attendance.on_behalf'
  const p = onBehalf ? parsePayload(SyncOnBehalfPayload, item.payload) : parsePayload(SyncAttendancePayload, item.payload)
  const own = await employeeOfUser(req, uid)
  let employee: number
  let user: number | null
  if (onBehalf) {
    const ob = p as SyncOnBehalf
    // US-14: "diabsenkan oleh PM" — requirements §4 "Absensi": PM C (atas nama tim). Not an approval
    // (ADR 0013 covers expense decisions only), so the PM keeps this right.
    if (!hasRole(req, 'pk-pm')) reject('FORBIDDEN', 'Hanya PM yang dapat mengabsenkan anggota tim.')
    if (own !== undefined && own === ob.employee_id) reject('FORBIDDEN', 'Absensi Anda sendiri dicatat lewat absen masuk/pulang biasa.', 'payload.employee_id')
    const emp = (await req.payload.findByID({ collection: 'employees', id: ob.employee_id, depth: 0, overrideAccess: true /* SYSTEM-READ: target employee of on-behalf */, req, disableErrors: true })) as { active?: boolean | null } | null
    if (!emp) reject('NOT_FOUND', 'Karyawan tidak ditemukan.', 'payload.employee_id')
    if (emp!.active === false) reject('VALIDATION', 'Karyawan sudah nonaktif.', 'payload.employee_id')
    employee = ob.employee_id
    user = await userOfEmployee(req, employee)
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
      location: p.project_id !== undefined ? { type: 'project', id: p.project_id } : { type: 'cost_center', id: p.cost_center_id! },
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
      source: onBehalf ? 'pm' : 'self',
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

async function store(c: ItemCtx, batch: SyncBatchIn, deviceId: string, verdict: TimeVerdict, result: SyncResultOut): Promise<void> {
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
      docType: ATTENDANCE.has(item.type) ? 'attendance' : item.type === 'progress_report.draft_upsert' ? 'progress_report' : 'expense_request',
      docId: result.server_id ?? undefined,
      docNo: result.server_copy?.doc_no ?? result.server_report?.doc_no ?? undefined,
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
  if (err instanceof SyncReject || err instanceof ProgressSyncReject) return err.errors
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
  const pg = err as { code?: unknown }
  if (typeof pg.code === 'string' && /^(42501|23505|23514|P0001)$/.test(pg.code)) {
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

async function processItem(req: PayloadRequest, batch: SyncBatchIn, deviceId: string, uid: number, item: SyncItemIn, features: Features): Promise<SyncResultOut> {
  const receivedAt = new Date()
  const verdict = judgeTime(item, batch.clock, receivedAt)
  const base = baseResult(item, receivedAt, verdict)
  if (UNSUPPORTED.has(item.type)) {
    return { ...base, status: 'unsupported', errors: [{ code: 'UNSUPPORTED', message: 'Jenis data ini belum didukung server; tetap simpan di antrean.' }] }
  }
  const c: ItemCtx = { req, uid, item }
  try {
    return await withReqTransaction(req, async () => {
      await lockItem(req, item.client_uuid)
      const stored = await readStored(req, item.client_uuid)
      if (stored) return duplicateOf(stored, uid, base)
      const isAttendance = ATTENDANCE.has(item.type)
      const isProgress = item.type === 'progress_report.draft_upsert'
      if (isAttendance && !features.attendance) reject('FEATURE_DISABLED', 'Absensi dari aplikasi belum diaktifkan server (Setting perusahaan).')
      if (isProgress && !features.progress) reject('FEATURE_DISABLED', 'Laporan progress dari aplikasi sedang dinonaktifkan server (Setting perusahaan).')
      if (!isAttendance && !isProgress && !features.drafts) reject('FEATURE_DISABLED', 'Sinkronisasi draft pengajuan sedang dinonaktifkan server.')
      await checkDependencies(req, uid, item)
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
        await store(c, batch, deviceId, verdict, result)
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
      await store(c, batch, deviceId, verdict, result)
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
    const rejected: SyncResultOut = {
      ...base,
      status: 'rejected',
      server_id: target ? String(target.id) : report?.id ? String(report.id) : null,
      rev: target?.copy?.rev ?? report?.copy?.rev ?? null,
      errors,
      server_copy: target?.copy ?? null,
      ...(item.type === 'progress_report.draft_upsert' ? { server_report: report?.copy ?? null } : {}),
    }
    return withReqTransaction(req, async () => {
      await lockItem(req, item.client_uuid)
      const stored = await readStored(req, item.client_uuid)
      if (stored) return duplicateOf(stored, uid, base)
      await store(c, batch, deviceId, verdict, rejected)
      return rejected
    })
  }
}

export async function processBatch(req: PayloadRequest, batch: SyncBatchIn, deviceId: string) {
  const uid = userId(req)
  if (uid === undefined) throw new APIError('Unauthorized', 401)
  const s = (await settings(req)) as { syncExpenseDraftsEnabled?: boolean | null; syncAttendanceEnabled?: boolean | null; syncProgressReportsEnabled?: boolean | null; timezone?: string | null }
  const features: Features = {
    drafts: s.syncExpenseDraftsEnabled !== false,
    attendance: s.syncAttendanceEnabled === true,
    progress: s.syncProgressReportsEnabled !== false,
    timezone: s.timezone || DEFAULT_TZ,
  }
  const results: SyncResultOut[] = []
  for (const item of batch.items) {
    results.push(await processItem(req, batch, deviceId, uid, item, features))
  }
  return { batch_id: batch.batch_id, server_time: new Date().toISOString(), results }
}
