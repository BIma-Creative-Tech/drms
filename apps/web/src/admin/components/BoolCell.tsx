import React from 'react'

/**
 * QA-29: list cell of checkbox fields — "Aktif" / "Nonaktif" for `active`, "Ya" / "Tidak" for every
 * other boolean (Payload's default cell showed "benar" / "salah"). Server component: plain text.
 */
export function boolText(value: unknown, kind: 'active' | 'yesno'): string {
  if (value === null || value === undefined || value === '') return '—'
  const on = value === true || value === 'true'
  return kind === 'active' ? (on ? 'Aktif' : 'Nonaktif') : on ? 'Ya' : 'Tidak'
}

export function ActiveCell({ cellData }: { cellData?: unknown }) {
  return <span data-pk-bool={String(cellData === true)}>{boolText(cellData, 'active')}</span>
}

export function YesNoCell({ cellData }: { cellData?: unknown }) {
  return <span data-pk-bool={String(cellData === true)}>{boolText(cellData, 'yesno')}</span>
}

export default YesNoCell
