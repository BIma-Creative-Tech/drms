import type { PayloadRequest } from 'payload'

import { relId, userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { assertAccount, assertOnOrAfterOpening, currentLockDate, loadEntry, postEntry, voidEntry } from '@/domain/cash/ledger'
import { failCoded, SHORTFALL_REAPPROVAL_REQUIRED } from '@/domain/coded-error'
import { formatRupiah } from '@/lib/money'
import { allocateDocNo } from '@/domain/numbering-db'
import { parseBusinessDate } from '@/domain/numbering'

import { actorContext, fail, loadRaw, loadVisible, requireAction, requireActionAudited, settings, today, updateRequest, type RequestDoc } from './common'
import { claimMedia, receiptsOf, recomputeFlags } from './receipts'
import { settlementOf, shortfallCheck, type SettlementStatus, type SettlementType, type ShortfallApprovalStatus } from './settlement-rules'
import { auditUnverifiedTransfer, checkDestination, requestTransferCostCenter } from './transfers'
import { isBusinessDate } from './types'

/**
 * T5 LPJ & settlement service (requirements v1.1 §7 T5, US-08/US-21/US-22; architecture §5.1,
 * §5.3; ADR 0005 §3). Pengajuan Baru only — the state table rejects every LPJ action on Reimburse.
 * Every function runs inside the caller's request transaction (row lock on the request first),
 * writes through Local API with SYSTEM-WRITE after the guards, and relies on the DB triggers
 * (pk_settlements_guard, pk_transfers_guard, pk_cash_entries_guard) as the last line of defence.
 */
export type SettlementDoc = {
  id: number
  docNo?: string | null
  request: unknown
  status: SettlementStatus
  usageNotes?: string | null
  /** Point 13: LPJ photo ids (media-receipts). */
  photos?: unknown[] | null
  transferredTotal?: number | null
  receiptsTotal?: number | null
  verifiedReceiptsTotal?: number | null
  difference?: number | null
  settlementType?: SettlementType | null
  financeNotes?: string | null
  submitCount?: number | null
  submittedAt?: string | null
  verifiedAt?: string | null
  settledAt?: string | null
  refundCashEntry?: unknown
  shortfallTransfer?: unknown
  reversalCount?: number | null
  lastReversedAt?: string | null
  lastReversalReason?: string | null
  // QA-06 / ADR 0019
  shortfallApprovalStatus?: ShortfallApprovalStatus | null
  shortfallApprovalCycle?: number | null
  shortfallApprovalLevel?: number | null
  shortfallApprovalAmount?: number | null
  shortfallApprovalSnapshot?: unknown
  shortfallApprovalNote?: string | null
  shortfallRejectReason?: string | null
}

export async function settlementOfRequest(req: PayloadRequest, requestId: number): Promise<SettlementDoc | null> {
  const res = await req.payload.find({
    collection: 'settlements',
    where: { request: { equals: requestId } },
    limit: 1,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: LPJ of a request the caller may read (checked by loadVisible)
    req,
  })
  return (res.docs[0] as unknown as SettlementDoc | undefined) ?? null
}

export async function updateSettlement(req: PayloadRequest, id: number, data: Record<string, unknown>, reason?: string): Promise<SettlementDoc> {
  if (reason) req.context.auditReason = reason
  return (await req.payload.update({
    collection: 'settlements',
    id,
    data: data as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: LPJ transition after guards (DB: pk_settlements_guard)
    req,
  })) as unknown as SettlementDoc
}

export async function requireSettlement(req: PayloadRequest, requestId: number, status: SettlementStatus[]): Promise<SettlementDoc> {
  const s = await settlementOfRequest(req, requestId)
  if (!s) fail(409, 'LPJ belum dibuat untuk pengajuan ini.')
  if (!status.includes(s.status)) fail(409, `LPJ berstatus ${s.status}; aksi tidak dapat dilakukan.`)
  return s
}

const sum = (xs: Array<{ amount: number }>) => xs.reduce((a, r) => a + r.amount, 0)

/** Point 13: max LPJ photos (same as the APK picker). */
export const MAX_LPJ_PHOTOS = 10

/**
 * PUT …/lpj/photos (point 13, DRMS 10/10) — the requester sets the LPJ photo set while the LPJ is editable
 * (Draft at "Nota Lengkap", Revisi at "LPJ Revisi"; same guard as Kirim LPJ). Photos = media-receipts uploaded
 * by the caller (images only), each claimed for the request (media read access follows the request). A
 * photo removed from the set stays claimed (audit trail), never reusable in another document.
 */
export async function setLpjPhotos(req: PayloadRequest, id: number, photos: number[], opts: { locked?: boolean } = {}): Promise<SettlementDoc> {
  if (!opts.locked) {
    const doc = await loadVisible(req, id, { lock: true })
    requireAction(await actorContext(req, doc), 'lpj_submit')
  }
  const s = await requireSettlement(req, id, ['draft', 'revision'])
  const uniq = [...new Set(photos)]
  if (uniq.length !== photos.length) fail(400, 'Foto LPJ tidak boleh ganda.', [{ path: 'photos', message: 'Foto ganda.' }])
  if (uniq.length > MAX_LPJ_PHOTOS) fail(400, `Maksimal ${MAX_LPJ_PHOTOS} foto LPJ.`, [{ path: 'photos', message: `Maksimal ${MAX_LPJ_PHOTOS} foto.` }])
  const current = new Set((s.photos ?? []).map((p) => relId(p)).filter((x): x is number => x !== undefined))
  for (const m of uniq) {
    // already part of this LPJ → kept as is; new → must be the caller's own unclaimed (or this request's) upload
    if (!current.has(m)) await claimMedia(req, 'media-receipts', m, id)
  }
  if (uniq.length === current.size && uniq.every((m) => current.has(m))) return s
  return updateSettlement(req, s.id, { photos: uniq })
}

/**
 * POST …/receipts-complete — "Ditransfer" → "Nota Lengkap" (architecture §5.1 DT → NL):
 * requester side declares the receipts complete (min 1 active receipt); the LPJ document is
 * created in Draft with the transferred total.
 */
export async function receiptsComplete(req: PayloadRequest, id: number): Promise<RequestDoc> {
  const doc = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, doc), 'receipts_complete')
  const active = await receiptsOf(req, id, true)
  if (active.length === 0) fail(409, 'Unggah minimal 1 nota sebelum menandai nota lengkap.')
  const raw = await loadRaw(req, id)
  if (!(await settlementOfRequest(req, id))) {
    await req.payload.create({
      collection: 'settlements',
      data: { request: id, status: 'draft', transferredTotal: raw.transferredTotal ?? 0, submitCount: 0 } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: LPJ draft created with "Nota Lengkap" (architecture §5.3)
      req,
    })
  }
  return updateRequest(req, id, { status: 'receipts_complete' })
}

/**
 * POST …/lpj/submit — "Nota Lengkap" | "LPJ Revisi" → "LPJ Diajukan" (US-08). Usage description
 * required at the first submit (kept on resubmit unless sent again). Totals: receipts total =
 * Σ active receipts (pending + valid), provisional difference = transferred − receipts total.
 * LPJ number allocated at the FIRST submit (ADR 0007). Flags recomputed (architecture §5.6).
 */
export async function submitLpj(req: PayloadRequest, id: number, input: { usageNotes?: string | null; photos?: number[] }) {
  const doc = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, doc), 'lpj_submit')
  // point 13: photos sent with the submit are saved BEFORE the status change (the DB freezes the set at submit)
  if (input.photos !== undefined) await setLpjPhotos(req, id, input.photos, { locked: true })
  const s = await requireSettlement(req, id, ['draft', 'revision'])
  const usageNotes = (input.usageNotes ?? '').trim() || s.usageNotes || ''
  if (usageNotes.length < 3) fail(400, 'Uraian penggunaan dana wajib diisi.', [{ path: 'usageNotes', message: 'Wajib diisi.' }])
  const active = await receiptsOf(req, id, true)
  if (active.length === 0) fail(409, 'LPJ membutuhkan minimal 1 nota.')
  const raw = await loadRaw(req, id)
  const transferred = raw.transferredTotal ?? 0
  const receiptsTotal = sum(active)
  let docNo = s.docNo ?? null
  const companyId = relId((raw as { company?: unknown }).company)!
  if (!docNo) docNo = (await allocateDocNo(req, 'settlement', { companyId, date: parseBusinessDate(await today(req, companyId)), docId: String(s.id) })).docNo
  await updateSettlement(req, s.id, {
    docNo,
    status: 'submitted',
    usageNotes: usageNotes.slice(0, 2000),
    transferredTotal: transferred,
    receiptsTotal,
    difference: transferred - receiptsTotal,
    submitCount: (s.submitCount ?? 0) + 1,
    submittedAt: new Date().toISOString(),
    submittedBy: userId(req),
  })
  const updated = await updateRequest(req, id, { status: 'lpj_submitted' })
  await recomputeFlags(req, id)
  return updated
}

/** POST …/lpj/request-revision — Finance, note required (US-21, G7) → "LPJ Revisi". */
export async function requestLpjRevision(req: PayloadRequest, id: number, note: string) {
  const doc = await loadVisible(req, id, { lock: true })
  await requireActionAudited(req, await actorContext(req, doc), 'lpj_request_revision', doc)
  const s = await requireSettlement(req, id, ['submitted'])
  await updateSettlement(req, s.id, { status: 'revision', financeNotes: note }, note)
  return updateRequest(req, id, { status: 'lpj_revision' }, note)
}

/**
 * POST …/lpj/verify — Finance (US-21): every active receipt decided (valid or rejected; none
 * pending), verified total = Σ valid receipts, difference = transferred − verified. Difference 0
 * → settled immediately and "Selesai"; otherwise "LPJ Terverifikasi" waiting for the settlement.
 */
export async function verifyLpj(req: PayloadRequest, id: number) {
  const doc = await loadVisible(req, id, { lock: true })
  await requireActionAudited(req, await actorContext(req, doc), 'lpj_verify', doc)
  const s = await requireSettlement(req, id, ['submitted'])
  const receipts = await receiptsOf(req, id)
  const pending = receipts.filter((r) => r.status === 'pending')
  if (pending.length > 0) fail(409, `Masih ada ${pending.length} nota yang belum diputuskan (valid/tolak).`)
  const raw = await loadRaw(req, id)
  const transferred = raw.transferredTotal ?? 0
  const verified = sum(receipts.filter((r) => r.status === 'valid'))
  const st = settlementOf(transferred, verified)
  const now = new Date().toISOString()
  await updateSettlement(req, s.id, {
    status: 'verified',
    transferredTotal: transferred,
    verifiedReceiptsTotal: verified,
    difference: st.difference,
    settlementType: st.type,
    verifiedAt: now,
    verifiedBy: userId(req),
  })
  if (st.type === 'none') {
    await updateSettlement(req, s.id, { status: 'settled', settledAt: now, settledBy: userId(req) })
    return updateRequest(req, id, { status: 'completed', verifiedReceiptsTotal: verified })
  }
  return updateRequest(req, id, { status: 'lpj_verified', verifiedReceiptsTotal: verified })
}

export type SettleInput = {
  cashAccountId: number
  /** Refund: date of the KM entry; shortfall: transfer date. Default today (company TZ). */
  date?: string
  /** Shortfall: bank reference of the transfer (required). */
  bankRef?: string
  /** Shortfall: media-transfer-proofs id (required). Refund: media-attachments id (optional, US-23). */
  proofMediaId?: number | null
  /** Optional echo; must equal the computed settlement amount (Finance cannot change it). */
  amount?: number
  /** QA-04: confirm a shortfall transfer that makes the cash account balance negative (audited). */
  confirmOverdraft?: boolean
  /** QA-17: confirm a shortfall transfer to an unverified bank account (audited). */
  confirmUnverifiedAccount?: boolean
}

/**
 * QA-06 / ADR 0019: may the shortfall of this verified LPJ be paid now? Total after the shortfall
 * ≤ approved × (1 + tolerance) (company setting `shortfallTolerancePct`, default 10), or an approved
 * shortfall re-approval covering it.
 */
export async function shortfallStateOf(req: PayloadRequest, raw: RequestDoc, s: SettlementDoc) {
  const st = settlementOf(s.transferredTotal ?? 0, s.verifiedReceiptsTotal ?? 0)
  const companyId = relId((raw as { company?: unknown }).company)
  const tolerancePct = Number((await settings(req, companyId)).shortfallTolerancePct ?? 10)
  const shortfall = st.type === 'shortfall' ? st.amount : 0
  // a settled LPJ already counts its shortfall transfer in the request's transferred total
  const before = (raw.transferredTotal ?? 0) - (s.status === 'settled' ? shortfall : 0)
  const check = shortfallCheck({
    approvedAmount: raw.approvedAmount ?? 0,
    transferredTotal: before,
    shortfall,
    tolerancePct,
    approval: { status: s.shortfallApprovalStatus ?? null, amount: s.shortfallApprovalAmount ?? null },
  })
  return { ...check, tolerancePct, shortfall, approvedAmount: raw.approvedAmount ?? 0 }
}

/**
 * POST …/settle — Finance (US-22), "LPJ Terverifikasi" → "Selesai":
 * - surplus (difference > 0): KM "Pengembalian LPJ" cash-in of the difference (ADR 0005 §3,
 *   sourceType settlement_refund, proof optional — architecture §5.1 note);
 * - shortfall (difference < 0): T3 transfer `lpj_shortfall` of the difference to the request's
 *   bank snapshot + automatic KK (proof + bank reference required, like US-20).
 * Amount is always computed server-side; the period lock applies (G5, DB-enforced).
 */
export async function settle(req: PayloadRequest, id: number, input: SettleInput) {
  const doc = await loadVisible(req, id, { lock: true })
  await requireActionAudited(req, await actorContext(req, doc), 'settle', doc)
  const s = await requireSettlement(req, id, ['verified'])
  const raw = await loadRaw(req, id)
  const st = settlementOf(s.transferredTotal ?? 0, s.verifiedReceiptsTotal ?? 0)
  if (input.amount !== undefined && input.amount !== st.amount) fail(409, `Nominal penyelesaian harus ${st.amount} (dihitung server).`)
  const todayDate = await today(req)
  const date = input.date ?? todayDate
  if (!isBusinessDate(date)) fail(400, 'Tanggal harus YYYY-MM-DD.')
  if (date > todayDate) fail(400, 'Tanggal tidak boleh di masa depan.')
  const account = await assertAccount(req, input.cashAccountId, relId((raw as { company?: unknown }).company)) // QA-MC4-10: account of the request's PT
  assertOnOrAfterOpening(account, date, 'date') // QA-05
  const lock = await currentLockDate(req, relId((raw as { company?: unknown }).company))
  if (lock && date <= lock) fail(409, `Periode ${date.slice(0, 7)} sudah ditutup (tutup buku s/d ${lock}).`)
  if (st.type === 'shortfall') {
    // QA-06 / ADR 0019: above approved + tolerance only after the re-approval of the new total
    const sf = await shortfallStateOf(req, raw, s)
    if (!sf.allowed) {
      const pending = s.shortfallApprovalStatus === 'pending_ack' || s.shortfallApprovalStatus === 'pending_approval'
      failCoded(
        409,
        SHORTFALL_REAPPROVAL_REQUIRED,
        `Total transfer menjadi ${formatRupiah(sf.totalAfter)}, melebihi nominal disetujui ${formatRupiah(sf.approvedAmount)} + toleransi ${sf.tolerancePct}% (${formatRupiah(sf.ceiling)}). ${
          pending ? 'Persetujuan kekurangan sedang berjalan.' : s.shortfallApprovalStatus === 'rejected' ? 'Persetujuan kekurangan ditolak.' : 'Ajukan persetujuan kekurangan (Direktur → Finance) terlebih dahulu.'
        }`,
        { approvedAmount: sf.approvedAmount, transferredTotal: sf.totalAfter, tolerancePct: sf.tolerancePct, limit: sf.ceiling, shortfallApprovalStatus: s.shortfallApprovalStatus ?? null },
      )
    }
  }
  const lpjNo = s.docNo ?? ''
  const label = `${lpjNo} — ${raw.docNo ?? ''} ${raw.title}`.slice(0, 900)
  const data: Record<string, unknown> = { status: 'settled', settledAt: new Date().toISOString(), settledBy: userId(req) }
  let transferredTotal = raw.transferredTotal ?? 0
  let refundEntry: { id: number; entryNo: string } | null = null
  let shortfall: { id: number; docNo: string; cashEntryId: number; cashEntryNo: string } | null = null

  if (st.type === 'refund') {
    const source = await req.payload.find({
      collection: 'cash-in-sources',
      // ADR 0016: the "Pengembalian LPJ" source OF THE REQUEST's PT (seeded per PT)
      where: { and: [{ company: { equals: relId((raw as { company?: unknown }).company) } }, { code: { equals: 'LPJ' } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true, // SYSTEM-READ: master "Pengembalian LPJ" (seed/data.ts)
      req,
    })
    const sourceId = (source.docs[0] as { id: number } | undefined)?.id
    if (!sourceId) fail(409, 'Sumber kas masuk "Pengembalian LPJ" (kode LPJ) belum ada di master.')
    if (input.proofMediaId) await claimMedia(req, 'media-attachments', input.proofMediaId, id)
    const entry = await postEntry(req, {
      direction: 'in',
      entryDate: date,
      cashAccountId: input.cashAccountId,
      amount: st.amount,
      cashInSourceId: sourceId,
      projectId: relId(raw.project) ?? null,
      // D2: the cost center of the request's transfer (chosen by Finance), legacy requests: their own
      costCenterId: (await requestTransferCostCenter(req, id)) ?? relId(raw.costCenter) ?? null,
      description: `Pengembalian LPJ ${label}`,
      proofId: input.proofMediaId ?? null,
      sourceType: 'settlement_refund',
      expenseRequestId: id,
    })
    data.refundCashEntry = entry.id
    refundEntry = { id: entry.id, entryNo: entry.entryNo }
  } else if (st.type === 'shortfall') {
    const bankRef = (input.bankRef ?? '').trim()
    if (!bankRef) fail(400, 'Nomor referensi bank wajib diisi untuk transfer kekurangan.', [{ path: 'bankRef', message: 'Wajib.' }])
    if (!input.proofMediaId) fail(400, 'Bukti transfer wajib untuk transfer kekurangan.', [{ path: 'proofMediaId', message: 'Wajib.' }])
    if (!raw.bankSnapshot?.accountNo) fail(409, 'Rekening tujuan belum tersimpan pada pengajuan.')
    const destination = await checkDestination(req, raw, input.confirmUnverifiedAccount === true) // QA-17
    const { docNo } = await allocateDocNo(req, 'transfer', { companyId: relId((raw as { company?: unknown }).company)!, date: parseBusinessDate(date) })
    await claimMedia(req, 'media-transfer-proofs', input.proofMediaId, id)
    const transfer = (await req.payload.create({
      collection: 'transfers',
      data: {
        docNo,
        request: id,
        kind: 'lpj_shortfall',
        cashAccount: input.cashAccountId,
        amount: st.amount,
        // D2: same cost center as the request's posted transfer (chosen by Finance then)
        costCenter: await requestTransferCostCenter(req, id),
        destination: { ...raw.bankSnapshot },
        bankRef,
        proof: input.proofMediaId,
        transferDate: date,
        postedBy: userId(req),
        status: 'posted',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: shortfall transfer after guards (DB: amount = LPJ shortfall)
      req,
    })) as unknown as { id: number; docNo: string }
    const categories = [...new Set((raw.lines ?? []).map((l) => relId(l.category)).filter((x): x is number => x !== undefined))]
    const entry = await postEntry(req, {
      direction: 'out',
      entryDate: date,
      cashAccountId: input.cashAccountId,
      amount: st.amount,
      categoryId: categories.length === 1 ? categories[0] : null,
      projectId: relId(raw.project) ?? null,
      costCenterId: (await requestTransferCostCenter(req, id)) ?? relId(raw.costCenter) ?? null,
      description: `Transfer kekurangan LPJ ${docNo} — ${label}`.slice(0, 1000),
      sourceType: 'transfer',
      expenseRequestId: id,
      transferId: transfer.id,
      confirmOverdraft: input.confirmOverdraft === true, // QA-04
    })
    if (destination.verificationStatus !== 'verified') {
      await auditUnverifiedTransfer(req, transfer, destination, { requestId: id, requestNo: raw.docNo, amount: st.amount, kind: 'lpj_shortfall', companyId: relId((raw as { company?: unknown }).company) })
    }
    await req.payload.update({
      collection: 'transfers',
      id: transfer.id,
      data: { cashEntry: entry.id } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: link the KK entry (DB: cash_entry_id set once)
      req,
    })
    data.shortfallTransfer = transfer.id
    transferredTotal += st.amount
    shortfall = { id: transfer.id, docNo: transfer.docNo, cashEntryId: entry.id, cashEntryNo: entry.entryNo }
  }

  const settlement = await updateSettlement(req, s.id, data)
  const request = await updateRequest(req, id, { status: 'completed', transferredTotal })
  return { settlement, request, refundEntry, shortfall, type: st.type, amount: st.amount }
}

/**
 * POST …/settle/reverse — Finance (E9, F6 backlog "settlement reversal"), "Selesai" → "LPJ
 * Terverifikasi": undoes a settlement that posted money so it can be settled again correctly
 * (wrong account/date/proof, refund not actually received, shortfall transfer bounced):
 * - refund: the KM "Pengembalian LPJ" is voided (reversal row, original stays visible "Void");
 * - shortfall: the transfer is voided and its KK reversed (same as T8 void transfer), the
 *   request's transferred total drops by the shortfall amount;
 * then the LPJ returns to `verified` (links cleared, reversal count/reason/actor recorded) and the
 * request to `lpj_verified`. Reason required. Period close (ADR 0005 §6, G5): when the settlement
 * transaction lies in a CLOSED period the reversal is refused (409) — the Direktur must re-open the
 * period first; the reversal row is therefore always dated like the original. Audited: status
 * changes of request/LPJ (hooks) + one `void` row on the settlement with the voided documents.
 */
export async function reverseSettlement(req: PayloadRequest, id: number, reason: string) {
  const doc = await loadVisible(req, id, { lock: true })
  await requireActionAudited(req, await actorContext(req, doc), 'settle_reverse', doc)
  const s = await requireSettlement(req, id, ['settled'])
  if (s.settlementType !== 'refund' && s.settlementType !== 'shortfall') {
    fail(409, 'LPJ ini selesai tanpa selisih; tidak ada kas masuk/transfer penyelesaian yang dapat dibatalkan.')
  }
  const raw = await loadRaw(req, id)
  const lock = await currentLockDate(req, relId((raw as { company?: unknown }).company))
  const closed = (date: string) =>
    fail(409, `Periode ${date.slice(0, 7)} sudah ditutup (tutup buku s/d ${lock}). Minta Direktur membuka kembali periode sebelum membatalkan penyelesaian.`)
  let transferredTotal = raw.transferredTotal ?? 0
  let voided: Record<string, unknown>

  if (s.settlementType === 'refund') {
    const entryId = relId(s.refundCashEntry)
    if (!entryId) fail(409, 'Kas masuk pengembalian LPJ tidak ditemukan pada LPJ ini.')
    const entry = await loadEntry(req, entryId)
    if (entry.status !== 'posted') fail(409, 'Kas masuk pengembalian LPJ sudah di-void.')
    if (lock && entry.entryDate <= lock) closed(entry.entryDate)
    const r = await voidEntry(req, entryId, reason, { viaSettlement: true })
    voided = { type: 'refund', amount: entry.amount, refundCashEntryId: entryId, refundCashEntryNo: entry.entryNo, reversalCashEntryId: r.reversal.id, reversalCashEntryNo: r.reversal.entryNo }
  } else {
    const transferId = relId(s.shortfallTransfer)
    if (!transferId) fail(409, 'Transfer kekurangan tidak ditemukan pada LPJ ini.')
    const t = (await req.payload
      .findByID({ collection: 'transfers', id: transferId, depth: 0, overrideAccess: true /* SYSTEM-READ: linked from the LPJ checked above */, req })
      .catch(() => null)) as { id: number; docNo?: string; status: string; amount: number; transferDate: string; cashEntry?: unknown } | null
    if (!t) fail(409, 'Transfer kekurangan tidak ditemukan pada LPJ ini.')
    if (t.status !== 'posted') fail(409, 'Transfer kekurangan sudah dibatalkan.')
    if (lock && t.transferDate <= lock) closed(t.transferDate)
    const entryId = relId(t.cashEntry)
    const r = entryId ? await voidEntry(req, entryId, reason, { viaTransfer: true }) : null
    req.context.auditReason = reason
    await req.payload.update({
      collection: 'transfers',
      id: t.id,
      data: { status: 'void', voidReason: reason, voidedBy: userId(req), voidedAt: new Date().toISOString() } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: void after guards (DB: only posted → void)
      req,
    })
    transferredTotal = Math.max(0, transferredTotal - t.amount)
    voided = { type: 'shortfall', amount: t.amount, shortfallTransferId: t.id, shortfallTransferNo: t.docNo ?? null, reversalCashEntryId: r?.reversal.id ?? null, reversalCashEntryNo: r?.reversal.entryNo ?? null }
  }

  const settlement = await updateSettlement(
    req,
    s.id,
    {
      status: 'verified',
      settledAt: null,
      settledBy: null,
      refundCashEntry: null,
      shortfallTransfer: null,
      reversalCount: (s.reversalCount ?? 0) + 1,
      lastReversedAt: new Date().toISOString(),
      lastReversedBy: userId(req),
      lastReversalReason: reason,
    },
    reason,
  )
  await writeAudit(req, [{ action: 'void', docType: 'settlement', docId: String(s.id), docNo: s.docNo ?? undefined, field: 'settlement', oldValue: voided, reason }])
  const request = await updateRequest(req, id, { status: 'lpj_verified', transferredTotal }, reason)
  return { settlement, request, voided }
}
