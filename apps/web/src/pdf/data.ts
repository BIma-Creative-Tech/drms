import { readFile } from 'node:fs/promises'

import type { CollectionSlug, PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { approvalsOf, settings, type ApprovalRow, type RequestDoc } from '@/domain/expense/common'
import { SKIPPED_LABEL } from '@/domain/expense/decision'
import { displayUnitPrice } from '@/domain/expense/lines'
import { receiptsOf } from '@/domain/expense/receipts'
import { FLAG_LABELS, REQUEST_TYPE_LABELS, statusLabel, type FlagKind } from '@/domain/expense/types'
import { DEFAULT_TZ } from '@/lib/time'
import { mediaPath } from '@/lib/media-files'

import { formatAmount, formatDateLong, formatDateShort, formatQty, formatRupiah, formatServerTime, pdfSafe, subtitleOf } from './format'
import type { PdfData, PdfImage, PdfReceipt, PdfSignature } from './PengajuanBiaya'

/** Images larger than this are skipped (RAM guard; stored receipts are ≤ 2000 px JPEG ≈ 0.5 MB). */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
/** ADR 0008 §2: ≤ 12 receipt images per on-demand PDF (more → worker batch job, later phase). */
export const MAX_RECEIPT_IMAGES = 12

type MediaRow = { id: number; filename?: string | null; mimeType?: string | null; filesize?: number | null }

async function loadImage(req: PayloadRequest, collection: CollectionSlug, id: number | undefined): Promise<PdfImage | null> {
  if (!id) return null
  const m = (await req.payload.findByID({ collection, id, depth: 0, overrideAccess: true /* SYSTEM-READ: image of a document the caller may read */, req }).catch(() => null)) as MediaRow | null
  if (!m) return null
  const format = m.mimeType === 'image/jpeg' ? 'jpg' : m.mimeType === 'image/png' ? 'png' : null
  if (!format) return null // WebP/PDF cannot be embedded (@react-pdf/image: JPEG/PNG/SVG only)
  if ((m.filesize ?? 0) > MAX_IMAGE_BYTES) return null
  const p = mediaPath(req.payload, collection, m.filename)
  if (!p) return null
  try {
    return { data: await readFile(p), format }
  } catch {
    return null
  }
}

/** Latest cycle's signature rows per position (US-46: unsigned positions stay empty). */
function latestCycle(rows: ApprovalRow[]): ApprovalRow[] {
  const max = rows.reduce((m, r) => Math.max(m, r.cycle), 0)
  return rows.filter((r) => r.cycle === max)
}

/**
 * Collects everything the template prints, from the stored (locked) request: lines are frozen
 * after submit (DB content hash), signatures are immutable media rows referenced by the Class A
 * approval rows. The caller has already checked read access to the request.
 */
export async function buildPdfData(req: PayloadRequest, requestId: number, opts: { internal: boolean; printedBy: string }): Promise<PdfData> {
  const doc = (await req.payload.findByID({ collection: 'expense-requests', id: requestId, depth: 2, overrideAccess: true /* SYSTEM-READ: caller access checked */, req })) as unknown as Omit<RequestDoc, 'requesters' | 'createdBy' | 'lines'> & {
    requesters?: Array<{ id: number; name?: string } | number>
    createdBy?: { id: number; name?: string; employee?: { name?: string } | number | null } | number
    lines?: Array<{ id: string; description?: string; qty?: number | null; unitPrice?: number | null; total?: number | null; notes?: string | null; uom?: { name?: string; code?: string } | number | null }>
  }
  const s = await settings(req)
  const tz = s.timezone || process.env.TZ || DEFAULT_TZ
  const companyCode = s.shortCode || 'DRMS'
  const companyName = s.name || 'PT Double Rezki Makmur Sejahtera'

  const rows = latestCycle(await approvalsOf(req, requestId))
  const sig = async (r: ApprovalRow | undefined) => {
    const img = await loadImage(req, 'media-signatures', relId(r?.signature))
    return img ? [img] : []
  }
  const requesterNames = (doc.requesters ?? []).map((r) => (typeof r === 'object' ? (r.name ?? '') : '')).filter(Boolean)
  const diajukan = rows.find((r) => r.position === 'diajukan' && r.decision === 'signed')
  const dibuat = rows.find((r) => r.position === 'dibuat' && r.decision === 'signed')
  const diketahui = rows.find((r) => r.position === 'diketahui' && (r.decision === 'acknowledged' || r.decision === 'rejected'))
  const approvals = rows.filter((r) => r.position === 'approval' && (r.decision === 'approved' || r.decision === 'rejected')).sort((a, b) => a.level - b.level)
  const creator = typeof doc.createdBy === 'object' ? doc.createdBy : null
  const creatorName = (creator?.employee && typeof creator.employee === 'object' ? creator.employee.name : undefined) || creator?.name || dibuat?.actorName || ''
  const skipped = doc.approvalSnapshot?.skipped ?? []
  const skippedAck = skipped.some((x) => x.position === 'diketahui')
  const skippedApproval = skipped.some((x) => x.position === 'approval') && (doc.approvalSnapshot?.steps.length ?? 0) === 0
  const approvalImages: PdfImage[] = []
  for (const a of approvals.slice(-2)) approvalImages.push(...(await sig(a)))

  const signatures: PdfSignature[] = [
    {
      label: 'Diajukan Oleh',
      names: pdfSafe(requesterNames.join(', ')),
      images: await sig(diajukan),
      time: formatServerTime(diajukan?.decidedAt, tz),
      note: diajukan?.onBehalf ? pdfSafe(`ditandatangani ${diajukan.actorName ?? ''} (diwakili)`) : undefined,
    },
    { label: 'Dibuat Oleh', names: pdfSafe(creatorName), images: await sig(dibuat), time: formatServerTime(dibuat?.decidedAt, tz) },
    {
      label: 'Diketahui Oleh',
      // ADR 0013: the Direktur's approval. F2e (legacy snapshots): delegated "Diketahui" → the actual person + "(dilimpahkan)".
      names: pdfSafe(diketahui?.actorName ? `${diketahui.actorName}${doc.approvalSnapshot?.acknowledgeDelegatedTo ? ' (dilimpahkan)' : ''}` : ''),
      images: diketahui?.decision === 'acknowledged' ? await sig(diketahui) : [],
      time: formatServerTime(diketahui?.decidedAt, tz),
      // ADR 0013 G1-2: the only Direktur was requester/creator → the position did not apply.
      note: diketahui?.decision === 'rejected' ? 'DITOLAK' : !diketahui && skippedAck ? pdfSafe(SKIPPED_LABEL) : undefined,
    },
    {
      label: 'Approval',
      names: pdfSafe(approvals.map((a) => a.actorName ?? '').filter(Boolean).join(', ')),
      images: approvals.some((a) => a.decision === 'rejected') ? [] : approvalImages,
      time: formatServerTime(approvals.at(-1)?.decidedAt, tz),
      note: approvals.some((a) => a.decision === 'rejected')
        ? 'DITOLAK'
        : approvals.length === 0 && skippedApproval
          ? pdfSafe(SKIPPED_LABEL)
          : approvals.length > 1
            ? `${approvals.length} level`
            : undefined,
    },
  ]

  const lineNoById = new Map((doc.lines ?? []).map((l, i) => [l.id, i + 1]))
  const flagDocs = opts.internal
    ? ((
        await req.payload.find({
          collection: 'receipt-flags',
          where: { and: [{ request: { equals: requestId } }, { status: { not_equals: 'resolved' } }] },
          depth: 0,
          pagination: false,
          overrideAccess: true, // SYSTEM-READ: internal variant (Finance/Owner/Admin only, checked by the endpoint)
          req,
        })
      ).docs as unknown as Array<{ kind: FlagKind; level: string; status: string; lineNo?: number | null; receipt?: unknown; message: string }>)
    : []
  const receiptRows = (await receiptsOf(req, requestId)).filter((r) => r.status === 'pending' || r.status === 'valid' || (opts.internal && r.status === 'rejected'))
  const receipts: PdfReceipt[] = []
  for (const [i, r] of receiptRows.entries()) {
    const lineNo = r.lineNo ?? lineNoById.get(r.lineId) ?? null
    const flags = flagDocs
      .filter((f) => relId(f.receipt) === r.id || (relId(f.receipt) === undefined && f.lineNo === lineNo))
      .map((f) => pdfSafe(`${FLAG_LABELS[f.kind]} (${f.level}${f.status === 'reviewed' ? ', sudah diperiksa' : ''}): ${f.message}`))
    receipts.push({
      heading: pdfSafe(`Nota ${i + 1} — baris ${lineNo ?? '-'}: ${r.vendorName}`),
      details: pdfSafe(`No. ${r.receiptNo || '-'} · ${formatDateShort(r.receiptDate)} · ${formatRupiah(r.amount)}`),
      status: r.status === 'valid' ? 'valid' : r.status === 'rejected' ? 'DITOLAK' : 'menunggu verifikasi',
      image: i < MAX_RECEIPT_IMAGES ? await loadImage(req, 'media-receipts', relId(r.image)) : null,
      flags,
    })
  }

  const kop = [s.pdfHeader, s.address, s.phone ? `Telp. ${s.phone}` : null]
    .flatMap((x) => (x ? String(x).split(/\r?\n/) : []))
    .map((x) => pdfSafe(x.trim()))
    .filter(Boolean)
    .slice(0, 4)

  return {
    companyName: pdfSafe(companyName),
    companyCode: pdfSafe(companyCode),
    kop,
    logo: await loadImage(req, 'media-company', relId(s.logo)),
    subtitle: pdfSafe(subtitleOf(doc.docNo, companyCode, doc.title)),
    dateText: formatDateLong(doc.requestDate),
    docNo: pdfSafe(doc.docNo ?? '(belum bernomor)'),
    typeLabel: REQUEST_TYPE_LABELS[doc.type],
    statusLabel: pdfSafe(statusLabel(doc.type, doc.status)),
    lines: (doc.lines ?? []).map((l, i) => ({
      no: i + 1,
      description: pdfSafe(l.description ?? ''),
      qty: formatQty(l.qty),
      uom: pdfSafe(l.uom && typeof l.uom === 'object' ? (l.uom.name ?? l.uom.code ?? '') : ''),
      // US-37: unit price is informational; empty → total ÷ qty (display only).
      unitPrice: formatAmount(displayUnitPrice({ unitPrice: l.unitPrice, qty: l.qty, total: l.total })),
      total: formatAmount(l.total ?? 0),
      notes: pdfSafe(l.notes ?? ''),
    })),
    grandTotal: formatRupiah(doc.grandTotal ?? 0),
    signatures,
    transfer: doc.bankSnapshot?.accountNo
      ? {
          bankName: pdfSafe(doc.bankSnapshot.bankName ?? ''),
          accountHolder: pdfSafe(doc.bankSnapshot.accountHolder ?? ''),
          accountNo: pdfSafe(doc.bankSnapshot.accountNo),
        }
      : null,
    receipts,
    internal: opts.internal,
    printedText: pdfSafe(`Dicetak ${formatServerTime(new Date().toISOString(), tz)} oleh ${opts.printedBy}`),
  }
}
