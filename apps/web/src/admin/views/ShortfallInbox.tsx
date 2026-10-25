import type { PayloadRequest } from 'payload'
import React from 'react'

import { ActionButton } from '@/admin/components/ActionButton'
import { KAS_STYLE } from '@/admin/components/kas/style'
import { Panel } from '@/admin/components/ui/nexus'
import { shortfallInbox } from '@/domain/expense/shortfall-approval'
import { withReqTransaction } from '@/lib/system-tx'

import { F3Root } from './f3-ui'
import { DataTable, EmptyState, rp, StatusPill, VIZ_STYLE } from './viz'

/**
 * QA-06 / ADR 0019 on "Persetujuan": LPJ shortfalls above approved + tolerance waiting for the caller's
 * decision — Direktur "Setujui" (Diketahui) then Finance approval, reject with a reason. Rendered only
 * when there is something to decide (the section stays out of the way otherwise).
 * DRMS 24/10: the popups name the request / LPJ with the figures (`doc`).
 */
export async function ShortfallInboxSection({ req }: { req: PayloadRequest }) {
  const { items } = await withReqTransaction(req, () => shortfallInbox(req))
  if (items.length === 0) return null
  const base = (id: number) => `/api/v1/expense-requests/${id}/lpj/shortfall-approval`
  const doc = (r: (typeof items)[number]) => ({
    object: `kekurangan ${r.docNo ?? `#${r.requestId}`}`,
    summary: [['Pengajuan', r.docNo ?? `#${r.requestId}`], ['Judul', r.title], ['LPJ', r.lpjNo], ['Disetujui', rp(r.approvedAmount)], ['Kekurangan', rp(r.shortfall)], ['Total transfer', rp(r.totalAfter)], ['Langkah', r.stepLabel]] as const,
  })
  return (
    <F3Root name="shortfall-inbox">
      <style>{VIZ_STYLE}</style>
      <style>{KAS_STYLE}</style>
      <Panel id="kekurangan-lpj" icon="tReceiptSearch" title="Kekurangan LPJ di atas nominal disetujui" data-pk-inbox="shortfall">
        <DataTable
          id="shortfall-inbox"
          caption="Persetujuan kekurangan LPJ yang menunggu keputusan saya"
          rows={items}
          rowKey={(r) => r.settlementId}
          cols={[
            {
              key: 'no',
              label: 'Pengajuan',
              cell: (r) => (
                <>
                  <a href={`/admin/collections/expense-requests/${r.requestId}`}>{r.docNo ?? `#${r.requestId}`}</a>
                  <span className="sub">
                    {r.title}
                    {r.lpjNo ? ` · ${r.lpjNo}` : ''}
                  </span>
                  {r.note ? <span className="sub">Alasan Finance: {r.note}</span> : null}
                </>
              ),
            },
            { key: 'appr', label: 'Disetujui', num: true, sec: true, cell: (r) => rp(r.approvedAmount) },
            { key: 'sf', label: 'Kekurangan', num: true, cell: (r) => rp(r.shortfall) },
            {
              key: 'tot',
              label: 'Total transfer',
              num: true,
              cell: (r) => (
                <>
                  <b>{rp(r.totalAfter)}</b>
                  <span className="sub">
                    maks. tanpa persetujuan {rp(r.limit)} ({r.tolerancePct}%)
                  </span>
                </>
              ),
            },
            { key: 'step', label: 'Langkah', cell: (r) => <StatusPill tone="wait" label={r.stepLabel} /> },
            {
              key: 'act',
              label: 'Aksi',
              cell: (r) => (
                <div className="pk-kact">
                  {/* Same app dialog (ActionDialog via ActionButton, QA-22/QA-23) as the request decisions above */}
                  <ActionButton
                    url={`${base(r.requestId)}/${r.step}`}
                    label="Setujui"
                    variant="primary"
                    confirm={`Setujui kekurangan ${r.docNo ?? `#${r.requestId}`}? Total transfer menjadi ${rp(r.totalAfter)} (disetujui ${rp(r.approvedAmount)}). ${
                      r.step === 'acknowledge' ? 'Berikutnya approval Finance.' : 'Transfer kekurangan dapat dicatat Finance setelah langkah terakhir.'
                    }`}
                    {...doc(r)}
                    testId={`shortfall-inbox-${r.step}-${r.requestId}`}
                  />
                  <ActionButton
                    url={`${base(r.requestId)}/reject`}
                    label="Tolak"
                    confirm="Transfer kekurangan tidak dapat dicatat. Alasan dikirim ke Finance."
                    prompt={{ field: 'reason', message: 'Alasan penolakan kekurangan (wajib, minimal 3 karakter):', minLength: 3 }}
                    {...doc(r)}
                    testId={`shortfall-inbox-reject-${r.requestId}`}
                  />
                </div>
              ),
            },
          ]}
          empty={<EmptyState text="Tidak ada kekurangan LPJ yang menunggu keputusan Anda." />}
        />
      </Panel>
    </F3Root>
  )
}

export default ShortfallInboxSection
