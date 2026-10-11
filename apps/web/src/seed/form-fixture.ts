/**
 * The client's paper form "228/PB-DRMS/20/IX/2026" as TEST DATA (requirements v1.1 §1.3; people
 * are the FICTIONAL pseudonyms of seed/data.ts — the public repo holds no client personal data).
 * Used by the F2a integration test (and later the F2b PDF test). It is NOT loaded by the live
 * seed: the historical number is registered with `submit(…, { historical })`, which formats
 * seq 228 / 20-09-2026 WITHOUT touching the live PB counter (go-live continues at 229).
 *
 * Expected: grand total Rp 1.447.500 (600.000 + 677.000 + 170.500; line 2 = user-rounded hotel
 * bill 676.876). D3 (DRMS 10/10): the line total is qty × harga satuan, so line 2 is entered as
 * 2 × 338.500 (the paper showed an informational 339.000); lines 1 and 3 carry only the total → the
 * server derives the unit price (total ÷ qty). Flags: hotel diff Rp 124 → info (tolerance Rp 1.000, Q-14);
 * receipts dated 21/09 after the 20/09 request date → date_after_request (Q-04: TGL = submit
 * date); BBM unit "bulan" → uom_suspicious (BBM allowed: liter, kali isi — Q-20).
 */
export const FORM_228 = {
  seq: 228,
  requestDate: '2026-09-20',
  docNo: '228/PB-DRMS/20/IX/2026',
  type: 'reimburse' as const,
  title: 'Pengajuan Reimburse Ops Palangka Banjar keperluan Service Tronton',
  costCenterCode: 'OPS-PB',
  /** "Diajukan Oleh" in order: Budi, Doni. */
  requesterCodes: ['EMP-001', 'EMP-002'],
  /** "Dibuat Oleh" Citra (Admin, Q-09), "Diketahui Oleh" Budi Hartono, "Approval" Sari. */
  creatorCode: 'EMP-003',
  acknowledgerCode: 'EMP-004',
  approverCode: 'EMP-005',
  bankAccountNo: '1234567890123',
  grandTotal: 1_447_500,
  lines: [
    { description: 'BBM Hilux Banjarmasin-Palangka', qty: 1, uomCode: 'BLN', unitPrice: null, total: 600_000, categoryCode: 'BBM', vehiclePlate: 'DA1234XY' },
    { description: 'Penginapan', qty: 2, uomCode: 'KMR', unitPrice: 338_500, total: 677_000, categoryCode: 'INAP', vehiclePlate: null },
    { description: 'Makan siang', qty: null, uomCode: null, unitPrice: null, total: 170_500, categoryCode: 'KSM', vehiclePlate: null },
  ],
  receipts: [
    { line: 0, receiptNo: '7654321', vendorName: 'Pertamina SPBU 61234501', receiptDate: '2026-09-21', receiptTime: '11:42:59', amount: 600_000, taxAmount: null },
    { line: 1, receiptNo: '9876543210', vendorName: 'POP! Hotel Banjarmasin (Traveloka)', receiptDate: '2026-09-20', receiptTime: null, amount: 676_876, taxAmount: null },
    { line: 2, receiptNo: 'TX0101.0001.000123', vendorName: 'Soto "Mas Joko" Banjarmasin', receiptDate: '2026-09-21', receiptTime: '10:47', amount: 170_500, taxAmount: 15_500 },
  ],
} as const
