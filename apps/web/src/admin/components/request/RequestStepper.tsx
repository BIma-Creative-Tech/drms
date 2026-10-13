import React from 'react'

import { isCurrentStep, STEPPER_STATE_LABELS, type RequestStepper as Stepper, type StepperState } from '@/domain/expense/request-stepper'
import { formatServerTimestamp } from '@/lib/server-time'
import { formatDateLong } from '@/pdf/format'

const ICON: Record<StepperState, string> = { done: '✓', current: '▶', revision: '↺', pending: '○', skipped: '–', rejected: '✕' }

const TONE: Record<StepperState, string> = {
  done: 'var(--pk-tone-ok)',
  current: 'var(--pk-primary)',
  revision: 'var(--pk-tone-warn)',
  rejected: 'var(--pk-tone-bad)',
  pending: 'transparent',
  skipped: 'transparent',
}

const dot = (s: StepperState): React.CSSProperties => ({
  flex: 'none',
  display: 'inline-grid',
  placeItems: 'center',
  width: 24,
  height: 24,
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  color: s === 'pending' || s === 'skipped' ? 'var(--theme-elevation-600)' : '#FFFFFF', // ≥ 4.5:1 on --pk-tone-* / --pk-primary
  background: TONE[s],
  border: s === 'pending' || s === 'skipped' ? '1.5px dashed var(--theme-elevation-400)' : '1.5px solid transparent',
})

const when = (at: string | null, tz: string) => (!at ? null : /^\d{4}-\d{2}-\d{2}$/.test(at) ? formatDateLong(at) : formatServerTimestamp(at, tz))

/**
 * DRMS 13/10 Persetujuan #3/#5: the ONE vertical stepper of the request page (domain/expense/request-stepper.ts) —
 * Diajukan → approval positions → [Verifikasi nota] → Transfer → [Nota & LPJ → Penyelesaian] → Selesai, per step
 * the role, planned approver, actor, time, decision and note; the waiting step is highlighted as "Tahapan saat ini".
 * Rendered twice by the page: in the right column (`sidebar`, sticky, desktop) and after the summary (`inline`,
 * stacked layout ≤ 1024 px) — custom.scss shows one of them. Server-rendered markup only.
 */
export function RequestStepper({ stepper, tz, variant, note, ruleName }: { stepper: Stepper; tz: string; variant: 'sidebar' | 'inline'; note?: string | null; ruleName?: string | null }) {
  const heading = `pk-stepper-${variant}`
  return (
    <section className={`pk-stepper pk-stepper--${variant}`} aria-labelledby={heading} data-pk-stepper={variant} data-pk-approval-timeline>
      <h3 id={heading} className="pk-stepper__title">
        Alur pengajuan
      </h3>
      {note ? (
        <p className="pk-stepper__note" data-pk-g1-exception>
          {note}
        </p>
      ) : null}
      {stepper.cycleNote ? (
        <p className="pk-stepper__note" data-pk-cycle-note>
          {stepper.cycleNote}
        </p>
      ) : null}
      {ruleName ? (
        <p className="pk-stepper__meta" data-pk-rule-name>
          Aturan approval: {ruleName}
        </p>
      ) : null}
      <ol className="pk-stepper__list">
        {stepper.steps.map((s, i) => {
          const time = when(s.at, tz)
          const current = isCurrentStep(s)
          return (
            <li
              key={s.key}
              className={['pk-stepper__step', current ? 'is-current' : null, `is-${s.state}`].filter(Boolean).join(' ')}
              data-pk-step={s.key}
              data-pk-step-state={s.state}
              aria-current={current ? 'step' : undefined}
            >
              {i < stepper.steps.length - 1 ? <span aria-hidden className="pk-stepper__line" /> : null}
              <span aria-hidden style={dot(s.state)}>
                {ICON[s.state]}
              </span>
              <div className="pk-stepper__body">
                <div className="pk-stepper__head">
                  <strong>{s.title}</strong>
                  <span className="pk-stepper__state">{STEPPER_STATE_LABELS[s.state]}</span>
                </div>
                <div className="pk-stepper__role">
                  {s.role}
                  {s.planned && s.planned !== s.role ? <> · rencana: {s.planned}</> : null}
                </div>
                {s.actor || time ? (
                  <div className="pk-stepper__actor">
                    {s.actor ? <span data-pk-step-actor>{s.actor}</span> : null}
                    {s.actor && time ? ' · ' : null}
                    {time ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</span> : null}
                  </div>
                ) : null}
                {s.note ? <div className="pk-stepper__stepnote">{s.note}</div> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default RequestStepper
