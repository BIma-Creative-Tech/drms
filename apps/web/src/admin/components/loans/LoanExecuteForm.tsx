'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { problemText } from '../ActionButton'
import { DateInput } from '../DateInput'
import { confirmAction, confirmLabel, confirmTitle, failureTitle, showResult, successTitle, type Summary } from '../feedback/feedback'
import { OverrideDialog, overridePromptOf, type OverridePrompt } from '../kas/OverrideDialog'
import { KAS_STYLE } from '../kas/style'
import { newIdemKey, sendJson } from '../kas/client'

/**
 * DRMS 24/10 #11/#12: "Eksekusi transfer" of an inter-project loan transfer order in "Antrian Transfer" — Finance gives
 * the bank transfer date (default today, between the loan date and today), an optional note and an optional transfer
 * proof (media-attachments first, then the action with its id; stored on the KK). The accounts are FIXED (frozen at the
 * approval) and only shown. A 409 CASH_OVERDRAFT_CONFIRM_REQUIRED opens the app dialog; "Tetap simpan" re-sends the
 * same body + `confirmOverdraft` (one Idempotency-Key per body). The server re-checks role, status and dates and posts
 * KK + KM in one transaction.
 * DRMS 24/10 (popups): "Yakin ingin eksekusi transfer <PJ>?" (pinjaman, nominal, akun, tanggal, catatan, bukti) before
 * anything is uploaded / sent, the result popup after (the overdraft dialog stays between them when the server asks).
 */
export type LoanExecuteFormProps = {
  url: string
  amountText: string
  /** "Dari <akun> → ke <akun>" (fixed accounts). */
  accountsText: string
  minDate: string
  today: string
  testId: string
  /** DRMS 24/10: the order as named in the popups ("PJ/2026/10/0001" / "pengembalian PJ/…"). */
  docText?: string | null
  /** DRMS 24/10: summary rows of the confirmation popup (pinjaman, dari → ke, nominal …). */
  summary?: Summary
}

async function uploadProof(file: File): Promise<number> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/v1/media/attachments', { method: 'POST', credentials: 'same-origin', body: fd })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(problemText(data, res.status))
  return (data as { id: number }).id
}

const ACTION = 'Eksekusi transfer'

export function LoanExecuteForm({ url, amountText, accountsText, minDate, today, testId, docText = null, summary = [] }: LoanExecuteFormProps) {
  const router = useRouter()
  const uid = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<OverridePrompt | null>(null)
  const pending = useRef<{ body: Record<string, unknown> } | null>(null)

  const send = async (body: Record<string, unknown>) => {
    const r = await sendJson('POST', url, body, newIdemKey())
    if (r.ok) {
      setPrompt(null)
      showResult({ ok: true, title: successTitle(ACTION, docText), message: 'Kas keluar dan kas masuk tercatat di kedua akun.', testId })
      router.refresh()
      return
    }
    const p = overridePromptOf(r.status, r.data)
    if (p) {
      pending.current = { body }
      setPrompt(p)
      return
    }
    setPrompt(null)
    setError(r.error)
    showResult({ ok: false, title: failureTitle(ACTION), message: r.error, testId })
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const f = new FormData(e.currentTarget)
    const date = String(f.get('executeDate') ?? '')
    if (!date) return setError('Isi tanggal transfer sesuai bukti bank.')
    if (date > today) return setError('Tanggal transfer tidak boleh di masa depan.')
    if (date < minDate) return setError('Tanggal transfer tidak boleh sebelum tanggal pinjaman.')
    const note = String(f.get('note') ?? '').trim()
    const body: Record<string, unknown> = { executeDate: date, ...(note ? { note } : {}) }
    const file = f.get('proof')
    const hasFile = file instanceof File && file.size > 0
    const yes = await confirmAction({
      title: confirmTitle(ACTION, docText),
      summary: [...summary, ['Nominal', amountText], ['Akun', accountsText], ['Tanggal transfer', date], ['Catatan', note || null], ['Bukti transfer', hasFile ? file.name : null]],
      confirmLabel: confirmLabel(ACTION),
      testId,
    })
    if (!yes) return
    setBusy(true)
    try {
      if (hasFile) body.proofMediaId = await uploadProof(file)
      await send(body)
    } catch (err) {
      const msg = (err as Error).message || 'Gagal.'
      setError(msg)
      showResult({ ok: false, title: failureTitle(ACTION), message: msg, testId })
    } finally {
      setBusy(false)
    }
  }

  const confirmOverride = async () => {
    if (!prompt || !pending.current) return
    setBusy(true)
    try {
      await send({ ...pending.current.body, [prompt.flag]: true })
    } catch (err) {
      const msg = (err as Error).message || 'Gagal.'
      setPrompt(null)
      setError(msg)
      showResult({ ok: false, title: failureTitle(ACTION), message: msg, testId })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <style href="pk-kas-style" precedence="default">
        {KAS_STYLE}
      </style>
      <form onSubmit={onSubmit} className="pk-mform" data-pk-loan-execute={testId} style={{ display: 'grid', gap: 12, padding: 12, border: '1px solid var(--pk-border)', borderRadius: 'var(--style-radius-m)', background: 'var(--pk-muted-bg)' }}>
        <strong style={{ fontSize: 15 }}>{amountText}</strong>
        <p className="help" style={{ margin: 0 }}>
          {accountsText}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px 16px', alignItems: 'start' }}>
          <div className="pk-fld">
            <label htmlFor={`${uid}-d`}>
              Tanggal transfer<span className="req" aria-hidden>*</span>
            </label>
            <DateInput id={`${uid}-d`} name="executeDate" defaultValue={today} min={minDate} max={today} required data-pk-field="loan-execute-date" />
            <p className="help">Sesuai bukti transfer bank (tanggal kas keluar / masuk).</p>
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-n`}>Catatan</label>
            <input id={`${uid}-n`} type="text" name="note" maxLength={500} autoComplete="off" />
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-p`}>Bukti transfer</label>
            <input id={`${uid}-p`} type="file" name="proof" accept="image/jpeg,image/png,application/pdf" />
            <p className="help">Opsional. JPG, PNG atau PDF.</p>
          </div>
        </div>
        <div className="pk-kact">
          <button type="submit" className="pk-kbtn primary" disabled={busy} data-pk-action={testId}>
            {busy ? 'Memproses…' : 'Eksekusi transfer'}
          </button>
          {error ? (
            <span className="pk-kerr" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      </form>
      <OverrideDialog
        prompt={prompt}
        busy={busy}
        onConfirm={() => void confirmOverride()}
        onCancel={() => {
          setPrompt(null)
          setError('Belum disimpan — konfirmasi dibatalkan.')
        }}
      />
    </>
  )
}

export default LoanExecuteForm
