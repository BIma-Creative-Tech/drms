'use client'
import { SaveButton, useFormFields } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import React from 'react'

import { isContentEditable, type RequestStatus } from '@/domain/expense/types'

/**
 * Expense request "Simpan" (DRMS 10/10 integration, Lead review d): only while the content is editable
 * (new / Draft / Revisi Nota). A submitted request changes only through the workflow actions (panel,
 * decision bar) — a "Simpan" there saved nothing and misled the reader. The server stays the authority
 * (beforeChange rejects content edits of a locked request).
 */
export function RequestSaveButton(props: SaveButtonClientProps) {
  const status = useFormFields(([fields]) => fields.status?.value) as RequestStatus | null | undefined
  if (status && !isContentEditable(status)) return null
  return <SaveButton {...props} />
}

export default RequestSaveButton
