import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { costCenterMonth, cashFlowMonthly } from '@/domain/reports/kpi'
import { officeScope } from '@/domain/reports/scope'
import { addDays } from '@/domain/expense/types'
import { PROJECT_WITHOUT_PB } from '@/fields/pusat-biaya'
import { resetRateLimits } from '@/lib/rate-limit'

import { getTestPayload, sqlAs, sqlError } from './helpers'
import { api, asUser, draftBody, makeWorld, png, sysCreate, upload, type World } from './flow-world'

/**
 * ADR 0031 (DRMS 21/10) "Pusat Biaya = akun kas" through the real API and the DB guards:
 * - a project request is charged to its project's Pusat Biaya (cash account); an unmapped project → 409 at the transfer;
 * - Finance pays from ANOTHER account → automatic, approved inter-project loan (reason required) with KK on the paying
 *   account + KM on the Pusat Biaya, then the transfer KK on the Pusat Biaya (A nets to 0, B carries the payment);
 *   the transfer void reverses the loan legs and cancels the loan (refused while a repayment is posted);
 * - a manual PJ of money between two different Pusat Biaya: Direktur approves → Finance "Cairkan" (KK lender, KM
 *   borrower) → repayments by Finance post the mirror pair, a void reverses it; same account / goods → a claim (no cash);
 * - the PM picks the Pusat Biaya of his project (names only, no bank data); K-15 per account; loan legs are not
 *   operational cash flow. Fictional data only.
 */
let w: World
let accB = 0 // second account of the world's PT (DRMS)
let projectB = 0 // project mapped to accB, PM = otherPm
let unmapped = 0 // project without Pusat Biaya

const E = '/api/v1/expense-requests'
const L = '/api/v1/project-loans'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) // Asia/Makassar

const balance = async (account: number) =>
  Number(
    (
      await sqlAs(
        'app',
        `SELECT (a.opening_balance + coalesce((SELECT sum(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END) FROM cash_entries e WHERE e.cash_account_id = a.id), 0))::text AS b FROM cash_accounts a WHERE a.id = $1`,
        [account],
      )
    ).rows[0].b,
  )
const legs = async (loan: number) =>
  (await sqlAs('app', `SELECT direction::text AS d, cash_account_id::int AS a, amount::bigint AS amount, status::text AS s, source_type::text AS t, project_loan_repayment_id::int AS r FROM cash_entries WHERE project_loan_id = $1 ORDER BY id`, [loan])).rows.map((x) => ({
    d: x.d as string,
    a: Number(x.a),
    amount: Number(x.amount),
    s: x.s as string,
    t: x.t as string,
    r: x.r === null ? null : Number(x.r),
  }))
const notified = async (id: number, event: string) => (await sqlAs('app', 'SELECT user_id::int AS u FROM notifications WHERE event = $1 AND doc_type = $2 AND doc_id = $3 ORDER BY user_id', [event, 'project_loan', String(id)])).rows.map((r) => r.u as number)

async function proof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

/** Pengajuan Baru 750.000 → Direktur "Diketahui" + Finance approved (world rule), not transferred. */
async function approvedAdvance(over: Record<string, unknown> = {}): Promise<number> {
  const c = await api('POST', E, w.users.staffA, draftBody(w, over), key())
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const id = c.body.id as number
  expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key())).status).toBe(200)
  expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key())).status).toBe(200)
  const a = await api('POST', `${E}/${id}/approve`, w.users.finance, {}, key())
  expect(a.status, JSON.stringify(a.body)).toBe(200)
  return id
}

const transfer = async (id: number, over: Record<string, unknown> = {}) => api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `PB-${id}-${randomUUID().slice(0, 4)}`, proofMediaId: await proof(), ...over }, key())

beforeAll(async () => {
  w = await makeWorld('PB')
  accB = await sysCreate('cash-accounts', { name: 'PB Rekening Kedua', kind: 'bank', openingBalance: 30_000_000 })
  projectB = await sysCreate('projects', { code: 'PB-PB', name: 'PB Proyek Akun Kedua', pm: w.users.otherPm.id, budget: 0, status: 'berjalan', cashAccount: accB })
  unmapped = await sysCreate('projects', { code: 'PB-NO', name: 'PB Proyek Tanpa Pusat Biaya', pm: w.users.pm.id, budget: 0, status: 'berjalan', cashAccount: null })
  for (const e of [w.emp.a]) await sysCreate('team-assignments', { employee: e, project: unmapped, roleInProject: 'staff' })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('1. transfer charged to the project Pusat Biaya', () => {
  it('queue shows the Pusat Biaya; paid from it → no loan, KK on it', async () => {
    const id = await approvedAdvance()
    const q = await api('GET', '/api/v1/transfer-queue', w.users.finance)
    const item = q.body.items.find((i: { id: number }) => i.id === id)
    expect(item).toMatchObject({ pusatBiaya: { id: w.cashAccount }, pusatBiayaMissing: false, costCenter: null })
    const before = await balance(w.cashAccount)
    const t = await transfer(id)
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    expect(t.body.projectLoan).toBeNull()
    expect(await balance(w.cashAccount)).toBe(before - 750_000)
    const row = (await sqlAs('app', 'SELECT cash_account_id::int AS a, paid_from_cash_account_id AS p, cost_center_id AS cc FROM transfers WHERE id = $1', [t.body.transferId])).rows[0]
    expect(row).toEqual({ a: w.cashAccount, p: null, cc: null })
    const d = (await api('GET', `${E}/${id}`, w.users.staffA)).body
    expect(d.pusatBiaya).toEqual({ id: w.cashAccount, name: expect.any(String) })
  })

  it('paid from another account without a reason → 400 loanReason; nothing written', async () => {
    const id = await approvedAdvance()
    const r = await transfer(id, { cashAccountId: accB })
    expect(r.status, JSON.stringify(r.body)).toBe(400)
    expect(r.body.errors?.[0]?.path).toBe('loanReason')
    expect(Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM transfers WHERE request_id = $1', [id])).rows[0].n)).toBe(0)
  })

  it('a project without Pusat Biaya → 409 (queue flags it)', async () => {
    const id = await approvedAdvance({ projectId: unmapped, title: 'Proyek belum dipetakan' })
    const item = (await api('GET', '/api/v1/transfer-queue', w.users.finance)).body.items.find((i: { id: number }) => i.id === id)
    expect(item).toMatchObject({ pusatBiaya: null, pusatBiayaMissing: true })
    const r = await transfer(id)
    expect(r.status, JSON.stringify(r.body)).toBe(409)
    expect(r.body.title).toBe(PROJECT_WITHOUT_PB)
  })
})

describe('2. paid from another account → automatic inter-project loan (DRMS 21/10 #4–#5)', () => {
  let id = 0
  let loan = 0
  let transferId = 0

  it('loan approved + disbursed with the transfer: KK on B, KM on A, transfer KK on A; A nets 0, B −amount', async () => {
    id = await approvedAdvance()
    const [a0, b0] = [await balance(w.cashAccount), await balance(accB)]
    const t = await transfer(id, { cashAccountId: accB, loanReason: 'Saldo pusat biaya project belum masuk', loanDueDate: addDays(today(), 14) })
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    expect(t.body.projectLoan).toMatchObject({ docNo: expect.stringMatching(/^PJ\//), kk: expect.any(String), km: expect.any(String) })
    loan = t.body.projectLoan.id
    transferId = t.body.transferId
    expect(await balance(w.cashAccount)).toBe(a0)
    expect(await balance(accB)).toBe(b0 - 750_000)
    expect(await legs(loan)).toEqual([
      { d: 'out', a: accB, amount: 750_000, s: 'posted', t: 'project_loan', r: null },
      { d: 'in', a: w.cashAccount, amount: 750_000, s: 'posted', t: 'project_loan', r: null },
    ])
    const tr = (await sqlAs('app', 'SELECT cash_account_id::int AS a, paid_from_cash_account_id::int AS p FROM transfers WHERE id = $1', [transferId])).rows[0]
    expect(tr).toEqual({ a: w.cashAccount, p: accB })
    const l = await api('GET', `${L}/${loan}`, w.users.finance)
    expect(l.status).toBe(200)
    expect(l.body).toMatchObject({
      origin: 'transfer',
      status: 'approved',
      lenderProject: null,
      lenderCashAccount: { id: accB },
      borrowerProject: { id: w.project },
      borrowerCashAccount: { id: w.cashAccount },
      cashBacked: true,
      awaitingDisbursement: false,
      transfer: { id: transferId },
      dueDate: addDays(today(), 14),
      disbursement: { kk: expect.any(String), km: expect.any(String) },
    })
    expect(l.body.allowedActions).toContain('repay')
    expect(l.body.allowedActions).not.toContain('cancel')
    expect(l.body.allowedActions).not.toContain('disburse')
    expect(await notified(loan, 'project_loan.auto_created')).toEqual(expect.arrayContaining([w.users.pm.id, w.users.owner.id]))
    const audit = (await sqlAs('app', "SELECT action::text AS a, reason FROM audit_logs WHERE doc_type = 'project_loan' AND doc_id = $1 AND action::text = 'auto_create'", [String(loan)])).rows
    expect(audit).toEqual([{ a: 'auto_create', reason: 'Saldo pusat biaya project belum masuk' }])
    // request detail: paid from B + the loan
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    expect(d.transfers.at(-1)).toMatchObject({ cashAccount: { id: w.cashAccount }, paidFromCashAccount: { id: accB }, projectLoan: { id: loan } })
  })

  it('the loan legs are voided only through the loan / transfer (409 on the cash entry)', async () => {
    const leg = (await sqlAs('app', "SELECT id FROM cash_entries WHERE project_loan_id = $1 AND direction = 'out'", [loan])).rows[0].id
    const r = await api('POST', `/api/v1/cash-entries/${leg}/void`, w.users.finance, { reason: 'uji void langsung' }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(409)
  })

  it('repayment (Finance; the PM may not): KK on A, KM on B; void reverses; transfer void refused meanwhile', async () => {
    expect((await api('POST', `${L}/${loan}/repayments`, w.users.pm, { amount: 100_000 }, key())).status).toBe(403)
    const rep = await api('POST', `${L}/${loan}/repayments`, w.users.finance, { amount: 300_000 }, key())
    expect(rep.status, JSON.stringify(rep.body)).toBe(201)
    expect(rep.body).toMatchObject({ status: 'partially_repaid', outstanding: 450_000 })
    const rid = rep.body.repayments[0].id as number
    expect(rep.body.repayments[0].cash).toEqual({ kk: expect.any(String), km: expect.any(String) })
    expect((await legs(loan)).filter((x) => x.r === rid)).toEqual([
      { d: 'out', a: w.cashAccount, amount: 300_000, s: 'posted', t: 'project_loan', r: rid },
      { d: 'in', a: accB, amount: 300_000, s: 'posted', t: 'project_loan', r: rid },
    ])
    const v = await api('POST', `${E}/${id}/transfers/${transferId}/void`, w.users.finance, { reason: 'salah akun' }, key())
    expect(v.status, JSON.stringify(v.body)).toBe(409)
    const vr = await api('POST', `${L}/${loan}/repayments/${rid}/void`, w.users.finance, { reason: 'salah catat' }, key())
    expect(vr.status, JSON.stringify(vr.body)).toBe(200)
    expect(vr.body).toMatchObject({ status: 'approved', outstanding: 750_000 })
    expect((await legs(loan)).filter((x) => x.r === rid && x.t === 'project_loan').map((x) => x.s)).toEqual(['void', 'void'])
  })

  it('DB: the loan legs and a transfer\'s "paid from" account are immutable', async () => {
    expect(await sqlError('app', 'UPDATE transfers SET paid_from_cash_account_id = NULL WHERE id = $1', [transferId])).toBeTruthy()
    expect(await sqlError('app', 'UPDATE cash_entries SET project_loan_id = NULL WHERE project_loan_id = $1', [loan])).toBeTruthy()
    expect(await sqlError('app', 'UPDATE project_loans SET lender_cash_account_id = $2 WHERE id = $1', [loan, w.cashAccount])).toBeTruthy()
  })

  it('transfer void → loan cancelled, its KK / KM reversed; balances back', async () => {
    const [a0, b0] = [await balance(w.cashAccount), await balance(accB)]
    const v = await api('POST', `${E}/${id}/transfers/${transferId}/void`, w.users.finance, { reason: 'salah akun pembayar' }, key())
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(await balance(w.cashAccount)).toBe(a0) // transfer KK + loan KM reversed together
    expect(await balance(accB)).toBe(b0 + 750_000)
    const l = (await api('GET', `${L}/${loan}`, w.users.finance)).body
    expect(l).toMatchObject({ status: 'cancelled', outstanding: 0 })
    expect((await legs(loan)).filter((x) => x.t === 'project_loan' && x.r === null).map((x) => x.s)).toEqual(['void', 'void'])
  })
})

describe('3. manual PJ of money between two Pusat Biaya (Direktur → Finance "Cairkan")', () => {
  let loan = 0
  const body = (over: Record<string, unknown> = {}) => ({ borrowerProjectId: w.project, lenderProjectId: projectB, amount: 5_000_000, reason: 'Termin belum cair', dueDate: addDays(today(), 30), submit: true, ...over })

  it('approval freezes the accounts → cash-backed, waiting for Finance; the PM cannot repay; Finance notified', async () => {
    const c = await api('POST', L, w.users.pm, body(), key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    loan = c.body.id
    expect(c.body).toMatchObject({ cashBacked: false, lenderCashAccount: null })
    const a = await api('POST', `${L}/${loan}/approve`, w.users.owner, {}, key())
    expect(a.status, JSON.stringify(a.body)).toBe(200)
    expect(a.body).toMatchObject({ status: 'approved', cashBacked: true, awaitingDisbursement: true, statusLabel: 'Disetujui – menunggu pencairan', lenderCashAccount: { id: accB }, borrowerCashAccount: { id: w.cashAccount }, disbursement: null })
    expect(await notified(loan, 'project_loan.disburse_pending')).toEqual(expect.arrayContaining([w.users.finance.id, w.users.finance2.id]))
    const pm = (await api('GET', `${L}/${loan}`, w.users.pm)).body
    expect(pm.allowedActions).not.toContain('repay')
    expect((await api('POST', `${L}/${loan}/repayments`, w.users.finance, { amount: 1_000 }, key())).status).toBe(409) // not disbursed yet
    expect((await api('POST', `${L}/${loan}/disburse`, w.users.pm, {}, key())).status).toBe(403)
  })

  it('Cairkan (Finance, once): KK on the lender account, KM on the borrower account', async () => {
    const [a0, b0] = [await balance(w.cashAccount), await balance(accB)]
    const d = await api('POST', `${L}/${loan}/disburse`, w.users.finance, {}, key())
    expect(d.status, JSON.stringify(d.body)).toBe(200)
    expect(d.body).toMatchObject({ awaitingDisbursement: false, statusLabel: 'Disetujui', disbursement: { kk: expect.any(String), km: expect.any(String) }, disbursedBy: { id: w.users.finance.id } })
    expect(await balance(accB)).toBe(b0 - 5_000_000)
    expect(await balance(w.cashAccount)).toBe(a0 + 5_000_000)
    expect((await api('POST', `${L}/${loan}/disburse`, w.users.finance, {}, key())).status).toBe(409)
    // a disbursed loan is settled by repayments, not cancelled
    expect((await api('POST', `${L}/${loan}/cancel`, w.users.owner, { reason: 'batal saja' }, key())).status).toBe(409)
  })

  it('repayment by Finance: KK borrower, KM lender; Lunas', async () => {
    const r = await api('POST', `${L}/${loan}/repayments`, w.users.finance, { amount: 5_000_000 }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.status).toBe('repaid')
    const rid = r.body.repayments[0].id as number
    expect((await legs(loan)).filter((x) => x.r === rid)).toEqual([
      { d: 'out', a: w.cashAccount, amount: 5_000_000, s: 'posted', t: 'project_loan', r: rid },
      { d: 'in', a: accB, amount: 5_000_000, s: 'posted', t: 'project_loan', r: rid },
    ])
  })

  it('same Pusat Biaya (w.project ↔ w.otherProject) or goods → a claim: no disbursement, no cash, PM repays', async () => {
    for (const over of [{ lenderProjectId: w.otherProject }, { kind: 'barang' }]) {
      const c = await api('POST', L, w.users.pm, body(over), key())
      expect(c.status, JSON.stringify(c.body)).toBe(201)
      const a = await api('POST', `${L}/${c.body.id}/approve`, w.users.owner, {}, key())
      expect(a.status, JSON.stringify(a.body)).toBe(200)
      expect(a.body).toMatchObject({ cashBacked: false, awaitingDisbursement: false })
      expect(a.body.allowedActions).not.toContain('disburse')
      const r = await api('POST', `${L}/${c.body.id}/repayments`, w.users.pm, { amount: 1_000_000 }, key())
      expect(r.status, JSON.stringify(r.body)).toBe(201)
      expect(await legs(c.body.id)).toEqual([])
    }
  })
})

describe('4. project mapping, PM picker, reports', () => {
  it('the PM reads the active accounts of his PT (names) without bank details or the menu', async () => {
    const r = await api('GET', '/api/cash-accounts?limit=100&depth=0', w.users.pm)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const b = r.body.docs.find((d: { id: number }) => d.id === accB)
    expect(b).toMatchObject({ id: accB, name: 'PB Rekening Kedua' })
    expect(b.accountNo).toBeUndefined()
    expect(b.openingBalance).toBeUndefined()
    expect((await api('GET', '/api/v1/cash-accounts/balances', w.users.pm)).status).toBe(403)
  })

  it('a user creates a project only with its Pusat Biaya; another PT\'s account is refused', async () => {
    const no = await api('POST', '/api/projects', w.users.owner, { code: `PB-N${Date.now() % 1000}`, name: 'Tanpa pusat biaya', pm: w.users.pm.id, status: 'berjalan' })
    expect(no.status).toBe(400)
    expect(JSON.stringify(no.body)).toContain('Pusat biaya (akun kas) wajib dipilih')
    const ok = await api('POST', '/api/projects', w.users.pm, { code: `PB-Y${Date.now() % 1000}`, name: 'Dengan pusat biaya', pm: w.users.pm.id, status: 'berjalan', cashAccount: accB })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    expect(Number((await sqlAs('app', 'SELECT cash_account_id::int AS a FROM projects WHERE id = $1', [ok.body.doc.id])).rows[0].a)).toBe(accB)
  })

  it('K-15 per Pusat Biaya counts the transfers charged to it; loan legs are not operational cash flow', async () => {
    const month = today().slice(0, 7)
    const k15 = await asUser(w.users.finance, async (req) => costCenterMonth(req, await officeScope(req), month))
    expect(k15.find((x) => x.id === w.cashAccount)?.fromRequests ?? 0).toBeGreaterThanOrEqual(750_000)
    const ops = await asUser(w.users.finance, async (req) => cashFlowMonthly(req, await officeScope(req), { from: month, to: month }, 'operational'))
    const book = await asUser(w.users.finance, async (req) => cashFlowMonthly(req, await officeScope(req), { from: month, to: month }, 'book'))
    const loanIn = Number((await sqlAs('app', "SELECT coalesce(sum(amount), 0)::bigint AS s FROM cash_entries WHERE source_type::text = 'project_loan' AND direction = 'in' AND status = 'posted' AND period = $1", [month])).rows[0].s)
    expect(loanIn).toBeGreaterThan(0)
    expect(book[0]!.masuk - ops[0]!.masuk).toBeGreaterThanOrEqual(loanIn)
  })
})

