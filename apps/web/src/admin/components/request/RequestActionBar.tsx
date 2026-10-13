import type { BeforeDocumentControlsServerProps } from 'payload'
import React from 'react'

import { actionBarProps } from './action-bar'
import { loadRequestPanel } from './panel-data'
import { RequestActionsClient } from './RequestActionsClient'

/**
 * DRMS 13/10 Persetujuan #5: `admin.components.edit.beforeDocumentControls` of the expense requests — the action bar
 * sits in Payload's sticky document-controls row, right before "Simpan". Server part: reads the request once per
 * render (panel-data, shared with the workflow panel and the stepper); props from action-bar.ts. New document: none.
 */
export async function RequestActionBar({ id, payload, user }: BeforeDocumentControlsServerProps) {
  const docId = Number(id)
  if (!id || !Number.isSafeInteger(docId)) return null
  const p = await loadRequestPanel(payload, user, docId)
  if (!p) return null
  return <RequestActionsClient {...actionBarProps(p)} />
}

export default RequestActionBar
