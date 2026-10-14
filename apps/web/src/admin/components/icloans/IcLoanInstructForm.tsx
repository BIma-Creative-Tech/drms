'use client'
import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'

import { formatRupiah } from '@/lib/money'

import { problemText } from '../ActionButton'
import { DateInput } from '../DateInput'
import { KAS_STYLE } from '../kas/style'
import { fieldErrors, newIdemKey, sendJson } from '../kas/client'
import { RupiahInput, useRupiah } from '../RupiahInput'

/**
 * ADR 0029 §3.4 "Perintahkan pinjaman antar-PT" (Owner): PT peminjam (pre-set from the request's fund panel), the
 * requests of that PT waiting at their final decision (ticked = linked; "Hitung untuk semua" ticks every one and sets
 * the amount to Σ needed − available), the lender list from GET /api/v1/intercompany-loans/lenders (Dana tersedia per
 * PT, short PTs disabled, a PT without a receiving account warned), amount (default = the gap), due date (default + 30
 * days) and reason. POST /api/v1/intercompany-loans (one Idempotency-Key per body) → the loan detail.
 */
type CompanyRef = { id: number; shortCode: string; name: string }
type Lenders = {
  borrower: { company: CompanyRef | null; balance: number; commitments: number; available: number; fundCheckEnabled: boolean; hasReceivingAccount: boolean; waiting: Array<{ id: number; docNo: string | null; title: string; needed: number; gap: number }>; gapAll: number }
  defaultDueDate: string
  lenders: Array<{ company: CompanyRef; balance: number; commitments: number; available: number; sufficient: boolean; hasReceivingAccount: boolean; warning: string | null }>
}

export function IcLoanInstructForm({ borrowers, initialBorrower, initialRequestIds = [], initialAmount }: { borrowers: CompanyRef[]; initialBorrower?: number; initialRequestIds?: number[]; initialAmount?: number }) {
  const router = useRouter()
  const uid = useId()
  const [borrower, setBorrower] = useState<number>(initialBorrower ?? borrowers[0]?.id ?? 0)
  const [data, setData] = useState<Lenders | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lender, setLender] = useState<number | null>(null)
  const [requestIds, setRequestIds] = useState<number[]>(initialRequestIds)
  const amount = useRupiah(initialAmount && initialAmount > 0 ? initialAmount : null)
  const [due, setDue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const key = useRef<string | undefined>(undefined)

  const load = useCallback(
    async (b: number, need: number | null) => {
      if (!b) return
      setLoadError(null)
      const q = new URLSearchParams({ borrower: String(b), ...(need && need > 0 ? { amount: String(need) } : {}) })
      const res = await fetch(`/api/v1/intercompany-loans/lenders?${q}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setData(null)
        setLoadError(problemText(body, res.status))
        return
      }
      setData(body as Lenders)
      setDue((d) => d || (body as Lenders).defaultDueDate)
    },
    [],
  )

  useEffect(() => {
    void load(borrower, amount.parsed.value)
    // the lender list follows the borrower and the amount (sufficient = available ≥ amount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borrower, amount.parsed.value])

  const touch = () => {
    key.current = newIdemKey()
  }
  const all = () => {
    if (!data) return
    setRequestIds(data.borrower.waiting.map((w) => w.id))
    amount.onChange(String(data.borrower.gapAll))
    touch()
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    amount.touch()
    const v = amount.parsed.value ?? 0
    const fe: Record<string, string> = {}
    if (!lender) fe.lenderCompanyId = 'Pilih PT pemberi.'
    if (amount.parsed.error) fe.amount = amount.parsed.error
    else if (!(v > 0)) fe.amount = 'Nilai pinjaman wajib diisi (> 0).'
    if (!due) fe.dueDate = 'Jatuh tempo wajib diisi.'
    if (reason.trim().length < 3) fe.reason = 'Alasan wajib diisi (minimal 3 karakter).'
    setErrs(fe)
    setError(null)
    if (Object.keys(fe).length) return
    setBusy(true)
    key.current ??= newIdemKey()
    try {
      const r = await sendJson('POST', '/api/v1/intercompany-loans', { borrowerCompanyId: borrower, lenderCompanyId: lender, amount: v, dueDate: due, reason: reason.trim(), requestIds }, key.current)
      if (!r.ok) {
        setError(r.error)
        setErrs(fieldErrors(r.data))
        return
      }
      const id = (r.data as { id?: number } | null)?.id
      if (typeof id === 'number') router.push(`/admin/pinjaman-antar-pt/detail/${id}?baru=1`)
    } catch {
      setError('Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.')
    } finally {
      setBusy(false)
    }
  }
  const b = data?.borrower
  const v = amount.parsed.value ?? 0
  const chosen = data?.lenders.find((x) => x.company.id === lender)
  return (
    <form onSubmit={submit} className="pk-mform" data-pk-icloan-instruct style={{ display: 'grid', gap: 14 }}>
      <style href="pk-kas-style" precedence="default">
        {KAS_STYLE}
      </style>
      <div className="pk-fld">
        <label htmlFor={`${uid}-b`}>
          PT peminjam<span className="req" aria-hidden>*</span>
        </label>
        <select
          id={`${uid}-b`}
          value={borrower}
          onChange={(e) => {
            setBorrower(Number(e.target.value))
            setRequestIds([])
            setLender(null)
            touch()
          }}
          data-pk-field="icloan-borrower"
        >
          {borrowers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.shortCode} — {c.name}
            </option>
          ))}
        </select>
      </div>
      {loadError ? (
        <p className="pk-kerr" role="alert">
          {loadError}
        </p>
      ) : null}
      {b ? (
        <div data-pk-icloan-borrower style={{ fontSize: 13 }}>
          <p style={{ margin: '0 0 6px' }}>
            Dana tersedia PT {b.company?.shortCode}: <b>{formatRupiah(b.available)}</b> (saldo {formatRupiah(b.balance)} − komitmen {formatRupiah(b.commitments)})
            {b.fundCheckEnabled ? '' : ' · cek dana PT ini belum aktif'}
          </p>
          {!b.hasReceivingAccount ? <p className="pk-kerr">PT ini belum menetapkan rekening penerimaan antar-PT — pinjaman tidak dapat diterima.</p> : null}
          {b.waiting.length > 0 ? (
            <fieldset style={{ border: '1px solid var(--pk-border)', borderRadius: 6, padding: 8 }}>
              <legend>Pengajuan yang menunggu persetujuan akhir</legend>
              {b.waiting.map((w) => (
                <label key={w.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <input
                    type="checkbox"
                    checked={requestIds.includes(w.id)}
                    onChange={(e) => {
                      setRequestIds((ids) => (e.target.checked ? [...ids, w.id] : ids.filter((x) => x !== w.id)))
                      touch()
                    }}
                    data-pk-icloan-request={w.id}
                  />
                  <span>
                    {w.docNo ?? `#${w.id}`} · {w.title} · dibutuhkan {formatRupiah(w.needed)}
                    {w.gap > 0 ? ` · kurang ${formatRupiah(w.gap)}` : ''}
                  </span>
                </label>
              ))}
              <button type="button" className="pk-kbtn sm" onClick={all} style={{ marginTop: 6 }} data-pk-action="icloan-all">
                Hitung untuk semua pengajuan yang menunggu ({formatRupiah(b.gapAll)})
              </button>
            </fieldset>
          ) : null}
        </div>
      ) : null}
      <div className="pk-fld">
        <label htmlFor={`${uid}-a`}>
          Nilai pinjaman<span className="req" aria-hidden>*</span>
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
          testId="icloan-instruct-amount"
          required
        />
        {errs.amount ? <p className="err">{errs.amount}</p> : <p className="help">Boleh di bawah kekurangan (beberapa PT pemberi) atau di atasnya (cadangan) — maksimal dana tersedia PT pemberi.</p>}
      </div>
      <fieldset style={{ border: '1px solid var(--pk-border)', borderRadius: 6, padding: 8 }} data-pk-icloan-lenders>
        <legend>
          PT pemberi<span className="req" aria-hidden>*</span>
        </legend>
        {(data?.lenders ?? []).length === 0 ? <p className="help">Tidak ada PT lain tempat Anda menjadi Owner.</p> : null}
        {(data?.lenders ?? []).map((x) => (
          <label key={x.company.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', opacity: x.sufficient ? 1 : 0.6 }}>
            <input
              type="radio"
              name="lender"
              value={x.company.id}
              checked={lender === x.company.id}
              disabled={!x.sufficient}
              onChange={() => {
                setLender(x.company.id)
                touch()
              }}
              data-pk-icloan-lender={x.company.id}
            />
            <span>
              <b>{x.company.shortCode}</b> {x.company.name} · Dana tersedia {formatRupiah(x.available)}
              {x.sufficient ? '' : ' (tidak cukup)'}
              {x.warning ? <span className="help"> · {x.warning}</span> : null}
            </span>
          </label>
        ))}
        {errs.lenderCompanyId ? <p className="err">{errs.lenderCompanyId}</p> : null}
      </fieldset>
      <div className="pk-fld">
        <label htmlFor={`${uid}-d`}>
          Jatuh tempo<span className="req" aria-hidden>*</span>
        </label>
        <DateInput
          id={`${uid}-d`}
          value={due}
          onChange={(e) => {
            setDue(e.target.value)
            touch()
          }}
          required
          hintClassName="help"
          data-pk-field="icloan-due"
        />
        {errs.dueDate ? <p className="err">{errs.dueDate}</p> : <p className="help">Default 30 hari. Tanpa bunga.</p>}
      </div>
      <div className="pk-fld">
        <label htmlFor={`${uid}-r`}>
          Alasan<span className="req" aria-hidden>*</span>
        </label>
        <textarea
          id={`${uid}-r`}
          value={reason}
          maxLength={1000}
          onChange={(e) => {
            setReason(e.target.value)
            touch()
          }}
          data-pk-field="icloan-reason"
        />
        {errs.reason ? <p className="err">{errs.reason}</p> : null}
      </div>
      {chosen && v > chosen.available ? <p className="pk-kerr">Nilai melebihi dana tersedia PT {chosen.company.shortCode}.</p> : null}
      <div className="pk-kact">
        <button type="submit" className="pk-kbtn primary" disabled={busy} data-pk-action="icloan-instruct">
          {busy ? 'Memproses…' : 'Perintahkan pinjaman'}
        </button>
        {error ? (
          <span className="pk-kerr" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  )
}

export default IcLoanInstructForm
