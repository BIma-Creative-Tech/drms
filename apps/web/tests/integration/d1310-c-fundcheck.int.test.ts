import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'
import { runDailyReminders } from '@/domain/reminders/service'
import { OWNER_RULE_NAME } from '@/seed/data'

import { addMembership, fixturePm, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser } from './flow-world'

/**
 * ADR 0029 (DRMS 13/10 Phase C) "Cek dana di persetujuan Owner + Pinjaman antar-PT" through the real API + DB guards,
 * with the owner's answers of 2026-10-14 ("setuju" on every default). Three fresh fictional PTs: L (lender, Rp 500 jt),
 * M (borrower: bank Rp 100 jt + a legacy SITE-flagged petty-cash account Rp 0 that COUNTS since DRMS 24/10), N (no designated receiving
 * account). One Owner (pk-principal in L, M and N; also Finance in L for the G1 case).
 *  0. switch OFF (default): today's behaviour — the Owner approves beyond the funds; the panel is information only
 *  1. switch ON: group admin only, reason required, audited
 *  2. the block: 409 FUND_INSUFFICIENT with the figures, request stays at the Owner step, audit row, panel, inbox
 *     badge, `instruct_loan`, Owner notification `expense.fund_shortfall`
 *  3. commitments: approved-not-transferred, LPJ shortfall, instructed loan (lender side); no site exclusion (DRMS 24/10)
 *  4. concurrency: two approvals racing on the same money → exactly one passes
 *  5. the Owner's own request: checked at submit, stays Draft
 *  6. a rule without an Owner level: the final (Direktur) approval is checked, the Owner notified
 *  7. loans: instruct (Owner only, lender list, 400 / 409 refusals), disburse (G1, closed periods both sides, KK + KM +
 *     link), the Owner approves AGAIN (no automatic approval), repay (partial, > outstanding, fund check, void),
 *     disbursement void (LOAN_HAS_REPAYMENTS, borrower shortfall confirmation), cancel, overdue reminder, report, Kas
 *  8. DB guards (loan tables, G1, frozen content, backstop trigger) and the switch back OFF.
 * L, M, N are deactivated in afterAll (every other test file assumes the single-company default).
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))

const E = '/api/v1/expense-requests'
const IC = '/api/v1/intercompany-loans'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const ptToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Makassar' })
const JT = 1_000_000

let L = 0
let M = 0
let N = 0
let codeL = ''
let owner: FlowUser
let financeL: FlowUser
let financeM: FlowUser
let direkturM: FlowUser
let staffM: FlowUser
let groupAdmin: FlowUser
let outsider: FlowUser
let staffEmp = 0
let ownerEmp = 0
let accStaff = 0
let accOwnerEmp = 0
let accL = 0
let accM = 0
let accSiteM = 0
let cat = 0
let uom = 0
let srcM = 0
let pOwner = 0
let pNoOwner = 0
let pOwn = 0

async function ok(p: Promise<{ status: number; body: any }>, status = 200) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await p
  expect(r.status, JSON.stringify(r.body)).toBe(status)
  return r.body
}

const figures = async (cid: number) => {
  const r = (await sqlAs('app', 'SELECT pk_fund_balance($1)::bigint AS b, pk_fund_commitments($1)::bigint AS c, pk_fund_available($1)::bigint AS a', [cid])).rows[0]
  return { balance: Number(r.b), commitments: Number(r.c), available: Number(r.a) }
}

beforeAll(async () => {
  await makeWorld('FCK') // seed (banks, uoms, default rules) + the DRMS world
  const p = await getTestPayload()
  const n = Date.now() % 1000
  codeL = `FCL${n}`
  L = await sysCreate('companies', { name: 'PT Contoh Pemberi Dana', shortCode: codeL, timezone: 'Asia/Makassar' })
  M = await sysCreate('companies', { name: 'PT Contoh Peminjam Dana', shortCode: `FCM${n}`, timezone: 'Asia/Makassar' })
  N = await sysCreate('companies', { name: 'PT Contoh Tanpa Rekening Antar PT', shortCode: `FCN${n}`, timezone: 'Asia/Makassar' })
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  uom = (await p.find({ collection: 'uoms', where: { code: { equals: 'LS' } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  accL = await sysCreate('cash-accounts', { company: L, name: 'Bank Pemberi', kind: 'bank', bank, accountNo: `61${Date.now() % 1e9}`, accountHolder: 'PT Contoh Pemberi Dana', openingBalance: 500 * JT, openingBalanceDate: '2020-01-01', intercompanyReceiving: true })
  accM = await sysCreate('cash-accounts', { company: M, name: 'Bank Peminjam', kind: 'bank', bank, accountNo: `62${Date.now() % 1e9}`, accountHolder: 'PT Contoh Peminjam Dana', openingBalance: 100 * JT, openingBalanceDate: '2020-01-01', intercompanyReceiving: true })
  const site = await sysCreate('sites', { company: M, code: `FCS${n}`, name: 'Site Contoh' })
  // DRMS 24/10: a site flag (legacy, written after 20261024_500000 cleared the old ones) no longer excludes the account
  accSiteM = await sysCreate('cash-accounts', { company: M, name: 'Kas kecil site', kind: 'cash', openingBalance: 0, openingBalanceDate: '2020-01-01', site })
  await sysCreate('cash-accounts', { company: N, name: 'Kas N', kind: 'cash', openingBalance: 900 * JT, openingBalanceDate: '2020-01-01' })
  cat = await sysCreate('expense-categories', { company: M, code: 'MAT', name: 'Material' })
  srcM = await sysCreate('cash-in-sources', { company: M, code: 'MODAL', name: 'Modal owner' })

  staffEmp = await sysCreate('employees', { company: M, code: 'FC-STF', name: 'FC Staf Peminjam' })
  ownerEmp = await sysCreate('employees', { company: M, code: 'FC-OWN', name: 'FC Owner Grup' })
  staffM = await makeFlowUser(['pk-staff'], 'fc-staff-m', staffEmp, { company: M })
  owner = await makeFlowUser(['pk-principal'], 'fc-owner', ownerEmp, { company: M })
  await addMembership(owner.id, L, ['pk-principal', 'pk-finance'], null) // the Owner also holds Finance in L (G1 case)
  await addMembership(owner.id, N, ['pk-principal'], null)
  financeL = await makeFlowUser(['pk-finance'], 'fc-finance-l', null, { company: L })
  financeM = await makeFlowUser(['pk-finance'], 'fc-finance-m', null, { company: M })
  direkturM = await makeFlowUser(['pk-owner'], 'fc-direktur-m', null, { company: M })
  groupAdmin = await makeFlowUser(['pk-admin'], 'fc-group-admin', null, { company: M, groupAdmin: true })
  outsider = await makeFlowUser(['pk-finance'], 'fc-outsider', null) // Finance of DRMS only
  accStaff = await sysCreate('employee-bank-accounts', { employee: staffEmp, bank, accountNo: `63${Date.now() % 1e9}`, accountHolder: 'FC Staf', isDefault: true, verificationStatus: 'verified' })
  accOwnerEmp = await sysCreate('employee-bank-accounts', { employee: ownerEmp, bank, accountNo: `64${Date.now() % 1e9}`, accountHolder: 'FC Owner', isDefault: true, verificationStatus: 'verified' })

  const pm = await fixturePm(M)
  const cc = await sysCreate('cost-centers', { company: M, code: 'FC-CC', name: 'FC Operasional' })
  pOwner = await sysCreate('projects', { company: M, code: 'FC-P1', name: 'FC Proyek Direktur lalu Owner', pm, budget: 0, status: 'berjalan', costCenter: cc })
  pNoOwner = await sysCreate('projects', { company: M, code: 'FC-P2', name: 'FC Proyek tanpa Owner', pm, budget: 0, status: 'berjalan', costCenter: cc })
  pOwn = await sysCreate('projects', { company: M, code: 'FC-P3', name: 'FC Proyek Owner', pm, budget: 0, status: 'berjalan', costCenter: cc })
  for (const project of [pOwner, pNoOwner, pOwn]) {
    await sysCreate('team-assignments', { company: M, employee: staffEmp, project, roleInProject: 'staff' })
    await sysCreate('team-assignments', { company: M, employee: ownerEmp, project, roleInProject: 'staff' })
  }
  const rule = (name: string, project: number, steps: Array<{ level: number; approverRole: string }>) =>
    sysCreate('approval-rules', { company: M, name, docType: 'expense_request', requestType: 'any', minAmount: 0, priority: 10, project, acknowledge: 'none', acknowledgeBy: 'role', acknowledgeRole: null, steps, active: true })
  await rule('FC Direktur lalu Owner', pOwner, [
    { level: 1, approverRole: 'pk-owner' },
    { level: 2, approverRole: 'pk-principal' },
  ])
  await rule('FC Direktur saja (tanpa level Owner)', pNoOwner, [{ level: 1, approverRole: 'pk-owner' }])
  // the Owner's own request: "Pengajuan Owner" (zero steps) — copied from the source PT; created if missing
  const have = await p.find({ collection: 'approval-rules', where: { and: [{ company: { equals: M } }, { name: { equals: OWNER_RULE_NAME } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
  if (have.docs.length === 0) {
    await sysCreate('approval-rules', { company: M, name: OWNER_RULE_NAME, docType: 'expense_request', requestType: 'any', minAmount: 0, priority: 5, requesterRoles: ['pk-principal'], acknowledge: 'none', acknowledgeBy: 'role', acknowledgeRole: null, steps: [], active: true })
  }
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  for (const id of [L, M]) if (id) await sqlAs('owner', "UPDATE period_closings SET status = 'reopened', reopen_reason = 'uji cek dana selesai' WHERE company_id = $1 AND status = 'closed'", [id])
  if (M) await sqlAs('owner', 'UPDATE companies SET fund_check_enabled = false WHERE id = $1', [M])
  for (const id of [L, M, N]) if (id) await p.update({ collection: 'companies', id, data: { active: false, changeReason: 'uji cek dana selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

const body = (project: number, amount: number, over: Record<string, unknown> = {}) => ({
  type: 'advance',
  title: `Pembelian material ${amount / JT} jt`,
  projectId: project,
  requesterIds: [staffEmp],
  bankAccountId: accStaff,
  neededDate: '2026-12-31',
  lines: [{ description: 'Material proyek', qty: 1, uomId: uom, unitPrice: amount, total: amount, categoryId: cat }],
  ...over,
})

/** Staff request through submit (+ the Direktur's level-1 approval when `atOwner`) → its id. */
async function request(project: number, amount: number, opts: { atOwner?: boolean } = {}): Promise<number> {
  const d = await ok(api('POST', E, staffM, body(project, amount), key()), 201)
  await ok(api('POST', `${E}/${d.id}/submit`, staffM, {}, key()))
  if (opts.atOwner) expect((await ok(api('POST', `${E}/${d.id}/approve`, direkturM, {}, key()))).currentLevel).toBe(2)
  return d.id as number
}

const statusOf = async (id: number) => (await sqlAs('app', 'SELECT status::text AS s, current_level::int AS l FROM expense_requests WHERE id = $1', [id])).rows[0] as { s: string; l: number | null }
const notes = async (event: string, docId: number | string) => (await sqlAs('app', 'SELECT user_id::int AS u, title, body, company_id AS c FROM notifications WHERE event = $1 AND doc_id = $2 ORDER BY id', [event, String(docId)])).rows as Array<{ u: number; title: string; body: string; c: number }>
async function proof(user: FlowUser): Promise<number> {
  return (await ok(upload('/api/v1/media/transfer-proofs', user, await png()), 201)).id as number
}
const nowAt = () => new Date(Date.now() - 5 * 60_000).toISOString()

let r0 = 0
let r1 = 0
let r2 = 0

describe('0. switch OFF (default): today\'s behaviour, the panel is information only', () => {
  it('availability: every active account (DRMS 24/10: a site-flagged one too); Kas roles of the PT only', async () => {
    expect(await figures(M)).toEqual({ balance: 100 * JT, commitments: 0, available: 100 * JT })
    const a = await ok(api('GET', `/api/v1/fund-availability?company=${M}`, financeM))
    expect(a).toMatchObject({ companyId: M, enabled: false, balance: 100 * JT, commitments: 0, available: 100 * JT, excludedSiteAccounts: { count: 0, balance: 0 } })
    expect(a.accounts.map((x: { id: number }) => x.id)).toEqual([accM, accSiteM])
    expect((await api('GET', `/api/v1/fund-availability?company=${M}`, staffM)).status).toBe(403)
    expect((await api('GET', `/api/v1/fund-availability?company=${M}`, financeL)).status).toBe(403) // not a member of M
  })

  it('the Owner approves beyond the funds; detail shows the panel (not blocked); Finance cancels', async () => {
    r0 = await request(pOwner, 150 * JT, { atOwner: true })
    const d = await ok(api('GET', `${E}/${r0}`, owner))
    expect(d.fundCheck).toMatchObject({ enabled: false, applies: true, status: 'insufficient', blocked: false, gap: 50 * JT })
    expect(d.allowedActions).toEqual(expect.arrayContaining(['approve', 'instruct_loan']))
    expect((await ok(api('GET', `${E}/${r0}`, staffM))).fundCheck).toBeNull() // requester: no figures
    expect((await ok(api('POST', `${E}/${r0}/approve`, owner, {}, key()))).status).toBe('approved')
    expect((await figures(M)).commitments).toBe(150 * JT)
    expect((await ok(api('POST', `${E}/${r0}/cancel`, financeM, { reason: 'uji cek dana: dibatalkan' }, key()))).status).toBe('cancelled')
    expect(await figures(M)).toMatchObject({ commitments: 0, available: 100 * JT })
  })
})

describe('1. the per-PT switch: group admin only, reason required, audited', () => {
  it('a Direktur cannot switch it; the group admin needs a reason; audited', async () => {
    const p = await getTestPayload()
    await p.update({ collection: 'companies', id: M, data: { fundCheckEnabled: true, changeReason: 'coba' } as never, user: direkturM as never, overrideAccess: false })
    expect((await sqlAs('app', 'SELECT fund_check_enabled AS f FROM companies WHERE id = $1', [M])).rows[0].f).toBe(false)
    await expect(p.update({ collection: 'companies', id: M, data: { fundCheckEnabled: true } as never, user: groupAdmin as never, overrideAccess: false })).rejects.toThrow()
    await p.update({ collection: 'companies', id: M, data: { fundCheckEnabled: true, changeReason: 'saldo cocok dengan rekening koran per hari ini' } as never, user: groupAdmin as never, overrideAccess: false })
    expect((await sqlAs('app', 'SELECT fund_check_enabled AS f FROM companies WHERE id = $1', [M])).rows[0].f).toBe(true)
    const audit = await sqlAs('app', "SELECT reason FROM audit_logs WHERE doc_type = 'company' AND doc_id = $1 AND field = 'fundCheckEnabled'", [String(M)])
    expect(audit.rows.map((r) => r.reason)).toContain('saldo cocok dengan rekening koran per hari ini')
    const me = await ok(api('GET', '/api/v1/me', owner))
    expect(me.companies.find((c: { id: number }) => c.id === M).capabilities).toMatchObject({ fundCheckEnabled: true, instructIntercompanyLoan: true })
  })
})

describe('2. the block at the Owner approval (hard, 409 FUND_INSUFFICIENT)', () => {
  it('refused with the figures; the request stays at the Owner step; audited; panel + inbox badge; Owner notified', async () => {
    r1 = await request(pOwner, 120 * JT, { atOwner: true })
    // the request reached the Owner level while short → expense.fund_shortfall (besides the normal pending_approval)
    const fs = await notes('expense.fund_shortfall', r1)
    expect(fs.map((x) => x.u)).toEqual([owner.id])
    expect(fs[0]!.title).toContain('tidak cukup')
    expect(fs[0]!.body).toContain('kurang Rp 20.000.000')
    const r = await api('POST', `${E}/${r1}/approve`, owner, {}, key())
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'FUND_INSUFFICIENT', companyId: M, balance: 100 * JT, commitments: 0, available: 100 * JT, needed: 120 * JT, gap: 20 * JT })
    expect(r.body.title).toContain('kurang Rp 20.000.000')
    expect(await statusOf(r1)).toEqual({ s: 'pending_approval', l: 2 })
    expect((await sqlAs('app', "SELECT count(*)::int AS n FROM approvals WHERE request_id = $1 AND position = 'approval' AND level = 2", [r1])).rows[0].n).toBe(0)
    const audit = await sqlAs('app', "SELECT field, new_value FROM audit_logs WHERE action = 'fund_insufficient' AND doc_type = 'expense_request' AND doc_id = $1", [String(r1)])
    expect(audit.rows).toEqual([expect.objectContaining({ field: 'approve', new_value: { v: expect.objectContaining({ needed: 120 * JT, available: 100 * JT, gap: 20 * JT }) } })])
    const d = await ok(api('GET', `${E}/${r1}`, owner))
    expect(d.fundCheck).toMatchObject({ enabled: true, applies: true, status: 'insufficient', blocked: true, needed: 120 * JT, gap: 20 * JT, accountCount: 1 })
    expect(d.fundCheck.blockedText).toContain('kurang Rp 20.000.000')
    expect(d.allowedActions).toEqual(expect.arrayContaining(['approve', 'reject', 'instruct_loan']))
    // the Direktur reads the panel (no loan action); Finance of the PT too
    const dd = await ok(api('GET', `${E}/${r1}`, direkturM))
    expect(dd.fundCheck).toMatchObject({ blocked: true })
    expect(dd.allowedActions).not.toContain('instruct_loan')
    const inbox = await ok(api('GET', '/api/v1/approvals/inbox', owner))
    expect(inbox.items.find((i: { id: number }) => i.id === r1)).toMatchObject({ finalStep: true, fundShort: 20 * JT })
  })

  it('the Owner may still reject (no fund check on a rejection)', async () => {
    const x = await request(pOwner, 130 * JT, { atOwner: true })
    expect((await ok(api('POST', `${E}/${x}/reject`, owner, { reason: 'ditunda, dana belum ada' }, key()))).status).toBe('rejected')
  })
})

describe('3. commitments: approved-not-transferred, LPJ shortfall, instructed loans', () => {
  it('an approval reserves the money: Rp 60 jt passes, the decision row keeps the figures; the next request sees the commitment', async () => {
    r2 = await request(pOwner, 60 * JT, { atOwner: true })
    expect((await ok(api('POST', `${E}/${r2}/approve`, owner, {}, key()))).status).toBe('approved')
    const row = (await sqlAs('app', "SELECT fund_balance::bigint AS b, fund_commitments::bigint AS c, fund_available::bigint AS a FROM approvals WHERE request_id = $1 AND position = 'approval' AND level = 2", [r2])).rows[0]
    expect({ b: Number(row.b), c: Number(row.c), a: Number(row.a) }).toEqual({ b: 100 * JT, c: 0, a: 100 * JT })
    expect(await figures(M)).toEqual({ balance: 100 * JT, commitments: 60 * JT, available: 40 * JT })
    const r = await api('POST', `${E}/${r1}/approve`, owner, {}, key())
    expect(r.body).toMatchObject({ code: 'FUND_INSUFFICIENT', commitments: 60 * JT, available: 40 * JT, gap: 80 * JT })
    const d = await ok(api('GET', `${E}/${r1}`, financeM))
    expect(d.fundCheck.commitmentItems).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'request', id: r2, amount: 60 * JT })]))
  })

  it('a verified, unsettled LPJ shortfall is a commitment (DB function = the panel figure)', async () => {
    // fixture: a verified shortfall LPJ of a request of M (row written by the owner; the LPJ flow itself is covered elsewhere)
    await sqlAs('owner', 'ALTER TABLE settlements DISABLE TRIGGER USER')
    let sid = 0
    try {
      sid = (await sqlAs('owner', "INSERT INTO settlements (company_id, request_id, doc_no, status, settlement_type, difference, transferred_total) VALUES ($1, $2, 'LPJ/FC/UJI/1', 'verified', 'shortfall', -5000000, 0) RETURNING id", [M, r0])).rows[0].id
    } finally {
      await sqlAs('owner', 'ALTER TABLE settlements ENABLE TRIGGER USER')
    }
    expect((await figures(M)).commitments).toBe(65 * JT)
    const a = await ok(api('GET', `/api/v1/fund-availability?company=${M}`, financeM))
    expect(a.commitmentItems).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'shortfall', amount: 5 * JT })]))
    await sqlAs('owner', 'ALTER TABLE settlements DISABLE TRIGGER USER')
    try {
      await sqlAs('owner', "UPDATE settlements SET status = 'settled' WHERE id = $1", [sid])
    } finally {
      await sqlAs('owner', 'ALTER TABLE settlements ENABLE TRIGGER USER')
    }
    expect((await figures(M)).commitments).toBe(60 * JT)
  })
})

describe('4. concurrency: two Owner approvals racing on the same money (per-PT advisory lock)', () => {
  it('Rp 30 jt + Rp 30 jt on Rp 40 jt available → exactly one is approved, the other 409', async () => {
    const a = await request(pOwner, 30 * JT, { atOwner: true })
    const b = await request(pOwner, 30 * JT, { atOwner: true })
    const [ra, rb] = await Promise.all([api('POST', `${E}/${a}/approve`, owner, {}, key()), api('POST', `${E}/${b}/approve`, owner, {}, key())])
    expect([ra.status, rb.status].sort()).toEqual([200, 409])
    const refused = ra.status === 409 ? ra : rb
    expect(refused.body).toMatchObject({ code: 'FUND_INSUFFICIENT', available: 10 * JT, needed: 30 * JT })
    expect(await figures(M)).toEqual({ balance: 100 * JT, commitments: 90 * JT, available: 10 * JT })
    // the refused one stays waiting
    expect((await statusOf(ra.status === 409 ? a : b)).s).toBe('pending_approval')
  })
})

describe('5. the Owner\'s own request (no approval): checked at submit, stays Draft', () => {
  it('short → 409 at submit, Draft, audited; the Draft shows the panel + "Perintahkan pinjaman"', async () => {
    const d = await ok(api('POST', E, owner, body(pOwn, 20 * JT, { requesterIds: [ownerEmp], bankAccountId: accOwnerEmp, title: 'Biaya Owner' }), key()), 201)
    const pre = await ok(api('GET', `${E}/${d.id}`, owner))
    expect(pre.fundCheck).toMatchObject({ applies: true, status: 'insufficient', blocked: true, gap: 10 * JT })
    expect(pre.allowedActions).toContain('instruct_loan')
    const s = await api('POST', `${E}/${d.id}/submit`, owner, {}, key())
    expect(s.status, JSON.stringify(s.body)).toBe(409)
    expect(s.body).toMatchObject({ code: 'FUND_INSUFFICIENT', needed: 20 * JT, available: 10 * JT })
    expect(await statusOf(d.id)).toMatchObject({ s: 'draft' })
    expect((await sqlAs('app', 'SELECT doc_no FROM expense_requests WHERE id = $1', [d.id])).rows[0].doc_no).toBeNull() // the whole submit rolled back
    expect((await sqlAs('app', "SELECT field FROM audit_logs WHERE action = 'fund_insufficient' AND doc_id = $1", [String(d.id)])).rows.map((r) => r.field)).toEqual(['submit'])
    // within the funds it goes straight to Finance (ADR 0026 unchanged)
    const small = await ok(api('POST', E, owner, body(pOwn, 1 * JT, { requesterIds: [ownerEmp], bankAccountId: accOwnerEmp, title: 'Biaya Owner kecil' }), key()), 201)
    const ss = await ok(api('POST', `${E}/${small.id}/submit`, owner, {}, key()))
    expect(ss).toMatchObject({ status: 'approved', approvalRule: { name: OWNER_RULE_NAME, selfApproval: 'principal_no_approval' } })
    expect(await figures(M)).toMatchObject({ commitments: 91 * JT, available: 9 * JT })
  })
})

let r6 = 0

describe('6. a rule without an Owner level: the final (Direktur) approval is checked, the Owner notified', () => {
  it('submit → final step at once → expense.fund_shortfall to the Owner; the Direktur gets 409', async () => {
    r6 = await request(pNoOwner, 30 * JT)
    expect((await statusOf(r6)).s).toBe('pending_approval')
    expect((await notes('expense.fund_shortfall', r6)).map((x) => x.u)).toEqual([owner.id])
    const r = await api('POST', `${E}/${r6}/approve`, direkturM, {}, key())
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'FUND_INSUFFICIENT', needed: 30 * JT, available: 9 * JT })
    const d = await ok(api('GET', `${E}/${r6}`, direkturM))
    expect(d.fundCheck).toMatchObject({ applies: true, blocked: true })
    expect(d.allowedActions).not.toContain('instruct_loan') // only the Owner instructs
    expect((await ok(api('GET', `${E}/${r6}`, owner))).allowedActions).toContain('instruct_loan')
  })
})

let loanId = 0
let loanNo = ''

describe('7a. "Perintahkan pinjaman antar-PT" (Owner)', () => {
  it('lender list: every other active PT where the caller is Owner, with its "Dana tersedia"; Owner only', async () => {
    const r = await ok(api('GET', `${IC}/lenders?borrower=${M}&amount=${110 * JT}`, owner))
    expect(r.borrower).toMatchObject({ available: 9 * JT, hasReceivingAccount: true, fundCheckEnabled: true })
    expect(r.borrower.waiting.map((w: { id: number }) => w.id)).toEqual(expect.arrayContaining([r1, r6]))
    const ids = r.lenders.map((x: { company: { id: number } }) => x.company.id)
    expect(ids).toEqual(expect.arrayContaining([L, N]))
    expect(ids).not.toContain(M)
    expect(r.lenders.find((x: { company: { id: number } }) => x.company.id === L)).toMatchObject({ available: 500 * JT, sufficient: true, hasReceivingAccount: true })
    expect(r.lenders.find((x: { company: { id: number } }) => x.company.id === N)).toMatchObject({ hasReceivingAccount: false })
    expect(r.defaultDueDate > ptToday()).toBe(true)
    expect((await api('GET', `${IC}/lenders?borrower=${M}`, financeM)).status).toBe(403)
  })

  it('refusals: non-Owner 403; borrower without receiving account 400 INTERCOMPANY_NO_ACCOUNT; beyond the lender 409 LOAN_LENDER_INSUFFICIENT', async () => {
    const base = { borrowerCompanyId: M, lenderCompanyId: L, amount: 110 * JT, reason: 'Dana pengajuan PB tertahan', requestIds: [r1] }
    expect((await api('POST', IC, financeM, base, key())).status).toBe(403)
    expect((await api('POST', IC, direkturM, base, key())).status).toBe(403)
    const noAcc = await api('POST', IC, owner, { ...base, borrowerCompanyId: N, requestIds: [] }, key())
    expect(noAcc.status).toBe(400)
    expect(noAcc.body.code).toBe('INTERCOMPANY_NO_ACCOUNT')
    const big = await api('POST', IC, owner, { ...base, amount: 600 * JT }, key())
    expect(big.status).toBe(409)
    expect(big.body).toMatchObject({ code: 'LOAN_LENDER_INSUFFICIENT', lenderCompanyId: L, available: 500 * JT })
    const wrongReq = await api('POST', IC, owner, { ...base, requestIds: [r1, 999_999_999] }, key())
    expect(wrongReq.status).toBe(400)
    expect((await api('POST', IC, owner, { ...base, dueDate: '2020-01-01' }, key())).status).toBe(400)
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM intercompany_loans WHERE borrower_company_id = $1', [M])).rows[0].n).toBe(0)
  })

  it('instructed: PJA/{LENDER}/… number, reserved in the lender\'s commitments, notified; readable by both PTs only', async () => {
    // Rp 120 jt: the whole need of r1 (the "Hitung" default would be its gap, Rp 111 jt — a little more is allowed, warning only)
    const r = await ok(api('POST', IC, owner, { borrowerCompanyId: M, lenderCompanyId: L, amount: 120 * JT, reason: 'Dana pengajuan PB tertahan', requestIds: [r1] }, key()), 201)
    loanId = r.id
    loanNo = r.docNo
    const yymm = ptToday().slice(2, 4) + ptToday().slice(5, 7)
    expect(loanNo).toBe(`PJA/${codeL}/${yymm}/0001`)
    expect(r).toMatchObject({ status: 'instructed', statusLabel: 'Menunggu pencairan', amount: 120 * JT, outstanding: 0, lender: { id: L }, borrower: { id: M }, side: 'both' })
    expect(r.requests.map((x: { id: number }) => x.id)).toEqual([r1])
    expect(r.allowedActions).toEqual(['cancel']) // the Owner is Finance of L too — never the disbursement of his own instruction (G1)
    expect(r.disburseBlockedByG1).toBe(true)
    expect((await figures(L)).commitments).toBe(120 * JT)
    expect((await notes('icloan.instructed', loanId)).map((x) => x.u)).toEqual(expect.arrayContaining([financeL.id, financeM.id, direkturM.id]))
    expect((await api('GET', `${IC}/${loanId}`, outsider)).status).toBe(404)
    const fl = await ok(api('GET', `${IC}/${loanId}`, financeL))
    expect(fl.allowedActions).toEqual(['disburse'])
    // the detail carries the queue item's `destination` for the queue item's readers (Finance of the lender, instructed)
    expect(fl.destination).toMatchObject({ accountHolder: 'PT Contoh Peminjam Dana', accountNoMasked: expect.stringMatching(/^••••\d{4}$/) })
    expect(r.destination).toEqual(fl.destination) // the Owner also holds Finance in L (the G1 creator sees the queue item too)
    expect((await ok(api('GET', `${IC}/${loanId}`, financeM))).destination).toBeNull() // borrower side: not a queue reader
    expect((await ok(api('GET', `${IC}/${loanId}`, direkturM))).destination).toBeNull()
    expect(fl.requests[0]).toMatchObject({ id: r1, title: null }) // lender side: the number only
    expect((await ok(api('GET', `${IC}/${loanId}`, financeM))).requests[0].title).toMatch(/Pembelian/)
    // linked on the request's panel
    expect((await ok(api('GET', `${E}/${r1}`, owner))).fundCheck.loans).toEqual([expect.objectContaining({ id: loanId, docNo: loanNo, status: 'instructed', statusLabel: 'Menunggu pencairan' })])
    const q = await ok(api('GET', `${IC}/queue`, financeL))
    expect(q.count).toBeGreaterThanOrEqual(1)
    expect(q.items.find((i: { id: number }) => i.id === loanId)).toMatchObject({ canDisburse: true, destination: { accountHolder: 'PT Contoh Peminjam Dana' } })
    expect(q.items.find((i: { id: number }) => i.id === loanId).destination).toEqual(fl.destination) // same helper, same masking
    expect((await ok(api('GET', `${IC}/queue`, owner))).items.find((i: { id: number }) => i.id === loanId)).toMatchObject({ canDisburse: false })
  })
})

describe('7b. disbursement (Finance of the lender)', () => {
  const disburseBody = async (user: FlowUser) => ({ cashAccountId: accL, bankRef: `FC-${randomUUID().slice(0, 6)}`, proofMediaId: await proof(user), transferAt: nowAt() })

  it('G1: the instruction\'s creator (also Finance of L) → 403 + access_denied; Finance of the borrower → 403', async () => {
    const r = await api('POST', `${IC}/${loanId}/disburse`, owner, await disburseBody(owner), key())
    expect(r.status).toBe(403)
    expect((await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'access_denied' AND doc_type = 'intercompany_loan' AND field = 'disburse' AND user_id = $1", [owner.id])).rows[0].n).toBeGreaterThan(0)
    expect((await api('POST', `${IC}/${loanId}/disburse`, financeM, await disburseBody(financeM), key())).status).toBe(403)
  })

  it('closed periods: borrower → 409 INTERCOMPANY_PERIOD_CLOSED, lender → 409 "Periode … sudah ditutup"; nothing written', async () => {
    const month = ptToday().slice(0, 7)
    await sqlAs('owner', "INSERT INTO period_closings (company_id, period, status, note, updated_at, created_at) VALUES ($1, $2, 'closed', 'uji cek dana', now(), now())", [M, month])
    const r = await api('POST', `${IC}/${loanId}/disburse`, financeL, await disburseBody(financeL), key())
    expect(r.status, JSON.stringify(r.body)).toBe(409)
    expect(r.body.code).toBe('INTERCOMPANY_PERIOD_CLOSED')
    await sqlAs('owner', "UPDATE period_closings SET status = 'reopened', reopen_reason = 'uji' WHERE company_id = $1 AND status = 'closed'", [M])
    await sqlAs('owner', "INSERT INTO period_closings (company_id, period, status, note, updated_at, created_at) VALUES ($1, $2, 'closed', 'uji cek dana', now(), now())", [L, month])
    const r2b = await api('POST', `${IC}/${loanId}/disburse`, financeL, await disburseBody(financeL), key())
    expect(r2b.status).toBe(409)
    expect(r2b.body.title).toMatch(/sudah ditutup/)
    await sqlAs('owner', "UPDATE period_closings SET status = 'reopened', reopen_reason = 'uji' WHERE company_id = $1 AND status = 'closed'", [L])
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM intercompany_loan_transfers WHERE loan_id = $1', [loanId])).rows[0].n).toBe(0)
    expect((await sqlAs('app', 'SELECT status FROM intercompany_loans WHERE id = $1', [loanId])).rows[0].status).toBe('instructed')
  })

  it('KK (intercompany, out) in L + automatic KM "Antar PT" in M on its receiving account, paired; status disbursed; Owner told', async () => {
    const r = await ok(api('POST', `${IC}/${loanId}/disburse`, financeL, await disburseBody(financeL), key()))
    expect(r).toMatchObject({ status: 'disbursed', outstanding: 120 * JT })
    expect(r.destination).toBeNull() // paid: the movement's toAccount shows the account
    const mv = r.movements[0]
    expect(mv).toMatchObject({ kind: 'disbursement', label: 'Pencairan', amount: 120 * JT, status: 'posted', fromCompanyId: L, toCompanyId: M })
    expect(mv.kk.entryNo).toMatch(/^KK\//)
    expect(mv.km.entryNo).toMatch(/^KM\//)
    const link = (await sqlAs('app', "SELECT * FROM intercompany_links WHERE source_doc_type = 'intercompany_loan_disbursement' AND source_doc_id = $1", [mv.id])).rows[0]
    expect(link).toMatchObject({ status: 'posted', source_company_id: L, target_company_id: M, source_transfer_id: null, target_cash_account_id: accM })
    const kk = (await sqlAs('app', 'SELECT company_id, direction::text AS d, source_type::text AS s, cash_account_id, amount::bigint AS a, project_id, description FROM cash_entries WHERE id = $1', [link.source_cash_entry_id])).rows[0]
    expect(kk).toMatchObject({ company_id: L, d: 'out', s: 'intercompany', cash_account_id: accL, project_id: null })
    expect(Number(kk.a)).toBe(120 * JT)
    expect(kk.description).toContain(loanNo) // the lender's own number
    const km = (await sqlAs('app', 'SELECT company_id, direction::text AS d, source_type::text AS s, cash_account_id, description FROM cash_entries WHERE id = $1', [link.target_cash_entry_id])).rows[0]
    expect(km).toMatchObject({ company_id: M, d: 'in', s: 'intercompany', cash_account_id: accM })
    expect(km.description).not.toContain('PJA') // never a number of the other PT (ADR 0028 §5)
    expect(await figures(L)).toEqual({ balance: 380 * JT, commitments: 0, available: 380 * JT })
    expect(await figures(M)).toMatchObject({ balance: 220 * JT, available: 129 * JT })
    const told = await notes('icloan.disbursed', loanId)
    expect(told.map((x) => x.u)).toEqual(expect.arrayContaining([owner.id, financeM.id, direkturM.id]))
    expect(told.find((x) => x.u === owner.id)!.body).toContain('siap disetujui')
    expect(await notes('cash.intercompany_received', link.target_cash_entry_id)).toEqual([]) // one message, not two
  })

  it('no automatic approval: the request waits for the Owner, who approves AGAIN with a fresh check', async () => {
    expect(await statusOf(r1)).toEqual({ s: 'pending_approval', l: 2 })
    expect((await ok(api('GET', `${E}/${r1}`, owner))).fundCheck.loans).toEqual([expect.objectContaining({ id: loanId, status: 'disbursed', statusLabel: 'Dicairkan' })])
    const a = await ok(api('POST', `${E}/${r1}/approve`, owner, {}, key()))
    expect(a.status).toBe('approved')
    const row = (await sqlAs('app', "SELECT fund_available::bigint AS a FROM approvals WHERE request_id = $1 AND position = 'approval' AND level = 2", [r1])).rows[0]
    expect(Number(row.a)).toBe(129 * JT)
    expect(await figures(M)).toMatchObject({ commitments: 211 * JT, available: 9 * JT })
  })

  it('Kas / reports: the legs are "Antar PT" with the loan as document; Rekap Kas lines; report "Pinjaman antar-PT"', async () => {
    const km = await ok(api('GET', '/api/v1/cash-entries?sourceType=intercompany', financeM))
    const row = km.items.find((i: { companyId: number; direction: string }) => i.companyId === M && i.direction === 'in')
    expect(row.intercompany).toMatchObject({ sourceDocType: 'intercompany_loan', loanLeg: 'received', sourceDocNo: loanNo, sourceDocId: loanId, counterpartCompany: { id: L } })
    const v = await api('POST', `/api/v1/cash-entries/${row.id}/void`, financeM, { reason: 'coba void langsung' }, key())
    expect(v.status).toBe(409)
    expect(v.body.title).toContain(loanNo)
    const rep = await ok(api('GET', '/api/v1/reports/pinjaman-antar-pt', financeL))
    expect(rep.main.rows.map((x: { nomor: string }) => x.nomor)).toContain(loanNo)
    const lenderRow = rep.main.rows.find((x: { nomor: string }) => x.nomor === loanNo)
    expect(lenderRow).toMatchObject({ peran: 'Pemberi (piutang)', piutang: 120 * JT, hutang: 0 })
    expect((await api('GET', '/api/v1/reports/pinjaman-antar-pt', staffM)).status).toBe(403)
    const kas = await ok(api('GET', `/api/v1/reports/rekap-kas?pt=${L}`, financeL))
    expect(JSON.stringify(kas)).toContain('Pinjaman antar-PT diberikan')
  })
})

describe('7c. repayment (Finance of the borrower, no approval, partial, fund-checked)', () => {
  const repayBody = async (amount: number, over: Record<string, unknown> = {}) => ({ cashAccountId: accM, bankRef: `FCR-${randomUUID().slice(0, 6)}`, proofMediaId: await proof(financeM), transferAt: nowAt(), amount, ...over })
  let mvId = 0

  it('refusals: Finance of the lender 403; above the outstanding 409; above the borrower\'s "Dana tersedia" 409 FUND_INSUFFICIENT', async () => {
    expect((await api('POST', `${IC}/${loanId}/repayments`, financeL, { cashAccountId: accL, bankRef: 'x', proofMediaId: await proof(financeL), transferAt: nowAt(), amount: 10 * JT }, key())).status).toBe(403)
    const over = await api('POST', `${IC}/${loanId}/repayments`, financeM, await repayBody(200 * JT), key())
    expect(over.status).toBe(409)
    expect(over.body.code).toBe('LOAN_REPAYMENT_EXCEEDS_OUTSTANDING')
    const short = await api('POST', `${IC}/${loanId}/repayments`, financeM, await repayBody(10 * JT), key()) // available Rp 9 jt
    expect(short.status).toBe(409)
    expect(short.body.code).toBe('FUND_INSUFFICIENT')
  })

  it('lender period closed → 409 INTERCOMPANY_PERIOD_CLOSED (receiving side)', async () => {
    await ok(api('POST', '/api/v1/cash-entries', financeM, { direction: 'in', cashAccountId: accM, amount: 50 * JT, description: 'Setoran modal uji', cashInSourceId: srcM }, key()), 201)
    expect((await figures(M)).available).toBe(59 * JT)
    await sqlAs('owner', "INSERT INTO period_closings (company_id, period, status, note, updated_at, created_at) VALUES ($1, $2, 'closed', 'uji cek dana', now(), now())", [L, ptToday().slice(0, 7)])
    const r = await api('POST', `${IC}/${loanId}/repayments`, financeM, await repayBody(30 * JT), key())
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('INTERCOMPANY_PERIOD_CLOSED')
    await sqlAs('owner', "UPDATE period_closings SET status = 'reopened', reopen_reason = 'uji' WHERE company_id = $1 AND status = 'closed'", [L])
  })

  it('partial repayment: KK in M + KM in L, "Sebagian dikembalikan", Owner + lender told; void moves it back', async () => {
    const r = await ok(api('POST', `${IC}/${loanId}/repayments`, financeM, await repayBody(30 * JT), key()), 201)
    expect(r).toMatchObject({ status: 'partially_repaid', repaidTotal: 30 * JT, outstanding: 90 * JT })
    const mv = r.movements.find((m: { kind: string }) => m.kind === 'repayment')
    mvId = mv.id
    expect(mv).toMatchObject({ label: 'Pengembalian ke-1', fromCompanyId: M, toCompanyId: L })
    const link = (await sqlAs('app', "SELECT source_company_id, target_company_id, target_cash_account_id FROM intercompany_links WHERE source_doc_type = 'intercompany_loan_repayment' AND source_doc_id = $1", [mvId])).rows[0]
    expect(link).toEqual({ source_company_id: M, target_company_id: L, target_cash_account_id: accL })
    expect((await notes('icloan.repaid', loanId)).map((x) => x.u)).toEqual(expect.arrayContaining([owner.id, financeL.id]))
    const v = await ok(api('POST', `${IC}/${loanId}/repayments/${mvId}/void`, financeM, { reason: 'salah nominal' }, key()))
    expect(v).toMatchObject({ status: 'disbursed', repaidTotal: 0, outstanding: 120 * JT })
    expect((await sqlAs('app', 'SELECT status FROM intercompany_links WHERE source_doc_type = $1 AND source_doc_id = $2', ['intercompany_loan_repayment', mvId])).rows[0].status).toBe('void')
  })
})

describe('7d. void of the disbursement (Finance of the lender) and cancel (Owner)', () => {
  it('with a posted repayment → 409 LOAN_HAS_REPAYMENTS', async () => {
    const r = await ok(api('POST', `${IC}/${loanId}/repayments`, financeM, { cashAccountId: accM, bankRef: 'FCR-2', proofMediaId: await proof(financeM), transferAt: nowAt(), amount: 10 * JT }, key()), 201)
    const v = await api('POST', `${IC}/${loanId}/disbursement/void`, financeL, { reason: 'salah rekening' }, key())
    expect(v.status).toBe(409)
    expect(v.body.code).toBe('LOAN_HAS_REPAYMENTS')
    const mv = r.movements.find((m: { kind: string; status: string }) => m.kind === 'repayment' && m.status === 'posted')
    await ok(api('POST', `${IC}/${loanId}/repayments/${mv.id}/void`, financeM, { reason: 'batal' }, key()))
  })

  it('the borrower would go negative → 409 LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED; confirmed → reversed both sides, back to instructed', async () => {
    const v = await api('POST', `${IC}/${loanId}/disbursement/void`, financeL, { reason: 'salah rekening' }, key())
    expect(v.status).toBe(409)
    expect(v.body).toMatchObject({ code: 'LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED', borrowerCompanyId: M, after: -61 * JT })
    const ok2 = await ok(api('POST', `${IC}/${loanId}/disbursement/void`, financeL, { reason: 'salah rekening', confirmBorrowerShortfall: true }, key()))
    expect(ok2).toMatchObject({ status: 'instructed', outstanding: 0, destination: { accountHolder: 'PT Contoh Peminjam Dana' } }) // waiting again
    expect(ok2.movements[0]).toMatchObject({ kind: 'disbursement', status: 'void' })
    expect((await statusOf(r1)).s).toBe('approved') // approved requests stay approved
    expect((await notes('icloan.disbursement_voided', loanId)).map((x) => x.u)).toEqual(expect.arrayContaining([owner.id, financeM.id]))
    expect(await figures(L)).toMatchObject({ balance: 500 * JT, commitments: 120 * JT })
  })

  it('cancel: Owner only, reason, while waiting; the reservation is released', async () => {
    expect((await api('POST', `${IC}/${loanId}/cancel`, financeL, { reason: 'tidak perlu' }, key())).status).toBe(403)
    const c = await ok(api('POST', `${IC}/${loanId}/cancel`, owner, { reason: 'pengajuan dibiayai dari setoran' }, key()))
    expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'pengajuan dibiayai dari setoran', destination: null })
    expect((await figures(L)).commitments).toBe(0)
    expect((await api('POST', `${IC}/${loanId}/cancel`, owner, { reason: 'lagi' }, key())).status).toBe(409)
  })
})

describe('7e. overdue reminder (daily, borrower PT) + the DB guards', () => {
  let loan2 = 0
  it('a loan due today and disbursed is "Terlambat" tomorrow: Owner, Finance + Direktur of M, Finance of L reminded once a day', async () => {
    const r = await ok(api('POST', IC, owner, { borrowerCompanyId: M, lenderCompanyId: L, amount: 5 * JT, reason: 'Pinjaman jatuh tempo hari ini', dueDate: ptToday() }, key()), 201)
    loan2 = r.id
    // G1 in the DB: the creator (Finance of L too) cannot be the executor even by SQL
    const mvSql = "INSERT INTO intercompany_loan_transfers (loan_id, kind, from_company_id, to_company_id, from_cash_account_id, to_cash_account_id, amount, transfer_date, bank_ref, executed_by_id) VALUES ($1, 'disbursement', $2, $3, $4, $5, $6, $7, 'x', $8)"
    expect((await sqlError('app', mvSql, [loan2, L, M, accL, accM, 5 * JT, ptToday(), owner.id]))?.code).toBe('42501')
    await ok(api('POST', `${IC}/${loan2}/disburse`, financeL, { cashAccountId: accL, bankRef: 'FC-OD', proofMediaId: await proof(financeL), transferAt: nowAt() }, key()))
    const tomorrow = new Date(Date.now() + 26 * 3600_000)
    await runDailyReminders(await getTestPayload(), { now: tomorrow, force: true, companyId: M })
    await runDailyReminders(await getTestPayload(), { now: tomorrow, force: true, companyId: M }) // same day: not again
    const od = await notes('icloan.overdue', loan2)
    expect(od.map((x) => x.u).sort((a, b) => a - b)).toEqual([owner.id, financeL.id, financeM.id, direkturM.id].sort((a, b) => a - b))
    expect(od.find((x) => x.u === financeL.id)!.c).toBe(L)
    expect(od.find((x) => x.u === financeM.id)!.c).toBe(M)
  })

  it('loan tables: Owner-only insert, frozen content, no DELETE, sides of a link checked', async () => {
    expect(
      (await sqlError('app', "INSERT INTO intercompany_loans (doc_no, lender_company_id, borrower_company_id, amount, instruction_date, due_date, reason, created_by_id) VALUES ('PJA/X/1', $1, $2, 1000, '2026-10-15', '2026-11-15', 'uji guard', $3)", [L, M, financeL.id]))?.code,
    ).toBe('42501')
    expect((await sqlError('app', 'UPDATE intercompany_loans SET amount = 1 WHERE id = $1', [loan2]))?.code).toBe('42501')
    expect((await sqlError('app', "UPDATE intercompany_loans SET due_date = '2099-01-01' WHERE id = $1", [loan2]))?.code).toBe('42501')
    expect((await sqlError('app', 'DELETE FROM intercompany_loans WHERE id = $1', [loan2]))?.code).toBe('42501')
    expect((await sqlError('app', "UPDATE intercompany_loans SET status = 'instructed' WHERE id = $1", [loanId]))).not.toBeNull() // cancelled is final
    const link = (await sqlAs('app', "SELECT * FROM intercompany_links WHERE source_doc_type = 'intercompany_loan_disbursement' AND status = 'posted' ORDER BY id DESC LIMIT 1")).rows[0]
    // a second link for the same movement / the sides swapped → refused
    expect(
      (
        await sqlError(
          'app',
          "INSERT INTO intercompany_links (source_company_id, target_company_id, source_doc_type, source_doc_id, source_cash_entry_id, target_cash_account_id, target_cash_entry_id, amount) VALUES ($1, $2, 'intercompany_loan_repayment', $3, $4, $5, $6, $7)",
          [link.source_company_id, link.target_company_id, link.source_doc_id, link.source_cash_entry_id, link.target_cash_account_id, link.target_cash_entry_id, link.amount],
        )
      )?.code,
    ).toBe('23514')
  })

  it('backstop: with the switch on, a status change into "approved" beyond the funds is refused by the DB (23514)', async () => {
    // r6 (Rp 30 jt) still waits; M is short — the approval guard is paused only for this statement (three transactions)
    await sqlAs('owner', 'ALTER TABLE expense_requests DISABLE TRIGGER expense_requests_approval_guard')
    let err: { code?: string; message: string } | null = null
    try {
      err = await sqlError('app', "UPDATE expense_requests SET status = 'approved', approved_amount = grand_total, approved_at = now() WHERE id = $1", [r6])
    } finally {
      await sqlAs('owner', 'ALTER TABLE expense_requests ENABLE TRIGGER expense_requests_approval_guard')
    }
    expect(err?.code).toBe('23514')
    expect(err?.message).toContain('fund check')
    expect((await statusOf(r6)).s).toBe('pending_approval')
  })
})

describe('8. switch OFF again: the block disappears at once (rollback path)', () => {
  it('the Direktur\'s final approval of r6 passes while M is still short', async () => {
    await sqlAs('owner', 'UPDATE companies SET fund_check_enabled = false WHERE id = $1', [M])
    expect((await figures(M)).available).toBeLessThan(30 * JT)
    expect((await ok(api('POST', `${E}/${r6}/approve`, direkturM, {}, key()))).status).toBe('approved')
  })
})
