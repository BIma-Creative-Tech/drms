import { sql } from '@payloadcms/db-postgres'
import { APIError, type CollectionSlug, type PayloadRequest } from 'payload'

import { relId, userId } from '@/access/roles'
import { writeAudit, writeAuditDetached } from '@/audit/writer'
import { companyById } from '@/domain/companies'
import { claimMedia } from '@/domain/expense/receipts'
import { localDate } from '@/domain/progress/rules'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { canCorrectFieldOn, canFieldReportOn, FIELD_COLLECTIONS, fieldReportsEnabled } from './access'
import { EDIT_WINDOW_HOURS, FIELD_REPORT_LABELS, kindAllows, kindOf, MAX_PHOTOS, reportDateError, type FieldReportType, type ProjectKind } from './rules'

/**
 * FR1 shared machinery of the field-report services (ADR 0020 §6): coded errors, project gate
 * (flag → access → state → kind), photos (media-progress-photos, owner link via claimMedia), the
 * 24 h window, PM/Direktur corrections (transaction-local `pk.field_override`), offline idempotency,
 * timing (same shape as progress reports) and the unit state side effects (status, last HM).
 */

/** Public domain error with a stable machine code (problem+json `code`, sync `errors[].code`). */
export class FieldError extends APIError {
  constructor(
    status: number,
    message: string,
    readonly pkCode: string,
    field?: string,
    readonly pkExtra?: Record<string, unknown>,
  ) {
    super(message, status, field ? { errors: [{ path: field, message }] } : null, true)
  }
}

export const fail = (status: number, code: string, message: string, field?: string, extra?: Record<string, unknown>): never => {
  throw new FieldError(status, message, code, field, extra)
}

/** Issues → 400 with every field path (`errors[]`). */
export function validation(issues: Array<{ path: string; message: string }>): void {
  if (issues.length === 0) return
  const e = new FieldError(400, issues.map((i) => i.message).slice(0, 3).join(' '), 'VALIDATION')
  ;(e as unknown as { data: unknown }).data = { errors: issues }
  throw e
}

export type Timing = {
  /** The time that counts (server time online; estimate / device time offline). */
  time: Date
  timeTrust: 'server' | 'estimated' | 'device_only'
  offline: boolean
  deviceTime?: string | null
  flags?: string[]
}

export const SERVER_TIMING = (): Timing => ({ time: new Date(), timeTrust: 'server', offline: false })

export type FieldDoc = Record<string, unknown> & {
  id: number
  company?: unknown
  project?: unknown
  reporter?: unknown
  editableUntil?: string | null
  syncRev?: number | null
  clientUuid?: string | null
  flags?: unknown
  updatedAt?: string
  createdAt?: string
}

export type ProjectRow = { id: number; company: number; kind: ProjectKind; status?: string | null; client: number | null; code: string; name: string; pm: number | null }

export const revOf = (d: { syncRev?: unknown }): number => (typeof d.syncRev === 'number' && d.syncRev > 0 ? d.syncRev : Number(d.syncRev) > 0 ? Number(d.syncRev) : 1)
export const flagsOf = (d: { flags?: unknown }): string[] => (Array.isArray(d.flags) ? d.flags.filter((f): f is string => typeof f === 'string') : [])

export async function loadProject(req: PayloadRequest, projectId: number): Promise<ProjectRow | null> {
  const p = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: project gate (caller checked below) */, req, disableErrors: true })) as Record<string, unknown> | null
  if (!p) return null
  return {
    id: p.id as number,
    company: relId(p.company)!,
    kind: kindOf(p.kind),
    status: (p.status as string | null) ?? null,
    client: relId(p.client) ?? null,
    code: String(p.code ?? ''),
    name: String(p.name ?? ''),
    pm: relId(p.pm) ?? null,
  }
}

async function denied(req: PayloadRequest, type: FieldReportType, projectId: number, what: string): Promise<never> {
  await writeAuditDetached(req, [
    { action: 'access_denied', docType: type, field: what, newValue: { projectId }, reason: 'laporan lapangan hanya oleh Staff yang ditugaskan, PM tim, atau Direktur (ADR 0020 §2)' },
  ])
  return fail(403, 'FORBIDDEN', `${FIELD_REPORT_LABELS[type]} hanya dapat dibuat oleh Staff yang ditugaskan ke project ini, PM project, atau Direktur.`, 'projectId')
}

/**
 * Gate of a NEW field report on `projectId` (ADR 0020): project exists → PT flag on (403
 * FEATURE_DISABLED) → caller may report on it (403 FORBIDDEN, audited) → not archived (409) → the
 * project kind offers `type` (409 WRONG_PROJECT_KIND).
 */
export async function requireReportableProject(req: PayloadRequest, projectId: number, type: FieldReportType): Promise<ProjectRow> {
  const p = await loadProject(req, projectId)
  if (!p) return fail(404, 'NOT_FOUND', 'Project tidak ditemukan.', 'projectId')
  if (!(await fieldReportsEnabled(req, p.company))) return fail(403, 'FEATURE_DISABLED', 'Laporan lapangan belum diaktifkan untuk PT ini (Setting perusahaan).')
  if (!(await canFieldReportOn(req, projectId))) return denied(req, type, projectId, 'create')
  if (p.status === 'arsip') return fail(409, 'STATE_CONFLICT', 'Project sudah diarsipkan.', 'projectId')
  if (!kindAllows(p.kind, type)) {
    return fail(409, 'WRONG_PROJECT_KIND', `${FIELD_REPORT_LABELS[type]} tidak tersedia untuk project berjenis "${p.kind}".`, 'projectId', { projectKind: p.kind })
  }
  return p
}

/** Today (business date) + timezone of a PT; `time` = the instant that counts. */
export async function companyDay(req: PayloadRequest, companyId: number, time: Date = new Date()): Promise<{ tz: string; today: string }> {
  const c = await companyById(req, companyId)
  const tz = c.timezone || process.env.TZ || DEFAULT_TZ
  return { tz, today: localDate(time, tz) }
}

export function checkReportDate(date: string, today: string, field: string): void {
  const err = reportDateError(date, today)
  if (err) fail(400, 'VALIDATION', err, field)
}

// ---------------------------------------------------------------- loading / idempotency

export async function loadRaw<T extends FieldDoc>(req: PayloadRequest, type: FieldReportType, id: number): Promise<T | null> {
  return (await req.payload.findByID({ collection: FIELD_COLLECTIONS[type], id, depth: 0, overrideAccess: true /* SYSTEM-READ: caller checked by the service */, req, disableErrors: true })) as T | null
}

/** A document the CALLER may read (collection access), else 404. */
export async function loadVisible<T extends FieldDoc>(req: PayloadRequest, type: FieldReportType, id: number): Promise<T> {
  const doc = (await req.payload.findByID({ collection: FIELD_COLLECTIONS[type], id, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req }).catch(() => null)) as T | null
  if (!doc) fail(404, 'NOT_FOUND', `${FIELD_REPORT_LABELS[type]} tidak ditemukan.`)
  return doc!
}

export async function findByClientUuid<T extends FieldDoc>(req: PayloadRequest, type: FieldReportType, clientUuid: string): Promise<T | null> {
  const res = await req.payload.find({
    collection: FIELD_COLLECTIONS[type],
    where: { clientUuid: { equals: clientUuid } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: offline idempotency key lookup (reporter checked by the caller)
    req,
  })
  return (res.docs[0] as unknown as T | undefined) ?? null
}

/** Replay of a clientUuid: same reporter → the existing document; another user → 409 CLIENT_UUID_CONFLICT. */
export async function replayOf<T extends FieldDoc>(req: PayloadRequest, type: FieldReportType, clientUuid: string | null | undefined): Promise<T | null> {
  if (!clientUuid) return null
  const existing = await findByClientUuid<T>(req, type, clientUuid)
  if (!existing) return null
  if (relId(existing.reporter) !== userId(req)) fail(409, 'CLIENT_UUID_CONFLICT', 'clientUuid sudah dipakai.', 'clientUuid')
  return existing
}

/** Row lock of a field document (serialises edits/corrections and the PO status side effects). */
export async function lockDoc(req: PayloadRequest, type: FieldReportType, id: number): Promise<void> {
  const tx = await getRequestTx(req)
  const table = { service_report: sql`service_reports`, unit_timesheet: sql`unit_timesheets`, aftersales_activity: sql`aftersales_activities`, daily_report: sql`daily_reports` }[type]
  await tx.execute(sql`SELECT id FROM ${table} WHERE id = ${id} FOR UPDATE`)
}

export function isEditable(req: PayloadRequest, d: FieldDoc, now = Date.now()): boolean {
  return relId(d.reporter) === userId(req) && !!d.editableUntil && new Date(d.editableUntil).getTime() > now
}

/** Reporter edit: own document, inside the 24 h window (else 403/409 NOT_EDITABLE). */
export function requireReporterEdit(req: PayloadRequest, d: FieldDoc, label: string): void {
  if (relId(d.reporter) !== userId(req)) fail(403, 'NOT_EDITABLE', `${label} hanya dapat diedit oleh pelapornya (koreksi: PM/Direktur).`)
  if (!d.editableUntil || new Date(d.editableUntil).getTime() <= Date.now()) {
    fail(409, 'NOT_EDITABLE', `${label} hanya dapat diedit ${EDIT_WINDOW_HOURS} jam setelah dibuat; setelah itu koreksi oleh PM/Direktur dengan alasan.`)
  }
}

/** PM team / Direktur correction gate (reason ≥ 3 chars). */
export async function requireCorrector(req: PayloadRequest, type: FieldReportType, d: FieldDoc, reason: string | undefined): Promise<string> {
  const projectId = relId(d.project)!
  if (!(await canCorrectFieldOn(req, projectId))) {
    await writeAuditDetached(req, [{ action: 'access_denied', docType: type, docId: String(d.id), field: 'correction', reason: 'koreksi laporan lapangan hanya oleh PM project atau Direktur' }])
    fail(403, 'FORBIDDEN', 'Koreksi hanya oleh PM project ini atau Direktur.')
  }
  const r = (reason ?? '').trim()
  if (r.length < 3) fail(400, 'VALIDATION', 'Alasan koreksi wajib diisi (min. 3 karakter).', 'reason')
  return r
}

/**
 * Runs `fn` with the transaction-local DB override (`pk.field_override` = 'correction' | 'system'):
 * the window trigger of migration fr1_security then accepts the UPDATE after the 24 h window
 * ('system': only po_status / flags / sync_rev). Reset afterwards (same transaction).
 */
export async function withOverride<T>(req: PayloadRequest, mode: 'correction' | 'system', fn: () => Promise<T>): Promise<T> {
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT set_config('pk.field_override', ${mode}, true)`)
  try {
    return await fn()
  } finally {
    await tx.execute(sql`SELECT set_config('pk.field_override', '', true)`)
  }
}

/** Updates a field document as SYSTEM-WRITE with the audit reason (withAudit diff) of this change. */
export async function writeDoc(req: PayloadRequest, type: FieldReportType, id: number, data: Record<string, unknown>, reason?: string): Promise<void> {
  const prev = req.context.auditReason
  if (reason) req.context.auditReason = reason
  try {
    await req.payload.update({
      collection: FIELD_COLLECTIONS[type],
      id,
      data: data as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: field report service (checks above; DB enforces window/identity)
      req,
    })
  } finally {
    if (reason) {
      if (prev === undefined) delete req.context.auditReason
      else req.context.auditReason = prev
    }
  }
}

export async function createDoc<T extends FieldDoc>(req: PayloadRequest, type: FieldReportType, data: Record<string, unknown>): Promise<T> {
  return (await req.payload.create({
    collection: FIELD_COLLECTIONS[type],
    data: data as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: field report after the service checks (HTTP create is closed)
    req,
  })) as unknown as T
}

// ---------------------------------------------------------------- photos

export async function photoIdsOf(req: PayloadRequest, type: FieldReportType, id: number): Promise<number[]> {
  const res = await req.payload.find({
    collection: 'media-progress-photos',
    where: { and: [{ ownerDocType: { equals: type } }, { ownerDocId: { equals: String(id) } }] },
    depth: 0,
    pagination: false,
    sort: 'id',
    select: { filename: true },
    overrideAccess: true, // SYSTEM-READ: photos of a document the caller may read
    req,
  })
  return res.docs.map((d) => d.id as number)
}

export type PhotoRow = { id: number; ownerDocId: string; width?: number | null; height?: number | null; filesize?: number | null }

export async function photosOf(req: PayloadRequest, type: FieldReportType, ids: readonly number[]): Promise<Map<number, PhotoRow[]>> {
  const map = new Map<number, PhotoRow[]>()
  if (ids.length === 0) return map
  const r = await req.payload.find({
    collection: 'media-progress-photos',
    where: { and: [{ ownerDocType: { equals: type } }, { ownerDocId: { in: ids.map(String) } }] },
    depth: 0,
    pagination: false,
    sort: 'id',
    select: { ownerDocId: true, width: true, height: true, filesize: true },
    overrideAccess: true, // SYSTEM-READ: photos of documents the caller may read (same rule as the photo read access)
    req,
  })
  for (const d of r.docs as unknown as PhotoRow[]) {
    const k = Number(d.ownerDocId)
    map.set(k, [...(map.get(k) ?? []), d])
  }
  return map
}

export const photoDto = (p: PhotoRow) => ({
  id: p.id,
  width: p.width ?? null,
  height: p.height ?? null,
  filesize: p.filesize ?? null,
  url: `/api/v1/media/progress-photos/${p.id}/file`,
  thumbUrl: `/api/v1/media/progress-photos/${p.id}/file?variant=thumb`,
})

/** Photos: unique, ≤ the type's maximum in total, uploaded by the caller, not owned yet. */
export async function checkPhotos(req: PayloadRequest, type: FieldReportType, ids: readonly number[], existing: number): Promise<void> {
  const max = MAX_PHOTOS[type]
  if (new Set(ids).size !== ids.length) fail(400, 'VALIDATION', 'Foto ganda.', 'photoIds')
  if (existing + ids.length > max) fail(400, 'PHOTO_LIMIT', `Maksimal ${max} foto (sudah ${existing}, ditambah ${ids.length}).`, 'photoIds')
  const uid = userId(req)
  for (const id of ids) {
    const m = (await req.payload.findByID({ collection: 'media-progress-photos', id, depth: 0, overrideAccess: true /* SYSTEM-READ: existence + uploader */, req, disableErrors: true })) as { uploadedBy?: unknown; ownerDocId?: string | null } | null
    if (!m) fail(400, 'MEDIA_MISSING', `Foto #${id} belum terunggah (POST /api/v1/media/progress-photos).`, 'photoIds')
    if (relId(m!.uploadedBy) !== uid) fail(403, 'FORBIDDEN', `Foto #${id} bukan unggahan Anda.`, 'photoIds')
    if (m!.ownerDocId) fail(409, 'MEDIA_IN_USE', `Foto #${id} sudah dipakai di dokumen lain.`, 'photoIds')
  }
}

export async function claimPhotos(req: PayloadRequest, type: FieldReportType, ownerId: number, ids: readonly number[], docNo?: string): Promise<void> {
  for (const id of ids) await claimMedia(req, 'media-progress-photos', id, ownerId, { ownerType: type })
  if (ids.length > 0) await writeAudit(req, [{ action: 'update', docType: type, docId: String(ownerId), docNo, field: 'photos', newValue: [...ids] }])
}

// ---------------------------------------------------------------- unit side effects

export type UnitRow = { id: number; company: number; kind: string; owner: string; client: number | null; status: string; lastHourMeter: number | null; unitCode: string | null; plateDisplay: string | null; type: string | null; active: boolean }

export async function loadUnit(req: PayloadRequest, unitId: number): Promise<UnitRow | null> {
  const u = (await req.payload.findByID({ collection: 'vehicles', id: unitId, depth: 0, overrideAccess: true /* SYSTEM-READ: unit of a field report (same PT checked by the caller) */, req, disableErrors: true })) as Record<string, unknown> | null
  if (!u) return null
  return {
    id: u.id as number,
    company: relId(u.company)!,
    kind: String(u.kind ?? 'kendaraan'),
    owner: String(u.owner ?? 'sendiri'),
    client: relId(u.client) ?? null,
    status: String(u.status ?? 'siap'),
    lastHourMeter: u.lastHourMeter === null || u.lastHourMeter === undefined ? null : Number(u.lastHourMeter),
    unitCode: (u.unitCode as string | null) ?? null,
    plateDisplay: (u.plateDisplay as string | null) ?? null,
    type: (u.type as string | null) ?? null,
    active: u.active !== false,
  }
}

/** A unit of the project's PT (404 otherwise — no existence oracle across PTs). */
export async function requireUnit(req: PayloadRequest, unitId: number, company: number): Promise<UnitRow> {
  const u = await loadUnit(req, unitId)
  if (!u || u.company !== company) return fail(404, 'NOT_FOUND', 'Unit tidak ditemukan.', 'unitId')
  if (!u.active) return fail(409, 'STATE_CONFLICT', 'Unit sudah dinonaktifkan.', 'unitId')
  return u
}

/** Latest HM reading of a unit on or before `date` (timesheet HM end / service HM), excluding one document. */
export async function readingOnOrBefore(req: PayloadRequest, unitId: number, company: number, date: string, except?: { type: FieldReportType; id: number }): Promise<number | null> {
  const tx = await getRequestTx(req)
  const exTs = except?.type === 'unit_timesheet' ? except.id : 0
  const exSv = except?.type === 'service_report' ? except.id : 0
  const r = (await tx.execute(sql`
    SELECT reading FROM (
      SELECT t.hm_end AS reading, t.report_date AS d, t.received_at AS at FROM unit_timesheets t
       WHERE t.unit_id = ${unitId} AND t.company_id = ${company} AND t.report_date <= ${date} AND t.id <> ${exTs}
      UNION ALL
      SELECT s.hour_meter, s.report_date, s.received_at FROM service_reports s
       WHERE s.unit_id = ${unitId} AND s.company_id = ${company} AND s.report_date <= ${date} AND s.hour_meter IS NOT NULL AND s.id <> ${exSv}
    ) x ORDER BY d DESC, at DESC LIMIT 1`)) as unknown as { rows: Array<{ reading: string | number }> }
  const v = r.rows[0]?.reading
  return v === undefined || v === null ? null : Number(v)
}

/** HM end of the latest timesheet of the unit BEFORE `date` (HM_GAP reference). */
export async function previousTimesheetEnd(req: PayloadRequest, unitId: number, company: number, date: string): Promise<number | null> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT t.hm_end FROM unit_timesheets t WHERE t.unit_id = ${unitId} AND t.company_id = ${company} AND t.report_date < ${date}
     ORDER BY t.report_date DESC, t.id DESC LIMIT 1`)) as unknown as { rows: Array<{ hm_end: string | number }> }
  const v = r.rows[0]?.hm_end
  return v === undefined || v === null ? null : Number(v)
}

/**
 * Unit state from its field documents (ADR 0020 §5/§6), recalculated after every create / edit /
 * correction so a corrected typo also corrects the unit:
 * - `lastHourMeter` / `lastHourMeterAt` = the reading of the LATEST document (report date, then
 *   server time) among timesheets (HM end) and service reports (HM);
 * - `status` = `unitStatusAfter` of the latest service report (unchanged when there is none).
 * Returns the status before/after (menunggu_part notification).
 */
export async function refreshUnit(req: PayloadRequest, unitId: number, company: number): Promise<{ before: string; after: string }> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT reading, at FROM (
      SELECT t.hm_end AS reading, t.report_date AS d, t.received_at AS at FROM unit_timesheets t WHERE t.unit_id = ${unitId} AND t.company_id = ${company}
      UNION ALL
      SELECT s.hour_meter, s.report_date, s.received_at FROM service_reports s WHERE s.unit_id = ${unitId} AND s.company_id = ${company} AND s.hour_meter IS NOT NULL
    ) x ORDER BY d DESC, at DESC LIMIT 1`)) as unknown as { rows: Array<{ reading: string | number; at: string | Date | null }> }
  const st = (await tx.execute(sql`
    SELECT s.unit_status_after::text AS status FROM service_reports s WHERE s.unit_id = ${unitId} AND s.company_id = ${company}
     ORDER BY s.report_date DESC, s.received_at DESC, s.id DESC LIMIT 1`)) as unknown as { rows: Array<{ status: string }> }
  const unit = await loadUnit(req, unitId)
  const before = unit?.status ?? 'siap'
  const row = r.rows[0]
  const data: Record<string, unknown> = {
    lastHourMeter: row ? Number(row.reading) : null,
    lastHourMeterAt: row?.at ? new Date(row.at).toISOString() : null,
  }
  const after = st.rows[0]?.status ?? before
  if (after !== before) data.status = after
  const same = unit && unit.lastHourMeter === data.lastHourMeter && data.status === undefined
  if (!same) {
    await req.payload.update({
      collection: 'vehicles',
      id: unitId,
      data: data as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: unit state from field reports (status / last HM are system fields)
      req,
    })
  }
  return { before, after }
}

export const collectionOf = (type: FieldReportType): CollectionSlug => FIELD_COLLECTIONS[type]
