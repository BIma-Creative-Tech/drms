'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { newIdemKey, sendJson } from './client'

/**
 * E2: button + native modal <dialog> (focus trap, Esc closes, focus returns to the button) asking
 * for a REQUIRED reason before an irreversible cash action (void KM/KK, void transfer, re-open a
 * period). Replaces window.prompt for these actions: label, helper text, inline error linked with
 * aria-describedby, busy state. One Idempotency-Key per opened dialog: a network retry of the same
 * submit is replayed by the server instead of executed twice (G15). The server re-checks role,
 * state and the reason (Zod min 3). Styles: KAS_STYLE, rendered ONCE by the host view.
 */
export type ReasonActionProps = {
  url: string
  label: string
  title: string
  description: React.ReactNode
  confirmLabel: string
  fieldLabel?: string
  field?: 'reason' | 'note'
  /** Extra JSON fields sent with the reason. */
  body?: Record<string, unknown>
  /** note (period close) is optional; reason is always required. */
  required?: boolean
  variant?: 'danger' | 'primary' | 'secondary'
  size?: 'sm' | 'md'
  testId?: string
  /** Navigate here after success instead of refreshing the current view. */
  redirectTo?: string
}

const MIN = 3

export function ReasonAction({ url, label, title, description, confirmLabel, fieldLabel = 'Alasan', field = 'reason', body, required = true, variant = 'danger', size = 'sm', testId, redirectTo }: ReasonActionProps) {
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const key = useRef<string | undefined>(undefined)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const uid = useId()
  const open = () => {
    setError(null)
    key.current = newIdemKey()
    ref.current?.showModal()
  }
  const close = () => {
    if (!busy) ref.current?.close()
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (required && v.length < MIN) {
      setError(`${fieldLabel} wajib diisi (minimal ${MIN} karakter).`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = { ...(body ?? {}) }
      if (v) payload[field] = v
      const r = await sendJson('POST', url, payload, key.current)
      if (!r.ok) {
        setError(r.error)
        return
      }
      ref.current?.close()
      setValue('')
      if (redirectTo) router.push(redirectTo)
      router.refresh()
    } catch {
      setError('Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.')
    } finally {
      setBusy(false)
    }
  }
  const btn = `pk-kbtn ${variant === 'secondary' ? '' : variant}${size === 'sm' ? ' sm' : ''}`
  return (
    <>
      <button type="button" className={btn} onClick={open} data-pk-action={testId}>
        {label}
      </button>
      <dialog ref={ref} className="pk-dlg" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-d`} onCancel={(e) => busy && e.preventDefault()}>
        <form onSubmit={submit} noValidate>
          <h2 id={`${uid}-t`}>{title}</h2>
          <div id={`${uid}-d`} className="desc">
            {description}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-r`}>
              {fieldLabel}
              {required ? (
                <span className="req" aria-hidden>
                  *
                </span>
              ) : null}
            </label>
            <textarea
              id={`${uid}-r`}
              name={field}
              value={value}
              maxLength={field === 'note' ? 500 : 1000}
              required={required}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${uid}-e` : undefined}
              onChange={(e) => {
                setValue(e.target.value)
                key.current = newIdemKey() // other body → other key (same key + other body = 422)
              }}
              autoFocus
            />
            {error ? (
              <p id={`${uid}-e`} className="err" role="alert">
                {error}
              </p>
            ) : required ? (
              <p className="help">Tercatat di audit log. Minimal {MIN} karakter.</p>
            ) : null}
          </div>
          <div className="foot">
            <button type="button" className="pk-kbtn" onClick={close} disabled={busy}>
              Batal
            </button>
            <button type="submit" className={`pk-kbtn ${variant === 'danger' ? 'danger-solid' : 'primary'}`} disabled={busy} data-pk-confirm={testId}>
              {busy ? 'Memproses…' : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

export default ReasonAction
