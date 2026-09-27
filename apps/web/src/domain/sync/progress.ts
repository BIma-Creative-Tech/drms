import type { PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { SyncProgressReportPayload, type SyncItemIn, type SyncProgressReportCopyOut } from '@/api/v1/schemas-sync'
import { createReport, editReport, findByClientUuid, loadReportRaw, loadVisibleReport, reportPhotoIds, reportRev, type ReportDoc } from '@/domain/progress/reports'

import { attendanceTimeOf } from './attendance'
import type { TimeVerdict } from './clock'

/**
 * Sync item `progress_report.draft_upsert` (E4, ADR 0010 sync contract; same idempotency and
 * conflict rules as expense drafts): the item's client_uuid is stored in sync_receipts by the
 * service (replay → duplicate); a report is identified by `report_id` or `report_client_uuid`
 * (default: the creating item's client_uuid). A new report goes through the SAME domain service as
 * POST /api/v1/progress-reports; an edit needs base_rev = server rev (else conflict + server_report,
 * server wins), must be the reporter's own and inside the 24 h window (else NOT_EDITABLE).
 */

type SyncError = { code: string; field?: string; message: string }

/** Rejection that carries the server version of the report (rolled back, then stored). */
export class ProgressSyncReject extends Error {
  constructor(
    readonly errors: SyncError[],
    readonly id: number | null = null,
    readonly copy: SyncProgressReportCopyOut | null = null,
  ) {
    super(errors[0]?.message ?? 'rejected')
  }
}

export type ProgressOutcome = {
  status: 'applied' | 'conflict'
  id: number
  rev: number
  copy: SyncProgressReportCopyOut
  flags: string[]
  errors: SyncError[]
}

const reject = (code: string, message: string, field?: string, id: number | null = null, copy: SyncProgressReportCopyOut | null = null): never => {
  throw new ProgressSyncReject([{ code, message, ...(field ? { field } : {}) }], id, copy)
}

export async function reportCopy(req: PayloadRequest, id: number): Promise<SyncProgressReportCopyOut> {
  const d = (await loadReportRaw(req, id))!
  return {
    id: d.id,
    client_uuid: d.clientUuid ?? null,
    rev: reportRev(d),
    doc_no: d.docNo ?? null,
    project_id: relId(d.project)!,
    stage_id: relId(d.stage)!,
    report_date: d.reportDate,
    pct_before: Number(d.pctBefore),
    pct_after: Number(d.pctAfter),
    project_pct_after: d.projectPctAfter === null || d.projectPctAfter === undefined ? null : Number(d.projectPctAfter),
    work: d.work,
    issues: d.issues ?? null,
    photo_media_ids: await reportPhotoIds(req, d.id),
    offline: d.offline === true,
    editable_until: d.editableUntil ?? null,
    updated_at: d.updatedAt ?? null,
  }
}

function parse(payload: unknown) {
  const r = SyncProgressReportPayload.safeParse(payload)
  if (!r.success) throw new ProgressSyncReject(r.error.issues.map((i) => ({ code: 'VALIDATION', field: ['payload', ...i.path].join('.'), message: i.message })))
  return r.data
}

export async function applyProgressReport(c: { req: PayloadRequest; uid: number; item: SyncItemIn }, verdict: TimeVerdict, receivedAt: Date): Promise<ProgressOutcome> {
  const { req, uid, item } = c
  const p = parse(item.payload)
  let existing: ReportDoc | null = null
  if (p.report_id !== undefined) {
    existing = await loadReportRaw(req, p.report_id)
    if (!existing) reject('NOT_FOUND', 'Laporan tidak ditemukan.', 'payload.report_id')
  } else {
    existing = await findByClientUuid(req, p.report_client_uuid ?? item.client_uuid)
  }

  if (existing) {
    if (relId(existing.reporter) !== uid) {
      const visible = await loadVisibleReport(req, existing.id).then(
        () => true,
        () => false,
      )
      if (!visible) reject('NOT_FOUND', 'Laporan tidak ditemukan.', p.report_id !== undefined ? 'payload.report_id' : 'payload.report_client_uuid')
      reject('NOT_EDITABLE', 'Laporan hanya dapat diedit oleh pelapornya.')
    }
    const rev = reportRev(existing)
    if (item.base_rev === null || item.base_rev === undefined || item.base_rev < rev) {
      return {
        status: 'conflict',
        id: existing.id,
        rev,
        copy: await reportCopy(req, existing.id),
        flags: [],
        errors: [{ code: 'STALE_REV', field: 'base_rev', message: 'Laporan sudah ada/diubah di server; versi server yang berlaku.' }],
      }
    }
    if (item.base_rev > rev) reject('VALIDATION', `base_rev ${item.base_rev} lebih baru dari revisi server ${rev}.`, 'base_rev')
    if (!existing.editableUntil || new Date(existing.editableUntil).getTime() <= receivedAt.getTime()) {
      reject('NOT_EDITABLE', 'Laporan hanya dapat diedit 24 jam setelah dibuat.', undefined, existing.id, await reportCopy(req, existing.id))
    }
    if (p.project_id !== undefined && p.project_id !== relId(existing.project)) reject('VALIDATION', 'Project laporan tidak dapat diganti.', 'payload.project_id')
    if (p.stage_id !== undefined && p.stage_id !== relId(existing.stage)) reject('VALIDATION', 'Tahapan laporan tidak dapat diganti.', 'payload.stage_id')
    if (!p.reason) reject('VALIDATION', 'Alasan edit wajib diisi.', 'payload.reason')
    const current = new Set(await reportPhotoIds(req, existing.id))
    await editReport(req, existing.id, {
      pctAfter: p.pct_after,
      work: p.work,
      issues: p.issues,
      addPhotoIds: (p.photo_media_ids ?? []).filter((m) => !current.has(m)),
      reason: p.reason!,
    })
    const copy = await reportCopy(req, existing.id)
    return { status: 'applied', id: existing.id, rev: copy.rev, copy, flags: [], errors: [] }
  }

  if (p.report_id !== undefined) reject('NOT_FOUND', 'Laporan tidak ditemukan.', 'payload.report_id')
  if (p.project_id === undefined) reject('VALIDATION', 'project_id wajib untuk laporan baru.', 'payload.project_id')
  if (p.stage_id === undefined) reject('VALIDATION', 'stage_id wajib untuk laporan baru.', 'payload.stage_id')
  if (p.pct_after === undefined) reject('VALIDATION', 'pct_after wajib untuk laporan baru.', 'payload.pct_after')
  if (!p.work) reject('VALIDATION', 'work wajib untuk laporan baru.', 'payload.work')
  const { time, flags: timeFlags } = attendanceTimeOf(verdict, item.device_time, receivedAt)
  const { doc } = await createReport(
    req,
    {
      projectId: p.project_id!,
      stageId: p.stage_id!,
      pctAfter: p.pct_after!,
      work: p.work!,
      issues: p.issues ?? null,
      photoIds: p.photo_media_ids ?? [],
      clientUuid: p.report_client_uuid ?? item.client_uuid,
    },
    { time, timeTrust: verdict.timeTrust, offline: item.offline, deviceTime: item.device_time, flags: [...verdict.flags, ...timeFlags] },
  )
  const copy = await reportCopy(req, doc.id)
  return { status: 'applied', id: doc.id, rev: copy.rev, copy, flags: timeFlags, errors: [] }
}
