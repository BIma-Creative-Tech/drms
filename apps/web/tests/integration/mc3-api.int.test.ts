import { randomUUID } from 'node:crypto'

import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { v1Endpoints } from '@/api/v1'
import { resetRateLimits } from '@/lib/rate-limit'
import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'

import { adr0013Fallback, api, draftBody, makeFlowUser, makeWorld, sysCreate, type FlowUser, type Res, type World } from './flow-world'
import { accessToken, addMembership, companyId, fixturePm, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, type TestUser, updateCompany } from './helpers'

/**
 * MC3-1 — /api/v1 for the multi-company APK (ADR 0016 §5/§8, docs/proyekkas/mc/mc3-progress.md):
 * `/me companies[]` (1 and 3 PTs, deprecated single-PT fields for mobile-v0.2.0), header / `?company=`
 * spoofing, a sample of every route class across PTs, masters per PT (company on items, shared
 * masters, per-PT radius, version + ETag / 304), `sync/batch` with per-item `company_id` (mixed-PT
 * outbox, mismatches, released-APK items → 409 for several PTs / accepted for one PT) and the queue
 * filters. PTs: A = company #1 DRMS (world `MC3`), B = fictional "PT Contoh Enam" (CS6),
 * C = fictional "PT Contoh Tujuh" (CS7). B and C are deactivated in afterAll.
 *
 *   solo      = world staffA (Staff in A only) — the released-APK single-PT case
 *   tri       = Staff in A (employee), PM + Staff in B (employee), Finance in C (no employee)
 *   bc        = Finance in B, Direktur in C (no membership in A)
 *   ownerAC   = Direktur in A and C;  financeAC = Finance in A and C;  staffC = Staff in C
 */
let w: World
let A = 0
let B = 0
let C = 0
const X: Record<string, number> = {}
let solo: FlowUser
let tri: FlowUser
let bc: FlowUser
let ownerAC: FlowUser
let financeAC: FlowUser
let staffC: FlowUser
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
type Body = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const ok = async (p: Promise<Res>, status = 200): Promise<Body> => {
  resetRateLimits()
  const r = await p
  expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(status)
  return r.body as Body
}
const call = async (method: string, path: string, user: FlowUser, body?: unknown, headers: Record<string, string> = {}) => {
  resetRateLimits()
  return api(method, path, user, body, headers)
}
const H = (...ids: number[]) => ({ 'X-Company-Ids': ids.join(',') })

/** Bearer token + registered device of a flow user (APK path). */
async function apk(user: FlowUser): Promise<{ token: string; device: string }> {
  const p = await getTestPayload()
  const doc = await p.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
  const t: TestUser = { ...user, keycloakSub: doc.keycloakSub as string }
  const token = await accessToken(t, ['pk-user'])
  return { token, device: await registerDevice(t, token) }
}
const bearer = (a: { token: string; device: string }, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${a.token}`, 'X-Device-Id': a.device, 'X-App-Version': '1.0.0', ...extra })

async function sync(a: { token: string; device: string }, items: unknown[], headers: Record<string, string> = {}) {
  resetRateLimits()
  const now = Date.now()
  const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'b', last_server_time: new Date(now - 60_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 60_000 }
  return http('POST', '/api/v1/sync/batch', { headers: bearer(a, headers), json: { batch_id: randomUUID(), device_id: a.device, clock, items } })
}
const draftItem = (payload: Record<string, unknown>, company?: number) => ({
  client_uuid: randomUUID(),
  type: 'expense_request.draft_upsert',
  ...(company === undefined ? {} : { company_id: company }),
  schema_version: 1,
  offline: true,
  device_time: new Date().toISOString(),
  elapsed_ms: 10_000_000,
  payload,
})
const draftIn = (pt: 'A' | 'B', title: string) =>
  pt === 'A'
    ? { kind: 'advance', title, project_id: w.project, requester_ids: [X.empTriA], bank_account_id: X.accTriA, needed_date: '2026-09-30', lines: [{ description: 'x', total: 10_000, category_id: w.cat.mat }] }
    : { kind: 'advance', title, project_id: X.projectB, requester_ids: [X.empTriB], bank_account_id: X.accTriB, needed_date: '2026-09-30', lines: [{ description: 'x', total: 10_000, category_id: X.catB }] }

async function submitted(by: FlowUser, body: Record<string, unknown>): Promise<number> {
  const d = await ok(call('POST', E, by, body, key()), 201)
  await ok(call('POST', `${E}/${d.id}/submit`, by, {}, key()))
  return d.id as number
}

const companyOfRequest = async (id: number) => Number((await sqlAs('app', 'SELECT company_id FROM expense_requests WHERE id = $1', [id])).rows[0]?.company_id)

beforeAll(async () => {
  w = await makeWorld('MC3')
  A = await companyId()
  const p = await getTestPayload()
  const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
  await seed(p, {
    uoms,
    banks,
    companies: [
      drms,
      { ...drms, company: { name: 'PT Contoh Enam', shortCode: 'CS6', timezone: 'Asia/Makassar' }, vehicles: [] },
      { ...drms, company: { name: 'PT Contoh Tujuh', shortCode: 'CS7', timezone: 'Asia/Makassar' }, vehicles: [] },
    ],
  })
  B = await companyId('CS6')
  C = await companyId('CS7')
  await adr0013Fallback([A, B, C])
  for (const code of ['CS6', 'CS7']) await updateCompany({ active: true, changeReason: 'uji MC3' }, code)
  await updateCompany({ defaultGeofenceRadiusM: 321 }, 'CS6')
  const inPt = async (company: number, collection: CollectionSlug, code: string) =>
    (await p.find({ collection, where: { and: [{ company: { equals: company } }, { code: { equals: code } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  X.catB = await inPt(B, 'expense-categories', 'MAT')
  X.catC = await inPt(C, 'expense-categories', 'MAT')
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number

  X.empTriA = await sysCreate('employees', { company: A, code: 'MC3-TRI', name: 'Tri DRMS' })
  X.empTriB = await sysCreate('employees', { company: B, code: 'MC3-TRI', name: 'Tri Contoh Enam' })
  X.empC = await sysCreate('employees', { company: C, code: 'MC3-SC', name: 'Staf Contoh Tujuh' })

  solo = w.users.staffA
  tri = await makeFlowUser(['pk-staff'], 'mc3-tri', X.empTriA)
  await addMembership(tri.id, B, ['pk-pm', 'pk-staff'], X.empTriB)
  await addMembership(tri.id, C, ['pk-finance'])
  bc = await makeFlowUser(['pk-finance'], 'mc3-bc', null, { company: B })
  await addMembership(bc.id, C, ['pk-owner'])
  ownerAC = await makeFlowUser(['pk-owner'], 'mc3-owner-ac', null)
  await addMembership(ownerAC.id, C, ['pk-owner'])
  financeAC = await makeFlowUser(['pk-finance'], 'mc3-finance-ac', null)
  await addMembership(financeAC.id, C, ['pk-finance'])
  staffC = await makeFlowUser(['pk-staff'], 'mc3-staff-c', X.empC, { company: C })

  X.projectB = await sysCreate('projects', { company: B, code: 'MC3-PB', name: 'Proyek Contoh Enam', pm: tri.id, budget: 40_000_000, status: 'berjalan' })
  X.projectB2 = await sysCreate('projects', { company: B, code: 'MC3-PB2', name: 'Proyek Contoh Enam titik', pm: tri.id, budget: 5_000_000, status: 'berjalan', lat: -0.5, lng: 117.1 })
  X.projectC = await sysCreate('projects', { company: C, pm: await fixturePm(C), code: 'MC3-PC', name: 'Proyek Contoh Tujuh', budget: 9_000_000, status: 'berjalan' })
  await sysCreate('team-assignments', { employee: X.empTriA, project: w.project, roleInProject: 'staff' })
  await sysCreate('team-assignments', { employee: X.empTriB, project: X.projectB, roleInProject: 'staff' })
  await sysCreate('team-assignments', { employee: X.empC, project: X.projectC, roleInProject: 'staff' })
  X.accTriA = await sysCreate('employee-bank-accounts', { employee: X.empTriA, bank, accountNo: `81${Date.now() % 1e8}`, accountHolder: 'Tri', isDefault: true })
  X.accTriB = await sysCreate('employee-bank-accounts', { employee: X.empTriB, bank, accountNo: `82${Date.now() % 1e8}`, accountHolder: 'Tri', isDefault: true })
  X.accC = await sysCreate('employee-bank-accounts', { employee: X.empC, bank, accountNo: `83${Date.now() % 1e8}`, accountHolder: 'Staf Contoh Tujuh', isDefault: true })
  X.cashB = await sysCreate('cash-accounts', { company: B, name: 'MC3 Kas Contoh Enam', kind: 'bank', openingBalance: 4_000_000 })
  X.cashC = await sysCreate('cash-accounts', { company: C, name: 'MC3 Kas Contoh Tujuh', kind: 'bank', openingBalance: 5_000_000 })

  // one request waiting for the Direktur in A and in C
  X.reqA = await submitted(w.users.staffA, draftBody(w))
  X.reqC = await submitted(staffC, {
    type: 'advance',
    title: 'MC3 C',
    projectId: X.projectC,
    requesterIds: [X.empC],
    bankAccountId: X.accC,
    neededDate: '2026-09-30',
    lines: [{ description: 'Material', total: 250_000, categoryId: X.catC }],
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  for (const id of [B, C]) if (id) await p.update({ collection: 'companies', id, data: { active: false, changeReason: 'uji MC3 selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

// ------------------------------------------------------------------------------------ /me

/** Keys of GET /me before MC3 (mobile-v0.2.0 parses these). */
const LEGACY_ME_KEYS = ['id', 'email', 'name', 'roles', 'capabilities', 'employee', 'authMethod', 'device', 'settings', 'serverTime']
const LEGACY_SETTINGS_KEYS = ['companyName', 'shortCode', 'timezone', 'minAppVersion', 'offlineMaxAgeDays', 'defaultGeofenceRadiusM', 'receiptRoundingTolerance', 'receiptMaxAgeDays', 'imageTargets']

describe('MC3 — GET /me companies[] + deprecated single-PT fields', () => {
  it('one PT (released APK, bearer): legacy fields = that PT, companies[] = [that PT]', async () => {
    await installLocalJwks()
    const a = await apk(solo)
    const r = await http('GET', '/api/v1/me', { headers: bearer(a) })
    expect(r.status).toBe(200)
    const me = r.body as Body
    expect(Object.keys(me)).toEqual(expect.arrayContaining(LEGACY_ME_KEYS))
    expect(Object.keys(me.settings)).toEqual(LEGACY_SETTINGS_KEYS)
    expect(me.companies).toHaveLength(1)
    const c = me.companies[0]
    expect(c).toMatchObject({ id: A, code: 'DRMS', selected: true, roles: ['pk-staff'], employeeId: w.emp.a, capabilities: { approvalInbox: false, teamMonitor: false, progressReportCreate: false } })
    expect(me.activeCompanyIds).toEqual([A])
    expect(me.legacyCompanyId).toBe(A)
    expect(me.roles).toEqual(c.roles)
    expect(me.capabilities).toEqual(c.capabilities)
    expect(me.employee).toEqual(c.employee)
    expect(me.employee.id).toBe(w.emp.a)
    expect(me.settings).toMatchObject({ shortCode: 'DRMS', companyName: c.name, timezone: c.timezone, defaultGeofenceRadiusM: c.settings.defaultGeofenceRadiusM })
    expect(me.authMethod).toBe('mobileBearer')
  })

  it('three PTs: roles / employee / capabilities per PT; legacy = union roles + first selected PT with an employee', async () => {
    const me = await ok(call('GET', '/api/v1/me', tri))
    expect(me.companies.map((c: Body) => c.id)).toEqual([A, B, C])
    const [a, b, c] = me.companies as Body[]
    expect(a).toMatchObject({ roles: ['pk-staff'], employeeId: X.empTriA, capabilities: { approvalInbox: false, teamMonitor: false, progressReportCreate: false } })
    // ADR 0021: the PM approves its project's requests first → approval inbox
    expect(b).toMatchObject({ code: 'CS6', roles: ['pk-pm', 'pk-staff'], employeeId: X.empTriB, capabilities: { approvalInbox: true, teamMonitor: true, progressReportCreate: true } })
    expect(b!.settings.defaultGeofenceRadiusM).toBe(321)
    expect(c).toMatchObject({ code: 'CS7', roles: ['pk-finance'], employeeId: null, employee: null, capabilities: { approvalInbox: true, teamMonitor: false, progressReportCreate: false } })
    expect(me.activeCompanyIds).toEqual([A, B, C])
    expect(me.legacyCompanyId).toBe(A)
    expect([...me.roles].sort()).toEqual(['pk-finance', 'pk-pm', 'pk-staff'])
    // FR1: field-report capabilities stay false while no selected PT has companies.fieldReportsEnabled
    expect(me.capabilities).toEqual({ approvalInbox: true, teamMonitor: true, progressReportCreate: true, serviceReportCreate: false, unitTimesheetCreate: false, aftersalesActivityCreate: false, dailyReportCreate: false })
    expect(me.employee.id).toBe(X.empTriA)
    expect(me.settings.shortCode).toBe('DRMS')
    // narrowed read selection: companies[] still lists every membership, `selected` + legacy follow the selection
    const bcOnly = await ok(call('GET', '/api/v1/me', tri, undefined, H(B, C)))
    expect(bcOnly.companies.map((x: Body) => [x.id, x.selected])).toEqual([
      [A, false],
      [B, true],
      [C, true],
    ])
    expect(bcOnly.activeCompanyIds).toEqual([B, C])
    expect(bcOnly.legacyCompanyId).toBe(B)
    expect([...bcOnly.roles].sort()).toEqual(['pk-finance', 'pk-pm', 'pk-staff'])
    expect(bcOnly.employee.id).toBe(X.empTriB)
    expect(bcOnly.settings).toMatchObject({ shortCode: 'CS6', defaultGeofenceRadiusM: 321 })
    const cOnly = await ok(call('GET', '/api/v1/me', tri, undefined, H(C)))
    expect(cOnly).toMatchObject({ legacyCompanyId: C, employee: null, roles: ['pk-finance'] })
    expect(cOnly.settings.shortCode).toBe('CS7')
  })

  it('legacy settings never name a PT outside the memberships (was company #1 for several PTs)', async () => {
    const me = await ok(call('GET', '/api/v1/me', bc))
    expect(me.companies.map((x: Body) => x.id)).toEqual([B, C])
    expect(me.legacyCompanyId).toBe(B)
    expect(me.settings.shortCode).toBe('CS6')
    expect(me.companies.map((x: Body) => x.code)).not.toContain('DRMS')
  })
})

// ------------------------------------------------------------------------------------ spoofing

describe('MC3 — company context spoofing (header / ?company=)', () => {
  it('X-Company-Ids naming a foreign or malformed PT → 403 COMPANY_NOT_ALLOWED on every route class', async () => {
    for (const path of ['/api/v1/me', '/api/v1/masters?types=uoms', `${E}?scope=all`, `${E}/${X.reqA}`, '/api/v1/approvals/inbox', '/api/v1/notifications']) {
      const r = await call('GET', path, solo, undefined, H(B))
      expect([path, r.status, r.body.code]).toEqual([path, 403, 'COMPANY_NOT_ALLOWED'])
    }
    const bad = await call('GET', '/api/v1/me', solo, undefined, { 'X-Company-Ids': `${A};DROP` })
    expect([bad.status, bad.body.code]).toEqual([403, 'COMPANY_NOT_ALLOWED'])
    // a mutation with a foreign header is refused before the handler
    const m = await call('POST', `${E}/${X.reqA}/cancel`, solo, { reason: 'uji spoof' }, { ...H(A, C), ...key() })
    expect([m.status, m.body.code]).toEqual([403, 'COMPANY_NOT_ALLOWED'])
  })

  it('?company= outside the selection → 403 on queues / cash (the balances + lock-date leak is closed)', async () => {
    for (const path of ['/api/v1/approvals/inbox', '/api/v1/transfer-queue', '/api/v1/lpj-queue', '/api/v1/budget-addenda', '/api/v1/budget-addenda/inbox', `${E}?scope=all`, '/api/v1/cash-accounts/balances', '/api/v1/period-closings', '/api/v1/cash-entries', '/api/v1/notifications', '/api/v1/progress-reports', '/api/v1/masters?types=projects']) {
      const r = await call('GET', `${path}${path.includes('?') ? '&' : '?'}company=${B}`, financeAC)
      expect([path, r.status, r.body.code]).toEqual([path, 403, 'COMPANY_NOT_ALLOWED'])
    }
    // in the membership but outside the header selection → 403 too (narrow only)
    const r = await call('GET', `/api/v1/cash-accounts/balances?company=${C}`, financeAC, undefined, H(A))
    expect(r.status).toBe(403)
    expect((await call('GET', '/api/v1/approvals/inbox?company=abc', financeAC)).status).toBe(400)
    // audited
    const audit = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'access_denied' AND field = 'company' AND user_id = $1", [financeAC.id])
    expect(Number(audit.rows[0]?.n)).toBeGreaterThan(0)
  })

  it('balances: Finance of A + C sees A and C accounts; ?company=C only C; never B', async () => {
    const all = await ok(call('GET', '/api/v1/cash-accounts/balances', financeAC))
    const pts = new Set((all.items as Body[]).map((i) => i.companyId))
    expect([...pts].sort((x, y) => x - y)).toEqual([A, C])
    const onlyC = await ok(call('GET', `/api/v1/cash-accounts/balances?company=${C}`, financeAC))
    expect((onlyC.items as Body[]).map((i) => i.cashAccountId)).toContain(X.cashC)
    expect((onlyC.items as Body[]).every((i) => i.companyId === C)).toBe(true)
    const periods = await ok(call('GET', `/api/v1/period-closings?company=${C}`, financeAC))
    expect(periods.lockDates.map((l: Body) => l.companyId)).toEqual([C])
    // Staff in B + Finance in … : `bc` is Finance in B, Direktur in C → both readable, A never
    const bcAll = await ok(call('GET', '/api/v1/cash-accounts/balances', bc))
    expect(new Set((bcAll.items as Body[]).map((i) => i.companyId))).toEqual(new Set([B, C]))
  })
})

// ------------------------------------------------------------------------------------ route classes

type RouteClass = 'public' | 'own' | 'selection' | 'document' | 'named-pt'

/**
 * Route table of /api/v1 (docs/proyekkas/mc/mc3-progress.md §Route table). Every registered endpoint
 * must be classified — a new route without a class fails this suite.
 *   public    = no company data (health, app gate, OpenAPI)
 *   own       = the caller's own rows / profile (no other user's data)
 *   selection = rows of the effective selection ∩ memberships, role per PT (access / per-PT scopes)
 *   document  = one document: read within the selection, role checked IN the document's PT (else 404/403)
 *   named-pt  = the PT is named by the request (body / query / sync company_id / derived from the
 *               referenced project) and checked against the membership + role IN that PT
 */
const ROUTE_CLASSES: Record<string, RouteClass> = {
  'GET /health': 'public',
  'HEAD /health': 'public',
  'GET /health/ready': 'public',
  'HEAD /health/ready': 'public',
  'GET /app/config': 'public',
  'GET /openapi.json': 'public',
  'GET /privacy-notice': 'public', // ADR 0018: the bundled notice text, no user data
  'GET /me': 'own',
  'POST /me/companies': 'own',
  'POST /me/privacy-ack': 'own', // ADR 0018: the caller's own acknowledgement
  'POST /devices/register': 'own',
  'POST /admin/test-email': 'own',
  'POST /media/:kind': 'own',
  'GET /notifications': 'own',
  'POST /notifications/read-all': 'own',
  'GET /notifications/:id': 'own',
  'POST /notifications/:id/read': 'own',
  'GET /attendance/me': 'own',
  'GET /masters': 'selection',
  'GET /expense-requests': 'selection',
  'GET /transfer-queue': 'selection',
  'GET /approvals/inbox': 'selection',
  'GET /lpj-queue': 'selection',
  'GET /lpj-shortfall-approvals/inbox': 'selection',
  'GET /cash-entries': 'selection',
  'GET /cash-accounts/balances': 'selection',
  'GET /period-closings': 'selection',
  'GET /dashboard/owner': 'selection',
  'GET /dashboard/finance': 'selection',
  'GET /dashboard/pm': 'selection',
  'GET /dashboard/admin': 'selection',
  'GET /dashboard/me': 'selection',
  'GET /reports/:code': 'selection',
  'GET /reports/:code/:format': 'selection',
  'GET /attendance/recap': 'document',
  'GET /attendance/team-today': 'selection',
  'GET /projects/progress': 'selection',
  'GET /progress-reports': 'selection',
  'GET /budget-addenda': 'selection',
  'GET /budget-addenda/inbox': 'selection',
  'GET /expense-requests/:id': 'document',
  'PATCH /expense-requests/:id': 'document',
  'GET /expense-requests/:id/history': 'document',
  'GET /expense-requests/:id/pdf': 'document',
  'POST /expense-requests/:id/submit': 'document',
  'POST /expense-requests/:id/withdraw': 'document',
  'POST /expense-requests/:id/cancel': 'document',
  'POST /expense-requests/:id/resubmit': 'document',
  'POST /expense-requests/:id/duplicate': 'document', // DRMS 13/10 Persetujuan #12: read the source + create role IN its PT
  'POST /expense-requests/:id/acknowledge': 'document',
  'POST /expense-requests/:id/approve': 'document',
  'POST /expense-requests/:id/reject': 'document',
  'POST /expense-requests/:id/complete': 'document',
  'POST /expense-requests/:id/receipts': 'document',
  'PATCH /expense-requests/:id/receipts/:rid': 'document',
  'POST /expense-requests/:id/receipts/:rid/remove': 'document',
  'POST /expense-requests/:id/receipts/:rid/verify': 'document',
  'POST /expense-requests/:id/receipts/:rid/reject': 'document',
  'POST /expense-requests/:id/receipts-resubmit': 'document',
  'POST /expense-requests/:id/verify-receipts': 'document',
  'POST /expense-requests/:id/flags/:fid/review': 'document',
  'POST /expense-requests/:id/transfer': 'document',
  'POST /expense-requests/:id/transfers/:tid/void': 'document',
  'POST /expense-requests/:id/receipts-complete': 'document',
  'POST /expense-requests/:id/lpj/submit': 'document',
  'PUT /expense-requests/:id/lpj/photos': 'document',
  'POST /expense-requests/:id/lpj/request-revision': 'document',
  'POST /expense-requests/:id/lpj/verify': 'document',
  'POST /expense-requests/:id/settle': 'document',
  'GET /expense-requests/:id/settle/precheck': 'document', // QA-11
  'GET /bank-account-preview': 'document', // DRMS 10/10 8e: the request (loadVisible) / the account's collection access
  'POST /expense-requests/:id/settle/reverse': 'document',
  // QA-06 / ADR 0019: LPJ shortfall re-approval
  'POST /expense-requests/:id/lpj/shortfall-approval': 'document',
  'POST /expense-requests/:id/lpj/shortfall-approval/acknowledge': 'document',
  'POST /expense-requests/:id/lpj/shortfall-approval/approve': 'document',
  'POST /expense-requests/:id/lpj/shortfall-approval/reject': 'document',
  'PATCH /cash-entries/:id': 'document',
  'POST /cash-entries/:id/void': 'document',
  'POST /devices/:id/revoke': 'document',
  'GET /media/:collection/:id/file': 'document',
  'GET /media/:collection/:id/signed-url': 'document',
  'POST /attendance/:id/correct': 'document',
  'GET /attendance/:id/selfie': 'document',
  'GET /projects/:id/stages': 'document',
  'PUT /projects/:id/stages': 'document',
  'GET /progress-reports/:id': 'document',
  'PATCH /progress-reports/:id': 'document',
  'GET /budget-addenda/:id': 'document',
  'PATCH /budget-addenda/:id': 'document',
  'POST /budget-addenda/:id/submit': 'document',
  'POST /budget-addenda/:id/cancel': 'document',
  'POST /budget-addenda/:id/acknowledge': 'document',
  'POST /budget-addenda/:id/approve': 'document',
  'POST /budget-addenda/:id/reject': 'document',
  'POST /expense-requests': 'named-pt',
  'POST /cash-entries': 'named-pt',
  'POST /period-closings': 'named-pt',
  'POST /period-closings/:period/reopen': 'named-pt',
  'POST /company-memberships/batch': 'named-pt',
  'POST /progress-reports': 'named-pt',
  'POST /budget-addenda': 'named-pt',
  'POST /sync/batch': 'named-pt',
  // owner decision 2026-10-09: web self check-in/out — PT of the referenced project / cost center, own employee there
  'POST /attendance/check-in': 'named-pt',
  'POST /attendance/check-out': 'named-pt',
  // FR1 (ADR 0020): field reports per project kind
  'GET /service-reports': 'selection',
  'GET /unit-timesheets': 'selection',
  'GET /aftersales-activities': 'selection',
  'GET /aftersales/open-pos': 'selection',
  'GET /units': 'selection',
  'GET /service-reports/:id': 'document',
  'PATCH /service-reports/:id': 'document',
  'POST /service-reports/:id/corrections': 'document',
  'GET /unit-timesheets/:id': 'document',
  'PATCH /unit-timesheets/:id': 'document',
  'POST /unit-timesheets/:id/corrections': 'document',
  'GET /aftersales-activities/:id': 'document',
  'PATCH /aftersales-activities/:id': 'document',
  'POST /aftersales-activities/:id/corrections': 'document',
  'GET /projects/:id/contract-units': 'document',
  'POST /service-reports': 'named-pt',
  'POST /unit-timesheets': 'named-pt',
  'POST /aftersales-activities': 'named-pt',
  // P3 konstruksi: RAP (per project / item) + Laporan harian
  'GET /rap/template.xlsx': 'public', // shared uom codes only
  'GET /projects/:id/rap': 'document',
  // DRMS 10/10 Phase C: APK projects (collection read scope ∩ selection) + the Finance cost-center picker (D2)
  'GET /projects': 'selection',
  'GET /projects/:id': 'document',
  'GET /cost-centers': 'selection',
  'GET /sites': 'selection', // ADR 0023
  'GET /projects/:id/rap.xlsx': 'document',
  'POST /projects/:id/rap/items': 'document',
  'PATCH /rap-items/:id': 'document',
  'POST /projects/:id/rap/import/preview': 'document',
  'POST /projects/:id/rap/import/commit': 'document',
  'POST /projects/:id/rap/apply-template': 'document',
  'POST /projects/:id/rap/save-template': 'document',
  'GET /projects/:id/daily-recap': 'document',
  'GET /daily-reports': 'selection',
  'GET /daily-reports/:id': 'document',
  'PATCH /daily-reports/:id': 'document',
  'POST /daily-reports/:id/corrections': 'document',
  'POST /daily-reports': 'named-pt',
  // ADR 0022 inter-project loans
  'GET /project-loans': 'selection',
  'GET /project-loans/inbox': 'selection',
  'GET /project-loans/options': 'selection',
  'GET /project-loans/:id': 'document',
  'PATCH /project-loans/:id': 'document',
  'POST /project-loans/:id/submit': 'document',
  'POST /project-loans/:id/cancel': 'document',
  'POST /project-loans/:id/approve': 'document',
  'POST /project-loans/:id/reject': 'document',
  'POST /project-loans/:id/repayments': 'document',
  'POST /project-loans/:id/repayments/:rid/void': 'document',
  'POST /project-loans': 'named-pt',
}

describe('MC3 — route classes sampled across PTs', () => {
  it('every /api/v1 endpoint is classified (route table complete)', () => {
    // (Payload appends its own root endpoints, e.g. GET /access, to the same array)
    const registered = v1Endpoints.filter((e) => e.path.startsWith('/v1/')).map((e) => `${String(e.method).toUpperCase()} ${e.path.replace(/^\/v1/, '')}`).sort()
    expect(registered).toEqual(Object.keys(ROUTE_CLASSES).sort())
  })

  it('selection: tri lists requests of its PTs only; ?company= / header narrow', async () => {
    const own = await ok(call('POST', E, tri, { ...draftBody(w), requesterIds: [X.empTriA], bankAccountId: X.accTriA }, key()), 201)
    const all = await ok(call('GET', `${E}?scope=all&limit=100`, tri))
    const pts = new Set((all.items as Body[]).map((i) => i.companyId))
    expect(pts.has(A)).toBe(true)
    expect([...pts].every((p) => [A, B, C].includes(p))).toBe(true)
    expect((all.items as Body[]).map((i) => i.id)).toContain(X.reqC) // Finance in C reads C
    const onlyC = await ok(call('GET', `${E}?scope=all&limit=100&company=${C}`, tri))
    expect((onlyC.items as Body[]).every((i) => i.companyId === C)).toBe(true)
    expect((onlyC.items as Body[]).map((i) => i.id)).not.toContain(own.id)
    const hdrA = await ok(call('GET', `${E}?scope=all&limit=100`, tri, undefined, H(A)))
    expect((hdrA.items as Body[]).map((i) => i.id)).not.toContain(X.reqC)
    // solo never sees C
    const soloAll = await ok(call('GET', `${E}?scope=all&limit=100`, solo))
    expect((soloAll.items as Body[]).every((i) => i.companyId === A)).toBe(true)
  })

  it('document: another PT\'s request → 404; the role is checked in the document\'s PT', async () => {
    expect((await call('GET', `${E}/${X.reqC}`, solo)).status).toBe(404)
    expect((await call('GET', `${E}/${X.reqC}/pdf`, solo)).status).toBe(404)
    expect((await call('GET', `${E}/${X.reqA}`, bc)).status).toBe(404)
    const detailC = await ok(call('GET', `${E}/${X.reqC}`, tri))
    expect(detailC.companyId).toBe(C)
    // tri is Finance in C but only Staff in A: Finance actions on an A request are refused
    expect([403, 404]).toContain((await call('POST', `${E}/${X.reqA}/acknowledge`, tri, {}, key())).status)
    // the header hides a document of a PT outside the selection
    expect((await call('GET', `${E}/${X.reqC}`, tri, undefined, H(A))).status).toBe(404)
  })

  it('document + named-pt beyond requests: cash entries, stages, attendance recap across PTs', async () => {
    // named-pt: Finance of C posts to a C account; Direktur-only in C (bc) cannot post there
    const entry = await ok(call('POST', '/api/v1/cash-entries', financeAC, { direction: 'out', cashAccountId: X.cashC, amount: 12_000, description: 'MC3 kas C', categoryId: X.catC }, key()), 201)
    expect(entry.companyId).toBe(C)
    expect([400, 403]).toContain((await call('POST', '/api/v1/cash-entries', bc, { direction: 'out', cashAccountId: X.cashC, amount: 12_000, description: 'MC3 bukan Finance C', categoryId: X.catC }, key())).status)
    // document: Finance of A only → 404 on the C entry; Finance of C may edit it
    expect((await call('PATCH', `/api/v1/cash-entries/${entry.id}`, w.users.finance, { reason: 'uji lintas PT', description: 'x' }, key())).status).toBe(404)
    expect((await call('POST', `/api/v1/cash-entries/${entry.id}/void`, w.users.finance, { reason: 'uji lintas PT' }, key())).status).toBe(404)
    await ok(call('PATCH', `/api/v1/cash-entries/${entry.id}`, financeAC, { reason: 'uji MC3', description: 'MC3 kas C (ubah)' }, key()))
    const listA = await ok(call('GET', `/api/v1/cash-entries?limit=100`, w.users.finance))
    expect((listA.items as Body[]).map((i) => i.id)).not.toContain(entry.id)
    // stages of a C project: invisible to A-only users; PM of B cannot edit them
    expect((await call('GET', `/api/v1/projects/${X.projectC}/stages`, solo)).status).toBe(404)
    expect([403, 404]).toContain((await call('PUT', `/api/v1/projects/${X.projectC}/stages`, tri, { stages: [{ name: 'Tahap 1', weightPct: 100, sequence: 1 }], reason: 'uji lintas PT' }, key())).status)
    // attendance recap of a C employee: PM of A → 404 (not a team member of A)
    expect([403, 404]).toContain((await call('GET', `/api/v1/attendance/recap?employee_id=${X.empC}`, w.users.pm)).status)
  })

  it('named-pt: creating in a PT without membership / role is refused', async () => {
    const r = await call('POST', E, solo, { ...draftBody(w), projectId: X.projectC, lines: [{ description: 'x', total: 10_000, categoryId: X.catC }] }, key())
    expect([400, 403, 404]).toContain(r.status)
    const close = await call('POST', '/api/v1/period-closings', financeAC, { period: '2020-01', company: B }, key())
    expect(close.status).toBe(403)
  })

  it('own + public: notifications carry companyId; health needs no company', async () => {
    const n = await ok(call('GET', '/api/v1/notifications?limit=100', ownerAC))
    const ids = new Set((n.items as Body[]).map((i) => i.companyId))
    expect(ids.has(A) && ids.has(C)).toBe(true)
    const nc = await ok(call('GET', `/api/v1/notifications?limit=100&company=${C}`, ownerAC))
    expect((nc.items as Body[]).length).toBeGreaterThan(0)
    expect((nc.items as Body[]).every((i) => i.companyId === C)).toBe(true)
    expect((await http('GET', '/api/v1/health')).status).toBe(200)
  })
})

// ------------------------------------------------------------------------------------ queues

describe('MC3 — queue endpoints ?company=', () => {
  it('approval inbox (Direktur A + C) → both PTs with company refs; ?company=C only C', async () => {
    const inbox = await ok(call('GET', '/api/v1/approvals/inbox', ownerAC))
    const byId = new Map((inbox.items as Body[]).map((i) => [i.id, i.company?.id]))
    expect(byId.get(X.reqA)).toBe(A)
    expect(byId.get(X.reqC)).toBe(C)
    const onlyC = await ok(call('GET', `/api/v1/approvals/inbox?company=${C}`, ownerAC))
    expect((onlyC.items as Body[]).map((i) => i.id)).toContain(X.reqC)
    expect((onlyC.items as Body[]).every((i) => i.company?.id === C)).toBe(true)
  })

  it('transfer queue + LPJ queue per PT (Finance A + C)', async () => {
    for (const id of [X.reqA, X.reqC]) {
      await ok(call('POST', `${E}/${id}/acknowledge`, ownerAC, {}, key()))
      await ok(call('POST', `${E}/${id}/approve`, financeAC, {}, key()))
    }
    const q = await ok(call('GET', '/api/v1/transfer-queue', financeAC))
    const ids = (q.items as Body[]).map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining([X.reqA, X.reqC]))
    const qa = await ok(call('GET', `/api/v1/transfer-queue?company=${A}`, financeAC))
    expect((qa.items as Body[]).map((i) => i.id)).toContain(X.reqA)
    expect((qa.items as Body[]).every((i) => i.companyId === A)).toBe(true)
    // tri: Finance only in C → the A request never appears
    const qt = await ok(call('GET', '/api/v1/transfer-queue', tri))
    expect((qt.items as Body[]).map((i) => i.id)).not.toContain(X.reqA)
    const lpj = await ok(call('GET', `/api/v1/lpj-queue?company=${C}`, financeAC))
    expect(Array.isArray(lpj.items)).toBe(true)
    expect((lpj.items as Body[]).every((i) => i.company?.id === C)).toBe(true)
    expect((await call('GET', '/api/v1/lpj-queue', solo)).status).toBe(403)
  })

  it('addenda list / inbox, progress reports, attendance accept ?company= of the selection', async () => {
    for (const path of ['/api/v1/budget-addenda', '/api/v1/budget-addenda/inbox', '/api/v1/progress-reports']) {
      const r = await ok(call('GET', `${path}?company=${C}`, ownerAC))
      expect((r.items as Body[]).every((i) => i.companyId === C)).toBe(true)
    }
    const team = await ok(call('GET', `/api/v1/attendance/team-today?company=${B}`, tri))
    expect((team.members as Body[]).every((m) => m.companyId === B)).toBe(true)
    // own recap per PT: the employee of THAT PT
    const recapB = await call('GET', `/api/v1/attendance/me?company=${B}`, tri)
    expect(recapB.status, JSON.stringify(recapB.body).slice(0, 300)).toBe(200)
    expect(JSON.stringify(recapB.body)).toContain(String(X.empTriB))
    expect((await call('GET', `/api/v1/attendance/me?company=${A},${B}`, tri)).status).toBe(400)
  })
})

// ------------------------------------------------------------------------------------ masters

describe('MC3 — masters per PT', () => {
  type M = { companies: Array<{ id: number; version: string; defaultGeofenceRadiusM: number }>; sharedVersion: string; types: Record<string, { items: Body[] }> }

  it('company on every item, shared masters marked, default radius of the item\'s PT', async () => {
    const all = await ok(call('GET', '/api/v1/masters?types=projects,uoms,cash-in-sources', tri))
    const m = all as unknown as M
    expect(m.companies.map((c) => c.id)).toEqual([A, B, C])
    const projectPts = new Set(m.types.projects!.items.map((i) => i.company))
    expect(projectPts).toEqual(new Set([A, B, C]))
    expect(m.types.uoms!.items.length).toBeGreaterThan(0)
    expect(m.types.uoms!.items.every((i) => i.shared === true && i.company === null)).toBe(true)
    expect(m.types.projects!.items.every((i) => i.shared === false)).toBe(true)
    // Finance only in C → cash-in sources of C only (Staff/PM cannot read them)
    expect(m.types['cash-in-sources']!.items.length).toBeGreaterThan(0)
    expect(m.types['cash-in-sources']!.items.every((i) => i.company === C)).toBe(true)
    const b2 = m.types.projects!.items.find((i) => i.id === X.projectB2)!
    expect(b2.radiusM).toBe(321)
    expect(m.companies.find((c) => c.id === B)!.defaultGeofenceRadiusM).toBe(321)
  })

  it('header / ?company= = one PT; ETag → 304; a change in B changes only B\'s version', async () => {
    const q = '/api/v1/masters?types=projects,uoms'
    const b1 = await call('GET', q, tri, undefined, H(B))
    expect(b1.status).toBe(200)
    const mb = b1.body as M
    expect(mb.companies.map((c) => c.id)).toEqual([B])
    expect(mb.types.projects!.items.every((i) => i.company === B)).toBe(true)
    const etag = b1.headers.get('etag')!
    expect(etag).toMatch(/^W\/"m1-/)
    const same = await call('GET', `/api/v1/masters?types=projects,uoms&company=${B}`, tri)
    expect(same.headers.get('etag')).toBe(etag)
    const nm = await call('GET', q, tri, undefined, { ...H(B), 'If-None-Match': etag })
    expect(nm.status).toBe(304)
    expect(nm.body).toBeNull()
    const c1 = (await ok(call('GET', q, tri, undefined, H(C)))) as unknown as M
    const p = await getTestPayload()
    await p.update({ collection: 'projects', id: X.projectB!, data: { name: 'Proyek Contoh Enam (ubah)' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    const b2 = await call('GET', q, tri, undefined, { ...H(B), 'If-None-Match': etag })
    expect(b2.status).toBe(200)
    expect((b2.body as M).companies[0]!.version).not.toBe(mb.companies[0]!.version)
    expect(b2.headers.get('etag')).not.toBe(etag)
    const c2 = (await ok(call('GET', q, tri, undefined, H(C)))) as unknown as M
    expect(c2.companies[0]!.version).toBe(c1.companies[0]!.version)
    expect(c2.sharedVersion).toBe(mb.sharedVersion)
  })
})

// ------------------------------------------------------------------------------------ sync

describe('MC3 — sync/batch per item PT', () => {
  it('mixed-PT outbox: each item under its company_id whatever the header; mismatch / foreign / role refused', async () => {
    const a = await apk(tri)
    const i1 = draftItem(draftIn('B', 'MC3 sync B'), B)
    const i2 = draftItem(draftIn('A', 'MC3 sync A'), A)
    const i3 = draftItem(draftIn('B', 'MC3 sync salah PT'), A)
    const i4 = draftItem(draftIn('A', 'MC3 sync PT asing'), 999_999)
    const i5 = { ...draftItem({ project_id: w.project, stage_id: 1, pct_after: 10, work: 'Uji' }, A), type: 'progress_report.draft_upsert' }
    const r = await sync(a, [i1, i2, i3, i4, i5], H(A))
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200)
    const res = (r.body as Body).results as Body[]
    expect(res.map((x) => [x.status, x.company_id, x.errors.map((e: Body) => e.code)])).toEqual([
      ['applied', B, []],
      ['applied', A, []],
      ['rejected', A, ['COMPANY_MISMATCH']],
      ['rejected', null, ['COMPANY_NOT_ALLOWED']],
      ['rejected', A, ['FORBIDDEN']],
    ])
    expect(await companyOfRequest(Number(res[0]!.server_id))).toBe(B)
    expect(await companyOfRequest(Number(res[1]!.server_id))).toBe(A)
    // audit row of the sync is tagged with the item's PT
    const au = await sqlAs('app', "SELECT company_id FROM audit_logs WHERE action = 'sync_offline' AND doc_id = $1 ORDER BY id DESC LIMIT 1", [res[0]!.server_id])
    expect(Number(au.rows[0]?.company_id)).toBe(B)
    // idempotency unchanged: replay → duplicate with the stored result
    const again = await sync(a, [i1], H(C))
    expect(((again.body as Body).results as Body[])[0]).toMatchObject({ status: 'duplicate', original_status: 'applied', company_id: B })
  })

  it('released APK (no company_id): several PTs → 409 COMPANY_REQUIRED, nothing processed; one PT → accepted', async () => {
    const a = await apk(tri)
    const legacy = draftItem(draftIn('A', 'MC3 lama'))
    const r = await sync(a, [draftItem(draftIn('B', 'MC3 baru'), B), legacy])
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'COMPANY_REQUIRED', errors: [{ path: 'items.1.company_id' }] })
    const stored = await sqlAs('app', 'SELECT count(*)::int AS n FROM sync_receipts WHERE client_uuid = $1::uuid', [legacy.client_uuid])
    expect(Number(stored.rows[0]?.n)).toBe(0)
    // one PT (released APK user): exactly as before, processed under the only PT
    const s = await apk(solo)
    const one = await sync(s, [
      draftItem({ kind: 'advance', title: 'MC3 lama satu PT', project_id: w.project, requester_ids: [w.emp.a], bank_account_id: w.accA, needed_date: '2026-09-30', lines: [{ description: 'x', total: 10_000, category_id: w.cat.mat }] }),
    ])
    expect(one.status).toBe(200)
    const first = ((one.body as Body).results as Body[])[0]!
    expect([first.status, first.company_id]).toEqual(['applied', A])
    // …and a released-APK item referencing a PT the user is NOT mapped to is answered like a missing
    // project (QA-MC4-14, scope rule: was COMPANY_MISMATCH = an existence oracle; still a final rejection)
    const foreign = await sync(s, [draftItem({ kind: 'advance', title: 'MC3 asing', project_id: X.projectC, requester_ids: [w.emp.a], bank_account_id: w.accA, lines: [{ description: 'x', total: 10_000 }] })])
    const missing = await sync(s, [draftItem({ kind: 'advance', title: 'MC3 hilang', project_id: 999_999_999, requester_ids: [w.emp.a], bank_account_id: w.accA, lines: [{ description: 'x', total: 10_000 }] })])
    const errs = (r: typeof foreign) => ((r.body as Body).results as Body[])[0]!.errors.map((e: Body) => [e.code, e.field, e.message])
    expect(((foreign.body as Body).results as Body[])[0]!.status).toBe('rejected')
    expect(errs(foreign)).toEqual(errs(missing))
    expect(errs(foreign).map((e: unknown[]) => e[0])).not.toContain('COMPANY_MISMATCH')
  })
})
