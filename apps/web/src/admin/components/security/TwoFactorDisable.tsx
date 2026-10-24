'use client'
import React, { useRef, useState } from 'react'

import { confirmAction, confirmLabel, confirmTitle } from '../feedback/feedback'

/**
 * "Nonaktifkan 2FA" — DRMS 24/10: the app confirmation popup (feedback.ts; was an inline confirmation step, never
 * window.confirm). The confirmed form posts to /auth/account-action (same-origin; the server checks the credential is
 * the caller's own), which sends the user to Keycloak: login again (password + code), confirm there, back to the page
 * — the outcome is shown there as the result popup (?status=…, KeamananAkun → SecurityResult).
 */
export function TwoFactorDisable({ credentialId, label }: { credentialId: string; label: string }) {
  const [sending, setSending] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const onClick = async () => {
    const yes = await confirmAction({
      title: confirmTitle('Nonaktifkan 2FA', `untuk ${label}`),
      summary: [['Autentikator', label]],
      description: 'Akun Anda kembali hanya dilindungi kata sandi. Anda akan diminta login ulang (kata sandi dan kode autentikator) lalu mengonfirmasi di halaman Keycloak.',
      confirmLabel: confirmLabel('Nonaktifkan'),
      danger: true,
      testId: '2fa-disable',
    })
    if (!yes) return
    setSending(true)
    form.current?.submit()
  }
  return (
    <form ref={form} method="post" action="/auth/account-action" data-pk-2fa-confirm>
      <input type="hidden" name="action" value="disable" />
      <input type="hidden" name="credentialId" value={credentialId} />
      <button type="button" className="pk-btn pk-btn--danger" onClick={() => void onClick()} disabled={sending} data-pk-2fa-disable={credentialId}>
        {sending ? 'Mengalihkan…' : 'Nonaktifkan 2FA'}
      </button>
    </form>
  )
}

export default TwoFactorDisable
