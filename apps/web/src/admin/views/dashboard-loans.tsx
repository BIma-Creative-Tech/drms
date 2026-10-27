import Link from 'next/link'
import React from 'react'

import type { LoanBlock } from '@/domain/reports/dashboards'
import { formatNumber } from '@/lib/money'

import { Card, DataTable, EmptyState, MetricRow, rp, StatusPill } from './viz'

/**
 * ADR 0022 §9: "Pinjaman antar project" card on the Direktur, Finance and PM dashboards — totals outstanding /
 * overdue, loans waiting for the caller (Direktur), top 5 projects by outstanding (borrowed / lent / overdue); each
 * row opens the project's "Pinjaman" tab, the card the report. Scope: loanScope (office roles: their PTs, PM: team).
 * Data: the dashboard payload's `loans` block (dashboards.ts loanBlock — same numbers as the APK home).
 * D2510: the totals read as a metric row (status dot, value, muted context) above the table.
 */
export function LoanCard({ data: d, i, span = 12 }: { data: LoanBlock; i: number; span?: 6 | 7 | 8 | 12 }) {
  const t = d.totals
  return (
    <Card
      id="loan-monitor"
      icon="tHierarchy2"
      title="Pinjaman antar project"
      sub={`Sisa ${rp(t.outstanding)} · ${formatNumber(t.overdueCount)} terlambat${t.overdueCount ? ` (${rp(t.overdue)})` : ''} · ${formatNumber(t.pending)} menunggu persetujuan`}
      span={span}
      i={i}
      action={{ href: '/admin/laporan/pinjaman-antar-project', label: 'Laporan pinjaman' }}
    >
      <div style={{ margin: '0 0 16px' }}>
        <MetricRow
          label="Pinjaman antar project"
          items={[
            { key: 'outstanding', label: 'Sisa pinjaman', value: rp(t.outstanding), tone: 'primary', kpi: 'loan-outstanding' },
            { key: 'overdue', label: 'Terlambat', value: formatNumber(t.overdueCount), sub: t.overdueCount ? rp(t.overdue) : undefined, tone: t.overdueCount ? 'bad' : 'ok', kpi: 'loan-overdue' },
            { key: 'pending', label: 'Menunggu persetujuan', value: formatNumber(t.pending), tone: t.pending ? 'warn' : 'neutral', kpi: 'loan-pending' },
          ]}
        />
      </div>
      {d.waitingForMe > 0 ? (
        <p className="pk-kpi-x" data-pk-loan-waiting style={{ marginTop: 0 }}>
          <Link href="/admin/persetujuan#pinjaman">
            <StatusPill tone="wait" label={`${d.waitingForMe} pinjaman menunggu keputusan Anda`} />
          </Link>
        </p>
      ) : null}
      <DataTable
        id="loan-monitor"
        caption="Pinjaman antar project per project"
        rows={d.projects}
        rowKey={(r) => r.projectId}
        rowAttrs={(r) => ({ 'data-pk-loan-project': String(r.projectId) })}
        empty={<EmptyState text="Belum ada pinjaman antar project yang disetujui." />}
        cols={[
          {
            key: 'p',
            label: 'Project',
            cell: (r) => (
              <a href={`/admin/collections/projects/${r.projectId}/pinjaman`}>
                {r.code} {r.name}
              </a>
            ),
          },
          { key: 'b', label: 'Diterima (sisa)', num: true, sort: 'descending', cell: (r) => <span title={rp(r.borrowed)}>{rp(r.outstandingBorrowed)}</span> },
          { key: 'l', label: 'Diberikan (sisa)', num: true, cell: (r) => <span title={rp(r.lent)}>{rp(r.outstandingLent)}</span> },
          { key: 'o', label: 'Terlambat', cell: (r) => (r.overdueCount > 0 ? <StatusPill tone="bad" label={`${formatNumber(r.overdueCount)} · ${rp(r.overdueBorrowed)}`} /> : <StatusPill tone="ok" label="Tepat waktu" />) },
        ]}
      />
    </Card>
  )
}
