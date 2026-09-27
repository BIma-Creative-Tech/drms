import { describe, expect, it } from 'vitest'

import type { DayRecap } from '@/domain/attendance/aggregate'
import { classCounts, classifyDay, geofenceError, minutesText, monthWeeks, offsetText, shiftMonth } from '@/domain/attendance/calendar'
import { retentionCutoff } from '@/domain/attendance/schedule'
import { companyClock, crossedThresholds, fill, reminderSettingsOf, runDecision } from '@/domain/reminders/rules'
import { tasks } from '@/jobs/tasks'

/** S2 web B: pure rules of the attendance calendar and the E7 reminder schedule (fake clock). */
const day = (over: Partial<DayRecap>): DayRecap => ({
  date: '2026-08-03',
  weekday: 1,
  kind: 'workday',
  holidayName: null,
  status: 'selesai',
  checkIn: '2026-08-03T00:05:00.000Z',
  checkOut: '2026-08-03T09:00:00.000Z',
  checkInLocal: '08:05',
  checkOutLocal: '17:00',
  workMinutes: 535,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  onBehalf: false,
  onBehalfBy: [],
  corrected: false,
  flags: [],
  locations: [],
  ...over,
})

describe('attendance calendar classification', () => {
  const today = '2026-08-20'
  it('maps every employee-day to exactly one legend class', () => {
    expect(classifyDay(day({}), today, '2026-08-03')).toBe('ontime')
    expect(classifyDay(day({ lateMinutes: 40 }), today, '2026-08-03')).toBe('late')
    expect(classifyDay(day({ earlyLeaveMinutes: 60 }), today, '2026-08-03')).toBe('early')
    expect(classifyDay(day({ lateMinutes: 40, earlyLeaveMinutes: 60 }), today, '2026-08-03')).toBe('lateEarly')
    expect(classifyDay(day({ status: 'hadir', checkOut: null }), today, '2026-08-05')).toBe('open')
    expect(classifyDay(day({ status: 'hadir', checkOut: null }), today, today)).toBe('ontime') // still at work today
    expect(classifyDay(day({ status: 'hadir', checkOut: null, lateMinutes: 5 }), today, today)).toBe('late')
    expect(classifyDay(day({ kind: 'holiday', holidayName: 'Libur' }), today, '2026-08-17')).toBe('holidayWork')
    expect(classifyDay(day({ kind: 'off' }), today, '2026-08-09')).toBe('holidayWork')
    expect(classifyDay(day({ checkIn: null, status: 'tidak_hadir' }), today, '2026-08-06')).toBe('absent')
    expect(classifyDay(day({ checkIn: null, status: 'libur', kind: 'off' }), today, '2026-08-09')).toBe('off')
    expect(classifyDay(day({ checkIn: null, status: 'belum_absen' }), today, today)).toBe('pending')
    expect(classifyDay(day({ checkIn: null, status: 'tanpa_jadwal', kind: 'unscheduled' }), today, '2026-08-06')).toBe('none')
  })

  it('counts classes for the legend totals', () => {
    const c = classCounts(['ontime', 'late', 'late', 'absent'])
    expect(c).toMatchObject({ ontime: 1, late: 2, absent: 1, off: 0 })
  })

  it('builds Monday-first weeks with padding (Aug 2026 starts on a Saturday)', () => {
    const w = monthWeeks('2026-08')
    expect(w[0]).toEqual([null, null, null, null, null, '2026-08-01', '2026-08-02'])
    expect(w.at(-1)).toEqual(['2026-08-31', null, null, null, null, null, null])
    expect(w.flat().filter(Boolean)).toHaveLength(31)
    expect(monthWeeks('2027-02').flat().filter(Boolean)).toHaveLength(28)
  })

  it('formats helpers', () => {
    expect(minutesText(465)).toBe('7 j 45 m')
    expect(minutesText(15)).toBe('15 m')
    expect(minutesText(null)).toBe('—')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(offsetText(480)).toBe('+08:00')
    expect(offsetText(-150)).toBe('-02:30')
  })

  it('validates cost-center geofence input: all three or none', () => {
    expect(geofenceError({ lat: null, lng: null, radiusM: null })).toBeNull()
    expect(geofenceError({ lat: -2.21, lng: 113.91, radiusM: 150 })).toBeNull()
    expect(geofenceError({ lat: -2.21, lng: null, radiusM: 150 })).toMatch(/sekaligus/)
    // S3e (US-01): radius optional (company default), but only with a point
    expect(geofenceError({ lat: -2.21, lng: 113.91, radiusM: null })).toBeNull()
    expect(geofenceError({ lat: null, lng: null, radiusM: 150 })).toMatch(/titik lokasi/)
    expect(geofenceError({ lat: 95, lng: 113.91, radiusM: 150 })).toMatch(/Latitude/)
    expect(geofenceError({ lat: -2.21, lng: 190, radiusM: 150 })).toMatch(/Longitude/)
    expect(geofenceError({ lat: -2.21, lng: 113.91, radiusM: 5 })).toMatch(/Radius/)
    expect(geofenceError({ lat: -2.21, lng: 113.91, radiusM: 12.5 })).toMatch(/Radius/)
  })
})

describe('selfie retention cutoff (fake clock)', () => {
  it('is N calendar months before now, clamped to month end', () => {
    expect(retentionCutoff(new Date('2027-09-26T02:30:00Z'), 12).toISOString()).toBe('2026-09-26T02:30:00.000Z')
    expect(retentionCutoff(new Date('2027-03-31T00:00:00Z'), 1).toISOString()).toBe('2027-02-28T00:00:00.000Z')
  })
})

describe('E7 reminder schedule (fake clock, Asia/Makassar)', () => {
  const s = reminderSettingsOf({}, 'Asia/Makassar')
  it('defaults follow the plan (hour 7, in-app on, email off, thresholds 85/100)', () => {
    expect(s).toMatchObject({ enabled: true, hour: 7, email: false, timeZone: 'Asia/Makassar' })
    expect(s.lateProgress).toEqual({ enabled: true, days: 3 })
    expect(s.lpjOverdue).toEqual({ enabled: true, days: 7 })
    expect(s.revision).toEqual({ enabled: true, days: 3 })
    expect(s.budget.thresholds).toEqual([85, 100])
  })

  it('reads settings (per-rule switches, thresholds deduplicated, invalid values fall back)', () => {
    const x = reminderSettingsOf({ remindersEnabled: false, reminderHour: 30, reminderEmailEnabled: true, reminderBudgetEnabled: false, budgetWarnPct: 80, budgetOverPct: 80, lateReportDays: 5, timezone: 'Asia/Jakarta' }, 'Asia/Makassar')
    expect(x).toMatchObject({ enabled: false, hour: 7, email: true, timeZone: 'Asia/Jakarta' })
    expect(x.budget).toEqual({ enabled: false, thresholds: [80] })
    expect(x.lateProgress.days).toBe(5)
  })

  it('company clock: 06:59 WITA is still before the hour, 23:30 UTC is already the next business day', () => {
    expect(companyClock(new Date('2026-09-25T22:59:00Z'), 'Asia/Makassar')).toEqual({ date: '2026-09-26', hour: 6 })
    expect(companyClock(new Date('2026-09-25T23:00:00Z'), 'Asia/Makassar')).toEqual({ date: '2026-09-26', hour: 7 })
    expect(companyClock(new Date('2026-09-26T15:59:00Z'), 'Asia/Makassar')).toEqual({ date: '2026-09-26', hour: 23 })
  })

  it('runs once per day at/after the configured hour', () => {
    expect(runDecision(s, 6, false)).toBe('before_hour')
    expect(runDecision(s, 7, false)).toBe('run')
    expect(runDecision(s, 13, true)).toBe('already_ran')
    expect(runDecision({ ...s, enabled: false }, 13, false)).toBe('disabled')
  })

  it('budget thresholds crossed (null pct = no RAB → none)', () => {
    expect(crossedThresholds(84.99, [85, 100])).toEqual([])
    expect(crossedThresholds(85, [85, 100])).toEqual([85])
    expect(crossedThresholds(130, [85, 100])).toEqual([85, 100])
    expect(crossedThresholds(null, [85, 100])).toEqual([])
  })

  it('fills templates (unknown placeholders → empty, no HTML semantics)', () => {
    expect(fill('{docNo} {x} <b>', { docNo: 'UM/2608/0001' })).toBe('UM/2608/0001  <b>')
  })

  it('registers the jobs: hourly reminders + nightly selfie retention', () => {
    const bySlug = new Map(tasks.map((t) => [t.slug, t]))
    expect(bySlug.get('dailyReminders')?.schedule?.[0]?.cron).toBe('2 * * * *')
    expect(bySlug.get('selfieRetention')?.schedule?.[0]?.cron).toBe('30 2 * * *')
  })
})
