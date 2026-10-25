import React from 'react'

import type { detail } from '@/domain/expense/dto'
import { maskAccountNo } from '@/domain/expense/dto'
import { formatRupiah } from '@/lib/money'
import { formatDateLong } from '@/pdf/format'

import { ImageThumb } from '../media/ImageThumb'
import { isNonImage, mediaThumbSource } from '../media/media-url'
import { BankReveal } from './BankReveal'

type Detail = Awaited<ReturnType<typeof detail>>

const named = (r: unknown): string => {
  if (!r || typeof r !== 'object') return ''
  const o = r as { code?: unknown; name?: unknown }
  return [o.code, o.name].filter((x) => typeof x === 'string' && x).join(' ')
}

/** Chosen account of a Draft (no submit snapshot yet) — bank-preview.ts, masked. */
export type DraftBank = { bankName: string | null; accountHolder: string | null; accountNoMasked: string | null; canReveal: boolean }

/**
 * DRMS 10/10 B-2 (item 3): read-only "Rincian pengajuan" of a submitted (locked) request — label: value on one
 * line, the APK detail order (PT, project / pusat biaya, urgensi, tanggal, pemohon, dibuat oleh, rekening,
 * keterangan, lampiran). Replaces the disabled header inputs of the Payload form (empty "Pilih project…"
 * placeholders, a "memuat…" account preview). Rows without a value are left out. Server-rendered from the
 * request DTO; the bank number is masked, the eye button reveals it only for the people the DTO allows.
 * DRMS 13/10 Persetujuan #5/#7: shown for EVERY status (read mode of a Draft too) as a two-column grid on wide screens,
 * with the money totals that left the sidebar (Nominal disetujui, Total ditransfer, Total nota terverifikasi LPJ); the
 * grand total stays the footer of "Rincian item".
 */
export function RequestSummary({ d, ptName, attachments, canRevealBank, draftBank = null }: { d: Detail; ptName: string | null; attachments: Array<{ id: number; name: string; mimeType?: string | null }>; canRevealBank: boolean; draftBank?: DraftBank | null }) {
  const scope = d.project ? named(d.project) : d.costCenter ? named(d.costCenter) : ''
  const rows: Array<[string, React.ReactNode, string]> = []
  const add = (label: string, value: React.ReactNode, key: string) => {
    if (value !== null && value !== undefined && value !== '') rows.push([label, value, key])
  }
  add('Jenis', d.typeLabel, 'type')
  // ADR 0027: vendor payment — the payee is the vendor (Pemohon = the Staff / Finance / PM filer)
  const vendorPay = d.payeeType === 'vendor'
  // ADR 0028: payment to another PT of the group — the payee is that PT (its designated receiving account)
  const icPay = d.payeeType === 'pt_grup'
  if (vendorPay) add('Jenis penerima', 'Vendor', 'payeeType')
  if (icPay) add('Jenis penerima', 'PT grup (pembayaran antar-PT)', 'payeeType')
  add('Judul', d.title, 'title')
  add('PT', ptName, 'company')
  add(d.project ? 'Project' : 'Pusat biaya lama', scope, 'scope')
  // ADR 0031 (DRMS 21/10): the Pusat Biaya = the project's cash account (read-only; the requester never picks it)
  if (d.project) add('Pusat biaya', d.pusatBiaya?.name ?? 'Project belum dipetakan ke pusat biaya (akun kas)', 'pusatBiaya')
  // ADR 0031: a transfer paid from another account → the automatic inter-project loan
  const paidFrom = [...d.transfers].reverse().find((t) => t.status === 'posted' && t.paidFromCashAccount)
  if (paidFrom?.paidFromCashAccount) add('Dibayar dari akun', `${paidFrom.paidFromCashAccount.name ?? '—'}${paidFrom.projectLoan ? ` (pinjaman ${paidFrom.projectLoan.docNo ?? ''})` : ''}`, 'paidFrom')
  add('Tingkat urgensi', d.urgencyLevel && 'name' in d.urgencyLevel ? String(d.urgencyLevel.name ?? '') : '', 'urgency')
  add('Tanggal pengajuan', d.requestDate ? formatDateLong(d.requestDate) : '', 'requestDate')
  add('Tanggal dibutuhkan', d.neededDate ? formatDateLong(d.neededDate) : '', 'neededDate')
  add('Pemohon', d.requesters.map((r) => (r && 'name' in r ? String(r.name ?? '') : '')).filter(Boolean).join(', '), 'requesters')
  add('Dibuat oleh', d.createdBy && 'name' in d.createdBy ? String(d.createdBy.name ?? '') : '', 'createdBy')
  // a submitted request shows its submit snapshot; a Draft (read mode, Persetujuan #7) the chosen account
  const bank = d.bank
    ? { bankName: d.bank.bankName, accountHolder: d.bank.accountHolder, masked: d.bank.accountNo ? (maskAccountNo(d.bank.accountNo, false) ?? '') : null, canReveal: canRevealBank }
    : draftBank
      ? { bankName: draftBank.bankName, accountHolder: draftBank.accountHolder, masked: draftBank.accountNoMasked, canReveal: draftBank.canReveal }
      : null
  if (vendorPay) add('Vendor', d.vendor && 'name' in d.vendor ? String(d.vendor.name ?? '') : '', 'vendor')
  if (icPay) {
    const pc = d.payeeCompany as { shortCode?: unknown; name?: unknown } | null
    add('PT penerima', pc ? [pc.shortCode, pc.name].filter((x) => typeof x === 'string' && x).join(' — ') : '', 'payeeCompany')
  }
  add(
    vendorPay ? 'Rekening vendor' : icPay ? 'Rekening penerimaan antar-PT' : 'Rekening tujuan',
    bank ? (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <span>
          {[bank.bankName, bank.accountHolder].filter(Boolean).join(' · ')}
          {bank.masked ? ' ·' : ''}
        </span>
        {bank.masked ? <BankReveal requestId={d.id} masked={bank.masked} canReveal={bank.canReveal} /> : null}
      </span>
    ) : null,
    'bank',
  )
  if ((vendorPay || icPay) && d.invoice) {
    // ADR 0028: the receiving PT's document (tagihan / memo) of a PT grup payment
    const docLabel = vendorPay ? 'invoice' : 'dokumen PT penerima'
    add(`Nomor ${docLabel}`, d.invoice.no ?? '', 'invoiceNo')
    add(`Tanggal ${docLabel}`, d.invoice.date ? formatDateLong(d.invoice.date) : '', 'invoiceDate')
    add('Jatuh tempo', d.invoice.dueDate ? formatDateLong(d.invoice.dueDate) : '', 'invoiceDueDate')
    add(
      `File ${docLabel}`,
      d.invoice.fileId ? (
        // D2510 (web 0.21.1): an image document is previewed (lightbox), a PDF stays a file link with its name
        <ImageThumb
          src={mediaThumbSource('attachments', d.invoice.fileId)}
          group={`request-files-${d.id}`}
          title={`File ${docLabel}${d.invoice.no ? ` ${d.invoice.no}` : ''}`}
          caption={d.invoice.date ? formatDateLong(d.invoice.date) : null}
          file={isNonImage(d.invoice.mimeType, d.invoice.fileName)}
          fileLabel={d.invoice.fileName ?? (vendorPay ? 'Lihat invoice' : 'Lihat dokumen')}
          size={72}
          data-pk-invoice-file=""
        />
      ) : null,
      'invoiceFile',
    )
  }
  // ADR 0028: the receiving PT's Kas Masuk of the transfer (number only; the entry belongs to that PT)
  if (icPay && d.intercompany) {
    add(
      `Kas masuk di PT ${d.intercompany.targetCompany?.shortCode ?? 'penerima'}`,
      <span data-pk-ic-entry={d.intercompany.status}>
        {d.intercompany.targetEntryNo}
        {d.intercompany.status === 'void' ? ' (dibatalkan — jurnal balik tercatat)' : ''}
      </span>,
      'intercompany',
    )
  }
  if (d.approvedAmount !== null) add('Nominal disetujui', formatRupiah(d.approvedAmount), 'approvedAmount')
  if (d.status !== 'draft') add('Total ditransfer', formatRupiah(d.transferredTotal ?? 0), 'transferredTotal')
  if (d.verifiedReceiptsTotal !== null) add('Total nota terverifikasi LPJ', formatRupiah(d.verifiedReceiptsTotal), 'verifiedReceiptsTotal')
  add('Keterangan', d.notes?.trim() ?? '', 'notes')
  add(
    'Lampiran',
    attachments.length > 0 ? (
      // D2510 (web 0.21.1): photos as previews (one lightbox group with the invoice file), PDFs as file links
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }} data-pk-attachments={attachments.length}>
        {attachments.map((a, i) => (
          <ImageThumb
            key={a.id}
            src={mediaThumbSource('attachments', a.id)}
            group={`request-files-${d.id}`}
            title={`Lampiran ${i + 1}/${attachments.length}`}
            caption={a.name}
            file={isNonImage(a.mimeType, a.name)}
            fileLabel={a.name}
            size={72}
            data-pk-attachment={a.id}
          />
        ))}
      </span>
    ) : null,
    'attachments',
  )
  return (
    <section className="pk-er-summary" data-pk-section="summary" style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 12, marginBottom: 16, fontSize: 13 }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>Rincian pengajuan</strong>
      <dl className="pk-er-summary__grid" style={{ margin: 0, display: 'grid', gap: 6 }}>
        {rows.map(([label, value, key]) => (
          <div key={key} className={key === 'notes' || key === 'attachments' || key === 'title' ? 'is-wide' : undefined} data-pk-summary={key} style={{ display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'baseline' }}>
            <dt style={{ flex: '0 0 auto', minWidth: 132, color: 'var(--pk-muted-fg)' }}>{label}:</dt>
            <dd style={{ margin: 0, flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere', fontWeight: 500 }}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default RequestSummary
