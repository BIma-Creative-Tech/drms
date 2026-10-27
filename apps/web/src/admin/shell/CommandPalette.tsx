'use client'

import { useRouter } from 'next/navigation'
import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '@/admin/modules/Icon'

import { searchNav, type NavEntry } from './nav-search'

/**
 * D2510: menu search (topbar "Cari menu", Ctrl+K / ⌘K) — a modal combobox over the caller's sidebar items
 * (nav-search.ts, no API call). ↑/↓ moves, Enter opens, Esc / backdrop closes and returns focus to the trigger.
 * Portalled into <body>: the glass top bar's backdrop-filter would clip a fixed overlay (same as PrivacyGate).
 */
export function CommandPalette({ entries, onClose }: { entries: NavEntry[]; onClose: () => void }) {
  const router = useRouter()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const hits = useMemo(() => searchNav(entries, q), [entries, q])
  const active = Math.min(sel, Math.max(hits.length - 1, 0))

  // mounted only while open (ModuleBar): focus the field, no page scroll behind the dialog
  useEffect(() => {
    requestAnimationFrame(() => input.current?.focus())
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  if (typeof document === 'undefined') return null

  const go = (e: NavEntry | undefined) => {
    if (!e) return
    onClose()
    router.push(e.href)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = hits.length || 1
      setSel((active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(hits[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return createPortal(
    <div className="pk-cmd" data-pk-cmd onKeyDown={onKey}>
      <div className="pk-cmd__backdrop" aria-hidden="true" onClick={onClose} />
      <div className="pk-cmd__dialog" role="dialog" aria-modal="true" aria-label="Cari menu">
        <div className="pk-cmd__field">
          <Icon name="search" size={18} />
          <input
            ref={input}
            className="pk-cmd__input"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={hits.length ? `${id}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder="Cari menu… (mis. pengajuan, kas, absensi)"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="pk-cmd__kbd">Esc</kbd>
        </div>
        <ul id={`${id}-list`} className="pk-cmd__list" role="listbox" aria-label="Hasil">
          {hits.map((h, i) => (
            <li
              key={h.key}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className="pk-cmd__opt"
              data-mod={h.mod}
              data-pk-cmd-opt={h.href}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(h)}
            >
              <span className="pk-cmd__chip" aria-hidden="true">
                <Icon name={h.icon} size={16} />
              </span>
              <span className="pk-cmd__text">
                <span className="pk-cmd__label">{h.label}</span>
                <span className="pk-cmd__path">{h.section ? `${h.moduleLabel} › ${h.section}` : h.moduleLabel}</span>
              </span>
              {h.badge ? <span className="pk-side__count">{h.badge > 99 ? '99+' : h.badge}</span> : null}
            </li>
          ))}
          {hits.length ? null : <li className="pk-cmd__empty">Tidak ada menu yang cocok.</li>}
        </ul>
      </div>
    </div>,
    document.body,
  )
}

export default CommandPalette
