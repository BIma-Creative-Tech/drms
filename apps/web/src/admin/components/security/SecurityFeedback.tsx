'use client'
import React, { useEffect, useRef, useState } from 'react'

import { confirmAction, confirmLabel, confirmTitle, showResult } from '../feedback/feedback'

/**
 * DRMS 24/10 (popup before + after every data-changing action) for the "Keamanan akun" page, whose actions are plain
 * form posts to /auth/account-action that continue at Keycloak:
 * - `ConfirmSubmit`: the submit button of such a form — asks first (confirmation popup), then submits the form;
 * - `SecurityResult`: the outcome Keycloak sends back (?status=…) as the result popup, once per page load (the inline
 *   message stays).
 */
export function ConfirmSubmit({ action, description, className, children }: { action: string; description?: string; className?: string; children: React.ReactNode }) {
  const [sending, setSending] = useState(false)
  const onClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = e.currentTarget.form
    if (!(await confirmAction({ title: confirmTitle(action), description, confirmLabel: confirmLabel(action) }))) return
    setSending(true)
    form?.submit()
  }
  return (
    <button type="button" className={className} onClick={(e) => void onClick(e)} disabled={sending}>
      {sending ? 'Mengalihkan…' : children}
    </button>
  )
}

export function SecurityResult({ ok, title, message }: { ok: boolean; title: string; message: string }) {
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current) return
    shown.current = true
    showResult({ ok, title, message, testId: '2fa-result' })
  }, [ok, title, message])
  return null
}
