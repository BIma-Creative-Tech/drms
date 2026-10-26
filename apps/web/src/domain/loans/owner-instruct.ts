import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { hasRole, relId, userId, userRoles } from '@/access/roles'
import { writeAudit, writeAuditDetached } from '@/audit/writer'
import { membersWithRole } from '@/domain/companies'
import { actorContext, loadVisible, today, type RequestDoc } from '@/domain/expense/common'
import { lastLevel, type ApprovalSnapshot } from '@/domain/expense/rules'
import { allowedActions } from '@/domain/expense/state'
import { finalStepWaiting, FUND_INSUFFICIENT, fundGap } from '@/domain/fundcheck/rules'
import { auditFundInsufficient, FUND_VIEW_ROLES, fundCheckEnabled, lockFunds, pbFigures, projectLoansOfRequest, type ProjectLoanRef } from '@/domain/fundcheck/service'
import { parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { isClosedProjectStatus } from '@/domain/projects/status'
import { formatRupiah } from '@/lib/money'
import { requestMeta } from '@/lib/request-meta'
import { getRequestTx } from '@/lib/tx'

import { addDays, AUTO_LOAN_DUE_DAYS, instructAmountError, instructedLoanReason, isDate, LENDER_REASON_TEXTS, lenderCandidateReason, REASON_MIN, type LenderCandidateReason } from './rules'
import { LoanError, loanVars, notifyLoan, type LoanDoc } from './service'

/**
 * DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26, user decisions) "Instruksi pinjam antar proyek": an expense request of a
 * project mapped to a Pusat Biaya is checked at its final decision against THAT cash account only. While it is short the
 * final decider (normally the Owner, `pk-principal`; whoever the approval engine — ADR 0026, stored roles — lets take
 * that step) cannot approve; instead he picks an open project of the same PT whose own account has the dana bebas and
 * instructs an inter-project loan to the request's project:
 * - GET  /expense-requests/{id}/project-loan-lenders → `instructionInfo` (figures, candidates, the waiting loan);
 * - POST /expense-requests/{id}/project-loan → `instructProjectLoan`: one transaction, lock order of ADR 0029 §1 (request
 *   row → PT fund lock), the shortfall and the lender's dana bebas re-checked under the lock, a loan PJ/… born APPROVED
 *   (`submitter_role` owner, no Direktur / Owner level, audited `approve` field `ownerInstruction`), cash-backed lender
 *   account → borrower account, linked to the request (`expense_request_id`). It is a transfer order in Finance's Antrian
 *   Transfer like every approved loan (Finance notified); Finance executes it (KK lender / KM borrower, the lender's dana
 *   bebas re-checked again — service.ts `executeLoan`), the instructor is notified, and approves the request normally.
 * The request stays waiting at its final decision meanwhile; a second instruction is refused while one waits (the DB
 * index allows one); the existing loan cancel path (Direktur / Owner, before the transfer) frees it again.
 */

type Project = { id: number; code: string | null; name: string | null; status: string | null; companyId: number; accountId: number | null; accountName: string | null; accountActive: boolean; pm: number | null }

const n = (v: unknown): number => Number(v ?? 0)

async function projectsOf(req: PayloadRequest, where: { companyId: number } | { id: number }): Promise<Project[]> {
  const tx = await getRequestTx(req)
  const cond = 'id' in where ? sql`p.id = ${where.id}` : sql`p.company_id = ${where.companyId}`
  const r = (await tx.execute(sql`
    SELECT p.id, p.code, p.name, p.status::text AS status, p.company_id, p.pm_id, a.id AS aid, a.name AS aname, (a.active IS NOT FALSE) AS active
      FROM projects p LEFT JOIN cash_accounts a ON a.id = p.cash_account_id
     WHERE ${cond} ORDER BY p.code, p.id`)) as unknown as { rows: Array<{ id: number; code: string | null; name: string | null; status: string | null; company_id: number; pm_id: number | null; aid: number | null; aname: string | null; active: boolean | null }> }
  return r.rows.map((x) => ({
    id: Number(x.id),
    code: x.code,
    name: x.name,
    status: x.status,
    companyId: Number(x.company_id),
    accountId: x.aid === null ? null : Number(x.aid),
    accountName: x.aname,
    accountActive: x.aid !== null && x.active === true,
    pm: x.pm_id === null ? null : Number(x.pm_id),
  }))
}

const smallProject = (p: Project) => ({ id: p.id, code: p.code, name: p.name })

export type LenderCandidate = {
  project: { id: number; code: string | null; name: string | null }
  account: { id: number; name: string } | null
  available: number | null
  eligible: boolean
  reason: LenderCandidateReason | null
  reasonText: string | null
}

type Ctx = {
  doc: RequestDoc
  companyId: number
  borrower: Project
  account: { id: number; name: string; balance: number; commitments: number; available: number }
  needed: number
  shortfall: number
  pending: ProjectLoanRef | null
  /** null = the caller may instruct now; else the Indonesian reason. */
  cannot: string | null
}

/** The request, its project's account figures and whether the caller may instruct (no write; locks when asked). */
async function context(req: PayloadRequest, id: number, opts: { lock?: boolean } = {}): Promise<Ctx> {
  const doc = await loadVisible(req, id, { lock: opts.lock })
  const companyId = relId((doc as { company?: unknown }).company)
  // cash data (account figures of the PT's projects): the Kas roles of the request's PT only, like the fund panel
  if (companyId === undefined || !hasRole(req, FUND_VIEW_ROLES, companyId)) fail(403, 'FORBIDDEN', 'Hanya Finance / Direktur / Owner PT pengajuan yang melihat dana akun kas project.')
  const projectId = relId(doc.project)
  const borrower = projectId === undefined ? undefined : (await projectsOf(req, { id: projectId }))[0]
  if (!borrower || borrower.accountId === null) fail(409, 'STATE_CONFLICT', 'Pengajuan ini tidak punya project dengan akun kas (pusat biaya): dana dicek per PT — gunakan pinjaman antar-PT.')
  if (opts.lock) await lockFunds(req, [companyId!]) // ADR 0029 §1: request row lock → PT fund lock
  const f = await pbFigures(req, { id: borrower!.accountId!, name: borrower!.accountName ?? `#${borrower!.accountId}` })
  const needed = Math.round(n(doc.grandTotal))
  const shortfall = fundGap(needed, f.available)
  const pending = (await projectLoansOfRequest(req, id)).find((l) => l.awaitingTransfer) ?? null
  const snap = (doc.approvalSnapshot ?? null) as ApprovalSnapshot | null
  const atFinal = finalStepWaiting({ status: doc.status, currentLevel: doc.currentLevel ?? null, lastLevel: snap ? lastLevel(snap) : null })
  const acts = atFinal ? allowedActions(await actorContext(req, doc)) : []
  const decides = acts.includes('approve') || acts.includes('acknowledge')
  const cannot = !atFinal
    ? 'Instruksi pinjaman hanya di keputusan akhir pengajuan (biasanya Owner).'
    : !decides
      ? 'Hanya pemegang keputusan akhir pengajuan ini (Owner) yang dapat menginstruksikan pinjaman antar proyek.'
      : !(await fundCheckEnabled(req, companyId))
        ? 'Cek dana PT ini belum aktif: pengajuan dapat disetujui tanpa pinjaman.'
        : pending
          ? `Pinjaman ${pending.docNo ?? `#${pending.id}`} sudah diinstruksikan dan menunggu transfer Finance.`
          : shortfall <= 0
            ? 'Dana bebas akun kas project sudah cukup — pengajuan dapat disetujui.'
            : null
  return { doc, companyId: companyId!, borrower: borrower!, account: { id: f.accountId, name: f.name, balance: f.balance, commitments: f.commitments, available: f.available }, needed, shortfall, pending, cannot }
}

const fail = (status: number, code: string, message: string, field?: string): never => {
  throw new LoanError(status, message, code, field)
}

/** Lender candidates: open projects of the PT except the borrower, with their account's dana bebas (one figure per account). */
async function candidates(req: PayloadRequest, c: Ctx): Promise<LenderCandidate[]> {
  const figures = new Map<number, number>()
  const out: LenderCandidate[] = []
  for (const p of await projectsOf(req, { companyId: c.companyId })) {
    if (p.id === c.borrower.id || isClosedProjectStatus(p.status)) continue
    let available: number | null = null
    if (p.accountId !== null && p.accountActive) {
      if (!figures.has(p.accountId)) figures.set(p.accountId, (await pbFigures(req, { id: p.accountId, name: p.accountName ?? '' })).available)
      available = figures.get(p.accountId)!
    }
    const reason = lenderCandidateReason({ accountId: p.accountId, accountActive: p.accountActive, borrowerAccountId: c.account.id, available: available ?? 0, minAmount: Math.max(1, c.shortfall) })
    out.push({
      project: smallProject(p),
      account: p.accountId === null ? null : { id: p.accountId, name: p.accountName ?? `#${p.accountId}` },
      available,
      eligible: reason === null,
      reason,
      reasonText: reason === null ? null : LENDER_REASON_TEXTS[reason],
    })
  }
  // eligible first (largest dana bebas first), then the others by code (projectsOf order)
  return [...out.filter((x) => x.eligible).sort((a, b) => (b.available ?? 0) - (a.available ?? 0) || a.project.id - b.project.id), ...out.filter((x) => !x.eligible)]
}

/** GET /expense-requests/{id}/project-loan-lenders — the dialog of "Instruksi pinjam antar proyek" (web + APK). */
export async function instructionInfo(req: PayloadRequest, id: number) {
  const c = await context(req, id)
  const loanDate = await today(req, c.companyId)
  const p = c.pending
  return {
    requestId: c.doc.id,
    docNo: c.doc.docNo ?? null,
    title: c.doc.title,
    companyId: c.companyId,
    borrowerProject: smallProject(c.borrower),
    borrowerAccount: c.account,
    needed: c.needed,
    shortfall: c.shortfall,
    minAmount: c.shortfall,
    loanDate,
    defaultDueDate: addDays(loanDate, AUTO_LOAN_DUE_DAYS),
    canInstruct: c.cannot === null,
    cannotReason: c.cannot,
    pendingLoan: p ? { id: p.id, docNo: p.docNo, amount: p.amount, statusLabel: p.statusLabel, lenderProject: p.lenderProject, lenderAccount: p.lenderAccount } : null,
    candidates: await candidates(req, c),
  }
}

export type InstructInput = { lenderProjectId: number; amount: number; reason: string; dueDate?: string }

/** POST /expense-requests/{id}/project-loan — the instructed, approved loan (see the module comment). */
export async function instructProjectLoan(req: PayloadRequest, id: number, input: InstructInput): Promise<LoanDoc> {
  const uid = userId(req)
  if (uid === undefined) fail(401, 'FORBIDDEN', 'Unauthorized')
  const c = await context(req, id, { lock: true })
  const docNo = c.doc.docNo ?? `#${c.doc.id}`
  if (c.cannot !== null) {
    const forbidden = c.cannot.startsWith('Hanya')
    if (forbidden) {
      await writeAuditDetached(req, [{ action: 'access_denied', docType: 'expense_request', docId: String(id), docNo: c.doc.docNo ?? undefined, field: 'instruct_project_loan', newValue: { status: c.doc.status, roles: userRoles(req) }, reason: 'instruksi pinjam antar proyek: hanya pemegang keputusan akhir (DRMS 26/10)' }])
    }
    fail(forbidden ? 403 : 409, forbidden ? 'FORBIDDEN' : 'STATE_CONFLICT', c.cannot, forbidden ? undefined : 'lenderProjectId')
  }
  const note = (input.reason ?? '').trim()
  if (note.length < REASON_MIN) fail(400, 'VALIDATION', `Alasan wajib diisi (min. ${REASON_MIN} karakter).`, 'reason')
  const lender = (await projectsOf(req, { id: input.lenderProjectId }))[0]
  if (!lender || lender.companyId !== c.companyId) fail(404, 'NOT_FOUND', 'Project pemberi tidak ditemukan di PT pengajuan.', 'lenderProjectId')
  if (lender!.id === c.borrower.id) fail(400, 'VALIDATION', 'Project pemberi dan peminjam harus berbeda.', 'lenderProjectId')
  if (isClosedProjectStatus(lender!.status)) fail(409, 'STATE_CONFLICT', lender!.status === 'dibatalkan' ? 'Project pemberi pinjaman sudah dibatalkan.' : 'Project pemberi pinjaman sudah diarsipkan.', 'lenderProjectId')
  if (isClosedProjectStatus(c.borrower.status)) fail(409, 'STATE_CONFLICT', 'Project pengajuan sudah ditutup; pinjaman tidak dapat diinstruksikan.', 'lenderProjectId')
  const lenderAccount = lender!.accountId
  const why = lenderCandidateReason({ accountId: lenderAccount, accountActive: lender!.accountActive, borrowerAccountId: c.account.id, available: Number.MAX_SAFE_INTEGER, minAmount: 0 })
  if (why) fail(409, 'STATE_CONFLICT', LENDER_REASON_TEXTS[why], 'lenderProjectId')
  // the lender account's dana bebas under the PT fund lock (taken by `context`)
  const lf = await pbFigures(req, { id: lenderAccount!, name: lender!.accountName ?? `#${lenderAccount}` })
  if (lf.available < c.shortfall) {
    await auditFundInsufficient(req, { docType: 'expense_request', docId: id, docNo: c.doc.docNo }, 'instruct_project_loan', { companyId: c.companyId, balance: lf.balance, commitments: lf.commitments, available: lf.available, needed: c.shortfall }, c.companyId, lf)
    fail(409, FUND_INSUFFICIENT, `Dana bebas akun kas ${lf.name} (${formatRupiah(lf.available)}) tidak cukup untuk menutup kekurangan ${formatRupiah(c.shortfall)}. Pilih project lain.`, 'lenderProjectId')
  }
  const amountErr = instructAmountError(input.amount, { min: c.shortfall, max: lf.available })
  if (amountErr) fail(400, 'VALIDATION', amountErr.message, amountErr.path)
  const loanDate = await today(req, c.companyId)
  const dueDate = input.dueDate ?? addDays(loanDate, AUTO_LOAN_DUE_DAYS)
  if (!isDate(dueDate) || dueDate < loanDate) fail(400, 'VALIDATION', 'Jatuh tempo tidak boleh sebelum tanggal pinjaman.', 'dueDate')
  const { docNo: loanNo } = await allocateDocNo(req, 'project_loan', { companyId: c.companyId, date: parseBusinessDate(loanDate) })
  const now = new Date().toISOString()
  const loan = (await req.payload.create({
    collection: 'project-loans',
    data: {
      origin: 'manual',
      docNo: loanNo,
      lenderProject: lender!.id,
      borrowerProject: c.borrower.id,
      lenderCashAccount: lenderAccount,
      borrowerCashAccount: c.account.id,
      cashBacked: true,
      expenseRequest: id,
      kind: 'dana',
      amount: input.amount,
      reason: instructedLoanReason(note, docNo),
      loanDate,
      dueDate,
      status: 'approved',
      repaidTotal: 0,
      outstanding: input.amount,
      samePm: lender!.pm !== null && lender!.pm === c.borrower.pm,
      createdBy: uid!,
      submittedAt: now,
      decidedAt: now,
      decidedBy: uid!,
      approvalCycle: 0,
      approvalLevel: 0,
      submitterRole: 'owner',
      source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: instructed loan after the decider / fund checks above (DB: pk_project_loan_instruction_check)
    req,
  })) as unknown as LoanDoc
  await writeAudit(req, [
    {
      action: 'approve',
      docType: 'project_loan',
      docId: String(loan.id),
      docNo: loanNo,
      field: 'ownerInstruction',
      newValue: {
        ownerInstructed: true,
        requestId: id,
        requestNo: c.doc.docNo ?? null,
        amount: input.amount,
        needed: c.needed,
        shortfall: c.shortfall,
        borrowerProjectId: c.borrower.id,
        borrowerCashAccountId: c.account.id,
        borrowerAvailable: c.account.available,
        lenderProjectId: lender!.id,
        lenderCashAccountId: lenderAccount,
        lenderAvailable: lf.available,
      },
      reason: `Instruksi pinjam antar proyek oleh pemegang keputusan akhir untuk pengajuan ${docNo} (DRMS 26/10, tanpa persetujuan Direktur / Owner terpisah): ${note}`.slice(0, 1000),
      companyId: c.companyId,
    },
  ])
  const vars = loanVars(loan, { id: lender!.id, code: lender!.code ?? undefined, name: lender!.name ?? undefined }, { id: c.borrower.id, code: c.borrower.code ?? undefined, name: c.borrower.name ?? undefined }, {
    lenderAccount: lf.name,
    borrowerAccount: c.account.name,
    requestNo: docNo,
  })
  // Finance: the transfer order (existing template); the PMs of both projects: what happened
  await notifyLoan(req, loan, 'project_loan.disburse_pending', await membersWithRole(req, 'pk-finance', c.companyId), vars)
  await notifyLoan(req, loan, 'project_loan.owner_instructed', [lender!.pm, c.borrower.pm].filter((x): x is number => x !== null), vars)
  return loan
}
