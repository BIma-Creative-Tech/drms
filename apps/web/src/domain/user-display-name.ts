import type { Payload } from 'payload'

import { companyContextOf, type Membership } from '@/access/roles'

/**
 * DRMS 10/10 WA-14: the ONE rule for "who is signed in" labels (launcher greeting, dashboard "Halo, …",
 * avatar menu of the top bar, GET /api/v1/me `displayName`) — a person is greeted by NAME, never by
 * email: `users.name` → the employee linked to the caller's membership in a SELECTED PT (lowest PT id
 * first; then the other active memberships) → the email local part → "Pengguna".
 * Only the caller's OWN memberships are looked at (ids from the auth context), so no other PT's data
 * is ever shown. Document labels of OTHER users keep `displayNames` (domain/companies.ts).
 */

export const FALLBACK_DISPLAY_NAME = 'Pengguna'

type UserLike = { name?: string | null; email?: string | null }

/** Pure part of the rule (unit-tested): the first non-empty candidate. */
export function pickDisplayName(user: UserLike | null | undefined, employeeName?: string | null): string {
  const name = (user?.name ?? '').trim()
  if (name) return name
  const emp = (employeeName ?? '').trim()
  if (emp) return emp
  const local = (user?.email ?? '').split('@')[0]?.trim() ?? ''
  return local || FALLBACK_DISPLAY_NAME
}

/** Employee ids of the caller's memberships in lookup order: selected PTs (ascending id), then the rest. */
export function employeeCandidates(user: unknown): number[] {
  const ctx = companyContextOf(user)
  if (!ctx) {
    // system/test users without a context: the derived single `employee` (withCompanyContext)
    const e = (user as { employee?: unknown } | null)?.employee
    return typeof e === 'number' ? [e] : []
  }
  const byId = (a: Membership, b: Membership) => a.company - b.company
  const selected = ctx.memberships.filter((m) => ctx.selected.includes(m.company)).sort(byId)
  const rest = ctx.memberships.filter((m) => !ctx.selected.includes(m.company)).sort(byId)
  const out: number[] = []
  for (const m of [...selected, ...rest]) if (typeof m.employee === 'number' && !out.includes(m.employee)) out.push(m.employee)
  return out
}

/**
 * Display name of the signed-in caller (see the file comment). Never throws: a failing employee
 * lookup falls back to the email local part.
 */
export async function resolveDisplayName(payload: Partial<Pick<Payload, 'find'>>, user: unknown): Promise<string> {
  const u = user as UserLike | null
  if ((u?.name ?? '').trim()) return pickDisplayName(u)
  const ids = employeeCandidates(user)
  let employeeName: string | null = null
  if (ids.length && typeof payload.find === 'function') {
    try {
      const res = await payload.find({
        collection: 'employees',
        where: { id: { in: ids } },
        depth: 0,
        pagination: false,
        select: { name: true },
        overrideAccess: true, // SYSTEM-READ: the caller's OWN membership employees (ids from the auth context)
      })
      const names = new Map(res.docs.map((d) => [d.id as number, String((d as { name?: unknown }).name ?? '').trim()]))
      employeeName = ids.map((id) => names.get(id)).find((n): n is string => !!n) ?? null
    } catch {
      employeeName = null
    }
  }
  return pickDisplayName(u, employeeName)
}
