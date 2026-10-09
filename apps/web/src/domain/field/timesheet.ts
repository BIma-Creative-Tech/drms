import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest, Where } from 'payload'

import { relId, userId } from '@/access/roles'
import { requestMeta } from '@/lib/request-meta'
import { getRequestTx } from '@/lib/tx'

import {
  checkPhotos,
  checkReportDate,
  claimPhotos,
  companyDay,
  createDoc,
  fail,
  flagsOf,
  isEditable,
  loadRaw,
  loadVisible,
  lockDoc,
  photoDto,
  photosOf,
  previousTimesheetEnd,
  refreshUnit,
  replayOf,
  requireCorrector,
  requireReportableProject,
  requireReporterEdit,
  requireUnit,
  revOf,
  SERVER_TIMING,
  validation,
  withOverride,
  writeDoc,
  type FieldDoc,
  type Timing,
} from './common'
import { namesOf, num, projectRef, str, unitRef, userRef } from './refs'
import { BREAKDOWN_SUGGEST_SERVICE_HOURS, hmGap, round2, timesheetErrors } from './rules'
import { scopedFind } from './service'

/**
 * FR1 Timesheet harian unit (ADR 0020 §5) — single write path of POST/PATCH /api/v1/unit-timesheets,
 * POST …/{id}/corrections and the sync item `unit_timesheet.upsert`. One timesheet per unit and date
 * (409 DUPLICATE_DATE; unique index is the final guard), the unit must be in an ACTIVE contract unit
 * of the project on that date (409 NOT_IN_CONTRACT; DB trigger), HM_GAP flag when HM start ≠ the
 * previous timesheet's HM end, unit last HM recalculated, exactly one HM photo.
 */
const TYPE = 'unit_timesheet' as const
const LABEL = 'Timesheet'

export type TimesheetDoc = FieldDoc & {
  unit: unknown
  contractUnit: unknown
  reportDate: string
  hmStart: number
  hmEnd: number
  workHours: number
  standbyHours?: number | null
  breakdownHours?: number | null
  breakdownReason?: string | null
  fuelLiters?: number | null
  operatorName?: string | null
  location?: string | null
  notes?: string | null
  receivedAt?: string | null
  deviceTime?: string | null
  timeTrust?: 'server' | 'estimated' | 'device_only' | null
  offline?: boolean | null
  source?: 'web' | 'apk' | null
  correctedAt?: string | null
  correctedBy?: unknown
}

export type TimesheetInput = {
  projectId: number
  unitId: number
  reportDate: string
  hmStart: number
  hmEnd: number
  workHours: number
  standbyHours?: number | null
  breakdownHours?: number | null
  breakdownReason?: string | null
  fuelLiters?: number | null
  operatorName?: string | null
  location?: string | null
  notes?: string | null
  hmPhotoId: number
  clientUuid?: string | null
}

export type TimesheetPatch = Partial<Omit<TimesheetInput, 'projectId' | 'unitId' | 'reportDate' | 'hmPhotoId' | 'clientUuid'>> & { reason?: string }

const clean = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Active contract unit of `projectId` covering `unitId` on `date` (company-bound query). */
export async function activeContractOn(req: PayloadRequest, company: number, projectId: number, unitId: number, date: string): Promise<number | null> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT cu.id FROM contract_units cu
     WHERE cu.company_id = ${company} AND cu.project_id = ${projectId} AND cu.unit_id = ${unitId} AND coalesce(cu.active, true)
       AND cu.start_date <= ${date} AND (cu.end_date IS NULL OR cu.end_date >= ${date})
     ORDER BY cu.id LIMIT 1`)) as unknown as { rows: Array<{ id: number }> }
  return r.rows[0] ? Number(r.rows[0].id) : null
}

async function existingOn(req: PayloadRequest, company: number, unitId: number, date: string): Promise<number | null> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT t.id FROM unit_timesheets t WHERE t.company_id = ${company} AND t.unit_id = ${unitId} AND t.report_date = ${date} LIMIT 1`)) as unknown as { rows: Array<{ id: number }> }
  return r.rows[0] ? Number(r.rows[0].id) : null
}

function flagsFor(base: string[], hmStart: number, prevEnd: number | null, breakdown: number): string[] {
  const out = base.filter((f) => f !== 'HM_GAP' && f !== 'BREAKDOWN_SUGGEST_SERVICE')
  if (hmGap(hmStart, prevEnd)) out.push('HM_GAP')
  if (breakdown >= BREAKDOWN_SUGGEST_SERVICE_HOURS) out.push('BREAKDOWN_SUGGEST_SERVICE')
  return [...new Set(out)]
}

/** POST /unit-timesheets + sync create. Replay of a clientUuid (same reporter) → existing (created false). */
export async function createTimesheet(req: PayloadRequest, input: TimesheetInput, timing: Timing = SERVER_TIMING()): Promise<{ doc: TimesheetDoc; created: boolean }> {
  const uid = userId(req)
  if (uid === undefined) fail(401, 'FORBIDDEN', 'Unauthorized')
  const replay = await replayOf<TimesheetDoc>(req, TYPE, input.clientUuid)
  if (replay) return { doc: replay, created: false }
  const project = await requireReportableProject(req, input.projectId, TYPE)
  const unit = await requireUnit(req, input.unitId, project.company)
  validation(timesheetErrors(input))
  const { today } = await companyDay(req, project.company, timing.time)
  checkReportDate(input.reportDate, today, 'reportDate')
  const contract = await activeContractOn(req, project.company, project.id, unit.id, input.reportDate)
  if (contract === null) fail(409, 'NOT_IN_CONTRACT', `Unit tidak ada di kontrak aktif project ini pada ${input.reportDate}.`, 'unitId')
  if ((await existingOn(req, project.company, unit.id, input.reportDate)) !== null) {
    fail(409, 'DUPLICATE_DATE', `Timesheet unit ini untuk ${input.reportDate} sudah ada (satu timesheet per unit per tanggal; koreksi lewat edit/koreksi).`, 'reportDate')
  }
  await checkPhotos(req, TYPE, [input.hmPhotoId], 0)
  const prevEnd = await previousTimesheetEnd(req, unit.id, project.company, input.reportDate)
  const base = [...(timing.flags ?? [])]
  if (input.reportDate < today) base.push('BACKDATED')
  const doc = await createDoc<TimesheetDoc>(req, TYPE, {
    project: project.id,
    unit: unit.id,
    contractUnit: contract,
    reportDate: input.reportDate,
    reporter: uid!,
    hmStart: round2(input.hmStart),
    hmEnd: round2(input.hmEnd),
    workHours: round2(input.workHours),
    standbyHours: round2(input.standbyHours ?? 0),
    breakdownHours: round2(input.breakdownHours ?? 0),
    breakdownReason: clean(input.breakdownReason),
    fuelLiters: input.fuelLiters === undefined || input.fuelLiters === null ? null : round2(input.fuelLiters),
    operatorName: clean(input.operatorName),
    location: clean(input.location),
    notes: clean(input.notes),
    photoCount: 1,
    receivedAt: new Date().toISOString(),
    editableUntil: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    deviceTime: timing.deviceTime ? new Date(timing.deviceTime).toISOString() : null,
    timeTrust: timing.timeTrust,
    offline: timing.offline,
    source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    flags: flagsFor(base, input.hmStart, prevEnd, input.breakdownHours ?? 0),
    syncRev: 1,
    clientUuid: input.clientUuid ?? null,
  })
  await claimPhotos(req, TYPE, doc.id, [input.hmPhotoId])
  await refreshUnit(req, unit.id, project.company)
  return { doc: (await loadRaw<TimesheetDoc>(req, TYPE, doc.id))!, created: true }
}

async function applyPatch(req: PayloadRequest, doc: TimesheetDoc, patch: TimesheetPatch, mode: 'edit' | 'correction', reason: string | undefined): Promise<TimesheetDoc> {
  const merged = {
    hmStart: patch.hmStart ?? Number(doc.hmStart),
    hmEnd: patch.hmEnd ?? Number(doc.hmEnd),
    workHours: patch.workHours ?? Number(doc.workHours),
    standbyHours: patch.standbyHours ?? num(doc.standbyHours),
    breakdownHours: patch.breakdownHours ?? num(doc.breakdownHours),
    breakdownReason: patch.breakdownReason !== undefined ? patch.breakdownReason : (doc.breakdownReason ?? null),
    fuelLiters: patch.fuelLiters !== undefined ? patch.fuelLiters : num(doc.fuelLiters),
  }
  validation(timesheetErrors(merged))
  const data: Record<string, unknown> = {}
  const set = (k: string, v: unknown, cur: unknown) => {
    if (v !== undefined && JSON.stringify(v ?? null) !== JSON.stringify(cur ?? null)) data[k] = v
  }
  const r2 = (v: number | null | undefined) => (v === undefined ? undefined : v === null ? null : round2(v))
  set('hmStart', r2(patch.hmStart), num(doc.hmStart))
  set('hmEnd', r2(patch.hmEnd), num(doc.hmEnd))
  set('workHours', r2(patch.workHours), num(doc.workHours))
  set('standbyHours', r2(patch.standbyHours), num(doc.standbyHours))
  set('breakdownHours', r2(patch.breakdownHours), num(doc.breakdownHours))
  set('breakdownReason', patch.breakdownReason === undefined ? undefined : clean(patch.breakdownReason), doc.breakdownReason)
  set('fuelLiters', r2(patch.fuelLiters), num(doc.fuelLiters))
  set('operatorName', patch.operatorName === undefined ? undefined : clean(patch.operatorName), doc.operatorName)
  set('location', patch.location === undefined ? undefined : clean(patch.location), doc.location)
  set('notes', patch.notes === undefined ? undefined : clean(patch.notes), doc.notes)
  if (Object.keys(data).length === 0) return doc
  const company = relId(doc.company)!
  const unitId = relId(doc.unit)!
  const prevEnd = await previousTimesheetEnd(req, unitId, company, doc.reportDate)
  const flags = flagsFor(flagsOf(doc), merged.hmStart, prevEnd, merged.breakdownHours ?? 0)
  data.flags = mode === 'correction' ? [...new Set([...flags, 'CORRECTED'])] : flags
  data.syncRev = revOf(doc) + 1
  if (mode === 'correction') {
    data.correctedAt = new Date().toISOString()
    data.correctedBy = userId(req)
    await withOverride(req, 'correction', () => writeDoc(req, TYPE, doc.id, data, `Koreksi: ${reason}`))
  } else {
    await writeDoc(req, TYPE, doc.id, data, reason)
  }
  await refreshUnit(req, unitId, company)
  return (await loadRaw<TimesheetDoc>(req, TYPE, doc.id))!
}

/** PATCH /unit-timesheets/{id}: the reporter, within 24 h. */
export async function editTimesheet(req: PayloadRequest, id: number, patch: TimesheetPatch): Promise<TimesheetDoc> {
  await loadVisible(req, TYPE, id)
  await lockDoc(req, TYPE, id)
  const doc = (await loadRaw<TimesheetDoc>(req, TYPE, id))!
  requireReporterEdit(req, doc, LABEL)
  return applyPatch(req, doc, patch, 'edit', patch.reason?.trim() || undefined)
}

/** POST /unit-timesheets/{id}/corrections: PM team / Direktur, any time, reason required. */
export async function correctTimesheet(req: PayloadRequest, id: number, patch: TimesheetPatch): Promise<TimesheetDoc> {
  await loadVisible(req, TYPE, id)
  await lockDoc(req, TYPE, id)
  const doc = (await loadRaw<TimesheetDoc>(req, TYPE, id))!
  const reason = await requireCorrector(req, TYPE, doc, patch.reason)
  return applyPatch(req, doc, patch, 'correction', reason)
}

// ---------------------------------------------------------------- read side

export async function timesheetDtos(req: PayloadRequest, docs: readonly TimesheetDoc[]) {
  const n = await namesOf(req, docs)
  const ph = await photosOf(req, TYPE, docs.map((d) => d.id))
  return docs.map((d) => {
    const hmStart = Number(d.hmStart)
    const hmEnd = Number(d.hmEnd)
    const breakdown = num(d.breakdownHours) ?? 0
    const photo = ph.get(d.id)?.[0]
    return {
      id: d.id,
      uuid: (d.uuid as string | null) ?? null,
      companyId: relId(d.company) ?? null,
      project: projectRef(n, d.project),
      unit: unitRef(n, d.unit),
      contractUnitId: relId(d.contractUnit) ?? null,
      reportDate: d.reportDate,
      reporter: userRef(n, d.reporter)!,
      hmStart,
      hmEnd,
      hmUsed: round2(hmEnd - hmStart),
      workHours: Number(d.workHours),
      standbyHours: num(d.standbyHours) ?? 0,
      breakdownHours: breakdown,
      breakdownReason: str(d.breakdownReason),
      fuelLiters: num(d.fuelLiters),
      operatorName: str(d.operatorName),
      location: str(d.location),
      notes: str(d.notes),
      hmPhoto: photo ? photoDto(photo) : null,
      suggestServiceReport: breakdown >= BREAKDOWN_SUGGEST_SERVICE_HOURS,
      offline: d.offline === true,
      timeTrust: d.timeTrust ?? 'server',
      source: d.source ?? null,
      flags: flagsOf(d),
      receivedAt: d.receivedAt ?? null,
      editableUntil: d.editableUntil ?? null,
      editable: isEditable(req, d),
      correctedAt: d.correctedAt ?? null,
      correctedBy: userRef(n, d.correctedBy),
      rev: revOf(d),
      clientUuid: d.clientUuid ?? null,
      createdAt: d.createdAt ?? null,
    }
  })
}

export type TimesheetDto = Awaited<ReturnType<typeof timesheetDtos>>[number]

export async function timesheetDto(req: PayloadRequest, d: TimesheetDoc): Promise<TimesheetDto> {
  return (await timesheetDtos(req, [d]))[0]!
}

export type TimesheetListFilter = { projectId?: number; unitId?: number; reporterId?: number; from?: string; to?: string; mine?: boolean; limit: number; after?: number; companyIds?: readonly number[] }

export async function listTimesheets(req: PayloadRequest, f: TimesheetListFilter): Promise<{ items: TimesheetDto[]; nextCursor: number | null }> {
  const and: Where[] = []
  if (f.projectId !== undefined) and.push({ project: { equals: f.projectId } })
  if (f.unitId !== undefined) and.push({ unit: { equals: f.unitId } })
  if (f.reporterId !== undefined) and.push({ reporter: { equals: f.reporterId } })
  if (f.from) and.push({ reportDate: { greater_than_equal: f.from } })
  if (f.to) and.push({ reportDate: { less_than_equal: f.to } })
  if (f.mine) and.push({ reporter: { equals: userId(req) ?? -1 } })
  if (f.after !== undefined) and.push({ id: { less_than: f.after } })
  if (f.companyIds?.length) and.push({ company: { in: [...f.companyIds] } })
  const docs = await scopedFind<TimesheetDoc>(req, 'unit-timesheets', and, f.limit + 1, '-id')
  const page = docs.slice(0, f.limit)
  return { items: await timesheetDtos(req, page), nextCursor: docs.length > f.limit ? page[page.length - 1]!.id : null }
}
