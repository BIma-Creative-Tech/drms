import { getTranslation } from '@payloadcms/translations'
import type { Payload, SanitizedPermissions, TypedUser, VisibleEntities } from 'payload'

import { isStaffOnly, ROLE_LABELS, rolesOf, type Role } from '@/access/roles'
import { resolveModules, type BadgeKey, type ResolvedModule } from '@/admin/modules/registry'
import { TRANSFER_QUEUE_WHERE } from '@/domain/expense/types'

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

export type ModuleNavInput = {
  payload: Pick<Payload, 'count' | 'config'>
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
  const badges = await loadBadges(payload, user)
  return resolveModules({ roles: rolesOf(user), staffOnly: isStaffOnly(user), canSee, labelOf, badges })
}
