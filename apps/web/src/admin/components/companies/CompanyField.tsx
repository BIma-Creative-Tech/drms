import { RelationshipField } from '@payloadcms/ui'
import type { RelationshipFieldServerComponent } from 'payload'
import React from 'react'

import { relId } from '@/access/roles'

import { companyLabels } from './labels'

/**
 * DRMS 10/10 9b (WA-08): the PT of an EXISTING document on one line — "PT: DRMS — PT Dua Raja Mitra
 * Sejahtera" with the short-code chip of the lists (custom.scss .pk-pt-chip) — instead of a label
 * and a disabled picker on two lines (`company` is immutable after create, ADR 0016 §4). On create
 * the normal PT picker stays (the companyField description explains when it is required).
 */
export const CompanyField: RelationshipFieldServerComponent = async (props) => {
  const { id, data, clientField, path, readOnly, schemaPath, permissions, req } = props
  const company = relId((data as { company?: unknown } | undefined)?.company)
  if (id !== undefined && id !== null && id !== '' && company !== undefined) {
    const l = (await companyLabels(req.payload)).get(company)
    return (
      <div className="field-type" data-pk-field="company" data-pk-company-inline={l?.shortCode ?? company} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6, marginBottom: 'var(--spacing-field, 16px)', fontSize: 14 }}>
        <span style={{ fontWeight: 600 }}>PT:</span>
        <span className="pk-pt-chip" title={l?.name}>
          {l?.shortCode ?? `#${company}`}
        </span>
        {l?.name ? <span>— {l.name}</span> : null}
      </div>
    )
  }
  return <RelationshipField field={clientField as never} path={path ?? 'company'} readOnly={readOnly} schemaPath={schemaPath} permissions={permissions} />
}

export default CompanyField
