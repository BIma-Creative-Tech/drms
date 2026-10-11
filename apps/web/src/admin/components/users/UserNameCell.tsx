import type { DefaultServerCellComponentProps } from 'payload'
import React, { cache } from 'react'

import { relId } from '@/access/roles'
import { userNameOf } from '@/domain/user-display-name'

/** One lookup per user + PT per request (a list page renders the same creator many times). */
const nameOf = cache((payload: DefaultServerCellComponentProps['payload'], id: number, company: number | null) => userNameOf(payload, id, company))

/** List cell of a user relationship: the person's name (UserNameField), never "Tanpa Judul" / an id. */
export async function UserNameCell({ cellData, rowData, payload }: DefaultServerCellComponentProps) {
  const id = relId(cellData)
  if (id === undefined) return <span>—</span>
  return <span data-pk-user-name>{await nameOf(payload, id, relId((rowData as { company?: unknown } | undefined)?.company) ?? null)}</span>
}

export default UserNameCell
