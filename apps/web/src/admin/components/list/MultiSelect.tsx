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

/** Button text: "Semua" (nothing or every option selected — D2410), the one label, or "2 dipilih". Pure, unit-tested. */
export function multiSummary(options: ReadonlyArray<MultiOption>, selected: readonly string[], allLabel = 'Semua'): string {
  if (selected.length === 0 || isEveryOption(options, selected)) return allLabel
  if (selected.length === 1) return options.find((o) => o.value === selected[0])?.label ?? selected[0]!
  return `${selected.length} dipilih`
}

const isEveryOption = (options: ReadonlyArray<MultiOption>, selected: readonly string[]) => options.length > 0 && options.every((o) => selected.includes(o.value))

/**
 * D2410 (point 7) filter mode: the ticks shown for an applied filter — no filter (empty) = EVERY option ticked ("Semua").
 * Pure, unit-tested.
 */
export function filterTicks(options: ReadonlyArray<MultiOption>, applied: readonly string[]): string[] {
  return applied.length === 0 ? options.map((o) => o.value) : [...applied]
}

/**
 * D2410 filter mode: the value to apply for the ticks, in option order — every option ticked (or none) = no filter
 * (empty → the parameter is sent as ''). Pure, unit-tested.
 */
export function filterValue(options: ReadonlyArray<MultiOption>, ticks: readonly string[]): string[] {
  const picked = options.map((o) => o.value).filter((v) => ticks.includes(v))
  return picked.length === options.length ? [] : picked
}

/** Tri-state of the "Semua" box (like the PT switcher's "Semua PT saya"). Pure, unit-tested. */
export function tickState(options: ReadonlyArray<MultiOption>, ticks: readonly string[]): 'all' | 'some' | 'none' {
  const n = options.filter((o) => ticks.includes(o.value)).length
  return n === 0 ? 'none' : n === options.length ? 'all' : 'some'
}

/**
 * DRMS 13/10 Umum #4 / #5 / Persetujuan #2: the checklist dropdown of every table filter — pick several values per
 * criterion. A button (aria-expanded) opens a panel with one checkbox per value (+ a search box from 8 values),
 * "Semua" and "Terapkan" (submit the enclosing GET form). Escape / a click outside closes and discards
 * unapplied ticks; focus returns to the button. Lives inside ListToolbar / the PkListView filter bar.
 * D2410 (user 2026-10-24, point 7): no filter = every option ticked; "Semua" is a tri-state box above the options (as
 * the PT switcher) that ticks every option (or clears them); every option ticked — or none — applies as no filter ('').
 * Form mode ("Kosongkan") is unchanged.
 */
export function MultiSelect({ name, label, options, value, allLabel = 'Semua', testKey, onChange, disabled, invalid }: Props) {
  const live = onChange !== undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>(() => (live ? [...value] : filterTicks(options, value)))
  const [needle, setNeedle] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const hiddenRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const applied = value.join(',')
  // D2410: the ticks of the applied value (no filter = every option ticked)
  const ticksOf = (v: string) => filterTicks(options, v ? v.split(',') : [])
  // the URL changed (applied here, elsewhere or Reset): the ticks follow it (state derived during render)
  const [seen, setSeen] = useState(applied)
  if (seen !== applied) {
    setSeen(applied)
    setDraft(ticksOf(applied))
  }

  const close = (restoreFocus: boolean) => {
    setOpen(false)
    setNeedle('')
    setDraft(ticksOf(applied))
    if (restoreFocus) btnRef.current?.focus()
  }

  // a click outside the dropdown closes it (unapplied ticks discarded)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setNeedle('')
        setDraft(filterTicks(options, applied ? applied.split(',') : []))
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, applied, options])

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
  // D2410: a filter naming every option is no filter (an old link) — not marked active, no count
  const filtering = value.length > 0 && (live || !isEveryOption(options, value))
  const tri = tickState(options, draft)
  const allBox = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = tri === 'some'
  }, [tri, open])

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
        data-active={filtering ? 'true' : undefined}
        data-pk-multi-mode={live ? 'form' : undefined}
        disabled={disabled}
        data-invalid={invalid || undefined}
        onClick={() => (open ? close(false) : openPanel())}
      >
        <span className="pk-ms__value">{summary}</span>
        {value.length > 1 && !live && filtering ? <span className="pk-ms__count" aria-hidden="true">{value.length}</span> : null}
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
          {live ? null : (
            <label className="pk-ms__opt pk-ms__all">
              <input
                ref={allBox}
                type="checkbox"
                checked={tri === 'all'}
                onChange={() => setDraft(tri === 'all' ? [] : options.map((o) => o.value))}
                autoFocus={options.length < SEARCH_FROM}
                data-pk-multi-all
              />
              <span>{allLabel}</span>
            </label>
          )}
          <ul className="pk-ms__list">
            {shown.map((o, i) => (
              <li key={o.value}>
                <label className="pk-ms__opt" title={o.title}>
                  <input type="checkbox" checked={ticked.includes(o.value)} onChange={() => toggle(o.value)} autoFocus={live && options.length < SEARCH_FROM && i === 0} data-pk-multi-opt={o.value} />
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
              <button type="button" className="pk-ltb__btn pk-ltb__btn--primary" onClick={() => apply(filterValue(options, draft))}>
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
