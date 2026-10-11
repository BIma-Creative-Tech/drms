import type { PayloadRequest } from 'payload'

import { userId } from '@/access/roles'
import { notificationTemplate, projectPmUsers, pushEnabled } from '@/domain/notifications'
import { fill } from '@/domain/reminders/rules'

/**
 * FR1 in-app notifications (ADR 0020 §6). Texts from `notification-templates` (event key, when
 * active) else the defaults below; placeholders {docNo} {unit} {project} {reporter} {date}. Written in
 * the transaction of the report (no notification without the report, and vice versa); the actor is
 * never notified about their own action.
 */
export const FIELD_EVENTS = {
  unitWaitingPart: 'field.unit_waiting_part',
  dailyOverRap: 'field.daily_over_rap',
  aftersalesFollowup: 'reminder.aftersales_followup',
} as const

export const FIELD_DEFAULT_TEXTS: Record<(typeof FIELD_EVENTS)[keyof typeof FIELD_EVENTS], { title: string; body: string }> = {
  'field.unit_waiting_part': {
    title: 'Unit menunggu part: {unit}',
    body: 'Laporan servis {docNo} ({date}, {project}): unit {unit} berstatus "Menunggu part". Pelapor: {reporter}.',
  },
  'field.daily_over_rap': {
    title: 'Volume melebihi RAP: {project}',
    body: 'Laporan harian {docNo} ({date}, {reporter}): {items} melebihi volume RAP. Catatan: {note}',
  },
  'reminder.aftersales_followup': {
    title: 'Follow-up penawaran: {client}',
    body: 'Penawaran {docNo} ke {client} ({project}) jatuh tempo follow-up {date}.',
  },
}

/** Service report → unit "menunggu part": the project's PM accounts (projects.pm + PM assignments). */
export async function notifyUnitWaitingPart(req: PayloadRequest, r: { id: number; docNo: string | null; company: number; project: number; projectLabel: string; unit: string; reporter: string; date: string }): Promise<number> {
  const recipients = (await projectPmUsers(req, r.project, r.company)).filter((u) => u !== userId(req))
  if (recipients.length === 0) return 0
  const t = await notificationTemplate(req, FIELD_EVENTS.unitWaitingPart, FIELD_DEFAULT_TEXTS[FIELD_EVENTS.unitWaitingPart])
  const vars = { docNo: r.docNo ?? `#${r.id}`, unit: r.unit, project: r.projectLabel, reporter: r.reporter, date: r.date }
  for (const uid of recipients) {
    await req.payload.create({
      collection: 'notifications',
      data: {
        user: uid,
        company: r.company,
        event: FIELD_EVENTS.unitWaitingPart,
        title: fill(t.title, vars).slice(0, 160),
        body: fill(t.body, vars).slice(0, 1000),
        docType: 'service_report',
        docId: String(r.id),
        docNo: r.docNo,
        pushStatus: pushEnabled() ? 'pending' : 'skipped',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: in-app notification committed with the service report
      req,
    })
  }
  return recipients.length
}

/** P3: a daily report pushed work items over their RAP volume → the project's PM accounts. */
export async function notifyDailyOverRap(req: PayloadRequest, r: { id: number; docNo: string | null; company: number; project: number; projectLabel: string; reporter: string; date: string; items: string; note: string }): Promise<number> {
  const recipients = (await projectPmUsers(req, r.project, r.company)).filter((u) => u !== userId(req))
  if (recipients.length === 0) return 0
  const t = await notificationTemplate(req, FIELD_EVENTS.dailyOverRap, FIELD_DEFAULT_TEXTS[FIELD_EVENTS.dailyOverRap])
  const vars = { docNo: r.docNo ?? `#${r.id}`, project: r.projectLabel, reporter: r.reporter, date: r.date, items: r.items, note: r.note }
  for (const uid of recipients) {
    await req.payload.create({
      collection: 'notifications',
      data: {
        user: uid,
        company: r.company,
        event: FIELD_EVENTS.dailyOverRap,
        title: fill(t.title, vars).slice(0, 160),
        body: fill(t.body, vars).slice(0, 1000),
        docType: 'daily_report',
        docId: String(r.id),
        docNo: r.docNo,
        pushStatus: pushEnabled() ? 'pending' : 'skipped',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: in-app notification committed with the daily report
      req,
    })
  }
  return recipients.length
}
