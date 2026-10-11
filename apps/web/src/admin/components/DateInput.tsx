'use client'
import React, { useId, useState } from 'react'

import { dateInputHint } from '@/pdf/format'

export type DateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  type?: 'date' | 'datetime-local'
  /** Extra class of the hint (default `pk-date-hint`). */
  hintClassName?: string
}

/**
 * DRMS 10/10 (Lead review h): the browser's native date / datetime picker shows its value in the
 * BROWSER locale (mm/dd/yyyy on an English Chrome, even with `<html lang="id">`), so every native date
 * input carries a helper text "Senin, 12 Oktober 2026" (datetime: "… 14.30") — the date is unambiguous
 * whatever the browser shows. Drop-in for `<input type="date">`: all props pass through (name, min,
 * max, required, disabled, id, data-*); controlled (`value` + `onChange`) and uncontrolled
 * (`defaultValue`, plain GET filter forms — the current value is tracked from the input events). The
 * text is computed from the value string only (pdf/format.ts, no locale / time zone) → no hydration
 * mismatch.
 */
export function DateInput({ type = 'date', hintClassName, value, defaultValue, onChange, onInput, ...rest }: DateInputProps) {
  const hintId = useId()
  const controlled = value !== undefined
  const [own, setOwn] = useState<string>(typeof defaultValue === 'string' ? defaultValue : '')
  const current = controlled ? (typeof value === 'string' ? value : '') : own
  const hint = dateInputHint(type, current)
  const describedBy = [rest['aria-describedby'], hint ? hintId : null].filter(Boolean).join(' ') || undefined
  return (
    <>
      <input
        {...rest}
        type={type}
        {...(controlled ? { value } : { defaultValue })}
        onChange={(e) => {
          if (!controlled) setOwn(e.target.value)
          onChange?.(e)
        }}
        onInput={(e) => {
          if (!controlled) setOwn((e.target as HTMLInputElement).value)
          onInput?.(e)
        }}
        aria-describedby={describedBy}
      />
      {hint ? (
        <small id={hintId} className={hintClassName ?? 'pk-date-hint'} data-pk-date-hint style={{ display: 'block', marginTop: 2, fontSize: 12, fontWeight: 400, lineHeight: 1.3, color: 'var(--theme-elevation-600, #6b7280)' }}>
          {hint}
        </small>
      ) : null}
    </>
  )
}

export default DateInput
