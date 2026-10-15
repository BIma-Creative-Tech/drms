'use client'
import { useAuth, useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import React from 'react'

import { Icon } from '@/admin/modules/Icon'
import { canOnRow, rowActionOf } from '@/admin/row-actions'
import { ROW_STATE_KEY, type RowState } from '@/domain/soft-delete/registry'

import { RowRecordAction } from './RowRecordAction'

type Props = { collectionSlug?: string; rowData?: Record<string, unknown>; viewType?: string }

/**
 * List cell of the "Aksi" column (src/admin/row-actions.ts): one labelled button per row that opens the
 * record. Visible text + an accessible name that starts with it and names the row ("Ubah Proyek
 * Jembatan"); ≥ 32 px high (44 px on touch), focus ring from the theme. "Ubah" only when the update
 * permission Payload sends to the client matches this row; the server re-checks on save either way.
 * D1610 (ADR 0030): on soft-deletable lists PkListView adds the row state (`rowData._pkRow`) → a second button
 * "Hapus" / "Batalkan" / "Nonaktifkan" / "Pulihkan" (RowRecordAction) and the badge "Dihapus" on a deleted row
 * (which only opens read-only: "Lihat").
 */
export function RowActionsCell({ collectionSlug, rowData, viewType }: Props) {
  const { permissions } = useAuth()
  const { config, getEntityConfig } = useConfig()
  const id = rowData?.id
  if (!collectionSlug || (typeof id !== 'number' && typeof id !== 'string')) return null
  // Payload sends `true` or `{ permission, where }` (per PT / per status) — evaluated against this row
  const state = (rowData?.[ROW_STATE_KEY] ?? null) as RowState | null
  const deleted = state?.deleted === true || rowData?.isDeleted === true
  const action = rowActionOf(collectionSlug, viewType !== 'trash' && !deleted && canOnRow((permissions?.collections?.[collectionSlug] as { update?: unknown } | undefined)?.update, rowData ?? {}))
  const useAsTitle = getEntityConfig({ collectionSlug })?.admin?.useAsTitle
  const title = useAsTitle ? rowData?.[useAsTitle] : undefined
  const name = typeof title === 'string' || typeof title === 'number' ? String(title) : `#${id}`
  const href = `${config.routes.admin}/collections/${collectionSlug}${viewType === 'trash' ? '/trash' : ''}/${encodeURIComponent(String(id))}`
  return (
    <span className="pk-row-actions">
      <Link href={href} prefetch={false} className="pk-row-act" data-kind={action.kind} aria-label={`${action.label} ${name}`} data-pk-row-action={action.kind}>
        <Icon name={action.icon} size={16} />
        <span>{action.label}</span>
      </Link>
      {state?.action && viewType !== 'trash' ? <RowRecordAction collection={collectionSlug} id={id} name={name} action={state.action} editHref={href} /> : null}
      {deleted ? (
        <span className="pk-row-badge" data-pk-deleted-badge>
          Dihapus
        </span>
      ) : null}
    </span>
  )
}

export default RowActionsCell
