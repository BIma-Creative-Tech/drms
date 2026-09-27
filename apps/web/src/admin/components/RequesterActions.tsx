'use client'
import React, { useRef, useState, useSyncExternalStore } from 'react'

import { postJson, problemText } from './ActionButton'

/**
 * Requester actions of the expense-request edit view (F2c, US-03…US-08): submit, withdraw/cancel
 * (reason), resubmit a rejected request, per-line receipt upload (multipart → /api/v1/media/receipts,
 * then the JSON action), mark receipts complete, (re)submit the LPJ, confirm completion. Every call
 * goes to the existing /api/v1 endpoints with the cookie session and an Idempotency-Key — the
 * server re-checks everything; the buttons shown are only the DTO's `allowedActions` hint.
 * After a success the page reloads (the Payload form state must reflect the new status) and the
 * result message is carried over in sessionStorage (text only, rendered escaped).
 */
type Action = 'submit' | 'withdraw' | 'cancel' | 'resubmit' | 'add_receipt' | 'receipts_resubmit' | 'receipts_complete' | 'lpj_submit' | 'complete'

type Flag = { id: number; label: string; level: string; message: string; status: string; lineNo?: number | null }

export type RequesterActionsProps = {
  id: number
  type: 'advance' | 'reimburse'
  status: string
  actions: Action[]
  profileHref: string
  hasSignature: boolean
  lines: Array<{ id: string; no: number; description: string; total: number }>
  receipts: Array<{
    id: number
    lineId: string
    lineNo: number | null
    receiptNo: string | null
    vendorName: string
    receiptDate: string
    amount: number
    imageId: number | null
    status: string
    flags: Flag[]
  }>
  requestFlags: Flag[]
  settlement: {
    docNo: string | null
    statusLabel: string
    usageNotes: string | null
    financeNotes: string | null
    receiptsTotal: number | null
    difference: number | null
    submitCount: number
  } | null
}

const FLASH_KEY = 'pk-flash'

/** Flash message of the previous action, read (and removed) once per page load on the client. */
let flashOnce: string | null | undefined
function readFlashOnce(): string | null {
  if (flashOnce === undefined) {
    try {
      flashOnce = sessionStorage.getItem(FLASH_KEY)
      sessionStorage.removeItem(FLASH_KEY)
    } catch {
      flashOnce = null
    }
  }
  return flashOnce
}
const noSubscribe = () => () => {}
const rp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `Rp ${v.toLocaleString('id-ID')}`)
const idemKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)

function flashAndGo(text: string, href?: string) {
  try {
    sessionStorage.setItem(FLASH_KEY, text)
  } catch {
    /* storage disabled: the reload still shows the new state */
  }
  if (href) window.location.assign(href)
  else window.location.reload()
}

async function uploadReceiptImage(file: File): Promise<number> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/v1/media/receipts', { method: 'POST', credentials: 'same-origin', body: fd })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(problemText(data, res.status))
  return (data as { id: number }).id
}

const base = (id: number) => `/api/v1/expense-requests/${id}`
const errStyle: React.CSSProperties = { color: 'var(--theme-error-500)', fontSize: 12 }
const box: React.CSSProperties = { border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 12, marginBottom: 16, fontSize: 13 }
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }
const btn = (primary = false) => `btn btn--style-${primary ? 'primary' : 'secondary'} btn--size-small`

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message || 'Gagal menghubungi server.')
      setBusy(false)
    }
  }
  return { busy, error, run }
}

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await postJson(url, body, { idempotencyKey: idemKey() })
  if (!r.ok) throw new Error(problemText(r.data, r.status))
  return (r.data ?? {}) as Record<string, unknown>
}

/** One button; optional required reason (≥ 3 chars, G7) or confirmation. */
function Act(props: { label: string; url: string; success: string; primary?: boolean; reason?: string; confirm?: string; gotoNew?: boolean; testId: string }) {
  const { busy, error, run } = useAction()
  const onClick = () => {
    let body: Record<string, unknown> = {}
    if (props.reason) {
      const v = window.prompt(props.reason)
      if (v === null) return
      if (v.trim().length < 3) {
        window.alert('Alasan wajib diisi (minimal 3 karakter).')
        return
      }
      body = { reason: v.trim() }
    } else if (props.confirm && !window.confirm(props.confirm)) return
    void run(async () => {
      const data = await post(props.url, body)
      const newId = typeof data.id === 'number' ? data.id : undefined
      flashAndGo(props.success, props.gotoNew && newId ? `/admin/collections/expense-requests/${newId}` : undefined)
    })
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, marginRight: 6, marginBottom: 6 }}>
      <button type="button" className={btn(props.primary)} style={{ margin: 0 }} disabled={busy} onClick={onClick} data-pk-action={props.testId}>
        {busy ? 'Memproses…' : props.label}
      </button>
      {error ? <span style={{ ...errStyle, maxWidth: 360 }}>{error}</span> : null}
    </span>
  )
}

/**
 * The panel renders INSIDE Payload's document <form>: no nested <form> (invalid HTML), no
 * `name`/`required` on these inputs (native validation would block Payload's own Save), Enter does
 * not submit the document. Values are read from the container by `data-f`.
 */
function useFields() {
  const ref = useRef<HTMLDivElement>(null)
  const get = (key: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null => ref.current?.querySelector(`[data-f="${key}"]`) ?? null
  const text = (key: string) => String(get(key)?.value ?? '').trim()
  const file = (key: string) => (get(key) as HTMLInputElement | null)?.files?.[0] ?? null
  return { ref, text, file }
}

const noEnter = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault()
}

function ReceiptForm({ requestId, lines }: { requestId: number; lines: RequesterActionsProps['lines'] }) {
  const { busy, error, run } = useAction()
  const { ref, text, file } = useFields()
  const onSubmit = () =>
    void run(async () => {
      const image = file('image')
      if (!image || image.size === 0) throw new Error('Foto nota wajib diunggah.')
      const vendorName = text('vendorName')
      const receiptDate = text('receiptDate')
      const amount = Number(text('amount').replace(/[^\d]/g, ''))
      if (!vendorName) throw new Error('Vendor / toko wajib diisi.')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) throw new Error('Tanggal nota wajib diisi.')
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Nominal harus angka Rupiah > 0.')
      const imageId = await uploadReceiptImage(image)
      await post(`${base(requestId)}/receipts`, { lineId: text('lineId'), receiptNo: text('receiptNo') || null, vendorName, receiptDate, amount, imageId })
      flashAndGo('Nota tersimpan. Periksa flag validasi pada daftar nota (bila ada).')
    })
  return (
    <div ref={ref} onKeyDown={noEnter} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginTop: 8 }} data-pk-form="receipt">
      <label style={field}>
        Baris item
        <select data-f="lineId">
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.no}. {l.description || '(tanpa uraian)'} — {rp(l.total)}
            </option>
          ))}
        </select>
      </label>
      <label style={field}>
        Foto nota (JPG/PNG/WebP)
        <input type="file" data-f="image" accept="image/jpeg,image/png,image/webp" />
      </label>
      <label style={field}>
        No. nota
        <input type="text" data-f="receiptNo" maxLength={64} />
      </label>
      <label style={field}>
        Vendor / toko
        <input type="text" data-f="vendorName" maxLength={160} />
      </label>
      <label style={field}>
        Tanggal nota
        <input type="date" data-f="receiptDate" />
      </label>
      <label style={field}>
        Nominal tercetak (Rp)
        <input type="text" data-f="amount" inputMode="numeric" placeholder="150000" />
      </label>
      <button type="button" className={btn(true)} style={{ margin: 0 }} disabled={busy} onClick={onSubmit} data-pk-action="add-receipt">
        {busy ? 'Mengunggah…' : 'Upload nota'}
      </button>
      {error ? <span style={{ ...errStyle, width: '100%' }}>{error}</span> : null}
    </div>
  )
}

function LpjForm({ requestId, settlement, resubmit }: { requestId: number; settlement: RequesterActionsProps['settlement']; resubmit: boolean }) {
  const { busy, error, run } = useAction()
  const { ref, text } = useFields()
  const onSubmit = () =>
    void run(async () => {
      const notes = text('usageNotes')
      await post(`${base(requestId)}/lpj/submit`, notes ? { usageNotes: notes } : {})
      flashAndGo(resubmit ? 'LPJ dikirim ulang ke Finance.' : 'LPJ terkirim ke Finance.')
    })
  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }} data-pk-form="lpj">
      <label style={field}>
        Uraian penggunaan dana (wajib saat kirim pertama)
        <textarea data-f="usageNotes" rows={3} maxLength={2000} defaultValue={settlement?.usageNotes ?? ''} />
      </label>
      <div>
        <button type="button" className={btn(true)} style={{ margin: 0 }} disabled={busy} onClick={onSubmit} data-pk-action="lpj-submit">
          {busy ? 'Memproses…' : resubmit ? 'Kirim ulang LPJ' : 'Kirim LPJ'}
        </button>
      </div>
      {error ? <span style={errStyle}>{error}</span> : null}
    </div>
  )
}

function FlagList({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null
  return (
    <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }}>
      {flags.map((f) => (
        <li key={f.id} style={{ color: f.level === 'warning' ? 'var(--pk-tone-warn-text)' : 'inherit' }}>
          {f.label}
          {f.lineNo ? ` (baris ${f.lineNo})` : ''}: {f.message}
          {f.status === 'reviewed' ? ' — sudah diperiksa Finance' : ''}
        </li>
      ))}
    </ul>
  )
}

const RECEIPT_STATUS: Record<string, string> = { pending: 'menunggu verifikasi', valid: 'valid', rejected: 'ditolak', removed: 'dihapus' }

export function RequesterActions(p: RequesterActionsProps) {
  const flash = useSyncExternalStore(noSubscribe, readFlashOnce, () => null)
  const has = (a: Action) => p.actions.includes(a)
  const url = base(p.id)
  const showReceipts = p.type === 'reimburse' || p.receipts.length > 0 || has('add_receipt')
  return (
    <div data-pk-panel="requester">
      {flash ? (
        <div role="status" style={{ ...box, borderColor: 'var(--theme-success-500)', background: 'var(--theme-success-50)' }}>
          {flash}
        </div>
      ) : null}
      <section style={box}>
        <strong>Aksi pemohon</strong>
        {!p.hasSignature && (has('submit') || has('lpj_submit')) ? (
          <div style={{ margin: '6px 0' }}>
            Anda belum punya tanda tangan di profil (wajib untuk mengirim bila aturan approval memintanya).{' '}
            <a href={p.profileHref}>Unggah tanda tangan di profil</a>.
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          {has('submit') ? (
            <Act testId="submit" primary label="Kirim pengajuan" url={`${url}/submit`} confirm="Kirim pengajuan ini? Setelah dikirim isi terkunci (tarik kembali bila perlu mengubah)." success="Pengajuan terkirim. Nomor diterbitkan dan approver dinotifikasi." />
          ) : null}
          {has('withdraw') ? (
            <Act testId="withdraw" label="Tarik kembali ke Draft" url={`${url}/withdraw`} reason="Alasan tarik kembali (wajib, min. 3 karakter):" success="Pengajuan ditarik kembali ke Draft; silakan ubah lalu kirim lagi." />
          ) : null}
          {has('cancel') ? <Act testId="cancel" label="Batalkan pengajuan" url={`${url}/cancel`} reason="Alasan pembatalan (wajib, min. 3 karakter):" success="Pengajuan dibatalkan." /> : null}
          {has('resubmit') ? (
            <Act testId="resubmit" primary gotoNew label="Ajukan ulang (buat draft baru)" url={`${url}/resubmit`} confirm="Buat draft baru dari pengajuan yang ditolak ini?" success="Draft baru dibuat dari pengajuan yang ditolak. Periksa, ubah bila perlu, lalu kirim." />
          ) : null}
          {has('receipts_resubmit') ? (
            <Act testId="receipts-resubmit" primary label="Kirim ulang nota" url={`${url}/receipts-resubmit`} confirm="Kirim ulang nota yang sudah diperbaiki ke Finance?" success="Nota dikirim ulang." />
          ) : null}
          {has('receipts_complete') ? (
            <Act testId="receipts-complete" primary label="Tandai nota lengkap" url={`${url}/receipts-complete`} confirm="Semua nota sudah diunggah? Setelah ini isi uraian lalu kirim LPJ." success="Nota ditandai lengkap. Lanjutkan dengan Kirim LPJ." />
          ) : null}
          {has('complete') ? <Act testId="complete" label="Konfirmasi selesai" url={`${url}/complete`} confirm="Dana sudah diterima? Tandai pengajuan selesai." success="Pengajuan ditandai selesai." /> : null}
          {p.actions.length === 0 ? (
            <div style={{ color: 'var(--theme-elevation-600)' }}>Tidak ada aksi untuk Anda pada status ini.</div>
          ) : null}
        </div>
        {p.requestFlags.length > 0 ? (
          <div style={{ marginTop: 8 }}>
            <strong style={{ fontSize: 12 }}>Flag validasi</strong>
            <FlagList flags={p.requestFlags} />
          </div>
        ) : null}
      </section>

      {showReceipts ? (
        <section style={box} data-pk-section="receipts">
          <strong>Nota {p.type === 'reimburse' ? '(wajib per baris sebelum kirim, US-38)' : '(setelah dana ditransfer)'}</strong>
          {p.receipts.length === 0 ? <div style={{ marginTop: 6 }}>Belum ada nota.</div> : null}
          {p.receipts.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <thead>
                <tr>
                  {['Foto', 'Baris', 'Nota', 'Tanggal', 'Nominal', 'Status', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: 4, borderBottom: '1px solid var(--theme-elevation-150)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.receipts.map((r) => (
                  <tr key={r.id} style={{ opacity: r.status === 'removed' ? 0.5 : 1 }}>
                    <td style={{ padding: 4, verticalAlign: 'top' }}>
                      {r.imageId ? (
                        <a href={`/api/v1/media/receipts/${r.imageId}/file`} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API file, not a static asset */}
                          <img src={`/api/v1/media/receipts/${r.imageId}/file?variant=thumb`} alt={`Nota ${r.receiptNo ?? r.id}`} style={{ width: 64, height: 64, objectFit: 'cover' }} />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ padding: 4, verticalAlign: 'top' }}>{r.lineNo ?? '—'}</td>
                    <td style={{ padding: 4, verticalAlign: 'top' }}>
                      {r.vendorName}
                      <div style={{ fontSize: 11 }}>No. {r.receiptNo ?? '—'}</div>
                      <FlagList flags={r.flags} />
                    </td>
                    <td style={{ padding: 4, verticalAlign: 'top' }}>{r.receiptDate}</td>
                    <td style={{ padding: 4, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{rp(r.amount)}</td>
                    <td style={{ padding: 4, verticalAlign: 'top' }}>{RECEIPT_STATUS[r.status] ?? r.status}</td>
                    <td style={{ padding: 4, verticalAlign: 'top' }}>
                      {has('add_receipt') && r.status !== 'removed' ? (
                        <Act testId={`remove-receipt-${r.id}`} label="Hapus" url={`${url}/receipts/${r.id}/remove`} reason="Alasan menghapus nota (wajib):" success="Nota dihapus (tercatat di riwayat)." />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {has('add_receipt') ? (
            p.lines.length === 0 ? (
              <div style={{ marginTop: 6 }}>Simpan minimal 1 baris item dulu, lalu upload nota per baris.</div>
            ) : (
              <ReceiptForm requestId={p.id} lines={p.lines} />
            )
          ) : null}
        </section>
      ) : null}

      {p.type === 'advance' && (p.settlement || has('lpj_submit')) ? (
        <section style={box} data-pk-section="lpj">
          <strong>LPJ {p.settlement?.docNo ?? ''}</strong> {p.settlement ? `· ${p.settlement.statusLabel} · kiriman ke-${p.settlement.submitCount}` : null}
          {p.settlement ? (
            <div style={{ marginTop: 4 }}>
              Total nota {rp(p.settlement.receiptsTotal)} · selisih (ditransfer − nota) {rp(p.settlement.difference)}
            </div>
          ) : null}
          {p.settlement?.financeNotes ? (
            <div style={{ marginTop: 6, padding: 8, borderLeft: '3px solid var(--pk-accent)', background: 'var(--theme-elevation-50)' }} data-pk-revision-note>
              <strong>Catatan revisi Finance:</strong> {p.settlement.financeNotes}
            </div>
          ) : null}
          {has('lpj_submit') ? <LpjForm requestId={p.id} settlement={p.settlement} resubmit={p.status === 'lpj_revision'} /> : null}
        </section>
      ) : null}
    </div>
  )
}

export default RequesterActions
