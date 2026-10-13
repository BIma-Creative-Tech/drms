'use client'
import React, { useEffect, useRef } from 'react'

import { REJECT_PROMPT } from '@/domain/expense/decision-texts'

import { ActionButton } from './ActionButton'

export type DecisionBarProps = {
  id: number
  /** Next step the caller may decide ('acknowledge' | 'approve'), null = reject only. */
  step: 'acknowledge' | 'approve' | null
  label: string
  confirm: string
  canReject: boolean
  /** Step waiting for the caller ("Persetujuan PM"). */
  stepLabel: string
  /** ADR 0022: API collection of the decision (default the expense requests); `/:id/{step|reject}` is appended. */
  base?: string
  /** Region label (screen readers). */
  regionLabel?: string
  /** Reject prompt (default the expense-request text). */
  rejectPrompt?: { field: string; message: string; minLength?: number }
}

const STYLE = `
.pk-decide { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px max(16px, env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); background: var(--theme-bg, var(--pk-card)); border-top: 1px solid var(--theme-elevation-150); box-shadow: 0 -6px 16px -10px rgb(15 23 42 / .35); }
.pk-decide__text { margin-right: auto; font-size: 13px; min-width: 0; }
.pk-decide .btn { margin: 0; min-height: 40px; }
/* the fixed bar must not cover the end of the page (lines table, receipts): reserve its measured height */
/* Payload's <body> is the scroll box (height 100%) — padding on it is not scrollable, so pad the template */
body:has([data-pk-decision-bar]) .template-default { padding-bottom: calc(var(--pk-decide-h, 96px) + 16px); }
@media (max-width: 520px) { .pk-decide__text { flex-basis: 100%; } .pk-decide > span { flex: 1 1 0; } .pk-decide .btn, .pk-decide button { width: 100%; } }
`

/**
 * DRMS 10/10 9d (WA-07): Setujui / Tolak / Diketahui on the request detail — the web counterpart of
 * the APK decision bar (fixed at the bottom, always visible while scrolling the lines/receipts). Shown
 * only when the server's `allowedActions` contains the decision (G1/G2, ADR 0013/0021); calls the same
 * POST /api/v1/expense-requests/:id/{acknowledge|approve|reject} with an Idempotency-Key per dialog
 * (ActionButton) and refreshes the page on success. Reject asks for a reason (≥ 3 characters).
 */
export function DecisionBar({ id, step, label, confirm, canReject, stepLabel, base = '/api/v1/expense-requests', regionLabel = 'Keputusan pengajuan', rejectPrompt = REJECT_PROMPT }: DecisionBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  // The bar wraps to two rows on phones: publish its real height for the page padding above.
  useEffect(() => {
    const el = ref.current
    const root = document.documentElement
    if (!el || typeof ResizeObserver === 'undefined') return
    const set = () => root.style.setProperty('--pk-decide-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--pk-decide-h')
    }
  }, [])
  return (
    <>
      <style>{STYLE}</style>
      <div ref={ref} className="pk-decide" role="region" aria-label={regionLabel} data-pk-decision-bar>
        <div className="pk-decide__text">
          {/* DRMS 13/10 Persetujuan #9: "Menunggu keputusan Anda" instead of "Giliran Anda" */}
          <strong>Menunggu keputusan Anda:</strong> {stepLabel}
        </div>
        {canReject ? <ActionButton url={`${base}/${id}/reject`} label="Tolak" prompt={rejectPrompt} testId="reject" /> : null}
        {step ? <ActionButton url={`${base}/${id}/${step}`} label={label} variant="primary" confirm={confirm} testId={step} /> : null}
      </div>
    </>
  )
}

export default DecisionBar
