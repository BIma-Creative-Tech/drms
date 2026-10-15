'use client'
import { useRouter } from 'next/navigation'
import React, { useRef, useState } from 'react'

import { errorLine } from '@/lib/field-labels'

import { ActionDialog } from './ActionDialog'

/**
 * Posts one /api/v1 action with the admin cookie session (same-origin fetch: the session strategy
 * checks Origin on unsafe methods) and refreshes the server-rendered view. Optional reason/note
 * (G7: reject, revision, cancel; `minLength` → required) or confirmation — QA-22/QA-23: in the app
 * dialog (ActionDialog: inline validation, the dialog stays open on a short reason or a server error),
 * never window.prompt/confirm. One Idempotency-Key per opened dialog + body (G15: a network retry of
 * the same submit is replayed, not repeated). The server re-checks every action; this is UI only.
 */
export type ActionButtonProps = {
  url: string
  label: string
  body?: Record<string, unknown>
  prompt?: { field: string; message: string; minLength?: number }
  confirm?: string
  variant?: 'primary' | 'secondary'
  /** data-pk-action attribute (UI tests). */
  testId?: string
}

const idemKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)

export async function postJson(url: string, body: unknown, opts: { idempotencyKey?: string } = {}): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  // G15: one key per click → a double submit / network retry of the same click is replayed, not repeated.
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}

/** Generic text per HTTP status when the body carries no readable detail (QA-21: never "HTTP 403"). */
export function statusText(status: number): string {
  if (status === 401) return 'Sesi Anda berakhir. Muat ulang halaman lalu masuk kembali.'
  if (status === 403) return 'Anda tidak berhak melakukan aksi ini.'
  if (status === 404) return 'Data tidak ditemukan (mungkin sudah berubah). Muat ulang halaman.'
  if (status === 409) return 'Status data sudah berubah. Muat ulang halaman lalu coba lagi.'
  if (status === 429) return 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.'
  if (status >= 500) return 'Terjadi kesalahan di server. Coba lagi beberapa saat lagi.'
  return 'Permintaan tidak dapat diproses.'
}

/**
 * Problem+json → one line for the user. QA-21: field paths are shown as their form labels
 * ("Uraian penggunaan dana: Wajib diisi"), unknown paths are dropped, never "HTTP 403".
 */
export function problemText(data: unknown, status: number): string {
  const p = (data ?? {}) as { title?: string; detail?: string; errors?: Array<{ path?: string; message?: string }> }
  const head = p.detail ?? (p.title && !/^[A-Z][A-Za-z ]+$/.test(p.title) ? p.title : statusText(status))
  // S3e: messages already in `detail` (body validation) are not repeated.
  const errs = (p.errors ?? [])
    .filter((e) => !(e.message && head.includes(e.message)))
    .map((e) => errorLine(e))
    .filter(Boolean)
    .join('; ')
  return [head, errs].filter(Boolean).join(' — ')
}

/** "Alasan penolakan (wajib, minimal 3 karakter):" → "Alasan penolakan" (dialog field label). */
export function promptLabel(message: string): string {
  return message.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[:：]\s*$/, '').trim() || 'Alasan'
}

export function ActionButton({ url, label, body, prompt, confirm, variant = 'secondary', testId }: ActionButtonProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = useRef<string | undefined>(undefined)
  const btnClass = `btn btn--style-${variant} btn--size-small pk-pbtn`

  const send = async (extra: Record<string, unknown>, idempotencyKey: string | undefined): Promise<string | null> => {
    const r = await postJson(url, { ...(body ?? {}), ...extra }, { idempotencyKey })
    if (!r.ok) return problemText(r.data, r.status)
    router.refresh()
    return null
  }

  // direct action (no reason, no confirmation)
  const run = async () => {
    setError(null)
    setBusy(true)
    try {
      setError(await send({}, idemKey()))
    } catch {
      setError('Gagal menghubungi server.')
    } finally {
      setBusy(false)
    }
  }

  if (prompt || confirm) {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, marginRight: 6 }}>
        <ActionDialog
          label={label}
          title={label}
          description={prompt ? (confirm ?? undefined) : confirm}
          confirmLabel={label}
          field={prompt ? { label: promptLabel(prompt.message), minLength: prompt.minLength ?? 0, required: (prompt.minLength ?? 0) > 0 } : undefined}
          rotateKey={() => {
            key.current = idemKey()
          }}
          onConfirm={(v) => send(prompt ? (v ? { [prompt.field]: v } : {}) : {}, key.current)}
          buttonClassName={btnClass}
          danger={Boolean(prompt && (prompt.minLength ?? 0) > 0 && /tolak|batal/i.test(label))}
          testId={testId}
        />
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, marginRight: 6 }}>
      <button type="button" className={btnClass} style={{ margin: 0 }} disabled={busy} onClick={run} data-pk-action={testId}>
        {busy ? 'Memproses…' : label}
      </button>
      {error ? (
        <span role="alert" style={{ color: 'var(--theme-error-500)', fontSize: 12, maxWidth: 320 }}>
          {error}
        </span>
      ) : null}
    </span>
  )
}

export default ActionButton
