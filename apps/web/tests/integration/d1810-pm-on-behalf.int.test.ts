import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { PM_ON_BEHALF_MESSAGE } from '@/domain/expense/on-behalf'
import { STAFF_SELF_ONLY_MESSAGE } from '@/domain/expense/drafts'
import { resetRateLimits } from '@/lib/rate-limit'

import { getTestPayload, sqlAs } from './helpers'
import { api, draftBody, makeFlowUser, makeWorld, sysCreate, type World } from './flow-world'

/**
 * D1810 (owner decision 2026-10-18, option A): the PM of a project files a request ON BEHALF of the employees assigned
 * to that project, so the transfer goes to the requester's account (not the creator's). The PM picks their accounts
 * (number masked); the submit snapshot = the transfer destination keeps the full number. Not for a non-member, a
 * member of another project, a Direktur, or a cost-center request; Staff stay self-only (QA-15).
 */
let w: World
let dirEmp: number
let accDir: number
let outsider: number
let accOutsider: number
let accPmOwn: number
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const masked = (no: string) => `••••${no.slice(-4)}`

async function accountNo(id: number): Promise<string> {
  return (await sqlAs('app', 'SELECT account_no FROM employee_bank_accounts WHERE id = $1', [id])).rows[0].account_no as string
}

beforeAll(async () => {
  w = await makeWorld('POB', { rule: 'pm_direktur' })
  const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id as number
  accPmOwn = await sysCreate('employee-bank-accounts', { employee: w.emp.pm, bank, accountNo: `7${Date.now() % 1e9}1`, accountHolder: 'POB PM', isDefault: true, verificationStatus: 'verified' })
  // a Direktur assigned to the project anyway (ADR 0024: still files his own request)
  dirEmp = await sysCreate('employees', { code: `POB-DIR-${randomUUID().slice(0, 4)}`, name: 'POB Direktur' })
  await makeFlowUser(['pk-owner'], 'pob-dir', dirEmp)
  await sysCreate('team-assignments', { employee: dirEmp, project: w.project, roleInProject: 'staff' })
  accDir = await sysCreate('employee-bank-accounts', { employee: dirEmp, bank, accountNo: `7${Date.now() % 1e9}2`, accountHolder: 'POB Direktur', isDefault: true, verificationStatus: 'verified' })
  // an employee of the other project only (its PM is someone else)
  outsider = await sysCreate('employees', { code: `POB-OUT-${randomUUID().slice(0, 4)}`, name: 'POB Luar' })
  await sysCreate('team-assignments', { employee: outsider, project: w.otherProject, roleInProject: 'staff' })
  accOutsider = await sysCreate('employee-bank-accounts', { employee: outsider, bank, accountNo: `7${Date.now() % 1e9}3`, accountHolder: 'POB Luar', isDefault: true, verificationStatus: 'verified' })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('1. The PM files for a member of his project', () => {
  it('Diajukan Oleh = Staff A only, Rekening tujuan = Staff A → 201; the submit snapshot (transfer destination) is Staff A\'s full number', async () => {
    const c = await api('POST', E, w.users.pm, draftBody(w, { requesterIds: [w.emp.a], bankAccountId: w.accA }), key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const s = await api('POST', `${E}/${c.body.id}/submit`, w.users.pm, {}, key())
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    const row = (await sqlAs('app', 'SELECT bank_snapshot_account_no AS no, created_by_id AS by FROM expense_requests WHERE id = $1', [c.body.id])).rows[0]
    expect(row.no).toBe(await accountNo(w.accA))
    expect(row.by).toBe(w.users.pm.id) // "Dibuat Oleh" stays the PM
    // the PM (creator, no requester) sees the number masked; the requester and Finance in full
    const asPm = await api('GET', `${E}/${c.body.id}`, w.users.pm)
    expect(asPm.body.bank.accountNo).toBe(masked(await accountNo(w.accA)))
    expect((await api('GET', `${E}/${c.body.id}`, w.users.staffA)).body.bank.accountNo).toBe(await accountNo(w.accA))
    expect((await api('GET', `${E}/${c.body.id}`, w.users.finance)).body.bank.accountNo).toBe(await accountNo(w.accA))
  })

  it('an empty Rekening tujuan takes the default account of the first requester (Staff B), not the PM\'s', async () => {
    const c = await api('POST', E, w.users.pm, draftBody(w, { requesterIds: [w.emp.b, w.emp.pm], bankAccountId: null }), key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect(c.body.bankAccountId).toBe(w.accB)
  })

  it('the PM may still not pick an account of no requester (G9)', async () => {
    const c = await api('POST', E, w.users.pm, draftBody(w, { requesterIds: [w.emp.a], bankAccountId: accPmOwn }), key())
    expect(c.status).toBe(400)
    expect(JSON.stringify(c.body)).toContain('Rekening harus milik salah satu pemohon.')
  })
})

describe('2. Limits of the PM rule', () => {
  it('an employee of another project → 403 with the PM message', async () => {
    const c = await api('POST', E, w.users.pm, draftBody(w, { requesterIds: [outsider], bankAccountId: accOutsider }), key())
    expect(c.status).toBe(403)
    expect(JSON.stringify(c.body)).toContain(PM_ON_BEHALF_MESSAGE)
  })

  it('a member of the project, but the request is on a project the PM does not lead → 403', async () => {
    await sysCreate('team-assignments', { employee: w.emp.a, project: w.otherProject, roleInProject: 'staff' })
    const c = await api('POST', E, w.users.pm, draftBody(w, { projectId: w.otherProject, requesterIds: [w.emp.a], bankAccountId: w.accA }), key())
    expect(c.status).toBe(403)
  })

  it('a Direktur assigned to the project → 403 (ADR 0024: he files his own request)', async () => {
    const c = await api('POST', E, w.users.pm, draftBody(w, { requesterIds: [dirEmp], bankAccountId: accDir }), key())
    expect(c.status).toBe(403)
    expect(JSON.stringify(c.body)).toContain(PM_ON_BEHALF_MESSAGE)
  })

  it('an ended assignment no longer counts (also at submit)', async () => {
    const c = await api('POST', E, w.users.pm, draftBody(w, { requesterIds: [w.emp.b], bankAccountId: w.accB }), key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    await sqlAs('owner', "UPDATE team_assignments SET end_date = now() - interval '3 days' WHERE employee_id = $1 AND project_id = $2", [w.emp.b, w.project])
    try {
      const s = await api('POST', `${E}/${c.body.id}/submit`, w.users.pm, {}, key())
      expect(s.status).toBe(403)
      expect((await sqlAs('app', 'SELECT status::text AS s FROM expense_requests WHERE id = $1', [c.body.id])).rows[0].s).toBe('draft')
    } finally {
      await sqlAs('owner', 'UPDATE team_assignments SET end_date = NULL WHERE employee_id = $1 AND project_id = $2', [w.emp.b, w.project])
    }
  })

  it('a Staff stays self-only (QA-15)', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { requesterIds: [w.emp.b], bankAccountId: w.accB }), key())
    expect(c.status).toBe(403)
    expect(JSON.stringify(c.body)).toContain(STAFF_SELF_ONLY_MESSAGE.slice(0, 40))
  })
})

describe('3. Accounts the PM reads: his team\'s, masked', () => {
  it('collection read (web picker) and masters (APK): Staff A/B masked, own account in full, outsider absent', async () => {
    const p = await getTestPayload()
    const res = await p.find({ collection: 'employee-bank-accounts', depth: 0, limit: 500, user: w.users.pm as never, overrideAccess: false })
    const byId = new Map((res.docs as Array<{ id: number; accountNo: string }>).map((d) => [d.id, d.accountNo]))
    expect(byId.get(w.accA)).toBe(masked(await accountNo(w.accA)))
    expect(byId.get(w.accB)).toBe(masked(await accountNo(w.accB)))
    expect(byId.get(accPmOwn)).toBe(await accountNo(accPmOwn))
    expect(byId.has(accOutsider)).toBe(false)
    const m = await api('GET', '/api/v1/masters?types=bank-accounts', w.users.pm)
    const items = m.body.types['bank-accounts'].items as Array<{ id: number; accountNo: string }>
    expect(items.find((i) => i.id === w.accA)?.accountNo).toBe(masked(await accountNo(w.accA)))
    expect(items.some((i) => i.id === accOutsider)).toBe(false)
  })

  it('a system read keeps the full number; Finance reads it in full; a Staff still reads only his own', async () => {
    const p = await getTestPayload()
    expect(((await p.findByID({ collection: 'employee-bank-accounts', id: w.accA, depth: 0 })) as { accountNo: string }).accountNo).toBe(await accountNo(w.accA))
    const fin = await p.findByID({ collection: 'employee-bank-accounts', id: w.accA, depth: 0, user: w.users.finance as never, overrideAccess: false })
    expect((fin as { accountNo: string }).accountNo).toBe(await accountNo(w.accA))
    const staff = await p.find({ collection: 'employee-bank-accounts', depth: 0, limit: 500, user: w.users.staffA as never, overrideAccess: false })
    expect(staff.docs.map((d) => d.id)).not.toContain(w.accB)
  })

  it('preview of a team account on a new form: masked, no reveal', async () => {
    const r = await api('GET', `/api/v1/bank-account-preview?account=${w.accA}&reveal=1`, w.users.pm)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ accountNoMasked: masked(await accountNo(w.accA)), canReveal: false })
    expect(r.body.accountNo).toBeUndefined()
  })
})
