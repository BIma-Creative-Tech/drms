/** Company timezone helpers (default Asia/Makassar; server timestamps stay UTC). */
export const DEFAULT_TZ = 'Asia/Makassar'

export type LocalDate = { year: number; month: number; day: number }

/** Calendar date of an instant in the given IANA timezone. */
export function localDateInTz(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (WITA = +480). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000)
}

/** UTC instant of 00:00 local time of the local day containing `instant`. */
export function startOfLocalDay(instant: Date, timeZone: string): Date {
  const d = localDateInTz(instant, timeZone)
  const guess = Date.UTC(d.year, d.month - 1, d.day)
  return new Date(guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000)
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
const ZONED_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * Item 11: instant of a date-time string. With an offset/Z (ISO 8601) it is taken as is; without one
 * ("YYYY-MM-DDTHH:MM[:SS]", e.g. an <input type="datetime-local">) it is a wall-clock time in
 * `timeZone` (the PT zone — the browser zone may differ). Null when invalid.
 */
export function parseZonedDateTime(value: string, timeZone: string): Date | null {
  if (ZONED_DT.test(value)) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const m = LOCAL_DT.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)]
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return null
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  const check = new Date(wall)
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null
  let at = wall - tzOffsetMinutes(new Date(wall), timeZone) * 60000
  at = wall - tzOffsetMinutes(new Date(at), timeZone) * 60000 // second pass: offset at the real instant
  return new Date(at)
}

/** "YYYY-MM-DD" of an instant in `timeZone`. */
export function isoDateInTz(instant: Date, timeZone: string): string {
  const d = localDateInTz(instant, timeZone)
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}
