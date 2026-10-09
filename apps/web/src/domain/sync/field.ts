import type { PayloadRequest } from 'payload'
import type { z } from 'zod'

import { relId } from '@/access/roles'
import {
  SyncAftersalesActivityPayload,
  SyncServiceReportPayload,
  SyncUnitTimesheetPayload,
  type SyncAftersalesActivityCopyOut,
  type SyncItemIn,
  type SyncItemType,
  type SyncServiceReportCopyOut,
  type SyncUnitTimesheetCopyOut,
} from '@/api/v1/schemas-sync'
import { createActivity, editActivity, type ActivityDoc } from '@/domain/field/aftersales'
import { findByClientUuid, flagsOf, loadRaw, loadVisible, photoIdsOf, revOf, type FieldDoc, type Timing } from '@/domain/field/common'
import type { FieldReportType } from '@/domain/field/rules'
import { createServiceReport, editServiceReport, type ServiceDoc } from '@/domain/field/service'
import { createTimesheet, editTimesheet, type TimesheetDoc } from '@/domain/field/timesheet'

import { attendanceTimeOf } from './attendance'
import type { TimeVerdict } from './clock'

/**
 * FR1 sync items (ADR 0010 sync contract, same rules as `progress_report.draft_upsert`):
 * `service_report.upsert`, `unit_timesheet.upsert`, `aftersales_activity.upsert`. The item's
 * client_uuid is stored in sync_receipts by the service (replay → duplicate); a record is identified
 * by its server id or its own client uuid (default: the creating item's client_uuid). A new record
 * goes through the SAME domain service as POST /api/v1/…; an edit needs base_rev = server rev (else
 * conflict + server copy, server wins), must be the reporter's own and inside the 24 h window (else
 * NOT_EDITABLE). Identity fields (project, unit, customer, date, kind) never change by sync.
 */
type SyncError = { code: string; field?: string; message: string }
export type FieldCopy = SyncServiceReportCopyOut | SyncUnitTimesheetCopyOut | SyncAftersalesActivityCopyOut

export const FIELD_SYNC_TYPES: Readonly<Partial<Record<SyncItemType, FieldReportType>>> = {
  'service_report.upsert': 'service_report',
  'unit_timesheet.upsert': 'unit_timesheet',
  'aftersales_activity.upsert': 'aftersales_activity',
}

/** Result key of the server copy per field type. */
export const FIELD_COPY_KEY: Readonly<Record<FieldReportType, 'server_service_report' | 'server_unit_timesheet' | 'server_aftersales_activity'>> = {
  service_report: 'server_service_report',
  unit_timesheet: 'server_unit_timesheet',
  aftersales_activity: 'server_aftersales_activity',
}

export class FieldSyncReject extends Error {
  constructor(
    readonly errors: SyncError[],
    readonly id: number | null = null,
    readonly copy: FieldCopy | null = null,
  ) {
    super(errors[0]?.message ?? 'rejected')
  }
}

export type FieldOutcome = { status: 'applied' | 'conflict'; id: number; rev: number; copy: FieldCopy; flags: string[]; errors: SyncError[] }

const reject = (code: string, message: string, field?: string, id: number | null = null, copy: FieldCopy | null = null): never => {
  throw new FieldSyncReject([{ code, message, ...(field ? { field } : {}) }], id, copy)
}

function parse<S extends z.ZodType>(schema: S, payload: unknown): z.infer<S> {
  const r = schema.safeParse(payload)
  if (!r.success) throw new FieldSyncReject(r.error.issues.map((i) => ({ code: 'VALIDATION', field: ['payload', ...i.path].join('.'), message: i.message })))
  return r.data
}

const n = (v: unknown): number => Number(v ?? 0)

export async function fieldCopy(req: PayloadRequest, type: FieldReportType, id: number): Promise<FieldCopy> {
  const d = (await loadRaw<FieldDoc>(req, type, id))!
  const base = { id: d.id, client_uuid: d.clientUuid ?? null, rev: revOf(d), flags: flagsOf(d), offline: d.offline === true, editable_until: d.editableUntil ?? null, updated_at: d.updatedAt ?? null }
  const photos = await photoIdsOf(req, type, d.id)
  if (type === 'service_report') {
    const s = d as unknown as ServiceDoc
    return { ...base, doc_no: s.docNo ?? null, project_id: relId(s.project)!, unit_id: relId(s.unit)!, report_date: s.reportDate, hour_meter: s.hourMeter === null || s.hourMeter === undefined ? null : n(s.hourMeter), service_type: s.serviceType, action: s.action, unit_status_after: s.unitStatusAfter, photo_media_ids: photos }
  }
  if (type === 'unit_timesheet') {
    const t = d as unknown as TimesheetDoc
    return {
      ...base,
      project_id: relId(t.project)!,
      unit_id: relId(t.unit)!,
      report_date: t.reportDate,
      hm_start: n(t.hmStart),
      hm_end: n(t.hmEnd),
      work_hours: n(t.workHours),
      standby_hours: n(t.standbyHours),
      breakdown_hours: n(t.breakdownHours),
      hm_photo_media_id: photos[0] ?? null,
    }
  }
  const a = d as unknown as ActivityDoc
  return { ...base, doc_no: a.docNo ?? null, project_id: relId(a.project)!, client_id: relId(a.client)!, activity_date: a.activityDate, kind: a.kind, po_status: a.poStatus ?? null, relates_to: relId(a.relatesTo) ?? null, photo_media_ids: photos }
}

type Ctx = { req: PayloadRequest; uid: number; item: SyncItemIn }

/** Existing record of an item (server id or own client uuid), or null for a new one. */
async function resolve(c: Ctx, type: FieldReportType, id: number | undefined, ownUuid: string | undefined): Promise<FieldDoc | null> {
  if (id !== undefined) {
    const d = await loadRaw<FieldDoc>(c.req, type, id)
    if (!d) reject('NOT_FOUND', 'Data tidak ditemukan.', 'payload')
    return d
  }
  return findByClientUuid<FieldDoc>(c.req, type, ownUuid ?? c.item.client_uuid)
}

/** Shared edit gate: reporter, base_rev, window. Returns a conflict outcome or null (go on). */
async function editGate(c: Ctx, type: FieldReportType, existing: FieldDoc, receivedAt: Date): Promise<FieldOutcome | null> {
  if (relId(existing.reporter) !== c.uid) {
    const visible = await loadVisible(c.req, type, existing.id).then(
      () => true,
      () => false,
    )
    if (!visible) reject('NOT_FOUND', 'Data tidak ditemukan.', 'payload')
    reject('NOT_EDITABLE', 'Data hanya dapat diedit oleh pelapornya (koreksi: PM/Direktur di web).')
  }
  const rev = revOf(existing)
  if (c.item.base_rev === null || c.item.base_rev === undefined || c.item.base_rev < rev) {
    return { status: 'conflict', id: existing.id, rev, copy: await fieldCopy(c.req, type, existing.id), flags: [], errors: [{ code: 'STALE_REV', field: 'base_rev', message: 'Data sudah ada/diubah di server; versi server yang berlaku.' }] }
  }
  if (c.item.base_rev > rev) reject('VALIDATION', `base_rev ${c.item.base_rev} lebih baru dari revisi server ${rev}.`, 'base_rev')
  if (!existing.editableUntil || new Date(existing.editableUntil).getTime() <= receivedAt.getTime()) {
    reject('NOT_EDITABLE', 'Data hanya dapat diedit 24 jam setelah dibuat.', undefined, existing.id, await fieldCopy(c.req, type, existing.id))
  }
  return null
}

const same = (given: number | undefined, current: unknown, field: string) => {
  if (given !== undefined && given !== relId(current)) reject('VALIDATION', 'Data identitas (project/unit/pelanggan) tidak dapat diganti.', field)
}

function timingOf(c: Ctx, verdict: TimeVerdict, receivedAt: Date): { timing: Timing; timeFlags: string[] } {
  const { time, flags } = attendanceTimeOf(verdict, c.item.device_time, receivedAt)
  return { timing: { time, timeTrust: verdict.timeTrust, offline: c.item.offline, deviceTime: c.item.device_time, flags: [...verdict.flags, ...flags] }, timeFlags: flags }
}

const required = (v: unknown, field: string, label: string) => {
  if (v === undefined || v === null || v === '') reject('VALIDATION', `${label} wajib untuk data baru.`, `payload.${field}`)
}

async function done(c: Ctx, type: FieldReportType, id: number, flags: string[] = []): Promise<FieldOutcome> {
  const copy = await fieldCopy(c.req, type, id)
  return { status: 'applied', id, rev: copy.rev, copy, flags, errors: [] }
}

export async function applyFieldItem(c: Ctx, type: FieldReportType, verdict: TimeVerdict, receivedAt: Date): Promise<FieldOutcome> {
  const { req, item } = c
  if (type === 'service_report') {
    const p = parse(SyncServiceReportPayload, item.payload)
    const existing = await resolve(c, type, p.report_id, p.report_client_uuid)
    if (existing) {
      const gate = await editGate(c, type, existing, receivedAt)
      if (gate) return gate
      same(p.project_id, existing.project, 'payload.project_id')
      same(p.unit_id, existing.unit, 'payload.unit_id')
      const current = new Set(await photoIdsOf(req, type, existing.id))
      await editServiceReport(req, existing.id, {
        helpers: p.helpers,
        startTime: p.start_time,
        endTime: p.end_time,
        hourMeter: p.hour_meter,
        serviceType: p.service_type,
        complaint: p.complaint,
        action: p.action,
        unitStatusAfter: p.unit_status_after,
        spareparts: p.spareparts?.map((l) => ({ name: l.name, partNo: l.part_no ?? null, qty: l.qty, uom: l.uom ?? null, note: l.note ?? null })),
        notes: p.notes,
        addPhotoIds: (p.photo_media_ids ?? []).filter((m) => !current.has(m)),
        reason: p.reason,
      })
      return done(c, type, existing.id)
    }
    if (p.report_id !== undefined) reject('NOT_FOUND', 'Laporan tidak ditemukan.', 'payload.report_id')
    required(p.project_id, 'project_id', 'project_id')
    required(p.unit_id, 'unit_id', 'unit_id')
    required(p.service_type, 'service_type', 'service_type')
    required(p.action, 'action', 'action')
    required(p.unit_status_after, 'unit_status_after', 'unit_status_after')
    const { timing, timeFlags } = timingOf(c, verdict, receivedAt)
    const { doc } = await createServiceReport(
      req,
      {
        projectId: p.project_id!,
        unitId: p.unit_id!,
        reportDate: p.report_date ?? null,
        helpers: p.helpers,
        startTime: p.start_time,
        endTime: p.end_time,
        hourMeter: p.hour_meter,
        serviceType: p.service_type!,
        complaint: p.complaint,
        action: p.action!,
        unitStatusAfter: p.unit_status_after!,
        spareparts: (p.spareparts ?? []).map((l) => ({ name: l.name, partNo: l.part_no ?? null, qty: l.qty, uom: l.uom ?? null, note: l.note ?? null })),
        notes: p.notes,
        photoIds: p.photo_media_ids ?? [],
        clientUuid: p.report_client_uuid ?? item.client_uuid,
      },
      timing,
    )
    return done(c, type, doc.id, timeFlags)
  }

  if (type === 'unit_timesheet') {
    const p = parse(SyncUnitTimesheetPayload, item.payload)
    const existing = await resolve(c, type, p.timesheet_id, p.timesheet_client_uuid)
    if (existing) {
      const gate = await editGate(c, type, existing, receivedAt)
      if (gate) return gate
      same(p.project_id, existing.project, 'payload.project_id')
      same(p.unit_id, existing.unit, 'payload.unit_id')
      if (p.report_date !== undefined && p.report_date !== (existing as unknown as TimesheetDoc).reportDate) reject('VALIDATION', 'Tanggal timesheet tidak dapat diganti.', 'payload.report_date')
      await editTimesheet(req, existing.id, {
        hmStart: p.hm_start,
        hmEnd: p.hm_end,
        workHours: p.work_hours,
        standbyHours: p.standby_hours,
        breakdownHours: p.breakdown_hours,
        breakdownReason: p.breakdown_reason,
        fuelLiters: p.fuel_liters,
        operatorName: p.operator_name,
        location: p.location,
        notes: p.notes,
        reason: p.reason,
      })
      return done(c, type, existing.id)
    }
    if (p.timesheet_id !== undefined) reject('NOT_FOUND', 'Timesheet tidak ditemukan.', 'payload.timesheet_id')
    for (const k of ['project_id', 'unit_id', 'report_date', 'hm_start', 'hm_end', 'work_hours', 'hm_photo_media_id'] as const) required(p[k], k, k)
    const { timing, timeFlags } = timingOf(c, verdict, receivedAt)
    const { doc } = await createTimesheet(
      req,
      {
        projectId: p.project_id!,
        unitId: p.unit_id!,
        reportDate: p.report_date!,
        hmStart: p.hm_start!,
        hmEnd: p.hm_end!,
        workHours: p.work_hours!,
        standbyHours: p.standby_hours,
        breakdownHours: p.breakdown_hours,
        breakdownReason: p.breakdown_reason,
        fuelLiters: p.fuel_liters,
        operatorName: p.operator_name,
        location: p.location,
        notes: p.notes,
        hmPhotoId: p.hm_photo_media_id!,
        clientUuid: p.timesheet_client_uuid ?? item.client_uuid,
      },
      timing,
    )
    return done(c, type, doc.id, timeFlags)
  }

  const p = parse(SyncAftersalesActivityPayload, item.payload)
  const existing = await resolve(c, type, p.activity_id, p.activity_client_uuid)
  if (existing) {
    const gate = await editGate(c, type, existing, receivedAt)
    if (gate) return gate
    same(p.project_id, existing.project, 'payload.project_id')
    same(p.client_id, (existing as unknown as ActivityDoc).client, 'payload.client_id')
    if (p.kind !== undefined && p.kind !== (existing as unknown as ActivityDoc).kind) reject('VALIDATION', 'Jenis aktivitas tidak dapat diganti.', 'payload.kind')
    const current = new Set(await photoIdsOf(req, type, existing.id))
    await editActivity(req, existing.id, {
      docNo: p.doc_no,
      items: p.items?.map((i) => ({ name: i.name, partNo: i.part_no ?? null, qty: i.qty, uom: i.uom ?? null })),
      value: p.value,
      followUpDate: p.follow_up_date,
      receiver: p.receiver,
      notes: p.notes,
      addPhotoIds: (p.photo_media_ids ?? []).filter((m) => !current.has(m)),
      reason: p.reason,
    })
    return done(c, type, existing.id)
  }
  if (p.activity_id !== undefined) reject('NOT_FOUND', 'Aktivitas tidak ditemukan.', 'payload.activity_id')
  for (const k of ['project_id', 'client_id', 'kind'] as const) required(p[k], k, k)
  const { timing, timeFlags } = timingOf(c, verdict, receivedAt)
  const { doc } = await createActivity(
    req,
    {
      projectId: p.project_id!,
      clientId: p.client_id!,
      activityDate: p.activity_date ?? null,
      kind: p.kind!,
      docNo: p.doc_no,
      items: (p.items ?? []).map((i) => ({ name: i.name, partNo: i.part_no ?? null, qty: i.qty, uom: i.uom ?? null })),
      value: p.value,
      relatesTo: p.relates_to,
      poDelivered: p.po_delivered,
      followUpDate: p.follow_up_date,
      receiver: p.receiver,
      notes: p.notes,
      photoIds: p.photo_media_ids ?? [],
      clientUuid: p.activity_client_uuid ?? item.client_uuid,
    },
    timing,
  )
  return done(c, type, doc.id, timeFlags)
}

/** PT of a field item without project_id (edit by server id / own client uuid). */
export function fieldItemRef(type: FieldReportType, p: Record<string, unknown>): { id?: unknown; uuid?: unknown } {
  if (type === 'service_report') return { id: p.report_id, uuid: p.report_client_uuid }
  if (type === 'unit_timesheet') return { id: p.timesheet_id, uuid: p.timesheet_client_uuid }
  return { id: p.activity_id, uuid: p.activity_client_uuid }
}
