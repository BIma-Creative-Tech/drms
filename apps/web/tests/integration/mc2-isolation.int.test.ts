import { randomUUID } from 'node:crypto'

import { strFromU8, unzipSync } from 'fflate'
import { handleEndpoints, type CollectionSlug } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { attendanceScope, narrowAttScope, teamMembers } from '@/domain/attendance/queries'
import { recapEmployees } from '@/domain/attendance/web'
import { selfieRetentionPlan } from '@/domain/attendance/retention'
import { balances, closePeriod, lockDates, postEntry } from '@/domain/cash/ledger'
import { letterheadOf } from '@/domain/companies'
import { approvalInbox, transferQueue } from '@/domain/expense/queues'
import { runDailyReminders } from '@/domain/reminders/service'
import { adminDashboard, financeDashboard, ownerDashboard, pmDashboard } from '@/domain/reports/dashboards'
import { cashBalances, pendingApprovals, perCompany, requestRows, requestSummary } from '@/domain/reports/kpi'
import { AUDIT_REPORT } from '@/domain/reports/registry'
import { auditScope, ledgerCompanies, officeScope, roleScope, scopeCompanies } from '@/domain/reports/scope'
import { resetRateLimits } from '@/lib/rate-limit'
import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'
import config from '@/payload.config'

import { pdfText } from '../fixtures/pdf-text'
import { api, asUser, draftBody, makeFlowUser, makeWorld, ORIGIN, png, sysCreate, upload, type FlowUser, type World } from './flow-world'
import { accessToken, addMembership, companyId, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, withContext, type TestUser } from './helpers'

/**
 * MC2 isolation + consolidation suite (ADR 0016 §5–§8, requirements v1.2 §5/§6, US-MC-06/10/11):
 * three PTs in one DB — A = company #1 DRMS (world `MC2`), B = fictional "PT Contoh Dua" (CS2),
 * C = fictional "PT Contoh Tiga" (CS3) — and users with DIFFERENT roles per PT:
 *   dual  = Finance in A, PM in B          (office scope A + team scope B, never C)
 *   group = Direktur in A and in C          (consolidation A + C, never B)
 *   adminB, financeB, ownerB, staffB (B only), staffC, financeC (C only),
 *   dewi  = Staff in A and in B (one employee per PT) — sync COMPANY_MISMATCH.
 * Asserts that every report / KPI / dashboard / export / queue / notification / job result never
 * includes a PT the user lacks the role for, that combined totals = Σ per PT, and the per-PT /
 * group letterhead of the exports. B and C are deactivated in afterAll (other files assume one PT).
 */
let w: World
let A = 0
let B = 0
let C = 0
const X: Record<string, number> = {}
let dual: FlowUser
let group: FlowUser
let adminB: FlowUser
let financeB: FlowUser
let ownerB: FlowUser
let staffB: FlowUser
let staffC: FlowUser
let financeC: FlowUser
let dewi: FlowUser
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const ok = async (p: Promise<{ status: number; body: unknown }>, status = 200) => {
  resetRateLimits()
  const r = await p
  expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(status)
  return r.body as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function download(path: string, user: FlowUser) {
  resetRateLimits()
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { Origin: ORIGIN, Cookie: user.cookie } }) })
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { status: res.status, bytes, text: new TextDecoder().decode(bytes) }
}

/** Info dictionary entry of a pdfkit PDF (`/Author 17 0 R` → `17 0 obj (text) endobj`, literal or UTF-16BE hex). */
function pdfInfo(bytes: Uint8Array, name: string): string | null {
  const text = Buffer.from(bytes).toString('latin1')
  const ref = new RegExp(`/${name} (\\d+) 0 R`).exec(text)
  const obj = ref ? new RegExp(`\\n${ref[1]} 0 obj\\n([\\s\\S]*?)\\nendobj`).exec(text)?.[1] : new RegExp(`/${name}\\s*(\\([^\\n]*\\)|<[0-9A-Fa-f]+>)`).exec(text)?.[1]
  if (!obj) return null
  if (obj.startsWith('(')) return obj.slice(1, -1).replace(/\\([()\\])/g, '$1')
  const buf = Buffer.from(obj.slice(1, -1), 'hex')
  return buf[0] === 0xfe && buf[1] === 0xff ? buf.subarray(2).swap16().toString('utf16le') : buf.toString('latin1')
}

/** Request in PT `pt` by `by` through /api/v1 (draft → submit), optionally acknowledged / approved. */
async function request(pt: 'B' | 'C', by: FlowUser, opts: { total?: number; ack?: FlowUser; approve?: FlowUser } = {}): Promise<number> {
  const body = {
    type: 'advance',
    title: `MC2 ${pt}`,
    projectId: X[`project${pt}`],
    requesterIds: [X[`emp${pt}`]],
    bankAccountId: X[`acc${pt}`],
    neededDate: '2026-09-30',
    lines: [{ description: 'Material', total: opts.total ?? 250_000, categoryId: X[`cat${pt}`] }],
  }
  const d = await ok(api('POST', E, by, body, key()), 201)
  await ok(api('POST', `${E}/${d.id}/submit`, by, {}, key()))
  if (opts.ack) await ok(api('POST', `${E}/${d.id}/acknowledge`, opts.ack, {}, key()))
  if (opts.approve) await ok(api('POST', `${E}/${d.id}/approve`, opts.approve, {}, key()))
  return d.id as number
}

beforeAll(async () => {
  w = await makeWorld('MC2')
  A = await companyId()
  const p = await getTestPayload()
  const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
  await seed(p, {
    uoms,
    banks,
    companies: [
      drms,
      { ...drms, company: { name: 'PT Contoh Dua', shortCode: 'CS2', timezone: 'Asia/Makassar' }, vehicles: [] },
      { ...drms, company: { name: 'PT Contoh Tiga', shortCode: 'CS3', timezone: 'Asia/Makassar' }, vehicles: [] },
    ],
  })
  B = await companyId('CS2')
  C = await companyId('CS3')
  const inPt = async (company: number, collection: CollectionSlug, code: string) =>
    (await p.find({ collection, where: { and: [{ company: { equals: company } }, { code: { equals: code } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  X.catB = await inPt(B, 'expense-categories', 'MAT')
  X.catC = await inPt(C, 'expense-categories', 'MAT')
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number

  X.empB = await sysCreate('employees', { company: B, code: 'MC2-SB', name: 'Staf Contoh Dua' })
  X.empC = await sysCreate('employees', { company: C, code: 'MC2-SC', name: 'Staf Contoh Tiga' })
  X.empDualB = await sysCreate('employees', { company: B, code: 'MC2-PMB', name: 'PM Contoh Dua' })
  X.empDewiA = await sysCreate('employees', { company: A, code: 'MC2-DEWI', name: 'Dewi DRMS' })
  X.empDewiB = await sysCreate('employees', { company: B, code: 'MC2-DEWI', name: 'Dewi Contoh Dua' })

  dual = await makeFlowUser(['pk-finance'], 'mc2-dual', null)
  await addMembership(dual.id, B, ['pk-pm'], X.empDualB)
  dual = { ...dual, ...(await withContext(dual)) }
  group = await makeFlowUser(['pk-owner'], 'mc2-group', null)
  await addMembership(group.id, C, ['pk-owner'])
  group = { ...group, ...(await withContext(group)) }
  dewi = await makeFlowUser(['pk-staff'], 'mc2-dewi', X.empDewiA)
  await addMembership(dewi.id, B, ['pk-staff'], X.empDewiB)
  dewi = { ...dewi, ...(await withContext(dewi)) }
  adminB = await makeFlowUser(['pk-admin'], 'mc2-admin-b', null, { company: B, groupAdmin: false })
  financeB = await makeFlowUser(['pk-finance'], 'mc2-finance-b', null, { company: B })
  ownerB = await makeFlowUser(['pk-owner'], 'mc2-owner-b', null, { company: B })
  staffB = await makeFlowUser(['pk-staff'], 'mc2-staff-b', X.empB, { company: B })
  staffC = await makeFlowUser(['pk-staff'], 'mc2-staff-c', X.empC, { company: C })
  financeC = await makeFlowUser(['pk-finance'], 'mc2-finance-c', null, { company: C })

  X.projectB = await sysCreate('projects', { company: B, code: 'MC2-PB', name: 'Proyek Contoh Dua', pm: dual.id, budget: 40_000_000, status: 'berjalan' })
  X.projectB2 = await sysCreate('projects', { company: B, code: 'MC2-PB2', name: 'Proyek Contoh Dua lain', budget: 5_000_000, status: 'berjalan' })
  X.projectC = await sysCreate('projects', { company: C, code: 'MC2-PC', name: 'Proyek Contoh Tiga', budget: 1_000_000, status: 'berjalan' })
  for (const [emp, project] of [
    [X.empB, X.projectB],
    [X.empC, X.projectC],
    [X.empDewiB, X.projectB],
  ] as const)
    await sysCreate('team-assignments', { employee: emp, project, roleInProject: 'staff' })
  X.accB = await sysCreate('employee-bank-accounts', { employee: X.empB, bank, accountNo: `71${Date.now() % 1e8}`, accountHolder: 'Staf Contoh Dua', isDefault: true })
  X.accC = await sysCreate('employee-bank-accounts', { employee: X.empC, bank, accountNo: `72${Date.now() % 1e8}`, accountHolder: 'Staf Contoh Tiga', isDefault: true })
  X.accDewiB = await sysCreate('employee-bank-accounts', { employee: X.empDewiB, bank, accountNo: `73${Date.now() % 1e8}`, accountHolder: 'Dewi', isDefault: true })
  X.cashB = await sysCreate('cash-accounts', { company: B, name: 'MC2 Kas Contoh Dua', kind: 'bank', openingBalance: 20_000_000 })
  X.cashC = await sysCreate('cash-accounts', { company: C, name: 'MC2 Kas Contoh Tiga', kind: 'bank', openingBalance: 7_000_000 })

  // requests: A (world), B (staffB: one in the transfer queue, one waiting), C (staffC: approved → over budget)
  const a1 = await ok(api('POST', E, w.users.staffA, draftBody(w), key()), 201)
  await ok(api('POST', `${E}/${a1.id}/submit`, w.users.staffA, {}, key()))
  X.reqA = a1.id
  X.reqB1 = await request('B', staffB, { ack: ownerB, approve: financeB })
  X.reqB2 = await request('B', staffB)
  X.reqC1 = await request('C', staffC, { total: 1_500_000, ack: group, approve: financeC })
  X.reqC2 = await request('C', staffC)
  // manual cash per PT (Finance of THAT PT)
  const today = new Date().toISOString().slice(0, 10)
  await asUser(w.users.finance, (req) => postEntry(req, { direction: 'in', entryDate: today, cashAccountId: w.cashAccount, amount: 1_111_000, description: 'MC2 kas A', sourceType: 'manual' } as never))
  await asUser(financeB, (req) => postEntry(req, { direction: 'out', entryDate: today, cashAccountId: X.cashB, amount: 222_000, description: 'MC2 kas B', sourceType: 'manual' } as never))
  await asUser(financeC, (req) => postEntry(req, { direction: 'in', entryDate: today, cashAccountId: X.cashC, amount: 333_000, description: 'MC2 kas C', sourceType: 'manual' } as never))
})

afterAll(async () => {
  const p = await getTestPayload()
  for (const id of [B, C]) if (id) await p.update({ collection: 'companies', id, data: { active: false, changeReason: 'uji MC2 selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await sqlAs('app', 'UPDATE company_settings SET group_name = NULL, group_pdf_header = NULL')
  await p.destroy()
})

const companyOfRequests = async (ids: number[]) =>
  ids.length ? (await sqlAs('app', 'SELECT DISTINCT company_id FROM expense_requests WHERE id = ANY($1::int[])', [ids])).rows.map((r) => Number(r.company_id)).sort((x, y) => x - y) : []

describe('MC2 — scopes per PT (role IN each PT)', () => {
  it('dual: office scope = A (all) + B (team, own projects only); never C; ledger = A only', async () => {
    const s = await asUser(dual, (req) => officeScope(req))
    expect(s.companies).toEqual([
      { company: A, kind: 'all' },
      { company: B, kind: 'team', projects: [X.projectB], costCenters: [] },
    ])
    expect(ledgerCompanies(s)).toEqual([A])
    const rows = await asUser(dual, (req) => requestRows(req, s, { from: '2000-01-01', to: '2999-12-31' }, { limit: 500 }))
    const ids = rows.map((r) => r.id)
    expect(ids).toEqual(expect.arrayContaining([X.reqA, X.reqB1, X.reqB2]))
    expect(ids).not.toContain(X.reqC1)
    expect(new Set(rows.map((r) => r.companyId))).toEqual(new Set([A, B]))
    // B rows only of the team project
    const bRows = (await sqlAs('app', 'SELECT id, project_id FROM expense_requests WHERE id = ANY($1::int[]) AND company_id = $2', [ids, B])).rows
    expect(bRows.every((r) => Number(r.project_id) === X.projectB)).toBe(true)
    // cash ledger: A accounts only
    const bal = await asUser(dual, (req) => cashBalances(req, s, '2999-12-31'))
    expect(bal.accounts.length).toBeGreaterThan(0)
    expect(bal.accounts.every((a) => a.companyId === A)).toBe(true)
    expect(bal.accounts.map((a) => a.id)).not.toContain(X.cashB)
  })

  it('a company-blind { kind: "all" } literal matches nothing (fail closed)', async () => {
    const rows = await asUser(group, (req) => requestRows(req, { kind: 'all' }, { from: '2000-01-01', to: '2999-12-31' }, { limit: 50 }))
    expect(rows).toEqual([])
  })

  it('selection narrows: dual with X-Company-Ids-like selection [B] has no A office scope', async () => {
    const narrowed = { ...dual, ...(await withContext(dual, [B])) }
    const s = await asUser(narrowed as FlowUser, (req) => officeScope(req))
    expect(scopeCompanies(s)).toEqual([B])
    expect(ledgerCompanies(s)).toEqual([])
  })
})

describe('MC2 — dashboards: per-PT breakdown + combined total, only PTs of the role', () => {
  it('group (Direktur A + C): owner dashboard covers A and C, Σ per PT = total, never B', async () => {
    const d = await asUser(group, (req) => ownerDashboard(req))
    expect(d.companies.map((c) => c.id)).toEqual([A, C])
    expect(d.cash.byCompany.map((b) => b.companyId)).toEqual([A, C])
    expect(d.cash.byCompany.reduce((s, b) => s + b.total, 0)).toBe(d.cash.total)
    expect(d.cash.accounts.every((a) => a.companyId === A || a.companyId === C)).toBe(true)
    expect(d.cash.accounts.map((a) => a.id)).not.toContain(X.cashB)
    expect(d.approvals.byCompany.reduce((s, b) => s + b.count, 0)).toBe(d.approvals.count)
    expect(d.approvals.byCompany.reduce((s, b) => s + b.sum, 0)).toBe(d.approvals.sum)
    expect(d.transferQueue.byCompany.reduce((s, b) => s + b.count, 0)).toBe(d.transferQueue.count)
    expect(d.budget.byCompany.reduce((s, b) => s + b.running, 0)).toBe(d.budget.running)
    expect(d.completeness.byCompany.map((b) => b.companyId)).toEqual([A, C])
    expect(d.projects.every((p) => p.companyId === A || p.companyId === C)).toBe(true)
    expect(d.projects.map((p) => p.id)).toContain(X.projectC)
    expect(d.projects.map((p) => p.id)).not.toContain(X.projectB)
    // per-PT numbers reconcile with SQL restricted to that PT
    for (const c of [A, C]) {
      const sql = await sqlAs('app', "SELECT count(*)::int AS n, coalesce(sum(grand_total),0)::text AS s FROM expense_requests WHERE company_id = $1 AND status IN ('pending_ack','pending_approval')", [c])
      const row = d.approvals.byCompany.find((b) => b.companyId === c)!
      expect([row.count, row.sum], `PT ${c}`).toEqual([sql.rows[0].n, Number(sql.rows[0].s)])
      const cash = await sqlAs(
        'app',
        `SELECT (SELECT coalesce(sum(opening_balance),0) FROM cash_accounts WHERE company_id = $1)
              + (SELECT coalesce(sum(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM cash_entries WHERE company_id = $1 AND entry_date <= $2) AS t`,
        [c, d.asOf],
      )
      expect(d.cash.byCompany.find((b) => b.companyId === c)!.total, `cash PT ${c}`).toBe(Number(cash.rows[0].t))
    }
  })

  it('dual: finance dashboard = A only; PM dashboard = B team only', async () => {
    const f = await asUser(dual, (req) => financeDashboard(req))
    expect(f.companies.map((c) => c.id)).toEqual([A])
    expect(f.accounts.every((a) => a.companyId === A)).toBe(true)
    expect(f.cashByCompany.map((b) => b.companyId)).toEqual([A])
    expect(f.lastClosedByCompany.map((b) => b.companyId)).toEqual([A])
    expect(f.viz.transferTop.every((t) => t.companyId === A)).toBe(true)
    const pm = await asUser(dual, (req) => pmDashboard(req))
    expect(pm.companies.map((c) => c.id)).toEqual([B])
    expect(pm.projects.map((p) => p.id)).toEqual([X.projectB])
    expect(pm.teamMonthByCompany.map((t) => t.companyId)).toEqual([B])
  })

  it('adminB: admin dashboard = PT B only (+ rows without PT), gaps per PT', async () => {
    const d = await asUser(adminB, (req) => adminDashboard(req))
    expect(d.companies.map((c) => c.id)).toEqual([B])
    expect(d.gaps.byCompany.map((g) => g.companyId)).toEqual([B])
    expect(d.latestAudit.every((r) => r.companyId === B || r.companyId === null)).toBe(true)
    expect(d.gaps.projectsWithoutPm).toBe((await sqlAs('app', "SELECT count(*)::int AS n FROM projects WHERE company_id = $1 AND pm_id IS NULL AND status <> 'arsip'", [B])).rows[0].n)
  })

  it('perCompany / requestSummary: Σ per PT = combined total (K-13)', async () => {
    const [sum, parts] = await asUser(group, async (req) => {
      const s = await roleScope(req, ['pk-owner'])
      return [await requestSummary(req, s, { from: '2000-01-01', to: '2999-12-31' }), await perCompany(s, (x) => requestSummary(req, x, { from: '2000-01-01', to: '2999-12-31' }))] as const
    })
    expect(parts.map((p) => p.companyId)).toEqual([A, C])
    expect(parts.reduce((a, p) => a + p.value.total.count, 0)).toBe(sum.total.count)
    expect(sum.byCompany.reduce((a, p) => a + p.sum, 0)).toBe(sum.total.sum)
    for (const p of parts) expect(sum.byCompany.find((b) => b.companyId === p.companyId)!.count).toBe(p.value.total.count)
  })
})

describe('MC2 — reports: PT parameter, PT column, subtotal per PT', () => {
  it('group: rekap-pengajuan spans A + C with a PT column and "Subtotal per PT" (Σ = total); never B', async () => {
    const r = await ok(api('GET', '/api/v1/reports/rekap-pengajuan?dari=2000-01-01&sampai=2999-12-31', group))
    expect(r.companies.map((c: { shortCode: string }) => c.shortCode)).toEqual(['DRMS', 'CS3'])
    expect(r.main.columns[0].key).toBe('pt')
    expect(new Set(r.main.rows.map((x: { pt: string }) => x.pt))).toEqual(new Set(['DRMS', 'CS3']))
    const sub = r.extra.find((t: { key: string }) => t.key === 'subtotal-pt')
    expect(sub.rows.map((x: { pt: string }) => x.pt)).toEqual(['DRMS', 'CS3'])
    expect(sub.totals.grandTotal).toBe(r.main.totals.grandTotal)
    expect(sub.rows.reduce((a: number, x: { grandTotal: number }) => a + x.grandTotal, 0)).toBe(r.main.totals.grandTotal)
    // the filter field lists the caller's PTs only
    const pc = await ok(api('GET', `/api/v1/reports/rekap-pengajuan?dari=2000-01-01&sampai=2999-12-31&pt=${C}`, group))
    expect(pc.companies.map((c: { id: number }) => c.id)).toEqual([C])
    expect(pc.main.columns[0].key).not.toBe('pt')
    // a foreign PT in `pt` never widens: B for group → nothing
    const foreign = await ok(api('GET', `/api/v1/reports/rekap-pengajuan?dari=2000-01-01&sampai=2999-12-31&pt=${B}`, group))
    expect(foreign.count).toBe(0)
  })

  it('dual: anggaran-project = A projects + B team project; rekap-kas (Finance) = A ledger only', async () => {
    const r = await ok(api('GET', '/api/v1/reports/anggaran-project', dual))
    expect(new Set(r.main.rows.map((x: { pt: string }) => x.pt))).toEqual(new Set(['DRMS', 'CS2']))
    const bRows = r.main.rows.filter((x: { pt: string }) => x.pt === 'CS2')
    expect(bRows.map((x: { project: string }) => x.project)).toEqual(['MC2-PB Proyek Contoh Dua'])
    const kas = await ok(api('GET', '/api/v1/reports/rekap-kas', dual))
    const saldo = kas.extra.find((t: { key: string }) => t.key === 'saldo')
    expect(saldo.rows.map((x: { akun: string }) => x.akun)).not.toContain('MC2 Kas Contoh Dua')
  })

  it('audit log: adminB sees PT B rows (+ rows without PT); dual (Finance A) only PT A rows', async () => {
    const sp = new URLSearchParams({ dari: '2000-01-01', sampai: '2999-12-31' })
    const b = await asUser(adminB, async (req) => AUDIT_REPORT.run(req, await auditScope(req), sp, { limit: 100 }))
    expect(b.main.rows.length).toBeGreaterThan(0)
    expect(b.main.rows.every((r) => r.company === B || r.company === null)).toBe(true)
    const legacy = await asUser(adminB, (req) => AUDIT_REPORT.run(req, { kind: 'all' }, sp, { limit: 100 }))
    expect(legacy.main.rows.every((r) => r.company === B || r.company === null)).toBe(true)
    const d = await asUser(dual, async (req) => AUDIT_REPORT.run(req, await auditScope(req), sp, { limit: 100 }))
    expect(d.main.rows.every((r) => r.company === A)).toBe(true)
  })
})

describe('MC2 — exports: letterhead per PT, group letterhead for > 1 PT', () => {
  it('letterheadOf: one PT → its name; several → group name or "Laporan gabungan: …"', async () => {
    await sqlAs('app', 'UPDATE company_settings SET group_name = NULL, group_pdf_header = NULL') // another file may have set one
    const one = await asUser(group, (req) => letterheadOf(req, [C]))
    expect(one).toMatchObject({ kind: 'company', name: 'PT Contoh Tiga' })
    const many = await asUser(group, (req) => letterheadOf(req, [A, C]))
    expect(many).toMatchObject({ kind: 'group', name: 'Laporan gabungan: DRMS, CS3' })
  })

  it('PDF: pt=C → PT Contoh Tiga letterhead; A + C → group letterhead with the PT list', async () => {
    const one = await download(`/api/v1/reports/anggaran-project/pdf?pt=${C}`, group)
    expect(one.status).toBe(200)
    const t1 = pdfText(Buffer.from(one.bytes))
    expect(t1).toContain('PT Contoh Tiga')
    expect(t1).not.toContain('Laporan gabungan')
    // raw SQL (not the audited Local API): audit.int.test looks for ITS groupName audit row; the global row
    // exists only after a first save → create it without touching the group fields
    if ((await sqlAs('app', 'SELECT 1 FROM company_settings')).rows.length === 0) {
      await (await getTestPayload()).updateGlobal({ slug: 'company-settings', data: {} as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    }
    await sqlAs('app', 'UPDATE company_settings SET group_name = $1, group_pdf_header = $2', ['Grup Contoh Sejahtera', 'Jl. Contoh No. 1'])
    const both = await download('/api/v1/reports/anggaran-project/pdf', group)
    expect(both.status).toBe(200)
    const t2 = pdfText(Buffer.from(both.bytes))
    expect(t2).toContain('Grup Contoh Sejahtera')
    expect(t2).toContain('Jl. Contoh No. 1')
    expect(t2).toContain('CS3')
    expect(t2).toContain('Subtotal per PT')
    // PDF metadata: Author = letterhead name, Subject = PT list
    expect(pdfInfo(both.bytes, 'Author')).toBe('Grup Contoh Sejahtera')
    expect(pdfInfo(both.bytes, 'Subject')).toBe('PT: DRMS, CS3')
    expect(pdfInfo(one.bytes, 'Author')).toBe('PT Contoh Tiga')
  })

  it('XLSX / CSV: title row 2 = letterhead of the effective PTs; PT column when > 1 PT', async () => {
    const x = await download(`/api/v1/reports/rekap-pengajuan/xlsx?dari=2000-01-01&sampai=2999-12-31&pt=${A}`, group)
    expect(x.status).toBe(200)
    const files = unzipSync(x.bytes)
    const all = Object.entries(files)
      .filter(([f]) => f.endsWith('.xml'))
      .map(([, v]) => strFromU8(v))
      .join('\n')
    const drmsName = (await sqlAs('app', 'SELECT name FROM companies WHERE id = $1', [A])).rows[0].name as string
    expect(all).toContain(drmsName.replace(/&/g, '&amp;'))
    expect(all).not.toContain('PT Contoh Tiga')
    const csv = await download('/api/v1/reports/rekap-pengajuan/csv?dari=2000-01-01&sampai=2999-12-31', group)
    const lines = csv.text.replace(/^﻿/, '').split('\r\n')
    expect(lines[1]).toContain('Grup Contoh Sejahtera')
    expect(csv.text).toContain('PT;Nomor;Tanggal')
    expect(csv.text).not.toMatch(/\nCS2;/)
  })
})

describe('MC2 — queues and Kas per PT', () => {
  it('approval inbox: items carry their PT; group sees A + C items only; the PT filter narrows', async () => {
    const inbox = await asUser(group, (req) => approvalInbox(req))
    expect(inbox.items.length).toBeGreaterThan(0)
    expect(inbox.items.every((i) => i.company?.id === A || i.company?.id === C)).toBe(true)
    expect(inbox.items.map((i) => i.id)).toContain(X.reqC2)
    const onlyC = await asUser(group, (req) => approvalInbox(req, { companyIds: [C] }))
    expect(onlyC.items.every((i) => i.company?.shortCode === 'CS3')).toBe(true)
    const q = await asUser(financeB, (req) => transferQueue(req))
    expect(q.map((i) => i.id)).toContain(X.reqB1)
    expect(q.every((i) => i.company?.id === B)).toBe(true)
  })

  it('balances: Kas PTs of the caller only; closing names its PT when ambiguous; closing C never locks A', async () => {
    const bal = await asUser(dual, (req) => balances(req))
    expect(bal.every((b) => b.companyId === A)).toBe(true)
    const g = await asUser(group, (req) => balances(req))
    expect(new Set(g.map((b) => b.companyId))).toEqual(new Set([A, C]))
    // group is Direktur in A and C → a close without company is ambiguous
    await expect(asUser(group, (req) => closePeriod(req, '2024-02', 'uji MC2'))).rejects.toMatchObject({ status: 400 })
    await asUser(group, (req) => closePeriod(req, '2024-02', 'uji MC2', C))
    const locks = await asUser(group, (req) => lockDates(req, [A, C]))
    expect(locks.find((l) => l.companyId === C)!.lockDate).toBe('2024-02-29')
    expect(locks.find((l) => l.companyId === A)!.lockDate ?? '0000').not.toBe('2024-02-29')
    // Finance of A cannot post into / edit the ledger of B (the endpoint role is "Finance in any PT")
    const post = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', cashAccountId: X.cashB, amount: 1_000, description: 'x', cashInSourceId: w.cashInSource }, key())
    expect(post.status).toBe(400)
    const entryB = (await sqlAs('app', 'SELECT id FROM cash_entries WHERE company_id = $1 ORDER BY id DESC LIMIT 1', [B])).rows[0].id
    expect((await api('POST', `/api/v1/cash-entries/${entryB}/void`, w.users.finance, { reason: 'uji MC2' }, key())).status).toBe(404)
    // period list: one lock date per readable PT
    const periods = await ok(api('GET', '/api/v1/period-closings', group))
    expect(periods.lockDates.map((l: { companyId: number }) => l.companyId)).toEqual([A, C])
  })
})

describe('MC2 — attendance per PT', () => {
  it('adminB: scope = PT B in full; recap employees of B only; a project of A narrows to nothing', async () => {
    const scope = await asUser(adminB, (req) => attendanceScope(req))
    expect(scope?.parts).toEqual([{ company: B, all: true, projects: [], costCenters: [] }])
    const emps = await asUser(adminB, (req) => recapEmployees(req, scope!, '2026-01-01', '2026-12-31'))
    expect(emps.length).toBeGreaterThan(0)
    const pts = (await sqlAs('app', 'SELECT DISTINCT company_id FROM employees WHERE id = ANY($1::int[])', [emps.map((e) => e.id)])).rows.map((r) => Number(r.company_id))
    expect(pts).toEqual([B])
    const narrowed = narrowAttScope(scope!, w.project)
    expect(await asUser(adminB, (req) => teamMembers(req, narrowed, '2026-01-01', '2026-12-31'))).toEqual([])
    const own = narrowAttScope(scope!, X.projectB)
    expect((await asUser(adminB, (req) => teamMembers(req, own, '2020-01-01', '2999-12-31'))).map((m) => m.employeeId)).toEqual(expect.arrayContaining([X.empB]))
  })
})

describe('MC2 — jobs loop per PT with that PT settings', () => {
  it('reminders: a run of PT C notifies holders IN C only (rows tagged C); the loop runs every active PT', async () => {
    const p = await getTestPayload()
    const r = await runDailyReminders(p, { force: true, companyId: C })
    expect(r.companies.map((c) => c.companyId)).toEqual([C])
    expect(r.rules.budget_threshold?.subjects ?? 0).toBeGreaterThan(0) // C request 1.5 jt on a 1 jt RAB
    const rows = await sqlAs('app', "SELECT user_id, company_id FROM notifications WHERE event = 'reminder.budget_threshold' AND doc_id = $1", [String(X.projectC)])
    expect(rows.rows.length).toBeGreaterThan(0)
    for (const x of rows.rows) {
      expect(Number(x.company_id)).toBe(C)
      const m = await sqlAs('app', 'SELECT 1 FROM company_memberships WHERE user_id = $1 AND company_id = $2', [x.user_id, C])
      expect(m.rows.length, `recipient ${x.user_id} is a member of C`).toBe(1)
    }
    const uids = rows.rows.map((x) => Number(x.user_id))
    expect(uids).toContain(group.id)
    expect(uids).not.toContain(w.users.owner.id)
    expect(uids).not.toContain(ownerB.id)
    const runs = await sqlAs('app', 'SELECT company_id FROM reminder_runs WHERE company_id = $1', [C])
    expect(runs.rows.length).toBeGreaterThan(0)
    const all = await runDailyReminders(p, { force: true })
    expect(all.companies.map((c) => c.companyId)).toEqual(expect.arrayContaining([A, B, C]))
    // B and C run; A may be switched off by another file's fixture (reminders toggles of DRMS)
    for (const c of all.companies.filter((x) => x.companyId !== A)) expect(c.status, `PT ${c.companyId}`).toBe('run')
  })

  it('selfie retention: months per PT (C = 1 month, A = 12) — a C selfie is a C candidate only', async () => {
    const p = await getTestPayload()
    await p.update({ collection: 'companies', id: C, data: { selfieRetentionMonths: 1 } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer()
    const selfie = await p.create({ collection: 'media-selfies', data: {}, file: { data: jpeg, mimetype: 'image/jpeg', name: 'mc2.jpg', size: jpeg.length }, user: staffC, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    await sqlAs(
      'app',
      `INSERT INTO attendances (employee_id, user_id, kind, project_id, local_date, attendance_time, received_at, time_trust, offline, lat, lng, distance_m, selfie_id, client_uuid, source, updated_at, created_at)
       VALUES ($1, $2, 'check_in', $3, '2026-09-01', now(), now(), 'server', false, -2.2, 113.9, 5, $4, $5, 'self', now(), now())`,
      [X.empC, staffC.id, X.projectC, selfie.id, randomUUID()],
    )
    const plan = await selfieRetentionPlan(p, new Date(Date.now() + 40 * 86_400_000))
    const byPt = new Map(plan.byCompany.map((b) => [b.companyId, b]))
    expect(byPt.get(C)!.months).toBe(1)
    expect(byPt.get(C)!.sampleIds).toContain(selfie.id)
    expect(byPt.get(A)!.months).toBe(12)
    expect(byPt.get(A)!.sampleIds).not.toContain(selfie.id)
  })
})

describe('MC2 — media of office roles per PT', () => {
  it('Finance of A cannot read the transfer proof of a B request; Finance of B can', async () => {
    const proof = await upload('/api/v1/media/transfer-proofs', financeB, await png())
    expect(proof.status).toBe(201)
    await ok(api('POST', `${E}/${X.reqB1}/transfer`, financeB, { cashAccountId: X.cashB, bankRef: 'MC2-B', proofMediaId: proof.body.id }, key()), 201)
    expect((await api('GET', `/api/v1/media/transfer-proofs/${proof.body.id}/file`, financeB)).status).toBe(200)
    expect((await api('GET', `/api/v1/media/transfer-proofs/${proof.body.id}/file`, w.users.finance)).status).toBe(404)
    const list = await api('GET', '/api/media-transfer-proofs?limit=500&depth=0', w.users.finance)
    expect(list.status).toBe(200)
    expect((list.body.docs as Array<{ id: number }>).map((d) => d.id)).not.toContain(proof.body.id)
    // the group Direktur (A + C) does not see B files either
    expect((await api('GET', `/api/v1/media/transfer-proofs/${proof.body.id}/file`, group)).status).toBe(404)
  })
})

describe('MC2 — sync: items are processed under their own PT (COMPANY_MISMATCH)', () => {
  it('dewi (Staff A + B): a B draft sent under X-Company-Ids A is rejected COMPANY_MISMATCH; under B it applies', async () => {
    await installLocalJwks()
    const p = await getTestPayload()
    const doc = await p.findByID({ collection: 'users', id: dewi.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
    const t: TestUser = { ...dewi, keycloakSub: doc.keycloakSub as string }
    const token = await accessToken(t, ['pk-user'])
    const device = await registerDevice(t, token)
    const item = () => ({
      client_uuid: randomUUID(),
      type: 'expense_request.draft_upsert',
      schema_version: 1,
      offline: true,
      device_time: new Date().toISOString(),
      elapsed_ms: 10_000_000,
      payload: { kind: 'advance', title: 'MC2 sync', project_id: X.projectB, requester_ids: [X.empDewiB], bank_account_id: X.accDewiB, needed_date: '2026-09-30', lines: [{ description: 'x', total: 10_000, category_id: X.catB }] },
    })
    const send = async (pt: number) => {
      resetRateLimits()
      const now = Date.now()
      const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'b', last_server_time: new Date(now - 60_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 60_000 }
      const r = await http('POST', '/api/v1/sync/batch', {
        headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': device, 'X-App-Version': '1.0.0', 'X-Company-Ids': String(pt) },
        json: { batch_id: randomUUID(), device_id: device, clock, items: [item()] },
      })
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      return (r.body as { results: Array<{ status: string; errors: Array<{ code: string }> }> }).results[0]!
    }
    const wrong = await send(A)
    expect(wrong.status).toBe('rejected')
    expect(wrong.errors.map((e) => e.code)).toEqual(['COMPANY_MISMATCH'])
    const right = await send(B)
    expect(right.status, JSON.stringify(right)).toBe('applied')
  })
})

describe('MC2 — per-PT decisions of dual roles', () => {
  it('dual (Finance A, PM B) cannot approve a B request; the internal PDF of a B request is refused', async () => {
    const id = await request('B', staffB, { ack: ownerB })
    expect([403, 404]).toContain((await api('POST', `${E}/${id}/approve`, dual, {}, key())).status)
    const pdf = await api('GET', `${E}/${X.reqB2}/pdf?variant=internal`, dual)
    expect(pdf.status).toBe(403)
    // PT of the list scope "team": B rows of the team project only, A rows in full
    const list = await ok(api('GET', `${E}?scope=team&limit=100`, dual))
    const ids = (list.items as Array<{ id: number }>).map((x) => x.id)
    expect(await companyOfRequests(ids)).toEqual([A, B].sort((x, y) => x - y))
    expect(ids).not.toContain(X.reqC1)
  })

  it('pending approvals KPI of group never counts B', async () => {
    const k = await asUser(group, async (req) => pendingApprovals(req, await roleScope(req, ['pk-owner'])))
    expect(k.byCompany.map((b) => b.companyId)).toEqual([A, C])
    const total = await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE company_id = ANY($1::int[]) AND status IN ('pending_ack','pending_approval')", [[A, C]])
    expect(k.count).toBe(total.rows[0].n)
  })
})

describe('MC2 — per-user system collections per PT', () => {
  it('audit-logs REST: Finance of B sees only B rows (no untagged); web sessions: Admin of B only users of B', async () => {
    const a = await api('GET', '/api/audit-logs?limit=500&depth=0', financeB)
    expect(a.status).toBe(200)
    expect((a.body.docs as Array<{ company?: number | null }>).every((d) => d.company === B)).toBe(true)
    const s = await api('GET', '/api/web-sessions?limit=500&depth=0', adminB)
    expect(s.status).toBe(200)
    const users = [...new Set((s.body.docs as Array<{ user: number }>).map((d) => d.user))]
    expect(users).toContain(adminB.id)
    expect(users).not.toContain(w.users.admin.id)
    for (const u of users) {
      const m = await sqlAs('app', 'SELECT company_id FROM company_memberships WHERE user_id = $1', [u])
      expect(m.rows.length === 0 || m.rows.some((r) => Number(r.company_id) === B), `user ${u}`).toBe(true)
    }
  })
})

describe('MC2 — role matrix batch save (all-or-nothing)', () => {
  it('Admin of B: a batch with one item of another PT is refused entirely; a B-only batch saves + audits role_change with the reason', async () => {
    const before = (await sqlAs('app', 'SELECT roles FROM (SELECT m.id, array_agg(r.value ORDER BY r.value) AS roles FROM company_memberships m LEFT JOIN company_memberships_roles r ON r.parent_id = m.id WHERE m.user_id = $1 AND m.company_id = $2 GROUP BY m.id) x', [staffB.id, B])).rows[0].roles
    const mixed = await api('POST', '/api/v1/company-memberships/batch', adminB, { reason: 'uji matriks MC2', items: [{ user: staffB.id, company: B, roles: ['pk-staff', 'pk-pm'] }, { user: staffB.id, company: A, roles: ['pk-admin'] }] }, key())
    expect(mixed.status).toBe(403)
    const still = (await sqlAs('app', 'SELECT array_agg(r.value ORDER BY r.value) AS roles FROM company_memberships m LEFT JOIN company_memberships_roles r ON r.parent_id = m.id WHERE m.user_id = $1 AND m.company_id = $2 GROUP BY m.id', [staffB.id, B])).rows[0].roles
    expect(still).toEqual(before)
    expect((await sqlAs('app', 'SELECT 1 FROM company_memberships WHERE user_id = $1 AND company_id = $2', [staffB.id, A])).rows.length).toBe(0)
    const ok2 = await api('POST', '/api/v1/company-memberships/batch', adminB, { reason: 'uji matriks MC2', items: [{ user: staffB.id, company: B, roles: ['pk-staff', 'pk-pm'] }, { user: adminB.id, company: B, roles: ['pk-admin'] }] }, key())
    expect(ok2.status, JSON.stringify(ok2.body)).toBe(200)
    expect(ok2.body.items.map((i: { roles: string[] }) => i.roles)).toEqual([['pk-pm', 'pk-staff'], ['pk-admin']])
    const audit = await sqlAs('app', "SELECT action, reason, company_id FROM audit_logs WHERE doc_type = 'company_membership' AND action = 'role_change' AND reason = 'uji matriks MC2'")
    expect(audit.rows.length).toBeGreaterThan(0)
    expect(audit.rows.every((r) => Number(r.company_id) === B)).toBe(true)
    // restore
    await ok(api('POST', '/api/v1/company-memberships/batch', adminB, { reason: 'uji matriks MC2 kembali', items: [{ user: staffB.id, company: B, roles: ['pk-staff'] }] }, key()))
  })
})
