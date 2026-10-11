/**
 * P3 Laporan Harian (konstruksi; owner decisions 2026-10-10): pure rules — weather, manpower/equipment
 * shape, flags. No Payload, no DB.
 */
export const WEATHER = ['cerah', 'berawan', 'hujan'] as const
export type Weather = (typeof WEATHER)[number]
export const WEATHER_LABELS: Record<Weather, string> = { cerah: 'Cerah', berawan: 'Berawan', hujan: 'Hujan' }
export const DAY_PARTS = ['pagi', 'siang', 'sore'] as const
export type DayPart = (typeof DAY_PARTS)[number]

export const MAX_DAILY_PHOTOS = 10
export const MAX_LINES = 300
export const MAX_RESOURCES = 60

/** Flags of a daily report (shown as chips; never block the report). */
export const DAILY_FLAGS = {
  overRap: 'MELEBIHI_RAP',
  possibleDuplicate: 'POSSIBLE_DUPLICATE',
  backdated: 'BACKDATED',
  corrected: 'CORRECTED',
} as const

/** "Minggu ke-N" of `date` counted from the project start (week 1 = the Mon–Sun week of the start). */
export function weekNo(start: string, date: string): number {
  const monday = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`)
    const wd = (t.getUTCDay() + 6) % 7
    return t.getTime() - wd * 86_400_000
  }
  return Math.floor((monday(date) - monday(start)) / (7 * 86_400_000)) + 1
}

/** Mon–Sun range of week N from the project start. */
export function weekRangeOf(start: string, n: number): { from: string; to: string } {
  const s = new Date(`${start}T00:00:00Z`)
  const mon = s.getTime() - ((s.getUTCDay() + 6) % 7) * 86_400_000 + (n - 1) * 7 * 86_400_000
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { from: iso(mon), to: iso(mon + 6 * 86_400_000) }
}
