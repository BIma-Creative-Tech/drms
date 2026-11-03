'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { problemText } from '../ActionButton'
import { asConfirmLabel, asConfirmTitle, failureTitle, showResult, successTitle, type Summary } from '../feedback/feedback'
import { FeedbackStyle, SummaryList } from '../feedback/FeedbackHost'
import { newIdemKey, sendJson } from './client'

/**
 * D0311 (user 2026-11-03) "Ganti bukti transfer": Finance / Admin of the PT replace the bank proof of a posted transfer
 * of a "Selesai" request — button + native modal <dialog> (same look as ReasonAction): the new file (JPEG/PNG/PDF,
 * the admin UploadSizeGuard applies) and the REQUIRED reason. The file is uploaded first (POST /api/v1/media/
 * transfer-proofs), then POST /api/v1/expense-requests/{id}/transfers/{tid}/proof. Nothing else of the transfer
 * changes; the old file stays in the Riwayat. No <form>: it also lives inside Payload's document form (see ReasonAction).
 * One Idempotency-Key per opened dialog (the uploaded id is reused on a retry of the same submit).
 */
export type TransferProofReplaceProps = {
  requestId: number
  transferId: number
  transferNo: string
  summary?: Summary
  size?: 'sm' | 'md'
}

const MIN = 3

async function uploadProof(file: File): Promise<number> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/v1/media/transfer-proofs', { method: 'POST', credentials: 'same-origin', body: fd })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(problemText(data, res.status))
  return (data as { id: number }).id
}

export function TransferProofReplace({ requestId, transferId, transferNo, summary, size = 'sm' }: TransferProofReplaceProps) {
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const key = useRef<string | undefined>(undefined)
  const uploaded = useRef<{ file: File; id: number } | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const uid = useId()
  const label = `Ganti bukti ${transferNo}`
  const open = () => {
    setError(null)
    key.current = newIdemKey()
    ref.current?.showModal()
  }
  const close = () => {
    if (!busy) ref.current?.close()
  }
  const submit = async () => {
    const file = fileRef.current?.files?.[0]
    const v = reason.trim()
    if (!file || file.size === 0) return setError('Pilih file bukti transfer yang baru.')
    if (v.length < MIN) return setError(`Alasan wajib diisi (minimal ${MIN} karakter).`)
    setBusy(true)
    setError(null)
    try {
      if (uploaded.current?.file !== file) uploaded.current = { file, id: await uploadProof(file) }
      const r = await sendJson('POST', `/api/v1/expense-requests/${requestId}/transfers/${transferId}/proof`, { proofMediaId: uploaded.current.id, reason: v }, key.current)
      if (!r.ok) {
        setError(r.error)
        showResult({ ok: false, title: failureTitle('Ganti bukti transfer'), message: r.error, testId: `replace-proof-${transferId}` })
        return
      }
      ref.current?.close()
      setReason('')
      uploaded.current = null
      if (fileRef.current) fileRef.current.value = ''
      showResult({ ok: true, title: successTitle(label, null), message: 'Bukti lama tetap tersimpan di Riwayat.', testId: `replace-proof-${transferId}` })
      router.refresh()
    } catch (err) {
      const msg = (err as Error).message || 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.'
      setError(msg)
      showResult({ ok: false, title: failureTitle('Ganti bukti transfer'), message: msg, testId: `replace-proof-${transferId}` })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <FeedbackStyle />
      <button type="button" className={`pk-kbtn${size === 'sm' ? ' sm' : ''}`} onClick={open} data-pk-action={`replace-proof-${transferId}`}>
        {label}
      </button>
      <dialog ref={ref} className="pk-dlg" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-d`} onCancel={(e) => busy && e.preventDefault()}>
        <div role="form" aria-labelledby={`${uid}-t`}>
          <h2 id={`${uid}-t`}>{asConfirmTitle(`Ganti bukti transfer ${transferNo}?`)}</h2>
          <SummaryList summary={summary} />
          <div id={`${uid}-d`} className="desc">
            Hanya file bukti yang diganti. Nominal, tanggal, akun, No. referensi bank dan KK tetap. Bukti lama tetap tersimpan dan dapat dibuka dari Riwayat.
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-f`}>
              Bukti transfer baru<span className="req" aria-hidden>*</span>
            </label>
            <input
              ref={fileRef}
              id={`${uid}-f`}
              type="file"
              name="proof"
              accept="image/jpeg,image/png,application/pdf"
              required
              onChange={() => {
                key.current = newIdemKey() // other file → other body → other key
              }}
            />
            <p className="help">Foto/PDF, maks. 5 MB.</p>
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-r`}>
              Alasan<span className="req" aria-hidden>*</span>
            </label>
            <textarea
              id={`${uid}-r`}
              name="reason"
              value={reason}
              maxLength={1000}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${uid}-e` : undefined}
              onChange={(e) => {
                setReason(e.target.value)
                key.current = newIdemKey()
              }}
            />
            {error ? (
              <p id={`${uid}-e`} className="err" role="alert">
                {error}
              </p>
            ) : (
              <p className="help">Tercatat di audit log. Minimal {MIN} karakter.</p>
            )}
          </div>
          <div className="foot">
            <button type="button" className="pk-kbtn" onClick={close} disabled={busy}>
              Batal
            </button>
            <button type="button" onClick={() => void submit()} className="pk-kbtn primary" disabled={busy} data-pk-confirm={`replace-proof-${transferId}`}>
              {busy ? 'Memproses…' : asConfirmLabel('Ganti bukti')}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}

export default TransferProofReplace
