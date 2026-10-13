'use client'
import { useRouter } from 'next/navigation'
import React from 'react'

/** Clicks on these (or inside them) keep their own behaviour instead of opening the row. */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, details, dialog, [role="button"], [role="dialog"], [data-pk-row-ignore]'

/**
 * Pure part (unit-tested): does a click on `target` open the row? Not when it hit an interactive element of the
 * row, nor when it came from outside the row's DOM (React bubbles events of a portalled dialog to the row).
 */
export function opensRow(target: Element | null, row: Element): boolean {
  if (!target || !row.contains(target)) return false
  const hit = target.closest(INTERACTIVE)
  return !hit || !row.contains(hit)
}

/**
 * DRMS 13/10 Persetujuan #1 (and Umum #7 for the custom tables): a table row that opens `href` on click and on
 * Enter (the row is focusable), with a pointer cursor. Links, buttons and dialogs inside the row keep working;
 * a click that ends a text selection does not navigate; Ctrl/⌘/middle click opens a new tab like a link.
 */
export function ClickableRow({ href, children, ...rest }: { href: string; children: React.ReactNode } & Omit<React.HTMLAttributes<HTMLTableRowElement>, 'onClick' | 'onAuxClick' | 'onKeyDown' | 'tabIndex'>) {
  const router = useRouter()
  const open = (newTab: boolean) => (newTab ? window.open(href, '_blank', 'noopener') : router.push(href))
  return (
    <tr
      {...rest}
      tabIndex={0}
      data-pk-row-link={href}
      style={{ cursor: 'pointer', ...rest.style }}
      onClick={(e) => {
        if (!opensRow(e.target as Element, e.currentTarget)) return
        if (window.getSelection()?.toString()) return
        open(e.ctrlKey || e.metaKey)
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && opensRow(e.target as Element, e.currentTarget)) open(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault()
          open(e.ctrlKey || e.metaKey)
        }
      }}
    >
      {children}
    </tr>
  )
}

export default ClickableRow
