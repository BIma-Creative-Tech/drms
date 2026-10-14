import React from 'react'

/** ADR 0028: list badge of the designated "Rekening penerimaan antar-PT" (Master Data › Akun kas/bank); text, never colour alone. */
export function IntercompanyReceivingCell({ cellData }: { cellData?: unknown }) {
  if (cellData !== true) return <span data-pk-ic-receiving="false">—</span>
  return (
    <span className="pk-status-pill" data-pk-ic-receiving="true">
      <span aria-hidden="true">●</span> Penerimaan antar-PT
    </span>
  )
}

export default IntercompanyReceivingCell
