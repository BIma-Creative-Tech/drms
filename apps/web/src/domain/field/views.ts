/**
 * FR1 web views (ADR 0020, plan "Web" of A/A2/B + project timeline) — pure view models of the admin
 * pages: the contract timesheet matrix (unit × day), the monthly recap per contract unit with the
 * billing ESTIMATE (never an invoice; only for the rate roles), the weekly aftersales recap and the
 * merged project timeline. No Payload / React import (unit-tested in tests/unit/fr1-views.test.ts);
 * the numbers use the same rules as the registry reports (availabilityPct, billingEstimate).
 */
import { addDays, availabilityPct, BACKDATE_LIMIT_TEXT, billingEstimate, contractDaysInMonth, daysBetween, OPEN_PO_STATUSES, round2, type ActivityKind, type BillingEstimate, type PoStatus, type RateBasis } from './rules'

export const ESTIMATE_LABEL = 'Estimasi — bukan invoice'
export const ESTIMATE_NOTE = 'Invoice resmi dibuat di luar aplikasi.'

const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const WEEKDAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// ---------------------------------------------------------------- numbers & dates

/** Indonesian number: dot thousands, comma decimals, ≤ `digits` decimals, no trailing zeros ('1.031,5'). */
export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const f = 10 ** digits
  const r = Math.round(Math.abs(v) * f) / f
  const [int, frac] = String(r).split('.')
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${v < 0 && r !== 0 ? '−' : ''}${grouped}${frac ? `,${frac}` : ''}`
}

/**
 * Decimal typed in an Indonesian form ('1.031,5', '7,5', '7.5', '1031'): a comma is the decimal mark
 * (dots are thousands); without a comma, several dots are thousands, and a single dot is the thousands
 * mark when it groups exactly 3 digits after a 1–3 digit integer not starting with 0 ('1.023', '5.000' —
 * what `fmtNum` prints, so prefilled HM values round-trip; 3 decimals are never valid input, max 2), else
 * the decimal mark ('7.5', '0.125'). Empty → null; anything else (letters, two commas, minus) → NaN.
 * UAT FR T-01 (2026-10-10): before, '1.023' read as 1.023 — the timesheet form rejected its own HM awal
 * prefill and the correction dialog re-sent untouched HM '1.030' as 1.03.
 */
export function parseDecimalId(raw: string | null | undefined): number | null {
  const t = String(raw ?? '').trim().replace(/\s+/g, '')
  if (t === '') return null
  let s: string
  if (t.includes(',')) {
    if (t.split(',').length > 2) return Number.NaN
    s = t.replace(/\./g, '').replace(',', '.')
  } else if ((t.match(/\./g) ?? []).length > 1 || /^[1-9]\d{0,2}\.\d{3}$/.test(t)) {
    s = t.replace(/\./g, '')
  } else {
    s = t
  }
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN
}

/** 'YYYY-MM-DD' → 'Kamis, 9 Okt 2026'. */
export function longDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay()
  return `${WEEKDAYS[dow]}, ${day} ${MONTHS_SHORT[m - 1]} ${y}`
}

/** 'YYYY-MM-DD' → 'Kam 9'. */
export function shortDay(d: string): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]!.slice(0, 3)} ${day}`
}

/** 'YYYY-MM' → 'Oktober 2026'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return `${MONTHS_LONG[m - 1]} ${y}`
}

/** Days of 'YYYY-MM' as business dates. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** Month query value (?bulan=) → 'YYYY-MM', never after the month of `today`. */
export function monthParam(v: unknown, today: string): string {
  const cur = today.slice(0, 7)
  return typeof v === 'string' && MONTH_RE.test(v) && v <= cur ? v : cur
}

/** Last `count` months up to the month of `today` (newest first) for a month picker. */
export function recentMonths(today: string, count = 12): string[] {
  const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number]
  return Array.from({ length: count }, (_, i) => {
    const idx = y * 12 + (m - 1) - i
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
  })
}

/** Monday of the week of `d`. */
export function mondayOf(d: string): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  const dow = (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7
  return addDays(d, -dow)
}

/** Week (Monday–Sunday) of `?minggu=YYYY-MM-DD` (any day of it), default: the week of `today`; never a future week. */
export function weekRange(v: unknown, today: string): { from: string; to: string; label: string } {
  const pick = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today ? v : today
  const from = mondayOf(pick)
  const to = addDays(from, 6)
  const [, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  const label = fm === tm ? `${fd}–${td} ${MONTHS_SHORT[tm - 1]} ${ty}` : `${fd} ${MONTHS_SHORT[fm - 1]} – ${td} ${MONTHS_SHORT[tm - 1]} ${ty}`
  return { from, to, label }
}

// ---------------------------------------------------------------- contract timesheet matrix

export type MatrixContract = {
  /** contract-units id */
  id: number
  unitId: number
  label: string
  type?: string | null
  startDate: string
  endDate: string | null
  active: boolean
}

export type MatrixTimesheet = {
  id: number
  unitId: number
  contractUnitId: number | null
  reportDate: string
  /** null = no HM reading that day (D2410: HM is weekly). */
  hmStart: number | null
  hmEnd: number | null
  workHours: number
  standbyHours: number
  breakdownHours: number
  flags: readonly string[]
}

/**
 * State of one cell: filled (work hours), breakdown (filled with breakdown hours > 0 — orange),
 * missing (in the contract, not in the future, no timesheet — red), off (outside the contract
 * period), future (after today).
 */
export type CellState = 'filled' | 'breakdown' | 'missing' | 'off' | 'future'
/** `fillable` (D2410): a missing day the caller may still file (date ≥ the caller's `minDate`) — the matrix "+". */
export type MatrixCell = { date: string; state: CellState; ts: MatrixTimesheet | null; hmGap: boolean; fillable: boolean }
export type MatrixRow = { contract: MatrixContract; cells: MatrixCell[]; work: number; standby: number; breakdown: number; filled: number; missing: number; gaps: number }
export type Matrix = { month: string; days: string[]; rows: MatrixRow[]; totals: { work: number; standby: number; breakdown: number; filled: number; missing: number; gaps: number } }

export const inPeriod = (date: string, c: Pick<MatrixContract, 'startDate' | 'endDate'>): boolean => date >= c.startDate && (c.endDate === null || date <= c.endDate)

/** Timesheet of a contract row: its own contract unit, or (legacy/null link) same unit inside the period. */
function belongs(t: MatrixTimesheet, c: MatrixContract): boolean {
  if (t.contractUnitId !== null) return t.contractUnitId === c.id
  return t.unitId === c.unitId && inPeriod(t.reportDate, c)
}

/**
 * Matrix unit × day of one kontrak_unit project for `month`: one row per contract unit overlapping
 * the month (inactive ones only when they have timesheets), cells per day, row/total sums. `minDate` (D2410) = the
 * caller's earliest timesheet date (`timesheetMinDate`): older missing days stay "missing" but are not `fillable`.
 */
export function buildTimesheetMatrix(input: { month: string; today: string; contracts: readonly MatrixContract[]; timesheets: readonly MatrixTimesheet[]; minDate?: string }): Matrix {
  const days = monthDays(input.month)
  const first = days[0]!
  const last = days[days.length - 1]!
  const rows: MatrixRow[] = []
  for (const c of input.contracts) {
    if (c.startDate > last || (c.endDate !== null && c.endDate < first)) continue
    const mine = input.timesheets.filter((t) => belongs(t, c) && t.reportDate >= first && t.reportDate <= last)
    if (!c.active && mine.length === 0) continue
    const byDate = new Map(mine.map((t) => [t.reportDate, t]))
    const row: MatrixRow = { contract: c, cells: [], work: 0, standby: 0, breakdown: 0, filled: 0, missing: 0, gaps: 0 }
    for (const date of days) {
      const ts = byDate.get(date) ?? null
      let state: CellState
      if (ts) state = ts.breakdownHours > 0 ? 'breakdown' : 'filled'
      else if (date > input.today) state = 'future'
      else if (!inPeriod(date, c) || !c.active) state = 'off'
      else state = 'missing'
      const hmGap = !!ts && ts.flags.includes('HM_GAP')
      row.cells.push({ date, state, ts, hmGap, fillable: state === 'missing' && (input.minDate === undefined || date >= input.minDate) })
      if (ts) {
        row.work += ts.workHours
        row.standby += ts.standbyHours
        row.breakdown += ts.breakdownHours
        row.filled++
      }
      if (state === 'missing') row.missing++
      if (hmGap) row.gaps++
    }
    row.work = round2(row.work)
    row.standby = round2(row.standby)
    row.breakdown = round2(row.breakdown)
    rows.push(row)
  }
  const sum = (k: 'work' | 'standby' | 'breakdown' | 'filled' | 'missing' | 'gaps') => round2(rows.reduce((a, r) => a + r[k], 0))
  return { month: input.month, days, rows, totals: { work: sum('work'), standby: sum('standby'), breakdown: sum('breakdown'), filled: sum('filled'), missing: sum('missing'), gaps: sum('gaps') } }
}

/** Accessible text of a matrix cell (screen readers / title). */
export function cellText(c: MatrixCell, unitLabel: string): string {
  const d = `${unitLabel}, ${longDate(c.date)}`
  if (c.ts) {
    const parts = [`${fmtNum(c.ts.workHours)} jam kerja`]
    if (c.ts.breakdownHours > 0) parts.push(`breakdown ${fmtNum(c.ts.breakdownHours)} jam`)
    if (c.hmGap) parts.push('selisih HM')
    return `${d}: ${parts.join(', ')}`
  }
  if (c.state === 'missing') return `${d}: belum diisi${c.fillable ? '' : ` — ${BACKDATE_LIMIT_TEXT.charAt(0).toLowerCase()}${BACKDATE_LIMIT_TEXT.slice(1)}`}`
  if (c.state === 'future') return `${d}: belum terjadi`
  return `${d}: di luar periode kontrak`
}

// ---------------------------------------------------------------- monthly recap per contract unit

export type ContractTermsView = { rateBasis: RateBasis; rate: number | null; minHoursPerMonth: number | null }

export type RecapRow = {
  contract: MatrixContract
  hmStart: number | null
  hmEnd: number | null
  work: number
  standby: number
  breakdown: number
  availability: number | null
  /** Days of the contract in the month up to today without a timesheet. */
  missing: number
  filled: number
  contractDays: number
  /** null for callers without the rate roles (never shown, never an empty "Rp" column). */
  estimate: BillingEstimate | null
  rateText: string | null
  /** Footnote of the estimate (minimum applied, prorated per_bulan). */
  estimateNote: string | null
}

export function rateText(t: ContractTermsView): string | null {
  if (t.rate === null) return null
  const rp = `Rp ${fmtNum(t.rate, 0)}`
  if (t.rateBasis === 'per_bulan') return `${rp}/bulan`
  return t.minHoursPerMonth ? `${rp}/jam · min ${fmtNum(t.minHoursPerMonth)} jam` : `${rp}/jam`
}

/** Footnote text of one estimate (why the amount is not simply rate × hours). */
export function estimateNote(e: BillingEstimate, workHours: number): string | null {
  if (e.basis === 'per_bulan') return e.contractDays < e.monthDays ? `Per bulan = prorata ${e.contractDays} dari ${e.monthDays} hari.` : null
  if (e.minHours !== null && e.minHours > 0 && workHours < e.minHours) return `Minimum ${fmtNum(e.minHours)} jam berlaku (jam kerja ${fmtNum(workHours)} di bawah minimum).`
  return null
}

/**
 * Recap rows of the matrix month (registry `rekap-timesheet-kontrak` rules): HM first recorded start → last recorded
 * end (D2410: days without HM skipped), hours, availability, missing days (contract days ≤ today) and — only when
 * `terms` carries a rate (rate roles) — the billing ESTIMATE.
 */
export function buildRecap(m: Matrix, terms: ReadonlyMap<number, ContractTermsView>): { rows: RecapRow[]; totals: { work: number; standby: number; breakdown: number; missing: number; estimate: number | null } } {
  const rows = m.rows.map((r): RecapRow => {
    const withHm = r.cells.filter((c) => c.ts && c.ts.hmStart !== null && c.ts.hmEnd !== null).map((c) => c.ts!)
    const t = terms.get(r.contract.id)
    const est = t && t.rate !== null ? billingEstimate({ rateBasis: t.rateBasis, rate: t.rate, minHoursPerMonth: t.minHoursPerMonth, startDate: r.contract.startDate, endDate: r.contract.endDate }, m.month, r.work) : null
    return {
      contract: r.contract,
      hmStart: withHm.length ? withHm[0]!.hmStart : null,
      hmEnd: withHm.length ? withHm[withHm.length - 1]!.hmEnd : null,
      work: r.work,
      standby: r.standby,
      breakdown: r.breakdown,
      availability: availabilityPct(r.work, r.standby, r.breakdown),
      missing: r.missing,
      filled: r.filled,
      contractDays: contractDaysInMonth(r.contract, m.month).contractDays,
      estimate: est,
      rateText: t ? rateText(t) : null,
      estimateNote: est ? estimateNote(est, r.work) : null,
    }
  })
  const anyEstimate = rows.some((r) => r.estimate !== null)
  return {
    rows,
    totals: {
      work: m.totals.work,
      standby: m.totals.standby,
      breakdown: m.totals.breakdown,
      missing: m.totals.missing,
      estimate: anyEstimate ? rows.reduce((a, r) => a + (r.estimate?.amount ?? 0), 0) : null,
    },
  }
}

// ---------------------------------------------------------------- weekly HM (D2410)

/** Label of a Monday–Sunday week: '29 Sep – 5 Okt 2026' / '6–12 Okt 2026'. */
export function weekLabel(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  if (fy !== ty) return `${fd} ${MONTHS_SHORT[fm - 1]} ${fy} – ${td} ${MONTHS_SHORT[tm - 1]} ${ty}`
  return fm === tm ? `${fd}–${td} ${MONTHS_SHORT[tm - 1]} ${ty}` : `${fd} ${MONTHS_SHORT[fm - 1]} – ${td} ${MONTHS_SHORT[tm - 1]} ${ty}`
}

/** Monday–Sunday weeks overlapping 'YYYY-MM' (the first may start in the previous month, the last end in the next). */
export function hmWeeks(month: string): Array<{ from: string; to: string; label: string }> {
  const days = monthDays(month)
  const out: Array<{ from: string; to: string; label: string }> = []
  for (let from = mondayOf(days[0]!); from <= days[days.length - 1]!; from = addDays(from, 7)) out.push({ from, to: addDays(from, 6), label: weekLabel(from, addDays(from, 6)) })
  return out
}

export type HmReading = { reportDate: string; hmStart: number | null; hmEnd: number | null }
export type HmWeek = { from: string; to: string; label: string; hmStart: number | null; hmEnd: number | null; total: number | null; days: number }

/**
 * D2410 (user 2026-10-24) weekly HM summary of ONE unit (operators read the HM about once a week): per Monday–Sunday
 * week overlapping `month` — HM awal = the first recorded HM start of the week, HM akhir = the last recorded HM end,
 * total = HM akhir − HM awal (the hours the meter ran that week, also on days without a reading), days = days with
 * HM. Timesheets without HM are skipped; a week without any reading has nulls and 0 days.
 */
export function weeklyHm(readings: readonly HmReading[], month: string): HmWeek[] {
  const withHm = readings.filter((r) => r.hmStart !== null && r.hmEnd !== null).sort((a, b) => (a.reportDate < b.reportDate ? -1 : a.reportDate > b.reportDate ? 1 : 0))
  return hmWeeks(month).map((w) => {
    const inWeek = withHm.filter((r) => r.reportDate >= w.from && r.reportDate <= w.to)
    const hmStart = inWeek.length ? inWeek[0]!.hmStart : null
    const hmEnd = inWeek.length ? inWeek[inWeek.length - 1]!.hmEnd : null
    return { ...w, hmStart, hmEnd, total: hmStart !== null && hmEnd !== null ? round2(hmEnd - hmStart) : null, days: new Set(inWeek.map((r) => r.reportDate)).size }
  })
}

// ---------------------------------------------------------------- aftersales weekly recap

export type WeekActivity = {
  id: number
  activityDate: string
  kind: ActivityKind
  client: { id: number; name: string | null }
  docNo: string | null
  poStatus: PoStatus | null
  value: number | null
  valueVisible: boolean
  followUpDate: string | null
}

export type ClientWeekRow = { clientId: number; name: string; penawaran: number; po: number; terkirim: number; belum: number; pengiriman: number; penagihan: number; kunjungan: number; value: number | null }

/**
 * Weekly aftersales recap (registry `rekap-aftersales` rules): per client the quotations, incoming POs
 * and their CURRENT status (terkirim / still open = belum kirim + sebagian), deliveries, invoices,
 * visits; the PO value only from values the caller may read (null when none).
 */
export function aftersalesWeek(activities: readonly WeekActivity[]): { kpi: { po: number; terkirim: number; belum: number; value: number | null }; clients: ClientWeekRow[] } {
  const by = new Map<number, ClientWeekRow>()
  for (const a of activities) {
    const r = by.get(a.client.id) ?? { clientId: a.client.id, name: a.client.name ?? `#${a.client.id}`, penawaran: 0, po: 0, terkirim: 0, belum: 0, pengiriman: 0, penagihan: 0, kunjungan: 0, value: null }
    if (a.kind === 'penawaran') r.penawaran++
    if (a.kind === 'pengiriman') r.pengiriman++
    if (a.kind === 'penagihan') r.penagihan++
    if (a.kind === 'kunjungan') r.kunjungan++
    if (a.kind === 'po_masuk') {
      r.po++
      if (a.poStatus === 'terkirim') r.terkirim++
      if (a.poStatus && OPEN_PO_STATUSES.includes(a.poStatus)) r.belum++
      if (a.valueVisible && a.value !== null && a.poStatus !== 'batal') r.value = (r.value ?? 0) + a.value
    }
    by.set(a.client.id, r)
  }
  const clients = [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'id') || a.clientId - b.clientId)
  const values = clients.filter((c) => c.value !== null)
  return {
    kpi: {
      po: clients.reduce((s, c) => s + c.po, 0),
      terkirim: clients.reduce((s, c) => s + c.terkirim, 0),
      belum: clients.reduce((s, c) => s + c.belum, 0),
      value: values.length ? values.reduce((s, c) => s + (c.value ?? 0), 0) : null,
    },
    clients,
  }
}

export type OpenPoView = { id: number; docNo: string | null; client: { id: number; name: string | null }; activityDate: string; poStatus: PoStatus; ageDays: number; items: ReadonlyArray<{ name: string; qty: number; uom?: string | null }> }
export type FollowUpView = { id: number; docNo: string | null; client: { id: number; name: string | null }; followUpDate: string; items: ReadonlyArray<{ name: string; qty: number; uom?: string | null }> }

export type TodoItem = { key: string; kind: 'po' | 'followup'; id: number; title: string; detail: string; tone: 'bad' | 'warn' | 'muted'; sortKey: number }

/** Short item list "Filter oli 6 PCS, V-belt 2 PCS" (max `n` items, then "+k"). */
export function itemsText(items: ReadonlyArray<{ name: string; qty: number; uom?: string | null }>, n = 3): string {
  if (items.length === 0) return ''
  const shown = items.slice(0, n).map((i) => `${i.name} ${fmtNum(i.qty, 3)}${i.uom ? ` ${i.uom}` : ''}`)
  return items.length > n ? `${shown.join(', ')} +${items.length - n}` : shown.join(', ')
}

/** Age (days) from which an open PO is shown as overdue (red) in "Perlu ditindaklanjuti". */
export const PO_OVERDUE_DAYS = 7

/**
 * "Perlu ditindaklanjuti": open POs (oldest first; ≥ PO_OVERDUE_DAYS red) and quotations whose
 * follow-up is due (overdue or within the next 7 days; due/overdue amber).
 */
export function followUpTodo(open: readonly OpenPoView[], followUps: readonly FollowUpView[], today: string): TodoItem[] {
  const out: TodoItem[] = []
  for (const p of open) {
    const status = p.poStatus === 'sebagian' ? 'Terkirim sebagian' : 'Belum kirim'
    const items = itemsText(p.items)
    out.push({ key: `po-${p.id}`, kind: 'po', id: p.id, title: `${p.docNo ?? `PO #${p.id}`} · ${p.client.name ?? '—'}`, detail: `${status} ${p.ageDays} hari${items ? ` · ${items}` : ''}`, tone: p.ageDays >= PO_OVERDUE_DAYS ? 'bad' : 'muted', sortKey: -p.ageDays })
  }
  for (const f of followUps) {
    const diff = daysBetween(today, f.followUpDate)
    const when = diff < 0 ? `lewat ${-diff} hari` : diff === 0 ? 'hari ini' : `${shortDay(f.followUpDate)} (${diff} hari lagi)`
    const items = itemsText(f.items)
    out.push({ key: `fu-${f.id}`, kind: 'followup', id: f.id, title: `${f.docNo ?? `Penawaran #${f.id}`} · ${f.client.name ?? '—'}`, detail: `Follow-up penawaran ${when}${items ? ` · ${items}` : ''}`, tone: diff <= 0 ? 'warn' : 'muted', sortKey: diff })
  }
  // open POs first (oldest first), then follow-ups by due date
  return out.sort((a, b) => (a.kind === b.kind ? a.sortKey - b.sortKey : a.kind === 'po' ? -1 : 1))
}

// ---------------------------------------------------------------- project timeline

export const TIMELINE_TYPES = ['timesheet', 'servis', 'aktivitas', 'harian'] as const
export type TimelineType = (typeof TIMELINE_TYPES)[number]
export const TIMELINE_LABELS: Record<TimelineType, string> = { timesheet: 'Timesheet', servis: 'Servis', aktivitas: 'Aktivitas', harian: 'Laporan harian' }

/** Which timeline types a project kind shows (konstruksi: daily reports from P3 — the hook is the `extra` input). */
export function timelineTypesFor(kind: string | null | undefined): TimelineType[] {
  if (kind === 'kontrak_unit') return ['timesheet', 'servis']
  if (kind === 'aftersales') return ['servis', 'aktivitas']
  if (kind === 'konstruksi') return ['harian']
  return []
}

export type TimelineEntry = {
  key: string
  type: TimelineType
  date: string
  title: string
  detail: string
  /** Part of the detail to stress (e.g. "EX-02 belum diisi"). */
  alert?: string
  href: string
  tone?: 'warn' | 'bad'
}

export type TimelineService = { id: number; docNo: string | null; reportDate: string; unitLabel: string; serviceTypeLabel: string; statusLabel: string; statusOk: boolean; action: string; hourMeter: number | null; spareparts: number; photos: number; reporter: string | null; corrected: boolean }
export type TimelineTimesheet = { id: number; reportDate: string; unitId: number; contractUnitId: number | null; unitLabel: string; workHours: number; breakdownHours: number; hmStart: number | null; hmEnd: number | null; flags: readonly string[] }
export type TimelineActivity = { id: number; activityDate: string; kindLabel: string; clientName: string | null; docNo: string | null; items: string; poStatusLabel: string | null; reporter: string | null }

const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Merges the field reports of one project into one timeline per date (newest first): each service
 * report and activity as an entry, the timesheets of a day as ONE summary ("2 dari 3 unit diisi"
 * against the contract units active that day; days in the window without any timesheet are listed
 * as missing up to today). `extra` = entries of other report types (P3 daily construction reports).
 */
export function mergeTimeline(input: {
  from: string
  to: string
  today: string
  types: readonly TimelineType[]
  contracts: readonly MatrixContract[]
  services: readonly TimelineService[]
  timesheets: readonly TimelineTimesheet[]
  activities: readonly TimelineActivity[]
  extra?: readonly TimelineEntry[]
  hrefs: { service: (id: number) => string; activity: (id: number) => string; timesheetDay: (date: string) => string }
}): Array<{ date: string; entries: TimelineEntry[] }> {
  const want = new Set(input.types)
  const entries: TimelineEntry[] = []
  const inWindow = (d: string) => d >= input.from && d <= input.to
  if (want.has('servis')) {
    for (const s of input.services) {
      if (!inWindow(s.reportDate)) continue
      const facts = [clip(s.action), s.hourMeter !== null ? `HM ${fmtNum(s.hourMeter)}` : null, s.spareparts ? `${s.spareparts} sparepart` : null, s.photos ? `${s.photos} foto` : null, s.reporter, s.corrected ? 'dikoreksi' : null].filter(Boolean)
      entries.push({ key: `sv-${s.id}`, type: 'servis', date: s.reportDate, title: `${s.docNo ?? `Servis #${s.id}`} · ${s.unitLabel} ${s.serviceTypeLabel} · ${s.statusLabel}`, detail: facts.join(' · '), href: input.hrefs.service(s.id), tone: s.statusOk ? undefined : 'warn' })
    }
  }
  if (want.has('aktivitas')) {
    for (const a of input.activities) {
      if (!inWindow(a.activityDate)) continue
      const facts = [a.items, a.poStatusLabel, a.reporter].filter(Boolean)
      entries.push({ key: `as-${a.id}`, type: 'aktivitas', date: a.activityDate, title: `${a.kindLabel} · ${a.clientName ?? '—'}${a.docNo ? ` · ${a.docNo}` : ''}`, detail: facts.join(' · '), href: input.hrefs.activity(a.id) })
    }
  }
  if (want.has('timesheet')) {
    const byDate = new Map<string, TimelineTimesheet[]>()
    for (const t of input.timesheets) if (inWindow(t.reportDate)) byDate.set(t.reportDate, [...(byDate.get(t.reportDate) ?? []), t])
    const last = input.to < input.today ? input.to : input.today
    for (let d = last; d >= input.from; d = addDays(d, -1)) {
      const expected = input.contracts.filter((c) => c.active && inPeriod(d, c))
      const day = byDate.get(d) ?? []
      if (day.length === 0 && expected.length === 0) continue
      const filledUnits = new Set(day.map((t) => t.unitId))
      const missing = expected.filter((c) => !filledUnits.has(c.unitId))
      const gaps = day.filter((t) => t.flags.includes('HM_GAP'))
      const total = Math.max(expected.length, filledUnits.size)
      const parts = [...day]
        .sort((a, b) => a.unitLabel.localeCompare(b.unitLabel, 'id'))
        .map((t) => `${t.unitLabel} ${fmtNum(t.workHours)} jam${t.breakdownHours > 0 ? ` (breakdown ${fmtNum(t.breakdownHours)})` : ''}${t.flags.includes('HM_GAP') ? ' ⚠' : ''}`)
      const alert = missing.length ? `${missing.map((c) => c.label).join(', ')} belum diisi` : undefined
      entries.push({
        key: `ts-${d}`,
        type: 'timesheet',
        date: d,
        title: `${filledUnits.size} dari ${total} unit diisi${gaps.length ? ' · ⚠ selisih HM' : ''}`,
        detail: parts.join(' · '),
        alert,
        href: input.hrefs.timesheetDay(d),
        tone: missing.length ? 'bad' : gaps.length ? 'warn' : undefined,
      })
    }
    // timesheets after today cannot exist (date check); nothing else to add
  }
  for (const e of input.extra ?? []) if (want.has(e.type) && inWindow(e.date)) entries.push(e)
  const order: Record<TimelineType, number> = { servis: 0, aktivitas: 1, harian: 2, timesheet: 3 }
  const groups = new Map<string, TimelineEntry[]>()
  for (const e of entries) groups.set(e.date, [...(groups.get(e.date) ?? []), e])
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, es]) => ({ date, entries: es.sort((a, b) => order[a.type] - order[b.type] || a.key.localeCompare(b.key)) }))
}

/** Timeline window (?dari/?sampai), default the last 30 days up to today; at most 92 days. */
export function timelineWindow(fromRaw: unknown, toRaw: unknown, today: string): { from: string; to: string } {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  const to = ok(toRaw) && toRaw <= today ? toRaw : today
  let from = ok(fromRaw) && fromRaw <= to ? fromRaw : addDays(to, -29)
  if (daysBetween(from, to) > 91) from = addDays(to, -91)
  return { from, to }
}

/** Live hours check of the timesheet form: Σ ≤ 24 and the share of each kind (0–100 %). */
export function hoursCheck(work: number | null, standby: number | null, breakdown: number | null): { total: number; over: boolean; shares: { work: number; standby: number; breakdown: number } } {
  const w = Number.isFinite(work) ? (work ?? 0) : 0
  const s = Number.isFinite(standby) ? (standby ?? 0) : 0
  const b = Number.isFinite(breakdown) ? (breakdown ?? 0) : 0
  const total = round2(w + s + b)
  const pct = (v: number) => Math.max(0, Math.min(100, (v / 24) * 100))
  return { total, over: total > 24, shares: { work: pct(w), standby: pct(s), breakdown: pct(b) } }
}
