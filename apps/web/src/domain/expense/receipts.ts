import { sql } from '@payloadcms/db-postgres'
import type { CollectionSlug, PayloadRequest } from 'payload'

import { relId, userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { getRequestTx } from '@/lib/tx'

import { actorContext, fail, ids, loadRaw, loadVisible, requireAction, requireActionAudited, settings, today, updateRequest, type RequestDoc } from './common'
import { computeFlags, normalizeReceiptNo, normalizeVendor, type DuplicateHit, type FlagCategory, type FlagSpec } from './flags'
import { grandTotal } from './lines'
import { auditSkipped, selectAndSnapshot, writeSnapshot } from './snapshot'
import { isBusinessDate, INACTIVE_FOR_DUPLICATES } from './types'

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

function lineIndex(doc: RequestDoc, lineId: string): number {
  const i = (doc.lines ?? []).findIndex((l) => l.id === lineId)
  if (i < 0) fail(400, 'Baris item tidak ditemukan.', [{ path: 'lineId', message: 'Baris item tidak ditemukan.' }])
  return i
}

function validateReceipt(input: Partial<ReceiptInput>, forCreate: boolean) {
  const errors: Array<{ path: string; message: string }> = []
  if (forCreate || input.receiptDate !== undefined) if (!isBusinessDate(input.receiptDate)) errors.push({ path: 'receiptDate', message: 'Tanggal nota harus YYYY-MM-DD.' })
  if (forCreate || input.amount !== undefined) {
    if (!(typeof input.amount === 'number' && Number.isSafeInteger(input.amount) && input.amount > 0)) errors.push({ path: 'amount', message: 'Nominal harus bilangan bulat Rupiah > 0.' })
  }
  if (forCreate || input.vendorName !== undefined) if (!(input.vendorName ?? '').trim()) errors.push({ path: 'vendorName', message: 'Vendor/toko wajib diisi.' })
  if (errors.length) fail(400, 'Data nota tidak valid.', errors)
}

/** POST /expense-requests/{id}/receipts (US-07, US-38). */
export async function addReceipt(req: PayloadRequest, requestId: number, input: ReceiptInput, opts: { clientUuid?: string } = {}) {
  const doc = await loadVisible(req, requestId, { lock: true })
  requireAction(await actorContext(req, doc), 'add_receipt')
  validateReceipt(input, true)
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
  await recomputeFlags(req, requestId)
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
  validateReceipt(input, false)
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
  await recomputeFlags(req, requestId)
  return updated
}

/** POST …/receipts/{rid}/remove — "hapus" = status removed + reason (no hard delete, G4/G7). */
export async function removeReceipt(req: PayloadRequest, requestId: number, receiptId: number, reason: string) {
  const doc = await loadVisible(req, requestId, { lock: true })
  requireAction(await actorContext(req, doc), 'add_receipt')
  const r = await loadReceipt(req, requestId, receiptId)
  if (r.status === 'removed') fail(409, 'Nota sudah dihapus.')
  req.context.auditReason = reason
  const updated = await req.payload.update({
    collection: 'receipts',
    id: receiptId,
    data: { status: 'removed', removeReason: reason } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: soft removal after guard
    req,
  })
  await recomputeFlags(req, requestId)
  return updated
}

/** US-39: Finance marks a receipt valid (Reimburse, after approval). */
export async function verifyReceipt(req: PayloadRequest, requestId: number, receiptId: number) {
  const doc = await loadVisible(req, requestId, { lock: true })
  await requireActionAudited(req, await actorContext(req, doc), 'receipt_verify', doc)
  const r = await loadReceipt(req, requestId, receiptId)
  if (r.status !== 'pending' && r.status !== 'rejected') fail(409, 'Nota tidak dalam status menunggu verifikasi.')
  return req.payload.update({
    collection: 'receipts',
    id: receiptId,
    data: { status: 'valid', verifiedBy: userId(req), verifiedAt: new Date().toISOString() } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: verification after guard (DB whitelist: status columns)
    req,
  })
}

/**
 * US-39: Finance rejects a receipt (reason) → Reimburse goes to "Revisi Nota". Uang Muka LPJ review
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
  if (doc.type === 'advance') return loadRaw(req, requestId)
  return updateRequest(req, requestId, { status: 'receipt_revision' }, reason)
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
  await assertEveryLineHasReceipt(req, raw)
  const total = grandTotal((raw.lines ?? []).map((l) => ({ total: l.total ?? null })))
  let updated: RequestDoc
  if (total === raw.approvedAmount) {
    updated = await updateRequest(req, requestId, { status: 'approved' })
  } else {
    const { rule, snapshot } = await selectAndSnapshot(req, raw)
    // E1 (ADR 0013 §6): the new amount goes through the WHOLE flow again — "Diketahui" (Direktur
    // approval) first when the new snapshot requires it, not straight to "Menunggu Approval".
    const needsAck = snapshot.acknowledge === 'required'
    updated = await updateRequest(req, requestId, {
      status: needsAck ? 'pending_ack' : 'pending_approval',
      approvalRule: rule.id,
      approvalSnapshot: snapshot,
      approvalCycle: (raw.approvalCycle ?? 0) + 1,
      currentLevel: needsAck ? 0 : 1,
    })
    await auditSkipped(req, updated, snapshot)
  }
  await writeSnapshot(req, updated, 'receipts_resubmit')
  await recomputeFlags(req, requestId)
  return updated
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
    where: { and: [{ request: { equals: requestId } }, { status: { equals: 'open' } }, { level: { equals: 'warning' } }] },
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
    .catch(() => null)) as (FlagDoc & { request: unknown }) | null
  if (!f || relId(f.request) !== requestId) fail(404, 'Flag tidak ditemukan.')
  if (f.status !== 'open') fail(409, 'Flag tidak terbuka.')
  const updated = await req.payload.update({
    collection: 'receipt-flags',
    id: flagId,
    data: { status: 'reviewed', reviewedBy: userId(req), reviewedAt: new Date().toISOString(), reviewNote: note ?? null } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: review after guard
    req,
  })
  await writeAudit(req, [
    { action: 'flag_reviewed', docType: 'expense_request', docId: String(requestId), docNo: doc.docNo ?? undefined, field: f.kind, oldValue: 'open', newValue: 'reviewed', reason: note },
  ])
  return updated
}

async function duplicateHits(req: PayloadRequest, requestId: number): Promise<DuplicateHit[]> {
  const tx = await getRequestTx(req)
  const inactive = sql.join(
    INACTIVE_FOR_DUPLICATES.map((s) => sql`${s}`),
    sql`, `,
  )
  const r = (await tx.execute(sql`
    SELECT r.id AS rid, o.request_id AS other, e.doc_no AS doc_no,
           CASE WHEN r.image_sha256 IS NOT NULL AND o.image_sha256 = r.image_sha256 THEN 'image' ELSE 'fields' END AS via
    FROM receipts r
    JOIN receipts o ON o.id <> r.id AND o.request_id <> r.request_id
     AND ((r.receipt_no_norm <> '' AND o.receipt_no_norm = r.receipt_no_norm AND o.vendor_norm = r.vendor_norm AND o.amount = r.amount)
          OR (r.image_sha256 IS NOT NULL AND o.image_sha256 = r.image_sha256))
    JOIN expense_requests e ON e.id = o.request_id
    WHERE r.request_id = ${requestId}
      AND r.status::text IN ('pending', 'valid') AND o.status::text IN ('pending', 'valid')
      AND e.status::text NOT IN (${inactive})
    ORDER BY r.id, o.request_id`)) as unknown as { rows: Array<{ rid: number; other: number; doc_no: string | null; via: 'image' | 'fields' }> }
  return r.rows.map((x) => ({ receiptId: Number(x.rid), otherRequestId: Number(x.other), otherDocNo: x.doc_no, via: x.via }))
}

/**
 * Recomputes the flag set of a request (architecture §5.6: on receipt save, on submit, on
 * receipt resubmit) and persists the difference: new → open + `flag_raised`; gone → `resolved`;
 * level/message changed → old resolved + new raised. Reviewed flags keep their review.
 */
export async function recomputeFlags(req: PayloadRequest, requestId: number): Promise<FlagSpec[]> {
  const doc = await loadRaw(req, requestId)
  const s = await settings(req)
  const lines = (doc.lines ?? []).map((l, i) => ({ id: l.id, lineNo: i + 1, total: l.total ?? 0, uom: relId(l.uom) ?? null, category: relId(l.category) ?? null }))
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
    periodFrom: doc.periodFrom,
    periodTo: doc.periodTo,
    lines,
    receipts,
    categories,
    uomNames,
    duplicates: await duplicateHits(req, requestId),
    tolerance: s.receiptRoundingTolerance ?? 1000, // Q-14 default
    maxAgeDays: s.receiptMaxAgeDays ?? 30,
  })

  const existing = (
    await req.payload.find({
      collection: 'receipt-flags',
      where: { and: [{ request: { equals: requestId } }, { status: { in: ['open', 'reviewed'] } }] },
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
        newValue: { level: w.level, message: w.message },
      })),
    )
  }
  return desired
}
