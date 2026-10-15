'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { formatRupiah } from '@/lib/money'

import { RupiahInput, useRupiah } from '../RupiahInput'
import { fieldErrors, newIdemKey, sendJson } from '../kas/client'
import { WrapSelect } from '../WrapSelect'

/**
 * E5 (US-18): PM form for an Addendum RAB — project (team projects only), nominal tambahan,
 * alasan. "Ajukan" creates + submits in one call (POST /api/v1/budget-addenda {submit:true});
 * "Simpan draft" keeps a Draft. Edit mode PATCHes a Draft. Live preview RAB lama → baru; inline
 * errors under each field (server errors mapped by path); one Idempotency-Key per content version.
 * QA-03: Nominal through the shared Rupiah field (decimals / minus / other characters refused inline).
 */
export type ProjectOpt = { id: number; code: string; name: string; budget: number | null }


export function AddendumForm({ projects, initialProject, edit }: { projects: ProjectOpt[]; initialProject?: number; edit?: { id: number; projectId: number; addition: number; reason: string } }) {
  const router = useRouter()
  const uid = useId()
  const key = useRef<string | undefined>(newIdemKey())
  const [project, setProject] = useState<number | ''>(edit?.projectId ?? initialProject ?? (projects.length === 1 ? projects[0]!.id : ''))
  const amount = useRupiah(edit ? edit.addition : null)
  const [reason, setReason] = useState(edit?.reason ?? '')
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'draft' | 'submit'>(null)
  const addition = amount.parsed.value ?? 0
  const p = projects.find((x) => x.id === project)
  const touch = () => {
    key.current = newIdemKey()
  }

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {}
    if (!project) e.projectId = 'Pilih project.'
    amount.touch()
    if (amount.parsed.error) e.addition = amount.parsed.error
    else if (!(addition > 0)) e.addition = 'Nominal tambahan wajib diisi (> 0).'
    if (reason.trim().length < 3) e.reason = 'Alasan wajib diisi (min. 3 karakter).'
    return e
  }

  const send = async (mode: 'draft' | 'submit') => {
    const e = validate()
    setErrs(e)
    setError(null)
    if (Object.keys(e).length > 0) return
    setBusy(mode)
    try {
      const r = edit
        ? await sendJson('PATCH', `/api/v1/budget-addenda/${edit.id}`, { addition, reason: reason.trim() }, key.current)
        : await sendJson('POST', '/api/v1/budget-addenda', { projectId: project, addition, reason: reason.trim(), submit: mode === 'submit' }, key.current)
      if (!r.ok) {
        setError(r.error)
        setErrs(fieldErrors(r.data))
        return
      }
      const id = (r.data as { id: number }).id
      if (edit && mode === 'submit') {
        const s = await sendJson('POST', `/api/v1/budget-addenda/${id}/submit`, {}, newIdemKey())
        if (!s.ok) {
          setError(s.error)
          return
        }
      }
      router.push(`/admin/addendum/detail/${id}?${mode === 'submit' ? 'diajukan' : 'tersimpan'}=1`)
      router.refresh()
    } catch {
      setError('Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <form
      className="pk-kform"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void send('submit')
      }}
      data-pk-form="addendum"
    >
      <div className="pk-kgrid">
        <div className="pk-fld full">
          <label htmlFor={`${uid}-p`}>
            Project
            <span className="req" aria-hidden>
              *
            </span>
          </label>
          <WrapSelect
            id={`${uid}-p`}
            value={project}
            disabled={!!edit}
            onChange={(e) => {
              setProject(e.target.value ? Number(e.target.value) : '')
              touch()
            }}
            aria-invalid={errs.projectId ? true : undefined}
            aria-describedby={errs.projectId ? `${uid}-pe` : undefined}
            data-pk-field="project"
          >
            <option value="">Pilih project tim Anda…</option>
            {projects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} {x.name}
              </option>
            ))}
          </WrapSelect>
          {errs.projectId ? (
            <p id={`${uid}-pe`} className="err">
              {errs.projectId}
            </p>
          ) : null}
        </div>
        <div className="pk-fld">
          <label htmlFor={`${uid}-a`}>
            Nominal tambahan
            <span className="req" aria-hidden>
              *
            </span>
          </label>
          <RupiahInput
            id={`${uid}-a`}
            field={{
              ...amount,
              onChange: (v: string) => {
                amount.onChange(v)
                touch()
              },
            }}
            invalid={!!errs.addition}
            describedBy={`${uid}-ah`}
            testId="addition"
          />
          {amount.error || errs.addition ? (
            <p id={`${uid}-ah`} className="err">
              {amount.error ?? errs.addition}
            </p>
          ) : (
            <p id={`${uid}-ah`} className="help">
              Bilangan bulat Rupiah (tanpa desimal), lebih dari 0; titik sebagai pemisah ribuan.
            </p>
          )}
        </div>
        <div className="pk-fld" aria-live="polite">
          <span className="lbl">RAB setelah disetujui</span>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }} data-pk-preview>
            {p ? (
              <>
                {p.budget ? formatRupiah(p.budget) : 'Tanpa RAB'} + {formatRupiah(addition)} = <b>{formatRupiah((p.budget ?? 0) + addition)}</b>
              </>
            ) : (
              '—'
            )}
          </p>
          <p className="help">Dihitung ulang dari RAB terkini saat Finance menyetujui.</p>
        </div>
        <div className="pk-fld full">
          <label htmlFor={`${uid}-r`}>
            Alasan
            <span className="req" aria-hidden>
              *
            </span>
          </label>
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
              Jelaskan pekerjaan tambah / perubahan lingkup. Dibaca Direktur dan Finance.
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
        <button type="submit" className="pk-kbtn primary" disabled={busy !== null} data-pk-action="addendum-submit">
          {busy === 'submit' ? 'Mengajukan…' : 'Ajukan ke Direktur'}
        </button>
        <button type="button" className="pk-kbtn" disabled={busy !== null} onClick={() => void send('draft')} data-pk-action="addendum-draft">
          {busy === 'draft' ? 'Menyimpan…' : 'Simpan draft'}
        </button>
      </div>
    </form>
  )
}

export default AddendumForm
