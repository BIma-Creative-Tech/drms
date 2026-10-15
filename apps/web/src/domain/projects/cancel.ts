import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relId, userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { cancelAddendumForProject } from '@/domain/addendum/service'
import { ADDENDUM_STATUS_LABELS, type AddendumStatus } from '@/domain/addendum/rules'
import { requestStatusLabel } from '@/domain/expense/timeline'
import type { RequestStatus, RequestType } from '@/domain/expense/types'
import { cancelForProject } from '@/domain/expense/workflow'
import { cancelLoanForProject } from '@/domain/loans/service'
import { LOAN_STATUS_LABELS, type LoanStatus } from '@/domain/loans/rules'
import { mayCancelProject, PROJECT_CANCELLABLE, RecordError, requestCancellable } from '@/domain/soft-delete/service'
import { REASON_MAX, REASON_MIN } from '@/domain/soft-delete/registry'
import { getRequestTx } from '@/lib/tx'

type SQL = ReturnType<typeof sql>

/**
 * D1610 (ADR 0030, owner 2026-10-16) "Batalkan proyek": a project that is already USED is not deleted — it gets the
 * terminal status `dibatalkan` with a required reason, and everything of it that is still in flight is cancelled
 * in the SAME transaction, through the existing state machines (each document's own `cancel` transition, its
 * normal notifications and audit rows), with the reason "Proyek dibatalkan: <alasan>":
 * - pengajuan: draft / menunggu persetujuan; Pengajuan Baru disetujui; Reimburse disetujui / nota terverifikasi /
 *   revisi nota (state.ts `cancel` rows);
 * - addendum RAB: draft / menunggu;
 * - pinjaman antar project (as lender or borrower): draft / menunggu, disetujui without any repayment.
 * Documents that can no longer be cancelled — money already transferred (Ditransfer, Nota Lengkap, LPJ …), a loan
 * with a repayment — BLOCK the cancellation: 409 with the list, settle them first (LPJ / refund / repayment).
 * Finished documents (selesai, ditolak, dibatalkan, approved addenda, repaid loans) stay as they are.
 * `projectCancelPlan` is the dry run shown in the confirmation dialog; `cancelProject` re-computes it under the
 * project row lock, so the dialog can never cancel something it did not show without the refusal.
 */

export type PlanItem = {
  kind: 'expense_request' | 'budget_addendum' | 'project_loan'
  id: number
  docNo: string | null
  title: string
  status: string
  statusLabel: string
  /** Admin URL of the document. */
  href: string
}

export type CancelPlan = {
  project: { id: number; code: string; name: string; status: string; companyId: number | null }
  /** The caller may cancel the project now (permission + status), ignoring `blocking`. */
  allowed: boolean
  /** Why not (permission / status), null when allowed. */
  notAllowedReason: string | null
  /** Cancelled together with the project. */
  cancel: PlanItem[]
  /** In flight but not cancellable → the cancellation is refused until they are settled. */
  blocking: PlanItem[]
}

export type CancelResult = { project: CancelPlan['project'] & { cancelReason: string }; cancelled: PlanItem[] }

const fail = (status: number, code: string, message: string, details: Record<string, unknown> = {}): never => {
  throw new RecordError(status, message, code, details)
}

async function rows<T>(req: PayloadRequest, q: SQL): Promise<T[]> {
  const tx = await getRequestTx(req)
  return ((await tx.execute(q)) as unknown as { rows: T[] }).rows
}

const FINISHED_REQUEST = ['completed', 'cancelled', 'rejected']

type ProjectRow = { id: number; code: string | null; name: string | null; status: string; company_id: number | null }

async function loadProject(req: PayloadRequest, id: number, lock: boolean): Promise<ProjectRow> {
  const r = await rows<ProjectRow>(req, sql`SELECT id, code, name, status::text AS status, company_id FROM projects WHERE id = ${id} AND is_deleted IS NOT TRUE${lock ? sql` FOR UPDATE` : sql``}`)
  const p = r[0]
  if (!p) return fail(404, 'NOT_FOUND', 'Project tidak ditemukan.')
  const visible = await req.payload.count({ collection: 'projects', where: { id: { equals: id } }, overrideAccess: false, user: req.user, req }).catch(() => ({ totalDocs: 0 }))
  if (visible.totalDocs === 0) fail(404, 'NOT_FOUND', 'Project tidak ditemukan.')
  return p
}

async function planOf(req: PayloadRequest, p: ProjectRow): Promise<Pick<CancelPlan, 'cancel' | 'blocking'>> {
  const company = p.company_id ?? -1
  const cancel: PlanItem[] = []
  const blocking: PlanItem[] = []
  const requests = await rows<{ id: number; doc_no: string | null; title: string | null; status: RequestStatus; type: RequestType; payee_type: string | null; approval_snapshot: unknown; current_level: number | null }>(
    req,
    sql`SELECT id, doc_no, title, status::text AS status, type::text AS type, payee_type::text AS payee_type, approval_snapshot, current_level
        FROM expense_requests
        WHERE project_id = ${p.id} AND company_id = ${company} AND is_deleted IS NOT TRUE AND status::text NOT IN (${sql.join(FINISHED_REQUEST.map((s) => sql`${s}`), sql`, `)})
        ORDER BY id`,
  )
  for (const r of requests) {
    const item: PlanItem = {
      kind: 'expense_request',
      id: Number(r.id),
      docNo: r.doc_no,
      title: r.title ?? '',
      status: r.status,
      statusLabel: requestStatusLabel(r.type, r.status, r.approval_snapshot as never, r.current_level),
      href: `/admin/collections/expense-requests/${r.id}`,
    }
    ;(requestCancellable({ type: r.type, status: r.status, payeeType: r.payee_type }) ? cancel : blocking).push(item)
  }
  const addenda = await rows<{ id: number; doc_no: string | null; reason: string | null; status: AddendumStatus }>(
    req,
    sql`SELECT id, doc_no, reason, status::text AS status FROM budget_addenda
        WHERE project_id = ${p.id} AND company_id = ${company} AND status::text IN ('draft', 'pending_ack', 'pending_approval') ORDER BY id`,
  )
  for (const a of addenda) {
    cancel.push({ kind: 'budget_addendum', id: Number(a.id), docNo: a.doc_no, title: a.reason ?? 'Addendum RAB', status: a.status, statusLabel: ADDENDUM_STATUS_LABELS[a.status] ?? a.status, href: `/admin/addendum/detail/${a.id}` })
  }
  const loans = await rows<{ id: number; doc_no: string | null; status: LoanStatus; repaid_total: string | number | null; posted: number }>(
    req,
    sql`SELECT l.id, l.doc_no, l.status::text AS status, l.repaid_total,
          (SELECT count(*)::int FROM project_loan_repayments r WHERE r.loan_id = l.id AND r.status::text = 'posted') AS posted
        FROM project_loans l
        WHERE (l.lender_project_id = ${p.id} OR l.borrower_project_id = ${p.id}) AND l.company_id = ${company}
          AND l.status::text IN ('draft', 'pending_approval', 'approved', 'partially_repaid') ORDER BY l.id`,
  )
  for (const l of loans) {
    const repaidAny = Number(l.repaid_total ?? 0) > 0 || Number(l.posted) > 0
    const item: PlanItem = { kind: 'project_loan', id: Number(l.id), docNo: l.doc_no, title: 'Pinjaman antar project', status: l.status, statusLabel: LOAN_STATUS_LABELS[l.status] ?? l.status, href: `/admin/pinjaman/detail/${l.id}` }
    ;(l.status === 'partially_repaid' || (l.status === 'approved' && repaidAny) ? blocking : cancel).push(item)
  }
  return { cancel, blocking }
}

function permission(req: PayloadRequest, p: ProjectRow): string | null {
  if (!mayCancelProject(req, p.company_id)) return 'Hanya Direktur atau Admin PT yang dapat membatalkan project.'
  if (p.status === 'dibatalkan') return 'Project ini sudah dibatalkan.'
  if (!PROJECT_CANCELLABLE.includes(p.status)) return 'Hanya project berstatus Perencanaan, Berjalan, atau Ditunda yang dapat dibatalkan.'
  return null
}

const projectOf = (p: ProjectRow): CancelPlan['project'] => ({ id: Number(p.id), code: p.code ?? '', name: p.name ?? '', status: p.status, companyId: relId(p.company_id) ?? null })

/** GET /projects/{id}/cancel-plan — the dry run of the confirmation dialog (nothing changes). */
export async function projectCancelPlan(req: PayloadRequest, id: number): Promise<CancelPlan> {
  const p = await loadProject(req, id, false)
  const reason = permission(req, p)
  return { project: projectOf(p), allowed: reason === null, notAllowedReason: reason, ...(await planOf(req, p)) }
}

/** POST /projects/{id}/cancel — status `dibatalkan` + the cascade, one transaction (the caller's). */
export async function cancelProject(req: PayloadRequest, id: number, reasonRaw: string): Promise<CancelResult> {
  const reason = reasonRaw.trim()
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) fail(400, 'REASON_REQUIRED', `Alasan pembatalan wajib diisi (${REASON_MIN}–${REASON_MAX} karakter).`)
  const p = await loadProject(req, id, true)
  const refused = permission(req, p)
  if (refused) fail(mayCancelProject(req, p.company_id) ? 409 : 403, mayCancelProject(req, p.company_id) ? 'STATE_CONFLICT' : 'FORBIDDEN', refused)
  const plan = await planOf(req, p)
  if (plan.blocking.length > 0) {
    fail(409, 'PROJECT_HAS_OPEN_DOCUMENTS', `Project belum dapat dibatalkan: ${plan.blocking.length} dokumen sudah berjalan (dana sudah ditransfer / LPJ / pengembalian pinjaman). Selesaikan dulu (LPJ, refund, pengembalian), lalu ulangi.`, { blocking: plan.blocking })
  }
  const why = `Proyek dibatalkan: ${reason}`.slice(0, REASON_MAX)
  for (const item of plan.cancel) {
    if (item.kind === 'expense_request') await cancelForProject(req, item.id, why)
    else if (item.kind === 'budget_addendum') await cancelAddendumForProject(req, item.id, why)
    else await cancelLoanForProject(req, item.id, why)
  }
  await rows(req, sql`UPDATE projects SET status = 'dibatalkan', cancel_reason = ${reason}, cancelled_at = now(), cancelled_by_id = ${userId(req) ?? null}, updated_at = now() WHERE id = ${p.id}`)
  const count = (k: PlanItem['kind']) => plan.cancel.filter((x) => x.kind === k).length
  await writeAudit(req, [
    {
      action: 'status_change',
      docType: 'project',
      docId: String(p.id),
      docNo: p.code ?? undefined,
      field: 'status',
      oldValue: p.status,
      newValue: { status: 'dibatalkan', cancelledRequests: count('expense_request'), cancelledAddenda: count('budget_addendum'), cancelledLoans: count('project_loan') },
      statusFrom: p.status,
      statusTo: 'dibatalkan',
      reason,
      companyId: relId(p.company_id) ?? null,
    },
  ])
  return { project: { ...projectOf({ ...p, status: 'dibatalkan' }), cancelReason: reason }, cancelled: plan.cancel }
}
