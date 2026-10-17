'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { DateInput } from '../DateInput'
import { RupiahInput, useRupiah } from '../RupiahInput'
import { fieldErrors, newIdemKey, sendJson } from '../kas/client'
import { WrapSelect } from '../WrapSelect'

/**
 * ADR 0022: PM form of an inter-project loan ("Pinjaman antar project") — project peminjam (projects the caller is
 * PM of), project pemberi (open projects of the SAME PT), jenis (Dana / Barang/material), nilai (Rupiah), alasan,
 * tanggal pinjaman (default today, not future) and jatuh tempo (required, ≥ tanggal pinjaman). "Ajukan ke Direktur"
 * creates + submits in one call (POST /api/v1/project-loans {submit:true}); "Simpan draft" keeps a Draft. Edit mode
 * PATCHes a Draft (borrower fixed). Inline errors under each field (server errors mapped by path); one
 * Idempotency-Key per content version.
 * UI feedback 17/10 #5: the edit page `/pinjaman/:id/ubah` renders this form with the layout of "Ajukan pinjaman"; in
 * edit mode the draft button reads "Simpan perubahan" and "Batal" goes back to the loan (borrower disabled).
 */
export type LoanProjectOpt = { id: number; code: string; name: string; companyId: number }

export type LoanFormEdit = { id: number; borrowerProjectId: number; lenderProjectId: number; kind: 'dana' | 'barang'; amount: number; reason: string; loanDate: string; dueDate: string }

export function LoanForm({ borrowers, lenders, today, initialBorrower, edit }: { borrowers: LoanProjectOpt[]; lenders: LoanProjectOpt[]; today: string; initialBorrower?: number; edit?: LoanFormEdit }) {
  const router = useRouter()
  const uid = useId()
  const key = useRef<string | undefined>(newIdemKey())
  const [borrower, setBorrower] = useState<number | ''>(edit?.borrowerProjectId ?? initialBorrower ?? (borrowers.length === 1 ? borrowers[0]!.id : ''))
  const [lender, setLender] = useState<number | ''>(edit?.lenderProjectId ?? '')
  const [kind, setKind] = useState<'dana' | 'barang'>(edit?.kind ?? 'dana')
  const amount = useRupiah(edit ? edit.amount : null)
  const [reason, setReason] = useState(edit?.reason ?? '')
  const [loanDate, setLoanDate] = useState(edit?.loanDate ?? today)
  const [dueDate, setDueDate] = useState(edit?.dueDate ?? '')
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'draft' | 'submit'>(null)
  const b = borrowers.find((x) => x.id === borrower)
  const lenderOpts = lenders.filter((x) => x.id !== borrower && (!b || x.companyId === b.companyId))
  const touch = () => {
    key.current = newIdemKey()
  }

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {}
    if (!borrower) e.borrowerProjectId = 'Project peminjam wajib dipilih.'
    if (!lender) e.lenderProjectId = 'Project pemberi pinjaman wajib dipilih.'
    else if (lender === borrower) e.lenderProjectId = 'Project pemberi dan peminjam harus berbeda.'
    amount.touch()
    if (amount.parsed.error) e.amount = amount.parsed.error
    else if (!((amount.parsed.value ?? 0) > 0)) e.amount = 'Nilai pinjaman wajib diisi (> 0).'
    if (reason.trim().length < 3) e.reason = 'Alasan wajib diisi (min. 3 karakter).'
    if (!loanDate) e.loanDate = 'Tanggal pinjaman wajib diisi.'
    else if (loanDate > today) e.loanDate = 'Tanggal pinjaman tidak boleh di masa depan.'
    if (!dueDate) e.dueDate = 'Jatuh tempo wajib diisi.'
    else if (loanDate && dueDate < loanDate) e.dueDate = 'Jatuh tempo tidak boleh sebelum tanggal pinjaman.'
    return e
  }

  const send = async (mode: 'draft' | 'submit') => {
    const e = validate()
    setErrs(e)
    setError(null)
    if (Object.keys(e).length > 0) return
    setBusy(mode)
    const content = { lenderProjectId: lender, kind, amount: amount.parsed.value, reason: reason.trim(), loanDate, dueDate }
    try {
      const r = edit ? await sendJson('PATCH', `/api/v1/project-loans/${edit.id}`, content, key.current) : await sendJson('POST', '/api/v1/project-loans', { ...content, borrowerProjectId: borrower, submit: mode === 'submit' }, key.current)
      if (!r.ok) {
        setError(r.error)
        setErrs(fieldErrors(r.data))
        return
      }
      const id = (r.data as { id: number }).id
      if (edit && mode === 'submit') {
        const s = await sendJson('POST', `/api/v1/project-loans/${id}/submit`, {}, newIdemKey())
        if (!s.ok) {
          setError(s.error)
          return
        }
      }
      router.push(`/admin/pinjaman/detail/${id}?${mode === 'submit' ? 'diajukan' : 'tersimpan'}=1`)
      router.refresh()
    } catch {
      setError('Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.')
    } finally {
      setBusy(null)
    }
  }

  const req = (
    <span className="req" aria-hidden>
      *
    </span>
  )
  const err = (k: string) =>
    errs[k] ? (
      <p id={`${uid}-${k}-e`} className="err">
        {errs[k]}
      </p>
    ) : null

  return (
    <form
      className="pk-kform"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void send('submit')
      }}
      data-pk-form="loan"
    >
      <div className="pk-kgrid">
        <div className="pk-fld">
          <label htmlFor={`${uid}-b`}>Project peminjam{req}</label>
          <WrapSelect
            id={`${uid}-b`}
            value={borrower}
            disabled={!!edit}
            onChange={(e) => {
              setBorrower(e.target.value ? Number(e.target.value) : '')
              touch()
            }}
            aria-invalid={errs.borrowerProjectId ? true : undefined}
            aria-describedby={errs.borrowerProjectId ? `${uid}-borrowerProjectId-e` : undefined}
            data-pk-field="borrower"
          >
            <option value="">Pilih project yang Anda pimpin…</option>
            {borrowers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} {x.name}
              </option>
            ))}
          </WrapSelect>
          {err('borrowerProjectId') ?? <p className="help">Project yang memakai dana / barang (Anda PM-nya).</p>}
        </div>
        <div className="pk-fld">
          <label htmlFor={`${uid}-l`}>Project pemberi pinjaman{req}</label>
          <WrapSelect
            id={`${uid}-l`}
            value={lender}
            onChange={(e) => {
              setLender(e.target.value ? Number(e.target.value) : '')
              touch()
            }}
            aria-invalid={errs.lenderProjectId ? true : undefined}
            aria-describedby={errs.lenderProjectId ? `${uid}-lenderProjectId-e` : undefined}
            data-pk-field="lender"
          >
            <option value="">Pilih project pemberi…</option>
            {lenderOpts.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} {x.name}
              </option>
            ))}
          </WrapSelect>
          {err('lenderProjectId') ?? <p className="help">Hanya project di PT yang sama.</p>}
        </div>
        <fieldset className="pk-fld" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="lbl" style={{ padding: 0 }}>
            Jenis{req}
          </legend>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 4 }}>
            {(['dana', 'barang'] as const).map((k) => (
              <label key={k} className="pk-check">
                <input
                  type="radio"
                  name={`${uid}-k`}
                  value={k}
                  checked={kind === k}
                  onChange={() => {
                    setKind(k)
                    touch()
                  }}
                  data-pk-field={`kind-${k}`}
                />
                {k === 'dana' ? 'Dana' : 'Barang/material'}
              </label>
            ))}
          </div>
          <p className="help">{kind === 'barang' ? 'Nilai barang dalam Rupiah; biaya barang tetap tercatat di RAP project pemberi.' : 'Dana project pemberi dipakai project peminjam.'}</p>
        </fieldset>
        <div className="pk-fld">
          <label htmlFor={`${uid}-a`}>Nilai pinjaman{req}</label>
          <RupiahInput
            id={`${uid}-a`}
            field={{
              ...amount,
              onChange: (v: string) => {
                amount.onChange(v)
                touch()
              },
            }}
            invalid={!!errs.amount}
            describedBy={`${uid}-ah`}
            testId="loan-amount"
          />
          {amount.error || errs.amount ? (
            <p id={`${uid}-ah`} className="err">
              {amount.error ?? errs.amount}
            </p>
          ) : (
            <p id={`${uid}-ah`} className="help">
              Bilangan bulat Rupiah, lebih dari 0. Tanpa bunga.
            </p>
          )}
        </div>
        <div className="pk-fld">
          <label htmlFor={`${uid}-d`}>Tanggal pinjaman{req}</label>
          <DateInput
            id={`${uid}-d`}
            value={loanDate}
            max={today}
            onChange={(e) => {
              setLoanDate(e.target.value)
              touch()
            }}
            aria-invalid={errs.loanDate ? true : undefined}
            data-pk-field="loanDate"
          />
          {err('loanDate')}
        </div>
        <div className="pk-fld">
          <label htmlFor={`${uid}-due`}>Jatuh tempo{req}</label>
          <DateInput
            id={`${uid}-due`}
            value={dueDate}
            min={loanDate || undefined}
            onChange={(e) => {
              setDueDate(e.target.value)
              touch()
            }}
            aria-invalid={errs.dueDate ? true : undefined}
            data-pk-field="dueDate"
          />
          {err('dueDate') ?? <p className="help">Lewat jatuh tempo dan belum lunas = Terlambat (pengingat harian).</p>}
        </div>
        <div className="pk-fld full">
          <label htmlFor={`${uid}-r`}>Alasan{req}</label>
          <textarea
            id={`${uid}-r`}
            value={reason}
            maxLength={1000}
            onChange={(e) => {
              setReason(e.target.value)
              touch()
            }}
            aria-invalid={errs.reason ? true : undefined}
            aria-describedby={`${uid}-rh`}
            data-pk-field="reason"
          />
          {errs.reason ? (
            <p id={`${uid}-rh`} className="err">
              {errs.reason}
            </p>
          ) : (
            <p id={`${uid}-rh`} className="help">
              Untuk apa dana / barang dipakai dan bagaimana dikembalikan. Dibaca Direktur dan PM project pemberi.
            </p>
          )}
        </div>
      </div>
      {error ? (
        <p className="pk-kerr" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pk-kact">
        <button type="submit" className="pk-kbtn primary" disabled={busy !== null} data-pk-action="loan-submit">
          {busy === 'submit' ? 'Mengajukan…' : 'Ajukan ke Direktur'}
        </button>
        <button type="button" className="pk-kbtn" disabled={busy !== null} onClick={() => void send('draft')} data-pk-action="loan-draft">
          {busy === 'draft' ? 'Menyimpan…' : edit ? 'Simpan perubahan' : 'Simpan draft'}
        </button>
        {edit ? (
          <Link className="pk-kbtn" href={`/admin/pinjaman/detail/${edit.id}`} data-pk-action="loan-cancel-edit">
            Batal
          </Link>
        ) : null}
      </div>
    </form>
  )
}

export default LoanForm
