import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { resetMinVersionCache } from '@/api/v1/http'
import { resetEnvCache } from '@/lib/env'
import { resetRateLimits } from '@/lib/rate-limit'

import { accessToken, auditRows, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, type TestUser } from './helpers'
import { api, draftBody, makeWorld, uploadMedia, type FlowUser, type World } from './flow-world'

/**
 * F4 — APK backend: POST /api/v1/sync/batch (ADR 0010 sync contract), GET /api/v1/app/config,
 * /.well-known/assetlinks.json, detail timeline/"Giliran", device registry checks.
 */
let w: World
type Mobile = { user: FlowUser; token: string; device: string }
let staffA: Mobile
let staffB: Mobile
let pm: Mobile
const E = '/api/v1/expense-requests'

async function mobile(user: FlowUser, roles: string[]): Promise<Mobile> {
  const p = await getTestPayload()
  const doc = await p.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
  const t: TestUser = { ...user, keycloakSub: doc.keycloakSub as string }
  const token = await accessToken(t, roles)
  return { user, token, device: await registerDevice(t, token) }
}

const headers = (m: Mobile, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${m.token}`, 'X-Device-Id': m.device, 'X-App-Version': '1.0.0', ...extra })

/** Monotonic clock of a fake device: last online call 10 min ago, items recorded after it. */
function clock(offsetMs = 0) {
  const now = Date.now()
  return {
    device_time: new Date(now + offsetMs).toISOString(),
    elapsed_ms: 10_000_000,
    boot_id: 'boot-1',
    last_server_time: new Date(now - 600_000).toISOString(),
    last_server_elapsed_ms: 10_000_000 - 600_000,
  }
}

type Item = Record<string, unknown> & { client_uuid: string }
function item(type: string, payload: Record<string, unknown>, over: Record<string, unknown> = {}): Item {
  return {
    client_uuid: randomUUID(),
    type,
    schema_version: 1,
    offline: true,
    device_time: new Date(Date.now() - 300_000).toISOString(),
    elapsed_ms: 10_000_000 - 300_000,
    payload,
    ...over,
  }
}

async function sync(m: Mobile, items: Item[], over: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) {
  resetRateLimits()
  const body = { batch_id: randomUUID(), device_id: m.device, clock: clock(), items, ...over }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return http('POST', '/api/v1/sync/batch', { headers: headers(m, extraHeaders), json: body }) as Promise<{ status: number; body: any; headers: Headers }>
}

function reimbursePayload(extra: Record<string, unknown> = {}) {
  return {
    kind: 'reimburse',
    title: 'Service Tronton (offline)',
    cost_center_id: w.costCenter,
    requester_ids: [w.emp.a],
    bank_account_id: w.accA,
    needed_date: '2026-09-30',
    client_grand_total: 770_500,
    lines: [
      { client_uuid: randomUUID(), description: 'BBM Hilux', qty: 1, uom_id: w.uom.bln, total: 600_000, category_id: w.cat.bbm, vehicle_id: w.vehicle },
      { client_uuid: randomUUID(), description: 'Makan siang', total: 170_500, category_id: w.cat.ksm },
    ],
    ...extra,
  }
}

beforeAll(async () => {
  w = await makeWorld('FM') // letters only (vehicle plate suffix)
  await installLocalJwks()
  staffA = await mobile(w.users.staffA, ['pk-staff'])
  staffB = await mobile(w.users.staffB, ['pk-staff'])
  pm = await mobile(w.users.pm, ['pk-pm'])
})

beforeEach(() => {
  resetRateLimits()
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('POST /api/v1/sync/batch — expense request drafts (ADR 0010)', () => {
  let draftUuid: string
  let requestId: number
  let firstBatch: { items: Item[]; batch_id: string }
  let receiptUuid: string
  let lineWithReceipt: string

  it('offline create (header + lines + receipt) → applied rev 1; server-set creator/total; offline facts stored as comparison values', async () => {
    const media = await uploadMedia('media-receipts', w.users.staffA)
    const payload = reimbursePayload()
    lineWithReceipt = (payload.lines[0] as { client_uuid: string }).client_uuid
    receiptUuid = randomUUID()
    ;(payload.lines[0] as Record<string, unknown>).receipts = [
      { client_uuid: receiptUuid, receipt_no: '7654321', vendor_name: 'SPBU Contoh', receipt_date: '2026-09-21', receipt_time: '11:42', amount: 600_000, media_id: media },
    ]
    const it1 = item('expense_request.draft_upsert', payload)
    draftUuid = it1.client_uuid
    const batchId = randomUUID()
    firstBatch = { items: [it1], batch_id: batchId }
    const r = await sync(staffA, [it1], { batch_id: batchId })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.batch_id).toBe(batchId)
    const res = r.body.results[0]
    expect(res, JSON.stringify(res)).toMatchObject({ client_uuid: it1.client_uuid, status: 'applied', rev: 1, time_trust: 'estimated', errors: [] })
    expect(res.flags).toContain('OFFLINE')
    expect(res.flags).not.toContain('CLIENT_TOTAL_MISMATCH')
    requestId = Number(res.server_id)
    expect(res.server_copy).toMatchObject({ id: requestId, status: 'draft', kind: 'reimburse', grand_total: 770_500, client_uuid: draftUuid, rev: 1, doc_no: null })
    expect(res.server_copy.lines.map((l: { id: string }) => l.id)).toEqual(payload.lines.map((l) => (l as { client_uuid: string }).client_uuid))
    expect(res.server_copy.receipts).toEqual([expect.objectContaining({ client_uuid: receiptUuid, line_id: lineWithReceipt, amount: 600_000, media_id: media, status: 'pending', receipt_time: '11:42' })])

    const er = (await sqlAs('app', 'SELECT created_by_id, source, client_uuid, grand_total::int AS gt, sync_rev::int AS rev FROM expense_requests WHERE id = $1', [requestId])).rows[0]
    expect(er).toMatchObject({ created_by_id: w.users.staffA.id, source: 'apk', client_uuid: draftUuid, gt: 770_500, rev: 1 })
    const sr = (await sqlAs('app', 'SELECT status, offline, device_time, estimated_time, time_trust, received_at, device_id, user_id FROM sync_receipts WHERE client_uuid = $1', [it1.client_uuid])).rows[0]
    expect(sr).toMatchObject({ status: 'applied', offline: true, time_trust: 'estimated', device_id: staffA.device, user_id: w.users.staffA.id })
    expect(new Date(sr.device_time).toISOString()).toBe(new Date(it1.device_time as string).toISOString())
    expect(sr.estimated_time).not.toBeNull()
    expect(Math.abs(new Date(sr.received_at).getTime() - Date.now())).toBeLessThan(60_000) // server time authoritative
    const audit = (await sqlAs('app', "SELECT source, device_id, device_time, new_value FROM audit_logs WHERE action = 'sync_offline' AND doc_id = $1", [String(requestId)])).rows
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ source: 'apk', device_id: staffA.device })
    expect(new Date(audit[0].device_time).toISOString()).toBe(new Date(it1.device_time as string).toISOString())
    expect(audit[0].new_value.v).toMatchObject({ status: 'applied', offline: true, time_trust: 'estimated' })
  })

  it('replaying the same batch → duplicate with the original result, nothing applied twice', async () => {
    const before = (await sqlAs('app', 'SELECT (SELECT count(*)::int FROM expense_requests WHERE client_uuid = $1) AS er, (SELECT count(*)::int FROM receipts WHERE request_id = $2) AS rc, (SELECT count(*)::int FROM audit_logs WHERE doc_id = $3) AS au', [draftUuid, requestId, String(requestId)])).rows[0]
    const r = await sync(staffA, firstBatch.items, { batch_id: firstBatch.batch_id })
    expect(r.status).toBe(200)
    expect(r.body.results[0]).toMatchObject({ status: 'duplicate', original_status: 'applied', server_id: String(requestId), rev: 1 })
    const after = (await sqlAs('app', 'SELECT (SELECT count(*)::int FROM expense_requests WHERE client_uuid = $1) AS er, (SELECT count(*)::int FROM receipts WHERE request_id = $2) AS rc, (SELECT count(*)::int FROM audit_logs WHERE doc_id = $3) AS au', [draftUuid, requestId, String(requestId)])).rows[0]
    expect(after).toEqual(before)
    expect(before.er).toBe(1)
  })

  it('edit with base_rev = rev → applied, rev + 1; receipt upserted by client_uuid (no duplicate row)', async () => {
    const payload: Record<string, unknown> & { lines: Array<Record<string, unknown>> } = reimbursePayload({ draft_client_uuid: draftUuid, title: 'Service Tronton (edit HP)' })
    // keep the line ids of the draft (server ids), change the receipt amount
    const copy = (await sqlAs('app', 'SELECT id FROM expense_requests_lines WHERE _parent_id = $1 ORDER BY _order', [requestId])).rows.map((x) => x.id as string)
    payload.lines = payload.lines.map(({ client_uuid: _c, ...l }, i) => ({ ...l, id: copy[i] }))
    const media = (await sqlAs('app', 'SELECT image_id FROM receipts WHERE client_uuid = $1', [receiptUuid])).rows[0].image_id as number
    ;(payload.lines[0] as Record<string, unknown>).receipts = [{ client_uuid: receiptUuid, receipt_no: '7654321', vendor_name: 'SPBU Contoh', receipt_date: '2026-09-21', amount: 599_000, media_id: media }]
    const r = await sync(staffA, [item('expense_request.draft_upsert', payload, { base_rev: 1 })])
    const res = r.body.results[0]
    expect(res, JSON.stringify(res)).toMatchObject({ status: 'applied', rev: 2 })
    expect(res.server_copy.title).toBe('Service Tronton (edit HP)')
    expect(res.server_copy.receipts).toHaveLength(1)
    expect(res.server_copy.receipts[0]).toMatchObject({ client_uuid: receiptUuid, amount: 599_000 })
  })

  it('stale edit after a web edit → conflict, server wins (server_copy, nothing changed)', async () => {
    const web = await api('PATCH', `${E}/${requestId}`, w.users.staffA, { title: 'Diubah di web' })
    expect(web.status, JSON.stringify(web.body)).toBe(200)
    expect(web.body.rev).toBe(3)
    const it2 = item('expense_request.draft_upsert', { draft_client_uuid: draftUuid, title: 'Edit offline basi' }, { base_rev: 2 })
    const r = await sync(staffA, [it2])
    const res = r.body.results[0]
    expect(res).toMatchObject({ status: 'conflict', server_id: String(requestId), rev: 3, errors: [expect.objectContaining({ code: 'STALE_REV' })] })
    expect(res.server_copy).toMatchObject({ title: 'Diubah di web', rev: 3 })
    const t = (await sqlAs('app', 'SELECT title FROM expense_requests WHERE id = $1', [requestId])).rows[0].title
    expect(t).toBe('Diubah di web')
    // missing base_rev on an existing draft is a conflict too; the conflict is stored (replay = duplicate)
    expect((await sync(staffA, [item('expense_request.draft_upsert', { draft_client_uuid: draftUuid, title: 'x' })])).body.results[0].status).toBe('conflict')
    const replay = await sync(staffA, [it2])
    expect(replay.body.results[0]).toMatchObject({ status: 'duplicate', original_status: 'conflict' })
  })

  it('detail exposes rev, status timeline and "Giliran" (next actor)', async () => {
    const r = await http('GET', `${E}/${requestId}`, { headers: headers(staffA) })
    expect(r.status).toBe(200)
    const b = r.body as { rev: number; timeline: Array<{ status: string; state: string }>; nextActor: { who: string; what: string } }
    expect(b.rev).toBe(3)
    expect(b.timeline[0]).toMatchObject({ status: 'draft', state: 'current' })
    expect(b.timeline.map((s) => s.status)).toEqual(expect.arrayContaining(['pending_approval', 'approved', 'transferred', 'completed']))
    expect(b.nextActor.who).toContain('Pemohon')
  })

  it('removing a line that still has a receipt is rejected (VALIDATION) and the rejection is stored', async () => {
    const it3 = item('expense_request.draft_upsert', { draft_client_uuid: draftUuid, lines: [{ client_uuid: randomUUID(), description: 'Baru', total: 1000 }] }, { base_rev: 3 })
    const r = await sync(staffA, [it3])
    expect(r.body.results[0]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'VALIDATION', field: 'payload.lines' })] })
    expect((await sqlAs('app', 'SELECT sync_rev::int AS rev FROM expense_requests WHERE id = $1', [requestId])).rows[0].rev).toBe(3)
    const replay = await sync(staffA, [it3])
    expect(replay.body.results[0]).toMatchObject({ status: 'duplicate', original_status: 'rejected' })
    const sr = (await sqlAs('app', 'SELECT status FROM sync_receipts WHERE client_uuid = $1', [it3.client_uuid])).rows[0]
    expect(sr.status).toBe('rejected')
    expect((await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'sync_offline' AND new_value->'v'->>'client_uuid' = $1", [it3.client_uuid])).rows[0].n).toBe(1)
  })

  it("authz: another user's draft — unreadable → NOT_FOUND, readable (Q-23 cost-center staff, PM) → NOT_EDITABLE; another user's item id is not replayed", async () => {
    const otherPm = await mobile(w.users.otherPm, ['pk-pm'])
    const byId = await sync(otherPm, [item('expense_request.draft_upsert', { request_id: requestId, title: 'curang' }, { base_rev: 3 })])
    expect(byId.body.results[0]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'NOT_FOUND' })], server_copy: null })
    const byUuid = await sync(otherPm, [item('expense_request.draft_upsert', { draft_client_uuid: draftUuid, title: 'curang' }, { base_rev: 3 })])
    expect(byUuid.body.results[0]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'NOT_FOUND' })], server_copy: null })
    // staff B is assigned to the same cost center → may read (Q-23), never edit; no server copy leaks
    const byStaff = await sync(staffB, [item('expense_request.draft_upsert', { draft_client_uuid: draftUuid, title: 'curang' }, { base_rev: 3 })])
    expect(byStaff.body.results[0]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'NOT_EDITABLE' })], server_copy: null })
    const byPm = await sync(pm, [item('expense_request.draft_upsert', { request_id: requestId, title: 'PM edit' }, { base_rev: 3 })])
    expect(byPm.body.results[0]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'NOT_EDITABLE' })], server_copy: null })
    const del = await sync(staffB, [item('expense_request.draft_delete', { draft_client_uuid: draftUuid })])
    expect(del.body.results[0].status).toBe('rejected')
    // staff A's already-processed item uuid sent by staff B
    const stolen = await sync(staffB, firstBatch.items)
    expect(stolen.body.results[0]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'CLIENT_UUID_CONFLICT' })], server_copy: null })
    const row = (await sqlAs('app', 'SELECT title, status FROM expense_requests WHERE id = $1', [requestId])).rows[0]
    expect(row).toEqual({ title: 'Diubah di web', status: 'draft' })
  })

  it('business rules of the domain apply (G9 bank account, G10 scope, masters) → rejected with field codes', async () => {
    const r = await sync(staffA, [
      item('expense_request.draft_upsert', reimbursePayload({ bank_account_id: w.accB })),
      item('expense_request.draft_upsert', reimbursePayload({ cost_center_id: null, project_id: w.otherProject })),
      item('expense_request.draft_upsert', { title: 'tanpa jenis' }),
      item('expense_request.draft_upsert', { kind: 'reimburse', title: 'x', lines: [{ description: 'minus', total: -5 }] }),
    ])
    const [bank, scope, kind, neg] = r.body.results
    expect(bank).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'VALIDATION', field: 'payload.bank_account_id' })] })
    expect(scope).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'FORBIDDEN' })] })
    expect(kind).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'VALIDATION', field: 'payload.kind' })] })
    expect(neg).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'VALIDATION', field: 'payload.lines.0.total' })] })
    // nothing was created for any of them
    const n = (await sqlAs('app', 'SELECT count(*)::int AS n FROM expense_requests WHERE client_uuid = ANY($1::text[])', [r.body.results.map((x: { client_uuid: string }) => x.client_uuid)])).rows[0].n
    expect(n).toBe(0)
  })

  it('receipts: advance drafts refuse receipts, missing / foreign media are rejected', async () => {
    const own = await uploadMedia('media-receipts', w.users.staffA)
    const foreign = await uploadMedia('media-receipts', w.users.staffB)
    const receipt = (media: number) => ({ client_uuid: randomUUID(), vendor_name: 'Toko', receipt_date: '2026-09-20', amount: 50_000, media_id: media })
    const line = (media: number) => [{ client_uuid: randomUUID(), description: 'Bahan', total: 50_000, category_id: w.cat.mat, receipts: [receipt(media)] }]
    const r = await sync(staffA, [
      item('expense_request.draft_upsert', { ...reimbursePayload(), kind: 'advance', client_grand_total: null, lines: line(own) }),
      item('expense_request.draft_upsert', { ...reimbursePayload(), client_grand_total: null, lines: line(999_999) }),
      item('expense_request.draft_upsert', { ...reimbursePayload(), client_grand_total: null, lines: line(foreign) }),
    ])
    expect(r.body.results.map((x: { errors: Array<{ code: string }> }) => x.errors[0]?.code)).toEqual(['VALIDATION', 'MEDIA_MISSING', 'FORBIDDEN'])
    expect(r.body.results.every((x: { status: string }) => x.status === 'rejected')).toBe(true)
  })

  it('CLIENT_TOTAL_MISMATCH flag; online item → time_trust server; no clock reference → device_only; clock skew flagged', async () => {
    const it1 = item('expense_request.draft_upsert', reimbursePayload({ client_grand_total: 1 }), { offline: false })
    const it2 = item('expense_request.draft_upsert', { ...reimbursePayload(), client_grand_total: null }, { boot_id: 'other-boot', device_time: new Date(Date.now() + 3_600_000).toISOString() })
    const it3 = item('expense_request.draft_upsert', { ...reimbursePayload(), client_grand_total: null }, { device_time: new Date(Date.now() - 7_200_000).toISOString() })
    const r = await sync(staffA, [it1, it2, it3])
    const [a, b, c] = r.body.results
    expect(a).toMatchObject({ status: 'applied', time_trust: 'server' })
    expect(a.flags).toEqual(['CLIENT_TOTAL_MISMATCH'])
    expect(b).toMatchObject({ status: 'applied', time_trust: 'device_only' })
    expect(b.flags).toEqual(['OFFLINE', 'CLOCK_SKEW'])
    expect(c).toMatchObject({ status: 'applied', time_trust: 'estimated' })
    expect(c.flags).toEqual(['OFFLINE', 'CLOCK_SKEW'])
  })

  it('offline create + queued edits in one batch (predicted base_rev 1, 2) → all applied in order', async () => {
    const create = item('expense_request.draft_upsert', { kind: 'advance', title: 'Q v1', project_id: w.project, requester_ids: [w.emp.a] })
    const e1 = item('expense_request.draft_upsert', { draft_client_uuid: create.client_uuid, title: 'Q v2' }, { base_rev: 1, depends_on: [create.client_uuid] })
    const e2 = item('expense_request.draft_upsert', { draft_client_uuid: create.client_uuid, title: 'Q v3' }, { base_rev: 2, depends_on: [e1.client_uuid] })
    const r = await sync(staffA, [create, e1, e2])
    expect(r.body.results.map((x: { status: string; rev: number }) => [x.status, x.rev])).toEqual([
      ['applied', 1],
      ['applied', 2],
      ['applied', 3],
    ])
    expect(r.body.results[2].server_copy.title).toBe('Q v3')
  })

  it('depends_on: unknown item → deferred (not stored); failed item → DEPENDENCY_FAILED', async () => {
    const orphan = item('expense_request.draft_upsert', { ...reimbursePayload(), client_grand_total: null }, { depends_on: [randomUUID()] })
    const r = await sync(staffA, [orphan])
    expect(r.body.results[0]).toMatchObject({ status: 'deferred', errors: [expect.objectContaining({ code: 'DEPENDENCY_PENDING' })] })
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM sync_receipts WHERE client_uuid = $1', [orphan.client_uuid])).rows[0].n).toBe(0)
    const bad = item('expense_request.draft_upsert', { title: 'tanpa jenis' })
    const dep = item('expense_request.draft_upsert', { ...reimbursePayload(), client_grand_total: null }, { depends_on: [bad.client_uuid] })
    const r2 = await sync(staffA, [bad, dep])
    expect(r2.body.results[1]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'DEPENDENCY_FAILED' })] })
  })

  it('draft_delete = soft delete (cancelled); again → ALREADY_CANCELLED; a submitted request → NOT_EDITABLE with server copy', async () => {
    const created = await sync(staffA, [item('expense_request.draft_upsert', { kind: 'advance', title: 'Hapus saya', project_id: w.project })])
    const uuid = created.body.results[0].client_uuid as string
    const del = await sync(staffA, [item('expense_request.draft_delete', { draft_client_uuid: uuid })])
    expect(del.body.results[0]).toMatchObject({ status: 'applied', flags: ['OFFLINE'] })
    expect(del.body.results[0].server_copy.status).toBe('cancelled')
    const again = await sync(staffA, [item('expense_request.draft_delete', { draft_client_uuid: uuid })])
    expect(again.body.results[0].flags).toContain('ALREADY_CANCELLED')
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM expense_requests WHERE client_uuid = $1', [uuid])).rows[0].n).toBe(1) // no hard delete

    // submitted online (web) → offline edit and delete are refused, server version returned
    const d = await api('POST', E, w.users.staffA, draftBody(w))
    expect(d.status, JSON.stringify(d.body)).toBe(201)
    expect((await api('POST', `${E}/${d.body.id}/submit`, w.users.staffA, {})).status).toBe(200)
    const edit = await sync(staffA, [item('expense_request.draft_upsert', { request_id: d.body.id, title: 'telat' }, { base_rev: 1 })])
    expect(edit.body.results[0]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'NOT_EDITABLE' })] })
    expect(edit.body.results[0].server_copy.status).toMatch(/^pending_/)
    const del2 = await sync(staffA, [item('expense_request.draft_delete', { request_id: d.body.id })])
    expect(del2.body.results[0].errors[0].code).toBe('NOT_EDITABLE')
  })

  it('progress items are processed (E4); on-behalf (E6) and feature flags off → FEATURE_DISABLED', async () => {
    const att = item('attendance.on_behalf', { project_id: w.project, lat: -2.2, lng: 113.9 })
    const prog = item('progress_report.draft_upsert', {})
    const r = await sync(staffA, [att, prog])
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(['rejected', 'rejected'])
    expect(r.body.results[0].errors[0].code).toBe('FEATURE_DISABLED') // E6: supported, same switch as check-in
    expect(r.body.results[1].errors[0].code).toBe('VALIDATION') // E4: an empty progress payload is refused (stored)
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM sync_receipts WHERE client_uuid = ANY($1::uuid[])', [[att.client_uuid, prog.client_uuid]])).rows[0].n).toBe(2)
    // F4b: own check-in is supported but off by default (company-settings.syncAttendanceEnabled).
    const own = await sync(staffA, [item('attendance.check_in', { project_id: w.project, lat: -2.2, lng: 113.9, is_mocked: false, selfie_media_id: 1 })])
    expect(own.body.results[0]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'FEATURE_DISABLED' })] })

    const p = await getTestPayload()
    await p.updateGlobal({ slug: 'company-settings', data: { syncExpenseDraftsEnabled: false }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    try {
      const off = await sync(staffA, [item('expense_request.draft_upsert', reimbursePayload())])
      expect(off.body.results[0]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'FEATURE_DISABLED' })] })
    } finally {
      await p.updateGlobal({ slug: 'company-settings', data: { syncExpenseDraftsEnabled: true }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    }
  })

  it('envelope: device_id must match, bearer only, ≤ 50 items, body limit, rate limit 12/min', async () => {
    const one = [item('expense_request.draft_upsert', reimbursePayload())]
    expect((await sync(staffA, one, { device_id: randomUUID() })).status).toBe(400)
    expect((await sync(staffA, [])).status).toBe(400)
    expect((await sync(staffA, Array.from({ length: 51 }, () => item('attendance.check_in', {})))).status).toBe(400)
    expect((await sync(staffA, [item('expense_request.draft_upsert', { notes: 'x'.repeat(300_000) })])).status).toBe(413)
    const noDevice = await http('POST', '/api/v1/sync/batch', { headers: { Authorization: `Bearer ${staffA.token}` }, json: { batch_id: randomUUID(), device_id: staffA.device, clock: clock(), items: one } })
    expect(noDevice.status).toBe(401)
    const web = await api('POST', '/api/v1/sync/batch', w.users.staffA, { batch_id: randomUUID(), device_id: staffA.device, clock: clock(), items: one })
    expect(web.status).toBe(403)
    resetRateLimits()
    const statuses: number[] = []
    for (let i = 0; i < 13; i++) {
      const res = await http('POST', '/api/v1/sync/batch', { headers: headers(staffB), json: { batch_id: randomUUID(), device_id: staffB.device, clock: clock(), items: [item('attendance.check_in', {})] } })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 12).every((s) => s === 200)).toBe(true)
    expect(statuses[12]).toBe(429)
  })
})

describe('GET /api/v1/app/config (public version gate)', () => {
  it('no auth needed; versions, download URL, timezone, features (push off), sync limits; update flags with ?version', async () => {
    const p = await getTestPayload()
    await p.updateGlobal({
      slug: 'company-settings',
      data: { minAppVersion: '1.2.0', latestAppVersion: '1.4.1', appDownloadUrl: 'https://drms-kas.staging.bimacreative.tech/unduh/proyekkas.apk' },
      overrideAccess: true, // SYSTEM-WRITE: fixture
    })
    resetAppConfigCache()
    resetMinVersionCache()
    try {
      const r = await http('GET', '/api/v1/app/config?version=1.1.9')
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('public, max-age=60')
      expect(r.body).toMatchObject({
        minSupportedVersion: '1.2.0',
        latestVersion: '1.4.1',
        downloadUrl: 'https://drms-kas.staging.bimacreative.tech/unduh/proyekkas.apk',
        updateRequired: true,
        updateAvailable: true,
        timezone: 'Asia/Makassar',
        android: { packageName: 'id.co.drms.proyekkas' },
        features: { pushEnabled: false, syncExpenseDrafts: true, syncAttendance: false, syncProgressReports: true },
        sync: { maxItemsPerBatch: 50, maxBatchBytes: 262144, rateLimitPerMinute: 12 },
      })
      const cur = await http('GET', '/api/v1/app/config?version=1.4.1')
      expect(cur.body).toMatchObject({ updateRequired: false, updateAvailable: false })
      expect((await http('GET', '/api/v1/app/config')).body).toMatchObject({ updateRequired: null, updateAvailable: null })
      expect((await http('GET', '/api/v1/app/config?version=abc')).status).toBe(400)
      // the same minimum is enforced on authenticated calls (426) — the gate endpoint itself stays reachable
      expect((await http('GET', '/api/v1/me', { headers: headers(staffA) })).status).toBe(426)
      expect((await http('GET', '/api/v1/app/config', { headers: headers(staffA) })).status).toBe(200)
    } finally {
      await p.updateGlobal({ slug: 'company-settings', data: { minAppVersion: null, latestAppVersion: null, appDownloadUrl: null }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
      resetAppConfigCache()
      resetMinVersionCache()
    }
  })

  it('admin/owner can edit the gate fields; an http download URL is refused', async () => {
    const r = await api('POST', '/api/globals/company-settings', w.users.owner, { appDownloadUrl: 'http://insecure.test/app.apk' })
    expect(r.status).toBe(400)
    const ok = await api('POST', '/api/globals/company-settings', w.users.admin, { latestAppVersion: '1.0.1' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const staff = await api('POST', '/api/globals/company-settings', w.users.staffA, { latestAppVersion: '9.9.9' })
    expect(staff.status).toBe(403)
  })
})

describe('/.well-known/assetlinks.json (Android App Links)', () => {
  const FP = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89'
  const load = async () => (await import('@/app/.well-known/assetlinks.json/route')).GET()

  it('statement with package + fingerprints from env; public JSON, cacheable', async () => {
    process.env.ANDROID_APP_CERT_SHA256 = ` ${FP.toLowerCase()} ,${FP.replace('AB', '11')}`
    resetEnvCache()
    try {
      const res = await load()
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/json')
      expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
      expect(await res.json()).toEqual([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: { namespace: 'android_app', package_name: 'id.co.drms.proyekkas', sha256_cert_fingerprints: [FP, FP.replace('AB', '11')] },
        },
      ])
    } finally {
      delete process.env.ANDROID_APP_CERT_SHA256
      resetEnvCache()
    }
  })

  it('no fingerprints configured → [] (verification fails closed)', async () => {
    const res = await load()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

describe('device registry for the APK (ADR 0003 §5 / ADR 0010)', () => {
  it('an unknown install id or another user\'s device is a plain 401 (no DEVICE_REVOKED hint)', async () => {
    const m = await mobile(w.users.staffA, ['pk-staff'])
    const unknown = await http('GET', '/api/v1/me', { headers: headers(m, { 'X-Device-Id': randomUUID() }) })
    expect(unknown.status).toBe(401)
    expect((unknown.body as { code?: string }).code).toBeUndefined()
    const other = await mobile(w.users.pm, ['pk-pm'])
    const foreign = await http('GET', '/api/v1/me', { headers: headers(m, { 'X-Device-Id': other.device }) })
    expect(foreign.status).toBe(401)
    expect((foreign.body as { code?: string }).code).toBeUndefined()
  })

  it('integrity signals (F4b): stored with risk + time, audited on change, omitted → kept, never blocking', async () => {
    const m = await mobile(w.users.staffA, ['pk-staff'])
    const reg = (json: Record<string, unknown>) => http('POST', '/api/v1/devices/register', { headers: headers(m), json: { deviceId: m.device, platform: 'android', ...json } })
    const read = async () =>
      (await sqlAs('app', 'SELECT id, integrity_risk, integrity_rooted, integrity_emulator, integrity_developer_mode, integrity_adb_enabled, integrity_mock_location, integrity_checked_at FROM devices WHERE device_id = $1', [m.device])).rows[0]
    const before = await read()
    expect(before.integrity_risk).toBe(false)
    expect(before.integrity_checked_at).toBeNull()
    const clean = { rooted: false, emulator: false, developerMode: true, adbEnabled: true, mockLocation: null }
    const r1 = await reg({ integrity: clean })
    expect(r1.status).toBe(200)
    expect(r1.body).toMatchObject({ integrityRisk: false })
    expect((r1.body as { integrityCheckedAt: string | null }).integrityCheckedAt).not.toBeNull()
    const rooted = await reg({ integrity: { ...clean, rooted: true } })
    expect(rooted.status).toBe(200) // recorded, not blocked (QM-4)
    expect(rooted.body).toMatchObject({ integrityRisk: true, status: 'active' })
    expect(await read()).toMatchObject({ integrity_risk: true, integrity_rooted: true, integrity_developer_mode: true, integrity_adb_enabled: true, integrity_mock_location: null })
    expect((await http('GET', '/api/v1/me', { headers: headers(m) })).status).toBe(200)
    expect((await reg({ appVersion: '1.0.4' })).status).toBe(200)
    expect((await read()).integrity_rooted).toBe(true)
    const rows = await auditRows('device', before.id as number)
    expect(rows.some((x) => x.field === 'integrityRisk' && JSON.stringify(x.new_value).includes('true'))).toBe(true)
    expect(rows.some((x) => x.field === 'integrityCheckedAt')).toBe(false)
    const bad = await reg({ integrity: { ...clean, rooted: 'no' } })
    expect(bad.status).toBe(400)
  })

  it('registration stores platform/model/version; push token nullable (null clears, omitted keeps)', async () => {
    const m = await mobile(w.users.finance, ['pk-finance'])
    const reg = (json: Record<string, unknown>) => http('POST', '/api/v1/devices/register', { headers: headers(m), json: { deviceId: m.device, platform: 'android', ...json } })
    expect((await reg({ model: 'Pixel', appVersion: '1.0.2', fcmToken: 'tok-1' })).status).toBe(200)
    const read = async () => (await sqlAs('app', 'SELECT platform, model, app_version, fcm_token FROM devices WHERE device_id = $1', [m.device])).rows[0]
    expect(await read()).toEqual({ platform: 'android', model: 'Pixel', app_version: '1.0.2', fcm_token: 'tok-1' })
    expect((await reg({ appVersion: '1.0.3' })).status).toBe(200)
    expect((await read()).fcm_token).toBe('tok-1')
    expect((await reg({ fcmToken: null })).status).toBe(200)
    expect((await read()).fcm_token).toBeNull()
  })

  it('a device marked lost/revoked by an admin is blocked on the NEXT request (also sync) and cannot re-register', async () => {
    const m = await mobile(w.users.staffB, ['pk-staff'])
    expect((await http('GET', '/api/v1/me', { headers: headers(m) })).status).toBe(200)
    const dev = (await sqlAs('app', 'SELECT id FROM devices WHERE device_id = $1', [m.device])).rows[0].id as number
    const r = await api('PATCH', `/api/devices/${dev}`, w.users.admin, { status: 'lost', revokeReason: 'HP hilang di lokasi', changeReason: 'HP hilang di lokasi' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const me = await http('GET', '/api/v1/me', { headers: headers(m) })
    expect(me.status).toBe(401)
    // F4b: a valid token on a revoked/lost device says so → the APK logs out without refreshing.
    expect(me.body).toMatchObject({ status: 401, code: 'DEVICE_REVOKED' })
    expect((me.body as { detail: string }).detail).toMatch(/dicabut/)
    const s = await sync(m, [item('attendance.check_in', {})])
    expect(s.status).toBe(401)
    expect(s.body.code).toBe('DEVICE_REVOKED')
    const again = await http('POST', '/api/v1/devices/register', { headers: headers(m), json: { deviceId: m.device, platform: 'android' } })
    expect(again.status).toBe(403)
    const rows = await auditRows('device', dev)
    expect(rows.map((x) => x.action)).toContain('device_revoke')
  })
})
