import { randomUUID } from 'node:crypto'

import type { CollectionSlug, Payload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { resetRateLimits } from '@/lib/rate-limit'
import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'

import { api, makeFlowUser, sysCreate, upload, type FlowUser, type Res } from './flow-world'
import { accessToken, addMembership, companyId, getTestPayload, http, installFakeKeycloak, installLocalJwks, registerDevice, updateCompany, type TestUser } from './helpers'

/**
 * MC4 QA open items (`docs/proyekkas/qa/mc4-qa-report.md` §2, ADR 0016 "Scope rule" 2026-10-02):
 * - QA-MC4-09: the Q-09 on-behalf permission (Admin/Finance create for others) is evaluated with the
 *   role in the DERIVED PT (requesters' / project's PT), never with a role held in another PT;
 * - QA-MC4-14 (rest, read rule): `employees.faceRefPhoto` PT check, display names never fall back to an
 *   employee of a PT the viewer is not mapped to, a foreign `?pt=` answers 403, and the existence-only
 *   oracles (sync COMPANY_MISMATCH vs NOT_FOUND, body `company` COMPANY_MISMATCH, addendum 403 vs 404)
 *   answer a reference of an unmapped PT exactly like a missing one.
 *
 * PTs: A = #1 DRMS, B = "PT Buka Dua" (OB2), C = "PT Buka Tiga" (OB3, never mapped to anyone below).
 *   adminAstaffB = Admin of A (no employee in A) + Staff of B (employee "Rahasia OB2 …")
 *   staffA = Staff of A only; staffAB = Staff of A + B; staffB = Staff of B; finA = Finance of A;
 *   adminA = Admin of A (not group admin); pmA = PM of A (team PM of projA)
 */
let p: Payload
let A = 0
let B = 0
let C = 0
type Key = 'projA' | 'projB' | 'projC' | 'catA' | 'catB' | 'empA' | 'accA' | 'empAB' | 'empB' | 'empB2' | 'accB2' | 'empC' | 'cashA'
const X = {} as Record<Key, number>
type Who = 'adminAstaffB' | 'staffA' | 'staffAB' | 'staffB' | 'finA' | 'adminA' | 'pmA'
const U = {} as Record<Who, FlowUser>
const tag = randomUUID().slice(0, 6).toUpperCase()
const E = '/api/v1/expense-requests'
const MISSING = 999_999_999
const SECRET_NAME = `Rahasia OB2 ${tag}`
type Body = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const key = () => ({ 'Idempotency-Key': randomUUID() })
const call = async (method: string, path: string, user: FlowUser, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
  resetRateLimits()
  return api(method, path, user, body, headers)
}
const ok = async (r: Promise<Res>, status = 200): Promise<Body> => {
  const res = await r
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status)
  return res.body as Body
}
/** status + machine code + field errors: what a caller can tell apart */
const shape = (r: Res) => ({ status: r.status, code: (r.body as Body | null)?.code ?? null, errors: ((r.body as Body | null)?.errors ?? []).map((e: Body) => [e.path, e.message]) })

async function inPt(company: number, collection: CollectionSlug, code: string): Promise<number> {
  return (await p.find({ collection, where: { and: [{ company: { equals: company } }, { code: { equals: code } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
}
async function employee(company: number, code: string, name: string, project?: number) {
  const emp = await sysCreate('employees', { company, code: `${code}-${tag}`, name })
  if (project) await sysCreate('team-assignments', { employee: emp, project, roleInProject: 'staff' })
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id
  const acc = await sysCreate('employee-bank-accounts', { employee: emp, bank, accountNo: `7${Date.now() % 1e9}${Math.floor(Math.random() * 90 + 10)}`, accountHolder: name, isDefault: true })
  return { emp, acc }
}
const jpeg = (seed: number) => sharp({ create: { width: 640, height: 800, channels: 3, background: { r: seed, g: 90, b: 140 } } }).jpeg().toBuffer()

// ---- APK (bearer) sync -------------------------------------------------------------------------
type Mobile = { token: string; device: string }
async function apk(user: FlowUser): Promise<Mobile> {
  const doc = await p.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
  const t: TestUser = { ...user, keycloakSub: doc.keycloakSub as string }
  const token = await accessToken(t, ['pk-user'])
  return { token, device: await registerDevice(t, token) }
}
const bearer = (m: Mobile) => ({ Authorization: `Bearer ${m.token}`, 'X-Device-Id': m.device, 'X-App-Version': '1.0.0' })
async function sync(m: Mobile, items: unknown[]): Promise<Body[]> {
  resetRateLimits()
  const now = Date.now()
  const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'b', last_server_time: new Date(now - 60_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 60_000 }
  const r = await http('POST', '/api/v1/sync/batch', { headers: bearer(m), json: { batch_id: randomUUID(), device_id: m.device, clock, items } })
  expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200)
  return (r.body as Body).results as Body[]
}
const item = (type: string, payload: Record<string, unknown>, company: number) => ({
  client_uuid: randomUUID(),
  type,
  company_id: company,
  schema_version: 1,
  offline: true,
  device_time: new Date().toISOString(),
  elapsed_ms: 10_000_000,
  payload,
})
/** what an APK can tell apart in a sync result */
const outcome = (r: Body) => ({ status: r.status, company_id: r.company_id, errors: (r.errors as Body[]).map((e) => [e.code, e.field ?? null, e.message]) })

beforeAll(async () => {
  p = await getTestPayload()
  installFakeKeycloak()
  await installLocalJwks()
  const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
  const pt = (name: string, shortCode: string) => ({ ...drms, company: { name, shortCode, timezone: 'Asia/Makassar' }, vehicles: [] })
  await seed(p, { uoms, banks, companies: [drms, pt('PT Buka Dua', 'OB2'), pt('PT Buka Tiga', 'OB3')] })
  A = await companyId()
  B = await companyId('OB2')
  C = await companyId('OB3')
  for (const c of ['OB2', 'OB3']) await updateCompany({ active: true, changeReason: 'uji temuan MC4 terbuka' }, c)

  const geo = { lat: -2.21, lng: 113.91, radiusM: 150 }
  X.projA = await sysCreate('projects', { company: A, code: `OBA-${tag}`, name: 'Proyek OB A', budget: 500_000_000, status: 'berjalan', ...geo })
  X.projB = await sysCreate('projects', { company: B, code: `OBB-${tag}`, name: 'Proyek OB B', budget: 500_000_000, status: 'berjalan', ...geo })
  X.projC = await sysCreate('projects', { company: C, code: `OBC-${tag}`, name: 'Proyek OB C', budget: 500_000_000, status: 'berjalan', ...geo })
  X.catA = await inPt(A, 'expense-categories', 'MAT')
  X.catB = await inPt(B, 'expense-categories', 'MAT')
  const eA = await employee(A, 'OBA1', 'Karyawan OB A', X.projA)
  const eAB = await employee(A, 'OBAB', 'Karyawan OB AB', X.projA)
  const eABb = await employee(B, 'OBABB', 'Karyawan OB AB di B', X.projB)
  const eB = await employee(B, 'OBB1', 'Karyawan OB B', X.projB)
  const eB2 = await employee(B, 'OBB2', 'Karyawan OB B dua', X.projB)
  const eSecret = await employee(B, 'OBSEC', SECRET_NAME, X.projB)
  const eC = await employee(C, 'OBC1', 'Karyawan OB C', X.projC)
  Object.assign(X, { empA: eA.emp, accA: eA.acc, empAB: eAB.emp, empB: eB.emp, empB2: eB2.emp, accB2: eB2.acc, empC: eC.emp })

  U.adminAstaffB = await makeFlowUser(['pk-admin'], 'ob-admin-a-staff-b', null, { groupAdmin: false, signature: false })
  await addMembership(U.adminAstaffB.id, B, ['pk-staff'], eSecret.emp)
  U.staffA = await makeFlowUser(['pk-staff'], 'ob-staff-a', eA.emp)
  U.staffAB = await makeFlowUser(['pk-staff'], 'ob-staff-ab', eAB.emp)
  await addMembership(U.staffAB.id, B, ['pk-staff'], eABb.emp)
  U.staffB = await makeFlowUser(['pk-staff'], 'ob-staff-b', eB.emp, { company: B })
  U.finA = await makeFlowUser(['pk-finance'], 'ob-fin-a', null)
  U.adminA = await makeFlowUser(['pk-admin'], 'ob-admin-a', null, { groupAdmin: false, signature: false })
  const ePm = await employee(A, 'OBPM', 'PM OB A')
  U.pmA = await makeFlowUser(['pk-pm'], 'ob-pm-a', ePm.emp)
  await sysCreate('team-assignments', { employee: ePm.emp, project: X.projA, roleInProject: 'pm' })
})

afterAll(async () => {
  await updateCompany({ syncAttendanceEnabled: false })
  resetAppConfigCache()
  for (const code of ['OB2', 'OB3']) await updateCompany({ active: false, changeReason: 'uji temuan MC4 terbuka selesai' }, code)
  await p.destroy()
})

const draft = (over: Record<string, unknown>) => ({ type: 'advance', title: `Uji OB ${randomUUID().slice(0, 4)}`, neededDate: '2026-12-30', lines: [{ description: 'Material', total: 100_000 }], ...over })

// ================================================================================ QA-MC4-09
describe('QA-MC4-09: Q-09 on-behalf is decided by the role in the derived PT', () => {
  it('Admin of A + Staff of B: a project-less draft for B employees → 403 (was 201 under the Admin role of A)', async () => {
    const r = await call('POST', E, U.adminAstaffB, draft({ requesterIds: [X.empB2], bankAccountId: X.accB2 }), key())
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(403)
    expect(String((r.body as Body).detail ?? (r.body as Body).title)).toMatch(/atas nama orang lain|Q-09|Forbidden/)
    const n = await p.count({ collection: 'expense-requests', where: { and: [{ createdBy: { equals: U.adminAstaffB.id } }, { company: { equals: B } }] }, overrideAccess: true /* SYSTEM-READ: assertion */ })
    expect(n.totalDocs).toBe(0)
  })

  it('…the same with a B project → 403 (role of B), and an update that swaps the requesters to B → 403', async () => {
    const withProject = await call('POST', E, U.adminAstaffB, draft({ projectId: X.projB, requesterIds: [X.empB2] }), key())
    expect(withProject.status, JSON.stringify(withProject.body).slice(0, 400)).toBe(403)
    const own = await ok(call('POST', E, U.adminAstaffB, draft({ requesterIds: [X.empA] }), key()), 201) // A employee, Admin of A: allowed
    expect((await call('PATCH', `${E}/${own.id}`, U.adminAstaffB, { requesterIds: [X.empB2] }, key())).status).toBe(403)
  })

  it('controls: Admin of A for an A employee without project → 201 in A; a Staff for themself (+ a colleague) → 201', async () => {
    const a = await ok(call('POST', E, U.adminAstaffB, draft({ requesterIds: [X.empA], bankAccountId: X.accA }), key()), 201)
    expect(a.companyId ?? a.company?.id ?? a.company).toBe(A)
    const s = await ok(call('POST', E, U.staffB, draft({ requesterIds: [X.empB, X.empB2] }), key()), 201)
    expect(s.companyId ?? s.company?.id ?? s.company).toBe(B)
    // Staff of B for someone else only → 403 (unchanged Q-09 default)
    expect((await call('POST', E, U.staffB, draft({ requesterIds: [X.empB2] }), key())).status).toBe(403)
  })
})

// ================================================================================ QA-MC4-14
describe('QA-MC4-14: faceRefPhoto must be a selfie of the employee\'s PT', () => {
  it('Admin of A cannot link a selfie of another user / PT; their own upload is accepted', async () => {
    const foreign = await upload('/api/v1/media/selfies', U.staffB, await jpeg(31), 'image/jpeg')
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(201)
    const bad = await call('PATCH', `/api/employees/${X.empA}`, U.adminA, { faceRefPhoto: foreign.body.id })
    expect(bad.status, JSON.stringify(bad.body).slice(0, 300)).toBe(400)
    const missing = await call('PATCH', `/api/employees/${X.empA}`, U.adminA, { faceRefPhoto: MISSING })
    expect(missing.status).toBe(400)
    expect(JSON.stringify(bad.body)).toBe(JSON.stringify(missing.body)) // same answer: no existence oracle
    const stored = await p.findByID({ collection: 'employees', id: X.empA, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })
    expect(stored.faceRefPhoto ?? null).toBeNull()
    const mine = await upload('/api/v1/media/selfies', U.adminA, await jpeg(32), 'image/jpeg')
    expect(mine.status, JSON.stringify(mine.body)).toBe(201)
    await ok(call('PATCH', `/api/employees/${X.empA}`, U.adminA, { faceRefPhoto: mine.body.id }))
    // an unrelated edit later (another admin) does not re-check the stored photo
    await ok(call('PATCH', `/api/employees/${X.empA}`, U.adminAstaffB, { position: 'Mandor' }))
  })
})

describe('QA-MC4-14: display names never fall back to an employee of an unmapped PT', () => {
  it('Riwayat of an A request created by Admin A / Staff B: a viewer mapped to A only sees the account name', async () => {
    const d = await ok(call('POST', E, U.adminAstaffB, draft({ projectId: X.projA, requesterIds: [X.empA], bankAccountId: X.accA }), key()), 201)
    const asRequester = await ok(call('GET', `${E}/${d.id}/history`, U.staffA))
    const names = (asRequester.items as Body[]).filter((h) => h.userId === U.adminAstaffB.id).map((h) => h.userName)
    expect(names.length).toBeGreaterThan(0)
    expect(names).not.toContain(SECRET_NAME)
    expect(new Set(names)).toEqual(new Set(['ob-admin-a-staff-b']))
    // the creator (mapped to B too) still sees the employee name of their own B membership as fallback
    const asCreator = await ok(call('GET', `${E}/${d.id}/history`, U.adminAstaffB))
    expect((asCreator.items as Body[]).filter((h) => h.userId === U.adminAstaffB.id).map((h) => h.userName)).toContain(SECRET_NAME)
  })

  it('audit-log report (Admin of A): the user column is not the B employee name', async () => {
    const r = await ok(call('GET', `/api/v1/reports/audit-log?user=${U.adminAstaffB.id}`, U.adminA))
    const users = (r.main.rows as Body[]).map((x) => x.user)
    expect(users.length).toBeGreaterThan(0)
    expect(users).not.toContain(SECRET_NAME)
  })
})

describe('QA-MC4-14: a foreign PT in ?pt= answers 403 (was: silently narrowed to nothing)', () => {
  it('reports JSON + export: ?pt=<unmapped> → 403 COMPANY_NOT_ALLOWED; own PT → 200', async () => {
    const q = '/api/v1/reports/rekap-pengajuan?dari=2000-01-01&sampai=2999-12-31'
    const own = await ok(call('GET', `${q}&pt=${A}`, U.finA))
    expect(own.companies.map((c: Body) => c.id)).toEqual([A])
    for (const path of [`${q}&pt=${C}`, `${q}&pt=${A},${C}`, `/api/v1/reports/rekap-pengajuan/csv?dari=2000-01-01&sampai=2999-12-31&pt=${C}`]) {
      const r = await call('GET', path, U.finA)
      expect(r.status, path).toBe(403)
      expect((r.body as Body).code).toBe('COMPANY_NOT_ALLOWED')
    }
  })
})

describe('QA-MC4-14: references of an unmapped PT answer exactly like missing ones (no existence oracle)', () => {
  it('body `company`: project of unmapped C = missing project (was 400 COMPANY_MISMATCH); mapped mismatch keeps COMPANY_MISMATCH', async () => {
    const body = (projectId: number) => draft({ company: A, projectId, requesterIds: [X.empA] })
    const foreign = await call('POST', E, U.staffA, body(X.projC), key())
    const missing = await call('POST', E, U.staffA, body(MISSING), key())
    expect(foreign.status).toBe(400)
    expect(shape(foreign)).toEqual(shape(missing))
    // a 2-PT user naming A with a B project: a real mismatch inside the mapping (contract unchanged)
    const mapped = await call('POST', E, U.staffAB, draft({ company: A, projectId: X.projB, requesterIds: [X.empAB] }), key())
    expect([mapped.status, (mapped.body as Body).code]).toEqual([400, 'COMPANY_MISMATCH'])
  })

  it('cash entry (Finance of A): project of unmapped C = missing project, with and without body `company`', async () => {
    X.cashA ||= await sysCreate('cash-accounts', { company: A, name: `Kas OB A ${tag}`, kind: 'bank', openingBalance: 10_000_000 })
    const body = (projectId: number, company?: number) => ({ direction: 'out', cashAccountId: X.cashA, amount: 25_000, description: 'Uji oracle kas', categoryId: X.catA, projectId, ...(company ? { company } : {}) })
    for (const company of [undefined, A]) {
      const foreign = await call('POST', '/api/v1/cash-entries', U.finA, body(X.projC, company), key())
      const missing = await call('POST', '/api/v1/cash-entries', U.finA, body(MISSING, company), key())
      expect(foreign.status, JSON.stringify(foreign.body).slice(0, 300)).toBeGreaterThanOrEqual(400)
      expect(shape(foreign)).toEqual(shape(missing))
    }
  })

  it('addendum: a project of unmapped C → 404 like a missing project (was 403)', async () => {
    const body = (projectId: number) => ({ projectId, addition: 1_000_000, reason: 'Uji oracle addendum' })
    const foreign = await call('POST', '/api/v1/budget-addenda', U.pmA, body(X.projC), key())
    const missing = await call('POST', '/api/v1/budget-addenda', U.pmA, body(MISSING), key())
    expect(foreign.status).toBe(404)
    expect(shape(foreign)).toEqual(shape(missing))
    const named = await call('POST', '/api/v1/budget-addenda', U.pmA, { ...body(X.projC), company: A }, key())
    const namedMissing = await call('POST', '/api/v1/budget-addenda', U.pmA, { ...body(MISSING), company: A }, key())
    expect(shape(named)).toEqual(shape(namedMissing))
  })

  it('sync draft: project / request of unmapped C = missing (was COMPANY_MISMATCH); mapped mismatch keeps COMPANY_MISMATCH', async () => {
    const m = await apk(U.staffA)
    const base = { kind: 'advance', title: 'OB sync', requester_ids: [X.empA], needed_date: '2026-12-30', lines: [{ description: 'x', total: 10_000 }] }
    const cReq = (await p.find({ collection: 'expense-requests', where: { company: { equals: C } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]?.id as number | undefined
    const cDraft = cReq ?? (await ok(call('POST', E, await makeFlowUser(['pk-staff'], 'ob-staff-c', X.empC, { company: C }), draft({ requesterIds: [X.empC] }), key()), 201)).id
    const [projForeign, projMissing, reqForeign, reqMissing] = await sync(m, [
      item('expense_request.draft_upsert', { ...base, project_id: X.projC }, A),
      item('expense_request.draft_upsert', { ...base, project_id: MISSING }, A),
      item('expense_request.draft_delete', { request_id: cDraft }, A),
      item('expense_request.draft_delete', { request_id: MISSING }, A),
    ])
    expect(projForeign!.errors.map((e: Body) => e.code)).not.toContain('COMPANY_MISMATCH')
    expect(outcome(projForeign!)).toEqual(outcome(projMissing!))
    expect(outcome(reqForeign!)).toEqual(outcome(reqMissing!))
    const ab = await apk(U.staffAB)
    const [mapped] = await sync(ab, [item('expense_request.draft_upsert', { ...base, requester_ids: [X.empAB], project_id: X.projB }, A)])
    expect(mapped!.errors.map((e: Body) => e.code)).toEqual(['COMPANY_MISMATCH'])
  })

  it('sync attendance: a location of unmapped C = a missing one (was COMPANY_MISMATCH)', async () => {
    await updateCompany({ syncAttendanceEnabled: true })
    resetAppConfigCache()
    const m = await apk(U.staffA)
    const selfie = async (seed: number) => {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(await jpeg(seed))], { type: 'image/jpeg' }), 'selfie.jpg')
      const { handleEndpoints } = await import('payload')
      const config = (await import('@payload-config')).default
      const res = await handleEndpoints({ config, request: new Request('http://localhost:3000/api/v1/media/selfies', { method: 'POST', headers: bearer(m), body: form }) })
      expect(res.status).toBe(201)
      return ((await res.json()) as { id: number }).id
    }
    const att = async (projectId: number) => ({ project_id: projectId, lat: -2.2101, lng: 113.91, accuracy_m: 10, is_mocked: false, selfie_media_id: await selfie(40 + projectId % 50), camera_lens: 'front' })
    const [foreign, missing] = await sync(m, [item('attendance.check_in', await att(X.projC), A), item('attendance.check_in', await att(MISSING), A)])
    expect(foreign!.errors.map((e: Body) => e.code)).not.toContain('COMPANY_MISMATCH')
    expect(outcome(foreign!)).toEqual(outcome(missing!))
  })
})
