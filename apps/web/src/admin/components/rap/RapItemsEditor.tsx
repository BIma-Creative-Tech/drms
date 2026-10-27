'use client'
import { useRouter } from 'next/navigation'
import React, { useEffect, useId, useRef, useState } from 'react'

import { formatNumber, formatRupiah, rupiahOrDash } from '@/lib/money'
import { groupRupiah, isImmediateRupiahError, parseRupiah } from '@/lib/rupiah-input'

import { problemText } from '../ActionButton'
import { confirmAction, confirmLabel, confirmTitle, failureTitle, showResult, successTitle } from '../feedback/feedback'
import { FORM_GRID_STYLE } from '../form-grid'
import { RupiahInput, type RupiahField } from '../RupiahInput'
import {
  createBody,
  draftAmount,
  draftOf,
  itemUsed,
  parseRapDraft,
  patchBody,
  RAP_ARCHIVED_HINT,
  RAP_LOCKED_HINT,
  rapGrandTotal,
  rapRealisedTotal,
  type RapEditMode,
  type RapItemDraft,
  type RapItemDraftErrors,
  type RapItemView,
} from './rap-item-form'
import { WrapSelect } from '../WrapSelect'
import { WrapText } from '../WrapText'

/**
 * DRMS 13/10 Wave 3 "Proyek › RAP" (client: "Form RAP"): the RAP items of one project as a table with a grand total
 * row, "+ Tambah item" and "Ubah" in one dialog (the LinesTableField pattern; label left of the input, D4). Writes go
 * to the existing endpoints POST /api/v1/projects/{id}/rap/items and PATCH /api/v1/rap-items/{id} (role, lock,
 * duplicate kode and stage re-checked by the server, audited). Items are never deleted — the dialog can deactivate
 * one (API `active: false`). A locked RAP (daily-report realisation) keeps the buttons visible but disabled for the
 * PM; the Direktur/Admin edits with a reason. A used item ("Sudah terpakai", owner 2026-10-13) stays editable, but the
 * dialog asks for a required "Alasan perubahan" (every role; the server enforces it and audits the reason). Money
 * (harga satuan, jumlah, realisasi) only when `prices`.
 */
type Opt = { id: number; label: string }

type Props = {
  projectId: number
  items: RapItemView[]
  stages: Opt[]
  uoms: Opt[]
  prices: boolean
  mode: RapEditMode
  stageRequired: boolean
  drivesProgress: boolean
}

const STYLE = `
.pk-rap-dlg { width: min(720px, calc(100vw - 32px)); }
.pk-rap-dlg .ro { min-height: 40px; display: flex; align-items: center; padding: 0 10px; border: 1px dashed var(--pk-input); border-radius: var(--style-radius-s); font-variant-numeric: tabular-nums; font-weight: 600; background: var(--pk-muted-bg); }
.pk-rap-items .pk-t tfoot th, .pk-rap-items .pk-t tfoot td { padding: 10px; border-top: 2px solid var(--pk-border); font-weight: 700; white-space: nowrap; }
.pk-rap-items .pk-t tr[data-pk-inactive] td { color: var(--pk-muted-fg); }
.pk-rap-items .pk-rap-chip { display: inline-block; margin: 2px 4px 0 0; padding: 0 6px; border-radius: 8px; font-size: 11px; font-weight: 600; border: 1px solid var(--pk-border); color: var(--pk-muted-fg); }
.pk-rap-items .pk-rap-chip.warn { color: var(--pk-tone-warn-text); border-color: color-mix(in oklab, var(--pk-tone-warn-text) 45%, var(--pk-border)); }
.pk-rap-items .pk-rap-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 10px; }
`

const qty = (v: number) => formatNumber(v, 2)
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export function RapItemsEditor({ projectId, items, stages, uoms, prices, mode, stageRequired, drivesProgress }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState<RapItemView | 'new' | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const canWrite = mode === 'edit' || mode === 'reason'
  const blockedHint = mode === 'locked' ? RAP_LOCKED_HINT : mode === 'archived' ? RAP_ARCHIVED_HINT : undefined
  const showActions = mode !== 'read'
  const grand = rapGrandTotal(items)
  const active = items.filter((i) => i.active).length
  // columns before the money / total cells (No, Kode, Uraian, Volume)
  const lead = 4

  return (
    <div className="pk-rap-items" data-pk-rap-editor={mode}>
      {/* KAS_STYLE (buttons, fields, dialog) comes with the page frame (views/frame.tsx) */}
      <style>{FORM_GRID_STYLE}</style>
      <style>{STYLE}</style>
      <div className="pk-rap-head">
        <p className="pk-note" style={{ margin: 0 }}>
          {items.length} item ditampilkan · {active} aktif{prices ? ' · jumlah = volume × harga satuan' : ''}
        </p>
        {showActions ? (
          <button type="button" className="pk-kbtn primary" onClick={() => setEditing('new')} disabled={!canWrite} title={blockedHint} data-pk-action="rap-item-add">
            + Tambah item
          </button>
        ) : null}
      </div>
      {blockedHint ? (
        <div className="pk-alert info" role="note" data-pk-rap-blocked={mode}>
          <b aria-hidden>i</b>
          <p>{blockedHint}</p>
        </div>
      ) : null}
      {done ? (
        <div className="pk-alert ok" role="status">
          <b aria-hidden>✓</b>
          <p>{done}</p>
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className="pk-es" data-pk-empty>
          <span>{canWrite ? 'Belum ada item. Tekan + Tambah item, atau unggah Excel di bawah.' : 'Belum ada item RAP yang cocok.'}</span>
        </div>
      ) : (
        <div className="pk-tw">
          <table className="pk-t" data-pk-table="rap-items">
            <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Item RAP project</caption>
            <thead>
              <tr>
                <th scope="col">No</th>
                <th scope="col">Kode</th>
                <th scope="col">Uraian</th>
                <th scope="col" className="n">
                  Volume
                </th>
                {prices ? (
                  <>
                    <th scope="col" className="n">
                      Harga satuan
                    </th>
                    <th scope="col" className="n">
                      Jumlah
                    </th>
                    <th scope="col" className="n">
                      Realisasi
                    </th>
                  </>
                ) : drivesProgress ? (
                  <th scope="col" className="n">
                    Realisasi volume
                  </th>
                ) : null}
                {showActions ? (
                  <th scope="col">
                    <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Aksi</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {items.map((i, n) => (
                <tr key={i.id} data-pk-rap-item={i.code} data-pk-inactive={i.active ? undefined : '1'} data-pk-used={itemUsed(i) ? '1' : undefined}>
                  <td>{n + 1}</td>
                  <td>
                    <b>{i.code}</b>
                  </td>
                  <td>
                    {i.description}
                    <span className="sub" style={{ display: 'block', fontSize: 12, color: 'var(--pk-muted-fg)' }}>
                      {i.kind === 'material' ? 'Material' : 'Pekerjaan'}
                      {i.stageName ? ` · ${i.stageName}` : ''}
                      {i.weightPct !== null ? ` · bobot ${formatNumber(i.weightPct, 2)}%` : ''}
                    </span>
                    {!i.active ? <span className="pk-rap-chip">Nonaktif</span> : null}
                    {itemUsed(i) ? (
                      <span className="pk-rap-chip warn" title="Item ini sudah punya realisasi (pengajuan atau laporan harian).">
                        Sudah terpakai
                      </span>
                    ) : null}
                  </td>
                  <td className="n">
                    {qty(i.volume)} {i.uomCode}
                  </td>
                  {prices ? (
                    <>
                      <td className="n">{rupiahOrDash(i.unitPrice ?? null)}</td>
                      <td className="n">
                        <b>{rupiahOrDash(i.value ?? null)}</b>
                      </td>
                      <td className="n">{rupiahOrDash(i.realisedAmount ?? 0)}</td>
                    </>
                  ) : drivesProgress ? (
                    <td className="n">
                      {qty(i.realised)} {i.uomCode}
                    </td>
                  ) : null}
                  {showActions ? (
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="pk-kbtn sm" onClick={() => setEditing(i)} disabled={!canWrite} title={blockedHint} aria-label={`Ubah item ${i.code}`} data-pk-action={`rap-item-edit-${i.code}`}>
                        Ubah
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            {/* client (DRMS 13/10): totals at the bottom of the table */}
            <tfoot>
              <tr data-pk-rap-grand-total={grand ?? ''}>
                <th scope="row" colSpan={prices ? lead + 1 : lead} style={{ textAlign: 'left' }}>
                  Grand total{' '}
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--pk-muted-fg)' }}>
                    ({active} item aktif{prices ? ', item nonaktif tidak dihitung' : ''})
                  </span>
                </th>
                {prices ? (
                  <>
                    <td className="n">{rupiahOrDash(grand)}</td>
                    <td className="n">{formatRupiah(rapRealisedTotal(items))}</td>
                  </>
                ) : drivesProgress ? (
                  <td />
                ) : null}
                {showActions ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {editing !== null ? (
        <RapItemDialog
          key={editing === 'new' ? 'new' : editing.id}
          projectId={projectId}
          item={editing === 'new' ? null : editing}
          stages={stages}
          uoms={uoms}
          prices={prices}
          needsReason={mode === 'reason'}
          stageRequired={stageRequired}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null)
            setDone(msg)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

const FIELD_PATHS: ReadonlyArray<keyof RapItemDraft> = ['code', 'description', 'kind', 'stageId', 'uomId', 'volume', 'unitPrice', 'weightPct', 'active', 'reason']

function RapItemDialog(props: { projectId: number; item: RapItemView | null; stages: Opt[]; uoms: Opt[]; prices: boolean; needsReason: boolean; stageRequired: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const { item } = props
  const ref = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const [d, setD] = useState<RapItemDraft>(() => draftOf(item))
  const [errors, setErrors] = useState<RapItemDraftErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [priceTouched, setPriceTouched] = useState(false)

  useEffect(() => {
    const dlg = ref.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  const set = (k: keyof RapItemDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value
    setD((p) => ({ ...p, [k]: value }))
    if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }))
  }
  const parsedPrice = parseRupiah(d.unitPrice, { allowZero: true })
  const price: RupiahField = {
    text: d.unitPrice,
    parsed: parsedPrice,
    error: parsedPrice.code && (priceTouched || isImmediateRupiahError(parsedPrice.code)) ? parsedPrice.error : null,
    onChange: (v: string) => {
      setD((p) => ({ ...p, unitPrice: v }))
      setPriceTouched(false)
      if (errors.unitPrice) setErrors((p) => ({ ...p, unitPrice: undefined }))
    },
    onBlur: () => {
      setPriceTouched(true)
      if (!parsedPrice.error && parsedPrice.value !== null) setD((p) => ({ ...p, unitPrice: groupRupiah(parsedPrice.value!) }))
    },
    touch: () => setPriceTouched(true),
  }
  const amount = draftAmount(d.volume, d.unitPrice)
  // owner 2026-10-13: changing a used item needs a reason (every role), like a locked RAP for the Direktur/Admin
  const used = item ? itemUsed(item) : false
  const askReason = props.needsReason || used
  const close = () => {
    ref.current?.close()
    props.onClose()
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setPriceTouched(true)
    const r = parseRapDraft(d, { stageRequired: props.stageRequired, needsReason: props.needsReason, used })
    if (!r.values) return setErrors(r.errors)
    const body = item ? patchBody(item, r.values, d.reason) : createBody(r.values, d.reason)
    if (!body) return close() // nothing changed
    if (!props.prices) delete body.unitPrice
    // DRMS 24/10: popup before (item, volume, amount, reason) and after
    const action = item ? 'Simpan item RAP' : 'Tambah item RAP'
    const summary: Array<[string, string | null]> = [
      ['Kode', r.values.code],
      ['Uraian', r.values.description || null],
      ['Volume', qty(r.values.volume)],
      ['Jumlah', props.prices && amount !== null ? formatRupiah(amount) : null],
      ['Status', r.values.active ? null : 'Nonaktif'],
      ['Alasan', d.reason.trim() || null],
    ]
    if (!(await confirmAction({ title: confirmTitle(action, r.values.code), summary, confirmLabel: confirmLabel(action) }))) return
    setBusy(true)
    setServerError(null)
    try {
      const res = await fetch(item ? `/api/v1/rap-items/${item.id}` : `/api/v1/projects/${props.projectId}/rap/items`, {
        method: item ? 'PATCH' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': newKey() },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as { errors?: Array<{ path?: string; message?: string }> } | null
      if (!res.ok) {
        // field errors next to their input; the rest (role, lock, conflict) as one message on top
        const fieldErrs: RapItemDraftErrors = {}
        for (const x of data?.errors ?? []) {
          const k = FIELD_PATHS.find((f) => f === x.path)
          if (k && x.message) fieldErrs[k] = x.message
        }
        setErrors(fieldErrs)
        setServerError(problemText(data, res.status))
        showResult({ ok: false, title: failureTitle(action), message: problemText(data, res.status) })
        return
      }
      ref.current?.close()
      showResult({ ok: true, title: successTitle(action, r.values.code) })
      props.onSaved(item ? `Item ${r.values.code} tersimpan.` : `Item ${r.values.code} ditambahkan ke RAP.`)
    } catch {
      setServerError('Gagal menghubungi server. Periksa koneksi lalu coba lagi.')
      showResult({ ok: false, title: failureTitle(action), message: 'Gagal menghubungi server. Periksa koneksi lalu coba lagi.' })
    } finally {
      setBusy(false)
    }
  }

  const err = (k: keyof RapItemDraft, extra?: string | null) => {
    const m = errors[k] ?? extra
    return m ? (
      <p id={`${uid}-${k}-e`} className="err" role="alert">
        {m}
      </p>
    ) : null
  }
  const aria = (k: keyof RapItemDraft) => (errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${uid}-${k}-e` } : {})
  const req = (
    <span className="req" aria-hidden>
      *
    </span>
  )
  return (
    <dialog ref={ref} className="pk-dlg pk-rap-dlg" aria-labelledby={`${uid}-t`} onCancel={props.onClose} data-pk-dialog="rap-item">
      <form onSubmit={submit} noValidate>
        <h2 id={`${uid}-t`}>{item ? `Ubah item RAP ${item.code}` : 'Tambah item RAP'}</h2>
        {used ? (
          <p className="desc" role="note" data-pk-rap-item-used>
            Item ini sudah terpakai (sudah punya realisasi): setiap perubahan wajib disertai alasan dan tercatat di audit. Perubahan volume / harga mengubah rencana; realisasi tetap. Item tidak dapat dihapus — nonaktifkan bila tidak dipakai lagi.
          </p>
        ) : null}
        {serverError ? (
          <div className="pk-alert bad" role="alert" style={{ margin: 0 }} data-pk-rap-error>
            <b aria-hidden>!</b>
            <p>{serverError}</p>
          </div>
        ) : null}
        <div className="pk-fgrid">
          <div className="pk-fld">
            <label htmlFor={`${uid}-code`}>Kode{req}</label>
            <input id={`${uid}-code`} type="text" value={d.code} onChange={set('code')} maxLength={32} autoFocus autoComplete="off" data-pk-rap-field="code" {...aria('code')} />
            {err('code') ?? <p className="help">Unik per project, mis. A.1.</p>}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-desc`}>Uraian{req}</label>
            <WrapText id={`${uid}-desc`} value={d.description} onChange={set('description')} maxLength={300} data-pk-rap-field="description" {...aria('description')} />
            {err('description')}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-kind`}>Jenis{req}</label>
            <WrapSelect id={`${uid}-kind`} value={d.kind} onChange={set('kind')} disabled={item !== null} data-pk-rap-field="kind" {...aria('kind')}>
              <option value="pekerjaan">Pekerjaan</option>
              <option value="material">Material</option>
            </WrapSelect>
            {err('kind') ?? <p className="help">{item ? 'Jenis tidak dapat diubah (buat item baru).' : 'Pekerjaan menggerakkan progress tahapan (konstruksi); material: masuk / terpakai / stok.'}</p>}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-stage`}>
              Tahapan{props.stageRequired ? req : null}
            </label>
            <WrapSelect id={`${uid}-stage`} value={d.stageId} onChange={set('stageId')} data-pk-rap-field="stageId" {...aria('stageId')}>
              <option value="">{props.stageRequired ? 'Pilih tahapan…' : '— Tanpa tahapan —'}</option>
              {props.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </WrapSelect>
            {err('stageId') ?? (props.stages.length === 0 ? <p className="help">Project ini belum punya tahapan aktif.</p> : null)}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-uom`}>Satuan{req}</label>
            <WrapSelect id={`${uid}-uom`} value={d.uomId} onChange={set('uomId')} data-pk-rap-field="uomId" {...aria('uomId')}>
              <option value="">Pilih satuan…</option>
              {props.uoms.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </WrapSelect>
            {err('uomId')}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-vol`}>Volume{req}</label>
            <input id={`${uid}-vol`} type="text" inputMode="decimal" value={d.volume} onChange={set('volume')} maxLength={16} placeholder="0" data-pk-rap-field="volume" {...aria('volume')} />
            {err('volume') ?? <p className="help">Maks. 2 desimal, pakai koma (mis. 12,5).</p>}
          </div>
          {props.prices ? (
            <>
              <div className="pk-fld">
                <label htmlFor={`${uid}-price`}>Harga satuan</label>
                <RupiahInput id={`${uid}-price`} field={price} testId="rap-unitPrice" invalid={Boolean(errors.unitPrice || price.error)} describedBy={errors.unitPrice || price.error ? `${uid}-unitPrice-e` : undefined} />
                {err('unitPrice', price.error) ?? <p className="help">Kosongkan bila belum ada harga.</p>}
              </div>
              <div className="pk-fld">
                <span className="lbl" id={`${uid}-amt-l`}>
                  Jumlah (otomatis)
                </span>
                <div className="ro" aria-labelledby={`${uid}-amt-l`} aria-live="polite" data-pk-rap-amount={amount ?? ''}>
                  {amount === null ? '—' : formatRupiah(amount)}
                </div>
              </div>
            </>
          ) : null}
          <div className="pk-fld">
            <label htmlFor={`${uid}-w`}>Bobot (%)</label>
            <input id={`${uid}-w`} type="text" inputMode="decimal" value={d.weightPct} onChange={set('weightPct')} maxLength={6} data-pk-rap-field="weightPct" {...aria('weightPct')} />
            {err('weightPct') ?? <p className="help">Opsional, 0–100.</p>}
          </div>
          {item ? (
            <div className="pk-fld">
              <label htmlFor={`${uid}-act`}>Status</label>
              <WrapSelect id={`${uid}-act`} value={d.active} onChange={set('active')} data-pk-rap-field="active">
                <option value="ya">Aktif</option>
                <option value="tidak">Nonaktif</option>
              </WrapSelect>
              <p className="help">Item RAP tidak pernah dihapus; item nonaktif tidak bisa dipilih di pengajuan baru.</p>
            </div>
          ) : null}
          {askReason ? (
            <div className="pk-fld">
              <label htmlFor={`${uid}-reason`}>Alasan perubahan{req}</label>
              <textarea id={`${uid}-reason`} value={d.reason} onChange={set('reason')} maxLength={1000} rows={2} data-pk-rap-field="reason" {...aria('reason')} />
              {err('reason') ?? <p className="help">{props.needsReason ? 'RAP terkunci karena sudah ada realisasi — alasan tercatat di audit.' : 'Item sudah terpakai — alasan wajib (min. 3 karakter) dan tercatat di audit.'}</p>}
            </div>
          ) : null}
        </div>
        <div className="foot">
          <button type="button" className="pk-kbtn" onClick={close} data-pk-action="rap-item-cancel">
            Batal
          </button>
          <button type="submit" className="pk-kbtn primary" disabled={busy} data-pk-action="rap-item-save">
            {busy ? 'Menyimpan…' : item ? 'Simpan perubahan' : 'Tambah item'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export default RapItemsEditor
