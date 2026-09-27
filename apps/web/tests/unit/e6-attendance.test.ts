import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from '@/api/v1/openapi'
import { AttendanceCorrectBody } from '@/api/v1/schemas-attendance'
import { SyncAttendancePayload, SyncBatch, SyncOnBehalfPayload } from '@/api/v1/schemas-sync'
import { recapRange, teamToday, type AttendanceFact, type LocationRef } from '@/domain/attendance/aggregate'
import {
  dayKind,
  evaluateDay,
  isoWeekday,
  localHHMM,
  parseSnapshot,
  presenceStatus,
  retentionCutoff,
  snapshotOf,
  type ScheduleSnapshot,
} from '@/domain/attendance/schedule'
import { attendanceReportScope } from '@/domain/reports/attendance-report'

/**
 * E6 pure parts: lateness table (schedule + holiday + timezone), monthly recap numbers, team today,
 * selfie retention cutoff, sync/correct contracts. Dates/names are fictional.
 */
const WITA = 'Asia/Makassar' // UTC+8
const Q30: ScheduleSnapshot = { id: 1, name: 'Kantor', start: '08:00', end: '17:00', toleranceMin: 15, workDays: [1, 2, 3, 4, 5, 6] }
/** Local WITA wall clock → Date. */
const at = (date: string, hhmmss: string) => new Date(`${date}T${hhmmss}+08:00`)

describe('schedule snapshot (Q-30 defaults)', () => {
  it('work schedule document → snapshot; missing workDays group = Senin–Sabtu; inactive/malformed → null', () => {
    expect(snapshotOf({ id: 3, name: 'A', startTime: '08:00', endTime: '17:00', lateToleranceMin: 10 })).toEqual({
      id: 3,
      name: 'A',
      start: '08:00',
      end: '17:00',
      toleranceMin: 10,
      workDays: [1, 2, 3, 4, 5, 6],
    })
    expect(snapshotOf({ startTime: '07:30', endTime: '16:00', workDays: { mon: true, tue: false, wed: true, thu: false, fri: true, sat: false, sun: true } })?.workDays).toEqual([1, 3, 5, 7])
    expect(snapshotOf({ startTime: '08:00', endTime: '17:00', active: false })).toBeNull()
    expect(snapshotOf({ startTime: '17:00', endTime: '08:00' })).toBeNull()
    expect(snapshotOf({ startTime: '8:00', endTime: '17:00' })).toBeNull()
    expect(snapshotOf(null)).toBeNull()
    expect(parseSnapshot(Q30)).toEqual(Q30)
    expect(parseSnapshot({ start: '08:00' })).toBeNull()
  })

  it('ISO weekday of a business date and day kind (holiday wins over weekday)', () => {
    expect(isoWeekday('2026-09-20')).toBe(7) // Minggu (form contoh 20 Sep 2026)
    expect(isoWeekday('2026-09-21')).toBe(1)
    expect(dayKind('2026-09-21', Q30, false)).toBe('workday')
    expect(dayKind('2026-09-20', Q30, false)).toBe('off')
    expect(dayKind('2026-09-21', Q30, true)).toBe('holiday')
    expect(dayKind('2026-09-21', null, false)).toBe('unscheduled')
  })
})

describe('lateness / early leave table (company-local clock)', () => {
  const cases: Array<[string, string, string | null, number, number, string]> = [
    // date, check-in, check-out, late, early, note
    ['2026-09-21', '07:55:00', '17:00:00', 0, 0, 'on time'],
    ['2026-09-21', '08:15:59', '17:05:00', 0, 0, 'last second inside tolerance'],
    ['2026-09-21', '08:16:00', '17:00:00', 16, 0, 'above tolerance → counted from 08:00'],
    ['2026-09-21', '09:30:00', '16:59:30', 90, 1, 'early leave rounded up'],
    ['2026-09-21', '08:05:00', '15:00:00', 0, 120, 'left 2 h early'],
    ['2026-09-20', '10:00:00', '12:00:00', 0, 0, 'Sunday = off day: never late'],
    ['2026-09-21', '08:20:00', null, 20, 0, 'no check-out yet: late only'],
  ]
  it.each(cases)('%s in %s out %s → late %i, early %i (%s)', (date, inAt, outAt, late, early) => {
    const ev = evaluateDay({ localDate: date, checkIn: at(date, inAt), checkOut: outAt ? at(date, outAt) : null, schedule: Q30, holiday: false, timeZone: WITA })
    expect(ev.lateMinutes).toBe(late)
    expect(ev.earlyLeaveMinutes).toBe(early)
  })

  it('holiday: accepted and flagged, never late; no schedule → nothing computed', () => {
    const d = '2026-09-22'
    expect(evaluateDay({ localDate: d, checkIn: at(d, '10:00:00'), checkOut: at(d, '11:00:00'), schedule: Q30, holiday: true, timeZone: WITA })).toEqual({
      kind: 'holiday',
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      workMinutes: 60,
    })
    expect(evaluateDay({ localDate: d, checkIn: at(d, '10:00:00'), checkOut: null, schedule: null, holiday: false, timeZone: WITA })).toMatchObject({ kind: 'unscheduled', lateMinutes: 0 })
  })

  it('timezone: the same instant is on time in WITA but late in WIB (08:10 WIB = 09:10 WITA)', () => {
    const instant = new Date('2026-09-21T01:10:00Z') // 09:10 WITA, 08:10 WIB
    expect(localHHMM(instant, WITA)).toBe('09:10')
    expect(localHHMM(instant, 'Asia/Jakarta')).toBe('08:10')
    expect(evaluateDay({ localDate: '2026-09-21', checkIn: instant, checkOut: null, schedule: Q30, holiday: false, timeZone: WITA }).lateMinutes).toBe(70)
    expect(evaluateDay({ localDate: '2026-09-21', checkIn: instant, checkOut: null, schedule: Q30, holiday: false, timeZone: 'Asia/Jakarta' }).lateMinutes).toBe(0)
  })

  it('presence status: belum absen / hadir (a location open) / selesai', () => {
    expect(presenceStatus([])).toBe('belum_absen')
    expect(presenceStatus([{ checkIn: 'x', checkOut: null }])).toBe('hadir')
    expect(presenceStatus([{ checkIn: 'x', checkOut: 'y' }, { checkIn: 'x', checkOut: null }])).toBe('hadir')
    expect(presenceStatus([{ checkIn: 'x', checkOut: 'y' }])).toBe('selesai')
  })
})

const P1: LocationRef = { type: 'project', id: 1, code: 'P1', name: 'Gedung' }
const CC: LocationRef = { type: 'cost_center', id: 9, code: 'OPS', name: 'Ops Palangka' }
let seq = 0
function fact(date: string, kind: 'check_in' | 'check_out', hhmmss: string, over: Partial<AttendanceFact> = {}): AttendanceFact {
  return {
    id: ++seq,
    employeeId: 5,
    kind,
    localDate: date,
    time: at(date, hhmmss),
    location: P1,
    source: 'self',
    recordedByName: null,
    corrected: false,
    schedule: Q30,
    flags: [],
    offline: false,
    ...over,
  }
}

describe('monthly recap numbers (US-09)', () => {
  // September 2026, "today" = 2026-09-10 (Thursday). Holiday on 2026-09-08 (fictional).
  const facts: AttendanceFact[] = [
    fact('2026-09-01', 'check_in', '07:58:00'),
    fact('2026-09-01', 'check_out', '17:02:00'),
    fact('2026-09-02', 'check_in', '08:31:00'), // late 31
    fact('2026-09-02', 'check_out', '16:30:00'), // early 30
    fact('2026-09-03', 'check_in', '08:00:00', { source: 'pm', recordedByName: 'PM Budi' }),
    fact('2026-09-03', 'check_out', '17:00:00', { source: 'pm', recordedByName: 'PM Budi' }),
    fact('2026-09-04', 'check_in', '08:10:00'), // no check-out → incomplete
    // 05 (Sat) absent, 06 (Sun) off
    fact('2026-09-07', 'check_in', '08:00:00'), // two locations: P1 08–12, CC 13–17
    fact('2026-09-07', 'check_out', '12:00:00'),
    fact('2026-09-07', 'check_in', '13:00:00', { location: CC }),
    fact('2026-09-07', 'check_out', '17:00:00', { location: CC }),
    fact('2026-09-08', 'check_in', '09:00:00'), // holiday work
    fact('2026-09-08', 'check_out', '12:00:00'),
    fact('2026-09-09', 'check_in', '08:45:00', { corrected: true }), // corrected → effective 08:45, late 45
    fact('2026-09-09', 'check_out', '17:00:00'),
    fact('2026-09-10', 'check_in', '08:05:00'), // today, still open
  ]
  const r = recapRange({ from: '2026-09-01', to: '2026-09-30', today: '2026-09-10', facts, holidays: new Map([['2026-09-08', 'Libur contoh']]), fallbackSchedule: Q30, timeZone: WITA })

  it('one row per date up to today with status and times', () => {
    expect(r.days).toHaveLength(10)
    expect(r.days.map((d) => d.status)).toEqual(['selesai', 'selesai', 'selesai', 'hadir', 'tidak_hadir', 'libur', 'selesai', 'selesai', 'selesai', 'hadir'])
    const d7 = r.days[6]!
    expect(d7.locations.map((l) => l.location.code)).toEqual(['P1', 'OPS'])
    expect(d7.checkInLocal).toBe('08:00')
    expect(d7.checkOutLocal).toBe('17:00')
    expect(d7.workMinutes).toBe(480) // 4 h + 4 h, lunch gap not counted
    expect(r.days[2]).toMatchObject({ onBehalf: true, onBehalfBy: ['PM Budi'] })
    expect(r.days[7]).toMatchObject({ kind: 'holiday', holidayName: 'Libur contoh', lateMinutes: 0 })
    expect(r.days[8]).toMatchObject({ corrected: true, lateMinutes: 45 })
  })

  it('summary', () => {
    expect(r.summary).toEqual({
      presentDays: 8,
      workingDays: 8, // 1–10 Sep minus Sunday 6th and holiday 8th
      absentDays: 1, // Saturday 5th
      lateDays: 2,
      lateMinutes: 31 + 45,
      earlyLeaveDays: 1,
      earlyLeaveMinutes: 30,
      workMinutes: 544 + 479 + 540 + 480 + 180 + 495,
      holidayWorkDays: 1,
      offDayWorkDays: 0,
      incompleteDays: 1, // the 4th (today's open day does not count)
      onBehalfDays: 1,
      correctedDays: 1,
    })
  })

  it('without any schedule: no working/absent days and no lateness', () => {
    const r2 = recapRange({ from: '2026-09-01', to: '2026-09-30', today: '2026-09-10', facts: facts.map((f) => ({ ...f, schedule: null })), holidays: new Map(), fallbackSchedule: null, timeZone: WITA })
    expect(r2.summary).toMatchObject({ workingDays: 0, absentDays: 0, lateDays: 0, presentDays: 8 })
  })

  it('future month part is not listed; a month entirely in the future is empty', () => {
    expect(recapRange({ from: '2026-10-01', to: '2026-10-31', today: '2026-09-10', facts: [], holidays: new Map(), fallbackSchedule: Q30, timeZone: WITA }).days).toEqual([])
  })
})

describe('team today (US-13)', () => {
  it('belum absen / hadir / selesai per member, sorted by name, counts', () => {
    const d = '2026-09-21'
    const members = [
      { employeeId: 1, code: 'E1', name: 'Citra', locations: [P1] },
      { employeeId: 2, code: 'E2', name: 'Andi', locations: [P1] },
      { employeeId: 3, code: 'E3', name: 'Bayu', locations: [CC] },
    ]
    const facts = [
      fact(d, 'check_in', '08:20:00', { employeeId: 1 }),
      fact(d, 'check_in', '07:50:00', { employeeId: 3, location: CC, source: 'pm', recordedByName: 'PM' }),
      fact(d, 'check_out', '17:00:00', { employeeId: 3, location: CC, source: 'pm', recordedByName: 'PM' }),
    ]
    const r = teamToday({ date: d, members, facts, holidayName: null, schedules: new Map(), timeZone: WITA })
    expect(r.rows.map((x) => [x.employee.name, x.status, x.lateMinutes, x.onBehalf])).toEqual([
      ['Andi', 'belum_absen', 0, false],
      ['Bayu', 'selesai', 0, true],
      ['Citra', 'hadir', 20, false],
    ])
    expect(r.counts).toEqual({ total: 3, belum_absen: 1, hadir: 1, selesai: 1 })
  })
})

describe('selfie retention cutoff (Q-33, default 12 months)', () => {
  it('calendar months back, clamped to the month end', () => {
    expect(retentionCutoff(new Date('2026-09-26T02:30:00Z'), 12).toISOString()).toBe('2025-09-26T02:30:00.000Z')
    expect(retentionCutoff(new Date('2026-03-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(retentionCutoff(new Date('2028-03-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z')
  })
})

describe('contracts', () => {
  const base = { lat: -2.2135, lng: 113.9135, accuracy_m: 10, is_mocked: false, selfie_media_id: 3 }
  it('check-in/out: exactly one of project_id / cost_center_id (Q-40)', () => {
    expect(SyncAttendancePayload.safeParse({ ...base, project_id: 7 }).success).toBe(true)
    expect(SyncAttendancePayload.safeParse({ ...base, cost_center_id: 9 }).success).toBe(true)
    expect(SyncAttendancePayload.safeParse({ ...base, project_id: 7, cost_center_id: 9 }).success).toBe(false)
    expect(SyncAttendancePayload.safeParse(base).success).toBe(false)
  })

  it('on-behalf (US-14): employee, kind and reason required; back camera allowed', () => {
    const ok = { ...base, project_id: 7, employee_id: 4, kind: 'check_in', reason: 'Tidak punya HP', camera_lens: 'back' }
    expect(SyncOnBehalfPayload.safeParse(ok).success).toBe(true)
    const { reason: _r, ...noReason } = ok
    expect(SyncOnBehalfPayload.safeParse(noReason).success).toBe(false)
    expect(SyncOnBehalfPayload.safeParse({ ...ok, reason: '  ' }).success).toBe(false)
    expect(SyncOnBehalfPayload.safeParse({ ...ok, kind: 'x' }).success).toBe(false)
    const item = { client_uuid: '018f0000-0000-7000-8000-000000000001', type: 'attendance.on_behalf', schema_version: 1, offline: true, device_time: '2026-09-21T08:00:00+08:00', elapsed_ms: 1, payload: ok }
    const batch = { batch_id: '018f0000-0000-7000-8000-000000000002', device_id: '018f0000-0000-7000-8000-000000000003', clock: { device_time: '2026-09-21T08:00:00+08:00', elapsed_ms: 2, boot_id: 'b' }, items: [item] }
    expect(SyncBatch.safeParse(batch).success).toBe(true)
  })

  it('correction (US-15): reason mandatory, offset datetime', () => {
    expect(AttendanceCorrectBody.safeParse({ new_time: '2026-09-21T08:00:00+08:00', reason: 'Lupa absen, konfirmasi mandor' }).success).toBe(true)
    expect(AttendanceCorrectBody.safeParse({ new_time: '2026-09-21T08:00:00+08:00' }).success).toBe(false)
    expect(AttendanceCorrectBody.safeParse({ new_time: '2026-09-21T08:00:00+08:00', reason: 'ab' }).success).toBe(false)
    expect(AttendanceCorrectBody.safeParse({ new_time: '2026-09-21 08:00', reason: 'alasan' }).success).toBe(false)
  })

  it('OpenAPI documents the attendance endpoints and the on-behalf payload', () => {
    const doc = buildOpenApiDocument('0.0.0') as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } }
    for (const p of ['/attendance/me', '/attendance/recap', '/attendance/team-today', '/attendance/{id}/correct', '/attendance/{id}/selfie']) expect(doc.paths[p], p).toBeDefined()
    expect(doc.components.schemas.SyncOnBehalfPayload).toBeDefined()
    expect(doc.components.schemas.AttendanceRecap).toBeDefined()
  })

  it('report scope: PM filters intersect the team scope (other ids → empty)', () => {
    const team = { kind: 'team' as const, projects: [1, 2], costCenters: [9] }
    expect(attendanceReportScope(team)).toEqual({ kind: 'team', projects: [1, 2], costCenters: [9] })
    expect(attendanceReportScope(team, 2)).toEqual({ kind: 'team', projects: [2], costCenters: [] })
    expect(attendanceReportScope(team, 3)).toEqual({ kind: 'team', projects: [], costCenters: [] })
    expect(attendanceReportScope({ kind: 'all' }, undefined, 44)).toEqual({ kind: 'team', projects: [], costCenters: [44] })
    expect(attendanceReportScope({ kind: 'all' })).toEqual({ kind: 'all' })
  })
})
