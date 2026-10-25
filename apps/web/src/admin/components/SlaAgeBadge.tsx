import React from 'react'

import { formatHours } from '@/domain/expense/sla'

import { Badge } from '../views/page-ui'

/**
 * Item 11 (DRMS 10/10): "Umur sejak disetujui" of a transfer-queue item — red once the age is over the
 * PT's transfer SLA (`companies.transferSlaHours`), green within it; "—" for requests approved before
 * the approval time was recorded (no backfill source). D2510: a soft badge (Nexus kit tones).
 */
export function SlaAgeBadge({ sla }: { sla: { approvedAt: string | null; slaHours: number; ageHours: number | null; over: boolean } }) {
  if (sla.ageHours === null) return <span className="pk-nx-sub">Umur sejak disetujui: —</span>
  const text = `${formatHours(sla.ageHours)} sejak disetujui`
  return (
    <Badge
      tone={sla.over ? 'bad' : 'ok'}
      title={`SLA transfer PT ini: ${sla.slaHours} jam sejak disetujui${sla.over ? ' — terlambat' : ''}`}
      data-pk-sla={sla.over ? 'over' : 'ok'}
      aria-label={`Umur sejak disetujui ${formatHours(sla.ageHours)}${sla.over ? `, melewati SLA ${sla.slaHours} jam` : `, dalam SLA ${sla.slaHours} jam`}`}
    >
      {text}
      {sla.over ? ` · lewat SLA ${sla.slaHours} jam` : ''}
    </Badge>
  )
}
