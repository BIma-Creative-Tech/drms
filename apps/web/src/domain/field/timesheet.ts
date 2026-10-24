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
  mayBackdateTimesheet,
  photoDto,
  photoIdsOf,
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
import { BREAKDOWN_SUGGEST_SERVICE_HOURS, hasHm, HM_PHOTO_REQUIRED, hmGap, round2, timesheetErrors } from './rules'
import { scopedFind } from './service'

/**
 * FR1 Timesheet harian unit (ADR 0020 §5) — single write path of POST/PATCH /api/v1/unit-timesheets,
 * POST …/{id}/corrections and the sync item `unit_timesheet.upsert`. One timesheet per unit and date
 * (409 DUPLICATE_DATE; unique index is the final guard), the unit must be in an ACTIVE contract unit
 * of the project on that date (409 NOT_IN_CONTRACT; DB trigger), HM_GAP flag when HM start ≠ the
 * previous timesheet's HM end, unit last HM recalculated, exactly one HM photo.
 * D2410 (user 2026-10-24, ADR 0020 amendment 2026-10-24): HM start/end and the HM photo are OPTIONAL (operators read
 * the HM about once a week) — both values or none, the photo required only with HM, HM_GAP against the previous
 * timesheet WITH HM; an edit may clear the HM (null) or add the photo when there is none yet. The PM of the project /
 * the Direktur may file any past date inside the contract unit's period (`mayBackdateTimesheet`).
 */
const TYPE = 'unit_timesheet' as const
const LABEL = 'Timesheet'

export type TimesheetDoc = FieldDoc & {
  unit: unknown
  contractUnit: unknown
  reportDate: string
  hmStart: number | null
  hmEnd: number | null
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
  /** D2410: optional, both or none (null = no HM reading on this day). */
  hmStart?: number | null
  hmEnd?: number | null
  workHours: number
  standbyHours?: number | null
  breakdownHours?: number | null
  breakdownReason?: string | null
  fuelLiters?: number | null
  operatorName?: string | null
  location?: string | null
  notes?: string | null
  /** D2410: required only with HM. */
  hmPhotoId?: number | null
  clientUuid?: string | null
}

/** hmStart/hmEnd: undefined = unchanged, null = cleared; hmPhotoId only adds the photo of a timesheet without one. */
export type TimesheetPatch = Partial<Omit<TimesheetInput, 'projectId' | 'unitId' | 'reportDate' | 'clientUuid'>> & { reason?: string }

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

function flagsFor(base: string[], hmStart: number | null, prevEnd: number | null, breakdown: number): string[] {
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
  const withHm = hasHm(input)
  const photoIds = typeof input.hmPhotoId === 'number' ? [input.hmPhotoId] : []
  if (withHm && photoIds.length === 0) validation([{ path: 'hmPhotoId', message: HM_PHOTO_REQUIRED }])
  const { today } = await companyDay(req, project.company, timing.time)
  checkReportDate(input.reportDate, today, 'reportDate', { unlimitedBackdate: mayBackdateTimesheet(req, project) })
  const contract = await activeContractOn(req, project.company, project.id, unit.id, input.reportDate)
  if (contract === null) fail(409, 'NOT_IN_CONTRACT', `Unit tidak ada di kontrak aktif project ini pada ${input.reportDate}.`, 'unitId')
  if ((await existingOn(req, project.company, unit.id, input.reportDate)) !== null) {
    fail(409, 'DUPLICATE_DATE', `Timesheet unit ini untuk ${input.reportDate} sudah ada (satu timesheet per unit per tanggal; koreksi lewat edit/koreksi).`, 'reportDate')
  }
  if (photoIds.length > 0) await checkPhotos(req, TYPE, photoIds, 0)
  const prevEnd = withHm ? await previousTimesheetEnd(req, unit.id, project.company, input.reportDate) : null
  const base = [...(timing.flags ?? [])]
  if (input.reportDate < today) base.push('BACKDATED')
  const doc = await createDoc<TimesheetDoc>(req, TYPE, {
    project: project.id,
    unit: unit.id,
    contractUnit: contract,
    reportDate: input.reportDate,
    reporter: uid!,
    hmStart: withHm ? round2(input.hmStart!) : null,
    hmEnd: withHm ? round2(input.hmEnd!) : null,
    workHours: round2(input.workHours),
    standbyHours: round2(input.standbyHours ?? 0),
    breakdownHours: round2(input.breakdownHours ?? 0),
    breakdownReason: clean(input.breakdownReason),
    fuelLiters: input.fuelLiters === undefined || input.fuelLiters === null ? null : round2(input.fuelLiters),
    operatorName: clean(input.operatorName),
    location: clean(input.location),
    notes: clean(input.notes),
    photoCount: photoIds.length,
    receivedAt: new Date().toISOString(),
    editableUntil: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    deviceTime: timing.deviceTime ? new Date(timing.deviceTime).toISOString() : null,
    timeTrust: timing.timeTrust,
    offline: timing.offline,
    source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    flags: flagsFor(base, withHm ? input.hmStart! : null, prevEnd, input.breakdownHours ?? 0),
    syncRev: 1,
    clientUuid: input.clientUuid ?? null,
  })
  await claimPhotos(req, TYPE, doc.id, photoIds)
  await refreshUnit(req, unit.id, project.company)
  return { doc: (await loadRaw<TimesheetDoc>(req, TYPE, doc.id))!, created: true }
}

async function applyPatch(req: PayloadRequest, doc: TimesheetDoc, patch: TimesheetPatch, mode: 'edit' | 'correction', reason: string | undefined): Promise<TimesheetDoc> {
  const merged = {
    hmStart: patch.hmStart !== undefined ? patch.hmStart : num(doc.hmStart),
    hmEnd: patch.hmEnd !== undefined ? patch.hmEnd : num(doc.hmEnd),
    workHours: patch.workHours ?? Number(doc.workHours),
    standbyHours: patch.standbyHours ?? num(doc.standbyHours),
    breakdownHours: patch.breakdownHours ?? num(doc.breakdownHours),
    breakdownReason: patch.breakdownReason !== undefined ? patch.breakdownReason : (doc.breakdownReason ?? null),
    fuelLiters: patch.fuelLiters !== undefined ? patch.fuelLiters : num(doc.fuelLiters),
  }
  validation(timesheetErrors(merged))
  // D2410: the HM photo is required with HM; a timesheet without one may get it on an edit (never replaced)
  const stored = await photoIdsOf(req, TYPE, doc.id)
  const addPhoto = typeof patch.hmPhotoId === 'number' && !stored.includes(patch.hmPhotoId) ? patch.hmPhotoId : null
  if (addPhoto !== null && stored.length > 0) fail(400, 'PHOTO_LIMIT', 'Foto meter HM sudah tersimpan dan tidak dapat diganti.', 'hmPhotoId')
  if (hasHm(merged) && stored.length === 0 && addPhoto === null) validation([{ path: 'hmPhotoId', message: HM_PHOTO_REQUIRED }])
  if (addPhoto !== null) await checkPhotos(req, TYPE, [addPhoto], 0)
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
  if (addPhoto !== null) data.photoCount = 1
  if (Object.keys(data).length === 0) return doc
  const company = relId(doc.company)!
  const unitId = relId(doc.unit)!
  const withHm = hasHm(merged)
  const prevEnd = withHm ? await previousTimesheetEnd(req, unitId, company, doc.reportDate) : null
  const flags = flagsFor(flagsOf(doc), withHm ? merged.hmStart! : null, prevEnd, merged.breakdownHours ?? 0)
  data.flags = mode === 'correction' ? [...new Set([...flags, 'CORRECTED'])] : flags
  data.syncRev = revOf(doc) + 1
  if (mode === 'correction') {
    data.correctedAt = new Date().toISOString()
    data.correctedBy = userId(req)
    await withOverride(req, 'correction', () => writeDoc(req, TYPE, doc.id, data, `Koreksi: ${reason}`))
  } else {
    await writeDoc(req, TYPE, doc.id, data, reason)
  }
  if (addPhoto !== null) await claimPhotos(req, TYPE, doc.id, [addPhoto])
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
    const hmStart = num(d.hmStart)
    const hmEnd = num(d.hmEnd)
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
      hmUsed: hmStart !== null && hmEnd !== null ? round2(hmEnd - hmStart) : null,
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
