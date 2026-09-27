'use client'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

/**
 * Posts one /api/v1 action with the admin cookie session (same-origin fetch: the session strategy
 * checks Origin on unsafe methods) and refreshes the server-rendered view. Optional reason/note
 * prompt (G7: reject, revision, cancel; `minLength` → required, checked before the call). Every
 * click sends a fresh Idempotency-Key (G15: a network retry of the same click is replayed, not
 * repeated). The server re-checks every action; this is UI only.
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

export function problemText(data: unknown, status: number): string {
  const p = (data ?? {}) as { title?: string; detail?: string; errors?: Array<{ path?: string; message?: string }> }
  const head = p.detail ?? p.title ?? `HTTP ${status}`
  // S3e: messages already in `detail` (body validation) are not repeated.
  const errs = (p.errors ?? [])
    .filter((e) => !(e.message && head.includes(e.message)))
    .map((e) => `${e.path ? `${e.path}: ` : ''}${e.message ?? ''}`)
    .join('; ')
  return [head, errs].filter(Boolean).join(' — ')
}

export function ActionButton({ url, label, body, prompt, confirm, variant = 'secondary', testId }: ActionButtonProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setError(null)
    const payload: Record<string, unknown> = { ...(body ?? {}) }
    if (prompt) {
      const v = window.prompt(prompt.message)
      if (v === null) return
      if (prompt.minLength && v.trim().length < prompt.minLength) {
        setError(`Wajib diisi (minimal ${prompt.minLength} karakter).`)
        return
      }
      payload[prompt.field] = v.trim()
    } else if (confirm && !window.confirm(confirm)) return
    setBusy(true)
    try {
      const r = await postJson(url, payload, { idempotencyKey: idemKey() })
      if (!r.ok) setError(problemText(r.data, r.status))
      else router.refresh()
    } catch {
      setError('Gagal menghubungi server.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, marginRight: 6 }}>
      <button type="button" className={`btn btn--style-${variant} btn--size-small`} style={{ margin: 0 }} disabled={busy} onClick={run} data-pk-action={testId}>
        {busy ? 'Memproses…' : label}
      </button>
      {error ? <span style={{ color: 'var(--theme-error-500)', fontSize: 12, maxWidth: 320 }}>{error}</span> : null}
    </span>
  )
}

export default ActionButton
