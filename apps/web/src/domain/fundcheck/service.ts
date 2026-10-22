import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { hasExactRole, hasRole, relId, userId, type Role } from '@/access/roles'
import { writeAuditDetached } from '@/audit/writer'
import { failCoded } from '@/domain/coded-error'
import { companyRefs, membersWithRole } from '@/domain/companies'
import { isNoApproval, isNoApprovalRule } from '@/domain/expense/decision'
import { lastLevel, type ApprovalSnapshot } from '@/domain/expense/rules'
import { loadActiveRules } from '@/domain/expense/snapshot'
import { icLoanStatusLabel } from '@/domain/intercompany/loan-rules'
import { notificationTemplate, pushEnabled } from '@/domain/notifications'
import { formatRupiah } from '@/lib/money'
import { getRequestTx } from '@/lib/tx'

import {
  FUND_INSUFFICIENT,
  FUND_SHORTFALL_DEFAULT,
  FUND_SHORTFALL_EVENT,
  finalStepWaiting,
  fundGap,
  fundInsufficientMessage,
  fundLockKey,
  panelApplies,
  renderFundText,
  blockedDecisionText,
  effectiveAvailable,
  fundRoute,
  fundRouteText,
  type FundCheckStatus,
  type FundFigures,
  type FundRoute,
  type PbFigures,
} from './rules'

/**
 * ADR 0029 §1–§2: "Dana tersedia" of a PT, the per-PT advisory lock, the hard block at the final approval / the Owner's
 * submit, the read-only panel of the request detail and the Owner notification `expense.fund_shortfall`.
 * Figures come from the SQL functions `pk_fund_balance` / `pk_fund_commitments` (migration 20261015_100200) — the DB
 * backstop trigger `pk_expense_fund_guard` uses the same functions and the same lock key.
 * Availability figures are cash data: served only to the Kas roles of that PT (Finance, Direktur; an Owner holds the
 * Direktur role as an effective role).
 */
export const FUND_VIEW_ROLES: readonly Role[] = ['pk-finance', 'pk-owner']

const n = (v: unknown): number => Number(v ?? 0)

/**
 * Per-PT advisory locks (transaction scoped) in ASCENDING company id — the lock order of ADR 0029 §1 (request row lock →
 * fund lock(s) → account lock). Every operation that can lower a PT's available funds takes it: the fund check,
 * every ledger posting (`postEntry`), loan instruction / disbursement / repayment / voids, the PT grup transfer.
 */
export async function lockFunds(req: PayloadRequest, companyIds: ReadonlyArray<number | null | undefined>): Promise<void> {
  const tx = await getRequestTx(req)
  const ids = [...new Set(companyIds.filter((c): c is number => typeof c === 'number' && Number.isSafeInteger(c) && c > 0))].sort((a, b) => a - b)
  for (const id of ids) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${fundLockKey(id)}, 0))`)
}

/** Saldo dana / Komitmen / Dana tersedia of one PT (the SQL definition). */
export async function fundFigures(req: PayloadRequest, companyId: number): Promise<FundFigures> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT pk_fund_balance(${companyId}::integer)::text AS b, pk_fund_commitments(${companyId}::integer)::text AS c`)) as unknown as { rows: Array<{ b: string; c: string }> }
  const balance = n(r.rows[0]?.b)
  const commitments = n(r.rows[0]?.c)
  return { companyId, balance, commitments, available: balance - commitments }
}

/** The Pusat Biaya (cash account) a project is mapped to (ADR 0031), or null (no project / not mapped). */
export async function projectPusatBiaya(req: PayloadRequest, projectId: number | undefined): Promise<{ id: number; name: string } | null> {
  if (projectId === undefined) return null
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT a.id, a.name FROM projects p JOIN cash_accounts a ON a.id = p.cash_account_id WHERE p.id = ${projectId}`)) as unknown as { rows: Array<{ id: number; name: string }> }
  const a = r.rows[0]
  return a ? { id: Number(a.id), name: a.name } : null
}

/** Saldo / Komitmen / Dana bebas of one Pusat Biaya account (the SQL definition `pk_pb_balance` / `pk_pb_commitments`). */
export async function pbFigures(req: PayloadRequest, account: { id: number; name: string }): Promise<PbFigures> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT pk_pb_balance(${account.id}::integer)::text AS b, pk_pb_commitments(${account.id}::integer)::text AS c`)) as unknown as { rows: Array<{ b: string; c: string }> }
  const balance = n(r.rows[0]?.b)
  const commitments = n(r.rows[0]?.c)
  return { accountId: account.id, name: account.name, balance, commitments, available: balance - commitments }
}

export type RequestFunds = { pt: FundFigures; pb: PbFigures | null; available: number }

/** PT and Pusat Biaya figures of a request (ADR 0031 amendment): `available` = the larger of the two. */
export async function requestFunds(req: PayloadRequest, companyId: number, projectId: number | undefined): Promise<RequestFunds> {
  const pt = await fundFigures(req, companyId)
  const acc = await projectPusatBiaya(req, projectId)
  const pb = acc ? await pbFigures(req, acc) : null
  return { pt, pb, available: effectiveAvailable(pt.available, pb?.available ?? null) }
}

/** The figures that decided a check (stored on the decision row): the Pusat Biaya's when it alone covers the need. */
function decidingFigures(f: RequestFunds, needed: number): FundFigures {
  const pb = f.pb
  if (pb && fundRoute(needed, f.pt.available, pb.available) === 'pusat_biaya') return { companyId: f.pt.companyId, balance: pb.balance, commitments: pb.commitments, available: pb.available }
  return f.pt
}

/** `companies.fund_check_enabled` of a PT (read fresh, not from the settings cache: the switch may change any time). */
export async function fundCheckEnabled(req: PayloadRequest, companyId: number | null | undefined): Promise<boolean> {
  if (typeof companyId !== 'number') return false
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT coalesce(fund_check_enabled, false) AS on FROM companies WHERE id = ${companyId}`)) as unknown as { rows: Array<{ on: boolean }> }
  return r.rows[0]?.on === true
}

async function codeOf(req: PayloadRequest, companyId: number): Promise<string> {
  return (await companyRefs(req, [companyId]))[0]?.shortCode ?? `#${companyId}`
}

/** Audit row of a refused fund step, in its own transaction (the refused operation rolls back; the attempt stays). */
export async function auditFundInsufficient(
  req: PayloadRequest,
  doc: { docType: string; docId: number; docNo?: string | null },
  step: string,
  figures: FundFigures & { needed: number },
  companyId: number,
  pb: PbFigures | null = null,
): Promise<void> {
  await writeAuditDetached(req, [
    {
      action: 'fund_insufficient',
      docType: doc.docType,
      docId: String(doc.docId),
      docNo: doc.docNo ?? undefined,
      field: step,
      newValue: {
        companyId: figures.companyId,
        balance: figures.balance,
        commitments: figures.commitments,
        available: figures.available,
        needed: figures.needed,
        gap: fundGap(figures.needed, effectiveAvailable(figures.available, pb?.available ?? null)),
        ...(pb ? { pusatBiaya: pb } : {}),
      },
      reason: 'Dana tersedia PT tidak cukup (ADR 0029)',
      companyId,
    },
  ])
}

/** 409 FUND_INSUFFICIENT with the figures (problem+json extras) — after the audit row. */
export async function refuseFunds(req: PayloadRequest, doc: { docType: string; docId: number; docNo?: string | null }, step: string, f: FundFigures, needed: number, pb: PbFigures | null = null): Promise<never> {
  await auditFundInsufficient(req, doc, step, { ...f, needed }, f.companyId, pb)
  const available = effectiveAvailable(f.available, pb?.available ?? null)
  return failCoded(409, FUND_INSUFFICIENT, fundInsufficientMessage(await codeOf(req, f.companyId), { available, needed, pbName: pb?.name }), {
    companyId: f.companyId,
    balance: f.balance,
    commitments: f.commitments,
    available,
    needed,
    gap: fundGap(needed, available),
    ...(pb ? { pusatBiayaAccountId: pb.accountId, pusatBiayaName: pb.name, pusatBiayaAvailable: pb.available } : {}),
  })
}

/**
 * The hard block of ADR 0029 §1 at the decision that makes a request `approved` (final approval level, a final
 * "Diketahui", the Owner's own submit / receipt resubmit without approval). Only for a PT with the switch on; takes the
 * PT's fund lock, compares the request's grand total (not yet committed) with the larger of the Pusat Biaya's and the
 * PT's available funds (ADR 0031 amendment) and refuses with 409 FUND_INSUFFICIENT (audited `fund_insufficient`).
 * Returns the deciding figures for the decision row (null = no check).
 */
export async function checkFundsForApproval(req: PayloadRequest, doc: { id: number; docNo?: string | null; grandTotal?: number | null; company?: unknown; project?: unknown }, step: string): Promise<FundFigures | null> {
  const companyId = relId(doc.company)
  if (companyId === undefined || !(await fundCheckEnabled(req, companyId))) return null
  await lockFunds(req, [companyId])
  const f = await requestFunds(req, companyId, relId(doc.project))
  const needed = doc.grandTotal ?? 0
  if (needed > f.available) await refuseFunds(req, { docType: 'expense_request', docId: doc.id, docNo: doc.docNo }, step, f.pt, needed, f.pb)
  return decidingFigures(f, needed)
}

// ---------------------------------------------------------------- read side (panel, inbox, availability endpoint)

export type CommitmentItem = { kind: 'request' | 'shortfall' | 'loan' | 'project_loan'; id: number; docNo: string | null; amount: number; status: string }

/** The commitments behind the figure (largest first, max `limit`) — the panel lists them so the Owner sees which. */
export async function commitmentItems(req: PayloadRequest, companyId: number, limit = 20): Promise<CommitmentItem[]> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT * FROM (
      SELECT 'request' AS kind, r.id, r.doc_no, greatest(coalesce(r.approved_amount, 0) - coalesce(r.transferred_total, 0), 0) AS amount, r.status::text AS status
        FROM expense_requests r
       WHERE r.company_id = ${companyId}
         AND ((r.type::text = 'advance' AND r.status::text = 'approved') OR (r.type::text = 'reimburse' AND r.status::text IN ('approved', 'receipt_revision', 'receipts_verified')))
      UNION ALL
      SELECT 'shortfall', e.id, e.doc_no, -s.difference, 'lpj_verified'
        FROM settlements s JOIN expense_requests e ON e.id = s.request_id
       WHERE s.company_id = ${companyId} AND s.status::text = 'verified' AND s.settlement_type::text = 'shortfall' AND s.difference < 0
      UNION ALL
      SELECT 'loan', l.id, l.doc_no, l.amount, l.status
        FROM intercompany_loans l WHERE l.lender_company_id = ${companyId} AND l.status = 'instructed'
    ) x WHERE x.amount > 0 ORDER BY x.amount DESC, x.id LIMIT ${limit}`)) as unknown as { rows: Array<{ kind: CommitmentItem['kind']; id: number; doc_no: string | null; amount: string; status: string }> }
  return r.rows.map((x) => ({ kind: x.kind, id: Number(x.id), docNo: x.doc_no, amount: n(x.amount), status: x.status }))
}

/** The commitments of one Pusat Biaya account (same parts as `pk_pb_commitments`), largest first. */
export async function pbCommitmentItems(req: PayloadRequest, accountId: number, limit = 20): Promise<CommitmentItem[]> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT * FROM (
      SELECT 'request' AS kind, r.id, r.doc_no, greatest(coalesce(r.approved_amount, 0) - coalesce(r.transferred_total, 0), 0) AS amount, r.status::text AS status
        FROM expense_requests r JOIN projects p ON p.id = r.project_id
       WHERE p.cash_account_id = ${accountId}
         AND ((r.type::text = 'advance' AND r.status::text = 'approved') OR (r.type::text = 'reimburse' AND r.status::text IN ('approved', 'receipt_revision', 'receipts_verified')))
      UNION ALL
      SELECT 'shortfall', e.id, e.doc_no, -s.difference, 'lpj_verified'
        FROM settlements s JOIN expense_requests e ON e.id = s.request_id JOIN projects p ON p.id = e.project_id
       WHERE p.cash_account_id = ${accountId} AND s.status::text = 'verified' AND s.settlement_type::text = 'shortfall' AND s.difference < 0
      UNION ALL
      SELECT 'project_loan', l.id, l.doc_no, l.amount, l.status::text
        FROM project_loans l
       WHERE l.lender_cash_account_id = ${accountId} AND l.status::text = 'approved' AND coalesce(l.cash_backed, false) AND l.disbursed_at IS NULL
    ) x WHERE x.amount > 0 ORDER BY x.amount DESC, x.id LIMIT ${limit}`)) as unknown as { rows: Array<{ kind: CommitmentItem['kind']; id: number; doc_no: string | null; amount: string; status: string }> }
  return r.rows.map((x) => ({ kind: x.kind, id: Number(x.id), docNo: x.doc_no, amount: n(x.amount), status: x.status }))
}

/** Requests of the PT waiting at their FINAL decision (normally the Owner level) — not committed, shown on the panel. */
export async function waitingAtFinal(req: PayloadRequest, companyId: number, excludeId?: number): Promise<Array<{ id: number; docNo: string | null; title: string; needed: number }>> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT r.id, r.doc_no, r.title, coalesce(r.grand_total, 0) AS needed
      FROM expense_requests r
     WHERE r.company_id = ${companyId} AND r.id <> ${excludeId ?? -1}
       AND ((r.status::text = 'pending_approval'
             AND coalesce(r.current_level, 1) >= coalesce((SELECT max((s ->> 'level')::int) FROM jsonb_array_elements(coalesce(r.approval_snapshot -> 'steps', '[]'::jsonb)) s), 0))
         OR (r.status::text = 'pending_ack' AND jsonb_array_length(coalesce(r.approval_snapshot -> 'steps', '[]'::jsonb)) = 0))
     ORDER BY r.submitted_at NULLS LAST, r.id`)) as unknown as { rows: Array<{ id: number; doc_no: string | null; title: string; needed: string }> }
  return r.rows.map((x) => ({ id: Number(x.id), docNo: x.doc_no, title: x.title, needed: n(x.needed) }))
}

/** Accounts behind "Saldo dana" (active, without site) + the excluded site accounts (count, balance). */
export async function fundAccounts(req: PayloadRequest, companyId: number): Promise<{ accounts: Array<{ id: number; name: string; kind: string; balance: number }>; excludedSiteAccounts: { count: number; balance: number } }> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT a.id, a.name, a.kind::text AS kind, a.site_id,
           (coalesce(a.opening_balance, 0) + coalesce((SELECT sum(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END) FROM cash_entries e WHERE e.cash_account_id = a.id), 0))::text AS balance
      FROM cash_accounts a
     WHERE a.company_id = ${companyId} AND a.active IS NOT FALSE
     ORDER BY a.name, a.id`)) as unknown as { rows: Array<{ id: number; name: string; kind: string; site_id: number | null; balance: string }> }
  const pool = r.rows.filter((x) => x.site_id === null)
  const site = r.rows.filter((x) => x.site_id !== null)
  return {
    accounts: pool.map((x) => ({ id: Number(x.id), name: x.name, kind: x.kind, balance: n(x.balance) })),
    excludedSiteAccounts: { count: site.length, balance: site.reduce((s, x) => s + n(x.balance), 0) },
  }
}

/** GET /fund-availability?company= — Finance / Direktur / Owner of that PT (the caller's selection); else 403. */
export async function fundAvailability(req: PayloadRequest, companyId: number) {
  const f = await fundFigures(req, companyId)
  const acc = await fundAccounts(req, companyId)
  const ref = (await companyRefs(req, [companyId]))[0] ?? null
  return {
    companyId,
    company: ref,
    enabled: await fundCheckEnabled(req, companyId),
    balance: f.balance,
    commitments: f.commitments,
    available: f.available,
    accounts: acc.accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance })),
    excludedSiteAccounts: acc.excludedSiteAccounts,
    commitmentItems: await commitmentItems(req, companyId),
  }
}

export type FundPanel = {
  companyId: number
  company: { id: number; shortCode: string; name: string } | null
  /** `companies.fund_check_enabled` — off: the panel is information only (today's behaviour). */
  enabled: boolean
  /** The request's next decision (or the Owner's submit) is the one the check runs at. */
  applies: boolean
  status: FundCheckStatus
  /** enabled ∧ applies ∧ insufficient: "Setujui" (or "Kirim") is refused by the server (409 FUND_INSUFFICIENT). */
  blocked: boolean
  blockedText: string | null
  balance: number
  commitments: number
  available: number
  needed: number
  gap: number
  /** ADR 0031 amendment: where the money comes from (pusat_biaya | other_account | pt | short). */
  route: FundRoute
  routeText: string | null
  /** The project's Pusat Biaya account and its figures (null: no project / not mapped → checked per PT only). */
  pusatBiaya: (PbFigures & { commitmentItems: CommitmentItem[] }) | null
  accountCount: number
  excludedSiteAccounts: { count: number; balance: number }
  waitingAtOwner: { count: number; amount: number }
  commitmentItems: CommitmentItem[]
  /** `statusLabel` from `IC_LOAN_STATUS_LABELS` (the loan list / detail / queue use the same labels). */
  loans: Array<{ id: number; docNo: string; status: string; statusLabel: string; amount: number; lender: { id: number; shortCode: string } | null }>
}

/** Is a Draft the Owner's own request that will go straight to Finance (checked at submit)? */
async function ownerDraft(req: PayloadRequest, doc: { status: string; createdBy?: unknown }, companyId: number): Promise<boolean> {
  if (doc.status !== 'draft') return false
  const creator = relId(doc.createdBy)
  if (creator === undefined) return false
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM company_memberships m JOIN company_memberships_roles mr ON mr.parent_id = m.id
                    WHERE m.user_id = ${creator} AND m.company_id = ${companyId} AND coalesce(m.active, true) AND mr.value::text = 'pk-principal') AS ok`)) as unknown as { rows: Array<{ ok: boolean }> }
  if (r.rows[0]?.ok !== true) return false
  return (await loadActiveRules(req, 'expense_request', companyId)).some(isNoApprovalRule)
}

/** Loans instructed for this request (ADR 0029 §3.4 linked requests; informational). */
async function loansOfRequest(req: PayloadRequest, requestId: number): Promise<FundPanel['loans']> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT l.id, l.doc_no, l.status, l.amount, l.lender_company_id FROM intercompany_loan_requests x JOIN intercompany_loans l ON l.id = x.loan_id
     WHERE x.request_id = ${requestId} ORDER BY l.id`)) as unknown as { rows: Array<{ id: number; doc_no: string; status: string; amount: string; lender_company_id: number }> }
  const refs = new Map((await companyRefs(req, r.rows.map((x) => Number(x.lender_company_id)))).map((c) => [c.id, c]))
  return r.rows.map((x) => {
    const c = refs.get(Number(x.lender_company_id))
    return { id: Number(x.id), docNo: x.doc_no, status: x.status, statusLabel: icLoanStatusLabel(x.status), amount: n(x.amount), lender: c ? { id: c.id, shortCode: c.shortCode } : null }
  })
}

/**
 * `fundCheck` of the request detail (§6 API): for the Kas roles of the request's PT, while the request waits for a
 * decision (any step — the Direktur sees it read-only, "cek akhir di Owner") or is the Owner's own Draft. null for
 * everyone else / any other status. `instructLoan` = the caller may order a loan from here (Owner of the PT, short).
 */
export async function fundPanel(req: PayloadRequest, doc: { id: number; status: string; grandTotal?: number | null; company?: unknown; project?: unknown; createdBy?: unknown; currentLevel?: number | null; approvalSnapshot?: ApprovalSnapshot | null }): Promise<{ panel: FundPanel; instructLoan: boolean } | null> {
  const companyId = relId(doc.company)
  if (companyId === undefined || !hasRole(req, FUND_VIEW_ROLES, companyId)) return null
  const draftOwner = await ownerDraft(req, doc, companyId)
  if (!panelApplies({ status: doc.status, ownerDraft: draftOwner })) return null
  const snap = doc.approvalSnapshot ?? null
  if (snap && isNoApproval(snap) && doc.status !== 'draft') return null
  const enabled = await fundCheckEnabled(req, companyId)
  const rf = await requestFunds(req, companyId, relId(doc.project))
  const f = rf.pt
  const pb = rf.pb
  const needed = doc.grandTotal ?? 0
  const gap = fundGap(needed, rf.available)
  const route = fundRoute(needed, f.available, pb?.available ?? null)
  const status: FundCheckStatus = gap > 0 ? 'insufficient' : 'ok'
  const applies = finalStepWaiting({ status: doc.status, currentLevel: doc.currentLevel, lastLevel: snap ? lastLevel(snap) : null, ownerDraft: draftOwner })
  const blocked = enabled && applies && gap > 0
  const acc = await fundAccounts(req, companyId)
  const waiting = await waitingAtFinal(req, companyId, doc.id)
  return {
    panel: {
      companyId,
      company: (await companyRefs(req, [companyId]))[0] ?? null,
      enabled,
      applies,
      status,
      blocked,
      blockedText: blocked ? blockedDecisionText(gap, pb?.name) : null,
      balance: f.balance,
      commitments: f.commitments,
      available: f.available,
      needed,
      gap,
      route,
      routeText: fundRouteText(route, pb?.name ?? null, pb ? fundGap(needed, pb.available) : 0),
      pusatBiaya: pb ? { ...pb, commitmentItems: await pbCommitmentItems(req, pb.accountId) } : null,
      accountCount: acc.accounts.length,
      excludedSiteAccounts: acc.excludedSiteAccounts,
      waitingAtOwner: { count: waiting.length, amount: waiting.reduce((s, w) => s + w.needed, 0) },
      commitmentItems: await commitmentItems(req, companyId),
      loans: await loansOfRequest(req, doc.id),
    },
    instructLoan: gap > 0 && hasExactRole(req, 'pk-principal', companyId),
  }
}

/**
 * Approval inbox badge "Dana kurang Rp X" (§2): the gap of a row at its FINAL decision for a Kas viewer of a PT with the
 * switch on, else null. One availability per PT per call (`cache`); each request compared on its own (live).
 */
export type FundCache = { pt: Map<number, FundFigures | null>; pb: Map<number, PbFigures | null> }

export const newFundCache = (): FundCache => ({ pt: new Map(), pb: new Map() })

export async function inboxFundShort(req: PayloadRequest, row: { company?: unknown; project?: unknown; grandTotal?: number | null; finalStep: boolean }, cache: FundCache): Promise<number | null> {
  const companyId = relId(row.company)
  if (companyId === undefined || !row.finalStep || !hasRole(req, FUND_VIEW_ROLES, companyId)) return null
  if (!cache.pt.has(companyId)) cache.pt.set(companyId, (await fundCheckEnabled(req, companyId)) ? await fundFigures(req, companyId) : null)
  const f = cache.pt.get(companyId)
  if (!f) return null
  // ADR 0031 amendment: the project's Pusat Biaya first (one figure per account per call)
  const acc = await projectPusatBiaya(req, relId(row.project))
  if (acc && !cache.pb.has(acc.id)) cache.pb.set(acc.id, await pbFigures(req, acc))
  const pb = acc ? (cache.pb.get(acc.id) ?? null) : null
  const gap = fundGap(row.grandTotal ?? 0, effectiveAvailable(f.available, pb?.available ?? null))
  return gap > 0 ? gap : null
}

// ---------------------------------------------------------------- notification

type NotifyDoc = { id: number; docNo?: string | null; title: string; status: string; grandTotal?: number | null; currentLevel?: number | null; approvalSnapshot?: ApprovalSnapshot | null; company?: unknown; project?: unknown }

/** Did this transition bring the request to its final decision (the step the fund check runs at)? */
export function enteredFinalStep(prev: { status: string; currentLevel?: number | null }, doc: Pick<NotifyDoc, 'status' | 'currentLevel' | 'approvalSnapshot'>): boolean {
  const snap = doc.approvalSnapshot
  if (!snap || isNoApproval(snap)) return false
  const last = lastLevel(snap)
  if (doc.status === 'pending_approval') return (prev.status !== 'pending_approval' || prev.currentLevel !== doc.currentLevel) && (doc.currentLevel ?? 1) >= last
  if (doc.status === 'pending_ack') return prev.status !== 'pending_ack' && last === 0
  return false
}

/**
 * `expense.fund_shortfall` (§2) to the Owner(s) of the PT (STORED role pk-principal) when the request reaches its final
 * decision and the PT (switch on) is short at that moment — in addition to the normal `expense.pending_approval`. Once
 * per request and cycle (this transition happens once per cycle); the inbox badge is live. Same transaction as the
 * transition (expense-requests afterChange hook).
 */
export async function notifyFundShortfall(req: PayloadRequest, prev: { status: string; currentLevel?: number | null }, doc: NotifyDoc): Promise<number> {
  const companyId = relId(doc.company)
  if (companyId === undefined || !enteredFinalStep(prev, doc)) return 0
  if (!(await fundCheckEnabled(req, companyId))) return 0
  const f = await requestFunds(req, companyId, relId(doc.project))
  const needed = doc.grandTotal ?? 0
  const gap = fundGap(needed, f.available)
  if (gap <= 0) return 0
  const actor = userId(req)
  const to = (await membersWithRole(req, 'pk-principal', companyId)).filter((u) => u !== actor).sort((a, b) => a - b)
  if (to.length === 0) return 0
  const t = await notificationTemplate(req, FUND_SHORTFALL_EVENT, FUND_SHORTFALL_DEFAULT)
  const vars = { company: await codeOf(req, companyId), docNo: doc.docNo ?? `#${doc.id}`, title: doc.title, needed: formatRupiah(needed), available: formatRupiah(f.available), gap: formatRupiah(gap) }
  for (const uid of to) {
    await req.payload.create({
      collection: 'notifications',
      data: {
        user: uid,
        event: FUND_SHORTFALL_EVENT,
        title: renderFundText(t.title, vars).slice(0, 160),
        body: renderFundText(t.body, vars).slice(0, 1000),
        docType: 'expense_request',
        docId: String(doc.id),
        docNo: doc.docNo ?? null,
        company: companyId,
        pushStatus: pushEnabled() ? 'pending' : 'skipped',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: in-app notification of a committed-together transition (ADR 0029 §2)
      req,
    })
  }
  return to.length
}
