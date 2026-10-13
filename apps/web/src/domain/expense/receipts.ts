import { sql } from '@payloadcms/db-postgres'
import type { CollectionSlug, PayloadRequest } from 'payload'

import { relId, userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { ORPHAN_MARK } from '@/domain/media-orphans'
import { rapOverBudgetLines } from '@/domain/rap/budget'
import { getRequestTx } from '@/lib/tx'

import { actorContext, fail, ids, loadRaw, loadVisible, requireAction, requireActionAudited, settings, today, updateRequest, type RequestDoc } from './common'
import { mayViewFlag, withFlagVisibility } from './flag-visibility'
import { computeFlags, normalizeReceiptNo, normalizeVendor, rapOverFlagSpecs, type DuplicateHit, type FlagCategory, type FlagSpec } from './flags'
import { grandTotal, lineNeedsCompletion } from './lines'
import { isNoApproval } from './decision'
import { auditSelfApproval, auditSkipped, legacyExceptionOf, selectAndSnapshot, writeSnapshot } from './snapshot'
import { isBusinessDate, INACTIVE_FOR_DUPLICATES, type FlagKind } from './types'

export type ReceiptInput = {
  lineId: string
  receiptNo?: string | null
  vendorName: string
  vendorId?: number | null
  receiptDate: string
  receiptTime?: string | null
  amount: number
  taxAmount?: number | null
  imageId: number
}

type ReceiptDoc = {
  id: number
  request: unknown
  lineId: string
  lineNo?: number | null
  receiptNo?: string | null
  vendorName: string
  receiptDate: string
  amount: number
  image: unknown
  imageSha256?: string | null
  status: 'pending' | 'valid' | 'rejected' | 'removed'
}

type FlagDoc = { id: number; key: string; kind: string; level: string; message: string; status: 'open' | 'reviewed' | 'resolved' }

const ACTIVE = ['pending', 'valid'] as const

export async function receiptsOf(req: PayloadRequest, requestId: number, activeOnly = false): Promise<ReceiptDoc[]> {
  const res = await req.payload.find({
    collection: 'receipts',
    where: activeOnly
      ? { and: [{ request: { equals: requestId } }, { status: { in: [...ACTIVE] } }] }
      : { request: { equals: requestId } },
    depth: 0,
    pagination: false,
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: receipts of a visible request
    req,
  })
  return res.docs as unknown as ReceiptDoc[]
}

/**
 * Links an uploaded media row to its owning request (media read access for requesters/team is
 * derived from it; columns immutable once set — DB trigger). The caller must be the uploader.
 */
export async function claimMedia(
  req: PayloadRequest,
  collection: CollectionSlug,
  mediaId: number,
  ownerId: number,
  opts: { anyUploader?: boolean; ownerType?: string } = {},
) {
  const ownerType = opts.ownerType ?? 'expense_request'
  const m = (await req.payload
    .findByID({ collection, id: mediaId, depth: 0, overrideAccess: true /* SYSTEM-READ: ownership checked below */, req })
    .catch(() => null)) as { id: number; uploadedBy?: unknown; ownerDocType?: string | null; ownerDocId?: string | null; sha256Original?: string | null } | null
  if (!m) fail(400, 'File tidak ditemukan.')
  if (!opts.anyUploader && relId(m.uploadedBy) !== userId(req)) fail(403, 'File bukan unggahan Anda.')
  // QA-11: an unclaimed upload removed by the orphan cleanup (domain/media-orphans.ts) is a tombstone
  if (m.ownerDocType === ORPHAN_MARK.type) fail(409, 'File sudah dihapus karena lama tidak dipakai; unggah ulang.')
  if (m.ownerDocId && !(m.ownerDocType === ownerType && m.ownerDocId === String(ownerId))) fail(409, 'File sudah dipakai di dokumen lain.')
  if (!m.ownerDocId) {
    await req.payload.update({
      collection,
      id: mediaId,
      data: { ownerDocType: ownerType, ownerDocId: String(ownerId) } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: owner link (media read scope)
      req,
    })
  }
  return m
}

/**
 * Prod 2026-10-12 (PB 230/PB-DRMS): "Lampiran umum" were stored on the draft but never owner-linked,
 * so only their uploader (and office roles of EVERY PT) could open them — the deciders saw no image.
 * Linked at submit (every path: web form, APK, re-submit after withdraw; idempotent). Only uploads of
 * the people on the request (`involved`: creator, requester accounts, caller) are linked; a file
 * already linked to ANOTHER expense request (copied by "Ajukan ulang", US-06) keeps that link.
 */
export async function claimAttachments(req: PayloadRequest, doc: RequestDoc, involved: ReadonlySet<number>): Promise<void> {
  // ADR 0025: the invoice file of a vendor payment is linked the same way (readable by everyone who reads the request)
  const invoice = relId(doc.invoiceFile)
  for (const mediaId of [...new Set([...ids(doc.attachments), ...(invoice !== undefined ? [invoice] : [])])]) {
    const m = (await req.payload
      .findByID({ collection: 'media-attachments', id: mediaId, depth: 0, overrideAccess: true /* SYSTEM-READ: owner link checked below */, req })
      .catch(() => null)) as { uploadedBy?: unknown; ownerDocType?: string | null; ownerDocId?: string | null } | null
    if (!m) fail(409, 'Lampiran tidak ditemukan; hapus dari pengajuan lalu unggah ulang.')
    if (m.ownerDocType === 'expense_request' && m.ownerDocId && m.ownerDocId !== String(doc.id)) continue
    if (!m.ownerDocId && !involved.has(relId(m.uploadedBy) ?? -1)) fail(409, 'Lampiran bukan unggahan pembuat/pemohon pengajuan ini; unggah ulang.')
    await claimMedia(req, 'media-attachments', mediaId, doc.id, { anyUploader: true })
  }
}

function lineIndex(doc: RequestDoc, lineId: string): number {
  const i = (doc.lines ?? []).findIndex((l) => l.id === lineId)
  if (i < 0) fail(400, 'Baris item tidak ditemukan.', [{ path: 'lineId', message: 'Baris item tidak ditemukan.' }])
  return i
}

/** QA-07: message of a receipt dated after today (company TZ) — same rule as the cash module. */
export const FUTURE_RECEIPT_MESSAGE = 'Tanggal nota tidak boleh di masa depan'

/** QA-27 (owner decision 2026-10-08): a receipt Finance marked valid is locked for the requester. */
export const VALID_RECEIPT_LOCKED = 'Nota sudah divalidasi Finance'

/**
 * Receipt input rules. `todayDate` = today in the document PT's timezone (QA-07: a receipt dated in
 * the future is refused with 400, like the cash module's "tidak boleh di masa depan").
 */
export function validateReceipt(input: Partial<ReceiptInput>, forCreate: boolean, todayDate: string) {
  const errors: Array<{ path: string; message: string }> = []
  if (forCreate || input.receiptDate !== undefined) {
    if (!isBusinessDate(input.receiptDate)) errors.push({ path: 'receiptDate', message: 'Tanggal nota harus YYYY-MM-DD.' })
    else if (input.receiptDate > todayDate) errors.push({ path: 'receiptDate', message: `${FUTURE_RECEIPT_MESSAGE} (hari ini ${todayDate}).` })
  }
  if (forCreate || input.amount !== undefined) {
    if (!(typeof input.amount === 'number' && Number.isSafeInteger(input.amount) && input.amount > 0)) errors.push({ path: 'amount', message: 'Nominal harus bilangan bulat Rupiah > 0.' })
  }
  if (forCreate || input.vendorName !== undefined) if (!(input.vendorName ?? '').trim()) errors.push({ path: 'vendorName', message: 'Vendor/toko wajib diisi.' })
  if (errors.length) fail(400, errors.some((e) => e.message.startsWith(FUTURE_RECEIPT_MESSAGE)) ? `${FUTURE_RECEIPT_MESSAGE}.` : 'Data nota tidak valid.', errors)
}

const companyOfDoc = (doc: RequestDoc) => relId((doc as { company?: unknown }).company)

/** POST /expense-requests/{id}/receipts (US-07, US-38). */
export async function addReceipt(req: PayloadRequest, requestId: number, input: ReceiptInput, opts: { clientUuid?: string } = {}) {
  const doc = await loadVisible(req, requestId, { lock: true })
  requireAction(await actorContext(req, doc), 'add_receipt')
  validateReceipt(input, true, await today(req, companyOfDoc(doc)))
  const idx = lineIndex(doc, input.lineId)
  const media = await claimMedia(req, 'media-receipts', input.imageId, requestId)
  const receipt = await req.payload.create({
    collection: 'receipts',
    data: {
      request: requestId,
      lineId: input.lineId,
      lineNo: idx + 1,
      receiptNo: input.receiptNo?.trim() || null,
      receiptNoNorm: normalizeReceiptNo(input.receiptNo),
      vendor: input.vendorId ?? null,
      vendorName: input.vendorName.trim(),
      vendorNorm: normalizeVendor(input.vendorName),
      receiptDate: input.receiptDate,
      receiptTime: input.receiptTime ?? null,
      amount: input.amount,
      taxAmount: input.taxAmount ?? null,
      image: input.imageId,
      imageSha256: media.sha256Original ?? null,
      status: 'pending',
      entrySource: 'manual',
      createdBy: userId(req),
      clientUuid: opts.clientUuid ?? null, // F4: APK offline id (sync batch)
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: receipt after add_receipt guard (DB: editable window)
    req,
  })
  await afterReceiptChange(req, requestId)
  return receipt
}

async function loadReceipt(req: PayloadRequest, requestId: number, receiptId: number): Promise<ReceiptDoc> {
  const r = (await req.payload
    .findByID({ collection: 'receipts', id: receiptId, depth: 0, overrideAccess: true /* SYSTEM-READ: belongs-to check below */, req })
    .catch(() => null)) as ReceiptDoc | null
  if (!r || relId(r.request) !== requestId) fail(404, 'Nota tidak ditemukan.')
  return r
}

/** PATCH /expense-requests/{id}/receipts/{rid} — only inside the receipt window (T4 "edit"). */
export async function editReceipt(req: PayloadRequest, requestId: number, receiptId: number, input: Partial<Omit<ReceiptInput, 'imageId'>>) {
  const doc = await loadVisible(req, requestId, { lock: true })
  requireAction(await actorContext(req, doc), 'add_receipt')
  const r = await loadReceipt(req, requestId, receiptId)
  if (r.status === 'removed') fail(409, 'Nota sudah dihapus.')
  if (r.status === 'valid') fail(409, `${VALID_RECEIPT_LOCKED}; nota tidak dapat diubah.`)
  validateReceipt(input, false, await today(req, companyOfDoc(doc)))
  const data: Record<string, unknown> = {}
  if (input.lineId !== undefined) {
    data.lineId = input.lineId
    data.lineNo = lineIndex(doc, input.lineId) + 1
  }
  if (input.receiptNo !== undefined) {
    data.receiptNo = input.receiptNo?.trim() || null
    data.receiptNoNorm = normalizeReceiptNo(input.receiptNo)
  }
  if (input.vendorName !== undefined) {
    data.vendorName = input.vendorName.trim()
    data.vendorNorm = normalizeVendor(input.vendorName)
  }
  if (input.vendorId !== undefined) data.vendor = input.vendorId
  if (input.receiptDate !== undefined) data.receiptDate = input.receiptDate
  if (input.receiptTime !== undefined) data.receiptTime = input.receiptTime
  if (input.amount !== undefined) data.amount = input.amount
  if (input.taxAmount !== undefined) data.taxAmount = input.taxAmount
  if (r.status === 'rejected') data.status = 'pending' // corrected receipt goes back to verification
  const updated = await req.payload.update({
    collection: 'receipts',
    id: receiptId,
    data: data as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: receipt edit after guard
    req,
  })
  await afterReceiptChange(req, requestId)
  return updated
}

/** POST …/receipts/{rid}/remove — "hapus" = status removed + reason (no hard delete, G4/G7). */
export async function removeReceipt(req: PayloadRequest, requestId: number, receiptId: number, reason: string) {
  const doc = await loadVisible(req, requestId, { lock: true })
  requireAction(await actorContext(req, doc), 'add_receipt')
  const r = await loadReceipt(req, requestId, receiptId)
  if (r.status === 'removed') fail(409, 'Nota sudah dihapus.')
  // QA-27 (owner decision 2026-10-08): a valid receipt is locked — Finance decided on it.
  if (r.status === 'valid') fail(409, `${VALID_RECEIPT_LOCKED}; nota tidak dapat dihapus.`)
  req.context.auditReason = reason
  const updated = await req.payload.update({
    collection: 'receipts',
    id: receiptId,
    data: { status: 'removed', removeReason: reason } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: soft removal after guard
    req,
  })
  await afterReceiptChange(req, requestId)
  return updated
}

/** US-39: Finance marks a receipt valid (Reimburse, after approval). */
export async function verifyReceipt(req: PayloadRequest, requestId: number, receiptId: number) {
  const doc = await loadVisible(req, requestId, { lock: true })
  await requireActionAudited(req, await actorContext(req, doc), 'receipt_verify', doc)
  const r = await loadReceipt(req, requestId, receiptId)
  if (r.status !== 'pending' && r.status !== 'rejected') fail(409, 'Nota tidak dalam status menunggu verifikasi.')
  const updated = await req.payload.update({
    collection: 'receipts',
    id: receiptId,
    data: { status: 'valid', verifiedBy: userId(req), verifiedAt: new Date().toISOString() } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: verification after guard (DB whitelist: status columns)
    req,
  })
  await afterReceiptChange(req, requestId) // QA-09: a rejected → valid receipt counts again
  return updated
}

/**
 * US-39: Finance rejects a receipt (reason) → Reimburse goes to "Revisi Nota". Pengajuan Baru LPJ review
 * (US-21): the receipt is rejected (excluded from the verified total) and the request stays in
 * "LPJ Diajukan" — Finance then asks for a revision or verifies the LPJ.
 */
export async function rejectReceipt(req: PayloadRequest, requestId: number, receiptId: number, reason: string) {
  const doc = await loadVisible(req, requestId, { lock: true })
  const ctx = await actorContext(req, doc)
  await requireActionAudited(req, ctx, doc.type === 'advance' ? 'receipt_verify' : 'receipt_reject', doc)
  const r = await loadReceipt(req, requestId, receiptId)
  if (r.status === 'removed' || r.status === 'rejected') fail(409, 'Nota sudah ditolak/dihapus.')
  req.context.auditReason = reason
  await req.payload.update({
    collection: 'receipts',
    id: receiptId,
    data: { status: 'rejected', rejectReason: reason, verifiedBy: userId(req), verifiedAt: new Date().toISOString() } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: rejection after guard
    req,
  })
  // QA-09: flags and the LPJ's provisional totals exclude the rejected receipt at once (were refreshed
  // only by the next LPJ submit).
  if (doc.type === 'advance') {
    await afterReceiptChange(req, requestId)
    return loadRaw(req, requestId)
  }
  const updated = await updateRequest(req, requestId, { status: 'receipt_revision' }, reason)
  await afterReceiptChange(req, requestId)
  return updated
}

/**
 * QA-09: after EVERY receipt change (add / edit / remove / valid / reject) the flags are recomputed
 * from the active receipts (pending + valid) and, on a Pengajuan Baru whose LPJ is still open (draft /
 * submitted / revision), the LPJ's provisional totals: receipts total = Σ active receipts,
 * difference = transferred − receipts total (DB: pk_settlements_guard allows exactly these two
 * columns, consistent, without a status change — migration 20261008_120000_qa_flow_receipts).
 * The verified total stays the job of the LPJ verification.
 */
export async function afterReceiptChange(req: PayloadRequest, requestId: number): Promise<void> {
  await recomputeFlags(req, requestId)
  await recomputeSettlementTotals(req, requestId)
}

/** QA-09: provisional LPJ totals of an open LPJ (no-op for Reimburse / no LPJ / verified+). */
export async function recomputeSettlementTotals(req: PayloadRequest, requestId: number): Promise<{ receiptsTotal: number; difference: number } | null> {
  const res = await req.payload.find({
    collection: 'settlements',
    where: { request: { equals: requestId } },
    limit: 1,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: LPJ of a request the caller acted on (guarded by the caller)
    req,
  })
  const s = res.docs[0] as unknown as { id: number; status: string; transferredTotal?: number | null; receiptsTotal?: number | null; difference?: number | null } | undefined
  if (!s || !['draft', 'submitted', 'revision'].includes(s.status)) return null
  const receiptsTotal = (await receiptsOf(req, requestId, true)).reduce((a, r) => a + r.amount, 0)
  const difference = (s.transferredTotal ?? 0) - receiptsTotal
  if (s.receiptsTotal === receiptsTotal && s.difference === difference) return { receiptsTotal, difference }
  await req.payload.update({
    collection: 'settlements',
    id: s.id,
    data: { receiptsTotal, difference } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: provisional LPJ totals after a receipt change (DB: pk_settlements_guard)
    req,
  })
  return { receiptsTotal, difference }
}

/**
 * POST …/receipts-resubmit (Reimburse, "Revisi Nota" → back): every line needs an active receipt;
 * grand total unchanged → "Disetujui"; changed → re-approval (new cycle, rule re-evaluated for the new
 * amount; "Menunggu Diketahui" when the rule requires the Direktur, else "Menunggu Approval") —
 * requirements §7 T1 Reimburse branch [Usulan], Q-12 default, ADR 0013 §6.
 */
export async function resubmitReceipts(req: PayloadRequest, requestId: number) {
  const doc = await loadVisible(req, requestId, { lock: true })
  requireAction(await actorContext(req, doc), 'receipts_resubmit')
  const raw = await loadRaw(req, requestId)
  // D3: a line saved before D3 (no reproducible unit price) is completed first — total = qty × harga satuan
  const incomplete = (raw.lines ?? []).map((l, i) => ({ l, i })).filter(({ l }) => lineNeedsCompletion(l))
  if (incomplete.length > 0) {
    fail(
      400,
      `Lengkapi Qty & Harga satuan pada baris ${incomplete.map(({ i }) => i + 1).join(', ')} sebelum mengirim ulang nota.`,
      incomplete.map(({ i }) => ({ path: `lines.${i}.unitPrice`, message: 'Lengkapi Qty & Harga satuan (total baris = qty × harga satuan).' })),
    )
  }
  await assertEveryLineHasReceipt(req, raw)
  const total = grandTotal((raw.lines ?? []).map((l) => ({ total: l.total ?? null })))
  let updated: RequestDoc
  if (total === raw.approvedAmount) {
    updated = await updateRequest(req, requestId, { status: 'approved' })
  } else {
    // ADR 0024: a request carrying an ADR 0021 exception keeps that flow; `direktur_no_approval` is re-derived
    const { rule, snapshot } = await selectAndSnapshot(req, raw, { legacy: legacyExceptionOf(raw.g1Exception) })
    // E1 (ADR 0013 §6): the new amount goes through the WHOLE flow again — "Diketahui" (Direktur
    // approval) first when the new snapshot requires it, not straight to "Menunggu Approval".
    const needsAck = snapshot.acknowledge === 'required'
    updated = await updateRequest(req, requestId, {
      status: needsAck ? 'pending_ack' : 'pending_approval',
      approvalRule: rule.id,
      approvalSnapshot: snapshot,
      g1Exception: snapshot.selfApproval ?? null,
      approvalCycle: (raw.approvalCycle ?? 0) + 1,
      currentLevel: needsAck ? 0 : isNoApproval(snapshot) ? 0 : 1,
    })
    await auditSkipped(req, updated, snapshot)
    await auditSelfApproval(req, updated, snapshot)
    // ADR 0024: a Direktur's own request under the zero-step rule needs no decision for the new amount either
    if (isNoApproval(snapshot)) {
      await writeSnapshot(req, updated, 'receipts_resubmit')
      await afterReceiptChange(req, requestId)
      return approveWithoutDecision(req, updated)
    }
  }
  await writeSnapshot(req, updated, 'receipts_resubmit')
  await afterReceiptChange(req, requestId)
  return updated
}

/**
 * ADR 0024 (owner decision 2026-10-11): "Menunggu persetujuan" → "Disetujui" with NO decision row, for a
 * request whose snapshot is `direktur_no_approval` (submit / receipt re-approval). Same transaction as the
 * submit; the DB accepts this transition without a decision only with `g1_exception = direktur_no_approval`
 * (trigger `expense_requests_approval_guard`). Audit: `approval_policy_exception` (written by the caller)
 * + the status change; Finance is notified (transfer queue / receipt verification) by the status hook.
 */
export async function approveWithoutDecision(req: PayloadRequest, doc: RequestDoc): Promise<RequestDoc> {
  if (doc.status !== 'pending_approval' || !isNoApproval(doc.approvalSnapshot)) return doc
  const approved = await updateRequest(req, doc.id, { status: 'approved', approvedAmount: doc.grandTotal ?? 0, approvedAt: new Date().toISOString() })
  await writeSnapshot(req, approved, 'approve')
  await syncProjectRapFlags(req, doc.id)
  return approved
}

export async function assertEveryLineHasReceipt(req: PayloadRequest, doc: RequestDoc) {
  const receipts = await receiptsOf(req, doc.id, true)
  const missing = (doc.lines ?? []).map((l, i) => ({ l, i })).filter(({ l }) => !receipts.some((r) => r.lineId === l.id))
  if (missing.length > 0) {
    fail(
      409,
      'Setiap baris Reimburse wajib punya minimal 1 nota (US-38).',
      missing.map(({ i }) => ({ path: `lines.${i}`, message: 'Belum ada nota.' })),
    )
  }
}

/**
 * US-06 (S3e, S-26): "Ajukan ulang" copies the ACTIVE receipts (pending/valid, not rejected/removed) of
 * the rejected request to the new draft — same photo (the media row stays owned by the old request;
 * its readers are the same people), line mapped by position (the clone keeps the line order), status
 * back to "belum diverifikasi". Rejected/removed receipts are not copied. Flags are recomputed for the
 * draft; the old request is rejected, so it never counts as a duplicate (INACTIVE_FOR_DUPLICATES).
 * Returns the number of copied receipts.
 */
export async function copyReceiptsForResubmit(req: PayloadRequest, fromId: number, to: RequestDoc): Promise<number> {
  const src = await loadRaw(req, fromId)
  const oldLines = (src.lines ?? []).map((l) => l.id)
  const newLines = (to.lines ?? []).map((l) => l.id)
  const receipts = await receiptsOf(req, fromId, true)
  let copied = 0
  for (const r of receipts) {
    const idx = oldLines.indexOf(r.lineId)
    const lineId = idx >= 0 ? newLines[idx] : undefined
    if (!lineId) continue
    const full = r as ReceiptDoc & Record<string, unknown>
    await req.payload.create({
      collection: 'receipts',
      data: {
        request: to.id,
        lineId,
        lineNo: idx + 1,
        receiptNo: r.receiptNo ?? null,
        receiptNoNorm: normalizeReceiptNo(r.receiptNo),
        vendor: relId(full.vendor) ?? null,
        vendorName: r.vendorName,
        vendorNorm: normalizeVendor(r.vendorName),
        receiptDate: r.receiptDate,
        receiptTime: (full.receiptTime as string | null | undefined) ?? null,
        amount: r.amount,
        taxAmount: (full.taxAmount as number | null | undefined) ?? null,
        image: relId(r.image),
        imageSha256: r.imageSha256 ?? null,
        status: 'pending',
        entrySource: (full.entrySource as string | undefined) ?? 'manual',
        createdBy: userId(req),
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: copy after the resubmit guard (DB: draft accepts receipts)
      req,
    })
    copied++
  }
  if (copied > 0) {
    await recomputeFlags(req, to.id)
    await writeAudit(req, [{ action: 'create', docType: 'expense_request', docId: String(to.id), field: 'receipts', newValue: { copiedFrom: fromId, count: copied }, reason: 'ajukan ulang: nota disalin (US-06)' }])
  }
  return copied
}

/** US-39: all receipts valid + all open warnings reviewed → "Nota Terverifikasi (Antri Transfer)". */
export async function verifyAllReceipts(req: PayloadRequest, requestId: number) {
  const doc = await loadVisible(req, requestId, { lock: true })
  await requireActionAudited(req, await actorContext(req, doc), 'verify_receipts', doc)
  const raw = await loadRaw(req, requestId)
  const receipts = await receiptsOf(req, requestId, true)
  const pending = receipts.filter((r) => r.status !== 'valid')
  if (pending.length > 0) fail(409, `Masih ada ${pending.length} nota yang belum diverifikasi.`)
  await assertEveryLineHasReceipt(req, raw)
  const open = await req.payload.count({
    collection: 'receipt-flags',
    // QA-MC4-06: a cross-PT duplicate the caller may not see does not exist for them (no oracle)
    where: withFlagVisibility(req, { and: [{ request: { equals: requestId } }, { status: { equals: 'open' } }, { level: { equals: 'warning' } }] }),
    overrideAccess: true, // SYSTEM-READ: open warnings
    req,
  })
  if (open.totalDocs > 0) fail(409, `Masih ada ${open.totalDocs} flag peringatan yang belum ditandai sudah diperiksa.`)
  return updateRequest(req, requestId, { status: 'receipts_verified' })
}

/** Finance marks a flag "sudah diperiksa" with an optional note (requirements §4, US-39). */
export async function reviewFlag(req: PayloadRequest, requestId: number, flagId: number, note?: string) {
  const doc = await loadVisible(req, requestId, { lock: true })
  await requireActionAudited(req, await actorContext(req, doc), 'review_flag', doc)
  const f = (await req.payload
    .findByID({ collection: 'receipt-flags', id: flagId, depth: 0, overrideAccess: true /* SYSTEM-READ: belongs-to check below */, req })
    .catch(() => null)) as (FlagDoc & { request: unknown; relatedCompany?: unknown }) | null
  if (!f || relId(f.request) !== requestId || !mayViewFlag(req, f)) fail(404, 'Flag tidak ditemukan.')
  if (f.status !== 'open') fail(409, 'Flag tidak terbuka.')
  const updated = await req.payload.update({
    collection: 'receipt-flags',
    id: flagId,
    data: { status: 'reviewed', reviewedBy: userId(req), reviewedAt: new Date().toISOString(), reviewNote: note ?? null } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: review after guard
    req,
  })
  const related = relId(f.relatedCompany)
  await writeAudit(req, [
    related === undefined
      ? { action: 'flag_reviewed', docType: 'expense_request', docId: String(requestId), docNo: doc.docNo ?? undefined, field: f.kind, oldValue: 'open', newValue: 'reviewed', reason: note }
      : // QA-MC4-06: cross-PT duplicate → untagged row + relatedCompanyId (see recomputeFlags)
        { action: 'flag_reviewed', docType: 'expense_request', docId: String(requestId), docNo: doc.docNo ?? undefined, field: f.kind, oldValue: 'open', newValue: { status: 'reviewed', relatedCompanyId: related }, reason: note, companyId: null },
  ])
  return updated
}

/**
 * US-50 duplicate search (QA-MC4-06, owner decision 2026-10-02 = ADR 0016 "Scope rule"): per receipt,
 * other ACTIVE receipts of active requests in the request's OWN PT or in a PT the receipt's UPLOADER
 * (`receipts.created_by`) is mapped to (active membership in an active PT). A single-PT uploader is
 * matched against that PT only; a multi-PT uploader against their PTs only — never an unmapped PT,
 * so the flag is no oracle for one. The scope depends on the receipt, not on who triggers the
 * recompute (submit / edit / resubmit by someone else gives the same flags). Imported receipts
 * without an uploader → own PT only.
 *
 * Match rules:
 * - OTHER request: same photo (SHA-256 of the original) OR same normalised receipt number + vendor
 *   + amount;
 * - SAME request (QA-08): same photo OR same normalised receipt number + vendor (the amount is not
 *   required: the same paper receipt split over two lines is still the same receipt). Only the LATER
 *   receipt of a pair is flagged (`o.id < r.id`), so a pair yields one flag, not two.
 */
async function duplicateHits(req: PayloadRequest, requestId: number): Promise<DuplicateHit[]> {
  const tx = await getRequestTx(req)
  const inactive = sql.join(
    INACTIVE_FOR_DUPLICATES.map((s) => sql`${s}`),
    sql`, `,
  )
  const r = (await tx.execute(sql`
    SELECT r.id AS rid, o.request_id AS other, o.id AS other_receipt, e.doc_no AS doc_no,
           CASE WHEN e.company_id <> r.company_id THEN e.company_id END AS other_company,
           CASE WHEN r.image_sha256 IS NOT NULL AND o.image_sha256 = r.image_sha256 THEN 'image' ELSE 'fields' END AS via
    FROM receipts r
    JOIN receipts o ON o.id <> r.id
     AND ((o.request_id <> r.request_id
           AND ((r.receipt_no_norm <> '' AND o.receipt_no_norm = r.receipt_no_norm AND o.vendor_norm = r.vendor_norm AND o.amount = r.amount)
                OR (r.image_sha256 IS NOT NULL AND o.image_sha256 = r.image_sha256)))
          OR (o.request_id = r.request_id AND o.id < r.id
              AND ((r.receipt_no_norm <> '' AND o.receipt_no_norm = r.receipt_no_norm AND o.vendor_norm = r.vendor_norm)
                   OR (r.image_sha256 IS NOT NULL AND o.image_sha256 = r.image_sha256))))
    JOIN expense_requests e ON e.id = o.request_id
    WHERE r.request_id = ${requestId}
      AND r.status::text IN ('pending', 'valid') AND o.status::text IN ('pending', 'valid')
      AND e.status::text NOT IN (${inactive})
      AND (e.company_id = r.company_id
           OR e.company_id IN (SELECT m.company_id FROM company_memberships m JOIN companies c ON c.id = m.company_id
                               WHERE m.user_id = r.created_by_id AND m.active AND c.active))
    ORDER BY r.id, o.request_id, o.id`)) as unknown as {
    rows: Array<{ rid: number; other: number; other_receipt: number; doc_no: string | null; other_company: number | null; via: 'image' | 'fields' }>
  }
  return r.rows.map((x) => ({
    receiptId: Number(x.rid),
    otherRequestId: Number(x.other),
    otherDocNo: x.doc_no,
    via: x.via,
    otherCompanyId: x.other_company === null ? null : Number(x.other_company),
    ...(Number(x.other) === requestId ? { otherReceiptId: Number(x.other_receipt) } : {}),
  }))
}

/**
 * Recomputes the flag set of a request (architecture §5.6: on receipt save, on submit, on
 * receipt resubmit) and persists the difference: new → open + `flag_raised`; gone → `resolved`;
 * level/message changed → old resolved + new raised. Reviewed flags keep their review.
 */
export async function recomputeFlags(req: PayloadRequest, requestId: number): Promise<FlagSpec[]> {
  const doc = await loadRaw(req, requestId)
  // ADR 0016 §1: receipt tolerance / max age of the DOCUMENT's PT
  const s = await settings(req, relId((doc as { company?: unknown }).company))
  const lines = (doc.lines ?? []).map((l, i) => ({ id: l.id, lineNo: i + 1, total: l.total ?? 0, uom: relId(l.uom) ?? null, category: relId(l.category) ?? null, receiptAmount: l.receiptAmount ?? null }))
  // D4: lines charged to a RAP item that is over its planned amount (cancelled / rejected requests: nothing to warn)
  const rapOver =
    doc.status === 'cancelled' || doc.status === 'rejected'
      ? []
      : await rapOverBudgetLines(req, { requestId, projectId: relId(doc.project) ?? null, lines: (doc.lines ?? []).map((l, i) => ({ id: l.id, lineNo: i + 1, total: l.total ?? 0, rapItem: relId(l.rapItem) ?? null })) })
  const receipts = (await receiptsOf(req, requestId, true)).map((r) => ({ id: r.id, lineId: r.lineId, receiptDate: r.receiptDate, amount: r.amount }))
  const catIds = [...new Set(lines.map((l) => l.category).filter((x): x is number => x !== null))]
  const uomIds = [...new Set(lines.map((l) => l.uom).filter((x): x is number => x !== null))]
  const [cats, uoms] = await Promise.all([
    catIds.length
      ? req.payload.find({ collection: 'expense-categories', where: { id: { in: catIds } }, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: flag rules */, req })
      : Promise.resolve({ docs: [] }),
    uomIds.length
      ? req.payload.find({ collection: 'uoms', where: { id: { in: uomIds } }, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: flag messages */, req })
      : Promise.resolve({ docs: [] }),
  ])
  const categories = new Map<number, FlagCategory>(
    (cats.docs as Array<{ id: number; name: string; allowedUoms?: unknown[] | null }>).map((c) => [c.id, { id: c.id, name: c.name, allowedUoms: ids(c.allowedUoms) }]),
  )
  const uomNames = new Map<number, string>((uoms.docs as Array<{ id: number; name: string }>).map((u) => [u.id, u.name]))
  let transferDate: string | null = null
  if (doc.type === 'advance') {
    const t = await req.payload.find({
      collection: 'transfers',
      where: { and: [{ request: { equals: requestId } }, { status: { equals: 'posted' } }] },
      sort: 'transferDate',
      limit: 1,
      depth: 0,
      overrideAccess: true, // SYSTEM-READ: transfer date for flag rules
      req,
    })
    transferDate = ((t.docs[0] as { transferDate?: string } | undefined)?.transferDate ?? null) || null
  }
  const desired = computeFlags({
    type: doc.type,
    requestDate: doc.requestDate ?? (await today(req)),
    transferDate,
    lines,
    receipts,
    categories,
    uomNames,
    duplicates: await duplicateHits(req, requestId),
    tolerance: s.receiptRoundingTolerance ?? 1000, // Q-14 default
    maxAgeDays: s.receiptMaxAgeDays ?? 30,
    rapOver,
  })

  await persistFlags(req, doc, desired)
  return desired
}

/**
 * Stores the desired flag set of a request: new → `open` (audit flag_raised), vanished or changed → `resolved`.
 * `kinds`: only flags of these kinds are compared (D4 RAP refresh at decision time touches nothing else).
 */
async function persistFlags(req: PayloadRequest, doc: RequestDoc, desired: FlagSpec[], kinds?: readonly FlagKind[]): Promise<void> {
  const requestId = doc.id
  const existing = (
    await req.payload.find({
      collection: 'receipt-flags',
      where: { and: [{ request: { equals: requestId } }, { status: { in: ['open', 'reviewed'] } }, ...(kinds ? [{ kind: { in: [...kinds] } }] : [])] },
      depth: 0,
      pagination: false,
      overrideAccess: true, // SYSTEM-READ: current flags
      req,
    })
  ).docs as unknown as FlagDoc[]
  const byKey = new Map(existing.map((f) => [f.key, f]))
  const wanted = new Map(desired.map((f) => [f.key, f]))
  const now = new Date().toISOString()
  for (const f of existing) {
    const w = wanted.get(f.key)
    if (w && w.level === f.level && w.message === f.message) continue
    await req.payload.update({
      collection: 'receipt-flags',
      id: f.id,
      data: { status: 'resolved', resolvedAt: now } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: flag no longer applies
      req,
    })
    byKey.delete(f.key)
  }
  const raised: FlagSpec[] = []
  for (const w of desired) {
    if (byKey.has(w.key)) continue
    await req.payload.create({
      collection: 'receipt-flags',
      data: {
        request: requestId,
        key: w.key,
        kind: w.kind,
        level: w.level,
        lineId: w.lineId,
        lineNo: w.lineNo,
        receipt: w.receiptId ?? null,
        relatedRequest: w.relatedRequestId ?? null,
        relatedCompany: w.relatedCompanyId ?? null,
        message: w.message,
        detail: w.detail,
        status: 'open',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: flag raised by the rules
      req,
    })
    raised.push(w)
  }
  if (raised.length > 0) {
    await writeAudit(
      req,
      raised.map((w) => ({
        action: 'flag_raised' as const,
        docType: 'expense_request',
        docId: String(requestId),
        docNo: doc.docNo ?? undefined,
        field: w.kind,
        lineNo: w.lineNo,
        newValue: { level: w.level, message: w.message, ...(w.relatedCompanyId !== undefined ? { relatedCompanyId: w.relatedCompanyId } : {}) },
        // QA-MC4-06: a cross-PT duplicate names a request of another PT → row WITHOUT a PT (group admins /
        // Admin-Direktur of every PT only); the request's "Riwayat" hides it from viewers not mapped to it
        ...(w.relatedCompanyId !== undefined ? { companyId: null } : {}),
      })),
    )
  }
}

/**
 * D4: refreshes only the "Melebihi RAP" flags of a request (RAP realisation moves when OTHER requests of the project
 * are approved). Called before every decision on it and, after a final approval, for the project's other pending
 * requests. Nothing else of the flag set changes.
 */
export async function syncRapFlags(req: PayloadRequest, requestId: number): Promise<void> {
  const doc = await loadRaw(req, requestId)
  const lines = (doc.lines ?? []).map((l, i) => ({ id: l.id, lineNo: i + 1, total: l.total ?? 0, rapItem: relId(l.rapItem) ?? null }))
  const over = doc.status === 'cancelled' || doc.status === 'rejected' ? [] : await rapOverBudgetLines(req, { requestId, projectId: relId(doc.project) ?? null, lines })
  await persistFlags(req, doc, rapOverFlagSpecs(over), ['rap_over_budget'])
}

/** D4: after request `approvedId` became committed, its project's pending requests re-check their RAP flags. */
export async function syncProjectRapFlags(req: PayloadRequest, approvedId: number): Promise<void> {
  const doc = await loadRaw(req, approvedId)
  const projectId = relId(doc.project)
  if (!projectId || !(doc.lines ?? []).some((l) => relId(l.rapItem) !== undefined)) return
  const pending = await req.payload.find({
    collection: 'expense-requests',
    where: { and: [{ project: { equals: projectId } }, { status: { in: ['pending_ack', 'pending_approval'] } }, { id: { not_equals: approvedId } }] },
    depth: 0,
    limit: 200,
    select: { status: true },
    overrideAccess: true, // SYSTEM-READ: sibling requests of the project whose RAP warning may change
    req,
  })
  for (const d of pending.docs) await syncRapFlags(req, d.id as number)
}

