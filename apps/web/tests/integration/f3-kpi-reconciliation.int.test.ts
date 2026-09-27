import { strFromU8, unzipSync } from 'fflate'
import { handleEndpoints, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { addDays, BUDGET_COMMITTED } from '@/domain/expense/types'
import { AUDIT_REPORT, reportByCode, type ReportDef } from '@/domain/reports/registry'
import {
  cashBalances,
  cashFlowMonthly,
  costCenterMonth,
  lpjSummary,
  pendingApprovals,
  projectBudgets,
  requestMoney,
  requestSummary,
  spending,
  transferQueueSummary,
  vehicleCosts,
} from '@/domain/reports/kpi'
import { ExportRefused, prepareExport } from '@/domain/reports/export'
import { addMonths, lastDay, periodRange } from '@/domain/reports/rules'
import { resetRateLimits } from '@/lib/rate-limit'
import config from '@/payload.config'

import { getTestPayload, sqlAs } from './helpers'
import { api, asUser, makeWorld, ORIGIN, png, sysCreate, upload, type FlowUser, type Res, type World } from './flow-world'

/**
 * F3 gate (kpi-definitions.md §3): every KPI of the dashboards/reports is compared with the
 * reconciliation SQL of the doc, on seeded masters + GENERATED data (≥ 500 requests over all
 * statuses, void + re-transfer, LPJ refunds/shortfalls, manual cash in/out with voids, a CLOSED
 * period voided later) plus data of the other test files in the shared DB. Scope negatives (PM of
 * another project, Staff, Admin) and the export surface (CSV/XLSX/PDF, caps, audit, rate limit).
 * Fictional data only.
 */
let w: World
const E = '/api/v1/expense-requests'
const N = Number(process.env.F3_GEN_REQUESTS ?? 520)
let today: string
let month: string
let closedMonth: string
const stats: Record<string, number> = {}
const bump = (k: string) => void (stats[k] = (stats[k] ?? 0) + 1)
let cc2: number // second cost center (other PM) for scope tests
let form228Id: number

// deterministic PRNG (mulberry32) → reproducible data set
let seed = 0x5eed_f3
function rnd(): number {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
const amount = () => (5 + Math.floor(rnd() * 400)) * 5_000 // 25.000 … 2.020.000

async function call(method: string, path: string, user: FlowUser | null, body?: unknown): Promise<Res> {
  resetRateLimits() // the generator runs thousands of actions per user
  return api(method, path, user, body)
}
async function must(r: Promise<Res>, status = 200): Promise<Res['body']> {
  const res = await r
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`)
  return res.body
}
async function proof(): Promise<number> {
  resetRateLimits()
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png(undefined, 120, 90))
  if (r.status !== 201) throw new Error(`proof upload ${r.status}`)
  return r.body.id
}
async function receipt(user: FlowUser, id: number, lineId: string, amt: number, date: string) {
  resetRateLimits()
  const img = await upload('/api/v1/media/receipts', user, await png(undefined, 120, 90))
  if (img.status !== 201) throw new Error(`receipt upload ${img.status}`)
  return must(call('POST', `${E}/${id}/receipts`, user, { lineId, receiptNo: `F3-${id}-${Math.floor(rnd() * 1e9)}`, vendorName: 'Toko Uji F3', receiptDate: date, amount: amt, imageId: img.body.id }), 201)
}

type Scope = { projectId?: number; costCenterId?: number; ack: FlowUser }

async function draft(type: 'advance' | 'reimburse', s: Scope, lines: Array<Record<string, unknown>>, title = `F3 ${type}`) {
  return must(
    call('POST', E, w.users.staffA, {
      type,
      title,
      ...(s.projectId ? { projectId: s.projectId } : { costCenterId: s.costCenterId }),
      requesterIds: [w.emp.a],
      bankAccountId: w.accA,
      neededDate: addDays(today, Math.floor(rnd() * 20) - 10),
      lines,
    }),
    201,
  )
}

function randomLines(n: number) {
  const out: Array<Record<string, unknown>> = []
  for (let i = 0; i < n; i++) {
    const kind = pick(['mat', 'ksm', 'inap', 'bbm'] as const)
    const total = amount()
    if (kind === 'bbm') out.push({ description: 'BBM Hilux', qty: 10, uomId: w.uom.l, unitPrice: total / 10, total, categoryId: w.cat.bbm, vehicleId: w.vehicle })
    else out.push({ description: `Item ${kind}`, total, categoryId: w.cat[kind] })
  }
  return out
}

/** Drives one request to `target` through /api/v1 (the real services, triggers and guards). */
async function drive(target: string, type: 'advance' | 'reimburse', s: Scope, opts: { transferDate?: string } = {}) {
  const lines = randomLines(type === 'reimburse' ? 1 : 1 + Math.floor(rnd() * 2))
  const d = await draft(type, s, lines)
  const id = d.id as number
  const lineIds = (d.lines as Array<{ id: string; total: number }>).map((l) => l.id)
  const totals = (d.lines as Array<{ total: number }>).map((l) => l.total)
  if (target === 'draft') return bump('draft')
  if (type === 'reimburse') for (const [i, l] of lineIds.entries()) await receipt(w.users.staffA, id, l, totals[i]!, addDays(today, -1))
  await must(call('POST', `${E}/${id}/submit`, w.users.staffA, {}))
  if (target === 'cancelled_early') {
    await must(call('POST', `${E}/${id}/cancel`, w.users.staffA, { reason: 'tidak jadi' }))
    return bump('cancelled')
  }
  if (target === 'pending_ack') return bump('pending_ack')
  if (target === 'rejected') {
    await must(call('POST', `${E}/${id}/reject`, s.ack, { reason: 'anggaran tidak sesuai' }))
    return bump('rejected')
  }
  await must(call('POST', `${E}/${id}/acknowledge`, s.ack, {}))
  if (target === 'pending_approval') return bump('pending_approval')
  await must(call('POST', `${E}/${id}/approve`, w.users.finance, {}))
  if (target === 'approved') return bump('approved')
  if (type === 'reimburse') {
    const det = await must(call('GET', `${E}/${id}`, w.users.finance))
    for (const r of det.receipts as Array<{ id: number; status: string }>) if (r.status === 'pending') await must(call('POST', `${E}/${id}/receipts/${r.id}/verify`, w.users.finance, {}))
    const again = await must(call('GET', `${E}/${id}`, w.users.finance))
    for (const f of (again.flags ?? []) as Array<{ id: number; status: string; level: string }>)
      if (f.status === 'open' && f.level === 'warning') await must(call('POST', `${E}/${id}/flags/${f.id}/review`, w.users.finance, { note: 'wajar' }))
    await must(call('POST', `${E}/${id}/verify-receipts`, w.users.finance, {}))
    if (target === 'receipts_verified') return bump('receipts_verified')
  }
  const transfer = async () => must(call('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: pick([w.cashAccount, cash2]), bankRef: `F3-${id}-${Math.floor(rnd() * 1e6)}`, proofMediaId: await proof(), transferDate: opts.transferDate }), 201)
  const t = await transfer()
  if (target === 'void_retransfer') {
    void t
    await must(call('POST', `${E}/${id}/transfers/${await lastTransferId(id)}/void`, w.users.finance, { reason: 'salah rekening' }))
    await transfer()
    bump('void_retransfer')
  }
  if (target === 'void_only') {
    await must(call('POST', `${E}/${id}/transfers/${await lastTransferId(id)}/void`, w.users.finance, { reason: 'batal transfer' }))
    return bump('void_only')
  }
  if (target === 'transferred' || target === 'void_retransfer') return bump('transferred')
  if (type === 'reimburse') {
    await must(call('POST', `${E}/${id}/complete`, w.users.staffA, {}))
    return bump('completed_reimburse')
  }
  // Uang Muka LPJ: receipts per line; variant exact / refund / shortfall
  const variant = target === 'lpj_refund' || target === 'lpj_verified_pending' ? -1 : target === 'lpj_shortfall' ? 1 : 0
  for (const [i, l] of lineIds.entries()) await receipt(w.users.staffA, id, l, totals[i]! + (i === 0 ? variant * 5_000 : 0), addDays(today, -1))
  await must(call('POST', `${E}/${id}/receipts-complete`, w.users.staffA, {}))
  if (target === 'receipts_complete') return bump('receipts_complete')
  await must(call('POST', `${E}/${id}/lpj/submit`, w.users.staffA, { usageNotes: 'Dana dipakai sesuai pengajuan.' }))
  if (target === 'lpj_submitted') return bump('lpj_submitted')
  const det = await must(call('GET', `${E}/${id}`, w.users.finance))
  for (const r of det.receipts as Array<{ id: number; status: string }>) if (r.status === 'pending') await must(call('POST', `${E}/${id}/receipts/${r.id}/verify`, w.users.finance, {}))
  const v = await must(call('POST', `${E}/${id}/lpj/verify`, w.users.finance, {}))
  if (v.status === 'completed') return bump('lpj_exact')
  if (target === 'lpj_verified_pending') return bump('lpj_verified')
  if (variant < 0) await must(call('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount }))
  else await must(call('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `SF-${id}`, proofMediaId: await proof() }))
  bump(variant < 0 ? 'lpj_refund' : 'lpj_shortfall')
}

async function lastTransferId(requestId: number): Promise<number> {
  const r = await sqlAs('app', "SELECT id FROM transfers WHERE request_id = $1 AND status = 'posted' ORDER BY id DESC LIMIT 1", [requestId])
  return r.rows[0]!.id
}

let cash2: number

async function manual(direction: 'in' | 'out', entryDate: string, amt: number, extra: Record<string, unknown> = {}) {
  return must(
    call('POST', '/api/v1/cash-entries', w.users.finance, {
      direction,
      entryDate,
      cashAccountId: pick([w.cashAccount, cash2]),
      amount: amt,
      description: `F3 manual ${direction}`,
      ...(direction === 'out' ? { categoryId: pick([w.cat.mat, w.cat.ksm, w.cat.bbm]) } : { cashInSourceId: w.cashInSource }),
      ...extra,
    }),
    201,
  )
}

const TARGETS_ADV = ['draft', 'pending_ack', 'pending_approval', 'rejected', 'cancelled_early', 'approved', 'transferred', 'void_retransfer', 'void_only', 'receipts_complete', 'lpj_submitted', 'lpj_verified_pending', 'lpj_refund', 'lpj_shortfall', 'lpj_exact'] as const
const WEIGHTS_ADV = [4, 6, 5, 4, 3, 8, 10, 3, 2, 3, 3, 3, 6, 4, 6]
const TARGETS_RMB = ['draft', 'pending_ack', 'pending_approval', 'rejected', 'cancelled_early', 'approved', 'receipts_verified', 'transferred', 'void_retransfer', 'completed'] as const
const WEIGHTS_RMB = [3, 5, 4, 3, 2, 6, 6, 5, 3, 8]
function weighted<T>(xs: readonly T[], ws: number[]): T {
  const total = ws.reduce((a, b) => a + b, 0)
  let r = rnd() * total
  for (let i = 0; i < xs.length; i++) if ((r -= ws[i]!) < 0) return xs[i]!
  return xs[xs.length - 1]!
}

const t0 = Date.now()
beforeAll(async () => {
  w = await makeWorld('FK') // tag letters only: it becomes part of a vehicle plate
  const p = await getTestPayload()
  today = (await asUser(w.users.finance, async (req) => (await import('@/domain/expense/common')).today(req)))
  month = today.slice(0, 7)
  closedMonth = addMonths(month, -3)
  cash2 = await sysCreate('cash-accounts', { name: 'F3 Kas Kecil', kind: 'cash', openingBalance: 5_000_000 })
  await sysCreate('cash-accounts', { name: 'F3 Nonaktif Nol', kind: 'cash', openingBalance: 0, active: false })
  // other PM's cost center + staff assignment to the other project (scope tests)
  cc2 = await sysCreate('cost-centers', { code: 'F3-CC2', name: 'F3 Ops Lain', manager: w.users.otherPm.id })
  await sysCreate('team-assignments', { employee: w.emp.a, project: w.otherProject, roleInProject: 'staff' })
  await sysCreate('team-assignments', { employee: w.emp.a, costCenter: cc2, roleInProject: 'staff' })
  await sysCreate('budget-lines', { project: w.project, category: w.cat.mat, amount: 20_000_000 })
  await sysCreate('budget-lines', { project: w.project, category: w.cat.ksm, amount: 5_000_000 })
  void p

  // --- closed-period data first (dated M-3), then close M-3 ---------------------------------
  const closedDate = `${closedMonth}-15`
  const closedEntries: number[] = []
  for (let i = 0; i < 6; i++) closedEntries.push((await manual(i % 2 ? 'in' : 'out', closedDate, amount(), i % 3 === 0 ? { costCenterId: w.costCenter } : {})).id)
  for (let i = 0; i < 4; i++) await drive('transferred', 'advance', { projectId: w.project, ack: w.users.owner }, { transferDate: addDays(closedDate, i) })
  for (let i = 0; i < 4; i++) await manual(i % 2 ? 'in' : 'out', `${addMonths(month, -2)}-10`, amount(), { vehicleId: w.vehicle, projectId: w.project })
  closedK02a = await asUser(w.users.finance, (req) => cashFlowMonthly(req, { from: closedMonth, to: closedMonth }, 'book'))
  await must(call('POST', '/api/v1/period-closings', w.users.finance, { period: closedMonth, note: 'F3 tutup buku uji' }), 201)
  // void in the closed month → reversal dated today (ADR 0005 §4)
  voidedClosed = closedEntries[1]!
  await must(call('POST', `/api/v1/cash-entries/${voidedClosed}/void`, w.users.finance, { reason: 'koreksi F3' }))
  // and a transfer dated in the closed month voided later
  const closedTransfer = await sqlAs('app', "SELECT t.id, t.request_id FROM transfers t WHERE t.transfer_date = $1 AND t.status = 'posted' LIMIT 1", [closedDate])
  await must(call('POST', `${E}/${closedTransfer.rows[0]!.request_id}/transfers/${closedTransfer.rows[0]!.id}/void`, w.users.finance, { reason: 'salah akun F3' }))

  // --- the form 228 case (seed case 1): Reimburse 1.447.500 on the world cost center ----------
  const f = await draft(
    'reimburse',
    { costCenterId: w.costCenter, ack: w.users.owner },
    [
      { description: 'BBM Hilux Banjarmasin-Palangka', qty: 60, uomId: w.uom.l, total: 600_000, categoryId: w.cat.bbm, vehicleId: w.vehicle },
      { description: 'Penginapan', qty: 2, uomId: w.uom.kmr, unitPrice: 339_000, total: 677_000, categoryId: w.cat.inap },
      { description: 'Makan siang', total: 170_500, categoryId: w.cat.ksm },
    ],
    '=HYPERLINK("http://x") Pengajuan Reimburse Ops keperluan Service Tronton',
  )
  form228Id = f.id
  for (const [i, l] of (f.lines as Array<{ id: string; total: number }>).entries()) await receipt(w.users.staffA, f.id, l.id, l.total, addDays(today, -1 - i))
  await must(call('POST', `${E}/${f.id}/submit`, w.users.staffA, {}))
  await must(call('POST', `${E}/${f.id}/acknowledge`, w.users.owner, {}))
  await must(call('POST', `${E}/${f.id}/approve`, w.users.finance, {}))
  const det = await must(call('GET', `${E}/${f.id}`, w.users.finance))
  for (const r of det.receipts) await must(call('POST', `${E}/${f.id}/receipts/${r.id}/verify`, w.users.finance, {}))
  const again = await must(call('GET', `${E}/${f.id}`, w.users.finance))
  for (const fl of again.flags ?? []) if (fl.status === 'open' && fl.level === 'warning') await must(call('POST', `${E}/${f.id}/flags/${fl.id}/review`, w.users.finance, { note: 'ok' }))
  await must(call('POST', `${E}/${f.id}/verify-receipts`, w.users.finance, {}))
  await must(call('POST', `${E}/${f.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'F3-228', proofMediaId: await proof() }), 201)

  // --- the generated body: N requests over all statuses and three scopes --------------------
  const scopes: Array<[Scope, number]> = [
    [{ projectId: w.project, ack: w.users.owner }, 40],
    [{ costCenterId: w.costCenter, ack: w.users.owner }, 25],
    [{ projectId: w.otherProject, ack: w.users.owner }, 25],
    [{ costCenterId: cc2, ack: w.users.owner }, 10],
  ]
  for (let i = 0; i < N; i++) {
    const s = weighted(
      scopes.map((x) => x[0]),
      scopes.map((x) => x[1]),
    )
    const type = rnd() < 0.55 ? 'advance' : 'reimburse'
    const target = type === 'advance' ? weighted(TARGETS_ADV, WEIGHTS_ADV) : weighted(TARGETS_RMB, WEIGHTS_RMB)
    await drive(target, type, s)
    if (i % 25 === 0) await manual(rnd() < 0.4 ? 'in' : 'out', addDays(today, -Math.floor(rnd() * 20)), amount(), rnd() < 0.5 ? { costCenterId: pick([w.costCenter, cc2]), vehicleId: rnd() < 0.5 ? w.vehicle : null } : { projectId: w.project })
  }
  // manual voids in the open period
  const open = await sqlAs('app', "SELECT id FROM cash_entries WHERE source_type = 'manual' AND status = 'posted' AND entry_date > $1 ORDER BY id DESC LIMIT 3", [lastDay(closedMonth)])
  for (const r of open.rows) await must(call('POST', `/api/v1/cash-entries/${r.id}/void`, w.users.finance, { reason: 'salah input F3' }))
  console.log(`[f3] generated ${N} requests in ${Math.round((Date.now() - t0) / 1000)} s`, JSON.stringify(stats))
}, 1_800_000)

let closedK02a: Awaited<ReturnType<typeof cashFlowMonthly>>
let voidedClosed: number

afterAll(async () => {
  // re-open the period closed by this file (Owner, latest closed) → no effect on other test files
  const latest = await sqlAs('app', "SELECT period FROM period_closings WHERE status = 'closed' ORDER BY period DESC LIMIT 1")
  if (latest.rows[0]?.period === closedMonth) await call('POST', `/api/v1/period-closings/${closedMonth}/reopen`, w.users.owner, { reason: 'F3 test selesai' })
  await (await getTestPayload()).destroy()
})

const asFinance = <T,>(fn: (req: PayloadRequest) => Promise<T>) => asUser(w.users.finance, fn)
const n = (v: unknown) => Number(v ?? 0)
const COMMITTED = BUDGET_COMMITTED.map((s) => `'${s}'`).join(',') // constant list, not user input

describe('generated data set', () => {
  it('covers ≥ 500 requests, every status, voids, LPJ refund/shortfall and a closed period', async () => {
    const r = await sqlAs('app', 'SELECT status::text AS s, count(*)::int AS n FROM expense_requests GROUP BY 1')
    const by = Object.fromEntries(r.rows.map((x) => [x.s, x.n]))
    expect(Object.values(by).reduce((a: number, b) => a + (b as number), 0)).toBeGreaterThanOrEqual(500)
    for (const s of ['draft', 'pending_ack', 'pending_approval', 'approved', 'receipts_verified', 'transferred', 'receipts_complete', 'lpj_submitted', 'lpj_verified', 'completed', 'rejected', 'cancelled']) {
      expect(by[s] ?? 0, s).toBeGreaterThan(0)
    }
    const v = await sqlAs('app', "SELECT count(*) FILTER (WHERE status = 'void')::int AS voids, count(*) FILTER (WHERE source_type = 'reversal')::int AS rev, count(*) FILTER (WHERE source_type = 'settlement_refund')::int AS refunds FROM cash_entries")
    expect(v.rows[0].voids).toBeGreaterThan(3)
    expect(v.rows[0].rev).toBe(v.rows[0].voids)
    expect(v.rows[0].refunds).toBeGreaterThan(0)
    const sf = await sqlAs('app', "SELECT count(*)::int AS n FROM transfers WHERE kind = 'lpj_shortfall' AND status = 'posted'")
    expect(sf.rows[0].n).toBeGreaterThan(0)
  })
})

describe('K-01 saldo kas per akun', () => {
  it('= doc SQL and = GET /api/v1/cash-accounts/balances, for today and for each month end', async () => {
    for (const asOf of [today, lastDay(closedMonth), lastDay(addMonths(month, -1)), '2000-01-01']) {
      const mine = await asFinance((req) => cashBalances(req, asOf))
      const doc = await sqlAs(
        'app',
        `SELECT a.id, (coalesce(a.opening_balance,0) + coalesce(sum(e.amount) FILTER (WHERE e.direction='in'),0) - coalesce(sum(e.amount) FILTER (WHERE e.direction='out'),0))::text AS balance
         FROM cash_accounts a LEFT JOIN cash_entries e ON e.cash_account_id=a.id AND e.entry_date <= $1 GROUP BY a.id`,
        [asOf],
      )
      const exp = new Map(doc.rows.map((x) => [x.id, n(x.balance)]))
      expect(mine.accounts.length).toBe(exp.size)
      for (const a of mine.accounts) expect(a.balance, `acc ${a.id} ${asOf}`).toBe(exp.get(a.id))
      expect(mine.total).toBe([...exp.values()].reduce((s, v) => s + v, 0))
      const api1 = await must(call('GET', `/api/v1/cash-accounts/balances?asOf=${asOf}`, w.users.finance))
      for (const a of api1.items) expect(a.balance).toBe(exp.get(a.cashAccountId))
    }
  })

  it('invariant: every void pair nets to zero (same amount/account, opposite direction)', async () => {
    const r = await sqlAs('app', 'SELECT count(*)::int AS n FROM cash_entries o JOIN cash_entries r ON r.reversal_of_id=o.id WHERE o.amount<>r.amount OR o.direction=r.direction OR o.cash_account_id<>r.cash_account_id')
    expect(r.rows[0].n).toBe(0)
  })

  it('dashboard hides an inactive account with balance 0', async () => {
    const d = await must(call('GET', '/api/v1/dashboard/owner', w.users.owner))
    expect(d.cash.accounts.map((a: { name: string }) => a.name)).not.toContain('F3 Nonaktif Nol')
    const all = await asFinance((req) => cashBalances(req, today))
    expect(d.cash.total).toBe(all.total)
  })
})

describe('K-02 kas masuk/keluar per bulan', () => {
  const range = () => ({ from: addMonths(month, -35), to: month })

  it('K-02a (book) = doc SQL per month, per account and total; balance roll-forward = K-01 at month ends', async () => {
    const accounts = (await sqlAs('app', 'SELECT id FROM cash_accounts')).rows.map((x) => x.id as number)
    for (const acc of [undefined, ...accounts.slice(-3)]) {
      const mine = await asFinance((req) => cashFlowMonthly(req, { ...range(), accountId: acc }, 'book'))
      const doc = await sqlAs(
        'app',
        `SELECT period, sum(amount) FILTER (WHERE direction='in')::text AS masuk, sum(amount) FILTER (WHERE direction='out')::text AS keluar
         FROM cash_entries WHERE period BETWEEN $1 AND $2 ${acc ? 'AND cash_account_id=$3' : ''} GROUP BY period ORDER BY period`,
        acc ? [range().from, range().to, acc] : [range().from, range().to],
      )
      const exp = new Map(doc.rows.map((x) => [x.period, x]))
      for (const m of mine) {
        expect(m.masuk, `${acc} ${m.period}`).toBe(n(exp.get(m.period)?.masuk))
        expect(m.keluar, `${acc} ${m.period}`).toBe(n(exp.get(m.period)?.keluar))
        expect(m.closingBalance! - m.openingBalance!).toBe(m.masuk - m.keluar)
      }
      // opening of P = K-01 at the end of P-1; closing of P = K-01 at the end of P
      for (const m of mine.filter((x) => x.masuk || x.keluar)) {
        const end = m.period === month ? today : lastDay(m.period)
        const k01 = await asFinance((req) => cashBalances(req, end, acc))
        expect(m.closingBalance, m.period).toBe(k01.total)
        const prev = await asFinance((req) => cashBalances(req, lastDay(addMonths(m.period, -1)), acc))
        expect(m.openingBalance, m.period).toBe(prev.total)
      }
    }
  })

  it('K-02b (operational) = doc SQL; K-02a − K-02b per month = net of void/reversal rows of that month', async () => {
    const a = await asFinance((req) => cashFlowMonthly(req, range(), 'book'))
    const b = await asFinance((req) => cashFlowMonthly(req, range(), 'operational'))
    const doc = await sqlAs(
      'app',
      `SELECT period, sum(amount) FILTER (WHERE direction='in')::text AS masuk, sum(amount) FILTER (WHERE direction='out')::text AS keluar
       FROM cash_entries WHERE period BETWEEN $1 AND $2 AND status='posted' AND source_type<>'reversal' GROUP BY period`,
      [range().from, range().to],
    )
    const exp = new Map(doc.rows.map((x) => [x.period, x]))
    const voids = await sqlAs(
      'app',
      `SELECT period, sum(CASE direction WHEN 'in' THEN amount ELSE -amount END)::text AS net FROM cash_entries
       WHERE period BETWEEN $1 AND $2 AND (status='void' OR source_type='reversal') GROUP BY period`,
      [range().from, range().to],
    )
    const vnet = new Map(voids.rows.map((x) => [x.period, n(x.net)]))
    for (const [i, m] of b.entries()) {
      expect(m.masuk, m.period).toBe(n(exp.get(m.period)?.masuk))
      expect(m.keluar, m.period).toBe(n(exp.get(m.period)?.keluar))
      expect(a[i]!.net - m.net, m.period).toBe(vnet.get(m.period) ?? 0)
      expect(a[i]!.koreksi, m.period).toBe(vnet.get(m.period) ?? 0)
    }
    // the owner chart uses K-02b
    const d = await must(call('GET', '/api/v1/dashboard/owner', w.users.owner))
    expect(d.cashFlow.basis).toBe('K-02b')
    for (const r of d.cashFlow.rows) expect(r.masuk).toBe(b.find((x) => x.period === r.period)!.masuk)
  })

  it('closed month (case 4): K-02a of the closed month is unchanged by the later void; the reversal lands in the current month', async () => {
    const after = await asFinance((req) => cashFlowMonthly(req, { from: closedMonth, to: closedMonth }, 'book'))
    expect(after[0]!.masuk).toBe(closedK02a[0]!.masuk)
    expect(after[0]!.keluar).toBe(closedK02a[0]!.keluar)
    const rev = await sqlAs('app', 'SELECT period FROM cash_entries WHERE reversal_of_id = $1', [voidedClosed])
    expect(rev.rows[0].period).toBe(month)
    const op = await asFinance((req) => cashFlowMonthly(req, { from: closedMonth, to: closedMonth }, 'operational'))
    expect(op[0]!.net).not.toBe(after[0]!.net) // K-02b of the old month changed (void excluded) — documented
  })
})

describe('K-03/K-04/K-05/K-06 per request', () => {
  it('for EVERY request: k03 − k04 = ledger net; transferred_total = k03; Σ transfers = Σ transfer KK; K-06 rules', async () => {
    const doc = await sqlAs(
      'app',
      `SELECT er.id, er.type::text AS type, er.status::text AS status, coalesce(er.transferred_total,0)::text AS tt, er.verified_receipts_total::text AS vrt, er.approved_amount::text AS aa,
         (SELECT coalesce(sum(amount),0) FROM transfers t WHERE t.request_id=er.id AND t.status='posted')::text AS k03,
         (SELECT coalesce(sum(CASE direction WHEN 'out' THEN amount ELSE -amount END),0) FROM cash_entries c WHERE c.expense_request_id=er.id)::text AS ledger_net,
         (SELECT coalesce(sum(amount),0) FROM cash_entries c WHERE c.expense_request_id=er.id AND c.source_type='settlement_refund' AND c.status='posted')::text AS k04,
         (SELECT coalesce(sum(amount),0) FROM cash_entries c WHERE c.expense_request_id=er.id AND c.source_type='transfer' AND c.status='posted')::text AS kk,
         (SELECT s.verified_receipts_total::text FROM settlements s WHERE s.request_id=er.id ORDER BY s.id DESC LIMIT 1) AS s_vrt,
         (SELECT coalesce(sum(r.amount),0) FROM receipts r WHERE r.request_id=er.id AND r.status='valid')::text AS valid_receipts
       FROM expense_requests er`,
    )
    expect(doc.rows.length).toBeGreaterThanOrEqual(500)
    let checked = 0
    await asFinance(async (req) => {
      for (const x of doc.rows) {
        const m = await requestMoney(req, x.id)
        expect(m.disbursed, `k03 ${x.id}`).toBe(n(x.k03))
        expect(m.refund, `k04 ${x.id}`).toBe(n(x.k04))
        expect(m.net, `k05 ${x.id}`).toBe(n(x.ledger_net))
        expect(n(x.k03) - n(x.k04), `ledger ${x.id}`).toBe(n(x.ledger_net))
        expect(n(x.tt), `transferred_total ${x.id}`).toBe(n(x.k03))
        expect(n(x.kk), `KK ${x.id}`).toBe(n(x.k03))
        if (x.type === 'advance' && ['lpj_verified', 'completed'].includes(x.status)) {
          expect(m.realized).toBe(n(x.vrt))
          expect(n(x.s_vrt)).toBe(n(x.vrt)) // K-06 (3)
          expect(n(x.valid_receipts)).toBe(n(x.vrt))
        } else if (x.type === 'reimburse' && ['receipts_verified', 'transferred', 'completed'].includes(x.status)) {
          expect(m.realized).toBe(n(x.aa))
        } else expect(m.realized).toBe(0)
        if (x.status === 'completed') expect(m.realized, `K-06 (2) ${x.id}`).toBe(n(x.ledger_net))
        checked++
      }
    })
    expect(checked).toBe(doc.rows.length)
  })

  it('K-06 (1): Σ realisasi per category = Σ realisasi per request (K-17 realisasi, full range, no manual)', async () => {
    const byCat = await asUser(w.users.pm, (req) => spending(req, { kind: 'all' }, { from: '2000-01-01', to: '2999-12-31', basis: 'realisasi', group: 'kategori', type: 'advance' }))
    const r = await sqlAs('app', "SELECT coalesce(sum(verified_receipts_total),0)::text AS s FROM expense_requests WHERE type='advance' AND status IN ('lpj_verified','completed')")
    expect(byCat.total).toBe(n(r.rows[0].s))
    const rb = await asUser(w.users.pm, (req) => spending(req, { kind: 'all' }, { from: '2000-01-01', to: '2999-12-31', basis: 'realisasi', group: 'kategori', type: 'reimburse' }))
    const r2 = await sqlAs('app', "SELECT coalesce(sum(approved_amount),0)::text AS s FROM expense_requests WHERE type='reimburse' AND status IN ('receipts_verified','transferred','completed')")
    expect(rb.total).toBe(n(r2.rows[0].s))
  })
})

describe('K-07/K-08 anggaran project (Komitmen)', () => {
  it('committed per project = doc SQL; % = round(committed / budget × 100, 2); colour thresholds from settings', async () => {
    const list = await asFinance((req) => projectBudgets(req, { kind: 'all' }, { includeArchived: true }))
    const doc = await sqlAs('app', `SELECT project_id, sum(grand_total)::text AS s FROM expense_requests WHERE status::text IN (${COMMITTED}) AND project_id IS NOT NULL GROUP BY project_id`)
    const exp = new Map(doc.rows.map((x) => [x.project_id, n(x.s)]))
    for (const p of list) {
      expect(p.committed, p.code).toBe(exp.get(p.id) ?? 0)
      if (p.budget) {
        expect(p.pct).toBe(Math.round((p.committed / p.budget) * 10000) / 100)
        expect(p.tone).toBe(p.pct! > 100 ? 'over' : p.pct! > 85 ? 'warn' : 'ok')
      } else expect(p.tone).toBe('none')
      // K-05/K-06 per project = Σ of the per-request figures
      const pr = await sqlAs(
        'app',
        `SELECT coalesce(sum((SELECT coalesce(sum(amount),0) FROM transfers t WHERE t.request_id=er.id AND t.status='posted')
           - (SELECT coalesce(sum(amount),0) FROM cash_entries c WHERE c.expense_request_id=er.id AND c.source_type='settlement_refund' AND c.status='posted')),0)::text AS net
         FROM expense_requests er WHERE er.project_id=$1`,
        [p.id],
      )
      expect(p.disbursedNet, p.code).toBe(n(pr.rows[0].net))
    }
  })

  it('the approval screen shows the same basis (last decision budget_pct_after sample)', async () => {
    const r = await sqlAs('app', "SELECT a.budget_pct_after::float AS pct FROM approvals a JOIN expense_requests er ON er.id = a.request_id WHERE er.project_id = $1 AND a.decision = 'approved' ORDER BY a.id DESC LIMIT 1", [w.project])
    const [p] = await asFinance((req) => projectBudgets(req, { kind: 'all' }, { projectId: w.project }))
    expect(r.rows[0].pct).toBeLessThanOrEqual(p!.pct! + 0.001) // committed only grows or stays after that decision
  })
})

describe('K-10 menunggu persetujuan / K-11 antrian transfer', () => {
  it('K-10 = doc SQL; "menunggu saya" = GET /api/v1/approvals/inbox', async () => {
    const mine = await asFinance((req) => pendingApprovals(req, { kind: 'all' }))
    const doc = await sqlAs('app', "SELECT status::text AS s, count(*)::int AS n, sum(grand_total)::text AS t FROM expense_requests WHERE status IN ('pending_ack','pending_approval') GROUP BY status")
    const by = Object.fromEntries(doc.rows.map((x) => [x.s, x]))
    expect(mine.pendingAck).toEqual({ count: n(by.pending_ack?.n), sum: n(by.pending_ack?.t) })
    expect(mine.pendingApproval).toEqual({ count: n(by.pending_approval?.n), sum: n(by.pending_approval?.t) })
    for (const u of [w.users.owner, w.users.pm, w.users.otherPm]) {
      const inbox = await must(call('GET', '/api/v1/approvals/inbox', u))
      const dash = await must(call('GET', `/api/v1/dashboard/${u === w.users.owner ? 'owner' : 'pm'}`, u))
      expect(u === w.users.owner ? dash.approvals.waitingForMe : dash.waitingForMe).toBe(inbox.items.length)
    }
  })

  it('K-11 = GET /api/v1/transfer-queue (count and Σ approvedAmount)', async () => {
    const q = await asFinance((req) => transferQueueSummary(req))
    const apiQ = await must(call('GET', '/api/v1/transfer-queue', w.users.finance))
    expect(q.count).toBe(apiQ.items.length)
    expect(q.sum).toBe(apiQ.items.reduce((s: number, i: { approvedAmount: number }) => s + i.approvedAmount, 0))
    expect(q.overdue).toBe(apiQ.items.filter((i: { neededDate: string | null }) => i.neededDate !== null && i.neededDate < today).length)
    const rv = await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE type='reimburse' AND status='approved'")
    expect(q.reimburseToVerify).toBe(rv.rows[0].n)
  })
})

describe('K-12 kelengkapan nota/LPJ', () => {
  it('a…g = recount SQL; age from the first posted advance transfer; overdue > lpjDueDays (7)', async () => {
    const s = await asFinance((req) => lpjSummary(req, { kind: 'all' }, '2000-01-01', '2999-12-31'))
    const st = await sqlAs('app', "SELECT status::text AS s, count(*)::int AS n FROM expense_requests WHERE type='advance' GROUP BY status")
    const by = Object.fromEntries(st.rows.map((x) => [x.s, x.n]))
    expect(s.withoutLpj.count).toBe(n(by.transferred) + n(by.receipts_complete) + n(by.lpj_revision))
    expect(s.lpjToVerify).toBe(n(by.lpj_submitted))
    expect(s.lpjToSettle.count).toBe(n(by.lpj_verified))
    const first = await sqlAs('app', "SELECT request_id, min(transfer_date) AS d FROM transfers WHERE status='posted' AND kind='advance' GROUP BY request_id")
    const firstBy = new Map(first.rows.map((x) => [x.request_id, x.d]))
    for (const r of s.rows) {
      expect(r.firstTransfer).toBe(firstBy.get(r.id))
      const age = Math.round((Date.parse(today) - Date.parse(r.firstTransfer!)) / 86_400_000)
      expect(r.ageDays).toBe(age)
      expect(r.overdue).toBe(age > 7)
    }
    expect(s.overdue.count).toBeGreaterThan(0) // the transfers dated 3 months ago
    const e = await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE type='reimburse' AND status='approved'")
    expect(s.reimburseToVerify).toBe(e.rows[0].n)
    const f = await sqlAs('app', "SELECT count(*)::int AS n FROM receipt_flags f JOIN expense_requests er ON er.id=f.request_id WHERE f.status='open' AND f.level='warning' AND er.status NOT IN ('cancelled','rejected')")
    expect(s.openWarnings).toBe(f.rows[0].n)
    const g = await sqlAs(
      'app',
      "SELECT count(*)::int AS total, count(*) FILTER (WHERE er.status IN ('lpj_submitted','lpj_verified','completed'))::int AS done FROM expense_requests er JOIN (SELECT request_id FROM transfers WHERE status='posted' AND kind='advance' GROUP BY request_id) t ON t.request_id=er.id WHERE er.type='advance'",
    )
    expect(s.ratio).toEqual({ done: g.rows[0].done, total: g.rows[0].total })
  })

  it('lpjDueDays is a company setting (default 7)', async () => {
    const r = await sqlAs('app', 'SELECT lpj_due_days::int AS d FROM company_settings')
    expect(r.rows.every((x) => x.d === 7) || r.rows.length === 0).toBe(true)
  })
})

describe('K-13 rekap pengajuan', () => {
  it('per status = doc SQL; Σ per category = Σ grand_total of the same requests', async () => {
    const f = { from: '2000-01-01', to: '2999-12-31' }
    const s = await asFinance((req) => requestSummary(req, { kind: 'all' }, f))
    // same filter as the report: non-draft with a request date in range (a draft cancelled before submit has none)
    const doc = await sqlAs('app', "SELECT status::text AS s, count(*)::int AS n FROM expense_requests WHERE status <> 'draft' AND request_date BETWEEN '2000-01-01' AND '2999-12-31' GROUP BY status")
    const by = new Map(doc.rows.map((x) => [x.s, x.n]))
    const mineBy = new Map<string, number>()
    for (const x of s.byStatus) mineBy.set(x.status, (mineBy.get(x.status) ?? 0) + x.count)
    expect(Object.fromEntries(mineBy)).toEqual(Object.fromEntries(by))
    expect(s.byCategory.reduce((a, c) => a + c.sum, 0)).toBe(s.total.sum)
    const gt = await sqlAs('app', "SELECT coalesce(sum(grand_total),0)::text AS s FROM expense_requests WHERE status <> 'draft' AND request_date BETWEEN '2000-01-01' AND '2999-12-31'")
    expect(s.total.sum).toBe(n(gt.rows[0].s))
  })

  it('JSON report paging covers every row exactly once', async () => {
    const seen = new Set<number>()
    let cursor: string | null = null
    let count = 0
    do {
      const r: Res['body'] = await must(call('GET', `/api/v1/reports/rekap-pengajuan?dari=2000-01-01&sampai=2999-12-31${cursor ? `&cursor=${cursor}` : ''}`, w.users.finance))
      count = r.count
      for (const row of r.main.rows) seen.add(row.nomor)
      cursor = r.nextCursor
    } while (cursor)
    expect(seen.size).toBe(count)
  })
})

describe('K-14 biaya per kendaraan / K-15 pusat biaya / K-17 per kategori', () => {
  it('K-14 (a) per vehicle = doc SQL; form 228 BBM line 600.000 on the world vehicle (seed case 1)', async () => {
    const v = await asFinance((req) => vehicleCosts(req, { kind: 'all' }, { from: '2000-01-01', to: '2999-12-31' }))
    const doc = await sqlAs(
      'app',
      "SELECT l.vehicle_id, sum(l.total)::text AS s FROM expense_requests_lines l JOIN expense_requests er ON er.id=l._parent_id WHERE l.vehicle_id IS NOT NULL AND er.status::text IN ('transferred','receipts_complete','lpj_submitted','lpj_revision','lpj_verified','completed') GROUP BY l.vehicle_id",
    )
    for (const x of doc.rows) expect(v.vehicles.find((y) => y.id === x.vehicle_id)?.fromRequests, `vehicle ${x.vehicle_id}`).toBe(n(x.s))
    const man = await sqlAs('app', "SELECT vehicle_id, sum(amount)::text AS s FROM cash_entries WHERE vehicle_id IS NOT NULL AND source_type='manual' AND direction='out' AND status='posted' GROUP BY vehicle_id")
    for (const x of man.rows) expect(v.vehicles.find((y) => y.id === x.vehicle_id)?.fromManual).toBe(n(x.s))
    const form = await asFinance((req) => vehicleCosts(req, { kind: 'team', projects: [], costCenters: [w.costCenter] }, { from: today, to: today, vehicleId: w.vehicle }))
    const own228 = await sqlAs('app', `SELECT sum(l.total)::text AS s FROM expense_requests_lines l WHERE l._parent_id = $1 AND l.vehicle_id = $2`, [form228Id, w.vehicle])
    expect(n(own228.rows[0].s)).toBe(600_000)
    expect(form.vehicles[0]!.fromRequests).toBeGreaterThanOrEqual(600_000)
  })

  it('K-15 per cost center and month = Σ out − Σ in of posted non-reversal ledger rows (every month with data)', async () => {
    for (const period of periodRange(addMonths(month, -3), month)) {
      const list = await asFinance((req) => costCenterMonth(req, { kind: 'all' }, period))
      const doc = await sqlAs(
        'app',
        "SELECT cost_center_id, sum(CASE direction WHEN 'out' THEN amount ELSE -amount END)::text AS s FROM cash_entries WHERE cost_center_id IS NOT NULL AND period=$1 AND status='posted' AND source_type<>'reversal' GROUP BY cost_center_id",
        [period],
      )
      const exp = new Map(doc.rows.map((x) => [x.cost_center_id, n(x.s)]))
      for (const c of list) expect(c.total, `${c.code} ${period}`).toBe(exp.get(c.id) ?? 0)
    }
  })

  it('seed case 1 (form 228): K-03 = K-05 = 1.447.500; lines per category sum to 1.447.500', async () => {
    const m = await asFinance((req) => requestMoney(req, form228Id))
    expect(m).toMatchObject({ disbursed: 1_447_500, refund: 0, net: 1_447_500, realized: 1_447_500 })
    const cats = await sqlAs('app', 'SELECT sum(total)::text AS s FROM expense_requests_lines WHERE _parent_id=$1', [form228Id])
    expect(n(cats.rows[0].s)).toBe(1_447_500)
  })

  it('K-17 dicairkan: Σ per category = Σ KK transfer (posted, kind ≠ shortfall) + Σ manual KK, for the full range and per month', async () => {
    for (const [from, to] of [
      ['2000-01-01', '2999-12-31'],
      [`${month}-01`, lastDay(month)],
      [`${closedMonth}-01`, lastDay(closedMonth)],
    ] as const) {
      const s = await asFinance((req) => spending(req, { kind: 'all' }, { from, to, basis: 'dicairkan', group: 'kategori' }))
      const doc = await sqlAs(
        'app',
        `SELECT (SELECT coalesce(sum(c.amount),0) FROM cash_entries c JOIN transfers t ON t.id=c.transfer_id WHERE c.source_type='transfer' AND c.status='posted' AND t.kind<>'lpj_shortfall' AND c.entry_date BETWEEN $1 AND $2)::text AS kk,
                (SELECT coalesce(sum(amount),0) FROM cash_entries WHERE source_type='manual' AND direction='out' AND status='posted' AND entry_date BETWEEN $1 AND $2)::text AS man`,
        [from, to],
      )
      expect(s.total, `${from}..${to}`).toBe(n(doc.rows[0].kk) + n(doc.rows[0].man))
      expect(s.items.reduce((a, i) => a + i.fromManual, 0)).toBe(n(doc.rows[0].man))
      const byScope = await asFinance((req) => spending(req, { kind: 'all' }, { from, to, basis: 'dicairkan', group: 'lingkup' }))
      expect(byScope.total).toBe(s.total)
    }
  })
})

describe('K-16 audit log', () => {
  it('count = SQL with the same filter; keyset paging returns every row once, newest first', async () => {
    const sp = new URLSearchParams({ dari: addDays(today, -1), sampai: today, aksi: 'approve' })
    const first = await asUser(w.users.owner, (req) => AUDIT_REPORT.run(req, { kind: 'all' }, sp, { limit: 50 }))
    const sql = await sqlAs(
      'app',
      "SELECT count(*)::int AS n FROM audit_logs WHERE action='approve' AND server_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Makassar') AND server_time < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Makassar')",
      [addDays(today, -1), today],
    )
    expect(first.count).toBe(sql.rows[0].n)
    expect(first.count).toBeGreaterThan(50)
    let cursor = first.next
    let seen = first.main.rows.length
    let prev = first.main.rows.at(-1)!.cells.waktu as string
    while (cursor) {
      const p = await asUser(w.users.owner, (req) => AUDIT_REPORT.run(req, { kind: 'all' }, sp, { cursor: cursor!, limit: 50 }))
      expect((p.main.rows[0]!.cells.waktu as string) <= prev).toBe(true)
      prev = p.main.rows.at(-1)!.cells.waktu as string
      seen += p.main.rows.length
      cursor = p.next
    }
    expect(seen).toBe(first.count)
  })

  it('Owner, Admin and Finance may read it (Q-F3-4); Staff/PM 403; export > 31 days → 400', async () => {
    for (const u of [w.users.owner, w.users.admin, w.users.finance]) expect((await call('GET', '/api/v1/reports/audit-log', u)).status).toBe(200)
    for (const u of [w.users.staffA, w.users.pm]) expect((await call('GET', '/api/v1/reports/audit-log', u)).status).toBe(403)
    expect((await call('GET', `/api/v1/reports/audit-log/csv?dari=${addDays(today, -40)}&sampai=${today}`, w.users.owner)).status).toBe(400)
  })
})

describe('scope (C5, kpi §3 case 5): PM sees only the team; Staff/Admin no office reports', () => {
  it('PM dashboard + reports never contain the other PM’s project/cost center', async () => {
    const d = await must(call('GET', '/api/v1/dashboard/pm', w.users.pm))
    expect(d.projects.map((p: { id: number }) => p.id)).toEqual([w.project])
    expect(d.costCenters.map((c: { id: number }) => c.id)).toEqual([w.costCenter])
    const other = await sqlAs('app', "SELECT doc_no FROM expense_requests WHERE (project_id = $1 OR cost_center_id = $2) AND status <> 'draft'", [w.otherProject, cc2])
    const otherNos = new Set(other.rows.map((x) => x.doc_no))
    expect(otherNos.size).toBeGreaterThan(10)
    for (const code of ['rekap-pengajuan', 'anggaran-project', 'kelengkapan', 'pengeluaran-kategori', 'biaya-kendaraan']) {
      const r = await must(call('GET', `/api/v1/reports/${code}?dari=2000-01-01&sampai=2999-12-31`, w.users.pm))
      expect(r.scope).toBe('team')
      expect(JSON.stringify(r)).not.toContain('FK-P2') // other project code
      for (const row of r.main.rows) if (row.nomor) expect(otherNos.has(row.nomor), `${code} ${row.nomor}`).toBe(false)
      // explicit out-of-scope filter → empty, never the other team's data
      const forced = await must(call('GET', `/api/v1/reports/${code}?dari=2000-01-01&sampai=2999-12-31&project=${w.otherProject}`, w.users.pm))
      if (code !== 'biaya-kendaraan') expect(forced.main.rows.length, code).toBe(0)
    }
    // CSV export of the PM with the other project forced
    const csv = await download(`/api/v1/reports/rekap-pengajuan/csv?dari=2000-01-01&sampai=2999-12-31&project=${w.otherProject}`, w.users.pm)
    expect(csv.status).toBe(200)
    for (const no of otherNos) expect(csv.text).not.toContain(no)
    // numbers of the team scope = SQL restricted to the team ids
    const team = await asUser(w.users.pm, async (req) => requestSummary(req, { kind: 'team', projects: [w.project], costCenters: [w.costCenter] }, { from: '2000-01-01', to: '2999-12-31' }))
    const sql = await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE status <> 'draft' AND request_date IS NOT NULL AND (project_id=$1 OR cost_center_id=$2)", [w.project, w.costCenter])
    expect(team.total.count).toBe(sql.rows[0].n)
    // PM: no manual cash in K-17 / K-14, no cash reports
    const k17 = await must(call('GET', '/api/v1/reports/pengeluaran-kategori?dari=2000-01-01&sampai=2999-12-31', w.users.pm))
    expect(k17.main.columns.map((c: { key: string }) => c.key)).not.toContain('manual')
    for (const code of ['rekap-kas', 'buku-kas']) expect((await call('GET', `/api/v1/reports/${code}`, w.users.pm)).status).toBe(403)
  })

  it('other PM gets its own team only; empty scope → empty (never "all")', async () => {
    const d = await must(call('GET', '/api/v1/dashboard/pm', w.users.otherPm))
    expect(d.projects.map((p: { id: number }) => p.id)).toEqual([w.otherProject])
    const lonely = await makeLonelyPm()
    const e = await must(call('GET', '/api/v1/dashboard/pm', lonely))
    expect(e).toMatchObject({ hasScope: false, projects: [], costCenters: [], latest: [], teamMonth: { count: 0 } })
    const r = await must(call('GET', '/api/v1/reports/rekap-pengajuan?dari=2000-01-01&sampai=2999-12-31', lonely))
    expect(r.count).toBe(0)
  })

  it('Staff: no office dashboards/reports (403); /dashboard/me lists only own requests', async () => {
    for (const p of ['/api/v1/dashboard/owner', '/api/v1/dashboard/finance', '/api/v1/dashboard/pm', '/api/v1/reports/rekap-kas', '/api/v1/reports/rekap-pengajuan', '/api/v1/reports/kelengkapan/csv', '/api/v1/reports/audit-log']) {
      expect((await call('GET', p, w.users.staffA)).status, p).toBe(403)
    }
    const me = await must(call('GET', '/api/v1/dashboard/me', w.users.staffB))
    expect(me.latest).toEqual([])
    const mine = await must(call('GET', '/api/v1/dashboard/me', w.users.staffA))
    expect(mine.latest.length).toBe(10)
    expect(mine.actions.every((a: { status: string }) => ['draft', 'receipt_revision', 'transferred', 'receipts_complete', 'lpj_revision'].includes(a.status))).toBe(true)
  })

  it('Admin: audit log + admin home only; no finance reports', async () => {
    expect((await call('GET', '/api/v1/dashboard/admin', w.users.admin)).status).toBe(200)
    for (const code of ['rekap-kas', 'anggaran-project', 'rekap-pengajuan']) expect((await call('GET', `/api/v1/reports/${code}`, w.users.admin)).status).toBe(403)
    expect((await call('GET', '/api/v1/reports/nope', w.users.finance)).status).toBe(404)
  })
})

async function makeLonelyPm(): Promise<FlowUser> {
  const { makeFlowUser } = await import('./flow-world')
  return makeFlowUser(['pk-pm'], 'f3-lonely-pm', null, { signature: false })
}

async function download(path: string, user: FlowUser): Promise<{ status: number; headers: Headers; bytes: Uint8Array; text: string }> {
  resetRateLimits()
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { Origin: ORIGIN, Cookie: user.cookie } }) })
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { status: res.status, headers: res.headers, bytes, text: new TextDecoder().decode(bytes) }
}

describe('exports (Q-F3-3/Q-F3-5)', () => {
  it('CSV: BOM, ";" separator, title rows, amounts as integers, formula injection neutralised, audit row', async () => {
    const before = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action='export' AND doc_type='report' AND doc_no='rekap-pengajuan'")
    const r = await download(`/api/v1/reports/rekap-pengajuan/csv?dari=${today}&sampai=${today}&pusat=${w.costCenter}`, w.users.finance)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/csv')
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="rekap-pengajuan_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect(Array.from(r.bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(r.text).toContain('Rekap Pengajuan\r\n')
    expect(r.text).toContain('Nomor;Tanggal;Jenis;Judul')
    expect(r.text).toContain(`;1447500;`)
    expect(r.text).toContain(`"'=HYPERLINK(""http://x"")`)
    expect(r.text).not.toMatch(/;=HYPERLINK/)
    const after = await sqlAs('app', "SELECT count(*)::int AS n, max(field) AS f FROM audit_logs WHERE action='export' AND doc_type='report' AND doc_no='rekap-pengajuan'")
    expect(after.rows[0].n).toBe(before.rows[0].n + 1)
  })

  it('CSV of a paged report streams past the first page (keyset), row count = report count', async () => {
    const sp = `dari=2000-01-01&sampai=2999-12-31`
    const json = await must(call('GET', `/api/v1/reports/rekap-pengajuan?${sp}`, w.users.finance))
    const r = await download(`/api/v1/reports/rekap-pengajuan/csv?${sp}`, w.users.finance)
    const dataLines = r.text.split('\r\n').filter((l) => /^\d+\/PB-/.test(l) || /^"?\d+\/PB-/.test(l))
    expect(json.count).toBeGreaterThan(100)
    expect(dataLines.length).toBe(json.count)
  })

  it('XLSX: numeric amounts with #,##0, title sheet + extra sheets, formula-looking title stays text', async () => {
    const r = await download(`/api/v1/reports/rekap-pengajuan/xlsx?dari=${today}&sampai=${today}&pusat=${w.costCenter}`, w.users.owner)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const files = unzipSync(r.bytes)
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!)
    expect(sheet).toContain('<v>1447500</v>')
    expect(sheet).not.toMatch(/<f>/)
    expect(strFromU8(files['xl/styles.xml']!)).toContain('formatCode="#,##0"')
    expect(Object.keys(files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).length).toBe(3) // main + per status + per category
  })

  it('PDF for rekap-kas / pengeluaran-kategori / anggaran-project only', async () => {
    for (const code of ['rekap-kas', 'pengeluaran-kategori', 'anggaran-project']) {
      const r = await download(`/api/v1/reports/${code}/pdf`, w.users.owner)
      expect(r.status, code).toBe(200)
      expect(r.text.slice(0, 5)).toBe('%PDF-')
    }
    for (const code of ['buku-kas', 'rekap-pengajuan', 'kelengkapan', 'biaya-kendaraan']) expect((await download(`/api/v1/reports/${code}/pdf`, w.users.owner)).status, code).toBe(404)
  })

  it('caps: XLSX > 10 000 rows → 413, PDF > 500 rows → 413 (no audit row); EXPORT_XLSX_ENABLED=false → 404', async () => {
    const def = reportByCode('rekap-pengajuan')!
    const fake: ReportDef = { ...def, run: async (req, s, sp, page) => ({ ...(await def.run(req, s, sp, { ...page, limit: 1 })), count: 10_001 }) }
    const before = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action='export'")
    await expect(asUser(w.users.finance, (req) => prepareExport(req, fake, { kind: 'all' }, new URLSearchParams(), 'xlsx'))).rejects.toMatchObject({ status: 413 })
    const pdfFake: ReportDef = { ...def, formats: ['pdf'], run: async (req, s, sp, page) => ({ ...(await def.run(req, s, sp, { ...page, limit: 1 })), count: 501 }) }
    await expect(asUser(w.users.finance, (req) => prepareExport(req, pdfFake, { kind: 'all' }, new URLSearchParams(), 'pdf'))).rejects.toBeInstanceOf(ExportRefused)
    const after = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action='export'")
    expect(after.rows[0].n).toBe(before.rows[0].n)
    process.env.EXPORT_XLSX_ENABLED = 'false'
    try {
      expect((await download('/api/v1/reports/rekap-kas/xlsx', w.users.finance)).status).toBe(404)
      const j = await must(call('GET', '/api/v1/reports/rekap-kas', w.users.finance))
      expect(j.formats).toEqual(['csv', 'pdf'])
      expect((await download('/api/v1/reports/rekap-kas/csv', w.users.finance)).status).toBe(200)
    } finally {
      delete process.env.EXPORT_XLSX_ENABLED
    }
  })

  it('rate limit: 10 exports per minute per user → 429', async () => {
    resetRateLimits()
    const codes: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}/api/v1/reports/kelengkapan/csv`, { headers: { Origin: ORIGIN, Cookie: w.users.finance.cookie } }) })
      await res.arrayBuffer()
      codes.push(res.status)
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true)
    expect(codes[10]).toBe(429)
  })
})
