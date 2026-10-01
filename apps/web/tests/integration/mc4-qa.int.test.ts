import { randomUUID } from 'node:crypto'

import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'
import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'

import { api, makeFlowUser, sysCreate, type FlowUser, type Res } from './flow-world'
import { addMembership, companyId, getTestPayload, installFakeKeycloak, makeUser, sqlAs, type TestUser } from './helpers'

/**
 * MC4 QA security review (docs/proyekkas/qa/mc4-qa-report.md, ADR 0016 risk #8 "IDOR across PTs").
 * Regression tests for the confirmed HIGH findings:
 *
 * QA-MC4-01 — REST create of a DERIVED-company document (PT copied from the parent: employee bank
 *   account, team assignment, budget line) with a body `company` of the caller's own PT A: create access
 *   checked the role in A, the field access then dropped `company`, `companyHook` derived PT B from the
 *   parent and nobody checked the role in B (the DB trigger accepts it: every reference is in B).
 * QA-MC4-02 — an Admin of PT A could update identity fields (email, name, active) of accounts that are
 *   also members of another PT, including a group admin (after adding them to A with a membership, or
 *   when the group admin has no membership at all) → cross-PT account takeover / lock-out.
 *
 * QA-MC4-03 — audit rows of per-PT documents written without a PT tag (request lines, signatures, PDF
 *   export, …) and every untagged row were shown to the Admin / Direktur of ANY PT (REST
 *   /api/audit-logs, report `audit-log`, admin dashboard) → PT B amounts, descriptions and doc numbers
 *   readable by the Admin / Direktur of PT A.
 *
 * PTs: A = #1 DRMS, B = fictional "PT Contoh QA" (CQA), deactivated in afterAll.
 */
let A = 0
let B = 0
const X: Record<string, number> = {}
let finA: FlowUser
let ownerA: FlowUser
let adminA: FlowUser
let adminAStaffB: FlowUser
let groupAdminB: TestUser
let groupAdminNoPt: TestUser
let sharedAB: TestUser
let onlyA: TestUser
let staffB: FlowUser
let ownerB: FlowUser

const call = async (method: string, path: string, user: FlowUser, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
  resetRateLimits()
  return api(method, path, user, body, headers)
}
const key = () => ({ 'Idempotency-Key': randomUUID() })
const count = async (q: string, params: unknown[]) => Number((await sqlAs('app', q, params)).rows[0]?.n ?? 0)

beforeAll(async () => {
  const p = await getTestPayload()
  installFakeKeycloak()
  const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
  await seed(p, {
    uoms,
    banks,
    companies: [drms, { ...drms, company: { name: 'PT Contoh QA', shortCode: 'CQA', timezone: 'Asia/Makassar' }, vehicles: [] }],
  })
  A = await companyId()
  B = await companyId('CQA')
  await p.update({ collection: 'companies', id: B, data: { active: true, changeReason: 'uji MC4 QA' } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  const inPt = async (company: number, collection: CollectionSlug, code: string) =>
    (await p.find({ collection, where: { and: [{ company: { equals: company } }, { code: { equals: code } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  X.catB = await inPt(B, 'expense-categories', 'MAT')
  X.bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number

  X.empB = await sysCreate('employees', { company: B, code: 'QA-B1', name: 'Karyawan Contoh QA' })
  X.empSelfB = await sysCreate('employees', { company: B, code: 'QA-B2', name: 'Admin A sebagai Staff B' })
  X.projectB = await sysCreate('projects', { company: B, code: 'QA-PB', name: 'Proyek Contoh QA', budget: 10_000_000, status: 'berjalan' })

  finA = await makeFlowUser(['pk-finance'], 'qa-fin-a', null, { signature: false })
  ownerA = await makeFlowUser(['pk-owner'], 'qa-owner-a', null, { signature: false })
  adminA = await makeFlowUser(['pk-admin'], 'qa-admin-a', null, { signature: false, groupAdmin: false })
  adminAStaffB = await makeFlowUser(['pk-admin'], 'qa-admin-a-staff-b', null, { signature: false, groupAdmin: false })
  await addMembership(adminAStaffB.id, B, ['pk-staff'], X.empSelfB)

  groupAdminB = await makeUser(['pk-admin'], { company: B, groupAdmin: true, label: 'qa-group-admin-b' })
  sharedAB = await makeUser(['pk-staff'], { label: 'qa-shared-ab' })
  await addMembership(sharedAB.id, B, ['pk-finance'])
  onlyA = await makeUser(['pk-staff'], { label: 'qa-only-a' })
  const ga = await p.create({
    collection: 'users',
    data: { email: `qa-group-admin-nopt-${randomUUID().slice(0, 8)}@drms.test`, keycloakSub: randomUUID(), active: true, groupAdmin: true },
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: fixture (group admin without any membership)
    context: { skipKeycloakSync: true },
  })
  groupAdminNoPt = { ...(ga as unknown as TestUser), roles: [], collection: 'users' }

  // QA-MC4-03: a submitted request of PT B (+ its PDF) by a B-only staff member
  X.empStaffB = await sysCreate('employees', { company: B, code: 'QA-B3', name: 'Staff Contoh QA' })
  await sysCreate('team-assignments', { employee: X.empStaffB, project: X.projectB, roleInProject: 'staff' })
  X.accStaffB = await sysCreate('employee-bank-accounts', { employee: X.empStaffB, bank: X.bank, accountNo: `93${Date.now() % 1e8}`, accountHolder: 'Staff Contoh QA', isDefault: true })
  staffB = await makeFlowUser(['pk-staff'], 'qa-staff-b', X.empStaffB, { company: B })
  ownerB = await makeFlowUser(['pk-owner'], 'qa-owner-b', null, { company: B, signature: false })
  await makeFlowUser(['pk-finance'], 'qa-fin-b', null, { company: B, signature: false })
  const body = { type: 'advance', title: 'QA rahasia PT B', projectId: X.projectB, requesterIds: [X.empStaffB], bankAccountId: X.accStaffB, neededDate: '2026-10-30', lines: [{ description: 'Material rahasia PT B', total: 4_321_000, categoryId: X.catB }] }
  const d = await call('POST', '/api/v1/expense-requests', staffB, body, key())
  expect(d.status, JSON.stringify(d.body).slice(0, 300)).toBe(201)
  X.reqB = d.body.id as number
  const sub = await call('POST', `/api/v1/expense-requests/${X.reqB}/submit`, staffB, {}, key())
  expect(sub.status, JSON.stringify(sub.body).slice(0, 300)).toBe(200)
  expect((await call('GET', `/api/v1/expense-requests/${X.reqB}/pdf`, staffB)).status).toBe(200)
})

afterAll(async () => {
  const p = await getTestPayload()
  if (B) await p.update({ collection: 'companies', id: B, data: { active: false, changeReason: 'uji MC4 QA selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

describe('QA-MC4-01: derived-company REST creates check the role IN the parent PT', () => {
  it('Finance of A cannot add a bank account to an employee of B by naming company A', async () => {
    const accountNo = `77${Date.now() % 1e9}`
    const r = await call('POST', '/api/employee-bank-accounts', finA, { company: A, employee: X.empB, bank: X.bank, accountNo, accountHolder: 'Penyerang', isDefault: true })
    expect([403, 404], JSON.stringify(r.body).slice(0, 300)).toContain(r.status)
    expect(await count('SELECT count(*)::int AS n FROM employee_bank_accounts WHERE account_no = $1', [accountNo])).toBe(0)
  })

  it('control: the same request without `company` was already refused (role checked in the derived PT)', async () => {
    const accountNo = `78${Date.now() % 1e9}`
    const r = await call('POST', '/api/employee-bank-accounts', finA, { employee: X.empB, bank: X.bank, accountNo, accountHolder: 'Penyerang', isDefault: true })
    expect(r.status).toBe(403)
    expect(await count('SELECT count(*)::int AS n FROM employee_bank_accounts WHERE account_no = $1', [accountNo])).toBe(0)
  })

  it('Admin of A who is only Staff in B cannot assign themselves as PM of a B project by naming company A', async () => {
    const r = await call('POST', '/api/team-assignments', adminAStaffB, { company: A, employee: X.empSelfB, project: X.projectB, roleInProject: 'pm' })
    expect([403, 404], JSON.stringify(r.body).slice(0, 300)).toContain(r.status)
    expect(await count('SELECT count(*)::int AS n FROM team_assignments WHERE employee_id = $1 AND project_id = $2', [X.empSelfB, X.projectB])).toBe(0)
  })

  it('Direktur of A cannot add a budget line to a B project by naming company A', async () => {
    const r = await call('POST', '/api/budget-lines', ownerA, { company: A, project: X.projectB, category: X.catB, amount: 999_000 })
    expect([403, 404], JSON.stringify(r.body).slice(0, 300)).toContain(r.status)
    expect(await count('SELECT count(*)::int AS n FROM budget_lines WHERE project_id = $1', [X.projectB])).toBe(0)
  })
})

describe('QA-MC4-02: a PT Admin cannot change accounts that also belong to another PT', () => {
  const name = async (id: number) => String((await sqlAs('app', 'SELECT name FROM users WHERE id = $1', [id])).rows[0]?.name ?? '')
  const active = async (id: number) => (await sqlAs('app', 'SELECT active FROM users WHERE id = $1', [id])).rows[0]?.active as boolean

  it('group admin (member of B only), added to A by the Admin of A, cannot be renamed or deactivated by that Admin', async () => {
    const m = await call('POST', '/api/company-memberships', adminA, { user: groupAdminB.id, company: A, roles: ['pk-staff'], active: true })
    expect(m.status, JSON.stringify(m.body).slice(0, 300)).toBe(201) // onboarding a person of another PT stays allowed
    const r = await call('PATCH', `/api/users/${groupAdminB.id}`, adminA, { name: 'Diambil alih' })
    expect([403, 404], JSON.stringify(r.body).slice(0, 300)).toContain(r.status)
    expect(await name(groupAdminB.id)).not.toBe('Diambil alih')
    const d = await call('PATCH', `/api/users/${groupAdminB.id}`, adminA, { active: false, changeReason: 'uji QA lintas PT' })
    expect([403, 404]).toContain(d.status)
    expect(await active(groupAdminB.id)).toBe(true)
  })

  it('a group admin without any membership cannot be changed by a PT Admin', async () => {
    const r = await call('PATCH', `/api/users/${groupAdminNoPt.id}`, adminA, { active: false, changeReason: 'uji QA lintas PT' })
    expect([403, 404], JSON.stringify(r.body).slice(0, 300)).toContain(r.status)
    expect(await active(groupAdminNoPt.id)).toBe(true)
  })

  it('an account that is also a member of B cannot be deactivated by the Admin of A only', async () => {
    const r = await call('PATCH', `/api/users/${sharedAB.id}`, adminA, { active: false, changeReason: 'uji QA lintas PT' })
    expect([403, 404], JSON.stringify(r.body).slice(0, 300)).toContain(r.status)
    expect(await active(sharedAB.id)).toBe(true)
  })

  it('control: the Admin of A still manages accounts that belong to A only', async () => {
    const r = await call('PATCH', `/api/users/${onlyA.id}`, adminA, { name: 'Nama baru QA' })
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200)
    expect(await name(onlyA.id)).toBe('Nama baru QA')
  })
})

describe('QA-MC4-03: audit rows of PT B are not shown to the Admin / Direktur of PT A', () => {
  const docNoB = async () => String((await sqlAs('app', 'SELECT doc_no FROM expense_requests WHERE id = $1', [X.reqB])).rows[0]?.doc_no)

  it('every audit row of the PT B request (lines, signatures, PDF export) carries PT B', async () => {
    const rows = (await sqlAs('app', "SELECT action::text AS action, field, company_id FROM audit_logs WHERE doc_type = 'expense_request' AND doc_id = $1", [String(X.reqB)])).rows
    expect(rows.length).toBeGreaterThan(5)
    expect(rows.filter((r) => r.company_id !== B).map((r) => `${r.action}/${r.field}`)).toEqual([])
  })

  it('REST /api/audit-logs and the audit-log report of the Admin / Direktur of A contain nothing of PT B', async () => {
    for (const u of [adminA, ownerA]) {
      const rest = await call('GET', `/api/audit-logs?limit=0&depth=0&where[docId][equals]=${X.reqB}&where[docType][equals]=expense_request`, u)
      expect(rest.status).toBe(200)
      expect(rest.body.totalDocs, u.email).toBe(0)
      const byStaffB = await call('GET', `/api/audit-logs?limit=0&depth=0&where[userId][equals]=${staffB.id}`, u)
      expect(byStaffB.body.totalDocs, `${u.email}: untagged rows of a PT B user`).toBe(0)
      const rep = await call('GET', '/api/v1/reports/audit-log?dari=2026-01-01&sampai=2026-12-31', u)
      expect(rep.status).toBe(200)
      expect(JSON.stringify(rep.body)).not.toContain(await docNoB())
    }
  })

  it('control: the Direktur of B still sees the rows of the B request', async () => {
    const rest = await call('GET', `/api/audit-logs?limit=0&depth=0&where[docId][equals]=${X.reqB}&where[docType][equals]=expense_request`, ownerB)
    expect(rest.status).toBe(200)
    expect(rest.body.totalDocs).toBeGreaterThan(5)
  })
})
