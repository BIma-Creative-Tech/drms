import React from 'react'

import { PRIVACY_PATH } from '@/legal/paths'

type Props = { searchParams?: Record<string, string | string[] | undefined> }

/** Injected via admin.components.beforeLogin (Login view hides LoginForm with disableLocalStrategy). */
export function SsoLoginButton({ searchParams }: Props) {
  const redirect = typeof searchParams?.redirect === 'string' ? searchParams.redirect : '/admin'
  const href = `/auth/login?returnTo=${encodeURIComponent(redirect)}`
  return (
    <div className="pk-sso">
      <a className="btn btn--style-primary btn--size-large" href={href} id="pk-sso-login">
        Masuk dengan akun DRMS (SSO)
      </a>
      {/* Q-46 / ASVS 8.3.3: the employee privacy notice is readable before login (public page). */}
      <p className="pk-sso__privacy">
        <a href={PRIVACY_PATH} id="pk-privacy-link">
          Pemberitahuan privasi
        </a>
      </p>
    </div>
  )
}

export default SsoLoginButton
