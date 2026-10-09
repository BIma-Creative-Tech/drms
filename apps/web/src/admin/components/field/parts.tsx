'use client'
import React, { useEffect, useId, useMemo, useRef, useState } from 'react'

import { fmtNum, parseDecimalId } from '@/domain/field/views'

import { uploadFieldPhoto } from './client'

/**
 * FR1 web forms — shared client parts: photo picker (preview, remove, upload on submit with the id
 * cached per file so a retry never uploads twice), the line editor of spare parts / activity items
 * (name, part no., qty, UoM), a decimal field with the Indonesian comma and a choice group (radio
 * pills, .pk-seg). Visible labels, errors linked with aria-describedby, ≥ 44 px on touch.
 */

// ---------------------------------------------------------------- photos

type Picked = { key: string; file: File; url: string }

export function usePhotos(max: number) {
  const [items, setItems] = useState<Picked[]>([])
  /** media id per picked file (filled on upload, reused on a retry) */
  const uploaded = useRef(new Map<string, number>())
  const urls = useRef(new Set<string>())
  useEffect(() => {
    const live = urls.current
    return () => live.forEach((u) => URL.revokeObjectURL(u))
  }, [])
  return {
    items,
    max,
    add(files: FileList | null) {
      if (!files) return
      const next = [...items]
      for (const f of Array.from(files)) {
        if (next.length >= max) break
        const url = URL.createObjectURL(f)
        urls.current.add(url)
        next.push({ key: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file: f, url })
      }
      setItems(next)
    },
    remove(key: string) {
      const p = items.find((x) => x.key === key)
      if (p) {
        URL.revokeObjectURL(p.url)
        urls.current.delete(p.url)
      }
      uploaded.current.delete(key)
      setItems(items.filter((x) => x.key !== key))
    },
    /** Upload every photo not uploaded yet; returns all media ids in order. */
    async uploadAll(onProgress?: (done: number, total: number) => void): Promise<number[]> {
      const out: number[] = []
      let done = 0
      for (const p of items) {
        let mid = uploaded.current.get(p.key)
        if (mid === undefined) {
          mid = await uploadFieldPhoto(p.file)
          uploaded.current.set(p.key, mid)
        }
        out.push(mid)
        onProgress?.(++done, items.length)
      }
      return out
    },
  }
}

export type PhotosState = ReturnType<typeof usePhotos>

export function PhotoPicker({ photos, label, help, required, error, name }: { photos: PhotosState; label: string; help?: string; required?: boolean; error?: string | null; name: string }) {
  const uid = useId()
  const full = photos.items.length >= photos.max
  return (
    <div className="pk-fld">
      <span className="lbl" id={`${uid}-l`}>
        {label}
        {required ? (
          <span className="req" aria-hidden>
            *
          </span>
        ) : null}{' '}
        <small style={{ fontWeight: 400, color: 'var(--pk-muted-fg)' }}>
          ({photos.items.length}/{photos.max})
        </small>
      </span>
      <ul className="pk-photos" aria-labelledby={`${uid}-l`}>
        {photos.items.map((p, i) => (
          <li key={p.key}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview (object URL) */}
            <img src={p.url} alt={`Pratinjau foto ${i + 1}`} />
            <button type="button" className="pk-kbtn sm danger" onClick={() => photos.remove(p.key)} aria-label={`Hapus foto ${i + 1}`}>
              Hapus
            </button>
          </li>
        ))}
        {!full ? (
          <li className="add">
            <label className="pk-kbtn" htmlFor={`${uid}-f`}>
              + Tambah foto
            </label>
            <input
              id={`${uid}-f`}
              name={name}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple={photos.max > 1}
              className="pk-sr"
              aria-describedby={[help ? `${uid}-h` : null, error ? `${uid}-e` : null].filter(Boolean).join(' ') || undefined}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                photos.add(e.target.files)
                e.target.value = ''
              }}
            />
          </li>
        ) : null}
      </ul>
      {help ? (
        <p className="help" id={`${uid}-h`}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="err" id={`${uid}-e`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- lines (spare parts / items)

export type LineDraft = { key: string; name: string; partNo: string; qty: string; uom: string; note: string }
export type LineOut = { name: string; partNo?: string | null; qty: number; uom?: string | null; note?: string | null }

let lineSeq = 0
export const newLine = (l: Partial<LineDraft> = {}): LineDraft => ({ key: `l${++lineSeq}`, name: '', partNo: '', qty: '', uom: '', note: '', ...l })

export const linesFrom = (xs: ReadonlyArray<{ name: string; partNo?: string | null; qty: number; uom?: string | null; note?: string | null }>): LineDraft[] =>
  xs.map((x) => newLine({ name: x.name, partNo: x.partNo ?? '', qty: fmtNum(x.qty, 3), uom: x.uom ?? '', note: x.note ?? '' }))

/** Rows → API lines; empty rows are dropped; returns errors per row index. */
export function linesOut(rows: readonly LineDraft[], withNote: boolean): { lines: LineOut[]; errors: Record<number, string> } {
  const lines: LineOut[] = []
  const errors: Record<number, string> = {}
  rows.forEach((r, i) => {
    const blank = !r.name.trim() && !r.qty.trim() && !r.partNo.trim()
    if (blank) return
    const q = parseDecimalId(r.qty)
    if (!r.name.trim()) errors[i] = 'Nama wajib diisi.'
    else if (q === null || !Number.isFinite(q) || q <= 0) errors[i] = 'Jumlah harus angka > 0 (mis. 1 atau 2,5).'
    else lines.push({ name: r.name.trim(), partNo: r.partNo.trim() || null, qty: q, uom: r.uom.trim() || null, ...(withNote ? { note: r.note.trim() || null } : {}) })
  })
  return { lines, errors }
}

export function LinesEditor({ rows, setRows, label, nameLabel, addLabel, help, withNote, max = 50 }: { rows: LineDraft[]; setRows: (r: LineDraft[]) => void; label: string; nameLabel: string; addLabel: string; help?: string; withNote?: boolean; max?: number }) {
  const uid = useId()
  const errs = useMemo(() => linesOut(rows, !!withNote).errors, [rows, withNote])
  const set = (i: number, k: keyof LineDraft, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <fieldset className="pk-lines">
      <legend>{label}</legend>
      {rows.length > 0 ? (
        <div className="pk-lines-h" aria-hidden>
          <span>{nameLabel}</span>
          <span>No. part</span>
          <span>Jumlah</span>
          <span>Satuan</span>
          <span />
        </div>
      ) : null}
      {rows.map((r, i) => (
        <div key={r.key} className="pk-line" data-pk-line={i + 1}>
          <input aria-label={`${nameLabel} ${i + 1}`} value={r.name} maxLength={160} onChange={(e) => set(i, 'name', e.target.value)} aria-invalid={errs[i] ? true : undefined} aria-describedby={errs[i] ? `${uid}-e${i}` : undefined} />
          <input aria-label={`No. part ${i + 1}`} value={r.partNo} maxLength={64} onChange={(e) => set(i, 'partNo', e.target.value)} />
          <input aria-label={`Jumlah ${i + 1}`} value={r.qty} inputMode="decimal" maxLength={12} onChange={(e) => set(i, 'qty', e.target.value)} aria-invalid={errs[i] ? true : undefined} />
          <input aria-label={`Satuan ${i + 1}`} value={r.uom} maxLength={16} placeholder="PCS" onChange={(e) => set(i, 'uom', e.target.value)} />
          <button type="button" className="pk-kbtn sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Hapus baris ${i + 1}`}>
            Hapus
          </button>
          {withNote ? <input className="note" aria-label={`Keterangan ${i + 1}`} placeholder="Keterangan (opsional)" value={r.note} maxLength={300} onChange={(e) => set(i, 'note', e.target.value)} /> : null}
          {errs[i] ? (
            <p className="err" id={`${uid}-e${i}`} role="alert">
              Baris {i + 1}: {errs[i]}
            </p>
          ) : null}
        </div>
      ))}
      {rows.length < max ? (
        <button type="button" className="pk-kbtn pk-add" onClick={() => setRows([...rows, newLine()])}>
          {addLabel}
        </button>
      ) : null}
      {help ? <p className="help">{help}</p> : null}
    </fieldset>
  )
}

// ---------------------------------------------------------------- choice group (radio pills)

export function Choice<T extends string>({ label, name, value, options, onChange, required, error }: { label: string; name: string; value: T | ''; options: ReadonlyArray<{ value: T; label: string }>; onChange: (v: T) => void; required?: boolean; error?: string | null }) {
  const uid = useId()
  return (
    <fieldset className="pk-fld pk-choice" aria-describedby={error ? `${uid}-e` : undefined}>
      <legend className="lbl">
        {label}
        {required ? (
          <span className="req" aria-hidden>
            *
          </span>
        ) : null}
      </legend>
      <div className="pk-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <label key={o.value} data-pk-choice={o.value}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      {error ? (
        <p className="err" id={`${uid}-e`} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

// ---------------------------------------------------------------- decimal field

export function DecimalField({ id, label, value, onChange, required, help, error, max, suffix, autoFocus }: { id: string; label: string; value: string; onChange: (v: string) => void; required?: boolean; help?: React.ReactNode; error?: string | null; max?: number; suffix?: string; autoFocus?: boolean }) {
  const bad = value.trim() !== '' && decOut(value, max) === undefined
  const msg = error ?? (bad ? `Angka tidak valid${max !== undefined ? ` (0–${fmtNum(max)})` : ''}, maks. 2 desimal — koma untuk desimal, mis. 7,5.` : null)
  return (
    <div className="pk-fld">
      <label htmlFor={id}>
        {label}
        {required ? (
          <span className="req" aria-hidden>
            *
          </span>
        ) : null}
        {suffix ? <small style={{ fontWeight: 400, color: 'var(--pk-muted-fg)' }}> ({suffix})</small> : null}
      </label>
      <input
        id={id}
        value={value}
        inputMode="decimal"
        autoComplete="off"
        maxLength={14}
        required={required}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={msg ? true : undefined}
        aria-describedby={[help ? `${id}-h` : null, msg ? `${id}-e` : null].filter(Boolean).join(' ') || undefined}
      />
      {help ? (
        <p className="help" id={`${id}-h`}>
          {help}
        </p>
      ) : null}
      {msg ? (
        <p className="err" id={`${id}-e`} role="alert">
          {msg}
        </p>
      ) : null}
    </div>
  )
}

/** Value of a decimal text for the API: null when empty, NaN-safe (undefined = invalid). */
export function decOut(v: string, max?: number): number | null | undefined {
  const p = parseDecimalId(v)
  if (p === null) return null
  if (!Number.isFinite(p) || (max !== undefined && p > max)) return undefined
  const r = Math.round(p * 100) / 100
  return Math.abs(r - p) > 1e-9 ? undefined : r
}
