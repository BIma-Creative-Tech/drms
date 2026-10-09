/**
 * Document numbering (ADR 0007). Pure formatting + period key here; SQL allocation in
 * numbering-db.ts (runs inside the business transaction).
 */
import { localDateInTz, type LocalDate } from '@/lib/time'

export { localDateInTz, type LocalDate }

export type ResetPolicy = 'never' | 'yearly' | 'monthly'

export const DOC_TYPES = [
  'expense_request',
  'transfer',
  'settlement',
  'cash_in',
  'cash_out',
  'progress_report',
  'budget_addendum',
  'reversal',
  // FR1 (ADR 0020): Laporan servis unit SV/YYMM/####
  'service_report',
] as const
export type DocType = (typeof DOC_TYPES)[number]

export type SequenceConfig = {
  docType: string
  pattern: string
  resetPolicy: ResetPolicy
  padding: number
  startAt: number
  timezone: string
  docCode?: string
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'] as const
const TOKEN = /\{(seq|DD|MM_ROMAN|MM|YYYY|YY|COMPANY|DOC)\}/g

/** Parse a business date 'YYYY-MM-DD' (already in company TZ) without TZ conversion. */
export function parseBusinessDate(value: string): LocalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) throw new Error('business date must be YYYY-MM-DD')
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  const check = new Date(Date.UTC(d.year, d.month - 1, d.day))
  if (check.getUTCFullYear() !== d.year || check.getUTCMonth() !== d.month - 1 || check.getUTCDate() !== d.day) {
    throw new Error('invalid business date')
  }
  return d
}

export function periodKey(policy: ResetPolicy, d: LocalDate): string {
  switch (policy) {
    case 'never':
      return 'ALL'
    case 'yearly':
      return String(d.year)
    case 'monthly':
      return `${d.year}-${String(d.month).padStart(2, '0')}`
  }
}

/** Returns an error message, or null when the pattern is valid for the reset policy (ADR 0007 §2). */
export function patternError(pattern: string, policy: ResetPolicy): string | null {
  if (!pattern.includes('{seq}')) return 'Pola harus memuat {seq}.'
  const unknown = pattern.replace(TOKEN, '').match(/\{[^}]*\}/)
  if (unknown) return `Token tidak dikenal: ${unknown[0]}`
  const hasYear = pattern.includes('{YY}') || pattern.includes('{YYYY}')
  const hasMonth = pattern.includes('{MM}') || pattern.includes('{MM_ROMAN}')
  if (policy !== 'never' && !hasYear) return 'Reset tahunan/bulanan membutuhkan token tahun ({YY}/{YYYY}).'
  if (policy === 'monthly' && !hasMonth) return 'Reset bulanan membutuhkan token bulan ({MM}/{MM_ROMAN}).'
  return null
}

export function validatePattern(pattern: string, policy: ResetPolicy): void {
  const err = patternError(pattern, policy)
  if (err) throw new Error(err)
}

export function formatDocNo(
  cfg: Pick<SequenceConfig, 'pattern' | 'padding' | 'docCode'>,
  seq: number,
  d: LocalDate,
  company: string,
): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('seq must be a positive integer')
  const tokens: Record<string, string> = {
    '{seq}': cfg.padding > 0 ? String(seq).padStart(cfg.padding, '0') : String(seq),
    '{DD}': String(d.day).padStart(2, '0'),
    '{MM}': String(d.month).padStart(2, '0'),
    '{MM_ROMAN}': ROMAN[d.month - 1] ?? '',
    '{YY}': String(d.year % 100).padStart(2, '0'),
    '{YYYY}': String(d.year),
    '{COMPANY}': company,
    '{DOC}': cfg.docCode ?? '',
  }
  return cfg.pattern.replace(TOKEN, (t) => tokens[t] ?? t)
}

/** ADR 0007 §3 defaults (seed). PB: reset never, startAt 229 (user decision 2026-09-23). */
export const DEFAULT_SEQUENCES: ReadonlyArray<Omit<SequenceConfig, 'timezone' | 'docType'> & { docType: DocType; docCode: string }> = [
  { docType: 'expense_request', docCode: 'PB', pattern: '{seq}/PB-{COMPANY}/{DD}/{MM_ROMAN}/{YYYY}', resetPolicy: 'never', padding: 0, startAt: 229 },
  { docType: 'transfer', docCode: 'TRF', pattern: 'TRF/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'settlement', docCode: 'LPJ', pattern: 'LPJ/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'cash_in', docCode: 'KM', pattern: 'KM/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'cash_out', docCode: 'KK', pattern: 'KK/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'progress_report', docCode: 'LP', pattern: 'LP/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'budget_addendum', docCode: 'ADD', pattern: 'ADD/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'service_report', docCode: 'SV', pattern: 'SV/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
]
