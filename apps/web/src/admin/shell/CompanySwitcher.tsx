'use client'

import { AnimatePresence, motion } from 'motion/react'
import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '@/admin/modules/Icon'

import { allState, canApply, requestBody, selectionDescription, switcherLabel, toggleAll, toggleCompany, type SwitcherState } from './company-switcher'

/**
 * PT switcher in the module bar (MC2-4, ADR 0016 §5, wireframe mc/wireframes.md §1a), left of the
 * bell. One membership → the PT code as plain text (nothing to choose). Several → a button that
 * opens a small dialog: "Semua PT saya" (tri-state) + one native checkbox per PT (code, name, the
 * user's roles THERE), Terapkan / Batal. Terapkan → POST /api/v1/me/companies (server sets the
 * HttpOnly cookie, re-validated against the memberships on every request) → full reload so every
 * server-rendered view, list and count re-reads the selection. At least one PT must stay checked.
 * Keyboard: Enter/Space/↓ opens, ↑/↓ move between the checkboxes, Space toggles, Esc cancels and
 * returns focus to the button. ≤ 768px: bottom sheet with a scrim (CSS .pk-pt__panel).
 */

const EASE = [0.22, 1, 0.36, 1] as const

export function CompanySwitcher({ state, open, setOpen, compact }: { state: SwitcherState; open: boolean; setOpen: (v: boolean) => void; compact: boolean }) {
  const { options, selected } = state
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const allBox = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<number[]>(selected)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openedFor, setOpenedFor] = useState(false)
  // ≤ 768px: bottom sheet portalled to <body> (the bar's backdrop-filter would contain a fixed panel)
  const [sheet, setSheet] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const on = () => setSheet(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // reset the draft each time the dialog opens (state adjusted during render, no effect)
  if (open !== openedFor) {
    setOpenedFor(open)
    if (open) {
      setDraft(selected)
      setError(null)
    }
  }

  const tri = allState(options, draft)
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = tri === 'some'
  }, [tri, open])
  useEffect(() => {
    if (open) requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus())
  }, [open])

  if (options.length === 0) return null
  const label = switcherLabel(options, selected, compact)
  const desc = selectionDescription(options, selected)

  if (options.length === 1) {
    const only = options[0]!
    return (
      <span className="pk-pt pk-pt--static" title={`${only.shortCode} — ${only.name}`} data-pk-pt-switcher="static">
        <Icon name="project" size={16} />
        <span className="pk-pt__text">{label}</span>
      </span>
    )
  }

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }

  const apply = async () => {
    if (!canApply(options, draft, selected) || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/me/companies', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(options, draft)),
      })
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { detail?: string } | null
        setError(p?.detail ?? `Gagal menyimpan pilihan PT (${res.status}).`)
        setBusy(false)
        return
      }
      window.location.reload()
    } catch {
      setError('Gagal menghubungi server. Coba lagi.')
      setBusy(false)
    }
  }

  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const boxes = Array.from(panel.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])
    const i = boxes.indexOf(document.activeElement as HTMLInputElement)
    if (i < 0) return
    e.preventDefault()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? boxes.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + boxes.length) % boxes.length
    boxes[next]?.focus()
  }

  const applyOk = canApply(options, draft, selected)
  const inside = (n: Node | null) => !!n && (!!panel.current?.contains(n) || !!btn.current?.contains(n))
  const onSheetBlur = (e: React.FocusEvent) => {
    if (e.relatedTarget && !inside(e.relatedTarget as Node)) setOpen(false)
  }
  const panelNode = (
    <motion.div
      key="panel"
      ref={panel}
      id={id}
      className={sheet ? 'pk-bar__menu pk-pt__panel pk-pt__panel--sheet' : 'pk-bar__menu pk-pt__panel'}
      role="dialog"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-h`}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.16, ease: EASE } }}
      exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
      onKeyDown={onKeys}
      data-pk-pt-panel
    >
      <div className="pk-pt__title" id={`${id}-t`}>
        Tampilkan data PT
      </div>
      <p className="pk-pt__hint" id={`${id}-h`}>
        Daftar, antrian, dasbor dan laporan memakai PT yang dicentang. Membuat dan menyetujui dokumen selalu mengikuti PT dokumen itu.
      </p>
      <label className="pk-pt__opt pk-pt__opt--all">
        <input ref={allBox} type="checkbox" checked={tri === 'all'} onChange={() => setDraft(toggleAll(options, draft))} data-pk-pt-all />
        <span className="pk-pt__name">Semua PT saya ({options.length})</span>
      </label>
      <div role="group" aria-label="PT" className="pk-pt__list">
        {options.map((o) => (
          <label key={o.id} className="pk-pt__opt">
            <input type="checkbox" checked={draft.includes(o.id)} onChange={() => setDraft(toggleCompany(options, draft, o.id))} data-pk-pt-option={o.shortCode} />
            <span className="pk-pt__code">{o.shortCode}</span>
            <span className="pk-pt__name">{o.name}</span>
            <span className="pk-pt__roles">{o.roles.join(' · ') || 'tanpa peran'}</span>
          </label>
        ))}
      </div>
      {draft.length === 0 ? (
        <p className="pk-pt__msg" role="status">
          Centang minimal satu PT.
        </p>
      ) : null}
      {error ? (
        <p className="pk-pt__msg" data-tone="bad" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pk-pt__actions">
        <button type="button" className="pk-pt__btn pk-pt__btn--primary" disabled={!applyOk || busy} onClick={() => void apply()} data-pk-pt-apply>
          {busy ? 'Menerapkan…' : 'Terapkan'}
        </button>
        <button type="button" className="pk-pt__btn" onClick={() => close(true)}>
          Batal
        </button>
      </div>
    </motion.div>
  )
  return (
    <div
      className="pk-bar__dd pk-bar__dd--end pk-pt-dd"
      data-open={open || undefined}
      onBlur={(e) => {
        // focus leaving the switcher (Tab / click elsewhere) = Batal; the mobile scrim stays inside
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node) && !inside(e.relatedTarget as Node)) setOpen(false)
      }}
    >
      <button
        ref={btn}
        type="button"
        className="pk-pt"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Pilih PT. ${desc}`}
        title={desc}
        data-pk-pt-switcher="button"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <Icon name="project" size={16} />
        <span className="pk-pt__text">{label}</span>
        <Icon name="chevronDown" size={14} className="pk-bar__chev" />
      </button>
      <AnimatePresence>{open && !sheet ? panelNode : null}</AnimatePresence>
      {sheet && typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <div className="pk-bar__dd pk-pt-sheet" data-open onBlur={onSheetBlur}>
                  <motion.div className="pk-pt__scrim" aria-hidden="true" onClick={() => close(true)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                  {panelNode}
                </div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  )
}
