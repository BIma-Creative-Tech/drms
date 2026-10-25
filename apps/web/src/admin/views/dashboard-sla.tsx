import React from 'react'

import type { SlaBlock } from '@/domain/reports/dashboards'
import { formatNumber } from '@/lib/money'

import { Card, Meter, MetricRow } from './viz'

/**
 * Item 11 (DRMS 10/10): KPI card "SLA transfer" on the Direktur and Finance dashboards — share of this
 * month's transfers (PT zone) done within the PT's transfer SLA since the final approval, average
 * duration, late count. Data: the dashboard payload's `sla` block (dashboards.ts slaBlock → sla-report.ts, same numbers
 * as the "SLA transfer" report and the APK home). D2510: share / average / late as a metric row.
 */
export function SlaTransferCard({ data: d, i, span = 4 }: { data: SlaBlock; i: number; span?: 3 | 4 | 6 | 12 }) {
  const tone = d.pctWithin === null ? 'none' : d.pctWithin >= 90 ? 'ok' : d.pctWithin >= 70 ? 'warn' : 'over'
  return (
    <Card id="sla-transfer" icon="tTimer" title="SLA transfer" sub={`Disetujui → ditransfer, bulan ini${d.slaHours.length === 1 ? ` · target ${d.slaHours[0]} jam` : ''}`} span={span} i={i} action={{ href: '/admin/laporan/sla-transfer', label: 'Laporan' }}>
      <MetricRow
        label="SLA transfer"
        items={[
          { key: 'within', label: 'Dalam SLA', value: d.text, sub: d.count === 0 ? 'Belum ada transfer bulan ini.' : `dari ${formatNumber(d.count)} transfer dalam SLA`, tone: tone === 'over' ? 'bad' : tone === 'none' ? 'neutral' : tone, kpi: 'sla-pct' },
          { key: 'avg', label: 'Rata-rata', value: d.avgText, sub: 'disetujui → ditransfer', tone: 'info' },
          { key: 'late', label: 'Terlambat', value: formatNumber(d.late), sub: 'transfer melewati SLA', tone: d.late > 0 ? 'bad' : 'ok', kpi: 'sla-late' },
        ]}
      />
      <Meter value={d.pctWithin ?? 0} max={100} tone={tone} />
    </Card>
  )
}
