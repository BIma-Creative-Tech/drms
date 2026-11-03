import type { PayloadRequest } from 'payload'
import React from 'react'

import { relId } from '@/access/roles'
import { actorContext, loadVisible } from '@/domain/expense/common'
import { allowedActions } from '@/domain/expense/state'
import { withSystemTransaction } from '@/lib/system-tx'

import { KAS_STYLE } from './kas/style'
import { TransferProofReplace } from './kas/TransferProofReplace'

/**
 * D0311 (user 2026-11-03): "Ganti bukti transfer" on the transfer document (Keuangan › Transfer & LPJ › Transfer,
 * `ui` field `proofReplace` of Transfers.ts). Server component (Payload field serverProps: id, req): shown only for a
 * posted transfer whose request is "Selesai" and only to Finance / Admin of the request's PT (the same
 * `transfer_proof_replace` rule as the request page) — the endpoint re-checks everything.
 */
export async function TransferProofField({ id, req }: { id?: number | string; req?: PayloadRequest }) {
  if (id === undefined || id === null || id === '' || !req?.user) return null
  const info = await withSystemTransaction(req.payload, req.user, async (r) => {
    const t = (await r.payload.findByID({ collection: 'transfers', id, depth: 0, user: r.user, overrideAccess: false, req: r, disableErrors: true })) as {
      id: number
      docNo?: string | null
      request?: unknown
      status?: string
    } | null
    const requestId = relId(t?.request)
    if (!t || t.status !== 'posted' || requestId === undefined) return null
    try {
      const doc = await loadVisible(r, requestId)
      return allowedActions(await actorContext(r, doc)).includes('transfer_proof_replace') ? { requestId, transferId: t.id, transferNo: t.docNo ?? `#${t.id}` } : null
    } catch {
      return null // request not readable → no action
    }
  }).catch(() => null)
  if (!info) return null
  return (
    <div className="pk-doclink" data-pk-transfer-proof-replace>
      <style>{KAS_STYLE}</style>
      <TransferProofReplace requestId={info.requestId} transferId={info.transferId} transferNo={info.transferNo} size="md" />
      <p className="pk-doclink__hint">Pengajuan sudah Selesai: hanya file bukti yang dapat diganti (alasan wajib). Bukti lama tetap ada di Riwayat.</p>
    </div>
  )
}

export default TransferProofField
