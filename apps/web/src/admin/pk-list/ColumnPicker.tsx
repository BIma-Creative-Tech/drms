'use client'

import { useRouter } from 'next/navigation'
import React, { useEffect, useId, useRef, useState } from 'react'

import { ROW_ACTIONS_FIELD } from '@/admin/row-actions'

import { columnsParam, nextVisible } from './query'

type Props = {
  slug: string
  /** Columns the caller may show, in the collection's field order. */
  columns: ReadonlyArray<{ name: string; label: string }>
  /** Currently visible (in order, without "Aksi"). */
  visible: readonly string[]
  /** The collection's default set (admin.defaultColumns). */
  defaults: readonly string[]
  /** Every column name of the collection (the saved preference lists all of them, like Payload's own). */
  all: readonly string[]
}

/**
 * DRMS 13/10 Umum #5: "Kolom ▾" — a checklist dropdown of the list's columns (instead of Payload's column pills).
 * "Terapkan" saves the choice per user and collection in Payload's preferences (`collection-<slug>` →
 * `columns`, the record Payload's own list and the MC4 / row-actions migrations use; it follows the user
 * across browsers and devices, unlike localStorage). It is saved the way Payload's own column toggle does:
 * the list URL gets `columns=["code","-name",…]` and the list route upserts the preference on the server
 * (renderListView) before PkListView renders — a direct POST to /api/payload-preferences would be overwritten
 * by the stale `columns` that Payload's ListQueryProvider writes into the URL. "Default" restores the
 * collection's defaultColumns. "Aksi" is always shown (not in the list).
 * Keyboard: Escape closes (focus back on the button); every control is a native checkbox/button.
 */
export function ColumnPicker({ slug, columns, visible, defaults, all }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [ticked, setTicked] = useState<string[]>([...visible])
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const current = visible.join(',')
  // saved (list re-rendered with the new columns): the ticks follow
  const [seen, setSeen] = useState(current)
  if (seen !== current) {
    setSeen(current)
    setTicked(current ? current.split(',') : [])
  }

  const close = (focus: boolean) => {
    setOpen(false)
    setTicked(current ? current.split(',') : [])
    if (focus) btnRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setTicked(current ? current.split(',') : [])
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, current])

  const apply = () => {
    const vis = nextVisible(visible, ticked, columns.map((c) => c.name))
    if (vis.length === 0) return
    const url = new URL(window.location.href)
    url.searchParams.set('columns', columnsParam([...vis, ROW_ACTIONS_FIELD], all))
    setOpen(false)
    btnRef.current?.focus()
    router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false })
  }

  return (
    <div
      ref={rootRef}
      className="pk-ms pk-ms--cols"
      data-pk-multi="kolom"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault()
          close(true)
        }
      }}
    >
      <button ref={btnRef} type="button" className="pk-ltb__btn pk-ms__colbtn" aria-expanded={open} aria-controls={panelId} aria-haspopup="true" onClick={() => (open ? close(false) : setOpen(true))} data-pk-columns={slug}>
        Kolom <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div id={panelId} className="pk-ms__panel pk-ms__panel--end" role="group" aria-label="Kolom yang ditampilkan">
          <ul className="pk-ms__list">
            {columns.map((c, i) => (
              <li key={c.name}>
                <label className="pk-ms__opt">
                  <input
                    type="checkbox"
                    checked={ticked.includes(c.name)}
                    onChange={() => setTicked((t) => (t.includes(c.name) ? t.filter((x) => x !== c.name) : [...t, c.name]))}
                    autoFocus={i === 0}
                  />
                  <span>{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="pk-ms__foot">
            <button type="button" className="pk-ltb__btn pk-ltb__btn--ghost" onClick={() => setTicked([...defaults])}>
              Default
            </button>
            <button type="button" className="pk-ltb__btn pk-ltb__btn--primary" onClick={apply} disabled={ticked.length === 0}>
              Terapkan
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default ColumnPicker
