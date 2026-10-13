/** Thousands grouping with '.' (id-ID) of a plain digit string. */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/**
 * Rupiah display `Rp 1.447.500` (requirements v1.1 §9). Manual grouping instead of Intl currency
 * style (architecture §16 item 11: Intl separator output is UNVERIFIED on the alpine ICU build).
 */
export function formatRupiah(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  return `${sign}Rp ${group(String(Math.abs(Math.trunc(amount))))}`
}

/**
 * DRMS 13/10 #10: Indonesian number for text and tables — thousands '.', decimals ',' (id-ID), at most
 * `digits` decimals without trailing zeros: 1234567 → '1.234.567', 1031.5 → '1.031,5' (digits ≥ 1).
 * Counts keep the default 0 (rounded). Manual like formatRupiah (no Intl); non-finite → '—'.
 */
export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  const f = 10 ** digits
  const r = Math.round(Math.abs(value) * f) / f
  const [int = '0', frac = ''] = r.toFixed(digits).split('.')
  const dec = frac.replace(/0+$/, '')
  return `${value < 0 && r !== 0 ? '-' : ''}${group(int)}${dec ? `,${dec}` : ''}`
}

/** formatRupiah of an optional amount, '—' when missing — the `rp` of the custom views and dashboard. */
export const rupiahOrDash = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : formatRupiah(v))
