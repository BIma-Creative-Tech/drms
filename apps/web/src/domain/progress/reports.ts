import { APIError, type PayloadRequest, type Where } from 'payload'

import { relId, userId } from '@/access/roles'
import { writeAudit, writeAuditDetached } from '@/audit/writer'
import { settings } from '@/domain/expense/common'
import { claimMedia } from '@/domain/expense/receipts'
import { parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { requestMeta } from '@/lib/request-meta'
import { DEFAULT_TZ } from '@/lib/time'

import { canReportOn } from './access'
import { lockProject, projectStages, recalcProjectProgress, setStageProgress } from './recalc'
import { EDIT_WINDOW_HOURS, isComplete, isPct, localDate, MAX_PHOTOS, projectProgress, round2, weightSum } from './rules'

/**
 * T11 progress reports (US-10/US-31, plan fase1-golive §E4) — the single write path used by
 * POST/PATCH /api/v1/progress-reports and the sync item `progress_report.draft_upsert`.
 * Runs inside the caller's transaction: number allocation, report row, photo ownership, stage % and
 * project progress (Σ weight × %) and every audit row commit or roll back together.
 */

/** Public domain error with a stable machine code (sync `errors[].code`, problem+json `code`). */
export class ProgressError extends APIError {
  constructor(
    status: number,
    message: string,
    readonly pkCode: string,
    field?: string,
  ) {
    super(message, status, field ? { errors: [{ path: field, message }] } : null, true)
  }
}

const fail = (status: number, code: string, message: string, field?: string): never => {
  throw new ProgressError(status, message, code, field)
}

export type ReportDoc = {
  id: number
  uuid?: string | null
  docNo?: string | null
  project: unknown
  stage: unknown
  reportDate: string
  pctBefore: number
  pctAfter: number
  projectPctBefore?: number | null
  projectPctAfter?: number | null
  work: string
  issues?: string | null
  reporter: unknown
  photoCount?: number | null
  receivedAt?: string | null
  editableUntil?: string | null
  deviceTime?: string | null
  timeTrust?: 'server' | 'estimated' | 'device_only' | null
  offline?: boolean | null
  source?: 'web' | 'apk' | null
  flags?: string[] | null
  syncRev?: number | null
  clientUuid?: string | null
  createdAt?: string
  updatedAt?: string
}

export type ReportInput = {
  projectId: number
  stageId: number
  pctAfter: number
  work: string
  issues?: string | null
  photoIds?: number[]
  clientUuid?: string | null
}

export type ReportTiming = {
  /** The time that counts for `reportDate` (server time online, estimate/device time offline). */
  time: Date
  timeTrust: 'server' | 'estimated' | 'device_only'
  offline: boolean
  deviceTime?: string | null
  flags?: string[]
}

export type ReportPatch = {
  pctAfter?: number
  work?: string
  issues?: string | null
  addPhotoIds?: number[]
  reason: string
}

type ProjectRow = { id: number; status?: string | null; code?: string; name?: string; progressPct?: number | null }

const revOf = (d: Pick<ReportDoc, 'syncRev'>): number => (typeof d.syncRev === 'number' && d.syncRev > 0 ? d.syncRev : 1)
export { revOf as reportRev }

async function loadRaw(req: PayloadRequest, id: number): Promise<ReportDoc | null> {
  return (await req.payload.findByID({ collection: 'progress-reports', id, depth: 0, overrideAccess: true /* SYSTEM-READ: caller checked by the service */, req, disableErrors: true })) as ReportDoc | null
}

/** A report the CALLER may read (collection access), else 404. */
export async function loadVisibleReport(req: PayloadRequest, id: number): Promise<ReportDoc> {
  const doc = (await req.payload
    .findByID({ collection: 'progress-reports', id, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req })
    .catch(() => null)) as ReportDoc | null
  if (!doc) fail(404, 'NOT_FOUND', 'Laporan progress tidak ditemukan.')
  return doc!
}

export async function findByClientUuid(req: PayloadRequest, clientUuid: string): Promise<ReportDoc | null> {
  const res = await req.payload.find({
    collection: 'progress-reports',
    where: { clientUuid: { equals: clientUuid } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: offline idempotency key lookup (reporter checked by the caller)
    req,
  })
  return (res.docs[0] as unknown as ReportDoc | undefined) ?? null
}

async function denied(req: PayloadRequest, projectId: number, what: string): Promise<never> {
  await writeAuditDetached(req, [
    {
      action: 'access_denied',
      docType: 'progress_report',
      field: what,
      newValue: { projectId },
      reason: 'laporan progress hanya oleh PM project tim atau Direktur (requirements §4; Staff tidak membuat)',
    },
  ])
  return fail(403, 'FORBIDDEN', 'Laporan progress hanya dapat dibuat oleh PM project ini atau Direktur.', 'projectId')
}

function validateText(input: { work?: string; issues?: string | null }, forCreate: boolean): void {
  if (forCreate || input.work !== undefined) {
    const w = (input.work ?? '').trim()
    if (w.length < 3) fail(400, 'VALIDATION', 'Uraian pekerjaan wajib diisi (min. 3 karakter).', 'work')
    if (w.length > 2000) fail(400, 'VALIDATION', 'Uraian pekerjaan maks. 2000 karakter.', 'work')
  }
  if (input.issues !== undefined && input.issues !== null && input.issues.trim().length > 2000) fail(400, 'VALIDATION', 'Kendala maks. 2000 karakter.', 'issues')
}

/** Photos: unique, ≤ MAX_PHOTOS in total, uploaded by the caller, not owned by another document. */
async function checkPhotos(req: PayloadRequest, ids: readonly number[], existing: number): Promise<void> {
  if (new Set(ids).size !== ids.length) fail(400, 'VALIDATION', 'Foto ganda.', 'photoIds')
  if (existing + ids.length > MAX_PHOTOS) fail(400, 'PHOTO_LIMIT', `Maksimal ${MAX_PHOTOS} foto per laporan (sudah ${existing}, ditambah ${ids.length}).`, 'photoIds')
  const uid = userId(req)
  for (const id of ids) {
    const m = (await req.payload.findByID({ collection: 'media-progress-photos', id, depth: 0, overrideAccess: true /* SYSTEM-READ: existence + uploader */, req, disableErrors: true })) as {
      uploadedBy?: unknown
      ownerDocId?: string | null
    } | null
    if (!m) fail(400, 'MEDIA_MISSING', `Foto #${id} belum terunggah (POST /api/v1/media/progress-photos).`, 'photoIds')
    if (relId(m!.uploadedBy) !== uid) fail(403, 'FORBIDDEN', `Foto #${id} bukan unggahan Anda.`, 'photoIds')
    if (m!.ownerDocId) fail(409, 'MEDIA_IN_USE', `Foto #${id} sudah dipakai di laporan lain.`, 'photoIds')
  }
}

export async function reportPhotoIds(req: PayloadRequest, reportId: number): Promise<number[]> {
  const res = await req.payload.find({
    collection: 'media-progress-photos',
    where: { and: [{ ownerDocType: { equals: 'progress_report' } }, { ownerDocId: { equals: String(reportId) } }] },
    depth: 0,
    pagination: false,
    sort: 'id',
    select: { filename: true },
    overrideAccess: true, // SYSTEM-READ: photos of a report the caller may read
    req,
  })
  return res.docs.map((d) => d.id as number)
}

async function claimPhotos(req: PayloadRequest, reportId: number, ids: readonly number[]): Promise<void> {
  for (const id of ids) await claimMedia(req, 'media-progress-photos', id, reportId, { ownerType: 'progress_report' })
}

async function companyTz(req: PayloadRequest): Promise<string> {
  const s = await settings(req)
  return s.timezone || process.env.TZ || DEFAULT_TZ
}

async function loadProject(req: PayloadRequest, projectId: number): Promise<ProjectRow> {
  const p = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: status (caller checked) */, req, disableErrors: true })) as ProjectRow | null
  if (!p) fail(404, 'NOT_FOUND', 'Project tidak ditemukan.', 'projectId')
  if (p!.status === 'arsip') fail(409, 'STATE_CONFLICT', 'Project sudah diarsipkan.', 'projectId')
  return p!
}

/**
 * Creates a report (US-10). Replaying a `clientUuid` of the same reporter returns the existing
 * report (`created: false`); another user's clientUuid → 409.
 */
export async function createReport(req: PayloadRequest, input: ReportInput, timing?: ReportTiming): Promise<{ doc: ReportDoc; created: boolean }> {
  const uid = userId(req)
  if (uid === undefined) fail(401, 'FORBIDDEN', 'Unauthorized')
  if (input.clientUuid) {
    const existing = await findByClientUuid(req, input.clientUuid)
    if (existing) {
      if (relId(existing.reporter) !== uid) fail(409, 'CLIENT_UUID_CONFLICT', 'clientUuid sudah dipakai.', 'clientUuid')
      return { doc: existing, created: false }
    }
  }
  if (!(await canReportOn(req, input.projectId))) await denied(req, input.projectId, 'create')
  validateText(input, true)
  if (!isPct(input.pctAfter)) fail(400, 'VALIDATION', 'Progress tahapan 0–100 dengan maks. 2 desimal.', 'pctAfter')
  const photoIds = input.photoIds ?? []
  await checkPhotos(req, photoIds, 0)

  await lockProject(req, input.projectId)
  const projectRow = await loadProject(req, input.projectId)
  const stages = await projectStages(req, input.projectId)
  const stage = stages.find((s) => s.id === input.stageId)
  if (!stage) fail(400, 'VALIDATION', 'Tahapan bukan milik project ini.', 'stageId')
  if (!stage!.active) fail(409, 'STATE_CONFLICT', 'Tahapan sudah dinonaktifkan.', 'stageId')
  const sum = weightSum(stages)
  if (!isComplete(sum)) fail(409, 'WEIGHTS_INCOMPLETE', `Total bobot tahapan project belum 100% (sekarang ${sum}%). Lengkapi tahapan dulu.`, 'projectId')
  const pctBefore = round2(stage!.progressPct)
  if (input.pctAfter < pctBefore) {
    fail(409, 'PROGRESS_DECREASED', `Progress tahapan tidak boleh turun (sekarang ${pctBefore}%). Koreksi lewat edit laporan terakhir (≤ ${EDIT_WINDOW_HOURS} jam).`, 'pctAfter')
  }

  const pctAfter = round2(input.pctAfter)
  // Project % before → after of this report (the recalculation below writes the same value).
  const projectPctBefore = round2(Number(projectRow.progressPct ?? 0))
  const projectPctAfter = projectProgress(stages.map((s) => (s.id === input.stageId ? { ...s, progressPct: pctAfter } : s)))

  const t: ReportTiming = timing ?? { time: new Date(), timeTrust: 'server', offline: false }
  const reportDate = localDate(t.time, await companyTz(req))
  const { docNo } = await allocateDocNo(req, 'progress_report', { date: parseBusinessDate(reportDate) })
  const receivedAt = new Date()
  const meta = requestMeta(req)
  const doc = (await req.payload.create({
    collection: 'progress-reports',
    data: {
      docNo,
      project: input.projectId,
      stage: input.stageId,
      reportDate,
      pctBefore,
      pctAfter,
      projectPctBefore,
      projectPctAfter,
      work: input.work.trim(),
      issues: input.issues?.trim() || null,
      reporter: uid!,
      photoCount: photoIds.length,
      // DB trigger: received_at = clock_timestamp(), editable_until = received_at + 24 h.
      receivedAt: receivedAt.toISOString(),
      editableUntil: new Date(receivedAt.getTime() + EDIT_WINDOW_HOURS * 3_600_000).toISOString(),
      deviceTime: t.deviceTime ? new Date(t.deviceTime).toISOString() : null,
      timeTrust: t.timeTrust,
      offline: t.offline,
      source: meta.source === 'apk' ? 'apk' : 'web',
      flags: t.flags ?? [],
      syncRev: 1,
      clientUuid: input.clientUuid ?? null,
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: report after the checks above (HTTP create is closed)
    req,
  })) as unknown as ReportDoc
  await claimPhotos(req, doc.id, photoIds)
  if (photoIds.length > 0) {
    await writeAudit(req, [{ action: 'create', docType: 'progress_report', docId: String(doc.id), docNo, field: 'photos', newValue: [...photoIds] }])
  }
  if (pctAfter !== pctBefore) await setStageProgress(req, input.stageId, pctAfter)
  await recalcProjectProgress(req, input.projectId)
  return { doc: (await loadRaw(req, doc.id))!, created: true }
}

/** Latest report of a stage (by id): only this one may change the stage % on edit. */
async function latestOfStage(req: PayloadRequest, stageId: number): Promise<number | undefined> {
  const res = await req.payload.find({
    collection: 'progress-reports',
    where: { stage: { equals: stageId } } as Where,
    depth: 0,
    limit: 1,
    sort: '-id',
    select: { docNo: true },
    overrideAccess: true, // SYSTEM-READ: latest report of the stage
    req,
  })
  return res.docs[0]?.id as number | undefined
}

/**
 * Edit within 24 h by the reporter (requirements §8 T11: reason required). `pctAfter` may change
 * only on the latest report of its stage and never below `pctBefore`; photos can be added up to 5.
 */
export async function editReport(req: PayloadRequest, id: number, patch: ReportPatch): Promise<ReportDoc> {
  const uid = userId(req)
  const visible = await loadVisibleReport(req, id)
  const projectId = relId(visible.project)!
  await lockProject(req, projectId)
  const doc = (await loadRaw(req, id))!
  if (relId(doc.reporter) !== uid) fail(403, 'NOT_EDITABLE', 'Laporan hanya dapat diedit oleh pelapornya.')
  if (!doc.editableUntil || new Date(doc.editableUntil).getTime() <= Date.now()) {
    fail(409, 'NOT_EDITABLE', `Laporan hanya dapat diedit ${EDIT_WINDOW_HOURS} jam setelah dibuat.`)
  }
  const reason = (patch.reason ?? '').trim()
  if (reason.length < 3) fail(400, 'VALIDATION', 'Alasan edit wajib diisi (min. 3 karakter).', 'reason')
  validateText(patch, false)
  const add = patch.addPhotoIds ?? []
  const current = await reportPhotoIds(req, id)
  await checkPhotos(req, add, current.length)

  const data: Record<string, unknown> = {}
  const stageId = relId(doc.stage)!
  let stageChange: number | undefined
  if (patch.pctAfter !== undefined && round2(patch.pctAfter) !== round2(doc.pctAfter)) {
    if (!isPct(patch.pctAfter)) fail(400, 'VALIDATION', 'Progress tahapan 0–100 dengan maks. 2 desimal.', 'pctAfter')
    if ((await latestOfStage(req, stageId)) !== id) fail(409, 'STATE_CONFLICT', 'Progress hanya dapat dikoreksi pada laporan terakhir tahapan ini.', 'pctAfter')
    if (patch.pctAfter < round2(doc.pctBefore)) fail(409, 'PROGRESS_DECREASED', `Progress tidak boleh di bawah nilai sebelum laporan (${doc.pctBefore}%).`, 'pctAfter')
    data.pctAfter = round2(patch.pctAfter)
    stageChange = round2(patch.pctAfter)
    const stages = await projectStages(req, projectId)
    data.projectPctAfter = projectProgress(stages.map((s) => (s.id === stageId ? { ...s, progressPct: stageChange! } : s)))
  }
  if (patch.work !== undefined && patch.work.trim() !== doc.work) data.work = patch.work.trim()
  if (patch.issues !== undefined && (patch.issues?.trim() || null) !== (doc.issues ?? null)) data.issues = patch.issues?.trim() || null
  if (add.length > 0) data.photoCount = current.length + add.length
  if (Object.keys(data).length === 0) return doc

  data.syncRev = revOf(doc) + 1
  req.context.auditReason = reason
  try {
    await req.payload.update({
      collection: 'progress-reports',
      id,
      data: data as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: reporter edit inside the 24 h window (checked above; DB enforces the window too)
      req,
    })
    if (add.length > 0) {
      await claimPhotos(req, id, add)
      await writeAudit(req, [{ action: 'update', docType: 'progress_report', docId: String(id), docNo: doc.docNo ?? undefined, field: 'photos', oldValue: current, newValue: [...current, ...add], reason }])
    }
    if (stageChange !== undefined) {
      await setStageProgress(req, stageId, stageChange)
      await recalcProjectProgress(req, projectId)
    }
  } finally {
    delete req.context.auditReason
  }
  return (await loadRaw(req, id))!
}

export { loadRaw as loadReportRaw }
