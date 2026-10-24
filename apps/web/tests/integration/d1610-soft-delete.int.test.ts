import { randomUUID } from 'node:crypto'

import type { SanitizedCollectionConfig } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { loadPkList } from '@/admin/pk-list/data'
import { addDays } from '@/domain/expense/types'
import { rows } from '@/domain/reports/kpi'
import { officeScope, projectScopeSql, requestScopeSql } from '@/domain/reports/scope'
import { SOFT_DELETE_ENTRIES } from '@/domain/soft-delete/registry'
import { rowStates } from '@/domain/soft-delete/service'
import { resetRateLimits } from '@/lib/rate-limit'
import { sql } from '@payloadcms/db-postgres'

import { auditRows, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, asUser, draftBody, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * D1610 (ADR 0030, owner 2026-10-16): "Hapus" per row = SOFT delete (isDeleted + who / when / reason, audit) of rows
 * nothing references yet; deleted rows hidden from lists / pickers / REST / v1 / masters / reports (labels of old
 * documents kept); Admin "Tampilkan yang dihapus" + "Pulihkan"; used rows → Nonaktifkan (master) / Batalkan (request)
 * / "Batalkan proyek" (status dibatalkan + cascade in ONE transaction, refused while money moved). Fictional data only.
 */
let w: World
let ptAdmin: FlowUser // Admin of the PT, not a group admin
let today = ''
const R = '/api/v1/records'
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const del = (u: FlowUser, collection: string, id: number, reason = 'Salah input, data ganda') => api('POST', `${R}/${collection}/${id}/delete`, u, { reason }, key())
const restore = (u: FlowUser, collection: string, id: number, reason = 'Ternyata masih dipakai') => api('POST', `${R}/${collection}/${id}/restore`, u, { reason }, key())
const check = (u: FlowUser, collection: string, id: number) => api('GET', `${R}/${collection}/${id}/delete-check`, u)
const flag = async (table: string, id: number) => (await sqlAs('app', `SELECT is_deleted, deleted_at, deleted_by_id, delete_reason FROM ${table} WHERE id = $1`, [id])).rows[0] as { is_deleted: boolean | null; deleted_at: Date | null; deleted_by_id: number | null; delete_reason: string | null }
const status = async (table: string, id: number) => (await sqlAs('app', `SELECT status::text AS s, cancel_reason AS r FROM ${table} WHERE id = $1`, [id])).rows[0] as { s: string; r: string | null }
const collectionConfig = async (slug: string) => ((await getTestPayload()).collections as unknown as Record<string, { config: SanitizedCollectionConfig }>)[slug]!.config

beforeAll(async () => {
  w = await makeWorld('SD')
  ptAdmin = await makeFlowUser(['pk-admin'], 'sd-ptadmin', null, { groupAdmin: false })
  await makeFlowUser(['pk-principal'], 'sd-principal', null) // 2026-10-24: a loan submit needs an Owner (level 2)
  today = (await sqlAs('app', "SELECT to_char(now() AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD') AS d")).rows[0].d
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('schema', () => {
  it('every registry table has the columns (app role can read them) and the reason CHECK', async () => {
    for (const e of SOFT_DELETE_ENTRIES) {
      const r = await sqlAs('app', `SELECT count(*)::int AS n FROM ${e.table} WHERE is_deleted IS TRUE AND deleted_at IS NULL`)
      expect(r.rows[0].n, e.table).toBe(0)
    }
    const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id as number
    // a deleted row without time / reason is refused by the DB (only the service writes the flag)
    expect((await sqlError('app', 'UPDATE banks SET is_deleted = true WHERE id = $1', [bank]))?.code).toBe('23514')
    expect((await sqlError('app', "UPDATE projects SET status = 'dibatalkan' WHERE id = $1", [w.otherProject]))?.code).toBe('23514')
  })
})

describe('master: Hapus of an unused row, hidden everywhere, Pulihkan', () => {
  let vendor = 0
  let account = 0
  const name = `SD Vendor Kosong ${Date.now()}`

  beforeAll(async () => {
    vendor = await sysCreate('vendors', { name })
    const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id as number
    account = await sysCreate('vendor-bank-accounts', { vendor, bank, accountNo: `7${Date.now() % 1e9}`, accountHolder: name, isDefault: true })
  })

  it('delete-check: unused (its own bank account does not count) → Hapus for whoever may update it', async () => {
    const c = await check(w.users.admin, 'vendors', vendor)
    expect(c.status, JSON.stringify(c.body)).toBe(200)
    expect(c.body).toMatchObject({ action: 'hapus', canDelete: true, deleted: false, usage: [] })
    // PM reads vendors but may not update them
    const pm = await check(w.users.pm, 'vendors', vendor)
    expect(pm.body).toMatchObject({ action: null, canDelete: false })
    // owner 2026-10-16: Staff read vendors (vendor-payment picker) — read only, like the PM
    const staff = await check(w.users.staffA, 'vendors', vendor)
    expect(staff.status, JSON.stringify(staff.body)).toBe(200)
    expect(staff.body).toMatchObject({ action: null, canDelete: false })
    expect((await check(w.users.admin, 'cash-entries', 1)).status).toBe(404) // not a soft-delete collection
  })

  it('reason required; PM 403; Admin deletes → flag, who / when / reason, audit; the owned bank account goes with it', async () => {
    expect((await del(w.users.admin, 'vendors', vendor, 'ok')).status).toBe(400)
    expect((await del(w.users.pm, 'vendors', vendor)).status).toBe(403)
    const r = await del(w.users.admin, 'vendors', vendor)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ deleted: true, canRestore: true, action: 'pulihkan' })
    const f = await flag('vendors', vendor)
    expect(f.is_deleted).toBe(true)
    expect(f.deleted_at).not.toBeNull()
    expect(Number(f.deleted_by_id)).toBe(w.users.admin.id)
    expect(f.delete_reason).toBe('Salah input, data ganda')
    expect((await flag('vendor_bank_accounts', account)).is_deleted).toBe(true)
    const a = (await auditRows('vendor', vendor)).filter((x) => x.action === 'soft_delete')
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ field: 'isDeleted', reason: 'Salah input, data ganda' })
    expect(Number(a[0]!.user_id)).toBe(w.users.admin.id)
    expect((await auditRows('vendor_bank_account', account)).some((x) => x.action === 'soft_delete')).toBe(true)
    expect((await del(w.users.admin, 'vendors', vendor)).status).toBe(409) // already deleted
  })

  it('hidden from REST lists, pickers, v1 masters, joins and PkListView — but found by id (labels of old documents)', async () => {
    const list = await api('GET', `/api/vendors?depth=0&limit=50&where[name][equals]=${encodeURIComponent(name)}`, w.users.admin)
    expect(list.status).toBe(200)
    expect(list.body.docs).toHaveLength(0)
    // a non-Admin asking for deleted rows explicitly gets nothing; an Admin gets them
    expect((await api('GET', `/api/vendors?depth=0&where[isDeleted][equals]=true&where[name][equals]=${encodeURIComponent(name)}`, w.users.finance)).body.docs).toHaveLength(0)
    expect((await api('GET', `/api/vendors?depth=0&where[isDeleted][equals]=true&where[name][equals]=${encodeURIComponent(name)}`, w.users.admin)).body.docs).toHaveLength(1)
    // id lookups (relationship labels, population, the detail page) still find it
    expect((await api('GET', `/api/vendors/${vendor}?depth=0`, w.users.finance)).status).toBe(200)
    expect((await api('GET', `/api/vendors?depth=0&where[id][in]=${vendor}`, w.users.finance)).body.docs).toHaveLength(1)
    // the tabbed Vendor page (DRMS 16/10): opens read-only, its "Rekening" tab no longer lists the deleted account, a save is refused
    const form = await api('GET', `/api/v1/vendor-form/${vendor}`, w.users.admin)
    expect(form.status, JSON.stringify(form.body)).toBe(200)
    expect(form.body.canEdit).toBe(false)
    expect(form.body.bankAccounts).toEqual([])
    const save = await api('PATCH', `/api/v1/vendor-form/${vendor}`, w.users.admin, { vendor: { name: `${name} ubah` } })
    expect(save.status).toBe(409)
    expect(JSON.stringify(save.body)).toContain('sudah dihapus')
    // APK masters: full read without it; a delta read lists it as a tombstone
    const full = await api('GET', '/api/v1/masters?types=vendors,vendor-bank-accounts', w.users.finance)
    expect(full.status).toBe(200)
    expect(full.body.types.vendors.items.some((i: { id: number }) => i.id === vendor)).toBe(false)
    expect(full.body.types['vendor-bank-accounts'].items.some((i: { id: number }) => i.id === account)).toBe(false)
    const since = new Date(Date.now() - 3_600_000).toISOString()
    const delta = await api('GET', `/api/v1/masters?types=vendors&since=${encodeURIComponent(since)}`, w.users.finance)
    expect(delta.body.types.vendors.items.find((i: { id: number }) => i.id === vendor)).toMatchObject({ deleted: true, active: false })
    // admin list: hidden by default, "Tampilkan yang dihapus" for an Admin only
    const cfg = await collectionConfig('vendors')
    const p = await getTestPayload()
    const load = (user: FlowUser, sp: Record<string, string>) => loadPkList({ payload: p, user: user as never, collection: cfg, searchParams: { q: name, ...sp } })
    expect((await load(w.users.admin, {})).docs).toHaveLength(0)
    const shown = await load(w.users.admin, { dihapus: 'tampil' })
    expect(shown.deleted).toEqual({ allowed: true, mode: 'tampil' })
    expect(shown.docs.map((d) => d.id)).toEqual([vendor])
    expect((await load(w.users.admin, { dihapus: 'hanya' })).docs.map((d) => d.id)).toEqual([vendor])
    const fin = await load(w.users.finance, { dihapus: 'tampil' })
    expect(fin.deleted.allowed).toBe(false)
    expect(fin.docs).toHaveLength(0)
    // row state of the deleted row: Pulihkan for the Admin, nothing for Finance
    expect((await asUser(w.users.admin, (req) => rowStates(req, 'vendors', shown.docs))).get(vendor)).toEqual({ action: 'pulihkan', deleted: true })
    expect((await asUser(w.users.finance, (req) => rowStates(req, 'vendors', shown.docs))).get(vendor)).toEqual({ action: null, deleted: true })
  })

  it('a deleted row is frozen (409) until restored; restore = Admin of the PT, audited, the account comes back', async () => {
    const patch = await api('PATCH', `/api/vendors/${vendor}`, w.users.admin, { contact: '0811' })
    expect(patch.status).toBe(409)
    expect((await restore(w.users.finance, 'vendors', vendor)).status).toBe(403)
    expect((await restore(w.users.admin, 'vendors', vendor, 'x')).status).toBe(400)
    const r = await restore(ptAdmin, 'vendors', vendor)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ deleted: false, action: 'hapus' })
    expect(await flag('vendors', vendor)).toMatchObject({ is_deleted: false, deleted_at: null, delete_reason: null })
    expect((await flag('vendor_bank_accounts', account)).is_deleted).toBe(false)
    expect((await auditRows('vendor', vendor)).filter((x) => x.action === 'restore')).toHaveLength(1)
    expect((await restore(ptAdmin, 'vendors', vendor)).status).toBe(409) // not deleted
    expect((await api('GET', `/api/vendors?depth=0&where[name][equals]=${encodeURIComponent(name)}`, w.users.finance)).body.docs).toHaveLength(1)
  })
})

describe('master / project in use → no Hapus', () => {
  it('a cost center referenced by projects: 409 IN_USE with the usage; the row action is Nonaktifkan', async () => {
    const c = await check(w.users.admin, 'cost-centers', w.projectCostCenter)
    expect(c.body.canDelete).toBe(false)
    expect(c.body.action).toBe('nonaktifkan')
    expect(c.body.usage.map((u: { label: string }) => u.label)).toContain('Project')
    const r = await del(w.users.admin, 'cost-centers', w.projectCostCenter)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('IN_USE')
    expect(r.body.usage.length).toBeGreaterThan(0)
    expect((await flag('cost_centers', w.projectCostCenter)).is_deleted).toBe(false)
  })

  it('an employee with a bank account used by requests / linked to a user account is used', async () => {
    // emp.admin is linked to the world Admin's membership (company_memberships.employee_id)
    const r = await del(w.users.admin, 'employees', w.emp.admin)
    expect(r.status).toBe(409)
    expect(JSON.stringify(r.body.usage)).toContain('Akses pengguna per PT')
  })

  it('a used project → PROJECT_IN_USE; its row action is Batalkan for the Direktur, nothing for the PM', async () => {
    const r = await del(w.users.admin, 'projects', w.otherProject)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('PROJECT_IN_USE')
    expect((await check(w.users.owner, 'projects', w.otherProject)).body.action).toBe('batalkan')
    expect((await check(w.users.otherPm, 'projects', w.otherProject)).body.action).toBe(null)
  })
})

describe('project: Hapus while unused (stages / team assignments are its own set-up)', () => {
  it('deleted project disappears from the v1 list, REST, reports scope, new requests and the APK masters', async () => {
    const pid = await sysCreate('projects', { code: `SD-DRAFT-${Date.now() % 1e6}`, name: 'SD Proyek Draft', pm: w.users.pm.id, status: 'perencanaan' })
    await sysCreate('team-assignments', { employee: w.emp.a, project: pid, roleInProject: 'staff' })
    expect((await check(w.users.owner, 'projects', pid)).body).toMatchObject({ action: 'hapus', canDelete: true })
    expect((await del(w.users.staffA, 'projects', pid)).status).toBe(403) // Staff reads its assigned project, may not update it
    const r = await del(w.users.owner, 'projects', pid)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const v1 = await api('GET', '/api/v1/projects?limit=100&status=perencanaan', w.users.owner)
    expect(v1.body.docs.some((d: { id: number }) => d.id === pid)).toBe(false)
    expect((await api('GET', `/api/projects?depth=0&where[code][like]=SD-DRAFT`, w.users.owner)).body.docs.some((d: { id: number }) => d.id === pid)).toBe(false)
    const inScope = await asUser(w.users.owner, async (req) => (await rows(req, sql`SELECT p.id FROM projects p WHERE ${projectScopeSql(await officeScope(req))}`)).map((x) => Number(x.id)))
    expect(inScope).not.toContain(pid)
    expect(inScope).toContain(w.project)
    // a new request naming it (stale APK cache) is refused like a missing project
    const stale = await api('POST', E, w.users.staffA, draftBody(w, { projectId: pid }))
    expect(stale.status).toBe(400)
    expect(JSON.stringify(stale.body)).toContain('Project tidak ditemukan')
    // the masters' team assignments leave the deleted project out
    const m = await api('GET', '/api/v1/masters?types=team-assignments,projects', w.users.staffA)
    expect(m.body.types['team-assignments'].items.some((i: { project: number }) => i.project === pid)).toBe(false)
    expect(m.body.types.projects.items.some((i: { id: number }) => i.id === pid)).toBe(false)
  })
})

describe('request: Hapus only as a never-submitted draft', () => {
  it('creator deletes the draft; another staff cannot; it leaves the lists; a deleted draft cannot be submitted', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const id = c.body.id as number
    expect((await check(w.users.staffA, 'expense-requests', id)).body).toMatchObject({ action: 'hapus', canDelete: true })
    expect((await del(w.users.staffB, 'expense-requests', id)).status).toBe(404) // not even visible to B
    expect((await del(w.users.finance, 'expense-requests', id)).status).toBe(403) // reads it, may not edit someone's draft
    const r = await del(w.users.staffA, 'expense-requests', id)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const mine = await api('GET', `${E}?scope=mine&limit=100`, w.users.staffA)
    expect(mine.body.items.some((i: { id: number }) => i.id === id)).toBe(false)
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(409)
    // reports never count it (Staff "perlu tindakan" counts drafts)
    const counted = await asUser(w.users.owner, async (req) => (await rows(req, sql`SELECT er.id FROM expense_requests er WHERE ${requestScopeSql(await officeScope(req))} AND er.id = ${id}`)).length)
    expect(counted).toBe(0)
    expect((await auditRows('expense_request', id)).some((x) => x.action === 'soft_delete')).toBe(true)
  })

  it('submitted (and withdrawn) requests are cancelled, never deleted', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    const id = c.body.id as number
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
    const sub = await del(w.users.staffA, 'expense-requests', id)
    expect(sub.status).toBe(409)
    expect(sub.body.code).toBe('NOT_A_DRAFT')
    expect((await check(w.users.staffA, 'expense-requests', id)).body.action).toBe('batalkan')
    expect((await api('POST', `${E}/${id}/withdraw`, w.users.staffA, { reason: 'Perlu revisi baris' })).status).toBe(200)
    expect((await del(w.users.staffA, 'expense-requests', id)).body.code).toBe('NOT_A_DRAFT') // keeps its number
  })
})

describe('Batalkan proyek — cascade in one transaction', () => {
  const proof = async () => {
    const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
    expect(r.status).toBe(201)
    return r.body.id as number
  }
  const newProject = async (tag: string) => {
    const id = await sysCreate('projects', { code: `SD-${tag}-${Date.now() % 1e6}`, name: `SD ${tag}`, pm: w.users.pm.id, budget: 20_000_000, status: 'berjalan', costCenter: w.projectCostCenter })
    await sysCreate('team-assignments', { employee: w.emp.a, project: id, roleInProject: 'staff' })
    return id
  }
  const draft = async (project: number) => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { projectId: project }))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    return c.body.id as number
  }
  const submitted = async (project: number) => {
    const id = await draft(project)
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
    return id
  }
  const approved = async (project: number) => {
    const id = await submitted(project)
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})).status).toBe(200)
    const a = await api('POST', `${E}/${id}/approve`, w.users.finance, {})
    expect(a.status, JSON.stringify(a.body)).toBe(200)
    expect((await status('expense_requests', id)).s).toBe('approved')
    return id
  }

  it('dry run lists what is cancelled; PM 403; Direktur cancels: requests / addendum / loan cancelled with "Proyek dibatalkan: …", notifications, project closed', async () => {
    const cp = await newProject('C1')
    const r1 = await draft(cp)
    const r2 = await submitted(cp)
    const r3 = await approved(cp)
    const ad = await api('POST', '/api/v1/budget-addenda', w.users.pm, { projectId: cp, addition: 1_000_000, reason: 'Tambah volume pekerjaan', submit: true }, key())
    expect(ad.status, JSON.stringify(ad.body)).toBe(201)
    const loan = await api('POST', '/api/v1/project-loans', w.users.pm, { borrowerProjectId: cp, lenderProjectId: w.otherProject, amount: 1_000_000, reason: 'Termin klien belum cair', dueDate: addDays(today, 30), submit: true }, key())
    expect(loan.status, JSON.stringify(loan.body)).toBe(201)

    const plan = await api('GET', `/api/v1/projects/${cp}/cancel-plan`, w.users.owner)
    expect(plan.status, JSON.stringify(plan.body)).toBe(200)
    expect(plan.body.allowed).toBe(true)
    expect(plan.body.blocking).toEqual([])
    expect(plan.body.cancel.map((x: { kind: string; id: number }) => `${x.kind}:${x.id}`).sort()).toEqual(
      [`expense_request:${r1}`, `expense_request:${r2}`, `expense_request:${r3}`, `budget_addendum:${ad.body.id}`, `project_loan:${loan.body.id}`].sort(),
    )
    // the dry run changes nothing
    expect((await status('expense_requests', r2)).s).toBe('pending_ack')
    const pmPlan = await api('GET', `/api/v1/projects/${cp}/cancel-plan`, w.users.pm)
    expect(pmPlan.body.allowed).toBe(false)
    expect((await api('POST', `/api/v1/projects/${cp}/cancel`, w.users.pm, { reason: 'Klien membatalkan kontrak' }, key())).status).toBe(403)
    expect((await api('POST', `/api/v1/projects/${cp}/cancel`, w.users.owner, { reason: 'x' }, key())).status).toBe(400)
    // "Hapus" is refused for this used project
    expect((await del(w.users.owner, 'projects', cp)).body.code).toBe('PROJECT_IN_USE')

    const res = await api('POST', `/api/v1/projects/${cp}/cancel`, w.users.owner, { reason: 'Klien membatalkan kontrak' }, key())
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.project).toMatchObject({ status: 'dibatalkan', cancelReason: 'Klien membatalkan kontrak' })
    expect(res.body.cancelled).toHaveLength(5)
    expect(await status('projects', cp)).toEqual({ s: 'dibatalkan', r: 'Klien membatalkan kontrak' })
    for (const id of [r1, r2, r3]) expect(await status('expense_requests', id), String(id)).toEqual({ s: 'cancelled', r: 'Proyek dibatalkan: Klien membatalkan kontrak' })
    expect(await status('budget_addenda', ad.body.id)).toEqual({ s: 'cancelled', r: 'Proyek dibatalkan: Klien membatalkan kontrak' })
    expect(await status('project_loans', loan.body.id)).toEqual({ s: 'cancelled', r: 'Proyek dibatalkan: Klien membatalkan kontrak' })
    // normal notifications of the request transition (the requester is told)
    const n = await sqlAs('app', "SELECT count(*)::int AS n FROM notifications WHERE event = 'expense.cancelled' AND doc_id = $1 AND user_id = $2", [String(r2), w.users.staffA.id])
    expect(n.rows[0].n).toBe(1)
    const a = await sqlAs('app', "SELECT reason, status_from FROM audit_logs WHERE doc_type = 'project' AND doc_id = $1 AND action = 'status_change' AND status_to = 'dibatalkan'", [String(cp)])
    expect(a.rows).toEqual([{ reason: 'Klien membatalkan kontrak', status_from: 'berjalan' }])
    // closed: no new request, no re-open from the form, no second cancel
    const again = await api('POST', E, w.users.staffA, draftBody(w, { projectId: cp }))
    expect([400, 409]).toContain(again.status)
    expect(JSON.stringify(again.body)).toContain('dibatalkan')
    expect((await api('PATCH', `/api/projects/${cp}`, w.users.owner, { status: 'berjalan' })).status).toBe(409)
    expect((await api('GET', `/api/v1/projects/${cp}/cancel-plan`, w.users.owner)).body.allowed).toBe(false)
    // default project list leaves it out; masters mark it inactive
    expect((await api('GET', '/api/v1/projects?limit=100', w.users.owner)).body.docs.some((d: { id: number }) => d.id === cp)).toBe(false)
    const m = await api('GET', '/api/v1/masters?types=projects', w.users.owner)
    expect(m.body.types.projects.items.find((i: { id: number }) => i.id === cp)).toMatchObject({ status: 'dibatalkan', active: false })
  })

  it('refused (409 + blocking list) while a request was already transferred; nothing changes (one transaction)', async () => {
    const cq = await newProject('C2')
    const pending = await submitted(cq)
    const moved = await approved(cq)
    const t = await api('POST', `${E}/${moved}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `TRF-SD-${moved}`, proofMediaId: await proof() })
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    const plan = await api('GET', `/api/v1/projects/${cq}/cancel-plan`, w.users.owner)
    expect(plan.body.blocking.map((x: { id: number }) => x.id)).toEqual([moved])
    expect(plan.body.cancel.map((x: { id: number }) => x.id)).toEqual([pending])
    const r = await api('POST', `/api/v1/projects/${cq}/cancel`, w.users.admin, { reason: 'Proyek tidak jadi dikerjakan' }, key())
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('PROJECT_HAS_OPEN_DOCUMENTS')
    expect(r.body.blocking.map((x: { id: number; statusLabel: string }) => x.id)).toEqual([moved])
    expect((await status('projects', cq)).s).toBe('berjalan')
    expect((await status('expense_requests', pending)).s).toBe('pending_ack')
  })
})
