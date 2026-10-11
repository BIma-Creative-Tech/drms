import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, FieldAccess, FieldHook, FilterOptionsProps, PayloadRequest, Where } from 'payload'

import { companiesWithRole, hasRole, isGroupAdmin, ownEmployees, relId, soleCompany } from '@/access/roles'
import { NO_ROWS } from '@/access/scope'
import { validationError } from '@/lib/validation'

/**
 * "Akun pengguna" on the Employee form (owner decision 2026-10-10): the user ↔ employee link of a PT
 * still lives ONLY on `company-memberships.employee` (ADR 0016 §2; unique (company, employee), same-PT
 * hook + DB trigger). The employee field `userAccount` is VIRTUAL: read = the membership whose
 * `employee` is this employee; write = that membership's `employee` is set / cleared through the
 * membership collection (its access + audit), in the same transaction as the employee save.
 */
export const USER_ACCOUNT = 'userAccount'

/** One membership row as the link logic needs it. */
export type LinkMembership = { id: number; user: number; employee: number | null; active: boolean }

export type LinkError = 'no_access' | 'inactive' | 'linked_other' | 'invalid'

/** Field error texts (Indonesian UI). `linked_other` names the other employee. */
export function linkErrorMessage(error: LinkError, other?: { code?: unknown; name?: unknown } | null): string {
  switch (error) {
    case 'no_access':
      return 'Akun ini belum punya akses di PT ini — tambahkan aksesnya di Akses PT dulu.'
    case 'inactive':
      return 'Akses akun ini di PT ini nonaktif — aktifkan dulu di Akses PT.'
    case 'linked_other': {
      const label = [other?.code, other?.name].filter((x) => typeof x === 'string' && x.trim() !== '').join(' ')
      return `Akun ini sudah tertaut ke karyawan ${label || 'lain'}.`
    }
    case 'invalid':
      return 'Akun pengguna tidak valid.'
  }
}

export const LINK_FORBIDDEN_MESSAGE = 'Hanya Admin PT ini (atau Admin grup) yang dapat mengubah akun pengguna karyawan.'

/**
 * Input value → wanted user id: `undefined` = not part of this write (leave the link alone), `null` =
 * unlink, a number = link that account, `NaN` = unusable value (400).
 */
export function wantedUser(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const id = relId(raw)
  if (id !== undefined) return Number.isSafeInteger(id) && id > 0 ? id : Number.NaN
  if (typeof raw === 'string' && /^[1-9]\d{0,9}$/.test(raw)) return Number(raw)
  return Number.NaN
}

export type LinkDecision =
  | { change: false }
  | { change: true; error: LinkError; otherEmployee?: number }
  | { change: true; error?: undefined; clear: number | null; set: number | null }

/**
 * Pure decision (unit-tested): `current` = the membership linked to this employee now (or null),
 * `target` = the membership (wanted user, employee's PT) or null. Clearing comes first (the unique
 * (company, employee) index allows one row per employee at a time).
 */
export function decideLink(args: { wanted: number | null; current: LinkMembership | null; target: LinkMembership | null; employeeId: number | undefined }): LinkDecision {
  const { wanted, current, target, employeeId } = args
  if (wanted !== null && Number.isNaN(wanted)) return { change: true, error: 'invalid' }
  if (wanted === (current?.user ?? null)) return { change: false }
  if (wanted === null) return { change: true, clear: current?.id ?? null, set: null }
  if (!target) return { change: true, error: 'no_access' }
  if (!target.active) return { change: true, error: 'inactive' }
  if (target.employee !== null && target.employee !== employeeId) return { change: true, error: 'linked_other', otherEmployee: target.employee }
  return { change: true, clear: current && current.id !== target.id ? current.id : null, set: target.id }
}

/** May the caller change the link in `company`? = may update that PT's memberships (Admin of the PT, group admin); system writes (no user) yes. */
export function mayLinkAccounts(req: Pick<PayloadRequest, 'user'>, company: number | undefined): boolean {
  if (!req.user) return true
  return company !== undefined && (isGroupAdmin(req) || hasRole(req, 'pk-admin', company))
}

/**
 * Field read access = who may read the membership rows (CompanyMemberships read): group admin, Admin
 * of the employee's PT, the linked person themself (own row). Create form (no document yet): an Admin
 * of any PT. Everyone else gets no value (the field is hidden).
 */
export function mayReadLink(req: Pick<PayloadRequest, 'user'>, doc: { id?: unknown; company?: unknown } | undefined): boolean {
  if (!req.user) return true
  if (isGroupAdmin(req)) return true
  const id = relId(doc?.id) ?? (typeof doc?.id === 'number' ? doc.id : undefined)
  if (id === undefined) return companiesWithRole(req, ['pk-admin'], { all: true }).length > 0
  return hasRole(req, 'pk-admin', relId(doc?.company)) || ownEmployees(req).includes(id)
}

export const userAccountReadAccess: FieldAccess = ({ req, doc }) => mayReadLink(req, doc as { id?: unknown; company?: unknown } | undefined)

// ---- reads ------------------------------------------------------------------------------------------

type Row = { id: number; user?: unknown; employee?: unknown; active?: unknown }
const toLink = (m: Row): LinkMembership => ({ id: m.id, user: relId(m.user) ?? -1, employee: relId(m.employee) ?? null, active: m.active !== false })

/** The membership linked to `employee` (at most one: unique (company, employee) + same-PT trigger). */
export async function membershipOfEmployee(req: PayloadRequest, employee: number): Promise<LinkMembership | null> {
  const r = await req.payload.find({
    collection: 'company-memberships',
    where: { employee: { equals: employee } },
    depth: 0,
    limit: 1,
    pagination: false,
    select: { user: true, employee: true, active: true },
    overrideAccess: true, // SYSTEM-READ: user ↔ employee link (caller checked by mayReadLink / mayLinkAccounts)
    req,
  })
  const m = r.docs[0] as unknown as Row | undefined
  return m ? toLink(m) : null
}

/** The membership of (`user`, `company`), active or not. */
export async function membershipOf(req: PayloadRequest, user: number, company: number): Promise<LinkMembership | null> {
  const r = await req.payload.find({
    collection: 'company-memberships',
    where: { and: [{ user: { equals: user } }, { company: { equals: company } }] },
    depth: 0,
    limit: 1,
    pagination: false,
    select: { user: true, employee: true, active: true },
    overrideAccess: true, // SYSTEM-READ: target membership of a link change (caller checked by mayLinkAccounts)
    req,
  })
  const m = r.docs[0] as unknown as Row | undefined
  return m ? toLink(m) : null
}

/**
 * Batched read of the linked user per employee: every afterRead of one request tick (a list page,
 * populated employees) is answered by ONE query (`employee IN (...)`). Batches are per request and
 * never cached beyond the tick (a link changed later in the same request is read fresh).
 */
const batches = new WeakMap<object, { ids: Set<number>; result: Promise<Map<number, number>> }>()

export function linkedUserOf(req: PayloadRequest, employee: number): Promise<number | null> {
  let b = batches.get(req)
  if (!b) {
    const ids = new Set<number>()
    const result = new Promise<Map<number, number>>((resolve, reject) => {
      setImmediate(() => {
        batches.delete(req)
        req.payload
          .find({
            collection: 'company-memberships',
            where: { employee: { in: [...ids] } },
            depth: 0,
            pagination: false,
            select: { user: true, employee: true },
            overrideAccess: true, // SYSTEM-READ: virtual employees.userAccount (field access checked by the caller)
            req,
          })
          .then((r) => {
            const out = new Map<number, number>()
            for (const m of r.docs as unknown as Row[]) {
              const e = relId(m.employee)
              const u = relId(m.user)
              if (e !== undefined && u !== undefined) out.set(e, u)
            }
            resolve(out)
          }, reject)
      })
    })
    b = { ids, result }
    batches.set(req, b)
  }
  b.ids.add(employee)
  return b.result.then((m) => m.get(employee) ?? null)
}

/** afterRead of `userAccount`: the linked account (id; populated by Payload at depth > 0), else null. */
export const readUserAccount: FieldHook = async ({ siblingData, overrideAccess, req }) => {
  const d = siblingData as { id?: unknown; company?: unknown } | undefined
  const id = typeof d?.id === 'number' ? d.id : undefined
  if (id === undefined) return null
  if (!overrideAccess && !mayReadLink(req, d)) return null // field access removes it anyway; skip the query
  return linkedUserOf(req, id)
}

// ---- picker -----------------------------------------------------------------------------------------

/**
 * Picker: ACTIVE accounts with an ACTIVE membership in the employee's PT that is not linked to an
 * employee yet, plus the account linked to THIS employee. PT = the form's `company` (on create with
 * several PTs the PT is chosen first), else the caller's only selected PT.
 */
export async function userAccountOptions({ data, id, req }: FilterOptionsProps): Promise<Where> {
  const company = relId((data as { company?: unknown } | undefined)?.company) ?? soleCompany(req)
  if (company === undefined) return NO_ROWS
  const employee = typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : undefined
  const free: Where = { and: [{ active: { equals: true } }, { employee: { exists: false } }] }
  const r = await req.payload.find({
    collection: 'company-memberships',
    where: { and: [{ company: { equals: company } }, employee !== undefined ? { or: [free, { employee: { equals: employee } }] } : free] },
    depth: 0,
    pagination: false,
    select: { user: true, employee: true },
    overrideAccess: true, // SYSTEM-READ: picker options (accounts with access to the employee's PT)
    req,
  })
  const rows = r.docs as unknown as Row[]
  const current = rows.find((m) => employee !== undefined && relId(m.employee) === employee)
  const freeUsers = rows.filter((m) => m !== current).map((m) => relId(m.user)).filter((u): u is number => u !== undefined)
  const or: Where[] = []
  if (freeUsers.length > 0) or.push({ and: [{ id: { in: freeUsers } }, { active: { equals: true } }] })
  const cu = relId(current?.user)
  if (cu !== undefined) or.push({ id: { equals: cu } })
  return or.length === 0 ? NO_ROWS : or.length === 1 ? or[0]! : { or }
}

/**
 * Admin create-form prefill (`/admin/collections/<slug>/create?company=3&user=7`, e.g. the "Buat
 * karyawan" button of the user form): a positive integer query parameter, ONLY on that admin route
 * (never from API query strings). Saving still runs every check.
 */
export function adminCreatePrefill(req: { url?: string | null } | null | undefined, slug: string, key: string): number | undefined {
  if (!req?.url) return undefined
  let u: URL
  try {
    u = new URL(req.url, 'http://local')
  } catch {
    return undefined
  }
  if (!u.pathname.endsWith(`/collections/${slug}/create`)) return undefined
  const v = u.searchParams.get(key)
  return v !== null && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : undefined
}

// ---- writes -----------------------------------------------------------------------------------------

/** Value of `userAccount` in the stored document as read in THIS request (afterRead), when present. */
function known(doc: unknown): { value: number | null } | undefined {
  if (!doc || typeof doc !== 'object' || !(USER_ACCOUNT in doc)) return undefined
  return { value: relId((doc as Record<string, unknown>)[USER_ACCOUNT]) ?? null }
}

async function resolve(req: PayloadRequest, args: { raw: unknown; employeeId: number | undefined; company: number | undefined; previous?: { value: number | null } }): Promise<{ wanted: number | null; decision: LinkDecision } | null> {
  const wanted = wantedUser(args.raw)
  if (wanted === undefined) return null
  if (args.employeeId === undefined && wanted === null) return null // create without an account
  // update without a change (the usual save: Payload merges the stored value into `data`): no query
  if (args.previous && args.previous.value === wanted) return { wanted, decision: { change: false } }
  const current = args.employeeId !== undefined ? await membershipOfEmployee(req, args.employeeId) : null
  if (wanted === (current?.user ?? null)) return { wanted, decision: { change: false } }
  const target = wanted !== null && !Number.isNaN(wanted) && args.company !== undefined ? await membershipOf(req, wanted, args.company) : null
  return { wanted, decision: decideLink({ wanted, current, target, employeeId: args.employeeId }) }
}

async function fail(req: PayloadRequest, decision: Extract<LinkDecision, { error: LinkError }>): Promise<never> {
  let other: { code?: unknown; name?: unknown } | null = null
  if (decision.error === 'linked_other' && decision.otherEmployee !== undefined) {
    other = (await req.payload.findByID({ collection: 'employees', id: decision.otherEmployee, depth: 0, select: { code: true, name: true }, overrideAccess: true /* SYSTEM-READ: name of the other employee of the same PT (caller is its Admin) */, req, disableErrors: true })) as { code?: unknown; name?: unknown } | null
  }
  throw validationError(req, { collection: 'employees' }, [{ path: USER_ACCOUNT, message: linkErrorMessage(decision.error, other) }])
}

function forbidden(req: PayloadRequest): never {
  const err = validationError(req, { collection: 'employees' }, [{ path: USER_ACCOUNT, message: LINK_FORBIDDEN_MESSAGE }])
  ;(err as { status: number }).status = 403
  throw err
}

/**
 * beforeChange (after the company hook resolved the PT): a changed `userAccount` is checked BEFORE
 * anything is written — caller may update the PT's memberships (else 403 on the field), the account
 * has a membership in the PT (active), and that membership is not linked to another employee.
 */
export const validateUserAccount: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (!data || !(USER_ACCOUNT in data)) return data
  const company = relId(data.company) ?? relId((originalDoc as { company?: unknown } | undefined)?.company)
  const employeeId = operation === 'update' ? relId(originalDoc) : undefined
  const r = await resolve(req, { raw: data[USER_ACCOUNT], employeeId, company, previous: operation === 'update' ? known(originalDoc) : undefined })
  if (!r || !r.decision.change) return data
  if (!mayLinkAccounts(req, company)) forbidden(req)
  if (r.decision.error !== undefined) return fail(req, r.decision)
  return data
}

/**
 * afterChange (same `req` = same transaction): clears the previously linked membership, then links
 * the new one — through the membership collection (`overrideAccess: false` for a user: its update
 * access + same-PT guard + audit `company_membership` apply). Create: the employee id exists now.
 */
export const applyUserAccount: CollectionAfterChangeHook = async ({ data, doc, operation, previousDoc, req }) => {
  if (!data || !(USER_ACCOUNT in data)) return doc
  const employeeId = doc.id as number
  const company = relId((doc as { company?: unknown }).company)
  const r = await resolve(req, { raw: (data as Record<string, unknown>)[USER_ACCOUNT], employeeId, company, previous: operation === 'update' ? known(previousDoc) : undefined })
  if (!r || !r.decision.change) return doc
  if (!mayLinkAccounts(req, company)) forbidden(req)
  const d = r.decision
  if (d.error !== undefined) return fail(req, d)
  const { clear, set } = d
  const reasons = (req.context?.pkAuditReason ?? {}) as Record<string, string | undefined>
  const changeReason = reasons.employees ?? `Akun pengguna diatur dari data karyawan ${String((doc as { code?: unknown }).code ?? employeeId)} (${operation === 'create' ? 'dibuat' : 'diubah'}).`
  const write = (id: number, employee: number | null) =>
    req.payload.update({
      collection: 'company-memberships',
      id,
      data: { employee, changeReason } as never,
      depth: 0,
      req,
      overrideAccess: !req.user, // user: membership update access applies; system writes (seed/import/jobs) are trusted
    })
  if (clear !== null) await write(clear, null)
  if (set !== null) await write(set, employeeId)
  ;(doc as Record<string, unknown>)[USER_ACCOUNT] = r.wanted
  return doc
}
