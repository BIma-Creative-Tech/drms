'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { fieldErrors, newIdemKey, sendJson } from '../kas/client'

/**
 * E5 (US-18): PM form for an Addendum RAB — project (team projects only), nominal tambahan,
 * alasan. "Ajukan" creates + submits in one call (POST /api/v1/budget-addenda {submit:true});
 * "Simpan draft" keeps a Draft. Edit mode PATCHes a Draft. Live preview RAB lama → baru; inline
 * errors under each field (server errors mapped by path); one Idempotency-Key per content version.
 */
export type ProjectOpt = { id: number; code: string; name: string; budget: number | null }

const rupiah = (v: number) => `Rp ${new Intl.NumberFormat('id-ID').format(v)}`
const digits = (s: string) => s.replace(/\D/g, '').slice(0, 13)

export function AddendumForm({ projects, initialProject, edit }: { projects: ProjectOpt[]; initialProject?: number; edit?: { id: number; projectId: number; addition: number; reason: string } }) {
  const router = useRouter()
  const uid = useId()
  const key = useRef<string | undefined>(newIdemKey())
  const [project, setProject] = useState<number | ''>(edit?.projectId ?? initialProject ?? (projects.length === 1 ? projects[0]!.id : ''))
  const [amount, setAmount] = useState(edit ? String(edit.addition) : '')
  const [reason, setReason] = useState(edit?.reason ?? '')
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'draft' | 'submit'>(null)
  const addition = amount ? Number(amount) : 0
  const p = projects.find((x) => x.id === project)
  const touch = () => {
    key.current = newIdemKey()
  }

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {}
    if (!project) e.projectId = 'Pilih project.'
    if (!(addition > 0)) e.addition = 'Nominal tambahan wajib diisi (> 0).'
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
          <select
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
          </select>
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
          <div className="pk-money">
            <span aria-hidden>Rp</span>
            <input
              id={`${uid}-a`}
              inputMode="numeric"
              autoComplete="off"
              value={amount ? new Intl.NumberFormat('id-ID').format(Number(amount)) : ''}
              onChange={(e) => {
                setAmount(digits(e.target.value))
                touch()
              }}
              aria-invalid={errs.addition ? true : undefined}
              aria-describedby={`${uid}-ah`}
              data-pk-field="addition"
            />
          </div>
          {errs.addition ? (
            <p id={`${uid}-ah`} className="err">
              {errs.addition}
            </p>
          ) : (
            <p id={`${uid}-ah`} className="help">
              Bilangan bulat Rupiah, lebih dari 0.
            </p>
          )}
        </div>
        <div className="pk-fld" aria-live="polite">
          <span className="lbl">RAB setelah disetujui</span>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }} data-pk-preview>
            {p ? (
              <>
                {p.budget ? rupiah(p.budget) : 'Tanpa RAB'} + {rupiah(addition)} = <b>{rupiah((p.budget ?? 0) + addition)}</b>
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
