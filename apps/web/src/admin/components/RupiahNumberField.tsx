'use client'
import { FieldDescription, FieldError, FieldLabel, useField } from '@payloadcms/ui'
import type { NumberFieldClientComponent } from 'payload'
import React, { useEffect } from 'react'

import { formatRupiah } from '@/lib/money'
import { groupRupiah, parseRupiah, type RupiahOptions } from '@/lib/rupiah-input'

import { RupiahInput, useRupiah } from './RupiahInput'

const OPTS: RupiahOptions = { allowZero: true }
/** "Rp" prefix inside the input (same rules as KAS_STYLE .pk-money, without the rest of the Kas styles). */
const MONEY_STYLE = `.pk-money{position:relative}.pk-money>span{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--pk-muted-fg);pointer-events:none}.pk-money>input{padding-left:36px;font-variant-numeric:tabular-nums}`

/**
 * DRMS 10/10 8c (WA-02): integer Rupiah `number` fields of the Payload forms (expense lines: harga
 * satuan, total) with the shared "Rp 1.250.000" input (RupiahInput / lib/rupiah-input — the same
 * parser as Kas and Addendum). A valid text is stored as the integer; an invalid text is kept in the
 * form as typed so Payload's number validation refuses the save (nothing is dropped silently) while
 * the inline Indonesian error explains why. Read-only values are shown formatted.
 */
export const RupiahNumberField: NumberFieldClientComponent = ({ field, path: pathProp, readOnly: readOnlyProp }) => {
  const path = pathProp ?? field.name
  const { value, setValue, showError } = useField<number | string | null>({ path })
  const readOnly = readOnlyProp || field.admin?.readOnly === true
  const r = useRupiah(typeof value === 'number' ? value : null, OPTS)
  const id = `field-${path.replace(/\./g, '__')}`

  // External changes (row moved / form reset after save) → show the stored integer again.
  useEffect(() => {
    if (typeof value === 'number' && value !== r.parsed.value) r.onChange(value > 0 ? groupRupiah(value) : value === 0 ? '0' : '')
    else if ((value === null || value === undefined) && r.parsed.value !== null) r.onChange('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the stored value
  }, [value])

  if (readOnly) {
    return (
      <div className="field-type number read-only" data-pk-rupiah={path} style={{ marginBottom: 'var(--spacing-field, 16px)' }}>
        <FieldLabel label={field.label} path={path} />
        <div style={{ padding: '6px 0', fontVariantNumeric: 'tabular-nums' }}>{typeof value === 'number' ? formatRupiah(value) : '—'}</div>
      </div>
    )
  }
  const bound = {
    ...r,
    onChange: (text: string) => {
      r.onChange(text)
      const p = parseRupiah(text, OPTS)
      setValue(p.error ? text : p.value)
    },
  }
  const errId = `${id}-err`
  return (
    <div className={['field-type', 'number', showError || r.error ? 'error' : null].filter(Boolean).join(' ')} data-pk-rupiah={path}>
      <style>{MONEY_STYLE}</style>
      <FieldLabel label={field.label} path={path} required={field.required} />
      <div className="field-type__wrap">
        <FieldError path={path} showError={showError && !r.error} />
        <RupiahInput id={id} name={path} field={bound} invalid={Boolean(r.error) || showError} describedBy={r.error ? errId : undefined} required={field.required} />
        {r.error ? (
          <span id={errId} role="alert" style={{ display: 'block', color: 'var(--theme-error-500)', fontSize: 12, marginTop: 4 }}>
            {r.error}
          </span>
        ) : null}
        <FieldDescription description={field.admin?.description} path={path} />
      </div>
    </div>
  )
}

export default RupiahNumberField
