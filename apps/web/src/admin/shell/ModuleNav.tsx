import type { Payload, SanitizedPermissions, TypedUser, VisibleEntities } from 'payload'
import React from 'react'

import { NotificationBell } from '@/admin/components/NotificationBell'
import { PrivacyGate } from '@/admin/components/privacy/PrivacyGate'
import { LogoutButton } from '@/components/LogoutButton'

import { ModuleBar } from './ModuleBar'
import { loadModules, loadNavUser, loadSwitcher } from './modules-server'

/**
 * admin.components.Nav (Payload 3.90.1 templates/Default: rendered on EVERY page that uses the
 * DefaultTemplate — built-in list/edit/account views and our custom views wrapped in Frame/Shell —
 * with serverProps {payload, permissions, user, i18n, …} + clientProps {visibleEntities}). Replaces
 * the left sidebar by the Odoo-style top bar: the server computes the visible modules, badges and
 * the bell, the client ModuleBar resolves the active module from the pathname and renders the menu.
 * Replacing Nav drops before/afterNavLinks and the default logout slot → bell + logout live here.
 * Also hosts the privacy-notice gate (ADR 0018): this is the one server component on every admin page.
 */
type Props = {
  payload: Payload
  user?: TypedUser
  permissions?: SanitizedPermissions
  visibleEntities?: VisibleEntities
  i18n?: Parameters<typeof loadModules>[0]['i18n']
}

export async function ModuleNav({ payload, user, permissions, visibleEntities, i18n }: Props) {
  if (!payload?.config || !user) return null
  const [modules, companies, who] = await Promise.all([loadModules({ payload, user, permissions, visibleEntities, i18n }), loadSwitcher(payload, user), loadNavUser(payload, user)])
  return (
    <>
      <ModuleBar modules={modules} user={who} companies={companies} bell={<NotificationBell payload={payload} user={user} />} logout={<LogoutButton />} />
      {/* ADR 0018 (Q-46): non-dismissable privacy-notice interstitial until the current version is acknowledged */}
      <PrivacyGate user={user as { privacyAckVersion?: unknown }} />
    </>
  )
}

export default ModuleNav
