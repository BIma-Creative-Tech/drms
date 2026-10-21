import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { getTestPayload } from './helpers'
import { api, draftBody, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type Res, type World } from './flow-world'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 3 Keuangan): GET /kas/book, /kas/periods, /transfers/voidable and the
 * read-only /data/{collection} lists — the web pages "Buku kas", "Tutup buku", "Transfer tercatat" and the "Data …"
 * lists as JSON, with the web's per-PT rights (Finance writes, Direktur reads / re-opens). The closing test runs in
 * its own PT (closing one PT never locks another, ADR 0016 §4), deactivated afterwards. Fictional data only.
 */
let w: World
let km: { id: number; entryNo: string }
let transfer: { requestId: number; transferId: number; transferDocNo: string }
let pt2: number
let fin2: FlowUser
let dir2: FlowUser
const E = '/api/v1/expense-requests'
const idem = () => ({ 'Idempotency-Key': randomUUID() })

async function must(r: Promise<Res>, status = 200): Promise<Res['body']> {
  resetRateLimits()
  const res = await r
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`)
  return res.body
}

/** Submitted request → approved by whoever the state machine allows next (as e2-kas-ui). */
async function driveApproved(id: number): Promise<void> {
  const deciders = [w.users.pm, w.users.owner, w.users.owner2, w.users.finance]
  for (let step = 0; step < 6; step++) {
    const cur = await must(api('GET', `${E}/${id}`, w.users.finance))
    if (cur.status === 'approved') return
    let acted = false
    for (const u of deciders) {
      resetRateLimits()
      const d = await api('GET', `${E}/${id}`, u)
      const act = ['acknowledge', 'approve'].find((a) => (d.body?.allowedActions ?? []).includes(a))
      if (!act) continue
      await must(api('POST', `${E}/${id}/${act}`, u, {}))
      acted = true
      break
    }
    if (!acted) throw new Error(`no decider for request ${id} in ${cur.status}`)
  }
  throw new Error(`request ${id} not approved`)
}

beforeAll(async () => {
  w = await makeWorld('AK3')
  km = await must(
    api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', cashAccountId: w.cashAccount, amount: 1_250_000, description: 'Setoran APK tahap 3 (fiktif)', cashInSourceId: w.cashInSource }, idem()),
    201,
  )
  const d = await must(api('POST', E, w.users.staffA, draftBody(w)), 201)
  await must(api('POST', `${E}/${d.id}/submit`, w.users.staffA, {}))
  await driveApproved(d.id)
  const proof = (await must(upload('/api/v1/media/transfer-proofs', w.users.finance, await png()), 201)).id
  const t = await must(api('POST', `${E}/${d.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'AK3-1', proofMediaId: proof }, idem()), 201)
  transfer = { requestId: d.id, transferId: t.transferId, transferDocNo: t.transferDocNo }
  // a PT of its own for the closing test
  pt2 = await sysCreate('companies', { name: 'PT Uji Tutup Buku APK', shortCode: `TB${Date.now() % 1000}`, timezone: 'Asia/Makassar' })
  fin2 = await makeFlowUser(['pk-finance'], 'ak3-pt2-finance', null, { company: pt2 })
  dir2 = await makeFlowUser(['pk-owner'], 'ak3-pt2-direktur', null, { company: pt2 })
  await sysCreate('cash-accounts', { company: pt2, name: 'Kas PT2 APK', kind: 'cash', openingBalance: 0, openingBalanceDate: '2025-01-01' })
}, 600_000)

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  // every other test file assumes the single-company default (same as d1010-loans)
  if (pt2) await p.update({ collection: 'companies', id: pt2, data: { active: false, changeReason: 'uji APK tahap 3 selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

describe('GET /api/v1/kas/book', () => {
  it('Finance: tiles, lookups, lock per PT, rows with edit / void rights', async () => {
    const b = await must(api('GET', '/api/v1/kas/book?per=100', w.users.finance))
    expect(b.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(b.canWrite).toBe(true)
    expect(b.pts[0]).toMatchObject({ write: true, reopen: false, today: b.today })
    expect(b.lookups.accounts.some((a: { id: number }) => a.id === w.cashAccount)).toBe(true)
    expect(b.accounts.find((a: { cashAccountId: number }) => a.cashAccountId === w.cashAccount)).toMatchObject({ name: expect.any(String), balance: expect.any(Number), flowIn: expect.any(Number) })
    expect(b.total).toBe(b.byPt.reduce((s: number, x: { total: number }) => s + x.total, 0))
    const row = b.page.rows.find((r: { id: number }) => r.id === km.id)
    expect(row).toMatchObject({ entryNo: km.entryNo, direction: 'in', amount: 1_250_000, sourceType: 'manual', canEdit: true, canVoid: true, voidHint: null })
    const kk = b.page.rows.find((r: { sourceType: string; request: { id: number } | null }) => r.sourceType === 'transfer' && r.request?.id === transfer.requestId)
    expect(kk).toMatchObject({ canEdit: false, canVoid: false, voidHint: 'Batalkan lewat transfer pengajuan' })
    expect(b.page).toMatchObject({ page: 1, totalDocs: expect.any(Number), totalPages: expect.any(Number) })
  })

  it('filters like the web (arah=keluar → only cash-out rows)', async () => {
    const b = await must(api('GET', '/api/v1/kas/book?arah=keluar&per=100', w.users.finance))
    expect(b.page.rows.length).toBeGreaterThan(0)
    expect(b.page.rows.every((r: { direction: string }) => r.direction === 'out')).toBe(true)
  })

  it('Direktur reads only (no write, no edit / void); Staff / Admin 403', async () => {
    const b = await must(api('GET', '/api/v1/kas/book?per=100', w.users.owner))
    expect(b.canWrite).toBe(false)
    expect(b.pts[0]).toMatchObject({ write: false, reopen: true })
    expect(b.page.rows.find((r: { id: number }) => r.id === km.id)).toMatchObject({ canEdit: false, canVoid: false, voidHint: null })
    expect((await api('GET', '/api/v1/kas/book', w.users.staffA)).status).toBe(403)
    expect((await api('GET', '/api/v1/kas/book', w.users.admin)).status).toBe(403)
  })
})

describe('GET /api/v1/kas/periods', () => {
  it('one PT: 13 months newest first, closable months; close → history + locked; re-open = Direktur only', async () => {
    const p0 = await must(api('GET', '/api/v1/kas/periods', fin2))
    expect(p0).toMatchObject({ company: pt2, lockDate: null, booksStart: '2025-01-01', latestClosed: null, canReopen: false, history: [] })
    expect(p0.rows[0]).toMatchObject({ period: p0.today.slice(0, 7), state: 'current', canClose: false })
    expect(p0.closable.length).toBeGreaterThan(0)
    const month = p0.closable[0] as string
    expect(p0.rows.find((r: { period: string }) => r.period === month)).toMatchObject({ state: 'open', canClose: true, n: 0, tin: 0, tout: 0 })

    await must(api('POST', '/api/v1/period-closings', fin2, { period: month, note: 'uji APK', company: pt2 }, idem()), 201)
    const p1 = await must(api('GET', `/api/v1/kas/periods?company=${pt2}`, fin2))
    expect(p1.latestClosed).toBe(month)
    expect(p1.lockDate).toMatch(new RegExp(`^${month}-\\d{2}$`))
    expect(p1.history[0]).toMatchObject({ period: month, status: 'closed', note: 'uji APK', closedBy: expect.any(String), closedAt: expect.any(String), reopenedBy: null })
    expect(p1.rows.find((r: { period: string }) => r.period === month)).toMatchObject({ state: 'closed', explicit: true, canClose: false, canReopen: false })
    expect(p1.closable).not.toContain(month)

    const d = await must(api('GET', '/api/v1/kas/periods', dir2))
    expect(d.canReopen).toBe(true)
    expect(d.rows.find((r: { period: string }) => r.period === month)).toMatchObject({ canReopen: true })
  })

  it('a PT outside the caller\'s Kas PTs → 403; Staff 403', async () => {
    const own = await must(api('GET', '/api/v1/kas/periods', w.users.finance))
    expect(own.company).not.toBe(pt2)
    expect((await api('GET', `/api/v1/kas/periods?company=${own.company}`, fin2)).status).toBe(403)
    expect((await api('GET', '/api/v1/kas/periods?company=abc', fin2)).status).toBe(400)
    expect((await api('GET', '/api/v1/kas/periods', w.users.staffA)).status).toBe(403)
  })
})

describe('GET /api/v1/transfers/voidable', () => {
  it('lists the recorded transfer; void right = Finance of the PT; filters q / jenis', async () => {
    const f = await must(api('GET', '/api/v1/transfers/voidable?per=100', w.users.finance))
    expect(f.items.find((t: { transferId: number }) => t.transferId === transfer.transferId)).toMatchObject({ requestId: transfer.requestId, requestType: 'advance', transferNo: transfer.transferDocNo, canVoid: true })
    const o = await must(api('GET', '/api/v1/transfers/voidable?per=100', w.users.owner))
    expect(o.items.find((t: { transferId: number }) => t.transferId === transfer.transferId)).toMatchObject({ canVoid: false })
    const q = await must(api('GET', `/api/v1/transfers/voidable?q=${encodeURIComponent(transfer.transferDocNo)}`, w.users.finance))
    expect(q.items.map((t: { transferId: number }) => t.transferId)).toEqual([transfer.transferId])
    const r = await must(api('GET', '/api/v1/transfers/voidable?jenis=reimburse&per=100', w.users.finance))
    expect(r.items.some((t: { transferId: number }) => t.transferId === transfer.transferId)).toBe(false)
    expect((await api('GET', '/api/v1/transfers/voidable', w.users.staffA)).status).toBe(403)
  })
})

describe('GET /api/v1/data/{collection}', () => {
  it('transfers: the web list columns as display text; detail with every readable field', async () => {
    const l = await must(api('GET', `/api/v1/data/transfers?q=${encodeURIComponent(transfer.transferDocNo)}`, w.users.finance))
    expect(l).toMatchObject({ collection: 'transfers', label: 'Transfer' })
    // MC2: the PT column (`company`) is prepended at runtime, as on the web list
    expect(l.columns.map((c: { key: string }) => c.key)).toEqual(['company', 'docNo', 'request', 'kind', 'amount', 'cashAccount', 'transferAt', 'status'])
    const item = l.items.find((i: { id: number }) => i.id === transfer.transferId)
    expect(item).toMatchObject({ title: transfer.transferDocNo, cells: { docNo: transfer.transferDocNo, status: 'Posted' } })
    expect(item.cells.amount).toMatch(/^Rp \d{1,3}(\.\d{3})*$/)
    const d = await must(api('GET', `/api/v1/data/transfers/${transfer.transferId}`, w.users.finance))
    expect(d).toMatchObject({ collection: 'transfers', id: transfer.transferId, title: transfer.transferDocNo })
    expect(d.fields.find((f: { key: string }) => f.key === 'bankRef')).toMatchObject({ value: 'AK3-1' })
  })

  it('access = the web list: the requester sees it, another Staff does not (list + 404)', async () => {
    const own = await must(api('GET', '/api/v1/data/transfers?limit=50', w.users.staffA))
    expect(own.items.some((i: { id: number }) => i.id === transfer.transferId)).toBe(true)
    const other = await must(api('GET', '/api/v1/data/transfers?limit=50', w.users.staffB))
    expect(other.items.some((i: { id: number }) => i.id === transfer.transferId)).toBe(false)
    expect((await api('GET', `/api/v1/data/transfers/${transfer.transferId}`, w.users.staffB)).status).toBe(404)
  })

  it('receipts / cash-entries lists; a collection outside the whitelist → 404', async () => {
    const r = await must(api('GET', '/api/v1/data/receipts', w.users.finance))
    expect(r).toMatchObject({ collection: 'receipts', label: 'Nota', page: 1 })
    expect(r.columns.map((c: { key: string }) => c.key)).toContain('vendorName')
    const c = await must(api('GET', `/api/v1/data/cash-entries?q=${encodeURIComponent(km.entryNo)}`, w.users.finance))
    expect(c.items[0]).toMatchObject({ id: km.id, cells: { entryNo: km.entryNo, amount: 'Rp 1.250.000' } })
    expect((await api('GET', '/api/v1/data/users', w.users.finance)).status).toBe(404)
    expect((await api('GET', '/api/v1/data/transfers/abc', w.users.finance)).status).toBe(404)
  })
})

describe('loan lists: summary=1 (web tiles) + detail today', () => {
  it('project loans: summary only on request; detail carries mayVoidRepayment + today', async () => {
    const plain = await must(api('GET', '/api/v1/project-loans', w.users.pm))
    expect(plain.summary).toBeUndefined()
    const s = await must(api('GET', '/api/v1/project-loans?summary=1', w.users.pm))
    expect(s.summary).toMatchObject({ totals: { pending: expect.any(Number), amount: expect.any(Number), repaid: expect.any(Number), outstanding: expect.any(Number), overdueCount: expect.any(Number), overdue: expect.any(Number) }, inboxCount: expect.any(Number), canCreate: true })
    const o = await must(api('GET', '/api/v1/project-loans?summary=1', w.users.owner))
    expect(o.summary.canCreate).toBe(false)
    const today = (await must(api('GET', '/api/v1/kas/book', w.users.finance))).today as string
    const l = await must(api('POST', '/api/v1/project-loans', w.users.pm, { borrowerProjectId: w.project, lenderProjectId: w.otherProject, amount: 100_000, reason: 'Uji APK tahap 3', dueDate: today }, idem()), 201)
    const d = await must(api('GET', `/api/v1/project-loans/${l.id}`, w.users.pm))
    expect(d).toMatchObject({ today, mayVoidRepayment: expect.any(Boolean) })
  })

  it('intercompany loans: summary only on request; Owner of one PT cannot instruct', async () => {
    expect((await must(api('GET', '/api/v1/intercompany-loans', w.users.finance))).summary).toBeUndefined()
    const s = await must(api('GET', '/api/v1/intercompany-loans?summary=1', w.users.finance))
    expect(s.summary).toMatchObject({ receivable: expect.any(Number), payable: expect.any(Number), overdue: expect.any(Number), queueCount: expect.any(Number), canInstruct: false })
  })
})
