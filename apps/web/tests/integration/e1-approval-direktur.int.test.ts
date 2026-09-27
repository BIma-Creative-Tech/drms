import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildPdfData } from '@/pdf/data'

import { getTestPayload, sqlAs } from './helpers'
import { api, asUser, draftBody, makeFlowUser, makeWorld, sysCreate, type FlowUser, type World } from './flow-world'

/**
 * E1 — ADR 0013 acceptance criteria 1–8 through the real API (AC-9: form-228 golden test; AC-10: APK):
 * "Diketahui" = approval by the Direktur (role pk-owner), then Finance; PM only monitors (403 +
 * `access_denied`); rules refuse PM/scope_manager/optional Direktur; G1-2 skip rule with
 * `approval_skipped` audit + PDF note; legacy (pre-E1) snapshots still complete.
 */
let w: World
let dirEmp: number
let dirReq: FlowUser
let accDir: number
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })

beforeAll(async () => {
  w = await makeWorld('ED') // letters only: the world's fictional vehicle plate uses the tag
  // A Direktur who is also an employee (can be "Diajukan Oleh") — for the G1-2 skip cases.
  dirEmp = await sysCreate('employees', { code: 'E1-DIR', name: 'E1 Direktur Pemohon' })
  dirReq = await makeFlowUser(['pk-owner'], 'e1-dir-req', dirEmp)
  const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id as number
  accDir = await sysCreate('employee-bank-accounts', { employee: dirEmp, bank, accountNo: `7${Date.now() % 1e9}5`, accountHolder: 'E1 Direktur', isDefault: true })
  await sysCreate('team-assignments', { employee: dirEmp, project: w.project, roleInProject: 'staff' })
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function submitted(creator: FlowUser = w.users.staffA, over: Record<string, unknown> = {}, expectStatus = 200) {
  const c = await api('POST', E, creator, draftBody(w, over), key())
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const s = await api('POST', `${E}/${c.body.id}/submit`, creator, {}, key())
  expect(s.status, JSON.stringify(s.body)).toBe(expectStatus)
  return { id: c.body.id as number, body: s.body }
}

/** Temporarily deactivates every active holder of `role` except `keep` (restored afterwards). */
async function onlyActive<T>(role: string, keep: number[], fn: () => Promise<T>): Promise<T> {
  const r = await sqlAs('app', `SELECT u.id FROM users u JOIN users_roles r ON r.parent_id = u.id WHERE r.value = $1 AND u.active AND NOT (u.id = ANY($2::int[]))`, [role, keep])
  const ids = r.rows.map((x) => x.id as number)
  if (ids.length) await sqlAs('app', 'UPDATE users SET active = false WHERE id = ANY($1::int[])', [ids])
  try {
    return await fn()
  } finally {
    if (ids.length) await sqlAs('app', 'UPDATE users SET active = true WHERE id = ANY($1::int[])', [ids])
  }
}

const audit = async (id: number, action: string) =>
  (await sqlAs('app', 'SELECT user_id::int AS user_id, field, reason, new_value FROM audit_logs WHERE doc_type = $1 AND doc_id = $2 AND action = $3 ORDER BY id', ['expense_request', String(id), action])).rows

describe('AC-1 / AC-3: Direktur (Diketahui) → Finance; notifications to Direktur, never to the PM', () => {
  it('submit → pending_ack; every active Direktur (not requester) is notified, PM and Finance are not; then Finance is notified', async () => {
    const { id, body } = await submitted()
    expect(body).toMatchObject({ status: 'pending_ack', statusLabel: 'Menunggu Diketahui (Direktur)', approvalRule: { acknowledgeRole: 'pk-owner', decisionRoles: ['pk-owner', 'pk-finance'] } })
    const notified = async (event: string) =>
      (await sqlAs('app', 'SELECT user_id::int AS u FROM notifications WHERE event = $1 AND doc_id = $2', [event, String(id)])).rows.map((r) => r.u as number)
    const ack = await notified('expense.pending_ack')
    expect(ack).toEqual(expect.arrayContaining([w.users.owner.id, w.users.owner2.id]))
    expect(ack).not.toContain(w.users.pm.id)
    expect(ack).not.toContain(w.users.finance.id)
    const n = await sqlAs('app', "SELECT title, body FROM notifications WHERE event = 'expense.pending_ack' AND doc_id = $1 AND user_id = $2", [String(id), w.users.owner.id])
    expect(n.rows[0].body).toContain('menunggu persetujuan Anda sebagai Direktur')
    const inbox = await api('GET', '/api/v1/approvals/inbox', w.users.owner)
    expect(inbox.body.items.find((i: { id: number }) => i.id === id)).toMatchObject({ step: 'acknowledge', stepLabel: 'Persetujuan Direktur (Diketahui)', decisionFlow: true })
    expect((await api('GET', '/api/v1/approvals/inbox', w.users.pm)).body.items.map((i: { id: number }) => i.id)).not.toContain(id)

    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key())).status).toBe(200)
    const appr = await notified('expense.pending_approval')
    expect(appr).toEqual(expect.arrayContaining([w.users.finance.id, w.users.finance2.id]))
    expect(appr).not.toContain(w.users.pm.id)
    expect(appr).not.toContain(w.users.owner.id)
    const fin = await api('GET', '/api/v1/approvals/inbox', w.users.finance)
    expect(fin.body.items.find((i: { id: number }) => i.id === id)).toMatchObject({ step: 'approve', stepLabel: 'Approval level 1' })
    const ok = await api('POST', `${E}/${id}/approve`, w.users.finance, {}, key())
    expect(ok.body).toMatchObject({ status: 'approved' })
    const pos = ok.body.approvals.filter((a: { position: string }) => a.position === 'diketahui' || a.position === 'approval')
    expect(pos.map((a: { position: string; actorId: number; signatureId: number | null }) => [a.position, a.actorId, a.signatureId !== null])).toEqual([
      ['diketahui', w.users.owner.id, true],
      ['approval', w.users.finance.id, true],
    ])
  })
})

describe('AC-2: PM monitors only', () => {
  it('PM acknowledge / approve / reject → 403 + access_denied audit; PM still reads the team request', async () => {
    const { id } = await submitted()
    for (const action of ['acknowledge', 'approve', 'reject']) {
      const r = await api('POST', `${E}/${id}/${action}`, w.users.pm, action === 'reject' ? { reason: 'PM menolak' } : {}, key())
      expect(r.status, action).toBe(403)
      expect(r.body.detail ?? r.body.errors?.[0]?.message ?? JSON.stringify(r.body)).toMatch(/Direktur atau Finance/)
    }
    const denied = await audit(id, 'access_denied')
    expect(denied.map((d) => [d.user_id, d.field])).toEqual([
      [w.users.pm.id, 'acknowledge'],
      [w.users.pm.id, 'approve'],
      [w.users.pm.id, 'reject'],
    ])
    expect(denied[0]!.reason).toMatch(/ADR 0013/)
    const get = await api('GET', `${E}/${id}`, w.users.pm)
    expect(get.status).toBe(200)
    expect(get.body.allowedActions).not.toEqual(expect.arrayContaining(['acknowledge']))
    const team = await api('GET', `${E}?scope=team&limit=100`, w.users.pm)
    expect(team.body.items.map((i: { id: number }) => i.id)).toContain(id)
    // Admin and Staff (not requester) do not decide either
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.admin, {}, key())).status).toBe(403)
    expect([403, 404]).toContain((await api('POST', `${E}/${id}/acknowledge`, w.users.staffB, {}, key())).status) // not visible to Staff B → 404
    // after the Direktur: PM still cannot approve at the Finance step
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key())).status).toBe(200)
    expect((await api('POST', `${E}/${id}/approve`, w.users.pm, {}, key())).status).toBe(403)
  })
})

describe('AC-4: rejection needs a reason (Direktur)', () => {
  it('Direktur reject without reason → 400; with reason → rejected, recorded at "Diketahui"', async () => {
    const { id } = await submitted()
    expect((await api('POST', `${E}/${id}/reject`, w.users.owner, {}, key())).status).toBe(400)
    const rj = await api('POST', `${E}/${id}/reject`, w.users.owner, { reason: 'anggaran tidak tersedia' }, key())
    expect(rj.status, JSON.stringify(rj.body)).toBe(200)
    expect(rj.body).toMatchObject({ status: 'rejected', rejectReason: 'anggaran tidak tersedia' })
    expect(rj.body.approvals.find((a: { decision: string }) => a.decision === 'rejected')).toMatchObject({ position: 'diketahui', actorId: w.users.owner.id })
  })
})

describe('AC-5: approval-rules refuse PM/Staff deciders, scope_manager and an optional Direktur', () => {
  const base = { docType: 'expense_request', requestType: 'any', minAmount: 0, priority: 900, active: false, name: 'E1 rule test' }
  const create = async (data: Record<string, unknown>) => {
    const p = await getTestPayload()
    return p.create({ collection: 'approval-rules', data: data as never, user: w.users.admin as never, overrideAccess: false, depth: 0 })
  }
  it.each([
    ['acknowledgeRole = pk-pm', { acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-pm', steps: [{ level: 1, approverRole: 'pk-finance' }] }],
    ['approverRole = pk-pm', { acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', steps: [{ level: 1, approverRole: 'pk-pm' }] }],
    ['approverRole = pk-staff', { acknowledge: 'none', acknowledgeBy: 'role', steps: [{ level: 1, approverRole: 'pk-staff' }] }],
    ['acknowledgeBy = scope_manager', { acknowledge: 'required', acknowledgeBy: 'scope_manager', steps: [{ level: 1, approverRole: 'pk-finance' }] }],
    ['optional Direktur', { acknowledge: 'optional', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', steps: [{ level: 1, approverRole: 'pk-finance' }] }],
  ])('%s → 400', async (_n, data) => {
    await expect(create({ ...base, ...data })).rejects.toMatchObject({ status: 400 })
  })
  it('a named PM as approver → 400; Direktur → Finance saves', async () => {
    await expect(create({ ...base, acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', steps: [{ level: 1, approverUser: w.users.pm.id }] })).rejects.toMatchObject({ status: 400 })
    const ok = await create({ ...base, acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', steps: [{ level: 1, approverRole: 'pk-finance' }] })
    expect(ok.id).toBeGreaterThan(0)
  })
  it('an active legacy rule (PM "Diketahui", written before E1) blocks new submissions with 409 instead of routing to the PM', async () => {
    const cc = await sysCreate('cost-centers', { code: 'E1-LEG', name: 'E1 legacy', manager: w.users.pm.id })
    const rule = await sysCreate('approval-rules', { ...base, name: 'E1 legacy rule', costCenter: cc, priority: 1, active: true, acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', steps: [{ level: 1, approverRole: 'pk-finance' }] })
    await sqlAs('owner', "UPDATE approval_rules SET acknowledge_by = 'scope_manager', acknowledge_role = NULL WHERE id = $1", [rule])
    for (const e of [w.emp.a]) await sysCreate('team-assignments', { employee: e, costCenter: cc, roleInProject: 'staff' })
    const { body } = await submitted(w.users.staffA, { projectId: undefined, costCenterId: cc }, 409)
    expect(JSON.stringify(body)).toMatch(/tidak sesuai alur Direktur/)
  })
})

describe('AC-6: G1-2 skip rule', () => {
  it('the only Direktur is the requester → "Diketahui" skipped (audit approval_skipped), Finance decides; PDF "(tidak berlaku — pemohon)"', async () => {
    const r = await onlyActive('pk-owner', [dirReq.id], () => submitted(w.users.admin, { requesterIds: [dirEmp], bankAccountId: accDir }))
    expect(r.body).toMatchObject({
      status: 'pending_approval',
      currentLevel: 1,
      approvalRule: { acknowledge: 'none', skipped: [{ position: 'diketahui', level: 0, role: 'pk-owner', reason: 'pemohon/pembuat adalah satu-satunya Direktur' }] },
    })
    const sk = await audit(r.id, 'approval_skipped')
    expect(sk).toEqual([expect.objectContaining({ field: 'diketahui', reason: 'pemohon/pembuat adalah satu-satunya Direktur' })])
    expect((await api('POST', `${E}/${r.id}/acknowledge`, dirReq, {}, key())).status).toBe(403) // G1 still
    const ok = await api('POST', `${E}/${r.id}/approve`, w.users.finance, {}, key())
    expect(ok.body.status).toBe('approved')
    const pdf = await asUser(w.users.finance, (req) => buildPdfData(req, r.id, { internal: false, printedBy: 'test' }))
    expect(pdf.signatures.find((s) => s.label === 'Diketahui Oleh')).toMatchObject({ names: '', note: '(tidak berlaku — pemohon)' })
    expect(pdf.signatures.find((s) => s.label === 'Approval')?.names).toContain('ED-finance')
  })

  it('a second Direktur exists → nothing is skipped (the other Direktur decides)', async () => {
    const r = await submitted(w.users.admin, { requesterIds: [dirEmp], bankAccountId: accDir })
    expect(r.body).toMatchObject({ status: 'pending_ack', approvalRule: { skipped: [] } })
    expect((await api('POST', `${E}/${r.id}/acknowledge`, w.users.owner, {}, key())).status).toBe(200)
  })

  it('the only Finance is the creator → approval skipped; the Direktur approval is final (approved, approvedAmount set)', async () => {
    const r = await onlyActive('pk-finance', [w.users.finance.id], () => submitted(w.users.finance, { requesterIds: [w.emp.a], bankAccountId: w.accA }))
    expect(r.body).toMatchObject({ status: 'pending_ack', approvalRule: { steps: [], skipped: [{ position: 'approval', level: 1, role: 'pk-finance' }] } })
    expect(await audit(r.id, 'approval_skipped')).toEqual([expect.objectContaining({ field: 'approval', reason: 'pemohon/pembuat adalah satu-satunya Finance' })])
    const ack = await api('POST', `${E}/${r.id}/acknowledge`, w.users.owner, {}, key())
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect(ack.body).toMatchObject({ status: 'approved', approvedAmount: ack.body.grandTotal })
    const pdf = await asUser(w.users.owner, (req) => buildPdfData(req, r.id, { internal: false, printedBy: 'test' }))
    expect(pdf.signatures.find((s) => s.label === 'Approval')).toMatchObject({ names: '', note: '(tidak berlaku — pemohon)' })
  })

  it('requester = only Direktur and creator = only Finance → no independent decision → 409', async () => {
    const r = await onlyActive('pk-owner', [dirReq.id], () =>
      onlyActive('pk-finance', [w.users.finance.id], () => submitted(w.users.finance, { requesterIds: [dirEmp], bankAccountId: accDir }, 409)),
    )
    expect(JSON.stringify(r.body)).toMatch(/Tidak ada pihak independen/)
    expect((await sqlAs('app', 'SELECT status FROM expense_requests WHERE id = $1', [r.id])).rows[0].status).toBe('draft')
  })

  it('no active Direktur at all → 409 (never a silent skip)', async () => {
    const r = await onlyActive('pk-owner', [], () => submitted(w.users.staffA, {}, 409))
    expect(JSON.stringify(r.body)).toMatch(/Tidak ada pengguna aktif untuk posisi/)
  })
})

describe('AC-8: requests submitted before E1 finish on their old snapshot', () => {
  it('legacy snapshot (PM "Diketahui", Owner approval): PM acknowledges, Direktur approves; Finance cannot', async () => {
    const { id } = await submitted()
    expect((await api('POST', `${E}/${id}/withdraw`, w.users.staffA, { reason: 'simulasi pra-E1' }, key())).status).toBe(200)
    // Re-create the state a pre-E1 submission left behind (snapshot without decisionRoles/skipped).
    const legacy = {
      ruleId: 1,
      ruleName: 'Default — Owner (semua nominal)',
      acknowledge: 'required',
      acknowledgeBy: 'scope_manager',
      acknowledgerUserId: w.users.pm.id,
      acknowledgeRole: null,
      signDiajukan: 'required',
      signDibuat: 'required',
      steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }],
    }
    await sqlAs('app', "UPDATE expense_requests SET status = 'pending_ack', current_level = 0, approval_snapshot = $2::jsonb WHERE id = $1", [id, JSON.stringify(legacy)])
    const d = await api('GET', `${E}/${id}`, w.users.pm)
    expect(d.body.approvalRule).toMatchObject({ acknowledgeBy: 'scope_manager', decisionRoles: [] })
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key())).status).toBe(403) // not the legacy acknowledger
    const ack = await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect(ack.body.status).toBe('pending_approval')
    expect((await api('POST', `${E}/${id}/approve`, w.users.finance, {}, key())).status).toBe(403)
    const ok = await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
  })
})

describe('APK needs (E3 / AC-10 server side)', () => {
  it('/me capabilities: approval inbox for Direktur and Finance, not for a PM-only user', async () => {
    const cap = async (u: FlowUser) => (await api('GET', '/api/v1/me', u)).body.capabilities
    expect(await cap(w.users.owner)).toEqual({ approvalInbox: true, teamMonitor: false, progressReportCreate: true })
    expect(await cap(w.users.finance)).toEqual({ approvalInbox: true, teamMonitor: false, progressReportCreate: false })
    expect(await cap(w.users.pm)).toEqual({ approvalInbox: false, teamMonitor: true, progressReportCreate: true })
    expect(await cap(w.users.staffA)).toEqual({ approvalInbox: false, teamMonitor: false, progressReportCreate: false })
  })
})
