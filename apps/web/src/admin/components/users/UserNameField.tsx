import type { RelationshipFieldServerProps } from 'payload'
import React from 'react'

import { relId } from '@/access/roles'
import { userNameOf } from '@/domain/user-display-name'

/**
 * Read-only user relationship ("Dibuat oleh", "Dicatat oleh", "Pelapor" …) shown by the person's NAME
 * (DRMS 10/10 integration, Lead review a). Payload's relationship input fetches the user with the
 * viewer's access — Staff/PM/Finance may read only their own account and saw "Tanpa Judul - ID: 1".
 * The name comes from `userNameOf` (same order as the greeting); the viewer already reads the document.
 */
export async function UserNameField(props: RelationshipFieldServerProps) {
  const { field, path, formState, data, payload } = props
  const p = path ?? field.name
  const raw = formState?.[p]?.value ?? (data as Record<string, unknown> | undefined)?.[field.name]
  const id = relId(raw)
  if (id === undefined) return null
  const name = await userNameOf(payload, id, relId((data as { company?: unknown } | undefined)?.company) ?? null)
  const label = typeof field.label === 'string' ? field.label : field.name
  return (
    <div className="field-type" data-pk-field={p} data-pk-user-name style={{ marginBottom: 16 }}>
      <div className="field-label">{label}</div>
      <div>{name}</div>
    </div>
  )
}

export default UserNameField
