import { APIError, type PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { firstDay, lastDay, PERIOD_RE } from '@/domain/reports/rules'

import { recapRange, teamToday, type DayRecap, type RecapSummary, type TeamTodayRow } from './aggregate'
import { attendanceContext, attendanceScope, currentSchedules, employeeRef, loadFacts, loadHolidays, teamMembers, type AttScope } from './queries'
import type { ScheduleSnapshot } from './schedule'

/**
 * E6 read services behind /api/v1/attendance/* (US-09 rekap bulanan, US-13 tim hari ini). Callers run
 * them inside one request transaction (consistent snapshot).
 */
export type MonthlyRecap = {
  employee: { id: number; code: string; name: string }
  month: string
  from: string
  to: string
  timezone: string
  schedule: ScheduleSnapshot | null
  days: DayRecap[]
  summary: RecapSummary
}

export function monthBounds(month: string | null | undefined, today: string): { month: string; from: string; to: string } {
  const m = month ?? today.slice(0, 7)
  if (!PERIOD_RE.test(m)) throw new APIError('month harus YYYY-MM.', 400, null, true)
  if (m > today.slice(0, 7)) throw new APIError('Bulan belum berjalan.', 400, null, true)
  return { month: m, from: firstDay(m), to: lastDay(m) }
}

async function recapOf(req: PayloadRequest, employeeId: number, month: string | null | undefined, scope: AttScope): Promise<MonthlyRecap> {
  const ctx = await attendanceContext(req)
  const b = monthBounds(month, ctx.today)
  const emp = await employeeRef(req, employeeId)
  if (!emp) throw new APIError('Karyawan tidak ditemukan.', 404, null, true)
  const [facts, holidays, schedules] = [
    await loadFacts(req, { from: b.from, to: b.to, employeeIds: [employeeId], scope }),
    await loadHolidays(req, b.from, b.to),
    await currentSchedules(req, [employeeId], ctx.defaultScheduleId),
  ]
  const schedule = schedules.get(employeeId) ?? null
  const r = recapRange({ from: b.from, to: b.to, today: ctx.today, facts, holidays, fallbackSchedule: schedule, timeZone: ctx.timeZone })
  return { employee: { id: emp.id, code: emp.code, name: emp.name }, month: b.month, from: b.from, to: b.to, timezone: ctx.timeZone, schedule, ...r }
}

/** US-09: own monthly recap (any role with an employee link). */
export async function myRecap(req: PayloadRequest, month: string | null | undefined): Promise<MonthlyRecap> {
  const employee = relId((req.user as { employee?: unknown } | null)?.employee)
  if (employee === undefined) throw new APIError('Akun Anda belum terhubung ke data karyawan. Hubungi Admin.', 409, null, true)
  return recapOf(req, employee, month, { kind: 'all' })
}

/**
 * Recap of another employee: office roles all; PM only for a member assigned to a TEAM location in
 * that month, and only the attendance at team locations (rows elsewhere stay invisible). Else 404.
 */
export async function employeeRecap(req: PayloadRequest, employeeId: number, month: string | null | undefined): Promise<MonthlyRecap> {
  const scope = await attendanceScope(req)
  if (!scope) throw new APIError('Forbidden', 403, null, true)
  if (scope.kind === 'team') {
    const ctx = await attendanceContext(req)
    const b = monthBounds(month, ctx.today)
    const members = await teamMembers(req, scope, b.from, b.to, employeeId)
    if (members.length === 0) throw new APIError('Karyawan tidak ditemukan di tim Anda.', 404, null, true)
  }
  return recapOf(req, employeeId, month, scope)
}

export type TeamTodayResult = {
  date: string
  timezone: string
  holidayName: string | null
  scope: AttScope['kind']
  counts: { total: number; belum_absen: number; hadir: number; selesai: number }
  members: TeamTodayRow[]
}

/** US-13: team presence for a date (default today; ≤ today). PM team, office roles all. */
export async function teamTodayFor(req: PayloadRequest, q: { date?: string; projectId?: number; costCenterId?: number }): Promise<TeamTodayResult> {
  let scope = await attendanceScope(req)
  if (!scope) throw new APIError('Forbidden', 403, null, true)
  const kind = scope.kind
  const ctx = await attendanceContext(req)
  const date = q.date ?? ctx.today
  if (date > ctx.today) throw new APIError('Tanggal tidak boleh di masa depan.', 400, null, true)
  if (q.projectId !== undefined || q.costCenterId !== undefined) {
    // Filters narrow the scope; an id outside a PM's team → empty (never other data).
    const ok = (ids: number[], id?: number) => id !== undefined && (scope!.kind === 'all' || ids.includes(id))
    scope = {
      kind: 'team',
      projects: ok(scope.kind === 'team' ? scope.projects : [], q.projectId) ? [q.projectId!] : [],
      costCenters: ok(scope.kind === 'team' ? scope.costCenters : [], q.costCenterId) ? [q.costCenterId!] : [],
    }
  }
  const members = await teamMembers(req, scope, date)
  const ids = members.map((m) => m.employeeId)
  const facts = await loadFacts(req, { from: date, to: date, employeeIds: ids, scope })
  const holidays = await loadHolidays(req, date, date)
  const schedules = await currentSchedules(req, ids, ctx.defaultScheduleId)
  const r = teamToday({ date, members, facts, holidayName: holidays.get(date) ?? null, schedules, timeZone: ctx.timeZone })
  return { date, timezone: ctx.timeZone, holidayName: holidays.get(date) ?? null, scope: kind, counts: r.counts, members: r.rows }
}
