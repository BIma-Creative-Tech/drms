'use client'
import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import React from 'react'

import { requestEditGate } from '@/collections/expense-request-form'

import { ConfirmSaveButton } from './feedback/ConfirmSaveButton'
import { useRequestMode } from './request/mode'

/**
 * Expense request "Simpan" (DRMS 10/10 integration, Lead review d): only while the content is editable
 * (new / Draft / Revisi Nota). A submitted request changes only through the workflow actions (panel,
 * action bar) — a "Simpan" there saved nothing and misled the reader. DRMS 13/10 Persetujuan #7: on an existing
 * request only in edit mode ("Edit" in the action bar), next to "Batal"; a new request is always in edit mode.
 * Payload's own submit (validation, audit reason, onSave) is kept. The server stays the authority (beforeChange
 * rejects content edits of a locked request). DRMS 24/10: the confirming "Simpan" (popup before + result after).
 */
export function RequestSaveButton(props: SaveButtonClientProps) {
  const { id, hasSavePermission } = useDocumentInfo()
  const status = useFormFields(([fields]) => fields.status?.value) as string | null | undefined
  const mode = useRequestMode(id)
  const gate = requestEditGate({ id, status, hasSavePermission })
  if (gate === 'locked' || mode !== 'edit') return null
  return <ConfirmSaveButton {...props} />
}

export default RequestSaveButton
