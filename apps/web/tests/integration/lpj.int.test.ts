import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { autoCloseReimburse } from '@/domain/expense/auto-close'
import { addDays } from '@/domain/expense/types'

import { auditRows, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, draftBody, makeWorld, png, upload, type FlowUser, type World } from './flow-world'

/**
 * F2b T5 LPJ & settlement (US-08, US-21, US-22; architecture §5.1/§5.3; ADR 0005 §3) through
 * /api/v1: surplus → KM "Pengembalian LPJ", shortfall → T3 transfer + KK, exact → Selesai,
 * revision loop, authz negatives, DB guards, §8 audit coverage, in-app notifications,
 * Reimburse auto-close job.
 */
let w: World
const E = '/api/v1/expense-requests'

beforeAll(async () => {
  w = await makeWorld('LP')
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function proof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

/** Uang Muka 750.000 (lines 600.000 + 150.000) → approved → transferred. */
async function transferredAdvance() {
  const c = await api('POST', E, w.users.staffA, draftBody(w))
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const id = c.body.id as number
  expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
  expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})).status).toBe(200)
  expect((await api('POST', `${E}/${id}/approve`, w.users.finance, {})).status).toBe(200)
  const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `TRF-${id}`, proofMediaId: await proof() })
  expect(t.status, JSON.stringify(t.body)).toBe(201)
  return { id, lineIds: c.body.lines.map((l: { id: string }) => l.id) as string[] }
}

async function addReceipt(id: number, lineId: string, amount: number, user: FlowUser = w.users.staffA, receiptNo?: string) {
  const img = await upload('/api/v1/media/receipts', user, await png())
  expect(img.status).toBe(201)
  const r = await api('POST', `${E}/${id}/receipts`, user, {
    lineId,
    receiptNo: receiptNo ?? `N-${id}-${amount}-${Math.random().toString(36).slice(2, 7)}`,
    vendorName: 'Toko Bangunan Maju',
    receiptDate: addDays(new Date().toISOString().slice(0, 10), -1),
    amount,
    imageId: img.body.id,
  })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body
}

async function verifyAll(id: number) {
  const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
  for (const r of d.receipts.filter((x: { status: string }) => x.status === 'pending')) {
    const v = await api('POST', `${E}/${id}/receipts/${r.id}/verify`, w.users.finance, {})
    expect(v.status, JSON.stringify(v.body)).toBe(200)
  }
}

async function lpjReady(amounts: number[]) {
  const { id, lineIds } = await transferredAdvance()
  for (const [i, a] of amounts.entries()) await addReceipt(id, lineIds[i % lineIds.length]!, a)
  const rc = await api('POST', `${E}/${id}/receipts-complete`, w.users.staffA, {})
  expect(rc.status, JSON.stringify(rc.body)).toBe(200)
  expect(rc.body).toMatchObject({ status: 'receipts_complete', statusLabel: 'Nota Lengkap', settlement: { status: 'draft', transferredTotal: 750_000 } })
  const s = await api('POST', `${E}/${id}/lpj/submit`, w.users.staffA, { usageNotes: 'Dana dipakai untuk material dan konsumsi tukang.' })
  expect(s.status, JSON.stringify(s.body)).toBe(200)
  return { id, lineIds, submitted: s.body }
}

describe('LPJ & settlement — surplus → KM "Pengembalian LPJ"', () => {
  let id: number
  it('submit: LPJ number, receipts total, provisional difference; Finance notified', async () => {
    const r = await lpjReady([600_000, 100_000])
    id = r.id
    expect(r.submitted).toMatchObject({
      status: 'lpj_submitted',
      statusLabel: 'LPJ Diajukan',
      settlement: { status: 'submitted', receiptsTotal: 700_000, transferredTotal: 750_000, difference: 50_000, submitCount: 1 },
    })
    expect(r.submitted.settlement.docNo).toMatch(/^LPJ\/\d{4}\/\d{4}$/)
    const n = await api('GET', '/api/v1/notifications?unread=true', w.users.finance)
    expect(n.status).toBe(200)
    expect(n.body.items.map((x: { event: string; docId: string }) => [x.event, x.docId])).toContainEqual(['expense.lpj_submitted', String(id)])
  })

  it('verify: pending receipts block (409); after receipt verification → LPJ Terverifikasi (refund 50.000)', async () => {
    expect((await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})).status).toBe(409)
    await verifyAll(id)
    const v = await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(v.body).toMatchObject({ status: 'lpj_verified', verifiedReceiptsTotal: 700_000, settlement: { status: 'verified', verifiedReceiptsTotal: 700_000, difference: 50_000, settlementType: 'refund' } })
    expect(v.body.allowedActions).toContain('settle')
  })

  it('settle: amount echo must match; KM 50.000 "Pengembalian LPJ" posted; Selesai', async () => {
    expect((await api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount, amount: 49_000 })).status).toBe(409)
    const s = await api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount, amount: 50_000 })
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body).toMatchObject({ settlementType: 'refund', amount: 50_000, shortfallTransferId: null, request: { status: 'completed', statusLabel: 'Selesai', settlement: { status: 'settled' } } })
    expect(s.body.refundCashEntryNo).toMatch(/^KM\/\d{4}\/\d{4}$/)
    const km = await sqlAs('app', `SELECT e.direction, e.amount::int, e.source_type, e.expense_request_id, s.code FROM cash_entries e JOIN cash_in_sources s ON s.id = e.cash_in_source_id WHERE e.id = $1`, [s.body.refundCashEntryId])
    expect(km.rows[0]).toEqual({ direction: 'in', amount: 50_000, source_type: 'settlement_refund', expense_request_id: id, code: 'LPJ' })
    // no second settlement; void of the refund entry alone is refused
    expect((await api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount })).status).toBe(409)
    expect((await api('POST', `/api/v1/cash-entries/${s.body.refundCashEntryId}/void`, w.users.finance, { reason: 'salah akun' })).status).toBe(409)
  })

  it('§8 T5 audit: settlement status_change rows draft → submitted → verified → settled; request status rows', async () => {
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    const rows = await auditRows('settlement', d.settlement.id)
    const statuses = rows.filter((r) => r.action === 'status_change').map((r) => [r.old_value?.v, r.new_value?.v])
    expect(statuses).toEqual([
      [undefined, 'draft'], // created with "Nota Lengkap"
      ['draft', 'submitted'],
      ['submitted', 'verified'],
      ['verified', 'settled'],
    ])
    expect(rows.find((r) => r.action === 'create' && r.field === 'request')).toBeTruthy()
    const req = (await auditRows('expense_request', id)).filter((r) => r.action === 'status_change').map((r) => r.new_value?.v)
    expect(req).toEqual(expect.arrayContaining(['transferred', 'receipts_complete', 'lpj_submitted', 'lpj_verified', 'completed']))
  })

  it('history (US-35) includes the LPJ and receipts with user names and source', async () => {
    const h = await api('GET', `${E}/${id}/history`, w.users.staffA)
    expect(h.status).toBe(200)
    const types = new Set(h.body.items.map((x: { docType: string }) => x.docType))
    expect([...types]).toEqual(expect.arrayContaining(['expense_request', 'receipt', 'transfer', 'settlement']))
    expect(types.has('cash_entry')).toBe(false) // ledger rows only for Finance/Owner/Admin
    const fin = await api('GET', `${E}/${id}/history`, w.users.finance)
    expect(new Set(fin.body.items.map((x: { docType: string }) => x.docType)).has('cash_entry')).toBe(true)
    const settled = h.body.items.find((x: { docType: string; action: string; newValue: unknown }) => x.docType === 'settlement' && x.newValue === 'settled')
    expect(settled).toMatchObject({ userName: `${'LP'}-finance`, source: 'web' })
  })
})

describe('LPJ & settlement — shortfall → transfer + KK', () => {
  it('difference −50.000: bank ref + proof required; lpj_shortfall transfer + KK; transferred total 800.000', async () => {
    const { id } = await lpjReady([600_000, 200_000])
    await verifyAll(id)
    const v = await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})
    expect(v.body.settlement).toMatchObject({ difference: -50_000, settlementType: 'shortfall' })
    expect((await api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount })).status).toBe(400)
    const s = await api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'MDR-LPJ-1', proofMediaId: await proof() })
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body).toMatchObject({ settlementType: 'shortfall', amount: 50_000, refundCashEntryId: null, request: { status: 'completed', transferredTotal: 800_000 } })
    const t = await sqlAs('app', 'SELECT t.kind, t.amount::int, t.status, e.direction, e.amount::int AS kk FROM transfers t JOIN cash_entries e ON e.id = t.cash_entry_id WHERE t.id = $1', [s.body.shortfallTransferId])
    expect(t.rows[0]).toEqual({ kind: 'lpj_shortfall', amount: 50_000, status: 'posted', direction: 'out', kk: 50_000 })
    const tr = s.body.request.transfers.map((x: { kind: string; amount: number }) => [x.kind, x.amount])
    expect(tr).toEqual([
      ['advance', 750_000],
      ['lpj_shortfall', 50_000],
    ])
    // the shortfall transfer cannot be voided through the transfer endpoint once Selesai
    expect((await api('POST', `${E}/${id}/transfers/${s.body.shortfallTransferId}/void`, w.users.finance, { reason: 'uji void' })).status).toBe(409)
  })
})

describe('LPJ & settlement — exact', () => {
  it('difference 0 → verified and settled at once (Selesai), no cash posting', async () => {
    const { id } = await lpjReady([600_000, 150_000])
    await verifyAll(id)
    const before = await sqlAs('app', 'SELECT count(*)::int AS n FROM cash_entries WHERE expense_request_id = $1', [id])
    const v = await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(v.body).toMatchObject({ status: 'completed', settlement: { status: 'settled', settlementType: 'none', difference: 0 } })
    const after = await sqlAs('app', 'SELECT count(*)::int AS n FROM cash_entries WHERE expense_request_id = $1', [id])
    expect(after.rows[0].n).toBe(before.rows[0].n)
    const n = await api('GET', '/api/v1/notifications', w.users.staffA)
    expect(n.body.items.map((x: { event: string; docId: string }) => [x.event, x.docId])).toContainEqual(['expense.completed', String(id)])
  })
})

describe('LPJ revision loop (US-08, US-21)', () => {
  let id: number
  let lineIds: string[]
  it('Finance requests revision: note required (G7); requester sees the note, fixes receipts and resubmits', async () => {
    const r = await lpjReady([600_000, 100_000])
    id = r.id
    lineIds = r.lineIds
    expect((await api('POST', `${E}/${id}/lpj/request-revision`, w.users.finance, {})).status).toBe(400)
    expect((await api('POST', `${E}/${id}/lpj/request-revision`, w.users.staffA, { note: 'tolong lengkapi' })).status).toBe(403)
    const rev = await api('POST', `${E}/${id}/lpj/request-revision`, w.users.finance, { note: 'Nota makan belum ada, lengkapi.' })
    expect(rev.status, JSON.stringify(rev.body)).toBe(200)
    expect(rev.body).toMatchObject({ status: 'lpj_revision', settlement: { status: 'revision', financeNotes: 'Nota makan belum ada, lengkapi.' } })
    const mine = await api('GET', '/api/v1/notifications?unread=true', w.users.staffA)
    const note = mine.body.items.find((x: { event: string; docId: string }) => x.event === 'expense.lpj_revision' && x.docId === String(id))
    expect(note).toBeTruthy()
    // finance cannot verify during revision; requester adds the missing receipt and resubmits
    expect((await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})).status).toBe(409)
    await addReceipt(id, lineIds[1]!, 50_000)
    const again = await api('POST', `${E}/${id}/lpj/submit`, w.users.staffA, {})
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect(again.body.settlement).toMatchObject({ status: 'submitted', submitCount: 2, receiptsTotal: 750_000, usageNotes: 'Dana dipakai untuk material dan konsumsi tukang.' })
    const rows = await auditRows('settlement', again.body.settlement.id)
    expect(rows.find((x) => x.action === 'update' && x.field === 'financeNotes')?.reason).toBe('Nota makan belum ada, lengkapi.')
  })

  it('a receipt rejected during review is excluded from the verified total (stays LPJ Diajukan)', async () => {
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    const small = d.receipts.find((x: { amount: number }) => x.amount === 50_000)
    const rj = await api('POST', `${E}/${id}/receipts/${small.id}/reject`, w.users.finance, { reason: 'nota buram' })
    expect(rj.status, JSON.stringify(rj.body)).toBe(200)
    expect(rj.body.status).toBe('lpj_submitted')
    await verifyAll(id)
    const v = await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})
    expect(v.body.settlement).toMatchObject({ verifiedReceiptsTotal: 700_000, difference: 50_000, settlementType: 'refund' })
  })
})

describe('authz negatives and DB guards (T5)', () => {
  it('state/role guards: LPJ on Reimburse → 409; staff cannot verify/settle; other PM → 404; LPJ before receipts → 409', async () => {
    const { id } = await transferredAdvance()
    expect((await api('POST', `${E}/${id}/receipts-complete`, w.users.staffA, {})).status).toBe(409) // no receipt yet
    expect((await api('POST', `${E}/${id}/lpj/submit`, w.users.staffA, { usageNotes: 'abc def' })).status).toBe(409) // not "Nota Lengkap"
    expect((await api('POST', `${E}/${id}/receipts-complete`, w.users.otherPm, {})).status).toBe(404)
    const reimb = await api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }))
    expect((await api('POST', `${E}/${reimb.body.id}/receipts-complete`, w.users.staffA, {})).status).toBe(409)
    const { id: id2 } = await lpjReady([600_000])
    expect((await api('POST', `${E}/${id2}/lpj/verify`, w.users.staffA, {})).status).toBe(403)
    expect((await api('POST', `${E}/${id2}/lpj/verify`, w.users.owner, {})).status).toBe(403)
    expect((await api('POST', `${E}/${id2}/settle`, w.users.owner, { cashAccountId: w.cashAccount })).status).toBe(403) // roles: Finance only
    expect((await api('POST', `${E}/${id2}/lpj/verify`, w.users.otherPm, {})).status).toBe(404)
    expect((await api('POST', `${E}/${id2}/lpj/submit`, w.users.finance, {})).status).toBe(403) // E9: Finance never submits an LPJ (403 before the 409 state check)
    expect((await api('POST', `${E}/${id2}/receipts-complete`, w.users.staffB, {})).status).toBe(404) // not own, not visible
  })

  it('DB: settled LPJ immutable; refund/shortfall amounts cross-checked; LPJ only for Uang Muka (raw SQL as app role)', async () => {
    const { id } = await lpjReady([600_000])
    await verifyAll(id)
    await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {}) // refund 150.000 pending
    const s = (await sqlAs('app', 'SELECT id FROM settlements WHERE request_id = $1', [id])).rows[0].id
    const refundWrong = await sqlError(
      'app',
      `INSERT INTO cash_entries (entry_no, entry_date, direction, amount, cash_account_id, source_type, expense_request_id, status, uuid)
       VALUES ('KM/TEST/0001', to_char(now(), 'YYYY-MM-DD'), 'in', 1000, $1, 'settlement_refund', $2, 'posted', gen_random_uuid()::text)`,
      [w.cashAccount, id],
    )
    expect(refundWrong?.code).toBe('42501')
    const shortfall = await sqlError(
      'app',
      `INSERT INTO transfers (doc_no, request_id, kind, cash_account_id, amount, bank_ref, proof_id, transfer_date, status, uuid)
       VALUES ('TRF/TEST/0001', $1, 'lpj_shortfall', $2, 1000, 'x', 1, to_char(now(), 'YYYY-MM-DD'), 'posted', gen_random_uuid()::text)`,
      [id, w.cashAccount],
    )
    expect(shortfall?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE settlements SET difference = 1 WHERE id = $1`, [s]))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE settlements SET status = 'settled' WHERE id = $1`, [s]))?.code).toMatch(/42501|23514/)
    expect((await sqlError('app', `DELETE FROM settlements WHERE id = $1`, [s]))?.code).toBe('42501')
    const done = await api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount })
    expect(done.status, JSON.stringify(done.body)).toBe(200)
    expect((await sqlError('app', `UPDATE settlements SET usage_notes = 'x' WHERE id = $1`, [s]))?.code).toBe('42501')
    const reimb = await api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }))
    expect((await sqlError('app', `INSERT INTO settlements (request_id, status, uuid) VALUES ($1, 'draft', gen_random_uuid()::text)`, [reimb.body.id]))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE expense_requests SET verified_receipts_total = 1 WHERE id = $1`, [id]))?.code).toBe('42501')
  })
})

describe('notifications API', () => {
  it('own rows only; mark read (idempotent); read-all; other user → 404', async () => {
    const list = await api('GET', '/api/v1/notifications', w.users.staffA)
    expect(list.status).toBe(200)
    expect(list.body.items.length).toBeGreaterThan(0)
    expect(list.body.unreadCount).toBeGreaterThan(0)
    const first = list.body.items[0]
    expect(first).toMatchObject({ uuid: expect.any(String), title: expect.any(String), readAt: null })
    expect((await api('GET', `/api/v1/notifications/${first.id}`, w.users.staffB)).status).toBe(404)
    expect((await api('POST', `/api/v1/notifications/${first.id}/read`, w.users.staffB, {})).status).toBe(404)
    expect((await api('GET', `/api/v1/notifications/${first.uuid}`, w.users.staffA)).body.id).toBe(first.id)
    const r1 = await api('POST', `/api/v1/notifications/${first.id}/read`, w.users.staffA, {})
    expect(r1.status).toBe(200)
    expect(r1.body.readAt).toEqual(expect.any(String))
    const r2 = await api('POST', `/api/v1/notifications/${first.uuid}/read`, w.users.staffA, {})
    expect(r2.body.readAt).toBe(r1.body.readAt)
    const all = await api('POST', '/api/v1/notifications/read-all', w.users.staffA, {})
    expect(all.status).toBe(200)
    expect((await api('GET', '/api/v1/notifications?unread=true', w.users.staffA)).body).toMatchObject({ items: [], unreadCount: 0 })
    // DB: a read notification stays read; identity immutable; no DELETE
    expect((await sqlError('app', 'UPDATE notifications SET read_at = NULL WHERE id = $1', [first.id]))?.code).toBe('42501')
    expect((await sqlError('app', "UPDATE notifications SET title = 'x' WHERE id = $1", [first.id]))?.code).toBe('42501')
    expect((await sqlError('app', 'DELETE FROM notifications WHERE id = $1', [first.id]))?.code).toBe('42501')
    expect((await api('GET', '/api/v1/notifications', null)).status).toBe(401)
  })

  it('approval step: approvers are notified, requesters/creator never asked to decide (G1)', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    await api('POST', `${E}/${c.body.id}/submit`, w.users.staffA, {})
    // ADR 0013: "Diketahui" = Direktur approval → the Direktur are asked, the PM (monitors only) is not
    const pm = await api('GET', '/api/v1/notifications?unread=true', w.users.pm)
    expect(pm.body.items.map((x: { event: string; docId: string }) => [x.event, x.docId])).not.toContainEqual(['expense.pending_ack', String(c.body.id)])
    const dir = await api('GET', '/api/v1/notifications?unread=true', w.users.owner2)
    expect(dir.body.items.map((x: { event: string; docId: string }) => [x.event, x.docId])).toContainEqual(['expense.pending_ack', String(c.body.id)])
    await api('POST', `${E}/${c.body.id}/acknowledge`, w.users.owner, {})
    for (const approver of [w.users.finance, w.users.finance2]) {
      const n = await api('GET', '/api/v1/notifications?unread=true', approver)
      expect(n.body.items.map((x: { event: string; docId: string }) => [x.event, x.docId])).toContainEqual(['expense.pending_approval', String(c.body.id)])
    }
    const own = await api('GET', '/api/v1/notifications', w.users.staffA)
    expect(own.body.items.filter((x: { event: string; docId: string }) => x.docId === String(c.body.id) && x.event.startsWith('expense.pending'))).toEqual([])
  })
})

describe('Reimburse auto-close job (architecture §5.2, setting reimburseAutoCloseDays)', () => {
  it('closes "Ditransfer" reimburse requests N days after the transfer; idempotent; audit source job', async () => {
    const p = await getTestPayload()
    const before = await p.findGlobal({ slug: 'company-settings', overrideAccess: true /* SYSTEM-READ: test */ })
    // reimburse → approved → receipts verified → transferred yesterday
    const c = await api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse', lines: [{ description: 'Makan', total: 150_000, categoryId: w.cat.ksm }] }))
    const id = c.body.id as number
    await addReceipt(id, c.body.lines[0].id, 150_000)
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
    await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})
    await api('POST', `${E}/${id}/approve`, w.users.finance, {})
    await verifyAll(id)
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    for (const f of d.flags.filter((x: { level: string; status: string }) => x.level === 'warning' && x.status === 'open')) await api('POST', `${E}/${id}/flags/${f.id}/review`, w.users.finance, {})
    expect((await api('POST', `${E}/${id}/verify-receipts`, w.users.finance, {})).status).toBe(200)
    const today = (await sqlAs('app', "SELECT to_char(now() AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD') AS d")).rows[0].d as string
    const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'RB-1', proofMediaId: await proof(), transferDate: addDays(today, -1) })
    expect(t.status, JSON.stringify(t.body)).toBe(201)

    await p.updateGlobal({ slug: 'company-settings', data: { reimburseAutoCloseDays: 2 }, overrideAccess: true /* SYSTEM-WRITE: test */ })
    expect(await autoCloseReimburse(p)).not.toContain(id) // 1 day < 2 days
    await p.updateGlobal({ slug: 'company-settings', data: { reimburseAutoCloseDays: 1 }, overrideAccess: true /* SYSTEM-WRITE: test */ })
    expect(await autoCloseReimburse(p)).toContain(id)
    expect(await autoCloseReimburse(p)).not.toContain(id) // idempotent
    await p.updateGlobal({ slug: 'company-settings', data: { reimburseAutoCloseDays: before.reimburseAutoCloseDays ?? 30 }, overrideAccess: true /* SYSTEM-WRITE: test */ })
    const rows = (await auditRows('expense_request', id)).filter((r) => r.action === 'status_change' && r.new_value?.v === 'completed')
    expect(rows).toEqual([expect.objectContaining({ source: 'job', user_id: null, reason: expect.stringContaining('otomatis selesai 1 hari') })])
  })
})
