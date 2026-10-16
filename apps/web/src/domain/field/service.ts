import type { PayloadRequest, Where } from 'payload'

import { relId, userId } from '@/access/roles'
import { SparepartLines, type SparepartLineIn } from '@/api/v1/schemas-field'
import { parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { requestMeta } from '@/lib/request-meta'
import { searchWhere } from '@/lib/text-search'

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
  photoIdsOf,
  photosOf,
  readingOnOrBefore,
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
import { notifyUnitWaitingPart } from './notify'
import { namesOf, num, projectRef, str, unitRef, userRef } from './refs'
import { hmDecreased, isDec2, round2, serviceTimeError, unitClientMismatch, type UnitStatus } from './rules'
import { resolveCreateServiceTypes, resolvePatchServiceTypes, serviceTypeIdsOf, serviceTypeRows, type ServiceTypeRow } from './service-types'

/**
 * FR1 Laporan servis unit (ADR 0020 §5) — the single write path of POST/PATCH /api/v1/service-reports,
 * POST …/{id}/corrections and the sync item `service_report.upsert`. Runs inside the caller's
 * transaction: number SV/YYMM/####, report row, photos, unit status / last HM and the "menunggu part"
 * notification commit or roll back together.
 *
 * DRMS owner 2026-10-17 (ADR 0020 amendment 2026-10-17): "Jenis servis" is a MULTI-selection of the PT's master
 * `service-types` (`serviceTypeIds`; rules + the legacy single code of APK 0.7.0: ./service-types.ts). The legacy
 * column `serviceType` is written = the code of the first selected type. Photos ≤ 25 (MAX_PHOTOS).
 */
const TYPE = 'service_report' as const
const LABEL = 'Laporan servis'

export type ServiceDoc = FieldDoc & {
  docNo?: string | null
  unit: unknown
  reportDate: string
  helpers?: string | null
  startTime?: string | null
  endTime?: string | null
  hourMeter?: number | null
  /** Ids of the selected `service-types` (selection order). */
  serviceTypes?: unknown
  /** Legacy single code = code of the first selected type. */
  serviceType?: string | null
  complaint?: string | null
  action: string
  unitStatusAfter: UnitStatus
  spareparts?: SparepartLineIn[] | null
  notes?: string | null
  receivedAt?: string | null
  deviceTime?: string | null
  timeTrust?: 'server' | 'estimated' | 'device_only' | null
  offline?: boolean | null
  source?: 'web' | 'apk' | null
  correctedAt?: string | null
  correctedBy?: unknown
}

export type ServiceInput = {
  projectId: number
  unitId: number
  reportDate?: string | null
  helpers?: string | null
  startTime?: string | null
  endTime?: string | null
  hourMeter?: number | null
  /** Selected master rows (1 … 20, unique, the report's PT, active on create). */
  serviceTypeIds?: number[] | null
  /** LEGACY single code (old clients, APK 0.7.0) — only when serviceTypeIds is absent. */
  serviceType?: string | null
  complaint?: string | null
  action: string
  unitStatusAfter: UnitStatus
  spareparts?: SparepartLineIn[] | null
  notes?: string | null
  photoIds?: number[]
  clientUuid?: string | null
}

export type ServicePatch = Partial<Omit<ServiceInput, 'projectId' | 'unitId' | 'reportDate' | 'photoIds' | 'clientUuid'>> & { addPhotoIds?: number[]; reason?: string }

const clean = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function checkContent(p: Partial<ServiceInput>, forCreate: boolean): void {
  const issues: Array<{ path: string; message: string }> = []
  if (forCreate || p.action !== undefined) {
    const a = (p.action ?? '').trim()
    if (a.length < 3 || a.length > 4000) issues.push({ path: 'action', message: 'Tindakan / pekerjaan wajib diisi (3–4000 karakter).' })
  }
  const t = serviceTimeError(p.startTime, p.endTime)
  if (t) issues.push(t)
  if (p.hourMeter !== undefined && p.hourMeter !== null && !isDec2(p.hourMeter)) issues.push({ path: 'hourMeter', message: 'HM ≥ 0 dengan maks. 2 desimal.' })
  if (p.spareparts !== undefined && p.spareparts !== null) {
    const r = SparepartLines.safeParse(p.spareparts)
    if (!r.success) issues.push(...r.error.issues.map((i) => ({ path: ['spareparts', ...i.path].join('.'), message: i.message })))
  }
  validation(issues)
}

async function hmCheck(req: PayloadRequest, unitId: number, company: number, date: string, hm: number, self?: number): Promise<void> {
  const last = await readingOnOrBefore(req, unitId, company, date, self ? { type: TYPE, id: self } : undefined)
  if (hmDecreased(hm, last)) {
    fail(409, 'HM_DECREASED', `HM ${hm} lebih kecil dari HM terakhir unit (${last}). Periksa angka HM; koreksi HM lama oleh PM/Direktur.`, 'hourMeter', { lastHourMeter: last })
  }
}

async function afterWrite(req: PayloadRequest, doc: ServiceDoc, statusChangedTo: UnitStatus | null): Promise<void> {
  const company = relId(doc.company)!
  const unitId = relId(doc.unit)!
  const { after } = await refreshUnit(req, unitId, company)
  if (statusChangedTo === 'menunggu_part' && after === 'menunggu_part') {
    const n = await namesOf(req, [doc])
    const p = projectRef(n, doc.project)
    await notifyUnitWaitingPart(req, {
      id: doc.id,
      docNo: doc.docNo ?? null,
      company,
      project: p.id,
      projectLabel: [p.code, p.name].filter(Boolean).join(' '),
      unit: unitRef(n, doc.unit).label ?? `#${unitId}`,
      reporter: userRef(n, doc.reporter)?.name ?? '',
      date: doc.reportDate,
    })
  }
}

/** POST /service-reports + sync create. Replay of a clientUuid (same reporter) → existing (created false). */
export async function createServiceReport(req: PayloadRequest, input: ServiceInput, timing: Timing = SERVER_TIMING()): Promise<{ doc: ServiceDoc; created: boolean }> {
  const uid = userId(req)
  if (uid === undefined) fail(401, 'FORBIDDEN', 'Unauthorized')
  const replay = await replayOf<ServiceDoc>(req, TYPE, input.clientUuid)
  if (replay) return { doc: replay, created: false }
  const project = await requireReportableProject(req, input.projectId, TYPE)
  const unit = await requireUnit(req, input.unitId, project.company)
  if (unitClientMismatch({ owner: unit.owner, client: unit.client }, project.client)) fail(400, 'VALIDATION', 'Unit milik pelanggan lain dari klien project ini.', 'unitId')
  checkContent(input, true)
  const types = await resolveCreateServiceTypes(req, project.company, input)
  const { today } = await companyDay(req, project.company, timing.time)
  const reportDate = input.reportDate ?? today
  checkReportDate(reportDate, today, 'reportDate')
  const photoIds = input.photoIds ?? []
  await checkPhotos(req, TYPE, photoIds, 0)
  if (input.hourMeter !== undefined && input.hourMeter !== null) await hmCheck(req, unit.id, project.company, reportDate, input.hourMeter)

  const { docNo } = await allocateDocNo(req, 'service_report', { companyId: project.company, date: parseBusinessDate(reportDate) })
  const flags = [...(timing.flags ?? [])]
  if (reportDate < today) flags.push('BACKDATED')
  const doc = await createDoc<ServiceDoc>(req, TYPE, {
    docNo,
    project: project.id,
    unit: unit.id,
    reportDate,
    reporter: uid!,
    helpers: clean(input.helpers),
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    hourMeter: input.hourMeter === undefined || input.hourMeter === null ? null : round2(input.hourMeter),
    serviceTypes: types.map((t) => t.id),
    serviceType: types[0]!.code,
    complaint: clean(input.complaint),
    action: input.action.trim(),
    unitStatusAfter: input.unitStatusAfter,
    spareparts: input.spareparts ?? [],
    notes: clean(input.notes),
    photoCount: photoIds.length,
    // DB trigger: received_at = clock_timestamp(), editable_until = received_at + 24 h
    receivedAt: new Date().toISOString(),
    editableUntil: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    deviceTime: timing.deviceTime ? new Date(timing.deviceTime).toISOString() : null,
    timeTrust: timing.timeTrust,
    offline: timing.offline,
    source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    flags: [...new Set(flags)],
    syncRev: 1,
    clientUuid: input.clientUuid ?? null,
  })
  await claimPhotos(req, TYPE, doc.id, photoIds, docNo)
  const fresh = (await loadRaw<ServiceDoc>(req, TYPE, doc.id))!
  await afterWrite(req, fresh, input.unitStatusAfter)
  return { doc: fresh, created: true }
}

async function applyPatch(req: PayloadRequest, doc: ServiceDoc, patch: ServicePatch, mode: 'edit' | 'correction', reason: string | undefined): Promise<ServiceDoc> {
  checkContent(patch, false)
  const merged = { startTime: patch.startTime !== undefined ? patch.startTime : doc.startTime, endTime: patch.endTime !== undefined ? patch.endTime : doc.endTime }
  const t = serviceTimeError(merged.startTime, merged.endTime)
  if (t) validation([t])
  const add = patch.addPhotoIds ?? []
  const current = await photoIdsOf(req, TYPE, doc.id)
  await checkPhotos(req, TYPE, add, current.length)
  const company = relId(doc.company)!
  const unitId = relId(doc.unit)!
  const types = await resolvePatchServiceTypes(req, company, serviceTypeIdsOf(doc.serviceTypes), patch)

  const data: Record<string, unknown> = {}
  const set = (k: keyof ServicePatch, v: unknown, cur: unknown) => {
    if (v !== undefined && JSON.stringify(v ?? null) !== JSON.stringify(cur ?? null)) data[k] = v
  }
  set('helpers', patch.helpers === undefined ? undefined : clean(patch.helpers), doc.helpers)
  set('startTime', patch.startTime, doc.startTime)
  set('endTime', patch.endTime, doc.endTime)
  set('hourMeter', patch.hourMeter === undefined ? undefined : patch.hourMeter === null ? null : round2(patch.hourMeter), num(doc.hourMeter))
  if (types) {
    data.serviceTypes = types.map((t) => t.id)
    if (types[0]!.code !== doc.serviceType) data.serviceType = types[0]!.code
  }
  set('complaint', patch.complaint === undefined ? undefined : clean(patch.complaint), doc.complaint)
  set('action', patch.action === undefined ? undefined : patch.action.trim(), doc.action)
  set('unitStatusAfter', patch.unitStatusAfter, doc.unitStatusAfter)
  set('spareparts', patch.spareparts, doc.spareparts ?? [])
  set('notes', patch.notes === undefined ? undefined : clean(patch.notes), doc.notes)
  if (add.length > 0) data.photoCount = current.length + add.length
  if (Object.keys(data).length === 0 && add.length === 0) return doc
  if (mode === 'edit' && typeof data.hourMeter === 'number') await hmCheck(req, unitId, company, doc.reportDate, data.hourMeter, doc.id)

  data.syncRev = revOf(doc) + 1
  const auditReason = mode === 'correction' ? `Koreksi: ${reason}` : reason
  if (mode === 'correction') {
    data.correctedAt = new Date().toISOString()
    data.correctedBy = userId(req)
    data.flags = [...new Set([...flagsOf(doc), 'CORRECTED'])]
    await withOverride(req, 'correction', () => writeDoc(req, TYPE, doc.id, data, auditReason))
  } else {
    await writeDoc(req, TYPE, doc.id, data, auditReason)
  }
  if (add.length > 0) await claimPhotos(req, TYPE, doc.id, add, doc.docNo ?? undefined)
  const fresh = (await loadRaw<ServiceDoc>(req, TYPE, doc.id))!
  await afterWrite(req, fresh, data.unitStatusAfter !== undefined ? (data.unitStatusAfter as UnitStatus) : null)
  return fresh
}

/** PATCH /service-reports/{id}: the reporter, within 24 h (reason optional, audited). */
export async function editServiceReport(req: PayloadRequest, id: number, patch: ServicePatch): Promise<ServiceDoc> {
  await loadVisible(req, TYPE, id)
  await lockDoc(req, TYPE, id)
  const doc = (await loadRaw<ServiceDoc>(req, TYPE, id))!
  requireReporterEdit(req, doc, LABEL)
  return applyPatch(req, doc, patch, 'edit', patch.reason?.trim() || undefined)
}

/** POST /service-reports/{id}/corrections: PM of the project team or Direktur, any time, reason required. */
export async function correctServiceReport(req: PayloadRequest, id: number, patch: ServicePatch): Promise<ServiceDoc> {
  await loadVisible(req, TYPE, id)
  await lockDoc(req, TYPE, id)
  const doc = (await loadRaw<ServiceDoc>(req, TYPE, id))!
  const reason = await requireCorrector(req, TYPE, doc, patch.reason)
  return applyPatch(req, doc, patch, 'correction', reason)
}

// ---------------------------------------------------------------- read side

const typeRef = (t: ServiceTypeRow) => ({ id: t.id, code: t.code, name: t.name, active: t.active })

export async function serviceDtos(req: PayloadRequest, docs: readonly ServiceDoc[]) {
  const n = await namesOf(req, docs)
  const ph = await photosOf(req, TYPE, docs.map((d) => d.id))
  const types = await serviceTypeRows(req, docs.flatMap((d) => serviceTypeIdsOf(d.serviceTypes)))
  return docs.map((d) => {
    const selected = serviceTypeIdsOf(d.serviceTypes).flatMap((id) => {
      const t = types.get(id)
      return t ? [typeRef(t)] : []
    })
    return {
      id: d.id,
      uuid: (d.uuid as string | null) ?? null,
      companyId: relId(d.company) ?? null,
      docNo: d.docNo ?? null,
      project: projectRef(n, d.project),
      unit: unitRef(n, d.unit),
      reportDate: d.reportDate,
      reporter: userRef(n, d.reporter)!,
      helpers: str(d.helpers),
      startTime: str(d.startTime),
      endTime: str(d.endTime),
      hourMeter: num(d.hourMeter),
      /** DRMS owner 2026-10-17: the selected types (selection order). */
      serviceTypes: selected,
      /** Legacy: code of the first selected type. */
      serviceType: selected[0]?.code ?? str(d.serviceType),
      complaint: str(d.complaint),
      action: d.action,
      unitStatusAfter: d.unitStatusAfter,
      spareparts: Array.isArray(d.spareparts) ? d.spareparts : [],
      notes: str(d.notes),
      photos: (ph.get(d.id) ?? []).map(photoDto),
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

export type ServiceDto = Awaited<ReturnType<typeof serviceDtos>>[number]

export async function serviceDto(req: PayloadRequest, d: ServiceDoc): Promise<ServiceDto> {
  return (await serviceDtos(req, [d]))[0]!
}

export type ServiceListFilter = { projectId?: number; unitId?: number; status?: UnitStatus; reporterId?: number; serviceTypeId?: number; from?: string; to?: string; mine?: boolean; limit: number; after?: number; companyIds?: readonly number[]; q?: string }

/** Newest first in the caller's read scope (collection access), cursor on id. */
export async function listServiceReports(req: PayloadRequest, f: ServiceListFilter): Promise<{ items: ServiceDto[]; nextCursor: number | null }> {
  const and: Where[] = []
  if (f.projectId !== undefined) and.push({ project: { equals: f.projectId } })
  if (f.unitId !== undefined) and.push({ unit: { equals: f.unitId } })
  if (f.status) and.push({ unitStatusAfter: { equals: f.status } })
  if (f.reporterId !== undefined) and.push({ reporter: { equals: f.reporterId } })
  if (f.serviceTypeId !== undefined) and.push({ serviceTypes: { in: [f.serviceTypeId] } }) // web filter "Jenis servis" (DRMS owner 2026-10-17)
  if (f.from) and.push({ reportDate: { greater_than_equal: f.from } })
  if (f.to) and.push({ reportDate: { less_than_equal: f.to } })
  if (f.mine) and.push({ reporter: { equals: userId(req) ?? -1 } })
  if (f.after !== undefined) and.push({ id: { less_than: f.after } })
  if (f.companyIds?.length) and.push({ company: { in: [...f.companyIds] } })
  const text = searchWhere(['docNo', 'complaint', 'action', 'notes'], f.q) // DRMS 10/10 D8
  if (text) and.push(text)
  const docs = await scopedFind<ServiceDoc>(req, 'service-reports', and, f.limit + 1, '-id')
  const page = docs.slice(0, f.limit)
  return { items: await serviceDtos(req, page), nextCursor: docs.length > f.limit ? page[page.length - 1]!.id : null }
}

/** Collection find with the caller's access; a role without read access gets an empty list (403 → []). */
export async function scopedFind<T>(req: PayloadRequest, collection: 'service-reports' | 'unit-timesheets' | 'aftersales-activities' | 'daily-reports', and: Where[], limit: number, sort: string): Promise<T[]> {
  try {
    const res = await req.payload.find({ collection, where: and.length ? { and } : undefined, sort, limit, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req })
    return res.docs as unknown as T[]
  } catch (err) {
    if ((err as { status?: number }).status === 403) return []
    throw err
  }
}

