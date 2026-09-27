import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relId, userId } from '@/access/roles'
import { assertAccount, currentLockDate, postEntry, voidEntry } from '@/domain/cash/ledger'
import { allocateDocNo } from '@/domain/numbering-db'
import { parseBusinessDate } from '@/domain/numbering'
import { getRequestTx } from '@/lib/tx'

import { actorContext, fail, loadRaw, loadVisible, requireAction, today, updateRequest } from './common'
import { claimMedia, recomputeFlags } from './receipts'
import { isBusinessDate } from './types'

export type TransferInput = {
  cashAccountId: number
  bankRef: string
  proofMediaId: number
  transferDate?: string
  /** Optional echo of the amount; must equal the approved amount (G3: Finance cannot change it). */
  amount?: number
}

type TransferDoc = { id: number; docNo: string; request: unknown; amount: number; status: 'posted' | 'void'; cashEntry?: unknown; kind: string }

/**
 * POST /expense-requests/{id}/transfer (US-20, T3): Uang Muka "Disetujui (Antri Transfer)" or
 * Reimburse "Nota Terverifikasi (Antri Transfer)". Amount copied from `approvedAmount` (G3, also
 * DB-checked on insert), destination = the request's bank snapshot (read-only), source account +
 * bank reference + proof required. Auto-posts ONE KK cash-out linked to request and transfer
 * (category = the lines' single category, else empty: category breakdown comes from the lines,
 * US-25) — all in one transaction; the DB rejects a transfer date in a closed period (G5).
 */
export async function recordTransfer(req: PayloadRequest, id: number, input: TransferInput) {
  const visible = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, visible), 'transfer')
  const doc = await loadRaw(req, id)
  const approved = doc.approvedAmount ?? 0
  if (input.amount !== undefined && input.amount !== approved) {
    fail(409, 'Nominal transfer harus sama dengan nominal yang disetujui; Finance tidak dapat mengubah nominal (G3).')
  }
  const todayDate = await today(req)
  const transferDate = input.transferDate ?? todayDate
  if (!isBusinessDate(transferDate)) fail(400, 'Tanggal transfer harus YYYY-MM-DD.')
  if (transferDate > todayDate) fail(400, 'Tanggal transfer tidak boleh di masa depan.')
  if (!input.bankRef.trim()) fail(400, 'Nomor referensi bank wajib diisi.')
  if (!doc.bankSnapshot?.accountNo) fail(409, 'Rekening tujuan belum tersimpan pada pengajuan.')
  await assertAccount(req, input.cashAccountId)
  const lock = await currentLockDate(req)
  if (lock && transferDate <= lock) fail(409, `Periode ${transferDate.slice(0, 7)} sudah ditutup (tutup buku s/d ${lock}).`)

  const { docNo } = await allocateDocNo(req, 'transfer', { date: parseBusinessDate(transferDate) })
  await claimMedia(req, 'media-transfer-proofs', input.proofMediaId, id)
  const transfer = (await req.payload.create({
    collection: 'transfers',
    data: {
      docNo,
      request: id,
      kind: doc.type,
      cashAccount: input.cashAccountId,
      amount: approved,
      destination: { ...doc.bankSnapshot },
      bankRef: input.bankRef.trim(),
      proof: input.proofMediaId,
      transferDate,
      postedBy: userId(req),
      status: 'posted',
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: transfer after guards (DB: amount = approved, period open)
    req,
  })) as unknown as TransferDoc
  const categories = [...new Set((doc.lines ?? []).map((l) => relId(l.category)).filter((x): x is number => x !== undefined))]
  const entry = await postEntry(req, {
    direction: 'out',
    entryDate: transferDate,
    cashAccountId: input.cashAccountId,
    amount: approved,
    categoryId: categories.length === 1 ? categories[0] : null,
    projectId: relId(doc.project) ?? null,
    costCenterId: relId(doc.costCenter) ?? null,
    description: `Transfer ${docNo} — ${doc.docNo ?? ''} ${doc.title}`.slice(0, 1000),
    sourceType: 'transfer',
    expenseRequestId: id,
    transferId: transfer.id,
  })
  const linked = await req.payload.update({
    collection: 'transfers',
    id: transfer.id,
    data: { cashEntry: entry.id } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: link the KK entry (DB: cash_entry_id set once)
    req,
  })
  const updated = await updateRequest(req, id, { status: 'transferred', transferredTotal: (doc.transferredTotal ?? 0) + approved })
  if (doc.type === 'advance') await recomputeFlags(req, id) // receipt date rules use the transfer date
  return { transfer: linked, cashEntry: entry, request: updated }
}

/**
 * POST /expense-requests/{id}/transfers/{tid}/void (T8): reversal of the KK entry (original stays
 * visible), transfer `void` with reason, request back to its transfer queue status.
 */
export async function voidTransfer(req: PayloadRequest, id: number, transferId: number, reason: string) {
  const visible = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, visible), 'transfer_void')
  const doc = await loadRaw(req, id)
  const t = (await req.payload
    .findByID({ collection: 'transfers', id: transferId, depth: 0, overrideAccess: true /* SYSTEM-READ: belongs-to check below */, req })
    .catch(() => null)) as TransferDoc | null
  if (!t || relId(t.request) !== id) fail(404, 'Transfer tidak ditemukan.')
  if (t.status !== 'posted') fail(409, 'Transfer sudah dibatalkan.')
  const entryId = relId(t.cashEntry)
  const voided = entryId ? await voidEntry(req, entryId, reason, { viaTransfer: true }) : null
  req.context.auditReason = reason
  const transfer = await req.payload.update({
    collection: 'transfers',
    id: transferId,
    data: { status: 'void', voidReason: reason, voidedBy: userId(req), voidedAt: new Date().toISOString() } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: void after guards (DB: only posted → void)
    req,
  })
  const back = doc.type === 'advance' ? 'approved' : 'receipts_verified'
  const updated = await updateRequest(req, id, { status: back, transferredTotal: Math.max(0, (doc.transferredTotal ?? 0) - t.amount) }, reason)
  return { transfer, reversal: voided?.reversal ?? null, request: updated }
}

/**
 * ADR 0013 O-2 (S3e, S-29): requests among `requestIds` whose CURRENT approval cycle the caller
 * approved (Finance "Approval" decision). Approve and transfer by the same Finance user stay allowed
 * (small team, audited); the transfer screen shows "Anda juga yang menyetujui" as a warning.
 */
export async function approvedByCaller(req: PayloadRequest, requestIds: number[]): Promise<Set<number>> {
  const uid = userId(req)
  const list = requestIds.filter((x) => Number.isSafeInteger(x) && x > 0)
  if (uid === undefined || list.length === 0) return new Set()
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT DISTINCT a.request_id AS id FROM approvals a JOIN expense_requests er ON er.id = a.request_id
     WHERE a.request_id IN (${sql.join(
       list.map((i) => sql`${i}`),
       sql`, `,
     )}) AND a.actor_id = ${uid} AND a.decision = 'approved' AND a.cycle = er.approval_cycle`)) as unknown as { rows: Array<{ id: number }> }
  return new Set(r.rows.map((x) => Number(x.id)))
}
