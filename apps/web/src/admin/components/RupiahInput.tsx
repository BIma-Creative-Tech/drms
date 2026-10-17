'use client'
import React, { useState } from 'react'

import { groupRupiah, isImmediateRupiahError, parseRupiah, type RupiahOptions, type RupiahParsed } from '@/lib/rupiah-input'

/**
 * QA-03 / QA-12: the shared Rupiah field of the admin forms (Kas masuk/keluar, Addendum RAB). The text
 * stays exactly as typed — nothing is dropped — and is validated by lib/rupiah-input: a comma, a minus
 * or any other character shows an inline Indonesian error at once; a malformed thousands group or 0
 * after leaving the field or on submit. A valid amount is regrouped ("1250000" → "1.250.000") on blur.
 * The form must call `touch()` on submit and refuse to send while `parsed.error` is set.
 */
export function useRupiah(initial: number | null = null, opts: RupiahOptions = {}) {
  const [text, setText] = useState(initial !== null && initial > 0 ? groupRupiah(initial) : '')
  const [touched, setTouched] = useState(false)
  const parsed: RupiahParsed = parseRupiah(text, opts)
  const error = parsed.code && (touched || isImmediateRupiahError(parsed.code)) ? parsed.error : null
  return {
    text,
    parsed,
    /** Error to show now (null while typing a not-yet-complete group). */
    error,
    onChange: (v: string) => {
      setText(v)
      setTouched(false)
    },
    onBlur: () => {
      setTouched(true)
      if (!parsed.error && parsed.value !== null) setText(groupRupiah(parsed.value))
    },
    /** Submit: show every error of the current text. */
    touch: () => setTouched(true),
  }
}

export type RupiahField = ReturnType<typeof useRupiah>

export function RupiahInput({
  id,
  field,
  name,
  describedBy,
  invalid,
  testId,
  required,
  disabled,
}: {
  id: string
  field: RupiahField
  name?: string
  describedBy?: string
  invalid?: boolean
  testId?: string
  required?: boolean
  disabled?: boolean
}) {
  return (
    <div className="pk-money">
      <span aria-hidden>Rp</span>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={field.text}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
        // UI feedback 17/10 #1: no placeholder — the "Rp" prefix already marks the money field
        maxLength={24}
        required={required}
        disabled={disabled}
        aria-invalid={invalid || field.error ? true : undefined}
        aria-describedby={describedBy}
        data-pk-field={testId}
      />
    </div>
  )
}

export default RupiahInput
