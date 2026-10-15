'use client'
import React, { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * DRMS 16/10 (owner: "kalimat pada kolom grid tidak terpotong"): a one-line free-text field whose long text WRAPS
 * while typing instead of scrolling out of sight — a `<textarea rows=1>` that grows with its text. The value stays one
 * line like `<input type="text">`: Enter never inserts a line break and pasted line breaks become spaces. Enter keeps
 * the input's behaviour: the keydown bubbles as usual (Enter guards inside Payload's document form treat this field
 * as an input — `isMultilineText`), and when nobody prevented it the form is submitted through its submit button
 * (implicit submission). The box keeps the input's width and height until the text needs a second line. Same props
 * as the input it replaces (no `type`).
 */
type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'>

const CLASS = 'pk-wtext'

/** A real multi-line textarea (Enter = new line), i.e. not a WrapText one-line field. */
export const isMultilineText = (t: EventTarget | null): boolean => t instanceof HTMLTextAreaElement && !t.classList.contains(CLASS)

const STYLE = `
textarea.pk-wtext { display: block; resize: none; overflow: hidden; overflow-wrap: anywhere; }
.pk-fld textarea.pk-wtext { min-height: 40px; line-height: 22px; }
@media (pointer: coarse) { .pk-fld textarea.pk-wtext { min-height: 44px; } }
`

const BREAK = /[\r\n]/
const BREAKS = /\r\n|\r|\n/g

function fit(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  const border = el.offsetHeight - el.clientHeight
  el.style.height = `${el.scrollHeight + border}px`
}

export function WrapText({ className, onChange, onKeyDown, onInput, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // controlled value changes (and the first paint) → refit; width changes (dialog / column resize) → refit
  useLayoutEffect(() => fit(ref.current))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      fit(el)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Enter / a typed line break never reaches the value (the native `beforeinput`, before the textarea edits itself)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const block = (e: InputEvent) => {
      if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') e.preventDefault()
    }
    el.addEventListener('beforeinput', block)
    return () => el.removeEventListener('beforeinput', block)
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.target
      if (BREAK.test(el.value)) {
        const at = el.selectionStart
        el.value = el.value.replace(BREAKS, ' ')
        el.setSelectionRange(at, at)
      }
      onChange?.(e)
    },
    [onChange],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(e)
      if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
      // implicit submission of a one-line input, once the keydown has bubbled through every handler: only when none
      // of them prevented it, and only through the form's default (submit) button
      const native = e.nativeEvent
      const form = e.currentTarget.form
      setTimeout(() => {
        if (native.defaultPrevented || !form) return
        const submitter = form.querySelector<HTMLButtonElement | HTMLInputElement>('button[type="submit"], button:not([type]), input[type="submit"]')
        if (submitter && !submitter.disabled) form.requestSubmit(submitter)
      })
    },
    [onKeyDown],
  )

  return (
    <>
      <style href="pk-wrap-text" precedence="default">
        {STYLE}
      </style>
      <textarea
        {...rest}
        ref={ref}
        rows={1}
        className={className ? `${CLASS} ${className}` : CLASS}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onInput={(e) => {
          fit(e.currentTarget) // uncontrolled fields (defaultValue) grow too
          onInput?.(e)
        }}
      />
    </>
  )
}
