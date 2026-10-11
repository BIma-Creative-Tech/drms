'use client'
import React from 'react'

import { REJECT_PROMPT } from '@/domain/expense/decision-texts'

import { ActionButton } from './ActionButton'

export type DecisionBarProps = {
  id: number
  /** Next step the caller may decide ('acknowledge' | 'approve'), null = reject only. */
  step: 'acknowledge' | 'approve' | null
  label: string
  confirm: string
  canReject: boolean
  /** Turn text ("Persetujuan PM project — giliran Anda"). */
  stepLabel: string
}

const STYLE = `
.pk-decide { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px max(16px, env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); background: var(--theme-bg, var(--pk-card)); border-top: 1px solid var(--theme-elevation-150); box-shadow: 0 -6px 16px -10px rgb(15 23 42 / .35); }
.pk-decide__text { margin-right: auto; font-size: 13px; min-width: 0; }
.pk-decide .btn { margin: 0; min-height: 40px; }
.pk-decide-spacer { height: 72px; }
@media (max-width: 520px) { .pk-decide__text { flex-basis: 100%; } .pk-decide > span { flex: 1 1 0; } .pk-decide .btn, .pk-decide button { width: 100%; } }
`

/**
 * DRMS 10/10 9d (WA-07): Setujui / Tolak / Diketahui on the request detail — the web counterpart of
 * the APK decision bar (fixed at the bottom, always visible while scrolling the lines/receipts). Shown
 * only when the server's `allowedActions` contains the decision (G1/G2, ADR 0013/0021); calls the same
 * POST /api/v1/expense-requests/:id/{acknowledge|approve|reject} with an Idempotency-Key per dialog
 * (ActionButton) and refreshes the page on success. Reject asks for a reason (≥ 3 characters).
 */
export function DecisionBar({ id, step, label, confirm, canReject, stepLabel }: DecisionBarProps) {
  return (
    <>
      <style>{STYLE}</style>
      <div className="pk-decide-spacer" aria-hidden />
      <div className="pk-decide" role="region" aria-label="Keputusan pengajuan" data-pk-decision-bar>
        <div className="pk-decide__text">
          <strong>Giliran Anda:</strong> {stepLabel}
        </div>
        {canReject ? <ActionButton url={`/api/v1/expense-requests/${id}/reject`} label="Tolak" prompt={REJECT_PROMPT} testId="reject" /> : null}
        {step ? <ActionButton url={`/api/v1/expense-requests/${id}/${step}`} label={label} variant="primary" confirm={confirm} testId={step} /> : null}
      </div>
    </>
  )
}

export default DecisionBar
