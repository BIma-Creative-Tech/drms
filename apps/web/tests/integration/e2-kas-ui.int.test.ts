import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accountFlows, cashBookPage, kasAccess, parseBookQuery, periodSummaries, voidableTransfers } from '@/domain/cash/book'
import { periodEnd } from '@/domain/cash/periods'
import { resetRateLimits } from '@/lib/rate-limit'

import { auditRows, getTestPayload, sqlAs } from './helpers'
import { api, asUser, draftBody, makeFlowUser, makeWorld, png, upload, type FlowUser, type Res, type World } from './flow-world'

/**
 * E2 (fase1-golive §E2) acceptance criteria through the same /api/v1 endpoints the web "Kas"
 * views call (cookie session + Origin, Idempotency-Key): KM/KK numbering, saldo change, audit,
 * edit with reason, void semantics (original stays "Void", reversal row linked), void transfer
 * (Uang Muka → approved, Reimburse → receipts_verified, KK reversed), posting into a closed period
 * rejected with an Indonesian message, re-open = Direktur (pk-owner) only, per-role negatives, and
 * the read model of the views (book page links, filters, flows, voidable transfers, view guards).
 * Fictional data only. The DB is shared with other files → assertions are restricted to this
 * world's ids; the period test restores the lock state it found.
 */
let w: World
let today: string
let yymm: string
let prev: string
/** Periods closed by OTHER test files that this file re-opened temporarily (re-closed in afterAll). */
const restoreClosed: string[] = []
const E = '/api/v1/expense-requests'

async function must(r: Promise<Res>, status = 200): Promise<Res['body']> {
  resetRateLimits()
  const res = await r
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`)
  return res.body
}

async function balanceOf(user: FlowUser = w.users.finance): Promise<number> {
  const b = await must(api('GET', '/api/v1/cash-accounts/balances', user))
  return b.items.find((x: { cashAccountId: number }) => x.cashAccountId === w.cashAccount).balance
}

const idem = () => ({ 'Idempotency-Key': randomUUID() })

/**
 * Drives a submitted request to `approved` by whoever the state machine allows next
 * (acknowledge/approve) — independent of the approval-rule layout (E1 changes who decides).
 */
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

async function transferProof(): Promise<number> {
  resetRateLimits()
  return (await must(upload('/api/v1/media/transfer-proofs', w.users.finance, await png()), 201)).id
}

beforeAll(async () => {
  w = await makeWorld('KAS')
  today = await asUser(w.users.finance, async (req) => (await import('@/domain/expense/common')).today(req))
  yymm = `${today.slice(2, 4)}${today.slice(5, 7)}`
  // A month no other test file uses (they close M-1 / M-3 relative to today or 2026-08): the
  // period test must not add audit rows or lock dates to their months.
  prev = '2025-03'
})

afterAll(async () => {
  for (const p of restoreClosed.sort()) await api('POST', '/api/v1/period-closings', w.users.finance, { period: p, note: 'dipulihkan setelah uji E2' })
  await (await getTestPayload()).destroy()
})

describe('E2 kas masuk / kas keluar (US-23)', () => {
  let km: { id: number; entryNo: string }
  let kk: { id: number; entryNo: string }

  it('Finance posts KM: number KM/YYMM/####, saldo +amount, audit create; same Idempotency-Key → replay, not a 2nd posting', async () => {
    const before = await balanceOf()
    const proofId = (await must(upload('/api/v1/media/attachments', w.users.finance, await png()), 201)).id
    const key = idem()
    const body = { direction: 'in', entryDate: today, cashAccountId: w.cashAccount, amount: 2_500_000, description: 'Setoran modal (fiktif)', cashInSourceId: w.cashInSource, projectId: w.project, proofId }
    const r = await api('POST', '/api/v1/cash-entries', w.users.finance, body, key)
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body).toMatchObject({ entryNo: expect.stringMatching(new RegExp(`^KM/${yymm}/\\d{4}$`)), direction: 'in', amount: 2_500_000, status: 'posted', sourceType: 'manual', period: today.slice(0, 7), projectId: w.project })
    km = r.body
    const again = await api('POST', '/api/v1/cash-entries', w.users.finance, body, key)
    expect(again.status).toBe(201)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect(again.body.id).toBe(km.id)
    expect(await balanceOf()).toBe(before + 2_500_000)
    const rows = await auditRows('cash_entry', km.id)
    expect(rows.some((x) => x.action === 'create')).toBe(true)
    const proof = await sqlAs('app', 'SELECT proof_id FROM cash_entries WHERE id = $1', [km.id])
    expect(proof.rows[0].proof_id).toBe(proofId)
  })

  it('Finance posts KK with category + vehicle + cost center: KK/YYMM/####, saldo −amount; numbers are sequential per month', async () => {
    const before = await balanceOf()
    const r = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'out', entryDate: today, cashAccountId: w.cashAccount, amount: 400_000, description: 'BBM operasional (fiktif)', categoryId: w.cat.bbm, vehicleId: w.vehicle, costCenterId: w.costCenter }, idem())
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.entryNo).toMatch(new RegExp(`^KK/${yymm}/\\d{4}$`))
    expect(r.body).toMatchObject({ vehicleId: w.vehicle, costCenterId: w.costCenter, categoryId: w.cat.bbm })
    kk = r.body
    expect(await balanceOf()).toBe(before - 400_000)
    const r2 = await must(api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'out', cashAccountId: w.cashAccount, amount: 1_000, description: 'Parkir', categoryId: w.cat.bbm }, idem()), 201)
    expect(Number(r2.entryNo.slice(-4))).toBe(Number(kk.entryNo.slice(-4)) + 1)
  })

  it('server-side validation in Indonesian: project XOR cost center, category/source required, future date, bad body', async () => {
    const base = { direction: 'out', cashAccountId: w.cashAccount, amount: 1_000, description: 'x', categoryId: w.cat.mat }
    const both = await api('POST', '/api/v1/cash-entries', w.users.finance, { ...base, projectId: w.project, costCenterId: w.costCenter })
    expect(both.status).toBe(400)
    expect(both.body.title).toBe('Pilih project ATAU pusat biaya.')
    const noCat = await api('POST', '/api/v1/cash-entries', w.users.finance, { ...base, categoryId: null })
    expect(noCat.body.title).toBe('Kategori wajib untuk kas keluar.')
    const noSrc = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', cashAccountId: w.cashAccount, amount: 1, description: 'x' })
    expect(noSrc.body.title).toBe('Sumber wajib untuk kas masuk.')
    const future = await api('POST', '/api/v1/cash-entries', w.users.finance, { ...base, entryDate: '2099-01-01' })
    expect(future.body.title).toBe('Tanggal tidak boleh di masa depan.')
    const zod = await api('POST', '/api/v1/cash-entries', w.users.finance, { ...base, amount: 1.5, entryNo: 'KM/HACK/1' })
    expect(zod.status).toBe(400) // strict schema: client cannot set the number, amount must be integer
  })

  it('edit before period close: reason required (400), descriptive fields only, audit with reason; Idempotency-Key honoured on PATCH', async () => {
    expect((await api('PATCH', `/api/v1/cash-entries/${kk.id}`, w.users.finance, { description: 'BBM Hilux' })).status).toBe(400)
    expect((await api('PATCH', `/api/v1/cash-entries/${kk.id}`, w.users.finance, { amount: 1, reason: 'ubah nominal' })).status).toBe(400) // strict: amount not editable
    const key = idem()
    const body = { description: 'BBM Hilux proyek (fiktif)', costCenterId: null, projectId: w.project, reason: 'salah pembebanan' }
    const e = await api('PATCH', `/api/v1/cash-entries/${kk.id}`, w.users.finance, body, key)
    expect(e.status, JSON.stringify(e.body)).toBe(200)
    expect(e.body).toMatchObject({ description: 'BBM Hilux proyek (fiktif)', projectId: w.project, costCenterId: null, amount: 400_000 })
    const again = await api('PATCH', `/api/v1/cash-entries/${kk.id}`, w.users.finance, body, key)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    const rows = await auditRows('cash_entry', kk.id)
    expect(rows.find((x) => x.field === 'description' && x.reason === 'salah pembebanan')).toBeTruthy()
    expect(rows.filter((x) => x.action === 'update' && x.field === 'description')).toHaveLength(1) // the replay wrote nothing
  })

  it('Void: reason required; original stays (status void + reason), reversal row inverted & linked, saldo restored, audit void', async () => {
    const before = await balanceOf()
    expect((await api('POST', `/api/v1/cash-entries/${km.id}/void`, w.users.finance, {})).status).toBe(400)
    expect((await api('POST', `/api/v1/cash-entries/${km.id}/void`, w.users.finance, { reason: 'x' })).status).toBe(400) // min 3
    const v = await api('POST', `/api/v1/cash-entries/${km.id}/void`, w.users.finance, { reason: 'setoran batal' }, idem())
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(v.body.original).toMatchObject({ id: km.id, entryNo: km.entryNo, status: 'void', voidReason: 'setoran batal', amount: 2_500_000, direction: 'in' })
    expect(v.body.reversal).toMatchObject({ direction: 'out', amount: 2_500_000, sourceType: 'reversal', reversalOfId: km.id, entryDate: today, status: 'posted' })
    expect(v.body.reversal.entryNo).toMatch(new RegExp(`^KK/${yymm}/\\d{4}$`))
    expect(v.body.original.reversedById).toBe(v.body.reversal.id)
    expect(await balanceOf()).toBe(before - 2_500_000)
    const rows = await auditRows('cash_entry', km.id)
    expect(rows.find((x) => x.action === 'void' && x.reason === 'setoran batal')).toBeTruthy()
    expect((await api('POST', `/api/v1/cash-entries/${km.id}/void`, w.users.finance, { reason: 'lagi' })).body.title).toBe('Transaksi sudah di-void.')
    expect((await api('POST', `/api/v1/cash-entries/${v.body.reversal.id}/void`, w.users.finance, { reason: 'balik' })).body.title).toBe('Jurnal balik tidak dapat di-void.')
    expect((await api('PATCH', `/api/v1/cash-entries/${km.id}`, w.users.finance, { description: 'x', reason: 'coba' })).status).toBe(409)
  })

  it('book read model (view): void row + linked reversal on one page, filters akun/periode/project/arah/status, flows per akun', async () => {
    const page = await asUser(w.users.finance, (req) => cashBookPage(req, parseBookQuery({ akun: String(w.cashAccount) })))
    const orig = page.rows.find((r) => r.id === km.id)!
    expect(orig).toMatchObject({ status: 'void', voidReason: 'setoran batal' })
    expect(orig.reversedBy?.entryNo).toMatch(/^KK\//)
    const rev = page.rows.find((r) => r.id === orig.reversedBy!.id)!
    expect(rev).toMatchObject({ sourceType: 'reversal', reversalOf: { id: km.id, entryNo: km.entryNo } })
    expect(page.rows.every((r) => r.cashAccountId === w.cashAccount)).toBe(true)
    const byProject = await asUser(w.users.finance, (req) => cashBookPage(req, parseBookQuery({ project: String(w.project), periode: today.slice(0, 7) })))
    expect(byProject.rows.map((r) => r.id)).toEqual(expect.arrayContaining([km.id, kk.id]))
    expect(byProject.rows.every((r) => r.projectId === w.project)).toBe(true)
    const voids = await asUser(w.users.finance, (req) => cashBookPage(req, parseBookQuery({ akun: String(w.cashAccount), status: 'void', arah: 'masuk' })))
    expect(voids.rows.map((r) => r.id)).toEqual([km.id])
    // invalid filter values are dropped (server-side Zod), never passed to the query
    expect(parseBookQuery({ akun: '1 OR 1=1', periode: '2026-13', hal: '-4', arah: 'x' })).toEqual({ hal: 1 })
    const flows = await asUser(w.users.finance, (req) => accountFlows(req, today.slice(0, 7)))
    const mine = flows.get(w.cashAccount)!
    const sql = await sqlAs('app', "SELECT coalesce(sum(amount) FILTER (WHERE direction='in'),0)::bigint AS i, coalesce(sum(amount) FILTER (WHERE direction='out'),0)::bigint AS o FROM cash_entries WHERE cash_account_id=$1 AND period=$2", [w.cashAccount, today.slice(0, 7)])
    expect([mine.tin, mine.tout]).toEqual([Number(sql.rows[0].i), Number(sql.rows[0].o)])
    // API list filter by project (parity with the view)
    const list = await must(api('GET', `/api/v1/cash-entries?projectId=${w.project}&limit=100`, w.users.finance))
    expect(list.items.every((x: { projectId: number }) => x.projectId === w.project)).toBe(true)
  })
})

describe('E2 void transfer (T8) — state rollback + KK reversal', () => {
  it('Uang Muka: void → request back to approved, KK void + reversal, transferredTotal 0, listed/unlisted in the voidable list', async () => {
    const d = await must(api('POST', E, w.users.staffA, draftBody(w)), 201)
    await must(api('POST', `${E}/${d.id}/submit`, w.users.staffA, {}))
    await driveApproved(d.id)
    const before = await balanceOf()
    const t = await must(api('POST', `${E}/${d.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'E2-UM-1', proofMediaId: await transferProof() }, idem()), 201)
    expect(await balanceOf()).toBe(before - 750_000)
    const listed = await asUser(w.users.finance, (req) => voidableTransfers(req))
    expect(listed.find((x) => x.transferId === t.transferId)).toMatchObject({ requestId: d.id, requestType: 'advance', amount: 750_000 })
    expect((await api('POST', `${E}/${d.id}/transfers/${t.transferId}/void`, w.users.staffA, { reason: 'coba' })).status).toBe(403)
    expect((await api('POST', `${E}/${d.id}/transfers/${t.transferId}/void`, w.users.owner, { reason: 'coba' })).status).toBe(403)
    expect((await api('POST', `${E}/${d.id}/transfers/${t.transferId}/void`, w.users.finance, {})).status).toBe(400)
    const v = await api('POST', `${E}/${d.id}/transfers/${t.transferId}/void`, w.users.finance, { reason: 'salah rekening sumber' }, idem())
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(v.body).toMatchObject({ status: 'approved', transferredTotal: 0 })
    const rows = await sqlAs('app', 'SELECT id, direction, source_type, status, reversal_of_id, void_reason FROM cash_entries WHERE expense_request_id = $1 ORDER BY id', [d.id])
    expect(rows.rows).toEqual([
      expect.objectContaining({ id: t.cashEntryId, direction: 'out', source_type: 'transfer', status: 'void', void_reason: 'salah rekening sumber' }),
      expect.objectContaining({ direction: 'in', source_type: 'reversal', status: 'posted', reversal_of_id: t.cashEntryId }),
    ])
    expect(await balanceOf()).toBe(before)
    const tr = await sqlAs('app', 'SELECT status, void_reason FROM transfers WHERE id = $1', [t.transferId])
    expect(tr.rows[0]).toEqual({ status: 'void', void_reason: 'salah rekening sumber' })
    expect((await asUser(w.users.finance, (req) => voidableTransfers(req))).some((x) => x.transferId === t.transferId)).toBe(false)
    const audit = await auditRows('expense_request', d.id)
    expect(audit.find((x) => x.field === 'status' && x.reason === 'salah rekening sumber')).toBeTruthy()
  })

  it('Reimburse: void → request back to receipts_verified (Nota Terverifikasi), KK reversed', async () => {
    const c = await must(api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' })), 201)
    for (const l of c.lines as Array<{ id: string; total: number }>) {
      resetRateLimits()
      const img = (await must(upload('/api/v1/media/receipts', w.users.staffA, await png()), 201)).id
      await must(api('POST', `${E}/${c.id}/receipts`, w.users.staffA, { lineId: l.id, receiptNo: `E2-${l.id.slice(0, 4)}`, vendorName: 'Toko Fiktif', receiptDate: today, amount: l.total, imageId: img }), 201)
    }
    await must(api('POST', `${E}/${c.id}/submit`, w.users.staffA, {}))
    await driveApproved(c.id)
    const d = await must(api('GET', `${E}/${c.id}`, w.users.finance))
    for (const r of d.receipts.filter((x: { status: string }) => x.status === 'pending')) await must(api('POST', `${E}/${c.id}/receipts/${r.id}/verify`, w.users.finance, {}))
    for (const f of d.flags.filter((x: { status: string; level: string }) => x.status === 'open' && x.level === 'warning')) await must(api('POST', `${E}/${c.id}/flags/${f.id}/review`, w.users.finance, {}))
    await must(api('POST', `${E}/${c.id}/verify-receipts`, w.users.finance, {}))
    const t = await must(api('POST', `${E}/${c.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'E2-RB-1', proofMediaId: await transferProof() }), 201)
    const before = await balanceOf()
    const v = await must(api('POST', `${E}/${c.id}/transfers/${t.transferId}/void`, w.users.finance, { reason: 'transfer ganda' }, idem()))
    expect(v).toMatchObject({ status: 'receipts_verified', transferredTotal: 0 })
    expect(v.allowedActions).toContain('transfer')
    expect(await balanceOf()).toBe(before + t.request.transferredTotal)
    const kk = await sqlAs('app', 'SELECT status FROM cash_entries WHERE id = $1', [t.cashEntryId])
    expect(kk.rows[0].status).toBe('void')
    // the KK of a transfer cannot be voided directly (only through the transfer)
    const again = await must(api('POST', `${E}/${c.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'E2-RB-2', proofMediaId: await transferProof() }), 201)
    const direct = await api('POST', `/api/v1/cash-entries/${again.cashEntryId}/void`, w.users.finance, { reason: 'langsung' })
    expect(direct.status).toBe(409)
    expect(direct.body.title).toBe('Kas keluar dari transfer di-void lewat pembatalan transfer.')
  })
})

describe('E2 tutup buku: closed period rejects postings (Indonesian message); re-open = Direktur only', () => {
  let inPrev: { id: number; entryNo: string }

  it('setup: an entry dated in an old month (period still open)', async () => {
    // periods closed by other files that are later than ours are re-opened (latest first, Direktur)
    // and closed again in afterAll, so this file sees — and leaves — the lock state it found.
    for (;;) {
      const lock = await must(api('GET', '/api/v1/period-closings', w.users.finance))
      const latest = (lock.items as Array<{ period: string; status: string }>).filter((p) => p.status === 'closed').map((p) => p.period).sort().at(-1)
      if (!latest || latest < prev) break
      await must(api('POST', `/api/v1/period-closings/${latest}/reopen`, w.users.owner, { reason: 'uji E2 dibuka sementara' }))
      restoreClosed.push(latest)
    }
    inPrev = await must(api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', entryDate: `${prev}-15`, cashAccountId: w.cashAccount, amount: 100_000, description: 'Pendapatan lain (fiktif)', cashInSourceId: w.cashInSource }), 201)
    expect(inPrev.entryNo).toMatch(new RegExp(`^KM/${prev.slice(2, 4)}${prev.slice(5, 7)}/\\d{4}$`))
  })

  it('PM/Staff/Admin cannot close (403); Finance closes (201, audit period_close); current month cannot be closed', async () => {
    for (const u of [w.users.pm, w.users.staffA, w.users.admin]) expect((await api('POST', '/api/v1/period-closings', u, { period: prev })).status).toBe(403)
    const cur = await api('POST', '/api/v1/period-closings', w.users.finance, { period: today.slice(0, 7) })
    expect(cur.body.title).toBe('Hanya bulan yang sudah lewat yang dapat ditutup.')
    const c = await api('POST', '/api/v1/period-closings', w.users.finance, { period: prev, note: 'tutup uji E2' }, idem())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const periods = await must(api('GET', '/api/v1/period-closings', w.users.finance))
    expect(periods.lockDate).toBe(periodEnd(prev))
    const a = await sqlAs('app', "SELECT action, reason FROM audit_logs WHERE doc_type = 'period_closing' AND doc_no = $1 ORDER BY id DESC LIMIT 1", [prev])
    expect(a.rows[0]).toEqual({ action: 'period_close', reason: 'tutup uji E2' })
  })

  it('posting / editing in the closed period is rejected with an Indonesian message; void → reversal dated today', async () => {
    const r = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', entryDate: `${prev}-20`, cashAccountId: w.cashAccount, amount: 5, description: 'telat', cashInSourceId: w.cashInSource })
    expect(r.status).toBe(409)
    expect(r.body.title).toBe(`Periode ${prev} sudah ditutup (tutup buku s/d ${periodEnd(prev)}).`)
    const e = await api('PATCH', `/api/v1/cash-entries/${inPrev.id}`, w.users.finance, { description: 'ubah', reason: 'koreksi' })
    expect(e.status).toBe(409)
    expect(e.body.title).toBe('Periode transaksi sudah ditutup.')
    const v = await must(api('POST', `/api/v1/cash-entries/${inPrev.id}/void`, w.users.finance, { reason: 'salah periode' }))
    expect(v.original).toMatchObject({ status: 'void', entryDate: `${prev}-15` })
    expect(v.reversal).toMatchObject({ entryDate: today, direction: 'out', reversalOfId: inPrev.id })
    const sums = await asUser(w.users.finance, (req) => periodSummaries(req, [prev]))
    expect(sums.get(prev)!.voids).toBeGreaterThanOrEqual(1)
  })

  it('re-open: Finance/PM 403, Direktur (pk-owner) without reason 400, with reason 200 (audit period_reopen); postings accepted again', async () => {
    const fin = await api('POST', `/api/v1/period-closings/${prev}/reopen`, w.users.finance, { reason: 'koreksi' })
    expect(fin.status).toBe(403)
    expect((await api('POST', `/api/v1/period-closings/${prev}/reopen`, w.users.pm, { reason: 'koreksi' })).status).toBe(403)
    expect((await api('POST', `/api/v1/period-closings/${prev}/reopen`, w.users.owner, {})).status).toBe(400)
    const r = await api('POST', `/api/v1/period-closings/${prev}/reopen`, w.users.owner, { reason: 'koreksi auditor E2' }, idem())
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.status).toBe('reopened')
    const a = await sqlAs('app', "SELECT action, reason FROM audit_logs WHERE doc_type = 'period_closing' AND doc_no = $1 ORDER BY id DESC LIMIT 1", [prev])
    expect(a.rows[0]).toEqual({ action: 'period_reopen', reason: 'koreksi auditor E2' })
    await must(api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', entryDate: `${prev}-20`, cashAccountId: w.cashAccount, amount: 5, description: 'susulan', cashInSourceId: w.cashInSource }), 201)
  })
})

describe('E2 per-role negatives (menu hidden: tests/unit/e2-kas.test.ts; here: API + view guard)', () => {
  it('PM / Staff: no read, no write on the cash endpoints (403); Admin reads the list but cannot write', async () => {
    for (const u of [w.users.pm, w.users.staffA]) {
      expect((await api('GET', '/api/v1/cash-entries', u)).status).toBe(403)
      expect((await api('GET', '/api/v1/cash-accounts/balances', u)).status).toBe(403)
      expect((await api('GET', '/api/v1/period-closings', u)).status).toBe(403)
    }
    for (const u of [w.users.pm, w.users.staffA, w.users.admin, w.users.owner]) {
      resetRateLimits()
      expect((await api('POST', '/api/v1/cash-entries', u, { direction: 'in', cashAccountId: w.cashAccount, amount: 1, description: 'x', cashInSourceId: w.cashInSource })).status).toBe(403)
      expect((await api('PATCH', '/api/v1/cash-entries/1', u, { description: 'x', reason: 'abc' })).status).toBe(403)
      expect((await api('POST', '/api/v1/cash-entries/1/void', u, { reason: 'abc' })).status).toBe(403)
    }
    // the collections stay create/update: denyAll even for Finance (UI uses the domain endpoints)
    expect((await api('POST', '/api/cash-entries', w.users.finance, { entryNo: 'KM/X/9', amount: 1 })).status).toBe(403)
    expect((await api('POST', '/api/period-closings', w.users.finance, { period: '2020-01' })).status).toBe(403)
  })

  it('cross-origin POST from a Finance session is rejected (CSRF guard of the cookie session)', async () => {
    const r = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', cashAccountId: w.cashAccount, amount: 1, description: 'x', cashInSourceId: w.cashInSource }, { Origin: 'https://evil.example' })
    expect(r.status).toBe(401)
  })

  it('view guard (kasAccess, used by every Kas view): PM / Staff / Admin / PM+Staff no page; Direktur reads + re-opens; Finance writes', async () => {
    const pmStaff = await makeFlowUser(['pk-pm', 'pk-staff'], 'KAS-pmstaff', null, { signature: false })
    for (const u of [w.users.pm, w.users.staffA, w.users.admin, pmStaff]) expect(kasAccess(u)).toEqual({ view: false, write: false, close: false, reopen: false })
    expect(kasAccess(w.users.owner)).toEqual({ view: true, write: false, close: true, reopen: true })
    expect(kasAccess(w.users.finance)).toEqual({ view: true, write: true, close: true, reopen: false })
  })
})
