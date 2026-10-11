import { randomUUID } from 'node:crypto'

import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closePeriod, postEntry } from '@/domain/cash/ledger'
import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'

import { adr0013Fallback, api, asUser, draftBody, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'
import { addMembership, auditRows, companyId, getTestPayload, sqlAs, sqlError, withContext } from './helpers'

/**
 * MC1 isolation suite (ADR 0016 §4–§5, US-MC-07/08/09/14). Two PTs in one DB: company #1 DRMS
 * (world `MCA`, built by the shared fixture) and the fictional "PT Contoh Satu" (CS1) built here
 * with explicit companies. "Rina" = Finance in DRMS and Staff in CS1 (with an employee in CS1 only).
 * CS1 is deactivated again in afterAll: every other test file assumes the single-company default.
 */
let w: World
let a = 0 // DRMS
let b = 0 // CS1
const B: Record<string, number> = {}
let rina: FlowUser
let ownerB: FlowUser
let financeB: FlowUser
let adminB: FlowUser
let pmB: FlowUser
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })

/** Per-PT collections with a `company` column (ADR 0016 §4) that a PT member may list over REST. */
const PER_PT: CollectionSlug[] = [
  'projects', 'project-stages', 'stage-templates', 'budget-lines', 'cost-centers', 'clients', 'vendors', 'expense-categories',
  'cash-in-sources', 'cash-accounts', 'vehicles', 'work-schedules', 'approval-rules', 'document-sequences', 'employees',
  'employee-bank-accounts', 'team-assignments', 'period-closings', 'expense-requests', 'expense-line-snapshots', 'approvals',
  'receipts', 'receipt-flags', 'transfers', 'cash-entries', 'settlements', 'budget-addenda', 'progress-reports', 'attendances',
  'attendance-corrections',
]

beforeAll(async () => {
  // 1. company #1 world while DRMS is still the only active PT (sysCreate relies on that default)
  w = await makeWorld('MCA')
  a = await companyId()
  const p = await getTestPayload()
  // 2. CS1 through the multi-company seed shape (same master codes as DRMS: codes are unique PER PT)
  const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
  await seed(p, { uoms, banks, companies: [drms, { ...drms, company: { name: 'PT Contoh Satu', shortCode: 'CS1', timezone: 'Asia/Makassar' }, vehicles: [] }] })
  b = await companyId('CS1')
  await adr0013Fallback([a, b])
  const inB = async (collection: CollectionSlug, code: string) =>
    (await p.find({ collection, where: { and: [{ company: { equals: b } }, { code: { equals: code } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  B.catKsm = await inB('expense-categories', 'KSM')
  B.cc = await inB('cost-centers', 'OPS-PB')
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  // 3. CS1 people (explicit company: two PTs are active from here on)
  B.empRina = await sysCreate('employees', { company: b, code: 'MC-RINA', name: 'Rina Contoh' })
  B.empPm = await sysCreate('employees', { company: b, code: 'MC-PM', name: 'PM Contoh' })
  rina = await makeFlowUser(['pk-finance'], 'mc-rina', null) // Finance in DRMS …
  await addMembership(rina.id, b, ['pk-staff'], B.empRina) // … Staff in CS1
  rina = { ...rina, ...(await withContext(rina)) } // Local API calls see both memberships
  ownerB = await makeFlowUser(['pk-owner'], 'mc-owner-b', null, { company: b })
  financeB = await makeFlowUser(['pk-finance'], 'mc-finance-b', null, { company: b })
  adminB = await makeFlowUser(['pk-admin'], 'mc-admin-b', null, { company: b, groupAdmin: false })
  pmB = await makeFlowUser(['pk-pm'], 'mc-pm-b', B.empPm, { company: b })
  B.project = await sysCreate('projects', { company: b, code: 'MC-P1', name: 'Proyek CS1', pm: pmB.id, budget: 50_000_000, status: 'berjalan' })
  B.project2 = await sysCreate('projects', { company: b, code: 'MC-P2', name: 'Proyek CS1 lain', pm: pmB.id, budget: 10_000_000, status: 'berjalan' })
  await sysCreate('team-assignments', { employee: B.empRina, project: B.project, roleInProject: 'staff' })
  B.acc = await sysCreate('employee-bank-accounts', { employee: B.empRina, bank, accountNo: `8${Date.now() % 1e9}`, accountHolder: 'Rina Contoh', isDefault: true })
  B.cash = await sysCreate('cash-accounts', { company: b, name: 'MC Kas CS1', kind: 'bank', openingBalance: 10_000_000 })
})

afterAll(async () => {
  const p = await getTestPayload()
  if (b) await p.update({ collection: 'companies', id: b, data: { active: false, changeReason: 'uji MC1 selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

const draftB = (over: Record<string, unknown> = {}) => ({
  type: 'advance',
  title: 'Konsumsi proyek CS1',
  projectId: B.project,
  requesterIds: [B.empRina],
  bankAccountId: B.acc,
  neededDate: '2026-09-30',
  lines: [{ description: 'Makan tukang', total: 150_000, categoryId: B.catKsm }],
  ...over,
})

describe('MC1 — reads are filtered per PT (REST + /api/v1)', () => {
  it('derived company: rows of a PT carry it (seed, hooks, DB default)', async () => {
    const r = await sqlAs('app', 'SELECT company_id FROM team_assignments WHERE employee_id = $1', [B.empRina])
    expect(r.rows.map((x) => x.company_id)).toEqual([b])
    expect((await sqlAs('app', 'SELECT company_id FROM employee_bank_accounts WHERE id = $1', [B.acc])).rows[0].company_id).toBe(b)
  })

  it('every per-PT collection over REST: a CS1-only user sees only CS1 rows, a DRMS-only user none of them', async () => {
    for (const slug of PER_PT) {
      for (const [user, allowed] of [
        [ownerB, [b]],
        [w.users.owner, [a]],
        [w.users.staffA, [a]],
      ] as const) {
        const r = await api('GET', `/api/${slug}?limit=200&depth=0`, user)
        if (r.status === 403) continue // no read access at all in that role
        expect(r.status, `${slug} ${JSON.stringify(r.body)}`).toBe(200)
        const foreign = (r.body.docs as Array<{ company?: number }>).filter((d) => !allowed.includes(d.company as number))
        expect(foreign, `${slug}: rows of another PT`).toEqual([])
      }
    }
  })

  it('Rina (Finance DRMS, Staff CS1): all DRMS projects, only her assigned CS1 project; id of another PT → 404', async () => {
    const r = await api('GET', '/api/projects?limit=500&depth=0', rina)
    const ids = (r.body.docs as Array<{ id: number }>).map((d) => d.id)
    expect(ids).toEqual(expect.arrayContaining([w.project, w.otherProject, B.project]))
    expect(ids).not.toContain(B.project2)
    expect([403, 404]).toContain((await api('GET', `/api/projects/${w.project}`, ownerB)).status)
    expect([403, 404]).toContain((await api('GET', `/api/projects/${B.project}`, w.users.owner)).status)
    expect((await api('GET', `/api/projects/${B.project}`, ownerB)).status).toBe(200)
  })

  it('users / memberships: an Admin of CS1 sees the accounts of CS1, not DRMS-only accounts', async () => {
    const users = await api('GET', '/api/users?limit=1000&depth=0', adminB)
    const uids = (users.body.docs as Array<{ id: number }>).map((d) => d.id)
    expect(uids).toEqual(expect.arrayContaining([financeB.id, rina.id]))
    expect(uids).not.toContain(w.users.staffA.id)
    const ms = await api('GET', '/api/company-memberships?limit=1000&depth=0', adminB)
    expect((ms.body.docs as Array<{ company: number; user: number }>).every((m) => m.company === b || m.user === adminB.id)).toBe(true)
    // an Admin of CS1 cannot grant himself / anyone roles in DRMS
    const mk = await api('POST', '/api/company-memberships', adminB, { user: adminB.id, company: a, roles: ['pk-admin'] })
    expect(mk.status).toBe(403)
  })
})

describe('MC1 — selection: X-Company-Ids / cookie only narrow', () => {
  it('Rina narrowed to CS1 sees no DRMS rows; a DRMS-only user asking for CS1 → 403 COMPANY_NOT_ALLOWED (audited)', async () => {
    const narrowed = await api('GET', '/api/projects?limit=500&depth=0', rina, undefined, { 'X-Company-Ids': String(b) })
    expect((narrowed.body.docs as Array<{ company: number }>).every((d) => d.company === b)).toBe(true)
    const forged = await api('GET', '/api/v1/me', w.users.staffA, undefined, { 'X-Company-Ids': String(b) })
    expect(forged.status).toBe(403)
    expect(forged.body.code).toBe('COMPANY_NOT_ALLOWED')
    const audit = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'access_denied' AND field = 'X-Company-Ids' AND user_id = $1", [w.users.staffA.id])
    expect(audit.rows[0].n).toBeGreaterThan(0)
    // generic REST with a forged header: the selection is intersected → nothing of CS1
    const rest = await api('GET', '/api/projects?limit=500&depth=0', w.users.staffA, undefined, { 'X-Company-Ids': `${a},${b}` })
    expect(((rest.body?.docs ?? []) as Array<{ company: number }>).some((d) => d.company === b)).toBe(false)
  })

  it('a forged / stale cookie is ignored (falls back to the memberships)', async () => {
    const r = await api('GET', '/api/projects?limit=500&depth=0', { ...w.users.owner, cookie: `${w.users.owner.cookie}; pk-company-ids=${b}` })
    const docs = r.body.docs as Array<{ company: number }>
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((d) => d.company === a)).toBe(true)
  })
})

describe('MC1 — mutations are checked against the role IN THE DOCUMENT PT', () => {
  let reqA = 0
  let reqB = 0

  it('Rina creates + submits her own request in CS1 (Staff there); numbering is per PT: PB-CS1', async () => {
    const c = await api('POST', E, rina, draftB(), key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    reqB = c.body.id
    expect((await sqlAs('app', 'SELECT company_id FROM expense_requests WHERE id = $1', [reqB])).rows[0].company_id).toBe(b)
    const s = await api('POST', `${E}/${reqB}/submit`, rina, {}, key())
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    // own counter per PT: the first CS1 number starts at the sequence start (229, default), whatever DRMS issued
    expect(s.body.docNo).toMatch(/^229\/PB-CS1\/\d{2}\/[IVX]+\/\d{4}$/)
    const counters = await sqlAs('app', "SELECT company_id, next_value FROM document_sequence_counters WHERE doc_type = 'expense_request' AND period_key = 'ALL' AND company_id = $1", [b])
    expect(counters.rows).toEqual([{ company_id: b, next_value: 230 }])
  })

  it('approval holders are members of the document PT: DRMS Direktur → 404 on the CS1 request; CS1 Direktur + Finance decide', async () => {
    expect((await api('POST', `${E}/${reqB}/acknowledge`, w.users.owner, {}, key())).status).toBe(404)
    expect((await api('POST', `${E}/${reqB}/acknowledge`, ownerB, {}, key())).status).toBe(200)
    // Rina is Finance — but only in DRMS: in CS1 she is Staff (and the requester) → never the approver
    expect((await api('POST', `${E}/${reqB}/approve`, rina, {}, key())).status).toBe(403)
    const ok = await api('POST', `${E}/${reqB}/approve`, financeB, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
    // Finance of DRMS cannot transfer a CS1 request (no read access → 404)
    const proof = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
    expect(proof.status).toBe(201)
    expect([403, 404]).toContain((await api('POST', `${E}/${reqB}/transfer`, w.users.finance, { cashAccountId: B.cash, bankRef: 'X', proofMediaId: proof.body.id }, key())).status)
  })

  it('Rina approves a DRMS request as Finance of DRMS (role of the document PT)', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w), key())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    reqA = c.body.id
    expect((await api('POST', `${E}/${reqA}/submit`, w.users.staffA, {}, key())).status).toBe(200)
    expect((await api('POST', `${E}/${reqA}/acknowledge`, ownerB, {}, key())).status).toBe(404) // Direktur of CS1 only
    expect((await api('POST', `${E}/${reqA}/acknowledge`, w.users.owner, {}, key())).status).toBe(200)
    const ok = await api('POST', `${E}/${reqA}/approve`, rina, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.docNo).toMatch(/\/PB-DRMS\//)
  })

  it('a draft mixing PTs is refused (project of CS1 + category of DRMS) — app 400, before the DB trigger', async () => {
    const r = await api('POST', E, rina, draftB({ lines: [{ description: 'x', total: 1_000, categoryId: w.cat.ksm }] }), key())
    expect(r.status).toBe(400)
  })

  it('Payload create of a CS1 master by a DRMS-only Admin is refused; with a foreign reference → 400', async () => {
    expect((await api('POST', '/api/clients', w.users.admin, { name: 'Klien CS1', company: b })).status).toBe(403)
    const p = await getTestPayload()
    const clientA = await sysCreate('clients', { company: a, name: 'Klien DRMS MC' })
    await expect(p.create({ collection: 'projects', data: { company: b, code: 'MC-X', name: 'x', client: clientA } as never, overrideAccess: true /* SYSTEM-WRITE: test */ })).rejects.toMatchObject({ status: 400 })
  })
})

describe('MC1 — DB guards (raw SQL as the app role)', () => {
  it('cross-PT references are rejected by triggers (23514 cross-company reference)', async () => {
    const refs = [
      [`INSERT INTO team_assignments (employee_id, project_id, role_in_project, updated_at, created_at) VALUES (${B.empRina}, ${w.project}, 'staff', now(), now())`],
      [`INSERT INTO cash_entries (entry_no, entry_date, direction, amount, cash_account_id, project_id, source_type, status, uuid) VALUES ('MC/X/1', '2031-01-05', 'out', 1, ${B.cash}, ${w.project}, 'manual', 'posted', gen_random_uuid()::text)`],
      [`UPDATE expense_requests SET project_id = ${w.project} WHERE id = (SELECT id FROM expense_requests WHERE company_id = ${b} AND status = 'draft' LIMIT 1)`],
      [`INSERT INTO company_memberships (user_id, company_id, employee_id, active, updated_at, created_at) VALUES (${w.users.staffB.id}, ${b}, ${w.emp.b}, true, now(), now())`],
      [`UPDATE projects SET pm_id = ${w.users.pm.id} WHERE id = ${B.project2}`], // PM of DRMS is no member of CS1
    ]
    // a draft of CS1 for the UPDATE case
    const d = await api('POST', E, rina, draftB(), key())
    expect(d.status).toBe(201)
    for (const [q] of refs) {
      const e = await sqlError('app', q!)
      expect(e?.code, q).toBe('23514')
      expect(e?.message).toContain('cross-company reference')
    }
  })

  it('company_id is immutable and NOT NULL; codes are unique PER PT', async () => {
    expect((await sqlError('app', `UPDATE projects SET company_id = ${a} WHERE id = ${B.project}`))?.code).toBe('42501')
    expect((await sqlError('app', `INSERT INTO clients (name, updated_at, created_at) VALUES ('tanpa PT', now(), now())`))?.code).toBe('23502')
    // same category code KSM in both PTs (seed) — and a duplicate inside one PT is refused
    expect((await sqlAs('app', "SELECT count(DISTINCT company_id)::int AS n FROM expense_categories WHERE code = 'KSM'")).rows[0].n).toBeGreaterThanOrEqual(2)
    expect((await sqlError('app', `INSERT INTO expense_categories (company_id, code, name, updated_at, created_at) VALUES (${b}, 'KSM', 'dup', now(), now())`))?.code).toBe('23505')
  })

  it('closing a period of DRMS never locks CS1 (pk_cash_lock_date per company)', async () => {
    const period = '2025-01'
    await asUser(rina, async (req) => {
      try {
        await closePeriod(req, period, 'uji MC1', a)
      } catch (e) {
        if ((e as { status?: number }).status !== 409) throw e // already closed by another suite run
      }
    })
    // Rina is not Finance/Direktur of CS1 → cannot close CS1
    await expect(asUser(rina, (req) => closePeriod(req, period, 'uji', b))).rejects.toMatchObject({ status: 403 })
    const inB = await asUser(financeB, (req) => postEntry(req, { direction: 'in', entryDate: '2025-01-15', cashAccountId: B.cash, amount: 1_000, description: 'uji MC1', sourceType: 'manual' } as never))
    expect(inB.entryNo).toMatch(/^KM\/2501\//)
    await expect(asUser(w.users.finance, (req) => postEntry(req, { direction: 'in', entryDate: '2025-01-15', cashAccountId: w.cashAccount, amount: 1_000, description: 'uji MC1', sourceType: 'manual' } as never))).rejects.toMatchObject({ status: 409 })
    // and the DB says the same for raw inserts (lock date of the row's company)
    const raw = await sqlError('app', `INSERT INTO cash_entries (entry_no, entry_date, direction, amount, cash_account_id, source_type, status, uuid) VALUES ('MC/X/2', '2025-01-16', 'in', 1, ${w.cashAccount}, 'manual', 'posted', gen_random_uuid()::text)`)
    expect(raw?.code).toBe('42501')
  })

  it('audit rows of a per-PT document carry its PT; actor roles are those of that PT', async () => {
    const p = await getTestPayload()
    const doc = await p.create({ collection: 'vendors', data: { name: 'Vendor CS1 MC' }, user: financeB, overrideAccess: false, depth: 0 })
    expect((doc as { company?: number }).company).toBe(b)
    const rows = await sqlAs('app', "SELECT company_id, user_roles FROM audit_logs WHERE doc_type = 'vendor' AND doc_id = $1", [String(doc.id)])
    expect(rows.rows.every((r) => r.company_id === b && r.user_roles === 'pk-finance')).toBe(true)
    expect((await auditRows('vendor', doc.id)).length).toBeGreaterThan(0)
  })
})
