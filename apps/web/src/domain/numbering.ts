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
  // P3 (konstruksi): Laporan harian LH/YYMM/####
  'daily_report',
  // ADR 0022: Pinjaman antar project PJ/{COMPANY}/YYMM/#### (issued at submit)
  'project_loan',
  // ADR 0029: Pinjaman antar-PT PJA/{LENDER}/YYMM/#### (issued at the Owner's instruction, lender PT's counter)
  'intercompany_loan',
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

/**
 * ADR 0007 §3 defaults (seed). D5 (owner decision DRMS 10/10, 2026-10-11): EVERY number carries the PT
 * short code, one shape `<DOC>/{COMPANY}/{YY}{MM}/{seq}` with 4 digits, e.g. `TRF/LLAS/2610/0001`.
 * Owner decision 2026-10-11 (DRMS 10/10 extra): PB resets MONTHLY from 1 per PT too (`PB/DRMS/2611/0001`,
 * `PB/LAS/2611/0001` — independent counters, keyed company + doc type + month); the earlier "paper series
 * continues, never + 229" rule (2026-09-23) is retired. `{COMPANY}` is always the PT's `shortCode`.
 * Already issued numbers are never rewritten; migrations 20261012_200100_d1010_data (patterns) and
 * 20261012_300200_d1010_pb_monthly (PB reset) move rows still on the default.
 */
export const DEFAULT_SEQUENCES: ReadonlyArray<Omit<SequenceConfig, 'timezone' | 'docType'> & { docType: DocType; docCode: string }> = [
  { docType: 'expense_request', docCode: 'PB', pattern: 'PB/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'transfer', docCode: 'TRF', pattern: 'TRF/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'settlement', docCode: 'LPJ', pattern: 'LPJ/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'cash_in', docCode: 'KM', pattern: 'KM/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'cash_out', docCode: 'KK', pattern: 'KK/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'progress_report', docCode: 'LP', pattern: 'LP/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'budget_addendum', docCode: 'ADD', pattern: 'ADD/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  { docType: 'service_report', docCode: 'SV', pattern: 'SV/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  // P3 konstruksi
  { docType: 'daily_report', docCode: 'LH', pattern: 'LH/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  // ADR 0022 §6: inter-project loan, number at submit (date token = loan date)
  { docType: 'project_loan', docCode: 'PJ', pattern: 'PJ/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
  // ADR 0029 §3.2: inter-PT loan, number at the Owner's instruction ({COMPANY} = the lender PT; seeded by 20261015_100300)
  { docType: 'intercompany_loan', docCode: 'PJA', pattern: 'PJA/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 },
]

/**
 * D5: the default patterns BEFORE 2026-10-12 (pattern + padding per doc type). The numbering migration
 * moves a sequence row to DEFAULT_SEQUENCES only while it still has exactly this pattern — a pattern
 * the Admin changed is left alone (and logged).
 */
export const LEGACY_DEFAULT_PATTERNS: Readonly<Record<string, { pattern: string; padding: number }>> = {
  expense_request: { pattern: '{seq}/PB-{COMPANY}/{DD}/{MM_ROMAN}/{YYYY}', padding: 0 },
  transfer: { pattern: 'TRF/{YY}{MM}/{seq}', padding: 4 },
  settlement: { pattern: 'LPJ/{YY}{MM}/{seq}', padding: 4 },
  cash_in: { pattern: 'KM/{YY}{MM}/{seq}', padding: 4 },
  cash_out: { pattern: 'KK/{YY}{MM}/{seq}', padding: 4 },
  progress_report: { pattern: 'LP/{YY}{MM}/{seq}', padding: 4 },
  budget_addendum: { pattern: 'ADD/{YY}{MM}/{seq}', padding: 4 },
  service_report: { pattern: 'SV/{YY}{MM}/{seq}', padding: 4 },
  daily_report: { pattern: 'LH/{YY}{MM}/{seq}', padding: 4 },
}

/** D5: a `{COMPANY}` token needs a non-empty PT short code (message for the Admin). */
export function companyCodeError(pattern: string, shortCode: string | null | undefined): string | null {
  if (!pattern.includes('{COMPANY}')) return null
  return typeof shortCode === 'string' && shortCode.trim() !== '' ? null : 'Kode singkat PT belum diisi. Admin: isi "Kode singkat" di Perusahaan (PT) sebelum dokumen bernomor diterbitkan.'
}
