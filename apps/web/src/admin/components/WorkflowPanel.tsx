import type { UIFieldServerProps } from 'payload'
import React from 'react'

import { hasRole, ownEmployees, relId } from '@/access/roles'
import { companyById } from '@/domain/companies'
import { buildApprovalTimeline, g1ExceptionText } from '@/domain/expense/approval-timeline'
import { displayName, ids, loadVisible, today } from '@/domain/expense/common'
import { isContentEditable } from '@/domain/expense/types'
import { detail } from '@/domain/expense/dto'
import { isDecisionSnapshot } from '@/domain/expense/decision'
import { decisionText } from '@/domain/expense/decision-texts'
import { lastLevel, type ApprovalSnapshot } from '@/domain/expense/rules'
import { ackStepLabel, approvalStepLabel, decisionByOf, nextActor, timeline } from '@/domain/expense/timeline'
import { formatRupiah } from '@/lib/money'
import { withSystemTransaction } from '@/lib/system-tx'

import { ApprovalTimeline } from './ApprovalTimeline'
import { DecisionBar } from './DecisionBar'
import { ReasonAction } from './kas/ReasonAction'
import { KAS_STYLE } from './kas/style'
import { Act, RequesterActions, type RequesterActionsProps } from './RequesterActions'
import { ReviewDetails } from './ReviewDetails'
import { RequestSummary } from './request/RequestSummary'
import { LpjPhotoGrid } from './lpj/LpjPhotoGrid'

type Detail = Awaited<ReturnType<typeof detail>>

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
 * ui field at the top of the expense-request edit view (F2c items 3 + 5): status timeline with the
 * NEXT expected actor for everyone who can read the request, and — for its creator/requesters only
 * — the requester actions the state machine allows now (`allowedActions` of the domain DTO, the
 * same guard the service enforces). Actions call the existing /api/v1 endpoints (guards, audit,
 * idempotency, notifications unchanged). Read in a fresh req + transaction (SYSTEM tx pattern of
 * the work views) as the logged-in user; visibility = collection read access (loadVisible).
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
  let data: {
    d: Detail
    snap: ApprovalSnapshot | null
    names: Record<number, string>
    hasSignature: boolean
    todayDate: string
    tz: string
    office: boolean
    ptName: string | null
    attachments: Array<{ id: number; name: string }>
  } | null = null
  try {
    data = await withSystemTransaction(req.payload, req.user, async (r) => {
      const doc = await loadVisible(r, docId)
      const d = await detail(r, docId)
      const snap = (doc.approvalSnapshot ?? null) as ApprovalSnapshot | null
      const names: Record<number, string> = {}
      const userIds = [snap?.acknowledgerUserId, ...(snap?.steps ?? []).map((s) => s.approverUserId)].filter((x): x is number => typeof x === 'number')
      for (const u of new Set(userIds)) names[u] = await displayName(r, u)
      const me = await r.payload.findByID({ collection: 'users', id: req.user!.id as number, depth: 0, overrideAccess: true /* SYSTEM-READ: own profile signature flag */, req: r })
      const company = relId((doc as { company?: unknown }).company)
      const pt = company !== undefined ? await companyById(r, company) : null
      const tz = pt?.timezone ?? 'Asia/Makassar'
      // B-2 item 3: "Lampiran" of the read-only summary (file names; the files open through the authorized media endpoint)
      const attIds = ids((doc as { attachments?: unknown[] | null }).attachments ?? null)
      const attachments = attIds.length
        ? (
            await r.payload.find({ collection: 'media-attachments', where: { id: { in: attIds } }, depth: 0, pagination: false, select: { filename: true }, overrideAccess: true /* SYSTEM-READ: names of a visible request's attachments */, req: r })
          ).docs.map((m) => ({ id: m.id as number, name: String((m as { filename?: string }).filename ?? `Lampiran #${String(m.id)}`) }))
        : []
      // KK (cash entries) are readable by Finance/Direktur/Admin of the PT only → link them only for those
      const office = hasRole(r, ['pk-finance', 'pk-owner', 'pk-admin'], company)
      return { d, snap, names, hasSignature: relId(me.signature) !== undefined, todayDate: await today(r, company), tz, office, ptName: pt ? [pt.shortCode, pt.name].filter(Boolean).join(' · ') : null, attachments }
    })
  } catch (err) {
    // Not visible (404) → the document view itself already denies; anything else is logged.
    const status = (err as { status?: number }).status
    if (status !== 404) req.payload.logger.error({ msg: 'workflow panel failed', id: docId, err: (err as Error).message })
    return null
  }
  const { d, snap, names, hasSignature, todayDate, tz, office, ptName, attachments } = data
  const steps = timeline(d.type, d.status, { skipAck: snap?.acknowledge === 'none', snapshot: snap, currentLevel: d.currentLevel ?? null })
  const next = nextActor({
    type: d.type,
    status: d.status,
    currentLevel: d.currentLevel,
    snapshot: snap,
    requesters: d.requesters.map((r) => (r && 'name' in r ? String(r.name ?? '') : '')).filter(Boolean).join(', '),
    names,
  })
  // Requester panel only for the request's creator / requesters (office actions such as a Finance
  // cancel after approval stay in the work views).
  const own = isOwn(d, req.user)
  const acts = (own ? d.allowedActions.filter((a) => (REQUESTER_ACTIONS as readonly string[]).includes(a)) : []) as RequesterActionsProps['actions']
  const box: React.CSSProperties = { border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 12, marginBottom: 16, fontSize: 13 }
  // DRMS 10/10 9c: readable approval timeline (APK turn_timeline.dart) instead of the raw snapshot.
  const approvalSteps = buildApprovalTimeline({
    type: d.type,
    status: d.status,
    approvalCycle: d.approvalCycle,
    currentLevel: d.currentLevel,
    submittedAt: d.submittedAt,
    snapshot: snap,
    approvals: d.approvals,
    transfers: d.transfers,
    requesters: d.requesters.map((r) => (r && 'name' in r ? String(r.name ?? '') : '')).filter(Boolean).join(', '),
    createdBy: d.createdBy && 'name' in d.createdBy ? String(d.createdBy.name ?? '') : null,
    names,
  })
  const olderDecisions = d.approvals.filter((a) => a.cycle !== d.approvalCycle)
  // DRMS 10/10 9d: decision bar when the server allows a decision now (same texts as the inbox).
  const decideStep = d.allowedActions.includes('approve') ? 'approve' : d.allowedActions.includes('acknowledge') ? 'acknowledge' : null
  const canReject = d.allowedActions.includes('reject')
  const level = d.currentLevel ?? 1
  const decision = decideStep
    ? decisionText({
        step: decideStep,
        docNo: d.docNo,
        grandTotal: d.grandTotal,
        decisionFlow: isDecisionSnapshot(snap),
        decisionBy: decisionByOf(snap, decideStep, decideStep === 'acknowledge' ? 0 : level),
        finalStep: snap ? (decideStep === 'acknowledge' ? lastLevel(snap) === 0 : level >= lastLevel(snap)) : false,
      })
    : null
  const decideLabel = decideStep === 'approve' || (!decideStep && d.status === 'pending_approval') ? approvalStepLabel(snap, level) : ackStepLabel(snap)
  return (
    <div className="field-type" data-pk-panel="workflow">
      <section style={box}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <strong style={{ fontSize: 15 }}>
            {d.docNo ?? `Draft #${d.id}`} · {d.typeLabel}
          </strong>
          <span style={badge(d.status === 'rejected' || d.status === 'cancelled' ? 'bad' : d.status === 'completed' ? 'ok' : 'warn')}>{d.statusLabel}</span>
          <span>
            Grand total <strong>{rp(d.grandTotal)}</strong>
            {d.approvedAmount !== null ? <> · disetujui {rp(d.approvedAmount)}</> : null}
            {d.transferredTotal ? <> · ditransfer {rp(d.transferredTotal)}</> : null}
          </span>
        </div>
        <ol style={{ display: 'flex', flexWrap: 'wrap', gap: 4, listStyle: 'none', padding: 0, margin: '10px 0' }} aria-label="Timeline status">
          {steps.map((s, i) => (
            <li key={`${s.status}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: s.state === 'current' ? 700 : 400,
                  background: s.state === 'current' ? 'var(--pk-primary)' : s.state === 'done' ? 'var(--theme-elevation-150)' : 'transparent',
                  color: s.state === 'current' ? 'var(--pk-on-primary)' : s.state === 'todo' ? 'var(--theme-elevation-500)' : 'inherit',
                  border: s.state === 'todo' ? '1px dashed var(--theme-elevation-300)' : '1px solid transparent',
                }}
                aria-current={s.state === 'current' ? 'step' : undefined}
              >
                {s.state === 'done' ? '✓ ' : ''}
                {s.label}
              </span>
              {i < steps.length - 1 ? <span aria-hidden>›</span> : null}
            </li>
          ))}
        </ol>
        {d.resubmitOf ? (
          // F2e: the previous request by NUMBER + title (UAT: "Pengajuan ulang dari" showed only a title).
          <div data-pk-resubmit-of={d.resubmitOf.id} style={{ marginBottom: 6 }}>
            Pengajuan ulang dari{' '}
            <a href={`/admin/collections/expense-requests/${d.resubmitOf.id}`}>
              <strong>{d.resubmitOf.docNo ?? `#${d.resubmitOf.id}`}</strong>
            </a>{' '}
            — {d.resubmitOf.title}
          </div>
        ) : null}
        {next ? (
          <div data-pk-next-actor>
            Giliran: <strong>{next.who}</strong> — {next.what}.
          </div>
        ) : (
          <div>Tidak ada aksi lanjutan (status akhir).</div>
        )}
        {d.type === 'reimburse' && d.allowedActions.includes('verify_receipts') ? (
          // F2d: Finance verifies Reimburse receipts in the Antrian Transfer view (US-39).
          <div style={{ marginTop: 6 }}>
            <a href={`/admin/antrian-transfer#reimburse-${d.id}`} data-pk-link="receipt-review">
              Verifikasi nota Reimburse (Antrian Transfer) →
            </a>
          </div>
        ) : null}
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
        {d.status !== 'draft' ? (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--theme-elevation-100)' }}>
            <ApprovalTimeline steps={approvalSteps} tz={tz} note={g1ExceptionText(snap?.selfApproval)} />
          </div>
        ) : null}
        {d.transfers.length > 0 ? (
          // DRMS 10/10 12b: transfer (TRF) and its cash-out (KK) numbers link to their detail.
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12 }} data-pk-transfers>
            {d.transfers.map((t) => (
              <li key={t.id}>
                Transfer <a href={`/admin/collections/transfers/${t.id}`}>{t.docNo}</a> · {t.transferDate} · {rp(t.amount)}
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
        ) : null}
        {olderDecisions.length > 0 ? (
          <details style={{ marginTop: 8, fontSize: 12 }}>
            <summary style={{ cursor: 'pointer' }}>Keputusan siklus sebelumnya ({olderDecisions.length})</summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {olderDecisions.map((a) => (
                <li key={a.id}>
                  siklus {a.cycle} · {POSITION_LABELS[a.position] ?? a.position}
                  {a.position === 'approval' ? ` L${a.level}` : ''}: {a.actorName ?? '—'} — {DECISION_LABELS[a.decision] ?? a.decision}
                  {a.onBehalf ? ' (diwakili)' : ''}
                  {a.reason ? ` — ${a.reason}` : ''}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      {!isContentEditable(d.status) ? (
        // B-2 item 3: header of a locked request as a read-only summary (the header inputs are hidden then)
        <RequestSummary d={d} ptName={ptName} attachments={attachments} canRevealBank={own || office} />
      ) : null}
      {d.status !== 'draft' ? (
        // S3e (US-26/US-59, S-05): lines, receipts and per-line flags. DRMS 10/10 9a: ONE lines table
        // for everyone incl. the requester; the Payload line cards are hidden after submit.
        <section style={box} id="review" data-pk-section="review">
          <ReviewDetails d={d} title="Rincian item" />
        </section>
      ) : null}
      {!own && d.settlement ? (
        // point 13: the LPJ (incl. its photos) for office readers of the request; the requester sees it in its panel
        <section style={box} data-pk-section="lpj">
          <strong>
            LPJ{' '}
            {d.settlement.docNo ? <a href={`/admin/collections/settlements/${d.settlement.id}`}>{d.settlement.docNo}</a> : null}
          </strong>{' '}
          · {d.settlement.statusLabel} · total nota {rp(d.settlement.receiptsTotal)} · selisih {rp(d.settlement.difference)}
          {d.settlement.usageNotes ? <div style={{ marginTop: 4 }}>Uraian penggunaan: {d.settlement.usageNotes}</div> : null}
          <LpjPhotoGrid ids={d.settlement.photos} group={`lpj-photos-${d.id}`} label="Foto LPJ" />
        </section>
      ) : null}
      {decideStep || canReject ? <DecisionBar id={d.id} step={decideStep} label={decision?.label ?? 'Setujui'} confirm={decision?.confirm ?? ''} canReject={canReject} stepLabel={decideLabel} /> : null}
      {own ? (
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
      ) : null}
    </div>
  )
}

function isOwn(d: Detail, user: { id?: unknown }): boolean {
  if (d.createdById === user.id) return true
  // ADR 0016: one employee per PT membership — any of them counts (each belongs to one PT).
  const emps = ownEmployees({ user } as never)
  return d.requesters.some((r) => r?.id !== undefined && emps.includes(r.id))
}

const POSITION_LABELS: Record<string, string> = { diajukan: 'Pemohon', dibuat: 'Dibuat oleh', diketahui: 'Diketahui', approval: 'Approval' }
const DECISION_LABELS: Record<string, string> = { signed: 'tanda tangan', acknowledged: 'diketahui', approved: 'disetujui', rejected: 'ditolak' }

export default WorkflowPanel
