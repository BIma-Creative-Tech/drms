'use client'
import React, { useId, useRef, useState } from 'react'

import { KAS_STYLE } from './kas/style'

/**
 * QA-22 / QA-23: the app dialog for confirmations and reasons (replaces window.confirm / prompt /
 * alert) — same look and behaviour as the Void (kas/ReasonAction) and Addendum (addendum/ConfirmAction)
 * dialogs: native modal <dialog> (focus trap, Esc closes, focus returns to the button), visible label,
 * inline error linked by aria-describedby, busy state, the dialog STAYS OPEN on a too-short reason or a
 * server error. No <form>: these buttons also live inside Payload's document <form> (expense-request
 * edit view), where a nested form is invalid and Enter must not submit the document.
 *
 * `onConfirm` performs the action and returns an error text (dialog stays open) or null (closed).
 * `rotateKey` is called when the dialog opens and when the reason changes, so the caller can keep one
 * Idempotency-Key per opened dialog + body (G15).
 */
export type ActionDialogProps = {
  label: string
  title: string
  description?: React.ReactNode
  confirmLabel: string
  /** Text field (reason/note). Omitted = confirmation only. */
  field?: { label: string; minLength?: number; maxLength?: number; required?: boolean; help?: string }
  onConfirm: (value: string) => Promise<string | null>
  rotateKey?: () => void
  /** Class of the trigger button (defaults to the Payload small secondary button). */
  buttonClassName?: string
  buttonStyle?: React.CSSProperties
  danger?: boolean
  testId?: string
}

const MIN = 3

export function ActionDialog({ label, title, description, confirmLabel, field, onConfirm, rotateKey, buttonClassName, buttonStyle, danger, testId }: ActionDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const uid = useId()
  const min = field ? (field.minLength ?? (field.required === false ? 0 : MIN)) : 0

  const open = () => {
    setError(null)
    rotateKey?.()
    ref.current?.showModal()
  }
  const close = () => {
    if (!busy) ref.current?.close()
  }
  const confirm = async () => {
    if (busy) return
    const v = value.trim()
    if (field && v.length < min) {
      setError(min > 0 ? `${field.label} wajib diisi (minimal ${min} karakter).` : `${field.label} wajib diisi.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const err = await onConfirm(v)
      if (err) {
        setError(err)
        return
      }
      ref.current?.close()
      setValue('')
    } catch {
      setError('Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.')
    } finally {
      setBusy(false)
    }
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    // inside Payload's form: Enter never submits the document; Ctrl/⌘+Enter confirms from the text field
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void confirm()
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) e.preventDefault()
  }

  return (
    <>
      {/* React 19 hoists + dedupes this stylesheet (dialog/button/field classes of the Kas views) */}
      <style href="pk-kas-style" precedence="default">
        {KAS_STYLE}
      </style>
      <button type="button" className={buttonClassName ?? 'btn btn--style-secondary btn--size-small'} style={buttonStyle ?? { margin: 0 }} onClick={open} data-pk-action={testId}>
        {label}
      </button>
      <dialog ref={ref} className="pk-dlg" aria-labelledby={`${uid}-t`} aria-describedby={description ? `${uid}-d` : undefined} onCancel={(e) => busy && e.preventDefault()} onKeyDown={onKeyDown} data-pk-dialog={testId}>
        <div style={{ display: 'grid', gap: 14, padding: 20 }}>
          <h2 id={`${uid}-t`} style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>
            {title}
          </h2>
          {description ? (
            <div id={`${uid}-d`} className="desc">
              {description}
            </div>
          ) : null}
          {field ? (
            <div className="pk-fld">
              <label htmlFor={`${uid}-r`}>
                {field.label}
                {min > 0 ? (
                  <span className="req" aria-hidden>
                    *
                  </span>
                ) : null}
              </label>
              <textarea
                id={`${uid}-r`}
                value={value}
                maxLength={field.maxLength ?? 1000}
                aria-required={min > 0 ? true : undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${uid}-e` : `${uid}-h`}
                onChange={(e) => {
                  setValue(e.target.value)
                  if (error) setError(null)
                  rotateKey?.() // other body → other key (same key + other body = 422)
                }}
                autoFocus
                data-pk-reason={testId}
              />
              {error ? (
                <p id={`${uid}-e`} className="err" role="alert">
                  {error}
                </p>
              ) : (
                <p id={`${uid}-h`} className="help">
                  {field.help ?? (min > 0 ? `Tercatat di audit log. Minimal ${min} karakter.` : 'Opsional.')}
                </p>
              )}
            </div>
          ) : error ? (
            <p className="pk-kerr" role="alert">
              {error}
            </p>
          ) : null}
          <div className="foot">
            <button type="button" className="pk-kbtn" onClick={close} disabled={busy}>
              Batal
            </button>
            <button type="button" className={`pk-kbtn ${danger ? 'danger-solid' : 'primary'}`} onClick={() => void confirm()} disabled={busy} data-pk-confirm={testId} autoFocus={!field}>
              {busy ? 'Memproses…' : confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}

export default ActionDialog
