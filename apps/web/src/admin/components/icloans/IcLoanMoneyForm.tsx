'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { formatRupiah } from '@/lib/money'

import { problemText } from '../ActionButton'
import { DateInput } from '../DateInput'
import { useDocSummary } from '../feedback/DocContext'
import { confirmAction, confirmLabel, confirmTitle, failureTitle, showResult, successTitle } from '../feedback/feedback'
import { OverrideDialog, overridePromptOf, type OverridePrompt } from '../kas/OverrideDialog'
import { KAS_STYLE } from '../kas/style'
import { newIdemKey, sendJson } from '../kas/client'
import { RupiahInput, useRupiah } from '../RupiahInput'
import { WrapSelect } from '../WrapSelect'

/**
 * ADR 0029 §3.5 / §3.6: the money form of an inter-PT loan movement — "Cairkan pinjaman" (Finance of the LENDER, amount =
 * the loan amount, fixed) and "Catat pengembalian" (Finance of the BORROWER, amount ≤ outstanding, editable). Source
 * account (the paying PT's accounts WITHOUT a site), date + time of the bank proof, bank reference and the proof upload
 * (media-transfer-proofs first, then the action with its id). A 409 CASH_OVERDRAFT_CONFIRM_REQUIRED opens the app
 * dialog; "Tetap simpan" re-sends the same body + `confirmOverdraft` (one Idempotency-Key per body). The server
 * re-checks role, G1, the fund check and both PTs' lock dates.
 * DRMS 24/10: confirmation popup (the loan of the surrounding DocSummaryProvider + akun, nominal, waktu, referensi)
 * before the upload, result popup after (the overdraft dialog stays in between when the server asks).
 */
export type IcLoanMoneyFormProps = {
  url: string
  submitLabel: string
  accounts: Array<{ id: number; name: string }>
  amountText: string
  /** Repayment: editable amount up to `max`; omitted = the fixed loan amount (disbursement). */
  amount?: { max: number }
  testId: string
}

async function uploadProof(file: File): Promise<number> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/v1/media/transfer-proofs', { method: 'POST', credentials: 'same-origin', body: fd })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(problemText(data, res.status))
  return (data as { id: number }).id
}

export function IcLoanMoneyForm({ url, submitLabel, accounts, amountText, amount, testId }: IcLoanMoneyFormProps) {
  const router = useRouter()
  const uid = useId()
  const money = useRupiah(amount ? amount.max : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<OverridePrompt | null>(null)
  const pending = useRef<{ body: Record<string, unknown>; key?: string } | null>(null)
  const doc = useDocSummary()

  const send = async (body: Record<string, unknown>, key?: string) => {
    const r = await sendJson('POST', url, body, key)
    if (r.ok) {
      setPrompt(null)
      showResult({ ok: true, title: successTitle(submitLabel, doc.object), message: 'Kas keluar / masuk kedua PT tercatat.' })
      router.refresh()
      return
    }
    const p = overridePromptOf(r.status, r.data)
    if (p) {
      pending.current = { body, key }
      setPrompt(p)
      return
    }
    setPrompt(null)
    setError(r.error)
    showResult({ ok: false, title: failureTitle(submitLabel), message: r.error })
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const f = new FormData(e.currentTarget)
    const at = String(f.get('transferAt') ?? '')
    if (!at) return setError('Isi tanggal & jam transfer sesuai bukti.')
    const bankRef = String(f.get('bankRef') ?? '').trim()
    if (!bankRef) return setError('Nomor referensi bank wajib diisi.')
    const body: Record<string, unknown> = { cashAccountId: Number(f.get('cashAccountId')), transferAt: at, bankRef }
    if (amount) {
      money.touch()
      const v = money.parsed.value ?? 0
      if (money.parsed.error) return setError(money.parsed.error)
      if (!(v > 0)) return setError('Nominal pengembalian wajib diisi (> 0).')
      if (v > amount.max) return setError(`Nominal melebihi sisa pinjaman (${formatRupiah(amount.max)}).`)
      body.amount = v
    }
    const file = f.get('proof')
    if (!(file instanceof File) || file.size === 0) return setError('Bukti transfer wajib diunggah.')
    const yes = await confirmAction({
      title: confirmTitle(submitLabel, doc.object),
      summary: [
        ...(doc.summary ?? []),
        ['Akun kas sumber', accounts.find((a) => a.id === body.cashAccountId)?.name ?? null],
        ['Nominal', amount ? formatRupiah(Number(body.amount)) : amountText],
        ['Tanggal & jam transfer', at.replace('T', ' ')],
        ['No. referensi bank', bankRef],
      ],
      confirmLabel: confirmLabel(submitLabel),
    })
    if (!yes) return
    setBusy(true)
    try {
      body.proofMediaId = await uploadProof(file)
      await send(body, newIdemKey())
    } catch (err) {
      const msg = (err as Error).message || 'Gagal.'
      setError(msg)
      showResult({ ok: false, title: failureTitle(submitLabel), message: msg })
    } finally {
      setBusy(false)
    }
  }

  const confirmOverride = async () => {
    if (!prompt || !pending.current) return
    setBusy(true)
    try {
      await send({ ...pending.current.body, [prompt.flag]: true }, newIdemKey())
    } catch (err) {
      setPrompt(null)
      const msg = (err as Error).message || 'Gagal.'
      setError(msg)
      showResult({ ok: false, title: failureTitle(submitLabel), message: msg })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <style href="pk-kas-style" precedence="default">
        {KAS_STYLE}
      </style>
      <form onSubmit={onSubmit} className="pk-mform" data-pk-icloan-form={testId} style={{ display: 'grid', gap: 12, padding: 12, border: '1px solid var(--pk-border)', borderRadius: 'var(--style-radius-m)', background: 'var(--pk-muted-bg)' }}>
        <strong style={{ fontSize: 15 }}>{amountText}</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px 16px', alignItems: 'start' }}>
          <div className="pk-fld">
            <label htmlFor={`${uid}-acc`}>
              Akun kas sumber<span className="req" aria-hidden>*</span>
            </label>
            <WrapSelect id={`${uid}-acc`} name="cashAccountId" required defaultValue={accounts[0]?.id}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </WrapSelect>
            <p className="help">Tanpa akun site (kas kecil / rekening cabang).</p>
          </div>
          {amount ? (
            <div className="pk-fld">
              <label htmlFor={`${uid}-amt`}>
                Nominal<span className="req" aria-hidden>*</span>
              </label>
              <RupiahInput id={`${uid}-amt`} field={money} testId="icloan-amount" required />
              <p className="help">Maksimal {formatRupiah(amount.max)} (sisa pinjaman). Boleh bertahap.</p>
            </div>
          ) : null}
          <div className="pk-fld">
            <label htmlFor={`${uid}-at`}>
              Tanggal &amp; jam transfer<span className="req" aria-hidden>*</span>
            </label>
            <DateInput id={`${uid}-at`} type="datetime-local" name="transferAt" required step={60} data-pk-field="icloan-transfer-at" hintClassName="help" />
            <p className="help">Sesuai bukti transfer bank.</p>
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-ref`}>
              No. referensi bank<span className="req" aria-hidden>*</span>
            </label>
            <input id={`${uid}-ref`} type="text" name="bankRef" required maxLength={64} autoComplete="off" />
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-proof`}>
              Bukti transfer<span className="req" aria-hidden>*</span>
            </label>
            <input id={`${uid}-proof`} type="file" name="proof" accept="image/jpeg,image/png,application/pdf" required />
            <p className="help">JPG, PNG atau PDF.</p>
          </div>
        </div>
        <div className="pk-kact">
          <button type="submit" className="pk-kbtn primary" disabled={busy || accounts.length === 0} data-pk-action={testId}>
            {busy ? 'Memproses…' : submitLabel}
          </button>
          {accounts.length === 0 ? <span className="pk-kerr">Belum ada akun kas aktif tanpa site di PT ini.</span> : null}
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

export default IcLoanMoneyForm
