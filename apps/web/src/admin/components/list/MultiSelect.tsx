'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'

export type MultiOption = { value: string; label: string; title?: string }

type Props = {
  /** Form field name; the applied values travel as ONE hidden input `name=a,b` (AutoSubmit keeps it on every search). */
  name: string
  /** Visible label of the field (also the accessible name of the button). */
  label: string
  options: ReadonlyArray<MultiOption>
  /** Applied values (from the URL; in form mode the current value). */
  value: readonly string[]
  /** Button text with nothing selected (default "Semua"). */
  allLabel?: string
  /** data-pk-filter-key of the button (e2e / tests). */
  testKey?: string
  /**
   * DRMS 13/10 W3 form mode ("multiple dropdown, bukan checkbox"): a controlled field of a client form instead of a
   * GET filter — every tick calls `onChange` at once (no hidden input, no submit); the footer has "Kosongkan" and
   * "Selesai". The button shows the chosen labels ("Staff, PM").
   */
  onChange?: (values: string[]) => void
  disabled?: boolean
  /** Error state of the button (form mode; the message is the field's error text). */
  invalid?: boolean
}

const SEARCH_FROM = 8

/** Form mode button text: the chosen labels in option order ("Staff, PM"), or `empty`. Pure, unit-tested. */
export function multiLabels(options: ReadonlyArray<MultiOption>, selected: readonly string[], empty: string): string {
  const labels = options.filter((o) => selected.includes(o.value)).map((o) => o.label)
  return labels.length ? labels.join(', ') : empty
}

/** Button text: "Semua", the one label, or "2 dipilih". Pure, unit-tested. */
export function multiSummary(options: ReadonlyArray<MultiOption>, selected: readonly string[], allLabel = 'Semua'): string {
  if (selected.length === 0) return allLabel
  if (selected.length === 1) return options.find((o) => o.value === selected[0])?.label ?? selected[0]!
  return `${selected.length} dipilih`
}

/**
 * DRMS 13/10 Umum #4 / #5 / Persetujuan #2: the checklist dropdown of every table filter — pick several values per
 * criterion. A button (aria-expanded) opens a panel with one checkbox per value (+ a search box from 8 values),
 * "Semua" (clear) and "Terapkan" (submit the enclosing GET form). Escape / a click outside closes and discards
 * unapplied ticks; focus returns to the button. Lives inside ListToolbar / the PkListView filter bar.
 */
export function MultiSelect({ name, label, options, value, allLabel = 'Semua', testKey, onChange, disabled, invalid }: Props) {
  const live = onChange !== undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>([...value])
  const [needle, setNeedle] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const hiddenRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const applied = value.join(',')
  // the URL changed (applied here, elsewhere or Reset): the ticks follow it (state derived during render)
  const [seen, setSeen] = useState(applied)
  if (seen !== applied) {
    setSeen(applied)
    setDraft(applied ? applied.split(',') : [])
  }

  const close = (restoreFocus: boolean) => {
    setOpen(false)
    setNeedle('')
    setDraft(applied ? applied.split(',') : [])
    if (restoreFocus) btnRef.current?.focus()
  }

  // a click outside the dropdown closes it (unapplied ticks discarded)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setNeedle('')
        setDraft(applied ? applied.split(',') : [])
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, applied])

  // form mode: the panel floats (position fixed under the button) so a scrolling table (Akses PT matrix) does not clip
  // it; it closes when the page scrolls or resizes. Phones keep the bottom sheet of the CSS.
  const [float, setFloat] = useState<{ top: number; left: number } | null>(null)
  const openPanel = () => {
    const r = btnRef.current?.getBoundingClientRect()
    setFloat(live && r && window.innerWidth > 640 ? { top: Math.round(r.bottom + 4), left: Math.round(Math.min(r.left, window.innerWidth - 240)) } : null)
    setOpen(true)
  }
  useEffect(() => {
    if (!open || !float) return
    const onMove = (e: Event) => {
      if (e.type === 'scroll' && rootRef.current?.contains(e.target as Node)) return // the option list itself
      setOpen(false)
      setNeedle('')
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, float])

  const shown = useMemo(() => {
    const n = needle.trim().toLocaleLowerCase('id')
    return n ? options.filter((o) => o.label.toLocaleLowerCase('id').includes(n)) : options
  }, [needle, options])

  const apply = (next: string[]) => {
    const input = hiddenRef.current
    if (!input) return
    input.value = next.join(',')
    setOpen(false)
    setNeedle('')
    btnRef.current?.focus()
    input.form?.requestSubmit()
  }

  const toggle = (v: string) => {
    if (onChange) {
      // form mode: option order, applied at once
      const next = value.includes(v) ? value.filter((x) => x !== v) : options.map((o) => o.value).filter((x) => x === v || value.includes(x))
      onChange(next)
      return
    }
    setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]))
  }
  const ticked = live ? value : draft
  const summary = live ? multiLabels(options, value, allLabel) : multiSummary(options, value, allLabel)

  return (
    <div
      ref={rootRef}
      className="pk-ms"
      data-pk-multi={name}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault()
          e.stopPropagation()
          close(true)
        }
      }}
    >
      {live ? null : <input ref={hiddenRef} type="hidden" name={name} defaultValue={applied} key={applied} />}
      <button
        ref={btnRef}
        type="button"
        className="pk-ms__btn"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        aria-label={`${label}: ${summary}`}
        data-pk-filter-key={testKey ?? name}
        data-active={value.length > 0 ? 'true' : undefined}
        data-pk-multi-mode={live ? 'form' : undefined}
        disabled={disabled}
        data-invalid={invalid || undefined}
        onClick={() => (open ? close(false) : openPanel())}
      >
        <span className="pk-ms__value">{summary}</span>
        {value.length > 1 && !live ? <span className="pk-ms__count" aria-hidden="true">{value.length}</span> : null}
        <span className="pk-ms__caret pk-caret" aria-hidden="true" />
      </button>
      {open ? (
        <div id={panelId} className="pk-ms__panel" role="group" aria-label={label} style={float ? { position: 'fixed', top: float.top, left: float.left, right: 'auto', bottom: 'auto' } : undefined}>
          {options.length >= SEARCH_FROM ? (
            <input
              type="search"
              className="pk-ms__search"
              placeholder={`Cari ${label.toLocaleLowerCase('id')}…`}
              aria-label={`Cari pilihan ${label}`}
              value={needle}
              onChange={(e) => setNeedle(e.target.value)}
              // the toolbar's AutoSubmit only listens to named fields; Enter must not submit the form
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault()
              }}
              autoFocus
            />
          ) : null}
          <ul className="pk-ms__list">
            {shown.map((o, i) => (
              <li key={o.value}>
                <label className="pk-ms__opt" title={o.title}>
                  <input type="checkbox" checked={ticked.includes(o.value)} onChange={() => toggle(o.value)} autoFocus={options.length < SEARCH_FROM && i === 0} data-pk-multi-opt={o.value} />
                  <span>{o.label}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 ? <li className="pk-ms__none">Tidak ada pilihan yang cocok.</li> : null}
          </ul>
          {live ? (
            <div className="pk-ms__foot">
              <button type="button" className="pk-ltb__btn pk-ltb__btn--ghost" onClick={() => onChange?.([])} disabled={value.length === 0}>
                Kosongkan
              </button>
              <button type="button" className="pk-ltb__btn pk-ltb__btn--primary" onClick={() => close(true)}>
                Selesai
              </button>
            </div>
          ) : (
            <div className="pk-ms__foot">
              <button type="button" className="pk-ltb__btn pk-ltb__btn--ghost" onClick={() => setDraft([])} disabled={draft.length === 0}>
                {allLabel}
              </button>
              <button type="button" className="pk-ltb__btn pk-ltb__btn--primary" onClick={() => apply(draft)}>
                Terapkan
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default MultiSelect
