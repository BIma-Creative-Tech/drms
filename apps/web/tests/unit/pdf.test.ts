import { describe, expect, it } from 'vitest'

import { formatAmount, formatDateLong, formatQty, formatServerTime, pdfSafe, subtitleOf } from '@/pdf/format'
import type { PdfData } from '@/pdf/PengajuanBiaya'
import { renderPengajuanBiaya } from '@/pdf/render'
import { FORM_228 } from '@/seed/form-fixture'

import { writeFileSync } from 'node:fs'

import { pdfFlatText, pdfPageCount, pdfText, pdfTextRuns } from '../fixtures/pdf-text'
import { receiptImage, signatureImage } from '../fixtures/receipt-image'

describe('PDF formatting (ADR 0008 §6)', () => {
  it('Rupiah, dates, quantities, subtitle', () => {
    expect(formatAmount(1_447_500)).toBe('1.447.500')
    expect(formatAmount(null)).toBe('')
    expect(formatDateLong('2026-09-20')).toBe('20 September 2026')
    expect(formatQty(24.8)).toBe('24,8')
    expect(formatQty(1200)).toBe('1.200')
    expect(formatServerTime('2026-09-20T06:05:00.000Z', 'Asia/Makassar')).toBe('20/09/2026 14:05 WITA')
    expect(subtitleOf('228/PB-DRMS/20/IX/2026', 'DRMS', 'Pengajuan Reimburse Ops')).toBe('228-PB DRMS-Pengajuan Reimburse Ops')
    expect(pdfSafe('a → b\u0007')).toBe('a -> b')
  })
})

/** Template-level golden test (no DB): the form 228 fixture as PdfData. The DB-driven golden test is in form-228.int.test.ts. */
describe('PengajuanBiaya template', () => {
  it('renders the form 228 layout; text extraction finds number, grand total and the 4 positions', async () => {
    const sig = { data: await signatureImage(1), format: 'png' as const }
    const d: PdfData = {
      companyName: 'PT Double Rezki Makmur Sejahtera',
      companyCode: 'DRMS',
      kop: [],
      logo: null,
      subtitle: subtitleOf(FORM_228.docNo, 'DRMS', FORM_228.title),
      dateText: formatDateLong(FORM_228.requestDate),
      docNo: FORM_228.docNo,
      typeLabel: 'Reimburse',
      statusLabel: 'Disetujui',
      lines: FORM_228.lines.map((l, i) => ({ no: i + 1, description: l.description, qty: formatQty(l.qty), uom: l.uomCode ?? '', unitPrice: formatAmount(l.unitPrice), total: formatAmount(l.total), notes: '' })),
      grandTotal: 'Rp 1.447.500',
      signatures: [
        { label: 'Diajukan Oleh', names: 'Budi, Doni Pratama', images: [sig], time: '20/09/2026 09:00 WITA' },
        { label: 'Dibuat Oleh', names: 'Citra', images: [sig], time: '20/09/2026 09:00 WITA' },
        { label: 'Diketahui Oleh', names: 'Budi Hartono', images: [sig], time: '20/09/2026 10:00 WITA' },
        { label: 'Approval', names: 'Sari', images: [sig], time: '20/09/2026 11:00 WITA' },
      ],
      transfer: { bankName: 'Bank Mandiri', accountHolder: 'Doni Pratama', accountNo: FORM_228.bankAccountNo },
      receipts: await Promise.all(
        FORM_228.receipts.map(async (r, i) => ({
          heading: `Nota ${i + 1} — baris ${r.line + 1}: ${r.vendorName}`,
          details: `No. ${r.receiptNo} · ${r.receiptDate}`,
          status: 'valid',
          image: { data: await receiptImage([r.vendorName, `NO ${r.receiptNo}`, `TOTAL RP ${formatAmount(r.amount)}`]), format: 'jpg' as const },
          flags: [],
        })),
      ),
      internal: false,
      printedText: 'Dicetak 23/09/2026 10:00 WITA oleh Finance',
    }
    const pdf = await renderPengajuanBiaya(d)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const text = pdfText(pdf)
    expect(text).toContain('PENGAJUAN BIAYA')
    expect(text).toContain('228/PB-DRMS/20/IX/2026')
    expect(text).toContain('Rp 1.447.500')
    if (process.env.PK_PDF_UNIT_OUT) writeFileSync(process.env.PK_PDF_UNIT_OUT, pdf)
    expect(pdfFlatText(pdf)).toContain('228-PB DRMS-Pengajuan Reimburse Ops Palangka Banjar keperluan Service Tronton')
    for (const label of ['Diajukan Oleh', 'Dibuat Oleh', 'Diketahui Oleh', 'Approval']) expect(text).toContain(label)
    const lines = pdfTextRuns(pdf)
    if (process.env.PK_PDF_DUMP) console.log(JSON.stringify(lines, null, 1))
    expect(lines).toEqual(
      expect.arrayContaining([
        '228-PB DRMS-Pengajuan Reimburse Ops Palangka Banjar keperluan Service Tronton',
        'No Uraian Jumlah Satuan Harga Satuan Total Keterangan',
        '2 Penginapan 2 KMR 338.500 677.000',
        '3 Makan siang 170.500',
        'GRAND TOTAL Rp 1.447.500',
        'Diajukan Oleh Dibuat Oleh Diketahui Oleh Approval',
        'Budi, Doni Pratama Citra Budi Hartono Sari',
      ]),
    )
    expect(pdfPageCount(pdf)).toBe(3) // form + 3 receipts at 2 per page
  })
})
