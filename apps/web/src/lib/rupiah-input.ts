/**
 * QA-03 / QA-12 (QA report 2026-10-08): ONE parser for every typed Rupiah amount in the admin.
 * The old masks dropped every non-digit, so "1.000,50" was saved as Rp 100.050 and "-5000" as a cash-in
 * of Rp 5.000 — silently. Rules now:
 * - optional "Rp" prefix and surrounding spaces are ignored;
 * - "." is the thousands separator, only in groups of 3 ("1.250.000"); plain digits are fine too;
 * - "," (decimal) → "Rupiah tanpa desimal"; "-" → refused (the cash form says to use "Kas keluar");
 *   any other character → refused; nothing is ever dropped silently;
 * - integer, at most 13 digits, > 0 unless `allowZero`.
 * Pure module (unit-tested), shared by the client forms and server-side helpers. The server still
 * validates the number it receives (Zod: integer > 0).
 */
export type RupiahErrorCode = 'decimal' | 'minus' | 'char' | 'group' | 'big' | 'zero'

export type RupiahParsed = { value: number | null; error: string | null; code: RupiahErrorCode | null }

export type RupiahOptions = {
  /** Message for a minus sign (cash form: use the "Kas keluar" type instead). */
  minusMessage?: string
  allowZero?: boolean
}

export const RUPIAH_MAX_DIGITS = 13

export const RUPIAH_MESSAGES: Record<RupiahErrorCode, string> = {
  decimal: 'Rupiah tanpa desimal — hapus koma dan angka di belakangnya.',
  minus: 'Nominal tidak boleh negatif.',
  char: 'Nominal hanya angka; titik (.) sebagai pemisah ribuan.',
  group: 'Pemisah ribuan tidak valid — titik setiap 3 angka (mis. 1.250.000).',
  big: 'Nominal terlalu besar.',
  zero: 'Nominal harus lebih dari 0.',
}

/** Message of the cash-entry form for a minus sign (QA-12). */
export const CASH_MINUS_MESSAGE = 'Gunakan jenis Kas keluar, bukan tanda minus.'

const fail = (code: RupiahErrorCode, opts: RupiahOptions): RupiahParsed => ({
  value: null,
  code,
  error: code === 'minus' && opts.minusMessage ? opts.minusMessage : RUPIAH_MESSAGES[code],
})

export function parseRupiah(raw: string | null | undefined, opts: RupiahOptions = {}): RupiahParsed {
  const t = String(raw ?? '')
    .trim()
    .replace(/^rp\.?\s*/i, '')
  if (t === '') return { value: null, error: null, code: null }
  if (t.includes(',')) return fail('decimal', opts)
  if (/[-−–]/.test(t)) return fail('minus', opts)
  if (/[^\d.]/.test(t)) return fail('char', opts)
  if (t.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(t)) return fail('group', opts)
  const digits = t.replace(/\./g, '').replace(/^0+(?=\d)/, '')
  if (digits.length > RUPIAH_MAX_DIGITS) return fail('big', opts)
  const n = Number(digits)
  if (!Number.isSafeInteger(n)) return fail('big', opts)
  if (n === 0 && !opts.allowZero) return fail('zero', opts)
  return { value: n, error: null, code: null }
}

/** 1250000 → "1.250.000" (manual grouping; Intl output is not relied on, see lib/money.ts). */
export function groupRupiah(n: number): string {
  return String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Errors shown while typing; "group"/"zero" wait for blur or submit (a half-typed "1.2" is not wrong yet). */
export function isImmediateRupiahError(code: RupiahErrorCode | null): boolean {
  return code === 'decimal' || code === 'minus' || code === 'char' || code === 'big'
}
