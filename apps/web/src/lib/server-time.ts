import { DEFAULT_TZ, tzOffsetMinutes } from './time'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const ABBR: Record<string, string> = { 'Asia/Jakarta': 'WIB', 'Asia/Pontianak': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' }
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * QA-25: a server timestamp as "8 Okt 2026 14:30 WITA" in the company timezone — the SAME text on the
 * server (SSR) and in any browser, whatever the browser timezone or ICU build: only the numeric UTC
 * offset comes from Intl; the text is assembled by hand (React hydration error #418 came from values
 * formatted in the server TZ during SSR and in the browser TZ during hydration).
 */
export function formatServerTimestamp(value: unknown, timeZone: string = DEFAULT_TZ): string {
  if (value === null || value === undefined || value === '') return '—'
  const d = new Date(value as string | number | Date)
  if (Number.isNaN(d.getTime())) return '—'
  const local = new Date(d.getTime() + tzOffsetMinutes(d, timeZone) * 60_000)
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} ${ABBR[timeZone] ?? timeZone}`
}
