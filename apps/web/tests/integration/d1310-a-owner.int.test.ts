import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { MSG_OWNER_ROLE_GROUP_ADMIN } from '@/collections/CompanyMemberships'
import { addDays } from '@/domain/expense/types'
import { pmDashboard } from '@/domain/reports/dashboards'
import { resetRateLimits } from '@/lib/rate-limit'
import { down as dataDown, OWNER_RULE, up as dataUp } from '@/migrations/20261013_630200_d1310_owner_role_data'
import { buildPdfData } from '@/pdf/data'

import { addMembership, companyId, getTestPayload, sqlAs } from './helpers'
import { ADR0013_FALLBACK_RULE, api, asUser, draftBody, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * ADR 0026 (owner decision 2026-10-13) through the real API + DB: the Owner (`pk-principal`) one approval level above
 * the Direktur — Staff → PM project → Direktur → Owner → Finance transfer queue; the Owner never decides the Direktur
 * level and vice versa (stored roles); notifications reach the Owner at his level; requests already submitted keep
 * their snapshot (in-flight flow unchanged); the LPJ shortfall re-approval uses the same rule (and roles); loans and
 * Addendum RAB stay Direktur-only; the Owner sees what the Direktur sees in each PT where he is Owner (dashboard,
 * lists, cash); the data migration 20261013_630200 is idempotent and leaves request snapshots alone.
 * The Owner's own request (no approval) and a Direktur's own request (→ Owner) are covered by d1010-e-approval.
 * Fictional data only. The shared test DB may hold other Owners of DRMS — assertions name this file's users.
 */
let w: World
let drms: number
let ownEmp: number
let principal: FlowUser
let pt2 = 0
let pt2Direktur: FlowUser
const E = '/api/v1/expense-requests'
const RULE = 'AOW rule PM→Direktur→Owner'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) // Asia/Makassar

beforeAll(async () => {
  w = await makeWorld('AOW') // ADR 0013 world rules — replaced below by the ADR 0026 shape
  drms = await companyId()
  await sqlAs('app', "UPDATE approval_rules SET active = false WHERE name LIKE 'AOW rule %'")
  await sysCreate('approval-rules', {
    company: drms,
    name: RULE,
    docType: 'expense_request',
    requestType: 'any',
    minAmount: 0,
    priority: 10,
    project: w.project,
    acknowledge: 'required',
    acknowledgeBy: 'scope_manager',
    acknowledgeRole: null,
    steps: [
      { level: 1, approverRole: 'pk-owner' },
      { level: 2, approverRole: 'pk-principal' },
    ],
    active: true,
  })
  ownEmp = await sysCreate('employees', { code: 'AOW-OWNER', name: 'AOW Owner' })
  principal = await makeFlowUser(['pk-principal'], 'aow-principal', ownEmp)
  // a second PT where the same Owner holds the Owner role (one membership per PT), with its own Direktur
  pt2 = await sysCreate('companies', { name: 'PT Uji Owner', shortCode: `OW${Date.now() % 1000}`, timezone: 'Asia/Makassar' })
  await addMembership(principal.id, pt2, ['pk-principal'], null)
  pt2Direktur = await makeFlowUser(['pk-owner'], 'aow-pt2-direktur', null, { company: pt2 })
}, 600_000)

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  // every other test file assumes the single-company default (same as d1010-loans / d1310-w3-dashboard)
  if (pt2) await p.update({ collection: 'companies', id: pt2, data: { active: false, changeReason: 'uji Owner selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

async function submitted(creator: FlowUser, body: Record<string, unknown>, expectStatus = 200) {
  const c = await api('POST', E, creator, body, key())
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const s = await api('POST', `${E}/${c.body.id}/submit`, creator, {}, key())
  expect(s.status, JSON.stringify(s.body)).toBe(expectStatus)
  return { id: c.body.id as number, body: s.body }
}

const notified = async (id: number, event: string) => (await sqlAs('app', 'SELECT user_id::int AS u, title FROM notifications WHERE event = $1 AND doc_id = $2 ORDER BY id', [event, String(id)])).rows
const inboxItem = async (u: FlowUser, id: number) => (await api('GET', '/api/v1/approvals/inbox', u)).body.items.find((i: { id: number }) => i.id === id)

async function proof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

async function receipt(id: number, lineId: string, amount: number, user: FlowUser = w.users.staffA) {
  const img = await upload('/api/v1/media/receipts', user, await png())
  expect(img.status).toBe(201)
  const r = await api('POST', `${E}/${id}/receipts`, user, { lineId, receiptNo: `AOW-${id}-${amount}-${randomUUID().slice(0, 5)}`, vendorName: 'Toko Maju', receiptDate: addDays(today(), -1), amount, imageId: img.body.id })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body
}

/** Staff request through PM → Direktur → Owner (approved). */
async function approvedByOwner(): Promise<number> {
  const { id } = await submitted(w.users.staffA, draftBody(w))
  expect((await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())).status).toBe(200)
  expect((await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())).status).toBe(200)
  const ok = await api('POST', `${E}/${id}/approve`, principal, {}, key())
  expect(ok.status, JSON.stringify(ok.body)).toBe(200)
  expect(ok.body.status).toBe('approved')
  return id
}

describe('1. Staff → PM project → Direktur → Owner → approved → Finance transfer queue', () => {
  it('each level only by its own role; notifications, inbox, labels, KPI, PDF and the queue follow', async () => {
    const { id, body } = await submitted(w.users.staffA, draftBody(w))
    expect(body).toMatchObject({
      status: 'pending_ack',
      statusLabel: 'Menunggu persetujuan PM',
      approvalRule: {
        name: RULE,
        steps: [
          { level: 1, approverRole: 'pk-owner' },
          { level: 2, approverRole: 'pk-principal' },
        ],
        decisionRoles: ['pk-owner', 'pk-finance', 'pk-principal'],
      },
    })
    // the Owner is neither the PM project nor the Direktur
    expect((await api('POST', `${E}/${id}/acknowledge`, principal, {}, key())).status).toBe(403)
    const ack = await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())
    expect(ack.body).toMatchObject({ status: 'pending_approval', currentLevel: 1, statusLabel: 'Menunggu persetujuan Direktur' })
    // level 1 = Direktur: the Owner (whose access implies the Direktur's) may NOT decide it
    expect((await api('POST', `${E}/${id}/approve`, principal, {}, key())).status).toBe(403)
    expect(await inboxItem(principal, id)).toBeUndefined()
    expect(await inboxItem(w.users.owner, id)).toMatchObject({ step: 'approve', stepLabel: 'Persetujuan Direktur', decisionBy: 'direktur', finalStep: false })
    expect((await notified(id, 'expense.pending_approval')).map((r) => r.u)).not.toContain(principal.id)
    const dir = await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())
    expect(dir.status, JSON.stringify(dir.body)).toBe(200)
    expect(dir.body).toMatchObject({ status: 'pending_approval', currentLevel: 2, statusLabel: 'Menunggu persetujuan Owner' })
    expect((await sqlAs('app', 'SELECT approved_at FROM expense_requests WHERE id = $1', [id])).rows[0].approved_at).toBeNull() // SLA starts at the Owner's approval
    // level 2 = Owner: notified as Owner; no Direktur asked at this level
    const ownerRows = (await notified(id, 'expense.pending_approval')).filter((r) => String(r.title).startsWith('Persetujuan Owner'))
    expect(ownerRows.map((r) => r.u)).toContain(principal.id)
    expect(ownerRows.map((r) => r.u)).not.toContain(w.users.owner.id)
    expect(ownerRows.map((r) => r.u)).not.toContain(w.users.owner2.id)
    for (const u of [w.users.owner, w.users.owner2]) expect((await api('POST', `${E}/${id}/approve`, u, {}, key())).status).toBe(403)
    expect(await inboxItem(w.users.owner, id)).toBeUndefined()
    expect(await inboxItem(principal, id)).toMatchObject({ step: 'approve', stepLabel: 'Persetujuan Owner', decisionBy: 'owner', finalStep: true })
    // the PM's team KPI names the Owner as the one deciding now
    const pmd = await asUser(w.users.pm, (req) => pmDashboard(req))
    expect(pmd.teamWaiting.owner).toBeGreaterThanOrEqual(1)
    expect(pmd.teamWaiting.items.find((i) => i.id === id)).toMatchObject({ waitingFor: 'owner' })
    // not in the transfer queue before the Owner approves
    expect((await api('GET', '/api/v1/transfer-queue', w.users.finance)).body.items.find((i: { id: number }) => i.id === id)).toBeUndefined()
    const ok = await api('POST', `${E}/${id}/approve`, principal, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body).toMatchObject({ status: 'approved', statusLabel: 'Disetujui (Antri Transfer)' })
    expect((await sqlAs('app', 'SELECT approved_at IS NOT NULL AS at FROM expense_requests WHERE id = $1', [id])).rows[0].at).toBe(true)
    expect((await api('GET', '/api/v1/transfer-queue', w.users.finance)).body.items.find((i: { id: number }) => i.id === id)).toMatchObject({ noApproval: false, noApprovalBy: null })
    // stepper of the detail: … Persetujuan Direktur (done) → Persetujuan Owner (done) → Transfer Finance (current)
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    const pdf = await asUser(w.users.finance, (req) => buildPdfData(req, id, { internal: false, printedBy: 'test' }))
    const box = pdf.signatures.find((s) => s.label === 'Approval')!
    // Owner 2026-10-14: document signatures stop at the Direktur — the Owner level is never printed
    const levelActor = (level: number) => (d.approvals as Array<{ position: string; level: number; actorName: string }>).find((a) => a.position === 'approval' && a.level === level)!.actorName
    expect(box.names).toBe(levelActor(1)) // the Direktur only, one printed level → no role suffix
    expect(box.names).not.toContain(levelActor(2))
    expect(box.names).not.toContain('(Owner)')
    expect(box.note).toBeUndefined()
    expect(d.status).toBe('approved')
    const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `AOW-${id}`, proofMediaId: await proof() }, key())
    expect(t.status, JSON.stringify(t.body)).toBe(201)
  })

  it('the Owner rejects at his level → Ditolak (reason required), Finance never sees it', async () => {
    const { id } = await submitted(w.users.staffA, draftBody(w))
    await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())
    await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())
    const r = await api('POST', `${E}/${id}/reject`, principal, { reason: 'anggaran ditunda' }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.status).toBe('rejected')
    // the Owner's rejection is not printed as a signature, but the box still says DITOLAK
    const box = (await asUser(w.users.finance, (req) => buildPdfData(req, id, { internal: false, printedBy: 'test' }))).signatures.find((s) => s.label === 'Approval')!
    expect(box.note).toBe('DITOLAK')
    expect(box.images).toEqual([])
    expect(box.names).not.toContain('(Owner)')
  })
})

describe('2. In-flight requests keep their flow (snapshot taken at submit)', () => {
  it('a request submitted under the PM → Direktur rule is approved by the Direktur even after the rule got the Owner level', async () => {
    await sysCreate('team-assignments', { employee: w.emp.a, project: w.otherProject, roleInProject: 'staff' })
    const rule = await sysCreate('approval-rules', {
      company: drms,
      name: 'AOW rule lama PM→Direktur',
      docType: 'expense_request',
      requestType: 'any',
      minAmount: 0,
      priority: 10,
      project: w.otherProject,
      acknowledge: 'required',
      acknowledgeBy: 'scope_manager',
      acknowledgeRole: null,
      steps: [{ level: 1, approverRole: 'pk-owner' }],
      active: true,
    })
    const before = await submitted(w.users.staffA, draftBody(w, { projectId: w.otherProject }))
    expect(before.body.approvalRule.steps.map((s: { approverRole: string }) => s.approverRole)).toEqual(['pk-owner'])
    const snap = (await sqlAs('app', 'SELECT approval_snapshot FROM expense_requests WHERE id = $1', [before.id])).rows[0].approval_snapshot
    // go-live: the rule gets the Owner level (what the data migration does)
    const p = await getTestPayload()
    await p.update({
      collection: 'approval-rules',
      id: rule,
      data: { steps: [{ level: 1, approverRole: 'pk-owner' }, { level: 2, approverRole: 'pk-principal' }] } as never,
      overrideAccess: true, // SYSTEM-WRITE: fixture (the Admin's change)
      context: { auditReason: 'ADR 0026 uji' },
    })
    expect((await sqlAs('app', 'SELECT approval_snapshot FROM expense_requests WHERE id = $1', [before.id])).rows[0].approval_snapshot).toEqual(snap)
    expect((await api('POST', `${E}/${before.id}/acknowledge`, w.users.otherPm, {}, key())).status).toBe(200)
    const ok = await api('POST', `${E}/${before.id}/approve`, w.users.owner, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved') // the Direktur is still the last level of THIS request
    expect(await inboxItem(principal, before.id)).toBeUndefined()
    // a request submitted after the change gets the Owner level
    const after = await submitted(w.users.staffA, draftBody(w, { projectId: w.otherProject }))
    expect(after.body.approvalRule.steps.map((s: { approverRole: string }) => s.approverRole)).toEqual(['pk-owner', 'pk-principal'])
  })
})

describe('3. LPJ shortfall re-approval uses the same rule and roles (PM → Direktur → Owner)', () => {
  it('Finance asks; the PM, then the Direktur, then the Owner approve — each only at his level', async () => {
    const id = await approvedByOwner()
    const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `AOS-${id}`, proofMediaId: await proof() }, key())
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    const lines = t.body.request.lines.map((l: { id: string }) => l.id) as string[]
    await receipt(id, lines[0]!, 600_000)
    await receipt(id, lines[1]!, 250_000)
    expect((await api('POST', `${E}/${id}/receipts-complete`, w.users.staffA, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material naik harga.' })).status).toBe(200)
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    for (const r of d.receipts.filter((x: { status: string }) => x.status === 'pending')) expect((await api('POST', `${E}/${id}/receipts/${r.id}/verify`, w.users.finance, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})).status).toBe(200)
    const path = `${E}/${id}/lpj/shortfall-approval`
    const req = await api('POST', path, w.users.finance, { note: 'Harga material naik' }, key())
    expect(req.status, JSON.stringify(req.body)).toBe(200)
    expect(req.body.settlement.shortfallApproval).toMatchObject({ status: 'pending_ack' })
    expect((await api('POST', `${path}/acknowledge`, w.users.pm, {}, key())).status).toBe(200)
    expect((await api('POST', `${path}/approve`, principal, {}, key())).status).toBe(403) // Direktur level
    const dir = await api('POST', `${path}/approve`, w.users.owner, {}, key())
    expect(dir.status, JSON.stringify(dir.body)).toBe(200)
    expect(dir.body.settlement.shortfallApproval).toMatchObject({ status: 'pending_approval', level: 2 })
    const inbox = await api('GET', '/api/v1/lpj-shortfall-approvals/inbox', principal)
    expect(inbox.body.items.find((x: { requestId: number }) => x.requestId === id)).toMatchObject({ step: 'approve', stepLabel: 'Persetujuan Owner' })
    const sid = req.body.settlement.id as number
    expect((await sqlAs('app', "SELECT user_id::int AS u FROM notifications WHERE event = 'expense.shortfall_pending_approval' AND doc_id = $1", [String(id)])).rows.map((r) => r.u)).toContain(principal.id)
    expect((await api('POST', `${path}/approve`, w.users.owner2, {}, key())).status).toBe(403) // Owner level
    const ok = await api('POST', `${path}/approve`, principal, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.settlement.shortfallApproval).toMatchObject({ status: 'approved', settleAllowed: true })
    expect((await sqlAs('app', "SELECT count(*)::int AS n FROM approvals WHERE settlement_id = $1 AND doc_type = 'expense_shortfall' AND decision IN ('approved', 'acknowledged')", [sid])).rows[0].n).toBe(3)
  })
})

describe('4. Loans and Addendum RAB stay Direktur-only', () => {
  it('the Owner cannot decide an inter-project loan; the Direktur can', async () => {
    const L = '/api/v1/project-loans'
    const c = await api('POST', L, w.users.pm, { borrowerProjectId: w.project, lenderProjectId: w.otherProject, amount: 1_500_000, reason: 'Termin klien belum cair', dueDate: addDays(today(), 30), submit: true }, key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect((await api('POST', `${L}/${c.body.id}/approve`, principal, {}, key())).status).toBe(403)
    expect((await api('GET', `${L}/inbox`, principal)).body.items?.find((x: { id: number }) => x.id === c.body.id)).toBeUndefined()
    expect((await api('POST', `${L}/${c.body.id}/approve`, w.users.owner, {}, key())).status).toBe(200)
  })
  it('the Owner cannot give the Direktur "Diketahui" of an addendum; the Direktur can', async () => {
    const c = await api('POST', '/api/v1/budget-addenda', w.users.pm, { projectId: w.project, addition: 1_000_000, reason: 'Tambah pekerjaan pagar' })
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect((await api('POST', `/api/v1/budget-addenda/${c.body.id}/submit`, w.users.pm, {})).body.status).toBe('pending_ack')
    expect((await api('POST', `/api/v1/budget-addenda/${c.body.id}/acknowledge`, principal, {})).status).toBe(403)
    expect((await api('POST', `/api/v1/budget-addenda/${c.body.id}/acknowledge`, w.users.owner, {})).status).toBe(200)
  })
})

describe('5. The Owner sees what the Direktur sees, in each PT where he is Owner', () => {
  const pick = (o: Record<string, unknown>) => ({ companies: o.companies, cash: o.cash, budget: o.budget, projects: o.projects, transferQueue: o.transferQueue, count: (o.approvals as { count: number }).count })
  it('DRMS: dashboard (Direktur layout), request list, cash balances are the same as the Direktur\'s', async () => {
    const h = { 'X-Company-Ids': String(drms) }
    const [a, b] = [await api('GET', '/api/v1/dashboard/owner', principal, undefined, h), await api('GET', '/api/v1/dashboard/owner', w.users.owner, undefined, h)]
    expect(a.status, JSON.stringify(a.body).slice(0, 300)).toBe(200)
    expect(pick(a.body)).toEqual(pick(b.body))
    const list = async (u: FlowUser) => ((await api('GET', `${E}?scope=all&limit=100`, u, undefined, h)).body.items as Array<{ id: number }>).map((x) => x.id)
    expect(await list(principal)).toEqual(await list(w.users.owner))
    const cash = async (u: FlowUser) => (await api('GET', '/api/v1/cash-accounts/balances', u, undefined, h)).body
    expect(await cash(principal)).toEqual(await cash(w.users.owner))
    const me = await api('GET', '/api/v1/me', principal)
    expect(me.body.companies.map((c: { id: number; roles: string[] }) => [c.id, c.roles])).toEqual(
      expect.arrayContaining([
        [drms, ['pk-owner', 'pk-principal']],
        [pt2, ['pk-owner', 'pk-principal']],
      ]),
    )
  })
  it('second PT: the same view as that PT\'s Direktur; nothing of a PT where he holds no membership', async () => {
    const h = { 'X-Company-Ids': String(pt2) }
    const [a, b] = [await api('GET', '/api/v1/dashboard/owner', principal, undefined, h), await api('GET', '/api/v1/dashboard/owner', pt2Direktur, undefined, h)]
    expect(a.status, JSON.stringify(a.body).slice(0, 300)).toBe(200)
    expect(pick(a.body)).toEqual(pick(b.body))
    // the PT2 Direktur is not mapped to DRMS: 403 for the header, the Owner of both PTs is
    expect((await api('GET', '/api/v1/dashboard/owner', pt2Direktur, undefined, { 'X-Company-Ids': String(drms) })).status).toBe(403)
  })
})

describe('6. Only a group admin grants or removes the Owner role (owner decision 2026-10-14)', () => {
  it('PT admin: REST, Akses PT matrix and Pengguna onboarding refuse adding / removing Owner (403); a group admin can', async () => {
    const ptAdmin = await makeFlowUser(['pk-admin'], 'aow-pt-admin', null, { signature: false, groupAdmin: false })
    const group = await makeFlowUser(['pk-admin'], 'aow-group-admin', null, { signature: false, groupAdmin: true })
    const target = await makeFlowUser(['pk-staff'], 'aow-owner-target', null, { signature: false })
    const p = await getTestPayload()
    const membership = async () =>
      (await p.find({ collection: 'company-memberships', where: { and: [{ user: { equals: target.id } }, { company: { equals: drms } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ }))
        .docs[0] as unknown as { id: number; roles: string[]; active: boolean }
    const batch = (u: FlowUser, roles: string[]) => api('POST', '/api/v1/company-memberships/batch', u, { reason: 'uji peran Owner', items: [{ user: target.id, company: drms, roles }] }, key())
    const onboard = (u: FlowUser, roles: string[]) => api('PATCH', `/api/v1/user-onboarding/${target.id}`, u, { companies: [{ company: drms, roles }], reason: 'uji peran Owner' })

    // a PT admin cannot GRANT the Owner role — Payload REST / Local API, the matrix, the Pengguna form (update + create)
    const id = (await membership()).id
    await expect(
      p.update({ collection: 'company-memberships', id, data: { roles: ['pk-principal', 'pk-staff'] } as never, user: ptAdmin as never, overrideAccess: false, depth: 0, context: { auditReason: 'uji' } }),
    ).rejects.toMatchObject({ status: 403, message: MSG_OWNER_ROLE_GROUP_ADMIN })
    const b1 = await batch(ptAdmin, ['pk-principal', 'pk-staff'])
    expect(b1.status, JSON.stringify(b1.body)).toBe(403)
    expect(JSON.stringify(b1.body)).toContain(MSG_OWNER_ROLE_GROUP_ADMIN)
    const o1 = await onboard(ptAdmin, ['pk-principal', 'pk-staff'])
    expect(o1.status, JSON.stringify(o1.body)).toBe(403)
    const c1 = await api('POST', '/api/v1/user-onboarding', ptAdmin, { user: { email: `aow-owner-${randomUUID().slice(0, 6)}@example.test`, name: 'Calon Owner' }, companies: [{ company: drms, roles: ['pk-principal'] }] })
    expect(c1.status, JSON.stringify(c1.body)).toBe(403)
    expect((await membership()).roles).toEqual(['pk-staff'])

    // a group admin grants it (matrix)
    const g = await batch(group, ['pk-principal', 'pk-staff'])
    expect(g.status, JSON.stringify(g.body)).toBe(200)
    expect((await membership()).roles).toEqual(['pk-principal', 'pk-staff'])
    // the PT admin may change the OTHER roles while the Owner stays, but cannot REMOVE it (role, empty roles, deactivation)
    const keep = await batch(ptAdmin, ['pk-pm', 'pk-principal', 'pk-staff'])
    expect(keep.status, JSON.stringify(keep.body)).toBe(200)
    expect((await batch(ptAdmin, ['pk-staff'])).status).toBe(403)
    expect((await onboard(ptAdmin, [])).status).toBe(403)
    await expect(p.update({ collection: 'company-memberships', id, data: { active: false } as never, user: ptAdmin as never, overrideAccess: false, depth: 0, context: { auditReason: 'uji' } })).rejects.toMatchObject({ status: 403 })
    expect((await membership()).roles).toEqual(['pk-pm', 'pk-principal', 'pk-staff'])
    // the group admin removes it (Pengguna form)
    const rm = await onboard(group, ['pk-staff'])
    expect(rm.status, JSON.stringify(rm.body)).toBe(200)
    expect((await membership()).roles).toEqual(['pk-staff'])
  })
})

describe('7. One person, one decision: a user who approved as PM project never decides the Direktur level of that request', () => {
  it('PM + Direktur in one account: "Persetujuan PM" given → the Direktur level is refused to him; another Direktur decides', async () => {
    const dual = await makeFlowUser(['pk-pm', 'pk-owner'], 'aow-pm-direktur', null)
    // this file's second PT is active by now → name the world PT explicitly
    const project = await sysCreate('projects', { company: drms, code: `AOW-P3-${Date.now() % 10000}`, name: 'AOW project PM+Direktur', pm: dual.id, budget: 20_000_000, status: 'berjalan' })
    await sysCreate('team-assignments', { employee: w.emp.a, project, roleInProject: 'staff' })
    await sysCreate('approval-rules', {
      company: drms,
      name: 'AOW rule PM+Direktur',
      docType: 'expense_request',
      requestType: 'any',
      minAmount: 0,
      priority: 10,
      project,
      acknowledge: 'required',
      acknowledgeBy: 'scope_manager',
      acknowledgeRole: null,
      steps: [
        { level: 1, approverRole: 'pk-owner' },
        { level: 2, approverRole: 'pk-principal' },
      ],
      active: true,
    })
    const { id } = await submitted(w.users.staffA, draftBody(w, { projectId: project }))
    expect((await api('POST', `${E}/${id}/acknowledge`, dual, {}, key())).status).toBe(200)
    expect((await api('POST', `${E}/${id}/approve`, dual, {}, key())).status).toBe(403)
    expect(await inboxItem(dual, id)).toBeUndefined()
    expect((await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())).status).toBe(200)
  })
})

/** Runs migration functions like `payload migrate` does (one OWNER connection) inside a transaction that is ROLLED BACK. */
async function inRolledBackTx(fn: (db: { execute: (q: unknown) => Promise<{ rows: Array<Record<string, unknown>> }> }) => Promise<void>): Promise<void> {
  const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
  await c.connect()
  const dialect = new PgDialect()
  const db = {
    execute: async (q: unknown) => {
      const x = dialect.sqlToQuery(q as never)
      return c.query(x.sql, x.params)
    },
  }
  try {
    await c.query('BEGIN')
    await fn(db)
  } finally {
    await c.query('ROLLBACK').catch(() => undefined)
    await c.end()
  }
}

describe('migration 20261013_630200_d1310_owner_role_data', () => {
  it('pre-ADR-0026 DRMS → Owner level after the Direktur / before Finance, "Pengajuan Owner" created; idempotent; snapshots untouched; down reverts', async () => {
    await inRolledBackTx(async (db) => {
      const q = async (s: string) => (await db.execute(sql.raw(s))).rows
      const snapshots = async () => (await q('SELECT md5(coalesce(string_agg(approval_snapshot::text, \',\' ORDER BY id), \'\')) AS h FROM expense_requests'))[0]!.h
      const before = await snapshots()
      // DRMS as of 2026-10-12: no Owner level (rules with more levels; "Pengajuan Direktur" back to the ADR 0024 zero-step
      // shape), no active Owner zero-step rule (deactivated: earlier files may reference it from requests)
      await q(`DELETE FROM approval_rules_steps s USING approval_rules r WHERE s._parent_id = r.id AND r.company_id = ${drms} AND s.approver_role::text = 'pk-principal'
                 AND (r.name = 'Pengajuan Direktur' OR (SELECT count(*) FROM approval_rules_steps x WHERE x._parent_id = r.id) > 1)`)
      await q(`UPDATE approval_rules r SET active = false WHERE r.company_id = ${drms} AND NOT EXISTS (SELECT 1 FROM approval_rules_steps s WHERE s._parent_id = r.id) AND pk_rule_requester_only(r.id, 'pk-principal')`)
      const stepsOf = async (name: string) =>
        (await q(`SELECT s.level::int AS level, s.approver_role::text AS role FROM approval_rules_steps s JOIN approval_rules r ON r.id = s._parent_id WHERE r.company_id = ${drms} AND r.name = '${name}' ORDER BY s.level`)).map((x) => [x.level, x.role])
      const ownerRules = async () =>
        q(`SELECT r.id, r.priority::int AS priority, r.acknowledge::text AS ack, (SELECT array_agg(value::text) FROM approval_rules_requester_roles x WHERE x.parent_id = r.id) AS roles,
                  (SELECT count(*)::int FROM approval_rules_steps s WHERE s._parent_id = r.id) AS steps FROM approval_rules r WHERE r.company_id = ${drms} AND r.name = '${OWNER_RULE}' AND r.active`)
      expect(await stepsOf('Pengajuan Direktur')).toEqual([])

      await dataUp({ db } as never)
      expect(await stepsOf('Default — PM project lalu Direktur (semua nominal)')).toEqual([
        [1, 'pk-owner'],
        [2, 'pk-principal'],
      ])
      expect(await stepsOf('Pengajuan Direktur')).toEqual([[1, 'pk-principal']])
      // ADR 0013 shape ("Diketahui" Direktur → Finance level): the Owner goes BEFORE Finance (Direktur → Owner → Finance)
      expect(await stepsOf(ADR0013_FALLBACK_RULE)).toEqual([
        [1, 'pk-principal'],
        [2, 'pk-finance'],
      ])
      expect(await stepsOf('Contoh — di atas Rp 10 juta: PM project lalu Direktur (Q-31, nonaktif)')).toEqual([[1, 'pk-owner']]) // inactive: the Admin decides
      expect(await stepsOf(RULE)).toEqual([
        [1, 'pk-owner'],
        [2, 'pk-principal'],
      ]) // this file's rule: its Owner level is back (once, after the Direktur)
      expect(await ownerRules()).toEqual([expect.objectContaining({ priority: 5, ack: 'none', roles: ['pk-principal'], steps: 0 })])
      const rid = (await ownerRules())[0]!.id
      expect(await q(`SELECT action::text AS a, source::text AS s FROM audit_logs WHERE doc_type = 'approval_rule' AND doc_id = '${rid}'`)).toEqual([{ a: 'create', s: 'system' }])
      await q('SET CONSTRAINTS ALL IMMEDIATE') // the ADR 0026 zero-step guard accepts every rule now
      await q('SET CONSTRAINTS ALL DEFERRED')

      await dataUp({ db } as never) // idempotent
      expect((await ownerRules()).length).toBe(1)
      expect(await stepsOf('Default — PM project lalu Direktur (semua nominal)')).toHaveLength(2)
      expect(await stepsOf('Pengajuan Direktur')).toHaveLength(1)
      expect(await snapshots()).toBe(before) // requests already submitted keep their snapshot

      await dataDown({ db } as never)
      expect(await stepsOf('Default — PM project lalu Direktur (semua nominal)')).toEqual([[1, 'pk-owner']])
      expect(await stepsOf('Pengajuan Direktur')).toEqual([[1, 'pk-principal']]) // never left without a level
      expect(await stepsOf(ADR0013_FALLBACK_RULE)).toEqual([[1, 'pk-finance']]) // renumbered back
      expect(await ownerRules()).toEqual([])
    })
  })
})
