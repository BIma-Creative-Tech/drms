import { APIError, type Payload, type PayloadRequest } from 'payload'

import { readCookie } from '@/auth/cookies'

import { companyContextOf, hasRole, isRole, withCompanyContext, type Membership, type Role } from './roles'

/**
 * Active company context (ADR 0016 §5). Resolution once per authenticated request (auth
 * strategies): ACTIVE memberships of the user in ACTIVE companies (DB only), then the selection:
 * - header `X-Company-Ids: 1,3` (APK / API clients; also honoured on web requests);
 * - else cookie `pk-company-ids` (`__Host-` prefixed on https; set by the MC2 PT switcher);
 * - else all memberships.
 * The selection only NARROWS: it is always intersected with the memberships. Foreign or malformed
 * ids in the HEADER mark the request (`req.context[COMPANY_DENIED_KEY]`) → `/api/v1` answers 403
 * COMPANY_NOT_ALLOWED; generic REST just uses the intersection (possibly empty = no rows). A stale
 * cookie (nothing left after the intersection) falls back to all memberships.
 * Mutations ignore the selection: they are checked against the role in the DOCUMENT's PT.
 */
export const COMPANY_HEADER = 'x-company-ids'
export const COMPANY_DENIED_KEY = 'pkCompanyDenied'

export function companyCookieName(insecure: boolean): string {
  return insecure ? 'pk-company-ids' : '__Host-pk-company-ids'
}

/** "1, 3" → [1, 3]; empty/absent → null; anything malformed → 'invalid'. */
export function parseCompanyIds(raw: string | null | undefined): number[] | null | 'invalid' {
  if (raw === null || raw === undefined) return null
  const t = raw.trim()
  if (t === '') return null
  if (t.length > 200) return 'invalid'
  const out: number[] = []
  for (const part of t.split(/[,\s]+/).filter(Boolean)) {
    if (!/^[1-9][0-9]{0,8}$/.test(part)) return 'invalid'
    out.push(Number(part))
  }
  return [...new Set(out)]
}

/** Active memberships of `userId` in active companies (SYSTEM-READ: authentication). */
export async function loadMemberships(payload: Payload, userId: number, req?: PayloadRequest): Promise<Membership[]> {
  const res = await payload.find({
    collection: 'company-memberships',
    where: { and: [{ user: { equals: userId } }, { active: { equals: true } }] },
    depth: 0,
    pagination: false,
    sort: 'company',
    overrideAccess: true, // SYSTEM-READ: authentication (company context)
    ...(req ? { req } : {}),
  })
  const rows = res.docs as unknown as Array<{ company: unknown; roles?: unknown; employee?: unknown }>
  if (rows.length === 0) return []
  const companyIds = rows.map((r) => (typeof r.company === 'object' && r.company ? (r.company as { id: number }).id : (r.company as number)))
  const active = await payload.find({
    collection: 'companies',
    where: { and: [{ id: { in: companyIds } }, { active: { equals: true } }] },
    depth: 0,
    pagination: false,
    select: { shortCode: true },
    overrideAccess: true, // SYSTEM-READ: authentication (company context)
    ...(req ? { req } : {}),
  })
  const activeIds = new Set(active.docs.map((d) => d.id as number))
  return rows
    .map((r, i) => ({
      company: companyIds[i]!,
      roles: (Array.isArray(r.roles) ? r.roles.filter(isRole) : []) as Role[],
      employee: typeof r.employee === 'object' && r.employee ? (r.employee as { id: number }).id : ((r.employee as number | null | undefined) ?? null),
    }))
    .filter((m) => activeIds.has(m.company))
}

/**
 * Attaches the company context to a freshly authenticated user doc. Returns `denied` when the
 * header named a PT outside the memberships (or was malformed).
 */
export async function attachCompanyContext<T extends { id: number; groupAdmin?: boolean | null }>(
  payload: Payload,
  user: T,
  headers: Headers,
  opts: { insecureCookie: boolean },
): Promise<{ user: T & { roles: Role[]; employee: number | null }; denied: boolean }> {
  const memberships = await loadMemberships(payload, user.id)
  const ids = memberships.map((m) => m.company)
  let selection: number[] | null = null
  let denied = false
  const header = parseCompanyIds(headers.get(COMPANY_HEADER))
  if (header === 'invalid') {
    denied = true
    selection = []
  } else if (header !== null) {
    denied = header.some((id) => !ids.includes(id))
    selection = header.filter((id) => ids.includes(id))
  } else {
    const cookie = parseCompanyIds(readCookie(headers.get('cookie'), companyCookieName(opts.insecureCookie)))
    if (Array.isArray(cookie)) {
      const kept = cookie.filter((id) => ids.includes(id))
      selection = kept.length > 0 ? kept : null // stale cookie → all
    }
  }
  return { user: withCompanyContext(user, memberships, selection, user.groupAdmin === true), denied }
}

/**
 * For custom endpoints after a SYSTEM-READ (ADR 0016 security model): the caller must hold one of
 * `roles` (or, without roles, any membership) in the document's PT — else 404 (no existence leak).
 */
export function assertCompanyAccess(req: Pick<PayloadRequest, 'user'>, companyId: number | null | undefined, roles?: readonly Role[]): void {
  const c = companyContextOf(req.user)
  const ok =
    typeof companyId === 'number' && !!c && (roles ? hasRole(req, roles, companyId) : c.memberships.some((m) => m.company === companyId))
  if (!ok) throw new APIError('Tidak ditemukan.', 404, null, true)
}
