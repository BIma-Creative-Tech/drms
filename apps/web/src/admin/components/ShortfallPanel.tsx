import React from 'react'

import type { ShortfallSummary } from '@/domain/expense/shortfall-approval'
import { formatRupiah } from '@/lib/money'

import { ReasonAction } from './kas/ReasonAction'

/**
 * QA-06 / ADR 0019 on "Verifikasi LPJ": the shortfall would make the total transfer exceed the approved
 * amount + tolerance. Shows the figures and the re-approval state (Direktur → Finance); Finance asks for
 * the "persetujuan kekurangan" (reason required). The settle form is shown again by the host view once
 * `settleAllowed` (within tolerance or approved). Styles: KAS_STYLE (ReasonAction dialog).
 */
export function ShortfallPanel({ requestId, sa, canRequest }: { requestId: number; sa: ShortfallSummary; canRequest: boolean }) {
  const running = sa.status === 'pending_ack' || sa.status === 'pending_approval'
  return (
    <div role="note" data-pk-shortfall={requestId} style={{ margin: '6px 0', padding: '8px 10px', borderLeft: '3px solid var(--pk-tone-warn)', background: 'var(--theme-elevation-50)', fontSize: 13 }}>
      <p style={{ margin: 0 }}>
        <strong>Perlu persetujuan kekurangan.</strong> Total transfer menjadi <strong>{formatRupiah(sa.totalAfter)}</strong>, melebihi nominal disetujui {formatRupiah(sa.approvedAmount)} + toleransi{' '}
        {sa.tolerancePct}% (maks. {formatRupiah(sa.limit)}).
      </p>
      {sa.status ? (
        <p style={{ margin: '4px 0 0' }} data-pk-shortfall-status={sa.status}>
          Status: <strong>{sa.statusLabel}</strong>
          {sa.note ? ` · Alasan Finance: ${sa.note}` : ''}
          {sa.status === 'rejected' && sa.rejectReason ? ` · Ditolak: ${sa.rejectReason}` : ''}
        </p>
      ) : null}
      {sa.decisions.length > 0 ? (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {sa.decisions.map((d, i) => (
            <li key={i}>
              Siklus {d.cycle} · {d.position === 'diketahui' ? 'Direktur' : `Finance level ${d.level}`}: {d.decision === 'rejected' ? 'menolak' : 'menyetujui'} — {d.actorName ?? '—'}
              {d.reason ? ` (${d.reason})` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {canRequest && !running ? (
        <div style={{ marginTop: 6 }}>
          <ReasonAction
            url={`/api/v1/expense-requests/${requestId}/lpj/shortfall-approval`}
            field="note"
            fieldLabel="Alasan kekurangan"
            variant="primary"
            label={sa.status === 'rejected' ? 'Ajukan ulang persetujuan kekurangan' : 'Ajukan persetujuan kekurangan'}
            title="Ajukan persetujuan kekurangan LPJ"
            description={
              <>
                Total transfer {formatRupiah(sa.totalAfter)} akan disetujui ulang lewat alur approval pengajuan (Direktur → Finance). Transfer kekurangan baru dapat dicatat setelah
                disetujui.
              </>
            }
            confirmLabel="Ajukan"
            testId={`shortfall-request-${requestId}`}
          />
        </div>
      ) : null}
      {running ? <p style={{ margin: '4px 0 0' }}>Keputusan diberikan di menu Persetujuan (web).</p> : null}
    </div>
  )
}

export default ShortfallPanel
