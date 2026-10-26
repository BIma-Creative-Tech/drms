import type { RequestPanel } from './panel-data'

/** Props of the request page's action bar (RequestActionsClient). Pure module (unit-tested). */
export type RequestActionsProps = {
  id: number
  decision: { step: 'acknowledge' | 'approve' | null; label: string; confirm: string; canReject: boolean; stepLabel: string; signAs?: string | null; blocked?: string | null } | null
  /** Finance flow links of this request (Catat transfer, Verifikasi nota) — the work happens in the queue views. */
  flowLinks: Array<{ href: string; label: string; testId: string }>
  /** "Cetak": one link, or a menu when there are several PDFs (internal copy for the office roles). */
  pdfs: Array<{ href: string; label: string }>
  canDuplicate: boolean
  /**
   * D1810: "Batalkan pengajuan" for the office (Finance / Direktur) — e.g. Finance cancels an approved request before the
   * transfer when the cash really approved in the field differs. Reason mandatory. D2410: Finance stage only, also on the
   * office user's own request (the requester panel has no cancel any more → exactly one button on the page).
   */
  canCancel: boolean
  /** UI feedback 17/10 #2: "Riwayat" (the request's history page, /riwayat) — a button here instead of a document tab. */
  historyHref: string
  /**
   * DRMS 26/10 #1: "Instruksi pinjam antar proyek" next to the disabled "Setujui" — the server lists
   * `instruct_project_loan` (final decider, the project's cash account short, no instructed loan waiting).
   */
  instructProjectLoan?: boolean
  docNo?: string | null
}

/**
 * DRMS 13/10 Persetujuan #5/#12: the action bar from the request as the caller reads it. Finance flow: "Catat
 * transfer" when the transfer is due (Antrian Transfer records it), "Verifikasi nota" for a Reimburse in
 * verification. PDFs (M16, US-46): only for a numbered request; the internal copy (validation flags) for the office
 * roles of the request's PT (the endpoint re-checks). "Duplikat": see panel-data `canDuplicate`. "Riwayat": every
 * reader, every status (the history view re-checks read access). "Batalkan pengajuan": `cancel` in the server's
 * `allowedActions` (D2410, state.ts: Finance stage only, office roles only — whether or not they are creator / requester).
 */
export function actionBarProps(p: Pick<RequestPanel, 'd' | 'office' | 'canDuplicate' | 'decision'> & { own?: boolean }): RequestActionsProps {
  const { d } = p
  const flowLinks: RequestActionsProps['flowLinks'] = []
  if (d.allowedActions.includes('transfer')) flowLinks.push({ href: d.type === 'reimburse' ? `/admin/antrian-transfer#reimburse-${d.id}` : '/admin/antrian-transfer', label: 'Catat transfer', testId: 'transfer' })
  else if (d.type === 'reimburse' && d.allowedActions.includes('verify_receipts')) flowLinks.push({ href: `/admin/antrian-transfer#reimburse-${d.id}`, label: 'Verifikasi nota', testId: 'receipt-review' })
  const pdfs = d.docNo
    ? [{ href: `/api/v1/expense-requests/${d.id}/pdf`, label: 'PDF Pengajuan Biaya' }, ...(p.office ? [{ href: `/api/v1/expense-requests/${d.id}/pdf?variant=internal`, label: 'PDF salinan internal (flag)' }] : [])]
    : []
  return {
    id: d.id,
    decision: p.decision,
    flowLinks,
    pdfs,
    canDuplicate: p.canDuplicate,
    canCancel: d.allowedActions.includes('cancel'),
    historyHref: `/admin/collections/expense-requests/${d.id}/riwayat`,
    instructProjectLoan: (d.allowedActions as readonly string[]).includes('instruct_project_loan'),
    docNo: d.docNo ?? null,
  }
}
