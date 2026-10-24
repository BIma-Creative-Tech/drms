'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { useDocSummary } from '../feedback/DocContext'
import { asConfirmLabel, asConfirmTitle, failureTitle, showResult, successTitle, type Summary } from '../feedback/feedback'
import { FeedbackStyle, SummaryList } from '../feedback/FeedbackHost'
import { newIdemKey, sendJson } from '../kas/client'

/**
 * E5: button + native modal <dialog> confirming a decision WITHOUT a text field (Direktur "Setujui",
 * Finance "Setujui", submit). Same behaviour as ReasonAction (focus trap, Esc, busy state, one
 * Idempotency-Key per opened dialog so a network retry is replayed, not executed twice). The server
 * re-checks role, step and state. Styles: KAS_STYLE (rendered once by the host view).
 * DRMS 24/10: "Yakin ingin …?" with the summary (prop or the surrounding DocSummaryProvider), result popup after.
 */
export function ConfirmAction({ url, label, title, description, confirmLabel, testId, variant = 'primary', size = 'sm', summary: summaryProp, success }: { url: string; label: string; title: string; description: React.ReactNode; confirmLabel: string; testId?: string; variant?: 'primary' | 'secondary'; size?: 'sm' | 'md'; summary?: Summary; success?: string }) {
  const router = useRouter()
  const doc = useDocSummary()
  const summary = summaryProp ?? doc.summary
  const ref = useRef<HTMLDialogElement>(null)
  const key = useRef<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const uid = useId()
  const open = () => {
    setError(null)
    key.current = newIdemKey()
    ref.current?.showModal()
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await sendJson('POST', url, {}, key.current)
      if (!r.ok) {
        setError(r.error)
        showResult({ ok: false, title: failureTitle(confirmLabel), message: r.error, testId })
        return
      }
      ref.current?.close()
      showResult({ ok: true, title: successTitle(confirmLabel, doc.object), message: success ?? null, testId })
      router.refresh()
    } catch {
      const msg = 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.'
      setError(msg)
      showResult({ ok: false, title: failureTitle(confirmLabel), message: msg, testId })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <FeedbackStyle />
      <button type="button" className={`pk-kbtn ${variant === 'primary' ? 'primary' : ''}${size === 'sm' ? ' sm' : ''}`} onClick={open} data-pk-action={testId}>
        {label}
      </button>
      <dialog ref={ref} className="pk-dlg" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-d`} onCancel={(e) => busy && e.preventDefault()}>
        <form onSubmit={submit} noValidate>
          <h2 id={`${uid}-t`}>{asConfirmTitle(title)}</h2>
          <SummaryList summary={summary} />
          <div id={`${uid}-d`} className="desc">
            {description}
          </div>
          {error ? (
            <p className="pk-kerr" role="alert">
              {error}
            </p>
          ) : null}
          <div className="foot">
            <button type="button" className="pk-kbtn" onClick={() => !busy && ref.current?.close()} disabled={busy}>
              Batal
            </button>
            <button type="submit" className="pk-kbtn primary" disabled={busy} data-pk-confirm={testId} autoFocus>
              {busy ? 'Memproses…' : asConfirmLabel(confirmLabel)}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

export default ConfirmAction
