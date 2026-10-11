import type { DefaultServerCellComponentProps } from 'payload'
import React from 'react'

import { requestStatusLabel } from '@/domain/expense/timeline'
import type { ApprovalSnapshot } from '@/domain/expense/rules'
import { REQUEST_STATUSES, type RequestStatus, type RequestType } from '@/domain/expense/types'

/** List cell of `expense-requests.status`: the same snapshot-aware label as the detail chip (Lead review b). */
export function RequestStatusCell({ cellData, rowData }: DefaultServerCellComponentProps) {
  const status = cellData as RequestStatus | null | undefined
  if (!status || !REQUEST_STATUSES.includes(status)) return <span>—</span>
  const row = (rowData ?? {}) as { type?: RequestType | null; approvalSnapshot?: ApprovalSnapshot | null; currentLevel?: number | null }
  return <span data-pk-status={status}>{requestStatusLabel(row.type ?? 'reimburse', status, row.approvalSnapshot ?? null, row.currentLevel ?? null)}</span>
}

export default RequestStatusCell
