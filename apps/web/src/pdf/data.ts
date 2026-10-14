import type { PayloadRequest } from 'payload'

import { relId, ROLE_LABELS, type Role } from '@/access/roles'
import { approvalsOf, settings, type ApprovalRow, type RequestDoc } from '@/domain/expense/common'
import { displayNames } from '@/domain/companies'
import { COMPANY_SIGNATURE_SOURCE, direkturLabel } from '@/domain/direktur-rules'
import { isNoApproval, NO_APPROVAL_PDF_LABEL, selfApprovalNote, SKIPPED_LABEL } from '@/domain/expense/decision'
import { withFlagVisibility } from '@/domain/expense/flag-visibility'
import { displayUnitPrice } from '@/domain/expense/lines'
import { receiptsOf } from '@/domain/expense/receipts'
import { requestStatusLabel } from '@/domain/expense/timeline'
import { FLAG_LABELS, REQUEST_TYPE_LABELS, type FlagKind } from '@/domain/expense/types'
import { DEFAULT_TZ } from '@/lib/time'

import { formatAmount, formatDateLong, formatDateShort, formatQty, formatRupiah, formatServerTime, pdfSafe, subtitleOf } from './format'
import { loadImage, MAX_RECEIPT_IMAGES } from './images'
import type { PdfAttachment, PdfData, PdfImage, PdfReceipt, PdfSignature } from './PengajuanBiaya'

export { MAX_RECEIPT_IMAGES }


/**
 * Printed name of a decision: the stored `actorName`; ADR 0025 — signed as the PT's definitive Direktur → that
 * Direktur with the title of the snapshot ("Nama (Jabatan)"), never the representative, and no "via app" note.
 */
export function printedName(r: Pick<ApprovalRow, 'actorName' | 'signatureSource' | 'representedDirektur'> | undefined): string {
  if (!r) return ''
  if (r.signatureSource === COMPANY_SIGNATURE_SOURCE) return direkturLabel(r.representedDirektur?.name ?? r.actorName, r.representedDirektur?.title)
  return r.actorName ?? ''
}

/** "Nama (Direktur)" — the actor of an approval level with its role (ADR 0026: several levels in one box). */
export function approverWithRole(name: string | null | undefined, role: Role | null): string {
  const n = (name ?? '').trim()
  if (!n) return ''
  return role ? `${n} (${ROLE_LABELS[role]})` : n
}

/**
 * Name printed for an approval level in the Approval box: ADR 0025 company-signed rows print the definitive Direktur
 * ("Nama (Jabatan)", role suffix only when no title is recorded); every other row = `actorName` + role (ADR 0026).
 */
export function approvalPrintedName(r: Pick<ApprovalRow, 'actorName' | 'signatureSource' | 'representedDirektur'>, role: Role | null): string {
  if (r.signatureSource === COMPANY_SIGNATURE_SOURCE && r.representedDirektur?.title?.trim()) return printedName(r)
  return approverWithRole(printedName(r), role)
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
  // ADR 0016 §6: letterhead + {COMPANY} of the document's PT
  const s = await settings(req, relId((doc as { company?: unknown }).company))
  const tz = s.timezone || process.env.TZ || DEFAULT_TZ
  // {COMPANY} = the PT's own short code only (never a hard-coded fallback; numbering refuses an empty one)
  const companyCode = s.shortCode || ''
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
  // ADR 0016 D1: the creator's employee = membership link IN THE DOCUMENT's PT
  const creatorName =
    (creator ? (await displayNames(req, [creator.id], { emailFallback: false, companyId: relId((doc as { company?: unknown }).company) })).get(creator.id)?.replace(/^user#\d+$/, '') : undefined) || dibuat?.actorName || ''
  const skipped = doc.approvalSnapshot?.skipped ?? []
  const skippedAck = skipped.some((x) => x.position === 'diketahui')
  const skippedApproval = skipped.some((x) => x.position === 'approval') && (doc.approvalSnapshot?.steps.length ?? 0) === 0
  const noApproval = isNoApproval(doc.approvalSnapshot)
  const levelRole = (level: number): Role | null => doc.approvalSnapshot?.steps.find((x) => x.level === level && x.approverUserId === null)?.approverRole ?? null
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
      // ADR 0013: the Direktur's approval; ADR 0021: the PM project's approval (the actual acknowledger is
      // printed). F2e (legacy snapshots): delegated "Diketahui" → the actual person + "(dilimpahkan)".
      // ADR 0025: a representative's decision prints the PT's definitive Direktur (no "via app" note)
      names: pdfSafe(diketahui?.actorName ? `${printedName(diketahui)}${doc.approvalSnapshot?.acknowledgeDelegatedTo ? ' (dilimpahkan)' : ''}` : ''),
      images: diketahui?.decision === 'acknowledged' ? await sig(diketahui) : [],
      time: formatServerTime(diketahui?.decidedAt, tz),
      // ADR 0013 G1-2: the only Direktur was requester/creator → the position did not apply.
      // ADR 0024: a Direktur's own request without approval → no decision position applies.
      note: diketahui?.decision === 'rejected' ? 'DITOLAK' : !diketahui && skippedAck ? pdfSafe(SKIPPED_LABEL) : !diketahui && noApproval ? pdfSafe(NO_APPROVAL_PDF_LABEL) : undefined,
    },
    {
      label: 'Approval',
      // ADR 0026: every approval level is listed; with several levels each name carries its role ("… (Direktur), … (Owner)").
      // ADR 0025: a representative's decision prints the PT's definitive Direktur ("Nama (Jabatan)" — the title already
      // names the position, so no role suffix then).
      names: pdfSafe(approvals.map((a) => approvalPrintedName(a, approvals.length > 1 ? levelRole(a.level) : null)).filter(Boolean).join(', ')),
      images: approvals.some((a) => a.decision === 'rejected') ? [] : approvalImages,
      time: formatServerTime(approvals.at(-1)?.decidedAt, tz),
      note: approvals.some((a) => a.decision === 'rejected')
        ? 'DITOLAK'
        : approvals.length === 0 && skippedApproval
          ? pdfSafe(SKIPPED_LABEL)
          : approvals.length === 0 && noApproval
            ? pdfSafe(NO_APPROVAL_PDF_LABEL)
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
          // QA-MC4-06: a cross-PT duplicate only for viewers mapped to the other request's PT
          where: withFlagVisibility(req, { and: [{ request: { equals: requestId } }, { status: { not_equals: 'resolved' } }] }),
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

  // "Lampiran umum": images share the receipts' image budget (ADR 0008 §2); PDFs are listed by name
  let imageBudget = Math.max(0, MAX_RECEIPT_IMAGES - Math.min(receiptRows.length, MAX_RECEIPT_IMAGES))
  const attachments: PdfAttachment[] = []
  for (const [i, a] of (doc.attachments ?? []).entries()) {
    const id = relId(a)
    const m = id
      ? ((await req.payload.findByID({ collection: 'media-attachments', id, depth: 0, overrideAccess: true /* SYSTEM-READ: caller access checked */, req }).catch(() => null)) as {
          mimeType?: string | null
          width?: number | null
          height?: number | null
        } | null)
      : null
    if (!m) continue
    const isImage = m.mimeType === 'image/jpeg' || m.mimeType === 'image/png'
    const image = isImage && imageBudget > 0 ? await loadImage(req, 'media-attachments', id) : null
    if (image) imageBudget--
    attachments.push({
      heading: pdfSafe(`Lampiran ${i + 1}`),
      details: pdfSafe(isImage ? `Gambar ${m.width ?? '?'}×${m.height ?? '?'} px` : 'Berkas PDF'),
      image,
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
    statusLabel: pdfSafe(requestStatusLabel(doc.type, doc.status, doc.approvalSnapshot ?? null, doc.currentLevel ?? null)),
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
    // ADR 0021 / 0024: the G1 exception is printed with the signatures (who filed / who approved, or none).
    policyNote: selfApprovalNote(doc.approvalSnapshot?.selfApproval) ? pdfSafe(selfApprovalNote(doc.approvalSnapshot?.selfApproval)) : undefined,
    transfer: doc.bankSnapshot?.accountNo
      ? {
          bankName: pdfSafe(doc.bankSnapshot.bankName ?? ''),
          accountHolder: pdfSafe(doc.bankSnapshot.accountHolder ?? ''),
          accountNo: pdfSafe(doc.bankSnapshot.accountNo),
        }
      : null,
    receipts,
    attachments,
    internal: opts.internal,
    printedText: pdfSafe(`Dicetak ${formatServerTime(new Date().toISOString(), tz)} oleh ${opts.printedBy}`),
  }
}
