'use client'
import { RelationshipField, useFormFields } from '@payloadcms/ui'
import type { RelationshipFieldClientProps } from 'payload'
import React from 'react'

/** Shown in the disabled picker until the form has a PT (DRMS 13/10 Pengajuan #3/#5). */
export const PICK_COMPANY_FIRST = 'Pilih PT terlebih dahulu'

/**
 * DRMS 13/10 Pengajuan #3/#5: a per-PT picker (project, urgensi, Pemohon, rekening) that stays disabled with
 * "Pilih PT terlebih dahulu" until the form's `company` has a value; afterwards the normal Payload picker,
 * whose options `filterOptions` (fields/company.ts companyScopedOptions) narrows to that PT. A single-PT user
 * never sees the lock: CompanyField prefills the PT on create. UI only — the company hook + DB trigger keep
 * cross-PT values impossible.
 * DRMS UI feedback 17/10 #4: `waitFor` / `waitLabel` (CompanyLockedField) — a derived form's picker waits for the
 * parent its PT comes from instead ("Pilih karyawan terlebih dahulu").
 */
export function CompanyScopedField(props: RelationshipFieldClientProps & { waitFor?: string; waitLabel?: string }) {
  const { waitFor = 'company', waitLabel, ...fieldProps } = props
  const hasCompany = useFormFields(([fields]) => {
    const v = fields[waitFor]?.value
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
  })
  if (hasCompany) return <RelationshipField {...fieldProps} />
  const text = waitLabel ? `Pilih ${waitLabel} terlebih dahulu` : PICK_COMPANY_FIRST
  const field = { ...fieldProps.field, admin: { ...fieldProps.field.admin, placeholder: `${text}…` } }
  return (
    <div data-pk-needs-company={fieldProps.field.name} data-pk-wait-for={waitFor}>
      <RelationshipField {...fieldProps} field={field} readOnly />
    </div>
  )
}

export default CompanyScopedField
