import { randomUUID } from 'node:crypto'

import { handleEndpoints, type CollectionSlug } from 'payload'
import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { AdminDashboard, FinanceDashboard, OwnerDashboard, PmDashboard, StaffDashboard } from '@/api/v1/schemas-reports'
import { copyCompanyDefaults } from '@/domain/company-defaults'
import { allocateDocNo } from '@/domain/numbering-db'
import { parseBusinessDate } from '@/domain/numbering'
import { resetRateLimits } from '@/lib/rate-limit'
import { up as listColumnUp } from '@/migrations/20260930_120000_mc4_list_company_column'
import config from '@/payload.config'
import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'

import { api, asUser, draftBody, makeFlowUser, makeWorld, ORIGIN, png, sysCreate, type FlowUser, type Res, type World } from './flow-world'
import { accessToken, addMembership, auditRows, companyId, fixturePm, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, type TestUser, updateCompany } from './helpers'

/**
 * MC4 code gaps (docs/proyekkas/mc/mc4-progress.md, ADR 0016 "Implementation notes (MC4)"):
 * 1 copy defaults on PT create · 2 optional body `company` on /api/v1 creates · 3 public
 * /app/config flags · 4 report PDF logo · 5 notification templates = group admin · extra (a)/(b)
 * per-PT dashboard fields / thresholds · (d) saved list columns. PTs: A = #1 DRMS (world `MC4`),
 * B = fictional "PT Contoh Delapan" (CS8), C = "PT Contoh Sembilan" (CS9); PTs created by the tests:
 * MC4X / MC4Y / MC4Z. Every PT except A is deactivated in afterAll.
 *
 *   tri     = Staff in A (employee), PM + Staff in B (employee), Finance in C
 *   finAC   = Finance in A and C;  ownerBC = Direktur in B and C (no membership in A)
 *   groupAdmin = Admin in A + users.groupAdmin;  ptAdmin = Admin in A (NOT group admin)
 */
let w: World
let A = 0
let B = 0
let C = 0
const X: Record<string, number> = {}
const created: number[] = []
let tri: FlowUser
let finAC: FlowUser
let ownerBC: FlowUser
let groupAdmin: FlowUser
let ptAdmin: FlowUser
const E = '/api/v1/expense-requests'
type Body = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const key = () => ({ 'Idempotency-Key': randomUUID() })
const H = (...ids: number[]) => ({ 'X-Company-Ids': ids.join(',') })
const call = async (method: string, path: string, user: FlowUser | null, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
  resetRateLimits()
  return api(method, path, user, body, headers)
}
const ok = async (p: Promise<Res>, status = 200): Promise<Body> => {
  const r = await p
  expect(r.status, JSON.stringify(r.body).slice(0, 600)).toBe(status)
  return r.body as Body
}
const COMPANY_OF = {
  expense_requests: 'SELECT company_id FROM expense_requests WHERE id = $1',
  progress_reports: 'SELECT company_id FROM progress_reports WHERE id = $1',
  budget_addenda: 'SELECT company_id FROM budget_addenda WHERE id = $1',
} as const
const companyOfRow = async (table: keyof typeof COMPANY_OF, id: number) => Number((await sqlAs('app', COMPANY_OF[table], [id])).rows[0]?.company_id)
const deniedCount = async (userId: number) => Number((await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'access_denied' AND field = 'company' AND user_id = $1", [userId])).rows[0]?.n)

/** Binary download through the Payload handler (report PDF). */
async function download(path: string, user: FlowUser): Promise<{ status: number; bytes: Buffer }> {
  resetRateLimits()
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { Origin: ORIGIN, Cookie: user.cookie } }) })
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) }
}
const hasImage = (pdf: Buffer) => /\/Subtype\s*\/Image/.test(pdf.toString('latin1'))

async function logoMedia(): Promise<number> {
  const p = await getTestPayload()
  const bytes = await png(4242, 120, 60)
  const doc = await p.create({ collection: 'media-company', data: {}, file: { data: bytes, mimetype: 'image/png', name: 'logo-mc4.png', size: bytes.length }, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  return doc.id as number
}

async function newCompany(user: FlowUser, data: Record<string, unknown>): Promise<number> {
  const p = await getTestPayload()
  const doc = await p.create({ collection: 'companies', data: { timezone: 'Asia/Makassar', active: true, ...data } as never, depth: 0, user, overrideAccess: false })
  created.push(doc.id as number)
  return doc.id as number
}

beforeAll(async () => {
  w = await makeWorld('MC4')
  A = await companyId()
  const p = await getTestPayload()
  const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
  await seed(p, {
    uoms,
    banks,
    companies: [
      drms,
      { ...drms, company: { name: 'PT Contoh Delapan', shortCode: 'CS8', timezone: 'Asia/Makassar' }, vehicles: [] },
      { ...drms, company: { name: 'PT Contoh Sembilan', shortCode: 'CS9', timezone: 'Asia/Makassar' }, vehicles: [] },
    ],
  })
  B = await companyId('CS8')
  C = await companyId('CS9')
  for (const code of ['CS8', 'CS9']) await updateCompany({ active: true, changeReason: 'uji MC4' }, code)
  const inPt = async (company: number, collection: CollectionSlug, code: string) =>
    (await p.find({ collection, where: { and: [{ company: { equals: company } }, { code: { equals: code } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  X.catB = await inPt(B, 'expense-categories', 'MAT')
  X.catC = await inPt(C, 'expense-categories', 'MAT')
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number

  X.empTriA = await sysCreate('employees', { company: A, code: 'MC4-TRI', name: 'Tri DRMS' })
  X.empTriB = await sysCreate('employees', { company: B, code: 'MC4-TRI', name: 'Tri Contoh Delapan' })
  tri = await makeFlowUser(['pk-staff'], 'mc4-tri', X.empTriA)
  await addMembership(tri.id, B, ['pk-pm', 'pk-staff'], X.empTriB)
  await addMembership(tri.id, C, ['pk-finance'])
  finAC = await makeFlowUser(['pk-finance'], 'mc4-fin-ac', null)
  await addMembership(finAC.id, C, ['pk-finance'])
  ownerBC = await makeFlowUser(['pk-owner'], 'mc4-owner-bc', null, { company: B })
  await addMembership(ownerBC.id, C, ['pk-owner'])
  groupAdmin = await makeFlowUser(['pk-admin'], 'mc4-group-admin', null, { groupAdmin: true })
  ptAdmin = await makeFlowUser(['pk-admin'], 'mc4-pt-admin', null, { groupAdmin: false })
  await makeFlowUser(['pk-finance'], 'mc4-fin-b', null, { company: B }) // approver pool of B (submit needs a Finance holder)

  X.projectB = await sysCreate('projects', { company: B, code: 'MC4-PB', name: 'Proyek Contoh Delapan', pm: tri.id, budget: 40_000_000, status: 'berjalan' })
  X.projectC = await sysCreate('projects', { company: C, pm: await fixturePm(C), code: 'MC4-PC', name: 'Proyek Contoh Sembilan', budget: 9_000_000, status: 'berjalan' })
  await sysCreate('team-assignments', { employee: X.empTriA, project: w.project, roleInProject: 'staff' })
  await sysCreate('team-assignments', { employee: X.empTriB, project: X.projectB, roleInProject: 'staff' })
  X.accTriA = await sysCreate('employee-bank-accounts', { employee: X.empTriA, bank, accountNo: `84${Date.now() % 1e8}`, accountHolder: 'Tri', isDefault: true })
  X.accTriB = await sysCreate('employee-bank-accounts', { employee: X.empTriB, bank, accountNo: `85${Date.now() % 1e8}`, accountHolder: 'Tri', isDefault: true })
  X.cashC = await sysCreate('cash-accounts', { company: C, name: 'MC4 Kas Contoh Sembilan', kind: 'bank', openingBalance: 5_000_000 })
  X.stageB = await sysCreate('project-stages', { project: X.projectB, name: 'Tahap tunggal', weightPct: 100, sequence: 1 })
})

afterAll(async () => {
  const p = await getTestPayload()
  for (const id of [B, C, ...created]) {
    if (id) await p.update({ collection: 'companies', id, data: { active: false, changeReason: 'uji MC4 selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  }
  await updateCompany({ budgetWarnPct: 85, defaultWorkSchedule: null })
  resetAppConfigCache()
  await p.destroy()
})

// ------------------------------------------------------------------------------ 1 copy defaults

describe('MC4-1 — "copy defaults from DRMS" when a group admin creates a PT (US-MC-01)', () => {
  it('sequences (start 1), copyable rules, default schedule and settings still at default are copied — in the same transaction, audited', async () => {
    const p = await getTestPayload()
    X.schedA = await sysCreate('work-schedules', { company: A, name: 'MC4 Jadwal Kantor', startTime: '07:30', endTime: '16:30', lateToleranceMin: 10, workDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false } })
    await updateCompany({ budgetWarnPct: 77, defaultWorkSchedule: X.schedA })
    // a rule naming a PT-specific project cannot be copied (the project belongs to A)
    await sysCreate('approval-rules', { company: A, name: 'MC4 aturan project A', minAmount: 0, project: w.project, steps: [{ level: 1, approverRole: 'pk-finance' }] })
    const srcRules = new Set((await sqlAs('app', 'SELECT name FROM approval_rules WHERE company_id = $1', [A])).rows.map((r) => r.name as string))
    const srcTypes = new Set((await sqlAs('app', 'SELECT doc_type FROM document_sequences WHERE company_id = $1', [A])).rows.map((r) => r.doc_type as string))
    for (const t of ['budget_addendum', 'cash_in', 'cash_out', 'expense_request', 'progress_report', 'settlement', 'transfer']) srcTypes.add(t)

    const id = await newCompany(groupAdmin, { shortCode: 'MC4X', name: 'PT Contoh MC4 X', lpjDueDays: 9 })
    const seqs = (await sqlAs('app', 'SELECT doc_type, start_at, pattern FROM document_sequences WHERE company_id = $1 ORDER BY doc_type', [id])).rows
    expect(seqs.map((s) => s.doc_type).sort()).toEqual([...srcTypes].sort())
    expect(seqs.every((s) => Number(s.start_at) === 1)).toBe(true)
    const rules = new Set((await sqlAs('app', 'SELECT name FROM approval_rules WHERE company_id = $1', [id])).rows.map((r) => r.name as string))
    const skipped = ((await auditRows('company', id)).find((r) => r.field === 'defaultsCopied')!.new_value?.v as Body).rules.skipped as string[]
    expect([...rules].sort()).toEqual([...srcRules].filter((n) => !skipped.includes(n)).sort())
    expect(rules.has('MC4 aturan project A')).toBe(false)
    expect(rules.has('Default — PM project lalu Direktur (semua nominal)')).toBe(true) // ADR 0021 seed default
    const doc = (await p.findByID({ collection: 'companies', id, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })) as unknown as Body
    expect(doc.budgetWarnPct).toBe(77) // default 85 → copied from A
    expect(doc.lpjDueDays).toBe(9) // chosen by the creator → kept
    const sched = (await sqlAs('app', 'SELECT id, name, start_time FROM work_schedules WHERE company_id = $1', [id])).rows
    expect(sched.map((s) => [s.name, s.start_time])).toEqual([['MC4 Jadwal Kantor', '07:30']])
    expect(doc.defaultWorkSchedule).toBe(Number(sched[0]!.id))
    // audit: one summary row + the copied rows by the group admin, all in the create transaction
    const summary = (await auditRows('company', id)).find((r) => r.field === 'defaultsCopied')!
    expect(summary.action).toBe('create')
    expect(Number(summary.user_id)).toBe(groupAdmin.id)
    expect((summary.new_value?.v as Body).rules.skipped).toContain('MC4 aturan project A')
    const createTx = (await auditRows('company', id)).find((r) => r.action === 'create' && r.field !== 'defaultsCopied')!.tx_id
    expect(summary.tx_id).toBe(createTx)
    const seqAudit = await sqlAs('app', "SELECT count(DISTINCT doc_id)::int AS n FROM audit_logs WHERE doc_type = 'document_sequence' AND action = 'create' AND company_id = $1 AND user_id = $2", [id, groupAdmin.id])
    expect(Number(seqAudit.rows[0]?.n)).toBe(srcTypes.size)
    // numbering works at once in the new PT: PB/MC4X/2609/0001 (D5: PT code in every number)
    const alloc = await asUser(null, (req) => allocateDocNo(req, 'expense_request', { companyId: id, date: parseBusinessDate('2026-09-30') }))
    expect(alloc.docNo).toBe('PB/MC4X/2609/0001')
    X.mc4x = id
  })

  it('idempotent: a second run creates nothing and keeps changed settings', async () => {
    await updateCompany({ budgetWarnPct: 66 }, 'MC4X')
    const r = await asUser(groupAdmin, (req) => copyCompanyDefaults(req, X.mc4x!))
    expect(r.sequences.created).toEqual([])
    expect(r.rules.created).toEqual([])
    expect(r.workSchedule.created).toBe(false)
    expect(r.settings).not.toContain('budgetWarnPct')
    expect(r.sequences.existing.length).toBeGreaterThanOrEqual(7)
    expect(Number((await sqlAs('app', 'SELECT budget_warn_pct FROM companies WHERE id = $1', [X.mc4x])).rows[0]?.budget_warn_pct)).toBe(66)
  })

  it('"Salin dari PT" names another source; "copy defaults" off → a bare PT', async () => {
    await updateCompany({ reminderHour: 9 }, 'CS8')
    const y = await newCompany(groupAdmin, { shortCode: 'MC4Y', name: 'PT Contoh MC4 Y', copyDefaultsFrom: B })
    expect(Number((await sqlAs('app', 'SELECT reminder_hour FROM companies WHERE id = $1', [y])).rows[0]?.reminder_hour)).toBe(9)
    expect(Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM document_sequences WHERE company_id = $1', [y])).rows[0]?.n)).toBeGreaterThanOrEqual(7)
    const z = await newCompany(groupAdmin, { shortCode: 'MC4Z', name: 'PT Contoh MC4 Z', copyDefaults: false })
    expect(Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM document_sequences WHERE company_id = $1', [z])).rows[0]?.n)).toBe(0)
    expect(Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM approval_rules WHERE company_id = $1', [z])).rows[0]?.n)).toBe(0)
    // the virtual fields are never stored / returned
    const doc = (await (await getTestPayload()).findByID({ collection: 'companies', id: y, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })) as unknown as Body
    expect(doc.copyDefaultsFrom ?? null).toBeNull()
  })

  it('negative authz: a PT Admin (not group admin) cannot create a PT (no defaults written)', async () => {
    const before = Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM companies')).rows[0]?.n)
    const p = await getTestPayload()
    await expect(p.create({ collection: 'companies', data: { shortCode: 'MC4N', name: 'PT Tidak Boleh', timezone: 'Asia/Makassar' } as never, user: ptAdmin, overrideAccess: false })).rejects.toMatchObject({ status: 403 })
    const rest = await call('POST', '/api/companies', ptAdmin, { shortCode: 'MC4N', name: 'PT Tidak Boleh', timezone: 'Asia/Makassar' })
    expect(rest.status).toBe(403)
    expect(Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM companies')).rows[0]?.n)).toBe(before)
  })
})

// ------------------------------------------------------------------------------ 2 body company

describe('MC4-2 — optional body `company` on /api/v1 creates', () => {
  it('project-less draft lands in the named PT (a membership with the role), whatever the header says', async () => {
    const body = { type: 'advance', title: 'MC4 tanpa project', requesterIds: [X.empTriB], bankAccountId: X.accTriB }
    const d = await ok(call('POST', E, tri, { ...body, company: B }, { ...key(), ...H(A) }), 201)
    expect(d.companyId).toBe(B)
    expect(await companyOfRow('expense_requests', d.id)).toBe(B)
    // Finance in C may create a draft there (expense create roles include Finance)
    const c = await ok(call('POST', E, tri, { type: 'advance', title: 'MC4 di C', company: C }, key()), 201)
    expect(await companyOfRow('expense_requests', c.id)).toBe(C)
  })

  it('consistent with the project PT: same PT → 201; another PT → 400 COMPANY_MISMATCH, nothing stored', async () => {
    const good = await ok(call('POST', E, tri, { type: 'advance', title: 'MC4 B', company: B, projectId: X.projectB, requesterIds: [X.empTriB], bankAccountId: X.accTriB, lines: [{ description: 'x', total: 10_000, categoryId: X.catB }] }, key()), 201)
    expect(good.companyId).toBe(B)
    const before = Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM expense_requests')).rows[0]?.n)
    const bad = await call('POST', E, tri, { ...draftBody(w, { requesterIds: [X.empTriA], bankAccountId: X.accTriA }), company: B }, key())
    expect([bad.status, bad.body.code, bad.body.errors?.[0]?.path]).toEqual([400, 'COMPANY_MISMATCH', 'projectId'])
    expect(Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM expense_requests')).rows[0]?.n)).toBe(before)
  })

  it('negative authz: a PT without membership / without the needed role → 403 COMPANY_NOT_ALLOWED (audited)', async () => {
    const n0 = await deniedCount(ownerBC.id)
    // ownerBC has no membership in A
    const r = await call('POST', E, ownerBC, { type: 'advance', title: 'MC4 asing', company: A }, key())
    expect([r.status, r.body.code]).toEqual([403, 'COMPANY_NOT_ALLOWED'])
    // ownerBC is Direktur in B: ADR 0024 lets a Direktur create (his OWN requests) — the role check passes, but
    // without an employee in B he cannot be the requester → refused by the on-behalf rule (not a PT denial)
    expect((await call('POST', E, ownerBC, { type: 'advance', title: 'MC4 peran', company: B }, key())).status).toBe(403)
    expect(await deniedCount(ownerBC.id)).toBe(n0 + 1)
    // progress report: tri is only Staff in A (needs PM / Direktur there)
    const pr = await call('POST', '/api/v1/progress-reports', tri, { company: A, projectId: w.project, stageId: X.stageB, pctAfter: 10, work: 'Uji MC4' }, key())
    expect([pr.status, pr.body.code]).toEqual([403, 'COMPANY_NOT_ALLOWED'])
    // addendum: PM only in B
    const ad = await call('POST', '/api/v1/budget-addenda', tri, { company: A, projectId: w.project, addition: 1000, reason: 'uji MC4' }, key())
    expect([ad.status, ad.body.code]).toEqual([403, 'COMPANY_NOT_ALLOWED'])
    // cash entry: Finance of A + C, but not of B
    const ce = await call('POST', '/api/v1/cash-entries', finAC, { company: B, direction: 'out', cashAccountId: X.cashC, amount: 1000, description: 'MC4', categoryId: X.catC }, key())
    expect([ce.status, ce.body.code]).toEqual([403, 'COMPANY_NOT_ALLOWED'])
  })

  it('progress report / addendum / cash entry with the right PT → created there; wrong PT for the reference → COMPANY_MISMATCH', async () => {
    const pr = await ok(call('POST', '/api/v1/progress-reports', tri, { company: B, projectId: X.projectB, stageId: X.stageB, pctAfter: 10, work: 'Uji MC4 progress' }, key()), 201)
    expect(await companyOfRow('progress_reports', pr.id)).toBe(B)
    const ad = await ok(call('POST', '/api/v1/budget-addenda', tri, { company: B, projectId: X.projectB, addition: 500_000, reason: 'uji MC4 addendum' }, key()), 201)
    expect(await companyOfRow('budget_addenda', ad.id)).toBe(B)
    const ce = await ok(call('POST', '/api/v1/cash-entries', finAC, { company: C, direction: 'out', cashAccountId: X.cashC, amount: 1000, description: 'MC4 kas C', categoryId: X.catC }, key()), 201)
    expect(ce.companyId).toBe(C)
    const mm = await call('POST', '/api/v1/cash-entries', finAC, { company: A, direction: 'out', cashAccountId: X.cashC, amount: 1000, description: 'MC4 salah', categoryId: X.catC }, key())
    expect([mm.status, mm.body.code, mm.body.errors?.[0]?.path]).toEqual([400, 'COMPANY_MISMATCH', 'cashAccountId'])
  })

  it('released APK 0.2.x / 0.3.0 (no body company): single-PT bearer create unchanged; multi-PT PT from the project', async () => {
    await installLocalJwks()
    const p = await getTestPayload()
    const doc = await p.findByID({ collection: 'users', id: w.users.staffA.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
    const t: TestUser = { ...w.users.staffA, keycloakSub: doc.keycloakSub as string }
    const token = await accessToken(t, ['pk-user'])
    const device = await registerDevice(t, token)
    resetRateLimits()
    const r = await http('POST', E, { headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': device, 'X-App-Version': '0.2.0', ...key() }, json: draftBody(w) })
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201)
    expect((r.body as Body).companyId).toBe(A)
    // multi-PT, no company: PT derived from the project exactly as before
    const d = await ok(call('POST', E, tri, { type: 'advance', title: 'MC4 lama', projectId: X.projectB, requesterIds: [X.empTriB], bankAccountId: X.accTriB }, key()), 201)
    expect(d.companyId).toBe(B)
  })
})

// ------------------------------------------------------------------------------ 3 /app/config

describe('MC4-3 — public GET /app/config: OR over active PTs, no PT data', () => {
  it('A off + B on → advertised; the body names no PT; per-PT truth in GET /me companies[].settings', async () => {
    await updateCompany({ syncAttendanceEnabled: false })
    await updateCompany({ syncAttendanceEnabled: true }, 'CS8')
    resetAppConfigCache()
    const r = await http('GET', '/api/v1/app/config?version=0.2.0')
    expect(r.status).toBe(200)
    const b = r.body as Body
    expect(b.features.syncAttendance).toBe(true)
    const text = JSON.stringify(b)
    for (const leak of ['CS8', 'CS9', 'DRMS', 'Contoh', 'companies', 'companyId']) expect(text, leak).not.toContain(leak)
    expect(Object.keys(b).sort()).toEqual(['android', 'downloadUrl', 'features', 'latestVersion', 'minSupportedVersion', 'serverTime', 'sync', 'timezone', 'updateAvailable', 'updateRequired', ...(b.releaseNotes ? ['releaseNotes'] : [])].sort())
    const me = await ok(call('GET', '/api/v1/me', tri))
    const byId = new Map((me.companies as Body[]).map((c) => [c.id, c.settings.syncAttendanceEnabled]))
    expect([byId.get(A), byId.get(B)]).toEqual([false, true])
    // …and the server still enforces A's flag on a sync item of A (FEATURE_DISABLED)
    await updateCompany({ syncAttendanceEnabled: false }, 'CS8')
    resetAppConfigCache()
    expect(((await http('GET', '/api/v1/app/config')).body as Body).features.syncAttendance).toBe(false)
  })
})

// ------------------------------------------------------------------------------ 4 PDF logo

describe('MC4-4 — report PDF letterhead logo (PT logo / group logo)', () => {
  it('one PT → its logo; several PTs → the group logo; no group logo → text only', async () => {
    const logo = await logoMedia()
    await updateCompany({ logo })
    const one = await download('/api/v1/reports/rekap-kas/pdf', w.users.finance)
    expect(one.status).toBe(200)
    expect(hasImage(one.bytes)).toBe(true)
    const p = await getTestPayload()
    await p.updateGlobal({ slug: 'company-settings', data: { groupLogo: null }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    const groupNoLogo = await download(`/api/v1/reports/rekap-kas/pdf?pt=${A},${C}`, finAC)
    expect(groupNoLogo.status).toBe(200)
    expect(hasImage(groupNoLogo.bytes)).toBe(false)
    await p.updateGlobal({ slug: 'company-settings', data: { groupLogo: logo }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    const group = await download(`/api/v1/reports/rekap-kas/pdf?pt=${A},${C}`, finAC)
    expect(hasImage(group.bytes)).toBe(true)
    await p.updateGlobal({ slug: 'company-settings', data: { groupLogo: null }, overrideAccess: true /* SYSTEM-WRITE: restore */ })
  })
})

// ------------------------------------------------------------------------------ 5 templates

describe('MC4-5 — notification templates: group admin writes, PT Admin / Direktur read', () => {
  it('PT Admin: read yes, create / update 403; group admin: create + update; Finance: no rows', async () => {
    const tpl = await ok(call('POST', '/api/notification-templates', groupAdmin, { event: 'mc4.uji', title: 'Uji', body: 'Isi' }), 201)
    const id = tpl.doc.id as number
    expect((await call('POST', '/api/notification-templates', ptAdmin, { event: 'mc4.uji2', title: 'x', body: 'x' })).status).toBe(403)
    expect((await call('PATCH', `/api/notification-templates/${id}`, ptAdmin, { title: 'Diubah PT Admin' })).status).toBe(403)
    expect((await call('GET', `/api/notification-templates/${id}`, ptAdmin)).status).toBe(200)
    expect((await call('GET', `/api/notification-templates/${id}`, w.users.owner)).status).toBe(200)
    expect([403, 404]).toContain((await call('GET', `/api/notification-templates/${id}`, w.users.finance)).status)
    await ok(call('PATCH', `/api/notification-templates/${id}`, groupAdmin, { title: 'Diubah admin grup' }))
    expect((await sqlAs('app', 'SELECT title FROM notification_templates WHERE id = $1', [id])).rows[0]?.title).toBe('Diubah admin grup')
  })
})

// ------------------------------------------------------------------------------ extra (a)/(b)

describe('MC4 extra — per-PT dashboard fields (APK) and thresholds without company #1 fallback', () => {
  it('dashboards match the documented schemas; Σ byCompany = totals; warnPct per PT', async () => {
    await updateCompany({ budgetWarnPct: 60 }, 'CS9')
    const owner = await ok(call('GET', '/api/v1/dashboard/owner', ownerBC))
    expect(OwnerDashboard.safeParse(owner).success, JSON.stringify(OwnerDashboard.safeParse(owner).error?.issues?.slice(0, 3))).toBe(true)
    expect(owner.companies.map((c: Body) => c.id)).toEqual([B, C])
    expect(owner.cash.byCompany.reduce((s: number, x: Body) => s + x.total, 0)).toBe(owner.cash.total)
    expect(owner.approvals.byCompany.reduce((s: number, x: Body) => s + x.count, 0)).toBe(owner.approvals.count)
    expect(owner.viz.warnPctByCompany).toEqual([
      { companyId: B, warnPct: 85 },
      { companyId: C, warnPct: 60 },
    ])
    // top-level display default = the caller's lowest selected PT (B) — never company #1 (not a member)
    expect(owner.viz.warnPct).toBe(85)
    const fin = await ok(call('GET', '/api/v1/dashboard/finance', finAC))
    expect(FinanceDashboard.safeParse(fin).success, JSON.stringify(FinanceDashboard.safeParse(fin).error?.issues?.slice(0, 3))).toBe(true)
    const pm = await ok(call('GET', '/api/v1/dashboard/pm', tri))
    expect(PmDashboard.safeParse(pm).success, JSON.stringify(PmDashboard.safeParse(pm).error?.issues?.slice(0, 3))).toBe(true)
    const me = await ok(call('GET', '/api/v1/dashboard/me', tri))
    expect(StaffDashboard.safeParse(me).success, JSON.stringify(StaffDashboard.safeParse(me).error?.issues?.slice(0, 3))).toBe(true)
    const adm = await ok(call('GET', '/api/v1/dashboard/admin', groupAdmin))
    expect(AdminDashboard.safeParse(adm).success, JSON.stringify(AdminDashboard.safeParse(adm).error?.issues?.slice(0, 3))).toBe(true)
  })

  it('approval inbox: items carry their PT warn %; top-level = lowest selected PT; K-09 rows carry their PT thresholds', async () => {
    await updateCompany({ budgetWarnPct: 70, progressBadGapPct: 5 }, 'CS8')
    // one request of B waiting for the Direktur of B (ownerBC)
    const d = await ok(call('POST', E, tri, { type: 'advance', title: 'MC4 inbox B', projectId: X.projectB, requesterIds: [X.empTriB], bankAccountId: X.accTriB, neededDate: '2026-10-30', lines: [{ description: 'Semen', total: 50_000, categoryId: X.catB }] }, key()), 201)
    await ok(call('POST', `${E}/${d.id}/submit`, tri, {}, key()))
    const inbox = await ok(call('GET', '/api/v1/approvals/inbox', ownerBC))
    expect(inbox.budgetWarnPct).toBe(70) // B (lowest selected), not A's value
    const item = (inbox.items as Body[]).find((i) => i.id === d.id)!
    expect([item.company.id, item.budget.warnPct]).toEqual([B, 70])
    for (const i of inbox.items as Body[]) expect(i.budget.warnPct).toBe(i.company.id === B ? 70 : 60)
    const k09 = await ok(call('GET', '/api/v1/projects/progress', ownerBC))
    const rowB = (k09.projects as Body[]).find((r) => r.id === X.projectB)!
    const rowC = (k09.projects as Body[]).find((r) => r.id === X.projectC)!
    expect([rowB.companyId, rowB.badGapPct]).toEqual([B, 5])
    expect([rowC.companyId, rowC.badGapPct]).toEqual([C, 8])
    expect(k09.badGapPct).toBe(5)
    await updateCompany({ budgetWarnPct: 85, progressBadGapPct: 8 }, 'CS8')
    await updateCompany({ budgetWarnPct: 85 }, 'CS9')
  })
})

// ------------------------------------------------------------------------------ extra (d)

describe('MC4 extra — saved list columns get the PT column once (migration 20260930_120000)', () => {
  it('prepends company only where the saved columns never named it; idempotent', async () => {
    const ins = async (key: string, value: unknown) => Number((await sqlAs('owner', 'INSERT INTO payload_preferences (key, value) VALUES ($1, $2::jsonb) RETURNING id', [key, JSON.stringify(value)])).rows[0]?.id)
    const old = await ins('collection-projects', { columns: [{ accessor: 'code', active: true }, { accessor: 'name', active: true }] })
    const hidden = await ins('collection-expense-requests', { columns: [{ accessor: 'company', active: false }, { accessor: 'docNo', active: true }] })
    const shared = await ins('collection-banks', { columns: [{ accessor: 'code', active: true }] })
    const dialect = new PgDialect()
    const db = { execute: async (q: unknown) => { const x = dialect.sqlToQuery(q as never); return sqlAs('owner', x.sql, x.params) } }
    await listColumnUp({ db } as never)
    await listColumnUp({ db } as never)
    const val = async (id: number) => (await sqlAs('owner', 'SELECT value FROM payload_preferences WHERE id = $1', [id])).rows[0]?.value as Body
    expect((await val(old)).columns).toEqual([{ accessor: 'company', active: true }, { accessor: 'code', active: true }, { accessor: 'name', active: true }])
    expect((await val(hidden)).columns[0]).toEqual({ accessor: 'company', active: false })
    expect((await val(shared)).columns).toEqual([{ accessor: 'code', active: true }])
    await sqlAs('owner', 'DELETE FROM payload_preferences WHERE id = ANY($1::int[])', [[old, hidden, shared]])
  })
})
