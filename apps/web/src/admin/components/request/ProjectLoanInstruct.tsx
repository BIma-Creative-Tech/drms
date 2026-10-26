'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { formatRupiah } from '@/lib/money'

import { postJson, problemText } from '../ActionButton'
import { confirmAction, confirmLabel, confirmTitle, failureTitle, showResult, successTitle } from '../feedback/feedback'
import { FeedbackStyle } from '../feedback/FeedbackHost'
import { KAS_STYLE } from '../kas/style'
import { isMultilineText } from '../WrapText'

/**
 * DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26) "Instruksi pinjam antar proyek" — the final decider's button next to
 * the disabled "Setujui" (request page action bar, approval inbox row). Opens a dialog that loads
 * GET /api/v1/expense-requests/{id}/project-loan-lenders: the request project's cash account (dana bebas, kurang), the
 * open projects of the same PT with their own account and its dana bebas (not eligible ones disabled with the reason),
 * the amount (default = the shortfall, min = shortfall, max = the chosen account's dana bebas), the due date and the
 * reason. "Lanjut" → the confirmation popup (DRMS 24/10) → POST …/project-loan (one Idempotency-Key per opened dialog
 * + body) → the result popup and a refresh. No <form>: the button also lives inside Payload's document form.
 */
type Candidate = {
  project: { id: number; code: string | null; name: string | null }
  account: { id: number; name: string } | null
  available: number | null
  eligible: boolean
  reasonText: string | null
}

type Info = {
  requestId: number
  docNo: string | null
  title: string
  borrowerProject: { id: number; code: string | null; name: string | null }
  borrowerAccount: { id: number; name: string; available: number }
  needed: number
  shortfall: number
  minAmount: number
  loanDate: string
  defaultDueDate: string
  canInstruct: boolean
  cannotReason: string | null
  pendingLoan: { id: number; docNo: string | null; amount: number; statusLabel: string } | null
  candidates: Candidate[]
}

const LABEL = 'Instruksi pinjam antar proyek'
const rp = formatRupiah
const idemKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)
const projectText = (p: { code: string | null; name: string | null }) => [p.code, p.name].filter(Boolean).join(' · ') || '—'

/** Pure: the amount error of the dialog (same rule as the server, domain/loans/rules.ts instructAmountError). */
export function amountError(raw: string, min: number, max: number | null): string | null {
  const v = Number(raw.replace(/[^\d]/g, ''))
  if (!raw.trim() || !Number.isSafeInteger(v) || v <= 0) return 'Nilai pinjaman wajib diisi (bilangan bulat Rupiah > 0).'
  if (v < min) return `Nilai pinjaman minimal ${rp(min)} (kekurangan dana akun kas pengajuan).`
  if (max !== null && v > max) return `Nilai pinjaman melebihi dana bebas akun kas pemberi (${rp(max)}).`
  return null
}

export function ProjectLoanInstruct({ requestId, docNo, buttonClassName, testId = 'instruct-project-loan' }: { requestId: number; docNo?: string | null; buttonClassName?: string; testId?: string }) {
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const key = useRef<string | undefined>(undefined)
  const uid = useId()
  const [info, setInfo] = useState<Info | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lender, setLender] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [reason, setReason] = useState('')

  const object = docNo ?? info?.docNo ?? `#${requestId}`
  const chosen = info?.candidates.find((c) => c.project.id === lender && c.eligible) ?? null
  const rotate = () => {
    key.current = idemKey()
  }

  const open = async () => {
    setError(null)
    setInfo(null)
    setLender(null)
    rotate()
    ref.current?.showModal()
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/expense-requests/${requestId}/project-loan-lenders`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      const data = (await res.json().catch(() => null)) as Info | null
      if (!res.ok || !data) {
        setError(problemText(data, res.status))
        return
      }
      setInfo(data)
      setAmount(String(data.minAmount))
      setDueDate(data.defaultDueDate)
      setReason(`Menutup kekurangan dana akun kas ${data.borrowerAccount.name} untuk pengajuan ${data.docNo ?? `#${data.requestId}`}`.slice(0, 900))
      setLender(data.candidates.find((c) => c.eligible)?.project.id ?? null)
    } catch {
      setError('Gagal menghubungi server. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }
  const close = () => {
    if (!busy) ref.current?.close()
  }

  const submit = async () => {
    if (busy || !info) return
    if (!chosen || !chosen.account) {
      setError('Pilih project pemberi pinjaman.')
      return
    }
    const amtErr = amountError(amount, info.minAmount, chosen.available)
    if (amtErr) {
      setError(amtErr)
      return
    }
    if (reason.trim().length < 3) {
      setError('Alasan wajib diisi (minimal 3 karakter).')
      return
    }
    const value = Number(amount.replace(/[^\d]/g, ''))
    const yes = await confirmAction({
      title: confirmTitle('instruksikan pinjaman antar proyek untuk', object),
      summary: [
        ['Pengajuan', object],
        ['Pemberi', `${projectText(chosen.project)} — akun kas ${chosen.account.name}`],
        ['Penerima', `${projectText(info.borrowerProject)} — akun kas ${info.borrowerAccount.name}`],
        ['Nilai pinjaman', rp(value)],
        ['Jatuh tempo', dueDate],
      ],
      description: 'Pinjaman langsung disetujui dan masuk Antrian Transfer Finance. Pengajuan tetap menunggu keputusan Anda; setujui setelah Finance mentransfer pinjaman.',
      confirmLabel: confirmLabel('instruksikan'),
      testId,
    })
    if (!yes) return
    setBusy(true)
    setError(null)
    try {
      const r = await postJson(`/api/v1/expense-requests/${requestId}/project-loan`, { lenderProjectId: chosen.project.id, amount: value, reason: reason.trim(), dueDate }, { idempotencyKey: key.current })
      if (!r.ok) {
        const msg = problemText(r.data, r.status)
        setError(msg)
        showResult({ ok: false, title: failureTitle(LABEL), message: msg, testId })
        return
      }
      const pending = (r.data as { fundCheck?: { projectLoans?: Array<{ docNo: string | null; awaitingTransfer: boolean }> } } | null)?.fundCheck?.projectLoans?.find((l) => l.awaitingTransfer)
      ref.current?.close()
      showResult({ ok: true, title: successTitle(LABEL, object), message: `Pinjaman ${pending?.docNo ?? ''} ${rp(value)} dari ${projectText(chosen.project)} masuk Antrian Transfer Finance. Setujui pengajuan setelah transfer dieksekusi.`.replace(/\s+/g, ' '), testId })
      router.refresh()
    } catch {
      const msg = 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.'
      setError(msg)
      showResult({ ok: false, title: failureTitle(LABEL), message: msg, testId })
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // inside Payload's form: Enter never submits the document
    if (e.key === 'Enter' && !isMultilineText(e.target) && !(e.target instanceof HTMLButtonElement)) e.preventDefault()
  }

  const amtErr = info && chosen ? amountError(amount, info.minAmount, chosen.available) : null
  return (
    <>
      <style href="pk-kas-style" precedence="default">
        {KAS_STYLE}
      </style>
      <style href="pk-pli-style" precedence="default">
        {STYLE}
      </style>
      <FeedbackStyle />
      <button type="button" className={buttonClassName ?? 'btn btn--style-primary btn--size-small pk-pbtn'} style={{ margin: 0 }} onClick={() => void open()} data-pk-action={testId}>
        {LABEL}
      </button>
      <dialog ref={ref} className="pk-dlg pk-pli" aria-labelledby={`${uid}-t`} onCancel={(e) => busy && e.preventDefault()} onKeyDown={onKeyDown} data-pk-dialog={testId}>
        <div role="form" aria-labelledby={`${uid}-t`}>
          <h2 id={`${uid}-t`}>
            {LABEL} — {object}
          </h2>
          {loading ? <p className="desc">Memuat project dan dana akun kas…</p> : null}
          {info ? (
            <>
              <dl className="pk-pli-fig" data-pk-pli="figures">
                <dt>Akun kas pengajuan</dt>
                <dd>
                  {info.borrowerAccount.name} ({projectText(info.borrowerProject)})
                </dd>
                <dt>Dana bebas</dt>
                <dd data-pk-pli="available">{rp(info.borrowerAccount.available)}</dd>
                <dt>Dibutuhkan</dt>
                <dd>{rp(info.needed)}</dd>
                <dt>Kurang</dt>
                <dd data-pk-pli="shortfall">
                  <b>{rp(info.shortfall)}</b>
                </dd>
              </dl>
              {info.pendingLoan ? (
                <p className="pk-alert info" data-pk-pli="pending">
                  <b>i</b>
                  <span>
                    Pinjaman {info.pendingLoan.docNo ?? `#${info.pendingLoan.id}`} ({rp(info.pendingLoan.amount)}) {info.pendingLoan.statusLabel.toLowerCase()}.
                  </span>
                </p>
              ) : null}
              {!info.canInstruct ? (
                <p className="pk-alert bad" data-pk-pli="cannot">
                  <b>!</b>
                  <span>{info.cannotReason}</span>
                </p>
              ) : (
                <>
                  <fieldset className="pk-pli-list" data-pk-pli="candidates">
                    <legend>Project pemberi (PT yang sama)</legend>
                    {info.candidates.length === 0 ? <p className="desc">Tidak ada project lain yang aktif di PT ini.</p> : null}
                    {info.candidates.map((c) => (
                      <label key={c.project.id} className={c.eligible ? undefined : 'off'} data-pk-pli-candidate={c.project.id} data-pk-pli-eligible={c.eligible ? 'yes' : 'no'}>
                        <input
                          type="radio"
                          name={`${uid}-lender`}
                          value={c.project.id}
                          checked={lender === c.project.id}
                          disabled={!c.eligible || busy}
                          onChange={() => {
                            setLender(c.project.id)
                            setError(null)
                            rotate()
                          }}
                        />
                        <span className="txt">
                          <b>{projectText(c.project)}</b>
                          <span>Akun kas: {c.account?.name ?? '—'}</span>
                          {c.reasonText ? <span className="why">{c.reasonText}</span> : null}
                        </span>
                        <span className="amt">{c.available === null ? '—' : rp(c.available)}</span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="pk-fld">
                    <label htmlFor={`${uid}-a`}>
                      Nilai pinjaman<span className="req">*</span>
                    </label>
                    <div className="pk-money">
                      <span>Rp</span>
                      <input
                        id={`${uid}-a`}
                        inputMode="numeric"
                        value={amount}
                        aria-invalid={amtErr ? true : undefined}
                        onChange={(e) => {
                          setAmount(e.target.value.replace(/[^\d]/g, ''))
                          setError(null)
                          rotate()
                        }}
                        disabled={busy}
                        data-pk-pli="amount"
                      />
                    </div>
                    <p className={amtErr ? 'err' : 'help'}>{amtErr ?? `Minimal ${rp(info.minAmount)} (kekurangan)${chosen && chosen.available !== null ? `, maksimal ${rp(chosen.available)} (dana bebas pemberi)` : ''}.`}</p>
                  </div>
                  <div className="pk-fld">
                    <label htmlFor={`${uid}-d`}>Jatuh tempo</label>
                    <input
                      id={`${uid}-d`}
                      type="date"
                      min={info.loanDate}
                      value={dueDate}
                      onChange={(e) => {
                        setDueDate(e.target.value)
                        rotate()
                      }}
                      disabled={busy}
                    />
                  </div>
                  <div className="pk-fld">
                    <label htmlFor={`${uid}-r`}>
                      Alasan / catatan<span className="req">*</span>
                    </label>
                    <textarea
                      id={`${uid}-r`}
                      value={reason}
                      maxLength={900}
                      onChange={(e) => {
                        setReason(e.target.value)
                        rotate()
                      }}
                      disabled={busy}
                      data-pk-pli="reason"
                    />
                    <p className="help">Tercatat di pinjaman dan audit log. Minimal 3 karakter.</p>
                  </div>
                </>
              )}
            </>
          ) : null}
          {error ? (
            <p className="pk-kerr" role="alert">
              {error}
            </p>
          ) : null}
          <div className="foot">
            <button type="button" className="pk-kbtn" onClick={close} disabled={busy}>
              {info?.canInstruct ? 'Batal' : 'Tutup'}
            </button>
            {info?.canInstruct ? (
              <button type="button" className="pk-kbtn primary" onClick={() => void submit()} disabled={busy || !chosen} data-pk-confirm={testId}>
                {busy ? 'Memproses…' : 'Lanjut'}
              </button>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  )
}

const STYLE = `
.pk-dlg.pk-pli { width: min(640px, calc(100vw - 32px)); }
.pk-pli-fig { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; font-size: 13px; }
.pk-pli-fig dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.pk-pli-list { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; min-width: 0; }
.pk-pli-list legend { font-size: 13px; font-weight: 600; margin-bottom: 6px; padding: 0; }
.pk-pli-list label { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 10px 12px; border: 1px solid var(--pk-border); border-radius: var(--style-radius-m); cursor: pointer; font-size: 13px; }
.pk-pli-list label:has(input:checked) { border-color: var(--pk-primary); background: color-mix(in oklab, var(--pk-primary) 6%, var(--pk-card)); }
.pk-pli-list label.off { cursor: not-allowed; opacity: .7; }
.pk-pli-list .txt { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.pk-pli-list .txt > span { color: var(--pk-muted-fg); }
.pk-pli-list .why { color: var(--pk-tone-bad-text) !important; }
.pk-pli-list .amt { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
@media (pointer: coarse) { .pk-pli-list label { min-height: 44px; } }
`

export default ProjectLoanInstruct
