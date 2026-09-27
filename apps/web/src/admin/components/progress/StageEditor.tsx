'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useMemo, useRef, useState } from 'react'

import { problemText } from '../ActionButton'
import { fieldErrors, newIdemKey } from '../kas/client'

/**
 * E4 stage editor (G11, US-29): edits the WHOLE active stage set of a project and saves it with
 * PUT /api/v1/projects/{id}/stages (one transaction server-side). Live total with a meter and an
 * inline message; save stays disabled until the total is exactly 100 %. Direktur may add and
 * deactivate stages; PM may rename, reorder and re-weight (the server re-checks every rule). A reason
 * is asked for as soon as a weight changes or a stage is removed (G7). No drag & drop: ↑/↓ buttons
 * (keyboard and touch friendly).
 */
export type EditorStage = { id?: number; name: string; weightPct: number; sequence: number; progressPct: number }

type Row = { key: string; id?: number; name: string; weight: string; progressPct: number }

const round2 = (v: number) => Math.round(v * 100) / 100
const parse = (s: string): number | null => {
  const t = s.trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null
  const v = Number(t)
  return v >= 0 && v <= 100 ? v : null
}
const fmt = (v: number) => String(round2(v)).replace('.', ',')

export function StageEditor({ projectId, stages, canAddRemove, templates }: { projectId: number; stages: EditorStage[]; canAddRemove: boolean; templates: Array<{ id: number; name: string }> }) {
  const router = useRouter()
  const uid = useId()
  const seq = useRef(0)
  const initial = useMemo(() => stages.map((s) => ({ key: `s${s.id}`, id: s.id, name: s.name, weight: fmt(s.weightPct), progressPct: s.progressPct })), [stages])
  const [rows, setRows] = useState<Row[]>(initial)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const weights = rows.map((r) => parse(r.weight))
  const sum = round2(weights.reduce<number>((t, v) => t + (v ?? 0), 0))
  const complete = Math.abs(sum - 100) < 0.01
  const invalid = weights.some((v) => v === null) || rows.some((r) => !r.name.trim())
  const byId = new Map(stages.filter((s) => s.id !== undefined).map((s) => [s.id!, s]))
  const removed = stages.filter((s) => s.id !== undefined && !rows.some((r) => r.id === s.id))
  const reweighted = rows.some((r, i) => r.id !== undefined && weights[i] !== null && round2(byId.get(r.id)!.weightPct) !== round2(weights[i]!))
  const needsReason = removed.length > 0 || reweighted
  const dirty = JSON.stringify(rows.map((r) => [r.id, r.name.trim(), parse(r.weight)])) !== JSON.stringify(initial.map((r) => [r.id, r.name.trim(), parse(r.weight)]))
  const canSave = dirty && complete && !invalid && (!needsReason || reason.trim().length >= 3) && !busy

  const update = (i: number, patch: Partial<Row>) => {
    setSaved(false)
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  }
  const move = (i: number, d: -1 | 1) => {
    setSaved(false)
    setRows((rs) => {
      const j = i + d
      if (j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }
  const add = () => {
    setSaved(false)
    setRows((rs) => [...rs, { key: `n${++seq.current}`, name: '', weight: fmt(Math.max(0, round2(100 - sum))), progressPct: 0 }])
  }
  const remove = (i: number) => {
    setSaved(false)
    setRows((rs) => rs.filter((_, k) => k !== i))
  }

  const put = async (body: unknown) => {
    const res = await fetch(`/api/v1/projects/${projectId}/stages`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': newIdemKey() ?? '' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    setError(null)
    setErrs({})
    try {
      const body = {
        stages: rows.map((r, i) => ({ ...(r.id !== undefined ? { id: r.id } : {}), name: r.name.trim(), weightPct: parse(r.weight)!, sequence: i + 1 })),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }
      const r = await put(body)
      if (!r.ok) {
        setError(problemText(r.data, r.status))
        setErrs(fieldErrors(r.data))
        return
      }
      setSaved(true)
      setReason('')
      router.refresh()
    } catch {
      setError('Gagal menghubungi server. Coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  const applyTemplate = async (templateId: number) => {
    setBusy(true)
    setError(null)
    try {
      const r = await put({ templateId })
      if (!r.ok) setError(problemText(r.data, r.status))
      else router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const tone = complete ? 'ok' : sum > 100 ? 'bad' : 'warn'
  return (
    <form className="pk-kform" onSubmit={save} noValidate data-pk-stage-editor={projectId} aria-describedby={`${uid}-sum`}>
      {rows.length === 0 && canAddRemove && templates.length > 0 ? (
        <div className="pk-fld">
          <span className="lbl">Mulai dari template tahapan</span>
          <div className="pk-kact">
            {templates.map((t) => (
              <button key={t.id} type="button" className="pk-kbtn sm" disabled={busy} onClick={() => applyTemplate(t.id)} data-pk-action={`template-${t.id}`}>
                {t.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="pk-tw">
        <table className="pk-t" data-pk-table="stage-editor">
          <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Tahapan dan bobot</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Nama tahapan</th>
              <th scope="col" className="n">
                Bobot (%)
              </th>
              <th scope="col" className="n sec">
                Progress
              </th>
              <th scope="col">
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Aksi</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const werr = weights[i] === null ? 'Bobot 0–100, maks. 2 desimal.' : errs[`stages.${i}.weightPct`]
              const nerr = !r.name.trim() ? 'Nama wajib diisi.' : errs[`stages.${i}.name`]
              return (
                <tr key={r.key} data-pk-stage-row={i + 1}>
                  <td className="nw">{i + 1}</td>
                  <td>
                    <div className="pk-fld">
                      <input aria-label={`Nama tahapan ${i + 1}`} value={r.name} maxLength={128} onChange={(e) => update(i, { name: e.target.value })} aria-invalid={nerr ? true : undefined} />
                      {nerr && dirty ? <p className="err">{nerr}</p> : null}
                    </div>
                  </td>
                  <td className="n" style={{ minWidth: 96 }}>
                    <div className="pk-fld">
                      <input
                        aria-label={`Bobot tahapan ${i + 1} (%)`}
                        inputMode="decimal"
                        value={r.weight}
                        onChange={(e) => update(i, { weight: e.target.value })}
                        aria-invalid={werr ? true : undefined}
                        style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                        data-pk-weight={i + 1}
                      />
                      {werr ? <p className="err">{werr}</p> : null}
                    </div>
                  </td>
                  <td className="n sec">{fmt(r.progressPct)}%</td>
                  <td>
                    <div className="pk-kact" style={{ flexWrap: 'nowrap' }}>
                      <button type="button" className="pk-kbtn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Naikkan tahapan ${i + 1}`}>
                        ↑
                      </button>
                      <button type="button" className="pk-kbtn sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Turunkan tahapan ${i + 1}`}>
                        ↓
                      </button>
                      {canAddRemove ? (
                        <button type="button" className="pk-kbtn sm danger" onClick={() => remove(i)} aria-label={`Nonaktifkan tahapan ${i + 1}`} title={r.id !== undefined ? 'Nonaktifkan (tidak dihapus)' : 'Hapus baris baru'}>
                          ✕
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {canAddRemove ? (
        <div>
          <button type="button" className="pk-kbtn" onClick={add} data-pk-action="add-stage">
            + Tambah tahapan
          </button>
        </div>
      ) : (
        <p className="help" style={{ margin: 0, fontSize: 12, color: 'var(--pk-muted-fg)' }}>
          PM dapat mengubah nama, urutan dan bobot. Menambah atau menonaktifkan tahapan dilakukan Direktur.
        </p>
      )}

      <div id={`${uid}-sum`} aria-live="polite" data-pk-weight-sum={sum} data-pk-weight-state={tone}>
        <div className={`pk-meter ${complete ? '' : sum > 100 ? 'over' : 'warn'}`} role="presentation">
          <span style={{ width: `${Math.min(100, sum)}%` }} />
        </div>
        <p style={{ margin: 0, fontSize: 13 }}>
          Total bobot <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(sum)}%</b>{' '}
          {complete ? (
            <span style={{ color: 'var(--pk-tone-ok-text)', fontWeight: 600 }}>✓ sudah 100%</span>
          ) : sum > 100 ? (
            <span style={{ color: 'var(--pk-tone-bad-text)', fontWeight: 600 }}>✕ kelebihan {fmt(round2(sum - 100))}%</span>
          ) : (
            <span style={{ color: 'var(--pk-tone-warn-text)', fontWeight: 600 }}>▲ kurang {fmt(round2(100 - sum))}%</span>
          )}
        </p>
      </div>

      {needsReason ? (
        <div className="pk-fld">
          <label htmlFor={`${uid}-reason`}>
            Alasan perubahan bobot / penonaktifan
            <span className="req" aria-hidden>
              *
            </span>
          </label>
          <textarea id={`${uid}-reason`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} aria-invalid={errs.reason ? true : undefined} data-pk-field="reason" />
          {errs.reason ? <p className="err">{errs.reason}</p> : <p className="help">Wajib (min. 3 karakter), tercatat di audit log. Progress project dihitung ulang.</p>}
        </div>
      ) : null}

      {error ? (
        <p className="pk-kerr" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--pk-tone-ok-text)', fontWeight: 600 }}>
          ✓ Tahapan tersimpan, progress project dihitung ulang.
        </p>
      ) : null}
      <div className="pk-kact">
        <button type="submit" className="pk-kbtn primary" disabled={!canSave} data-pk-action="save-stages">
          {busy ? 'Menyimpan…' : 'Simpan tahapan'}
        </button>
        {dirty ? (
          <button
            type="button"
            className="pk-kbtn"
            onClick={() => {
              setRows(initial)
              setReason('')
              setErrs({})
              setError(null)
            }}
          >
            Batalkan perubahan
          </button>
        ) : null}
      </div>
    </form>
  )
}

export default StageEditor
