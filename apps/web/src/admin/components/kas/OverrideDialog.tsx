'use client'
import React, { useEffect, useId, useRef } from 'react'

import type { OverridePrompt } from './override'

export { overridePromptOf, type OverrideFlag, type OverridePrompt } from './override'

/**
 * QA-04 / QA-17 (owner decisions 2026-10-08: warning + explicit confirmation, audited). The server
 * answers 409 with a stable `code` when a cash-out would make the account balance negative
 * (CASH_OVERDRAFT_CONFIRM_REQUIRED {balance, after}) or when the destination bank account is not
 * verified (BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED). The form shows this app dialog (native modal
 * <dialog>, not window.confirm) with the figures; "Tetap simpan" re-sends the same body plus the
 * confirmation flag — the server re-checks and writes the audit row. Styles: KAS_STYLE (.pk-dlg).
 */
export function OverrideDialog({ prompt, busy, onConfirm, onCancel }: { prompt: OverridePrompt | null; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const uid = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (prompt && !d.open) d.showModal()
    if (!prompt && d.open) d.close()
  }, [prompt])
  return (
    <dialog
      ref={ref}
      className="pk-dlg"
      aria-labelledby={`${uid}-t`}
      aria-describedby={`${uid}-d`}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      data-pk-override={prompt?.flag}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) onConfirm()
        }}
      >
        <h2 id={`${uid}-t`}>{prompt?.title}</h2>
        <div id={`${uid}-d`} className="desc">
          {(prompt?.lines ?? []).map((l, i) => (
            <p key={i} style={{ margin: i ? '6px 0 0' : 0 }}>
              {l}
            </p>
          ))}
        </div>
        <div className="foot">
          <button type="button" className="pk-kbtn" onClick={() => !busy && onCancel()} disabled={busy} autoFocus>
            Batal
          </button>
          <button type="submit" className="pk-kbtn primary" disabled={busy} data-pk-confirm-override={prompt?.flag}>
            {busy ? 'Menyimpan…' : 'Tetap simpan'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export default OverrideDialog
