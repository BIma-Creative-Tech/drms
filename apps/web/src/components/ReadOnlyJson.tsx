'use client'
import { FieldLabel, useField } from '@payloadcms/ui'
import type { JSONFieldClientComponent } from 'payload'
import React from 'react'

/**
 * Read-only renderer for `json` fields. Payload's default JSON field loads the Monaco editor from
 * cdn.jsdelivr.net (@payloadcms/ui CodeEditor), which the nonce-strict CSP blocks (user decision
 * 2026-09-23: no json/code editors in the admin). Audit values are stored wrapped as `{ v: … }`.
 * React escapes the text; no HTML is injected.
 */
function jsonText(value: unknown): string {
  const unwrapped =
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && 'v' in value
      ? (value as { v: unknown }).v
      : value
  return unwrapped === undefined || unwrapped === null ? '—' : JSON.stringify(unwrapped, null, 2)
}

export const ReadOnlyJson: JSONFieldClientComponent = ({ field, path }) => {
  const { value } = useField<unknown>({ path })
  const text = jsonText(value)
  return (
    <div className="field-type pk-readonly-json">
      <FieldLabel label={field?.label} path={path} />
      <pre className="pk-readonly-json__value">{text}</pre>
    </div>
  )
}

/**
 * DRMS 10/10 9c: technical JSON (e.g. the approval rule snapshot) folded into a closed <details> —
 * the readable version is shown elsewhere (approval timeline); the raw value stays for Admin support.
 */
export const CollapsedReadOnlyJson: JSONFieldClientComponent = ({ field, path }) => {
  const { value } = useField<unknown>({ path })
  return (
    <details className="field-type pk-readonly-json" data-pk-raw-json={path}>
      <summary style={{ cursor: 'pointer', fontSize: 13 }}>{typeof field?.label === 'string' ? field.label : path} (data teknis)</summary>
      <pre className="pk-readonly-json__value">{jsonText(value)}</pre>
    </details>
  )
}

export default ReadOnlyJson
