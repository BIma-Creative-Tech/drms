import { randomBytes, randomUUID } from 'node:crypto'

import type { CollectionSlug, Payload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { canRevoke } from '@/domain/devices'
import { addDays } from '@/domain/expense/types'
import { resetRateLimits } from '@/lib/rate-limit'
import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'

import { api, asUser, makeFlowUser, png, sysCreate, upload, type FlowUser, type Res } from './flow-world'
import { addMembership, companyId, getTestPayload, installFakeKeycloak, sqlAs, withContext } from './helpers'

/**
 * PT scope rule (owner decision 2026-10-02, ADR 0016 "Scope rule"): read + search scope = the PTs a
 * user is MAPPED to (active memberships in active PTs). 1 PT → that PT only; ≥ 2 PTs → consolidated
 * over THOSE PTs, never an unmapped one; mutations single-PT; group admin keeps its ADR powers.
 * Closes QA-MC4-05 (deactivated PT media), QA-MC4-06 (duplicate receipts across PTs), QA-MC4-07
 * (media lists by `ownerCompany`) and the LOW findings QA-MC4-08/10/11/12 + /me, notifications.
 *
 * PTs: A = #1 DRMS, B = "PT Skop Dua" (SK2), C = "PT Skop Tiga" (SK3, never mapped to the 2-PT user),
 * D = "PT Skop Empat" (SK4, deactivated by a test). B/C/D are deactivated in afterAll.
 *
 *   staffA1 = Staff in A only (1-PT user)        staffAB = Staff in A and B (2-PT user, uploader)
 *   staffB / staffC / staffD = Staff of that PT   finA = Finance A only; finAB = Finance A + B
 *   ownerA = Direktur A; adminA = Admin A (NOT group admin); groupAdmin = Admin A + users.groupAdmin
 */
let p: Payload
let A = 0
let B = 0
let C = 0
let D = 0
const X: Record<string, number> = {}
type Fx = { project: number; cat: number }
type Emp = { emp: number; acc: number }
const PT_FX: Partial<Record<'A' | 'B' | 'C' | 'D', Fx>> = {}
const EMPS: Partial<Record<'A1' | 'ABa' | 'ABb' | 'B' | 'C' | 'D', Emp>> = {}
type Who = 'staffA1' | 'staffAB' | 'staffB' | 'staffC' | 'staffD' | 'finA' | 'finAB' | 'finD' | 'ownerA' | 'adminA' | 'groupAdmin'
const U = {} as Record<Who, FlowUser>
const tag = randomUUID().slice(0, 6).toUpperCase()
const E = '/api/v1/expense-requests'
type Body = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const key = () => ({ 'Idempotency-Key': randomUUID() })
const yesterday = () => addDays(new Date().toISOString().slice(0, 10), -1)
const call = async (method: string, path: string, user: FlowUser, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
  resetRateLimits()
  return api(method, path, user, body, headers)
}
const ok = async (r: Promise<Res>, status = 200): Promise<Body> => {
  const res = await r
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status)
  return res.body as Body
}
const docRef = async (id: number) => {
  const r = (await sqlAs('app', 'SELECT doc_no FROM expense_requests WHERE id = $1', [id])).rows[0] as { doc_no: string | null }
  return r.doc_no ?? `#${id}`
}
const dupFlags = (body: Body) => (body.flags as Body[]).filter((f) => f.kind === 'duplicate')

async function inPt(company: number, collection: CollectionSlug, code: string): Promise<number> {
  return (await p.find({ collection, where: { and: [{ company: { equals: company } }, { code: { equals: code } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
}

/** Project + MAT category of a PT; `employee` assigned to the project with a default bank account. */
async function ptFixture(company: number, code: string) {
  const project = await sysCreate('projects', { company, code: `${code}-${tag}`, name: `Proyek ${code}`, budget: 500_000_000, status: 'berjalan' })
  return { project, cat: await inPt(company, 'expense-categories', 'MAT') }
}
async function staffEmployee(company: number, project: number, code: string) {
  const emp = await sysCreate('employees', { company, code: `${code}-${tag}`, name: `Karyawan ${code}` })
  await sysCreate('team-assignments', { employee: emp, project, roleInProject: 'staff' })
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id
  const acc = await sysCreate('employee-bank-accounts', { employee: emp, bank, accountNo: `8${Date.now() % 1e9}${Math.floor(Math.random() * 90 + 10)}`, accountHolder: `Karyawan ${code}`, isDefault: true })
  return { emp, acc }
}

/** Image bytes no other suite produces (the shared DB holds every suite's receipts; `png()` repeats across files). */
const uniquePng = () => sharp(randomBytes(24 * 24 * 3), { raw: { width: 24, height: 24, channels: 3 } }).png().toBuffer()

type Receipt = { no: string; vendor: string; amount: number; bytes?: Buffer }
/** Reimburse draft with ONE line + ONE receipt (receipt total = line total → no amount flag). */
async function draftWithReceipt(user: FlowUser, f: { project: number; cat: number }, e: { emp: number; acc: number }, rc: Receipt, type: 'reimburse' | 'advance' = 'reimburse') {
  const d = await ok(
    call('POST', E, user, { type, title: `Uji skop ${rc.no}`, projectId: f.project, requesterIds: [e.emp], bankAccountId: e.acc, neededDate: '2026-12-30', lines: [{ description: 'Material', total: rc.amount, categoryId: f.cat }] }, key()),
    201,
  )
  if (type === 'advance') return { id: d.id as number, receiptId: 0, mediaId: 0 }
  const img = await upload('/api/v1/media/receipts', user, rc.bytes ?? (await uniquePng()))
  expect(img.status, JSON.stringify(img.body)).toBe(201)
  const r = await ok(call('POST', `${E}/${d.id}/receipts`, user, { lineId: d.lines[0].id, receiptNo: rc.no, vendorName: rc.vendor, receiptDate: yesterday(), amount: rc.amount, imageId: img.body.id }, key()), 201)
  return { id: d.id as number, receiptId: (r.receipts as Body[])[0]!.id as number, mediaId: img.body.id as number }
}

beforeAll(async () => {
  p = await getTestPayload()
  installFakeKeycloak()
  const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
  const pt = (name: string, shortCode: string) => ({ ...drms, company: { name, shortCode, timezone: 'Asia/Makassar' }, vehicles: [] })
  await seed(p, { uoms, banks, companies: [drms, pt('PT Skop Dua', 'SK2'), pt('PT Skop Tiga', 'SK3'), pt('PT Skop Empat', 'SK4')] })
  A = await companyId()
  B = await companyId('SK2')
  C = await companyId('SK3')
  D = await companyId('SK4')
  for (const c of [B, C, D]) await p.update({ collection: 'companies', id: c, data: { active: true, changeReason: 'uji aturan skop PT' } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })

  const fA = await ptFixture(A, 'SKA')
  const fB = await ptFixture(B, 'SKB')
  const fC = await ptFixture(C, 'SKC')
  const fD = await ptFixture(D, 'SKD')
  Object.assign(X, { projA: fA.project, projB: fB.project, projC: fC.project, catA: fA.cat, catB: fB.cat, catC: fC.cat })
  const eA1 = await staffEmployee(A, fA.project, 'SA1')
  const eABa = await staffEmployee(A, fA.project, 'SABA')
  const eABb = await staffEmployee(B, fB.project, 'SABB')
  const eB = await staffEmployee(B, fB.project, 'SB')
  const eC = await staffEmployee(C, fC.project, 'SC')
  const eD = await staffEmployee(D, fD.project, 'SD')
  X.accB = eB.acc
  X.cashB = await sysCreate('cash-accounts', { company: B, name: `Kas B ${tag}`, kind: 'bank', openingBalance: 10_000_000 })
  X.cashA = await sysCreate('cash-accounts', { company: A, name: `Kas A ${tag}`, kind: 'bank', openingBalance: 50_000_000 })

  U.staffA1 = await makeFlowUser(['pk-staff'], 'sk-staff-a1', eA1.emp)
  U.staffAB = await makeFlowUser(['pk-staff'], 'sk-staff-ab', eABa.emp)
  await addMembership(U.staffAB.id, B, ['pk-staff'], eABb.emp)
  U.staffB = await makeFlowUser(['pk-staff'], 'sk-staff-b', eB.emp, { company: B })
  U.staffC = await makeFlowUser(['pk-staff'], 'sk-staff-c', eC.emp, { company: C })
  U.staffD = await makeFlowUser(['pk-staff'], 'sk-staff-d', eD.emp, { company: D })
  U.finA = await makeFlowUser(['pk-finance'], 'sk-fin-a', null)
  U.finAB = await makeFlowUser(['pk-finance'], 'sk-fin-ab', null)
  await addMembership(U.finAB.id, B, ['pk-finance'])
  U.finD = await makeFlowUser(['pk-finance'], 'sk-fin-d', null, { company: D, signature: false })
  U.ownerA = await makeFlowUser(['pk-owner'], 'sk-owner-a', null)
  U.adminA = await makeFlowUser(['pk-admin'], 'sk-admin-a', null, { groupAdmin: false, signature: false })
  U.groupAdmin = await makeFlowUser(['pk-admin'], 'sk-group-admin', null, { groupAdmin: true, signature: false })
  Object.assign(PT_FX, { A: fA, B: fB, C: fC, D: fD })
  Object.assign(EMPS, { A1: eA1, ABa: eABa, ABb: eABb, B: eB, C: eC, D: eD })
})

afterAll(async () => {
  for (const c of [B, C, D]) {
    if (c) await p.update({ collection: 'companies', id: c, data: { active: false, changeReason: 'uji aturan skop PT selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: fixture cleanup */ })
  }
  await p.destroy()
})

const F = () => PT_FX as Record<'A' | 'B' | 'C' | 'D', Fx>
const EMP = () => EMPS as Record<'A1' | 'ABa' | 'ABb' | 'B' | 'C' | 'D', Emp>

// ================================================================================ read scope
describe('scope rule: reads and searches = the mapped PTs', () => {
  it('1-PT user: list = own PT only; a foreign PT in X-Company-Ids → 403; a request of another PT → 404', async () => {
    const own = await draftWithReceipt(U.staffA1, F().A, EMP().A1, { no: `R1-${tag}`, vendor: 'Toko Satu', amount: 120_000 })
    const other = await draftWithReceipt(U.staffB, F().B, EMP().B, { no: `R2-${tag}`, vendor: 'Toko Dua', amount: 130_000 })
    const list = await ok(call('GET', `${E}?scope=mine&limit=100`, U.staffA1))
    const ids = (list.items as Body[]).map((i) => i.id)
    expect(ids).toContain(own.id)
    expect(ids).not.toContain(other.id)
    expect((await call('GET', `${E}?limit=10`, U.staffA1, undefined, { 'X-Company-Ids': String(B) })).status).toBe(403)
    expect((await call('GET', `${E}/${other.id}`, U.staffA1)).status).toBe(404)
    expect((await call('GET', `/api/expense-requests/${other.id}`, U.staffA1)).status).toBe(404)
  })

  it('2-PT user: consolidated list over A + B; narrowed by X-Company-Ids; C (unmapped) → 404 / 403', async () => {
    const inA = await draftWithReceipt(U.staffAB, F().A, EMP().ABa, { no: `R3-${tag}`, vendor: 'Toko Tiga', amount: 140_000 })
    const inB = await draftWithReceipt(U.staffAB, F().B, EMP().ABb, { no: `R4-${tag}`, vendor: 'Toko Empat', amount: 150_000 })
    const inC = await draftWithReceipt(U.staffC, F().C, EMP().C, { no: `R5-${tag}`, vendor: 'Toko Lima', amount: 160_000 })
    const all = (await ok(call('GET', `${E}?scope=mine&limit=100`, U.staffAB))).items as Body[]
    expect(all.map((i) => i.id)).toEqual(expect.arrayContaining([inA.id, inB.id]))
    expect(all.map((i) => i.id)).not.toContain(inC.id)
    const onlyB = (await ok(call('GET', `${E}?scope=mine&limit=100`, U.staffAB, undefined, { 'X-Company-Ids': String(B) }))).items as Body[]
    expect(onlyB.map((i) => i.id)).toContain(inB.id)
    expect(onlyB.map((i) => i.id)).not.toContain(inA.id)
    expect((await call('GET', `${E}?limit=10`, U.staffAB, undefined, { 'X-Company-Ids': `${A},${C}` })).status).toBe(403)
    expect((await call('GET', `${E}/${inC.id}`, U.staffAB)).status).toBe(404)
    expect((await call('GET', `/api/v1/media/receipts/${inC.mediaId}/file`, U.staffAB)).status).toBe(404)
  })
})

// ================================================================================ QA-MC4-06
describe('QA-MC4-06: duplicate receipts — search over the uploader\'s mapped PTs, display per viewer', () => {
  const X2 = (): Receipt => ({ no: `DUP2-${tag}`, vendor: 'Toko Ganda', amount: 250_000 })

  beforeAll(async () => {
    // the same receipt (number + vendor + amount) already used in PT B and in PT C
    X.rB = (await draftWithReceipt(U.staffB, F().B, EMP().B, X2())).id
    X.rC = (await draftWithReceipt(U.staffC, F().C, EMP().C, X2())).id
    X.rB1 = (await draftWithReceipt(U.staffB, F().B, EMP().B, { no: `DUP1-${tag}`, vendor: 'Toko Satu Ganda', amount: 99_000 })).id
    X.rC3 = (await draftWithReceipt(U.staffC, F().C, EMP().C, { no: `DUP3-${tag}`, vendor: 'Toko Tiga Ganda', amount: 77_000 })).id
  })

  it('1-PT user: a receipt also used in PT B raises NO flag (search = own PT only)', async () => {
    const r = await draftWithReceipt(U.staffA1, F().A, EMP().A1, { no: `DUP1-${tag}`, vendor: 'Toko Satu Ganda', amount: 99_000 })
    expect(dupFlags(await ok(call('GET', `${E}/${r.id}`, U.staffA1)))).toEqual([])
    expect(Number((await sqlAs('app', "SELECT count(*)::int AS n FROM receipt_flags WHERE request_id = $1 AND kind = 'duplicate'", [r.id])).rows[0]!.n)).toBe(0)
  })

  it('control, same PT: a 1-PT user\'s duplicate inside A is flagged with the doc number, visible to Finance A', async () => {
    const bytes = await uniquePng()
    const first = await draftWithReceipt(U.staffA1, F().A, EMP().A1, { no: `SAME-${tag}`, vendor: 'Toko Sama', amount: 55_000, bytes })
    const again = await draftWithReceipt(U.staffA1, F().A, EMP().A1, { no: `SAME2-${tag}`, vendor: 'Toko Lain', amount: 56_000, bytes })
    const seen = dupFlags(await ok(call('GET', `${E}/${again.id}`, U.finA)))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ relatedRequestId: first.id })
    expect(seen[0]!.message).toContain(await docRef(first.id))
    expect((await sqlAs('app', 'SELECT related_company_id FROM receipt_flags WHERE id = $1', [seen[0]!.id])).rows[0]!.related_company_id).toBeNull()
  })

  it('2-PT user: the hit in mapped PT B is flagged (relatedCompany = B); the hit in unmapped PT C is not', async () => {
    const r = await draftWithReceipt(U.staffAB, F().A, EMP().ABa, X2())
    X.rA2 = r.id
    X.rA2receipt = r.receiptId
    const mine = dupFlags(await ok(call('GET', `${E}/${r.id}`, U.staffAB)))
    expect(mine.map((f) => f.relatedRequestId)).toEqual([X.rB])
    expect(mine[0]!.message).toContain(await docRef(X.rB!))
    X.flagAB = mine[0]!.id as number
    const rows = (await sqlAs('app', "SELECT related_request_id, related_company_id FROM receipt_flags WHERE request_id = $1 AND kind = 'duplicate'", [r.id])).rows
    expect(rows).toEqual([{ related_request_id: X.rB, related_company_id: B }])
  })

  it('no existence oracle: a receipt that exists only in unmapped PT C gives the same answer as a new one', async () => {
    const hitInC = await draftWithReceipt(U.staffAB, F().A, EMP().ABa, { no: `DUP3-${tag}`, vendor: 'Toko Tiga Ganda', amount: 77_000 })
    const fresh = await draftWithReceipt(U.staffAB, F().A, EMP().ABa, { no: `NEW-${tag}`, vendor: 'Toko Baru', amount: 77_000 })
    const a = await ok(call('GET', `${E}/${hitInC.id}`, U.staffAB))
    const b = await ok(call('GET', `${E}/${fresh.id}`, U.staffAB))
    expect(a.flags).toEqual([])
    expect(b.flags).toEqual([])
  })

  it('display: Finance of A + B sees the flag with number and link; Finance of A only sees nothing of it (detail, REST, flag id)', async () => {
    const both = dupFlags(await ok(call('GET', `${E}/${X.rA2}`, U.finAB)))
    expect(both).toHaveLength(1)
    expect(both[0]).toMatchObject({ relatedRequestId: X.rB })
    expect(both[0]!.message).toContain(await docRef(X.rB!))

    const onlyA = await ok(call('GET', `${E}/${X.rA2}`, U.finA))
    expect(dupFlags(onlyA)).toEqual([])
    expect(JSON.stringify(onlyA)).not.toContain(await docRef(X.rB!))
    const rest = await ok(call('GET', `/api/receipt-flags?limit=0&depth=0&where[request][equals]=${X.rA2}`, U.finA))
    expect(rest.totalDocs).toBe(0)
    expect((await ok(call('GET', `/api/receipt-flags?limit=0&depth=0&where[request][equals]=${X.rA2}`, U.finAB))).totalDocs).toBe(1)
    expect([403, 404]).toContain((await call('GET', `/api/receipt-flags/${X.flagAB}`, U.finA)).status)
    // Direktur A (A only) neither
    expect(dupFlags(await ok(call('GET', `${E}/${X.rA2}`, U.ownerA)))).toEqual([])
  })

  it('audit trail: the flag rows carry no PT; Riwayat shows them only to viewers mapped to B; the audit log only to group admins', async () => {
    const rows = (await sqlAs('app', "SELECT company_id, new_value FROM audit_logs WHERE doc_type = 'expense_request' AND doc_id = $1 AND action = 'flag_raised' AND field = 'duplicate'", [String(X.rA2)])).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]!.company_id).toBeNull()
    expect((rows[0]!.new_value as { v: { relatedCompanyId: number } }).v.relatedCompanyId).toBe(B)
    const histA = await ok(call('GET', `${E}/${X.rA2}/history`, U.finA))
    expect(JSON.stringify(histA)).not.toContain('"flag_raised"')
    const histAB = await ok(call('GET', `${E}/${X.rA2}/history`, U.finAB))
    expect(JSON.stringify(histAB)).toContain('"flag_raised"')
    const q = `/api/audit-logs?limit=0&depth=0&where[docId][equals]=${X.rA2}&where[action][equals]=flag_raised`
    expect((await ok(call('GET', q, U.adminA))).totalDocs).toBe(0)
    expect((await ok(call('GET', q, U.groupAdmin))).totalDocs).toBe(1)
  })

  it('flow: counts and the stored decision count exclude it; Finance A cannot review it (404) and verifies without it; Finance A + B must review it', async () => {
    const id = X.rA2!
    let d = await ok(call('POST', `${E}/${id}/submit`, U.staffAB, {}, key()))
    if (d.status === 'pending_ack') d = await ok(call('POST', `${E}/${id}/acknowledge`, U.ownerA, {}, key()))
    expect(d.status).toBe('pending_approval')
    const inboxA = (await ok(call('GET', '/api/v1/approvals/inbox', U.finA))).items as Body[]
    expect(inboxA.find((i) => i.id === id)?.flags).toMatchObject({ warning: 0 })
    const inboxAB = (await ok(call('GET', '/api/v1/approvals/inbox', U.finAB))).items as Body[]
    expect(inboxAB.find((i) => i.id === id)?.flags).toMatchObject({ warning: 1 })
    d = await ok(call('POST', `${E}/${id}/approve`, U.finA, {}, key()))
    expect(d.status).toBe('approved')
    const stored = (await sqlAs('app', 'SELECT open_flags FROM approvals WHERE request_id = $1', [id])).rows.map((r) => Number(r.open_flags))
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.every((n) => n === 0)).toBe(true) // read by everyone who reads the request
    expect((await call('POST', `${E}/${id}/flags/${X.flagAB}/review`, U.finA, { note: 'cek' }, key())).status).toBe(404)
    await ok(call('POST', `${E}/${id}/receipts/${X.rA2receipt}/verify`, U.finA, {}, key()))
    const blocked = await call('POST', `${E}/${id}/verify-receipts`, U.finAB, {}, key())
    expect(blocked.status).toBe(409)
    const done = await ok(call('POST', `${E}/${id}/verify-receipts`, U.finA, {}, key()))
    expect(done.status).toBe('receipts_verified')
  })
})

// ================================================================================ QA-MC4-05 / 07
describe('QA-MC4-05 / QA-MC4-07: media of a PT only for users mapped to it; ownerCompany derived by the DB', () => {
  let finEveryActive: FlowUser
  let rD: { id: number; mediaId: number }

  beforeAll(async () => {
    rD = await draftWithReceipt(U.staffD, F().D, EMP().D, { no: `MD-${tag}`, vendor: 'Toko D', amount: 66_000 })
    // Finance in every ACTIVE PT except D (the QA-MC4-05 precondition once D is deactivated)
    const active = (await sqlAs('app', 'SELECT id FROM companies WHERE active ORDER BY id')).rows.map((r) => Number(r.id)).filter((c) => c !== D)
    finEveryActive = await makeFlowUser(['pk-finance'], 'sk-fin-every', null, { signature: false })
    for (const c of active) if (c !== A) await addMembership(finEveryActive.id, c, ['pk-finance'])
  })

  it('ownerCompany = the PT of the owner document (receipts, selfies), whatever a client writes', async () => {
    const own = (id: number, t = 'media_receipts') => sqlAs('app', `SELECT owner_company_id AS c FROM ${t} WHERE id = $1`, [id]).then((r) => Number(r.rows[0]!.c))
    expect(await own(rD.mediaId)).toBe(D)
    await sqlAs('app', 'UPDATE media_receipts SET owner_company_id = $1 WHERE id = $2', [A, rD.mediaId])
    expect(await own(rD.mediaId)).toBe(D) // trigger re-derives
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 9, g: 9, b: 9 } } }).jpeg().toBuffer()
    const selfie = await p.create({ collection: 'media-selfies', data: {}, file: { data: bytes, mimetype: 'image/jpeg', name: 's.jpg', size: bytes.length }, user: U.staffB, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    expect((await sqlAs('app', 'SELECT owner_company_id AS c FROM media_selfies WHERE id = $1', [selfie.id])).rows[0]!.c).toBeNull()
    await sysCreate('attendances', {
      employee: EMP().B.emp, user: U.staffB.id, kind: 'check_in', project: F().B.project, localDate: '2026-09-03', attendanceTime: '2026-09-03T00:30:00.000Z', receivedAt: '2026-09-03T00:30:01.000Z',
      timeTrust: 'server', lat: -3.32, lng: 114.59, distanceM: 5, selfie: selfie.id, clientUuid: randomUUID(), company: B,
    })
    expect(await own(selfie.id as number, 'media_selfies')).toBe(B)
  })

  it('office list: one ownerCompany predicate — no unbounded load of the office PTs\' requests', async () => {
    const seen: Array<{ where: unknown }> = []
    const orig = p.find.bind(p)
    p.find = (async (a: Parameters<Payload['find']>[0]) => {
      if (a.collection === 'expense-requests' && a.pagination === false) seen.push({ where: a.where })
      return orig(a)
    }) as Payload['find']
    let ids: number[] = []
    try {
      const r = await ok(call('GET', '/api/media-receipts?limit=500&depth=0', U.finA))
      ids = (r.docs as Body[]).map((d) => d.id as number)
    } finally {
      p.find = orig
    }
    expect(ids).not.toContain(rD.mediaId)
    for (const s of seen) expect(JSON.stringify(s.where)).toContain('not_in') // own/team requests OUTSIDE the office PTs only
  })

  it('D active: Finance of D reads the file, Finance of every other active PT does not', async () => {
    expect((await call('GET', `/api/v1/media/receipts/${rD.mediaId}/file`, U.finD)).status).toBe(200)
    expect((await call('GET', `/api/v1/media/receipts/${rD.mediaId}/file`, finEveryActive)).status).toBe(404)
  })

  it('D deactivated: still 404 for Finance of every remaining active PT (was 200), for the former members of D and a group admin; list excludes it', async () => {
    await p.update({ collection: 'companies', id: D, data: { active: false, changeReason: 'uji QA-MC4-05' } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    expect((await call('GET', `/api/v1/media/receipts/${rD.mediaId}/file`, finEveryActive)).status).toBe(404)
    expect((await call('GET', `/api/v1/media/receipts/${rD.mediaId}/file`, U.finD)).status).toBe(404)
    expect((await call('GET', `/api/v1/media/receipts/${rD.mediaId}/file`, U.groupAdmin)).status).toBe(404)
    const list = await ok(call('GET', '/api/media-receipts?limit=1000&depth=0', finEveryActive))
    expect((list.docs as Body[]).map((d) => d.id)).not.toContain(rD.mediaId)
    // the uploader is no longer mapped to any active PT either (no company context, no role) → 404
    expect((await call('GET', `/api/v1/media/receipts/${rD.mediaId}/file`, U.staffD)).status).toBe(404)
  })
})

// ================================================================================ LOW findings
describe('LOW findings closed under the rule (QA-MC4-08 / 10 / 11 / 12, /me, notifications)', () => {
  it('QA-MC4-08: a stage template of another PT is answered like a missing one (nothing copied)', async () => {
    const items = [{ name: 'Rahasia B', weightPct: 100, sequence: 1 }]
    const tB = await sysCreate('stage-templates', { company: B, name: `Templat B ${tag}`, items, active: true })
    const tA = await sysCreate('stage-templates', { company: A, name: `Templat A ${tag}`, items: [{ name: 'Tahap A', weightPct: 100, sequence: 1 }], active: true })
    const proj = await sysCreate('projects', { company: A, code: `SKT-${tag}`, name: 'Proyek templat', budget: 1_000_000, status: 'berjalan' })
    const foreign = await call('PUT', `/api/v1/projects/${proj}/stages`, U.ownerA, { templateId: tB }, key())
    const missing = await call('PUT', `/api/v1/projects/${proj}/stages`, U.ownerA, { templateId: 999_999_999 }, key())
    expect(foreign.status).toBe(400)
    expect(foreign.body).toEqual(missing.body)
    expect(JSON.stringify(foreign.body)).not.toContain('Rahasia B')
    expect((await call('PUT', `/api/v1/projects/${proj}/stages`, U.ownerA, { templateId: tA }, key())).status).toBe(200)
  })

  it('QA-MC4-10: draft references of another PT (project, bank account, category) = the same 400 as missing ones', async () => {
    const base = { type: 'reimburse', title: 'Oracle', requesterIds: [EMP().A1.emp], neededDate: '2026-12-30' }
    const proj = await call('POST', E, U.staffA1, { ...base, projectId: X.projB, bankAccountId: EMP().A1.acc, lines: [{ description: 'x', total: 1000, categoryId: X.catA }] }, key())
    const projMissing = await call('POST', E, U.staffA1, { ...base, projectId: 999_999_999, bankAccountId: EMP().A1.acc, lines: [{ description: 'x', total: 1000, categoryId: X.catA }] }, key())
    expect([proj.status, proj.body.errors]).toEqual([projMissing.status, projMissing.body.errors])
    const acc = await call('POST', E, U.staffA1, { ...base, projectId: X.projA, bankAccountId: X.accB, lines: [{ description: 'x', total: 1000, categoryId: X.catA }] }, key())
    expect(acc.status).toBe(400)
    expect(JSON.stringify(acc.body.errors)).toContain('Rekening tidak ditemukan atau nonaktif.')
    expect(JSON.stringify(acc.body.errors)).not.toContain('Q-11')
    const cat = await call('POST', E, U.staffA1, { ...base, projectId: X.projA, bankAccountId: EMP().A1.acc, lines: [{ description: 'x', total: 1000, categoryId: X.catB }] }, key())
    expect(cat.status).toBe(400)
    expect(JSON.stringify(cat.body.errors)).toContain('Kategori tidak ditemukan atau nonaktif.')
  })

  it('QA-MC4-10: a project of another PT answers the same whatever progressPct is sent (no value oracle)', async () => {
    const stored = Number((await sqlAs('app', 'SELECT progress_pct FROM projects WHERE id = $1', [X.projB])).rows[0]!.progress_pct ?? 0)
    const same = await call('PATCH', `/api/projects/${X.projB}`, U.finA, { progressPct: stored })
    const other = await call('PATCH', `/api/projects/${X.projB}`, U.finA, { progressPct: stored + 12.5 })
    expect(other.status).toBe(same.status)
    expect([403, 404]).toContain(other.status)
  })

  it('QA-MC4-10: a transfer from a cash account of another PT → 400 "Akun kas tidak ditemukan" (account checked first)', async () => {
    const r = await draftWithReceipt(U.staffA1, F().A, EMP().A1, { no: `ADV-${tag}`, vendor: '-', amount: 300_000 }, 'advance')
    let d = await ok(call('POST', `${E}/${r.id}/submit`, U.staffA1, {}, key()))
    if (d.status === 'pending_ack') d = await ok(call('POST', `${E}/${r.id}/acknowledge`, U.ownerA, {}, key()))
    d = await ok(call('POST', `${E}/${r.id}/approve`, U.finA, {}, key()))
    expect(d.status).toBe('approved')
    const proof = await upload('/api/v1/media/transfer-proofs', U.finA, await png())
    const t = await call('POST', `${E}/${r.id}/transfer`, U.finA, { cashAccountId: X.cashB, bankRef: `REF-${tag}`, proofMediaId: proof.body.id }, key())
    expect(t.status, JSON.stringify(t.body)).toBe(400)
    expect(JSON.stringify(t.body)).toContain('Akun kas tidak ditemukan')
    expect(JSON.stringify(t.body)).not.toContain('tutup buku')
  })

  it('QA-MC4-11: PT logos — own PT 200, another PT 404, group admin all', async () => {
    const logo = async (c: number) => Number((await sqlAs('app', 'SELECT logo_id FROM companies WHERE id = $1', [c])).rows[0]!.logo_id)
    expect((await call('GET', `/api/v1/media/company/${await logo(A)}/file`, U.staffA1)).status).toBe(200)
    expect((await call('GET', `/api/v1/media/company/${await logo(B)}/file`, U.staffA1)).status).toBe(404)
    expect((await call('GET', `/api/v1/media/company/${await logo(B)}/file`, U.staffAB)).status).toBe(200)
    expect((await call('GET', `/api/v1/media/company/${await logo(C)}/file`, U.groupAdmin)).status).toBe(200)
  })

  it('QA-MC4-12: a former member of A (now only in B) — signature and device are no longer "of A"', async () => {
    const mover = await makeFlowUser(['pk-staff'], 'sk-mover', null)
    await addMembership(mover.id, B, ['pk-staff'])
    const sig = (await sqlAs('app', 'SELECT signature_id FROM users WHERE id = $1', [mover.id])).rows[0]!.signature_id as number
    expect((await call('GET', `/api/v1/media/signatures/${sig}/file`, U.finA)).status).toBe(200)
    expect(await asUser(U.adminA, (req) => canRevoke(req, { user: mover.id }))).toBe(true)
    await sqlAs('owner', 'UPDATE company_memberships SET active = false WHERE user_id = $1 AND company_id = $2', [mover.id, A])
    expect((await call('GET', `/api/v1/media/signatures/${sig}/file`, U.finA)).status).toBe(404)
    const adminA = { ...U.adminA, ...(await withContext(U.adminA)) } as FlowUser
    expect(await asUser(adminA, (req) => canRevoke(req, { user: mover.id }))).toBe(false)
  })

  it('notifications: rows of a PT the user is no longer mapped to are hidden; rows without a PT stay', async () => {
    const n = await makeFlowUser(['pk-staff'], 'sk-notif', null)
    await addMembership(n.id, B, ['pk-staff'])
    const mk = (company: number | null, title: string) =>
      sysCreate('notifications', { user: n.id, company, event: 'uji', title, body: 'isi', docType: 'expense_request', docId: '1', pushStatus: 'skipped', uuid: randomUUID() })
    const inB = await mk(B, `Notif B ${tag}`)
    const none = await mk(null, `Notif umum ${tag}`)
    const ids = async () => ((await ok(call('GET', '/api/v1/notifications?limit=100', n))).items as Body[]).map((i) => i.id)
    expect(await ids()).toEqual(expect.arrayContaining([inB, none]))
    await sqlAs('owner', 'UPDATE company_memberships SET active = false WHERE user_id = $1 AND company_id = $2', [n.id, B])
    expect(await ids()).toContain(none)
    expect(await ids()).not.toContain(inB)
    expect((await call('GET', `/api/v1/notifications/${inB}`, n)).status).toBe(404)
  })

  it('/me without any active membership names no PT (was the name and settings of PT #1)', async () => {
    const lone = await makeFlowUser(['pk-staff'], 'sk-lone', null, { signature: false })
    await sqlAs('owner', 'UPDATE company_memberships SET active = false WHERE user_id = $1', [lone.id])
    const me = await ok(call('GET', '/api/v1/me', lone))
    expect(me.companies).toEqual([])
    expect(me.settings.companyName).toBe('')
    expect(me.settings.shortCode).toBe('')
    expect(me.legacyCompanyId).toBeNull()
  })
})
