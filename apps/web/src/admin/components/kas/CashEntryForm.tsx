'use client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import React, { useId, useMemo, useRef, useState } from 'react'

import { formatRupiah } from '@/lib/money'

import { fieldErrors, newIdemKey, sendJson, uploadAttachment } from './client'

/**
 * E2 form "Kas masuk / Kas keluar" (US-23) and its edit mode (ADR 0005 §5: descriptive fields
 * only, open period only, reason required). Posts to POST /api/v1/cash-entries and
 * PATCH /api/v1/cash-entries/{id} (Zod-validated server-side; numbering, period lock, saldo and
 * audit are the domain's job). Visible labels, inline errors linked by aria-describedby, an error
 * summary with role=alert, busy state, one Idempotency-Key per unchanged form (a retry after a
 * network error is replayed, never posted twice; the uploaded proof id is reused).
 */
export type Opt = { id: number; label: string; requiresVehicle?: boolean }

export type CashEntryFormProps = {
  mode: 'create' | 'edit'
  today: string
  minDate: string | null
  lockDate: string | null
  initialDirection: 'in' | 'out'
  options: { accounts: Opt[]; projects: Opt[]; costCenters: Opt[]; categories: Opt[]; sources: Opt[]; vehicles: Opt[] }
  entry?: {
    id: number
    entryNo: string
    direction: 'in' | 'out'
    entryDate: string
    amount: number
    account: string
    description: string
    categoryId: number | null
    cashInSourceId: number | null
    projectId: number | null
    costCenterId: number | null
    vehicleId: number | null
  }
}

type Scope = 'project' | 'pusat' | 'none'

function digits(v: string): string {
  return v.replace(/[^\d]/g, '').replace(/^0+/, '').slice(0, 13)
}
const grouped = (d: string) => (d ? Number(d).toLocaleString('id-ID') : '')

export function CashEntryForm({ mode, today, minDate, lockDate, initialDirection, options, entry }: CashEntryFormProps) {
  const router = useRouter()
  const uid = useId()
  const edit = mode === 'edit' && entry
  const [direction, setDirection] = useState<'in' | 'out'>(entry?.direction ?? initialDirection)
  const [scope, setScope] = useState<Scope>(entry?.projectId ? 'project' : entry?.costCenterId ? 'pusat' : 'none')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string>(entry?.categoryId ? String(entry.categoryId) : '')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState<string | null>(null)
  const key = useRef<string | undefined>(undefined)
  const proof = useRef<{ file: File; id: number } | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const needsVehicle = useMemo(() => options.categories.find((c) => String(c.id) === categoryId)?.requiresVehicle === true, [categoryId, options.categories])

  const id = (n: string) => `${uid}-${n}`
  const err = (name: string) => errors[name]
  const described = (name: string, help?: boolean) => [err(name) ? id(`${name}-e`) : null, help ? id(`${name}-h`) : null].filter(Boolean).join(' ') || undefined
  const Err = ({ name }: { name: string }) =>
    err(name) ? (
      <p id={id(`${name}-e`)} className="err">
        {err(name)}
      </p>
    ) : null

  const onChange = () => {
    key.current = undefined // different body → new key
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const s = (k: string) => String(f.get(k) ?? '').trim()
    const n = (k: string) => (s(k) ? Number(s(k)) : null)
    const found: Record<string, string> = {}
    const body: Record<string, unknown> = {}
    const description = s('description')
    if (!description) found.description = 'Keterangan wajib diisi.'
    const projectId = scope === 'project' ? n('projectId') : null
    const costCenterId = scope === 'pusat' ? n('costCenterId') : null
    if (scope === 'project' && !projectId) found.projectId = 'Pilih project.'
    if (scope === 'pusat' && !costCenterId) found.costCenterId = 'Pilih pusat biaya.'
    if (direction === 'out' && !n('categoryId')) found.categoryId = 'Kategori wajib untuk kas keluar.'
    if (direction === 'in' && !n('cashInSourceId')) found.cashInSourceId = 'Sumber wajib untuk kas masuk.'
    if (!edit) {
      const amt = Number(amount || '0')
      if (!(amt > 0)) found.amount = 'Nominal wajib diisi (Rupiah, bilangan bulat > 0).'
      if (!n('cashAccountId')) found.cashAccountId = 'Pilih akun kas.'
      const date = s('entryDate')
      if (!date) found.entryDate = 'Tanggal wajib diisi.'
      else if (date > today) found.entryDate = 'Tanggal tidak boleh di masa depan.'
      else if (lockDate && date <= lockDate) found.entryDate = `Periode sudah ditutup (tutup buku s/d ${lockDate}).`
      Object.assign(body, { direction, entryDate: date, cashAccountId: n('cashAccountId'), amount: amt, description })
    } else {
      const reason = s('reason')
      if (reason.length < 3) found.reason = 'Alasan perubahan wajib diisi (minimal 3 karakter).'
      body.reason = reason
      if (description !== entry.description) body.description = description
    }
    if (direction === 'out') {
      const cat = n('categoryId')
      const veh = n('vehicleId')
      if (!edit || cat !== entry.categoryId) body.categoryId = cat
      if (!edit || veh !== entry.vehicleId) body.vehicleId = veh
    } else {
      const src = n('cashInSourceId')
      if (!edit || src !== entry.cashInSourceId) body.cashInSourceId = src
    }
    if (!edit || projectId !== entry.projectId) body.projectId = projectId
    if (!edit || costCenterId !== entry.costCenterId) body.costCenterId = costCenterId
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setSummary('Periksa isian yang ditandai.')
      requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }
    if (edit && Object.keys(body).length === 1) {
      setSummary('Tidak ada perubahan untuk disimpan.')
      requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }
    setSummary(null)
    setBusy(true)
    try {
      const file = f.get('proof')
      if (!edit && file instanceof File && file.size > 0) {
        if (proof.current?.file !== file) proof.current = { file, id: await uploadAttachment(file) }
        body.proofId = proof.current.id
      }
      key.current ??= newIdemKey()
      const r = edit ? await sendJson('PATCH', `/api/v1/cash-entries/${entry.id}`, body, key.current) : await sendJson('POST', '/api/v1/cash-entries', body, key.current)
      if (!r.ok) {
        const fe = fieldErrors(r.data)
        setErrors(fe)
        setSummary(r.error)
        requestAnimationFrame(() => summaryRef.current?.focus())
        return
      }
      const saved = r.data as { id: number }
      router.push(edit ? `/admin/kas?diubah=${saved.id}#ce-${saved.id}` : `/admin/kas?baru=${saved.id}#ce-${saved.id}`)
      router.refresh()
    } catch (x) {
      setSummary((x as Error).message || 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.')
      requestAnimationFrame(() => summaryRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  const select = (name: string, label: string, opts: Opt[], value: number | null | undefined, o: { required?: boolean; empty?: string; help?: string; onPick?: (v: string) => void } = {}) => (
    <div className="pk-fld">
      <label htmlFor={id(name)}>
        {label}
        {o.required ? (
          <span className="req" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      <select
        id={id(name)}
        name={name}
        defaultValue={value ? String(value) : ''}
        required={o.required}
        aria-invalid={err(name) ? true : undefined}
        aria-describedby={described(name, !!o.help)}
        onChange={o.onPick ? (e) => o.onPick!(e.target.value) : undefined}
        data-pk-field={name}
      >
        <option value="">{o.empty ?? '— pilih —'}</option>
        {opts.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
      {o.help ? (
        <p id={id(`${name}-h`)} className="help">
          {o.help}
        </p>
      ) : null}
      <Err name={name} />
    </div>
  )

  return (
    <form className="pk-kform" onSubmit={onSubmit} onChange={onChange} noValidate data-pk-form={edit ? 'cash-edit' : 'cash-create'}>
      {summary ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="pk-alert bad" data-pk-form-error>
          <b aria-hidden>!</b>
          <div>
            <p>
              <strong>{summary}</strong>
            </p>
            {Object.keys(errors).length > 0 ? (
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {Object.entries(errors).map(([k, v]) => (
                  <li key={k}>
                    <a href={`#${id(k)}`}>{v}</a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {edit ? (
        <div className="pk-alert info">
          <b aria-hidden>i</b>
          <p>
            <strong>{entry.entryNo}</strong> · {entry.entryDate} · {entry.account} · {entry.direction === 'in' ? 'masuk' : 'keluar'} <strong>{formatRupiah(entry.amount)}</strong>
            <br />
            Nominal, tanggal, akun dan arah tidak dapat diubah — untuk itu void transaksi ini lalu catat ulang.
          </p>
        </div>
      ) : (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ padding: 0, marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
            Jenis transaksi
          </legend>
          <div className="pk-seg dir" role="radiogroup" aria-label="Jenis transaksi">
            {(['in', 'out'] as const).map((d) => (
              <label key={d} data-pk-dir={d}>
                <input type="radio" name="direction" value={d} checked={direction === d} onChange={() => setDirection(d)} />
                <span aria-hidden>{d === 'in' ? '↓' : '↑'}</span>
                {d === 'in' ? 'Kas masuk' : 'Kas keluar'}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="pk-kgrid">
        {!edit ? (
          <>
            <div className="pk-fld">
              <label htmlFor={id('entryDate')}>
                Tanggal<span className="req" aria-hidden>*</span>
              </label>
              <input id={id('entryDate')} type="date" name="entryDate" defaultValue={today} max={today} min={minDate ?? undefined} required aria-invalid={err('entryDate') ? true : undefined} aria-describedby={described('entryDate', true)} />
              <p id={id('entryDate-h')} className="help">
                {lockDate ? `Tutup buku s/d ${lockDate}: tanggal sebelumnya ditolak.` : 'Belum ada periode yang ditutup.'} Tidak boleh di masa depan.
              </p>
              <Err name="entryDate" />
            </div>
            {select('cashAccountId', 'Akun kas', options.accounts, options.accounts.length === 1 ? options.accounts[0]!.id : null, { required: true })}
            <div className="pk-fld">
              <label htmlFor={id('amount')}>
                Nominal<span className="req" aria-hidden>*</span>
              </label>
              <div className="pk-money">
                <span aria-hidden>Rp</span>
                <input
                  id={id('amount')}
                  name="amount"
                  inputMode="numeric"
                  autoComplete="off"
                  value={grouped(amount)}
                  onChange={(e) => setAmount(digits(e.target.value))}
                  placeholder="0"
                  required
                  aria-invalid={err('amount') ? true : undefined}
                  aria-describedby={described('amount', true)}
                  data-pk-field="amount"
                />
              </div>
              <p id={id('amount-h')} className="help">
                Rupiah tanpa desimal{amount ? ` · ${formatRupiah(Number(amount))}` : ''}.
              </p>
              <Err name="amount" />
            </div>
          </>
        ) : null}

        {direction === 'in'
          ? select('cashInSourceId', 'Sumber kas masuk', options.sources, entry?.cashInSourceId, { required: true })
          : select('categoryId', 'Kategori biaya', options.categories, entry?.categoryId, { required: true, onPick: setCategoryId })}

        <div className="pk-fld full">
          <span className="lbl" id={id('scope-l')}>
            Dibebankan ke
          </span>
          <div className="pk-seg" role="radiogroup" aria-labelledby={id('scope-l')}>
            {(
              [
                ['project', 'Project'],
                ['pusat', 'Pusat biaya'],
                ['none', 'Tidak ada'],
              ] as const
            ).map(([v, l]) => (
              <label key={v} data-pk-scope={v}>
                <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)} />
                {l}
              </label>
            ))}
          </div>
          <p className="help">Project ATAU pusat biaya — tidak keduanya.</p>
        </div>
        {scope === 'project' ? select('projectId', 'Project', options.projects, entry?.projectId, { required: true }) : null}
        {scope === 'pusat' ? select('costCenterId', 'Pusat biaya', options.costCenters, entry?.costCenterId, { required: true }) : null}
        {direction === 'out'
          ? select('vehicleId', 'Kendaraan (opsional)', options.vehicles, entry?.vehicleId, {
              empty: '— tanpa kendaraan —',
              help: needsVehicle ? 'Kategori ini biasanya dicatat per kendaraan.' : undefined,
            })
          : null}

        <div className="pk-fld full">
          <label htmlFor={id('description')}>
            Keterangan<span className="req" aria-hidden>*</span>
          </label>
          <textarea id={id('description')} name="description" defaultValue={entry?.description ?? ''} maxLength={1000} required aria-invalid={err('description') ? true : undefined} aria-describedby={described('description')} />
          <Err name="description" />
        </div>

        {!edit ? (
          <div className="pk-fld full">
            <label htmlFor={id('proof')}>Bukti (opsional)</label>
            <input id={id('proof')} type="file" name="proof" accept="application/pdf,image/jpeg,image/png" aria-describedby={id('proof-h')} />
            <p id={id('proof-h')} className="help">
              PDF, JPG atau PNG. PDF maks. 5 MB; gambar diperkecil otomatis.
            </p>
          </div>
        ) : (
          <div className="pk-fld full">
            <label htmlFor={id('reason')}>
              Alasan perubahan<span className="req" aria-hidden>*</span>
            </label>
            <textarea id={id('reason')} name="reason" maxLength={1000} required aria-invalid={err('reason') ? true : undefined} aria-describedby={described('reason', true)} />
            <p id={id('reason-h')} className="help">
              Tercatat di audit log bersama nilai lama dan baru.
            </p>
            <Err name="reason" />
          </div>
        )}
      </div>

      <div className="pk-kact" style={{ justifyContent: 'flex-end' }}>
        <Link className="pk-kbtn" href="/admin/kas">
          Batal
        </Link>
        <button type="submit" className="pk-kbtn primary" disabled={busy} data-pk-submit>
          {busy ? 'Menyimpan…' : edit ? 'Simpan perubahan' : direction === 'in' ? 'Simpan kas masuk' : 'Simpan kas keluar'}
        </button>
      </div>
    </form>
  )
}

export default CashEntryForm
