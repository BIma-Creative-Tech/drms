'use client'
import { FieldLabel, useField } from '@payloadcms/ui'
import type { ClientField, DefaultCellComponentProps, UploadFieldClientComponent } from 'payload'
import React from 'react'

import { ImageThumb, ThumbList } from './ImageThumb'
import { MEDIA_KIND_OF, mediaThumbSource, uploadIds, uploadMime, type MediaKind } from './media-url'

/**
 * D2510 image preview (web 0.21.1): upload fields of the Payload views (wired for every upload field to a media
 * collection by src/admin/display-cells.ts).
 * - UploadCell: list column — Payload's own cell showed the file NAME (relationship title) without a preview; now a
 *   thumbnail per file that opens the lightbox (group = the row), PDFs as a file link.
 * - UploadPreviewField: READ-ONLY upload fields (selfie of an attendance, transfer / cash proof, approval signature):
 *   thumbnails through the authorized /api/v1 file endpoint. Payload's preview used the generic static route
 *   /api/<media>/file/<name>, i.e. the media collection's own read rule — a PM saw no selfie of his team (Q-33
 *   visibility runs through the attendance, which the /api/v1 endpoint checks) and nothing opened in a popup.
 * Editable upload fields keep Payload's field (upload, choose existing, its own preview).
 */
function kindOf(field: ClientField | undefined): MediaKind | null {
  const rel = field && 'relationTo' in field ? (field as { relationTo?: unknown }).relationTo : undefined
  return typeof rel === 'string' ? (MEDIA_KIND_OF[rel] ?? null) : null
}

function labelText(field: ClientField | undefined): string {
  const l = field && 'label' in field ? (field as { label?: unknown }).label : undefined
  if (typeof l === 'string' && l.trim()) return l
  if (l && typeof l === 'object') {
    const first = Object.values(l as Record<string, unknown>).find((v) => typeof v === 'string' && v.trim())
    if (typeof first === 'string') return first
  }
  return field && 'name' in field ? String((field as { name?: unknown }).name ?? 'File') : 'File'
}

/** Thumbnails of one upload value (ids in order; a populated value also tells its MIME type). */
function Thumbs({ kind, value, group, title, size }: { kind: MediaKind; value: unknown; group: string; title: string; size: number }) {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
  const ids = uploadIds(value)
  const mimeOf = (id: number) => uploadMime(list.find((v) => v && typeof v === 'object' && Number((v as { id?: unknown }).id) === id))
  if (ids.length === 0) return null
  if (ids.length === 1) {
    const id = ids[0]!
    const mime = mimeOf(id)
    return <ImageThumb src={mediaThumbSource(kind, id)} group={group} title={title} size={size} file={mime !== null && !mime.startsWith('image/')} data-pk-upload-thumb={id} />
  }
  return (
    <ThumbList
      group={group}
      label={title}
      size={size}
      items={ids.map((id, i) => {
        const mime = mimeOf(id)
        return { key: id, src: mediaThumbSource(kind, id), title: `${title} ${i + 1}/${ids.length}`, file: mime !== null && !mime.startsWith('image/'), 'data-pk-upload-thumb': id }
      })}
    />
  )
}

export function UploadCell({ cellData, field, rowData, collectionSlug }: DefaultCellComponentProps) {
  const kind = kindOf(field)
  const ids = uploadIds(cellData)
  if (!kind || ids.length === 0) return <span>—</span>
  const name = field && 'name' in field ? String(field.name) : 'file'
  const row = (rowData as { id?: unknown } | undefined)?.id
  return (
    <span data-pk-upload-cell={name}>
      <Thumbs kind={kind} value={cellData} group={`${collectionSlug}-${String(row ?? '')}-${name}`} title={`${labelText(field)}${row !== undefined ? ` #${String(row)}` : ''}`} size={40} />
    </span>
  )
}

export const UploadPreviewField: UploadFieldClientComponent = ({ field, path: pathProp }) => {
  const path = pathProp ?? field.name
  const { value } = useField<unknown>({ path })
  const kind = kindOf(field as unknown as ClientField)
  const title = labelText(field as unknown as ClientField)
  return (
    <div className="field-type pk-thumb-field" data-pk-field={`upload-preview-${field.name}`}>
      <FieldLabel label={field.label} path={path} />
      {kind && uploadIds(value).length > 0 ? <Thumbs kind={kind} value={value} group={`upload-${path}`} title={title} size={96} /> : <div className="pk-thumb-empty">Tidak ada file.</div>}
    </div>
  )
}

export default UploadCell
