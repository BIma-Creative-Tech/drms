import type { SelectFieldServerProps } from 'payload'
import React from 'react'

import { isDraftForm } from '@/collections/expense-request-form'
import { requestStatusLabel } from '@/domain/expense/timeline'
import type { ApprovalSnapshot } from '@/domain/expense/rules'
import type { RequestStatus, RequestType } from '@/domain/expense/types'

/**
 * Read-only "Status" in the expense-request sidebar (DRMS 10/10 integration). Shows the SAME label as the
 * workflow panel chip, the lists and the APK (`requestStatusLabel`: ADR 0021 "Menunggu persetujuan PM" …).
 * Nothing on a new / Draft form (8i). Replaces `admin.condition` on the column: a condition on a required
 * field makes Payload's Postgres adapter treat `status` as nullable (schema drift against NOT NULL).
 */
export function RequestStatusField(props: SelectFieldServerProps) {
  const data = (props.data ?? {}) as { status?: RequestStatus | null; type?: RequestType | null; approvalSnapshot?: ApprovalSnapshot | null; currentLevel?: number | null }
  if (isDraftForm(data) || !data.status) return null
  const label = requestStatusLabel(data.type ?? 'reimburse', data.status, data.approvalSnapshot ?? null, data.currentLevel ?? null)
  return (
    <div className="field-type" data-pk-field="status" style={{ marginBottom: 16 }}>
      <div className="field-label">Status</div>
      <div>{label}</div>
    </div>
  )
}

export default RequestStatusField
