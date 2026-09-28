import { APIError, type Payload, type PayloadRequest } from 'payload'

import { isRole, relId, soleCompany, type Role } from '@/access/roles'
import type { Company, CompanySetting } from '@/payload-types'

/**
 * Company (PT) helpers for domain code (ADR 0016). Everything here is a SYSTEM-READ; callers have
 * already checked that the caller may act on the document / PT in question.
 */

export type EffectiveSettings = Omit<CompanySetting, 'id' | 'updatedAt' | 'createdAt'> & Omit<Company, 'id' | 'updatedAt' | 'createdAt'> & { companyId: number }

const CACHE = 'pkCompanyCache'

function cache(req: PayloadRequest): Map<number, Company> {
  req.context ??= {}
  let m = req.context[CACHE] as Map<number, Company> | undefined
  if (!m) {
    m = new Map()
    req.context[CACHE] = m
  }
  return m
}

export async function companyById(req: PayloadRequest, id: number): Promise<Company> {
  const c = cache(req)
  const hit = c.get(id)
  if (hit) return hit
  const doc = (await req.payload.findByID({ collection: 'companies', id, depth: 0, overrideAccess: true /* SYSTEM-READ: company settings */, req, disableErrors: true })) as Company | null
  if (!doc) throw new APIError('PT tidak ditemukan.', 404, null, true)
  c.set(id, doc)
  return doc
}

/** Lowest-id ACTIVE company (= #1 DRMS on every deployment created by migration `*_mc1_companies`). */
export async function firstActiveCompanyId(payload: Payload, req?: PayloadRequest): Promise<number> {
  const res = await payload.find({
    collection: 'companies',
    where: { active: { equals: true } },
    sort: 'id',
    limit: 1,
    depth: 0,
    select: { shortCode: true },
    overrideAccess: true, // SYSTEM-READ: default company
    ...(req ? { req } : {}),
  })
  const id = res.docs[0]?.id as number | undefined
  if (id === undefined) throw new APIError('Belum ada PT aktif.', 500)
  return id
}

/** Active company ids (jobs loop, MC2). */
export async function activeCompanyIds(payload: Payload, req?: PayloadRequest): Promise<number[]> {
  const res = await payload.find({
    collection: 'companies',
    where: { active: { equals: true } },
    sort: 'id',
    depth: 0,
    pagination: false,
    select: { shortCode: true },
    overrideAccess: true, // SYSTEM-READ: active companies
    ...(req ? { req } : {}),
  })
  return res.docs.map((d) => d.id as number)
}

/**
 * PT whose settings apply when the caller has no document at hand: the caller's only selected PT,
 * else company #1. Domain callers pass the document's PT (`settings(req, company)`); remaining
 * company-less callers are UI/context hints (MC2 review, see docs/proyekkas/mc/mc2-progress.md).
 */
export async function contextCompanyId(req: PayloadRequest): Promise<number> {
  return soleCompany(req) ?? firstActiveCompanyId(req.payload, req)
}

/**
 * PT of a new per-PT master created WITHOUT an explicit company: the caller's only selected PT;
 * a system write (no user) → the only active PT. Ambiguous → 400 (the PT must be named).
 */
export async function defaultCompanyForWrite(req: PayloadRequest): Promise<number> {
  if (req.user) {
    const c = soleCompany(req)
    if (c === undefined) throw new APIError('PT wajib dipilih.', 400, null, true)
    return c
  }
  const ids = await activeCompanyIds(req.payload, req)
  if (ids.length !== 1) throw new APIError('PT wajib dipilih.', 400, null, true)
  return ids[0]!
}

/** Short reference of a PT (labels, PT columns, breakdown rows). */
export type CompanyRef = { id: number; shortCode: string; name: string }

/** References of `ids` (SYSTEM-READ via the per-request cache), in the given order; unknown ids skipped. */
export async function companyRefs(req: PayloadRequest, ids: readonly number[]): Promise<CompanyRef[]> {
  const out: CompanyRef[] = []
  for (const id of [...new Set(ids)]) {
    const c = await companyById(req, id).catch(() => null)
    if (c) out.push({ id, shortCode: c.shortCode, name: c.name })
  }
  return out
}

/**
 * Letterhead of a report / export over `companyIds` (requirements v1.2 §6, ADR 0016 §6): one PT →
 * that PT's name, logo, PDF header, address and phone; several PTs → the GROUP letterhead of the
 * app-wide settings (groupName / groupLogo / groupPdfHeader) — or, when the group name is empty,
 * "Laporan gabungan: DRMS, CS1". `companies` = the PTs covered (PT list line of the header).
 */
export type Letterhead = { kind: 'company' | 'group'; name: string; lines: string[]; logo: number | null; companies: CompanyRef[] }

export async function letterheadOf(req: PayloadRequest, companyIds: readonly number[]): Promise<Letterhead> {
  const refs = await companyRefs(req, [...companyIds].sort((a, b) => a - b))
  if (refs.length === 1) {
    const c = await companyById(req, refs[0]!.id)
    const lines = [...(c.pdfHeader ?? '').split('\n'), c.address ?? '', c.phone ? `Telp. ${c.phone}` : ''].map((l) => l.trim()).filter(Boolean)
    return { kind: 'company', name: c.name, lines, logo: relId(c.logo) ?? null, companies: refs }
  }
  const app = await appSettings(req)
  const g = app as { groupName?: string | null; groupPdfHeader?: string | null; groupLogo?: unknown }
  const list = refs.map((r) => r.shortCode).join(', ')
  const name = g.groupName?.trim() || `Laporan gabungan: ${list}`
  const lines = [...(g.groupPdfHeader ?? '').split('\n').map((l) => l.trim()).filter(Boolean), ...(g.groupName?.trim() ? [`PT: ${list}`] : [])]
  return { kind: 'group', name, lines, logo: relId(g.groupLogo) ?? null, companies: refs }
}

/** App-wide settings (global `company-settings`, ADR 0016 §1). */
export async function appSettings(req: PayloadRequest): Promise<CompanySetting> {
  return req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: app-wide settings */, req })
}

/** App-wide + per-PT settings of `companyId` (default: `contextCompanyId`). */
export async function settings(req: PayloadRequest, companyId?: number | null): Promise<EffectiveSettings> {
  const id = typeof companyId === 'number' ? companyId : await contextCompanyId(req)
  const [app, company] = await Promise.all([appSettings(req), companyById(req, id)])
  return { ...app, ...company, companyId: id } as EffectiveSettings
}

/**
 * Same for jobs / code without a request: company `companyId`, default company #1 (the jobs loop
 * over every active PT and pass it, ADR 0016 §7).
 */
export async function settingsOf(payload: Payload, companyId?: number | null, req?: PayloadRequest): Promise<EffectiveSettings> {
  const id = typeof companyId === 'number' ? companyId : await firstActiveCompanyId(payload, req)
  const [app, company] = await Promise.all([
    payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: app-wide settings */, ...(req ? { req } : {}) }),
    payload.findByID({ collection: 'companies', id, depth: 0, overrideAccess: true /* SYSTEM-READ: company settings */, ...(req ? { req } : {}) }),
  ])
  return { ...app, ...company, companyId: id } as EffectiveSettings
}

// ---- membership queries (approver pools, recipients, G1) ----------------------------------------

type MRow = { user: unknown; company: unknown; employee?: unknown; roles?: unknown }

async function memberships(req: PayloadRequest, where: Record<string, unknown>): Promise<MRow[]> {
  const res = await req.payload.find({
    collection: 'company-memberships',
    where: { and: [where, { active: { equals: true } }] } as never,
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: memberships (approver pools / recipients)
    req,
  })
  return res.docs as unknown as MRow[]
}

async function activeUsers(req: PayloadRequest, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return []
  const res = await req.payload.find({
    collection: 'users',
    where: { and: [{ id: { in: ids } }, { active: { equals: true } }] },
    depth: 0,
    pagination: false,
    select: { email: true },
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: active accounts
    req,
  })
  return res.docs.map((d) => d.id as number)
}

/** Active users holding `role` IN `companyId` (ADR 0016 §5: approver pools / recipients per PT). */
export async function membersWithRole(req: PayloadRequest, role: Role, companyId: number): Promise<number[]> {
  const rows = await memberships(req, { and: [{ company: { equals: companyId } }, { roles: { in: [role] } }] })
  return activeUsers(req, [...new Set(rows.map((r) => relId(r.user)).filter((x): x is number => x !== undefined))])
}

/** Roles in `companyId` + active flag of the given users (users without membership → no roles). */
export async function rolesOfUsersIn(req: PayloadRequest, userIds: number[], companyId: number): Promise<Map<number, { roles: Role[]; active: boolean }>> {
  const out = new Map<number, { roles: Role[]; active: boolean }>()
  if (userIds.length === 0) return out
  const res = await req.payload.find({
    collection: 'users',
    where: { id: { in: userIds } },
    depth: 0,
    pagination: false,
    select: { active: true },
    overrideAccess: true, // SYSTEM-READ: named decision users
    req,
  })
  const rows = await memberships(req, { and: [{ company: { equals: companyId } }, { user: { in: userIds } }] })
  const roles = new Map(rows.map((r) => [relId(r.user), (Array.isArray(r.roles) ? r.roles.filter(isRole) : []) as Role[]]))
  for (const u of res.docs as unknown as Array<{ id: number; active?: boolean | null }>) out.set(u.id, { roles: roles.get(u.id) ?? [], active: u.active !== false })
  return out
}

/** Accounts linked to the employees (membership.employee); `activeOnly` filters inactive users. */
export async function usersOfEmployees(req: PayloadRequest, employeeIds: number[], opts: { activeOnly?: boolean } = {}): Promise<number[]> {
  if (employeeIds.length === 0) return []
  const rows = await memberships(req, { employee: { in: employeeIds } })
  const ids = [...new Set(rows.map((r) => relId(r.user)).filter((x): x is number => x !== undefined))].sort((a, b) => a - b)
  return opts.activeOnly ? activeUsers(req, ids) : ids
}

/** Account of one employee, or null. */
export async function userOfEmployee(req: PayloadRequest, employee: number): Promise<number | null> {
  return (await usersOfEmployees(req, [employee]))[0] ?? null
}

/** Employee of `userId` in `companyId`, or null. */
export async function employeeOfUser(req: PayloadRequest, userId: number, companyId: number): Promise<number | null> {
  const rows = await memberships(req, { and: [{ user: { equals: userId } }, { company: { equals: companyId } }] })
  return relId(rows[0]?.employee) ?? null
}

/**
 * Display employee per user — names in history/DTOs/PDF: the membership employee of `preferCompany`
 * (the document's PT) when there is one, else the first membership (lowest PT id) with an employee.
 */
export async function displayEmployeeByUser(req: PayloadRequest, userIds: number[], preferCompany?: number | null): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  if (userIds.length === 0) return out
  const res = await req.payload.find({
    collection: 'company-memberships',
    where: { user: { in: userIds } },
    depth: 0,
    pagination: false,
    sort: 'company',
    overrideAccess: true, // SYSTEM-READ: display names
    req,
  })
  const rows = res.docs as unknown as MRow[]
  const ordered = typeof preferCompany === 'number' ? [...rows.filter((r) => relId(r.company) === preferCompany), ...rows.filter((r) => relId(r.company) !== preferCompany)] : rows
  for (const r of ordered) {
    const u = relId(r.user)
    const e = relId(r.employee)
    if (u !== undefined && e !== undefined && !out.has(u)) out.set(u, e)
  }
  return out
}

/** Company of a per-PT document (SYSTEM-READ), or undefined. */
export async function companyOf(req: PayloadRequest, collection: string, id: number | null | undefined): Promise<number | undefined> {
  if (typeof id !== 'number') return undefined
  const doc = (await req.payload.findByID({ collection: collection as never, id, depth: 0, overrideAccess: true /* SYSTEM-READ: company of a document */, req, disableErrors: true })) as {
    company?: unknown
  } | null
  return relId(doc?.company)
}

/**
 * Display name per user: the employee name of its membership in `opts.companyId` (the document's PT,
 * ADR 0016 D1), else of its first membership (lowest PT id) that links an employee, else the account
 * name, else the email.
 */
export async function displayNames(req: PayloadRequest, userIds: number[], opts: { emailFallback?: boolean; companyId?: number | null } = {}): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return out
  const [users, empByUser] = await Promise.all([
    req.payload.find({
      collection: 'users',
      where: { id: { in: ids } },
      depth: 0,
      pagination: false,
      select: { name: true, email: true },
      overrideAccess: true, // SYSTEM-READ: display names
      req,
    }),
    displayEmployeeByUser(req, ids, opts.companyId),
  ])
  const empIds = [...new Set(empByUser.values())]
  const emps = empIds.length
    ? await req.payload.find({ collection: 'employees', where: { id: { in: empIds } }, depth: 0, pagination: false, select: { name: true }, overrideAccess: true /* SYSTEM-READ: display names */, req })
    : { docs: [] }
  const empName = new Map(emps.docs.map((e) => [e.id as number, (e as { name?: string }).name]))
  for (const u of users.docs as unknown as Array<{ id: number; name?: string | null; email: string }>) {
    const e = empByUser.get(u.id)
    out.set(u.id, (e !== undefined ? empName.get(e) : undefined) || u.name || (opts.emailFallback === false ? undefined : u.email) || `user#${u.id}`)
  }
  return out
}

/** SQL fragment: display name of `users u` via its first membership employee (raw-SQL reports). */
export const USER_DISPLAY_EMPLOYEE_SQL = `(SELECT e.name FROM company_memberships m JOIN employees e ON e.id = m.employee_id WHERE m.user_id = u.id ORDER BY m.company_id LIMIT 1)`
