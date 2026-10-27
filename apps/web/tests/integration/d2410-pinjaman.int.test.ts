import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { addDays } from '@/domain/expense/types'
import { resetRateLimits } from '@/lib/rate-limit'

import { auditRows, companyId, getTestPayload, installLocalJwks, sqlAs, sqlError } from './helpers'
import { api, makeFlowUser, makeWorld, sysCreate, type FlowUser, type World } from './flow-world'

/**
 * DRMS 24/10 #10–#12 (ADR 0022 / 0031 amendment 2026-10-24) through the real API + DB guards:
 * - Finance files an inter-project loan (borrower PM notified); Direktur (level 1) → Owner (level 2), G1 in the service
 *   AND the DB (level order, stored roles, creator never at level 2);
 * - the approved cash-backed loan is a transfer order; the Finance user who filed it may execute it (legacy `/disburse`
 *   too) — audited `selfExecuted`;
 * - repayment requests: PM / Finance submit (planned date, ≤ the part not yet requested), Direktur → Owner, reject /
 *   cancel with reason, transfer order executed by Finance (KK borrower / KM lender, tagged), DB lifecycle guard;
 * - the Persetujuan inbox carries repayment requests at the caller's level; no Owner → 409. Fictional data only.
 */
let w: World
let principal: FlowUser
let accB = 0
let projectB = 0
let today = ''

const L = '/api/v1/project-loans'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const act = (u: FlowUser, id: number, action: string, body: Record<string, unknown> = {}) => api('POST', `${L}/${id}/${action}`, u, body, key())
const notified = async (id: number, event: string) => (await sqlAs('app', 'SELECT user_id::int AS u FROM notifications WHERE event = $1 AND doc_type = $2 AND doc_id = $3 ORDER BY user_id', [event, 'project_loan', String(id)])).rows.map((r) => r.u as number)
const repayment = (body: { repayments: Array<{ id: number }> }, id: number) => body.repayments.find((r) => r.id === id) as Record<string, unknown>

async function onlyActive<T>(role: string, keep: number[], fn: () => Promise<T>): Promise<T> {
  const r = await sqlAs('app', `SELECT DISTINCT u.id FROM users u JOIN company_memberships m ON m.user_id = u.id AND coalesce(m.active, true) JOIN company_memberships_roles r ON r.parent_id = m.id WHERE r.value::text = $1 AND u.active AND NOT (u.id = ANY($2::int[]))`, [role, keep])
  const ids = r.rows.map((x) => x.id as number)
  if (ids.length) await sqlAs('app', 'UPDATE users SET active = false WHERE id = ANY($1::int[])', [ids])
  try {
    return await fn()
  } finally {
    if (ids.length) await sqlAs('app', 'UPDATE users SET active = true WHERE id = ANY($1::int[])', [ids])
  }
}

beforeAll(async () => {
  await installLocalJwks()
  w = await makeWorld('PNJ')
  today = (await sqlAs('app', "SELECT to_char(now() AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD') AS d")).rows[0].d
  principal = await makeFlowUser(['pk-principal'], 'pnj-principal', null)
  accB = await sysCreate('cash-accounts', { name: 'PNJ Rekening Kedua', kind: 'bank', openingBalance: 40_000_000 })
  projectB = await sysCreate('projects', { code: 'PNJ-B', name: 'PNJ Proyek Akun Kedua', pm: w.users.otherPm.id, budget: 0, status: 'berjalan', cashAccount: accB })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('1. Finance files; Direktur → Owner (G1 in service and DB); Finance executes its own order', () => {
  let loan = 0

  it('Finance creates + submits for the borrower project (any open project of its PT); the borrower PM is notified', async () => {
    const opts = await api('GET', `${L}/options`, w.users.finance)
    expect(opts.body.borrowers.map((p: { id: number }) => p.id)).toEqual(expect.arrayContaining([w.project, projectB]))
    const c = await api('POST', L, w.users.finance, { borrowerProjectId: w.project, lenderProjectId: projectB, amount: 3_000_000, reason: 'Termin klien belum cair (Finance)', dueDate: addDays(today, 30), submit: true }, key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    loan = c.body.id
    expect(c.body).toMatchObject({ status: 'pending_approval', approvalLevel: 1, submitterRole: 'finance', originLabel: 'Diajukan Finance', createdBy: { id: w.users.finance.id } })
    expect(await notified(loan, 'project_loan.filed')).toEqual([w.users.pm.id])
    expect(await notified(loan, 'project_loan.pending')).toEqual(expect.arrayContaining([w.users.owner.id, w.users.owner2.id]))
    expect(await notified(loan, 'project_loan.pending')).not.toContain(principal.id)
  })

  it('DB: no level 2 before an approved level 1, level 2 only by an Owner, the level and the approval follow the rows', async () => {
    const company = await companyId()
    const ins = (level: number, actor: number) => sqlError('app', "INSERT INTO approvals (doc_type, loan_id, cycle, position, level, actor_id, decision, company_id) VALUES ('project_loan', $1, 1, 'approval', $2, $3, 'approved', $4)", [loan, level, actor, company])
    expect((await ins(2, principal.id))?.message).toContain('follows an approved Direktur level')
    expect((await ins(1, principal.id))?.message).toContain('level 1 by a Direktur')
    expect((await ins(1, w.users.finance.id))?.message).toContain('loan creator cannot hold a decision position')
    expect((await sqlError('app', `UPDATE project_loans SET approval_level = 2 WHERE id = ${loan}`))?.code).toBe('42501')
  })

  it('level 1 by the Direktur (the Owner may not), level 2 by the Owner (a Direktur may not) → approved transfer order', async () => {
    expect((await act(principal, loan, 'approve')).status).toBe(403)
    const d = await act(w.users.owner, loan, 'approve')
    expect(d.status, JSON.stringify(d.body)).toBe(200)
    expect(d.body).toMatchObject({ status: 'pending_approval', approvalLevel: 2, statusLabel: 'Menunggu persetujuan Owner' })
    expect(await notified(loan, 'project_loan.pending_owner')).toEqual(expect.arrayContaining([principal.id]))
    const company = await companyId()
    expect((await sqlError('app', "INSERT INTO approvals (doc_type, loan_id, cycle, position, level, actor_id, decision, company_id) VALUES ('project_loan', $1, 1, 'approval', 2, $2, 'approved', $3)", [loan, w.users.owner2.id, company]))?.message).toContain('level 2 by an Owner')
    expect((await sqlError('app', `UPDATE project_loans SET status = 'approved', decided_at = now() WHERE id = ${loan}`))?.code).toBe('42501')
    expect((await act(w.users.owner2, loan, 'approve')).status).toBe(403)
    const reject = await act(w.users.owner2, loan, 'reject', { reason: 'bukan level saya' })
    expect(reject.status).toBe(403)
    const o = await act(principal, loan, 'approve')
    expect(o.status, JSON.stringify(o.body)).toBe(200)
    expect(o.body).toMatchObject({ status: 'approved', cashBacked: true, awaitingDisbursement: true, decidedBy: { id: principal.id } })
    expect(await notified(loan, 'project_loan.approved')).toEqual(expect.arrayContaining([w.users.finance.id, w.users.pm.id, w.users.otherPm.id]))
  })

  it('the submitting Finance user may execute the order (legacy /disburse = same execution), audited selfExecuted; tags both projects', async () => {
    const order = (await api('GET', `${L}/transfer-orders`, w.users.finance)).body.items.find((i: { key: string }) => i.key === `loan-${loan}`)
    expect(order).toMatchObject({ selfSubmitted: true, canExecute: true, minDate: today, today })
    const d = await act(w.users.finance, loan, 'disburse', { disburseDate: today })
    expect(d.status, JSON.stringify(d.body)).toBe(200)
    expect(d.body).toMatchObject({ disbursedBy: { id: w.users.finance.id }, disbursement: { kk: expect.any(String), km: expect.any(String) } })
    const audit = (await auditRows('project_loan', loan)).find((r) => r.action === 'disburse')
    expect(audit?.new_value).toMatchObject({ v: { selfExecuted: true } })
    const tags = (await sqlAs('app', "SELECT direction::text AS d, cash_account_id::int AS a, project_id::int AS p FROM cash_entries WHERE project_loan_id = $1 AND project_loan_repayment_id IS NULL ORDER BY direction", [loan])).rows
    expect(tags).toEqual([
      { d: 'in', a: w.cashAccount, p: w.project },
      { d: 'out', a: accB, p: projectB },
    ])
  })
})

describe('2. repayment requests (#12)', () => {
  let loan = 0

  beforeAll(async () => {
    const c = await api('POST', L, w.users.pm, { borrowerProjectId: w.project, lenderProjectId: projectB, amount: 4_000_000, reason: 'Bayar material dulu', dueDate: addDays(today, 60), submit: true }, key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    loan = c.body.id
    for (const u of [w.users.owner, principal]) expect((await act(u, loan, 'approve')).status).toBe(200)
    expect((await act(w.users.finance, loan, 'execute')).status).toBe(200)
  })

  it('PM submits (planned date may be in the future); the open request reserves the outstanding; Staff / lender PM refused', async () => {
    expect((await act(w.users.otherPm, loan, 'repayments', { amount: 1_000 })).status).toBe(403)
    expect((await act(w.users.staffA, loan, 'repayments', { amount: 1_000 })).status).toBe(404)
    const r = await act(w.users.pm, loan, 'repayments', { amount: 1_500_000, repayDate: addDays(today, 10), note: 'Termin 1' })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body).toMatchObject({ status: 'approved', repaidTotal: 0, outstanding: 4_000_000, repayableAmount: 2_500_000, repaymentNeedsApproval: true })
    const row = r.body.repayments[0]
    expect(row).toMatchObject({ status: 'pending_approval', statusLabel: 'Menunggu persetujuan Direktur', approvalLevel: 1, plannedDate: addDays(today, 10), seq: null, cash: null, allowedActions: ['cancel'] })
    expect(await notified(loan, 'project_loan.repayment_pending')).toEqual(expect.arrayContaining([w.users.owner.id, w.users.owner2.id]))
    const over = await act(w.users.finance, loan, 'repayments', { amount: 2_500_001 })
    expect(over.status).toBe(400)
    expect(over.body.errors?.[0]?.path).toBe('amount')
    expect((await act(w.users.finance, loan, 'repayments', { amount: 1_000, repayDate: addDays(today, -400) })).status).toBe(400) // before the loan date
  })

  it('inbox at the caller\'s level; level 1 Direktur, level 2 Owner; the Owner rejects with a reason', async () => {
    const rid = (await api('GET', `${L}/${loan}`, w.users.pm)).body.repayments[0].id as number
    const dirInbox = (await api('GET', `${L}/inbox`, w.users.owner)).body
    expect(dirInbox.repayments.map((x: { id: number }) => x.id)).toContain(rid)
    expect(dirInbox.repayments.find((x: { id: number }) => x.id === rid)).toMatchObject({ loanId: loan, amount: 1_500_000, approvalLevel: 1, submittedBy: { id: w.users.pm.id } })
    expect((await api('GET', `${L}/inbox`, principal)).body.repayments.map((x: { id: number }) => x.id)).not.toContain(rid)
    expect((await act(principal, loan, `repayments/${rid}/approve`)).status).toBe(403)
    expect((await act(w.users.pm, loan, `repayments/${rid}/approve`)).status).toBe(403)
    const d = await act(w.users.owner, loan, `repayments/${rid}/approve`)
    expect(d.status, JSON.stringify(d.body)).toBe(200)
    expect(repayment(d.body, rid)).toMatchObject({ status: 'pending_approval', approvalLevel: 2, statusLabel: 'Menunggu persetujuan Owner' })
    expect(await notified(loan, 'project_loan.repayment_pending_owner')).toEqual(expect.arrayContaining([principal.id]))
    expect((await api('GET', `${L}/inbox`, principal)).body.repayments.map((x: { id: number }) => x.id)).toContain(rid)
    expect((await act(principal, loan, `repayments/${rid}/reject`, {})).status).toBe(400)
    const rej = await act(principal, loan, `repayments/${rid}/reject`, { reason: 'Kas peminjam belum cukup' })
    expect(rej.status, JSON.stringify(rej.body)).toBe(200)
    expect(repayment(rej.body, rid)).toMatchObject({ status: 'rejected', rejectReason: 'Kas peminjam belum cukup', allowedActions: [] })
    expect(rej.body.repayableAmount).toBe(4_000_000)
    expect(await notified(loan, 'project_loan.repayment_rejected')).toEqual([w.users.pm.id])
    const rows = (await sqlAs('app', 'SELECT level::int AS level, decision::text AS d FROM approvals WHERE loan_repayment_id = $1 ORDER BY id', [rid])).rows
    expect(rows).toEqual([
      { level: 1, d: 'approved' },
      { level: 2, d: 'rejected' },
    ])
  })

  it('cancel: the submitter while pending, Finance once approved (reason); DB refuses a skipped step', async () => {
    const a = await act(w.users.pm, loan, 'repayments', { amount: 500_000 })
    const r1 = (a.body.repayments as Array<{ id: number; status: string }>).find((x) => x.status === 'pending_approval')!.id
    expect((await sqlError('app', `UPDATE project_loan_repayments SET status = 'approved', decided_at = now() WHERE id = ${r1}`))?.code).toBe('42501')
    expect((await act(w.users.finance, loan, `repayments/${r1}/cancel`, { reason: 'bukan saya' })).status).toBe(403)
    const c1 = await act(w.users.pm, loan, `repayments/${r1}/cancel`, { reason: 'Salah nominal' })
    expect(c1.status, JSON.stringify(c1.body)).toBe(200)
    expect(repayment(c1.body, r1)).toMatchObject({ status: 'cancelled', cancelReason: 'Salah nominal' })
    const b = await act(w.users.finance, loan, 'repayments', { amount: 700_000 })
    const r2 = (b.body.repayments as Array<{ id: number; status: string }>).find((x) => x.status === 'pending_approval')!.id
    for (const u of [w.users.owner, principal]) expect((await act(u, loan, `repayments/${r2}/approve`)).status).toBe(200)
    const order = (await api('GET', `${L}/transfer-orders`, w.users.finance)).body.items.find((i: { key: string }) => i.key === `repayment-${r2}`)
    expect(order).toMatchObject({ kind: 'repayment', amount: 700_000, fromAccount: { id: w.cashAccount }, toAccount: { id: accB }, selfSubmitted: true })
    const c2 = await act(w.users.finance, loan, `repayments/${r2}/cancel`, { reason: 'Diganti pengajuan baru' })
    expect(c2.status, JSON.stringify(c2.body)).toBe(200)
    expect(repayment(c2.body, r2)).toMatchObject({ status: 'cancelled' })
    expect((await act(w.users.finance, loan, `repayments/${r2}/execute`)).status).toBe(409)
  })

  it('approved order executed by Finance: KK borrower (borrower project) + KM lender (lender project); Sebagian kembali; void reverses', async () => {
    const a = await act(w.users.pm, loan, 'repayments', { amount: 1_000_000 })
    const rid = (a.body.repayments as Array<{ id: number; status: string }>).find((x) => x.status === 'pending_approval')!.id
    for (const u of [w.users.owner, principal]) expect((await act(u, loan, `repayments/${rid}/approve`)).status).toBe(200)
    expect((await act(w.users.pm, loan, `repayments/${rid}/execute`)).status).toBe(403)
    const x = await act(w.users.finance, loan, `repayments/${rid}/execute`, { executeDate: today, note: 'BCA' })
    expect(x.status, JSON.stringify(x.body)).toBe(200)
    expect(x.body).toMatchObject({ status: 'partially_repaid', repaidTotal: 1_000_000, outstanding: 3_000_000, repayableAmount: 3_000_000 })
    expect(repayment(x.body, rid)).toMatchObject({ status: 'posted', seq: 1, repayDate: today, executedBy: { id: w.users.finance.id }, cash: { kk: expect.any(String), km: expect.any(String) } })
    const legs = (await sqlAs('app', "SELECT direction::text AS d, cash_account_id::int AS a, project_id::int AS p FROM cash_entries WHERE project_loan_repayment_id = $1 AND status = 'posted' ORDER BY direction", [rid])).rows
    expect(legs).toEqual([
      { d: 'in', a: accB, p: projectB },
      { d: 'out', a: w.cashAccount, p: w.project },
    ])
    expect(await notified(loan, 'project_loan.repaid')).toEqual(expect.arrayContaining([w.users.owner.id, w.users.otherPm.id]))
    expect((await sqlError('app', `UPDATE project_loan_repayments SET amount = 1 WHERE id = ${rid}`))?.code).toBe('42501')
    const v = await act(w.users.finance, loan, `repayments/${rid}/void`, { reason: 'Salah transfer' })
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(v.body).toMatchObject({ status: 'approved', repaidTotal: 0, outstanding: 4_000_000 })
  })

  it('DB: a cash-backed loan is never repaid by a direct posted row; a decision by the submitter is refused', async () => {
    const company = await companyId()
    const ins = await sqlError('app', "INSERT INTO project_loan_repayments (loan_id, repay_date, amount, status, recorded_by_id, company_id) VALUES ($1, $2, 1000, 'posted', $3, $4)", [loan, today, w.users.finance.id, company])
    expect(ins?.message).toContain('starts as a request')
    const a = await act(w.users.pm, loan, 'repayments', { amount: 100_000 })
    const rid = (a.body.repayments as Array<{ id: number; status: string }>).find((x) => x.status === 'pending_approval')!.id
    const dec = await sqlError('app', "INSERT INTO approvals (doc_type, loan_repayment_id, cycle, position, level, actor_id, decision, company_id) VALUES ('project_loan_repayment', $1, 1, 'approval', 1, $2, 'approved', $3)", [rid, w.users.pm.id, company])
    expect(dec?.message).toContain('repayment submitter cannot hold a decision position')
    expect((await act(w.users.pm, loan, `repayments/${rid}/cancel`, { reason: 'uji selesai' })).status).toBe(200)
  })

  it('no active Owner → a repayment request is refused (409 NO_OWNER)', async () => {
    const r = await onlyActive('pk-principal', [], () => act(w.users.pm, loan, 'repayments', { amount: 100_000 }))
    expect(r.status, JSON.stringify(r.body)).toBe(409)
    expect(JSON.stringify(r.body)).toContain('belum punya Owner aktif')
  })
})
