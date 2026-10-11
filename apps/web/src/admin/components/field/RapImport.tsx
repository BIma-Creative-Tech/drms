'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useState } from 'react'

import { problemText } from '../ActionButton'

/**
 * P3 RAP Excel import (two steps): POST …/rap/import/preview (multipart "file") shows new / changed /
 * unchanged rows, items to deactivate, new stages and issues; POST …/rap/import/commit with the SAME file
 * and its sha256 (`_payload` {fileHash, reason}) writes it (409 FILE_CHANGED when the file differs).
 */
type Preview = {
  fileHash: string
  locked: boolean
  rows: Array<{ row: number; code: string; status: 'new' | 'changed' | 'unchanged'; changes: string[] }>
  deactivated: Array<{ code: string; description: string; hasRealisation: boolean }>
  newStages: string[]
  issues: Array<{ row?: number; column?: string; message: string }>
  counts: { new: number; changed: number; unchanged: number; deactivated: number }
}

export function RapImport({ projectId, needsReason }: { projectId: number; needsReason: boolean }) {
  const router = useRouter()
  const uid = useId()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const post = async (step: 'preview' | 'commit') => {
    const fd = new FormData()
    fd.append('file', file!)
    if (step === 'commit') fd.append('_payload', JSON.stringify({ fileHash: preview!.fileHash, ...(reason.trim() ? { reason: reason.trim() } : {}) }))
    const res = await fetch(`/api/v1/projects/${projectId}/rap/import/${step}`, { method: 'POST', credentials: 'same-origin', body: fd })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(problemText(data, res.status))
    return data
  }

  const doPreview = async () => {
    if (!file) return setError('Pilih file .xlsx dulu.')
    setError(null)
    setDone(null)
    setBusy('Memeriksa file…')
    try {
      setPreview((await post('preview')) as Preview)
    } catch (x) {
      setError((x as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const doCommit = async () => {
    if (needsReason && reason.trim().length < 3) return setError('RAP terkunci: isi alasan perubahan (min. 3 karakter).')
    setError(null)
    setBusy('Menyimpan RAP…')
    try {
      await post('commit')
      setDone(`RAP tersimpan: ${preview!.counts.new} baru, ${preview!.counts.changed} berubah, ${preview!.counts.deactivated} dinonaktifkan.`)
      setPreview(null)
      setFile(null)
      router.refresh()
    } catch (x) {
      setError((x as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const blocking = (preview?.issues.length ?? 0) > 0
  const changed = preview?.rows.filter((r) => r.status !== 'unchanged') ?? []
  return (
    <div className="pk-kform" data-pk-form="rap-import">
      {error ? (
        <div className="pk-alert bad" role="alert">
          <b aria-hidden>!</b>
          <p>{error}</p>
        </div>
      ) : null}
      {done ? (
        <div className="pk-alert ok" role="status">
          <b aria-hidden>✓</b>
          <p>{done}</p>
        </div>
      ) : null}
      <div className="pk-fld">
        <label htmlFor={`${uid}-file`}>File RAP (.xlsx, maks. 2 MB)</label>
        <input
          id={`${uid}-file`}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setPreview(null)
          }}
        />
        <p className="help">Kolom: kode, uraian, tahapan, jenis (pekerjaan/material), satuan, volume, harga_satuan, bobot. Unduh template kosong atau RAP project sebagai contoh.</p>
      </div>
      <div className="pk-actions">
        <button type="button" className="pk-kbtn" onClick={doPreview} disabled={!file || busy !== null} data-pk-submit="rap-preview">
          {busy === 'Memeriksa file…' ? busy : 'Pratinjau'}
        </button>
      </div>
      {preview ? (
        <section aria-label="Pratinjau impor" data-pk-rap-preview>
          <p className="pk-note">
            {preview.counts.new} baru · {preview.counts.changed} berubah · {preview.counts.unchanged} sama · {preview.counts.deactivated} dinonaktifkan
            {preview.newStages.length ? ` · tahapan baru: ${preview.newStages.join(', ')}` : ''}
          </p>
          {blocking ? (
            <ul className="pk-errlist" data-pk-rap-issues>
              {preview.issues.map((i, k) => (
                <li key={k}>
                  {i.row ? `Baris ${i.row}${i.column ? ` (${i.column})` : ''}: ` : ''}
                  {i.message}
                </li>
              ))}
            </ul>
          ) : null}
          {changed.length ? (
            <ul style={{ fontSize: 13, lineHeight: 1.6 }}>
              {changed.slice(0, 50).map((r) => (
                <li key={r.row}>
                  <b>{r.code}</b> — {r.status === 'new' ? 'baru' : r.changes.join('; ')}
                </li>
              ))}
              {changed.length > 50 ? <li>… {changed.length - 50} lagi</li> : null}
            </ul>
          ) : null}
          {preview.deactivated.length ? (
            <p className="pk-note">
              Dinonaktifkan: {preview.deactivated.map((d) => `${d.code}${d.hasRealisation ? ' (sudah ada realisasi)' : ''}`).join(', ')}
            </p>
          ) : null}
          {needsReason ? (
            <div className="pk-fld">
              <label htmlFor={`${uid}-reason`}>
                Alasan perubahan<span className="req" aria-hidden>*</span>
              </label>
              <textarea id={`${uid}-reason`} value={reason} maxLength={1000} rows={2} onChange={(e) => setReason(e.target.value)} />
            </div>
          ) : null}
          <div className="pk-actions">
            <button type="button" className="pk-kbtn primary" onClick={doCommit} disabled={blocking || busy !== null} data-pk-submit="rap-commit">
              {busy === 'Menyimpan RAP…' ? busy : 'Simpan RAP'}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

export default RapImport
