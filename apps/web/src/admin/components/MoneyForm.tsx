'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { postJson, problemText } from './ActionButton'
import { useDocSummary } from './feedback/DocContext'
import { confirmAction, confirmLabel, confirmTitle, failureTitle, showResult, successTitle, type Summary } from './feedback/feedback'
import { OverrideDialog, overridePromptOf, type OverridePrompt } from './kas/OverrideDialog'
import { DateInput } from './DateInput'
import { KAS_STYLE } from './kas/style'
import { WrapSelect } from './WrapSelect'

/**
 * Finance forms of the transfer queue (T3, US-20) and the LPJ settlement (T5, US-22): cash account,
 * date (transfer: date + time of the bank proof, required — item 11), bank reference and proof upload (multipart to /api/v1/media/{kind} first, then the
 * action with the returned id). Amounts are never entered: the server copies/computes them (G3).
 * QA 2026-10-08: a 409 asking for confirmation (unverified destination account QA-17, balance below 0
 * QA-04) opens the app dialog; "Tetap simpan" re-sends the same body + flag (the proof is not re-uploaded).
 * DRMS 24/10: after the client checks, "Yakin ingin <submitLabel> <dokumen>?" with the document (DocSummaryProvider),
 * account, date, reference and amount; the result popup follows the save (or the server's error).
 */
export type MoneyFormProps = {
  url: string
  submitLabel: string
  cashAccounts: Array<{ id: number; name: string }>
  bankRef: 'required' | 'none'
  proof: { kind: 'transfer-proofs' | 'attachments'; required: boolean } | null
  amountText: string
  /**
   * QA-11: read-only GET checked BEFORE the proof upload (e.g. …/settle/precheck) — a configuration
   * error is shown without leaving an orphan file behind.
   */
  precheckUrl?: string
  /**
   * ADR 0031 (DRMS 21/10): transfer only — the project's Pusat Biaya (cash account). It is the default "Dibayar dari
   * akun"; picking another account shows the automatic inter-project loan panel (reason required, due date optional).
   * `missing`: a project request whose project is not mapped yet — the transfer is refused until it is.
   */
  pusatBiaya?: { id: number; name: string } | null
  pusatBiayaMissing?: boolean
}

/** B-2 integration: the money form in the admin field look (KAS_STYLE .pk-fld), one row on desktop, stacked on a phone. */
const MFORM_STYLE = `
.pk-mform { display: grid; gap: 12px; padding: 12px; border: 1px solid var(--pk-border); border-radius: var(--style-radius-m); background: var(--pk-muted-bg); }
.pk-mform__amount { font-size: 15px; font-variant-numeric: tabular-nums; }
.pk-mform__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px 16px; align-items: start; }
.pk-mform .pk-fld :is(input:not([type='checkbox'], [type='radio']), select) { background: var(--theme-input-bg, var(--pk-card)); }
`

async function uploadProof(kind: string, file: File): Promise<number> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/v1/media/${kind}`, { method: 'POST', credentials: 'same-origin', body: fd })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(problemText(data, res.status))
  return (data as { id: number }).id
}

export function MoneyForm({ url, submitLabel, cashAccounts, bankRef, proof, amountText, precheckUrl, pusatBiaya, pusatBiayaMissing }: MoneyFormProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<OverridePrompt | null>(null)
  const pending = useRef<Record<string, unknown> | null>(null)
  // Item 11 (DRMS 10/10): the T3 transfer records the date AND time of the bank proof (transfer SLA).
  const isTransfer = url.endsWith('/transfer')
  const uid = useId()
  // ADR 0031: default source = the project's Pusat Biaya; another account → automatic loan panel
  const defaultAccount = isTransfer && pusatBiaya && cashAccounts.some((a) => a.id === pusatBiaya.id) ? pusatBiaya.id : cashAccounts[0]?.id
  const [account, setAccount] = useState<number | undefined>(defaultAccount)
  const loan = isTransfer && pusatBiaya != null && account !== undefined && account !== pusatBiaya.id
  const doc = useDocSummary()
  const fail = (msg: string) => {
    setError(msg)
    showResult({ ok: false, title: failureTitle(submitLabel), message: msg, testId: 'money-submit' })
  }
  const send = async (body: Record<string, unknown>) => {
    const r = await postJson(url, body)
    if (r.ok) {
      setPrompt(null)
      showResult({ ok: true, title: successTitle(submitLabel, doc.object), message: amountText, testId: 'money-submit' })
      router.refresh()
      return
    }
    const p = overridePromptOf(r.status, r.data)
    if (p) {
      pending.current = body
      setPrompt(p)
      return
    }
    setPrompt(null)
    fail(problemText(r.data, r.status))
  }
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const f = new FormData(e.currentTarget)
    const body: Record<string, unknown> = { cashAccountId: Number(f.get('cashAccountId')) }
    if (isTransfer) {
      // item 11: wall-clock date + time of the bank proof; the server reads it in the PT time zone
      const at = String(f.get('transferAt') ?? '')
      if (!at) return setError('Isi tanggal & jam transfer sesuai bukti.')
      body.transferAt = at
      if (pusatBiayaMissing) return setError('Project belum dipetakan ke pusat biaya (akun kas). Petakan dulu di data project.')
      if (loan) {
        // ADR 0031 #4: paid from another account → automatic inter-project loan (reason required)
        const reason = String(f.get('loanReason') ?? '').trim()
        if (reason.length < 3) return setError('Isi alasan membayar dari akun lain (tercatat sebagai pinjaman antar project).')
        body.loanReason = reason
        const due = String(f.get('loanDueDate') ?? '')
        if (due) body.loanDueDate = due
      }
    } else {
      const date = String(f.get('date') ?? '')
      if (date) body.date = date
    }
    if (bankRef === 'required') body.bankRef = String(f.get('bankRef') ?? '').trim()
    const file = f.get('proof')
    const summary: Summary = [
      ...(doc.summary ?? []),
      [isTransfer ? 'Dibayar dari akun' : 'Akun kas', cashAccounts.find((a) => a.id === body.cashAccountId)?.name ?? null],
      [isTransfer ? 'Tanggal & jam transfer' : 'Tanggal', String(body.transferAt ?? body.date ?? '').replace('T', ' ') || (isTransfer ? null : 'hari ini')],
      ['No. referensi bank', (body.bankRef as string | undefined) || null],
      ['Bukti', file instanceof File && file.size > 0 ? file.name : null],
      ['Pinjaman antar project', loan ? 'ya — dibayar dari akun lain' : null],
    ]
    if (!(await confirmAction({ title: confirmTitle(submitLabel, doc.object), summary, description: amountText, confirmLabel: confirmLabel(submitLabel), testId: 'money-submit' }))) return
    setBusy(true)
    try {
      if (precheckUrl) {
        const pre = await fetch(precheckUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        if (!pre.ok) throw new Error(problemText(await pre.json().catch(() => null), pre.status))
      }
      if (proof && file instanceof File && file.size > 0) body.proofMediaId = await uploadProof(proof.kind, file)
      else if (proof?.required) throw new Error('Bukti wajib diunggah.')
      await send(body)
    } catch (err) {
      fail((err as Error).message || 'Gagal.')
    } finally {
      setBusy(false)
    }
  }
  const confirm = async () => {
    if (!prompt || !pending.current) return
    setBusy(true)
    try {
      await send({ ...pending.current, [prompt.flag]: true })
    } catch (err) {
      setPrompt(null)
      fail((err as Error).message || 'Gagal.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
    <style href="pk-kas-style" precedence="default">
      {KAS_STYLE}
    </style>
    <style href="pk-mform-style" precedence="default">
      {MFORM_STYLE}
    </style>
    <form onSubmit={onSubmit} className="pk-mform" data-pk-money-form>
      <strong className="pk-mform__amount">{amountText}</strong>
      <div className="pk-mform__grid">
        <div className="pk-fld">
          <label htmlFor={`${uid}-acc`}>
            {isTransfer ? 'Dibayar dari akun' : 'Akun kas'}
            <span className="req" aria-hidden>*</span>
          </label>
          <WrapSelect id={`${uid}-acc`} name="cashAccountId" required defaultValue={defaultAccount} onChange={(e) => setAccount(Number(e.currentTarget.value))} data-pk-field="transfer-account">
            {cashAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {isTransfer && pusatBiaya?.id === a.id ? ' (pusat biaya project)' : ''}
              </option>
            ))}
          </WrapSelect>
          {isTransfer && pusatBiaya ? <p className="help">Pusat biaya project: {pusatBiaya.name}.</p> : null}
          {isTransfer && pusatBiayaMissing ? (
            <p className="help" role="alert" data-pk-transfer-pb-missing>
              Project belum punya pusat biaya (akun kas) — transfer ditolak sampai dipetakan di data project.
            </p>
          ) : null}
        </div>
        {isTransfer ? (
          <div className="pk-fld">
            <label htmlFor={`${uid}-at`}>
              Tanggal &amp; jam transfer<span className="req" aria-hidden>*</span>
            </label>
            <DateInput id={`${uid}-at`} type="datetime-local" name="transferAt" required step={60} data-pk-field="transfer-at" hintClassName="help" />
            <p className="help">Sesuai bukti transfer bank.</p>
          </div>
        ) : (
          <div className="pk-fld">
            <label htmlFor={`${uid}-date`}>Tanggal</label>
            <DateInput id={`${uid}-date`} type="date" name="date" hintClassName="help" />
            <p className="help">Kosong = hari ini.</p>
          </div>
        )}
        {loan ? (
          // ADR 0031 #4–#5: the payment from another account is recorded as an inter-project loan (KK on that account,
          // KM on the project's Pusat Biaya) — automatic and approved; PM project and Direktur are notified
          <div className="pk-fld full" role="note" data-pk-transfer-loan style={{ gridColumn: '1 / -1', borderLeft: '3px solid var(--pk-tone-warn)', paddingLeft: 10 }}>
            <label htmlFor={`${uid}-loan`}>
              Alasan membayar dari akun lain<span className="req" aria-hidden>*</span>
            </label>
            <input id={`${uid}-loan`} type="text" name="loanReason" required minLength={3} maxLength={1000} placeholder="mis. saldo pusat biaya project belum cukup" data-pk-field="loan-reason" />
            <p className="help">
              Akun ini bukan pusat biaya project ({pusatBiaya?.name}). Akan tercatat otomatis <strong>pinjaman antar project</strong>: kas keluar dari akun pembayar dan kas masuk ke pusat biaya project.
            </p>
            <label htmlFor={`${uid}-due`}>Jatuh tempo pinjaman</label>
            <DateInput id={`${uid}-due`} type="date" name="loanDueDate" hintClassName="help" data-pk-field="loan-due" />
            <p className="help">Kosong = 30 hari setelah tanggal transfer.</p>
          </div>
        ) : null}
        {bankRef === 'required' ? (
          <div className="pk-fld">
            <label htmlFor={`${uid}-ref`}>
              No. referensi bank<span className="req" aria-hidden>*</span>
            </label>
            <input id={`${uid}-ref`} type="text" name="bankRef" required maxLength={64} placeholder="mis. nomor referensi di bukti" autoComplete="off" />
          </div>
        ) : null}
        {proof ? (
          <div className="pk-fld">
            <label htmlFor={`${uid}-proof`}>
              {proof.required ? 'Bukti' : 'Bukti (opsional)'}
              {proof.required ? <span className="req" aria-hidden>*</span> : null}
            </label>
            <input id={`${uid}-proof`} type="file" name="proof" accept="image/jpeg,image/png,application/pdf" required={proof.required} />
            <p className="help">JPG, PNG atau PDF.</p>
          </div>
        ) : null}
      </div>
      <div className="pk-kact">
        <button type="submit" className="pk-kbtn primary" disabled={busy} data-pk-action="money-submit">
          {busy ? 'Memproses…' : submitLabel}
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
      onConfirm={() => void confirm()}
      onCancel={() => {
        setPrompt(null)
        setError('Belum disimpan — konfirmasi dibatalkan.')
      }}
    />
    </>
  )
}

export default MoneyForm
