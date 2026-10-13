import { RelationshipField } from '@payloadcms/ui'
import type { RelationshipFieldServerComponent } from 'payload'
import React from 'react'

import { relId, type Role } from '@/access/roles'
import { creatableCompanies } from '@/fields/company'

import { CompanyBadge } from './CompanyBadge'
import { CompanyPrefill } from './CompanyPrefill'
import { companyLabels } from './labels'

/**
 * DRMS 10/10 9b (WA-08): the PT of an EXISTING document on one line with the short-code chip of the lists
 * (custom.scss .pk-pt-chip) — instead of a label and a disabled picker on two lines (`company` is immutable
 * after create, ADR 0016 §4). DRMS 13/10 Persetujuan #8: as a badge, without the "PT:" label (CompanyBadge).
 * On create the normal PT picker stays (the companyField description explains when it is required) — except
 * for a form with `createRoles` (DRMS 13/10 Pengajuan #1/#2) where exactly one PT is possible: prefilled and
 * read-only (CompanyPrefill).
 */
export const CompanyField: RelationshipFieldServerComponent = async (props) => {
  const { id, data, field, clientField, path, readOnly, schemaPath, permissions, req } = props
  const company = relId((data as { company?: unknown } | undefined)?.company)
  const existing = id !== undefined && id !== null && id !== ''
  if (existing && company !== undefined) {
    const l = (await companyLabels(req.payload)).get(company)
    return <CompanyBadge shortCode={l?.shortCode ?? `#${company}`} name={l?.name ?? null} />
  }
  const roles = (field.custom as { pkCreateRoles?: readonly Role[] } | undefined)?.pkCreateRoles
  const picker = <RelationshipField field={clientField as never} path={path ?? 'company'} readOnly={readOnly} schemaPath={schemaPath} permissions={permissions} />
  if (existing || !roles) return picker
  const allowed = creatableCompanies(req.user, roles)
  if (allowed.length === 1) {
    const only = allowed[0]!
    const l = (await companyLabels(req.payload)).get(only)
    return <CompanyPrefill path={path ?? 'company'} id={only} shortCode={l?.shortCode ?? `#${only}`} name={l?.name ?? null} />
  }
  if (allowed.length === 0) {
    return (
      <>
        {picker}
        <p className="field-description" data-pk-no-creatable-company style={{ marginTop: -8 }}>
          Anda tidak berhak membuat data ini di PT yang dipilih. Ubah pilihan PT di kanan atas.
        </p>
      </>
    )
  }
  return picker
}

export default CompanyField
