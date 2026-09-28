'use client'
import React, { useId, useState } from 'react'

/**
 * "Nonaktifkan 2FA" with an inline confirmation step (no window.confirm). The confirmed form posts
 * to /auth/account-action (same-origin; the server checks the credential is the caller's own), which
 * sends the user to Keycloak: login again (password + code), confirm there, back to the page.
 */
export function TwoFactorDisable({ credentialId, label }: { credentialId: string; label: string }) {
  const [asking, setAsking] = useState(false)
  const [sending, setSending] = useState(false)
  const id = useId()
  if (!asking) {
    return (
      <button type="button" className="pk-btn" onClick={() => setAsking(true)} data-pk-2fa-disable={credentialId}>
        Nonaktifkan 2FA
      </button>
    )
  }
  return (
    <form method="post" action="/auth/account-action" className="pk-sec__confirm" role="group" aria-labelledby={id} onSubmit={() => setSending(true)} data-pk-2fa-confirm>
      <input type="hidden" name="action" value="disable" />
      <input type="hidden" name="credentialId" value={credentialId} />
      <p id={id}>
        Nonaktifkan 2FA untuk <strong>{label}</strong>? Akun Anda kembali hanya dilindungi kata sandi. Anda akan diminta login ulang (kata sandi dan kode
        autentikator) lalu mengonfirmasi di halaman Keycloak.
      </p>
      <div className="pk-actions">
        <button type="submit" className="pk-btn pk-btn--danger" disabled={sending} autoFocus>
          {sending ? 'Mengalihkan…' : 'Ya, nonaktifkan'}
        </button>
        <button type="button" className="pk-btn" onClick={() => setAsking(false)} disabled={sending}>
          Batal
        </button>
      </div>
    </form>
  )
}

export default TwoFactorDisable
