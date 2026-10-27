import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { auditRows, fixturePm, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, makeFlowUser, makeWorld, sysCreate, type FlowUser } from './flow-world'

/**
 * DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26) "Instruksi pinjam antar proyek" through the real API + DB guards.
 * A fresh fictional PT Q (fund check ON), the Owner (pk-principal) = the only (final) level, accounts A Rp 10 jt, B Rp 100 jt,
 * C Rp 2 jt; projects Q-A (A, borrower), Q-A2 (A too), Q-B (B), Q-C (C), Q-N (no account):
 *  1. a 30 jt request of Q-A: the PT has 112 jt but A only 10 jt free → blocked, 409, `instruct_project_loan`, inbox row;
 *  2. lender candidates (Owner only may instruct; Finance reads; Staff 403): B eligible, C below the shortfall, A2 the
 *     same account, N no account;
 *  3. refusals (Finance 403 audited, C 409 FUND_INSUFFICIENT, amount < shortfall / > dana bebas 400), then the instruction:
 *     an approved PJ loan linked to the request (no decision rows), Finance notified, transfer order in Antrian Transfer,
 *     the request still blocked ("menunggu transfer Finance"), a second instruction 409; DB: the link is immutable, a
 *     raw instructed loan by a non-decider is refused;
 *  4. Finance executes (KK B / KM A) → the Owner is notified (request_ready) and approves normally;
 *  5. the lender's dana bebas is re-checked at the execution (409 when it dropped); the Owner cancels and may instruct again.
 * Q is deactivated in afterAll.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))

const E = '/api/v1/expense-requests'
const L = '/api/v1/project-loans'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const JT = 1_000_000

let Q = 0
let staff: FlowUser
let owner: FlowUser
let finance: FlowUser
let staffEmp = 0
let accStaff = 0
let accA = 0
let accB = 0
let accC = 0
let cat = 0
let uom = 0
const p: Record<'A' | 'A2' | 'B' | 'C' | 'N', number> = { A: 0, A2: 0, B: 0, C: 0, N: 0 }

async function ok(r: Promise<{ status: number; body: any }>, status = 200) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const x = await r
  expect(x.status, JSON.stringify(x.body)).toBe(status)
  return x.body
}

const free = async (acc: number) => Number((await sqlAs('app', 'SELECT (pk_pb_balance($1) - pk_pb_commitments($1))::bigint AS a', [acc])).rows[0].a)
const notified = async (event: string, docType: string, docId: number) =>
  (await sqlAs('app', 'SELECT user_id::int AS u FROM notifications WHERE event = $1 AND doc_type = $2 AND doc_id = $3 ORDER BY user_id', [event, docType, String(docId)])).rows.map((r) => r.u as number)

beforeAll(async () => {
  await makeWorld('POL')
  const pl = await getTestPayload()
  const n = Date.now() % 1000
  Q = await sysCreate('companies', { name: 'PT Contoh Instruksi Pinjaman', shortCode: `POL${n}`, timezone: 'Asia/Makassar' })
  const bank = (await pl.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  uom = (await pl.find({ collection: 'uoms', where: { code: { equals: 'LS' } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  const account = (name: string, opening: number, no: string) => sysCreate('cash-accounts', { company: Q, name, kind: 'bank', bank, accountNo: `${no}${Date.now() % 1e9}`, accountHolder: 'PT Contoh Instruksi Pinjaman', openingBalance: opening, openingBalanceDate: '2020-01-01' })
  accA = await account('Kas Contoh A', 10 * JT, '81')
  accB = await account('Kas Contoh B', 100 * JT, '82')
  accC = await account('Kas Contoh C', 2 * JT, '83')
  cat = await sysCreate('expense-categories', { company: Q, code: 'MAT', name: 'Material' })
  staffEmp = await sysCreate('employees', { company: Q, code: 'POL-STF', name: 'POL Staf' })
  staff = await makeFlowUser(['pk-staff'], 'pol-staff', staffEmp, { company: Q })
  owner = await makeFlowUser(['pk-principal'], 'pol-owner', null, { company: Q })
  finance = await makeFlowUser(['pk-finance'], 'pol-finance', null, { company: Q })
  accStaff = await sysCreate('employee-bank-accounts', { employee: staffEmp, bank, accountNo: `84${Date.now() % 1e9}`, accountHolder: 'POL Staf', isDefault: true, verificationStatus: 'verified' })
  const pm = await fixturePm(Q)
  const project = async (code: string, cashAccount: number | null) => {
    const id = await sysCreate('projects', { company: Q, code, name: `POL Proyek ${code}`, pm, budget: 0, status: 'berjalan', cashAccount })
    await sysCreate('team-assignments', { company: Q, employee: staffEmp, project: id, roleInProject: 'staff' })
    await sysCreate('approval-rules', { company: Q, name: `POL Owner ${code}`, docType: 'expense_request', requestType: 'any', minAmount: 0, priority: 10, project: id, acknowledge: 'none', acknowledgeBy: 'role', acknowledgeRole: null, steps: [{ level: 1, approverRole: 'pk-principal' }], active: true })
    return id
  }
  p.A = await project('POL-A', accA)
  p.A2 = await project('POL-A2', accA)
  p.B = await project('POL-B', accB)
  p.C = await project('POL-C', accC)
  p.N = await project('POL-N', null)
  await sqlAs('owner', 'UPDATE companies SET fund_check_enabled = true WHERE id = $1', [Q])
}, 600_000)

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const pl = await getTestPayload()
  if (Q) {
    await sqlAs('owner', 'UPDATE companies SET fund_check_enabled = false WHERE id = $1', [Q])
    await pl.update({ collection: 'companies', id: Q, data: { active: false, changeReason: 'uji instruksi pinjaman selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  }
  await pl.destroy()
})

/** Staff request through submit → its id (waiting at the Owner = the final level). */
async function request(project: number, amount: number): Promise<number> {
  const d = await ok(
    api('POST', E, staff, {
      type: 'advance',
      title: `Material ${amount / JT} jt`,
      projectId: project,
      requesterIds: [staffEmp],
      bankAccountId: accStaff,
      neededDate: '2026-12-31',
      lines: [{ description: 'Material proyek', qty: 1, uomId: uom, unitPrice: amount, total: amount, categoryId: cat }],
    }, key()),
    201,
  )
  await ok(api('POST', `${E}/${d.id}/submit`, staff, {}, key()))
  return d.id as number
}

const lenders = (u: FlowUser, id: number) => api('GET', `${E}/${id}/project-loan-lenders`, u)
const instruct = (u: FlowUser, id: number, body: Record<string, unknown>) => api('POST', `${E}/${id}/project-loan`, u, body, key())
type Cand = { project: { id: number }; account: { id: number } | null; available: number | null; eligible: boolean; reason: string | null }
const cand = (body: { candidates: Cand[] }, project: number) => body.candidates.find((c) => c.project.id === project)

let r1 = 0
let loan1 = 0

describe('d2610: the project cash account only; the Owner instructs an inter-project loan', () => {
  it('1. the PT has the money, the account not → blocked, 409, instruct_project_loan, inbox row', async () => {
    r1 = await request(p.A, 30 * JT)
    const d = await ok(api('GET', `${E}/${r1}`, owner))
    expect(d.fundCheck).toMatchObject({ enabled: true, applies: true, status: 'insufficient', blocked: true, route: 'short', gap: 20 * JT, available: 112 * JT, projectLoans: [], projectLoanPending: false })
    expect(d.fundCheck.pusatBiaya).toMatchObject({ accountId: accA, available: 10 * JT })
    expect(d.allowedActions).toEqual(expect.arrayContaining(['approve', 'reject', 'instruct_project_loan']))
    expect(d.allowedActions).not.toContain('instruct_loan')
    const a = await api('POST', `${E}/${r1}/approve`, owner, {}, key())
    expect(a.status).toBe(409)
    expect(a.body).toMatchObject({ code: 'FUND_INSUFFICIENT', available: 10 * JT, gap: 20 * JT, pusatBiayaAccountId: accA })
    const inbox = await ok(api('GET', '/api/v1/approvals/inbox', owner))
    expect(inbox.items.find((i: { id: number }) => i.id === r1)).toMatchObject({ finalStep: true, fundShort: 20 * JT, instructProjectLoan: true, projectLoanPending: null })
    // the Owner was told at submit — the account's own event / text
    expect(await notified('expense.fund_shortfall_account', 'expense_request', r1)).toEqual([owner.id])
  })

  it('2. lender candidates: Owner may instruct, Finance reads only, Staff 403', async () => {
    const b = await ok(lenders(owner, r1))
    expect(b).toMatchObject({ requestId: r1, needed: 30 * JT, shortfall: 20 * JT, minAmount: 20 * JT, canInstruct: true, cannotReason: null, pendingLoan: null, borrowerAccount: { id: accA, available: 10 * JT } })
    expect(b.candidates.map((c: Cand) => c.project.id)).not.toContain(p.A)
    expect(b.candidates[0]).toMatchObject({ project: { id: p.B }, account: { id: accB }, available: 100 * JT, eligible: true, reason: null })
    expect(cand(b, p.C)).toMatchObject({ eligible: false, reason: 'insufficient', available: 2 * JT })
    expect(cand(b, p.A2)).toMatchObject({ eligible: false, reason: 'same_account' })
    expect(cand(b, p.N)).toMatchObject({ eligible: false, reason: 'no_account', account: null, available: null })
    const f = await ok(lenders(finance, r1))
    expect(f).toMatchObject({ canInstruct: false })
    expect(f.cannotReason).toContain('Hanya pemegang keputusan akhir')
    expect((await lenders(staff, r1)).status).toBe(403)
  })

  it('3. refusals, then the instruction: approved PJ loan linked to the request, transfer order, request still blocked', async () => {
    const byFinance = await instruct(finance, r1, { lenderProjectId: p.B, amount: 20 * JT, reason: 'uji Finance' })
    expect(byFinance.status).toBe(403)
    expect((await auditRows('expense_request', r1)).some((r) => r.action === 'access_denied' && r.field === 'instruct_project_loan')).toBe(true)
    const poor = await instruct(owner, r1, { lenderProjectId: p.C, amount: 20 * JT, reason: 'dari C' })
    expect(poor.status).toBe(409)
    expect(poor.body.code).toBe('FUND_INSUFFICIENT')
    expect((await instruct(owner, r1, { lenderProjectId: p.A2, amount: 20 * JT, reason: 'akun sama' })).status).toBe(409)
    expect((await instruct(owner, r1, { lenderProjectId: p.B, amount: 19 * JT, reason: 'kurang' })).status).toBe(400)
    expect((await instruct(owner, r1, { lenderProjectId: p.B, amount: 101 * JT, reason: 'lebih' })).status).toBe(400)
    expect((await instruct(owner, r1, { lenderProjectId: p.B, amount: 25 * JT, reason: 'x' })).status).toBe(400)

    const d = await ok(instruct(owner, r1, { lenderProjectId: p.B, amount: 25 * JT, reason: 'Termin klien Q-A belum cair' }), 201)
    expect(d.fundCheck).toMatchObject({ blocked: true, projectLoanPending: true })
    expect(d.fundCheck.projectLoans).toHaveLength(1)
    expect(d.fundCheck.projectLoans[0]).toMatchObject({ amount: 25 * JT, awaitingTransfer: true, statusLabel: 'Disetujui – menunggu transfer Finance', lenderProject: { id: p.B }, lenderAccount: { id: accB } })
    expect(d.fundCheck.blockedText).toContain('menunggu transfer Finance')
    expect(d.allowedActions).not.toContain('instruct_project_loan')
    loan1 = d.fundCheck.projectLoans[0].id
    const row = (await sqlAs('app', 'SELECT status::text AS s, submitter_role::text AS role, expense_request_id::int AS r, approval_level::int AS lvl, cash_backed AS cash, lender_cash_account_id::int AS la, borrower_cash_account_id::int AS ba, created_by_id::int AS c, decided_by_id::int AS dby, disbursed_at FROM project_loans WHERE id = $1', [loan1])).rows[0]
    expect(row).toMatchObject({ s: 'approved', role: 'owner', r: r1, lvl: 0, cash: true, la: accB, ba: accA, c: owner.id, dby: owner.id, disbursed_at: null })
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM approvals WHERE loan_id = $1', [loan1])).rows[0].n).toBe(0)
    expect((await auditRows('project_loan', loan1)).find((r) => r.action === 'approve' && r.field === 'ownerInstruction')?.new_value).toMatchObject({ v: { ownerInstructed: true, requestId: r1, shortfall: 20 * JT } })
    expect(await notified('project_loan.disburse_pending', 'project_loan', loan1)).toEqual([finance.id])
    // the lender account reserves it; the borrower account is credited only by the transfer
    expect(await free(accB)).toBe(75 * JT)
    expect(await free(accA)).toBe(10 * JT)
    // loan detail / transfer order
    const l = await ok(api('GET', `${L}/${loan1}`, owner))
    expect(l).toMatchObject({ submitterRole: 'owner', originLabel: 'Instruksi Owner', awaitingDisbursement: true, expenseRequest: { id: r1 } })
    const orders = await ok(api('GET', `${L}/transfer-orders`, finance))
    const order = orders.items.find((i: { key: string }) => i.key === `loan-${loan1}`)
    expect(order).toMatchObject({ canExecute: true, amount: 25 * JT, fromAccount: { id: accB }, toAccount: { id: accA } })
    expect(order.note).toContain('Instruksi Owner untuk pengajuan')
    // no duplicate; approve still refused; inbox shows the waiting loan
    expect((await instruct(owner, r1, { lenderProjectId: p.B, amount: 20 * JT, reason: 'dua kali' })).status).toBe(409)
    expect((await api('POST', `${E}/${r1}/approve`, owner, {}, key())).status).toBe(409)
    const inbox = await ok(api('GET', '/api/v1/approvals/inbox', owner))
    expect(inbox.items.find((i: { id: number }) => i.id === r1)).toMatchObject({ instructProjectLoan: false, projectLoanPending: { id: loan1 } })
    const info = await ok(lenders(owner, r1))
    expect(info).toMatchObject({ canInstruct: false, pendingLoan: { id: loan1 } })
  })

  it('3b. DB: the link is immutable; a raw instructed loan by a non-decider is refused', async () => {
    expect(await sqlError('app', 'UPDATE project_loans SET expense_request_id = NULL WHERE id = $1', [loan1])).not.toBeNull()
    const r2 = await request(p.C, 5 * JT)
    const err = await sqlError(
      'app',
      `INSERT INTO project_loans (company_id, doc_no, origin, lender_project_id, borrower_project_id, lender_cash_account_id, borrower_cash_account_id, cash_backed, kind, amount, reason, loan_date, due_date, status, repaid_total, outstanding, created_by_id, submitted_at, decided_at, decided_by_id, approval_level, approval_cycle, submitter_role, expense_request_id)
       VALUES ($1, 'PJ/UJI/RAW/1', 'manual', $2, $3, $4, $5, true, 'dana', 3000000, 'uji mentah', '2026-10-26', '2026-11-25', 'approved', 0, 3000000, $6, now(), now(), $6, 0, 0, 'owner', $7)`,
      [Q, p.B, p.C, accB, accC, finance.id, r2],
    )
    expect(err?.code).toBe('42501')
    expect(err?.message).toContain('final decider')
    await ok(api('POST', `${E}/${r2}/reject`, owner, { reason: 'uji selesai' }, key()))
  })

  it('4. Finance executes (KK B / KM A) → the Owner is notified and approves normally', async () => {
    const x = await ok(api('POST', `${L}/${loan1}/execute`, finance, {}, key()))
    expect(x).toMatchObject({ awaitingDisbursement: false, disbursedBy: { id: finance.id } })
    const legs = (await sqlAs('app', 'SELECT direction::text AS d, cash_account_id::int AS a, amount::bigint AS m FROM cash_entries WHERE project_loan_id = $1 ORDER BY direction::text', [loan1])).rows
    expect(legs).toEqual([
      { d: 'in', a: accA, m: String(25 * JT) },
      { d: 'out', a: accB, m: String(25 * JT) },
    ])
    expect(await notified('project_loan.request_ready', 'expense_request', r1)).toEqual([owner.id])
    const d = await ok(api('GET', `${E}/${r1}`, owner))
    expect(d.fundCheck).toMatchObject({ status: 'ok', blocked: false, gap: 0, route: 'pusat_biaya', projectLoanPending: false })
    expect(d.fundCheck.projectLoans[0]).toMatchObject({ id: loan1, awaitingTransfer: false })
    expect(d.allowedActions).not.toContain('instruct_project_loan')
    expect((await ok(api('POST', `${E}/${r1}/approve`, owner, {}, key()))).status).toBe('approved')
    expect(await free(accA)).toBe(5 * JT)
  })

  it('5. the lender is re-checked at the execution; the Owner cancels and may instruct again', async () => {
    const r3 = await request(p.C, 5 * JT)
    const d = await ok(instruct(owner, r3, { lenderProjectId: p.B, amount: 3 * JT, reason: 'Tutup kekurangan Q-C' }), 201)
    const loan = d.fundCheck.projectLoans[0].id as number
    expect(await free(accB)).toBe(72 * JT)
    // B's balance drops by other means (e.g. a payment from it) → the transfer order no longer fits
    await sqlAs('owner', 'ALTER TABLE cash_accounts DISABLE TRIGGER cash_accounts_opening_lock')
    try {
      await sqlAs('owner', 'UPDATE cash_accounts SET opening_balance = opening_balance - $2 WHERE id = $1', [accB, 73 * JT])
      const x = await api('POST', `${L}/${loan}/execute`, finance, {}, key())
      expect(x.status).toBe(409)
      expect(x.body.code).toBe('FUND_INSUFFICIENT')
      expect((await auditRows('project_loan', loan)).some((r) => r.action === 'fund_insufficient')).toBe(true)
      await sqlAs('owner', 'UPDATE cash_accounts SET opening_balance = opening_balance + $2 WHERE id = $1', [accB, 73 * JT])
    } finally {
      await sqlAs('owner', 'ALTER TABLE cash_accounts ENABLE TRIGGER cash_accounts_opening_lock')
    }
    expect((await ok(api('POST', `${L}/${loan}/cancel`, owner, { reason: 'instruksi ulang' }, key()))).status).toBe('cancelled')
    const info = await ok(lenders(owner, r3))
    expect(info).toMatchObject({ canInstruct: true, pendingLoan: null, shortfall: 3 * JT })
  })
})
