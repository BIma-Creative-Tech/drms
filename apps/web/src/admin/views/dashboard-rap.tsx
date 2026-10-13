import React from 'react'

import type { RapMissingBlock, RapMonitoringBlock } from '@/domain/reports/dashboards'
import { formatNumber } from '@/lib/money'

import { Card, DataTable, EmptyState, Meter, StatusPill, rp } from './viz'

const pct = (v: number | null) => (v === null ? '—' : `${formatNumber(v, 1)}%`)

/**
 * DRMS 10/10 point 2–4 (D4): "Monitoring RAP" on the Direktur dashboard — projects with a RAP, realisation (Σ approved
 * request lines charged to the RAP items) vs plan, items over plan; each row opens the project's RAP tab.
 * Data: the dashboard payload's `rapMonitoring` block (domain/rap/budget.ts rapMonitoring: caller's project read scope,
 * selected PTs — same rows as the APK home).
 */
export function RapMonitorCard({ data: d, i, span = 12 }: { data: RapMonitoringBlock; i: number; span?: 6 | 7 | 8 | 12 }) {
  return (
    <Card
      id="rap-monitor"
      title="Monitoring RAP"
      sub={d.projects === 0 ? 'Realisasi pengajuan per item RAP' : `${formatNumber(d.projects)} project ber-RAP · ${formatNumber(d.overProjects)} dengan item melebihi RAP`}
      span={span}
      i={i}
      action={{ href: '/admin/collections/projects', label: 'Semua project' }}
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
          { key: 'pl', label: 'Rencana', num: true, sec: true, cell: (r) => (r.planned === null ? '—' : rp(r.planned)) },
          { key: 're', label: 'Realisasi', num: true, cell: (r) => rp(r.realised) },
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

/**
 * DRMS 10/10 D4 (owner 2026-10-11 "RAP wajib untuk semua proyek yang punya RAB"): projects with a RAB (or konstruksi)
 * WITHOUT a RAP — their requests cannot be submitted. Direktur dashboard: every readable project of the selected PTs
 * (the owner has the PMs fill them); PM dashboard (`team`): the PM's team projects only (nudge). Renders nothing when
 * every such project has a RAP. Each row opens the project's RAP tab (template / Excel import). Data: the dashboard
 * payload's `rapMissing` block (`team` = PM layout).
 */
export function RapMissingCard({ data: d, i, span = 12 }: { data: RapMissingBlock; i: number; span?: 6 | 7 | 8 | 12 }) {
  const team = d.team
  if (d.total === 0) return null
  return (
    <Card
      id="rap-missing"
      title={team ? 'Project Anda belum punya RAP' : 'Project ber-RAB belum punya RAP'}
      sub={`${formatNumber(d.total)} project · pengajuan project ini belum bisa dikirim sampai RAP diisi${team ? '' : ' (minta PM mengisi)'}`}
      span={span}
      i={i}
    >
      <DataTable
        id="rap-missing"
        caption="Project ber-RAB tanpa RAP"
        rows={d.rows}
        rowKey={(r) => r.id}
        rowAttrs={(r) => ({ 'data-pk-rap-missing': String(r.id) })}
        empty={<EmptyState text="Semua project ber-RAB sudah punya RAP." />}
        cols={[
          {
            key: 'p',
            label: 'Project',
            cell: (r) => (
              <a href={`/admin/collections/projects/${r.id}/rap`}>
                {r.code} {r.name}
              </a>
            ),
          },
          { key: 'k', label: 'Jenis', sec: true, cell: (r) => r.kindLabel },
          { key: 'b', label: 'RAB', num: true, sec: true, cell: (r) => (r.budget === null ? '—' : <span title={rp(r.budget)}>{rp(r.budget)}</span>) },
          { key: 's', label: 'Status', cell: () => <StatusPill tone="warn" label="Isi RAP" /> },
        ]}
      />
    </Card>
  )
}
