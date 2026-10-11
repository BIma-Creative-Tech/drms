'use client'
import { FieldError, useField, useForm, useFormFields } from '@payloadcms/ui'
import type { ArrayFieldClientComponent } from 'payload'
import React, { useEffect, useId, useMemo, useRef, useState } from 'react'

import { formatRupiah } from '@/lib/money'

import { KAS_STYLE } from '../kas/style'
import { LineCard } from './LineCard'
import { RupiahInput, useRupiah } from '../RupiahInput'
import { draftOf, draftTotal, formatQty, LINE_FIELD_NAMES, parseDraft, relValue, rowValues, type LineDraft, type LineDraftErrors, type LineValues } from './line-form'

/**
 * DRMS 10/10 8f–8h (D3, WA-05): the expense-request lines as a TABLE (No, Uraian, Kategori, Qty, Satuan, Harga
 * satuan, Total, Nominal sesuai nota, aksi) with "Tambah baris" / "Ubah" in one dialog — the APK line editor's
 * fields and order. Replaces Payload's row cards for `lines` on the Draft / Revisi Nota form; the rows stay
 * ordinary Payload form state (`lines.<i>.<field>`), so Simpan, server validation errors and the audit work as
 * before. Total = qty × harga satuan, shown live and read-only (the server recomputes it, lines.ts). At ≤ 640 px
 * every line is an APK-style card (LineCard; owner: the APK layout wins). In "Revisi Nota" lines cannot be added
 * or removed (receipts are linked to them) — only edited. A line saved before D3 (no unit price) shows
 * "Lengkapi Qty & Harga satuan"; the request cannot be sent until it is completed (server rule).
 */
type Opt = { id: number; label: string; short?: string; company?: number | null; requiresVehicle?: boolean; defaultUom?: number | null }
type Masters = { uoms: Opt[]; categories: Opt[]; vehicles: Opt[]; error: string | null }

const LIST = 'depth=0&limit=500&pagination=false&where[active][not_equals]=false'

async function fetchList(slug: string, sort: string): Promise<Array<Record<string, unknown>>> {
  const r = await fetch(`/api/${slug}?${LIST}&sort=${sort}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(String(r.status))
  return ((await r.json()) as { docs?: Array<Record<string, unknown>> }).docs ?? []
}

function useMasters(): Masters {
  const [m, setM] = useState<Masters>({ uoms: [], categories: [], vehicles: [], error: null })
  useEffect(() => {
    let alive = true
    Promise.all([fetchList('uoms', 'name'), fetchList('expense-categories', 'name'), fetchList('vehicles', 'displayName').catch(() => [])])
      .then(([u, c, v]) => {
        if (!alive) return
        setM({
          uoms: u.map((d) => ({ id: d.id as number, label: `${String(d.name ?? '')}${d.code ? ` (${String(d.code)})` : ''}`, short: String(d.name ?? d.code ?? '') })),
          categories: c.map((d) => ({ id: d.id as number, label: String(d.name ?? ''), company: relValue(d.company), requiresVehicle: d.requiresVehicle === true, defaultUom: relValue(d.defaultUom) })),
          vehicles: v.map((d) => ({ id: d.id as number, label: String(d.displayName ?? d.plateDisplay ?? d.plateNo ?? `#${String(d.id)}`), company: relValue(d.company) })),
          error: null,
        })
      })
      .catch(() => alive && setM((p) => ({ ...p, error: 'Master data (satuan / kategori) gagal dimuat. Muat ulang halaman.' })))
    return () => {
      alive = false
    }
  }, [])
  return m
}

const cell: React.CSSProperties = { padding: '8px 6px', borderBottom: '1px solid var(--theme-elevation-100)', verticalAlign: 'top', textAlign: 'left', fontSize: 13 }
const numCell: React.CSSProperties = { ...cell, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const head: React.CSSProperties = { ...cell, fontSize: 12, fontWeight: 600, color: 'var(--pk-muted-fg)', borderBottom: '1px solid var(--theme-elevation-150)' }
const rp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatRupiah(v))
const STYLE = `
.pk-lines-dlg { width: min(640px, calc(100vw - 32px)); }
.pk-lines-dlg .body { display: grid; gap: 16px; padding: 20px; }
.pk-lines-dlg .calc { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; padding: 10px 12px; border-radius: var(--style-radius-m); background: var(--pk-muted-bg); border: 1px solid var(--pk-border); font-size: 13px; }
.pk-lines-dlg .calc strong { font-size: 18px; font-variant-numeric: tabular-nums; }
.pk-lines-dlg .ro { min-height: 40px; font-size: 16px; display: flex; align-items: center; padding: 0 10px; border: 1px dashed var(--pk-input); border-radius: var(--style-radius-s); font-variant-numeric: tabular-nums; font-weight: 600; background: var(--pk-muted-bg); }
.pk-lines .pk-mismatch { display: inline-block; margin-top: 2px; padding: 0 6px; border-radius: 8px; font-size: 11px; font-weight: 600; color: #FFFFFF; background: var(--pk-tone-warn); }
.pk-lines .rowerr { color: var(--pk-tone-bad-text); font-size: 12px; font-weight: 600; }
`

export const LinesTableField: ArrayFieldClientComponent = (props) => {
  const { field, path: pathProp } = props
  const path = pathProp ?? field.name
  const { rows = [], showError, errorMessage } = useField({ path, hasRows: true })
  const { dispatchFields, removeFieldRow, setModified } = useForm()
  // primitive selector → re-render only when a line value / error, the status or the PT changes
  const snapshot = useFormFields(([f]) =>
    JSON.stringify({
      status: f.status?.value ?? null,
      company: relValue(f.company?.value),
      lines: Object.fromEntries(
        Object.entries(f)
          .filter(([k]) => k.startsWith(`${path}.`))
          .map(([k, v]) => [k, { value: v?.value ?? null, error: v?.valid === false ? (v.errorMessage ?? 'Tidak valid') : null }]),
      ),
    }),
  )
  const state = useMemo(() => JSON.parse(snapshot) as { status: string | null; company: number | null; lines: Record<string, { value: unknown; error: string | null }> }, [snapshot])
  const values: LineValues[] = rows.map((_, i) => rowValues(state.lines, path, i))
  const rowErrors = (i: number) => LINE_FIELD_NAMES.map((f) => state.lines[`${path}.${i}.${f}`]?.error).filter((e): e is string => Boolean(e))
  const revision = state.status === 'receipt_revision'
  const masters = useMasters()
  const categories = masters.categories.filter((c) => state.company === null || c.company === null || c.company === undefined || c.company === state.company)
  const vehicles = masters.vehicles.filter((v) => state.company === null || v.company === null || v.company === undefined || v.company === state.company)
  const nameOf = (list: Opt[], id: number | null, short = false) => {
    const o = id === null ? undefined : list.find((x) => x.id === id)
    return id === null ? '—' : ((short ? o?.short : undefined) ?? o?.label ?? `#${id}`)
  }
  // grand total of the dialog preview (the table total is LinesTotalPreview below, as in the APK editor)
  const grand = values.reduce((s, v) => s + (v.total ?? 0), 0)

  const [editing, setEditing] = useState<number | 'new' | null>(null)

  const save = (v: LineValues) => {
    if (editing === 'new') {
      const subFieldState = Object.fromEntries(LINE_FIELD_NAMES.map((f) => [f, { value: v[f] === '' ? null : v[f], initialValue: undefined, valid: true }]))
      dispatchFields({ type: 'ADD_ROW', path, rowIndex: rows.length, subFieldState } as never)
    } else if (typeof editing === 'number') {
      for (const f of LINE_FIELD_NAMES) dispatchFields({ type: 'UPDATE', path: `${path}.${editing}.${f}`, value: v[f] === '' ? null : v[f], valid: true, errorMessage: undefined } as never)
    }
    setModified(true)
    setEditing(null)
  }

  return (
    <div className="field-type pk-lines" data-pk-lines-table style={{ marginBottom: 'var(--spacing-field, 16px)' }}>
      <style href="pk-kas-style" precedence="default">
        {KAS_STYLE}
      </style>
      <style>{STYLE}</style>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div>
          <strong style={{ fontSize: 15 }}>Rincian item</strong>{' '}
          <span style={{ fontSize: 12, color: 'var(--pk-muted-fg)' }}>Total baris = qty × harga satuan (dihitung otomatis).</span>
        </div>
        {!revision ? (
          <button type="button" className="pk-kbtn primary" onClick={() => setEditing('new')} data-pk-action="line-add" disabled={rows.length >= 200}>
            + Tambah baris
          </button>
        ) : null}
      </div>
      <FieldError path={path} showError={showError} message={errorMessage} />
      {masters.error ? <p className="pk-kerr">{masters.error}</p> : null}
      {rows.length === 0 ? (
        <div style={{ padding: 16, border: '1px dashed var(--pk-input)', borderRadius: 'var(--style-radius-m)', color: 'var(--pk-muted-fg)', fontSize: 13 }} data-pk-lines-empty>
          Belum ada baris. Tekan <strong>Tambah baris</strong> untuk mengisi uraian, qty, satuan dan harga satuan.
        </div>
      ) : (
        <>
        <div className="pk-lwide" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={head}>No</th>
              <th style={head}>Uraian</th>
              <th style={head}>Kategori</th>
              <th style={{ ...head, textAlign: 'right' }}>Qty</th>
              <th style={head}>Satuan</th>
              <th style={{ ...head, textAlign: 'right' }}>Harga satuan</th>
              <th style={{ ...head, textAlign: 'right' }}>Total</th>
              <th style={{ ...head, textAlign: 'right' }}>Nominal sesuai nota</th>
              <th style={head}>
                <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
                  Aksi
                </span>
              </th>
            </tr>
          </thead>
          {values.map((v, i) => {
            const errs = rowErrors(i)
            const mismatch = v.receiptAmount !== null && v.total !== null && v.receiptAmount !== v.total
            return (
              <tbody key={rows[i]?.id ?? i} data-pk-line-row={i + 1}>
                <tr>
                  <td style={cell} data-label="No">
                    {i + 1}
                  </td>
                  <td style={{ ...cell, minWidth: 110 }} data-label="Uraian" data-span="full" data-primary>
                    {v.description || <em style={{ color: 'var(--pk-muted-fg)' }}>(tanpa uraian)</em>}
                    {v.vehicle ? <div style={{ fontSize: 12, fontWeight: 400 }}>Kendaraan {nameOf(vehicles, v.vehicle)}</div> : null}
                    {v.notes ? <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--pk-muted-fg)' }}>{v.notes}</div> : null}
                    {v.unitPrice === null ? (
                      <div>
                        <span className="pk-lchip pk-lchip--todo" data-pk-line-incomplete={i + 1}>
                          Lengkapi Qty &amp; Harga satuan
                        </span>
                      </div>
                    ) : null}
                    {errs.length > 0 ? <div className="rowerr">{errs.join(' ')}</div> : null}
                  </td>
                  <td style={cell} data-label="Kategori">
                    {nameOf(categories, v.category)}
                  </td>
                  <td style={numCell} data-label="Qty">
                    {v.qty === null ? '1' : formatQty(v.qty)}
                  </td>
                  <td style={cell} data-label="Satuan">
                    {nameOf(masters.uoms, v.uom, true)}
                  </td>
                  <td style={numCell} data-label="Harga satuan">
                    {v.unitPrice === null ? <span className="rowerr">belum diisi</span> : rp(v.unitPrice)}
                  </td>
                  <td style={{ ...numCell, fontWeight: 700 }} data-label="Total">
                    {rp(v.total)}
                  </td>
                  <td style={numCell} data-label="Nominal sesuai nota">
                    {rp(v.receiptAmount)}
                    {mismatch ? (
                      <div>
                        <span className="pk-mismatch" title="Nominal sesuai nota berbeda dari total baris — Finance akan melihat flag Selisih nota" data-pk-line-mismatch={i + 1}>
                          Selisih {rp(Math.abs((v.total ?? 0) - (v.receiptAmount ?? 0)))}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td style={cell} data-label="Aksi" data-span="full">
                    <div className="pk-kact" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap', gap: 4 }}>
                      <button type="button" className="pk-kbtn sm" onClick={() => setEditing(i)} data-pk-action={`line-edit-${i + 1}`} aria-label={`Ubah baris ${i + 1}`}>
                        Ubah
                      </button>
                      {!revision ? (
                        <button
                          type="button"
                          className="pk-kbtn sm danger"
                          onClick={() => {
                            removeFieldRow({ path, rowIndex: i })
                            setModified(true)
                          }}
                          data-pk-action={`line-remove-${i + 1}`}
                          aria-label={`Hapus baris ${i + 1}`}
                        >
                          Hapus
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              </tbody>
            )
          })}
        </table>
        </div>
        <div className="pk-lcards" data-pk-lines-cards>
          {values.map((v, i) => (
            <LineCard
              key={rows[i]?.id ?? i}
              no={i + 1}
              description={v.description}
              total={v.total}
              qtyPrice={`${v.qty === null ? '1' : formatQty(v.qty)}${v.uom ? ` ${nameOf(masters.uoms, v.uom, true)}` : ''}${v.unitPrice === null ? '' : ` × ${rp(v.unitPrice)}`}`}
              category={v.category === null ? null : nameOf(categories, v.category)}
              vehicle={v.vehicle ? nameOf(vehicles, v.vehicle) : null}
              notes={v.notes || null}
              receiptAmount={v.receiptAmount}
              mismatch={v.receiptAmount !== null && v.total !== null && v.receiptAmount !== v.total}
              needsCompletion={v.unitPrice === null}
              error={rowErrors(i).join(' ') || null}
              actions={
                <>
                  <button type="button" className="pk-kbtn sm" onClick={() => setEditing(i)} data-pk-action={`line-card-edit-${i + 1}`} aria-label={`Ubah baris ${i + 1}`}>
                    Ubah
                  </button>
                  {!revision ? (
                    <button
                      type="button"
                      className="pk-kbtn sm danger"
                      onClick={() => {
                        removeFieldRow({ path, rowIndex: i })
                        setModified(true)
                      }}
                      aria-label={`Hapus baris ${i + 1}`}
                    >
                      Hapus
                    </button>
                  ) : null}
                </>
              }
            />
          ))}
        </div>
        </>
      )}
      {editing !== null ? (
        <LineDialog
          key={String(editing)}
          no={editing === 'new' ? rows.length + 1 : editing + 1}
          initial={editing === 'new' ? null : (values[editing] ?? null)}
          otherTotal={grand - (editing === 'new' ? 0 : (values[editing]?.total ?? 0))}
          uoms={masters.uoms}
          categories={categories}
          vehicles={vehicles}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  )
}

function LineDialog(props: { no: number; initial: LineValues | null; otherTotal: number; uoms: Opt[]; categories: Opt[]; vehicles: Opt[]; onSave: (v: LineValues) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const [d, setD] = useState<LineDraft>(() => draftOf(props.initial))
  const [errors, setErrors] = useState<LineDraftErrors>({})
  const price = useRupiah(props.initial?.unitPrice ?? null)
  const nota = useRupiah(props.initial?.receiptAmount ?? null, { allowZero: true })
  const cat = props.categories.find((c) => String(c.id) === d.category)
  const needsVehicle = cat?.requiresVehicle === true
  const draft = { ...d, unitPrice: price.text, receiptAmount: nota.text }
  const total = draftTotal(draft)
  const notaValue = nota.parsed.value

  useEffect(() => {
    const dlg = ref.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  const set = (k: keyof LineDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value
    setD((p) => {
      const next = { ...p, [k]: value }
      // a category with a default unit pre-fills an empty "Satuan" (APK line editor)
      if (k === 'category' && !p.uom) {
        const c = props.categories.find((o) => String(o.id) === value)
        if (c?.defaultUom) next.uom = String(c.defaultUom)
      }
      return next
    })
    if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }))
  }
  const close = () => {
    ref.current?.close()
    props.onClose()
  }
  const submit = () => {
    price.touch()
    nota.touch()
    const r = parseDraft(draft, { requiresVehicle: needsVehicle })
    if (!r.values) {
      setErrors(r.errors)
      return
    }
    ref.current?.close()
    props.onSave(r.values)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    // inside Payload's document <form>: Enter never submits the document
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      submit()
    }
  }
  const err = (k: keyof LineDraft, extra?: string | null) => {
    const m = errors[k] ?? extra
    return m ? (
      <p id={`${uid}-${k}-e`} className="err" role="alert">
        {m}
      </p>
    ) : null
  }
  const aria = (k: keyof LineDraft) => (errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${uid}-${k}-e` } : {})

  return (
    <dialog ref={ref} className="pk-dlg pk-lines-dlg" aria-labelledby={`${uid}-t`} onCancel={props.onClose} onKeyDown={onKeyDown} data-pk-dialog="line">
      <div className="body">
        <h2 id={`${uid}-t`} style={{ margin: 0, fontSize: 18 }}>
          {props.initial ? `Ubah baris ${props.no}` : `Tambah baris ${props.no}`}
        </h2>
        {props.initial && props.initial.unitPrice === null && props.initial.total !== null ? (
          // pre-D3 line (APK: lineNeedsUnitPrice) — the stored total stays until Qty & Harga satuan are filled
          <p className="help" role="note" style={{ margin: 0, color: 'var(--pk-tone-warn-text)', fontWeight: 600 }} data-pk-line-legacy>
            Baris ini dibuat sebelum Total dihitung otomatis. Isi Qty, Satuan dan Harga satuan (total lama: {formatRupiah(props.initial.total)}).
          </p>
        ) : null}
        <div className="pk-kgrid">
          <div className="pk-fld full">
            <label htmlFor={`${uid}-desc`}>
              Uraian<span className="req" aria-hidden>*</span>
            </label>
            <input id={`${uid}-desc`} type="text" value={d.description} onChange={set('description')} maxLength={500} autoFocus placeholder="mis. Semen 50 kg" data-pk-line-field="description" {...aria('description')} />
            {err('description')}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-cat`}>
              Kategori<span className="req" aria-hidden>*</span>
            </label>
            <select id={`${uid}-cat`} value={d.category} onChange={set('category')} data-pk-line-field="category" {...aria('category')}>
              <option value="">Pilih kategori…</option>
              {props.categories.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {err('category')}
          </div>
          {needsVehicle || d.vehicle ? (
            <div className="pk-fld">
              <label htmlFor={`${uid}-veh`}>
                Kendaraan{needsVehicle ? <span className="req" aria-hidden>*</span> : null}
              </label>
              <select id={`${uid}-veh`} value={d.vehicle} onChange={set('vehicle')} data-pk-line-field="vehicle" {...aria('vehicle')}>
                <option value="">Pilih kendaraan…</option>
                {props.vehicles.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {err('vehicle')}
            </div>
          ) : null}
          <div className="pk-fld">
            <label htmlFor={`${uid}-qty`}>
              Qty<span className="req" aria-hidden>*</span>
            </label>
            <input id={`${uid}-qty`} type="text" inputMode="decimal" value={d.qty} onChange={set('qty')} placeholder="1" maxLength={16} data-pk-line-field="qty" {...aria('qty')} />
            {err('qty') ?? <p className="help">Desimal pakai koma, mis. 24,8.</p>}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-uom`}>
              Satuan<span className="req" aria-hidden>*</span>
            </label>
            <select id={`${uid}-uom`} value={d.uom} onChange={set('uom')} data-pk-line-field="uom" {...aria('uom')}>
              <option value="">Pilih satuan…</option>
              {props.uoms.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {err('uom')}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-price`}>
              Harga satuan<span className="req" aria-hidden>*</span>
            </label>
            <RupiahInput id={`${uid}-price`} field={price} testId="line-unitPrice" invalid={Boolean(errors.unitPrice || price.error)} describedBy={errors.unitPrice || price.error ? `${uid}-unitPrice-e` : undefined} />
            {err('unitPrice', price.error)}
          </div>
          <div className="pk-fld">
            <span className="lbl" id={`${uid}-total-l`}>
              Total (otomatis)
            </span>
            <div className="ro" aria-labelledby={`${uid}-total-l`} aria-live="polite" data-pk-line-total={total ?? ''}>
              {total === null ? '—' : formatRupiah(total)}
            </div>
            <p className="help">Qty × harga satuan — tidak dapat diubah.</p>
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-nota`}>Nominal sesuai nota</label>
            <RupiahInput id={`${uid}-nota`} field={nota} testId="line-receiptAmount" invalid={Boolean(errors.receiptAmount || nota.error)} describedBy={`${uid}-receiptAmount-e`} />
            {err('receiptAmount', nota.error) ??
              (notaValue !== null && total !== null && notaValue !== total ? (
                <p id={`${uid}-receiptAmount-e`} className="help" style={{ color: 'var(--pk-tone-warn-text)', fontWeight: 600 }}>
                  Berbeda {formatRupiah(Math.abs(total - notaValue))} dari total — Finance akan melihat flag &quot;Selisih nota&quot;. Pengajuan tetap memakai total.
                </p>
              ) : (
                <p id={`${uid}-receiptAmount-e`} className="help">
                  Opsional. Isi bila nota sudah ada.
                </p>
              ))}
          </div>
          <div className="pk-fld full">
            <label htmlFor={`${uid}-notes`}>Keterangan</label>
            <input id={`${uid}-notes`} type="text" value={d.notes} onChange={set('notes')} maxLength={500} data-pk-line-field="notes" {...aria('notes')} />
            {err('notes')}
          </div>
        </div>
        <div className="calc" data-pk-line-preview>
          <span>
            Total baris <strong>{total === null ? '—' : formatRupiah(total)}</strong>
          </span>
          <span>
            Grand total pengajuan <strong>{formatRupiah(props.otherTotal + (total ?? 0))}</strong>
          </span>
        </div>
        <div className="foot">
          <button type="button" className="pk-kbtn" onClick={close} data-pk-action="line-cancel">
            Batal
          </button>
          <button type="button" className="pk-kbtn primary" onClick={submit} data-pk-action="line-save">
            {props.initial ? 'Simpan perubahan' : 'Tambah ke tabel'}
          </button>
        </div>
      </div>
    </dialog>
  )
}

export default LinesTableField
