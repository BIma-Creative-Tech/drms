import { describe, expect, it } from 'vitest'

import { SyncUnitTimesheetPayload } from '@/api/v1/schemas-sync'
import { migrations } from '@/migrations'
import { ContractUnitList, UnitTimesheetCorrection, UnitTimesheetUpdate } from '@/api/v1/schemas-field'
import { BACKDATE_MAX_DAYS, hasHm, hmGap, reportDateError, timesheetErrors, timesheetMinDate } from '@/domain/field/rules'
import { buildRecap, buildTimesheetMatrix, cellText, hmWeeks, weekLabel, weeklyHm, type MatrixContract, type MatrixTimesheet } from '@/domain/field/views'

/**
 * D2410 (user 2026-10-24, ADR 0020 amendment 2026-10-24) pure rules of the timesheet feedback:
 * 1. backdate — reporters 14 days; the PM of the project / the Direktur any past date inside the contract period
 *    (`reportDateError` option, `timesheetMinDate`, matrix `fillable`);
 * 2. weekly HM — HM start/end optional but both or none, HM_GAP only with HM, weekly HM summary (Mon–Sun weeks
 *    overlapping the month), null-safe monthly recap; old clients (always HM) unchanged.
 */
const C = (id: number, unitId: number, label: string, startDate: string, endDate: string | null = null): MatrixContract => ({ id, unitId, label, type: 'Excavator', startDate, endDate, active: true })
let seq = 0
const T = (unitId: number, reportDate: string, hm: [number, number] | null, work = 8): MatrixTimesheet => ({
  id: ++seq,
  unitId,
  contractUnitId: null,
  reportDate,
  hmStart: hm ? hm[0] : null,
  hmEnd: hm ? hm[1] : null,
  workHours: work,
  standbyHours: 0,
  breakdownHours: 0,
  flags: [],
})

describe('D2410 migration wiring', () => {
  it('20261024_100000_d2410_timesheet_hm_optional runs after the 0.19.1 migrations, once', () => {
    const names = migrations.map((m) => m.name)
    expect(names.filter((n) => n === '20261024_100000_d2410_timesheet_hm_optional')).toHaveLength(1)
    expect(names.indexOf('20261024_100000_d2410_timesheet_hm_optional')).toBeGreaterThan(names.indexOf('20261022_100000_d2210_pb_fund'))
  })
})

describe('D2410 backdate window', () => {
  it('reporters keep 14 days; PM / Direktur any past date, never the future', () => {
    expect(BACKDATE_MAX_DAYS).toBe(14)
    expect(reportDateError('2026-09-01', '2026-10-24')).toMatch(/14 hari ke belakang; tanggal yang lebih lama hanya dapat diisi PM project atau Direktur/)
    expect(reportDateError('2026-09-01', '2026-10-24', { unlimitedBackdate: true })).toBeNull()
    expect(reportDateError('2026-10-25', '2026-10-24', { unlimitedBackdate: true })).toMatch(/masa depan/)
    expect(reportDateError('2026-02-30', '2026-10-24', { unlimitedBackdate: true })).toMatch(/YYYY-MM-DD/)
  })
  it('timesheetMinDate: today − 14 for reporters, the earliest contract start for PM / Direktur', () => {
    expect(timesheetMinDate('2026-10-24', false, ['2026-08-01'])).toBe('2026-10-10')
    expect(timesheetMinDate('2026-10-24', true, ['2026-09-15', '2026-08-01'])).toBe('2026-08-01')
    expect(timesheetMinDate('2026-10-24', true, [])).toBe('2026-10-24')
    expect(timesheetMinDate('2026-10-24', true, ['2026-11-01'])).toBe('2026-10-24')
  })
  it('matrix: older missing days stay "missing" (red) but only days ≥ minDate are fillable ("+")', () => {
    const m = buildTimesheetMatrix({ month: '2026-10', today: '2026-10-24', contracts: [C(1, 11, 'EX-01', '2026-09-01')], timesheets: [], minDate: '2026-10-10' })
    const cell = (d: string) => m.rows[0]!.cells.find((c) => c.date === d)!
    expect(cell('2026-10-09')).toMatchObject({ state: 'missing', fillable: false })
    expect(cell('2026-10-10')).toMatchObject({ state: 'missing', fillable: true })
    expect(cell('2026-10-25')).toMatchObject({ state: 'future', fillable: false })
    expect(m.totals.missing).toBe(24)
    expect(cellText(cell('2026-10-09'), 'EX-01')).toMatch(/belum diisi — tanggal laporan paling lama 14 hari ke belakang; tanggal yang lebih lama hanya dapat diisi PM project atau Direktur$/)
    expect(cellText(cell('2026-10-10'), 'EX-01')).toMatch(/belum diisi$/)
    // PM / Direktur: minDate = contract start → every missing day fillable
    const pm = buildTimesheetMatrix({ month: '2026-10', today: '2026-10-24', contracts: [C(1, 11, 'EX-01', '2026-09-01')], timesheets: [], minDate: '2026-09-01' })
    expect(pm.rows[0]!.cells.filter((c) => c.state === 'missing').every((c) => c.fillable)).toBe(true)
  })
})

describe('D2410 weekly HM: optional pair, photo rule, HM_GAP', () => {
  it('HM optional, both or none, end ≥ start, ≥ 0, 2 decimals; work hours stay required', () => {
    expect(timesheetErrors({ workHours: 8 })).toEqual([])
    expect(timesheetErrors({ hmStart: null, hmEnd: null, workHours: 8 })).toEqual([])
    expect(timesheetErrors({ hmStart: 1000, hmEnd: 1008, workHours: 8 })).toEqual([])
    expect(timesheetErrors({ hmStart: 1000, workHours: 8 }).map((e) => e.path)).toEqual(['hmEnd'])
    expect(timesheetErrors({ hmEnd: 1008, workHours: 8 }).map((e) => e.path)).toEqual(['hmStart'])
    expect(timesheetErrors({ hmStart: 1008, hmEnd: 1000, workHours: 8 }).map((e) => e.path)).toEqual(['hmEnd'])
    expect(timesheetErrors({ hmStart: -1, hmEnd: 2, workHours: 8 }).map((e) => e.path)).toEqual(['hmStart'])
    expect(timesheetErrors({ hmStart: 1, hmEnd: 2.005, workHours: 8 }).map((e) => e.path)).toEqual(['hmEnd'])
    expect(timesheetErrors({ workHours: 25 }).map((e) => e.path)).toEqual(['workHours'])
    expect(hasHm({ hmStart: 1, hmEnd: 2 })).toBe(true)
    expect(hasHm({ hmStart: 1, hmEnd: null })).toBe(false)
    expect(hasHm({})).toBe(false)
  })
  it('HM_GAP only when both the start and a previous end WITH HM exist', () => {
    expect(hmGap(null, 1000)).toBe(false)
    expect(hmGap(1050, null)).toBe(false)
    expect(hmGap(1050, 1008)).toBe(true)
    expect(hmGap(1008, 1008)).toBe(false)
  })
  it('API / sync contract: HM nullable; old clients (always HM + photo) still valid; edit may clear or add the photo', () => {
    expect(UnitTimesheetUpdate.safeParse({ hmStart: null, hmEnd: null }).success).toBe(true)
    expect(UnitTimesheetUpdate.safeParse({ hmStart: 1000, hmEnd: 1008, hmPhotoId: 5 }).success).toBe(true)
    expect(UnitTimesheetCorrection.safeParse({ hmStart: null, hmEnd: null, reason: 'HM salah ketik' }).success).toBe(true)
    expect(SyncUnitTimesheetPayload.safeParse({ project_id: 1, unit_id: 2, report_date: '2026-10-24', work_hours: 8 }).success).toBe(true)
    expect(SyncUnitTimesheetPayload.safeParse({ project_id: 1, unit_id: 2, report_date: '2026-10-24', hm_start: null, hm_end: null, hm_photo_media_id: null, work_hours: 8 }).success).toBe(true)
    expect(SyncUnitTimesheetPayload.safeParse({ project_id: 1, unit_id: 2, report_date: '2026-10-24', hm_start: 1000, hm_end: 1008, work_hours: 8, hm_photo_media_id: 3 }).success).toBe(true)
    expect(ContractUnitList.safeParse({ projectId: 1, items: [], timesheetMinDate: '2026-10-10' }).success).toBe(true)
  })
})

describe('D2410 weekly HM summary + null-safe monthly recap', () => {
  it('weeks Monday–Sunday overlapping the month, labelled with dates', () => {
    const w = hmWeeks('2026-10')
    expect(w.map((x) => x.from)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(w[0]).toMatchObject({ to: '2026-10-04', label: '28 Sep – 4 Okt 2026' })
    expect(w[1]!.label).toBe('5–11 Okt 2026')
    expect(weekLabel('2026-12-28', '2027-01-03')).toBe('28 Des 2026 – 3 Jan 2027')
    expect(hmWeeks('2026-06').length).toBe(5) // 1 Jun 2026 = Monday
  })
  it('HM awal = first recorded start, HM akhir = last recorded end, total = akhir − awal, days with HM; days without HM skipped', () => {
    const ts = [T(11, '2026-10-05', [1000, 1008]), T(11, '2026-10-06', null), T(11, '2026-10-09', [1040, 1050]), T(11, '2026-10-12', null), T(11, '2026-09-29', [900, 905])]
    const w = weeklyHm(ts, '2026-10')
    expect(w[0]).toMatchObject({ from: '2026-09-28', hmStart: 900, hmEnd: 905, total: 5, days: 1 })
    expect(w[1]).toMatchObject({ from: '2026-10-05', hmStart: 1000, hmEnd: 1050, total: 50, days: 2 })
    expect(w[2]).toMatchObject({ from: '2026-10-12', hmStart: null, hmEnd: null, total: null, days: 0 })
  })
  it('monthly recap HM = first / last RECORDED reading (null-safe); hours unaffected', () => {
    const m = buildTimesheetMatrix({ month: '2026-10', today: '2026-10-31', contracts: [C(1, 11, 'EX-01', '2026-09-01'), C(2, 12, 'EX-02', '2026-09-01')], timesheets: [T(11, '2026-10-01', null), T(11, '2026-10-02', [1008, 1015]), T(11, '2026-10-03', null), T(12, '2026-10-01', null, 5)] })
    const r = buildRecap(m, new Map())
    expect(r.rows[0]).toMatchObject({ hmStart: 1008, hmEnd: 1015, work: 24 })
    expect(r.rows[1]).toMatchObject({ hmStart: null, hmEnd: null, work: 5 })
  })
})
