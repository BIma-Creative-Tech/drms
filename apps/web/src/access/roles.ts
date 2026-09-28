import type { Access, PayloadRequest } from 'payload'

/**
 * The five ProyekKas roles (ADR 0003 §2 as revised by ADR 0016 §2): held PER PT in
 * `company-memberships` (DB only). Keycloak keeps identity + the coarse realm role `pk-user`.
 */
export const ROLES = ['pk-staff', 'pk-pm', 'pk-finance', 'pk-owner', 'pk-admin'] as const
export type Role = (typeof ROLES)[number]

/** Keycloak realm role "may log in to ProyekKas" (ADR 0016 §2). */
export const LOGIN_ROLE = 'pk-user'

/**
 * Display labels. ADR 0013 / GATE 1 G1-1 (user 2026-09-26): the role `pk-owner` is shown as
 * "Direktur" (the role id stays `pk-owner`).
 */
export const ROLE_LABELS: Record<Role, string> = {
  'pk-staff': 'Staff lapangan',
  'pk-pm': 'Project Manager',
  'pk-finance': 'Finance',
  'pk-owner': 'Direktur',
  'pk-admin': 'Admin',
}

/**
 * Roles allowed into the Payload admin panel (architecture §7.2). F2c (user decision 2026-09-24):
 * Staff also gets a restricted web panel (own requests, receipts, notifications, own profile) —
 * permanent fallback for field staff without the APK. What staff SEES is narrowed by
 * `src/access/panel-visibility.ts`; what staff may READ/WRITE is still decided by access functions.
 */
export const PANEL_ROLES: readonly Role[] = ['pk-admin', 'pk-finance', 'pk-owner', 'pk-pm', 'pk-staff']

// ---- company context (ADR 0016 §5) --------------------------------------------------------------

/** One active membership of the user in an active PT. */
export type Membership = { company: number; roles: Role[]; employee: number | null }

/**
 * Per-request access context, attached to `req.user` by the auth strategies (and by
 * `withCompanyContext` for system/test users): all ACTIVE memberships, the effective selection
 * (cookie / `X-Company-Ids` ∩ memberships; default = all) and the DB-only `groupAdmin` flag.
 */
export type CompanyContext = { memberships: Membership[]; selected: number[]; groupAdmin: boolean }

export const COMPANY_CTX = '_pkCompanies'

type UserLike = Record<string, unknown> | null | undefined
type ReqLike = Pick<PayloadRequest, 'user'>

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

export function companyContextOf(user: unknown): CompanyContext | null {
  const c = (user as UserLike)?.[COMPANY_CTX] as CompanyContext | undefined
  return c && Array.isArray(c.memberships) && Array.isArray(c.selected) ? c : null
}

/**
 * Builds the user object seen by access control: `_pkCompanies` + DERIVED convenience fields
 * `roles` (union of the roles in the selected PTs — UI hints / MC2 transition helpers only, never a
 * stored value) and `employee` (employee of the first selected membership that has one).
 * MC2: `employee` is ambiguous with >1 selected PT — callers must use `employeeIn(req, company)`.
 */
export function withCompanyContext<T extends object>(user: T, memberships: Membership[], selection: number[] | null, groupAdmin: boolean): T & { roles: Role[]; employee: number | null } {
  const ids = memberships.map((m) => m.company)
  const selected = selection === null ? ids : ids.filter((id) => selection.includes(id))
  const sel = memberships.filter((m) => selected.includes(m.company))
  const roles = [...new Set(sel.flatMap((m) => m.roles))].sort() as Role[]
  const employee = sel.find((m) => m.employee !== null)?.employee ?? null
  const ctx: CompanyContext = { memberships, selected, groupAdmin }
  return { ...user, [COMPANY_CTX]: ctx, roles, employee, groupAdmin }
}

/** Selected memberships (all memberships when `all`). */
export function membershipsOf(user: unknown, opts: { all?: boolean } = {}): Membership[] {
  const c = companyContextOf(user)
  if (!c) return []
  return opts.all ? c.memberships : c.memberships.filter((m) => c.selected.includes(m.company))
}

/** Roles of the user in ANY selected PT (UI hints). Plain objects without a context: their `roles`. */
export function rolesOf(user: unknown): Role[] {
  const c = companyContextOf(user)
  if (c) return [...new Set(membershipsOf(user).flatMap((m) => m.roles))]
  const roles = (user as { roles?: unknown } | null | undefined)?.roles
  return Array.isArray(roles) ? roles.filter(isRole) : []
}

export function userRoles(req: ReqLike): Role[] {
  return rolesOf(req.user)
}

/** Staff without any other panel role in the selected PTs (the restricted "requester" panel). */
export function isStaffOnly(user: unknown): boolean {
  const roles = rolesOf(user)
  return roles.includes('pk-staff') && !roles.some((r) => r !== 'pk-staff')
}

/**
 * Roles of the caller IN ONE PT (ADR 0016 §5) — independent of the read selection: a mutation is
 * checked against the role in the document's PT. No context / no membership → [].
 */
export function rolesIn(req: ReqLike, companyId: number | null | undefined): Role[] {
  if (typeof companyId !== 'number') return []
  const c = companyContextOf(req.user)
  return c?.memberships.find((m) => m.company === companyId)?.roles ?? []
}

/** `hasRole(req, role | roles, companyId)` — the company is REQUIRED (null/undefined → false). */
export function hasRole(req: ReqLike, role: Role | readonly Role[], companyId: number | null | undefined): boolean {
  const want: readonly Role[] = typeof role === 'string' ? [role] : role
  return rolesIn(req, companyId).some((r) => want.includes(r))
}

/**
 * Role held in ANY selected PT. Only for UI hints, list endpoints whose rows are then filtered per
 * PT by access control, and the MC2 transition (every call is an MC2 review point).
 */
export function hasRoleAny(req: ReqLike, ...roles: Role[]): boolean {
  return userRoles(req).some((r) => roles.includes(r))
}

/** PTs (selected, or all memberships with `all`) where the caller holds one of `roles`. */
export function companiesWithRole(req: ReqLike, roles: readonly Role[], opts: { all?: boolean } = {}): number[] {
  return membershipsOf(req.user, opts)
    .filter((m) => m.roles.some((r) => roles.includes(r)))
    .map((m) => m.company)
}

/** Selected PTs of the caller (all memberships with `all`). */
export function memberCompanies(req: ReqLike, opts: { all?: boolean } = {}): number[] {
  return membershipsOf(req.user, opts).map((m) => m.company)
}

/** Employee of the caller in `companyId` (membership link), or undefined. */
export function employeeIn(req: ReqLike, companyId: number | null | undefined): number | undefined {
  if (typeof companyId !== 'number') return undefined
  const c = companyContextOf(req.user)
  const e = c?.memberships.find((m) => m.company === companyId)?.employee
  return typeof e === 'number' ? e : undefined
}

/** All employee ids of the caller (one per PT). */
export function ownEmployees(req: ReqLike): number[] {
  const c = companyContextOf(req.user)
  return (c?.memberships ?? []).map((m) => m.employee).filter((e): e is number => typeof e === 'number')
}

/** DB-only flag `users.groupAdmin` (ADR 0016 §2): companies + app-wide settings. */
export function isGroupAdmin(req: ReqLike): boolean {
  const c = companyContextOf(req.user)
  return c ? c.groupAdmin === true : false
}

/**
 * Single PT for a write without an explicit company: the only selected PT of the caller, else
 * undefined (the caller must name the PT).
 */
export function soleCompany(req: ReqLike): number | undefined {
  const sel = memberCompanies(req)
  return sel.length === 1 ? sel[0] : undefined
}

export const hasAnyRole =
  (...roles: Role[]): Access =>
  ({ req }) =>
    hasRoleAny(req, ...roles)

export const denyAll: Access = () => false

/** Any authenticated user with at least one ProyekKas role in a selected PT. */
export const anyRole: Access = ({ req }) => userRoles(req).length > 0

export function userId(req: ReqLike): number | undefined {
  const id = (req.user as { id?: unknown } | null)?.id
  return typeof id === 'number' ? id : undefined
}

/** Relationship value → id (depth 0 id or populated doc). */
export function relId(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number') {
    return (value as { id: number }).id
  }
  return undefined
}
