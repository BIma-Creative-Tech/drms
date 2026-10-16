import type { PayloadRequest, Where } from 'payload'

import { hasRole, memberCompanies, relId } from '@/access/roles'
import { companyById, displayNames } from '@/domain/companies'
import { DEFAULT_TZ } from '@/lib/time'
import { localDate } from '@/domain/progress/rules'

import { mayReadRates } from './access'
import { scopedFind } from './service'
import { namesOf, num, str, unitRef } from './refs'
import { kindOf, round2, unitLabel, type FieldReportType, type ProjectKind, type RateBasis } from './rules'
import type { TimesheetDoc } from './timesheet'
import type { ContractTermsView, MatrixContract, MatrixTimesheet } from './views'
import { NOT_DELETED } from '@/domain/soft-delete/where'

/**
 * FR1 web views (admin custom views, ADR 0020): read models that are not part of the /api/v1
 * contract — always with the CALLER's access (overrideAccess:false), names via the shared batch
 * lookup, rates only through `mayReadRates`. Writes never happen here (the views post to /api/v1).
 */

export type ProjectOpt = { id: number; code: string; name: string; kind: ProjectKind; companyId: number; clientId: number | null; status: string | null; label: string }

/** Selected PTs of the caller where field reports are switched on (companies.fieldReportsEnabled). */
export async function enabledCompanies(req: PayloadRequest): Promise<number[]> {
  const out: number[] = []
  for (const c of memberCompanies(req)) {
    const co = await companyById(req, c).catch(() => null)
    if (co?.fieldReportsEnabled === true) out.push(c)
  }
  return out
}

/** Today (business date) of a PT (company timezone), else of the server TZ. */
export async function todayOf(req: PayloadRequest, companyId?: number | null): Promise<string> {
  const co = typeof companyId === 'number' ? await companyById(req, companyId).catch(() => null) : null
  return localDate(new Date(), co?.timezone || process.env.TZ || DEFAULT_TZ)
}

/** Projects of the given kinds the caller may read (Staff: assigned; PM: team; office: all), in PTs with the flag on. */
export async function fieldProjects(req: PayloadRequest, kinds: readonly ProjectKind[], companies: readonly number[], opts: { includeArchived?: boolean } = {}): Promise<ProjectOpt[]> {
  if (companies.length === 0) return []
  const and: Where[] = [{ kind: { in: [...kinds] } }, { company: { in: [...companies] } }]
  if (!opts.includeArchived) and.push({ status: { not_in: ['arsip', 'dibatalkan'] } })
  const r = await req.payload
    .find({ collection: 'projects', where: { and }, sort: 'code', depth: 0, pagination: false, select: { code: true, name: true, kind: true, company: true, client: true, status: true }, user: req.user, overrideAccess: false /* caller's project scope */, req })
    .catch(() => ({ docs: [] as unknown[] }))
  return (r.docs as Array<Record<string, unknown> & { id: number }>).map((p) => ({
    id: p.id,
    code: String(p.code ?? ''),
    name: String(p.name ?? ''),
    kind: kindOf(p.kind),
    companyId: relId(p.company)!,
    clientId: relId(p.client) ?? null,
    status: (p.status as string | null) ?? null,
    label: `${String(p.code ?? '')} ${String(p.name ?? '')}`.trim(),
  }))
}

/**
 * One document the caller may read, or null — `find` by id instead of findByID: a findByID that throws
 * NotFound/Forbidden makes Payload kill the request transaction, which the view still needs.
 */
async function findVisible(req: PayloadRequest, collection: 'projects' | 'vehicles' | 'service-reports' | 'unit-timesheets' | 'aftersales-activities' | 'daily-reports', id: number, select?: Record<string, true>): Promise<(Record<string, unknown> & { id: number }) | null> {
  const r = await req.payload.find({ collection, where: { id: { equals: id } }, limit: 1, depth: 0, pagination: false, ...(select ? { select } : {}), user: req.user, overrideAccess: false /* caller's read scope */, req })
  return (r.docs[0] as unknown as (Record<string, unknown> & { id: number }) | undefined) ?? null
}

/** A field report the caller may read (collection access), or null. */
export async function visibleFieldDoc<T>(req: PayloadRequest, type: FieldReportType, id: number): Promise<T | null> {
  const collection = ({ service_report: 'service-reports', unit_timesheet: 'unit-timesheets', aftersales_activity: 'aftersales-activities', daily_report: 'daily-reports' } as const)[type]
  return (await findVisible(req, collection, id)) as T | null
}

/** One project the caller may read (any kind), or null. */
export async function visibleProject(req: PayloadRequest, id: number): Promise<ProjectOpt | null> {
  const p = await findVisible(req, 'projects', id, { code: true, name: true, kind: true, company: true, client: true, status: true })
  if (!p) return null
  return { id: p.id, code: String(p.code ?? ''), name: String(p.name ?? ''), kind: kindOf(p.kind), companyId: relId(p.company)!, clientId: relId(p.client) ?? null, status: (p.status as string | null) ?? null, label: `${String(p.code ?? '')} ${String(p.name ?? '')}`.trim() }
}

type ContractRow = Record<string, unknown> & { id: number; startDate: string; endDate?: string | null }

export type ContractView = MatrixContract & { projectId: number; companyId: number; terms: ContractTermsView | null; notes: string | null; unitType: string | null }

/**
 * Contract units of projects (caller's read scope of contract-units); rates only for the rate roles of
 * the unit's PT (`terms` null otherwise — the caller never sees an empty rate).
 */
export async function contractsOf(req: PayloadRequest, projectIds: readonly number[]): Promise<ContractView[]> {
  if (projectIds.length === 0) return []
  const r = await req.payload
    .find({ collection: 'contract-units', where: { project: { in: [...projectIds] } }, sort: 'startDate', depth: 0, pagination: false, user: req.user, overrideAccess: false /* caller's scope; rate fields stripped by field access */, req })
    .catch(() => ({ docs: [] as unknown[] }))
  const docs = r.docs as ContractRow[]
  const n = await namesOf(req, docs, { users: [], clients: [] })
  return docs.map((c) => {
    const company = relId(c.company)!
    const u = unitRef(n, c.unit)
    const rates = mayReadRates(req, company) && c.rate !== undefined && c.rate !== null
    return {
      id: c.id,
      unitId: u.id,
      label: u.label ?? `Unit #${u.id}`,
      type: u.type,
      unitType: u.type,
      startDate: c.startDate,
      endDate: (c.endDate as string | null | undefined) || null,
      active: c.active !== false,
      projectId: relId(c.project)!,
      companyId: company,
      terms: rates ? { rateBasis: (c.rateBasis === 'per_bulan' ? 'per_bulan' : 'per_jam') as RateBasis, rate: Number(c.rate), minHoursPerMonth: num(c.minHoursPerMonth) } : null,
      notes: str(c.notes),
    }
  })
}

/** Raw timesheets of projects in [from, to] (caller's read scope) as matrix rows (with unit labels). */
export async function timesheetsOf(req: PayloadRequest, f: { projectIds?: readonly number[]; unitId?: number; from: string; to: string; limit?: number }): Promise<Array<MatrixTimesheet & { projectId: number; unitLabel: string; reporterId: number | null }>> {
  const and: Where[] = [{ reportDate: { greater_than_equal: f.from } }, { reportDate: { less_than_equal: f.to } }]
  if (f.projectIds) and.push({ project: { in: [...f.projectIds, 0] } })
  if (f.unitId !== undefined) and.push({ unit: { equals: f.unitId } })
  const docs = await scopedFind<TimesheetDoc>(req, 'unit-timesheets', and, f.limit ?? 5000, 'reportDate')
  const n = await namesOf(req, docs, { users: [], clients: [] })
  return docs.map((d) => ({
    id: d.id,
    projectId: relId(d.project)!,
    unitId: relId(d.unit)!,
    unitLabel: unitRef(n, d.unit).label ?? `Unit #${relId(d.unit)}`,
    contractUnitId: relId(d.contractUnit) ?? null,
    reportDate: d.reportDate,
    hmStart: Number(d.hmStart),
    hmEnd: Number(d.hmEnd),
    workHours: Number(d.workHours),
    standbyHours: num(d.standbyHours) ?? 0,
    breakdownHours: num(d.breakdownHours) ?? 0,
    flags: Array.isArray(d.flags) ? (d.flags as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    reporterId: relId(d.reporter) ?? null,
  }))
}

export type UnitView = {
  id: number
  companyId: number
  kind: 'kendaraan' | 'alat_berat'
  label: string
  unitCode: string | null
  plate: string | null
  type: string | null
  brandModel: string | null
  serialNo: string | null
  owner: 'sendiri' | 'pelanggan'
  client: { id: number; name: string | null } | null
  status: 'siap' | 'rusak' | 'menunggu_part'
  lastHourMeter: number | null
  lastHourMeterAt: string | null
  active: boolean
}

function unitView(d: Record<string, unknown> & { id: number }, clientName: (id: number) => string | null): UnitView {
  const client = relId(d.client)
  return {
    id: d.id,
    companyId: relId(d.company)!,
    kind: d.kind === 'alat_berat' ? 'alat_berat' : 'kendaraan',
    label: unitLabel(d as never),
    unitCode: str(d.unitCode),
    plate: str(d.plateDisplay) ?? str(d.plateNo),
    type: str(d.type),
    brandModel: str(d.brandModel),
    serialNo: str(d.serialNo),
    owner: d.owner === 'pelanggan' ? 'pelanggan' : 'sendiri',
    client: client === undefined ? null : { id: client, name: clientName(client) },
    status: d.status === 'rusak' || d.status === 'menunggu_part' ? d.status : 'siap',
    lastHourMeter: num(d.lastHourMeter),
    lastHourMeterAt: str(d.lastHourMeterAt),
    active: d.active !== false,
  }
}

/** Units ("Unit & Kendaraan") of PTs the caller may read; heavy equipment first. */
export async function unitsOf(req: PayloadRequest, companies: readonly number[], opts: { ids?: readonly number[]; activeOnly?: boolean } = {}): Promise<UnitView[]> {
  if (companies.length === 0) return []
  const and: Where[] = [{ company: { in: [...companies] } }]
  // D1610: an explicit id list skips the central read rule → soft-deleted units are excluded here
  if (opts.ids) and.push({ id: { in: [...opts.ids, 0] } }, NOT_DELETED)
  if (opts.activeOnly) and.push({ active: { equals: true } })
  const r = await req.payload.find({ collection: 'vehicles', where: { and }, sort: 'displayName', depth: 0, pagination: false, user: req.user, overrideAccess: false /* members read the units of their PTs */, req }).catch(() => ({ docs: [] as unknown[] }))
  const docs = r.docs as Array<Record<string, unknown> & { id: number }>
  const n = await namesOf(req, docs, { users: [], clients: ['client'] })
  return docs.map((d) => unitView(d, (id) => n.client.get(id) ?? null)).sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label, 'id') : a.kind === 'alat_berat' ? -1 : 1))
}

export async function visibleUnit(req: PayloadRequest, id: number): Promise<UnitView | null> {
  const d = await findVisible(req, 'vehicles', id)
  if (!d) return null
  const n = await namesOf(req, [d], { users: [], clients: ['client'] })
  return unitView(d, (cid) => n.client.get(cid) ?? null)
}

/** Clients of PTs (aftersales picker; Staff assigned to an aftersales project read the PT's clients). */
export async function clientsOf(req: PayloadRequest, companies: readonly number[]): Promise<Array<{ id: number; name: string; companyId: number }>> {
  if (companies.length === 0) return []
  const r = await req.payload
    .find({ collection: 'clients', where: { company: { in: [...companies] } }, sort: 'name', depth: 0, pagination: false, select: { name: true, company: true }, user: req.user, overrideAccess: false /* caller's read scope */, req })
    .catch(() => ({ docs: [] as unknown[] }))
  return (r.docs as Array<{ id: number; name?: string; company?: unknown }>).map((c) => ({ id: c.id, name: c.name ?? `#${c.id}`, companyId: relId(c.company)! }))
}

/** Reporters of a field collection the caller can see (filter "Mekanik / pelapor"). */
export async function reportersOf(req: PayloadRequest, collection: 'service-reports' | 'unit-timesheets' | 'aftersales-activities' | 'daily-reports'): Promise<Array<{ id: number; name: string }>> {
  const docs = await scopedFind<{ reporter?: unknown }>(req, collection, [], 2000, '-id')
  const ids = [...new Set(docs.map((d) => relId(d.reporter)).filter((x): x is number => x !== undefined))]
  const names = await displayNames(req, ids)
  return ids.map((id) => ({ id, name: names.get(id) ?? `#${id}` })).sort((a, b) => a.name.localeCompare(b.name, 'id'))
}

// ---------------------------------------------------------------- history (audit) of one document

const FIELD_LABELS: Record<string, string> = {
  hourMeter: 'HM',
  hmStart: 'HM awal',
  hmEnd: 'HM akhir',
  workHours: 'jam kerja',
  standbyHours: 'jam standby',
  breakdownHours: 'jam breakdown',
  breakdownReason: 'alasan breakdown',
  fuelLiters: 'BBM',
  operatorName: 'operator',
  location: 'lokasi',
  notes: 'catatan',
  serviceType: 'jenis servis',
  serviceTypes: 'jenis servis', // DRMS owner 2026-10-17: multi-select of the PT master
  complaint: 'keluhan',
  action: 'tindakan',
  unitStatusAfter: 'status unit',
  spareparts: 'sparepart',
  helpers: 'helper',
  startTime: 'jam mulai',
  endTime: 'jam selesai',
  docNo: 'no. dokumen',
  items: 'item',
  value: 'nilai',
  followUpDate: 'follow-up',
  receiver: 'penerima',
  poStatus: 'status PO',
  flags: 'tanda',
}

export type HistoryEntry = { at: string; user: string | null; action: 'create' | 'update' | 'correction' | 'other'; fields: string[]; reason: string | null }

/**
 * Change history of ONE field document the caller may read (checked by the view before): audit rows
 * grouped per event — who, when, which fields, the reason ("Koreksi: …"). Values are NOT shown (an
 * aftersales value must stay hidden from callers without the rate roles).
 */
export async function historyOf(req: PayloadRequest, type: FieldReportType, id: number): Promise<HistoryEntry[]> {
  const r = await req.payload
    .find({
      collection: 'audit-logs',
      where: { and: [{ docType: { equals: type } }, { docId: { equals: String(id) } }, { action: { in: ['create', 'update', 'status_change'] } }] },
      sort: 'serverTime',
      limit: 300,
      depth: 0,
      select: { serverTime: true, eventId: true, action: true, field: true, reason: true, userId: true },
      overrideAccess: true, // SYSTEM-READ: history of a document the caller may read (no values returned)
      req,
    })
    .catch(() => ({ docs: [] as unknown[] }))
  const rows = r.docs as Array<{ serverTime?: string; eventId?: string; action?: string; field?: string | null; reason?: string | null; userId?: number | null }>
  const names = await displayNames(req, rows.map((x) => x.userId).filter((x): x is number => typeof x === 'number'))
  const events = new Map<string, HistoryEntry>()
  for (const x of rows) {
    const key = x.eventId ?? `${x.serverTime}-${x.userId}`
    const e = events.get(key) ?? { at: x.serverTime ?? '', user: typeof x.userId === 'number' ? (names.get(x.userId) ?? null) : null, action: x.action === 'create' ? 'create' : 'update', fields: [], reason: null }
    if (x.field && x.field !== 'syncRev' && x.field !== 'correctedAt' && x.field !== 'correctedBy' && x.field !== 'editableUntil') {
      const label = FIELD_LABELS[x.field] ?? null
      if (label && !e.fields.includes(label)) e.fields.push(label)
    }
    if (x.reason && !e.reason) e.reason = x.reason
    if (e.reason && /^koreksi/i.test(e.reason)) e.action = 'correction'
    events.set(key, e)
  }
  return [...events.values()].filter((e) => e.action === 'create' || e.fields.length > 0 || e.reason)
}

/** Rounded sum helper for the overview tiles. */
export const sum2 = (xs: readonly number[]): number => round2(xs.reduce((a, b) => a + b, 0))

/** Caller holds a creator role (Staff/PM/Direktur) in PT `company` — UI hint; the API re-checks assignment/team. */
export const mayCreateIn = (req: PayloadRequest, company: number): boolean => hasRole(req, ['pk-staff', 'pk-pm', 'pk-owner'], company)
/** PM / Direktur in PT `company` (corrections; the API re-checks the project team). */
export const mayCorrectIn = (req: PayloadRequest, company: number | null | undefined): boolean => hasRole(req, ['pk-pm', 'pk-owner'], company)
