'use client'
import React, { useRef, useState } from 'react'

import { problemText } from '../ActionButton'
import { useDocSummary } from '../feedback/DocContext'
import { confirmAction, confirmLabel, confirmTitle, failureTitle, isDangerAction, showResult, successTitle, type Summary } from '../feedback/feedback'
import { KAS_STYLE } from '../kas/style'
import { LpjPhotoGrid } from './LpjPhotoGrid'

export const MAX_LPJ_PHOTOS = 10
const idemKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)

/**
 * Point 13 (DRMS 10/10): the requester adds / removes LPJ photos while the LPJ is Draft / Revisi (web = APK
 * LPJ photo picker). Each new image is uploaded to POST /api/v1/media/receipts (re-encoded, EXIF stripped —
 * same pipeline as receipt photos), then the whole set is saved with PUT …/lpj/photos (the server claims each
 * file for the request and re-checks role, status and the limit of 10). Read-only once the LPJ is sent.
 * DRMS 24/10: "Yakin ingin tambah / hapus foto LPJ?" first, the result popup after (plus the inline note).
 */
export function LpjPhotosEditor({ requestId, photos: initial }: { requestId: number; photos: number[] }) {
  const [photos, setPhotos] = useState<number[]>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const doc = useDocSummary()

  const save = async (next: number[]) => {
    const key = idemKey()
    const r = await fetch(`/api/v1/expense-requests/${requestId}/lpj/photos`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify({ photos: next }),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) throw new Error(problemText(data, r.status))
    setPhotos(next)
  }
  const run = async (action: string, summary: Summary, fn: () => Promise<void>, done: string) => {
    setError(null)
    setNote(null)
    if (!(await confirmAction({ title: confirmTitle(action, doc.object ? `pada ${doc.object}` : null), summary: [...(doc.summary ?? []), ...summary], confirmLabel: confirmLabel(action), danger: isDangerAction(action) }))) return
    setBusy(true)
    try {
      await fn()
      setNote(done)
      showResult({ ok: true, title: successTitle(action, doc.object ? `pada ${doc.object}` : null), message: done })
    } catch (e) {
      const msg = (e as Error).message || 'Gagal menghubungi server.'
      setError(msg)
      showResult({ ok: false, title: failureTitle(action), message: msg })
    } finally {
      setBusy(false)
    }
  }
  const onFiles = (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (input.current) input.current.value = ''
    if (list.length === 0) return
    if (photos.length + list.length > MAX_LPJ_PHOTOS) {
      setError(`Maksimal ${MAX_LPJ_PHOTOS} foto LPJ (sisa ${MAX_LPJ_PHOTOS - photos.length}).`)
      return
    }
    void run('Tambah foto LPJ', [['Foto baru', list.map((f) => f.name).join(', ')], ['Jumlah setelah disimpan', `${photos.length + list.length}/${MAX_LPJ_PHOTOS}`]], async () => {
      const added: number[] = []
      for (const f of list) {
        if (!/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error(`"${f.name}" bukan foto JPG/PNG/WebP.`)
        const fd = new FormData()
        fd.append('file', f)
        const r = await fetch('/api/v1/media/receipts', { method: 'POST', credentials: 'same-origin', body: fd })
        const data = await r.json().catch(() => null)
        if (!r.ok) throw new Error(problemText(data, r.status))
        added.push((data as { id: number }).id)
      }
      await save([...photos, ...added])
    }, list.length === 1 ? 'Foto LPJ tersimpan.' : `${list.length} foto LPJ tersimpan.`)
  }

  return (
    <div data-pk-lpj-photos-editor style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      <style href="pk-kas-style" precedence="default">
        {KAS_STYLE}
      </style>
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        Foto LPJ ({photos.length}/{MAX_LPJ_PHOTOS}) <span style={{ fontWeight: 400, color: 'var(--pk-muted-fg)' }}>— foto barang / lokasi pekerjaan, opsional.</span>
      </div>
      <LpjPhotoGrid ids={photos} group={`lpj-own-${requestId}`} label="Foto LPJ">
        {(id) => (
          <button
            type="button"
            className="pk-kbtn sm danger"
            disabled={busy}
            onClick={() => void run('Hapus foto LPJ', [['Foto', `#${photos.indexOf(id) + 1} dari ${photos.length}`]], () => save(photos.filter((p) => p !== id)), 'Foto LPJ dihapus.')}
            data-pk-action={`lpj-photo-remove-${id}`}
            aria-label="Hapus foto LPJ ini"
          >
            Hapus
          </button>
        )}
      </LpjPhotoGrid>
      {photos.length < MAX_LPJ_PHOTOS ? (
        <label className="pk-kbtn" style={{ width: 'fit-content', cursor: busy ? 'progress' : 'pointer' }} data-pk-action="lpj-photo-add">
          {busy ? 'Mengunggah…' : '+ Tambah foto'}
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={(e) => onFiles(e.target.files)} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
        </label>
      ) : null}
      {error ? (
        <span role="alert" className="pk-kerr">
          {error}
        </span>
      ) : null}
      {note ? (
        <span role="status" style={{ fontSize: 12, color: 'var(--pk-tone-ok-text)' }}>
          {note}
        </span>
      ) : null}
    </div>
  )
}

export default LpjPhotosEditor
