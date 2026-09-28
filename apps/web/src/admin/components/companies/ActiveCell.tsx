import React from 'react'

/** "Aktif" list column as a status word (never colour alone) instead of Payload's "benar/salah". */
export function ActiveCell({ cellData }: { cellData?: unknown }) {
  const on = cellData !== false
  return (
    <span className={`pk-status-pill${on ? '' : ' pk-status-pill--off'}`} data-pk-active={on ? 'true' : 'false'}>
      <span aria-hidden="true">{on ? '●' : '○'}</span> {on ? 'Aktif' : 'Nonaktif'}
    </span>
  )
}

export default ActiveCell
