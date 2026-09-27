'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { newIdemKey, sendJson } from '../kas/client'

/**
 * E5: button + native modal <dialog> confirming a decision WITHOUT a text field (Direktur "Setujui",
 * Finance "Setujui", submit). Same behaviour as ReasonAction (focus trap, Esc, busy state, one
 * Idempotency-Key per opened dialog so a network retry is replayed, not executed twice). The server
 * re-checks role, step and state. Styles: KAS_STYLE (rendered once by the host view).
 */
export function ConfirmAction({ url, label, title, description, confirmLabel, testId, variant = 'primary', size = 'sm' }: { url: string; label: string; title: string; description: React.ReactNode; confirmLabel: string; testId?: string; variant?: 'primary' | 'secondary'; size?: 'sm' | 'md' }) {
  const router = useRouter()
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
        return
      }
      ref.current?.close()
      router.refresh()
    } catch {
      setError('Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className={`pk-kbtn ${variant === 'primary' ? 'primary' : ''}${size === 'sm' ? ' sm' : ''}`} onClick={open} data-pk-action={testId}>
        {label}
      </button>
      <dialog ref={ref} className="pk-dlg" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-d`} onCancel={(e) => busy && e.preventDefault()}>
        <form onSubmit={submit} noValidate>
          <h2 id={`${uid}-t`}>{title}</h2>
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
              {busy ? 'Memproses…' : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

export default ConfirmAction
