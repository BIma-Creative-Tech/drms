/**
 * QA-21: API / form error paths → the labels the user sees in the forms (Bahasa Indonesia). Error
 * texts never show a raw path ("usageNotes: Wajib diisi"); an unknown path is dropped and only the
 * message is shown. Pure data, safe for client components.
 */
const LABELS: Record<string, string> = {
  title: 'Judul',
  type: 'Jenis',
  description: 'Keterangan',
  notes: 'Catatan',
  note: 'Catatan',
  reason: 'Alasan',
  changeReason: 'Alasan perubahan',
  usageNotes: 'Uraian penggunaan dana',
  financeNotes: 'Catatan Finance',
  amount: 'Nominal',
  addition: 'Tambahan RAB',
  entryDate: 'Tanggal',
  receiptDate: 'Tanggal nota',
  receiptNo: 'No. nota',
  vendorName: 'Vendor / toko',
  transferDate: 'Tanggal transfer',
  bankRef: 'No. referensi bank',
  neededDate: 'Tanggal dibutuhkan',
  urgencyLevel: 'Tingkat urgensi',
  urgencyLevelId: 'Tingkat urgensi',
  lines: 'Rincian item',
  lineId: 'Baris item',
  project: 'Project',
  projectId: 'Project',
  costCenter: 'Pusat biaya',
  costCenterId: 'Pusat biaya',
  requesters: 'Diajukan oleh',
  // d1510 (owner decision 2026-10-15): "Log perubahan" row of a request re-routed to the current approval rule
  approvalRule: 'Alur persetujuan',
  requesterIds: 'Diajukan oleh',
  bankAccount: 'Rekening tujuan',
  bankAccountId: 'Rekening tujuan',
  cashAccountId: 'Akun kas',
  categoryId: 'Kategori',
  category: 'Kategori',
  cashInSourceId: 'Sumber kas masuk',
  vehicleId: 'Kendaraan',
  vehicle: 'Kendaraan',
  uomId: 'Satuan',
  uom: 'Satuan',
  qty: 'Jumlah',
  // DRMS 13/10 Persetujuan #6: line fields of the request audit ("Log perubahan": lines.total, lines.rapItem)
  total: 'Total',
  rapItem: 'Item RAP',
  rapItemId: 'Item RAP',
  unitPrice: 'Harga satuan',
  receiptAmount: 'Nominal sesuai nota',
  proofId: 'Bukti',
  proofMediaId: 'Bukti transfer',
  imageId: 'Foto nota',
  signatureMediaId: 'Tanda tangan',
  company: 'PT',
  company_id: 'PT',
  code: 'Kode',
  name: 'Nama',
  stages: 'Tahapan',
  sequence: 'Urutan',
  weightPct: 'Bobot (%)',
  roles: 'Peran',
  employee: 'Karyawan',
  active: 'Aktif',
}

/** Label of an error path: `lines.2.uomId` → "Baris 3 · Satuan"; unknown → null (path not shown). */
export function fieldLabel(path: string | null | undefined): string | null {
  if (!path) return null
  const parts = path.split('.')
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    const next = parts[i + 1]
    if (next !== undefined && /^\d+$/.test(next)) {
      out.push(p === 'lines' ? `Baris ${Number(next) + 1}` : p === 'stages' ? `Tahapan ${Number(next) + 1}` : p === 'items' ? `Baris ${Number(next) + 1}` : `${LABELS[p] ?? p} ${Number(next) + 1}`)
      i++
      continue
    }
    const label = LABELS[p]
    if (!label) return out.length > 0 ? out.join(' · ') : null
    out.push(label)
  }
  return out.join(' · ')
}

/** One error line: "Label: message", or just the message when the path has no label. */
export function errorLine(e: { path?: string | null; message?: string | null }): string {
  const msg = (e.message ?? '').trim()
  const label = fieldLabel(e.path)
  return label && msg ? `${label}: ${msg}` : msg || label || ''
}
