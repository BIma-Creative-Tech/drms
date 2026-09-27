import type { PayloadRequest } from 'payload'

import { relId, userId, type Role } from '@/access/roles'
import { formatRupiah } from '@/lib/money'

import type { ApprovalSnapshot } from './expense/rules'
import { REQUEST_TYPE_LABELS, statusLabel, type RequestStatus, type RequestType } from './expense/types'

/**
 * In-app notifications on T1/T5 status transitions (requirements v1.1 US-05 "push … di setiap
 * perpindahan status ke semua pemohon", US-19/US-26/US-41; ADR 0011 §5). Called from the
 * expense-requests afterChange hook → same transaction as the transition (no notification without
 * the change, and vice versa). Recipients are computed server-side by role + scope; the actor is
 * never notified about their own action. Text: `notification-templates` row of the event when
 * active (placeholders {docNo} {title} {amount} {status} {type}), else the defaults below.
 *
 * Push (FCM) arrives in F4: rows are written with pushStatus `skipped` unless PUSH_FCM_ENABLED=true,
 * in which case they are `pending` for the F4 dispatcher job (ADR 0011 §5 pipeline hook).
 */
export type NotifyEvent =
  | 'expense.pending_ack'
  | 'expense.pending_approval'
  | 'expense.approved'
  | 'expense.rejected'
  | 'expense.cancelled'
  | 'expense.receipt_revision'
  | 'expense.receipts_verified'
  | 'expense.transfer_queue'
  | 'expense.receipts_to_verify'
  | 'expense.transferred'
  | 'expense.lpj_submitted'
  | 'expense.lpj_revision'
  | 'expense.lpj_verified'
  | 'expense.completed'
  // S3e (US-05, US-41, S-04): requester-side events, gated by company-settings.notifyRequesterStatusEnabled
  | 'expense.submitted'
  | 'expense.withdrawn'
  | 'expense.created_on_behalf'

const DEFAULTS: Record<NotifyEvent, { title: string; body: string }> = {
  // ADR 0013 §10: "Diketahui" is the Direktur's approval; recipients = active Direktur (pk-owner)
  // holders minus requester/creator. pending_approval → active Finance holders (never the PM).
  'expense.pending_ack': { title: 'Persetujuan Direktur: {docNo}', body: '{docNo} menunggu persetujuan Anda sebagai Direktur: {type} "{title}" {amount}.' },
  'expense.pending_approval': { title: 'Menunggu Approval: {docNo}', body: '{type} "{title}" {amount} menunggu persetujuan Anda.' },
  'expense.approved': { title: 'Disetujui: {docNo}', body: 'Pengajuan "{title}" {amount} disetujui.' },
  'expense.rejected': { title: 'Ditolak: {docNo}', body: 'Pengajuan "{title}" ditolak. Lihat alasan di detail pengajuan.' },
  'expense.cancelled': { title: 'Dibatalkan: {docNo}', body: 'Pengajuan "{title}" dibatalkan.' },
  'expense.receipt_revision': { title: 'Revisi Nota: {docNo}', body: 'Finance menolak nota pada pengajuan "{title}". Perbaiki nota lalu kirim ulang.' },
  'expense.receipts_verified': { title: 'Nota terverifikasi: {docNo}', body: 'Nota pengajuan "{title}" terverifikasi; menunggu transfer.' },
  'expense.transfer_queue': { title: 'Antri transfer: {docNo}', body: '{type} "{title}" {amount} siap ditransfer.' },
  'expense.receipts_to_verify': { title: 'Verifikasi nota: {docNo}', body: 'Reimburse "{title}" {amount} disetujui; nota menunggu verifikasi Finance.' },
  'expense.transferred': { title: 'Dana ditransfer: {docNo}', body: 'Dana pengajuan "{title}" telah ditransfer.' },
  'expense.lpj_submitted': { title: 'LPJ diajukan: {docNo}', body: 'LPJ pengajuan "{title}" menunggu verifikasi Finance.' },
  'expense.lpj_revision': { title: 'LPJ perlu revisi: {docNo}', body: 'Finance meminta revisi LPJ "{title}". Lihat catatan revisi.' },
  'expense.lpj_verified': { title: 'LPJ terverifikasi: {docNo}', body: 'LPJ "{title}" terverifikasi; menunggu penyelesaian selisih.' },
  'expense.completed': { title: 'Selesai: {docNo}', body: 'Pengajuan "{title}" selesai.' },
  'expense.submitted': { title: 'Diajukan: {docNo}', body: '{type} "{title}" {amount} telah diajukan dan menunggu persetujuan.' },
  'expense.withdrawn': { title: 'Ditarik ke Draft: {docNo}', body: 'Pengajuan "{title}" ditarik kembali ke Draft.' },
  'expense.created_on_behalf': { title: 'Pengajuan atas nama Anda: {docNo}', body: 'Draft {type} "{title}" {amount} dibuat atas nama Anda. Anda tercantum sebagai pemohon (Diajukan Oleh).' },
}

/** S3e: requester-side events that company-settings.notifyRequesterStatusEnabled can switch off. */
export const REQUESTER_STATUS_EVENTS: ReadonlySet<NotifyEvent> = new Set<NotifyEvent>(['expense.submitted', 'expense.withdrawn', 'expense.created_on_behalf'])

/** S3e: events that also send an email to the deciding user when company-settings.approvalEmailEnabled. */
export const APPROVAL_EMAIL_EVENTS: ReadonlySet<NotifyEvent> = new Set<NotifyEvent>(['expense.pending_ack', 'expense.pending_approval'])

type Doc = {
  id: number
  docNo?: string | null
  type: RequestType
  status: RequestStatus
  title: string
  grandTotal?: number | null
  approvedAmount?: number | null
  requesters?: unknown[] | null
  createdBy?: unknown
  currentLevel?: number | null
  approvalSnapshot?: ApprovalSnapshot | null
}

async function usersWithRole(req: PayloadRequest, role: Role): Promise<number[]> {
  const res = await req.payload.find({
    collection: 'users',
    where: { and: [{ roles: { in: [role] } }, { active: { equals: true } }] },
    depth: 0,
    pagination: false,
    select: { email: true },
    overrideAccess: true, // SYSTEM-READ: notification recipients by role
    req,
  })
  return res.docs.map((d) => d.id as number)
}

/** "Diajukan Oleh" employees' active user accounts + "Dibuat Oleh". */
async function people(req: PayloadRequest, doc: Doc): Promise<number[]> {
  const empIds = (doc.requesters ?? []).map((r) => relId(r)).filter((x): x is number => x !== undefined)
  const out = new Set<number>()
  const creator = relId(doc.createdBy)
  if (creator !== undefined) out.add(creator)
  if (empIds.length > 0) {
    const res = await req.payload.find({
      collection: 'users',
      where: { and: [{ employee: { in: empIds } }, { active: { equals: true } }] },
      depth: 0,
      pagination: false,
      select: { email: true },
      overrideAccess: true, // SYSTEM-READ: requester accounts (Q-28: employees without account get nothing)
      req,
    })
    for (const u of res.docs) out.add(u.id as number)
  }
  return [...out]
}

async function stepUsers(req: PayloadRequest, doc: Doc, kind: 'ack' | 'approval'): Promise<number[]> {
  const snap = doc.approvalSnapshot
  if (!snap) return []
  let ids: number[] = []
  if (kind === 'ack') {
    if (snap.acknowledgerUserId !== null) ids = [snap.acknowledgerUserId]
    else if (snap.acknowledgeBy === 'role' && snap.acknowledgeRole) ids = await usersWithRole(req, snap.acknowledgeRole)
  } else {
    const step = snap.steps.find((s) => s.level === (doc.currentLevel ?? 1))
    if (step?.approverUserId) ids = [step.approverUserId]
    else if (step?.approverRole) ids = await usersWithRole(req, step.approverRole)
  }
  // G1: requesters/creator can never decide → never asked to.
  const excluded = new Set(await people(req, doc))
  return ids.filter((x) => !excluded.has(x))
}

/** Events + recipients of one transition (pure mapping; recipients resolved lazily). */
export function eventsFor(prev: { status: RequestStatus; currentLevel?: number | null } | null, doc: Doc): Array<{ event: NotifyEvent; to: 'people' | 'finance' | 'ack' | 'approval' }> {
  const changed = !prev || prev.status !== doc.status
  if (!changed) {
    // multi-level approval: next level is waiting
    if (doc.status === 'pending_approval' && prev && prev.currentLevel !== doc.currentLevel) return [{ event: 'expense.pending_approval', to: 'approval' }]
    return []
  }
  // S3e (US-05): submit (Draft → waiting) also informs the other requesters / the creator.
  const submitted = prev?.status === 'draft' ? [{ event: 'expense.submitted' as const, to: 'people' as const }] : []
  switch (doc.status) {
    case 'pending_ack':
      return [{ event: 'expense.pending_ack', to: 'ack' }, ...submitted]
    case 'pending_approval':
      return [{ event: 'expense.pending_approval', to: 'approval' }, ...submitted]
    case 'approved':
      if (prev?.status === 'receipt_revision' || prev?.status === 'receipts_verified' || prev?.status === 'transferred') {
        return doc.type === 'advance' ? [{ event: 'expense.transfer_queue', to: 'finance' }] : [{ event: 'expense.receipts_to_verify', to: 'finance' }]
      }
      return [
        { event: 'expense.approved', to: 'people' },
        doc.type === 'advance' ? { event: 'expense.transfer_queue', to: 'finance' } : { event: 'expense.receipts_to_verify', to: 'finance' },
      ]
    case 'rejected':
      return [{ event: 'expense.rejected', to: 'people' }]
    case 'cancelled':
      return [{ event: 'expense.cancelled', to: 'people' }]
    case 'receipt_revision':
      return [{ event: 'expense.receipt_revision', to: 'people' }]
    case 'receipts_verified':
      return [
        { event: 'expense.receipts_verified', to: 'people' },
        { event: 'expense.transfer_queue', to: 'finance' },
      ]
    case 'transferred':
      return [{ event: 'expense.transferred', to: 'people' }]
    case 'lpj_submitted':
      return [{ event: 'expense.lpj_submitted', to: 'finance' }]
    case 'lpj_revision':
      return [{ event: 'expense.lpj_revision', to: 'people' }]
    case 'lpj_verified':
      return [{ event: 'expense.lpj_verified', to: 'people' }]
    case 'completed':
      return [{ event: 'expense.completed', to: 'people' }]
    case 'draft':
      // S3e (US-05): withdraw (waiting → Draft) informs the other requesters / the creator.
      return prev && (prev.status === 'pending_ack' || prev.status === 'pending_approval') ? [{ event: 'expense.withdrawn', to: 'people' }] : []
    default:
      return [] // receipts_complete: nobody to inform
  }
}

export function renderTemplate(tpl: string, doc: Doc): string {
  const vars: Record<string, string> = {
    docNo: doc.docNo ?? `#${doc.id}`,
    title: doc.title,
    amount: formatRupiah(doc.approvedAmount ?? doc.grandTotal ?? 0),
    status: statusLabel(doc.type, doc.status),
    type: REQUEST_TYPE_LABELS[doc.type],
  }
  return tpl.replace(/\{(docNo|title|amount|status|type)\}/g, (_, k: string) => vars[k] ?? '')
}

/** Active `notification-templates` text of `event`, else `fallback` (also used by E4/E7 reminders). */
export async function notificationTemplate(req: PayloadRequest, event: string, fallback: { title: string; body: string }): Promise<{ title: string; body: string }> {
  const res = await req.payload.find({
    collection: 'notification-templates',
    where: { and: [{ event: { equals: event } }, { active: { equals: true } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: admin-maintained texts
    req,
  })
  const t = res.docs[0] as { title?: string; body?: string; channel?: string } | undefined
  return t?.title && t.body ? { title: t.title, body: t.body } : fallback
}

async function template(req: PayloadRequest, event: NotifyEvent): Promise<{ title: string; body: string }> {
  return notificationTemplate(req, event, DEFAULTS[event])
}

export function pushEnabled(): boolean {
  return process.env.PUSH_FCM_ENABLED === 'true'
}

type NotifySettings = { requesterStatus: boolean; approvalEmail: boolean }

/** S3e toggles (company-settings): requester in-app events default ON, approval email default OFF. */
export async function notifySettings(req: PayloadRequest): Promise<NotifySettings> {
  const s = (await req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: notification toggles */, req })) as {
    notifyRequesterStatusEnabled?: boolean | null
    approvalEmailEnabled?: boolean | null
  }
  return { requesterStatus: s.notifyRequesterStatusEnabled !== false, approvalEmail: s.approvalEmailEnabled === true }
}

/**
 * S3e (US-26/US-41, S-04): email to a deciding user (Direktur / Finance) — same `sendEmail` job queue,
 * SMTP rate guard and retry as the E7 reminder emails; queued in the transition's transaction (no
 * mail for a rolled-back change). Text without amount and requester names (the mailbox leaves the
 * company network); the link opens the Persetujuan inbox.
 */
export function approvalEmail(doc: Doc, event: NotifyEvent, appUrl: string | undefined): { subject: string; text: string } {
  const no = doc.docNo ?? `#${doc.id}`
  const step = event === 'expense.pending_ack' ? 'persetujuan Anda sebagai Direktur (Diketahui)' : 'approval Anda'
  const base = appUrl ? `${appUrl.replace(/\/$/, '')}/admin/persetujuan` : null
  return {
    subject: `ProyekKas — Menunggu keputusan Anda: ${no}`.slice(0, 200),
    text: `Pengajuan ${no} (${REQUEST_TYPE_LABELS[doc.type]}) menunggu ${step}.\n\n${base ? `Buka Persetujuan: ${base}\n\n` : ''}Email otomatis ProyekKas. Pengaturan: Setting perusahaan → Notifikasi status pengajuan.\n`,
  }
}

/** Creates the in-app rows of one transition (+ queued approval emails). Returns the number of in-app rows written. */
export async function notifyTransition(req: PayloadRequest, prev: { status: RequestStatus; currentLevel?: number | null } | null, doc: Doc): Promise<number> {
  const all = eventsFor(prev, doc)
  if (all.length === 0) return 0
  const settings = await notifySettings(req)
  return deliver(req, doc, settings.requesterStatus ? all : all.filter((e) => !REQUESTER_STATUS_EVENTS.has(e.event)), settings)
}

/**
 * S3e (US-41): a request created on behalf of other requesters (Admin/Finance, or a creator listing
 * colleagues) informs those requesters' accounts. The creator (= actor) is never notified.
 */
export async function notifyCreated(req: PayloadRequest, doc: Doc): Promise<number> {
  const settings = await notifySettings(req)
  if (!settings.requesterStatus) return 0
  return deliver(req, doc, [{ event: 'expense.created_on_behalf', to: 'people' }], settings)
}

async function deliver(req: PayloadRequest, doc: Doc, events: Array<{ event: NotifyEvent; to: 'people' | 'finance' | 'ack' | 'approval' }>, settings: NotifySettings): Promise<number> {
  if (events.length === 0) return 0
  const actor = userId(req)
  let finance: number[] | null = null
  let written = 0
  const done = new Set<string>()
  for (const e of events) {
    let to: number[] = []
    if (e.to === 'people') to = await people(req, doc)
    else if (e.to === 'finance') to = finance ??= await usersWithRole(req, 'pk-finance')
    else to = await stepUsers(req, doc, e.to)
    const t = await template(req, e.event)
    for (const uid of to) {
      if (uid === actor || done.has(`${e.event}:${uid}`)) continue
      done.add(`${e.event}:${uid}`)
      if (settings.approvalEmail && APPROVAL_EMAIL_EVENTS.has(e.event)) {
        const m = approvalEmail(doc, e.event, process.env.APP_URL)
        await req.payload.jobs.queue({ task: 'sendEmail', input: { userId: uid, subject: m.subject, text: m.text }, req })
      }
      await req.payload.create({
        collection: 'notifications',
        data: {
          user: uid,
          event: e.event,
          title: renderTemplate(t.title, doc).slice(0, 160),
          body: renderTemplate(t.body, doc).slice(0, 1000),
          docType: 'expense_request',
          docId: String(doc.id),
          docNo: doc.docNo ?? null,
          pushStatus: pushEnabled() ? 'pending' : 'skipped',
        } as never,
        depth: 0,
        overrideAccess: true, // SYSTEM-WRITE: in-app notification of a committed-together transition
        req,
      })
      written++
    }
  }
  return written
}

/** Admin page of a notification's document, or null when there is none. S3e: used by the web notification page (/admin/notifikasi). */
export function notificationHref(docType: string | null | undefined, docId: string | null | undefined): string | null {
  if (!docId || !/^\d{1,10}$/.test(docId)) return null
  switch (docType) {
    case 'expense_request':
      return `/admin/collections/expense-requests/${docId}`
    case 'project':
      return `/admin/progress/project/${docId}`
    case 'progress_report':
      return `/admin/progress/laporan/${docId}`
    case 'budget_addendum':
      return `/admin/addendum/detail/${docId}`
    default:
      return null
  }
}
