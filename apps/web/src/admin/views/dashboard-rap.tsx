import type { PayloadRequest } from 'payload'
import React from 'react'

import { rapMonitoring } from '@/domain/rap/budget'
import { withSystemTransaction } from '@/lib/system-tx'

import { Card, DataTable, EmptyState, Meter, StatusPill, rp, rpShort } from './viz'

const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`)

/**
 * DRMS 10/10 point 2–4 (D4): "Monitoring RAP" on the Direktur dashboard — projects with a RAP, realisation (Σ approved
 * request lines charged to the RAP items) vs plan, items over plan; each row opens the project's RAP tab.
 * Data: domain/rap/budget.ts rapMonitoring (caller's project read scope, selected PTs).
 */
export async function RapMonitorCard({ req, i, span = 12 }: { req: PayloadRequest; i: number; span?: 6 | 7 | 8 | 12 }) {
  // own req + transaction: the dashboard cards render concurrently (a shared req transaction would be committed under us)
  const d = await withSystemTransaction(req.payload, req.user, (r) => rapMonitoring(r, { limit: 8 }))
  return (
    <Card
      id="rap-monitor"
      title="Monitoring RAP"
      sub={d.projects === 0 ? 'Realisasi pengajuan per item RAP' : `${d.projects} project ber-RAP · ${d.overProjects} dengan item melebihi RAP`}
      span={span}
      i={i}
      action={{ href: '/admin/collections/projects?where[kind][equals]=konstruksi', label: 'Semua project' }}
    >
      <DataTable
        id="rap-monitor"
        caption="Monitoring RAP per project"
        rows={d.rows}
        rowKey={(r) => r.projectId}
        rowAttrs={(r) => ({ 'data-pk-rap-project': String(r.projectId) })}
        empty={<EmptyState text="Belum ada project dengan RAP." />}
        cols={[
          {
            key: 'p',
            label: 'Project',
            cell: (r) => (
              <a href={`/admin/collections/projects/${r.projectId}/rap`}>
                {r.code} {r.name}
              </a>
            ),
          },
          { key: 'pl', label: 'Rencana', num: true, sec: true, cell: (r) => (r.planned === null ? '—' : rpShort(r.planned)) },
          { key: 're', label: 'Realisasi', num: true, cell: (r) => <span title={rp(r.realised)}>{rpShort(r.realised)}</span> },
          {
            key: 'pc',
            label: '% RAP',
            num: true,
            sort: 'descending',
            cell: (r) => (
              <span style={{ display: 'inline-grid', gap: 2, minWidth: 72 }}>
                {pct(r.percent)}
                <Meter value={r.realised} max={Math.max(1, r.planned ?? 0)} tone={r.overBudget ? 'over' : (r.percent ?? 0) >= 85 ? 'warn' : 'ok'} />
              </span>
            ),
          },
          { key: 'o', label: 'Melebihi RAP', cell: (r) => (r.overBudgetItems > 0 ? <StatusPill tone="warn" label={`${r.overBudgetItems} item`} /> : <StatusPill tone="ok" label="Aman" />) },
        ]}
      />
    </Card>
  )
}
