'use client'
import React, { useEffect, useId, useRef, useSyncExternalStore } from 'react'

import { KAS_STYLE } from '../kas/style'
import { answerConfirm, dismissResult, feedbackStore, restoreResult, summaryRows, type FeedbackState, type Summary } from './feedback'

/**
 * DRMS 24/10: the two app popups of every data-changing action (feedback.ts) — mounted ONCE through
 * `admin.components.providers` (payload.config.ts), so every admin page has them, Payload's built-in edit views and
 * drawers included. Native modal <dialog> like ActionDialog (focus trap, Esc = Batal / OK, focus returns to the
 * button that opened it), KAS_STYLE classes. Both dialogs sit in the browser top layer: above the loading shield and
 * above an open reason dialog (a failure result shows on top of it; the reason dialog stays for a retry).
 */
const FEEDBACK_STYLE = `
.pk-fb__sum { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; padding: 10px 12px; border: 1px solid var(--pk-border); border-radius: var(--style-radius-m); background: var(--pk-muted-bg); font-size: 13px; }
.pk-fb__sum dt { color: var(--pk-muted-fg); }
.pk-fb__sum dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.pk-fb__res { display: flex; gap: 12px; align-items: flex-start; }
.pk-fb__res > b { flex: none; width: 28px; height: 28px; border-radius: 999px; display: inline-grid; place-items: center; color: #FFFFFF; font-size: 15px; background: var(--pk-tone-ok); }
.pk-fb__res[data-ok='false'] > b { background: var(--pk-tone-bad); }
.pk-fb__res p { margin: 4px 0 0; font-size: 13px; line-height: 1.5; color: var(--pk-fg); white-space: pre-line; overflow-wrap: anywhere; }
`

/** Summary rows as a definition list (shared with ActionDialog / ReasonAction / RowRecordAction). */
export function SummaryList({ summary }: { summary?: Summary }) {
  const rows = summaryRows(summary)
  if (rows.length === 0) return null
  return (
    <dl className="pk-fb__sum" data-pk-summary>
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

/** Style tag of the summary list for components outside the host (React 19 hoists + dedupes it). */
export function FeedbackStyle() {
  return (
    <style href="pk-feedback-style" precedence="default">
      {FEEDBACK_STYLE}
    </style>
  )
}

const empty: FeedbackState = { confirm: null, result: null }

export function FeedbackHost({ children }: { children?: React.ReactNode }) {
  const s = useSyncExternalStore(feedbackStore.subscribe, feedbackStore.get, () => empty)
  const confirmRef = useRef<HTMLDialogElement>(null)
  const resultRef = useRef<HTMLDialogElement>(null)
  const uid = useId()

  useEffect(() => {
    const detach = feedbackStore.attach()
    restoreResult()
    return detach
  }, [])

  useEffect(() => {
    const d = confirmRef.current
    if (!d) return
    if (s.confirm && !d.open) d.showModal()
    if (!s.confirm && d.open) d.close()
  }, [s.confirm])

  useEffect(() => {
    const d = resultRef.current
    if (!d) return
    if (s.result && !d.open) d.showModal()
    if (!s.result && d.open) d.close()
  }, [s.result])

  const c = s.confirm
  const r = s.result
  return (
    <>
      {children}
      <style href="pk-kas-style" precedence="default">
        {KAS_STYLE}
      </style>
      <FeedbackStyle />
      <dialog
        ref={confirmRef}
        className="pk-dlg"
        aria-labelledby={`${uid}-ct`}
        aria-describedby={c ? `${uid}-cd` : undefined}
        onCancel={(e) => {
          e.preventDefault()
          answerConfirm(false)
        }}
        // Enter inside Payload's document form must never submit the document
        onKeyDown={(e) => e.stopPropagation()}
        data-pk-dialog={c ? (c.testId ?? 'confirm') : undefined}
        data-pk-confirm-dialog
      >
        {c ? (
          <div role="group" aria-labelledby={`${uid}-ct`} style={{ display: 'grid', gap: 14, padding: 20, whiteSpace: 'normal', textAlign: 'left' }}>
            <h2 id={`${uid}-ct`} style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>
              {c.title}
            </h2>
            <div id={`${uid}-cd`} style={{ display: 'grid', gap: 10 }}>
              <SummaryList summary={c.summary} />
              {c.description ? <p className="desc">{c.description}</p> : null}
            </div>
            <div className="foot">
              <button type="button" className="pk-kbtn" onClick={() => answerConfirm(false)} data-pk-cancel={c.testId ?? 'confirm'}>
                Batal
              </button>
              <button type="button" className={`pk-kbtn ${c.danger ? 'danger-solid' : 'primary'}`} onClick={() => answerConfirm(true)} data-pk-confirm={c.testId ?? 'confirm'} data-pk-confirm-yes autoFocus>
                {c.confirmLabel}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
      <dialog
        ref={resultRef}
        className="pk-dlg"
        role="alertdialog"
        aria-labelledby={`${uid}-rt`}
        aria-describedby={r?.message ? `${uid}-rd` : undefined}
        onCancel={(e) => {
          e.preventDefault()
          dismissResult()
        }}
        onKeyDown={(e) => e.stopPropagation()}
        data-pk-result={r ? (r.ok ? 'ok' : 'error') : undefined}
      >
        {r ? (
          <div style={{ display: 'grid', gap: 16, padding: 20, whiteSpace: 'normal', textAlign: 'left' }}>
            <div className="pk-fb__res" data-ok={r.ok ? 'true' : 'false'}>
              <b aria-hidden>{r.ok ? '✓' : '!'}</b>
              <div style={{ minWidth: 0 }}>
                <h2 id={`${uid}-rt`} style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>
                  {r.title}
                </h2>
                {r.message ? <p id={`${uid}-rd`}>{r.message}</p> : null}
              </div>
            </div>
            <div className="foot">
              <button type="button" className="pk-kbtn primary" onClick={dismissResult} data-pk-result-ok={r.testId ?? (r.ok ? 'ok' : 'error')} autoFocus>
                OK
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  )
}

export default FeedbackHost
