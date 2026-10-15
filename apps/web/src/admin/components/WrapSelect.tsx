'use client'
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'

/**
 * DRMS 16/10 (owner: "pilihan dari dropdown master data yang sangat panjang … dibuat text wrap"): a native `<select>`
 * whose chosen option is shown WRAPPED instead of cut off at the box edge. The select itself stays the control
 * (keyboard, mobile picker, screen readers, `name`/`data-*` hooks, form posts) and keeps its own box (border,
 * background, arrow) from the surrounding styles; only its own one-line text is hidden and the full label is drawn on
 * top of it (`aria-hidden`), with the select's padding and font. The box keeps its width and height until the label
 * needs a second line, then the select grows with it. Same props as `<select>`; `wrapStyle` styles the wrapper
 * (e.g. a max width that used to sit on the select).
 */
type Props = React.SelectHTMLAttributes<HTMLSelectElement> & { wrapStyle?: React.CSSProperties }

const STYLE = `
.pk-wsel { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; max-width: 100%; }
.pk-wsel > select, .pk-wsel > .pk-wsel__face { grid-area: 1 / 1; }
.pk-wsel > select { width: 100%; max-width: 100%; min-width: 0; }
.pk-wsel > select :is(option, optgroup) { -webkit-text-fill-color: currentColor; }
.pk-wsel__face { position: relative; z-index: 1; align-self: start; box-sizing: border-box; display: flex; align-items: center; pointer-events: none; white-space: normal; overflow-wrap: anywhere; text-align: start; }
`

/** Room for the select's own arrow at the end of the box. */
const ARROW = 24

export function WrapSelect({ wrapStyle, onChange, children, ...rest }: Props) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const selRef = useRef<HTMLSelectElement>(null)
  const faceRef = useRef<HTMLSpanElement>(null)
  const [label, setLabel] = useState('')

  // the face copies the select's text metrics (padding + border, font, colour) so the label sits where the select's
  // own text would; the select's own text is hidden (text fill, its `color` untouched) only here on the client — the
  // server HTML shows the plain select until hydration. The select is then made as tall as the (possibly wrapped)
  // label.
  const fit = useCallback(() => {
    const sel = selRef.current
    const face = faceRef.current
    if (!sel || !face) return
    setLabel(sel.selectedOptions[0]?.text ?? '')
    sel.style.height = ''
    sel.style.setProperty('-webkit-text-fill-color', 'transparent')
    const natural = sel.offsetHeight
    const cs = getComputedStyle(sel)
    const px = (v: string) => parseFloat(v) || 0
    face.style.color = cs.color
    face.style.paddingTop = `${px(cs.borderTopWidth) + px(cs.paddingTop)}px`
    face.style.paddingBottom = `${px(cs.borderBottomWidth) + px(cs.paddingBottom)}px`
    face.style.paddingInlineStart = `${px(cs.borderLeftWidth) + px(cs.paddingLeft)}px`
    face.style.paddingInlineEnd = `${px(cs.borderRightWidth) + px(cs.paddingRight) + ARROW}px`
    face.style.fontFamily = cs.fontFamily
    face.style.fontSize = cs.fontSize
    face.style.fontWeight = cs.fontWeight
    face.style.fontStyle = cs.fontStyle
    face.style.lineHeight = cs.lineHeight === 'normal' ? '1.3' : cs.lineHeight
    face.style.letterSpacing = cs.letterSpacing
    face.style.minHeight = `${natural}px`
    const h = face.offsetHeight
    if (h > natural) sel.style.height = `${h}px`
  }, [])

  // every render (controlled value / options changed), width changes, a form reset (uncontrolled selects), the theme
  useLayoutEffect(() => fit())
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const sel = selRef.current
    if (!wrap || !sel) return
    let width = wrap.clientWidth
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (wrap.clientWidth === width) return
      width = wrap.clientWidth
      fit()
    })
    ro?.observe(wrap)
    const form = sel.form
    const onReset = () => requestAnimationFrame(fit)
    form?.addEventListener('reset', onReset)
    // light/dark switch (html[data-theme]) → the copied colour follows
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => fit())
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      ro?.disconnect()
      mo?.disconnect()
      form?.removeEventListener('reset', onReset)
    }
  }, [fit])

  return (
    <span ref={wrapRef} className="pk-wsel" style={wrapStyle}>
      <style href="pk-wrap-select" precedence="default">
        {STYLE}
      </style>
      <select
        {...rest}
        ref={selRef}
        onChange={(e) => {
          onChange?.(e)
          fit()
        }}
      >
        {children}
      </select>
      <span ref={faceRef} className="pk-wsel__face" aria-hidden="true">
        {label}
      </span>
    </span>
  )
}
