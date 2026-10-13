import Link from 'next/link'
import type { PayloadRequest } from 'payload'
import React from 'react'

import { loanDashboard } from '@/domain/loans/report'
import { loanInbox } from '@/domain/loans/service'
import { formatNumber } from '@/lib/money'
import { withSystemTransaction } from '@/lib/system-tx'

import { Card, DataTable, EmptyState, rp, StatusPill } from './viz'

/**
 * ADR 0022 §9: "Pinjaman antar project" card on the Direktur, Finance and PM dashboards — totals outstanding /
 * overdue, loans waiting for the caller (Direktur), top 5 projects by outstanding (borrowed / lent / overdue); each
 * row opens the project's "Pinjaman" tab, the card the report. Scope: loanScope (office roles: their PTs, PM: team).
 */
export async function LoanCard({ req, i, span = 12 }: { req: PayloadRequest; i: number; span?: 6 | 7 | 8 | 12 }) {
  // own req + transaction: the dashboard cards render concurrently (a shared req transaction would be committed under us)
  const d = await withSystemTransaction(req.payload, req.user, async (r) => ({ ...(await loanDashboard(r)), waiting: (await loanInbox(r)).items.length }))
  const t = d.totals
  return (
    <Card
      id="loan-monitor"
      title="Pinjaman antar project"
      sub={`Sisa ${rp(t.outstanding)} · ${formatNumber(t.overdueCount)} terlambat${t.overdueCount ? ` (${rp(t.overdue)})` : ''} · ${formatNumber(t.pending)} menunggu persetujuan`}
      span={span}
      i={i}
      action={{ href: '/admin/laporan/pinjaman-antar-project', label: 'Laporan pinjaman' }}
    >
      {d.waiting > 0 ? (
        <p className="pk-kpi-x" data-pk-loan-waiting style={{ marginTop: 0 }}>
          <Link href="/admin/persetujuan#pinjaman">
            <StatusPill tone="wait" label={`${d.waiting} pinjaman menunggu keputusan Anda`} />
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
