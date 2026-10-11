/**
 * Formatting for the "Pengajuan Biaya" PDF (ADR 0008 §6). Pure module (unit-tested).
 * Rupiah via lib/money (manual grouping, architecture §16 item 11); dates `id-ID` long form from
 * the business date (no TZ shift: 'YYYY-MM-DD' is already the company-TZ date); signature times in
 * the company TZ with the Indonesian zone abbreviation.
 */
import { formatRupiah } from '@/lib/money'

export { formatRupiah }

const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

/** '2026-09-20' → '20 September 2026'. */
export function formatDateLong(businessDate: string | null | undefined): string {
  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return ''
  const [y, m, d] = businessDate.split('-').map(Number) as [number, number, number]
  return `${d} ${MONTHS_ID[m - 1]} ${y}`
}

const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

/**
 * DRMS 10/10 (Lead review h): helper text next to a native date input — '2026-10-12' → 'Senin, 12 Oktober
 * 2026'. Deterministic (no locale / TZ: the weekday comes from the calendar date in UTC), so server and
 * browser render the same text. Empty / malformed / impossible dates (2026-02-30) → ''.
 */
export function formatDateWeekday(businessDate: string | null | undefined): string {
  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return ''
  const [y, m, d] = businessDate.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return ''
  return `${DAYS_ID[t.getUTCDay()]}, ${d} ${MONTHS_ID[m - 1]} ${y}`
}

/** `<input type="datetime-local">` value '2026-10-12T14:30' → 'Senin, 12 Oktober 2026 14.30' (wall time as typed, no TZ shift). */
export function formatDateTimeLocalHint(value: string | null | undefined): string {
  const m = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(value ?? '')
  if (!m) return ''
  const day = formatDateWeekday(m[1])
  return day ? `${day} ${m[2]}.${m[3]}` : ''
}

/** Helper text of a native date / datetime-local input value. */
export function dateInputHint(type: 'date' | 'datetime-local', value: string | null | undefined): string {
  return type === 'date' ? formatDateWeekday(value) : formatDateTimeLocalHint(value)
}

/** '2026-09-21' → '21/09/2026'. */
export function formatDateShort(businessDate: string | null | undefined): string {
  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return ''
  const [y, m, d] = businessDate.split('-')
  return `${d}/${m}/${y}`
}

const TZ_ABBR: Record<string, string> = { 'Asia/Jakarta': 'WIB', 'Asia/Pontianak': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' }

/** ISO instant → '20/09/2026 14:05 WITA' in the company timezone. */
export function formatServerTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')} ${TZ_ABBR[timeZone] ?? timeZone}`
}

/** Quantity with Indonesian decimal comma, no grouping surprises ('24,8'). Empty for null. */
export function formatQty(q: number | null | undefined): string {
  if (q === null || q === undefined) return ''
  const s = Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000)
  const [int, frac] = s.split('.')
  const grouped = (int ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return frac ? `${grouped},${frac}` : grouped
}

/** Amount without the currency prefix ('339.000'); empty for null. */
export function formatAmount(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return formatRupiah(v).replace(/^(-?)Rp /, '$1')
}

/**
 * Subtitle "<no urut>-PB <COMPANY>-<judul>" (US-46; form: "228-PB DRMS-Pengajuan Reimburse …").
 * The sequence is the leading number of the document number (`228/PB-DRMS/…`).
 */
export function subtitleOf(docNo: string | null | undefined, companyCode: string, title: string): string {
  const seq = docNo?.match(/^(\d+)/)?.[1]
  return seq ? `${seq}-PB ${companyCode}-${title}` : title
}

/**
 * Standard PDF fonts (Helvetica) use WinAnsi encoding (pdfkit AFM fonts): characters outside it
 * would print as garbage. Indonesian text is Latin-1; replace the few typographic characters that
 * are not in WinAnsi and drop control characters.
 */
export function pdfSafe(text: string | null | undefined): string {
  if (!text) return ''
  const printable = Array.from(text)
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0
      return code >= 0x20 ? code !== 0x7f : c === '\n' || c === '\t' || c === '\r'
    })
    .join('')
  return printable
    .replace(/[\u{2192}\u{21d2}]/gu, '->')
    .replace(/\u{2264}/gu, '<=')
    .replace(/\u{2265}/gu, '>=')
    .replace(/[\u{a0}\u{2007}\u{202f}]/gu, ' ')
    .replace(/[^\u{9}\u{a}\u{d}\u{20}-\u{7e}\u{a1}-\u{ff}\u{152}\u{153}\u{160}\u{161}\u{178}\u{17d}\u{17e}\u{192}\u{2c6}\u{2dc}\u{2013}\u{2014}\u{2018}\u{2019}\u{201a}\u{201c}\u{201d}\u{201e}\u{2020}\u{2021}\u{2022}\u{2026}\u{2030}\u{2039}\u{203a}\u{20ac}\u{2122}]/gu, '?')
}
