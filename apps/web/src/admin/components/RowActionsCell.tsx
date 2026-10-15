'use client'
import { useAuth, useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import React from 'react'

import { Icon } from '@/admin/modules/Icon'
import { partnerFormHref } from '@/admin/partner-routes'
import { canOnRow, rowActionOf } from '@/admin/row-actions'

type Props = { collectionSlug?: string; rowData?: Record<string, unknown>; viewType?: string }

/**
 * List cell of the "Aksi" column (src/admin/row-actions.ts): one labelled button per row that opens the
 * record. Visible text + an accessible name that starts with it and names the row ("Ubah Proyek
 * Jembatan"); ≥ 32 px high (44 px on touch), focus ring from the theme. "Ubah" only when the update
 * permission Payload sends to the client matches this row; the server re-checks on save either way.
 */
export function RowActionsCell({ collectionSlug, rowData, viewType }: Props) {
  const { permissions } = useAuth()
  const { config, getEntityConfig } = useConfig()
  const id = rowData?.id
  if (!collectionSlug || (typeof id !== 'number' && typeof id !== 'string')) return null
  // Payload sends `true` or `{ permission, where }` (per PT / per status) — evaluated against this row
  const action = rowActionOf(collectionSlug, viewType !== 'trash' && canOnRow((permissions?.collections?.[collectionSlug] as { update?: unknown } | undefined)?.update, rowData ?? {}))
  const useAsTitle = getEntityConfig({ collectionSlug })?.admin?.useAsTitle
  const title = useAsTitle ? rowData?.[useAsTitle] : undefined
  const name = typeof title === 'string' || typeof title === 'number' ? String(title) : `#${id}`
  // DRMS 16/10: clients / vendors open their tabbed page (admin/partner-routes.ts), read-only without the update right
  const custom = viewType === 'trash' ? null : partnerFormHref(collectionSlug, id, config.routes.admin)
  const href = custom ?? `${config.routes.admin}/collections/${collectionSlug}${viewType === 'trash' ? '/trash' : ''}/${encodeURIComponent(String(id))}`
  return (
    <span className="pk-row-actions">
      <Link href={href} prefetch={false} className="pk-row-act" data-kind={action.kind} aria-label={`${action.label} ${name}`} data-pk-row-action={action.kind}>
        <Icon name={action.icon} size={16} />
        <span>{action.label}</span>
      </Link>
    </span>
  )
}

export default RowActionsCell
