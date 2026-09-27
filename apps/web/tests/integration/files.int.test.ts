import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'

import { getTestPayload, sqlAs } from './helpers'
import { api, draftBody, makeWorld, ORIGIN, png, upload, type FlowUser, type World } from './flow-world'

/**
 * F2b `GET /api/v1/media/{collection}/{id}/file` (ADR 0004 §4, architecture §7.4/§14 "Files: IDOR"):
 * the APK's authenticated, scoped file download. Access = the media collection's own read access
 * (owner-document derived) → other users' receipts are 404, never 403 (no existence leak); approval
 * signatures are visible to readers of the signed request; transfer proofs are audited.
 */
let w: World
const E = '/api/v1/expense-requests'
let receiptImg: number
let requestId: number
let proofId: number

async function file(path: string, user: FlowUser | null) {
  const h = new Headers({ Origin: ORIGIN })
  if (user) h.set('Cookie', user.cookie)
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}${path}`, { method: 'GET', headers: h }) })
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) }
}

beforeAll(async () => {
  w = await makeWorld('FI')
  // Uang Muka of Staff A through approval and transfer; receipt uploaded after the transfer.
  const c = await api('POST', E, w.users.staffA, draftBody(w))
  requestId = c.body.id
  await api('POST', `${E}/${requestId}/submit`, w.users.staffA, {})
  await api('POST', `${E}/${requestId}/acknowledge`, w.users.owner, {})
  await api('POST', `${E}/${requestId}/approve`, w.users.finance, {})
  const pr = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  proofId = pr.body.id
  const t = await api('POST', `${E}/${requestId}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'FI-1', proofMediaId: proofId })
  expect(t.status, JSON.stringify(t.body)).toBe(201)
  const img = await upload('/api/v1/media/receipts', w.users.staffA, await png(4242, 1200, 900))
  receiptImg = img.body.id
  const r = await api('POST', `${E}/${requestId}/receipts`, w.users.staffA, { lineId: c.body.lines[0].id, receiptNo: 'FI-001', vendorName: 'Toko FI', receiptDate: '2026-09-22', amount: 600_000, imageId: receiptImg })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('GET /api/v1/media/{collection}/{id}/file', () => {
  it('requester: streams the stored JPEG with private/no-store, nosniff, inline; thumb variant is WebP', async () => {
    const r = await file(`/api/v1/media/receipts/${receiptImg}/file`, w.users.staffA)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/jpeg')
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('content-disposition')).toBe(`inline; filename="receipts-${receiptImg}.jpg"`)
    expect(Number(r.headers.get('content-length'))).toBe(r.bytes.length)
    expect(r.bytes.readUInt16BE(0)).toBe(0xffd8)
    const t = await file(`/api/v1/media/receipts/${receiptImg}/file?variant=thumb`, w.users.staffA)
    expect(t.status).toBe(200)
    expect(t.headers.get('content-type')).toBe('image/webp')
    expect(t.bytes.subarray(8, 12).toString()).toBe('WEBP')
  })

  it("other user's receipt → 404 (staff not on it, other PM); team PM and Finance → 200; anonymous → 401", async () => {
    expect((await file(`/api/v1/media/receipts/${receiptImg}/file`, w.users.staffB)).status).toBe(404)
    expect((await file(`/api/v1/media/receipts/${receiptImg}/file`, w.users.otherPm)).status).toBe(404)
    expect((await file(`/api/v1/media/receipts/${receiptImg}/file`, w.users.pm)).status).toBe(200)
    expect((await file(`/api/v1/media/receipts/${receiptImg}/file`, w.users.finance)).status).toBe(200)
    expect((await file(`/api/v1/media/receipts/${receiptImg}/file`, null)).status).toBe(401)
  })

  it('an unclaimed upload is visible only to its uploader', async () => {
    const own = await upload('/api/v1/media/receipts', w.users.staffB, await png())
    expect((await file(`/api/v1/media/receipts/${own.body.id}/file`, w.users.staffB)).status).toBe(200)
    expect((await file(`/api/v1/media/receipts/${own.body.id}/file`, w.users.staffA)).status).toBe(404)
  })

  it('signatures: own profile signature; the approver signature of a request the caller may read; nothing else', async () => {
    const p = await getTestPayload()
    const sigOf = async (u: FlowUser) => ((await p.findByID({ collection: 'users', id: u.id, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })).signature as number)
    expect((await file(`/api/v1/media/signatures/${await sigOf(w.users.staffA)}/file`, w.users.staffA)).status).toBe(200)
    const ownerSig = await sigOf(w.users.owner)
    const s = await file(`/api/v1/media/signatures/${ownerSig}/file`, w.users.staffA) // owner approved staff A's request
    expect(s.status).toBe(200)
    expect(s.headers.get('content-type')).toBe('image/png')
    expect((await file(`/api/v1/media/signatures/${ownerSig}/file`, w.users.staffB)).status).toBe(404)
    expect((await file(`/api/v1/media/signatures/${await sigOf(w.users.owner2)}/file`, w.users.staffA)).status).toBe(404)
  })

  it('transfer proof: requester may read it (own request), audited view_sensitive once per 10 min; outsiders 404', async () => {
    const before = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'view_sensitive' AND doc_type = 'media_transfer_proofs' AND doc_id = $1", [String(proofId)])
    const r1 = await file(`/api/v1/media/transfer-proofs/${proofId}/file`, w.users.staffA)
    expect(r1.status).toBe(200)
    expect(r1.headers.get('content-type')).toBe('image/jpeg')
    await file(`/api/v1/media/transfer-proofs/${proofId}/file`, w.users.staffA)
    const after = await sqlAs('app', "SELECT count(*)::int AS n, max(user_id)::int AS u FROM audit_logs WHERE action = 'view_sensitive' AND doc_type = 'media_transfer_proofs' AND doc_id = $1", [String(proofId)])
    expect(after.rows[0].n - before.rows[0].n).toBe(1)
    expect(after.rows[0].u).toBe(w.users.staffA.id)
    expect((await file(`/api/v1/media/transfer-proofs/${proofId}/file`, w.users.staffB)).status).toBe(404)
  })

  it('bad input: unknown collection, non-numeric id, traversal-looking ids, unknown variant, missing doc', async () => {
    expect((await file(`/api/v1/media/selfies/${receiptImg}/file`, w.users.finance)).status).toBe(404)
    expect((await file('/api/v1/media/receipts/abc/file', w.users.finance)).status).toBe(404)
    expect((await file('/api/v1/media/receipts/..%2F..%2Fetc%2Fpasswd/file', w.users.finance)).status).toBe(404)
    expect((await file(`/api/v1/media/receipts/${receiptImg}/file?variant=../../x`, w.users.finance)).status).toBe(400)
    expect((await file('/api/v1/media/receipts/999999999/file', w.users.finance)).status).toBe(404)
  })
})
