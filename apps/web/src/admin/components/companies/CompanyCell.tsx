import type { Payload } from 'payload'
import React from 'react'

import { companyIdOf, companyLabels } from './labels'

/**
 * List cell of the `company` column on every per-PT collection (MC2-4, wireframe §4): the PT short
 * code as a chip (full name in the tooltip) instead of the long company name.
 */
export async function CompanyCell({ cellData, payload }: { cellData?: unknown; payload: Payload }) {
  const id = companyIdOf(cellData)
  if (id === undefined) return <span>—</span>
  const c = (await companyLabels(payload)).get(id)
  return (
    <span className="pk-pt-chip" title={c?.name ?? undefined} data-pk-company={c?.shortCode ?? id}>
      {c?.shortCode ?? `#${id}`}
    </span>
  )
}

export default CompanyCell
