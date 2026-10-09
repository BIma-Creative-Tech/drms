import { describe, expect, it } from 'vitest'

import {
  aftersalesWeek,
  buildRecap,
  buildTimesheetMatrix,
  cellText,
  ESTIMATE_LABEL,
  estimateNote,
  fmtNum,
  followUpTodo,
  hoursCheck,
  longDate,
  mergeTimeline,
  monthDays,
  monthLabel,
  monthParam,
  parseDecimalId,
  rateText,
  recentMonths,
  timelineTypesFor,
  timelineWindow,
  weekRange,
  type MatrixContract,
  type MatrixTimesheet,
  type TimelineTimesheet,
} from '@/domain/field/views'
import { billingEstimate } from '@/domain/field/rules'

/** FR1 web view models (src/domain/field/views.ts): matrix, recap + estimate labelling, aftersales week, timeline merge. */

const C = (id: number, unitId: number, label: string, startDate: string, endDate: string | null = null, active = true): MatrixContract => ({ id, unitId, label, type: 'Excavator', startDate, endDate, active })
let tsId = 0
const T = (unitId: number, contractUnitId: number | null, reportDate: string, work: number, extra: Partial<MatrixTimesheet> = {}): MatrixTimesheet => ({
  id: ++tsId,
  unitId,
  contractUnitId,
  reportDate,
  hmStart: 1000,
  hmEnd: 1000 + work,
  workHours: work,
  standbyHours: 0,
  breakdownHours: 0,
  flags: [],
  ...extra,
})

describe('numbers & dates (Indonesian)', () => {
  it('fmtNum: dot thousands, comma decimals, no trailing zeros, dash for null', () => {
    expect(fmtNum(1031.5)).toBe('1.031,5')
    expect(fmtNum(70_000_000, 0)).toBe('70.000.000')
    expect(fmtNum(8)).toBe('8')
    expect(fmtNum(7.25)).toBe('7,25')
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(-2.5)).toBe('−2,5')
  })
  it('parseDecimalId: comma = decimal, several dots = thousands, single dot = decimal', () => {
    expect(parseDecimalId('1.031,5')).toBe(1031.5)
    expect(parseDecimalId('7,5')).toBe(7.5)
    expect(parseDecimalId('7.5')).toBe(7.5)
    expect(parseDecimalId('1.250.000')).toBe(1250000)
    expect(parseDecimalId(' 1031 ')).toBe(1031)
    expect(parseDecimalId('')).toBeNull()
    expect(parseDecimalId('1,2,3')).toBeNaN()
    expect(parseDecimalId('-3')).toBeNaN()
    expect(parseDecimalId('abc')).toBeNaN()
  })
  it('month helpers, week range, long dates', () => {
    expect(monthDays('2026-02')).toHaveLength(28)
    expect(monthDays('2026-10').at(-1)).toBe('2026-10-31')
    expect(monthParam('2026-09', '2026-10-09')).toBe('2026-09')
    expect(monthParam('2026-11', '2026-10-09')).toBe('2026-10') // never a future month
    expect(monthParam('bogus', '2026-10-09')).toBe('2026-10')
    expect(monthLabel('2026-10')).toBe('Oktober 2026')
    expect(recentMonths('2026-01-15', 3)).toEqual(['2026-01', '2025-12', '2025-11'])
    expect(weekRange(undefined, '2026-10-09')).toEqual({ from: '2026-10-05', to: '2026-10-11', label: '5–11 Okt 2026' })
    expect(weekRange('2026-09-30', '2026-10-09')).toMatchObject({ from: '2026-09-28', to: '2026-10-04', label: '28 Sep – 4 Okt 2026' })
    expect(weekRange('2027-01-01', '2026-10-09').from).toBe('2026-10-05') // future → this week
    expect(longDate('2026-10-09')).toBe('Jumat, 9 Okt 2026')
  })
})

describe('contract timesheet matrix (unit × day)', () => {
  const contracts = [C(1, 11, 'EX-01', '2026-09-01'), C(2, 12, 'EX-02', '2026-10-05', '2026-10-20'), C(3, 13, 'DZ-09', '2026-08-01', null, false)]
  const ts = [
    T(11, 1, '2026-10-01', 8),
    T(11, 1, '2026-10-02', 7.5, { standbyHours: 1 }),
    T(12, 2, '2026-10-06', 2, { breakdownHours: 6 }),
    T(12, 2, '2026-10-07', 6, { flags: ['HM_GAP'] }),
    T(11, null, '2026-10-03', 8), // legacy row without contract link → matched by unit + period
  ]
  const m = buildTimesheetMatrix({ month: '2026-10', today: '2026-10-08', contracts, timesheets: ts })

  it('one row per contract overlapping the month; inactive contracts without timesheets are skipped', () => {
    expect(m.days).toHaveLength(31)
    expect(m.rows.map((r) => r.contract.label)).toEqual(['EX-01', 'EX-02'])
  })
  it('cell states: filled / breakdown (orange) / missing (red, ≤ today, in period) / off / future; HM gap flag', () => {
    const ex1 = m.rows[0]!
    const ex2 = m.rows[1]!
    const at = (r: typeof ex1, d: string) => r.cells.find((c) => c.date === d)!
    expect(at(ex1, '2026-10-01').state).toBe('filled')
    expect(at(ex1, '2026-10-03').state).toBe('filled') // legacy row
    expect(at(ex1, '2026-10-04').state).toBe('missing')
    expect(at(ex1, '2026-10-09').state).toBe('future')
    expect(at(ex2, '2026-10-04').state).toBe('off') // before the contract start
    expect(at(ex2, '2026-10-06').state).toBe('breakdown')
    expect(at(ex2, '2026-10-07')).toMatchObject({ state: 'filled', hmGap: true })
    expect(at(ex2, '2026-10-08').state).toBe('missing')
  })
  it('row and total sums', () => {
    expect(m.rows[0]).toMatchObject({ work: 23.5, standby: 1, filled: 3, missing: 5 }) // 4..8 missing
    expect(m.rows[1]).toMatchObject({ work: 8, breakdown: 6, filled: 2, missing: 2, gaps: 1 }) // 5 and 8 missing
    expect(m.totals).toMatchObject({ work: 31.5, filled: 5, missing: 7, gaps: 1 })
  })
  it('accessible cell text', () => {
    const c = m.rows[1]!.cells.find((x) => x.date === '2026-10-06')!
    expect(cellText(c, 'EX-02')).toBe('EX-02, Selasa, 6 Okt 2026: 2 jam kerja, breakdown 6 jam')
    expect(cellText(m.rows[0]!.cells.find((x) => x.date === '2026-10-04')!, 'EX-01')).toMatch(/belum diisi$/)
  })
})

describe('monthly recap + billing ESTIMATE labelling (rate roles only)', () => {
  // UAT FR1-1: EX-01 per jam Rp 350.000, minimum 200 jam; 3 days 8 + 7 + 8 = 23 h → estimate = 200 × rate
  const contracts = [C(1, 11, 'EX-01', '2026-09-01'), C(2, 21, 'DZ-01', '2026-10-23')]
  const ts = [T(11, 1, '2026-10-01', 8, { hmStart: 1000, hmEnd: 1008 }), T(11, 1, '2026-10-02', 7, { hmStart: 1008, hmEnd: 1015, standbyHours: 1 }), T(11, 1, '2026-10-03', 8, { hmStart: 1015, hmEnd: 1023, breakdownHours: 1 })]
  const m = buildTimesheetMatrix({ month: '2026-10', today: '2026-10-31', contracts, timesheets: ts })
  const terms = new Map([
    [1, { rateBasis: 'per_jam' as const, rate: 350_000, minHoursPerMonth: 200 }],
    [2, { rateBasis: 'per_bulan' as const, rate: 95_000_000, minHoursPerMonth: null }],
  ])

  it('per jam with the monthly minimum; per bulan prorated by contract days (mockup: 9 of 31 days)', () => {
    const r = buildRecap(m, terms)
    const ex = r.rows[0]!
    expect(ex).toMatchObject({ hmStart: 1000, hmEnd: 1023, work: 23, standby: 1, breakdown: 1, availability: 96 })
    expect(ex.estimate?.amount).toBe(70_000_000)
    expect(ex.rateText).toBe('Rp 350.000/jam · min 200 jam')
    expect(ex.estimateNote).toMatch(/Minimum 200 jam berlaku/)
    const dz = r.rows[1]!
    expect(dz.estimate?.amount).toBe(27_580_645)
    expect(dz.rateText).toBe('Rp 95.000.000/bulan')
    expect(dz.estimateNote).toBe('Per bulan = prorata 9 dari 31 hari.')
    expect(dz.missing).toBe(9) // 23..31 without timesheets
    expect(r.totals.estimate).toBe(97_580_645)
  })
  it('without rates (Staff/PM): no estimate, no rate text, total estimate null → no "Rp" column at all', () => {
    const r = buildRecap(m, new Map())
    expect(r.rows.every((x) => x.estimate === null && x.rateText === null && x.estimateNote === null)).toBe(true)
    expect(r.totals.estimate).toBeNull()
  })
  it('labels: estimate is never an invoice; notes only when the amount is not rate × hours', () => {
    expect(ESTIMATE_LABEL).toBe('Estimasi — bukan invoice')
    const full = billingEstimate({ rateBasis: 'per_jam', rate: 100, minHoursPerMonth: 10, startDate: '2026-10-01' }, '2026-10', 50)
    expect(estimateNote(full, 50)).toBeNull()
    expect(rateText({ rateBasis: 'per_jam', rate: 1000, minHoursPerMonth: null })).toBe('Rp 1.000/jam')
    expect(rateText({ rateBasis: 'per_jam', rate: null, minHoursPerMonth: 200 })).toBeNull()
  })
})

describe('aftersales weekly recap + follow-ups', () => {
  const client = (id: number, name: string) => ({ id, name })
  const acts = [
    { id: 1, activityDate: '2026-10-09', kind: 'po_masuk' as const, client: client(1, 'PT Sumber Tambang'), docNo: 'PO-0912', poStatus: 'belum_kirim' as const, value: 4_250_000, valueVisible: true, followUpDate: null },
    { id: 2, activityDate: '2026-10-06', kind: 'po_masuk' as const, client: client(2, 'CV Maju Jaya'), docNo: 'PO-0907', poStatus: 'terkirim' as const, value: 3_100_000, valueVisible: true, followUpDate: null },
    { id: 3, activityDate: '2026-10-09', kind: 'pengiriman' as const, client: client(2, 'CV Maju Jaya'), docNo: 'SJ-0441', poStatus: null, value: null, valueVisible: true, followUpDate: null },
    { id: 4, activityDate: '2026-10-09', kind: 'penawaran' as const, client: client(3, 'PT Kalteng Coal'), docNo: 'Q-0388', poStatus: null, value: 9_000_000, valueVisible: true, followUpDate: '2026-10-14' },
    { id: 5, activityDate: '2026-10-07', kind: 'po_masuk' as const, client: client(1, 'PT Sumber Tambang'), docNo: 'PO-0910', poStatus: 'batal' as const, value: 1_000, valueVisible: true, followUpDate: null },
  ]
  it('per client: PO in / delivered / still open; value of non-cancelled POs only', () => {
    const w = aftersalesWeek(acts)
    expect(w.kpi).toEqual({ po: 3, terkirim: 1, belum: 1, value: 7_350_000 })
    expect(w.clients.map((c) => c.name)).toEqual(['CV Maju Jaya', 'PT Kalteng Coal', 'PT Sumber Tambang'])
    expect(w.clients[0]).toMatchObject({ po: 1, terkirim: 1, pengiriman: 1, value: 3_100_000 })
    expect(w.clients[1]).toMatchObject({ penawaran: 1, po: 0, value: null }) // a quotation value is not a PO value
  })
  it('hidden values (Staff/PM) → no value anywhere', () => {
    const w = aftersalesWeek(acts.map((a) => ({ ...a, value: null, valueVisible: false })))
    expect(w.kpi.value).toBeNull()
    expect(w.clients.every((c) => c.value === null)).toBe(true)
  })
  it('"Perlu ditindaklanjuti": open POs oldest first (≥ 7 days red), then due follow-ups (overdue/today amber)', () => {
    const todo = followUpTodo(
      [
        { id: 10, docNo: 'PO-0912', client: client(1, 'PT Sumber Tambang'), activityDate: '2026-10-09', poStatus: 'belum_kirim', ageDays: 0, items: [{ name: 'Filter oli', qty: 6, uom: 'PCS' }] },
        { id: 11, docNo: 'PO-0870', client: client(1, 'PT Sumber Tambang'), activityDate: '2026-09-27', poStatus: 'sebagian', ageDays: 12, items: [] },
      ],
      [
        { id: 20, docNo: 'Q-0388', client: client(3, 'PT Kalteng Coal'), followUpDate: '2026-10-14', items: [] },
        { id: 21, docNo: 'Q-0380', client: client(3, 'PT Kalteng Coal'), followUpDate: '2026-10-08', items: [] },
      ],
      '2026-10-09',
    )
    expect(todo.map((t) => t.id)).toEqual([11, 10, 21, 20])
    expect(todo[0]).toMatchObject({ tone: 'bad', detail: 'Terkirim sebagian 12 hari' })
    expect(todo[1]).toMatchObject({ tone: 'muted', detail: 'Belum kirim 0 hari · Filter oli 6 PCS' })
    expect(todo[2]).toMatchObject({ tone: 'warn', detail: 'Follow-up penawaran lewat 1 hari' })
    expect(todo[3]!.detail).toBe('Follow-up penawaran Rab 14 (5 hari lagi)')
  })
})

describe('project timeline (merged by date)', () => {
  const contracts = [C(1, 11, 'EX-01', '2026-09-01'), C(2, 12, 'EX-02', '2026-09-01'), C(3, 13, 'DZ-01', '2026-09-01')]
  const tsl = (unitId: number, label: string, d: string, work: number, flags: string[] = []): TimelineTimesheet => ({ id: ++tsId, reportDate: d, unitId, contractUnitId: null, unitLabel: label, workHours: work, breakdownHours: 0, hmStart: 1, hmEnd: 1 + work, flags })
  const input = {
    from: '2026-10-06',
    to: '2026-10-09',
    today: '2026-10-09',
    contracts,
    services: [{ id: 7, docNo: 'SV/2610/0007', reportDate: '2026-10-09', unitLabel: 'EX-01', serviceTypeLabel: 'Perbaikan', statusLabel: 'Menunggu part', statusOk: false, action: 'Ganti seal kit silinder boom', hourMeter: 1025, spareparts: 2, photos: 3, reporter: 'Agus', corrected: false }],
    timesheets: [tsl(11, 'EX-01', '2026-10-09', 8), tsl(13, 'DZ-01', '2026-10-09', 7), tsl(11, 'EX-01', '2026-10-08', 8), tsl(12, 'EX-02', '2026-10-08', 8), tsl(13, 'DZ-01', '2026-10-08', 8), tsl(12, 'EX-02', '2026-10-06', 8, ['HM_GAP'])],
    activities: [],
    hrefs: { service: (id: number) => `/sv/${id}`, activity: (id: number) => `/as/${id}`, timesheetDay: (d: string) => `/ts#${d}` },
  }
  it('kontrak_unit: day summaries "n dari m unit diisi" with the missing units, HM gap, and service entries first', () => {
    const g = mergeTimeline({ ...input, types: ['timesheet', 'servis'] })
    expect(g.map((x) => x.date)).toEqual(['2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06'])
    const d9 = g[0]!.entries
    expect(d9.map((e) => e.type)).toEqual(['servis', 'timesheet'])
    expect(d9[0]).toMatchObject({ title: 'SV/2610/0007 · EX-01 Perbaikan · Menunggu part', href: '/sv/7', tone: 'warn' })
    expect(d9[0]!.detail).toBe('Ganti seal kit silinder boom · HM 1.025 · 2 sparepart · 3 foto · Agus')
    expect(d9[1]).toMatchObject({ title: '2 dari 3 unit diisi', alert: 'EX-02 belum diisi', tone: 'bad', detail: 'DZ-01 7 jam · EX-01 8 jam' })
    expect(g[1]!.entries[0]).toMatchObject({ title: '3 dari 3 unit diisi', alert: undefined, tone: undefined })
    expect(g[2]!.entries[0]).toMatchObject({ title: '0 dari 3 unit diisi' }) // nothing reported that day
    expect(g[3]!.entries[0]).toMatchObject({ title: '1 dari 3 unit diisi · ⚠ selisih HM' })
  })
  it('type filter + P3 hook (extra entries of type harian only when asked)', () => {
    const extra = [{ key: 'lh-1', type: 'harian' as const, date: '2026-10-07', title: 'LH/2610/0001', detail: '', href: '/lh/1' }]
    expect(mergeTimeline({ ...input, types: ['servis'], extra }).flatMap((x) => x.entries.map((e) => e.type))).toEqual(['servis'])
    expect(mergeTimeline({ ...input, types: ['harian'], extra })).toEqual([{ date: '2026-10-07', entries: [extra[0]] }])
  })
  it('kinds → timeline types; window defaults to 30 days, capped at 92', () => {
    expect(timelineTypesFor('kontrak_unit')).toEqual(['timesheet', 'servis'])
    expect(timelineTypesFor('aftersales')).toEqual(['servis', 'aktivitas'])
    expect(timelineTypesFor('trading')).toEqual([])
    expect(timelineWindow(undefined, undefined, '2026-10-09')).toEqual({ from: '2026-09-10', to: '2026-10-09' })
    expect(timelineWindow('2026-01-01', '2026-10-09', '2026-10-09')).toEqual({ from: '2026-07-10', to: '2026-10-09' })
    expect(timelineWindow('2026-10-01', '2026-12-01', '2026-10-09').to).toBe('2026-10-09')
  })
})

describe('timesheet form live hours check', () => {
  it('Σ ≤ 24 with shares of the 24 h bar', () => {
    expect(hoursCheck(8, 1.5, 0)).toEqual({ total: 9.5, over: false, shares: { work: (8 / 24) * 100, standby: (1.5 / 24) * 100, breakdown: 0 } })
    expect(hoursCheck(20, 4, 0.5).over).toBe(true)
    expect(hoursCheck(null, null, null).total).toBe(0)
  })
})
