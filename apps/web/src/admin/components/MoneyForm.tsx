'use client'
import { useRouter } from 'next/navigation'
import React, { useRef, useState } from 'react'

import { postJson, problemText } from './ActionButton'
import { OverrideDialog, overridePromptOf, type OverridePrompt } from './kas/OverrideDialog'

/**
 * Finance forms of the transfer queue (T3, US-20) and the LPJ settlement (T5, US-22): cash account,
 * optional date, bank reference and proof upload (multipart to /api/v1/media/{kind} first, then the
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
}

async function uploadProof(kind: string, file: File): Promise<number> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/v1/media/${kind}`, { method: 'POST', credentials: 'same-origin', body: fd })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(problemText(data, res.status))
  return (data as { id: number }).id
}

export function MoneyForm({ url, submitLabel, cashAccounts, bankRef, proof, amountText, precheckUrl }: MoneyFormProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<OverridePrompt | null>(null)
  const pending = useRef<Record<string, unknown> | null>(null)
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
    const date = String(f.get('date') ?? '')
    if (date) body[url.endsWith('/transfer') ? 'transferDate' : 'date'] = date
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
  const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }
  return (
    <>
    <form onSubmit={onSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
      <strong style={{ alignSelf: 'center' }}>{amountText}</strong>
      <label style={field}>
        Akun kas
        <select name="cashAccountId" required defaultValue={cashAccounts[0]?.id}>
          {cashAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label style={field}>
        Tanggal (kosong = hari ini)
        <input type="date" name="date" />
      </label>
      {bankRef === 'required' ? (
        <label style={field}>
          No. referensi bank
          <input type="text" name="bankRef" required maxLength={64} />
        </label>
      ) : null}
      {proof ? (
        <label style={field}>
          {proof.required ? 'Bukti (wajib)' : 'Bukti (opsional)'}
          <input type="file" name="proof" accept={proof.kind === 'transfer-proofs' ? 'image/jpeg,image/png,application/pdf' : 'image/jpeg,image/png,application/pdf'} required={proof.required} />
        </label>
      ) : null}
      <button type="submit" className="btn btn--style-primary btn--size-small" style={{ margin: 0 }} disabled={busy}>
        {busy ? 'Memproses…' : submitLabel}
      </button>
      {error ? <span style={{ color: 'var(--theme-error-500)', fontSize: 12, width: '100%' }} role="alert">{error}</span> : null}
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
