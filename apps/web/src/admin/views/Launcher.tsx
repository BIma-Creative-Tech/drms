import { Gutter } from '@payloadcms/ui'
import { redirect } from 'next/navigation'
import type { Payload, SanitizedPermissions, TypedUser, VisibleEntities } from 'payload'
import React from 'react'

import { loadModules } from '@/admin/shell/modules-server'

/**
 * `/admin` (admin.components.views.dashboard, Payload 3.90.1 views/Dashboard: rendered inside the default
 * template with {payload, user, permissions, visibleEntities, i18n, …}). D2510 (user 2026-10-25, ADR 0033): the
 * Odoo-style module launcher is gone — the sidebar lists every module — so the home URL opens the caller's first
 * visible menu item, i.e. the role dashboard (/admin/dashboard) for every role that has one. A caller without any
 * visible module gets the empty-state line instead of a redirect loop.
 */
type Props = {
  payload: Payload
  user?: TypedUser | null
  permissions?: SanitizedPermissions
  visibleEntities?: VisibleEntities
  i18n?: Parameters<typeof loadModules>[0]['i18n']
}

export async function Launcher({ payload, user, permissions, visibleEntities, i18n }: Props) {
  if (!user) return null
  const modules = await loadModules({ payload, user, permissions, visibleEntities, i18n })
  const first = modules[0]?.firstHref
  if (first) redirect(first)
  return (
    <Gutter>
      <p className="pk-home-empty" data-pk-home-empty>
        Akun Anda belum punya akses ke modul mana pun. Hubungi Admin.
      </p>
    </Gutter>
  )
}

export default Launcher
