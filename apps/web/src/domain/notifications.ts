import type { PayloadRequest } from 'payload'

import { relId, userId, type Role } from '@/access/roles'
import { formatRupiah } from '@/lib/money'
import { DEFAULT_TZ, startOfLocalDay } from '@/lib/time'

import { isNoApproval } from './expense/decision'
import type { ApprovalSnapshot } from './expense/rules'
import { requestStatusLabel } from './expense/timeline'
import { REQUEST_TYPE_LABELS, type RequestStatus, type RequestType } from './expense/types'
import { contextCompanyId, membersWithRole, settings, usersOfEmployees } from '@/domain/companies'

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
  // QA-18 (owner decision 2026-10-08): the team PM of the request's project
  | 'expense.team_submitted'

const DEFAULTS: Record<NotifyEvent, { title: string; body: string }> = {
  // ADR 0013 §10: "Diketahui" is the Direktur's approval; recipients = active Direktur (pk-owner)
  // holders minus requester/creator. pending_approval → the holders of the current level. ADR 0021
  // snapshots: pending_ack → the PM project (PM_ACK_DEFAULT text), pending_approval → the Direktur.
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
  'expense.team_submitted': { title: 'Pengajuan tim: {docNo}', body: '{type} "{title}" {amount} di project Anda telah diajukan dan menunggu persetujuan.' },
}

/**
 * ADR 0021: "Diketahui" of a PM project → Direktur snapshot is the PM's approval (the Direktur hears of
 * the request only after it, through `expense.pending_approval`; Finance after the Direktur).
 */
const PM_ACK_DEFAULT = { title: 'Persetujuan PM: {docNo}', body: '{docNo} menunggu persetujuan Anda sebagai PM project: {type} "{title}" {amount}.' }

/**
 * ADR 0024: the team PM hears of a Direktur's own request without approval when it reaches Finance (the
 * request never waits for a decision: Draft → "Menunggu persetujuan" → "Disetujui" in one transaction).
 */
const NO_APPROVAL_TEAM_DEFAULT = {
  title: 'Pengajuan Direktur: {docNo}',
  body: '{type} "{title}" {amount} di project Anda diajukan oleh Direktur — tanpa persetujuan (kebijakan PT), langsung ke antrian Finance.',
}

/** The waiting "Diketahui" is the PM project's (ADR 0021 snapshot). */
function pmAck(doc: Doc): boolean {
  const snap = doc.approvalSnapshot
  return !!snap && snap.acknowledgeBy === 'scope_manager' && (snap.decisionRoles?.length ?? 0) > 0
}

/**
 * QA-18 (owner decision 2026-10-08): the team PM of the request's PROJECT is informed of these steps —
 * submitted (→ "Menunggu Diketahui"/"Menunggu Approval": `expense.team_submitted`), rejected,
 * transferred, LPJ revision and completed (same events / texts as the requesters'). Requests on a cost
 * center have no team PM here. Recipients: see `teamPms`.
 */
export const PM_EVENTS: ReadonlySet<NotifyEvent> = new Set<NotifyEvent>(['expense.team_submitted', 'expense.rejected', 'expense.transferred', 'expense.lpj_revision', 'expense.completed'])

type Target = 'people' | 'finance' | 'ack' | 'approval' | 'pm'

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
  g1Exception?: string | null
  company?: unknown
  project?: unknown
}

/** Holders of `role` in the document's PT (ADR 0016 §5: recipients per PT). */
async function usersWithRole(req: PayloadRequest, role: Role, doc: Doc): Promise<number[]> {
  return membersWithRole(req, role, relId(doc.company) ?? (await contextCompanyId(req)))
}

/** "Diajukan Oleh" employees' active user accounts + "Dibuat Oleh". */
async function people(req: PayloadRequest, doc: Doc): Promise<number[]> {
  const empIds = (doc.requesters ?? []).map((r) => relId(r)).filter((x): x is number => x !== undefined)
  const out = new Set<number>()
  const creator = relId(doc.createdBy)
  if (creator !== undefined) out.add(creator)
  // Q-28: employees without account get nothing.
  for (const u of await usersOfEmployees(req, empIds, { activeOnly: true })) out.add(u)
  return [...out]
}

async function stepUsers(req: PayloadRequest, doc: Doc, kind: 'ack' | 'approval'): Promise<number[]> {
  const snap = doc.approvalSnapshot
  if (!snap) return []
  let ids: number[] = []
  if (kind === 'ack') {
    if (snap.acknowledgerUserId !== null) ids = [snap.acknowledgerUserId]
    else if (snap.acknowledgeBy === 'role' && snap.acknowledgeRole) ids = await usersWithRole(req, snap.acknowledgeRole, doc)
  } else {
    const step = snap.steps.find((s) => s.level === (doc.currentLevel ?? 1))
    if (step?.approverUserId) ids = [step.approverUserId]
    else if (step?.approverRole) ids = await usersWithRole(req, step.approverRole, doc)
  }
  // G1: requesters/creator can never decide → never asked to (ADR 0021: except the narrow exception —
  // the creator PM holds "Diketahui"; the requester Direktur the approval step only as the only Direktur).
  // Owner answer 2026-10-11: the requester Direktur is asked only under `direktur_via_pm_self` (only Direktur).
  const exempt = (snap.selfApproval === 'direktur_via_pm' || snap.selfApproval === 'direktur_via_pm_self') && doc.g1Exception === snap.selfApproval
  if (exempt && (kind === 'ack' || snap.selfApproval === 'direktur_via_pm_self')) return ids
  const excluded = new Set(await people(req, doc))
  return ids.filter((x) => !excluded.has(x))
}

/**
 * QA-18: team PMs of the request's project = the project's PM (`projects.pm`) + accounts of employees
 * with an active `team-assignments` row (role in project = pm, within its dates). PT scope rule (ADR 0016
 * "Scope rule", 2026-10-02): only users holding the PM role IN THE REQUEST's PT through an active
 * membership of an ACTIVE PT (membersWithRole), active accounts only. Requesters / creator get their own
 * event already (not repeated); the actor is skipped by `deliver`.
 */
async function teamPms(req: PayloadRequest, doc: Doc): Promise<number[]> {
  const project = relId(doc.project)
  const company = relId(doc.company)
  if (project === undefined || company === undefined) return []
  const pms = await projectPmUsers(req, project, company)
  if (pms.length === 0) return []
  const requesters = new Set(await people(req, doc))
  return pms.filter((u) => !requesters.has(u))
}

/** ADR 0021: the PM project who must approve now gets `expense.pending_ack`, not also `team_submitted`. */
function teamPmsFor(event: NotifyEvent, doc: Doc, pms: number[]): number[] {
  if (event !== 'expense.team_submitted' || doc.status !== 'pending_ack' || !pmAck(doc)) return pms
  const ack = doc.approvalSnapshot?.acknowledgerUserId ?? null
  return ack === null ? pms : pms.filter((u) => u !== ack)
}

/**
 * Active PM accounts of a project: `projects.pm` + active team-assignments with role pm, holding pk-pm
 * in the project's (active) PT. Shared by QA-18 (expense requests) and FR1 (field reports).
 */
export async function projectPmUsers(req: PayloadRequest, project: number, company: number): Promise<number[]> {
  const co = (await req.payload.findByID({ collection: 'companies', id: company, depth: 0, select: { active: true }, overrideAccess: true /* SYSTEM-READ: PT active (scope rule) */, req, disableErrors: true })) as {
    active?: boolean | null
  } | null
  if (!co || co.active === false) return []
  const p = (await req.payload.findByID({ collection: 'projects', id: project, depth: 0, select: { pm: true, company: true }, overrideAccess: true /* SYSTEM-READ: team PM of the project */, req, disableErrors: true })) as {
    pm?: unknown
    company?: unknown
  } | null
  if (!p || relId(p.company) !== company) return []
  const candidates = new Set<number>()
  const pm = relId(p.pm)
  if (pm !== undefined) candidates.add(pm)
  const now = new Date()
  const today = startOfLocalDay(now, process.env.TZ || DEFAULT_TZ).toISOString() // same window as access/scope.ts
  const assignments = await req.payload.find({
    collection: 'team-assignments',
    where: {
      and: [
        { project: { equals: project } },
        { roleInProject: { equals: 'pm' } },
        { or: [{ startDate: { exists: false } }, { startDate: { less_than_equal: now.toISOString() } }] },
        { or: [{ endDate: { exists: false } }, { endDate: { greater_than_equal: today } }] },
      ],
    },
    depth: 0,
    pagination: false,
    select: { employee: true },
    overrideAccess: true, // SYSTEM-READ: PM assignments of the project (recipients)
    req,
  })
  const emps = assignments.docs.map((a) => relId((a as { employee?: unknown }).employee)).filter((x): x is number => x !== undefined)
  for (const u of await usersOfEmployees(req, emps, { activeOnly: true })) candidates.add(u)
  if (candidates.size === 0) return []
  const pmsOfPt = new Set(await membersWithRole(req, 'pk-pm', company))
  return [...candidates].filter((u) => pmsOfPt.has(u)).sort((a, b) => a - b)
}

/** Events + recipients of one transition (pure mapping; recipients resolved lazily). */
export function eventsFor(prev: { status: RequestStatus; currentLevel?: number | null } | null, doc: Doc): Array<{ event: NotifyEvent; to: Target }> {
  if (isNoApproval(doc.approvalSnapshot) && prev && prev.status !== doc.status) {
    // ADR 0024: nobody decides — the transient "Menunggu persetujuan" is silent; on "Disetujui" Finance
    // (transfer queue / receipt verification), the other requesters and the team PM are informed.
    if (doc.status === 'pending_approval') return []
    if (doc.status === 'approved' && prev.status === 'pending_approval') {
      const base = baseEventsFor(prev, doc)
      return relId(doc.project) === undefined ? base : [...base, { event: 'expense.team_submitted', to: 'pm' }]
    }
  }
  const base = baseEventsFor(prev, doc)
  // QA-18: the team PM of the project hears about submit / reject / transfer / LPJ revision / completion
  if (relId(doc.project) === undefined || !prev || prev.status === doc.status) return base
  const pm: Array<{ event: NotifyEvent; to: Target }> = []
  if (prev.status === 'draft' && (doc.status === 'pending_ack' || doc.status === 'pending_approval')) pm.push({ event: 'expense.team_submitted', to: 'pm' })
  else if (doc.status === 'rejected') pm.push({ event: 'expense.rejected', to: 'pm' })
  else if (doc.status === 'transferred') pm.push({ event: 'expense.transferred', to: 'pm' })
  else if (doc.status === 'lpj_revision') pm.push({ event: 'expense.lpj_revision', to: 'pm' })
  else if (doc.status === 'completed') pm.push({ event: 'expense.completed', to: 'pm' })
  return [...base, ...pm]
}

function baseEventsFor(prev: { status: RequestStatus; currentLevel?: number | null } | null, doc: Doc): Array<{ event: NotifyEvent; to: Target }> {
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
    status: requestStatusLabel(doc.type, doc.status, doc.approvalSnapshot ?? null, doc.currentLevel ?? null),
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
export async function notifySettings(req: PayloadRequest, companyId?: number | null): Promise<NotifySettings> {
  const s = await settings(req, companyId)
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
  const step = event === 'expense.pending_ack' ? (pmAck(doc) ? 'persetujuan Anda sebagai PM project' : 'persetujuan Anda sebagai Direktur (Diketahui)') : 'approval Anda'
  const base = appUrl ? `${appUrl.replace(/\/$/, '')}/admin/persetujuan` : null
  return {
    subject: `RR Teams — Menunggu keputusan Anda: ${no}`.slice(0, 200),
    text: `Pengajuan ${no} (${REQUEST_TYPE_LABELS[doc.type]}) menunggu ${step}.\n\n${base ? `Buka Persetujuan: ${base}\n\n` : ''}Email otomatis RR Teams. Pengaturan: Setting perusahaan → Notifikasi status pengajuan.\n`,
  }
}

/** Creates the in-app rows of one transition (+ queued approval emails). Returns the number of in-app rows written. */
export async function notifyTransition(req: PayloadRequest, prev: { status: RequestStatus; currentLevel?: number | null } | null, doc: Doc): Promise<number> {
  const all = eventsFor(prev, doc)
  if (all.length === 0) return 0
  const settings = await notifySettings(req, relId(doc.company))
  return deliver(req, doc, settings.requesterStatus ? all : all.filter((e) => !REQUESTER_STATUS_EVENTS.has(e.event)), settings)
}

/**
 * S3e (US-41): a request created on behalf of other requesters (Admin/Finance, or a creator listing
 * colleagues) informs those requesters' accounts. The creator (= actor) is never notified.
 */
export async function notifyCreated(req: PayloadRequest, doc: Doc): Promise<number> {
  const settings = await notifySettings(req, relId(doc.company))
  if (!settings.requesterStatus) return 0
  return deliver(req, doc, [{ event: 'expense.created_on_behalf', to: 'people' }], settings)
}

async function deliver(req: PayloadRequest, doc: Doc, events: Array<{ event: NotifyEvent; to: Target }>, settings: NotifySettings): Promise<number> {
  if (events.length === 0) return 0
  const actor = userId(req)
  let finance: number[] | null = null
  let pms: number[] | null = null
  let written = 0
  const done = new Set<string>()
  for (const e of events) {
    let to: number[] = []
    if (e.to === 'people') to = await people(req, doc)
    else if (e.to === 'finance') to = finance ??= await usersWithRole(req, 'pk-finance', doc)
    else if (e.to === 'pm') to = teamPmsFor(e.event, doc, (pms ??= await teamPms(req, doc)))
    else to = await stepUsers(req, doc, e.to)
    const t =
      e.event === 'expense.pending_ack' && pmAck(doc)
        ? PM_ACK_DEFAULT
        : e.event === 'expense.team_submitted' && isNoApproval(doc.approvalSnapshot)
          ? NO_APPROVAL_TEAM_DEFAULT
          : await template(req, e.event)
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
          company: relId(doc.company) ?? null, // ADR 0016 §4 (PT label / filter)
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
    case 'project_loan':
      return `/admin/pinjaman/detail/${docId}`
    // FR1: field reports → the custom detail views (ADR 0020 web views)
    case 'service_report':
      return `/admin/laporan-servis/detail/${docId}`
    case 'unit_timesheet':
      return `/admin/unit-kontrak/timesheet/detail/${docId}`
    case 'aftersales_activity':
      return `/admin/aftersales/aktivitas/detail/${docId}`
    case 'daily_report':
      return `/admin/laporan-harian/detail/${docId}`
    default:
      return null
  }
}
