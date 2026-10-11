import React from 'react'

import { TIMELINE_STATE_LABELS, type ApprovalTimelineStep, type TimelineState } from '@/domain/expense/approval-timeline'
import { formatServerTimestamp } from '@/lib/server-time'
import { formatDateLong } from '@/pdf/format'

const ICON: Record<TimelineState, string> = { done: '✓', current: '▶', pending: '○', skipped: '–', rejected: '✕' }

const dot = (s: TimelineState): React.CSSProperties => ({
  flex: 'none',
  display: 'inline-grid',
  placeItems: 'center',
  width: 22,
  height: 22,
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  color: s === 'pending' || s === 'skipped' ? 'var(--theme-elevation-600)' : '#FFFFFF', // ≥ 4.5:1 on --pk-tone-* / --pk-primary
  background: s === 'done' ? 'var(--pk-tone-ok)' : s === 'current' ? 'var(--pk-primary)' : s === 'rejected' ? 'var(--pk-tone-bad)' : 'transparent',
  border: s === 'pending' || s === 'skipped' ? '1.5px dashed var(--theme-elevation-400)' : '1.5px solid transparent',
})

const when = (at: string | null, tz: string) => (!at ? null : /^\d{4}-\d{2}-\d{2}$/.test(at) ? formatDateLong(at) : formatServerTimestamp(at, tz))

/**
 * DRMS 10/10 9c (WA-06): vertical approval timeline of the request detail (web counterpart of the
 * APK TimelineView): one row per position with role, planned approver, state, actor, time and note.
 * Server-rendered markup only (steps from domain/expense/approval-timeline.ts).
 */
export function ApprovalTimeline({ steps, tz, note }: { steps: ApprovalTimelineStep[]; tz: string; note?: string | null }) {
  return (
    <section aria-labelledby="pk-approval-tl" data-pk-approval-timeline>
      <h3 id="pk-approval-tl" style={{ fontSize: 14, margin: '4px 0 8px' }}>
        Alur persetujuan
      </h3>
      {note ? (
        <p data-pk-g1-exception style={{ margin: '0 0 8px', fontSize: 12, padding: '6px 8px', borderRadius: 4, background: 'var(--theme-elevation-50)' }}>
          {note}
        </p>
      ) : null}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map((s, i) => {
          const time = when(s.at, tz)
          return (
            <li key={s.key} data-pk-step={s.key} data-pk-step-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined} style={{ display: 'flex', gap: 10, position: 'relative', paddingBottom: i < steps.length - 1 ? 12 : 0 }}>
              {i < steps.length - 1 ? <span aria-hidden style={{ position: 'absolute', left: 10.5, top: 24, bottom: 0, width: 1, background: 'var(--theme-elevation-150)' }} /> : null}
              <span aria-hidden style={dot(s.state)}>
                {ICON[s.state]}
              </span>
              <div style={{ minWidth: 0, fontSize: 13, lineHeight: 1.45 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
                  <strong style={{ fontWeight: s.state === 'current' ? 800 : 600 }}>{s.title}</strong>
                  <span style={{ fontSize: 11, fontWeight: 600, color: s.state === 'rejected' ? 'var(--pk-tone-bad-text)' : s.state === 'current' ? 'var(--pk-primary)' : 'var(--theme-elevation-700)' }}>{TIMELINE_STATE_LABELS[s.state]}</span>
                </div>
                <div style={{ color: 'var(--theme-elevation-700)', fontSize: 12 }}>
                  {s.role}
                  {s.planned && s.planned !== s.role ? <> · rencana: {s.planned}</> : null}
                </div>
                {s.actor || time ? (
                  <div style={{ fontSize: 12 }}>
                    {s.actor ? <span data-pk-step-actor>{s.actor}</span> : null}
                    {s.actor && time ? ' · ' : null}
                    {time ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</span> : null}
                  </div>
                ) : null}
                {s.note ? <div style={{ fontSize: 12, fontStyle: s.state === 'skipped' ? 'italic' : undefined }}>{s.note}</div> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default ApprovalTimeline
