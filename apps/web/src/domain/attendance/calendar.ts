/**
 * E6 web (S2) — pure presentation rules of the attendance calendar / team grid (no Payload, no
 * React): one classification per employee-day so the personal calendar, the team grid, the legend
 * and the totals always agree. Unit-tested (tests/unit/s2b-attendance-web.test.ts).
 *
 * Status is never colour alone: every class has a glyph + a label (dataviz "status" palette:
 * ok / warn / bad + neutral; `holidayWork` uses the primary hue = "information", not a status).
 */
import type { DayRecap } from './aggregate'
import { datesBetween, isoWeekday } from './schedule'

export type DayClass = 'ontime' | 'late' | 'early' | 'lateEarly' | 'open' | 'absent' | 'holidayWork' | 'off' | 'pending' | 'none'

export const DAY_CLASSES: Record<DayClass, { label: string; glyph: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'empty' }> = {
  ontime: { label: 'Hadir tepat waktu', glyph: '✓', tone: 'ok' },
  late: { label: 'Terlambat', glyph: '▲', tone: 'warn' },
  early: { label: 'Pulang cepat', glyph: '▼', tone: 'warn' },
  lateEarly: { label: 'Terlambat & pulang cepat', glyph: '◆', tone: 'warn' },
  open: { label: 'Tanpa absen pulang', glyph: '◐', tone: 'warn' },
  absent: { label: 'Tidak hadir', glyph: '✕', tone: 'bad' },
  holidayWork: { label: 'Masuk di hari libur/non-kerja', glyph: '●', tone: 'info' },
  off: { label: 'Libur / non-kerja', glyph: '○', tone: 'muted' },
  pending: { label: 'Belum absen (hari ini)', glyph: '◷', tone: 'empty' },
  none: { label: 'Tanpa jadwal', glyph: '–', tone: 'empty' },
}

/** Legend order (reading order of the calendar). */
export const LEGEND: DayClass[] = ['ontime', 'late', 'early', 'lateEarly', 'open', 'absent', 'holidayWork', 'off', 'pending', 'none']

export function classifyDay(d: Pick<DayRecap, 'status' | 'kind' | 'lateMinutes' | 'earlyLeaveMinutes' | 'checkIn'>, today: string, date: string): DayClass {
  if (d.checkIn) {
    if (d.kind === 'holiday' || d.kind === 'off') return 'holidayWork'
    if (d.status === 'hadir') return date < today ? 'open' : d.lateMinutes > 0 ? 'late' : 'ontime'
    if (d.lateMinutes > 0 && d.earlyLeaveMinutes > 0) return 'lateEarly'
    if (d.lateMinutes > 0) return 'late'
    if (d.earlyLeaveMinutes > 0) return 'early'
    return 'ontime'
  }
  if (d.status === 'tidak_hadir') return 'absent'
  if (d.status === 'libur') return 'off'
  if (d.status === 'belum_absen') return 'pending'
  return 'none'
}

/** Weeks (Monday first) of a month; null = padding cell before the 1st / after the last day. */
export function monthWeeks(month: string): Array<Array<string | null>> {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const days = datesBetween(`${month}-01`, `${month}-${String(last).padStart(2, '0')}`)
  const cells: Array<string | null> = [...Array.from({ length: isoWeekday(days[0]!) - 1 }, () => null), ...days]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: Array<Array<string | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** Counts per class (legend totals). */
export function classCounts(classes: DayClass[]): Record<DayClass, number> {
  const out = Object.fromEntries(LEGEND.map((k) => [k, 0])) as Record<DayClass, number>
  for (const c of classes) out[c]++
  return out
}

/** "08:05" / "7 j 45 m" helpers (Indonesian short forms). */
export function minutesText(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} j ${m} m` : `${m} m`
}

/** Previous / next month of YYYY-MM. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** "+08:00" from an offset in minutes (for building ISO times on the client). */
export function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const a = Math.abs(minutes)
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

/**
 * Geofence input check (cost centers, Q-40): latitude + longitude together (or both empty); the radius
 * is optional — empty = company-settings.defaultGeofenceRadiusM (S3e, US-01) — and needs a point.
 */
export function geofenceError(v: { lat: number | null; lng: number | null; radiusM: number | null }): string | null {
  if (v.lat === null && v.lng === null && v.radiusM === null) return null
  if ((v.lat === null) !== (v.lng === null)) return 'Isi latitude dan longitude sekaligus (atau kosongkan keduanya).'
  if (v.lat === null) return 'Radius hanya berlaku bila titik lokasi (latitude, longitude) diisi.'
  if (!(v.lat! >= -90 && v.lat! <= 90)) return 'Latitude harus −90 s/d 90.'
  if (!(v.lng! >= -180 && v.lng! <= 180)) return 'Longitude harus −180 s/d 180.'
  if (v.radiusM !== null && !(Number.isInteger(v.radiusM) && v.radiusM >= 10 && v.radiusM <= 5000)) return 'Radius harus bilangan bulat 10–5000 m.'
  return null
}

/** Radius that counts for attendance: the location's own radius, else the company default (S3e, US-01). */
export function effectiveRadiusM(own: number | null | undefined, companyDefault: number | null | undefined): number {
  if (typeof own === 'number' && own > 0) return own
  return typeof companyDefault === 'number' && companyDefault > 0 ? companyDefault : 100
}

/**
 * S3e (US-01, S-19): the APK enables the attendance button from `lat`/`lng`/`radiusM`. A location with
 * a point but no own radius gets the company default radius here (the same radius the server checks,
 * domain/attendance/record.ts). The stored value stays empty. Used by GET /api/v1/masters.
 */
export function withEffectiveRadius(item: Record<string, unknown>, defaultRadiusM: number | null | undefined): Record<string, unknown> {
  if (typeof item.lat !== 'number' || typeof item.lng !== 'number' || typeof item.radiusM === 'number') return item
  return { ...item, radiusM: effectiveRadiusM(null, defaultRadiusM) }
}
