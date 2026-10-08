'use client'
import { FieldLabel, useField } from '@payloadcms/ui'
import type { DateFieldClientProps } from 'payload'
import React from 'react'

import { formatServerTimestamp } from '@/lib/server-time'

/**
 * QA-25: read-only server timestamps (submittedAt, decidedAt, …) shown as fixed company-TZ text
 * ("8 Okt 2026 14:30 WITA") instead of Payload's date picker, which formats in the SERVER timezone
 * during SSR and in the BROWSER timezone after hydration (React #418 for a browser outside WITA).
 */
export function ServerTimeField({ field, path }: DateFieldClientProps) {
  const p = path ?? field.name
  const { value } = useField<string>({ path: p })
  return (
    <div className="field-type date-time-field read-only" data-pk-server-time={p} style={{ marginBottom: 'var(--spacing-field, 16px)' }}>
      <FieldLabel label={field.label} path={p} />
      <div style={{ padding: '6px 0', fontVariantNumeric: 'tabular-nums' }}>{formatServerTimestamp(value)}</div>
    </div>
  )
}

export default ServerTimeField
