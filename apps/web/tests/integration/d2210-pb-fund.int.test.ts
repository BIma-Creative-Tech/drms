import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { fixturePm, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, makeFlowUser, makeWorld, sysCreate, type FlowUser } from './flow-world'

/**
 * ADR 0031 amendment (user 2026-10-22, "PB dulu, lalu PT"), narrowed by the amendment 2026-10-26 (DRMS 26/10 #1): the
 * fund check of the final approval compares a request of a mapped project with ITS Pusat Biaya's dana bebas only (the
 * PT no longer covers a short account — the Owner instructs an inter-project loan instead, d2610-owner-loan.int.test.ts).
 * A fresh fictional PT P (fund check ON) with three bank accounts — A Rp 51 jt, B Rp 179 jt, C Rp 0 — and one project
 * mapped to each (Direktur = the final level):
 *  1. C has nothing, the PT has 230 → 2026-10-26: refused (route short, the PT figure is information only)
 *  2. a 17 jt request of A's project: A covers it → panel route pusat_biaya, approved
 *  3. a request of C's project: C short → 409 naming the account; the inbox badge
 *  4. the DB backstop uses the same rule (23514 for C although the PT has plenty, accepted for A)
 * P is deactivated in afterAll.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))

const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const JT = 1_000_000

let P = 0
let staff: FlowUser
let direktur: FlowUser
let staffEmp = 0
let accStaff = 0
let accA = 0
let accC = 0
let cat = 0
let uom = 0
let pA = 0
let pC = 0

async function ok(p: Promise<{ status: number; body: any }>, status = 200) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await p
  expect(r.status, JSON.stringify(r.body)).toBe(status)
  return r.body
}

const ptAvailable = async () => Number((await sqlAs('app', 'SELECT pk_fund_available($1)::bigint AS a', [P])).rows[0].a)
const pbAvailable = async (acc: number) => Number((await sqlAs('app', 'SELECT (pk_pb_balance($1) - pk_pb_commitments($1))::bigint AS a', [acc])).rows[0].a)

beforeAll(async () => {
  await makeWorld('PBF')
  const p = await getTestPayload()
  const n = Date.now() % 1000
  P = await sysCreate('companies', { name: 'PT Contoh Pusat Biaya', shortCode: `PBF${n}`, timezone: 'Asia/Makassar' })
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  uom = (await p.find({ collection: 'uoms', where: { code: { equals: 'LS' } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  const account = (name: string, opening: number, no: string) => sysCreate('cash-accounts', { company: P, name, kind: 'bank', bank, accountNo: `${no}${Date.now() % 1e9}`, accountHolder: 'PT Contoh Pusat Biaya', openingBalance: opening, openingBalanceDate: '2020-01-01' })
  accA = await account('CSR Contoh A', 51 * JT, '71')
  const accB = await account('CSR Contoh B', 179 * JT, '72')
  accC = await account('CSR Contoh C', 0, '73')
  cat = await sysCreate('expense-categories', { company: P, code: 'MAT', name: 'Material' })
  staffEmp = await sysCreate('employees', { company: P, code: 'PBF-STF', name: 'PBF Staf' })
  staff = await makeFlowUser(['pk-staff'], 'pbf-staff', staffEmp, { company: P })
  direktur = await makeFlowUser(['pk-owner'], 'pbf-direktur', null, { company: P })
  accStaff = await sysCreate('employee-bank-accounts', { employee: staffEmp, bank, accountNo: `74${Date.now() % 1e9}`, accountHolder: 'PBF Staf', isDefault: true, verificationStatus: 'verified' })
  const pm = await fixturePm(P)
  const project = async (code: string, cashAccount: number) => {
    const id = await sysCreate('projects', { company: P, code, name: `PBF Proyek ${code}`, pm, budget: 0, status: 'berjalan', cashAccount })
    await sysCreate('team-assignments', { company: P, employee: staffEmp, project: id, roleInProject: 'staff' })
    await sysCreate('approval-rules', { company: P, name: `PBF Direktur ${code}`, docType: 'expense_request', requestType: 'any', minAmount: 0, priority: 10, project: id, acknowledge: 'none', acknowledgeBy: 'role', acknowledgeRole: null, steps: [{ level: 1, approverRole: 'pk-owner' }], active: true })
    return id
  }
  pA = await project('PBF-A', accA)
  await project('PBF-B', accB)
  pC = await project('PBF-C', accC)
  await sqlAs('owner', 'UPDATE companies SET fund_check_enabled = true WHERE id = $1', [P])
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  if (P) {
    await sqlAs('owner', 'UPDATE companies SET fund_check_enabled = false WHERE id = $1', [P])
    await p.update({ collection: 'companies', id: P, data: { active: false, changeReason: 'uji cek dana pusat biaya selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  }
  await p.destroy()
})

/** Staff request through submit → its id (waiting at the Direktur = final level). */
async function request(project: number, amount: number): Promise<number> {
  const d = await ok(
    api('POST', E, staff, {
      type: 'advance',
      title: `Pembelian material ${amount / JT} jt`,
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

const approve = (id: number) => api('POST', `${E}/${id}/approve`, direktur, {}, key())

let c1 = 0
let c3 = 0
let a2 = 0

describe('d2210 / d2610: fund check of a mapped project = its Pusat Biaya only', () => {
  it('1. C empty, the PT would cover it → 2026-10-26: blocked (route short), 409 naming the account', async () => {
    c1 = await request(pC, 140 * JT)
    const d = await ok(api('GET', `${E}/${c1}`, direktur))
    expect(d.fundCheck).toMatchObject({ enabled: true, applies: true, status: 'insufficient', blocked: true, gap: 140 * JT, route: 'short', routeText: null, available: 230 * JT })
    expect(d.fundCheck.pusatBiaya).toMatchObject({ accountId: accC, name: 'CSR Contoh C', balance: 0, commitments: 0, available: 0 })
    expect(d.fundCheck.blockedText).toContain('Dana bebas akun kas CSR Contoh C tidak cukup')
    expect(d.fundCheck.blockedText).not.toContain('dana PT')
    const r = await approve(c1)
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'FUND_INSUFFICIENT', available: 0, needed: 140 * JT, gap: 140 * JT, pusatBiayaAccountId: accC, pusatBiayaAvailable: 0 })
    expect(await ptAvailable()).toBe(230 * JT)
  })

  it('2. its Pusat Biaya covers it → route pusat_biaya, approved', async () => {
    a2 = await request(pA, 17 * JT)
    const d = await ok(api('GET', `${E}/${a2}`, direktur))
    expect(d.fundCheck).toMatchObject({ status: 'ok', blocked: false, gap: 0, route: 'pusat_biaya', available: 230 * JT, needed: 17 * JT })
    expect(d.fundCheck.pusatBiaya).toMatchObject({ accountId: accA, balance: 51 * JT, commitments: 0, available: 51 * JT })
    expect(d.fundCheck.routeText).toBe('Dana pusat biaya CSR Contoh A cukup — Finance membayar dari akun ini.')
    const inbox = await ok(api('GET', '/api/v1/approvals/inbox', direktur))
    expect(inbox.items.find((i: { id: number }) => i.id === a2)).toMatchObject({ finalStep: true, fundShort: null, instructProjectLoan: false, projectLoanPending: null })
    expect((await ok(approve(a2))).status).toBe('approved')
    expect(await pbAvailable(accA)).toBe(34 * JT)
    expect(await ptAvailable()).toBe(213 * JT)
  })

  it('3. C short → 409 naming the account; the inbox badge + the loan instruction for the final decider', async () => {
    c3 = await request(pC, 1 * JT)
    const d = await ok(api('GET', `${E}/${c3}`, direktur))
    expect(d.fundCheck).toMatchObject({ status: 'insufficient', blocked: true, route: 'short', routeText: null, gap: 1 * JT, projectLoans: [], projectLoanPending: false })
    expect(d.fundCheck.blockedText).toBe('Dana bebas akun kas CSR Contoh C tidak cukup — kurang Rp 1.000.000. Tolak, atau Owner menginstruksikan pinjaman antar proyek ke akun ini lalu menyetujui setelah Finance mentransfernya.')
    expect(d.allowedActions).toContain('instruct_project_loan')
    expect(d.allowedActions).not.toContain('instruct_loan')
    const inbox = await ok(api('GET', '/api/v1/approvals/inbox', direktur))
    expect(inbox.items.find((i: { id: number }) => i.id === c3)).toMatchObject({ fundShort: 1 * JT, instructProjectLoan: true, projectLoanPending: null })
    const r = await approve(c3)
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'FUND_INSUFFICIENT', companyId: P, available: 0, needed: 1 * JT, gap: 1 * JT, pusatBiayaAccountId: accC, pusatBiayaName: 'CSR Contoh C', pusatBiayaAvailable: 0 })
    expect(r.body.title).toContain('Dana bebas akun kas CSR Contoh C tidak cukup')
  })

  it('4. DB backstop: same rule (C refused 23514, A accepted)', async () => {
    const a4 = await request(pA, 2 * JT)
    await sqlAs('owner', 'ALTER TABLE expense_requests DISABLE TRIGGER expense_requests_approval_guard')
    let errC: { code?: string; message: string } | null = null
    let errA: { code?: string; message: string } | null = null
    try {
      errC = await sqlError('app', "UPDATE expense_requests SET status = 'approved', approved_amount = grand_total, approved_at = now() WHERE id = $1", [c3])
      errA = await sqlError('app', "UPDATE expense_requests SET status = 'approved', approved_amount = grand_total, approved_at = now() WHERE id = $1", [a4])
    } finally {
      await sqlAs('owner', 'ALTER TABLE expense_requests ENABLE TRIGGER expense_requests_approval_guard')
    }
    expect(errC?.code).toBe('23514')
    expect(errC?.message).toContain('fund check')
    expect(errA).toBeNull()
    expect(Number((await sqlAs('app', 'SELECT pk_request_fund_available($1, $2)::bigint AS a', [P, pA])).rows[0].a)).toBe(32 * JT)
    // 2026-10-26: C's request is compared with C only although the PT has plenty
    expect(Number((await sqlAs('app', 'SELECT pk_request_fund_available($1, $2)::bigint AS a', [P, pC])).rows[0].a)).toBe(0)
    expect(await ptAvailable()).toBeGreaterThan(200 * JT)
    expect(Number((await sqlAs('app', 'SELECT pk_request_fund_available($1, NULL)::bigint AS a', [P])).rows[0].a)).toBe(await ptAvailable())
  })
})
