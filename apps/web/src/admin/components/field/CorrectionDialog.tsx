'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { parseRupiah, groupRupiah } from '@/lib/rupiah-input'
import { fmtNum } from '@/domain/field/views'

import { newIdemKey, sendJson, fieldErrors } from '../kas/client'
import { decOut, LinesEditor, linesFrom, linesOut, type LineDraft } from './parts'
import { WrapSelect } from '../WrapSelect'

/**
 * FR1 correction (PM of the project team / Direktur, any time, REASON REQUIRED → POST …/corrections,
 * flag CORRECTED, audited "Koreksi: …") and the reporter's own edit inside the 24 h window (PATCH,
 * reason optional). Native modal <dialog> (focus trap, Esc, focus back to the button), the fields of
 * the document prefilled, only CHANGED fields are sent; one Idempotency-Key per opened dialog + body.
 * The server re-checks the role/team, the window, HM_DECREASED, Σ hours ≤ 24 and PO transitions.
 */
type Line = { name: string; partNo?: string | null; qty: number; uom?: string | null; note?: string | null }
export type CorrField =
  | { name: string; label: string; kind: 'text' | 'textarea' | 'time' | 'date'; value: string | null; max?: number; required?: boolean }
  | { name: string; label: string; kind: 'decimal'; value: number | null; max?: number; required?: boolean }
  | { name: string; label: string; kind: 'select'; value: string | null; options: Array<{ value: string; label: string }> }
  | { name: string; label: string; kind: 'rupiah'; value: number | null }
  | { name: string; label: string; kind: 'lines'; value: Line[]; withNote?: boolean }

export type CorrectionDialogProps = {
  url: string
  mode: 'correction' | 'edit'
  buttonLabel: string
  title: string
  description: React.ReactNode
  fields: CorrField[]
  testId?: string
}

const initialText = (f: CorrField): string => {
  if (f.kind === 'lines') return ''
  if (f.kind === 'decimal') return f.value === null ? '' : fmtNum(f.value)
  if (f.kind === 'rupiah') return f.value === null ? '' : groupRupiah(f.value)
  return f.value ?? ''
}

export function CorrectionDialog({ url, mode, buttonLabel, title, description, fields, testId }: CorrectionDialogProps) {
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, initialText(f)])))
  const [lines, setLines] = useState<Record<string, LineDraft[]>>(() => Object.fromEntries(fields.filter((f) => f.kind === 'lines').map((f) => [f.name, linesFrom((f as { value: Line[] }).value)])))
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const idem = useRef<{ body: string; key: string | undefined } | null>(null)
  const required = mode === 'correction'

  const open = () => {
    setText(Object.fromEntries(fields.map((f) => [f.name, initialText(f)])))
    setLines(Object.fromEntries(fields.filter((f) => f.kind === 'lines').map((f) => [f.name, linesFrom((f as { value: Line[] }).value)])))
    setReason('')
    setErrors({})
    setError(null)
    idem.current = null
    ref.current?.showModal()
  }
  const close = () => {
    if (!busy) ref.current?.close()
  }

  /** Changed fields → API body; field errors. */
  const diff = (): { body: Record<string, unknown>; errs: Record<string, string> } => {
    const body: Record<string, unknown> = {}
    const errs: Record<string, string> = {}
    for (const f of fields) {
      const t = (text[f.name] ?? '').trim()
      if (f.kind === 'lines') {
        const out = linesOut(lines[f.name] ?? [], !!f.withNote)
        if (Object.keys(out.errors).length) errs[f.name] = 'Periksa baris yang ditandai.'
        const before = JSON.stringify(f.value.map((l) => ({ name: l.name, partNo: l.partNo ?? null, qty: l.qty, uom: l.uom ?? null, ...(f.withNote ? { note: l.note ?? null } : {}) })))
        const after = JSON.stringify(out.lines.map((l) => ({ name: l.name, partNo: l.partNo ?? null, qty: l.qty, uom: l.uom ?? null, ...(f.withNote ? { note: l.note ?? null } : {}) })))
        if (before !== after) body[f.name] = out.lines
      } else if (f.kind === 'decimal') {
        const v = decOut(t, f.max)
        if (v === undefined) errs[f.name] = `Angka tidak valid (maks. 2 desimal${f.max !== undefined ? `, ≤ ${fmtNum(f.max)}` : ''}).`
        else if (v === null && f.required) errs[f.name] = 'Wajib diisi.'
        else if (v !== f.value) body[f.name] = v
      } else if (f.kind === 'rupiah') {
        const p = parseRupiah(t, { allowZero: true })
        if (p.error) errs[f.name] = p.error
        else if (p.value !== f.value) body[f.name] = p.value
      } else {
        const v = t === '' ? null : t
        if (v === null && 'required' in f && f.required) errs[f.name] = 'Wajib diisi.'
        else if (v !== (f.value ?? null)) body[f.name] = v
      }
    }
    return { body, errs }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { body, errs } = diff()
    setErrors(errs)
    if (Object.keys(errs).length) {
      setError('Periksa isian yang ditandai.')
      return
    }
    if (Object.keys(body).length === 0) {
      setError('Tidak ada perubahan.')
      return
    }
    const r = reason.trim()
    if (required && r.length < 3) {
      setError('Alasan koreksi wajib diisi (minimal 3 karakter).')
      return
    }
    if (r) body.reason = r
    const json = JSON.stringify(body)
    if (!idem.current || idem.current.body !== json) idem.current = { body: json, key: newIdemKey() }
    setBusy(true)
    setError(null)
    try {
      const res = await sendJson(mode === 'correction' ? 'POST' : 'PATCH', url, body, idem.current.key)
      if (!res.ok) {
        setErrors(fieldErrors(res.data))
        setError(res.error)
        return
      }
      ref.current?.close()
      router.refresh()
    } catch {
      setError('Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.')
    } finally {
      setBusy(false)
    }
  }

  const fid = (n: string) => `${uid}-${n}`
  return (
    <>
      <button type="button" className={`pk-kbtn${mode === 'correction' ? '' : ' primary'}`} onClick={open} data-pk-action={testId}>
        {buttonLabel}
      </button>
      <dialog ref={ref} className="pk-dlg pk-dlg-wide" aria-labelledby={fid('t')} aria-describedby={fid('d')} onCancel={(e) => busy && e.preventDefault()}>
        <form onSubmit={submit} noValidate>
          <h2 id={fid('t')}>{title}</h2>
          <div id={fid('d')} className="desc">
            {description}
          </div>
          <div className="pk-kgrid">
            {fields.map((f) => {
              const err = errors[f.name]
              const describedBy = err ? fid(`${f.name}-e`) : undefined
              if (f.kind === 'lines') {
                return (
                  <div key={f.name} className="full">
                    <LinesEditor rows={lines[f.name] ?? []} setRows={(rows) => setLines({ ...lines, [f.name]: rows })} label={f.label} nameLabel="Nama" addLabel="+ Tambah baris" withNote={f.withNote} />
                    {err ? (
                      <p className="pk-kerr" id={fid(`${f.name}-e`)} role="alert">
                        {err}
                      </p>
                    ) : null}
                  </div>
                )
              }
              const common = {
                id: fid(f.name),
                value: text[f.name] ?? '',
                'aria-invalid': err ? true : undefined,
                'aria-describedby': describedBy,
              } as const
              const set = (v: string) => setText({ ...text, [f.name]: v })
              return (
                <div key={f.name} className={`pk-fld${f.kind === 'textarea' ? ' full' : ''}`}>
                  <label htmlFor={fid(f.name)}>{f.label}</label>
                  {f.kind === 'textarea' ? (
                    <textarea {...common} rows={3} maxLength={f.max ?? 4000} onChange={(e) => set(e.target.value)} />
                  ) : f.kind === 'select' ? (
                    <WrapSelect {...common} onChange={(e) => set(e.target.value)}>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </WrapSelect>
                  ) : f.kind === 'rupiah' ? (
                    <div className="pk-money">
                      <span aria-hidden>Rp</span>
                      <input {...common} inputMode="numeric" maxLength={24} onChange={(e) => set(e.target.value)} />
                    </div>
                  ) : (
                    <input {...common} type={f.kind === 'decimal' ? 'text' : f.kind} inputMode={f.kind === 'decimal' ? 'decimal' : undefined} maxLength={f.kind === 'text' ? (f.max ?? 200) : undefined} onChange={(e) => set(e.target.value)} />
                  )}
                  {err ? (
                    <p className="err" id={fid(`${f.name}-e`)} role="alert">
                      {err}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
          <div className="pk-fld">
            <label htmlFor={fid('reason')}>
              {required ? 'Alasan koreksi' : 'Alasan perubahan (opsional)'}
              {required ? (
                <span className="req" aria-hidden>
                  *
                </span>
              ) : null}
            </label>
            <textarea id={fid('reason')} value={reason} maxLength={1000} required={required} onChange={(e) => setReason(e.target.value)} aria-describedby={fid('reason-h')} />
            <p className="help" id={fid('reason-h')}>
              {required ? 'Tercatat di audit log dan riwayat laporan. Minimal 3 karakter.' : 'Tercatat di audit log.'}
            </p>
          </div>
          {error ? (
            <p className="pk-kerr" role="alert">
              {error}
            </p>
          ) : null}
          <div className="foot">
            <button type="button" className="pk-kbtn" onClick={close} disabled={busy}>
              Batal
            </button>
            <button type="submit" className="pk-kbtn primary" disabled={busy} data-pk-confirm={testId}>
              {busy ? 'Menyimpan…' : mode === 'correction' ? 'Simpan koreksi' : 'Simpan perubahan'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

export default CorrectionDialog
