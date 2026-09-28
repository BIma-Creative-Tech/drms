import type { Payload } from 'payload'
import React from 'react'

import { memberCounts } from './labels'

/** Companies list column "Anggota" (MC2-4, wireframe §3): active memberships of the row's PT. */
export async function MemberCountCell({ rowData, payload }: { rowData?: { id?: unknown }; payload: Payload }) {
  const id = typeof rowData?.id === 'number' ? rowData.id : undefined
  if (id === undefined) return <span>—</span>
  const n = (await memberCounts(payload)).get(id) ?? 0
  return <span data-pk-member-count={n}>{n}</span>
}

export default MemberCountCell
