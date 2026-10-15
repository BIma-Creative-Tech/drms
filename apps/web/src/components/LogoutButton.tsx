import React from 'react'

/** admin.components.logout.Button → POST /auth/logout (revokes web session + Keycloak RP logout). */
export function LogoutButton() {
  return (
    <form action="/auth/logout" method="post" className="pk-logout">
      <button type="submit" id="pk-logout" className="btn btn--style-secondary btn--size-small pk-pbtn">
        Keluar
      </button>
    </form>
  )
}

export default LogoutButton
