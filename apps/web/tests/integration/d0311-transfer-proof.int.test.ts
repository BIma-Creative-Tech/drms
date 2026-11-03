import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'
import { addDays } from '@/domain/expense/types'

import { auditRows, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, draftBody, makeWorld, png, upload, type FlowUser, type World } from './flow-world'

/**
 * D0311 (user 2026-11-03) "Ganti bukti transfer" through /api/v1 + the DB guard:
 * - Finance and Admin of the PT replace the bank proof of a posted transfer once the request is "Selesai" (file only:
 *   amount, dates, account, bank reference and KK unchanged; reason required; audited old → new with the reason);
 * - "Sudah Ditransfer" → 409 (existing flow: void + record again); other roles 403; a void transfer / the same file /
 *   a file used elsewhere → 409; a missing reason → 400;
 * - DB: pk_transfers_guard lets only the proof change, only on a completed request, only to a file of that request.
 */
let w: World
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })

beforeAll(async () => {
  w = await makeWorld('TP')
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function proof(user: FlowUser = w.users.finance): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', user, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

/** Pengajuan Baru 750.000 → approved → transferred; returns the request and its transfer. */
async function transferred() {
  const c = await api('POST', E, w.users.staffA, draftBody(w))
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const id = c.body.id as number
  expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
  expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})).status).toBe(200)
  expect((await api('POST', `${E}/${id}/approve`, w.users.finance, {})).status).toBe(200)
  const proofId = await proof()
  const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `TRF-${id}`, proofMediaId: proofId }, key())
  expect(t.status, JSON.stringify(t.body)).toBe(201)
  return { id, transferId: t.body.transferId as number, proofId, lineIds: t.body.request.lines.map((l: { id: string }) => l.id) as string[] }
}

/** … → receipts = the transferred amount → LPJ verified with difference 0 → Selesai. */
async function completed() {
  const r = await transferred()
  for (const [i, amount] of [600_000, 150_000].entries()) {
    const img = await upload('/api/v1/media/receipts', w.users.staffA, await png())
    expect(img.status).toBe(201)
    const rc = await api('POST', `${E}/${r.id}/receipts`, w.users.staffA, {
      lineId: r.lineIds[i % r.lineIds.length],
      receiptNo: `N-${r.id}-${i}`,
      vendorName: 'Toko Bangunan Maju',
      receiptDate: addDays(new Date().toISOString().slice(0, 10), -1),
      amount,
      imageId: img.body.id,
    })
    expect(rc.status, JSON.stringify(rc.body)).toBe(201)
  }
  expect((await api('POST', `${E}/${r.id}/receipts-complete`, w.users.staffA, {})).status).toBe(200)
  expect((await api('POST', `${E}/${r.id}/lpj/submit`, w.users.staffA, { usageNotes: 'Dana dipakai untuk material dan konsumsi tukang.' })).status).toBe(200)
  const d = (await api('GET', `${E}/${r.id}`, w.users.finance)).body
  for (const x of d.receipts.filter((y: { status: string }) => y.status === 'pending')) {
    expect((await api('POST', `${E}/${r.id}/receipts/${x.id}/verify`, w.users.finance, {})).status).toBe(200)
  }
  const v = await api('POST', `${E}/${r.id}/lpj/verify`, w.users.finance, {})
  expect(v.status, JSON.stringify(v.body)).toBe(200)
  expect(v.body.status).toBe('completed')
  return r
}

const replace = (user: FlowUser, id: number, tid: number, body: Record<string, unknown>) => api('POST', `${E}/${id}/transfers/${tid}/proof`, user, body, key())

const transferRow = async (tid: number) =>
  (await sqlAs('app', 'SELECT proof_id, amount::int, bank_ref, transfer_date::text, cash_account_id, cash_entry_id, status FROM transfers WHERE id = $1', [tid])).rows[0]

describe('Ganti bukti transfer — Selesai only', () => {
  it('"Sudah Ditransfer": not offered; Finance → 409 (void + record again), other roles 403', async () => {
    const r = await transferred()
    const d = (await api('GET', `${E}/${r.id}`, w.users.finance)).body
    expect(d.allowedActions).not.toContain('transfer_proof_replace')
    const res = await replace(w.users.finance, r.id, r.transferId, { proofMediaId: await proof(), reason: 'salah upload' })
    expect(res.status, JSON.stringify(res.body)).toBe(409)
    expect(res.body.title).toMatch(/hanya dapat diganti setelah pengajuan Selesai/)
    expect((await transferRow(r.transferId)).proof_id).toBe(r.proofId)
  })

  it('Finance replaces the proof of a Selesai request: file only, audited with the reason, old file kept', async () => {
    const r = await completed()
    const before = await transferRow(r.transferId)
    const d = (await api('GET', `${E}/${r.id}`, w.users.finance)).body
    expect(d.allowedActions).toContain('transfer_proof_replace')
    const next = await proof()
    expect((await replace(w.users.finance, r.id, r.transferId, { proofMediaId: next })).status).toBe(400) // reason required
    expect((await replace(w.users.finance, r.id, r.transferId, { proofMediaId: r.proofId, reason: 'sama' })).status).toBe(409) // same file
    const ok = await replace(w.users.finance, r.id, r.transferId, { proofMediaId: next, reason: 'salah upload bukti PB lain' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('completed')
    expect(ok.body.transfers.find((t: { id: number }) => t.id === r.transferId).proofId).toBe(next)
    const after = await transferRow(r.transferId)
    expect(after).toEqual({ ...before, proof_id: next })
    const rows = (await auditRows('transfer', r.transferId)).filter((a) => a.field === 'proof')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'update', old_value: { v: r.proofId }, new_value: { v: next }, reason: 'salah upload bukti PB lain' })
    // the old file stays linked to the request: the requester still reads it (Riwayat link)
    expect((await api('GET', `/api/v1/media/transfer-proofs/${r.proofId}/file`, w.users.staffA)).status).toBe(200)
    expect((await api('GET', `/api/v1/media/transfer-proofs/${next}/file`, w.users.staffA)).status).toBe(200)
  })

  it('Admin of the PT may replace too (uploads its own file); Owner / PM / Staff 403', async () => {
    const r = await completed()
    for (const u of [w.users.owner, w.users.pm, w.users.staffA]) {
      expect((await replace(u, r.id, r.transferId, { proofMediaId: await proof(), reason: 'coba ganti' })).status).toBe(403)
    }
    expect((await upload('/api/v1/media/transfer-proofs', w.users.staffA, await png())).status).toBe(403)
    const mine = await proof(w.users.admin)
    const ok = await replace(w.users.admin, r.id, r.transferId, { proofMediaId: mine, reason: 'bukti yang benar dari bank' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect((await transferRow(r.transferId)).proof_id).toBe(mine)
  })

  it('a file already used by another transfer, or uploaded by someone else → refused', async () => {
    const a = await completed()
    const b = await completed()
    expect((await replace(w.users.finance, a.id, a.transferId, { proofMediaId: b.proofId, reason: 'pakai bukti lain' })).status).toBe(409)
    const foreign = await proof(w.users.finance2)
    expect((await replace(w.users.finance, a.id, a.transferId, { proofMediaId: foreign, reason: 'bukan unggahan saya' })).status).toBe(403)
  })
})

describe('DB guard pk_transfers_guard (D0311)', () => {
  it('only the proof, only on a completed request, only to a file of that request', async () => {
    const done = await completed()
    const open = await transferred()
    // request not completed → refused
    expect((await sqlError('app', 'UPDATE transfers SET proof_id = $1 WHERE id = $2', [done.proofId, open.transferId]))?.code).toBe('42501')
    // a file of ANOTHER request → refused
    expect((await sqlError('app', 'UPDATE transfers SET proof_id = $1 WHERE id = $2', [open.proofId, done.transferId]))?.code).toBe('42501')
    // proof + another column at once → refused
    const next = await proof()
    await sqlAs('app', "UPDATE media_transfer_proofs SET owner_doc_type = 'expense_request', owner_doc_id = $1 WHERE id = $2", [String(done.id), next])
    expect((await sqlError('app', "UPDATE transfers SET proof_id = $1, bank_ref = 'X' WHERE id = $2", [next, done.transferId]))?.code).toBe('42501')
    // proof alone, file of that request → allowed
    expect(await sqlError('app', 'UPDATE transfers SET proof_id = $1 WHERE id = $2', [next, done.transferId])).toBeNull()
    // everything else stays immutable on a posted transfer
    expect((await sqlError('app', "UPDATE transfers SET bank_ref = 'X' WHERE id = $1", [done.transferId]))?.code).toBe('42501')
  })
})
