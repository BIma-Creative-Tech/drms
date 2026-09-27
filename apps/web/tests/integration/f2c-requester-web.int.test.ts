import { randomUUID } from 'node:crypto'

import { createLocalReq } from 'payload'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { WorkflowPanel } from '@/admin/components/WorkflowPanel'
import { addDays } from '@/domain/expense/types'

import { getTestPayload } from './helpers'
import { api, draftBody, makeWorld, png, upload, type FlowUser, type World } from './flow-world'

/**
 * F2c — requester actions in the web panel. The panel only calls the EXISTING /api/v1 endpoints
 * (cookie session + Idempotency-Key, exactly the request shapes of RequesterActions.tsx), so these
 * tests pin: (1) staff access restrictions, (2) the admin create/edit form path (generic REST) now
 * runs the same draft rules as /api/v1 (Q-09, G9, G10, US-53) with a server-computed grand total,
 * (3) each requester action happy path + one negative, (4) self-service profile signature,
 * (5) the server-rendered workflow panel (timeline, next actor, buttons only for own requests).
 */
let w: World
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })

beforeAll(async () => {
  w = await makeWorld('FC')
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function draft(user: FlowUser = w.users.staffA, over: Record<string, unknown> = {}) {
  const r = await api('POST', E, user, draftBody(w, over), key())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body as { id: number; lines: Array<{ id: string; total: number }> }
}

async function panelHtml(user: FlowUser, id: number): Promise<string> {
  const p = await getTestPayload()
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, p)
  const el = await WorkflowPanel({ req, id, operation: 'update' } as never)
  return el ? renderToString(el) : ''
}

describe('F2c staff panel — access restrictions', () => {
  it('staff sees only own requests via the generic REST list the admin list view uses', async () => {
    const a = await draft()
    const b = await draft(w.users.staffB, { requesterIds: [w.emp.b], bankAccountId: w.accB })
    const listA = await api('GET', '/api/expense-requests?limit=100&depth=0', w.users.staffA)
    expect(listA.status).toBe(200)
    const idsA = listA.body.docs.map((d: { id: number }) => d.id)
    expect(idsA).toContain(a.id)
    expect(idsA).not.toContain(b.id)
    expect((await api('GET', `/api/expense-requests/${b.id}`, w.users.staffA)).status).toBe(404)
  })

  it('staff cannot read masters outside scope, other users, or use finance views/actions', async () => {
    const users = await api('GET', '/api/users?limit=100&depth=0', w.users.staffA)
    expect(users.body.docs.map((d: { id: number }) => d.id)).toEqual([w.users.staffA.id])
    const acc = await api('GET', '/api/cash-accounts?limit=100', w.users.staffA)
    expect(acc.status === 403 || acc.body.docs.length === 0).toBe(true)
    expect((await api('GET', '/api/v1/transfer-queue', w.users.staffA)).status).toBe(403)
    const a = await draft()
    expect((await api('POST', `${E}/${a.id}/transfer`, w.users.staffA, { cashAccountId: w.cashAccount, bankRef: 'X', proofMediaId: 1 })).status).toBe(403)
  })
})

describe('F2c admin create/edit form path (generic REST) = same draft rules as /api/v1', () => {
  const lines = () => [
    { description: 'BBM operasional', qty: 24.8, uom: w.uom.l, total: 250_000, category: w.cat.bbm, vehicle: w.vehicle },
    { description: 'Penginapan', qty: 1, uom: w.uom.kmr, total: 400_000, category: w.cat.inap },
  ]

  it('Admin creates on behalf (Q-09): 2 requesters, cost center, bank account of the 2nd requester; grand total server-computed', async () => {
    const r = await api('POST', '/api/expense-requests', w.users.admin, {
      type: 'advance',
      title: 'Perjalanan dinas (atas nama)',
      costCenter: w.costCenter,
      requesters: [w.emp.a, w.emp.b],
      bankAccount: w.accB,
      lines: lines(),
      grandTotal: 1, // ignored
      status: 'approved', // ignored (system field)
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.doc).toMatchObject({ status: 'draft', grandTotal: 650_000, createdBy: expect.objectContaining({ id: w.users.admin.id }) })
    const id = r.body.doc.id as number
    const s = await api('POST', `${E}/${id}/submit`, w.users.admin, {}, key())
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body.status).toBe('pending_ack')
    expect(s.body.approvals.find((a: { position: string }) => a.position === 'diajukan')).toMatchObject({ onBehalf: true, employeeId: w.emp.a })
  })

  it('negatives: staff on behalf of someone else 403; project AND cost center 400; foreign bank account 400; project out of scope 403', async () => {
    const base = { type: 'reimburse', title: 'Uji', lines: lines() }
    const onBehalf = await api('POST', '/api/expense-requests', w.users.staffA, { ...base, requesters: [w.emp.b], costCenter: w.costCenter })
    expect(onBehalf.status, JSON.stringify(onBehalf.body)).toBe(403)
    const both = await api('POST', '/api/expense-requests', w.users.admin, { ...base, project: w.project, costCenter: w.costCenter, requesters: [w.emp.a] })
    expect(both.status).toBe(400)
    const bank = await api('POST', '/api/expense-requests', w.users.admin, { ...base, costCenter: w.costCenter, requesters: [w.emp.b], bankAccount: w.accA })
    expect(bank.status).toBe(400)
    expect(JSON.stringify(bank.body)).toContain('bankAccount')
    const scope = await api('POST', '/api/expense-requests', w.users.staffA, { ...base, project: w.otherProject })
    expect(scope.status).toBe(403)
  })

  it('staff creates for themselves in the form (requester defaults to own employee) and edits the draft; total recomputed', async () => {
    const r = await api('POST', '/api/expense-requests', w.users.staffA, { type: 'reimburse', title: 'Konsumsi', project: w.project, bankAccount: w.accA, lines: [{ description: 'Makan', total: 90_000, category: w.cat.ksm }] })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.doc.requesters.map((e: { id: number } | number) => (typeof e === 'number' ? e : e.id))).toEqual([w.emp.a])
    const u = await api('PATCH', `/api/expense-requests/${r.body.doc.id}`, w.users.staffA, { lines: [{ description: 'Makan', total: 90_000, category: w.cat.ksm }, { description: 'Minum', total: 10_000, category: w.cat.ksm }] })
    expect(u.status, JSON.stringify(u.body)).toBe(200)
    expect(u.body.doc.grandTotal).toBe(100_000)
  })
})

describe('F2c requester actions (panel request shapes)', () => {
  it('Kirim pengajuan: happy; another staff → 404', async () => {
    const a = await draft()
    expect((await api('POST', `${E}/${a.id}/submit`, w.users.staffB, {}, key())).status).toBe(404)
    const s = await api('POST', `${E}/${a.id}/submit`, w.users.staffA, {}, key())
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body).toMatchObject({ status: 'pending_ack' })
    expect(s.body.docNo).toBeTruthy()
  })

  it('Tarik kembali: reason required (400) then back to Draft; same Idempotency-Key replays', async () => {
    const a = await draft()
    await api('POST', `${E}/${a.id}/submit`, w.users.staffA, {}, key())
    expect((await api('POST', `${E}/${a.id}/withdraw`, w.users.staffA, {}, key())).status).toBe(400)
    const k = key()
    const r = await api('POST', `${E}/${a.id}/withdraw`, w.users.staffA, { reason: 'Salah nominal' }, k)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.status).toBe('draft')
    const again = await api('POST', `${E}/${a.id}/withdraw`, w.users.staffA, { reason: 'Salah nominal' }, k)
    expect(again.status).toBe(200)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
  })

  it('Batalkan: after "Diketahui" the requester can no longer cancel (403); on Draft with reason OK', async () => {
    const a = await draft()
    await api('POST', `${E}/${a.id}/submit`, w.users.staffA, {}, key())
    expect((await api('POST', `${E}/${a.id}/acknowledge`, w.users.owner, {}, key())).status).toBe(200)
    expect((await api('POST', `${E}/${a.id}/cancel`, w.users.staffA, { reason: 'Tidak jadi' }, key())).status).toBe(403)
    const b = await draft()
    const c = await api('POST', `${E}/${b.id}/cancel`, w.users.staffA, { reason: 'Tidak jadi' }, key())
    expect(c.status, JSON.stringify(c.body)).toBe(200)
    expect(c.body).toMatchObject({ status: 'cancelled', cancelReason: 'Tidak jadi' })
  })

  it('Ajukan ulang: only from Ditolak (409 on Draft); creates a new Draft linked to the old one', async () => {
    const a = await draft()
    expect((await api('POST', `${E}/${a.id}/resubmit`, w.users.staffA, {}, key())).status).toBe(409)
    await api('POST', `${E}/${a.id}/submit`, w.users.staffA, {}, key())
    expect((await api('POST', `${E}/${a.id}/reject`, w.users.owner, { reason: 'Lengkapi rincian' }, key())).status).toBe(200)
    const r = await api('POST', `${E}/${a.id}/resubmit`, w.users.staffA, {}, key())
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body).toMatchObject({ status: 'draft', resubmitOfId: a.id, docNo: null })
    expect(r.body.id).not.toBe(a.id)
  })

  it('Upload nota per baris (Reimburse draft): media upload + receipt → flags; Uang Muka draft → 409', async () => {
    const d = await draft(w.users.staffA, { type: 'reimburse' })
    const img = await upload('/api/v1/media/receipts', w.users.staffA, await png())
    expect(img.status).toBe(201)
    const r = await api('POST', `${E}/${d.id}/receipts`, w.users.staffA, {
      lineId: d.lines[0]!.id,
      receiptNo: `FC-${d.id}`,
      vendorName: 'Toko Uji',
      receiptDate: addDays(new Date().toISOString().slice(0, 10), -1),
      amount: 650_000, // line total 600.000 → amount_diff flag
      imageId: img.body.id,
    }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.receipts).toHaveLength(1)
    expect(r.body.flags.map((f: { kind: string }) => f.kind)).toContain('amount_diff')
    const adv = await draft()
    const img2 = await upload('/api/v1/media/receipts', w.users.staffA, await png())
    const neg = await api('POST', `${E}/${adv.id}/receipts`, w.users.staffA, { lineId: adv.lines[0]!.id, vendorName: 'X', receiptDate: '2026-09-01', amount: 1000, imageId: img2.body.id }, key())
    expect(neg.status).toBe(409)
  })

  it('Kirim LPJ / revisi / Kirim ulang LPJ (Uang Muka): usage notes required; revision note visible to the requester', async () => {
    const a = await draft()
    await api('POST', `${E}/${a.id}/submit`, w.users.staffA, {}, key())
    await api('POST', `${E}/${a.id}/acknowledge`, w.users.owner, {}, key())
    await api('POST', `${E}/${a.id}/approve`, w.users.finance, {}, key())
    const proof = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
    expect((await api('POST', `${E}/${a.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `FC-${a.id}`, proofMediaId: proof.body.id }, key())).status).toBe(201)
    const img = await upload('/api/v1/media/receipts', w.users.staffA, await png())
    const rc = await api('POST', `${E}/${a.id}/receipts`, w.users.staffA, { lineId: a.lines[0]!.id, vendorName: 'Toko', receiptDate: addDays(new Date().toISOString().slice(0, 10), -1), amount: 600_000, imageId: img.body.id }, key())
    expect(rc.status, JSON.stringify(rc.body)).toBe(201)
    expect((await api('POST', `${E}/${a.id}/receipts-complete`, w.users.staffA, {}, key())).status).toBe(200)
    expect((await api('POST', `${E}/${a.id}/lpj/submit`, w.users.staffA, {}, key())).status).toBe(400) // first submit needs usage notes
    const s = await api('POST', `${E}/${a.id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material semen.' }, key())
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect((await api('POST', `${E}/${a.id}/lpj/request-revision`, w.users.finance, { note: 'Lampirkan nota makan' }, key())).status).toBe(200)
    const d = await api('GET', `${E}/${a.id}`, w.users.staffA)
    expect(d.body).toMatchObject({ status: 'lpj_revision', settlement: { financeNotes: 'Lampirkan nota makan' } })
    expect(d.body.allowedActions).toContain('lpj_submit')
    const html = await panelHtml(w.users.staffA, a.id)
    expect(html).toContain('Catatan revisi Finance')
    expect(html).toContain('Lampirkan nota makan')
    expect(html).toContain('Kirim ulang LPJ')
    const again = await api('POST', `${E}/${a.id}/lpj/submit`, w.users.staffA, {}, key())
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect(again.body.settlement).toMatchObject({ status: 'submitted', submitCount: 2, usageNotes: 'Material semen.' })
  })
})

describe('F2c workflow panel (server-rendered in the edit view)', () => {
  it('own draft: timeline + "Giliran: Pemohon" + Kirim pengajuan button; other staff: nothing', async () => {
    const a = await draft()
    const html = await panelHtml(w.users.staffA, a.id)
    expect(html).toContain('data-pk-panel="workflow"')
    expect(html).toContain('Giliran')
    expect(html).toContain('data-pk-action="submit"')
    expect(html).not.toContain('data-pk-action="withdraw"')
    expect(await panelHtml(w.users.staffB, a.id)).toBe('')
  })

  it('approver sees the timeline and whose turn it is, but no requester actions', async () => {
    const a = await draft()
    await api('POST', `${E}/${a.id}/submit`, w.users.staffA, {}, key())
    const html = await panelHtml(w.users.owner, a.id)
    expect(html).toContain('Menunggu Diketahui')
    expect(html).toContain('data-pk-next-actor')
    expect(html).not.toContain('data-pk-panel="requester"')
    const own = await panelHtml(w.users.staffA, a.id)
    expect(own).toContain('data-pk-action="withdraw"')
    expect(own).toContain('data-pk-action="cancel"')
    expect(own).not.toContain('data-pk-action="submit"')
  })
})

describe('F2c profile signature (self-service)', () => {
  async function sig(user: FlowUser): Promise<number> {
    const r = await upload('/api/media-signatures', user, await png(undefined, 600, 200))
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    return r.body.doc.id as number
  }

  it('own signature: upload (resized PNG) + set on own profile → 200; audited', async () => {
    const id = await sig(w.users.staffB)
    const r = await api('PATCH', `/api/users/${w.users.staffB.id}`, w.users.staffB, { signature: id })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.doc.signature?.id ?? r.body.doc.signature).toBe(id)
    // the admin form re-sends the unchanged read-only fields → still allowed
    const full = await api('PATCH', `/api/users/${w.users.staffB.id}`, w.users.staffB, { email: w.users.staffB.email, roles: ['pk-staff'], employee: w.emp.b, active: true, signature: id })
    expect(full.status, JSON.stringify(full.body)).toBe(200)
  })

  it('someone else\'s profile → 403; someone else\'s image on own profile → 403; own roles → 403', async () => {
    const mine = await sig(w.users.staffB)
    expect((await api('PATCH', `/api/users/${w.users.staffA.id}`, w.users.staffB, { signature: mine })).status).toBe(403)
    const foreign = await sig(w.users.staffA)
    expect((await api('PATCH', `/api/users/${w.users.staffB.id}`, w.users.staffB, { signature: foreign })).status).toBe(403)
    expect((await api('PATCH', `/api/users/${w.users.staffB.id}`, w.users.staffB, { roles: ['pk-admin'] })).status).toBe(403)
    expect((await api('PATCH', `/api/users/${w.users.staffB.id}`, w.users.staffB, { email: 'x@evil.test' })).status).toBe(403)
  })

  it('Admin still manages other users\' signatures', async () => {
    const id = await sig(w.users.admin)
    const r = await api('PATCH', `/api/users/${w.users.nosig.id}`, w.users.admin, { signature: id })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
  })
})
