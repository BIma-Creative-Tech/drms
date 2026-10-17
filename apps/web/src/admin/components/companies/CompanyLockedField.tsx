import { RelationshipField } from '@payloadcms/ui'
import type { RelationshipFieldServerComponent } from 'payload'
import React from 'react'

import { soleCompany } from '@/access/roles'

import { CompanyScopedField } from './CompanyScopedField'

/**
 * DRMS UI feedback 17/10 #4: a per-PT picker of a master / derived form (fields/company.ts `lockedUntilCompany`) —
 * with several PTs selected it stays disabled with "Pilih PT terlebih dahulu" (or "Pilih <parent> terlebih dahulu" on a
 * derived form) until the PT is known, like the expense-request pickers (CompanyScopedField); its `filterOptions`
 * then lists that PT's rows only. With ONE selected PT nothing waits: the options already are that PT's
 * (formOrSoleCompany / parentCompany fall back to the only selected PT). UI only — the company hook + DB trigger keep
 * cross-PT values impossible.
 */
export const CompanyLockedField: RelationshipFieldServerComponent = (props) => {
  const { field, clientField, path, readOnly, schemaPath, permissions, req } = props
  const custom = field.custom as { pkWaitFor?: string; pkWaitLabel?: string } | undefined
  const fieldProps = { field: clientField as never, path: path ?? field.name, readOnly, schemaPath, permissions }
  if (soleCompany(req) !== undefined) return <RelationshipField {...fieldProps} />
  return <CompanyScopedField {...fieldProps} waitFor={custom?.pkWaitFor} waitLabel={custom?.pkWaitLabel} />
}

export default CompanyLockedField
