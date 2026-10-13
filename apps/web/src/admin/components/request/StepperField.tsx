import type { UIFieldServerProps } from 'payload'
import React from 'react'

import { loadRequestPanel } from './panel-data'
import { RequestStepper } from './RequestStepper'

/**
 * DRMS 13/10 Persetujuan #3/#5: right column of the request page (sidebar ui field, sticky in Payload's layout) — the
 * request stepper instead of "Cetak PDF", "Total ditransfer" and "Aturan approval". Nothing on a new document (the
 * sidebar then collapses and the form uses the full width).
 */
export async function StepperField({ req, id }: UIFieldServerProps) {
  const docId = Number(id)
  if (!id || !Number.isSafeInteger(docId)) return null
  const p = await loadRequestPanel(req.payload, req.user, docId)
  if (!p) return null
  return <RequestStepper stepper={p.stepper} tz={p.tz} variant="sidebar" note={p.stepperNote} ruleName={p.ruleName} />
}

export default StepperField
