import React from 'react'

import { PrivacyNoticeBody } from '@/legal/PrivacyNoticeBody'
import { PRIVACY_NOTICE, privacyAckCurrent } from '@/legal/privacy-notice'

import { PrivacyInterstitial } from './PrivacyInterstitial'

/**
 * Server half of the admin privacy gate (ADR 0018), rendered by the shell Nav (src/admin/shell/ModuleNav.tsx) on
 * every admin page: nothing when the user acknowledged the current notice, else the non-dismissable interstitial
 * with the server-rendered notice. The decision uses the user row of THIS request (the session strategy loads it).
 */
export function PrivacyGate({ user }: { user: { privacyAckVersion?: unknown } | null | undefined }) {
  if (!user || privacyAckCurrent(user.privacyAckVersion)) return null
  return (
    <PrivacyInterstitial version={PRIVACY_NOTICE.version} title={PRIVACY_NOTICE.title}>
      <PrivacyNoticeBody skipTitle />
    </PrivacyInterstitial>
  )
}

export default PrivacyGate
