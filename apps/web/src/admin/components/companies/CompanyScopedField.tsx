'use client'
import { RelationshipField, useFormFields } from '@payloadcms/ui'
import type { RelationshipFieldClientComponent } from 'payload'
import React from 'react'

/** Shown in the disabled picker until the form has a PT (DRMS 13/10 Pengajuan #3/#5). */
export const PICK_COMPANY_FIRST = 'Pilih PT terlebih dahulu'

/**
 * DRMS 13/10 Pengajuan #3/#5: a per-PT picker (project, urgensi, Pemohon, rekening) that stays disabled with
 * "Pilih PT terlebih dahulu" until the form's `company` has a value; afterwards the normal Payload picker,
 * whose options `filterOptions` (fields/company.ts companyScopedOptions) narrows to that PT. A single-PT user
 * never sees the lock: CompanyField prefills the PT on create. UI only — the company hook + DB trigger keep
 * cross-PT values impossible.
 */
export const CompanyScopedField: RelationshipFieldClientComponent = (props) => {
  const hasCompany = useFormFields(([fields]) => {
    const v = fields.company?.value
    return v !== undefined && v !== null && v !== ''
  })
  if (hasCompany) return <RelationshipField {...props} />
  const field = { ...props.field, admin: { ...props.field.admin, placeholder: `${PICK_COMPANY_FIRST}…` } }
  return (
    <div data-pk-needs-company={props.field.name}>
      <RelationshipField {...props} field={field} readOnly />
    </div>
  )
}

export default CompanyScopedField
