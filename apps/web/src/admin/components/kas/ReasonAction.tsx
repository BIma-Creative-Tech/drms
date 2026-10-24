'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { useDocSummary } from '../feedback/DocContext'
import { asConfirmLabel, asConfirmTitle, failureTitle, showResult, successTitle, type Summary } from '../feedback/feedback'
import { FeedbackStyle, SummaryList } from '../feedback/FeedbackHost'
import { newIdemKey, sendJson } from './client'

/**
 * E2: button + native modal <dialog> (focus trap, Esc closes, focus returns to the button) asking
 * for a REQUIRED reason before an irreversible cash action (void KM/KK, void transfer, re-open a
 * period). Replaces window.prompt for these actions: label, helper text, inline error linked with
 * aria-describedby, busy state. One Idempotency-Key per opened dialog: a network retry of the same
 * submit is replayed by the server instead of executed twice (G15). The server re-checks role,
 * state and the reason (Zod min 3). Styles: KAS_STYLE, rendered ONCE by the host view.
 * No <form>: the transfer void lives in the expense-request workflow panel, i.e. INSIDE Payload's document
 * <form> — a nested <form> is invalid HTML and broke hydration of the request detail (DRMS 10/10 int., g).
 * The confirm button submits by click; the textarea keeps Enter for new lines (same as ActionDialog).
 * DRMS 24/10: this dialog IS the confirmation (no second popup) — it shows the `summary` of the surrounding
 * DocSummaryProvider (number, amount, person) unless given, and the result popup follows (feedback.ts): "Berhasil:
 * <aksi> <dokumen>" or the server's error on top of the still-open dialog.
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
  /**
   * ADR 0029: an explicit confirmation checkbox sent as `{ [field]: true }` when ticked (e.g. `confirmBorrowerShortfall`
   * of a loan disbursement void — the server answers 409 with the figures while it is missing).
   */
  confirm?: { field: string; label: string }
  /** DRMS 24/10: what is affected; default the surrounding DocSummaryProvider. */
  summary?: Summary
  /** DRMS 24/10: message of the success popup. */
  success?: string
}

const MIN = 3

export function ReasonAction({ url, label, title, description, confirmLabel, fieldLabel = 'Alasan', field = 'reason', body, required = true, variant = 'danger', size = 'sm', testId, redirectTo, confirm, summary: summaryProp, success }: ReasonActionProps) {
  const router = useRouter()
  const doc = useDocSummary()
  const summary = summaryProp ?? doc.summary
  const ref = useRef<HTMLDialogElement>(null)
  const key = useRef<string | undefined>(undefined)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const uid = useId()
  const open = () => {
    setError(null)
    key.current = newIdemKey()
    ref.current?.showModal()
  }
  const close = () => {
    if (!busy) ref.current?.close()
  }
  const submit = async () => {
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
      if (confirm && confirmed) payload[confirm.field] = true
      const r = await sendJson('POST', url, payload, key.current)
      if (!r.ok) {
        setError(r.error)
        showResult({ ok: false, title: failureTitle(confirmLabel), message: r.error, testId })
        return
      }
      ref.current?.close()
      setValue('')
      // "Void transfer TRF/…" (label) names its document; "Tolak" + "Tolak addendum" → the provider's number
      const act = label.length > confirmLabel.length ? label : confirmLabel
      showResult({ ok: true, title: successTitle(act, /\S\/\S/.test(act) ? null : doc.object), message: success ?? null, testId })
      if (redirectTo) router.push(redirectTo)
      router.refresh()
    } catch {
      const msg = 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.'
      setError(msg)
      showResult({ ok: false, title: failureTitle(confirmLabel), message: msg, testId })
    } finally {
      setBusy(false)
    }
  }
  const btn = `pk-kbtn ${variant === 'secondary' ? '' : variant}${size === 'sm' ? ' sm' : ''}`
  return (
    <>
      <FeedbackStyle />
      <button type="button" className={btn} onClick={open} data-pk-action={testId}>
        {label}
      </button>
      <dialog ref={ref} className="pk-dlg" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-d`} onCancel={(e) => busy && e.preventDefault()}>
        <div role="form" aria-labelledby={`${uid}-t`}>
          <h2 id={`${uid}-t`}>{asConfirmTitle(title)}</h2>
          <SummaryList summary={summary} />
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
          {confirm ? (
            <label className="pk-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => {
                  setConfirmed(e.target.checked)
                  key.current = newIdemKey() // other body → other key
                }}
                data-pk-confirm-field={confirm.field}
              />
              <span>{confirm.label}</span>
            </label>
          ) : null}
          <div className="foot">
            <button type="button" className="pk-kbtn" onClick={close} disabled={busy}>
              Batal
            </button>
            <button type="button" onClick={() => void submit()} className={`pk-kbtn ${variant === 'danger' ? 'danger-solid' : 'primary'}`} disabled={busy} data-pk-confirm={testId}>
              {busy ? 'Memproses…' : asConfirmLabel(confirmLabel)}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}

export default ReasonAction
