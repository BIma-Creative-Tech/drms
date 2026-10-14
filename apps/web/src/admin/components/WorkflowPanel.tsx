import type { UIFieldServerProps } from 'payload'
import React from 'react'

import { isContentEditable } from '@/domain/expense/types'
import { formatRupiah } from '@/lib/money'
import { formatServerTime } from '@/pdf/format'

import { ReasonAction } from './kas/ReasonAction'
import { KAS_STYLE } from './kas/style'
import { Act, RequesterActions, type RequesterActionsProps } from './RequesterActions'
import { ReviewDetails } from './ReviewDetails'
import { ChangeLog } from './request/ChangeLog'
import { FundPanel } from './request/FundPanel'
import { loadRequestPanel } from './request/panel-data'
import { RequestStepper } from './request/RequestStepper'
import { RequestSummary } from './request/RequestSummary'
import { LpjPhotoGrid } from './lpj/LpjPhotoGrid'

// Local copies of views/shared helpers: that module pulls the admin DefaultTemplate (not needed
// in a field component, and keeps this component renderable in integration tests).
const rp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatRupiah(v))
const badge = (tone: 'ok' | 'warn' | 'bad'): React.CSSProperties => ({
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  color: '#FFFFFF', // ≥ 4.5:1 on every --pk-tone-* (src/theme/tokens.ts)
  background: tone === 'ok' ? 'var(--pk-tone-ok)' : tone === 'warn' ? 'var(--pk-tone-warn)' : 'var(--pk-tone-bad)',
})

/** Requester-side actions surfaced in the web panel (F2c). Office actions stay in the work views. */
const REQUESTER_ACTIONS = ['submit', 'withdraw', 'cancel', 'resubmit', 'add_receipt', 'receipts_resubmit', 'receipts_complete', 'lpj_submit', 'complete'] as const

/**
 * ui field at the top of the expense-request edit view (F2c items 3 + 5) = the MAIN COLUMN of the request page
 * (DRMS 13/10 Persetujuan #3/#5–#7): header (number · type, PT badge, status, "Tahapan saat ini"), the read-only
 * "Rincian pengajuan" summary (every status — the page opens in read mode, "Edit" in the action bar switches the
 * Payload inputs on), the stepper again for the stacked layout (≤ 1024 px; on desktop it is the right column,
 * StepperField), "Rincian item" with receipts and flags, transfers, LPJ, the requester actions (creator /
 * requesters: `allowedActions` of the domain DTO, the same guard the service enforces) and "Log perubahan".
 * Decisions, "Cetak" and "Duplikat" are in the action bar (RequestActionBar). Sections marked `data-pk-read` belong
 * to read mode (custom.scss hides them while the form is edited). Actions call the existing /api/v1 endpoints
 * (guards, audit, idempotency, notifications unchanged). Data: panel-data.ts (fresh req + transaction as the
 * logged-in user; visibility = collection read access), read once per render for the three page parts.
 */
export async function WorkflowPanel(props: UIFieldServerProps) {
  const { req, id } = props
  const docId = Number(id)
  if (!id || !Number.isSafeInteger(docId) || !req.user) {
    return (
      // DRMS 10/10 8i: short help on create (the APK editor shows none).
      <div className="field-type" data-pk-panel="workflow-create" style={{ fontSize: 13, color: 'var(--theme-elevation-700)' }}>
        Isi lalu <strong>Simpan</strong> sebagai Draft; tombol <em>Kirim pengajuan</em> muncul setelah tersimpan.
      </div>
    )
  }
  const data = await loadRequestPanel(req.payload, req.user, docId)
  // Not visible (404) → the document view itself already denies; anything else is logged by the loader.
  if (!data) return null
  const { d, hasSignature, todayDate, tz, office, own, ptName, pt, attachments, stepper } = data
  const next = d.nextActor
  // Requester panel only for the request's creator / requesters (office actions such as a Finance
  // cancel after approval stay in the work views).
  const acts = (own ? d.allowedActions.filter((a) => (REQUESTER_ACTIONS as readonly string[]).includes(a)) : []) as RequesterActionsProps['actions']
  const box: React.CSSProperties = { border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 12, marginBottom: 16, fontSize: 13 }
  // DRMS 13/10 Persetujuan #4: no "Keputusan siklus sebelumnya" list — earlier cycles stay in "Log perubahan" / "Riwayat"
  return (
    <div className="field-type pk-er-panel" data-pk-panel="workflow">
      <section style={box} data-pk-section="header">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <strong style={{ fontSize: 15 }}>
            {d.docNo ?? `Draft #${d.id}`} · {d.typeLabel}
          </strong>
          {/* DRMS 13/10 Persetujuan #8: the PT as a small badge (custom.scss .pk-pt-badge), no "PT:" label */}
          {pt ? (
            <span className="pk-pt-badge" title={pt.name ?? undefined} data-pk-company-inline={pt.shortCode}>
              <span className="pk-pt-chip">{pt.shortCode}</span>
              {pt.name ? <span className="pk-pt-badge__name">{pt.name}</span> : null}
            </span>
          ) : null}
          <span style={badge(d.status === 'rejected' || d.status === 'cancelled' ? 'bad' : d.status === 'completed' ? 'ok' : 'warn')}>{d.statusLabel}</span>
          {/* DRMS 13/10 Persetujuan #10: the grand total is the footer row of "Rincian item"; #5: the other totals are in the summary */}
        </div>
        {d.resubmitOf ? (
          // F2e: the previous request by NUMBER + title (UAT: "Pengajuan ulang dari" showed only a title).
          <div data-pk-resubmit-of={d.resubmitOf.id} style={{ marginTop: 6 }}>
            Pengajuan ulang dari{' '}
            <a href={`/admin/collections/expense-requests/${d.resubmitOf.id}`}>
              <strong>{d.resubmitOf.docNo ?? `#${d.resubmitOf.id}`}</strong>
            </a>{' '}
            — {d.resubmitOf.title}
          </div>
        ) : null}
        {next ? (
          // DRMS 13/10 Persetujuan #9: "Tahapan saat ini" instead of "Giliran"
          <div data-pk-next-actor style={{ marginTop: 6 }}>
            Tahapan saat ini: <strong>{next.who}</strong> — {next.what}.
          </div>
        ) : (
          <div style={{ marginTop: 6 }}>Tidak ada aksi lanjutan (status akhir).</div>
        )}
        {!own && d.allowedActions.includes('complete') ? (
          // QA-19: the turn text names "Pemohon atau Finance" — Finance confirms the Reimburse "selesai" here
          // (state.ts: complete = own || Finance); the requester gets the same button in its panel below.
          <div style={{ marginTop: 8 }} data-pk-finance-complete>
            <Act testId="complete" label="Konfirmasi selesai" url={`/api/v1/expense-requests/${d.id}/complete`} confirm="Dana sudah diterima pemohon? Tandai pengajuan selesai." success="Pengajuan ditandai selesai." />
          </div>
        ) : null}
        {d.allowedActions.includes('settle_reverse') && d.settlement ? (
          // E9: Finance reverses the LPJ settlement (void refund KM / shortfall transfer) → "LPJ Terverifikasi".
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }} data-pk-settle-reverse>
            <style>{KAS_STYLE}</style>
            <ReasonAction
              url={`/api/v1/expense-requests/${d.id}/settle/reverse`}
              label="Batalkan penyelesaian LPJ"
              title={`Batalkan penyelesaian LPJ ${d.settlement.docNo ?? ''}?`}
              description={
                d.settlement.settlementType === 'refund'
                  ? `Kas masuk pengembalian ${rp(d.settlement.difference ?? 0)} di-void (jurnal balik), LPJ kembali ke Terverifikasi dan dapat diselesaikan ulang. Ditolak bila periode transaksinya sudah ditutup.`
                  : `Transfer kekurangan ${rp(-(d.settlement.difference ?? 0))} di-void dan KK-nya dibalik, LPJ kembali ke Terverifikasi dan dapat diselesaikan ulang. Ditolak bila periode transaksinya sudah ditutup.`
              }
              confirmLabel="Batalkan penyelesaian"
              testId="settle-reverse"
            />
          </div>
        ) : null}
        {d.rejectReason ? <div style={{ marginTop: 6, color: 'var(--theme-error-500)' }}>Alasan ditolak: {d.rejectReason}</div> : null}
        {d.cancelReason ? <div style={{ marginTop: 6 }}>Alasan batal: {d.cancelReason}</div> : null}
      </section>
      {/* ADR 0029 §2: "Ketersediaan dana PT" (Kas roles of the PT; waiting request or the Owner's own Draft) */}
      <div data-pk-read>
        <FundPanel d={d} />
      </div>
      <div data-pk-read>
        {/* B-2 item 3 / Persetujuan #7: read-only summary on every status (the read mode of a Draft too) */}
        <RequestSummary d={d} ptName={ptName} attachments={attachments} canRevealBank={own || office} draftBank={data.draftBank} />
      </div>
      {/* Persetujuan #3 + layout: the stepper after the summary in the stacked layout (desktop: right column) */}
      <div data-pk-read className="pk-er-stepper-inline">
        <RequestStepper stepper={stepper} tz={tz} variant="inline" note={data.stepperNote} ruleName={data.ruleName} />
      </div>
      {d.lines.length > 0 || !isContentEditable(d.status) ? (
        // S3e (US-26/US-59, S-05): lines, receipts and per-line flags. DRMS 10/10 9a: ONE lines table
        // for everyone incl. the requester; Persetujuan #7: the Draft's read mode too (edit mode: LinesTableField).
        <section style={box} id="review" data-pk-section="review" data-pk-read>
          <ReviewDetails d={d} title="Rincian item" />
        </section>
      ) : null}
      {d.transfers.length > 0 ? (
        // DRMS 10/10 12b: transfer (TRF) and its cash-out (KK) numbers link to their detail.
        <section style={box} data-pk-section="transfers" data-pk-read>
          <strong>Transfer</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }} data-pk-transfers>
            {d.transfers.map((t) => (
              <li key={t.id}>
                <a href={`/admin/collections/transfers/${t.id}`}>{t.docNo}</a> · {t.transferDate} · {rp(t.amount)}
                {t.costCenter ? ` · ${[t.costCenter.code, t.costCenter.name].filter(Boolean).join(' ')}` : ''}
                {t.status !== 'posted' ? ` · ${t.status === 'void' ? 'Void' : t.status}` : ''}
                {t.cashEntryId && office ? (
                  <>
                    {' '}
                    · <a href={`/admin/collections/cash-entries/${t.cashEntryId}`}>KK</a>
                  </>
                ) : null}
                {t.proofId ? (
                  <>
                    {' '}
                    ·{' '}
                    <a href={`/api/v1/media/transfer-proofs/${t.proofId}/file`} target="_blank" rel="noopener noreferrer" data-pk-lightbox={`transfer-${d.id}`} data-pk-lightbox-title={`Bukti transfer ${t.docNo}`}>
                      bukti
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {d.allowedActions.includes('transfer_void') ? (
            // E2 (US-24, T8): Finance voids a recorded transfer from the request detail (reason dialog).
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }} data-pk-transfer-void>
              <style>{KAS_STYLE}</style>
              {d.transfers
                .filter((t) => t.status === 'posted' && (t.kind === 'advance' || t.kind === 'reimburse'))
                .map((t) => (
                  <ReasonAction
                    key={t.id}
                    url={`/api/v1/expense-requests/${d.id}/transfers/${t.id}/void`}
                    label={`Void transfer ${t.docNo}`}
                    title={`Void transfer ${t.docNo}?`}
                    description={`KK transfer ${rp(t.amount)} dibalik dengan jurnal balik, transfer ditandai Void, dan pengajuan kembali ke ${d.type === 'advance' ? 'Disetujui (Antri Transfer)' : 'Nota Terverifikasi (Antri Transfer)'}.`}
                    confirmLabel="Void transfer"
                    testId={`void-transfer-${t.id}`}
                  />
                ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {!own && d.settlement ? (
        // point 13: the LPJ (incl. its photos) for office readers of the request; the requester sees it in its panel
        <section style={box} data-pk-section="lpj" data-pk-read>
          <strong>
            LPJ{' '}
            {d.settlement.docNo ? <a href={`/admin/collections/settlements/${d.settlement.id}`}>{d.settlement.docNo}</a> : null}
          </strong>{' '}
          · {d.settlement.statusLabel} · total nota {rp(d.settlement.receiptsTotal)} · selisih {rp(d.settlement.difference)}
          {d.settlement.usageNotes ? <div style={{ marginTop: 4 }}>Uraian penggunaan: {d.settlement.usageNotes}</div> : null}
          <LpjPhotoGrid ids={d.settlement.photos} group={`lpj-photos-${d.id}`} label="Foto LPJ" />
        </section>
      ) : null}
      {own ? (
        // Persetujuan #7: requester actions (Kirim pengajuan, nota, LPJ …) belong to read mode — save the edit first
        <div data-pk-read data-pk-requester-actions>
          <RequesterActions
            id={d.id}
            type={d.type}
            status={d.status}
            actions={acts}
            profileHref={`/admin/collections/users/${req.user.id}`}
            hasSignature={hasSignature}
            today={todayDate}
            lines={d.lines.map((l) => ({ id: l.id, no: l.no, description: l.description ?? '', total: l.total, incomplete: isContentEditable(d.status) && l.unitPrice === null }))}
            receipts={d.receipts.map((r) => ({
              ...r,
              flags: d.flags.filter((f) => f.receiptId === r.id).map((f) => ({ id: f.id, label: f.kindLabel, level: f.level, message: f.message, status: f.status })),
            }))}
            requestFlags={d.flags.filter((f) => f.receiptId === null).map((f) => ({ id: f.id, label: f.kindLabel, level: f.level, message: f.message, status: f.status, lineNo: f.lineNo }))}
            settlement={
              d.settlement
                ? { docNo: d.settlement.docNo, statusLabel: d.settlement.statusLabel, usageNotes: d.settlement.usageNotes, financeNotes: d.settlement.financeNotes, receiptsTotal: d.settlement.receiptsTotal, difference: d.settlement.difference, submitCount: d.settlement.submitCount, photos: d.settlement.photos }
                : null
            }
          />
        </div>
      ) : null}
      {/* Persetujuan #6/#13: change log (who / when / what) with the created / last-changed times */}
      <div data-pk-read>
        <ChangeLog entries={data.history} created={data.createdAt ? formatServerTime(data.createdAt, tz) : null} updated={data.updatedAt ? formatServerTime(data.updatedAt, tz) : null} />
      </div>
    </div>
  )
}

export default WorkflowPanel
