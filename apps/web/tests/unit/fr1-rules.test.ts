import { describe, expect, it } from 'vitest'

import { ServiceReportCreate, SparepartLines, UnitTimesheetCreate } from '@/api/v1/schemas-field'
import { SyncItem } from '@/api/v1/schemas-sync'
import {
  activityErrors,
  availabilityPct,
  billingEstimate,
  contractDaysInMonth,
  hmDecreased,
  hmGap,
  kindAllows,
  kindOf,
  normalizeUnitCode,
  poAgeDays,
  poStatusAfterDelivery,
  poStatusCorrection,
  reportDateError,
  reportTypesFor,
  serviceTimeError,
  timesheetErrors,
  unitClientMismatch,
  unitErrors,
  unitLabel,
} from '@/domain/field/rules'
import { weekStart } from '@/domain/reports/field-reports'
import { reminderSettingsOf } from '@/domain/reminders/rules'

/** FR1 (ADR 0020) pure rules: project kinds, unit master, HM, hours, billing estimate, availability, PO status. */
describe('FR1 project kinds → report types (ADR 0020 §1)', () => {
  it('kontrak_unit → timesheet + servis; aftersales → servis + aktivitas; konstruksi → laporan harian (P3); others none', () => {
    expect(reportTypesFor('kontrak_unit')).toEqual(['unit_timesheet', 'service_report'])
    expect(reportTypesFor('aftersales')).toEqual(['service_report', 'aftersales_activity'])
    expect(reportTypesFor('konstruksi')).toEqual(['daily_report'])
    for (const k of ['umum', 'trading']) expect(reportTypesFor(k), k).toEqual([])
    expect(kindAllows('aftersales', 'unit_timesheet')).toBe(false)
    expect(kindAllows('kontrak_unit', 'aftersales_activity')).toBe(false)
    expect(kindOf(null)).toBe('umum')
    expect(kindOf('bogus')).toBe('umum')
  })
})

describe('FR1 unit master (Unit & Kendaraan)', () => {
  it('vehicle needs a plate, heavy equipment a unit code; customer unit needs a customer', () => {
    expect(unitErrors({ kind: 'kendaraan', plateNo: 'DA1234XY' })).toEqual([])
    expect(unitErrors({ kind: 'kendaraan' }).map((e) => e.path)).toEqual(['plateNo'])
    expect(unitErrors({ kind: 'alat_berat', unitCode: 'EX-01' })).toEqual([])
    expect(unitErrors({ kind: 'alat_berat', plateNo: 'DA1234XY' }).map((e) => e.path)).toEqual(['unitCode'])
    expect(unitErrors({ kind: 'alat_berat', unitCode: 'ex 01' }).map((e) => e.path)).toEqual(['unitCode'])
    expect(unitErrors({ kind: 'alat_berat', unitCode: 'EX-01', owner: 'pelanggan' }).map((e) => e.path)).toEqual(['client'])
    expect(unitErrors({ kind: 'alat_berat', unitCode: 'EX-01', owner: 'pelanggan', client: 7 })).toEqual([])
    expect(unitErrors({ kind: 'kapal', plateNo: 'X' }).map((e) => e.path)).toContain('kind')
    expect(normalizeUnitCode(' ex 01 ')).toBe('EX-01')
    expect(unitLabel({ unitCode: 'EX-01', plateDisplay: 'DA 1 X' })).toBe('EX-01 · DA 1 X')
    expect(unitLabel({ unitCode: null, plateDisplay: null, type: 'Excavator' })).toBe('Excavator')
  })

  it('customer unit vs project client: mismatch only for a customer unit on a project WITH a client', () => {
    expect(unitClientMismatch({ owner: 'pelanggan', client: 3 }, 4)).toBe(true)
    expect(unitClientMismatch({ owner: 'pelanggan', client: 3 }, 3)).toBe(false)
    expect(unitClientMismatch({ owner: 'pelanggan', client: 3 }, null)).toBe(false)
    expect(unitClientMismatch({ owner: 'sendiri', client: null }, 4)).toBe(false)
  })
})

describe('FR1 hour meter + timesheet hours', () => {
  it('HM may not decrease (2-decimal tolerance); HM_GAP when start ≠ previous end', () => {
    expect(hmDecreased(1022.99, 1023)).toBe(true)
    expect(hmDecreased(1023, 1023)).toBe(false)
    expect(hmDecreased(1023.004, 1023.008)).toBe(false)
    expect(hmDecreased(5, null)).toBe(false)
    expect(hmGap(1020, 1023)).toBe(true) // UAT step 2
    expect(hmGap(1025, 1023)).toBe(true)
    expect(hmGap(1023, 1023)).toBe(false)
    expect(hmGap(1023, null)).toBe(false)
  })

  it('HM end ≥ start, hours ≥ 0 and Σ ≤ 24, breakdown needs a reason, ≤ 2 decimals', () => {
    expect(timesheetErrors({ hmStart: 1000, hmEnd: 1008, workHours: 8, standbyHours: 2, breakdownHours: 0 })).toEqual([])
    expect(timesheetErrors({ hmStart: 1008, hmEnd: 1000, workHours: 8 }).map((e) => e.path)).toEqual(['hmEnd'])
    expect(timesheetErrors({ hmStart: 0, hmEnd: 1, workHours: 20, standbyHours: 4, breakdownHours: 0.5, breakdownReason: 'x' }).map((e) => e.path)).toEqual(['workHours'])
    expect(timesheetErrors({ hmStart: 0, hmEnd: 1, workHours: 12, standbyHours: 12, breakdownHours: 0 })).toEqual([])
    expect(timesheetErrors({ hmStart: 0, hmEnd: 1, workHours: 4, breakdownHours: 2 }).map((e) => e.path)).toEqual(['breakdownReason'])
    expect(timesheetErrors({ hmStart: 0, hmEnd: 1, workHours: 4, breakdownHours: 2, breakdownReason: 'hidrolik bocor' })).toEqual([])
    expect(timesheetErrors({ hmStart: 0.001, hmEnd: 1, workHours: -1 }).map((e) => e.path).sort()).toEqual(['hmStart', 'workHours'])
    expect(timesheetErrors({ hmStart: 0, hmEnd: 1, workHours: 1, fuelLiters: -2 }).map((e) => e.path)).toEqual(['fuelLiters'])
  })

  it('service visit times and report dates', () => {
    expect(serviceTimeError('08:00', '10:30')).toBeNull()
    expect(serviceTimeError('10:30', '08:00')?.path).toBe('endTime')
    expect(serviceTimeError('8:00', null)?.path).toBe('startTime')
    expect(reportDateError('2026-10-10', '2026-10-10')).toBeNull()
    expect(reportDateError('2026-10-11', '2026-10-10')).toMatch(/masa depan/)
    expect(reportDateError('2026-09-25', '2026-10-10')).toMatch(/14 hari/)
    expect(reportDateError('2026-09-26', '2026-10-10')).toBeNull()
    expect(reportDateError('2026-02-30', '2026-10-10')).toMatch(/YYYY-MM-DD/)
  })
})

describe('FR1 billing estimate (NOT an invoice) + availability', () => {
  const perJam = { rateBasis: 'per_jam' as const, rate: 350_000, minHoursPerMonth: 200, startDate: '2026-09-01', endDate: null }

  it('per_jam full month: rate × max(work hours, minimum) — UAT step 1 (23 h → 200 h minimum)', () => {
    const e = billingEstimate(perJam, '2026-10', 23)
    expect(e).toMatchObject({ basis: 'per_jam', billableHours: 200, minHours: 200, contractDays: 31, monthDays: 31, amount: 70_000_000 })
    expect(billingEstimate(perJam, '2026-10', 250.5).amount).toBe(Math.round(350_000 * 250.5))
  })

  it('per_jam partial month: the minimum is prorated by the contract days', () => {
    const e = billingEstimate({ ...perJam, startDate: '2026-10-17' }, '2026-10', 10) // 15 of 31 days
    expect(e.contractDays).toBe(15)
    expect(e.minHours).toBe(96.77)
    expect(e.amount).toBe(Math.round(350_000 * 96.77))
  })

  it('per_bulan prorated by contract days; no overlap → 0', () => {
    const pb = { rateBasis: 'per_bulan' as const, rate: 31_000_000, startDate: '2026-10-11', endDate: '2026-12-31' }
    expect(billingEstimate(pb, '2026-10', 0)).toMatchObject({ contractDays: 21, monthDays: 31, amount: 21_000_000, billableHours: null })
    expect(billingEstimate(pb, '2026-11', 0).amount).toBe(31_000_000)
    expect(billingEstimate(pb, '2026-09', 99).amount).toBe(0)
    expect(billingEstimate({ ...pb, endDate: '2026-10-15' }, '2026-10', 0).amount).toBe(5_000_000)
  })

  it('contract days of a month: start/end inclusive, leap February', () => {
    expect(contractDaysInMonth({ startDate: '2028-01-15', endDate: null }, '2028-02')).toMatchObject({ contractDays: 29, monthDays: 29, from: '2028-02-01', to: '2028-02-29' })
    expect(contractDaysInMonth({ startDate: '2026-10-05', endDate: '2026-10-05' }, '2026-10').contractDays).toBe(1)
    expect(contractDaysInMonth({ startDate: '2026-11-01', endDate: null }, '2026-10').contractDays).toBe(0)
  })

  it('availability = (work + standby) / (work + standby + breakdown)', () => {
    expect(availabilityPct(8, 2, 0)).toBe(100)
    expect(availabilityPct(6, 0, 2)).toBe(75)
    expect(availabilityPct(5, 1, 3)).toBe(66.7)
    expect(availabilityPct(0, 0, 0)).toBeNull()
  })
})

describe('FR1 aftersales: PO status + activity fields', () => {
  it('a delivery moves an open PO to sebagian / terkirim; a closed PO refuses', () => {
    expect(poStatusAfterDelivery('belum_kirim', false)).toEqual({ ok: true, status: 'sebagian' })
    expect(poStatusAfterDelivery('sebagian', true)).toEqual({ ok: true, status: 'terkirim' })
    expect(poStatusAfterDelivery(null, true)).toEqual({ ok: true, status: 'terkirim' })
    expect(poStatusAfterDelivery('terkirim', false).ok).toBe(false)
    expect(poStatusAfterDelivery('batal', true).ok).toBe(false)
    expect(poStatusCorrection('belum_kirim', 'batal')).toEqual({ ok: true, status: 'batal' })
    expect(poStatusCorrection('batal', 'belum_kirim').ok).toBe(false)
    expect(poAgeDays('2026-10-01', '2026-10-10')).toBe(9)
    expect(poAgeDays('2026-10-11', '2026-10-10')).toBe(0)
  })

  it('kind-specific fields', () => {
    expect(activityErrors({ kind: 'pengiriman', relatesTo: 5, poDelivered: true })).toEqual([])
    expect(activityErrors({ kind: 'pengiriman' }).map((e) => e.path)).toEqual(['relatesTo'])
    expect(activityErrors({ kind: 'penagihan' })).toEqual([])
    expect(activityErrors({ kind: 'kunjungan', relatesTo: 5 }).map((e) => e.path)).toEqual(['relatesTo'])
    expect(activityErrors({ kind: 'po_masuk', poDelivered: true }).map((e) => e.path)).toEqual(['poDelivered'])
    expect(activityErrors({ kind: 'penawaran', followUpDate: '2026-10-20' })).toEqual([])
    expect(activityErrors({ kind: 'po_masuk', followUpDate: '2026-10-20' }).map((e) => e.path)).toEqual(['followUpDate'])
    expect(activityErrors({ kind: 'po_masuk', value: 1.5 }).map((e) => e.path)).toEqual(['value'])
  })

  it('weekly recap starts on Monday', () => {
    expect(weekStart('2026-10-10')).toBe('2026-10-05') // Saturday → Monday
    expect(weekStart('2026-10-05')).toBe('2026-10-05')
    expect(weekStart('2026-10-11')).toBe('2026-10-05') // Sunday belongs to the week that started Monday
  })
})

describe('FR1 API / sync contract', () => {
  it('spare parts are validated text lines (no stock); timesheet needs exactly one HM photo', () => {
    expect(SparepartLines.safeParse([{ name: 'Filter oli', partNo: '600-211', qty: 2, uom: 'PCS' }]).success).toBe(true)
    expect(SparepartLines.safeParse([{ name: '', qty: 1 }]).success).toBe(false)
    expect(SparepartLines.safeParse([{ name: 'Seal', qty: 0 }]).success).toBe(false)
    expect(SparepartLines.safeParse([{ name: 'Seal', qty: 1, stock: 4 }]).success).toBe(false)
    const ts = { projectId: 1, unitId: 2, reportDate: '2026-10-10', hmStart: 1000, hmEnd: 1008, workHours: 8 }
    expect(UnitTimesheetCreate.safeParse(ts).success).toBe(false)
    expect(UnitTimesheetCreate.safeParse({ ...ts, hmPhotoId: 9 }).success).toBe(true)
    expect(ServiceReportCreate.safeParse({ projectId: 1, unitId: 2, serviceType: 'perbaikan', action: 'Ganti seal', unitStatusAfter: 'menunggu_part', photoIds: Array.from({ length: 11 }, (_, i) => i + 1) }).success).toBe(false)
  })

  it('new sync item types are accepted by the envelope', () => {
    const base = { client_uuid: '0192f0c4-7b1a-7c3e-8f00-000000000001', schema_version: 1, offline: true, device_time: '2026-10-10T08:00:00+08:00', elapsed_ms: 1, company_id: 1 }
    for (const type of ['service_report.upsert', 'unit_timesheet.upsert', 'aftersales_activity.upsert']) {
      expect(SyncItem.safeParse({ ...base, type, payload: { project_id: 1 } }).success, type).toBe(true)
    }
  })

  it('the aftersales follow-up reminder runs only where field reports are on', () => {
    expect(reminderSettingsOf({}, 'Asia/Makassar').aftersalesFollowup.enabled).toBe(false)
    expect(reminderSettingsOf({ fieldReportsEnabled: true }, 'Asia/Makassar').aftersalesFollowup.enabled).toBe(true)
  })
})
