'use client'
import { FieldDescription, FieldError, FieldLabel, useField, useFormFields } from '@payloadcms/ui'
import type { RelationshipFieldClientComponent } from 'payload'
import React, { useEffect, useState } from 'react'

import { PICK_COMPANY_FIRST } from './companies/CompanyScopedField'
import { intercompanyOptionLabel, payeesQuery, type PayeeOption } from './intercompany-payee'

const relValue = (v: unknown): number | null => {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'value' in v) return relValue((v as { value: unknown }).value)
  if (v && typeof v === 'object' && 'id' in v) return relValue((v as { id: unknown }).id)
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  return null
}

/**
 * ADR 0028 "PT penerima" of a "PT grup" payment: a filer of PT A cannot read PT B's companies row or cash accounts, so
 * the picker is a plain select over the payee directory (GET /api/v1/intercompany/payees?company=<form PT>: other
 * active PTs with a designated receiving account, masked number). Locked until the form has a PT. A stored PT that is
 * no longer in the directory stays shown ("tidak tersedia") so the filer sees why the submit fails. UI only — the
 * server validates (drafts.ts payeeCompanyErrors).
 */
export const IntercompanyPayeeField: RelationshipFieldClientComponent = ({ field, path: pathProp, readOnly }) => {
  const path = pathProp ?? field.name
  const { value, setValue, showError } = useField<unknown>({ path })
  const company = useFormFields(([f]) => relValue(f.company?.value))
  const selected = relValue(value)
  const url = company === null ? null : payeesQuery(company)
  const [res, setRes] = useState<{ url: string; items: PayeeOption[]; status: 'ok' | 'error' } | null>(null)

  useEffect(() => {
    if (!url) return
    let alive = true
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        const body = (await r.json()) as { items: PayeeOption[] }
        if (alive) setRes({ url, items: body.items, status: 'ok' })
      })
      .catch(() => alive && setRes({ url, items: [], status: 'error' }))
    return () => {
      alive = false
    }
  }, [url])

  const current = res && res.url === url ? res : null
  const items = current?.items ?? []
  const id = `field-${path.replace(/\./g, '__')}`
  const missing = selected !== null && current?.status === 'ok' && !items.some((i) => i.companyId === selected)
  return (
    <div className={['field-type', 'select', showError ? 'error' : null].filter(Boolean).join(' ')} data-pk-intercompany-payee={selected ?? ''}>
      <FieldLabel label={field.label} path={path} required />
      <div className="field-type__wrap">
        <FieldError path={path} showError={showError} />
        <select
          id={id}
          name={path}
          value={selected === null ? '' : String(selected)}
          disabled={readOnly || company === null || !current}
          onChange={(e) => setValue(e.target.value === '' ? null : Number(e.target.value))}
          aria-invalid={showError ? true : undefined}
          style={{ width: '100%', maxWidth: 520, minHeight: 40, padding: '6px 10px', border: '1px solid var(--theme-elevation-150)', borderRadius: 4, background: 'var(--theme-input-bg, var(--theme-elevation-0))', color: 'inherit' }}
        >
          <option value="">{company === null ? `${PICK_COMPANY_FIRST}…` : !current ? 'memuat…' : items.length === 0 ? 'Belum ada PT lain dengan rekening penerimaan antar-PT' : (field.admin?.placeholder as string | undefined) || 'Pilih PT penerima…'}</option>
          {missing ? <option value={String(selected)}>{`PT #${selected} (tidak tersedia — pilih PT lain)`}</option> : null}
          {items.map((i) => (
            <option key={i.companyId} value={String(i.companyId)}>
              {intercompanyOptionLabel(i)}
            </option>
          ))}
        </select>
        {current?.status === 'error' ? <div style={{ color: 'var(--theme-error-500)', fontSize: 13, marginTop: 4 }}>Gagal memuat daftar PT penerima (hanya Finance, PM atau Direktur PT ini).</div> : null}
        <FieldDescription description={field.admin?.description} path={path} />
      </div>
    </div>
  )
}

export default IntercompanyPayeeField
