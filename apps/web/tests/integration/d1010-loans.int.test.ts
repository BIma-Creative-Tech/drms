import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { addDays } from '@/domain/expense/types'
import { runDailyReminders } from '@/domain/reminders/service'
import { resetRateLimits } from '@/lib/rate-limit'

import { auditRows, companyId, getTestPayload, installLocalJwks, sqlAs, sqlError, updateCompany } from './helpers'
import { api, makeFlowUser, makeWorld, sysCreate, type FlowUser, type World } from './flow-world'

/**
 * ADR 0022 Pinjaman antar project (DRMS 10/10 point 15, owner D6 + Q-L1…Q-L7 2026-10-11): PM of the borrower
 * project submits → Direktur decides (one level, G1 incl. the `direktur_self` exception) → repayments by the borrower
 * PM / Finance (append-only, void with reason) → Lunas. Notional allocation: NO cash entry is ever created. Same PT
 * only (service 400 + DB trigger), numbering PJ/<code>/<YYMM>/####, transitions + frozen content in the DB, overdue
 * (derived) + daily reminder, report / list scope. Fictional data only.
 */
let w: World
let pmDir: FlowUser // PM of `dirProject` AND Direktur of the PT (ADR 0021 "Utamakan Direktur lain")
let thirdProject = 0 // pm = w.users.pm (PM of both sides → samePm)
let dirProject = 0
let otherPt = 0
let foreignProject = 0
let today = ''

const L = '/api/v1/project-loans'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const create = (u: FlowUser, body: Record<string, unknown>) => api('POST', L, u, body, key())
const act = (u: FlowUser, id: number, action: string, body: Record<string, unknown> = {}) => api('POST', `${L}/${id}/${action}`, u, body, key())
const cashCount = async () => Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM cash_entries')).rows[0].n)
const notified = async (id: number, event: string) => (await sqlAs('app', 'SELECT user_id::int AS u FROM notifications WHERE event = $1 AND doc_type = $2 AND doc_id = $3 ORDER BY user_id', [event, 'project_loan', String(id)])).rows.map((r) => r.u as number)
const denied = async (userId: number) => Number((await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE doc_type = 'project_loan' AND action = 'access_denied' AND user_id = $1", [String(userId)])).rows[0].n)
const body = (over: Record<string, unknown> = {}) => ({ borrowerProjectId: w.project, lenderProjectId: w.otherProject, amount: 20_000_000, reason: 'Termin klien belum cair, bayar material', dueDate: addDays(today, 30), ...over })

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

async function approved(over: Record<string, unknown> = {}): Promise<number> {
  const c = await create(w.users.pm, body({ submit: true, ...over }))
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const a = await act(w.users.owner, c.body.id, 'approve')
  expect(a.status, JSON.stringify(a.body)).toBe(200)
  return c.body.id
}

beforeAll(async () => {
  await installLocalJwks()
  w = await makeWorld('PJL')
  today = (await sqlAs('app', "SELECT to_char(now() AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD') AS d")).rows[0].d
  pmDir = await makeFlowUser(['pk-pm', 'pk-owner'], 'pjl-pmdir', null)
  thirdProject = await sysCreate('projects', { code: 'PJL-P3', name: 'PJL Gudang', pm: w.users.pm.id, budget: 30_000_000, status: 'berjalan' })
  dirProject = await sysCreate('projects', { code: 'PJL-P4', name: 'PJL Direktur', pm: pmDir.id, budget: 30_000_000, status: 'berjalan' })
  otherPt = await sysCreate('companies', { name: 'PT Uji Pinjaman', shortCode: `PJ${Date.now() % 1000}`, timezone: 'Asia/Makassar' })
  const foreignPm = await makeFlowUser(['pk-pm'], 'pjl-foreign-pm', null, { company: otherPt })
  foreignProject = await sysCreate('projects', { company: otherPt, code: 'PJL-X1', name: 'PJL Lain PT', pm: foreignPm.id, budget: 10_000_000, status: 'berjalan' })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  // every other test file assumes the single-company default (same as mc-isolation)
  if (otherPt) await p.update({ collection: 'companies', id: otherPt, data: { active: false, changeReason: 'uji pinjaman selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
})

describe('create + submit (D6: PM of the borrower project)', () => {
  let id = 0

  it('validation (amount, reason, dates, lender ≠ borrower), only the borrower PM creates, same PT only', async () => {
    expect((await create(w.users.pm, body({ amount: 0 }))).status).toBe(400)
    expect((await create(w.users.pm, body({ amount: 1.5 }))).status).toBe(400)
    expect((await create(w.users.pm, body({ reason: 'x' }))).status).toBe(400)
    expect((await create(w.users.pm, body({ dueDate: undefined }))).status).toBe(400)
    const early = await create(w.users.pm, body({ loanDate: today, dueDate: addDays(today, -1) }))
    expect(early.status).toBe(400)
    expect(early.body.errors?.[0]?.path).toBe('dueDate')
    expect((await create(w.users.pm, body({ loanDate: addDays(today, 1) }))).status).toBe(400)
    const same = await create(w.users.pm, body({ lenderProjectId: w.project }))
    expect(same.status).toBe(400)
    expect(same.body.errors?.[0]?.path).toBe('lenderProjectId')
    // another PT → 400 COMPANY_MISMATCH ("Project pemberi dan peminjam harus di PT yang sama.")
    const cross = await create(w.users.pm, body({ lenderProjectId: foreignProject }))
    expect(cross.status).toBe(400)
    expect(JSON.stringify(cross.body)).toContain('PT yang sama')
    // the lender's PM is not the borrower PM → 403 + access_denied; office roles do not create (D6)
    const before = await denied(w.users.otherPm.id)
    expect((await create(w.users.otherPm, body())).status).toBe(403)
    expect(await denied(w.users.otherPm.id)).toBe(before + 1)
    for (const u of [w.users.staffA, w.users.finance, w.users.owner, w.users.admin]) expect((await create(u, body())).status, u.email).toBe(403)
    // HTTP collection writes are closed
    expect((await api('POST', '/api/project-loans', w.users.pm, { borrowerProject: w.project, lenderProject: w.otherProject, amount: 1, reason: 'abc', loanDate: today, dueDate: today, createdBy: w.users.pm.id })).status).toBe(403)

    const ok = await create(w.users.pm, body({ kind: 'barang' }))
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    expect(ok.body).toMatchObject({ status: 'draft', docNo: null, kind: 'barang', kindLabel: 'Barang/material', amount: 20_000_000, outstanding: 20_000_000, loanDate: today, allowedActions: expect.arrayContaining(['edit', 'submit', 'cancel']) })
    id = ok.body.id
  })

  it('draft edit; submit → number PJ/<code>/<YYMM>/####, Direktur pool notified, lender PM notified; content frozen', async () => {
    const e = await api('PATCH', `${L}/${id}`, w.users.pm, { amount: 25_000_000 }, key())
    expect(e.status, JSON.stringify(e.body)).toBe(200)
    expect(e.body.amount).toBe(25_000_000)
    expect((await api('PATCH', `${L}/${id}`, w.users.otherPm, { amount: 1 }, key())).status).toBe(403) // lender PM reads, never edits
    const s = await act(w.users.pm, id, 'submit')
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body.status).toBe('pending_approval')
    expect(s.body.statusLabel).toBe('Menunggu persetujuan Direktur')
    expect(s.body.docNo).toMatch(new RegExp(`^PJ/[A-Z0-9]{2,16}/${today.slice(2, 4)}${today.slice(5, 7)}/\\d{4}$`))
    expect(s.body.samePm).toBe(false)
    expect(s.body.g1Exception).toBeNull()
    const pend = await notified(id, 'project_loan.pending')
    expect(pend).toEqual(expect.arrayContaining([w.users.owner.id, w.users.owner2.id]))
    expect(pend).not.toContain(w.users.pm.id)
    expect(await notified(id, 'project_loan.submitted')).toEqual([w.users.otherPm.id])
    expect((await api('PATCH', `${L}/${id}`, w.users.pm, { amount: 1 }, key())).status).toBe(409)
    expect((await sqlError('app', `UPDATE project_loans SET amount = 1 WHERE id = ${id}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE project_loans SET status = 'repaid' WHERE id = ${id}`))?.code).toMatch(/42501|23514/)
    const audit = (await auditRows('project_loan', id)).map((r) => r.action)
    expect(audit).toEqual(expect.arrayContaining(['create', 'update', 'number_issued', 'status_change']))
  })

  it('decisions: PM / Finance / lender PM 403 (+ access_denied), Staff 404, reject needs a reason; Direktur approves; NO cash entry', async () => {
    const before = await denied(w.users.pm.id)
    expect((await act(w.users.pm, id, 'approve')).status).toBe(403)
    expect(await denied(w.users.pm.id)).toBeGreaterThan(before)
    expect((await act(w.users.finance, id, 'approve')).status).toBe(403)
    expect((await act(w.users.otherPm, id, 'approve')).status).toBe(403)
    expect((await act(w.users.staffA, id, 'approve')).status).toBe(404)
    expect((await act(w.users.owner, id, 'reject', {})).status).toBe(400)
    const inbox = await api('GET', `${L}/inbox`, w.users.owner)
    expect(inbox.body.items.map((i: { id: number }) => i.id)).toContain(id)
    expect((await api('GET', `${L}/inbox`, w.users.pm)).body.items).toEqual([])
    const cash = await cashCount()
    const a = await act(w.users.owner, id, 'approve')
    expect(a.status, JSON.stringify(a.body)).toBe(200)
    expect(a.body).toMatchObject({ status: 'approved', outstanding: 25_000_000, repaidTotal: 0, decidedBy: { id: w.users.owner.id } })
    expect(a.body.decisions).toEqual([expect.objectContaining({ decision: 'approved', actor: expect.objectContaining({ id: w.users.owner.id }) })])
    expect(await cashCount()).toBe(cash)
    expect((await act(w.users.owner2, id, 'approve')).status).toBe(409)
    expect(await notified(id, 'project_loan.approved')).toEqual([w.users.pm.id, w.users.otherPm.id].sort((x, y) => x - y))
    const rows = await sqlAs('app', "SELECT doc_type::text AS t, position::text AS p, level::int AS level, actor_id FROM approvals WHERE loan_id = $1", [id])
    expect(rows.rows).toEqual([{ t: 'project_loan', p: 'approval', level: 1, actor_id: w.users.owner.id }])
    expect((await auditRows('project_loan', id)).map((r) => r.action)).toContain('approve')
  })

  it('repayments: borrower PM / Finance, ≤ outstanding, append-only, void moves the status back; still no cash entry', async () => {
    const cash = await cashCount()
    expect((await act(w.users.staffA, id, 'repayments', { amount: 1_000_000 })).status).toBe(404)
    expect((await act(w.users.otherPm, id, 'repayments', { amount: 1_000_000 })).status).toBe(403)
    expect((await act(w.users.owner, id, 'repayments', { amount: 1_000_000 })).status).toBe(403)
    const over = await act(w.users.finance, id, 'repayments', { amount: 25_000_001 })
    expect(over.status).toBe(400)
    expect(over.body.errors?.[0]?.path).toBe('amount')
    expect((await act(w.users.finance, id, 'repayments', { amount: 1_000_000, repayDate: addDays(today, 1) })).status).toBe(400)
    const r1 = await act(w.users.finance, id, 'repayments', { amount: 10_000_000, note: 'Termin 1 cair' })
    expect(r1.status, JSON.stringify(r1.body)).toBe(201)
    expect(r1.body).toMatchObject({ status: 'partially_repaid', statusLabel: 'Sebagian kembali', repaidTotal: 10_000_000, outstanding: 15_000_000 })
    expect(await notified(id, 'project_loan.repaid')).toEqual(expect.arrayContaining([w.users.owner.id, w.users.otherPm.id]))
    const r2 = await act(w.users.pm, id, 'repayments', { amount: 15_000_000 })
    expect(r2.status, JSON.stringify(r2.body)).toBe(201)
    expect(r2.body).toMatchObject({ status: 'repaid', statusLabel: 'Lunas', outstanding: 0 })
    expect(r2.body.repayments.map((x: { seq: number }) => x.seq)).toEqual([1, 2])
    expect(r2.body.allowedActions).not.toContain('repay')
    expect((await act(w.users.pm, id, 'repayments', { amount: 1 })).status).toBe(409)
    const rid = r2.body.repayments[0].id
    // void: Direktur / Finance only, reason required
    expect((await act(w.users.pm, id, `repayments/${rid}/void`, { reason: 'salah catat' })).status).toBe(403)
    expect((await act(w.users.finance, id, `repayments/${rid}/void`, {})).status).toBe(400)
    const v = await act(w.users.finance, id, `repayments/${rid}/void`, { reason: 'Salah catat nominal' })
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(v.body).toMatchObject({ status: 'partially_repaid', repaidTotal: 15_000_000, outstanding: 10_000_000 })
    expect(v.body.repayments[0]).toMatchObject({ status: 'void', seq: null, voidReason: 'Salah catat nominal' })
    expect((await act(w.users.owner, id, `repayments/${rid}/void`, { reason: 'lagi' })).status).toBe(409)
    expect(await cashCount()).toBe(cash)
    // append-only in the DB; repaid_total must equal the posted repayments
    expect((await sqlError('app', `DELETE FROM project_loan_repayments WHERE id = ${rid}`))?.code).toMatch(/42501/)
    expect((await sqlError('app', `UPDATE project_loan_repayments SET amount = 1 WHERE id = ${r2.body.repayments[1].id}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE project_loan_repayments SET status = 'posted', void_reason = NULL, voided_by_id = NULL, voided_at = NULL WHERE id = ${rid}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE project_loans SET repaid_total = 25000000, outstanding = 0, status = 'repaid' WHERE id = ${id}`))?.code).toBe('23514')
    expect((await sqlError('app', `DELETE FROM project_loans WHERE id = ${id}`))?.code).toMatch(/42501/)
    const audit = await auditRows('project_loan_repayment', rid)
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(['create', 'void']))
    expect(audit.find((r) => r.action === 'void')?.reason).toBe('Salah catat nominal')
  })

  it('concurrent repayments never exceed the outstanding (row lock)', async () => {
    const loan = await approved({ amount: 10_000_000 })
    const [a, b] = await Promise.all([act(w.users.finance, loan, 'repayments', { amount: 6_000_000 }), act(w.users.pm, loan, 'repayments', { amount: 6_000_000 })])
    expect([a.status, b.status].sort()).toEqual([201, 400])
    const s = await sqlAs('app', 'SELECT repaid_total::int AS r, status::text AS s FROM project_loans WHERE id = $1', [loan])
    expect(s.rows[0]).toEqual({ r: 6_000_000, s: 'partially_repaid' })
  })
})

describe('reject / cancel', () => {
  it('reject with reason → Ditolak (final), creator + lender PM notified', async () => {
    const c = await create(w.users.pm, body({ submit: true }))
    const r = await act(w.users.owner2, c.body.id, 'reject', { reason: 'Dana project pemberi dibutuhkan bulan ini' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ status: 'rejected', rejectReason: 'Dana project pemberi dibutuhkan bulan ini', outstanding: 0 })
    expect(await notified(c.body.id, 'project_loan.rejected')).toEqual([w.users.pm.id, w.users.otherPm.id].sort((x, y) => x - y))
    expect((await sqlError('app', `UPDATE project_loans SET reject_reason = 'x' WHERE id = ${c.body.id}`))?.code).toBe('42501')
    expect((await act(w.users.pm, c.body.id, 'cancel', { reason: 'batal' })).status).toBe(409)
  })

  it('creator cancels Draft / Menunggu; Direktur cancels an approved loan only without repayment', async () => {
    const d = await create(w.users.pm, body())
    expect((await act(w.users.owner, d.body.id, 'cancel', { reason: 'bukan saya' })).status).toBe(409) // a Direktur cancels approved loans only
    expect((await act(w.users.pm, d.body.id, 'cancel', { reason: 'Tidak jadi' })).body.status).toBe('cancelled')
    const p = await create(w.users.pm, body({ submit: true }))
    expect((await act(w.users.pm, p.body.id, 'cancel', { reason: 'Termin sudah cair' })).body.status).toBe('cancelled')
    const a = await approved()
    expect((await act(w.users.pm, a, 'cancel', { reason: 'x y z' })).status).toBe(409) // after the decision only a Direktur cancels
    const ok = await act(w.users.owner, a, 'cancel', { reason: 'Diselesaikan di luar sistem' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body).toMatchObject({ status: 'cancelled', outstanding: 0 })
    const b = await approved()
    expect((await act(w.users.finance, b, 'repayments', { amount: 1_000_000 })).status).toBe(201)
    expect((await act(w.users.owner, b, 'cancel', { reason: 'Diselesaikan di luar sistem' })).status).toBe(409)
  })
})

describe('G1 (ADR 0021 "Utamakan Direktur lain") + PM of both projects', () => {
  it('PM who is also a Direktur: another Direktur decides, the creator is refused (service 403 + DB)', async () => {
    const c = await create(pmDir, body({ borrowerProjectId: dirProject, lenderProjectId: w.project, submit: true }))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect(c.body.g1Exception).toBeNull()
    expect(await notified(c.body.id, 'project_loan.pending')).not.toContain(pmDir.id)
    expect((await api('GET', `${L}/inbox`, pmDir)).body.items.map((i: { id: number }) => i.id)).not.toContain(c.body.id)
    expect((await act(pmDir, c.body.id, 'approve')).status).toBe(403)
    const ins = await sqlError('app', "INSERT INTO approvals (doc_type, loan_id, cycle, position, level, actor_id, decision, company_id) VALUES ('project_loan', $1, 1, 'approval', 1, $2, 'approved', $3)", [c.body.id, pmDir.id, await companyId()])
    expect(ins?.message).toContain('loan creator cannot hold a decision position')
    expect((await act(w.users.owner, c.body.id, 'approve')).status).toBe(200)
  })

  it('the PT\'s ONLY Direktur approves his own loan: direktur_self recorded (column, audit, note)', async () => {
    const c = await onlyActive('pk-owner', [pmDir.id], () => create(pmDir, body({ borrowerProjectId: dirProject, lenderProjectId: w.project, submit: true })))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect(c.body.g1Exception).toBe('direktur_self')
    const ex = (await auditRows('project_loan', c.body.id)).filter((r) => r.action === 'approval_policy_exception')
    expect(ex).toEqual([expect.objectContaining({ reason: expect.stringMatching(/satu-satunya Direktur PT/) })])
    const a = await act(pmDir, c.body.id, 'approve')
    expect(a.status, JSON.stringify(a.body)).toBe(200)
    expect(a.body.g1Note).toBe('Disetujui Direktur pembuat karena satu-satunya Direktur PT')
    expect((await sqlError('app', `UPDATE project_loans SET g1_exception = NULL WHERE id = ${c.body.id}`))?.code).toBe('42501')
  })

  it('no active Direktur → 409 NO_DIREKTUR at submit', async () => {
    const d = await create(w.users.pm, body())
    const s = await onlyActive('pk-owner', [], () => act(w.users.pm, d.body.id, 'submit'))
    expect(s.status).toBe(409)
    expect(s.body.code ?? JSON.stringify(s.body)).toMatch(/NO_DIREKTUR|Direktur/)
  })

  it('PM of both projects: allowed, marked "PM peminjam = PM pemberi"', async () => {
    const c = await create(w.users.pm, body({ lenderProjectId: thirdProject, submit: true }))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect(c.body).toMatchObject({ samePm: true, samePmNote: 'PM peminjam = PM pemberi' })
    expect(await notified(c.body.id, 'project_loan.submitted')).toEqual([])
  })
})

describe('numbering, overdue, reminder, list, report', () => {
  it('number per loan month (monthly reset) and increasing within the month', async () => {
    const prev = addDays(`${today.slice(0, 7)}-01`, -1)
    const a = await create(w.users.pm, body({ loanDate: prev, dueDate: addDays(today, 10), submit: true }))
    expect(a.status, JSON.stringify(a.body)).toBe(201)
    expect(a.body.docNo).toMatch(new RegExp(`/${prev.slice(2, 4)}${prev.slice(5, 7)}/0001$`))
    const b = await create(w.users.pm, body({ loanDate: prev, dueDate: addDays(today, 10), submit: true }))
    expect(b.body.docNo).toMatch(new RegExp(`/${prev.slice(2, 4)}${prev.slice(5, 7)}/0002$`))
    expect(await sqlError('app', `UPDATE project_loans SET doc_no = 'PJ/X/0000/0001' WHERE id = ${a.body.id}`)).not.toBeNull()
  })

  it('overdue is derived (Terlambat + days); daily reminder to the borrower PM + Direktur, once per day, switchable per PT', async () => {
    const loan = await approved({ loanDate: addDays(today, -40), dueDate: addDays(today, -10) })
    const d = await api('GET', `${L}/${loan}`, w.users.pm)
    expect(d.body).toMatchObject({ overdue: true, overdueLabel: 'Terlambat', daysOverdue: 10 })
    const list = await api('GET', `${L}?overdue=1&limit=100`, w.users.owner)
    expect(list.body.items.map((i: { id: number }) => i.id)).toContain(loan)
    const company = await companyId()
    await updateCompany({ reminderLoanOverdueEnabled: false })
    await runDailyReminders(await getTestPayload(), { force: true, companyId: company })
    expect(await notified(loan, 'project_loan.overdue')).toEqual([])
    await updateCompany({ reminderLoanOverdueEnabled: true })
    await runDailyReminders(await getTestPayload(), { force: true, companyId: company })
    await runDailyReminders(await getTestPayload(), { force: true, companyId: company })
    const to = await notified(loan, 'project_loan.overdue')
    expect(to).toEqual(expect.arrayContaining([w.users.pm.id, w.users.owner.id, w.users.owner2.id]))
    expect(new Set(to).size).toBe(to.length) // once per recipient per day
    expect(to).not.toContain(w.users.otherPm.id)
  })

  it('list: D8 pages + filters; Staff sees nothing; lender PM sees the loans of his project', async () => {
    const page = await api('GET', `${L}?project=${w.project}&role=borrower&page=1&limit=2`, w.users.owner)
    expect(page.status).toBe(200)
    expect(page.body).toMatchObject({ page: 1, limit: 2 })
    expect(page.body.items).toHaveLength(2)
    expect(page.body.totalDocs).toBeGreaterThan(2)
    expect(page.body.totalPages).toBe(Math.ceil(page.body.totalDocs / 2))
    expect((await api('GET', `${L}?q=PJ%2F&limit=5`, w.users.owner)).body.items.every((i: { docNo: string }) => i.docNo?.startsWith('PJ/'))).toBe(true)
    expect((await api('GET', L, w.users.staffA)).body).toMatchObject({ items: [], totalDocs: 0 })
    // PT isolation (ADR 0016): Finance of another PT sees none of these loans, nor their detail
    const foreignFinance = await makeFlowUser(['pk-finance'], 'pjl-fin-other', null, { company: otherPt })
    expect((await api('GET', L, foreignFinance)).body).toMatchObject({ items: [], totalDocs: 0 })
    expect((await api('GET', `${L}/${page.body.items[0].id}`, foreignFinance)).status).toBe(404)
    const rep = await api('GET', '/api/v1/reports/pinjaman-antar-project', foreignFinance)
    expect(rep.status).toBe(200)
    expect(rep.body.main.rows).toEqual([])
    const lender = await api('GET', `${L}?limit=100`, w.users.otherPm)
    expect(lender.body.items.length).toBeGreaterThan(0)
    expect(lender.body.items.every((i: { lenderProject: { id: number }; borrowerProject: { id: number } }) => i.lenderProject.id === w.otherProject || i.borrowerProject.id === w.otherProject)).toBe(true)
  })

  it('report "pinjaman-antar-project": office all, PM team, Staff 403; per-project figures reconcile with the loans', async () => {
    const r = await api('GET', `/api/v1/reports/pinjaman-antar-project?project=${w.otherProject}`, w.users.finance)
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200)
    const outstanding = Number(
      (await sqlAs('app', "SELECT coalesce(sum(amount - repaid_total), 0)::bigint AS s FROM project_loans WHERE lender_project_id = $1 AND status::text IN ('approved','partially_repaid','repaid')", [w.otherProject])).rows[0].s,
    )
    const fig = r.body.extra.find((t: { key: string }) => t.key === 'per-project').rows.find((x: { project: string }) => x.project.startsWith('PJL-P2'))
    expect(fig.sisaDiberikan).toBe(outstanding)
    expect((await api('GET', '/api/v1/reports/pinjaman-antar-project', w.users.staffA)).status).toBe(403)
    const pm = await api('GET', '/api/v1/reports/pinjaman-antar-project', pmDir)
    expect(pm.status).toBe(200)
    expect(pm.body.main.rows.length).toBeGreaterThan(0)
    const csv = await api('GET', '/api/v1/reports/pinjaman-antar-project/csv', w.users.owner)
    expect(csv.status).toBe(200)
    expect(String(csv.body)).toContain('Sisa (Rp)')
  })
})
