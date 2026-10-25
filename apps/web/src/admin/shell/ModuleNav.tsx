import { cookies } from 'next/headers'
import type { Payload, SanitizedPermissions, TypedUser, VisibleEntities } from 'payload'
import React from 'react'

import { NotificationBell } from '@/admin/components/NotificationBell'
import { PrivacyGate } from '@/admin/components/privacy/PrivacyGate'
import { LogoutButton } from '@/components/LogoutButton'

import { ModuleBar } from './ModuleBar'
import { loadFeatures, loadModules, loadNavUser, loadSwitcher, quickCreateFor } from './modules-server'
import { SIDEBAR_COOKIE, sidebarMode } from './nav-search'

/**
 * admin.components.Nav (Payload 3.90.1 templates/Default: rendered on EVERY page that uses the
 * DefaultTemplate — built-in list/edit/account views and our custom views wrapped in Frame/Shell —
 * with serverProps {payload, permissions, user, i18n, …} + clientProps {visibleEntities}). D2510 (ADR 0033):
 * renders the Nexus-style shell — left sidebar with every visible module/menu item + slim top bar — instead of
 * Payload's sidebar: the server computes the visible modules, badges, the bell and the sidebar width (cookie), the
 * client ModuleBar resolves the active module/item from the pathname.
 * Replacing Nav drops before/afterNavLinks and the default logout slot → bell + logout live here.
 * Also hosts the privacy-notice gate (ADR 0018): this is the one server component on every admin page.
 * DRMS 16/10: the "+ Buat" menu items (quick-create.ts) are resolved here too — the PT features are loaded once and
 * shared with the module list.
 */
/** The `pk-side` cookie of this request; outside a request scope (tests) → the full sidebar. */
async function sidebarModeOfRequest() {
  try {
    return sidebarMode((await cookies()).get(SIDEBAR_COOKIE)?.value)
  } catch {
    return sidebarMode(undefined)
  }
}

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
  const mode = await sidebarModeOfRequest()
  return (
    <>
      <ModuleBar modules={modules} user={who} companies={companies} quickCreate={quickCreate} sidebarMode={mode} bell={<NotificationBell payload={payload} user={user} />} logout={<LogoutButton />} />
      {/* ADR 0018 (Q-46): non-dismissable privacy-notice interstitial until the current version is acknowledged */}
      <PrivacyGate user={user as { privacyAckVersion?: unknown }} />
    </>
  )
}

export default ModuleNav
