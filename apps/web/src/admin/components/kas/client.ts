'use client'
import { problemText } from '../ActionButton'

/**
 * E2 client helpers of the Kas views: same pattern as ActionButton/MoneyForm (same-origin fetch
 * with the admin cookie session; the session strategy checks Origin/Sec-Fetch-Site on unsafe
 * methods = CSRF guard; the server validates every body with Zod and re-checks role + state).
 */
export const newIdemKey = (): string | undefined => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)

export type Sent = { ok: boolean; status: number; data: unknown; error: string | null }

export async function sendJson(method: 'POST' | 'PATCH', url: string, body: unknown, idempotencyKey?: string): Promise<Sent> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const res = await fetch(url, { method, credentials: 'same-origin', headers, body: JSON.stringify(body ?? {}) })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : problemText(data, res.status) }
}

/** Field errors of a problem+json body keyed by path (400 from Zod / domain `fail(…, errors)`). */
export function fieldErrors(data: unknown): Record<string, string> {
  const errs = ((data ?? {}) as { errors?: Array<{ path?: string; message?: string }> }).errors ?? []
  const out: Record<string, string> = {}
  for (const e of errs) if (e.path && e.message && !out[e.path]) out[e.path] = e.message
  return out
}

/** Proof upload (media-attachments: PDF/JPEG/PNG, validated + re-encoded server-side). */
export async function uploadAttachment(file: File): Promise<number> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/v1/media/attachments', { method: 'POST', credentials: 'same-origin', body: fd })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(problemText(data, res.status))
  return (data as { id: number }).id
}
