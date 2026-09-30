import { randomUUID } from 'node:crypto'

import type { CollectionSlug } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { attendanceScope, narrowAttScope, narrowAttToCompanies, type AttScope } from '@/domain/attendance/queries'
import { teamTodayFor } from '@/domain/attendance/service'
import { mayCorrect, teamMonth } from '@/domain/attendance/web'
import { kasAccessIn } from '@/domain/cash/book'
import { balances, lockDates } from '@/domain/cash/ledger'
import { today } from '@/domain/expense/common'
import { transferQueue } from '@/domain/expense/queues'
import { resetRateLimits } from '@/lib/rate-limit'
import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'

import { api, asUser, draftBody, makeFlowUser, makeWorld, sysCreate, type FlowUser, type World } from './flow-world'
import { addMembership, companyId, getTestPayload, sqlAs, withContext } from './helpers'

/**
 * MC2 integration (admin UI ↔ backend, `mc2-contract.md`): the UI-facing endpoints and domain calls
 * of the admin views across TWO PTs — A = company #1 DRMS (world `MC2I`), B = fictional "PT Contoh
 * Empat" (CS4) — with users holding DIFFERENT roles per PT:
 *   mix   = Finance + Admin in A, PM in B (not a group admin)
 *   finAB = Finance in A and in B (closing must name the PT)
 *   finance (world) = Finance in A only — the Absensi leak regression (office user of A, project of B).
 * B is deactivated in afterAll (other files assume one active PT).
 */
let w: World
let A = 0
let B = 0
const X = {} as { catB: number; empB: number; empPmB: number; projectB: number; accB: number; cashB: number; reqA: number; reqB: number }
let mix: FlowUser
let finAB: FlowUser
let ownerB: FlowUser
let staffB: FlowUser
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const ok = async (p: Promise<{ status: number; body: unknown }>, status = 200) => {
  resetRateLimits()
  const r = await p
  expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(status)
  return r.body as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** The PT switcher (POST /api/v1/me/companies) → the same user with the selection cookie. */
async function switchTo(u: FlowUser, companyIds: number[] | null): Promise<FlowUser> {
  resetRateLimits()
  const r = await api('POST', '/api/v1/me/companies', u, { companyIds })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  const set = r.headers.get('set-cookie') ?? ''
  const pair = set.split(';')[0]!
  return { ...u, cookie: companyIds === null ? u.cookie : `${u.cookie}; ${pair}` }
}

async function attendance(employee: number, user: FlowUser, project: number, date: string) {
  const p = await getTestPayload()
  const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 40, g: 60, b: 80 } } }).jpeg().toBuffer()
  const selfie = await p.create({ collection: 'media-selfies', data: {}, file: { data: jpeg, mimetype: 'image/jpeg', name: 'mc2i.jpg', size: jpeg.length }, user, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  await sqlAs(
    'app',
    `INSERT INTO attendances (employee_id, user_id, kind, project_id, local_date, attendance_time, received_at, time_trust, offline, lat, lng, distance_m, selfie_id, client_uuid, source, updated_at, created_at)
     VALUES ($1, $2, 'check_in', $3, $4, now(), now(), 'server', false, -2.2, 113.9, 5, $5, $6, 'self', now(), now())`,
    [employee, user.id, project, date, selfie.id, randomUUID()],
  )
}

beforeAll(async () => {
  w = await makeWorld('MC2I')
  A = await companyId()
  const p = await getTestPayload()
  const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
  await seed(p, { uoms, banks, companies: [drms, { ...drms, company: { name: 'PT Contoh Empat', shortCode: 'CS4', timezone: 'Asia/Makassar' }, vehicles: [] }] })
  B = await companyId('CS4')
  const inPt = async (company: number, collection: CollectionSlug, code: string) =>
    (await p.find({ collection, where: { and: [{ company: { equals: company } }, { code: { equals: code } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  X.catB = await inPt(B, 'expense-categories', 'MAT')
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number

  X.empB = await sysCreate('employees', { company: B, code: 'MC2I-SB', name: 'Staf Contoh Empat' })
  X.empPmB = await sysCreate('employees', { company: B, code: 'MC2I-PMB', name: 'PM Contoh Empat' })
  mix = await makeFlowUser(['pk-finance', 'pk-admin'], 'mc2i-mix', null, { groupAdmin: false })
  await addMembership(mix.id, B, ['pk-pm'], X.empPmB)
  finAB = await makeFlowUser(['pk-finance'], 'mc2i-finab', null)
  await addMembership(finAB.id, B, ['pk-finance'])
  ownerB = await makeFlowUser(['pk-owner'], 'mc2i-owner-b', null, { company: B })
  staffB = await makeFlowUser(['pk-staff'], 'mc2i-staff-b', X.empB, { company: B })

  X.projectB = await sysCreate('projects', { company: B, code: 'MC2I-PB', name: 'Proyek Contoh Empat', pm: mix.id, budget: 30_000_000, status: 'berjalan' })
  await sysCreate('team-assignments', { employee: X.empB, project: X.projectB, roleInProject: 'staff' })
  X.accB = await sysCreate('employee-bank-accounts', { employee: X.empB, bank, accountNo: `74${Date.now() % 1e8}`, accountHolder: 'Staf Contoh Empat', isDefault: true })
  X.cashB = await sysCreate('cash-accounts', { company: B, name: 'MC2I Kas Contoh Empat', kind: 'bank', openingBalance: 9_000_000 })

  // attendance today: A employee at the A project, B employee at the B project
  const d = await asUser(w.users.finance, (req) => today(req))
  await attendance(w.emp.a, w.users.staffA, w.project, d)
  await attendance(X.empB, staffB, X.projectB, d)

  // transfer queue: one approved request per PT
  const a = await ok(api('POST', E, w.users.staffA, draftBody(w, { title: 'MC2I A' }), key()), 201)
  await ok(api('POST', `${E}/${a.id}/submit`, w.users.staffA, {}, key()))
  await ok(api('POST', `${E}/${a.id}/acknowledge`, w.users.owner, {}, key()))
  await ok(api('POST', `${E}/${a.id}/approve`, w.users.finance, {}, key()))
  X.reqA = a.id
  const b = await ok(
    api('POST', E, staffB, { type: 'advance', title: 'MC2I B', projectId: X.projectB, requesterIds: [X.empB], bankAccountId: X.accB, neededDate: '2026-09-30', lines: [{ description: 'Material', total: 300_000, categoryId: X.catB }] }, key()),
    201,
  )
  await ok(api('POST', `${E}/${b.id}/submit`, staffB, {}, key()))
  await ok(api('POST', `${E}/${b.id}/acknowledge`, ownerB, {}, key()))
  await ok(api('POST', `${E}/${b.id}/approve`, finAB, {}, key()))
  X.reqB = b.id
})

afterAll(async () => {
  const p = await getTestPayload()
  if (B) await p.update({ collection: 'companies', id: B, data: { active: false, changeReason: 'uji MC2 integrasi selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

describe('MC2 integration — Absensi filters are bound to the PT (mc2-contract §0.1)', () => {
  it('office user of PT A filtering by a PT B project id sees nothing of B (was: the company-less narrow() leaked B)', async () => {
    const fin = w.users.finance
    const month = (await asUser(fin, (req) => today(req))).slice(0, 7)
    const scope = (await asUser(fin, (req) => attendanceScope(req)))!
    expect(scope.parts).toEqual([{ company: A, all: true, projects: [], costCenters: [] }])
    // before the fix the view built this company-less literal from the query string; MC4: the
    // domain no longer honours a literal without PT parts at all (it matches nothing)
    const legacy: AttScope = { kind: 'team', projects: [X.projectB], costCenters: [] }
    const leaked = await asUser(fin, (req) => teamMonth(req, legacy, month))
    expect(leaked, 'MC4: a company-blind literal matches nothing').toEqual([])
    // the view now narrows with narrowAttScope → the PT A predicate stays
    const grid = await asUser(fin, (req) => teamMonth(req, narrowAttScope(scope, X.projectB), month))
    expect(grid).toEqual([])
    const own = await asUser(fin, (req) => teamMonth(req, narrowAttScope(scope, w.project), month))
    expect(own.map((e) => e.id)).toContain(w.emp.a)
    expect(new Set(own.map((e) => e.companyId))).toEqual(new Set([A]))
    // "Tim hari ini" with the same filter (+ PT ids on the rows)
    const t = await asUser(fin, (req) => teamTodayFor(req, { projectId: X.projectB }))
    expect(t.members).toEqual([])
    const tA = await asUser(fin, (req) => teamTodayFor(req, {}))
    expect(tA.members.length).toBeGreaterThan(0)
    for (const m of tA.members) expect(m.companyId).toBe(A)
    // PT filter to a PT without attendance rights → nothing (never widened)
    expect(narrowAttToCompanies(scope, [B]).parts).toEqual([])
    expect((await asUser(fin, (req) => teamTodayFor(req, { companyIds: [B] }))).members).toEqual([])
  })

  it('mix (Finance A, PM B): grid rows carry their PT; the PT filter narrows to B; correction rights per employee PT', async () => {
    const m = await withContext(mix)
    const month = (await asUser(m as FlowUser, (req) => today(req))).slice(0, 7)
    const scope = (await asUser(m as FlowUser, (req) => attendanceScope(req)))!
    const all = await asUser(m as FlowUser, (req) => teamMonth(req, scope, month))
    const pts = new Map(all.map((e) => [e.id, e.companyId]))
    expect(pts.get(w.emp.a)).toBe(A)
    expect(pts.get(X.empB)).toBe(B)
    const onlyB = await asUser(m as FlowUser, (req) => teamMonth(req, narrowAttToCompanies(scope, [B]), month))
    expect(onlyB.map((e) => e.companyId)).toEqual([B])
    const today2 = await asUser(m as FlowUser, (req) => teamTodayFor(req, { companyIds: [B] }))
    expect(today2.members.map((x) => [x.employee.id, x.companyId])).toEqual([[X.empB, B]])
    // T10: Admin of A may correct an A employee, PM of B a B team member; never with the other PT's id
    await asUser(m as FlowUser, async (req) => {
      expect(mayCorrect(req, scope, w.emp.a, A)).toBe(true)
      expect(mayCorrect(req, scope, X.empB, B)).toBe(true)
      return null
    })
    const fin = await withContext(w.users.finance)
    const finScope = (await asUser(fin as FlowUser, (req) => attendanceScope(req)))!
    await asUser(fin as FlowUser, async (req) => {
      expect(mayCorrect(req, finScope, w.emp.a, A)).toBe(false) // Finance reads, Admin/PM correct
      return null
    })
  })
})

describe('MC2 integration — switcher cookie × dashboards × queues (different roles per PT)', () => {
  it('mix: finance dashboard = A only, PM dashboard = B only; the switcher selection gates both', async () => {
    const fin = await ok(api('GET', '/api/v1/dashboard/finance', mix))
    expect(fin.companies.map((c: { id: number }) => c.id)).toEqual([A])
    expect(fin.cashByCompany.map((c: { companyId: number }) => c.companyId)).toEqual([A])
    expect(fin.lastClosedByCompany.map((c: { companyId: number }) => c.companyId)).toEqual([A])
    expect(fin.transferQueue.byCompany.map((c: { companyId: number }) => c.companyId)).toEqual([A])
    const pm = await ok(api('GET', '/api/v1/dashboard/pm', mix))
    expect(pm.companies.map((c: { id: number }) => c.id)).toEqual([B])
    expect(pm.teamMonthByCompany.map((c: { companyId: number }) => c.companyId)).toEqual([B])
    for (const p of pm.projects) expect(p.companyId).toBe(B)

    const onlyB = await switchTo(mix, [B])
    resetRateLimits()
    expect((await api('GET', '/api/v1/dashboard/finance', onlyB)).status).toBe(403)
    expect((await ok(api('GET', '/api/v1/dashboard/pm', onlyB))).companies.map((c: { id: number }) => c.id)).toEqual([B])
    const onlyA = await switchTo(mix, [A])
    resetRateLimits()
    expect((await api('GET', '/api/v1/dashboard/pm', onlyA)).status).toBe(403)
    // a PT without membership → 403 COMPANY_NOT_ALLOWED (never widens)
    resetRateLimits()
    const foreign = await api('POST', '/api/v1/me/companies', w.users.finance, { companyIds: [B] })
    expect(foreign.status).toBe(403)
    expect(foreign.body.code).toBe('COMPANY_NOT_ALLOWED')
  })

  it('finAB: Σ per PT = combined; queue items carry their PT; the selection narrows the queue and Kas', async () => {
    const fin = await ok(api('GET', '/api/v1/dashboard/finance', finAB))
    expect(fin.cashByCompany.map((c: { companyId: number }) => c.companyId)).toEqual([A, B])
    expect(fin.cashByCompany.reduce((s: number, c: { total: number }) => s + c.total, 0)).toBe(fin.cashTotal)
    expect(fin.transferQueue.byCompany.reduce((s: number, c: { count: number }) => s + c.count, 0)).toBe(fin.transferQueue.count)

    const ctx = await withContext(finAB)
    const q = await asUser(ctx as FlowUser, (req) => transferQueue(req))
    const byId = new Map(q.map((i) => [i.id, i.company?.id]))
    expect(byId.get(X.reqA)).toBe(A)
    expect(byId.get(X.reqB)).toBe(B)
    expect(q.find((i) => i.id === X.reqB)?.company?.shortCode).toBe('CS4')
    const mixQ = await asUser((await withContext(mix)) as FlowUser, (req) => transferQueue(req))
    // PM of B (Finance only in A): the Finance queue never lists B's team requests (bank snapshot)
    expect(mixQ.map((i) => i.company?.id)).not.toContain(B)
    expect(mixQ.map((i) => i.id)).toContain(X.reqA)
    const mixApi = await ok(api('GET', '/api/v1/transfer-queue', mix))
    expect(mixApi.items.map((i: { id: number }) => i.id)).not.toContain(X.reqB)

    const onlyB = await switchTo(finAB, [B])
    const list = await ok(api('GET', '/api/v1/transfer-queue', onlyB))
    const ids = (list.items ?? list).map((i: { id: number }) => i.id)
    expect(ids).toContain(X.reqB)
    expect(ids).not.toContain(X.reqA)

    const sel = await withContext(finAB, [B])
    await asUser(sel as FlowUser, async (req) => {
      expect(kasAccessIn(req)).toEqual({ view: [B], write: [B], close: [B], reopen: [] })
      const bal = await balances(req)
      expect(new Set(bal.map((a) => a.companyId))).toEqual(new Set([B]))
      return null
    })
  })

  it('Tutup buku: Finance of two PTs must name the PT (400), closing B never locks A', async () => {
    const before = await asUser((await withContext(finAB)) as FlowUser, (req) => lockDates(req, [A, B]))
    resetRateLimits()
    const amb = await api('POST', '/api/v1/period-closings', finAB, { period: '2023-05' }, key())
    expect(amb.status).toBe(400)
    expect(JSON.stringify(amb.body)).toMatch(/PT wajib dipilih/)
    const closed = await ok(api('POST', '/api/v1/period-closings', finAB, { period: '2023-05', company: B }, key()), 201)
    expect(closed.companyId).toBe(B)
    const list = await ok(api('GET', '/api/v1/period-closings', finAB))
    const locks = new Map(list.lockDates.map((l: { companyId: number; lockDate: string | null }) => [l.companyId, l.lockDate]))
    expect(locks.get(B)).toBe(before.find((l) => l.companyId === B)!.lockDate ?? '2023-05-31')
    expect(locks.get(A)).toBe(before.find((l) => l.companyId === A)!.lockDate)
    // reopen: Direktur of THAT PT only (finAB is not) — explicit company in the query
    resetRateLimits()
    expect((await api('POST', `/api/v1/period-closings/2023-05/reopen?company=${B}`, finAB, { reason: 'uji buka' }, key())).status).toBe(403)
    await ok(api('POST', `/api/v1/period-closings/2023-05/reopen?company=${B}`, ownerB, { reason: 'uji buka kembali' }, key()))
  })
})

describe('MC2 integration — role matrix batch (Admin of A only)', () => {
  it('a batch touching PT B is refused as a whole (403, cell path items.1); an A-only batch saves + audits the reason', async () => {
    const target = w.users.staffB
    const roles = async () => (await sqlAs('app', 'SELECT r.value FROM company_memberships m JOIN company_memberships_roles r ON r.parent_id = m.id WHERE m.user_id = $1 AND m.company_id = $2 ORDER BY 1', [target.id, A])).rows.map((x) => x.value)
    const mBefore = await roles()
    const mixed = await api('POST', '/api/v1/company-memberships/batch', mix, { reason: 'uji matriks integrasi', items: [{ user: target.id, company: A, roles: ['pk-staff', 'pk-pm'] }, { user: staffB.id, company: B, roles: ['pk-staff', 'pk-pm'] }] }, key())
    expect(mixed.status).toBe(403)
    expect(mixed.body.errors).toEqual([{ path: 'items.1', message: 'Anda bukan Admin PT ini.' }])
    expect(await roles()).toEqual(mBefore) // all-or-nothing: item 0 not saved either

    // a hook error names its item too (employee of another PT on an A membership)
    const bad = await api('POST', '/api/v1/company-memberships/batch', mix, { reason: 'uji matriks integrasi', items: [{ user: target.id, company: A, roles: ['pk-staff'], employee: X.empB }] }, key())
    expect([400, 409]).toContain(bad.status)
    expect(bad.body.errors?.[0]?.path).toBe('items.0')

    const saved = await ok(api('POST', '/api/v1/company-memberships/batch', mix, { reason: 'uji matriks integrasi', items: [{ user: target.id, company: A, roles: ['pk-staff', 'pk-pm'] }] }, key()))
    expect(saved.items).toMatchObject([{ user: target.id, company: A, roles: ['pk-pm', 'pk-staff'], created: false }])
    const audit = await sqlAs('app', "SELECT reason, company_id FROM audit_logs WHERE action = 'role_change' AND reason = 'uji matriks integrasi' ORDER BY id DESC LIMIT 1")
    expect(audit.rows[0]).toMatchObject({ reason: 'uji matriks integrasi' })
    await ok(api('POST', '/api/v1/company-memberships/batch', mix, { reason: 'uji matriks kembali', items: [{ user: target.id, company: A, roles: ['pk-staff'] }] }, key()))
  })
})
