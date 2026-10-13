/**
 * Button labels + confirmation texts of the decisions (ADR 0013 / ADR 0021) — ONE source for the
 * Persetujuan inbox and the request detail decision bar (DRMS 10/10 9d), same wording as the APK
 * decision sheet. Pure module (unit-tested). The server re-checks every decision.
 */
import { formatRupiah } from '@/lib/money'

export type DecisionStep = 'acknowledge' | 'approve'

export type DecisionTextInput = {
  step: DecisionStep
  docNo: string | null
  grandTotal: number
  /** ADR 0013+ snapshot (decision roles recorded): "Diketahui" is an approval. */
  decisionFlow: boolean
  decisionBy: 'pm' | 'direktur' | 'owner' | 'finance' | 'other'
  /** Approving this step is the last decision (→ Finance transfer). */
  finalStep: boolean
}

export const REJECT_PROMPT = { field: 'reason', message: 'Alasan penolakan (wajib, minimal 3 karakter):', minLength: 3 } as const

export function decisionText(i: DecisionTextInput): { label: string; confirm: string } {
  const no = i.docNo ?? 'pengajuan ini'
  const amount = formatRupiah(i.grandTotal)
  if (i.step === 'acknowledge') {
    // ADR 0013: "Diketahui" is the Direktur's approval → "Setujui"; ADR 0021: the PM project's approval
    // (then the Direktur); legacy snapshots keep "Diketahui".
    if (i.decisionBy === 'pm') return { label: 'Setujui', confirm: `Setujui ${no} sebesar ${amount} sebagai PM project? Pengajuan diteruskan ke Direktur.` }
    if (i.decisionFlow) return { label: 'Setujui', confirm: `Setujui ${no} sebesar ${amount} sebagai Direktur (Diketahui)?` }
    return { label: 'Diketahui', confirm: `Tandai ${no} sudah diketahui?` }
  }
  if (i.decisionBy === 'direktur' && i.finalStep) return { label: 'Setujui', confirm: `Setujui ${no} sebesar ${amount} sebagai Direktur? Pengajuan diteruskan ke Finance untuk transfer.` }
  // ADR 0025: Direktur → Owner → Finance (the next level is the Owner's under the default rules)
  if (i.decisionBy === 'direktur') return { label: 'Setujui', confirm: `Setujui ${no} sebesar ${amount} sebagai Direktur? Pengajuan diteruskan ke level persetujuan berikutnya.` }
  if (i.decisionBy === 'owner' && i.finalStep) return { label: 'Setujui', confirm: `Setujui ${no} sebesar ${amount} sebagai Owner? Pengajuan diteruskan ke Finance untuk transfer.` }
  if (i.decisionBy === 'owner') return { label: 'Setujui', confirm: `Setujui ${no} sebesar ${amount} sebagai Owner?` }
  return { label: 'Setujui', confirm: `Setujui ${no} sebesar ${amount}?` }
}
