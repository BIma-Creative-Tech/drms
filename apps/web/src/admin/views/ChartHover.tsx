'use client'

import React, { useCallback, useRef, useState } from 'react'

/**
 * Hover/focus tooltip layer of the Beranda charts (dataviz: "tooltips enhance, never gate" —
 * every value is also in the chart's table view). Server-rendered marks carry
 * `data-tip='{"t": title, "r": [[label, value, seriesKey], …]}'`; this wrapper listens for
 * pointer and keyboard focus on them and shows one tooltip. Text is rendered by React (escaped),
 * never via innerHTML. No inline <script> (CSP): Next bundles this file as a normal chunk.
 */
type Tip = { t: string; r: Array<[string, string, string?]> }
type Shown = Tip & { x: number; y: number; flip: boolean }

function parse(el: Element | null): Tip | null {
  const raw = el?.getAttribute('data-tip')
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Tip
    return typeof v?.t === 'string' && Array.isArray(v.r) ? v : null
  } catch {
    return null
  }
}

export function ChartHover({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Shown | null>(null)

  const show = useCallback((target: EventTarget | null, point?: { x: number; y: number }) => {
    const el = target instanceof Element ? target.closest('[data-tip]') : null
    const host = root.current
    const t = parse(el)
    if (!el || !host || !t || !host.contains(el)) return setTip(null)
    const box = host.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const x = (point?.x ?? r.left + r.width / 2) - box.left
    const y = (point?.y ?? r.top) - box.top
    setTip({ ...t, x, y, flip: x > box.width * 0.62 })
  }, [])

  return (
    <div
      ref={root}
      className="pk-hover-root"
      onPointerMove={(e) => show(e.target, { x: e.clientX, y: e.clientY })}
      onPointerLeave={() => setTip(null)}
      onFocus={(e) => show(e.target)}
      onBlur={() => setTip(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setTip(null)
      }}
    >
      {children}
      {tip ? (
        <div className={`pk-tip${tip.flip ? ' flip' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <div className="pk-tip-t">{tip.t}</div>
          {tip.r.map(([label, value, key], i) => (
            <div className="pk-tip-r" key={i}>
              {key ? <i className={`k ${key}`} aria-hidden /> : null}
              <b>{value}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
