/**
 * E7 — pure rules of the scheduled reminders (M12, US-11; plan fase1-golive §E7). No Payload import:
 * unit-tested with a fake clock. The service (./service.ts) runs the queries and the delivery.
 */
import { localHHMM } from '@/domain/attendance/schedule'
import { localDateInTz } from '@/lib/time'

export const REMINDER_RULES = ['late_progress', 'lpj_overdue', 'revision_pending', 'budget_threshold', 'aftersales_followup', 'loan_overdue', 'ic_loan_overdue'] as const
export type ReminderRule = (typeof REMINDER_RULES)[number]

export const REMINDER_EVENTS: Record<ReminderRule, string> = {
  late_progress: 'progress.late_report', // E4 hook (domain/progress/reminders.ts)
  lpj_overdue: 'reminder.lpj_overdue',
  revision_pending: 'reminder.revision_pending',
  budget_threshold: 'reminder.budget_threshold',
  aftersales_followup: 'reminder.aftersales_followup', // FR1 (ADR 0020): quotation follow-up due → reporter + PM
  loan_overdue: 'project_loan.overdue', // ADR 0022 Q-L6: inter-project loan past due → borrower PM + Direktur, daily
  // ADR 0029 §3.8: inter-PT loan (PJA) past due → Owner, Finance + Direktur of the borrower, Finance of the lender, daily
  ic_loan_overdue: 'icloan.overdue',
}

export type ReminderSettings = {
  /** PT of these settings (ADR 0016 §7; `reminder_runs` key). */
  companyId: number
  enabled: boolean
  hour: number
  email: boolean
  timeZone: string
  lateProgress: { enabled: boolean; days: number }
  lpjOverdue: { enabled: boolean; days: number }
  revision: { enabled: boolean; days: number }
  budget: { enabled: boolean; thresholds: number[] }
  /** FR1: only where the PT's field reports are on (companies.fieldReportsEnabled). */
  aftersalesFollowup: { enabled: boolean }
  /** ADR 0022 Q-L6: overdue inter-project loans, daily (companies.reminderLoanOverdueEnabled). */
  loanOverdue: { enabled: boolean }
  /** ADR 0029 §3.8: overdue inter-PT loans of this BORROWER PT, daily (companies.reminderIcLoanOverdueEnabled). */
  icLoanOverdue: { enabled: boolean }
}

const int = (v: unknown, def: number, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : def)
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def)

/** company-settings → reminder settings (defaults = plan §E7 / migration defaults). */
export function reminderSettingsOf(s: Record<string, unknown>, fallbackTz: string): ReminderSettings {
  const warn = typeof s.budgetWarnPct === 'number' && s.budgetWarnPct > 0 ? s.budgetWarnPct : 85
  const over = typeof s.budgetOverPct === 'number' && s.budgetOverPct > 0 ? s.budgetOverPct : 100
  return {
    companyId: typeof s.companyId === 'number' ? s.companyId : typeof s.id === 'number' ? s.id : 0,
    enabled: bool(s.remindersEnabled, true),
    hour: int(s.reminderHour, 7, 0, 23),
    email: bool(s.reminderEmailEnabled, false),
    timeZone: typeof s.timezone === 'string' && s.timezone ? s.timezone : fallbackTz,
    lateProgress: { enabled: bool(s.reminderLateProgressEnabled, true), days: int(s.lateReportDays, 3, 1, 60) },
    lpjOverdue: { enabled: bool(s.reminderLpjOverdueEnabled, true), days: int(s.lpjDueDays, 7, 1, 365) },
    revision: { enabled: bool(s.reminderRevisionEnabled, true), days: int(s.reminderRevisionDays, 3, 1, 60) },
    budget: { enabled: bool(s.reminderBudgetEnabled, true), thresholds: [...new Set([warn, over])].sort((a, b) => a - b) },
    aftersalesFollowup: { enabled: bool(s.fieldReportsEnabled, false) },
    loanOverdue: { enabled: bool(s.reminderLoanOverdueEnabled, true) },
    icLoanOverdue: { enabled: bool(s.reminderIcLoanOverdueEnabled, true) },
  }
}

/** Business date + hour of an instant on the company clock. */
export function companyClock(now: Date, timeZone: string): { date: string; hour: number } {
  const d = localDateInTz(now, timeZone)
  const date = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
  return { date, hour: Number(localHHMM(now, timeZone).slice(0, 2)) }
}

/** Why a tick does (not) run: the job fires hourly; the run happens once per day at/after `hour`. */
export function runDecision(s: Pick<ReminderSettings, 'enabled' | 'hour'>, localHour: number, alreadyRanToday: boolean): 'run' | 'disabled' | 'before_hour' | 'already_ran' {
  if (!s.enabled) return 'disabled'
  if (localHour < s.hour) return 'before_hour'
  if (alreadyRanToday) return 'already_ran'
  return 'run'
}

/** Thresholds (ascending) reached by `pct`; empty when the project has no RAB (pct null). */
export function crossedThresholds(pct: number | null, thresholds: readonly number[]): number[] {
  if (pct === null) return []
  return thresholds.filter((t) => pct >= t)
}

/** Replaces {key} placeholders (unknown keys → empty). Plain text only. */
export function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-zA-Z]+)\}/g, (_, k: string) => vars[k] ?? '')
}

export const DEFAULT_TEXTS: Record<Exclude<ReminderRule, 'late_progress' | 'loan_overdue' | 'ic_loan_overdue'>, { title: string; body: string }> = {
  aftersales_followup: {
    title: 'Follow-up penawaran: {client}',
    body: 'Penawaran {docNo} ke {client} ({project}) jatuh tempo follow-up {date}.',
  },
  lpj_overdue: {
    title: 'LPJ terlambat: {docNo}',
    body: 'Pengajuan baru {docNo} "{title}" sudah {days} hari sejak ditransfer ({since}) tanpa nota/LPJ (batas {limit} hari). Segera ajukan LPJ.',
  },
  revision_pending: {
    title: 'Revisi menunggu: {docNo}',
    body: '{status} untuk {docNo} "{title}" belum diperbaiki selama {days} hari (sejak {since}). Perbaiki lalu kirim ulang.',
  },
  budget_threshold: {
    title: 'Anggaran {code} ≥ {threshold}%',
    body: 'Komitmen project {code} {name} mencapai {pct}% dari RAB (ambang {threshold}%). Komitmen {committed} dari RAB {budget}.',
  },
}

// ---------------------------------------------------------------- D2710 daily digest email

/**
 * D2710 (user 2026-10-27): ONE reminder email per recipient per day instead of one per subject — prod sent ~150
 * reminder emails at once to ~12 people (up to 19 each) against the mailbox budget of 24/h (email/rate-guard.ts), so
 * about half failed for good every day. Every rule's email part goes into the daily digest; in-app rows are unchanged.
 */
export type DigestItem = { rule: ReminderRule; title: string; body: string; companyId: number }

/** Section headings of the digest, in this order. */
export const DIGEST_SECTIONS: Record<ReminderRule, string> = {
  lpj_overdue: 'LPJ terlambat',
  revision_pending: 'Revisi belum diperbaiki',
  late_progress: 'Laporan progress terlambat',
  budget_threshold: 'Ambang anggaran project',
  loan_overdue: 'Pinjaman antar proyek terlambat',
  ic_loan_overdue: 'Pinjaman antar-PT terlambat',
  aftersales_followup: 'Follow-up penawaran',
}

/** Text budget of one digest (sendEmail input `text` max 20 000). */
export const DIGEST_MAX_TEXT = 18_000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** "2026-10-27" → "27 Okt 2026". */
export function dateLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : date
}

/**
 * Subject + text of one recipient's digest. One item keeps the single reminder's subject; several items are grouped
 * per rule (DIGEST_SECTIONS order), each line prefixed with the PT when the items span several PTs (`ptLabel`).
 */
export function digestEmail(items: readonly DigestItem[], opts: { date: string; appUrl?: string | null; ptLabel?: (companyId: number) => string | null }): { subject: string; text: string } {
  const base = opts.appUrl ? `${opts.appUrl.replace(/\/$/, '')}/admin` : null
  const footer = `${base ? `Buka RR Teams: ${base}\n\n` : ''}Email otomatis pengingat harian RR Teams (satu email per hari). Setiap pengingat juga ada di lonceng notifikasi.\n`
  if (items.length === 1) {
    const only = items[0]!
    return { subject: `RR Teams — ${only.title}`.slice(0, 200), text: `${only.body}\n\n${footer}` }
  }
  const multiPt = new Set(items.map((i) => i.companyId)).size > 1
  const pt = (i: DigestItem) => {
    const label = multiPt ? opts.ptLabel?.(i.companyId) : null
    return label ? `[${label}] ` : ''
  }
  let text = `Ringkasan pengingat harian RR Teams, ${dateLabel(opts.date)}: ${items.length} pengingat.\n`
  let shown = 0
  outer: for (const rule of Object.keys(DIGEST_SECTIONS) as ReminderRule[]) {
    const list = items.filter((i) => i.rule === rule)
    if (list.length === 0) continue
    const head = `\n${DIGEST_SECTIONS[rule]} (${list.length})\n`
    if (text.length + head.length > DIGEST_MAX_TEXT) break
    text += head
    for (const i of list) {
      const line = `- ${pt(i)}${i.body}\n`
      if (text.length + line.length > DIGEST_MAX_TEXT) break outer
      text += line
      shown++
    }
  }
  if (shown < items.length) text += `\n… dan ${items.length - shown} pengingat lainnya. Lihat semuanya di lonceng notifikasi RR Teams.\n`
  return { subject: `RR Teams — Ringkasan pengingat ${dateLabel(opts.date)} (${items.length} pengingat)`.slice(0, 200), text: `${text}\n${footer}` }
}
