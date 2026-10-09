import { getTranslation } from '@payloadcms/translations'
import type { Payload, SanitizedPermissions, TypedUser, VisibleEntities } from 'payload'

import { companyContextOf, isStaffOnly, membershipsOf, ROLE_LABELS, rolesOf, type Role } from '@/access/roles'
import { resolveModules, type BadgeKey, type FeatureKey, type ResolvedModule } from '@/admin/modules/registry'
import { TRANSFER_QUEUE_WHERE } from '@/domain/expense/types'

import { normalizeSelection, type SwitcherState } from './company-switcher'

/**
 * Server-side data of the Odoo-style navigation (ModuleNav bar + Launcher at /admin): visible
 * modules for the caller, badge counts, unread notifications. No React here (unit-testable with a
 * stub payload). Counts respect the caller's read access (overrideAccess:false); a failing count
 * never breaks the navigation (→ 0).
 */

type I18nLike = Parameters<typeof getTranslation>[1]

/** Moved from F2NavLinks (US-19 "badge jumlah antrian"): Direktur/Finance only. S3e (S-07): the
 * transfer badge counts exactly the transfer queue of the page title (TRANSFER_QUEUE_WHERE). */
export async function loadBadges(payload: Pick<Payload, 'count'>, user: TypedUser): Promise<Partial<Record<BadgeKey, number>>> {
  const roles = rolesOf(user)
  if (!roles.includes('pk-finance') && !roles.includes('pk-owner')) return {}
  const count = async (where: Parameters<Payload['count']>[0]['where']) => {
    try {
      return (await payload.count({ collection: 'expense-requests', where, user, overrideAccess: false })).totalDocs
    } catch {
      return 0
    }
  }
  const [transfers, lpj] = await Promise.all([count(TRANSFER_QUEUE_WHERE), count({ status: { in: ['lpj_submitted', 'lpj_verified'] } })])
  return { transfers, lpj }
}

/** S3e (US-05): unread in-app notifications of the caller (bell in the top bar). */
export async function loadUnread(payload: Pick<Payload, 'count'>, user: TypedUser): Promise<number> {
  try {
    const r = await payload.count({
      collection: 'notifications',
      where: { and: [{ user: { equals: user.id } }, { readAt: { exists: false } }] },
      user,
      overrideAccess: false,
    })
    return r.totalDocs
  } catch {
    return 0
  }
}

export type NavUser = { id: number | string; name: string; email: string; roles: Role[]; roleLabel: string; staffOnly: boolean; initials: string }

export function navUser(user: TypedUser): NavUser {
  const u = user as unknown as { id: number | string; name?: string | null; email?: string | null }
  const roles = rolesOf(user)
  const name = (u.name ?? '').trim() || (u.email ?? '').split('@')[0] || 'Pengguna'
  const initials =
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  return { id: u.id, name, email: u.email ?? '', roles, roleLabel: roles.map((r) => ROLE_LABELS[r]).join(' · ') || 'Tanpa peran', staffOnly: isStaffOnly(user), initials }
}

/**
 * FR1 (ADR 0020 §10): per-PT feature flags that gate custom views in the menu — on when ANY selected
 * PT of the caller has it (companies.fieldReportsEnabled). A failing lookup hides the views (→ off).
 */
export async function loadFeatures(payload: Partial<Pick<Payload, 'find'>>, user: TypedUser): Promise<Partial<Record<FeatureKey, boolean>>> {
  const ids = membershipsOf(user).map((m) => m.company)
  if (ids.length === 0 || typeof payload.find !== 'function') return {}
  try {
    const r = await payload.find({
      collection: 'companies',
      where: { and: [{ id: { in: ids } }, { fieldReportsEnabled: { equals: true } }] },
      depth: 0,
      limit: 1,
      pagination: false,
      select: { shortCode: true },
      overrideAccess: true, // SYSTEM-READ: feature flag of the caller's own selected PTs (menu only; views re-check)
    })
    return { fieldReports: r.docs.length > 0 }
  } catch {
    return {}
  }
}

export type ModuleNavInput = {
  payload: Pick<Payload, 'count' | 'config'> & Partial<Pick<Payload, 'find'>>
  user: TypedUser
  permissions?: SanitizedPermissions | null
  visibleEntities?: VisibleEntities | null
  i18n?: I18nLike
}

/** Visible modules for the caller: Payload read permission ∧ visibleEntities ∧ role rules. */
export async function loadModules({ payload, user, permissions, visibleEntities, i18n }: ModuleNavInput): Promise<ResolvedModule[]> {
  const cfg = payload.config
  const labelOf = (kind: 'collection' | 'global', slug: string): string => {
    const raw =
      kind === 'collection'
        ? (cfg.collections.find((c) => c.slug === slug)?.labels?.plural as unknown)
        : (cfg.globals.find((g) => g.slug === slug)?.label as unknown)
    if (typeof raw === 'string') return raw
    if (raw && typeof raw === 'object' && i18n) return getTranslation(raw as Record<string, string>, i18n)
    return slug
  }
  const canSee = (kind: 'collection' | 'global', slug: string): boolean => {
    const visible = (kind === 'collection' ? visibleEntities?.collections : visibleEntities?.globals) as readonly string[] | undefined
    if (!visible?.includes(slug)) return false
    const perms = kind === 'collection' ? permissions?.collections : permissions?.globals
    return Boolean((perms as Record<string, { read?: unknown } | undefined> | undefined)?.[slug]?.read)
  }
  // QA-20(c): create/update permission (a `Where` counts: some rows of the caller's PTs) for `manage` modules
  const canManage = (kind: 'collection' | 'global', slug: string): boolean => {
    if (!canSee(kind, slug)) return false
    const perms = (kind === 'collection' ? permissions?.collections : permissions?.globals) as Record<string, { create?: unknown; update?: unknown } | undefined> | undefined
    return Boolean(perms?.[slug]?.create || perms?.[slug]?.update)
  }
  const [badges, features] = await Promise.all([loadBadges(payload, user), loadFeatures(payload, user)])
  return resolveModules({ roles: rolesOf(user), staffOnly: isStaffOnly(user), canSee, canManage, labelOf, badges, features })
}

/**
 * MC2-4 PT switcher data: the caller's ACTIVE memberships (in active PTs, from the per-request
 * company context of the auth strategy) with code/name and the roles held there, plus the current
 * selection. Empty options = no membership (no switcher).
 */
export async function loadSwitcher(payload: Pick<Payload, 'find'>, user: TypedUser): Promise<SwitcherState> {
  const ctx = companyContextOf(user)
  if (!ctx || ctx.memberships.length === 0) return { options: [], selected: [] }
  const ids = ctx.memberships.map((m) => m.company)
  let names = new Map<number, { shortCode: string; name: string }>()
  try {
    const res = await payload.find({
      collection: 'companies',
      where: { id: { in: ids } },
      depth: 0,
      pagination: false,
      sort: 'shortCode',
      select: { shortCode: true, name: true },
      overrideAccess: true, // SYSTEM-READ: labels of the caller's own active memberships (context already resolved)
    })
    names = new Map(res.docs.map((d) => [d.id as number, { shortCode: String(d.shortCode ?? d.id), name: String(d.name ?? '') }]))
  } catch {
    // labels only — fall back to ids
  }
  const options = ctx.memberships
    .map((m) => ({ id: m.company, shortCode: names.get(m.company)?.shortCode ?? `#${m.company}`, name: names.get(m.company)?.name ?? '', roles: m.roles.map((r) => ROLE_LABELS[r]) }))
    .sort((a, b) => a.shortCode.localeCompare(b.shortCode) || a.id - b.id)
  return { options, selected: normalizeSelection(options, ctx.selected) }
}
