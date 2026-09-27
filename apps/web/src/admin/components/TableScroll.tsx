import React from 'react'

/**
 * Wide table → scrolls inside its own box (never the page; 390px audit 2026-09-27), with edge
 * shadows as the "more →" affordance (custom.scss .pk-tscroll). Focusable named region so keyboard
 * users can scroll it (WCAG 2.1.1 / axe scrollable-region-focusable).
 */
export function TableScroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pk-tscroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  )
}

export default TableScroll
