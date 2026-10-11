import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { addDays } from '@/domain/expense/types'
import { down as migrationDown, up as migrationUp } from '@/migrations/20261010_130000_approval_pm_direktur'
import { resetRateLimits } from '@/lib/rate-limit'
import { buildPdfData } from '@/pdf/data'

import { auditRows, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, asUser, draftBody, legacyCostCenter, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * ADR 0021 (owner decision 2026-10-10) through the real API: Staff → PM project ("Diketahui" =
 * Persetujuan PM, `acknowledgeBy: scope_manager` = projects.pm / cost-center manager) → Direktur
 * (level 1) → Finance transfer (no Finance approval); Tolak at each step; only the request's PM;
 * PM requester skips the PM step; project without PM → 409; the narrow G1 exception `direktur_via_pm`
 * (PM files for the Direktur) incl. the DB trigger; LPJ shortfall PM → Direktur; Addendum RAB stays
 * Direktur → Finance; an old (Direktur → Finance) snapshot still finishes.
 */
let w: World
let old: World
let dirEmp: number
let dirReq: FlowUser
let accDir: number
let teamPm: FlowUser
let accPm: number
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) // Asia/Makassar

beforeAll(async () => {
  w = await makeWorld('APM', { rule: 'pm_direktur' })
  old = await makeWorld('APO') // ADR 0013 world rules (Direktur → Finance)
  // A Direktur who is also an employee (can be "Diajukan Oleh") — for the G1 exception.
  dirEmp = await sysCreate('employees', { code: 'APM-DIR', name: 'APM Direktur Pemohon' })
  dirReq = await makeFlowUser(['pk-owner'], 'apm-dir-req', dirEmp)
  const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id as number
  accPm = await sysCreate('employee-bank-accounts', { employee: w.emp.pm, bank, accountNo: `6${Date.now() % 1e9}7`, accountHolder: 'APM PM', isDefault: true, verificationStatus: 'verified' })
  accDir = await sysCreate('employee-bank-accounts', { employee: dirEmp, bank, accountNo: `6${Date.now() % 1e9}4`, accountHolder: 'APM Direktur', isDefault: true, verificationStatus: 'verified' })
  // A second PM of the same project (team assignment), NOT projects.pm
  const teamEmp = await sysCreate('employees', { code: 'APM-PM2', name: 'APM PM tim' })
  teamPm = await makeFlowUser(['pk-pm'], 'apm-team-pm', teamEmp)
  await sysCreate('team-assignments', { employee: teamEmp, project: w.project, roleInProject: 'pm' })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function submitted(creator: FlowUser = w.users.staffA, over: Record<string, unknown> = {}, expectStatus = 200, world: World = w) {
  const c = await api('POST', E, creator, draftBody(world, over), key())
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const s = await api('POST', `${E}/${c.body.id}/submit`, creator, {}, key())
  expect(s.status, JSON.stringify(s.body)).toBe(expectStatus)
  return { id: c.body.id as number, body: s.body }
}

/** Temporarily deactivates every active holder of `role` except `keep` (restored afterwards). */
async function onlyActive<T>(role: string, keep: number[], fn: () => Promise<T>): Promise<T> {
  const r = await sqlAs('app', `SELECT DISTINCT u.id FROM users u JOIN company_memberships m ON m.user_id = u.id AND coalesce(m.active, true) JOIN company_memberships_roles r ON r.parent_id = m.id WHERE r.value::text = $1 AND u.active AND NOT (u.id = ANY($2::int[]))`, [role, keep])
  const ids = r.rows.map((x) => x.id as number)
  if (ids.length) await sqlAs('app', 'UPDATE users SET active = false WHERE id = ANY($1::int[])', [ids])
  try {
    return await fn()
  } finally {
    if (ids.length) await sqlAs('app', 'UPDATE users SET active = true WHERE id = ANY($1::int[])', [ids])
  }
}

const notified = async (id: number, event: string) => (await sqlAs('app', 'SELECT user_id::int AS u FROM notifications WHERE event = $1 AND doc_id = $2', [event, String(id)])).rows.map((r) => r.u as number)
const audit = async (id: number, action: string) =>
  (await sqlAs('app', 'SELECT user_id::int AS user_id, field, reason, new_value FROM audit_logs WHERE doc_type = $1 AND doc_id = $2 AND action = $3 ORDER BY id', ['expense_request', String(id), action])).rows
const inboxItem = async (u: FlowUser, id: number) => (await api('GET', '/api/v1/approvals/inbox', u)).body.items.find((i: { id: number }) => i.id === id)

async function proof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

async function receipt(id: number, lineId: string, amount: number, user: FlowUser = w.users.staffA) {
  const img = await upload('/api/v1/media/receipts', user, await png())
  expect(img.status).toBe(201)
  const r = await api('POST', `${E}/${id}/receipts`, user, { lineId, receiptNo: `APM-${id}-${amount}-${randomUUID().slice(0, 5)}`, vendorName: 'Toko Maju', receiptDate: addDays(today(), -1), amount, imageId: img.body.id })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
}

describe('1. Staff → PM → Direktur → Finance transfer', () => {
  it('Pengajuan Baru: PM notified and approves, then the Direktur; Finance only transfers', async () => {
    const { id, body } = await submitted()
    expect(body).toMatchObject({
      status: 'pending_ack',
      statusLabel: 'Menunggu persetujuan PM',
      approvalRule: { acknowledgeBy: 'scope_manager', acknowledgerUserId: w.users.pm.id, steps: [{ level: 1, approverRole: 'pk-owner' }], decisionRoles: ['pk-owner', 'pk-finance'], selfApproval: null },
    })
    // only the PM is asked; Direktur / Finance not yet; no duplicate team_submitted for the acknowledger PM
    expect(await notified(id, 'expense.pending_ack')).toEqual([w.users.pm.id])
    expect(await notified(id, 'expense.team_submitted')).not.toContain(w.users.pm.id)
    const n = await sqlAs('app', "SELECT title, body FROM notifications WHERE event = 'expense.pending_ack' AND doc_id = $1", [String(id)])
    expect(n.rows[0]).toMatchObject({ title: expect.stringMatching(/^Persetujuan PM: /), body: expect.stringContaining('sebagai PM project') })
    expect(await inboxItem(w.users.pm, id)).toMatchObject({ step: 'acknowledge', stepLabel: 'Persetujuan PM', decisionFlow: true, decisionBy: 'pm', finalStep: false })
    expect(await inboxItem(w.users.owner, id)).toBeUndefined()
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key())).status).toBe(403) // not the Direktur's turn
    const d = (await api('GET', `${E}/${id}`, w.users.staffA)).body
    expect(d.nextActor).toMatchObject({ what: 'setujui sebagai PM project atau tolak' })

    const ack = await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect(ack.body).toMatchObject({ status: 'pending_approval', currentLevel: 1, statusLabel: 'Menunggu persetujuan Direktur' })
    const appr = await notified(id, 'expense.pending_approval')
    expect(appr).toEqual(expect.arrayContaining([w.users.owner.id, w.users.owner2.id]))
    expect(appr).not.toContain(w.users.finance.id)
    expect(await inboxItem(w.users.owner, id)).toMatchObject({ step: 'approve', stepLabel: 'Persetujuan Direktur', decisionBy: 'direktur', finalStep: true })
    expect(await inboxItem(w.users.finance, id)).toBeUndefined()
    expect((await api('POST', `${E}/${id}/approve`, w.users.finance, {}, key())).status).toBe(403)
    expect((await api('POST', `${E}/${id}/approve`, w.users.pm, {}, key())).status).toBe(403) // PM decided already; not a Direktur

    const ok = await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body).toMatchObject({ status: 'approved', approvedAmount: ok.body.grandTotal })
    expect(await notified(id, 'expense.transfer_queue')).toEqual(expect.arrayContaining([w.users.finance.id, w.users.finance2.id]))
    const pos = ok.body.approvals.filter((a: { position: string }) => a.position === 'diketahui' || a.position === 'approval')
    expect(pos.map((a: { position: string; actorId: number }) => [a.position, a.actorId])).toEqual([
      ['diketahui', w.users.pm.id],
      ['approval', w.users.owner.id],
    ])
    const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `APM-${id}`, proofMediaId: await proof() })
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    expect(t.body.request.status).toBe('transferred')
    const pdf = await asUser(w.users.finance, (req) => buildPdfData(req, id, { internal: false, printedBy: 'test' }))
    expect(pdf.signatures.find((s) => s.label === 'Diketahui Oleh')?.names).toMatch(/APM[ -]PM/i)
    expect(pdf.signatures.find((s) => s.label === 'Approval')?.names).toContain('APM-owner')
    expect(pdf.policyNote).toBeUndefined()
  })

  it('LEGACY Reimburse (cost center → its manager): PM → Direktur → Finance verifies receipts (not an approval) → transfer', async () => {
    // DRMS 10/10 D2: cost-center requests exist only from before D2 (legacy row, sent again after a withdraw)
    const c = await api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }), key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const id = c.body.id as number
    await legacyCostCenter(id, w.costCenter)
    await receipt(id, c.body.lines[0].id, 600_000)
    await receipt(id, c.body.lines[1].id, 150_000)
    const s = await api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key())
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body).toMatchObject({ status: 'pending_ack', approvalRule: { acknowledgerUserId: w.users.pm.id } })
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())).status).toBe(200)
    const ok = await api('POST', `${E}/${id}/approve`, w.users.owner2, {}, key())
    expect(ok.body.status).toBe('approved')
    expect(await notified(id, 'expense.receipts_to_verify')).toEqual(expect.arrayContaining([w.users.finance.id]))
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    expect(d.allowedActions).not.toContain('approve')
    for (const r of d.receipts.filter((x: { status: string }) => x.status === 'pending')) expect((await api('POST', `${E}/${id}/receipts/${r.id}/verify`, w.users.finance, {})).status).toBe(200)
    for (const f of d.flags.filter((x: { status: string; level: string }) => x.status === 'open' && x.level === 'warning')) expect((await api('POST', `${E}/${id}/flags/${f.id}/review`, w.users.finance, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/verify-receipts`, w.users.finance, {})).status).toBe(200)
    const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `APR-${id}`, proofMediaId: await proof() })
    expect(t.status, JSON.stringify(t.body)).toBe(201)
  })
})

describe('2. Tolak at the PM step and at the Direktur step', () => {
  it('PM rejects (reason required) → rejected; requester + creator notified, reason shown', async () => {
    const { id } = await submitted()
    expect((await api('POST', `${E}/${id}/reject`, w.users.pm, {}, key())).status).toBe(400)
    const rj = await api('POST', `${E}/${id}/reject`, w.users.pm, { reason: 'bukan kebutuhan project' }, key())
    expect(rj.status, JSON.stringify(rj.body)).toBe(200)
    expect(rj.body).toMatchObject({ status: 'rejected', rejectReason: 'bukan kebutuhan project' })
    expect(rj.body.approvals.find((a: { decision: string }) => a.decision === 'rejected')).toMatchObject({ position: 'diketahui', actorId: w.users.pm.id })
    expect(await notified(id, 'expense.rejected')).toContain(w.users.staffA.id)
    const n = await sqlAs('app', "SELECT title FROM notifications WHERE event = 'expense.rejected' AND doc_id = $1 AND user_id = $2", [String(id), w.users.staffA.id])
    expect(n.rows[0].title).toMatch(/^Ditolak: /)
  })

  it('Direktur rejects after the PM → rejected; requester and the team PM notified', async () => {
    const { id } = await submitted()
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())).status).toBe(200)
    const rj = await api('POST', `${E}/${id}/reject`, w.users.owner, { reason: 'tunda bulan depan' }, key())
    expect(rj.status, JSON.stringify(rj.body)).toBe(200)
    expect(rj.body).toMatchObject({ status: 'rejected', rejectReason: 'tunda bulan depan' })
    const to = await notified(id, 'expense.rejected')
    expect(to).toEqual(expect.arrayContaining([w.users.staffA.id, w.users.pm.id]))
  })
})

describe('3. Only the PM of THIS request decides', () => {
  it('PM of another project → 404/403; team PM of the same project (not projects.pm) → 403 + access_denied', async () => {
    const { id } = await submitted()
    expect([403, 404]).toContain((await api('POST', `${E}/${id}/acknowledge`, w.users.otherPm, {}, key())).status)
    const r = await api('POST', `${E}/${id}/acknowledge`, teamPm, {}, key())
    expect(r.status, JSON.stringify(r.body)).toBe(403)
    expect(r.body.detail ?? r.body.errors?.[0]?.message ?? JSON.stringify(r.body)).toMatch(/PM project dari pengajuan ini atau Direktur/)
    expect((await api('POST', `${E}/${id}/reject`, teamPm, { reason: 'bukan saya' }, key())).status).toBe(403)
    const denied = await audit(id, 'access_denied')
    expect(denied.map((d) => [d.user_id, d.field])).toEqual(expect.arrayContaining([[teamPm.id, 'acknowledge'], [teamPm.id, 'reject']]))
    expect(denied.find((d) => d.user_id === teamPm.id)!.reason).toMatch(/ADR 0021/)
    expect(await inboxItem(teamPm, id)).toBeUndefined()
  })
})

describe('4. PM files for himself → the PM step is skipped, the Direktur decides', () => {
  it('requester = the PM → pending_approval, approval_skipped audit, Direktur approves', async () => {
    const r = await submitted(w.users.pm, { requesterIds: [w.emp.pm], bankAccountId: accPm })
    expect(r.body).toMatchObject({ status: 'pending_approval', currentLevel: 1, approvalRule: { acknowledge: 'none', skipped: [{ position: 'diketahui', level: 0, userId: w.users.pm.id, reason: 'PM project adalah pemohon/pembuat' }] } })
    expect(await audit(r.id, 'approval_skipped')).toEqual([expect.objectContaining({ field: 'diketahui' })])
    expect(await notified(r.id, 'expense.pending_approval')).toEqual(expect.arrayContaining([w.users.owner.id]))
    const ok = await api('POST', `${E}/${r.id}/approve`, w.users.owner, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
  })
})

describe('5. Project without a PM → 409', () => {
  // DRMS 10/10 #5: new projects need a PM (validation + NOT NULL, migration 20261012_100000_d1010_project_pm);
  // a LEGACY row without one (DB where the migration skipped NOT NULL) is simulated as the owner role.
  afterAll(async () => {
    await sqlAs('owner', "UPDATE projects SET pm_id = $1 WHERE code = 'APM-NOPM' AND pm_id IS NULL", [w.users.pm.id])
    await sqlAs('owner', 'ALTER TABLE projects ALTER COLUMN pm_id SET NOT NULL')
  })
  it('submit is blocked with a clear message; the request stays Draft', async () => {
    const noPm = await sysCreate('projects', { code: 'APM-NOPM', name: 'APM tanpa PM', pm: w.users.pm.id, budget: 10_000_000, status: 'berjalan' })
    await sqlAs('owner', 'ALTER TABLE projects ALTER COLUMN pm_id DROP NOT NULL')
    await sqlAs('owner', 'UPDATE projects SET pm_id = NULL WHERE id = $1', [noPm])
    await sysCreate('approval-rules', { docType: 'expense_request', requestType: 'any', priority: 10, acknowledge: 'required', acknowledgeBy: 'scope_manager', acknowledgeRole: null, active: true, project: noPm, name: 'APM rule tanpa PM', minAmount: 0, steps: [{ level: 1, approverRole: 'pk-owner' }] })
    await sysCreate('team-assignments', { employee: w.emp.a, project: noPm, roleInProject: 'staff' })
    const r = await submitted(w.users.staffA, { projectId: noPm }, 409)
    expect(JSON.stringify(r.body)).toContain('Project ini belum punya PM. Hubungi Admin untuk mengisi PM project.')
    expect((await sqlAs('app', 'SELECT status FROM expense_requests WHERE id = $1', [r.id])).rows[0].status).toBe('draft')
  })
})

describe('6. A Direktur request is filed by the PM (narrow G1 exception)', () => {
  const approvalInsert = "INSERT INTO approvals (doc_type, request_id, cycle, position, level, actor_id, decision) VALUES ('expense_request', $1, 1, $2, $3, $4, $5)"

  it('PT with another Direktur ("Utamakan Direktur lain"): PM approves, then ONLY the other Direktur; the requester Direktur → 403 + audit, DB refuses', async () => {
    const r = await submitted(w.users.pm, { requesterIds: [dirEmp], bankAccountId: accDir })
    expect(r.body).toMatchObject({ status: 'pending_ack', approvalRule: { acknowledgerUserId: w.users.pm.id, selfApproval: 'direktur_via_pm', skipped: [] } })
    expect((await sqlAs('app', 'SELECT g1_exception FROM expense_requests WHERE id = $1', [r.id])).rows[0].g1_exception).toBe('direktur_via_pm')
    expect(await audit(r.id, 'approval_policy_exception')).toEqual([expect.objectContaining({ field: 'g1Exception', reason: 'Pengajuan Direktur — diajukan oleh PM (kebijakan owner 2026-10-10)' })])
    expect(await notified(r.id, 'expense.pending_ack')).toEqual([]) // the PM submitted it himself (the actor is never notified)
    expect(await inboxItem(w.users.pm, r.id)).toMatchObject({ step: 'acknowledge', selfApproval: 'direktur_via_pm' })
    // the requester Direktur cannot take the PM's step; the DB refuses what the exception does not cover
    expect((await api('POST', `${E}/${r.id}/acknowledge`, dirReq, {}, key())).status).toBe(403)
    expect((await sqlError('app', approvalInsert, [r.id, 'approval', 1, w.users.pm.id, 'approved']))?.message).toContain('requester/creator cannot hold a decision position')
    expect((await sqlError('app', approvalInsert, [r.id, 'diketahui', 0, dirReq.id, 'acknowledged']))?.message).toContain('requester/creator cannot hold a decision position')
    // the column is fixed after submit
    expect((await sqlError('app', 'UPDATE expense_requests SET g1_exception = NULL WHERE id = $1', [r.id]))?.message).toMatch(/g1_exception|locked/)

    const ack = await api('POST', `${E}/${r.id}/acknowledge`, w.users.pm, {}, key())
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect(ack.body.status).toBe('pending_approval')
    // only the other Direktur(s) are asked; the requester Direktur is not
    const appr = await notified(r.id, 'expense.pending_approval')
    expect(appr).toEqual(expect.arrayContaining([w.users.owner.id, w.users.owner2.id]))
    expect(appr).not.toContain(dirReq.id)
    expect(await inboxItem(dirReq, r.id)).toBeUndefined()
    expect(await inboxItem(w.users.owner, r.id)).toMatchObject({ step: 'approve', decisionBy: 'direktur', finalStep: true })
    expect((await api('POST', `${E}/${r.id}/approve`, w.users.pm, {}, key())).status).toBe(403)
    const self = await api('POST', `${E}/${r.id}/approve`, dirReq, {}, key())
    expect(self.status, JSON.stringify(self.body)).toBe(403)
    expect((await audit(r.id, 'access_denied')).some((d) => d.user_id === dirReq.id && d.field === 'approve')).toBe(true)
    expect((await sqlError('app', approvalInsert, [r.id, 'approval', 1, dirReq.id, 'approved']))?.message).toContain('requester/creator cannot hold a decision position')

    const ok = await api('POST', `${E}/${r.id}/approve`, w.users.owner, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
    const pos = ok.body.approvals.filter((a: { position: string }) => a.position === 'diketahui' || a.position === 'approval')
    expect(pos.map((a: { position: string; actorId: number }) => [a.position, a.actorId])).toEqual([
      ['diketahui', w.users.pm.id],
      ['approval', w.users.owner.id],
    ])
    const pdf = await asUser(w.users.finance, (req) => buildPdfData(req, r.id, { internal: false, printedBy: 'test' }))
    expect(pdf.policyNote).toMatch(/^Pengajuan Direktur .{1,3} diajukan oleh PM \(kebijakan owner 2026-10-10\)$/)
  })

  it('PT with a single Direktur: PM approves, then the requester Direktur approves his own request (direktur_via_pm_self)', async () => {
    const r = await onlyActive('pk-owner', [dirReq.id], () => submitted(w.users.pm, { requesterIds: [dirEmp], bankAccountId: accDir }))
    expect(r.body).toMatchObject({ status: 'pending_ack', approvalRule: { acknowledgerUserId: w.users.pm.id, selfApproval: 'direktur_via_pm_self', skipped: [] } })
    expect((await sqlAs('app', 'SELECT g1_exception FROM expense_requests WHERE id = $1', [r.id])).rows[0].g1_exception).toBe('direktur_via_pm_self')
    expect(await audit(r.id, 'approval_policy_exception')).toEqual([expect.objectContaining({ reason: expect.stringMatching(/satu-satunya Direktur PT/) })])
    // still not the requester at "Diketahui", nor the creator at the approval level
    expect((await sqlError('app', approvalInsert, [r.id, 'diketahui', 0, dirReq.id, 'acknowledged']))?.message).toContain('requester/creator cannot hold a decision position')
    expect((await sqlError('app', approvalInsert, [r.id, 'approval', 1, w.users.pm.id, 'approved']))?.message).toContain('requester/creator cannot hold a decision position')
    expect((await api('POST', `${E}/${r.id}/acknowledge`, w.users.pm, {}, key())).status).toBe(200)
    expect(await notified(r.id, 'expense.pending_approval')).toContain(dirReq.id)
    expect(await inboxItem(dirReq, r.id)).toMatchObject({ step: 'approve', decisionBy: 'direktur', finalStep: true, selfApproval: 'direktur_via_pm_self' })
    const ok = await api('POST', `${E}/${r.id}/approve`, dirReq, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
    const pos = ok.body.approvals.filter((a: { position: string }) => a.position === 'diketahui' || a.position === 'approval')
    expect(pos.map((a: { position: string; actorId: number }) => [a.position, a.actorId])).toEqual([
      ['diketahui', w.users.pm.id],
      ['approval', dirReq.id],
    ])
    const pdf = await asUser(w.users.finance, (req) => buildPdfData(req, r.id, { internal: false, printedBy: 'test' }))
    expect(pdf.policyNote).toMatch(/satu-satunya Direktur PT/)
  })

  it('without the exception the DB still refuses the creator (G1): raw insert on a Staff request', async () => {
    const { id } = await submitted()
    const err = await sqlError('app', "INSERT INTO approvals (doc_type, request_id, cycle, position, level, actor_id, decision) VALUES ('expense_request', $1, 1, 'diketahui', 0, $2, 'acknowledged')", [id, w.users.staffA.id])
    expect(err?.message).toContain('requester/creator cannot hold a decision position')
    expect((await sqlError('app', "UPDATE expense_requests SET g1_exception = 'direktur_via_pm' WHERE id = $1", [id]))?.message).toMatch(/g1_exception|locked/)
  })

  it('a Direktur request created without the PM while no other Direktur exists → 409 (the Direktur step is never skipped)', async () => {
    const r = await onlyActive('pk-owner', [dirReq.id], () => submitted(w.users.admin, { requesterIds: [dirEmp], bankAccountId: accDir }, 409))
    expect(JSON.stringify(r.body)).toContain('Pengajuan untuk Direktur dibuat oleh PM project')
  })

  it('a PM may file on behalf of a Direktur only — not for a Staff of another person', async () => {
    const c = await api('POST', E, w.users.pm, draftBody(w, { requesterIds: [w.emp.a], bankAccountId: w.accA }), key())
    expect(c.status).toBe(403)
  })
})

describe('7. LPJ shortfall above the tolerance: PM → Direktur', () => {
  it('Finance asks; the PM approves (Persetujuan PM), then the Direktur; Finance settles', async () => {
    const { id } = await submitted()
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())).status).toBe(200)
    expect((await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())).status).toBe(200)
    const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `APS-${id}`, proofMediaId: await proof() })
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    const lines = t.body.request.lines.map((l: { id: string }) => l.id) as string[]
    await receipt(id, lines[0]!, 600_000)
    await receipt(id, lines[1]!, 250_000)
    expect((await api('POST', `${E}/${id}/receipts-complete`, w.users.staffA, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material naik harga.' })).status).toBe(200)
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    for (const r of d.receipts.filter((x: { status: string }) => x.status === 'pending')) expect((await api('POST', `${E}/${id}/receipts/${r.id}/verify`, w.users.finance, {})).status).toBe(200)
    const v = await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(v.body.settlement).toMatchObject({ settlementType: 'shortfall', difference: -100_000 })

    const path = `${E}/${id}/lpj/shortfall-approval`
    const req = await api('POST', path, w.users.finance, { note: 'Harga material naik' }, key())
    expect(req.status, JSON.stringify(req.body)).toBe(200)
    expect(req.body.settlement.shortfallApproval).toMatchObject({ status: 'pending_ack', amount: 850_000 })
    const n = await sqlAs('app', "SELECT user_id::int AS u, title FROM notifications WHERE event = 'expense.shortfall_pending_ack' AND doc_id = $1", [String(id)])
    expect(n.rows.map((x) => x.u)).toEqual([w.users.pm.id])
    expect(n.rows[0].title).toMatch(/^Persetujuan PM/)
    const pmInbox = await api('GET', '/api/v1/lpj-shortfall-approvals/inbox', w.users.pm)
    expect(pmInbox.body.items.find((x: { requestId: number }) => x.requestId === id)).toMatchObject({ step: 'acknowledge', stepLabel: 'Persetujuan PM' })
    expect((await api('POST', `${path}/acknowledge`, w.users.owner, {}, key())).status).toBe(403)
    expect((await api('POST', `${path}/acknowledge`, teamPm, {}, key())).status).toBe(403)
    expect((await api('GET', `${E}/${id}`, w.users.pm)).body.settlement.shortfallApproval).toMatchObject({ allowedActions: ['acknowledge', 'reject'] })
    const a = await api('POST', `${path}/acknowledge`, w.users.pm, {}, key())
    expect(a.status, JSON.stringify(a.body)).toBe(200)
    expect(a.body.settlement.shortfallApproval).toMatchObject({ status: 'pending_approval', level: 1 })
    const ownerInbox = await api('GET', '/api/v1/lpj-shortfall-approvals/inbox', w.users.owner)
    expect(ownerInbox.body.items.find((x: { requestId: number }) => x.requestId === id)).toMatchObject({ step: 'approve', stepLabel: 'Persetujuan Direktur' })
    expect((await api('POST', `${path}/approve`, w.users.finance, {}, key())).status).toBe(403)
    const b = await api('POST', `${path}/approve`, w.users.owner, {}, key())
    expect(b.status, JSON.stringify(b.body)).toBe(200)
    expect(b.body.settlement.shortfallApproval).toMatchObject({ status: 'approved', settleAllowed: true })
    const s = await api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `APS2-${id}`, proofMediaId: await proof() })
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body).toMatchObject({ settlementType: 'shortfall', request: { status: 'completed' } })
  })
})

describe('8. Addendum RAB stays Direktur → Finance', () => {
  it('scope_manager is refused on an addendum rule; the PM cannot decide an addendum', async () => {
    const p = await getTestPayload()
    await expect(
      p.create({
        collection: 'approval-rules',
        data: { docType: 'budget_addendum', requestType: 'any', minAmount: 0, priority: 900, active: false, name: 'APM addendum PM', acknowledge: 'required', acknowledgeBy: 'scope_manager', steps: [{ level: 1, approverRole: 'pk-finance' }] } as never,
        user: w.users.admin as never,
        overrideAccess: false,
        depth: 0,
      }),
    ).rejects.toMatchObject({ status: 400 })
    const c = await api('POST', '/api/v1/budget-addenda', w.users.pm, { projectId: w.project, addition: 2_000_000, reason: 'Tambah pekerjaan pagar' })
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const s = await api('POST', `/api/v1/budget-addenda/${c.body.id}/submit`, w.users.pm, {})
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body.status).toBe('pending_ack')
    expect((await api('POST', `/api/v1/budget-addenda/${c.body.id}/acknowledge`, w.users.pm, {})).status).toBe(403)
    expect((await api('POST', `/api/v1/budget-addenda/${c.body.id}/acknowledge`, w.users.owner, {})).status).toBe(200)
    const ok = await api('POST', `/api/v1/budget-addenda/${c.body.id}/approve`, w.users.finance, {})
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
  })
})

describe('9. An old (Direktur → Finance) snapshot finishes on its own rules', () => {
  it('ADR 0013 world: Direktur "Diketahui" then Finance approves; the PM cannot decide', async () => {
    const { id, body } = await submitted(old.users.staffA, {}, 200, old)
    expect(body).toMatchObject({ status: 'pending_ack', statusLabel: 'Menunggu Diketahui (Direktur)', approvalRule: { acknowledgeBy: 'role', acknowledgeRole: 'pk-owner' } })
    expect((await api('POST', `${E}/${id}/acknowledge`, old.users.pm, {}, key())).status).toBe(403)
    expect((await api('POST', `${E}/${id}/acknowledge`, old.users.owner, {}, key())).status).toBe(200)
    expect(await inboxItem(old.users.finance, id)).toMatchObject({ step: 'approve', stepLabel: 'Approval level 1', decisionBy: 'finance' })
    const ok = await api('POST', `${E}/${id}/approve`, old.users.finance, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
  })
})

describe('Admin data', () => {
  it('approval_policy_exception rows are readable in the request audit trail', async () => {
    const rows = (await sqlAs('app', "SELECT doc_id FROM audit_logs WHERE action = 'approval_policy_exception' AND doc_type = 'expense_request'")).rows
    expect(rows.length).toBeGreaterThan(0)
    const one = await auditRows('expense_request', rows[0].doc_id as string)
    expect(one.some((x) => x.action === 'approval_policy_exception')).toBe(true)
  })
})

/** Runs migration functions like `payload migrate` does (one OWNER connection) inside a transaction that is ROLLED BACK. */
async function inRolledBackTx(fn: (db: { execute: (q: unknown) => Promise<unknown> }) => Promise<void>): Promise<void> {
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

describe('migration 20261010_130000_approval_pm_direktur', () => {
  it('up is re-runnable; down → up round trip restores column, guard and trigger', async () => {
    await inRolledBackTx(async (db) => {
      const n = async (q: string) => ((await db.execute(sql.raw(q))) as { rows: Array<{ n: number }> }).rows[0]!.n
      const col = "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'expense_requests' AND column_name = 'g1_exception'"
      const trg = "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'expense_requests_g1_exception'"
      const fn = "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'pk_approvals_before_insert' AND prosrc LIKE '%direktur_via_pm%'"
      await migrationUp({ db } as never)
      expect([await n(col), await n(trg), await n(fn)]).toEqual([1, 1, 1])
      await migrationDown({ db } as never)
      expect([await n(col), await n(trg), await n(fn)]).toEqual([0, 0, 0])
      await migrationUp({ db } as never)
      expect([await n(col), await n(trg), await n(fn)]).toEqual([1, 1, 1])
    })
  })
})
