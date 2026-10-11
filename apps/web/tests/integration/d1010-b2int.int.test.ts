import { beforeAll, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { api, draftBody, makeWorld, png, upload, type World } from './flow-world'
import { sqlAs } from './helpers'

/**
 * DRMS 10/10 B-2 integration: a request locked BEFORE D3 (unit price informational — not reproducing the
 * total, or none) is sent back to an editable status ("Revisi Nota"). The DB rule total = qty × unit price
 * (20261012_300100_d1010_lines_guard) must not block the requester: on unlock the line gets total ÷ qty when
 * exact, else no unit price ("Lengkapi Qty & Harga satuan"); saving other fields works, (re)submit is refused
 * until the line is completed. Fictional data.
 */
const E = '/api/v1/expense-requests'
let w: World

beforeAll(async () => {
  w = await makeWorld(`bi${Date.now() % 100000}`)
})

async function receiptImage(): Promise<number> {
  const r = await upload('/api/v1/media/receipts', w.users.staffA, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

const receipt = async (lineId: string, amount: number, no: string) =>
  api('POST', `${E}/${id}/receipts`, w.users.staffA, { lineId, receiptNo: no, vendorName: 'TB Sinar', receiptDate: '2026-09-20', amount, imageId: await receiptImage() })

/**
 * Turns the lines of a LOCKED request into pre-D3 rows (as the owner, triggers off for this one statement
 * batch, content hash re-frozen): line 1 unit price 59.999 × 10 ≠ 600.000 (exact 60.000 exists), line 2
 * qty 7 × 21.429 ≠ 150.000 (no exact unit price).
 */
async function makeLegacy(rid: number) {
  await sqlAs(
    'owner',
    `BEGIN;
     ALTER TABLE expense_requests_lines DISABLE TRIGGER USER;
     ALTER TABLE expense_requests DISABLE TRIGGER USER;
     UPDATE expense_requests_lines SET unit_price = 59999 WHERE _parent_id = ${rid} AND _order = 1;
     UPDATE expense_requests_lines SET qty = 7, uom_id = ${w.uom.l}, unit_price = 21429 WHERE _parent_id = ${rid} AND _order = 2;
     UPDATE expense_requests SET content_hash = pk_expense_content_hash(id) WHERE id = ${rid};
     ALTER TABLE expense_requests ENABLE TRIGGER USER;
     ALTER TABLE expense_requests_lines ENABLE TRIGGER USER;
     COMMIT;`,
  )
}

let id = 0
type Line = { id: string; description: string; qty: number | null; uom: { id: number } | null; unitPrice: number | null; total: number; category: { id: number } }
const body = (lines: Line[]) => lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty, uomId: l.uom?.id ?? null, unitPrice: l.unitPrice, total: l.total, categoryId: l.category.id }))

describe('D3 legacy line on a request sent back to Revisi Nota', () => {
  it('approved Reimburse with pre-D3 lines → Finance rejects a receipt → Revisi Nota (not blocked by the DB rule)', async () => {
    resetRateLimits()
    const c = await api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' })) // DRMS 10/10 D2: a project request
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    id = c.body.id
    expect((await receipt(c.body.lines[0].id, 600_000, 'L-1')).status).toBe(201)
    expect((await receipt(c.body.lines[1].id, 150_000, 'L-2')).status).toBe(201)
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/approve`, w.users.finance, {})).status).toBe(200)
    await makeLegacy(id)
    const before = (await api('GET', `${E}/${id}`, w.users.finance)).body
    expect(before.lines.map((l: Line) => [l.qty, l.unitPrice, l.total])).toEqual([
      [10, 59_999, 600_000],
      [7, 21_429, 150_000],
    ])
    const rj = await api('POST', `${E}/${id}/receipts/${before.receipts[1].id}/reject`, w.users.finance, { reason: 'nota buram' })
    expect(rj.status, JSON.stringify(rj.body)).toBe(200)
    expect(rj.body.status).toBe('receipt_revision')
    // unlock: exact → unit price = total ÷ qty; not exact → no unit price (legacy). Totals unchanged.
    expect(rj.body.lines.map((l: Line) => [l.qty, l.unitPrice, l.total])).toEqual([
      [10, 60_000, 600_000],
      [7, null, 150_000],
    ])
    expect(rj.body.grandTotal).toBe(750_000)
  })

  it('requester edits another field (line 1 description, notes via the admin form) → saved; the legacy line keeps its total', async () => {
    const d = (await api('GET', `${E}/${id}`, w.users.staffA)).body
    const lines = body(d.lines)
    lines[0] = { ...lines[0]!, description: 'Semen 50 kg' }
    const u = await api('PATCH', `${E}/${id}`, w.users.staffA, { lines })
    expect(u.status, JSON.stringify(u.body)).toBe(200)
    expect(u.body.lines.map((l: Line) => [l.description, l.unitPrice, l.total])).toEqual([
      ['Semen 50 kg', 60_000, 600_000],
      ['Makan tukang', null, 150_000],
    ])
    expect(u.body.grandTotal).toBe(750_000)
    // admin form (Payload REST, same collection hook): notes only — Payload re-writes the stored lines
    const f = await api('PATCH', `/api/expense-requests/${id}`, w.users.staffA, { notes: 'nota baru menyusul' })
    expect(f.status, JSON.stringify(f.body)).toBe(200)
    expect(f.body.doc.grandTotal).toBe(750_000)
  })

  it('"Kirim ulang nota" is refused until the legacy line has Qty & Harga satuan; completed → re-approval', async () => {
    expect((await receipt((await api('GET', `${E}/${id}`, w.users.staffA)).body.lines[1].id, 150_000, 'L-2B')).status).toBe(201)
    const blocked = await api('POST', `${E}/${id}/receipts-resubmit`, w.users.staffA, {})
    expect(blocked.status).toBe(400)
    expect(blocked.body.errors).toEqual([expect.objectContaining({ path: 'lines.1.unitPrice' })])
    expect(JSON.stringify(blocked.body)).toMatch(/Lengkapi Qty & Harga satuan pada baris 2/)

    const d = (await api('GET', `${E}/${id}`, w.users.staffA)).body
    const lines = body(d.lines)
    lines[1] = { ...lines[1]!, unitPrice: 21_429 }
    const u = await api('PATCH', `${E}/${id}`, w.users.staffA, { lines })
    expect(u.status, JSON.stringify(u.body)).toBe(200)
    expect(u.body.lines[1]).toMatchObject({ unitPrice: 21_429, total: 150_003 })
    expect(u.body.grandTotal).toBe(750_003)
    const rs = await api('POST', `${E}/${id}/receipts-resubmit`, w.users.staffA, {})
    expect(rs.status, JSON.stringify(rs.body)).toBe(200)
    expect(rs.body).toMatchObject({ status: 'pending_ack', grandTotal: 750_003, approvalCycle: 2 })
  })

  it('the DB still refuses a changed line whose total ≠ qty × unit price while editable', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    expect(c.status).toBe(201)
    const err = await sqlAs('app', `UPDATE expense_requests_lines SET unit_price = unit_price + 1 WHERE _parent_id = ${c.body.id} AND _order = 1`).then(
      () => null,
      (e: { code?: string }) => e,
    )
    expect(err?.code).toBe('23514')
  })
})
