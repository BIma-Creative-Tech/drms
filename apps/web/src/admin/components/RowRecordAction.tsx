'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { postJson, problemText } from './ActionButton'
import { asConfirmLabel, asConfirmTitle, failureTitle, showResult, successTitle } from './feedback/feedback'
import { KAS_STYLE } from './kas/style'

/**
 * D1610 (ADR 0030): the second button of the "Aksi" column on soft-deletable lists — "Hapus" (unused row / draft
 * never submitted), "Batalkan" (used project → Batalkan proyek with its dry run; submitted request → the existing
 * cancel), "Nonaktifkan" (used master: why it cannot be deleted + link to the form) or "Pulihkan" (Admin, deleted
 * row). The state comes from the server (PkListView → `rowData._pkRow`); every endpoint re-checks. Native modal
 * <dialog> like ActionDialog (focus trap, Esc, focus back), reason required where something changes, one
 * Idempotency-Key per opened dialog + body. Clicks inside do not open the row (ClickableRow ignores buttons/dialogs).
 * DRMS 24/10: the dialog is the confirmation ("Yakin ingin hapus …?", [Ya, hapus]); the result popup follows.
 */
export type RowRecordActionKind = 'hapus' | 'batalkan' | 'nonaktifkan' | 'pulihkan'

type Props = { collection: string; id: number | string; name: string; action: RowRecordActionKind; editHref: string }

type Usage = { label: string; count: number }
type Check = { canDelete: boolean; blockedReason: string | null; usage: Usage[]; deletedAt: string | null; deleteReason: string | null; title: string }
type PlanItem = { kind: string; id: number; docNo: string | null; title: string; statusLabel: string; href: string }
type Plan = { allowed: boolean; notAllowedReason: string | null; cancel: PlanItem[]; blocking: PlanItem[] }

const LABEL: Record<RowRecordActionKind, string> = { hapus: 'Hapus', batalkan: 'Batalkan', nonaktifkan: 'Nonaktifkan', pulihkan: 'Pulihkan' }
const KIND: Record<string, string> = { expense_request: 'Pengajuan', budget_addendum: 'Addendum RAB', project_loan: 'Pinjaman' }
const MIN = 3

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)

async function getJson(url: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) }
}

function Items({ items, testId }: { items: PlanItem[]; testId: string }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13, maxHeight: 180, overflow: 'auto' }} data-pk-plan={testId}>
      {items.map((i) => (
        <li key={`${i.kind}-${i.id}`}>
          <a href={i.href} target="_blank" rel="noopener noreferrer">
            {KIND[i.kind] ?? i.kind} {i.docNo ?? `#${i.id}`}
          </a>
          {i.title ? ` — ${i.title}` : ''} <span style={{ color: 'var(--pk-muted-fg)' }}>({i.statusLabel})</span>
        </li>
      ))}
    </ul>
  )
}

export function RowRecordAction({ collection, id, name, action, editHref }: Props) {
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const key = useRef<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [check, setCheck] = useState<Check | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isProjectCancel = action === 'batalkan' && collection === 'projects'
  const isRequestCancel = action === 'batalkan' && collection === 'expense-requests'
  const base = `/api/v1/records/${encodeURIComponent(collection)}/${encodeURIComponent(String(id))}`

  const open = async () => {
    setError(null)
    setReason('')
    setCheck(null)
    setPlan(null)
    key.current = newKey()
    ref.current?.showModal()
    if (isRequestCancel) return
    setLoading(true)
    try {
      const r = await getJson(isProjectCancel ? `/api/v1/projects/${encodeURIComponent(String(id))}/cancel-plan` : `${base}/delete-check`)
      if (!r.ok) setError(problemText(r.data, r.status))
      else if (isProjectCancel) setPlan(r.data as Plan)
      else setCheck(r.data as Check)
    } catch {
      setError('Gagal menghubungi server. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }
  const close = () => {
    if (!busy) ref.current?.close()
  }

  // what the dialog can confirm
  const canConfirm = action === 'nonaktifkan' ? false : isRequestCancel ? true : isProjectCancel ? !!plan && plan.allowed && plan.blocking.length === 0 : action === 'pulihkan' ? !!check : !!check && check.canDelete
  const url = isProjectCancel ? `/api/v1/projects/${encodeURIComponent(String(id))}/cancel` : isRequestCancel ? `/api/v1/expense-requests/${encodeURIComponent(String(id))}/cancel` : action === 'pulihkan' ? `${base}/restore` : `${base}/delete`

  const confirm = async () => {
    if (busy || !canConfirm) return
    const v = reason.trim()
    if (v.length < MIN) {
      setError(`Alasan wajib diisi (minimal ${MIN} karakter).`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await postJson(url, { reason: v }, { idempotencyKey: key.current })
      if (!r.ok) {
        const msg = problemText(r.data, r.status)
        setError(msg)
        showResult({ ok: false, title: failureTitle(confirmLabel), message: msg, testId: `row-${action}` })
        const blocking = (r.data as { blocking?: PlanItem[] } | null)?.blocking
        if (isProjectCancel && Array.isArray(blocking) && plan) setPlan({ ...plan, blocking })
        return
      }
      ref.current?.close()
      showResult({ ok: true, title: successTitle(confirmLabel, name), message: action === 'pulihkan' ? 'Data kembali tampil di daftar dan pemilih.' : null, testId: `row-${action}` })
      router.refresh()
    } catch {
      const msg = 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.'
      setError(msg)
      showResult({ ok: false, title: failureTitle(confirmLabel), message: msg, testId: `row-${action}` })
    } finally {
      setBusy(false)
    }
  }

  const title = isProjectCancel ? `Batalkan proyek ${name}?` : isRequestCancel ? `Batalkan pengajuan ${name}?` : action === 'pulihkan' ? `Pulihkan ${name}?` : action === 'nonaktifkan' ? `${name} sudah dipakai` : `Hapus ${name}?`
  const confirmLabel = isProjectCancel ? 'Batalkan proyek' : isRequestCancel ? 'Batalkan pengajuan' : action === 'pulihkan' ? 'Pulihkan' : 'Hapus'

  let body: React.ReactNode = null
  if (loading) body = <p className="desc">Memeriksa data…</p>
  else if (isRequestCancel) body = <p className="desc">Pengajuan dibatalkan lewat alur yang sama seperti tombol Batalkan di halaman pengajuan (pemohon mendapat notifikasi). Pembatalan tidak dapat dikembalikan.</p>
  else if (isProjectCancel && plan) {
    body = !plan.allowed ? (
      <p className="pk-kerr">{plan.notAllowedReason}</p>
    ) : plan.blocking.length > 0 ? (
      <>
        <p className="pk-kerr">Project belum dapat dibatalkan: dokumen berikut sudah berjalan (dana sudah ditransfer, LPJ, atau pengembalian pinjaman). Selesaikan dulu, lalu ulangi.</p>
        <Items items={plan.blocking} testId="blocking" />
      </>
    ) : (
      <>
        <p className="desc">Status project menjadi Dibatalkan (tidak dapat dikembalikan). {plan.cancel.length > 0 ? 'Dokumen berikut ikut dibatalkan dengan alasan "Proyek dibatalkan: …" dan pihak terkait mendapat notifikasi:' : 'Tidak ada dokumen yang masih berjalan.'}</p>
        {plan.cancel.length > 0 ? <Items items={plan.cancel} testId="cancel" /> : null}
      </>
    )
  } else if (check) {
    const usage = check.usage.length > 0 ? (
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} data-pk-usage>
        {check.usage.map((u) => (
          <li key={u.label}>
            {u.label}: {u.count}
          </li>
        ))}
      </ul>
    ) : null
    if (action === 'nonaktifkan')
      body = (
        <>
          <p className="desc">Data yang sudah dipakai tidak dapat dihapus. Dipakai di:</p>
          {usage}
          <p className="desc">
            Nonaktifkan lewat formulir: hapus centang <b>Aktif</b>, isi <b>Alasan perubahan</b>, lalu simpan. Data nonaktif tidak muncul di pemilih, riwayat tetap utuh.
          </p>
        </>
      )
    else if (action === 'pulihkan')
      body = <p className="desc">Data kembali tampil di daftar dan pemilih.{check.deleteReason ? ` Alasan hapus: ${check.deleteReason}.` : ''} Tercatat di audit log.</p>
    else
      body = check.canDelete ? (
        <p className="desc">Data disembunyikan dari daftar, pemilih, laporan, dan aplikasi (soft delete) — tidak dihapus permanen; Admin dapat memulihkannya. Tercatat di audit log.</p>
      ) : (
        <>
          <p className="pk-kerr">{check.blockedReason}</p>
          {usage}
        </>
      )
  }

  return (
    <>
      <style href="pk-kas-style" precedence="default">
        {KAS_STYLE}
      </style>
      <button type="button" className="pk-row-act" data-kind={action} aria-label={`${LABEL[action]} ${name}`} data-pk-row-action={action} onClick={() => void open()}>
        <span>{LABEL[action]}</span>
      </button>
      <dialog ref={ref} className="pk-dlg" aria-labelledby={`${uid}-t`} onCancel={(e) => busy && e.preventDefault()} data-pk-dialog={`row-${action}`}>
        <div style={{ display: 'grid', gap: 14, padding: 20, whiteSpace: 'normal', textAlign: 'left' }}>
          <h2 id={`${uid}-t`} style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>
            {action === 'nonaktifkan' ? title : asConfirmTitle(title)}
          </h2>
          {body}
          {canConfirm ? (
            <div className="pk-fld">
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
                aria-required
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  setReason(e.target.value)
                  if (error) setError(null)
                  key.current = newKey() // other body → other key (same key + other body = 422)
                }}
                data-pk-reason={`row-${action}`}
              />
              <p className="help">Wajib, minimal {MIN} karakter. Tercatat di audit log.</p>
            </div>
          ) : null}
          {error ? (
            <p className="pk-kerr" role="alert">
              {error}
            </p>
          ) : null}
          <div className="foot">
            <button type="button" className="pk-kbtn" onClick={close} disabled={busy}>
              {canConfirm ? 'Batal' : 'Tutup'}
            </button>
            {action === 'nonaktifkan' ? (
              <a className="pk-kbtn primary" href={editHref}>
                Buka formulir
              </a>
            ) : null}
            {canConfirm ? (
              <button type="button" className={`pk-kbtn ${action === 'pulihkan' ? 'primary' : 'danger-solid'}`} onClick={() => void confirm()} disabled={busy} data-pk-confirm={`row-${action}`}>
                {busy ? 'Memproses…' : asConfirmLabel(confirmLabel)}
              </button>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  )
}

export default RowRecordAction
