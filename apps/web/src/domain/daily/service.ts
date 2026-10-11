import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest, Where } from 'payload'

import { relId, userId } from '@/access/roles'
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
  replayOf,
  requireCorrector,
  requireReportableProject,
  requireReporterEdit,
  revOf,
  SERVER_TIMING,
  validation,
  withOverride,
  writeDoc,
  type FieldDoc,
  type Timing,
} from '@/domain/field/common'
import { notifyDailyOverRap } from '@/domain/field/notify'
import { namesOf, num, projectRef, str, userRef } from '@/domain/field/refs'
import { scopedFind } from '@/domain/field/service'
import { parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { loadProjectFor, refreshRapProgress } from '@/domain/rap/service'
import { isQty0, itemPct, round2, type LineKind, type LineOrigin } from '@/domain/rap/rules'
import { requestMeta } from '@/lib/request-meta'
import { getRequestTx } from '@/lib/tx'

import { DAILY_FLAGS, MAX_LINES, MAX_RESOURCES, WEATHER, weekNo, weekRangeOf, type Weather } from './rules'

/**
 * P3 Laporan Harian (konstruksi; owner decisions 2026-10-09/10) — the single write path of
 * POST/PATCH /api/v1/daily-reports, POST …/{id}/corrections and the sync item `daily_report.upsert`.
 * Values per RAP item are a LEDGER: create appends `report` lines, an edit by the reporter within 24 h
 * appends the difference (`edit`), a PM/Direktur correction appends the difference with a reason
 * (`correction`). The DB moves the RAP realisation from the ledger; every write recomputes the
 * RAP-driven stages and the project % in the same transaction.
 */
const TYPE = 'daily_report' as const
const LABEL = 'Laporan harian'

export type DailyWork = { rapItemId: number; qty: number }
export type DailyMaterial = { rapItemId: number; received?: number; used?: number }
export type DailyResource = { resourceTypeId: number; count: number; hours?: number | null }
export type DailyWeather = { morning?: Weather | null; noon?: Weather | null; afternoon?: Weather | null }

export type DailyInput = {
  projectId: number
  reportDate?: string | null
  weather?: DailyWeather
  rainHours?: number | null
  stopHours?: number | null
  work?: DailyWork[]
  materials?: DailyMaterial[]
  manpower?: DailyResource[]
  equipment?: DailyResource[]
  issues?: string | null
  notes?: string | null
  photoIds?: number[]
  clientUuid?: string | null
}
export type DailyPatch = Partial<Omit<DailyInput, 'projectId' | 'reportDate' | 'photoIds' | 'clientUuid'>> & { addPhotoIds?: number[]; reason?: string }

export type DailyDoc = FieldDoc & {
  docNo?: string | null
  reportDate: string
  weatherMorning?: Weather | null
  weatherNoon?: Weather | null
  weatherAfternoon?: Weather | null
  rainHours?: number | null
  stopHours?: number | null
  manpower?: unknown
  equipment?: unknown
  workerCount?: number | null
  issues?: string | null
  notes?: string | null
  receivedAt?: string | null
  editableUntil?: string | null
  deviceTime?: string | null
  timeTrust?: 'server' | 'estimated' | 'device_only' | null
  offline?: boolean | null
  source?: 'web' | 'apk' | null
  correctedAt?: string | null
  correctedBy?: unknown
}

const clean = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const isHours = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 24 && Math.abs(round2(v) - v) < 1e-9

type ItemInfo = { id: number; code: string; description: string; kind: 'pekerjaan' | 'material'; volume: number; realised: number; active: boolean; uom: string }

async function rapItemsOf(req: PayloadRequest, projectId: number, company: number): Promise<Map<number, ItemInfo>> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT i.id, i.code, i.description, i.kind::text AS kind, i.volume::text AS volume, i.realised_qty::text AS realised, i.active, u.code AS uom
      FROM rap_items i JOIN uoms u ON u.id = i.uom_id
     WHERE i.project_id = ${projectId} AND i.company_id = ${company}`)) as unknown as {
    rows: Array<{ id: number; code: string; description: string; kind: 'pekerjaan' | 'material'; volume: string; realised: string | null; active: boolean | null; uom: string }>
  }
  return new Map(r.rows.map((x) => [x.id, { id: x.id, code: x.code, description: x.description, kind: x.kind, volume: Number(x.volume), realised: Number(x.realised ?? 0), active: x.active !== false, uom: x.uom }]))
}

async function resourceKinds(req: PayloadRequest, company: number): Promise<Map<number, { kind: string; active: boolean; name: string }>> {
  const res = await req.payload.find({ collection: 'resource-types', where: { company: { equals: company } }, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: masters of the report's PT */, req })
  return new Map(res.docs.map((d) => [d.id as number, { kind: String((d as { kind?: unknown }).kind), active: (d as { active?: boolean | null }).active !== false, name: String((d as { name?: unknown }).name ?? '') }]))
}

/** Report values per item and kind = Σ of its ledger lines. */
async function currentValues(req: PayloadRequest, reportId: number, company: number): Promise<Map<string, number>> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT rap_item_id, kind::text AS kind, sum(qty)::text AS qty FROM daily_report_lines WHERE report_id = ${reportId} AND company_id = ${company} GROUP BY rap_item_id, kind`)) as unknown as {
    rows: Array<{ rap_item_id: number; kind: LineKind; qty: string }>
  }
  return new Map(r.rows.map((x) => [`${x.rap_item_id}:${x.kind}`, Number(x.qty)]))
}

/** Desired values of the report from the input (absent sections: unchanged → null). */
function desiredValues(work: DailyWork[] | undefined, materials: DailyMaterial[] | undefined): Map<string, number> | null {
  if (work === undefined && materials === undefined) return null
  const out = new Map<string, number>()
  for (const w of work ?? []) out.set(`${w.rapItemId}:work`, round2(w.qty))
  for (const m of materials ?? []) {
    if (m.received !== undefined) out.set(`${m.rapItemId}:material_in`, round2(m.received))
    if (m.used !== undefined) out.set(`${m.rapItemId}:material_used`, round2(m.used))
  }
  return out
}

function checkContent(p: Partial<DailyInput>, items: Map<number, ItemInfo>, resources: Map<number, { kind: string; active: boolean }>): void {
  const issues: Array<{ path: string; message: string }> = []
  for (const k of ['morning', 'noon', 'afternoon'] as const) {
    const v = p.weather?.[k]
    if (v !== undefined && v !== null && !(WEATHER as readonly string[]).includes(v)) issues.push({ path: `weather.${k}`, message: 'Cuaca: cerah / berawan / hujan.' })
  }
  if (p.rainHours !== undefined && p.rainHours !== null && !isHours(p.rainHours)) issues.push({ path: 'rainHours', message: 'Jam hujan 0–24.' })
  if (p.stopHours !== undefined && p.stopHours !== null && !isHours(p.stopHours)) issues.push({ path: 'stopHours', message: 'Jam berhenti kerja 0–24.' })
  if ((p.work?.length ?? 0) + (p.materials?.length ?? 0) > MAX_LINES) issues.push({ path: 'work', message: `Maks. ${MAX_LINES} baris pekerjaan + material.` })
  const seenW = new Set<number>()
  p.work?.forEach((w, i) => {
    const it = items.get(w.rapItemId)
    if (!it) issues.push({ path: `work.${i}.rapItemId`, message: 'Item RAP bukan milik project ini.' })
    else if (it.kind !== 'pekerjaan') issues.push({ path: `work.${i}.rapItemId`, message: `Item ${it.code} adalah material, bukan pekerjaan.` })
    else if (!it.active) issues.push({ path: `work.${i}.rapItemId`, message: `Item ${it.code} sudah dinonaktifkan.` })
    if (seenW.has(w.rapItemId)) issues.push({ path: `work.${i}.rapItemId`, message: 'Item pekerjaan ganda.' })
    seenW.add(w.rapItemId)
    if (!isQty0(w.qty)) issues.push({ path: `work.${i}.qty`, message: 'Volume ≥ 0, maks. 2 desimal.' })
  })
  const seenM = new Set<number>()
  p.materials?.forEach((m, i) => {
    const it = items.get(m.rapItemId)
    if (!it) issues.push({ path: `materials.${i}.rapItemId`, message: 'Item RAP bukan milik project ini.' })
    else if (it.kind !== 'material') issues.push({ path: `materials.${i}.rapItemId`, message: `Item ${it.code} adalah pekerjaan, bukan material.` })
    else if (!it.active) issues.push({ path: `materials.${i}.rapItemId`, message: `Item ${it.code} sudah dinonaktifkan.` })
    if (seenM.has(m.rapItemId)) issues.push({ path: `materials.${i}.rapItemId`, message: 'Item material ganda.' })
    seenM.add(m.rapItemId)
    if (m.received !== undefined && !isQty0(m.received)) issues.push({ path: `materials.${i}.received`, message: 'Material masuk ≥ 0, maks. 2 desimal.' })
    if (m.used !== undefined && !isQty0(m.used)) issues.push({ path: `materials.${i}.used`, message: 'Material terpakai ≥ 0, maks. 2 desimal.' })
  })
  for (const [section, kind] of [['manpower', 'tenaga'], ['equipment', 'alat']] as const) {
    const rows = p[section]
    if (rows === undefined) continue
    if (rows.length > MAX_RESOURCES) issues.push({ path: section, message: `Maks. ${MAX_RESOURCES} baris.` })
    const seen = new Set<number>()
    rows.forEach((r, i) => {
      const t = resources.get(r.resourceTypeId)
      if (!t || t.kind !== kind) issues.push({ path: `${section}.${i}.resourceTypeId`, message: kind === 'tenaga' ? 'Jenis tenaga tidak dikenal.' : 'Jenis alat tidak dikenal.' })
      if (seen.has(r.resourceTypeId)) issues.push({ path: `${section}.${i}.resourceTypeId`, message: 'Jenis ganda.' })
      seen.add(r.resourceTypeId)
      if (!(Number.isSafeInteger(r.count) && r.count >= 1 && r.count <= 9999)) issues.push({ path: `${section}.${i}.count`, message: 'Jumlah 1–9999.' })
      if (r.hours !== undefined && r.hours !== null && !isHours(r.hours)) issues.push({ path: `${section}.${i}.hours`, message: 'Jam 0–24.' })
    })
  }
  if (p.issues !== undefined && p.issues !== null && p.issues.length > 2000) issues.push({ path: 'issues', message: 'Kendala maks. 2000 karakter.' })
  if (p.notes !== undefined && p.notes !== null && p.notes.length > 2000) issues.push({ path: 'notes', message: 'Catatan maks. 2000 karakter.' })
  validation(issues)
}

const resourcesOf = (rows: DailyResource[]) => rows.map((r) => ({ resourceTypeId: r.resourceTypeId, count: r.count, ...(r.hours === undefined || r.hours === null ? {} : { hours: round2(r.hours) }) }))

/**
 * Appends the ledger lines that turn `current` into `desired` (only keys present in `desired`) and
 * returns the work items now realised above their RAP volume.
 */
async function appendLines(
  req: PayloadRequest,
  doc: { id: number; project: number; company: number; reportDate: string },
  items: Map<number, ItemInfo>,
  current: Map<string, number>,
  desired: Map<string, number>,
  origin: LineOrigin,
  reason: string | null,
): Promise<{ changed: number; overRap: ItemInfo[] }> {
  let changed = 0
  const touched = new Set<number>()
  for (const [k, value] of desired) {
    const [itemId, kind] = k.split(':') as [string, LineKind]
    const delta = round2(value - (current.get(k) ?? 0))
    if (delta === 0) continue
    await req.payload.create({
      collection: 'daily-report-lines',
      data: { report: doc.id, project: doc.project, reportDate: doc.reportDate, rapItem: Number(itemId), kind, qty: delta, origin, reason, createdBy: userId(req) } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: append-only ledger of the daily report (DB checks item / project / kind)
      req,
    })
    changed++
    if (kind === 'work') touched.add(Number(itemId))
  }
  if (touched.size === 0) return { changed, overRap: [] }
  const fresh = await rapItemsOf(req, doc.project, doc.company)
  return { changed, overRap: [...touched].map((id) => fresh.get(id)!).filter((i) => i && i.realised > i.volume) }
}

/** Another reporter booked one of `itemIds` on the same project and date → POSSIBLE_DUPLICATE (never blocked). */
async function hasOtherBooking(req: PayloadRequest, d: { id: number; project: number; company: number; reportDate: string }, itemIds: number[]): Promise<boolean> {
  if (itemIds.length === 0) return false
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM daily_report_lines l
                    WHERE l.company_id = ${d.company} AND l.project_id = ${d.project} AND l.report_date = ${d.reportDate}
                      AND l.report_id <> ${d.id} AND l.kind = 'work' AND l.rap_item_id IN (${sql.join(itemIds.map((i) => sql`${i}`), sql`, `)})
                    GROUP BY l.report_id, l.rap_item_id HAVING sum(l.qty) <> 0) AS dup`)) as unknown as { rows: Array<{ dup: boolean }> }
  return r.rows[0]?.dup === true
}

async function afterLedger(
  req: PayloadRequest,
  doc: DailyDoc,
  res: { overRap: ItemInfo[] },
  note: string | null,
  workItemIds: number[],
): Promise<void> {
  const company = relId(doc.company)!
  const project = relId(doc.project)!
  const flags = new Set(flagsOf(doc))
  const before = [...flags].sort().join()
  if (res.overRap.length > 0) flags.add(DAILY_FLAGS.overRap)
  if (await hasOtherBooking(req, { id: doc.id, project, company, reportDate: doc.reportDate }, workItemIds)) flags.add(DAILY_FLAGS.possibleDuplicate)
  if ([...flags].sort().join() !== before) await withOverride(req, 'system', () => writeDoc(req, TYPE, doc.id, { flags: [...flags] }))
  await refreshRapProgress(req, project)
  if (res.overRap.length > 0) {
    const n = await namesOf(req, [doc])
    const pr = projectRef(n, doc.project)
    await notifyDailyOverRap(req, {
      id: doc.id,
      docNo: doc.docNo ?? null,
      company,
      project,
      projectLabel: [pr.code, pr.name].filter(Boolean).join(' '),
      reporter: userRef(n, doc.reporter)?.name ?? '',
      date: doc.reportDate,
      items: res.overRap.map((i) => `${i.code} ${i.description} (${round2(i.realised)}/${i.volume} ${i.uom})`).join(', '),
      note: note ?? '-',
    })
  }
}

/** Over-RAP needs an explanation (owner decision: allowed, flagged, PM notified, note required). */
function requireOverRapNote(over: ItemInfo[], note: string | null): void {
  if (over.length > 0 && !note) {
    fail(400, 'OVER_RAP_NOTE_REQUIRED', `Volume melebihi RAP (${over.map((i) => i.code).join(', ')}): isi catatan penjelasan.`, 'notes', { items: over.map((i) => ({ id: i.id, code: i.code, realised: round2(i.realised), volume: i.volume })) })
  }
}

/** Projected realisation of work items after applying `desired` (to require the note before writing). */
function projectedOver(items: Map<number, ItemInfo>, current: Map<string, number>, desired: Map<string, number> | null): ItemInfo[] {
  if (!desired) return []
  const out: ItemInfo[] = []
  for (const [k, v] of desired) {
    const [id, kind] = k.split(':')
    if (kind !== 'work') continue
    const it = items.get(Number(id))
    if (!it) continue
    const realised = round2(it.realised + v - (current.get(k) ?? 0))
    if (realised > it.volume && v > (current.get(k) ?? 0)) out.push({ ...it, realised })
  }
  return out
}

export async function createDailyReport(req: PayloadRequest, input: DailyInput, timing: Timing = SERVER_TIMING()): Promise<{ doc: DailyDoc; created: boolean }> {
  const uid = userId(req)
  if (uid === undefined) fail(401, 'FORBIDDEN', 'Unauthorized')
  const replay = await replayOf<DailyDoc>(req, TYPE, input.clientUuid)
  if (replay) return { doc: replay, created: false }
  const project = await requireReportableProject(req, input.projectId, TYPE)
  const items = await rapItemsOf(req, project.id, project.company)
  checkContent(input, items, await resourceKinds(req, project.company))
  const { today } = await companyDay(req, project.company, timing.time)
  const reportDate = input.reportDate ?? today
  checkReportDate(reportDate, today, 'reportDate')
  const existing = await req.payload.find({
    collection: 'daily-reports',
    where: { and: [{ project: { equals: project.id } }, { reporter: { equals: uid } }, { reportDate: { equals: reportDate } }] } as Where,
    limit: 1,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: one report per project, reporter and date
    req,
  })
  if (existing.docs[0]) fail(409, 'DAILY_EXISTS', `Anda sudah membuat laporan harian untuk ${reportDate} di project ini — ubah laporan itu.`, 'reportDate', { id: existing.docs[0].id })
  const photoIds = input.photoIds ?? []
  await checkPhotos(req, TYPE, photoIds, 0)
  const desired = desiredValues(input.work ?? [], input.materials ?? [])!
  const note = clean(input.notes)
  requireOverRapNote(projectedOver(items, new Map(), desired), note)

  const { docNo } = await allocateDocNo(req, 'daily_report', { companyId: project.company, date: parseBusinessDate(reportDate) })
  const flags = [...(timing.flags ?? [])]
  if (reportDate < today) flags.push(DAILY_FLAGS.backdated)
  const manpower = resourcesOf(input.manpower ?? [])
  const doc = await createDoc<DailyDoc>(req, TYPE, {
    docNo,
    project: project.id,
    reportDate,
    reporter: uid!,
    weatherMorning: input.weather?.morning ?? null,
    weatherNoon: input.weather?.noon ?? null,
    weatherAfternoon: input.weather?.afternoon ?? null,
    rainHours: input.rainHours ?? null,
    stopHours: input.stopHours ?? null,
    manpower,
    equipment: resourcesOf(input.equipment ?? []),
    workerCount: manpower.reduce((s, r) => s + r.count, 0),
    issues: clean(input.issues),
    notes: note,
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
  const res = await appendLines(req, { id: doc.id, project: project.id, company: project.company, reportDate }, items, new Map(), desired, 'report', null)
  const fresh = (await loadRaw<DailyDoc>(req, TYPE, doc.id))!
  await afterLedger(req, fresh, res, note, (input.work ?? []).filter((w) => w.qty > 0).map((w) => w.rapItemId))
  return { doc: (await loadRaw<DailyDoc>(req, TYPE, doc.id))!, created: true }
}

async function applyPatch(req: PayloadRequest, doc: DailyDoc, patch: DailyPatch, mode: 'edit' | 'correction', reason: string | undefined): Promise<DailyDoc> {
  const company = relId(doc.company)!
  const project = relId(doc.project)!
  const items = await rapItemsOf(req, project, company)
  checkContent(patch, items, await resourceKinds(req, company))
  const add = patch.addPhotoIds ?? []
  const photos = await photoIdsOf(req, TYPE, doc.id)
  await checkPhotos(req, TYPE, add, photos.length)
  const current = await currentValues(req, doc.id, company)
  const desired = desiredValues(patch.work, patch.materials)
  const note = patch.notes !== undefined ? clean(patch.notes) : (doc.notes ?? null)
  requireOverRapNote(projectedOver(items, current, desired), note)

  const data: Record<string, unknown> = {}
  const set = (k: string, v: unknown, cur: unknown) => {
    if (v !== undefined && JSON.stringify(v ?? null) !== JSON.stringify(cur ?? null)) data[k] = v
  }
  set('weatherMorning', patch.weather?.morning, doc.weatherMorning)
  set('weatherNoon', patch.weather?.noon, doc.weatherNoon)
  set('weatherAfternoon', patch.weather?.afternoon, doc.weatherAfternoon)
  set('rainHours', patch.rainHours, num(doc.rainHours))
  set('stopHours', patch.stopHours, num(doc.stopHours))
  if (patch.manpower !== undefined) {
    const m = resourcesOf(patch.manpower)
    set('manpower', m, doc.manpower)
    set('workerCount', m.reduce((s, r) => s + r.count, 0), num(doc.workerCount))
  }
  if (patch.equipment !== undefined) set('equipment', resourcesOf(patch.equipment), doc.equipment)
  set('issues', patch.issues === undefined ? undefined : clean(patch.issues), doc.issues)
  set('notes', patch.notes === undefined ? undefined : clean(patch.notes), doc.notes)
  if (add.length > 0) data.photoCount = photos.length + add.length
  const ledgerChanges = desired ? [...desired].filter(([k, v]) => round2(v - (current.get(k) ?? 0)) !== 0).length : 0
  if (Object.keys(data).length === 0 && add.length === 0 && ledgerChanges === 0) return doc

  data.syncRev = revOf(doc) + 1
  const auditReason = mode === 'correction' ? `Koreksi: ${reason}` : reason
  if (mode === 'correction') {
    data.correctedAt = new Date().toISOString()
    data.correctedBy = userId(req)
    data.flags = [...new Set([...flagsOf(doc), DAILY_FLAGS.corrected])]
    await withOverride(req, 'correction', () => writeDoc(req, TYPE, doc.id, data, auditReason))
  } else {
    await writeDoc(req, TYPE, doc.id, data, auditReason)
  }
  if (add.length > 0) await claimPhotos(req, TYPE, doc.id, add, doc.docNo ?? undefined)
  const res = desired
    ? await appendLines(req, { id: doc.id, project, company, reportDate: doc.reportDate }, items, current, desired, mode === 'correction' ? 'correction' : 'edit', reason ?? null)
    : { changed: 0, overRap: [] as ItemInfo[] }
  const fresh = (await loadRaw<DailyDoc>(req, TYPE, doc.id))!
  await afterLedger(req, fresh, res, note, (patch.work ?? []).filter((w) => w.qty > 0).map((w) => w.rapItemId))
  return (await loadRaw<DailyDoc>(req, TYPE, doc.id))!
}

/** PATCH /daily-reports/{id}: the reporter, within 24 h. */
export async function editDailyReport(req: PayloadRequest, id: number, patch: DailyPatch): Promise<DailyDoc> {
  await loadVisible(req, TYPE, id)
  await lockDoc(req, TYPE, id)
  const doc = (await loadRaw<DailyDoc>(req, TYPE, id))!
  requireReporterEdit(req, doc, LABEL)
  return applyPatch(req, doc, patch, 'edit', patch.reason?.trim() || undefined)
}

/** POST /daily-reports/{id}/corrections: PM of the project team or the Direktur, any time, reason required (Finance / Admin only read). */
export async function correctDailyReport(req: PayloadRequest, id: number, patch: DailyPatch): Promise<DailyDoc> {
  await loadVisible(req, TYPE, id)
  await lockDoc(req, TYPE, id)
  const doc = (await loadRaw<DailyDoc>(req, TYPE, id))!
  const reason = await requireCorrector(req, TYPE, doc, patch.reason)
  return applyPatch(req, doc, patch, 'correction', reason)
}

// ---------------------------------------------------------------- read side

type LineRow = { report_id: number; rap_item_id: number; kind: LineKind; qty: string; origin: LineOrigin; reason: string | null; created_by_id: number; created_at: string; id: number }

async function linesOf(req: PayloadRequest, reportIds: number[], companies: number[]): Promise<LineRow[]> {
  if (reportIds.length === 0 || companies.length === 0) return []
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT l.id, l.report_id, l.rap_item_id, l.kind::text AS kind, l.qty::text AS qty, l.origin::text AS origin, l.reason, l.created_by_id, l.created_at
      FROM daily_report_lines l
     WHERE l.report_id IN (${sql.join(reportIds.map((i) => sql`${i}`), sql`, `)}) AND l.company_id IN (${sql.join(companies.map((c) => sql`${c}`), sql`, `)})
     ORDER BY l.id`)) as unknown as { rows: LineRow[] }
  return r.rows
}

export async function dailyDtos(req: PayloadRequest, docs: readonly DailyDoc[], opts: { history?: boolean } = {}) {
  const n = await namesOf(req, docs)
  const ph = await photosOf(req, TYPE, docs.map((d) => d.id))
  const companies = [...new Set(docs.map((d) => relId(d.company)).filter((c): c is number => c !== undefined))]
  const lines = await linesOf(req, docs.map((d) => d.id), companies)
  const itemIds = [...new Set(lines.map((l) => l.rap_item_id))]
  const items = new Map<number, { code: string; description: string; kind: string; uom: string }>()
  if (itemIds.length) {
    const res = await req.payload.find({ collection: 'rap-items', where: { id: { in: itemIds } }, depth: 1, pagination: false, select: { code: true, description: true, kind: true, uom: true }, overrideAccess: true /* SYSTEM-READ: names of items of readable reports */, req })
    for (const d of res.docs as Array<{ id: number; code: string; description: string; kind: string; uom?: { code?: string } | number }>) {
      items.set(d.id, { code: d.code, description: d.description, kind: d.kind, uom: typeof d.uom === 'object' ? String(d.uom?.code ?? '') : '' })
    }
  }
  const resources = new Map<number, string>()
  for (const c of companies) for (const [id, r] of await resourceKinds(req, c)) resources.set(id, r.name)
  const users = new Map<number, string | null>()
  if (opts.history) {
    const uids = [...new Set(lines.map((l) => l.created_by_id))]
    const u = await namesOf(req, uids.map((id) => ({ reporter: id })))
    for (const id of uids) users.set(id, userRef(u, id)?.name ?? null)
  }
  const ref = (id: number) => ({ id, ...(items.get(id) ?? { code: `#${id}`, description: '', kind: '', uom: '' }) })
  const res = (rows: unknown) => (Array.isArray(rows) ? (rows as DailyResource[]).map((r) => ({ ...r, name: resources.get(r.resourceTypeId) ?? `#${r.resourceTypeId}` })) : [])
  return docs.map((d) => {
    const mine = lines.filter((l) => l.report_id === d.id)
    const sum = new Map<string, number>()
    for (const l of mine) sum.set(`${l.rap_item_id}:${l.kind}`, round2((sum.get(`${l.rap_item_id}:${l.kind}`) ?? 0) + Number(l.qty)))
    const work = [...sum].filter(([k, v]) => k.endsWith(':work') && v !== 0).map(([k, v]) => ({ item: ref(Number(k.split(':')[0])), qty: v }))
    const mat = new Map<number, { received: number; used: number }>()
    for (const [k, v] of sum) {
      const [id, kind] = k.split(':')
      if (kind === 'work') continue
      const m = mat.get(Number(id)) ?? { received: 0, used: 0 }
      if (kind === 'material_in') m.received = v
      else m.used = v
      mat.set(Number(id), m)
    }
    return {
      id: d.id,
      uuid: (d.uuid as string | null) ?? null,
      companyId: relId(d.company) ?? null,
      docNo: d.docNo ?? null,
      project: projectRef(n, d.project),
      reportDate: d.reportDate,
      reporter: userRef(n, d.reporter)!,
      weather: { morning: d.weatherMorning ?? null, noon: d.weatherNoon ?? null, afternoon: d.weatherAfternoon ?? null },
      rainHours: num(d.rainHours),
      stopHours: num(d.stopHours),
      work,
      materials: [...mat].filter(([, m]) => m.received !== 0 || m.used !== 0).map(([id, m]) => ({ item: ref(id), ...m })),
      manpower: res(d.manpower),
      equipment: res(d.equipment),
      workerCount: num(d.workerCount) ?? 0,
      issues: str(d.issues),
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
      ...(opts.history
        ? { ledger: mine.map((l) => ({ id: l.id, item: ref(l.rap_item_id), kind: l.kind, qty: Number(l.qty), origin: l.origin, reason: l.reason, by: { id: l.created_by_id, name: users.get(l.created_by_id) ?? null }, at: l.created_at })) }
        : {}),
    }
  })
}

export type DailyDto = Awaited<ReturnType<typeof dailyDtos>>[number]

export async function dailyDto(req: PayloadRequest, d: DailyDoc, opts: { history?: boolean } = {}): Promise<DailyDto> {
  return (await dailyDtos(req, [d], opts))[0]!
}

export type DailyListFilter = { projectId?: number; reporterId?: number; from?: string; to?: string; mine?: boolean; limit: number; after?: number; companyIds?: readonly number[] }

export async function listDailyReports(req: PayloadRequest, f: DailyListFilter): Promise<{ items: DailyDto[]; nextCursor: number | null }> {
  const and: Where[] = []
  if (f.projectId !== undefined) and.push({ project: { equals: f.projectId } })
  if (f.reporterId !== undefined) and.push({ reporter: { equals: f.reporterId } })
  if (f.from) and.push({ reportDate: { greater_than_equal: f.from } })
  if (f.to) and.push({ reportDate: { less_than_equal: f.to } })
  if (f.mine) and.push({ reporter: { equals: userId(req) ?? -1 } })
  if (f.after !== undefined) and.push({ id: { less_than: f.after } })
  if (f.companyIds?.length) and.push({ company: { in: [...f.companyIds] } })
  const docs = await scopedFind<DailyDoc>(req, 'daily-reports', and, f.limit + 1, '-id')
  const page = docs.slice(0, f.limit)
  return { items: await dailyDtos(req, page), nextCursor: docs.length > f.limit ? page[page.length - 1]!.id : null }
}

// ---------------------------------------------------------------- weekly recap

export type WeeklyRecap = {
  project: { id: number; startDate: string }
  weeks: Array<{ week: number; from: string; to: string; reports: number; workerDays: number; rainHours: number; stopHours: number }>
  items: Array<{ id: number; code: string; description: string; uom: string; volume: number; perWeek: Record<number, number>; realised: number; pct: number }>
}

/**
 * GET /projects/{id}/daily-recap — "Minggu ke-N" (Mon–Sun, week 1 = the week of the project start, or of
 * the first report when the project has no start date): per week the reports, worker-days and hours lost;
 * per work item the volume booked per week and the cumulative %. Quantities only (no prices).
 */
export async function weeklyRecap(req: PayloadRequest, projectId: number): Promise<WeeklyRecap> {
  const p = await loadProjectFor(req, projectId)
  const tx = await getRequestTx(req)
  const head = (await tx.execute(sql`
    SELECT to_char(coalesce(pr.start_date::date, (SELECT min(report_date)::date FROM daily_reports WHERE project_id = pr.id AND company_id = pr.company_id), current_date), 'YYYY-MM-DD') AS start
      FROM projects pr WHERE pr.id = ${projectId} AND pr.company_id = ${p.company}`)) as unknown as { rows: Array<{ start: string }> }
  const start = head.rows[0]?.start ?? new Date().toISOString().slice(0, 10)
  const reports = (await tx.execute(sql`
    SELECT left(report_date::text, 10) AS d, coalesce(worker_count, 0) AS workers, coalesce(rain_hours, 0)::text AS rain, coalesce(stop_hours, 0)::text AS stop
      FROM daily_reports WHERE project_id = ${projectId} AND company_id = ${p.company}`)) as unknown as { rows: Array<{ d: string; workers: number; rain: string; stop: string }> }
  const lines = (await tx.execute(sql`
    SELECT rap_item_id, left(report_date::text, 10) AS d, sum(qty)::text AS qty
      FROM daily_report_lines WHERE project_id = ${projectId} AND company_id = ${p.company} AND kind = 'work'
     GROUP BY rap_item_id, report_date`)) as unknown as { rows: Array<{ rap_item_id: number; d: string; qty: string }> }
  const items = await rapItemsOf(req, projectId, p.company)

  const weeks = new Map<number, WeeklyRecap['weeks'][number]>()
  const week = (n: number) => {
    let w = weeks.get(n)
    if (!w) weeks.set(n, (w = { week: n, ...weekRangeOf(start, n), reports: 0, workerDays: 0, rainHours: 0, stopHours: 0 }))
    return w
  }
  for (const r of reports.rows) {
    const w = week(Math.max(1, weekNo(start, r.d)))
    w.reports++
    w.workerDays += Number(r.workers)
    w.rainHours = round2(w.rainHours + Number(r.rain))
    w.stopHours = round2(w.stopHours + Number(r.stop))
  }
  const perItem = new Map<number, Record<number, number>>()
  for (const l of lines.rows) {
    const n = Math.max(1, weekNo(start, l.d))
    week(n)
    const m = perItem.get(l.rap_item_id) ?? {}
    m[n] = round2((m[n] ?? 0) + Number(l.qty))
    perItem.set(l.rap_item_id, m)
  }
  return {
    project: { id: projectId, startDate: start },
    weeks: [...weeks.values()].sort((a, b) => a.week - b.week),
    items: [...items.values()]
      .filter((i) => i.kind === 'pekerjaan' && (i.active || i.realised !== 0))
      .sort((a, b) => a.code.localeCompare(b.code, 'id', { numeric: true }))
      .map((i) => ({ id: i.id, code: i.code, description: i.description, uom: i.uom, volume: i.volume, perWeek: perItem.get(i.id) ?? {}, realised: round2(i.realised), pct: itemPct(i.realised, i.volume) })),
  }
}
