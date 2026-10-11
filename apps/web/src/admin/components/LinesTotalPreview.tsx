'use client'
import { useFormFields } from '@payloadcms/ui'
import React from 'react'

import { formatRupiah } from '@/lib/money'

import { sumLineTotals } from './lines-total'

/**
 * DRMS 10/10 8i: "Total (pratinjau)" under the line cards of the create / draft form — the APK draft
 * editor shows the same preview. Display only: the grand total is computed by the server from the
 * line totals at save (US-03).
 */
export function LinesTotalPreview() {
  // primitive selector result → re-render only when the sum or the row count changes
  const key = useFormFields(([fields]) => {
    const s = sumLineTotals(fields as Record<string, { value?: unknown }>)
    return `${s.total}|${s.rows}`
  })
  const [total, rows] = key.split('|').map(Number) as [number, number]
  return (
    <div className="field-type" data-pk-total-preview={total} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, padding: '10px 12px', border: '1px solid var(--theme-elevation-150)', borderRadius: 4, marginBottom: 'var(--spacing-field, 16px)' }}>
      <strong>Total (pratinjau)</strong>
      <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatRupiah(total)}</span>
      <span style={{ fontSize: 12, color: 'var(--theme-elevation-600)' }}>
        {rows} baris · nilai final dihitung server saat disimpan.
      </span>
    </div>
  )
}

export default LinesTotalPreview
