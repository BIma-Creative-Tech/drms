/**
 * E6 — work schedule, holidays and lateness (Q-30: 08:00–17:00 WITA, Senin–Sabtu, toleransi 15
 * menit; "absen di hari libur tetap diterima dan ditandai"). PURE module (no Payload import):
 * unit-tested with time tables, and shared by the recap, team-today and the attendance report so
 * every screen/export computes the same numbers.
 *
 * Rules (documented for UAT; the client confirms them with Q-30):
 * - Minutes are computed on the company-local wall clock (IANA timezone of company-settings).
 * - Late: seconds after `start` are truncated to whole minutes; if that is MORE than the tolerance,
 *   the late minutes are counted FROM `start` (08:15:59 with 15 min tolerance = on time; 08:16:00 =
 *   16 minutes late).
 * - Early leave: minutes before `end`, rounded UP (16:59:30 = 1 minute early). No tolerance.
 * - On a holiday or a non-working weekday nothing is late/early; the day is flagged instead.
 * - Without a schedule nothing is late/early and no day counts as "absent".
 */

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

/** Snapshot stored on the attendance row at check-in (`attendances.schedule`). */
export type ScheduleSnapshot = {
  id: number | null
  name: string
  start: string // HH:MM
  end: string // HH:MM
  toleranceMin: number
  /** ISO weekdays (1 = Monday … 7 = Sunday) that are working days. */
  workDays: number[]
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function hhmmToMinutes(v: string): number {
  const m = HHMM.exec(v)
  if (!m) throw new Error(`invalid HH:MM "${v}"`)
  return Number(m[1]) * 60 + Number(m[2])
}

type ScheduleDoc = {
  id?: unknown
  name?: unknown
  startTime?: unknown
  endTime?: unknown
  lateToleranceMin?: unknown
  active?: unknown
  workDays?: Partial<Record<WeekdayKey, unknown>> | null
}

/** Work-schedule document → snapshot; null when it is missing, inactive or malformed. */
export function snapshotOf(doc: ScheduleDoc | null | undefined): ScheduleSnapshot | null {
  if (!doc || doc.active === false) return null
  if (typeof doc.startTime !== 'string' || typeof doc.endTime !== 'string' || !HHMM.test(doc.startTime) || !HHMM.test(doc.endTime)) return null
  if (doc.endTime <= doc.startTime) return null
  const days = doc.workDays
  // Missing group (rows created before E6) = Q-30 default Monday–Saturday.
  const workDays = WEEKDAY_KEYS.map((k, i) => (days && typeof days[k] === 'boolean' ? (days[k] ? i + 1 : 0) : k === 'sun' ? 0 : i + 1)).filter((d) => d > 0)
  const tol = typeof doc.lateToleranceMin === 'number' && doc.lateToleranceMin >= 0 ? Math.floor(doc.lateToleranceMin) : 15
  return {
    id: typeof doc.id === 'number' ? doc.id : null,
    name: typeof doc.name === 'string' ? doc.name : '',
    start: doc.startTime,
    end: doc.endTime,
    toleranceMin: tol,
    workDays,
  }
}

/** Parses a stored snapshot (json column); null when absent/invalid. */
export function parseSnapshot(v: unknown): ScheduleSnapshot | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Partial<ScheduleSnapshot>
  if (typeof s.start !== 'string' || typeof s.end !== 'string' || !HHMM.test(s.start) || !HHMM.test(s.end)) return null
  if (!Array.isArray(s.workDays) || typeof s.toleranceMin !== 'number') return null
  return {
    id: typeof s.id === 'number' ? s.id : null,
    name: typeof s.name === 'string' ? s.name : '',
    start: s.start,
    end: s.end,
    toleranceMin: s.toleranceMin,
    workDays: s.workDays.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7),
  }
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a business date YYYY-MM-DD (calendar, TZ-free). */
export function isoWeekday(localDate: string): number {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number]
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return dow === 0 ? 7 : dow
}

/** Seconds since local midnight of `instant` in `timeZone`. */
export function localSecondsOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return get('hour') * 3600 + get('minute') * 60 + get('second')
}

/** "HH:MM" of an instant on the company-local clock. */
export function localHHMM(instant: Date, timeZone: string): string {
  const s = localSecondsOfDay(instant, timeZone)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}`
}

/** Every business date from..to inclusive (YYYY-MM-DD). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  const [y, m, d] = from.split('-').map(Number) as [number, number, number]
  for (let t = Date.UTC(y, m - 1, d); ; t += 86_400_000) {
    const s = new Date(t).toISOString().slice(0, 10)
    if (s > to) break
    out.push(s)
  }
  return out
}

export type DayKind = 'workday' | 'holiday' | 'off' | 'unscheduled'

/** Working day / holiday / non-working weekday. A holiday wins over the weekday. */
export function dayKind(localDate: string, schedule: ScheduleSnapshot | null, holiday: boolean): DayKind {
  if (holiday) return 'holiday'
  if (!schedule) return 'unscheduled'
  return schedule.workDays.includes(isoWeekday(localDate)) ? 'workday' : 'off'
}

export type DayEvaluation = {
  kind: DayKind
  lateMinutes: number
  earlyLeaveMinutes: number
  /** Minutes between check-in and check-out (null while a check-out is missing). */
  workMinutes: number | null
}

/**
 * Lateness / early leave of one employee-day. `checkIn` = first effective check-in of the day,
 * `checkOut` = last effective check-out (corrections already applied by the caller).
 */
export function evaluateDay(args: {
  localDate: string
  checkIn: Date | null
  checkOut: Date | null
  schedule: ScheduleSnapshot | null
  holiday: boolean
  timeZone: string
}): DayEvaluation {
  const kind = dayKind(args.localDate, args.schedule, args.holiday)
  const workMinutes = args.checkIn && args.checkOut ? Math.max(0, Math.floor((args.checkOut.getTime() - args.checkIn.getTime()) / 60_000)) : null
  let lateMinutes = 0
  let earlyLeaveMinutes = 0
  if (kind === 'workday' && args.schedule) {
    const start = hhmmToMinutes(args.schedule.start) * 60
    const end = hhmmToMinutes(args.schedule.end) * 60
    if (args.checkIn) {
      const late = Math.floor(Math.max(0, localSecondsOfDay(args.checkIn, args.timeZone) - start) / 60)
      lateMinutes = late > args.schedule.toleranceMin ? late : 0
    }
    if (args.checkOut) {
      earlyLeaveMinutes = Math.ceil(Math.max(0, end - localSecondsOfDay(args.checkOut, args.timeZone)) / 60)
    }
  }
  return { kind, lateMinutes, earlyLeaveMinutes, workMinutes }
}

/** Status of an employee-day for "tim hari ini" (US-13) and the recap. */
export type PresenceStatus = 'belum_absen' | 'hadir' | 'selesai'

/** hadir = at least one location still open (check-in without check-out); selesai = all closed. */
export function presenceStatus(locations: Array<{ checkIn: unknown; checkOut: unknown }>): PresenceStatus {
  const withIn = locations.filter((l) => l.checkIn)
  if (withIn.length === 0) return 'belum_absen'
  return withIn.some((l) => !l.checkOut) ? 'hadir' : 'selesai'
}

/** Selfie retention cutoff (Q-33): instant `months` calendar months before `now` (UTC arithmetic). */
export function retentionCutoff(now: Date, months: number): Date {
  const d = new Date(now.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}
