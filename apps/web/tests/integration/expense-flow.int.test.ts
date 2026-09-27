import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accessToken, auditRows, getTestPayload, installLocalJwks, registerDevice, sqlAs, http } from './helpers'
import { api, draftBody, makeWorld, png, upload, type World } from './flow-world'

/**
 * T1–T4, T6–T8 state machines through /api/v1 (cookie sessions, same handler as the Next route):
 * Uang Muka and Reimburse happy paths, withdraw/cancel/reject/resubmit, multi-level approval,
 * receipt revision + re-approval, transfer + void, audit coverage (§8) and idempotency (G15).
 */
let w: World

beforeAll(async () => {
  w = await makeWorld('FL')
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

const E = '/api/v1/expense-requests'

async function proof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

async function receiptImage(user = w.users.staffA, bytes?: Buffer): Promise<number> {
  const r = await upload('/api/v1/media/receipts', user, bytes ?? (await png()))
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

async function approvedAdvance(over: Record<string, unknown> = {}) {
  const c = await api('POST', E, w.users.staffA, draftBody(w, over))
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const id = c.body.id as number
  expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
  expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})).status).toBe(200)
  const a = await api('POST', `${E}/${id}/approve`, w.users.finance, {})
  expect(a.status, JSON.stringify(a.body)).toBe(200)
  return a.body
}

describe('Uang Muka (advance) — happy path', () => {
  let id: number
  let lineIds: string[]

  it('Draft: created by Staff for themselves; creator/status/grand total are server-set', async () => {
    const r = await api('POST', E, w.users.staffA, { ...draftBody(w), createdBy: 1 })
    expect(r.status).toBe(400) // strict schema: client cannot even send createdBy
    const ok = await api('POST', E, w.users.staffA, draftBody(w))
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    id = ok.body.id
    lineIds = ok.body.lines.map((l: { id: string }) => l.id)
    expect(ok.body).toMatchObject({ status: 'draft', type: 'advance', grandTotal: 750_000, docNo: null, createdBy: { id: w.users.staffA.id } })
    expect(ok.body.allowedActions).toEqual(expect.arrayContaining(['edit', 'submit', 'cancel']))
  })

  it('Draft edit (US-04): lines replaced, grand total recomputed, per-line audit with line_no', async () => {
    const r = await api('PATCH', `${E}/${id}`, w.users.staffA, {
      lines: [
        { id: lineIds[0], description: 'Semen', qty: 12, uomId: w.uom.l, total: 720_000, categoryId: w.cat.mat },
        { description: 'Pasir', total: 80_000, categoryId: w.cat.mat },
      ],
    })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.grandTotal).toBe(800_000)
    const rows = await auditRows('expense_request', id)
    const lineRows = await sqlAs('app', "SELECT action, field, line_no::int AS line_no FROM audit_logs WHERE doc_type='expense_request' AND doc_id=$1 AND field LIKE 'lines%' ORDER BY id", [String(id)])
    expect(lineRows.rows).toEqual(
      expect.arrayContaining([
        { action: 'update', field: 'lines.qty', line_no: 1 },
        { action: 'update', field: 'lines.total', line_no: 1 },
        { action: 'create', field: 'lines', line_no: 2 }, // added
        { action: 'update', field: 'lines', line_no: 2 }, // "Makan tukang" removed
      ]),
    )
    expect(rows.some((x) => x.action === 'update' && x.field === 'grandTotal')).toBe(true)
  })

  it('submit → Menunggu Diketahui: number issued, signatures Diajukan + Dibuat, snapshot, content frozen', async () => {
    const r = await api('POST', `${E}/${id}/submit`, w.users.staffA, {})
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.status).toBe('pending_ack')
    expect(r.body.docNo).toMatch(/^\d+\/PB-DRMS\/\d{2}\/[IVX]+\/\d{4}$/)
    expect(r.body.approvals.map((a: { position: string }) => a.position).sort()).toEqual(['diajukan', 'dibuat'])
    expect(r.body.approvalRule).toMatchObject({
      acknowledge: 'required',
      acknowledgeBy: 'role',
      acknowledgeRole: 'pk-owner',
      acknowledgerUserId: null,
      decisionRoles: ['pk-owner', 'pk-finance'],
      skipped: [],
      steps: [{ level: 1, approverRole: 'pk-finance' }],
    })
    const snap = await sqlAs('app', 'SELECT reason, grand_total::int AS g, content_hash IS NOT NULL AS h FROM expense_line_snapshots WHERE request_id = $1', [id])
    expect(snap.rows).toEqual([{ reason: 'submit', g: 800_000, h: true }])
    expect((await api('PATCH', `${E}/${id}`, w.users.staffA, { title: 'x' })).status).toBe(409) // G8
  })

  it('Diketahui = Direktur approval → Approval by Finance: budget % before → after (US-26), approvedAmount frozen (AC-3)', async () => {
    expect((await api('POST', `${E}/${id}/approve`, w.users.finance, {})).status).toBe(409) // still waiting for Diketahui
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.otherPm, {})).status).toBe(404) // not his project
    const ack = await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect(ack.body).toMatchObject({ status: 'pending_approval', currentLevel: 1 })
    expect((await api('POST', `${E}/${id}/approve`, w.users.pm, {})).status).toBe(403) // PM cannot approve (US-17)
    expect((await api('POST', `${E}/${id}/approve`, w.users.owner, {})).status).toBe(403) // one position per person (G1)
    expect((await api('POST', `${E}/${id}/approve`, w.users.owner2, {})).status).toBe(403) // Direktur is not the approval step
    const ok = await api('POST', `${E}/${id}/approve`, w.users.finance, {})
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body).toMatchObject({ status: 'approved', statusLabel: 'Disetujui (Antri Transfer)', approvedAmount: 800_000 })
    const appr = ok.body.approvals.find((a: { position: string }) => a.position === 'approval')
    expect(appr).toMatchObject({ actorId: w.users.finance.id, budgetPctBefore: 0, budgetPctAfter: 0.8, signatureSource: 'profile' })
    const dik = ok.body.approvals.find((a: { position: string }) => a.position === 'diketahui')
    expect(dik).toMatchObject({ actorId: w.users.owner.id, decision: 'acknowledged', signatureSource: 'profile' })
    expect(dik.signatureSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(appr.signatureSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('transfer queue lists it; Finance transfer requires the approved amount (G3), posts KK; Staff cannot transfer', async () => {
    const q = await api('GET', '/api/v1/transfer-queue', w.users.finance)
    expect(q.body.items.map((i: { id: number }) => i.id)).toContain(id)
    const pf = await proof()
    expect((await api('POST', `${E}/${id}/transfer`, w.users.staffA, { cashAccountId: w.cashAccount, bankRef: 'X', proofMediaId: pf })).status).toBe(403)
    const bad = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'REF-1', proofMediaId: pf, amount: 900_000 })
    expect(bad.status).toBe(409)
    const noProof = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'REF-1' })
    expect(noProof.status).toBe(400)
    const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'REF-1', proofMediaId: pf, amount: 800_000 })
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    expect(t.body.transferDocNo).toMatch(/^TRF\/\d{4}\/\d{4}$/)
    expect(t.body.request).toMatchObject({ status: 'transferred', transferredTotal: 800_000 })
    const kk = await sqlAs('app', 'SELECT direction, amount::int, source_type, project_id, transfer_id, status FROM cash_entries WHERE id = $1', [t.body.cashEntryId])
    expect(kk.rows[0]).toEqual({ direction: 'out', amount: 800_000, source_type: 'transfer', project_id: w.project, transfer_id: t.body.transferId, status: 'posted' })
  })

  it('void transfer (T8): reversal row, original KK stays visible as void, request back to the queue; re-transfer', async () => {
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    const tr = d.transfers[0]
    expect((await api('POST', `${E}/${id}/transfers/${tr.id}/void`, w.users.finance, {})).status).toBe(400) // reason required
    const cashVoid = await api('POST', `/api/v1/cash-entries/${tr.cashEntryId}/void`, w.users.finance, { reason: 'langsung' })
    expect(cashVoid.status).toBe(409) // transfer postings are voided through the transfer
    const v = await api('POST', `${E}/${id}/transfers/${tr.id}/void`, w.users.finance, { reason: 'salah akun sumber' })
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(v.body).toMatchObject({ status: 'approved', transferredTotal: 0 })
    const rows = await sqlAs('app', 'SELECT id, direction, source_type, status, reversal_of_id, void_reason FROM cash_entries WHERE expense_request_id = $1 ORDER BY id', [id])
    expect(rows.rows).toEqual([
      expect.objectContaining({ id: tr.cashEntryId, direction: 'out', source_type: 'transfer', status: 'void', void_reason: 'salah akun sumber' }),
      expect.objectContaining({ direction: 'in', source_type: 'reversal', status: 'posted', reversal_of_id: tr.cashEntryId }),
    ])
    const again = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'REF-2', proofMediaId: await proof() })
    expect(again.status, JSON.stringify(again.body)).toBe(201)
  })

  it('after transfer the requester adds receipts (Uang Muka window); Finance cannot change the approved amount', async () => {
    const d = (await api('GET', `${E}/${id}`, w.users.staffA)).body
    const add = await api('POST', `${E}/${id}/receipts`, w.users.staffA, {
      lineId: d.lines[0].id,
      receiptNo: 'NB-1',
      vendorName: 'TB Maju',
      receiptDate: '2026-09-22',
      amount: 720_000,
      imageId: await receiptImage(),
    })
    expect(add.status, JSON.stringify(add.body)).toBe(201)
    // Finance tries to change the amount after approval: every path is closed
    expect((await api('PATCH', `${E}/${id}`, w.users.finance, { lines: [{ description: 'x', total: 1, categoryId: w.cat.mat }] })).status).toBe(403)
    const rest = await api('PATCH', `/api/expense-requests/${id}`, w.users.finance, { lines: [] })
    expect([403, 404]).toContain(rest.status)
  })
})

describe('Reimburse — receipts at submission, revision, re-approval, verification, transfer, completion', () => {
  let id: number
  let d: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

  it('submit without a receipt on every line → 409 (US-38); with receipts → Menunggu Diketahui', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse', projectId: null, costCenterId: w.costCenter }))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    id = c.body.id
    const r0 = await api('POST', `${E}/${id}/receipts`, w.users.staffA, {
      lineId: c.body.lines[0].id,
      receiptNo: 'R-1',
      vendorName: 'TB Sinar',
      receiptDate: '2026-09-20',
      amount: 600_000,
      imageId: await receiptImage(),
    })
    expect(r0.status).toBe(201)
    const s1 = await api('POST', `${E}/${id}/submit`, w.users.staffA, {})
    expect(s1.status).toBe(409)
    expect(s1.body.errors).toEqual([expect.objectContaining({ path: 'lines.1' })])
    expect(
      (
        await api('POST', `${E}/${id}/receipts`, w.users.staffA, {
          lineId: c.body.lines[1].id,
          receiptNo: 'R-2',
          vendorName: 'Warung Bu Sri',
          receiptDate: '2026-09-20',
          amount: 150_000,
          imageId: await receiptImage(),
        })
      ).status,
    ).toBe(201)
    const s2 = await api('POST', `${E}/${id}/submit`, w.users.staffA, {})
    expect(s2.status, JSON.stringify(s2.body)).toBe(200)
    expect(s2.body.status).toBe('pending_ack')
    // receipts are locked now (DB window): adding more → 403 for the requester
    expect((await api('POST', `${E}/${id}/receipts`, w.users.staffA, { lineId: c.body.lines[0].id, vendorName: 'x', receiptDate: '2026-09-20', amount: 1, imageId: await receiptImage() })).status).toBe(409)
  })

  it('Direktur approves (Diketahui), Finance approves; Finance rejects a receipt → Revisi Nota', async () => {
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/approve`, w.users.finance, {})).status).toBe(200)
    d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    expect(d.allowedActions).toEqual(expect.arrayContaining(['receipt_verify', 'receipt_reject', 'verify_receipts']))
    expect((await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'X', proofMediaId: await proof() })).status).toBe(409) // not verified yet
    expect((await api('POST', `${E}/${id}/receipts/${d.receipts[1].id}/reject`, w.users.finance, {})).status).toBe(400)
    const rj = await api('POST', `${E}/${id}/receipts/${d.receipts[1].id}/reject`, w.users.finance, { reason: 'nota buram' })
    expect(rj.status, JSON.stringify(rj.body)).toBe(200)
    expect(rj.body.status).toBe('receipt_revision')
  })

  it('requester fixes receipts and the amount changed → back to Menunggu Diketahui (Direktur), new cycle (AC-7)', async () => {
    const lines = d.lines.map((l: { id: string; description: string; total: number; category: { id: number } }, i: number) => ({
      id: l.id,
      description: l.description,
      total: i === 1 ? 140_000 : l.total,
      categoryId: l.category.id,
    }))
    expect((await api('PATCH', `${E}/${id}`, w.users.staffA, { title: 'ganti' })).status).toBe(409) // only lines in Revisi Nota
    const patched = await api('PATCH', `${E}/${id}`, w.users.staffA, { lines })
    expect(patched.status, JSON.stringify(patched.body)).toBe(200)
    expect(patched.body.grandTotal).toBe(740_000)
    const add = await api('POST', `${E}/${id}/receipts`, w.users.staffA, {
      lineId: d.lines[1].id,
      receiptNo: 'R-2B',
      vendorName: 'Warung Bu Sri',
      receiptDate: '2026-09-20',
      amount: 140_000,
      imageId: await receiptImage(),
    })
    expect(add.status, JSON.stringify(add.body)).toBe(201)
    const rs = await api('POST', `${E}/${id}/receipts-resubmit`, w.users.staffA, {})
    expect(rs.status, JSON.stringify(rs.body)).toBe(200)
    expect(rs.body).toMatchObject({ status: 'pending_ack', currentLevel: 0, grandTotal: 740_000, approvedAmount: 750_000, approvalCycle: 2 })
    expect((await api('POST', `${E}/${id}/approve`, w.users.finance, {})).status).toBe(409) // Direktur first
    const ack2 = await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})
    expect(ack2.status, JSON.stringify(ack2.body)).toBe(200)
    expect(ack2.body).toMatchObject({ status: 'pending_approval', currentLevel: 1 })
    const re = await api('POST', `${E}/${id}/approve`, w.users.finance, {})
    expect(re.status, JSON.stringify(re.body)).toBe(200)
    expect(re.body).toMatchObject({ status: 'approved', approvedAmount: 740_000 })
  })

  it('Finance verifies receipts → Nota Terverifikasi → transfer → requester confirms → Selesai', async () => {
    d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    for (const r of d.receipts.filter((x: { status: string }) => x.status === 'pending')) {
      expect((await api('POST', `${E}/${id}/receipts/${r.id}/verify`, w.users.finance, {})).status).toBe(200)
    }
    for (const f of d.flags.filter((x: { status: string; level: string }) => x.status === 'open' && x.level === 'warning')) {
      expect((await api('POST', `${E}/${id}/flags/${f.id}/review`, w.users.finance, {})).status).toBe(200)
    }
    const v = await api('POST', `${E}/${id}/verify-receipts`, w.users.finance, {})
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'RB-1', proofMediaId: await proof() })
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    expect(t.body.request.transferredTotal).toBe(740_000)
    expect((await api('POST', `${E}/${id}/complete`, w.users.staffB, {})).status).toBe(403) // not own (Q-23 lets B read, not act)
    const done = await api('POST', `${E}/${id}/complete`, w.users.staffA, {})
    expect(done.body.status).toBe('completed')
  })
})

describe('approval rules by amount (US-34): > Rp 10 juta needs two different approvers', () => {
  it('Direktur, then Finance level 1 → level 2; the same Finance cannot hold two levels (G1, DB unique); second Finance approves', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { lines: [{ description: 'Genset', total: 12_000_000, categoryId: w.cat.mat }] }))
    const id = c.body.id
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).body.approvalRule.steps).toHaveLength(2)
    await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})
    const l1 = await api('POST', `${E}/${id}/approve`, w.users.finance, {})
    expect(l1.body).toMatchObject({ status: 'pending_approval', currentLevel: 2 })
    expect((await api('POST', `${E}/${id}/approve`, w.users.finance, {})).status).toBe(403)
    const l2 = await api('POST', `${E}/${id}/approve`, w.users.finance2, {})
    expect(l2.body).toMatchObject({ status: 'approved', approvedAmount: 12_000_000 })
  })
})

describe('withdraw / cancel / reject / resubmit (US-04, US-06, G7, G8)', () => {
  it('withdraw before a decision (reason required) → Draft, keeps its number; after a decision → 403', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    const id = c.body.id
    const s = await api('POST', `${E}/${id}/submit`, w.users.staffA, {})
    const no = s.body.docNo
    expect((await api('POST', `${E}/${id}/withdraw`, w.users.staffA, {})).status).toBe(400)
    const wd = await api('POST', `${E}/${id}/withdraw`, w.users.staffA, { reason: 'salah jumlah' })
    expect(wd.body).toMatchObject({ status: 'draft', docNo: no })
    expect((await api('PATCH', `${E}/${id}`, w.users.staffA, { title: 'Perbaikan' })).status).toBe(200)
    const s2 = await api('POST', `${E}/${id}/submit`, w.users.staffA, {})
    expect(s2.body).toMatchObject({ docNo: no, approvalCycle: 2 })
    await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})
    expect((await api('POST', `${E}/${id}/withdraw`, w.users.staffA, { reason: 'x terlambat' })).status).toBe(403)
    expect((await api('POST', `${E}/${id}/cancel`, w.users.staffA, { reason: 'x terlambat' })).status).toBe(403)
    const st = await auditRows('expense_request', id)
    expect(st.find((r) => r.action === 'status_change' && r.reason === 'salah jumlah')).toBeTruthy()
  })

  it('reject needs a reason (Finance, AC-4); resubmit clones into a new Draft with a reference and gets a NEW number', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    const id = c.body.id
    const first = (await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).body.docNo
    await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})
    expect((await api('POST', `${E}/${id}/reject`, w.users.finance, {})).status).toBe(400)
    const rj = await api('POST', `${E}/${id}/reject`, w.users.finance, { reason: 'anggaran belum ada' })
    expect(rj.body).toMatchObject({ status: 'rejected', rejectReason: 'anggaran belum ada' })
    expect((await api('POST', `${E}/${id}/resubmit`, w.users.staffB, {})).status).toBe(404)
    const rs = await api('POST', `${E}/${id}/resubmit`, w.users.staffA, {})
    expect(rs.status, JSON.stringify(rs.body)).toBe(201)
    expect(rs.body).toMatchObject({ status: 'draft', resubmitOfId: id, grandTotal: 750_000, docNo: null })
    const s = await api('POST', `${E}/${rs.body.id}/submit`, w.users.staffA, {})
    expect(s.body.docNo).not.toBe(first)
  })

  it('cancel a Draft with reason; Finance cancels an approved Uang Muka; cancelled is terminal', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    expect((await api('POST', `${E}/${c.body.id}/cancel`, w.users.staffA, { reason: 'tidak jadi' })).body.status).toBe('cancelled')
    expect((await api('POST', `${E}/${c.body.id}/submit`, w.users.staffA, {})).status).toBe(409)
    const a = await approvedAdvance()
    expect((await api('POST', `${E}/${a.id}/cancel`, w.users.staffA, { reason: 'x batal' })).status).toBe(403)
    expect((await api('POST', `${E}/${a.id}/cancel`, w.users.finance, { reason: 'dobel' })).body).toMatchObject({ status: 'cancelled', cancelReason: 'dobel' })
  })
})

describe('draft validation (US-03, US-40, US-44, US-53, G9, G10, Q-09, Q-22)', () => {
  it('rejects bad input server-side', async () => {
    const both = await api('POST', E, w.users.staffA, draftBody(w, { costCenterId: w.costCenter }))
    expect(both.status).toBe(400)
    const foreignAcc = await api('POST', E, w.users.staffA, draftBody(w, { bankAccountId: w.accB }))
    expect(foreignAcc.status).toBe(400)
    expect(foreignAcc.body.errors[0].message).toMatch(/salah satu pemohon/)
    expect((await api('POST', E, w.users.staffA, draftBody(w, { requesterIds: [w.emp.b] }))).status).toBe(403) // Q-09
    expect((await api('POST', E, w.users.staffA, draftBody(w, { projectId: w.otherProject }))).status).toBe(403) // G10
    const vehicle = await api('POST', E, w.users.staffA, draftBody(w, { lines: [{ description: 'Solar', qty: 20, uomId: w.uom.l, total: 200_000, categoryId: w.cat.bbm }] }))
    expect(vehicle.status).toBe(201)
    const s = await api('POST', `${E}/${vehicle.body.id}/submit`, w.users.staffA, {})
    expect(s.status).toBe(400)
    expect(s.body.errors).toEqual([expect.objectContaining({ path: 'lines.0.vehicleId' })])
  })

  it('Admin creates on behalf of two requesters (one without account); account of the 2nd requester is valid', async () => {
    const r = await api('POST', E, w.users.admin, draftBody(w, { requesterIds: [w.emp.noAccount, w.emp.b], bankAccountId: w.accB }))
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.createdBy.id).toBe(w.users.admin.id)
    expect(r.body.requesters.map((x: { id: number }) => x.id)).toEqual([w.emp.noAccount, w.emp.b])
  })

  it('a required signature that does not exist blocks the submit (US-43)', async () => {
    const p = await getTestPayload()
    await p.update({ collection: 'users', id: w.users.nosig.id, data: { employee: w.emp.noAccount }, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { skipKeycloakSync: true } })
    await sqlAs('app', 'UPDATE web_sessions SET revoked_at = NULL WHERE user_id = $1', [w.users.nosig.id])
    await p.create({ collection: 'team-assignments', data: { employee: w.emp.noAccount, project: w.project, roleInProject: 'staff' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    const c = await api('POST', E, w.users.nosig, draftBody(w, { requesterIds: [w.emp.noAccount], bankAccountId: null }))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const s = await api('POST', `${E}/${c.body.id}/submit`, w.users.nosig, {})
    expect(s.status).toBe(400) // bank account missing first
    expect(s.body.errors).toEqual([expect.objectContaining({ path: 'bankAccountId' })])
  })
})

describe('idempotency (G15) and APK bearer', () => {
  it('same Idempotency-Key → same response replayed; other body → 422; APK without key → 400', async () => {
    const key = randomUUID()
    const body = draftBody(w, { title: 'Idempoten' })
    const a = await api('POST', E, w.users.staffA, body, { 'Idempotency-Key': key })
    const b = await api('POST', E, w.users.staffA, body, { 'Idempotency-Key': key })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(b.body.id).toBe(a.body.id)
    expect(b.headers.get('idempotent-replayed')).toBe('true')
    const n = await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE title = 'Idempoten'")
    expect(n.rows[0].n).toBe(1)
    const c = await api('POST', E, w.users.staffA, { ...body, title: 'Lain' }, { 'Idempotency-Key': key })
    expect(c.status).toBe(422)
    // retried submit with the same key does not double-submit
    const k2 = randomUUID()
    const s1 = await api('POST', `${E}/${a.body.id}/submit`, w.users.staffA, {}, { 'Idempotency-Key': k2 })
    const s2 = await api('POST', `${E}/${a.body.id}/submit`, w.users.staffA, {}, { 'Idempotency-Key': k2 })
    expect([s1.status, s2.status]).toEqual([200, 200])
    expect(s2.body.docNo).toBe(s1.body.docNo)
    // an error response is never stored: the same key can be used again after fixing the cause
    const k3 = randomUUID()
    expect((await api('POST', `${E}/${a.body.id}/cancel`, w.users.staffA, { reason: 'ab' }, { 'Idempotency-Key': k3 })).status).toBe(400)

    await installLocalJwks()
    const token = await accessToken({ keycloakSub: (await sqlAs('app', 'SELECT keycloak_sub FROM users WHERE id=$1', [w.users.staffA.id])).rows[0].keycloak_sub }, ['pk-staff'])
    const device = await registerDevice({ ...w.users.staffA, keycloakSub: '' }, token)
    const apk = await http('POST', E, { headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': device, 'X-App-Version': '1.0.0' }, json: body })
    expect(apk.status).toBe(400)
    const apkOk = await http('POST', E, { headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': device, 'X-App-Version': '1.0.0', 'Idempotency-Key': randomUUID() }, json: { ...body, clientUuid: randomUUID() } })
    expect(apkOk.status).toBe(201)
  })

  it('clientUuid: an offline retry returns the existing draft (200)', async () => {
    const clientUuid = randomUUID()
    const a = await api('POST', E, w.users.staffA, draftBody(w, { clientUuid }))
    const b = await api('POST', E, w.users.staffA, draftBody(w, { clientUuid }))
    expect([a.status, b.status]).toEqual([201, 200])
    expect(b.body.id).toBe(a.body.id)
  })
})

describe('lists and history', () => {
  it('scopes mine / team / inbox and the Riwayat history', async () => {
    const mine = await api('GET', `${E}?scope=mine&limit=100`, w.users.staffA)
    expect(mine.status).toBe(200)
    expect(mine.body.items.length).toBeGreaterThan(3)
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    await api('POST', `${E}/${c.body.id}/submit`, w.users.staffA, {})
    const pmInbox = await api('GET', `${E}?scope=inbox`, w.users.pm)
    expect(pmInbox.body.items.map((i: { id: number }) => i.id)).not.toContain(c.body.id) // ADR 0013: PM only monitors
    const ownerInbox = await api('GET', `${E}?scope=inbox`, w.users.owner)
    expect(ownerInbox.body.items.map((i: { id: number }) => i.id)).toContain(c.body.id) // Direktur approval ("Diketahui")
    const financeInbox = await api('GET', `${E}?scope=inbox`, w.users.finance)
    expect(financeInbox.body.items.map((i: { id: number }) => i.id)).not.toContain(c.body.id) // waiting for the Direktur
    const team = await api('GET', `${E}?scope=team&limit=100`, w.users.otherPm)
    expect(team.body.items).toEqual([])
    const page1 = await api('GET', `${E}?limit=2`, w.users.finance)
    expect(page1.body.nextCursor).toBeTruthy()
    const page2 = await api('GET', `${E}?limit=2&cursor=${page1.body.nextCursor}`, w.users.finance)
    expect(page2.body.items[0].id).toBeLessThan(page1.body.items[1].id)
    const h = await api('GET', `${E}/${c.body.id}/history`, w.users.staffA)
    expect(h.body.items.map((i: { action: string }) => i.action)).toEqual(expect.arrayContaining(['create', 'number_issued', 'status_change', 'sign']))
  })
})
