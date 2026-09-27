import { Gutter } from '@payloadcms/ui'
import type { Payload, SanitizedPermissions, TypedUser, VisibleEntities } from 'payload'
import React from 'react'

import { loadModules, navUser } from '@/admin/shell/modules-server'

import { LauncherGrid } from './LauncherGrid'

/**
 * `/admin` = Odoo-style module launcher (admin.components.views.dashboard, Payload 3.90.1
 * views/Dashboard: rendered inside the default template with {payload, user, permissions,
 * visibleEntities, i18n, …}). Greeting (name + role) and a tile per visible module — the same
 * resolveModules() as the top bar, so a tile appears only when the caller can open at least one
 * item of it. The role dashboard moved to its own module at /admin/dashboard.
 */
type Props = {
  payload: Payload
  user?: TypedUser | null
  permissions?: SanitizedPermissions
  visibleEntities?: VisibleEntities
  i18n?: Parameters<typeof loadModules>[0]['i18n']
}

export function greeting(date: Date, timeZone = 'Asia/Makassar'): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date))
  if (h < 11) return 'Selamat pagi'
  if (h < 15) return 'Selamat siang'
  if (h < 18) return 'Selamat sore'
  return 'Selamat malam'
}

export async function Launcher({ payload, user, permissions, visibleEntities, i18n }: Props) {
  if (!user) return null
  const modules = await loadModules({ payload, user, permissions, visibleEntities, i18n })
  const who = navUser(user)
  return (
    <Gutter>
      <section className="pk-launcher" data-pk-launcher aria-labelledby="pk-launcher-title">
        <header className="pk-launcher__head">
          <p className="pk-launcher__hello">{greeting(new Date())},</p>
          <h1 id="pk-launcher-title" className="pk-launcher__name">
            {who.name}
          </h1>
          <p className="pk-launcher__role">
            <span className="pk-launcher__role-pill">{who.roleLabel}</span>
            <span>Pilih modul untuk mulai bekerja.</span>
          </p>
        </header>
        {modules.length ? (
          <LauncherGrid modules={modules} />
        ) : (
          <p className="pk-launcher__empty">Akun Anda belum punya akses ke modul mana pun. Hubungi Admin.</p>
        )}
      </section>
    </Gutter>
  )
}

export default Launcher
