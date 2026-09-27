import { randomUUID } from 'node:crypto'

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { accessToken, auditRows, getTestPayload, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser } from './helpers'
import { api, makeWorld, type FlowUser, type World } from './flow-world'

/**
 * E5 Addendum RAB (plan fase1-golive §E5, T12, US-18/US-30, ADR 0013 engine with docType
 * budget_addendum): PM of the team submits → Direktur "Setujui" → Finance approves → projects.budget
 * += addition in ONE transaction with audit; negative authz (PM outside the team 403, PM/Staff/Admin
 * decisions 403 + access_denied), reason rules, transaction atomicity, DB guards, APK path.
 * Fictional data only.
 */
let w: World

const budgetOf = async (id: number) => Number((await sqlAs('app', 'SELECT budget FROM projects WHERE id = $1', [id])).rows[0].budget)
const create = (u: FlowUser, body: Record<string, unknown>) => api('POST', '/api/v1/budget-addenda', u, body)
const act = (u: FlowUser, id: number, action: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) => api('POST', `/api/v1/budget-addenda/${id}/${action}`, u, body, headers)
const deniedCount = async (userId: number) =>
  (await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE doc_type = 'budget_addendum' AND action = 'access_denied' AND user_id = $1", [String(userId)])).rows[0].n as number

beforeAll(async () => {
  await installLocalJwks()
  w = await makeWorld('add')
})

beforeEach(() => resetRateLimits())

describe('create + submit (US-18)', () => {
  let draft: number

  it('nominal and reason are required; only the PM of the team may create (others 403 + access_denied)', async () => {
    expect((await create(w.users.pm, { projectId: w.project, addition: 0, reason: 'Tambah pekerjaan' })).status).toBe(400)
    expect((await create(w.users.pm, { projectId: w.project, addition: 5_000_000 })).status).toBe(400)
    expect((await create(w.users.pm, { projectId: w.project, addition: 5_000_000, reason: 'x' })).status).toBe(400)
    expect((await create(w.users.pm, { projectId: w.project, addition: 1.5, reason: 'Tambah pekerjaan' })).status).toBe(400)
    const before = await deniedCount(w.users.otherPm.id)
    const outside = await create(w.users.otherPm, { projectId: w.project, addition: 5_000_000, reason: 'Tambah pekerjaan' })
    expect(outside.status).toBe(403)
    expect(outside.body.code).toBe('FORBIDDEN')
    expect(await deniedCount(w.users.otherPm.id)).toBe(before + 1)
    for (const u of [w.users.staffA, w.users.finance, w.users.owner, w.users.admin]) {
      expect((await create(u, { projectId: w.project, addition: 5_000_000, reason: 'Tambah pekerjaan' })).status, u.email).toBe(403)
    }
    const ok = await create(w.users.pm, { projectId: w.project, addition: 5_000_000, reason: 'Tambah pekerjaan pagar keliling' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    expect(ok.body).toMatchObject({ status: 'draft', docNo: null, addition: 5_000_000, allowedActions: expect.arrayContaining(['edit', 'submit', 'cancel']) })
    draft = ok.body.id
    // the collection itself is closed for HTTP writes
    expect((await api('POST', '/api/budget-addenda', w.users.pm, { project: w.project, addition: 1, reason: 'abc', createdBy: w.users.pm.id })).status).toBe(403)
    expect((await api('PATCH', `/api/budget-addenda/${draft}`, w.users.owner, { status: 'approved' })).status).toBe(403)
  })

  it('draft edit, submit → Menunggu Direktur with ADD/YYMM/####, snapshot of the budget_addendum rule, Direktur notified', async () => {
    const e = await api('PATCH', `/api/v1/budget-addenda/${draft}`, w.users.pm, { addition: 7_500_000 })
    expect(e.status).toBe(200)
    expect(e.body.addition).toBe(7_500_000)
    expect((await api('PATCH', `/api/v1/budget-addenda/${draft}`, w.users.otherPm, { addition: 1 })).status).toBe(404)
    const s = await act(w.users.pm, draft, 'submit')
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body.status).toBe('pending_ack')
    expect(s.body.docNo).toMatch(/^ADD\/\d{4}\/\d{4}$/)
    expect(s.body.approvalRule).toMatchObject({ acknowledgeRole: 'pk-owner', levels: 1 })
    expect(s.body.budgetAtSubmit).toBe(100_000_000)
    const n = await sqlAs('app', "SELECT user_id FROM notifications WHERE doc_type = 'budget_addendum' AND doc_id = $1 AND event = 'addendum.pending_ack'", [String(draft)])
    const to = n.rows.map((r) => Number(r.user_id))
    expect(to).toEqual(expect.arrayContaining([w.users.owner.id, w.users.owner2.id]))
    expect(to).not.toContain(w.users.pm.id)
    // content frozen after submit (service 409, DB 42501)
    expect((await api('PATCH', `/api/v1/budget-addenda/${draft}`, w.users.pm, { addition: 1 })).status).toBe(409)
    expect((await sqlError('app', `UPDATE budget_addenda SET addition = 1 WHERE id = ${draft}`))?.code).toBe('42501')
  })

  it('negative authz on decisions: PM/Staff/Admin 403 + access_denied; Finance cannot skip the Direktur step; creator never decides', async () => {
    const pmBefore = await deniedCount(w.users.pm.id)
    const pm = await act(w.users.pm, draft, 'acknowledge')
    expect(pm.status).toBe(403)
    expect(await deniedCount(w.users.pm.id)).toBeGreaterThan(pmBefore)
    for (const u of [w.users.staffA, w.users.admin]) expect((await act(u, draft, 'acknowledge')).status, u.email).toBe(404) // cannot even read it
    expect((await act(w.users.finance, draft, 'acknowledge')).status).toBe(403)
    expect((await act(w.users.finance, draft, 'approve')).status).toBe(409) // not at the Finance step yet
    expect((await act(w.users.owner, draft, 'reject', {})).status).toBe(400) // reason required (G7)
  })

  it('Direktur "Setujui" → Menunggu Finance; Finance approves → RAB = old + addition in ONE transaction, audited before → after', async () => {
    const inboxOwner = await api('GET', '/api/v1/budget-addenda/inbox', w.users.owner)
    expect(inboxOwner.status).toBe(200)
    expect(inboxOwner.body.items.find((i: { id: number }) => i.id === draft)).toMatchObject({ step: 'acknowledge', budget: { current: 100_000_000, afterAddition: 107_500_000 } })
    expect((await api('GET', '/api/v1/budget-addenda/inbox', w.users.pm)).body.items).toEqual([])
    const a = await act(w.users.owner, draft, 'acknowledge')
    expect(a.status, JSON.stringify(a.body)).toBe(200)
    expect(a.body.status).toBe('pending_approval')
    expect((await act(w.users.owner, draft, 'approve')).status).toBe(403) // not Finance
    expect((await act(w.users.owner2, draft, 'approve')).status).toBe(403)
    const inboxFin = await api('GET', '/api/v1/budget-addenda/inbox', w.users.finance)
    expect(inboxFin.body.items.find((i: { id: number }) => i.id === draft)?.step).toBe('approve')

    const key = randomUUID()
    const f = await act(w.users.finance, draft, 'approve', {}, { 'Idempotency-Key': key })
    expect(f.status, JSON.stringify(f.body)).toBe(200)
    expect(f.body).toMatchObject({ status: 'approved', oldBudget: 100_000_000, newBudget: 107_500_000 })
    expect(f.body.decisions.map((d: { position: string; decision: string }) => `${d.position}:${d.decision}`)).toEqual(['diketahui:acknowledged', 'approval:approved'])
    expect(await budgetOf(w.project)).toBe(107_500_000)
    // replay of the same click: stored response, no second increase
    const replay = await act(w.users.finance, draft, 'approve', {}, { 'Idempotency-Key': key })
    expect(replay.status).toBe(200)
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true')
    expect(await budgetOf(w.project)).toBe(107_500_000)
    expect((await act(w.users.finance2, draft, 'approve')).status).toBe(409)

    const projAudit = (await auditRows('project', w.project)).filter((r) => r.field === 'budget')
    expect(projAudit.at(-1)).toMatchObject({ action: 'update', old_value: { v: 100_000_000 }, new_value: { v: 107_500_000 } })
    expect(projAudit.at(-1)!.reason).toMatch(/Addendum RAB ADD\/\d{4}\/\d{4} disetujui/)
    const addAudit = await auditRows('budget_addendum', draft)
    const approveRow = addAudit.find((r) => r.action === 'approve')!
    const statusRow = addAudit.filter((r) => r.action === 'status_change').at(-1)!
    expect(statusRow.new_value).toEqual({ v: 'approved' })
    expect(new Set([approveRow.tx_id, statusRow.tx_id, projAudit.at(-1)!.tx_id]).size).toBe(1)
    expect(addAudit.map((r) => r.action)).toEqual(expect.arrayContaining(['create', 'number_issued', 'acknowledge', 'approve', 'status_change']))
    // approved row is final (DB)
    expect((await sqlError('app', `UPDATE budget_addenda SET reject_reason = 'x' WHERE id = ${draft}`))?.code).toBe('42501')
    expect((await sqlError('app', `DELETE FROM budget_addenda WHERE id = ${draft}`))?.code).toMatch(/42501/)
    // creator notified
    const n = await sqlAs('app', "SELECT count(*)::int AS n FROM notifications WHERE doc_id = $1 AND doc_type = 'budget_addendum' AND event = 'addendum.approved' AND user_id = $2", [String(draft), String(w.users.pm.id)])
    expect(n.rows[0].n).toBe(1)
  })

  it('K-08/K-09 reconcile with the new RAB (dashboard data = projects.budget)', async () => {
    const r = await api('GET', `/api/v1/projects/progress?project=${w.project}`, w.users.owner)
    expect(r.status).toBe(200)
    const p = r.body.projects[0]
    expect(p.budget).toBe(107_500_000)
    const committed = Number((await sqlAs('app', "SELECT coalesce(sum(grand_total),0)::text AS s FROM expense_requests WHERE project_id = $1 AND status::text IN ('approved','receipt_revision','receipts_verified','transferred','receipts_complete','lpj_submitted','lpj_revision','lpj_verified','completed')", [w.project])).rows[0].s)
    expect(p.committed).toBe(committed)
  })
})

describe('reject, cancel, concurrency, atomicity, DB guards', () => {
  it('reject with reason at the Finance step → Ditolak, RAB unchanged, creator notified', async () => {
    const before = await budgetOf(w.project)
    const c = await create(w.users.pm, { projectId: w.project, addition: 2_000_000, reason: 'Tambahan drainase', submit: true })
    expect(c.status).toBe(201)
    expect(c.body.status).toBe('pending_ack')
    expect((await act(w.users.owner, c.body.id, 'acknowledge')).status).toBe(200)
    const r = await act(w.users.finance, c.body.id, 'reject', { reason: 'Anggaran belum tersedia' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'rejected', rejectReason: 'Anggaran belum tersedia', oldBudget: null, newBudget: null })
    expect(await budgetOf(w.project)).toBe(before)
  })

  it('cancel: creator before any decision (reason required); not after a decision', async () => {
    const c = await create(w.users.pm, { projectId: w.project, addition: 1_000_000, reason: 'Salah input', submit: true })
    expect((await act(w.users.pm, c.body.id, 'cancel', {})).status).toBe(400)
    expect((await act(w.users.owner, c.body.id, 'cancel', { reason: 'bukan pengaju' })).status).toBe(403)
    const x = await act(w.users.pm, c.body.id, 'cancel', { reason: 'Salah input nominal' })
    expect(x.status).toBe(200)
    expect(x.body.status).toBe('cancelled')
    const d = await create(w.users.pm, { projectId: w.project, addition: 1_000_000, reason: 'Pekerjaan tambah', submit: true })
    expect((await act(w.users.owner, d.body.id, 'acknowledge')).status).toBe(200)
    expect((await act(w.users.pm, d.body.id, 'cancel', { reason: 'batal' })).status).toBe(409)
    expect((await act(w.users.finance, d.body.id, 'reject', { reason: 'Tutup uji' })).status).toBe(200)
  })

  it('concurrent addenda: the second approval adds to the CURRENT RAB (not the value at submit)', async () => {
    const a = await create(w.users.pm, { projectId: w.project, addition: 1_000_000, reason: 'Addendum A', submit: true })
    const b = await create(w.users.pm, { projectId: w.project, addition: 3_000_000, reason: 'Addendum B', submit: true })
    const start = await budgetOf(w.project)
    for (const id of [a.body.id, b.body.id]) expect((await act(w.users.owner, id, 'acknowledge')).status).toBe(200)
    expect((await act(w.users.finance, b.body.id, 'approve')).status).toBe(200)
    const ra = await act(w.users.finance, a.body.id, 'approve')
    expect(ra.body).toMatchObject({ oldBudget: start + 3_000_000, newBudget: start + 4_000_000, budgetAtSubmit: start })
    expect(await budgetOf(w.project)).toBe(start + 4_000_000)
  })

  it('atomicity: a failing RAB update rolls back the decision row, the status change and every audit row', async () => {
    const c = await create(w.users.pm, { projectId: w.project, addition: 9_000_000, reason: 'Uji atomik', submit: true })
    expect((await act(w.users.owner, c.body.id, 'acknowledge')).status).toBe(200)
    const before = await budgetOf(w.project)
    const auditBefore = (await auditRows('budget_addendum', c.body.id)).length
    // test-only trigger (owner role): the RAB update of this project fails
    await sqlAs('owner', `CREATE OR REPLACE FUNCTION pk_test_fail_budget() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = ${w.project} AND NEW.budget IS DISTINCT FROM OLD.budget THEN RAISE EXCEPTION 'uji gagal' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END $$`)
    await sqlAs('owner', 'CREATE TRIGGER pk_test_fail_budget BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION pk_test_fail_budget()')
    try {
      const r = await act(w.users.finance, c.body.id, 'approve')
      expect(r.status).toBeGreaterThanOrEqual(409) // DB error → problem response, nothing committed
    } finally {
      await sqlAs('owner', 'DROP TRIGGER pk_test_fail_budget ON projects')
      await sqlAs('owner', 'DROP FUNCTION pk_test_fail_budget()')
    }
    const row = (await sqlAs('app', 'SELECT status, old_budget, new_budget FROM budget_addenda WHERE id = $1', [c.body.id])).rows[0]
    expect(row).toMatchObject({ status: 'pending_approval', old_budget: null, new_budget: null })
    expect((await sqlAs('app', "SELECT count(*)::int AS n FROM approvals WHERE addendum_id = $1 AND position = 'approval'", [c.body.id])).rows[0].n).toBe(0)
    expect((await auditRows('budget_addendum', c.body.id)).length).toBe(auditBefore)
    expect(await budgetOf(w.project)).toBe(before)
    // and it still completes normally afterwards
    expect((await act(w.users.finance, c.body.id, 'approve')).status).toBe(200)
    expect(await budgetOf(w.project)).toBe(before + 9_000_000)
  })

  it('DB guards: creator can never hold a decision row; owner per docType; drafts only on insert', async () => {
    const c = await create(w.users.pm, { projectId: w.project, addition: 1_000_000, reason: 'Uji DB', submit: true })
    const g1 = await sqlError('app', `INSERT INTO approvals (doc_type, addendum_id, cycle, position, level, actor_id, decision) VALUES ('budget_addendum', ${c.body.id}, 1, 'diketahui', 0, ${w.users.pm.id}, 'acknowledged')`)
    expect(g1?.code).toBe('42501')
    const owner = await sqlError('app', `INSERT INTO approvals (doc_type, addendum_id, cycle, position, level, actor_id, decision) VALUES ('expense_request', ${c.body.id}, 1, 'diketahui', 0, ${w.users.owner.id}, 'acknowledged')`)
    expect(owner?.code).toBe('23514')
    const ins = await sqlError('app', `INSERT INTO budget_addenda (project_id, status, addition, reason, created_by_id, doc_no) VALUES (${w.project}, 'approved', 1, 'abc', ${w.users.pm.id}, 'ADD/X/1')`)
    expect(ins?.code).toBe('42501')
    const skip = await sqlError('app', `UPDATE budget_addenda SET status = 'approved' WHERE id = ${c.body.id}`)
    expect(skip).not.toBeNull()
    await act(w.users.pm, c.body.id, 'cancel', { reason: 'Tutup uji DB' })
  })
})

describe('read scope + APK', () => {
  it('list/detail: PM team + own, Direktur/Finance all, other PM/Staff/Admin nothing (404 on detail)', async () => {
    const mine = await api('GET', `/api/v1/budget-addenda?project=${w.project}`, w.users.pm)
    expect(mine.status).toBe(200)
    expect(mine.body.items.length).toBeGreaterThan(3)
    const id = mine.body.items[0].id
    for (const u of [w.users.otherPm, w.users.staffA, w.users.admin]) {
      expect((await api('GET', `/api/v1/budget-addenda?project=${w.project}`, u)).body.items, u.email).toEqual([])
      expect((await api('GET', `/api/v1/budget-addenda/${id}`, u)).status, u.email).toBe(404)
    }
    expect((await api('GET', `/api/v1/budget-addenda?project=${w.project}`, w.users.finance)).body.items.length).toBe(mine.body.items.length)
    const page = await api('GET', `/api/v1/budget-addenda?project=${w.project}&limit=2`, w.users.owner)
    expect(page.body.items).toHaveLength(2)
    const next = await api('GET', `/api/v1/budget-addenda?project=${w.project}&limit=2&cursor=${page.body.nextCursor}`, w.users.owner)
    expect(next.body.items[0].id).toBeLessThan(page.body.items[1].id)
    // decision rows are readable by the PM of the team (Riwayat), not by another PM
    const approvalsPm = await api('GET', `/api/approvals?where[addendum][exists]=true&limit=100`, w.users.pm)
    expect(approvalsPm.status).toBe(200)
    expect(approvalsPm.body.docs.length).toBeGreaterThan(0)
    const approvalsOther = await api('GET', `/api/approvals?where[addendum][exists]=true&limit=100`, w.users.otherPm)
    expect(approvalsOther.body.docs ?? []).toEqual([])
  })

  it('APK: Direktur approves from the phone (bearer + device, Idempotency-Key mandatory)', async () => {
    const c = await create(w.users.pm, { projectId: w.project, addition: 4_000_000, reason: 'Addendum dari lapangan', submit: true })
    const p = await getTestPayload()
    const doc = await p.findByID({ collection: 'users', id: w.users.owner.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
    const t: TestUser = { ...w.users.owner, keycloakSub: doc.keycloakSub as string }
    const token = await accessToken(t, ['pk-owner'])
    const device = await registerDevice(t, token)
    const h = { Authorization: `Bearer ${token}`, 'X-Device-Id': device, 'X-App-Version': '1.0.0' }
    const noKey = await api('POST', `/api/v1/budget-addenda/${c.body.id}/acknowledge`, null, {}, h)
    expect(noKey.status).toBe(400)
    const ok = await api('POST', `/api/v1/budget-addenda/${c.body.id}/acknowledge`, null, {}, { ...h, 'Idempotency-Key': randomUUID() })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('pending_approval')
    const row = (await sqlAs('app', "SELECT source, device_id FROM approvals WHERE addendum_id = $1 AND position = 'diketahui'", [c.body.id])).rows[0]
    expect(row).toMatchObject({ source: 'apk', device_id: device })
    await act(w.users.finance, c.body.id, 'reject', { reason: 'Tutup uji APK' })
  })
})
