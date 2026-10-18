import { getAccessResults, type PayloadRequest, type TypedUser, type VisibleEntities } from 'payload'

import { loadModules } from '@/admin/shell/modules-server'

import { json, v1 } from '../http'

/** Payload's `admin.hidden` rule (@payloadcms/ui getVisibleEntities, 3.90.1), without the UI bundle. */
export function visibleEntitiesOf(req: Pick<PayloadRequest, 'payload' | 'user'>): VisibleEntities {
  const shown = (hidden: unknown): boolean => {
    if (typeof hidden !== 'function') return !hidden
    try {
      return !(hidden as (a: { user: unknown }) => boolean)({ user: req.user })
    } catch {
      return false
    }
  }
  return {
    collections: req.payload.config.collections.filter((c) => shown(c.admin?.hidden)).map((c) => c.slug),
    globals: req.payload.config.globals.filter((g) => shown(g.admin?.hidden)).map((g) => g.slug),
  } as VisibleEntities
}

/**
 * GET /api/v1/me/modules — the web launcher's modules for the caller (user 2026-10-18: APK menu 1:1 with the web).
 * Same resolveModules() input as /admin (Payload permissions ∧ admin.hidden ∧ view roles, badges, PT features) for
 * the PTs of `X-Company-Ids`; the APK maps each item `href` to its own screen. Menu only — every route re-checks.
 */
export const meModulesEndpoint = v1({
  path: '/me/modules',
  method: 'get',
  rateLimit: [60, 60_000],
  handler: async ({ req }) => {
    const permissions = await getAccessResults({ req })
    const modules = await loadModules({ payload: req.payload, user: req.user as TypedUser, permissions, visibleEntities: visibleEntitiesOf(req), i18n: req.i18n })
    return json({
      modules: modules.map((m) => ({
        id: m.id,
        label: m.label,
        hint: m.hint,
        badge: m.badge,
        sections: m.sections.map((s) => ({ label: s.label ?? null, items: s.items.map((i) => ({ href: i.href, label: i.label, kind: i.kind, badge: i.badge ?? 0 })) })),
      })),
    })
  },
})
