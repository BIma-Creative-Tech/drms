import { datesBetween, evaluateDay, isoWeekday, localHHMM, presenceStatus, type DayKind, type PresenceStatus, type ScheduleSnapshot } from './schedule'

/**
 * E6 — pure aggregation of attendance facts into employee-days (recap US-09, team today US-13,
 * report M13). Facts carry the EFFECTIVE time (newest T10 correction applied by the loader).
 * No Payload import: unit-tested with fixed tables.
 */
export type LocationRef = { type: 'project' | 'cost_center'; id: number; code: string; name: string }

export type AttendanceFact = {
  id: number
  employeeId: number
  kind: 'check_in' | 'check_out'
  localDate: string
  /** Effective time (correction applied). */
  time: Date
  location: LocationRef
  source: 'self' | 'pm'
  recordedByName: string | null
  corrected: boolean
  schedule: ScheduleSnapshot | null
  flags: string[]
  offline: boolean
}

export type DayStatus = 'selesai' | 'hadir' | 'belum_absen' | 'tidak_hadir' | 'libur' | 'tanpa_jadwal'

export type LocationDay = {
  location: LocationRef
  checkIn: { id: number; time: string; source: 'self' | 'pm'; corrected: boolean } | null
  checkOut: { id: number; time: string; source: 'self' | 'pm'; corrected: boolean } | null
}

export type DayRecap = {
  date: string
  weekday: number
  kind: DayKind
  holidayName: string | null
  status: DayStatus
  checkIn: string | null
  checkOut: string | null
  checkInLocal: string | null
  checkOutLocal: string | null
  workMinutes: number | null
  lateMinutes: number
  earlyLeaveMinutes: number
  onBehalf: boolean
  onBehalfBy: string[]
  corrected: boolean
  flags: string[]
  locations: LocationDay[]
}

export type RecapSummary = {
  presentDays: number
  workingDays: number
  absentDays: number
  lateDays: number
  lateMinutes: number
  earlyLeaveDays: number
  earlyLeaveMinutes: number
  workMinutes: number
  holidayWorkDays: number
  offDayWorkDays: number
  incompleteDays: number
  onBehalfDays: number
  correctedDays: number
}

const locKey = (l: LocationRef) => `${l.type}:${l.id}`

/** Groups facts of ONE employee by location for one day. */
function locationDays(facts: AttendanceFact[]): LocationDay[] {
  const by = new Map<string, LocationDay>()
  for (const f of [...facts].sort((a, b) => a.time.getTime() - b.time.getTime())) {
    const k = locKey(f.location)
    const cur = by.get(k) ?? { location: f.location, checkIn: null, checkOut: null }
    const v = { id: f.id, time: f.time.toISOString(), source: f.source, corrected: f.corrected }
    if (f.kind === 'check_in' && !cur.checkIn) cur.checkIn = v
    if (f.kind === 'check_out' && !cur.checkOut) cur.checkOut = v
    by.set(k, cur)
  }
  return [...by.values()].sort((a, b) => (a.checkIn?.time ?? '').localeCompare(b.checkIn?.time ?? ''))
}

/**
 * One employee-day. `fallbackSchedule` = the employee's CURRENT schedule, used when no check-in
 * snapshot exists (absent days, rows recorded before E6).
 */
export function recapDay(args: {
  date: string
  facts: AttendanceFact[]
  holidayName: string | null
  fallbackSchedule: ScheduleSnapshot | null
  today: string
  timeZone: string
}): DayRecap {
  const locs = locationDays(args.facts)
  const ins = locs.filter((l) => l.checkIn)
  const firstIn = ins.length ? ins.map((l) => l.checkIn!.time).sort()[0]! : null
  const closed = ins.filter((l) => l.checkOut)
  const allClosed = ins.length > 0 && closed.length === ins.length
  const lastOut = allClosed ? closed.map((l) => l.checkOut!.time).sort().at(-1)! : null
  const firstInFact = firstIn ? args.facts.find((f) => f.kind === 'check_in' && f.time.toISOString() === firstIn) : undefined
  const schedule = firstInFact?.schedule ?? args.fallbackSchedule
  const ev = evaluateDay({
    localDate: args.date,
    checkIn: firstIn ? new Date(firstIn) : null,
    checkOut: lastOut ? new Date(lastOut) : null,
    schedule,
    holiday: args.holidayName !== null,
    timeZone: args.timeZone,
  })
  const workMinutes = closed.length
    ? closed.reduce((s, l) => s + Math.max(0, Math.floor((new Date(l.checkOut!.time).getTime() - new Date(l.checkIn!.time).getTime()) / 60_000)), 0)
    : null
  let status: DayStatus
  if (ins.length > 0) status = presenceStatus(ins) === 'selesai' ? 'selesai' : 'hadir'
  else if (ev.kind === 'workday') status = args.date < args.today ? 'tidak_hadir' : 'belum_absen'
  else if (ev.kind === 'unscheduled') status = 'tanpa_jadwal'
  else status = 'libur'
  const onBehalfBy = [...new Set(args.facts.filter((f) => f.source === 'pm' && f.recordedByName).map((f) => f.recordedByName as string))]
  return {
    date: args.date,
    weekday: isoWeekday(args.date),
    kind: ev.kind,
    holidayName: args.holidayName,
    status,
    checkIn: firstIn,
    checkOut: lastOut,
    checkInLocal: firstIn ? localHHMM(new Date(firstIn), args.timeZone) : null,
    checkOutLocal: lastOut ? localHHMM(new Date(lastOut), args.timeZone) : null,
    workMinutes,
    lateMinutes: ev.lateMinutes,
    earlyLeaveMinutes: ev.earlyLeaveMinutes,
    onBehalf: args.facts.some((f) => f.source === 'pm'),
    onBehalfBy,
    corrected: args.facts.some((f) => f.corrected),
    flags: [...new Set(args.facts.flatMap((f) => f.flags))],
    locations: locs,
  }
}

/** Days from..to (inclusive, never after `today`) of one employee + totals. */
export function recapRange(args: {
  from: string
  to: string
  today: string
  facts: AttendanceFact[]
  holidays: Map<string, string>
  fallbackSchedule: ScheduleSnapshot | null
  timeZone: string
}): { days: DayRecap[]; summary: RecapSummary } {
  const last = args.to < args.today ? args.to : args.today
  const byDate = new Map<string, AttendanceFact[]>()
  for (const f of args.facts) byDate.set(f.localDate, [...(byDate.get(f.localDate) ?? []), f])
  const days = args.from > last ? [] : datesBetween(args.from, last).map((date) =>
    recapDay({ date, facts: byDate.get(date) ?? [], holidayName: args.holidays.get(date) ?? null, fallbackSchedule: args.fallbackSchedule, today: args.today, timeZone: args.timeZone }),
  )
  return { days, summary: summarize(days, args.today) }
}

export function summarize(days: DayRecap[], today: string): RecapSummary {
  const present = days.filter((d) => d.checkIn)
  return {
    presentDays: present.length,
    workingDays: days.filter((d) => d.kind === 'workday').length,
    absentDays: days.filter((d) => d.status === 'tidak_hadir').length,
    lateDays: days.filter((d) => d.lateMinutes > 0).length,
    lateMinutes: days.reduce((s, d) => s + d.lateMinutes, 0),
    earlyLeaveDays: days.filter((d) => d.earlyLeaveMinutes > 0).length,
    earlyLeaveMinutes: days.reduce((s, d) => s + d.earlyLeaveMinutes, 0),
    workMinutes: days.reduce((s, d) => s + (d.workMinutes ?? 0), 0),
    holidayWorkDays: present.filter((d) => d.kind === 'holiday').length,
    offDayWorkDays: present.filter((d) => d.kind === 'off').length,
    incompleteDays: present.filter((d) => d.status === 'hadir' && d.date < today).length,
    onBehalfDays: present.filter((d) => d.onBehalf).length,
    correctedDays: days.filter((d) => d.corrected).length,
  }
}

export type TeamMember = { employeeId: number; code: string; name: string; locations: LocationRef[] }

export type TeamTodayRow = {
  employee: { id: number; code: string; name: string }
  assigned: LocationRef[]
  status: PresenceStatus
  checkIn: string | null
  checkOut: string | null
  checkInLocal: string | null
  checkOutLocal: string | null
  lateMinutes: number
  onBehalf: boolean
  corrected: boolean
  locations: LocationDay[]
}

/** US-13: hadir / belum absen / selesai per team member for one date. */
export function teamToday(args: {
  date: string
  members: TeamMember[]
  facts: AttendanceFact[]
  holidayName: string | null
  schedules: Map<number, ScheduleSnapshot | null>
  timeZone: string
}): { rows: TeamTodayRow[]; counts: { total: number; belum_absen: number; hadir: number; selesai: number } } {
  const rows = args.members.map((m): TeamTodayRow => {
    const facts = args.facts.filter((f) => f.employeeId === m.employeeId && f.localDate === args.date)
    const day = recapDay({ date: args.date, facts, holidayName: args.holidayName, fallbackSchedule: args.schedules.get(m.employeeId) ?? null, today: args.date, timeZone: args.timeZone })
    const status: PresenceStatus = day.status === 'selesai' ? 'selesai' : day.status === 'hadir' ? 'hadir' : 'belum_absen'
    return {
      employee: { id: m.employeeId, code: m.code, name: m.name },
      assigned: m.locations,
      status,
      checkIn: day.checkIn,
      checkOut: day.checkOut,
      checkInLocal: day.checkInLocal,
      checkOutLocal: day.checkOutLocal,
      lateMinutes: day.lateMinutes,
      onBehalf: day.onBehalf,
      corrected: day.corrected,
      locations: day.locations,
    }
  })
  rows.sort((a, b) => a.employee.name.localeCompare(b.employee.name, 'id'))
  const counts = { total: rows.length, belum_absen: 0, hadir: 0, selesai: 0 }
  for (const r of rows) counts[r.status]++
  return { rows, counts }
}
