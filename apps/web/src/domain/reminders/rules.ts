/**
 * E7 — pure rules of the scheduled reminders (M12, US-11; plan fase1-golive §E7). No Payload import:
 * unit-tested with a fake clock. The service (./service.ts) runs the queries and the delivery.
 */
import { localHHMM } from '@/domain/attendance/schedule'
import { localDateInTz } from '@/lib/time'

export const REMINDER_RULES = ['late_progress', 'lpj_overdue', 'revision_pending', 'budget_threshold'] as const
export type ReminderRule = (typeof REMINDER_RULES)[number]

export const REMINDER_EVENTS: Record<ReminderRule, string> = {
  late_progress: 'progress.late_report', // E4 hook (domain/progress/reminders.ts)
  lpj_overdue: 'reminder.lpj_overdue',
  revision_pending: 'reminder.revision_pending',
  budget_threshold: 'reminder.budget_threshold',
}

export type ReminderSettings = {
  enabled: boolean
  hour: number
  email: boolean
  timeZone: string
  lateProgress: { enabled: boolean; days: number }
  lpjOverdue: { enabled: boolean; days: number }
  revision: { enabled: boolean; days: number }
  budget: { enabled: boolean; thresholds: number[] }
}

const int = (v: unknown, def: number, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : def)
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def)

/** company-settings → reminder settings (defaults = plan §E7 / migration defaults). */
export function reminderSettingsOf(s: Record<string, unknown>, fallbackTz: string): ReminderSettings {
  const warn = typeof s.budgetWarnPct === 'number' && s.budgetWarnPct > 0 ? s.budgetWarnPct : 85
  const over = typeof s.budgetOverPct === 'number' && s.budgetOverPct > 0 ? s.budgetOverPct : 100
  return {
    enabled: bool(s.remindersEnabled, true),
    hour: int(s.reminderHour, 7, 0, 23),
    email: bool(s.reminderEmailEnabled, false),
    timeZone: typeof s.timezone === 'string' && s.timezone ? s.timezone : fallbackTz,
    lateProgress: { enabled: bool(s.reminderLateProgressEnabled, true), days: int(s.lateReportDays, 3, 1, 60) },
    lpjOverdue: { enabled: bool(s.reminderLpjOverdueEnabled, true), days: int(s.lpjDueDays, 7, 1, 365) },
    revision: { enabled: bool(s.reminderRevisionEnabled, true), days: int(s.reminderRevisionDays, 3, 1, 60) },
    budget: { enabled: bool(s.reminderBudgetEnabled, true), thresholds: [...new Set([warn, over])].sort((a, b) => a - b) },
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

export const DEFAULT_TEXTS: Record<Exclude<ReminderRule, 'late_progress'>, { title: string; body: string }> = {
  lpj_overdue: {
    title: 'LPJ terlambat: {docNo}',
    body: 'Uang muka {docNo} "{title}" sudah {days} hari sejak ditransfer ({since}) tanpa nota/LPJ (batas {limit} hari). Segera ajukan LPJ.',
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
