'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { postJson, problemText } from './ActionButton'
import { OverrideDialog, overridePromptOf, type OverridePrompt } from './kas/OverrideDialog'
import { DateInput } from './DateInput'
import { KAS_STYLE } from './kas/style'

/**
 * Finance forms of the transfer queue (T3, US-20) and the LPJ settlement (T5, US-22): cash account,
 * date (transfer: date + time of the bank proof, required — item 11), bank reference and proof upload (multipart to /api/v1/media/{kind} first, then the
 * action with the returned id). Amounts are never entered: the server copies/computes them (G3).
 * QA 2026-10-08: a 409 asking for confirmation (unverified destination account QA-17, balance below 0
 * QA-04) opens the app dialog; "Tetap simpan" re-sends the same body + flag (the proof is not re-uploaded).
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
   * D2 (DRMS 10/10): transfer only — Finance picks the cost center of the money (required); `defaultId` = the
   * project's default cost center (pre-selected, may be changed).
   */
  costCenter?: { options: Array<{ id: number; label: string }>; defaultId: number | null }
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

export function MoneyForm({ url, submitLabel, cashAccounts, bankRef, proof, amountText, precheckUrl, costCenter }: MoneyFormProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<OverridePrompt | null>(null)
  const pending = useRef<Record<string, unknown> | null>(null)
  // Item 11 (DRMS 10/10): the T3 transfer records the date AND time of the bank proof (transfer SLA).
  const isTransfer = url.endsWith('/transfer')
  const uid = useId()
  const send = async (body: Record<string, unknown>) => {
    const r = await postJson(url, body)
    if (r.ok) {
      setPrompt(null)
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
    setError(problemText(r.data, r.status))
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
      if (costCenter) {
        // D2: cost center chosen by Finance (mandatory)
        const cc = Number(f.get('costCenterId') ?? '')
        if (!cc) return setError('Pilih pusat biaya.')
        body.costCenterId = cc
      }
    } else {
      const date = String(f.get('date') ?? '')
      if (date) body.date = date
    }
    if (bankRef === 'required') body.bankRef = String(f.get('bankRef') ?? '').trim()
    setBusy(true)
    try {
      if (precheckUrl) {
        const pre = await fetch(precheckUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        if (!pre.ok) throw new Error(problemText(await pre.json().catch(() => null), pre.status))
      }
      const file = f.get('proof')
      if (proof && file instanceof File && file.size > 0) body.proofMediaId = await uploadProof(proof.kind, file)
      else if (proof?.required) throw new Error('Bukti wajib diunggah.')
      await send(body)
    } catch (err) {
      setError((err as Error).message || 'Gagal.')
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
      setError((err as Error).message || 'Gagal.')
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
            Akun kas<span className="req" aria-hidden>*</span>
          </label>
          <select id={`${uid}-acc`} name="cashAccountId" required defaultValue={cashAccounts[0]?.id}>
            {cashAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
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
        {isTransfer && costCenter ? (
          <div className="pk-fld">
            <label htmlFor={`${uid}-cc`}>
              Pusat biaya<span className="req" aria-hidden>*</span>
            </label>
            <select id={`${uid}-cc`} name="costCenterId" required defaultValue={costCenter.defaultId ?? ''} data-pk-field="transfer-cost-center">
              <option value="">Pilih pusat biaya…</option>
              {costCenter.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="help">{costCenter.defaultId ? 'Usulan: pusat biaya default project. Ubah bila perlu.' : 'Project belum punya pusat biaya default — pilih.'}</p>
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
