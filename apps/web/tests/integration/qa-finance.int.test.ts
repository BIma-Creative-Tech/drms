import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import { createLocalReq, type Payload } from 'payload'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { json, v1 } from '@/api/v1/http'
import { balances, booksStartDate, closePeriod } from '@/domain/cash/ledger'
import { transferQueue } from '@/domain/expense/queues'
import { addDays } from '@/domain/expense/types'
import { cashBalances, cashFlowMonthly } from '@/domain/reports/kpi'
import { officeScope } from '@/domain/reports/scope'
import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'
import { down as migrationDown, up as migrationUp } from '@/migrations/20261008_090000_qa_finance_integrity'
import { getRequestTx } from '@/lib/tx'

import { api, asUser, draftBody, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'
import { auditRows, companyId, getTestPayload, sqlAs, sqlError } from './helpers'

/**
 * QA report 2026-10-08 — keuangan, end to end through /api/v1 and the DB guards:
 * QA-05 (date before the account opening date → 400, wrapped pg errors → 409 never 500),
 * QA-04 (overdraft → 409 CASH_OVERDRAFT_CONFIRM_REQUIRED, confirmation audited),
 * QA-17 (unverified destination → 409 BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED, queue shows the state, audited),
 * QA-14 (opening balance only from its date: K-01, K-02 running balance, balances API),
 * QA-30 (no closing before the books start), QA-06 / ADR 0019 (shortfall above approved + tolerance → re-approval
 * Direktur → Finance; DB guards), and the migration (idempotent up, guarded down).
 */
let p: Payload
let w: World
let Q: number // a PT of its own for the go-live dates (QA-14/QA-30) — DRMS stays without a books start
let finQ: FlowUser
const E = '/api/v1/expense-requests'
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) // Asia/Makassar
const month = (d: string) => d.slice(0, 7)
const firstOf = (d: string) => `${month(d)}-01`
const prevMonth = (d: string) => month(addDays(firstOf(d), -1))
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const key = () => ({ 'Idempotency-Key': randomUUID() })

beforeAll(async () => {
  p = await getTestPayload()
  w = await makeWorld('QF')
  const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
  await seed(p, { uoms, banks, companies: [drms, { ...drms, company: { name: 'PT Uji Keuangan', shortCode: 'QAF', timezone: 'Asia/Makassar' }, vehicles: [] }] })
  Q = await companyId('QAF')
  await p.update({ collection: 'companies', id: Q, data: { active: true, changeReason: 'uji QA keuangan' } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  finQ = await makeFlowUser(['pk-finance', 'pk-owner'], 'qf-fin-q', null, { company: Q, signature: false })
})

afterAll(async () => {
  if (Q) await p.update({ collection: 'companies', id: Q, data: { active: false, changeReason: 'uji QA keuangan selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

async function proof(user: FlowUser = w.users.finance): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', user, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

/** Cash account (default PT DRMS — two PTs are active in this file, so the PT is always named). */
async function account(data: Record<string, unknown>): Promise<number> {
  return sysCreate('cash-accounts', { name: `QF akun ${randomUUID().slice(0, 6)}`, kind: 'bank', company: await companyId(), ...data })
}

/** Pengajuan Baru 750.000 → submitted, Direktur + Finance approved (not transferred). */
async function approvedAdvance(over: Record<string, unknown> = {}): Promise<number> {
  const c = await api('POST', E, w.users.staffA, draftBody(w, over))
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const id = c.body.id as number
  expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
  expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})).status).toBe(200)
  const a = await api('POST', `${E}/${id}/approve`, w.users.finance, {})
  expect(a.status, JSON.stringify(a.body)).toBe(200)
  return id
}

async function entries(accountId: number): Promise<number> {
  return Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM cash_entries WHERE cash_account_id = $1', [accountId])).rows[0].n)
}

// ------------------------------------------------------------------------------------------------ QA-05

describe('QA-05 — date before the account opening-balance date: 400 with the date, never 500', () => {
  it('cash entry: 400 "Tanggal sebelum tanggal saldo awal akun (dd/mm/yyyy)" on entryDate; nothing posted', async () => {
    const t = today()
    const acc = await account({ company: Q, openingBalance: 5_000_000, openingBalanceDate: t })
    const src = (await sqlAs('app', "SELECT id FROM cash_in_sources WHERE company_id = $1 AND code = 'MODAL'", [Q])).rows[0].id
    const r = await api('POST', '/api/v1/cash-entries', finQ, { direction: 'in', entryDate: addDays(t, -1), cashAccountId: acc, amount: 1000, description: 'sebelum go-live', cashInSourceId: src }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(400)
    expect(r.body.title).toBe(`Tanggal sebelum tanggal saldo awal akun (${dmy(t)}).`)
    expect(r.body.errors).toEqual([{ path: 'entryDate', message: `Tanggal sebelum tanggal saldo awal akun (${dmy(t)}).` }])
    expect(await entries(acc)).toBe(0)
    // on / after the opening date: fine
    expect((await api('POST', '/api/v1/cash-entries', finQ, { direction: 'in', entryDate: t, cashAccountId: acc, amount: 1000, description: 'hari go-live', cashInSourceId: src }, key())).status).toBe(201)
  })

  it('transfer dated before the source account opening date: 400 on transferDate (no transfer, no KK)', async () => {
    const id = await approvedAdvance()
    const t = today()
    const acc = await account({ openingBalance: 10_000_000, openingBalanceDate: t })
    try {
      const r = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: acc, bankRef: `QF-${id}`, proofMediaId: await proof(), transferDate: addDays(t, -1) })
      expect(r.status, JSON.stringify(r.body)).toBe(400)
      expect(r.body.errors).toEqual([{ path: 'transferDate', message: `Tanggal sebelum tanggal saldo awal akun (${dmy(t)}).` }])
      expect(Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM transfers WHERE request_id = $1', [id])).rows[0].n)).toBe(0)
    } finally {
      // DRMS must not get a books start from this fixture (QA-30 rule), the account is not used again
      await p.update({ collection: 'cash-accounts', id: acc, data: { openingBalanceDate: null, active: false, changeReason: 'uji QA-05 selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: fixture cleanup */ })
    }
  })

  it('a DB guard error wrapped by drizzle (SQLSTATE on `cause`) is answered 409, not 500', async () => {
    const ep = v1({
      path: '/qa-test/db-guard',
      method: 'post',
      auth: 'public',
      transactional: true,
      handler: async ({ req }) => {
        const tx = await getRequestTx(req)
        await tx.execute(sql`DO $x$ BEGIN RAISE EXCEPTION 'qa guard' USING ERRCODE = '42501'; END $x$`)
        return json({})
      },
    })
    const req = await createLocalReq({}, p)
    Object.assign(req, { headers: new Headers(), searchParams: new URLSearchParams(), routeParams: {} })
    const res = await ep.handler(req)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ title: 'Conflict', detail: 'Ditolak oleh aturan integritas data.' })
  })
})

// ------------------------------------------------------------------------------------------------ QA-04

describe('QA-04 — cash-out below 0: 409 CASH_OVERDRAFT_CONFIRM_REQUIRED, confirmation audited', () => {
  let small: number
  beforeAll(async () => {
    small = await account({ openingBalance: 1_000 })
  })
  const out = (amount: number, extra: Record<string, unknown> = {}) =>
    api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'out', cashAccountId: small, amount, description: 'uji saldo', categoryId: w.cat.ksm, ...extra }, key())

  it('without confirmation: 409 with balance / after; nothing posted', async () => {
    const r = await out(5_000)
    expect(r.status, JSON.stringify(r.body)).toBe(409)
    expect(r.body).toMatchObject({ code: 'CASH_OVERDRAFT_CONFIRM_REQUIRED', balance: 1_000, after: -4_000, cashAccountId: small })
    expect(r.body.title).toContain('minus')
    expect(await entries(small)).toBe(0)
  })

  it('confirmed: 201 + audit overdraft_confirmed (old/new balance); a negative balance keeps asking', async () => {
    const r = await out(5_000, { confirmOverdraft: true })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const a = await auditRows('cash_entry', r.body.id)
    const row = a.find((x) => x.action === 'overdraft_confirmed')!
    expect(row).toMatchObject({ field: 'balance', old_value: { v: { cashAccountId: small, balance: 1_000 } }, user_id: String(w.users.finance.id) })
    expect(row.new_value).toMatchObject({ v: { cashAccountId: small, balance: -4_000, amount: 5_000, sourceType: 'manual' } })
    expect((await out(100)).body).toMatchObject({ code: 'CASH_OVERDRAFT_CONFIRM_REQUIRED', balance: -4_000, after: -4_100 })
    expect((await api('GET', '/api/v1/cash-accounts/balances', w.users.finance)).body.items.find((x: { cashAccountId: number }) => x.cashAccountId === small).balance).toBe(-4_000)
  })

  it('cash-in never asks; cash-out within the balance posts without an audit row', async () => {
    const i = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', cashAccountId: small, amount: 10_000, description: 'setoran', cashInSourceId: w.cashInSource }, key())
    expect(i.status, JSON.stringify(i.body)).toBe(201)
    const o = await out(6_000)
    expect(o.status, JSON.stringify(o.body)).toBe(201)
    expect((await auditRows('cash_entry', o.body.id)).some((x) => x.action === 'overdraft_confirmed')).toBe(false)
  })

  it('transfer from an account without enough balance: 409, then confirmed transfer + audit row with the transfer', async () => {
    const id = await approvedAdvance()
    // ADR 0031: `small` is not the project's Pusat Biaya → automatic loan; the overdraft is asked on its KK (paying account)
    const body = { cashAccountId: small, bankRef: `QF4-${id}`, proofMediaId: await proof(), loanReason: 'uji saldo minus' }
    const r = await api('POST', `${E}/${id}/transfer`, w.users.finance, body)
    expect(r.status, JSON.stringify(r.body)).toBe(409)
    expect(r.body).toMatchObject({ code: 'CASH_OVERDRAFT_CONFIRM_REQUIRED', balance: 0, after: -750_000 })
    expect(Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM transfers WHERE request_id = $1', [id])).rows[0].n)).toBe(0)
    const ok = await api('POST', `${E}/${id}/transfer`, w.users.finance, { ...body, confirmOverdraft: true })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    expect(ok.body.projectLoan).toMatchObject({ kk: expect.any(String) })
    const kk = (await sqlAs('app', "SELECT id FROM cash_entries WHERE project_loan_id = $1 AND direction = 'out'", [ok.body.projectLoan.id])).rows[0].id as number
    const row = (await auditRows('cash_entry', kk)).find((x) => x.action === 'overdraft_confirmed')!
    expect(row.new_value).toMatchObject({ v: { balance: -750_000, sourceType: 'project_loan' } })
  })

  it('a void (reversal) is a correction and never asks', async () => {
    const acc = await account({ openingBalance: 0 })
    const i = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', cashAccountId: acc, amount: 2_000, description: 'masuk', cashInSourceId: w.cashInSource }, key())
    await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'out', cashAccountId: acc, amount: 2_000, description: 'keluar', categoryId: w.cat.ksm }, key())
    const v = await api('POST', `/api/v1/cash-entries/${i.body.id}/void`, w.users.finance, { reason: 'salah catat' }, key())
    expect(v.status, JSON.stringify(v.body)).toBe(200)
  })
})

// ------------------------------------------------------------------------------------------------ QA-17

describe('QA-17 — transfer to an unverified employee bank account', () => {
  let id: number
  beforeAll(async () => {
    const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id
    const accU = await sysCreate('employee-bank-accounts', { employee: w.emp.a, bank, accountNo: `8${Date.now() % 1e9}7`, accountHolder: 'QF Staff A (baru)', isDefault: false })
    id = await approvedAdvance({ bankAccountId: accU })
  })

  it('the transfer queue (Antrian Transfer) shows the verification state of the destination account', async () => {
    const other = await approvedAdvance()
    const items = await asUser(w.users.finance, (req) => transferQueue(req))
    expect(items.find((x) => x.id === id)?.bankVerification).toBe('unverified')
    expect(items.find((x) => x.id === other)?.bankVerification).toBe('verified')
  })

  it('POST …/transfer: 409 BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED with the destination; confirmed → 201 + audit', async () => {
    const body = { cashAccountId: w.cashAccount, bankRef: `QF17-${id}`, proofMediaId: await proof() }
    const r = await api('POST', `${E}/${id}/transfer`, w.users.finance, body)
    expect(r.status, JSON.stringify(r.body)).toBe(409)
    expect(r.body).toMatchObject({ code: 'BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED', verificationStatus: 'unverified', accountHolder: 'QF Staff A (baru)' })
    expect(r.body.accountNo).toMatch(/^8\d+7$/)
    const ok = await api('POST', `${E}/${id}/transfer`, w.users.finance, { ...body, confirmUnverifiedAccount: true })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    const a = (await auditRows('transfer', ok.body.transferId)).find((x) => x.action === 'bank_unverified_confirmed')!
    expect(a).toMatchObject({ field: 'destination', user_id: String(w.users.finance.id) })
    expect(a.new_value).toMatchObject({ v: { verificationStatus: 'unverified', requestId: id, amount: 750_000, kind: 'advance' } })
  })
})

// ------------------------------------------------------------------------------------------------ QA-14

describe('QA-14 — the opening balance counts only from its date on', () => {
  const t = today()
  const P1 = prevMonth(t) // go-live month
  const P0 = prevMonth(`${P1}-01`)
  let acc: number
  beforeAll(async () => {
    acc = await account({ company: Q, openingBalance: 5_000_000, openingBalanceDate: `${P1}-01` })
    await asUser(null, async (req) => {
      const { postEntry } = await import('@/domain/cash/ledger')
      await postEntry(req, { direction: 'out', entryDate: `${P1}-10`, cashAccountId: acc, amount: 300_000, description: 'keluar go-live', sourceType: 'manual' })
    })
  })

  it('K-02 (Rekap Kas): months before go-live 0; go-live month adds it as saldoAwalAkun; reconciles', async () => {
    const rows = await asUser(finQ, async (req) => cashFlowMonthly(req, await officeScope(req), { from: P0, to: month(t), accountId: acc }, 'book'))
    expect(rows.map((r) => r.period)).toEqual([P0, P1, month(t)])
    expect(rows[0]).toMatchObject({ openingBalance: 0, saldoAwalAkun: 0, closingBalance: 0 })
    expect(rows[1]).toMatchObject({ openingBalance: 0, saldoAwalAkun: 5_000_000, keluar: 300_000, closingBalance: 4_700_000 })
    expect(rows[2]).toMatchObject({ openingBalance: 4_700_000, saldoAwalAkun: 0 })
    for (const r of rows) expect(r.closingBalance! - r.openingBalance!).toBe(r.saldoAwalAkun + r.net)
    // a range starting after go-live carries it in the start balance
    const later = await asUser(finQ, async (req) => cashFlowMonthly(req, await officeScope(req), { from: month(t), to: month(t), accountId: acc }, 'book'))
    expect(later[0]).toMatchObject({ openingBalance: 4_700_000, saldoAwalAkun: 0 })
  })

  it('K-01 and GET /cash-accounts/balances: 0 before the opening date, opening + flows from it', async () => {
    const before = `${P0}-15`
    const k01 = await asUser(finQ, async (req) => ({ b: await cashBalances(req, await officeScope(req), before, acc), a: await cashBalances(req, await officeScope(req), t, acc) }))
    expect(k01.b.accounts[0]).toMatchObject({ opening: 0, balance: 0 })
    expect(k01.a.accounts[0]).toMatchObject({ opening: 5_000_000, balance: 4_700_000 })
    const api0 = await api('GET', `/api/v1/cash-accounts/balances?asOf=${before}`, finQ)
    expect(api0.body.items.find((x: { cashAccountId: number }) => x.cashAccountId === acc)).toMatchObject({ openingBalance: 0, balance: 0 })
    const svc = await asUser(finQ, (req) => balances(req, `${P1}-01`, { companyIds: [Q] }))
    expect(svc.find((x) => x.cashAccountId === acc)).toMatchObject({ openingBalance: 5_000_000, balance: 5_000_000 })
  })
})

// ------------------------------------------------------------------------------------------------ QA-30

describe('QA-30 — Tutup buku never before the PT books start', () => {
  it('books start = earliest opening date of the PT accounts; earlier months → 400; DRMS has none', async () => {
    const start = await asUser(finQ, (req) => booksStartDate(req, Q))
    expect(start).not.toBeNull()
    expect(start! <= `${prevMonth(today())}-01`).toBe(true)
    const before = prevMonth(start!)
    const r = await api('POST', '/api/v1/period-closings', finQ, { period: before, company: Q }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(400)
    expect(r.body.title).toContain(`sebelum buku kas PT dimulai (saldo awal akun kas pertama per ${dmy(start!)})`)
    await expect(asUser(null, (req) => closePeriod(req, before, 'uji', Q))).rejects.toMatchObject({ status: 400 })
    // the go-live month itself can be closed
    const ok = await api('POST', '/api/v1/period-closings', finQ, { period: month(start!), company: Q }, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
  })
})

// ------------------------------------------------------------------------------------------------ QA-06

async function receipt(id: number, lineId: string, amount: number) {
  const img = await upload('/api/v1/media/receipts', w.users.staffA, await png())
  expect(img.status).toBe(201)
  const r = await api('POST', `${E}/${id}/receipts`, w.users.staffA, {
    lineId,
    receiptNo: `QF6-${id}-${amount}-${randomUUID().slice(0, 5)}`,
    vendorName: 'Toko Bangunan Maju',
    receiptDate: addDays(today(), -1),
    amount,
    imageId: img.body.id,
  })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
}

/** Pengajuan Baru 750.000 transferred; receipts 600.000 + 250.000 = 850.000 valid; LPJ verified (shortfall 100.000 = +13,3 %). */
async function verifiedShortfall(): Promise<number> {
  const id = await approvedAdvance()
  const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `QF6-${id}`, proofMediaId: await proof() })
  expect(t.status, JSON.stringify(t.body)).toBe(201)
  const lines = t.body.request.lines.map((l: { id: string }) => l.id) as string[]
  await receipt(id, lines[0]!, 600_000)
  await receipt(id, lines[1]!, 250_000)
  expect((await api('POST', `${E}/${id}/receipts-complete`, w.users.staffA, {})).status).toBe(200)
  expect((await api('POST', `${E}/${id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material naik harga.' })).status).toBe(200)
  const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
  for (const r of d.receipts.filter((x: { status: string }) => x.status === 'pending')) expect((await api('POST', `${E}/${id}/receipts/${r.id}/verify`, w.users.finance, {})).status).toBe(200)
  const v = await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})
  expect(v.status, JSON.stringify(v.body)).toBe(200)
  expect(v.body.settlement).toMatchObject({ settlementType: 'shortfall', difference: -100_000 })
  return id
}

const settleBody = async (id: number) => ({ cashAccountId: w.cashAccount, bankRef: `QF6S-${id}`, proofMediaId: await proof() })
const sa = async (id: number, user: FlowUser = w.users.finance) => (await api('GET', `${E}/${id}`, user)).body.settlement.shortfallApproval

describe('QA-06 / ADR 0019 — shortfall above approved + tolerance needs re-approval (Direktur → Finance)', () => {
  let id: number
  beforeAll(async () => {
    id = await verifiedShortfall()
  })

  it('settle → 409 SHORTFALL_REAPPROVAL_REQUIRED with the figures; detail explains it; nothing transferred', async () => {
    const r = await api('POST', `${E}/${id}/settle`, w.users.finance, await settleBody(id))
    expect(r.status, JSON.stringify(r.body)).toBe(409)
    expect(r.body).toMatchObject({ code: 'SHORTFALL_REAPPROVAL_REQUIRED', approvedAmount: 750_000, transferredTotal: 850_000, tolerancePct: 10, limit: 825_000, shortfallApprovalStatus: null })
    expect(await sa(id)).toMatchObject({ aboveTolerance: true, settleAllowed: false, status: null, totalAfter: 850_000, limit: 825_000, allowedActions: [] })
    expect((await api('GET', `${E}/${id}`, w.users.staffA)).body.settlement.shortfallApproval ?? null).toBeNull() // office roles only
    expect(Number((await sqlAs('app', "SELECT count(*)::int AS n FROM transfers WHERE request_id = $1 AND kind = 'lpj_shortfall'", [id])).rows[0].n)).toBe(0)
  })

  it('request: Finance only (Staff 403, reason required); pending_ack for the new total; Direktur notified; again → 409', async () => {
    const path = `${E}/${id}/lpj/shortfall-approval`
    expect((await api('POST', path, w.users.staffA, { note: 'harga naik' }, key())).status).toBe(403)
    expect((await api('POST', path, w.users.finance, {}, key())).status).toBe(400)
    const r = await api('POST', path, w.users.finance, { note: 'Harga material naik' }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.settlement.shortfallApproval).toMatchObject({ status: 'pending_ack', amount: 850_000, cycle: 1, note: 'Harga material naik' })
    const n = await api('GET', '/api/v1/notifications?unread=true', w.users.owner)
    expect(n.body.items.map((x: { event: string; docId: string }) => [x.event, x.docId])).toContainEqual(['expense.shortfall_pending_ack', String(id)])
    expect((await api('GET', '/api/v1/notifications?unread=true', w.users.staffA)).body.items.some((x: { event: string }) => x.event.startsWith('expense.shortfall'))).toBe(false)
    expect((await api('POST', path, w.users.finance, { note: 'lagi' }, key())).status).toBe(409)
    const s = await api('POST', `${E}/${id}/settle`, w.users.finance, await settleBody(id))
    expect(s.body).toMatchObject({ code: 'SHORTFALL_REAPPROVAL_REQUIRED', shortfallApprovalStatus: 'pending_ack' })
  })

  it('inbox + guards: Direktur sees step acknowledge; Finance cannot acknowledge; PM/Staff 403', async () => {
    const inbox = await api('GET', '/api/v1/lpj-shortfall-approvals/inbox', w.users.owner)
    expect(inbox.status).toBe(200)
    expect(inbox.body.items.find((x: { requestId: number }) => x.requestId === id)).toMatchObject({ step: 'acknowledge', totalAfter: 850_000, approvedAmount: 750_000, limit: 825_000 })
    expect((await api('GET', '/api/v1/lpj-shortfall-approvals/inbox', w.users.finance)).body.items.some((x: { requestId: number }) => x.requestId === id)).toBe(false)
    // ADR 0021: the inbox is open to every role (the PM project decides "Persetujuan PM"); this one is not the PM's step
    const pmInbox = await api('GET', '/api/v1/lpj-shortfall-approvals/inbox', w.users.pm)
    expect(pmInbox.status).toBe(200)
    expect(pmInbox.body.items.some((x: { requestId: number }) => x.requestId === id)).toBe(false)
    expect((await api('POST', `${E}/${id}/lpj/shortfall-approval/acknowledge`, w.users.finance, {}, key())).status).toBe(403)
    expect((await api('POST', `${E}/${id}/lpj/shortfall-approval/approve`, w.users.finance, {}, key())).status).toBe(409)
    expect((await api('POST', `${E}/${id}/lpj/shortfall-approval/acknowledge`, w.users.pm, {}, key())).status).toBe(403)
    expect((await api('POST', `${E}/${id}/lpj/shortfall-approval/acknowledge`, w.users.staffA, {}, key())).status).toBe(403)
  })

  it('Direktur acknowledges → Finance approves → settle pays the shortfall; decision rows + audit', async () => {
    const a = await api('POST', `${E}/${id}/lpj/shortfall-approval/acknowledge`, w.users.owner, {}, key())
    expect(a.status, JSON.stringify(a.body)).toBe(200)
    expect(a.body.settlement.shortfallApproval).toMatchObject({ status: 'pending_approval', level: 1 })
    expect((await api('POST', `${E}/${id}/lpj/shortfall-approval/acknowledge`, w.users.owner, {}, key())).status).toBe(409)
    const b = await api('POST', `${E}/${id}/lpj/shortfall-approval/approve`, w.users.finance, {}, key())
    expect(b.status, JSON.stringify(b.body)).toBe(200)
    expect(b.body.settlement.shortfallApproval).toMatchObject({ status: 'approved', settleAllowed: true })
    expect(b.body.settlement.shortfallApproval.decisions.map((d: { position: string; decision: string }) => `${d.position}:${d.decision}`)).toEqual(['diketahui:acknowledged', 'approval:approved'])
    const sid = b.body.settlement.id as number
    const rows = await sqlAs('app', "SELECT doc_type::text AS t, request_id, cycle::int AS c, position::text AS p, actor_id FROM approvals WHERE settlement_id = $1 ORDER BY id", [sid])
    expect(rows.rows).toEqual([
      { t: 'expense_shortfall', request_id: null, c: 1, p: 'diketahui', actor_id: w.users.owner.id },
      { t: 'expense_shortfall', request_id: null, c: 1, p: 'approval', actor_id: w.users.finance.id },
    ])
    const audit = await auditRows('settlement', sid)
    expect(audit.filter((x) => ['acknowledge', 'approve'].includes(x.action)).map((x) => x.field)).toEqual(['shortfall_diketahui', 'shortfall_approval'])
    expect((await api('GET', '/api/v1/notifications?unread=true', w.users.finance2)).body.items.map((x: { event: string }) => x.event)).toContain('expense.shortfall_approved')
    const s = await api('POST', `${E}/${id}/settle`, w.users.finance, await settleBody(id))
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body).toMatchObject({ settlementType: 'shortfall', amount: 100_000, request: { status: 'completed', transferredTotal: 850_000 } })
    // after settling, the figures stay those of the decision (the shortfall is not counted twice)
    expect(s.body.request.settlement.shortfallApproval).toMatchObject({ totalAfter: 850_000, status: 'approved', settleAllowed: null })
    // the request's own approval history is untouched (one cycle, Direktur + Finance of the original amount)
    expect(Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM approvals WHERE request_id = $1 AND position IN ($2, $3)', [id, 'diketahui', 'approval'])).rows[0].n)).toBe(2)
  })

  it('reject (reason) keeps settle refused; Finance may ask again (cycle 2); DB guards on the graph and G1', async () => {
    const id2 = await verifiedShortfall()
    const path = `${E}/${id2}/lpj/shortfall-approval`
    await api('POST', path, w.users.finance, { note: 'Perlu tambahan semen' }, key())
    expect((await api('POST', `${path}/reject`, w.users.owner, {}, key())).status).toBe(400)
    const r = await api('POST', `${path}/reject`, w.users.owner, { reason: 'Tidak sesuai RAB' }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.settlement.shortfallApproval).toMatchObject({ status: 'rejected', rejectReason: 'Tidak sesuai RAB', settleAllowed: false })
    expect((await api('POST', `${E}/${id2}/settle`, w.users.finance, await settleBody(id2))).body).toMatchObject({ code: 'SHORTFALL_REAPPROVAL_REQUIRED', shortfallApprovalStatus: 'rejected' })
    const sid = r.body.settlement.id as number
    // DB: rejected → approved is not a transition; amount fixed within a cycle
    expect((await sqlError('app', "UPDATE settlements SET shortfall_approval_status = 'approved' WHERE id = $1", [sid]))?.code).toBe('42501')
    // DB G1: the requester can never hold a decision row of the shortfall
    const g1 = await sqlError('app', "INSERT INTO approvals (doc_type, settlement_id, company_id, cycle, position, level, actor_id, decision) VALUES ('expense_shortfall', $1, $2, 1, 'approval', 1, $3, 'approved')", [sid, await companyId(), w.users.staffA.id])
    expect(g1?.code).toBe('42501')
    // owner check: a shortfall row needs its settlement, not a request
    expect((await sqlError('app', "INSERT INTO approvals (doc_type, request_id, company_id, cycle, position, level, actor_id, decision) VALUES ('expense_shortfall', $1, $2, 1, 'dibuat', 0, $3, 'signed')", [id2, await companyId(), w.users.finance2.id]))?.code).toBe('23514')
    // a second cycle: the same Direktur decides again
    const again = await api('POST', path, w.users.finance, { note: 'RAB direvisi, mohon ditinjau ulang' }, key())
    expect(again.body.settlement.shortfallApproval).toMatchObject({ status: 'pending_ack', cycle: 2 })
    expect((await api('POST', `${path}/acknowledge`, w.users.owner, {}, key())).status).toBe(200)
    expect((await api('POST', `${path}/approve`, w.users.finance2, {}, key())).status).toBe(200)
    expect((await api('POST', `${E}/${id2}/settle`, w.users.finance, await settleBody(id2))).status).toBe(200)
  })

  it('DB: a shortfall transfer above the tolerance without approval is refused by the trigger (ADR 0019)', async () => {
    const id3 = await verifiedShortfall()
    const proofId = await proof()
    const err = await sqlError(
      'app',
      `INSERT INTO transfers (doc_no, request_id, company_id, kind, cash_account_id, amount, bank_ref, proof_id, transfer_date, status, uuid)
       VALUES ('TRF/QF/0001', $1, $2, 'lpj_shortfall', $3, 100000, 'x', $4, $5, 'posted', gen_random_uuid()::text)`,
      [id3, await companyId(), w.cashAccount, proofId, today()],
    )
    expect(err?.code).toBe('42501')
    expect(err?.message).toMatch(/ADR 0019/)
  })
})

// ------------------------------------------------------------------------------------------------ migration

/** Runs migration functions like `payload migrate` does (one OWNER connection) inside a transaction that is ROLLED BACK. */
async function inRolledBackTx(fn: (db: { execute: (q: unknown) => Promise<unknown> }) => Promise<void>): Promise<void> {
  const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
  await c.connect()
  const dialect = new PgDialect()
  const db = {
    execute: async (q: unknown) => {
      const x = dialect.sqlToQuery(q as never)
      return c.query(x.sql, x.params)
    },
  }
  try {
    await c.query('BEGIN')
    await fn(db)
  } finally {
    await c.query('ROLLBACK').catch(() => undefined)
    await c.end()
  }
}

describe('migration 20261008_090000_qa_finance_integrity', () => {
  it('up is re-runnable (idempotent)', async () => {
    await inRolledBackTx(async (db) => {
      await migrationUp({ db } as never)
      await migrationUp({ db } as never)
    })
  })

  it('down is refused while shortfall re-approvals / confirmation audit rows exist (append-only history)', async () => {
    await expect(inRolledBackTx(async (db) => migrationDown({ db } as never))).rejects.toThrow(/qa_finance_integrity down: .* not rolling back/)
  })

  it('down → up round trip restores the schema (blocking rows removed inside the rolled-back transaction)', async () => {
    await inRolledBackTx(async (db) => {
      const run = (q: string) => db.execute(sql.raw(q))
      await run('ALTER TABLE approvals DISABLE TRIGGER USER')
      await run("DELETE FROM approvals WHERE doc_type::text = 'expense_shortfall'")
      await run('ALTER TABLE approvals ENABLE TRIGGER USER')
      await run('ALTER TABLE settlements DISABLE TRIGGER USER')
      await run('UPDATE settlements SET shortfall_approval_status = NULL, shortfall_approval_cycle = 0, shortfall_approval_snapshot = NULL, shortfall_approval_amount = NULL')
      await run('ALTER TABLE settlements ENABLE TRIGGER USER')
      await run('ALTER TABLE audit_logs DISABLE TRIGGER USER')
      // + the values of LATER migrations (approval_pm_direktur ADR 0021, d1310_renumber, d1310_fundcheck ADR 0029): their
      // rows (written by whichever files ran earlier in the same CI part) would block the enum rebuild; ADR 0031: disburse / auto_create
      await run("DELETE FROM audit_logs WHERE action::text IN ('overdraft_confirmed', 'bank_unverified_confirmed', 'approval_policy_exception', 'renumbered', 'fund_insufficient', 'disburse', 'auto_create')")
      await run('ALTER TABLE audit_logs ENABLE TRIGGER USER')
      await migrationDown({ db } as never)
      const cols = (await db.execute(sql.raw("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'settlements' AND column_name LIKE 'shortfall_approval%'"))) as { rows: Array<{ n: number }> }
      expect(cols.rows[0]!.n).toBe(0)
      const trig = (await db.execute(sql.raw("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'transfers_shortfall_tolerance'"))) as { rows: Array<{ n: number }> }
      expect(trig.rows[0]!.n).toBe(0)
      await migrationUp({ db } as never)
      const back = (await db.execute(sql.raw("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'settlements' AND column_name LIKE 'shortfall_approval%'"))) as { rows: Array<{ n: number }> }
      expect(back.rows[0]!.n).toBe(6)
    })
  })

  it('schema: tolerance default 10 and CHECK 0–100; new audit actions', async () => {
    expect(Number((await sqlAs('app', 'SELECT shortfall_tolerance_pct::int AS t FROM companies WHERE id = $1', [Q])).rows[0].t)).toBe(10)
    expect((await sqlError('owner', 'UPDATE companies SET shortfall_tolerance_pct = 101 WHERE id = $1', [Q]))?.code).toBe('23514')
    const v = await sqlAs('app', "SELECT unnest(enum_range(NULL::enum_audit_logs_action))::text AS v")
    expect(v.rows.map((r) => r.v)).toEqual(expect.arrayContaining(['overdraft_confirmed', 'bank_unverified_confirmed']))
  })
})
