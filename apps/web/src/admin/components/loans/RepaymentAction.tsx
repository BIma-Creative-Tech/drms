'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { DateInput } from '../DateInput'
import { RupiahInput, useRupiah } from '../RupiahInput'
import { fieldErrors, newIdemKey, sendJson } from '../kas/client'

/**
 * ADR 0022 §7: "Catat pengembalian" — button + native modal <dialog> (focus trap, Esc closes) with nominal (Rupiah,
 * ≤ sisa pinjaman), tanggal (default today, between the loan date and today) and an optional note. POST
 * /api/v1/project-loans/:id/repayments with one Idempotency-Key per opened dialog / content version. No Direktur
 * approval (Q-L7); the server re-checks role (borrower PM / Finance), status and amount. Styles: KAS_STYLE.
 */
export function RepaymentAction({ loanId, outstanding, loanDate, today }: { loanId: number; outstanding: number; loanDate: string; today: string }) {
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const key = useRef<string | undefined>(undefined)
  const uid = useId()
  const amount = useRupiah(null)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const touch = () => {
    key.current = newIdemKey()
  }
  const open = () => {
    setError(null)
    setErrs({})
    touch()
    ref.current?.showModal()
  }
  const close = () => {
    if (!busy) ref.current?.close()
  }
  const submit = async () => {
    const e: Record<string, string> = {}
    amount.touch()
    const v = amount.parsed.value ?? 0
    if (amount.parsed.error) e.amount = amount.parsed.error
    else if (!(v > 0)) e.amount = 'Nominal pengembalian wajib diisi (> 0).'
    else if (v > outstanding) e.amount = `Nominal melebihi sisa pinjaman (Rp ${new Intl.NumberFormat('id-ID').format(outstanding)}).`
    if (!date) e.repayDate = 'Tanggal pengembalian wajib diisi.'
    else if (date < loanDate) e.repayDate = 'Tanggal pengembalian tidak boleh sebelum tanggal pinjaman.'
    else if (date > today) e.repayDate = 'Tanggal pengembalian tidak boleh di masa depan.'
    setErrs(e)
    setError(null)
    if (Object.keys(e).length > 0) return
    setBusy(true)
    try {
      const r = await sendJson('POST', `/api/v1/project-loans/${loanId}/repayments`, { amount: v, repayDate: date, note: note.trim() || null }, key.current)
      if (!r.ok) {
        setError(r.error)
        setErrs(fieldErrors(r.data))
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
      <button type="button" className="pk-kbtn primary" onClick={open} data-pk-action="loan-repay">
        Catat pengembalian
      </button>
      <dialog ref={ref} className="pk-dlg" aria-labelledby={`${uid}-t`} onCancel={(e) => busy && e.preventDefault()}>
        <div role="form" aria-labelledby={`${uid}-t`}>
          <h2 id={`${uid}-t`}>Catat pengembalian</h2>
          <div className="desc">Sisa pinjaman Rp {new Intl.NumberFormat('id-ID').format(outstanding)}. Tanpa persetujuan Direktur; Direktur dan PM pemberi diberi tahu. Salah catat dibatalkan (void) dengan alasan.</div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-a`}>
              Nominal
              <span className="req" aria-hidden>
                *
              </span>
            </label>
            <RupiahInput
              id={`${uid}-a`}
              field={{
                ...amount,
                onChange: (x: string) => {
                  amount.onChange(x)
                  touch()
                },
              }}
              invalid={!!errs.amount}
              describedBy={`${uid}-ae`}
              testId="repay-amount"
            />
            {amount.error || errs.amount ? (
              <p id={`${uid}-ae`} className="err">
                {amount.error ?? errs.amount}
              </p>
            ) : null}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-d`}>
              Tanggal pengembalian
              <span className="req" aria-hidden>
                *
              </span>
            </label>
            <DateInput
              id={`${uid}-d`}
              value={date}
              min={loanDate}
              max={today}
              onChange={(e) => {
                setDate(e.target.value)
                touch()
              }}
              aria-invalid={errs.repayDate ? true : undefined}
              data-pk-field="repayDate"
            />
            {errs.repayDate ? <p className="err">{errs.repayDate}</p> : null}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-n`}>Catatan</label>
            <textarea
              id={`${uid}-n`}
              value={note}
              maxLength={500}
              onChange={(e) => {
                setNote(e.target.value)
                touch()
              }}
              data-pk-field="repayNote"
            />
          </div>
          {error ? (
            <p className="err" role="alert">
              {error}
            </p>
          ) : null}
          <div className="foot">
            <button type="button" className="pk-kbtn" onClick={close} disabled={busy}>
              Batal
            </button>
            <button type="button" className="pk-kbtn primary" onClick={() => void submit()} disabled={busy} data-pk-confirm="loan-repay">
              {busy ? 'Menyimpan…' : 'Simpan pengembalian'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}

export default RepaymentAction
