import type { PayloadRequest } from 'payload'
import React from 'react'

import { formatHours } from '@/domain/expense/sla'
import { slaThisMonth } from '@/domain/reports/sla-report'
import { withReqTransaction } from '@/lib/system-tx'

import { Card, Meter } from './viz'

/**
 * Item 11 (DRMS 10/10): KPI card "SLA transfer" on the Direktur and Finance dashboards — share of this
 * month's transfers (PT zone) done within the PT's transfer SLA since the final approval, average
 * duration, late count. Data: domain/reports/sla-report.ts (same numbers as the "SLA transfer" report).
 */
export async function SlaTransferCard({ req, i, span = 4 }: { req: PayloadRequest; i: number; span?: 3 | 4 | 6 | 12 }) {
  const d = await withReqTransaction(req, () => slaThisMonth(req))
  const tone = d.pctWithin === null ? 'none' : d.pctWithin >= 90 ? 'ok' : d.pctWithin >= 70 ? 'warn' : 'over'
  return (
    <Card id="sla-transfer" title="SLA transfer" sub={`Disetujui → ditransfer, bulan ini${d.slaHours.length === 1 ? ` · target ${d.slaHours[0]} jam` : ''}`} span={span} i={i} action={{ href: '/admin/laporan/sla-transfer', label: 'Laporan' }}>
      <p className="pk-kpi-v" style={{ fontSize: 22, margin: 0 }} data-pk-kpi="sla-pct">
        {d.text}
      </p>
      <p className="pk-kpi-x">{d.count === 0 ? 'Belum ada transfer bulan ini.' : `dari ${d.count} transfer dalam SLA`}</p>
      <Meter value={d.pctWithin ?? 0} max={100} tone={tone} />
      <p className="pk-kpi-x" data-pk-kpi="sla-late">
        Rata-rata <b>{formatHours(d.avgHours)}</b> · terlambat <b>{d.late}</b>
      </p>
    </Card>
  )
}
