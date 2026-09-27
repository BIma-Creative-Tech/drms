import { randomUUID } from 'node:crypto'

import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ReimburseReceiptReview, loadReimburseReview } from '@/admin/components/ReimburseReceiptReview'
import { addDays } from '@/domain/expense/types'

import { getTestPayload } from './helpers'
import { api, asUser, draftBody, makeWorld, png, upload, type FlowUser, type World } from './flow-world'

// ActionButton (client component) refreshes through the app router; not mounted in SSR tests.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

/**
 * F2d (UAT) — Finance verifies Reimburse receipts in the web panel ("Antrian Transfer" view,
 * section "Verifikasi nota Reimburse"). The section only calls the EXISTING /api/v1 endpoints
 * (cookie session + Idempotency-Key, the ActionButton request shapes), so these tests pin:
 * the server-rendered section (buttons per allowedActions), the happy path Valid → flag
 * diperiksa → Verifikasi semua nota → "Nota Terverifikasi (Antri Transfer)" → transfer, a Tolak
 * with a required reason (→ "Revisi Nota"), and the authz negatives (staff/owner cannot verify).
 */
let w: World
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const yesterday = () => addDays(new Date().toISOString().slice(0, 10), -1)

beforeAll(async () => {
  w = await makeWorld('FD')
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

/** Reimburse (lines 600.000 + 150.000) with one receipt per line, submitted and approved. Line 2 receipt differs by 10.000 → warning flag. */
async function approvedReimburse() {
  const d = await api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }), key())
  expect(d.status, JSON.stringify(d.body)).toBe(201)
  const id = d.body.id as number
  const lines = d.body.lines as Array<{ id: string }>
  for (const [i, amount] of [600_000, 140_000].entries()) {
    const img = await upload('/api/v1/media/receipts', w.users.staffA, await png())
    expect(img.status).toBe(201)
    const r = await api('POST', `${E}/${id}/receipts`, w.users.staffA, { lineId: lines[i]!.id, receiptNo: `FD-${id}-${i}`, vendorName: `Toko FD ${i}`, receiptDate: yesterday(), amount, imageId: img.body.id }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(201)
  }
  expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key())).status).toBe(200)
  expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key())).status).toBe(200)
  const a = await api('POST', `${E}/${id}/approve`, w.users.finance, {}, key())
  expect(a.status, JSON.stringify(a.body)).toBe(200)
  expect(a.body.status).toBe('approved')
  return a.body as { id: number; receipts: Array<{ id: number; status: string }>; flags: Array<{ id: number; kind: string; level: string; status: string }> }
}

async function sectionHtml(user: FlowUser): Promise<string> {
  const data = await asUser(user, (req) => loadReimburseReview(req))
  return renderToString(ReimburseReceiptReview({ data }))
}

describe('F2d Finance receipt verification (Reimburse, Antrian Transfer view)', () => {
  it('section: Finance sees receipts with thumbnails, flags and Valid/Tolak/Tandai flag diperiksa/Verifikasi semua nota; Owner read-only', async () => {
    const r = await approvedReimburse()
    const html = await sectionHtml(w.users.finance)
    const start = html.indexOf(`data-pk-receipt-review="${r.id}"`)
    expect(start).toBeGreaterThan(-1)
    const mine = html.slice(start, html.indexOf('</section>', start))
    expect(mine).toContain('/file?variant=thumb')
    expect(mine).toContain('Rp')
    expect(mine).toContain(yesterday())
    expect(mine).toContain('data-pk-action="receipt-valid"')
    expect(mine).toContain('data-pk-action="receipt-reject"')
    expect(mine).toContain('data-pk-action="flag-review"')
    expect(mine).toContain('data-pk-action="verify-receipts"')
    expect(mine).toContain('Verifikasi semua nota')
    const owner = await sectionHtml(w.users.owner)
    expect(owner).toContain(`data-pk-receipt-review="${r.id}"`)
    expect(owner).not.toContain('data-pk-action=')
    // staff never reaches the section's data: request list is access-scoped, actions absent
    expect(await sectionHtml(w.users.staffA)).not.toContain('data-pk-action=')
  })

  it('happy path: Valid per receipt → flag diperiksa → Verifikasi semua nota → "Nota Terverifikasi (Antri Transfer)" → transfer', async () => {
    const r = await approvedReimburse()
    const warn = r.flags.find((f) => f.status === 'open' && f.level === 'warning')
    expect(warn, JSON.stringify(r.flags)).toBeTruthy()
    // not before every receipt is valid; no transfer while "Disetujui"
    expect((await api('POST', `${E}/${r.id}/verify-receipts`, w.users.finance, {}, key())).status).toBe(409)
    const proof = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
    expect((await api('POST', `${E}/${r.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `FD-${r.id}`, proofMediaId: proof.body.id }, key())).status).toBe(409)
    for (const rc of r.receipts) {
      const v = await api('POST', `${E}/${r.id}/receipts/${rc.id}/verify`, w.users.finance, {}, key())
      expect(v.status, JSON.stringify(v.body)).toBe(200)
    }
    // open warning still blocks
    const blocked = await api('POST', `${E}/${r.id}/verify-receipts`, w.users.finance, {}, key())
    expect(blocked.status).toBe(409)
    expect(JSON.stringify(blocked.body)).toContain('flag')
    // "Tandai flag diperiksa" on every open warning (amount difference, possibly unusual unit)
    const open = r.flags.filter((f) => f.status === 'open' && f.level === 'warning')
    for (const f of open) {
      const rev = await api('POST', `${E}/${r.id}/flags/${f.id}/review`, w.users.finance, { note: 'Sudah dicek, wajar' }, key())
      expect(rev.status, JSON.stringify(rev.body)).toBe(200)
    }
    expect((await api('POST', `${E}/${r.id}/flags/${warn!.id}/review`, w.users.finance, {}, key())).status).toBe(409) // already reviewed
    const k = key()
    const all = await api('POST', `${E}/${r.id}/verify-receipts`, w.users.finance, {}, k)
    expect(all.status, JSON.stringify(all.body)).toBe(200)
    expect(all.body).toMatchObject({ status: 'receipts_verified', statusLabel: 'Nota Terverifikasi (Antri Transfer)' })
    // same Idempotency-Key → replayed, not repeated
    const again = await api('POST', `${E}/${r.id}/verify-receipts`, w.users.finance, {}, k)
    expect(again.status).toBe(200)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    // leaves the review section, enters the transfer queue; transfer now possible
    expect(await sectionHtml(w.users.finance)).not.toContain(`data-pk-receipt-review="${r.id}"`)
    const q = await api('GET', '/api/v1/transfer-queue', w.users.finance)
    expect(q.body.items.map((i: { id: number }) => i.id)).toContain(r.id)
    const t = await api('POST', `${E}/${r.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `FD-${r.id}`, proofMediaId: proof.body.id }, key())
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    expect(t.body.request.status).toBe('transferred')
  })

  it('Tolak: reason required (400); with reason → receipt rejected, request "Revisi Nota", listed as waiting for the requester', async () => {
    const r = await approvedReimburse()
    const rc = r.receipts[0]!
    expect((await api('POST', `${E}/${r.id}/receipts/${rc.id}/reject`, w.users.finance, {}, key())).status).toBe(400)
    expect((await api('POST', `${E}/${r.id}/receipts/${rc.id}/reject`, w.users.finance, { reason: 'x' }, key())).status).toBe(400)
    const rej = await api('POST', `${E}/${r.id}/receipts/${rc.id}/reject`, w.users.finance, { reason: 'Nota buram, foto ulang' }, key())
    expect(rej.status, JSON.stringify(rej.body)).toBe(200)
    expect(rej.body.status).toBe('receipt_revision')
    expect(rej.body.receipts.find((x: { id: number }) => x.id === rc.id).status).toBe('rejected')
    const html = await sectionHtml(w.users.finance)
    expect(html).not.toContain(`data-pk-receipt-review="${r.id}"`)
    expect(html).toContain('Menunggu revisi nota pemohon')
    expect(html).toContain(`/admin/collections/expense-requests/${r.id}`)
  })

  it('authz: staff (requester or not) and Owner cannot verify / reject / review flags / verify all', async () => {
    const r = await approvedReimburse()
    const rc = r.receipts[0]!
    const flag = r.flags.find((f) => f.status === 'open')!
    for (const u of [w.users.staffA, w.users.owner, w.users.pm]) {
      expect((await api('POST', `${E}/${r.id}/receipts/${rc.id}/verify`, u, {}, key())).status, u.email).toBe(403)
      expect((await api('POST', `${E}/${r.id}/receipts/${rc.id}/reject`, u, { reason: 'Tidak sah' }, key())).status, u.email).toBe(403)
      expect((await api('POST', `${E}/${r.id}/flags/${flag.id}/review`, u, {}, key())).status, u.email).toBe(403)
      expect((await api('POST', `${E}/${r.id}/verify-receipts`, u, {}, key())).status, u.email).toBe(403)
    }
    // another staff does not even see the request
    expect((await api('POST', `${E}/${r.id}/receipts/${rc.id}/verify`, w.users.staffB, {}, key())).status).toBe(404)
    const d = await api('GET', `${E}/${r.id}`, w.users.finance)
    expect(d.body.receipts.every((x: { status: string }) => x.status === 'pending')).toBe(true)
    expect(d.body.status).toBe('approved')
  })
})
