import type { Payload, SanitizedPermissions, TypedUser, VisibleEntities } from 'payload'
import React from 'react'

import { NotificationBell } from '@/admin/components/NotificationBell'
import { PrivacyGate } from '@/admin/components/privacy/PrivacyGate'
import { LogoutButton } from '@/components/LogoutButton'

import { ModuleBar } from './ModuleBar'
import { loadFeatures, loadModules, loadNavUser, loadSwitcher, quickCreateFor } from './modules-server'

/**
 * admin.components.Nav (Payload 3.90.1 templates/Default: rendered on EVERY page that uses the
 * DefaultTemplate — built-in list/edit/account views and our custom views wrapped in Frame/Shell —
 * with serverProps {payload, permissions, user, i18n, …} + clientProps {visibleEntities}). Replaces
 * the left sidebar by the Odoo-style top bar: the server computes the visible modules, badges and
 * the bell, the client ModuleBar resolves the active module from the pathname (no module menu since
 * DRMS 13/10 #9 — the module landing page has the tiles).
 * Replacing Nav drops before/afterNavLinks and the default logout slot → bell + logout live here.
 * Also hosts the privacy-notice gate (ADR 0018): this is the one server component on every admin page.
 * DRMS 16/10: the "+ Buat" menu items (quick-create.ts) are resolved here too — the PT features are loaded once and
 * shared with the module list.
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
  const featuresP = loadFeatures(payload, user)
  const [features, modules, companies, who] = await Promise.all([
    featuresP,
    featuresP.then((f) => loadModules({ payload, user, permissions, visibleEntities, i18n, features: f })),
    loadSwitcher(payload, user),
    loadNavUser(payload, user),
  ])
  const quickCreate = quickCreateFor({ user, permissions, visibleEntities, features })
  return (
    <>
      <ModuleBar modules={modules} user={who} companies={companies} quickCreate={quickCreate} bell={<NotificationBell payload={payload} user={user} />} logout={<LogoutButton />} />
      {/* ADR 0018 (Q-46): non-dismissable privacy-notice interstitial until the current version is acknowledged */}
      <PrivacyGate user={user as { privacyAckVersion?: unknown }} />
    </>
  )
}

export default ModuleNav
