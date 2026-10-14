import React from 'react'

import type { IntercompanyBlock } from '@/domain/reports/dashboards'

import { Card, DataTable, EmptyState, rp, StatusPill } from './viz'

/**
 * ADR 0029 §3.9 on the Owner / Direktur dashboard: "Dana tersedia per PT" (saldo tanpa akun site − komitmen, with the
 * PT's fund-check switch) and "Hutang / piutang antar-PT" (outstanding per PT). Data: the dashboard payload's
 * `intercompany` block (dashboards.ts intercompanyBlock — same numbers as GET /api/v1/dashboard/owner).
 */
export function IntercompanyCard({ data: d, codeOf, i, span = 12 }: { data: IntercompanyBlock; codeOf: (id: number) => string; i: number; span?: 6 | 7 | 8 | 12 }) {
  const pos = new Map(d.positions.map((p) => [p.companyId, p]))
  const rows = d.funds.map((f) => ({ ...f, pos: pos.get(f.companyId) ?? null }))
  return (
    <Card id="intercompany-funds" title="Dana tersedia & pinjaman antar-PT" sub="Dana tersedia = saldo akun tanpa site − komitmen (pengajuan disetujui belum ditransfer, kekurangan LPJ, perintah pinjaman)" span={span} i={i} action={{ href: '/admin/pinjaman-antar-pt', label: 'Pinjaman antar-PT' }}>
      <DataTable
        id="intercompany-funds"
        caption="Dana tersedia dan pinjaman antar-PT per PT"
        rows={rows}
        rowKey={(r) => r.companyId}
        rowAttrs={(r) => ({ 'data-pk-fund-company': String(r.companyId) })}
        empty={<EmptyState text="Tidak ada PT." />}
        cols={[
          { key: 'pt', label: 'PT', cell: (r) => <b>{codeOf(r.companyId)}</b> },
          { key: 'av', label: 'Dana tersedia', num: true, cell: (r) => <span title={`Saldo ${rp(r.balance)} − komitmen ${rp(r.commitments)}`}>{r.available < 0 ? <StatusPill tone="bad" label={rp(r.available)} /> : rp(r.available)}</span> },
          { key: 'ck', label: 'Cek dana', sec: true, cell: (r) => <StatusPill tone={r.fundCheckEnabled ? 'ok' : 'none'} label={r.fundCheckEnabled ? 'Aktif' : 'Belum aktif'} /> },
          { key: 'pi', label: 'Piutang antar-PT', num: true, cell: (r) => rp(r.pos?.receivable ?? 0) },
          { key: 'hu', label: 'Hutang antar-PT', num: true, cell: (r) => rp(r.pos?.payable ?? 0) },
          { key: 'od', label: 'Terlambat', cell: (r) => ((r.pos?.overdue ?? 0) > 0 ? <StatusPill tone="bad" label={rp(r.pos!.overdue)} /> : <StatusPill tone="ok" label="—" />) },
        ]}
      />
    </Card>
  )
}
