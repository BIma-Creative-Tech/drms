import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { NO_APPROVAL_PDF_LABEL, PRINCIPAL_NO_APPROVAL_NOTE } from '@/domain/expense/decision'
import { MSG_OWNER_OWN_REQUEST } from '@/domain/expense/snapshot'
import { addDays } from '@/domain/expense/types'
import { resetRateLimits } from '@/lib/rate-limit'
import { DIREKTUR_RULE, down as dataDown, up as dataUp } from '@/migrations/20261013_300000_d1010_approval_config_data'
import { buildPdfData } from '@/pdf/data'
import { DIREKTUR_RULE_NAME, OWNER_RULE_NAME } from '@/seed/data'

import { companyId, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, asUser, draftBody, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * ADR 0024 (owner decision 2026-10-11) as amended by ADR 0025 (owner 2026-10-13) through the real API + DB:
 * configurable approval rules ("Peran pemohon", zero-step rule for the OWNER only — was the Direktur) and the
 * audited no-approval exception — the Owner's own request → Finance transfer queue at once (audit, timeline, PDF,
 * report, notifications); an Owner request filed by someone else is refused; a Direktur's own request now goes to
 * the Owner; Staff / PM flows unchanged; zero-step rules refused for other roles (Direktur included) in the service
 * AND the DB; LPJ shortfall and reimburse re-approval without approval; Addendum RAB unchanged; ADR 0021
 * (`direktur_via_pm`) snapshots keep working; rule priority selection; the ADR 0024 per-PT data migration.
 * The Owner-level flow itself is covered by d1310-a-owner.int.test.ts.
 */
let w: World
let w2: World
let drms: number
let dirEmp: number
let dirReq: FlowUser
let accDir: number
let accPm: number
// ADR 0025: the Owner (pk-principal) with an employee — his own request is the no-approval one
let ownEmp: number
let ownReq: FlowUser
let accOwn: number
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) // Asia/Makassar

beforeAll(async () => {
  w = await makeWorld('EAP', { rule: 'pm_direktur' })
  w2 = await makeWorld('EAQ', { rule: 'pm_direktur' })
  drms = await companyId()
  dirEmp = await sysCreate('employees', { code: 'EAP-DIR', name: 'EAP Direktur Pemohon' })
  dirReq = await makeFlowUser(['pk-owner'], 'eap-dir-req', dirEmp)
  const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id as number
  accDir = await sysCreate('employee-bank-accounts', { employee: dirEmp, bank, accountNo: `7${Date.now() % 1e9}4`, accountHolder: 'EAP Direktur', isDefault: true, verificationStatus: 'verified' })
  accPm = await sysCreate('employee-bank-accounts', { employee: w.emp.pm, bank, accountNo: `7${Date.now() % 1e9}7`, accountHolder: 'EAP PM', isDefault: true, verificationStatus: 'verified' })
  ownEmp = await sysCreate('employees', { code: 'EAP-OWN', name: 'EAP Owner Pemohon' })
  ownReq = await makeFlowUser(['pk-principal'], 'eap-own-req', ownEmp)
  accOwn = await sysCreate('employee-bank-accounts', { employee: ownEmp, bank, accountNo: `7${Date.now() % 1e9}5`, accountHolder: 'EAP Owner', isDefault: true, verificationStatus: 'verified' })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

const direkturBody = (over: Record<string, unknown> = {}) => draftBody(w, { requesterIds: [dirEmp], bankAccountId: accDir, title: 'Biaya perjalanan Direktur', ...over })
const ownerBody = (over: Record<string, unknown> = {}) => draftBody(w, { requesterIds: [ownEmp], bankAccountId: accOwn, title: 'Biaya perjalanan Owner', ...over })

async function submitted(creator: FlowUser, body: Record<string, unknown>, expectStatus = 200) {
  const c = await api('POST', E, creator, body, key())
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const s = await api('POST', `${E}/${c.body.id}/submit`, creator, {}, key())
  expect(s.status, JSON.stringify(s.body)).toBe(expectStatus)
  return { id: c.body.id as number, body: s.body }
}

const audit = async (docType: string, id: number, action: string) =>
  (await sqlAs('app', 'SELECT user_id::int AS user_id, field, reason, new_value, source FROM audit_logs WHERE doc_type = $1 AND doc_id = $2 AND action = $3 ORDER BY id', [docType, String(id), action])).rows
const notified = async (id: number, event: string) => (await sqlAs('app', 'SELECT user_id::int AS u, title, body FROM notifications WHERE event = $1 AND doc_id = $2', [event, String(id)])).rows
const decisions = async (id: number) => (await sqlAs('app', "SELECT position::text AS p FROM approvals WHERE request_id = $1 AND position IN ('diketahui', 'approval')", [id])).rows

async function proof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

async function receipt(id: number, lineId: string, amount: number, user: FlowUser) {
  const img = await upload('/api/v1/media/receipts', user, await png())
  expect(img.status).toBe(201)
  const r = await api('POST', `${E}/${id}/receipts`, user, { lineId, receiptNo: `EAP-${id}-${amount}-${randomUUID().slice(0, 5)}`, vendorName: 'Toko Maju', receiptDate: addDays(today(), -1), amount, imageId: img.body.id })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body
}

describe('1. The Owner files his own request → Finance transfer queue at once (audited exception, ADR 0025)', () => {
  it('Pengajuan Baru: no approval step, status "Tanpa persetujuan (Antri Transfer)", audit + timeline + queue + PDF + report + notifications', async () => {
    const { id, body } = await submitted(ownReq, ownerBody())
    expect(body).toMatchObject({
      status: 'approved',
      statusLabel: 'Tanpa persetujuan (Antri Transfer)',
      approvedAmount: body.grandTotal,
      approvalRule: { name: OWNER_RULE_NAME, acknowledge: 'none', steps: [], skipped: [], selfApproval: 'principal_no_approval' },
    })
    // the status path never shows a waiting step
    expect(body.timeline.map((s: { status: string }) => s.status)).not.toContain('pending_approval')
    expect((await sqlAs('app', 'SELECT g1_exception, approved_at IS NOT NULL AS at FROM expense_requests WHERE id = $1', [id])).rows[0]).toEqual({ g1_exception: 'principal_no_approval', at: true })
    expect(await decisions(id)).toEqual([]) // no decision row at all
    expect(await audit('expense_request', id, 'approval_policy_exception')).toEqual([
      expect.objectContaining({ user_id: ownReq.id, field: 'g1Exception', reason: PRINCIPAL_NO_APPROVAL_NOTE, new_value: { v: expect.objectContaining({ exception: 'principal_no_approval', ruleName: OWNER_RULE_NAME }) } }),
    ])
    // nobody was asked to decide; Finance hears of the transfer queue, the team PM of the Owner request
    expect(await notified(id, 'expense.pending_approval')).toEqual([])
    expect(await notified(id, 'expense.pending_ack')).toEqual([])
    expect((await notified(id, 'expense.transfer_queue')).map((r) => r.u)).toEqual(expect.arrayContaining([w.users.finance.id, w.users.finance2.id]))
    const team = await notified(id, 'expense.team_submitted')
    expect(team.map((r) => r.u)).toEqual([w.users.pm.id])
    expect(team[0].body).toContain('tanpa persetujuan (kebijakan PT)')
    expect(team[0].title).toContain('Pengajuan Owner')
    // transfer queue (API + web data): flagged item
    const q = await api('GET', '/api/v1/transfer-queue', w.users.finance)
    expect(q.body.items.find((i: { id: number }) => i.id === id)).toMatchObject({ noApproval: true, noApprovalBy: 'owner', statusLabel: 'Tanpa persetujuan (Antri Transfer)' })
    // inbox: nothing for any Direktur / Owner / PM
    for (const u of [w.users.owner, w.users.owner2, dirReq, ownReq, w.users.pm]) expect((await api('GET', '/api/v1/approvals/inbox', u)).body.items.find((i: { id: number }) => i.id === id)).toBeUndefined()
    // PDF: note + the decision boxes "(tidak berlaku — tanpa persetujuan)"
    const pdf = await asUser(w.users.finance, (req) => buildPdfData(req, id, { internal: false, printedBy: 'test' }))
    expect(pdf.policyNote).toMatch(/^Tanpa persetujuan .{1,3} pengajuan Owner \(kebijakan PT\)$/)
    expect(pdf.statusLabel).toBe('Tanpa persetujuan (Antri Transfer)')
    expect(pdf.signatures.filter((s) => s.label === 'Diketahui Oleh' || s.label === 'Approval').map((s) => s.note)).toEqual([expect.stringContaining('tanpa persetujuan'), expect.stringContaining('tanpa persetujuan')])
    expect(NO_APPROVAL_PDF_LABEL).toContain('tanpa persetujuan')
    // report K-13: column "Persetujuan"
    const rep = await api('GET', `/api/v1/reports/rekap-pengajuan?dari=2000-01-01&sampai=2999-12-31`, w.users.finance)
    expect(rep.status, JSON.stringify(rep.body).slice(0, 300)).toBe(200)
    expect(rep.body.main.columns.map((c: { key: string }) => c.key)).toContain('persetujuan')
    expect(rep.body.main.rows.find((r: { nomor: string }) => r.nomor === body.docNo)).toMatchObject({ persetujuan: PRINCIPAL_NO_APPROVAL_NOTE, status: 'Tanpa persetujuan (Antri Transfer)' })
    // Finance remains the only check: the normal transfer works
    const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `EAP-${id}`, proofMediaId: await proof() }, key())
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    expect(t.body.request.status).toBe('transferred')
    // the column stays fixed
    expect((await sqlError('app', 'UPDATE expense_requests SET g1_exception = NULL WHERE id = $1', [id]))?.message).toMatch(/g1_exception|locked/)
  })

  it('/me and masters hint the APK (ownRequestNoApproval, employees.direktur)', async () => {
    const me = await api('GET', '/api/v1/me', ownReq)
    // ADR 0025: effective roles — the Owner is listed with the Direktur role too (same view and permissions)
    expect(me.body.companies.find((c: { id: number }) => c.id === drms)).toMatchObject({ ownRequestNoApproval: true, roles: ['pk-owner', 'pk-principal'], capabilities: { approvalInbox: true } })
    // ADR 0025: a Direktur's own request goes to the Owner — no hint for the Direktur any more
    const dir = await api('GET', '/api/v1/me', dirReq)
    expect(dir.body.companies.find((c: { id: number }) => c.id === drms)).toMatchObject({ ownRequestNoApproval: false })
    const staff = await api('GET', '/api/v1/me', w.users.staffA)
    expect(staff.body.companies.find((c: { id: number }) => c.id === drms)).toMatchObject({ ownRequestNoApproval: false })
    const m = await api('GET', '/api/v1/masters?types=employees', w.users.finance)
    const items = m.body.types.employees.items as Array<{ id: number; direktur: boolean }>
    expect(items.find((e) => e.id === dirEmp)?.direktur).toBe(true)
    expect(items.find((e) => e.id === ownEmp)?.direktur).toBe(true) // ADR 0025: the Owner files his own request too
    expect(items.find((e) => e.id === w.emp.a)?.direktur).toBe(false)
  })
})

describe('2. An Owner request filed by someone else is refused; a Direktur\'s own request goes to the Owner (ADR 0025)', () => {
  it('PM → 403 at the draft; Admin on behalf of the Owner → 409 at submit (stays Draft); the 2026-10-10 PM wording is gone', async () => {
    const pm = await api('POST', E, w.users.pm, ownerBody(), key())
    expect(pm.status).toBe(403)
    expect(JSON.stringify(pm.body)).toContain('Hanya Admin/Finance yang boleh membuat pengajuan atas nama orang lain.')
    const r = await submitted(w.users.admin, ownerBody(), 409)
    expect(JSON.stringify(r.body)).toContain(MSG_OWNER_OWN_REQUEST)
    expect(JSON.stringify(r.body)).not.toContain('dibuat oleh PM project')
    expect((await sqlAs('app', 'SELECT status, g1_exception FROM expense_requests WHERE id = $1', [r.id])).rows[0]).toEqual({ status: 'draft', g1_exception: null })
  })
  it('a Direktur\'s own request → "Pengajuan Direktur" → the Owner approves (no exception, the Direktur never decides it)', async () => {
    const { id, body } = await submitted(dirReq, direkturBody())
    expect(body).toMatchObject({
      status: 'pending_approval',
      statusLabel: 'Menunggu persetujuan Owner',
      approvalRule: { name: DIREKTUR_RULE_NAME, acknowledge: 'none', steps: [{ level: 1, approverRole: 'pk-principal' }], selfApproval: null },
    })
    for (const u of [dirReq, w.users.owner]) expect((await api('POST', `${E}/${id}/approve`, u, {}, key())).status).toBe(403)
    const ok = await api('POST', `${E}/${id}/approve`, ownReq, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body).toMatchObject({ status: 'approved', statusLabel: 'Disetujui (Antri Transfer)' })
    expect(await audit('expense_request', id, 'approval_policy_exception')).toEqual([])
  })
  it('a Direktur together with a Staff as requesters → the default flow (PM → Direktur), no exception', async () => {
    const r = await submitted(w.users.admin, draftBody(w, { requesterIds: [w.emp.a, dirEmp] }))
    expect(r.body).toMatchObject({ status: 'pending_ack', approvalRule: { selfApproval: null, acknowledgerUserId: w.users.pm.id } })
  })
})

describe('3. Staff / PM flows unchanged', () => {
  it('Staff → PM project → Direktur → Finance transfer', async () => {
    const { id, body } = await submitted(w.users.staffA, draftBody(w))
    expect(body).toMatchObject({ status: 'pending_ack', statusLabel: 'Menunggu persetujuan PM', approvalRule: { selfApproval: null } })
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())).body.status).toBe('pending_approval')
    const ok = await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())
    expect(ok.body).toMatchObject({ status: 'approved', statusLabel: 'Disetujui (Antri Transfer)' })
    expect(await audit('expense_request', id, 'approval_policy_exception')).toEqual([])
    const q = await api('GET', '/api/v1/transfer-queue', w.users.finance)
    expect(q.body.items.find((i: { id: number }) => i.id === id)).toMatchObject({ noApproval: false })
  })
  it('PM files for himself → PM step skipped (audited), the Direktur decides', async () => {
    const { id, body } = await submitted(w.users.pm, draftBody(w, { requesterIds: [w.emp.pm], bankAccountId: accPm }))
    expect(body).toMatchObject({ status: 'pending_approval', approvalRule: { selfApproval: null } })
    expect((await audit('expense_request', id, 'approval_skipped')).map((x) => x.field)).toEqual(['diketahui'])
    expect((await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())).body.status).toBe('approved')
  })
})

describe('4. Zero-step rules: Owner only (ADR 0025; was Direktur) — service AND DB', () => {
  const zero = (requesterRoles: string[], over: Record<string, unknown> = {}) => ({
    company: drms,
    name: `EAP nol level ${requesterRoles.join('+') || 'semua'}`,
    docType: 'expense_request',
    requestType: 'any',
    minAmount: 0,
    priority: 900,
    active: false,
    requesterRoles,
    acknowledge: 'none',
    acknowledgeBy: 'role',
    acknowledgeRole: null,
    steps: [],
    ...over,
  })
  const create = async (data: Record<string, unknown>) =>
    (await getTestPayload()).create({ collection: 'approval-rules', data: data as never, user: w.users.admin as never, overrideAccess: false, depth: 0 })

  it('service: refused for Direktur / Staff / PM / Finance / everybody / Owner+Staff / with "Diketahui"; allowed for Owner only', async () => {
    for (const roles of [['pk-owner'], ['pk-staff'], ['pk-pm'], ['pk-finance'], [], ['pk-principal', 'pk-staff']]) {
      await expect(create(zero(roles)), roles.join('+')).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Peran pemohon = Owner/) })
    }
    await expect(create(zero(['pk-principal'], { acknowledge: 'required', acknowledgeRole: 'pk-owner' }))).rejects.toMatchObject({ status: 400 })
    await expect(create(zero(['pk-principal'], { docType: 'budget_addendum' }))).rejects.toMatchObject({ status: 400 })
    const ok = (await create(zero(['pk-principal']))) as { id: number }
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM approval_rules_steps WHERE _parent_id = $1', [ok.id])).rows[0].n).toBe(0)
    // later change to Staff: refused; a change needs a reason (audited, existing pattern)
    const p = await getTestPayload()
    await expect(p.update({ collection: 'approval-rules', id: ok.id, data: { requesterRoles: ['pk-staff'] } as never, user: w.users.admin as never, overrideAccess: false, depth: 0, context: { auditReason: 'uji' } })).rejects.toMatchObject({ status: 400 })
    await expect(p.update({ collection: 'approval-rules', id: ok.id, data: { name: 'EAP nol level Owner (ubah)' } as never, user: w.users.admin as never, overrideAccess: false, depth: 0 })).rejects.toMatchObject({ status: 400 })
  })

  it('DB: a zero-step rule for another role / no role is refused at commit (23514), even as raw SQL', async () => {
    const ins = (role: string | null) => `
      WITH r AS (INSERT INTO approval_rules (company_id, name, doc_type, request_type, min_amount, acknowledge, acknowledge_by, sign_diajukan, sign_dibuat, active)
                 VALUES ($1, 'EAP raw', 'expense_request', 'any', 0, 'none', 'role', 'required', 'required', false) RETURNING id)
      ${role ? `INSERT INTO approval_rules_requester_roles ("order", parent_id, value) SELECT 1, id, '${role}' FROM r` : 'SELECT id FROM r'}`
    expect((await sqlError('app', ins('pk-staff'), [drms]))?.code).toBe('23514')
    expect((await sqlError('app', ins(null), [drms]))?.code).toBe('23514')
    expect((await sqlError('app', ins('pk-owner'), [drms]))?.code).toBe('23514') // ADR 0025: no zero-step Direktur rule any more
    expect(await sqlError('app', ins('pk-principal'), [drms])).toBeNull()
    // the seeded Owner rule cannot be widened nor lose its role
    const seeded = (await sqlAs('app', 'SELECT id FROM approval_rules WHERE company_id = $1 AND name = $2', [drms, OWNER_RULE_NAME])).rows[0].id as number
    expect((await sqlError('app', "UPDATE approval_rules_requester_roles SET value = 'pk-staff' WHERE parent_id = $1", [seeded]))?.code).toBe('23514')
    expect((await sqlError('app', 'DELETE FROM approval_rules_requester_roles WHERE parent_id = $1', [seeded]))?.code).toBe('23514')
    expect((await sqlError('app', "UPDATE approval_rules SET acknowledge = 'required' WHERE id = $1", [seeded]))?.code).toBe('23514')
    // the seeded Direktur rule (Owner level) cannot lose its last level
    const dirRule = (await sqlAs('app', 'SELECT id FROM approval_rules WHERE company_id = $1 AND name = $2', [drms, DIREKTUR_RULE_NAME])).rows[0].id as number
    expect((await sqlError('app', 'DELETE FROM approval_rules_steps WHERE _parent_id = $1', [dirRule]))?.code).toBe('23514')
    // a rule WITH a level may name any requester role
    expect(await sqlError('app', "INSERT INTO approval_rules_requester_roles (\"order\", parent_id, value) SELECT 2, id, 'pk-staff' FROM approval_rules WHERE company_id = $1 AND name LIKE 'Contoh —%' AND NOT active LIMIT 1", [drms])).toBeNull()
  })

  it('DB: the exception only for the Owner\'s own request under that rule; "Disetujui" needs a decision otherwise', async () => {
    // a Staff request cannot be frozen with principal_no_approval (nor the ADR 0024 value)
    const c = await api('POST', E, w.users.staffA, draftBody(w), key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect((await sqlError('app', "UPDATE expense_requests SET status = 'pending_approval', g1_exception = 'principal_no_approval' WHERE id = $1", [c.body.id]))?.message).toContain('principal_no_approval only')
    expect((await sqlError('app', "UPDATE expense_requests SET status = 'pending_approval', g1_exception = 'direktur_no_approval' WHERE id = $1", [c.body.id]))?.message).toContain('direktur_no_approval only')
    // a Staff request waiting for the Direktur cannot jump to "Disetujui" without a decision row
    const { id } = await submitted(w.users.staffA, draftBody(w))
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())).status).toBe(200)
    expect((await sqlError('app', "UPDATE expense_requests SET status = 'approved', approved_amount = grand_total WHERE id = $1", [id]))?.message).toContain('approved without a decision')
  })
})

describe('5. LPJ shortfall of an Owner request: no approval either (audited)', () => {
  it('Finance asks → approved at once (no decision row), settle pays the shortfall', async () => {
    const { id } = await submitted(ownReq, ownerBody())
    const t = await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `EAS-${id}`, proofMediaId: await proof() }, key())
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    const lines = t.body.request.lines.map((l: { id: string }) => l.id) as string[]
    await receipt(id, lines[0]!, 600_000, ownReq)
    await receipt(id, lines[1]!, 250_000, ownReq)
    expect((await api('POST', `${E}/${id}/receipts-complete`, ownReq, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/lpj/submit`, ownReq, { usageNotes: 'Harga naik.' })).status).toBe(200)
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    for (const r of d.receipts.filter((x: { status: string }) => x.status === 'pending')) expect((await api('POST', `${E}/${id}/receipts/${r.id}/verify`, w.users.finance, {})).status).toBe(200)
    const v = await api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    const req = await api('POST', `${E}/${id}/lpj/shortfall-approval`, w.users.finance, { note: 'Harga material naik' }, key())
    expect(req.status, JSON.stringify(req.body)).toBe(200)
    expect(req.body.settlement.shortfallApproval).toMatchObject({ status: 'approved', noApproval: true, settleAllowed: true, statusLabel: 'Kekurangan tanpa persetujuan — pengajuan Owner (kebijakan PT)', decisions: [] })
    const sid = req.body.settlement.id as number
    expect(await audit('settlement', sid, 'approval_policy_exception')).toEqual([expect.objectContaining({ field: 'shortfallApproval', reason: PRINCIPAL_NO_APPROVAL_NOTE })])
    expect((await sqlAs('app', "SELECT count(*)::int AS n FROM approvals WHERE settlement_id = $1 AND doc_type = 'expense_shortfall'", [sid])).rows[0].n).toBe(0)
    const s = await api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `EAS2-${id}`, proofMediaId: await proof() })
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body).toMatchObject({ settlementType: 'shortfall', request: { status: 'completed' } })
  })
})

describe('6. Reimburse of the Owner: receipt re-approval with a new amount needs no approval either', () => {
  it('approved at submit; Revisi Nota with a changed total → "Tanpa persetujuan (Verifikasi Nota)" again, new cycle, audited twice', async () => {
    const c = await api('POST', E, ownReq, ownerBody({ type: 'reimburse', title: 'Reimburse Owner' }), key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const id = c.body.id as number
    for (const l of c.body.lines as Array<{ id: string; total: number }>) await receipt(id, l.id, l.total, ownReq)
    const s = await api('POST', `${E}/${id}/submit`, ownReq, {}, key())
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body).toMatchObject({ status: 'approved', statusLabel: 'Tanpa persetujuan (Verifikasi Nota)', approvalCycle: 1 })
    expect((await notified(id, 'expense.receipts_to_verify')).length).toBeGreaterThan(0)
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    const rj = await api('POST', `${E}/${id}/receipts/${d.receipts[1].id}/reject`, w.users.finance, { reason: 'nota buram' }, key())
    expect(rj.body.status).toBe('receipt_revision')
    const lines = d.lines.map((l: { id: string; description: string; qty: number | null; uom: { id: number } | null; unitPrice: number | null; total: number; category: { id: number } }, i: number) => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      uomId: l.uom?.id ?? null,
      unitPrice: i === 1 ? 140_000 : l.unitPrice,
      categoryId: l.category.id,
    }))
    const patched = await api('PATCH', `${E}/${id}`, ownReq, { lines })
    expect(patched.status, JSON.stringify(patched.body)).toBe(200)
    await receipt(id, d.lines[1].id, 140_000, ownReq)
    const rs = await api('POST', `${E}/${id}/receipts-resubmit`, ownReq, {})
    expect(rs.status, JSON.stringify(rs.body)).toBe(200)
    expect(rs.body).toMatchObject({ status: 'approved', approvalCycle: 2, approvedAmount: rs.body.grandTotal, approvalRule: { selfApproval: 'principal_no_approval' } })
    expect(await decisions(id)).toEqual([])
    expect((await audit('expense_request', id, 'approval_policy_exception')).length).toBe(2)
  })
})

describe('7. Addendum RAB is unchanged (Direktur → Finance)', () => {
  it('PM submits, the Direktur approves, Finance approves', async () => {
    const c = await api('POST', '/api/v1/budget-addenda', w.users.pm, { projectId: w.project, addition: 2_000_000, reason: 'Tambah pekerjaan pagar' })
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const s = await api('POST', `/api/v1/budget-addenda/${c.body.id}/submit`, w.users.pm, {})
    expect(s.body.status).toBe('pending_ack')
    expect((await api('POST', `/api/v1/budget-addenda/${c.body.id}/acknowledge`, w.users.owner, {})).status).toBe(200)
    const ok = await api('POST', `/api/v1/budget-addenda/${c.body.id}/approve`, w.users.finance, {})
    expect(ok.body.status).toBe('approved')
  })
})

describe('8. ADR 0021 snapshots (direktur_via_pm) keep working with their wording', () => {
  it('a request submitted before ADR 0024 (PM filed for the Direktur): PM approves, another Direktur approves', async () => {
    // a PM draft for himself, turned into the pre-ADR-0024 state (requester Direktur, ADR 0021 snapshot) by SQL
    const c = await api('POST', E, w.users.pm, draftBody(w, { requesterIds: [w.emp.pm], bankAccountId: accPm }), key())
    expect(c.status).toBe(201)
    const id = c.body.id as number
    const rule = (await sqlAs('app', "SELECT id, name FROM approval_rules WHERE company_id = $1 AND name LIKE 'EAP rule PM→Direktur%project%' LIMIT 1", [drms])).rows[0]
    const snap = {
      ruleId: rule.id,
      ruleName: rule.name,
      acknowledge: 'required',
      acknowledgeBy: 'scope_manager',
      acknowledgerUserId: w.users.pm.id,
      acknowledgeRole: null,
      signDiajukan: 'required',
      signDibuat: 'required',
      steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }],
      decisionRoles: ['pk-owner', 'pk-finance'],
      skipped: [],
      selfApproval: 'direktur_via_pm',
    }
    await sqlAs('app', "UPDATE expense_requests_rels SET employees_id = $1 WHERE parent_id = $2 AND path = 'requesters'", [dirEmp, id])
    await sqlAs('app', 'UPDATE expense_requests SET bank_account_id = $1 WHERE id = $2', [accDir, id])
    await sqlAs('owner', 'ALTER TABLE expense_requests DISABLE TRIGGER USER')
    try {
      await sqlAs(
        'owner',
        `UPDATE expense_requests SET status = 'pending_ack', doc_no = $2, request_date = now()::date, submitted_at = now(), approval_rule_id = $3, approval_snapshot = $4::jsonb,
           g1_exception = 'direktur_via_pm', approval_cycle = 1, current_level = 0, content_hash = pk_expense_content_hash(id) WHERE id = $1`,
        [id, `PB/EAP/LEGACY/${id}`, rule.id, JSON.stringify(snap)],
      )
    } finally {
      await sqlAs('owner', 'ALTER TABLE expense_requests ENABLE TRIGGER USER')
    }
    const d = await api('GET', `${E}/${id}`, w.users.pm)
    expect(d.body).toMatchObject({ status: 'pending_ack', statusLabel: 'Menunggu persetujuan PM', approvalRule: { selfApproval: 'direktur_via_pm' } })
    expect(d.body.allowedActions).toContain('acknowledge')
    // the requester Direktur cannot take the PM step
    expect((await api('POST', `${E}/${id}/acknowledge`, dirReq, {}, key())).status).toBe(403)
    const ack = await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect(ack.body.status).toBe('pending_approval')
    expect((await api('POST', `${E}/${id}/approve`, dirReq, {}, key())).status).toBe(403)
    const ok = await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
    expect(ok.body.statusLabel).toBe('Disetujui (Antri Transfer)')
    const pdf = await asUser(w.users.finance, (req) => buildPdfData(req, id, { internal: false, printedBy: 'test' }))
    expect(pdf.policyNote).toMatch(/^Pengajuan Direktur .{1,3} diajukan oleh PM \(kebijakan owner 2026-10-10\)$/)
  })
})

describe('9. Rule selection by "Peran pemohon" + priority', () => {
  it('a priority-5 rule for Staff requesters (Direktur only) wins for Staff; a PM still gets the world rule', async () => {
    const r = await sysCreate('approval-rules', {
      company: drms,
      name: 'EAQ Staff langsung Direktur',
      docType: 'expense_request',
      requestType: 'any',
      minAmount: 0,
      priority: 5,
      project: w2.project,
      requesterRoles: ['pk-staff'],
      acknowledge: 'none',
      acknowledgeBy: 'role',
      acknowledgeRole: null,
      steps: [{ level: 1, approverRole: 'pk-owner' }],
      active: true,
    })
    const staff = await submitted(w2.users.staffA, draftBody(w2))
    expect(staff.body).toMatchObject({ status: 'pending_approval', approvalRule: { id: r, name: 'EAQ Staff langsung Direktur', selfApproval: null } })
    const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id as number
    const acc = await sysCreate('employee-bank-accounts', { employee: w2.emp.pm, bank, accountNo: `8${Date.now() % 1e9}1`, accountHolder: 'EAQ PM', isDefault: true, verificationStatus: 'verified' })
    const pm = await submitted(w2.users.pm, draftBody(w2, { requesterIds: [w2.emp.pm], bankAccountId: acc }))
    expect(pm.body.approvalRule.name).toMatch(/^EAQ rule PM→Direktur/)
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

describe('migration 20261013_300000_d1010_approval_config_data', () => {
  it('seeds "Pengajuan Direktur" only in a PT that still has the default rules; idempotent; down removes it', async () => {
    await inRolledBackTx(async (db) => {
      const q = async (s: string) => (await db.execute(sql.raw(s))).rows
      // DRMS as a fresh PT of 2026-10-11: only the seeded default active (its ADR 0025 Owner level removed), no Direktur rule yet
      await q(`UPDATE approval_rules SET active = (name = 'Default — PM project lalu Direktur (semua nominal)') WHERE company_id = ${drms} AND doc_type = 'expense_request'`)
      await q(`DELETE FROM approval_rules_steps s USING approval_rules r WHERE s._parent_id = r.id AND r.company_id = ${drms} AND r.name = 'Default — PM project lalu Direktur (semua nominal)' AND s.approver_role::text = 'pk-principal'`)
      const mine = async () => q(`SELECT r.id, r.priority::int AS priority, r.acknowledge::text AS ack, (SELECT array_agg(value::text) FROM approval_rules_requester_roles x WHERE x.parent_id = r.id) AS roles,
                                  (SELECT count(*)::int FROM approval_rules_steps s WHERE s._parent_id = r.id) AS steps FROM approval_rules r WHERE r.company_id = ${drms} AND r.name = '${DIREKTUR_RULE}' AND r.active`)
      await dataUp({ db } as never)
      expect(await mine()).toEqual([expect.objectContaining({ priority: 10, ack: 'none', roles: ['pk-owner'], steps: 0 })])
      const id = (await mine())[0]!.id as number
      expect(await q(`SELECT action::text AS a, source::text AS s FROM audit_logs WHERE doc_type = 'approval_rule' AND doc_id = '${id}'`)).toEqual([{ a: 'create', s: 'system' }])
      // (ADR 0025: the zero-step guard of 20261013_610100 would refuse this Direktur rule at commit — the ADR 0025 data
      // migration gives it an Owner level first; covered by d1310-a-owner.int.test.ts. Rolled back here.)
      await dataUp({ db } as never) // idempotent
      expect((await mine()).length).toBe(1)
      await dataDown({ db } as never)
      expect(await mine()).toEqual([])
      // a PT whose rules the Admin changed is left alone
      await q(`UPDATE approval_rules SET max_amount = 5000000 WHERE company_id = ${drms} AND name = 'Default — PM project lalu Direktur (semua nominal)'`)
      await dataUp({ db } as never)
      expect(await mine()).toEqual([])
    })
  })
})
