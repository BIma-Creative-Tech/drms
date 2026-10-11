'use client'
import { FieldLabel, useField } from '@payloadcms/ui'
import type { UploadFieldClientComponent } from 'payload'
import React from 'react'

import { relValue } from './lines/line-form'
import { LpjPhotoGrid } from './lpj/LpjPhotoGrid'

/**
 * Point 13 (DRMS 10/10): "Foto LPJ" on the LPJ document (Settlements, read-only — written by the LPJ service):
 * thumbnails in the admin lightbox instead of Payload's upload rows (which would link the raw media document).
 */
export const LpjPhotosField: UploadFieldClientComponent = ({ field, path: pathProp }) => {
  const path = pathProp ?? field.name
  const { value } = useField<unknown[]>({ path })
  const ids = (Array.isArray(value) ? value : []).map(relValue).filter((x): x is number => x !== null)
  return (
    <div className="field-type" data-pk-field="lpj-photos" style={{ marginBottom: 'var(--spacing-field, 16px)' }}>
      <FieldLabel label={field.label} path={path} />
      {ids.length === 0 ? <div style={{ color: 'var(--pk-muted-fg)', fontSize: 13 }}>Tidak ada foto.</div> : <LpjPhotoGrid ids={ids} group={`lpj-doc-${path}`} label="Foto LPJ" />}
    </div>
  )
}

export default LpjPhotosField
