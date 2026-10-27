/**
 * FR1 (ADR 0020, requirements v1.3) — pure rules of the field reports per project kind: which report
 * types a project kind offers, unit master validation, hour-meter (HM) rules, timesheet hours, the
 * monthly billing ESTIMATE of a contract unit (never an invoice), availability and PO status
 * transitions of the aftersales activity log. No Payload import (unit-tested in
 * tests/unit/fr1-rules.test.ts).
 */

import type { Role } from '@/access/roles'

/** ADR 0020 §7: contract rates / billing estimates and aftersales values — Direktur, Finance, Admin only. */
export const RATE_FIELD_ROLES: readonly Role[] = ['pk-owner', 'pk-finance', 'pk-admin']

export const PROJECT_KINDS = ['umum', 'konstruksi', 'kontrak_unit', 'aftersales', 'trading'] as const
export type ProjectKind = (typeof PROJECT_KINDS)[number]
export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
  umum: 'Umum',
  konstruksi: 'Konstruksi',
  kontrak_unit: 'Kontrak unit (sewa alat)',
  aftersales: 'Aftersales (servis & sparepart)',
  trading: 'Trading',
}

export const FIELD_REPORT_TYPES = ['service_report', 'unit_timesheet', 'aftersales_activity', 'daily_report'] as const
export type FieldReportType = (typeof FIELD_REPORT_TYPES)[number]
export const FIELD_REPORT_LABELS: Record<FieldReportType, string> = {
  service_report: 'Laporan servis unit',
  unit_timesheet: 'Timesheet unit',
  aftersales_activity: 'Aktivitas aftersales',
  daily_report: 'Laporan harian',
}

/**
 * ADR 0020 §1: the project kind decides the field reports. Konstruksi gets the daily construction
 * report (P3, `daily_report`); trading and umum have none.
 */
export const REPORT_TYPES_BY_KIND: Readonly<Record<ProjectKind, readonly FieldReportType[]>> = {
  umum: [],
  konstruksi: ['daily_report'],
  kontrak_unit: ['unit_timesheet', 'service_report'],
  aftersales: ['service_report', 'aftersales_activity'],
  trading: [],
}

export function isProjectKind(v: unknown): v is ProjectKind {
  return typeof v === 'string' && (PROJECT_KINDS as readonly string[]).includes(v)
}

/** Project kind of a stored value (null/unknown → umum, the default of existing projects). */
export const kindOf = (v: unknown): ProjectKind => (isProjectKind(v) ? v : 'umum')

export function reportTypesFor(kind: unknown): readonly FieldReportType[] {
  return REPORT_TYPES_BY_KIND[kindOf(kind)]
}

export function kindAllows(kind: unknown, type: FieldReportType): boolean {
  return reportTypesFor(kind).includes(type)
}

// ---------------------------------------------------------------- units

export const UNIT_KINDS = ['kendaraan', 'alat_berat'] as const
export type UnitKind = (typeof UNIT_KINDS)[number]
export const UNIT_OWNERS = ['sendiri', 'pelanggan'] as const
export type UnitOwner = (typeof UNIT_OWNERS)[number]
export const UNIT_STATUSES = ['siap', 'rusak', 'menunggu_part'] as const
export type UnitStatus = (typeof UNIT_STATUSES)[number]
export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = { siap: 'Siap operasi', rusak: 'Rusak', menunggu_part: 'Menunggu part' }

/** Unit code of heavy equipment: letters, digits, `-`, `/`, `.` (e.g. `EX-01`), stored upper case. */
export const UNIT_CODE_RE = /^[A-Z0-9][A-Z0-9./-]{0,31}$/

export const normalizeUnitCode = (v: string): string => v.trim().toUpperCase().replace(/\s+/g, '-')

export type UnitInput = { kind?: unknown; unitCode?: unknown; plateNo?: unknown; owner?: unknown; client?: unknown }
export type FieldIssue = { path: string; message: string }

const filled = (v: unknown): boolean => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')

/**
 * Master "Unit & Kendaraan" (ADR 0020 §3): a vehicle needs a plate, heavy equipment a unit code;
 * a customer-owned unit names its customer (clients), an own unit never does.
 */
export function unitErrors(u: UnitInput): FieldIssue[] {
  const out: FieldIssue[] = []
  const kind = u.kind ?? 'kendaraan'
  if (!(UNIT_KINDS as readonly unknown[]).includes(kind)) out.push({ path: 'kind', message: 'Jenis unit tidak dikenal.' })
  if (kind === 'kendaraan' && !filled(u.plateNo)) out.push({ path: 'plateNo', message: 'Nomor polisi wajib untuk kendaraan.' })
  if (kind === 'alat_berat' && !filled(u.unitCode)) out.push({ path: 'unitCode', message: 'Kode unit wajib untuk alat berat.' })
  if (filled(u.unitCode) && !UNIT_CODE_RE.test(String(u.unitCode))) out.push({ path: 'unitCode', message: 'Kode unit: huruf besar/angka, boleh - / . (maks. 32), mis. EX-01.' })
  const owner = u.owner ?? 'sendiri'
  if (!(UNIT_OWNERS as readonly unknown[]).includes(owner)) out.push({ path: 'owner', message: 'Pemilik unit tidak dikenal.' })
  if (owner === 'pelanggan' && !filled(u.client)) out.push({ path: 'client', message: 'Pelanggan wajib diisi untuk unit milik pelanggan.' })
  return out
}

/** Display label of a unit: unit code and/or plate (`EX-01 · DA 1234 XY`), else the type. */
export function unitLabel(u: { unitCode?: string | null; plateDisplay?: string | null; plateNo?: string | null; type?: string | null }): string {
  const parts = [u.unitCode, u.plateDisplay ?? u.plateNo].filter((x): x is string => typeof x === 'string' && x.length > 0)
  return parts.length > 0 ? parts.join(' · ') : (u.type ?? '—')
}

// ---------------------------------------------------------------- numbers, dates

export const EDIT_WINDOW_HOURS = 24
export const MAX_HOURS_PER_DAY = 24
/** A report date may lie at most this many days before the day it reaches the server (offline queue). */
export const BACKDATE_MAX_DAYS = 14
/** Photos per report; service report 10 → 25 (DRMS owner 2026-10-17, ADR 0020 amendment 2026-10-17; DB: migration d1710_service_types). */
export const MAX_PHOTOS: Readonly<Record<FieldReportType, number>> = { service_report: 25, unit_timesheet: 1, aftersales_activity: 5, daily_report: 10 }
/** HM / hours / litres: ≥ 0, ≤ 2 decimals. */
export const MAX_HM = 10_000_000

export const round2 = (v: number): number => Math.round(v * 100) / 100

export function isDec2(v: unknown, max = MAX_HM): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && Math.abs(round2(v) - v) < 1e-9
}

export const BUSINESS_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function utcOf(d: string): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, day)
}

/** Calendar days b − a between business dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcOf(b) - utcOf(a)) / 86_400_000)
}

export function addDays(d: string, n: number): string {
  return new Date(utcOf(d) + n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Report date of a field report against "today" in the company TZ: not in the future, not older than
 * BACKDATE_MAX_DAYS. Returns an error message or null.
 * D2410 (user 2026-10-24, ADR 0020 amendment 2026-10-24): `unlimitedBackdate` — the timesheet of the project's PM
 * (projects.pm) or the PT's Direktur may lie on ANY past date (the contract unit's period is checked by the caller /
 * the DB trigger); never in the future.
 */
export function reportDateError(date: string, today: string, opts: { unlimitedBackdate?: boolean } = {}): string | null {
  if (!BUSINESS_DATE_RE.test(date) || addDays(date, 0) !== date) return 'Tanggal harus YYYY-MM-DD.'
  if (date > today) return `Tanggal laporan tidak boleh di masa depan (hari ini ${today}).`
  if (!opts.unlimitedBackdate && daysBetween(date, today) > BACKDATE_MAX_DAYS) return `${BACKDATE_LIMIT_TEXT}.`
  return null
}

/** Why a reporter may not pick an older date (API error, web matrix title, form notice). */
export const BACKDATE_LIMIT_TEXT = `Tanggal laporan paling lama ${BACKDATE_MAX_DAYS} hari ke belakang; tanggal yang lebih lama hanya dapat diisi PM project atau Direktur`

/**
 * D2410: earliest report date of a NEW timesheet for the caller on a project — today − BACKDATE_MAX_DAYS for a field
 * reporter; for the PM of the project / the Direktur the earliest start of the project's contract units (each contract
 * unit's own period still applies; `today` when there is none).
 */
export function timesheetMinDate(today: string, unlimitedBackdate: boolean, contractStarts: readonly string[] = []): string {
  if (!unlimitedBackdate) return addDays(today, -BACKDATE_MAX_DAYS)
  const first = [...contractStarts].sort()[0]
  return first !== undefined && first < today ? first : today
}

// ---------------------------------------------------------------- hour meter

/** HM tolerance: readings are compared on 2 decimals. */
const HM_EPS = 0.005

/** ADR 0020 §6: a new reading below the unit's last HM is rejected (HM_DECREASED) unless it is a correction. */
export function hmDecreased(reading: number, last: number | null | undefined): boolean {
  return typeof last === 'number' && Number.isFinite(last) && reading < last - HM_EPS
}

/** HM_GAP: the timesheet's start HM differs from the end HM of the unit's previous timesheet WITH HM (D2410: HM is weekly). */
export function hmGap(start: number | null | undefined, previousEnd: number | null | undefined): boolean {
  return typeof start === 'number' && typeof previousEnd === 'number' && Number.isFinite(previousEnd) && Math.abs(start - previousEnd) > HM_EPS
}

export type TimesheetHours = {
  /** D2410 (user 2026-10-24): HM is optional (operators read it about once a week) — both or none. */
  hmStart?: number | null
  hmEnd?: number | null
  workHours: number
  standbyHours?: number | null
  breakdownHours?: number | null
  breakdownReason?: string | null
  fuelLiters?: number | null
}

const given = (v: unknown): boolean => v !== undefined && v !== null

/** Does a timesheet carry an HM reading (both values; the pair rule makes "one of them" an error)? */
export const hasHm = (t: { hmStart?: unknown; hmEnd?: unknown }): boolean => given(t.hmStart) && given(t.hmEnd)

export const HM_PHOTO_REQUIRED = 'Foto meter HM wajib bila HM diisi.'

/**
 * Timesheet numbers (ADR 0020 §5, amendment 2026-10-24): HM optional but both or none, HM end ≥ start (≥ 0, 2
 * decimals); work hours required; hours ≥ 0 and Σ ≤ 24, breakdown needs a reason.
 */
export function timesheetErrors(t: TimesheetHours): FieldIssue[] {
  const out: FieldIssue[] = []
  const s = given(t.hmStart)
  const e = given(t.hmEnd)
  if (s && !isDec2(t.hmStart)) out.push({ path: 'hmStart', message: 'HM awal ≥ 0 dengan maks. 2 desimal.' })
  if (e && !isDec2(t.hmEnd)) out.push({ path: 'hmEnd', message: 'HM akhir ≥ 0 dengan maks. 2 desimal.' })
  else if (e && isDec2(t.hmStart) && (t.hmEnd as number) < t.hmStart) out.push({ path: 'hmEnd', message: 'HM akhir tidak boleh lebih kecil dari HM awal.' })
  if (s && !e) out.push({ path: 'hmEnd', message: 'HM akhir wajib bila HM awal diisi (HM boleh dikosongkan keduanya).' })
  if (e && !s) out.push({ path: 'hmStart', message: 'HM awal wajib bila HM akhir diisi (HM boleh dikosongkan keduanya).' })
  const hours: Array<[keyof TimesheetHours, string]> = [
    ['workHours', 'Jam kerja'],
    ['standbyHours', 'Jam standby'],
    ['breakdownHours', 'Jam breakdown'],
  ]
  let sum = 0
  for (const [k, label] of hours) {
    const v = t[k] ?? 0
    if (!isDec2(v, MAX_HOURS_PER_DAY)) out.push({ path: k, message: `${label} 0–24 dengan maks. 2 desimal.` })
    else sum += v as number
  }
  if (round2(sum) > MAX_HOURS_PER_DAY) out.push({ path: 'workHours', message: `Total jam kerja + standby + breakdown maks. 24 (sekarang ${round2(sum)}).` })
  if ((t.breakdownHours ?? 0) > 0 && !filled(t.breakdownReason)) out.push({ path: 'breakdownReason', message: 'Alasan breakdown wajib bila ada jam breakdown.' })
  if (t.fuelLiters !== undefined && t.fuelLiters !== null && !isDec2(t.fuelLiters, 100_000)) out.push({ path: 'fuelLiters', message: 'BBM (liter) ≥ 0 dengan maks. 2 desimal.' })
  return out
}

/** Breakdown hours from which the APK/web suggests a service report (plan B "Perilaku sistem"). */
export const BREAKDOWN_SUGGEST_SERVICE_HOURS = 4

// ---------------------------------------------------------------- billing estimate (NOT an invoice)

export const RATE_BASES = ['per_jam', 'per_bulan'] as const
export type RateBasis = (typeof RATE_BASES)[number]

export type ContractTerms = { rateBasis: RateBasis; rate: number; minHoursPerMonth?: number | null; startDate: string; endDate?: string | null }

/** Days of `month` ('YYYY-MM') and how many of them the contract covers (start/end inclusive). */
export function contractDaysInMonth(c: Pick<ContractTerms, 'startDate' | 'endDate'>, month: string): { contractDays: number; monthDays: number; from: string | null; to: string | null } {
  const first = `${month}-01`
  const [y, m] = month.split('-').map(Number) as [number, number]
  const monthDays = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const last = `${month}-${String(monthDays).padStart(2, '0')}`
  const from = c.startDate > first ? c.startDate : first
  const to = c.endDate && c.endDate < last ? c.endDate : last
  if (from > to) return { contractDays: 0, monthDays, from: null, to: null }
  return { contractDays: daysBetween(from, to) + 1, monthDays, from, to }
}

export type BillingEstimate = {
  basis: RateBasis
  /** Hours billed (per_jam): max(work hours, minimum hours of the covered part of the month). */
  billableHours: number | null
  /** Minimum hours applied for the covered part of the month (per_jam; prorated when partial). */
  minHours: number | null
  contractDays: number
  monthDays: number
  /** Rupiah, rounded; ESTIMATE ONLY (ADR 0020 §8: the invoice is made outside the app). */
  amount: number
}

/**
 * Monthly billing estimate of one contract unit (ADR 0020 §8):
 * - per_jam: rate × max(work hours, minimum hours); the minimum is prorated by the contract days of
 *   the month when the contract covers only part of it (a full month uses minHoursPerMonth as is);
 * - per_bulan: rate × contract days / days of the month (full month = rate).
 */
export function billingEstimate(c: ContractTerms, month: string, workHours: number): BillingEstimate {
  const { contractDays, monthDays } = contractDaysInMonth(c, month)
  if (contractDays === 0) return { basis: c.rateBasis, billableHours: c.rateBasis === 'per_jam' ? 0 : null, minHours: c.rateBasis === 'per_jam' ? 0 : null, contractDays, monthDays, amount: 0 }
  if (c.rateBasis === 'per_bulan') {
    return { basis: 'per_bulan', billableHours: null, minHours: null, contractDays, monthDays, amount: Math.round((c.rate * contractDays) / monthDays) }
  }
  const fullMin = Math.max(0, c.minHoursPerMonth ?? 0)
  const minHours = contractDays === monthDays ? fullMin : round2((fullMin * contractDays) / monthDays)
  const billableHours = round2(Math.max(workHours, minHours))
  return { basis: 'per_jam', billableHours, minHours, contractDays, monthDays, amount: Math.round(c.rate * billableHours) }
}

/**
 * Physical availability (%) of a unit over its timesheets: (work + standby) / (work + standby +
 * breakdown) × 100, 1 decimal; null without reported hours. ADR 0020 §8 (open question: a planned
 * hours per day figure from the contract would replace the denominator).
 */
export function availabilityPct(work: number, standby: number, breakdown: number): number | null {
  const total = work + standby + breakdown
  if (!(total > 0)) return null
  return Math.round(((work + standby) / total) * 1000) / 10
}

// ---------------------------------------------------------------- aftersales activity log

export const ACTIVITY_KINDS = ['penawaran', 'po_masuk', 'pengiriman', 'penagihan', 'kunjungan', 'lainnya'] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]
export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  penawaran: 'Penawaran',
  po_masuk: 'PO masuk',
  pengiriman: 'Pengiriman',
  penagihan: 'Penagihan',
  kunjungan: 'Kunjungan',
  lainnya: 'Lainnya',
}
export const PO_STATUSES = ['belum_kirim', 'sebagian', 'terkirim', 'batal'] as const
export type PoStatus = (typeof PO_STATUSES)[number]
export const PO_STATUS_LABELS: Record<PoStatus, string> = { belum_kirim: 'Belum kirim', sebagian: 'Terkirim sebagian', terkirim: 'Terkirim', batal: 'Batal' }
/** PO statuses that still need a delivery ("PO terbuka"). */
export const OPEN_PO_STATUSES: readonly PoStatus[] = ['belum_kirim', 'sebagian']

/** Activity kinds that refer to an incoming PO (`relatesTo`). */
export const RELATES_TO_PO: readonly ActivityKind[] = ['pengiriman', 'penagihan']

export type PoTransition = { ok: true; status: PoStatus } | { ok: false; message: string }

/**
 * Status of an incoming PO after a delivery that refers to it: "PO selesai dikirim?" yes → terkirim,
 * no → sebagian. A cancelled or fully delivered PO takes no further delivery (PO_CLOSED).
 */
export function poStatusAfterDelivery(current: PoStatus | null | undefined, delivered: boolean): PoTransition {
  const cur = current ?? 'belum_kirim'
  if (cur === 'batal') return { ok: false, message: 'PO sudah dibatalkan; pengiriman tidak dapat dicatat untuk PO ini.' }
  if (cur === 'terkirim') return { ok: false, message: 'PO sudah terkirim seluruhnya.' }
  return { ok: true, status: delivered ? 'terkirim' : 'sebagian' }
}

/** Manual PO status change (correction by PM/Direktur): any status, except back from batal. */
export function poStatusCorrection(current: PoStatus | null | undefined, next: PoStatus): PoTransition {
  if ((current ?? 'belum_kirim') === 'batal' && next !== 'batal') return { ok: false, message: 'PO yang dibatalkan tidak dapat dibuka lagi.' }
  return { ok: true, status: next }
}

export type ActivityShape = {
  kind: ActivityKind
  relatesTo?: number | null
  followUpDate?: string | null
  receiver?: string | null
  poDelivered?: boolean | null
  value?: number | null
}

/** Kind-specific fields of an activity (pure part; the referenced PO is checked by the service + DB). */
export function activityErrors(a: ActivityShape): FieldIssue[] {
  const out: FieldIssue[] = []
  if (!(ACTIVITY_KINDS as readonly string[]).includes(a.kind)) out.push({ path: 'kind', message: 'Jenis aktivitas tidak dikenal.' })
  const relates = RELATES_TO_PO.includes(a.kind)
  if (a.kind === 'pengiriman' && (a.relatesTo === undefined || a.relatesTo === null)) out.push({ path: 'relatesTo', message: 'Pengiriman harus mengacu ke PO masuk.' })
  if (!relates && a.relatesTo !== undefined && a.relatesTo !== null) out.push({ path: 'relatesTo', message: 'Hanya pengiriman/penagihan yang mengacu ke PO masuk.' })
  if (a.kind !== 'pengiriman' && a.poDelivered !== undefined && a.poDelivered !== null) out.push({ path: 'poDelivered', message: '"PO selesai dikirim" hanya untuk pengiriman.' })
  if (a.kind !== 'penawaran' && filled(a.followUpDate)) out.push({ path: 'followUpDate', message: 'Tanggal follow-up hanya untuk penawaran.' })
  if (filled(a.followUpDate) && !BUSINESS_DATE_RE.test(String(a.followUpDate))) out.push({ path: 'followUpDate', message: 'Tanggal harus YYYY-MM-DD.' })
  if (a.value !== undefined && a.value !== null && !(Number.isSafeInteger(a.value) && a.value >= 0)) out.push({ path: 'value', message: 'Nilai harus bilangan bulat Rupiah ≥ 0.' })
  return out
}

/** Days a PO is open as of `asOf` (both business dates). */
export const poAgeDays = (poDate: string, asOf: string): number => Math.max(0, daysBetween(poDate, asOf))

// ---------------------------------------------------------------- service report

/**
 * The four LEGACY service types (enum of the 0.13 schema, APK 0.7.0 `ServiceType`). DRMS owner 2026-10-17: "Jenis
 * servis" is now the per-PT master `service-types` (multi-select on the report) — these codes/names only seed every PT
 * (migration d1710_service_types + `ensureDefaultServiceTypes`) and map the legacy single `serviceType` /
 * `service_type` of old clients onto the PT's master row with the same code.
 */
export const SERVICE_TYPES = ['servis_berkala', 'perbaikan', 'inspeksi', 'pemasangan'] as const
export type ServiceType = (typeof SERVICE_TYPES)[number]
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = { servis_berkala: 'Servis berkala', perbaikan: 'Perbaikan', inspeksi: 'Inspeksi', pemasangan: 'Pemasangan' }
/** Seed of the per-PT master (code = legacy enum value). */
export const DEFAULT_SERVICE_TYPES: ReadonlyArray<{ code: ServiceType; name: string; sortOrder: number }> = SERVICE_TYPES.map((code, i) => ({ code, name: SERVICE_TYPE_LABELS[code], sortOrder: i + 1 }))
/** Selected service types of one report: 1 … MAX_SERVICE_TYPES, unique (API + sync). */
export const MAX_SERVICE_TYPES = 20
export const SERVICE_TYPES_REQUIRED = 'Pilih minimal satu jenis servis.'

/**
 * LEGACY single value of a selection (REST DTO `serviceType`, sync copy `service_type`, column `service_type`) —
 * coordinator decision 2026-10-17: the code of the first selected type whose code is one of the four legacy codes (APK
 * 0.7.0 can show / pre-select only those), else the first selected code; null for an empty selection.
 */
export function legacyServiceTypeCode(codes: ReadonlyArray<string | null | undefined>): string | null {
  const list = codes.filter((c): c is string => typeof c === 'string' && c !== '')
  return list.find((c) => (SERVICE_TYPES as readonly string[]).includes(c)) ?? list[0] ?? null
}

/** "Servis berkala, Perbaikan": names of the selected types in selection order (legacy code → its label as fallback). */
export function serviceTypeNames(types: ReadonlyArray<{ name?: string | null; code?: string | null }> | null | undefined, legacy?: string | null): string {
  const names = (types ?? []).map((t) => t.name || t.code || '').filter(Boolean)
  if (names.length > 0) return names.join(', ')
  if (!legacy) return '—'
  return SERVICE_TYPE_LABELS[legacy as ServiceType] ?? legacy
}

/** Start/end time of a service visit (HH:MM, same day): end after start when both are given. */
export function serviceTimeError(start?: string | null, end?: string | null): FieldIssue | null {
  if (start && !TIME_RE.test(start)) return { path: 'startTime', message: 'Jam mulai HH:MM.' }
  if (end && !TIME_RE.test(end)) return { path: 'endTime', message: 'Jam selesai HH:MM.' }
  if (start && end && end <= start) return { path: 'endTime', message: 'Jam selesai harus setelah jam mulai.' }
  return null
}

/**
 * Customer-owned unit on a project with a client: the unit's customer must be that client
 * (plan A "pelanggan harus sama dengan klien project bila diisi").
 */
export function unitClientMismatch(unit: { owner?: string | null; client?: number | null }, projectClient: number | null | undefined): boolean {
  return unit.owner === 'pelanggan' && typeof projectClient === 'number' && unit.client !== projectClient
}
