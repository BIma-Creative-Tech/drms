'use client'
import { FieldDescription, FieldError, FieldLabel, useField } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import React from 'react'

import { formatDateLong } from '@/pdf/format'

/**
 * DRMS 10/10 8c (WA-01): business dates (company-TZ date, stored as text `YYYY-MM-DD` — no data
 * migration) get the browser's date picker instead of a free text box. `<input type="date">` reads
 * and writes exactly `YYYY-MM-DD`, is keyboard accessible and uses the native picker on phones (like
 * the APK). Read-only values are shown as "12 Oktober 2026". Server validation is unchanged
 * (isBusinessDate + the DB CHECK).
 */
export const BusinessDateField: TextFieldClientComponent = ({ field, path: pathProp, readOnly: readOnlyProp }) => {
  const path = pathProp ?? field.name
  const { value, setValue, showError } = useField<string | null>({ path })
  const readOnly = readOnlyProp || field.admin?.readOnly === true
  const id = `field-${path.replace(/\./g, '__')}`
  const v = typeof value === 'string' ? value : ''
  if (readOnly) {
    return (
      <div className="field-type text read-only" data-pk-business-date={path} style={{ marginBottom: 'var(--spacing-field, 16px)' }}>
        <FieldLabel label={field.label} path={path} />
        <div style={{ padding: '6px 0', fontVariantNumeric: 'tabular-nums' }}>{v ? formatDateLong(v) || v : '—'}</div>
      </div>
    )
  }
  return (
    <div className={['field-type', 'text', showError ? 'error' : null].filter(Boolean).join(' ')} data-pk-business-date={path}>
      <FieldLabel label={field.label} path={path} required={field.required} />
      <div className="field-type__wrap">
        <FieldError path={path} showError={showError} />
        <input
          id={id}
          name={path}
          type="date"
          value={v}
          onChange={(e) => setValue(e.target.value === '' ? null : e.target.value)}
          aria-invalid={showError ? true : undefined}
          style={{ maxWidth: 240 }}
        />
        <FieldDescription description={field.admin?.description} path={path} />
      </div>
    </div>
  )
}

export default BusinessDateField
