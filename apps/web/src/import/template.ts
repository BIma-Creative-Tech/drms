/**
 * Builds the go-live import workbook (E11) from the sheet specification: "Petunjuk" (Indonesian
 * instructions), "Pengaturan" and one sheet per master with header row, dropdowns/number ranges
 * (data validation) and Excel input hints. Used by scripts/gen-import-template.mjs (committed
 * template + fictional sample) and by the tests. Pure.
 */
import { BANKS, CATEGORIES, UOMS } from '@/seed/data'

import { SAMPLE } from './sample'
import { isTextColumn, SETTINGS, SHEETS, validationFor, type SheetKey } from './spec'
import { writeXlsx, type WriteCell, type WriteSheet } from './xlsx-io'

export type SheetRows = Partial<Record<Exclude<SheetKey, 'pengaturan'>, Array<Record<string, string | number | null>>>>
export type WorkbookContent = { settings: Record<string, string | number>; rows: SheetRows }

export const TEMPLATE_VERSION = 'S3b-1'

const V = (v: string | number | null | undefined): WriteCell => (v === null || v === undefined || v === '' ? null : v)

/** Standard master rows pre-filled in the blank template (same values as the seed, Q-19/Q-20). */
export function standardRows(): SheetRows {
  return {
    bank: BANKS.map((b) => ({ kode: b.code, nama: b.name })),
    satuan: UOMS.map((u) => ({ kode: u.code, nama: u.name, kelompok: u.category })),
    kategori: CATEGORIES.map((c) => ({
      kode: c.code,
      nama: c.name,
      satuan_default: (c as { defaultUom?: string }).defaultUom ?? null,
      satuan_wajar: c.allowed.join(', '),
      perlu_kendaraan: (c as { requiresVehicle?: boolean }).requiresVehicle ? 'Ya' : 'Tidak',
      aktif: 'Ya',
    })),
  }
}

function petunjuk(sample: boolean): WriteSheet {
  const rows: WriteCell[][] = [
    [{ v: sample ? 'CONTOH FIKTIF — Impor data go-live ProyekKas (DRMS)' : 'Template impor data go-live ProyekKas (DRMS)', s: 'title' }],
    [{ v: `Versi template ${TEMPLATE_VERSION}. ${sample ? 'SEMUA DATA DI FILE INI FIKTIF (untuk uji/latihan), bukan data klien.' : 'Diisi oleh klien, diperiksa oleh Lead sebelum impor.'}`, s: 'hint' }],
    [],
    [{ v: 'Cara mengisi', s: 'bold' }],
    [{ v: '1. Setiap sheet = satu jenis data master. Baris 1 (judul kolom) JANGAN diubah, dipindah atau dihapus. Kolom bertanda * wajib diisi.', s: 'wrap' }],
    [{ v: '2. Isi data mulai baris 2, satu baris per data. Baris kosong diabaikan. Sheet yang tidak dipakai biarkan hanya berisi judul kolom.', s: 'wrap' }],
    [{ v: '3. Kode (kode karyawan, kode project, kode bank, …) adalah penghubung antar sheet: tulis persis sama (huruf besar/kecil berpengaruh), tanpa spasi.', s: 'wrap' }],
    [{ v: '4. Nominal Rupiah: bilangan bulat tanpa desimal, mis. 1500000 atau 1.500.000. Tanggal: YYYY-MM-DD (mis. 2026-11-01) atau DD/MM/YYYY.', s: 'wrap' }],
    [{ v: '5. Nomor rekening dan No. HP ditulis sebagai TEKS (kolom sudah berformat teks) agar angka nol di depan tidak hilang.', s: 'wrap' }],
    [{ v: '6. Pilihan (Ya/Tidak, peran, jenis, status) tersedia sebagai daftar pilihan (dropdown) di sel. Pesan bantuan muncul saat sel dipilih.', s: 'wrap' }],
    [{ v: '7. PASSWORD TIDAK DIISI di file ini. Akun login dibuat oleh Lead di Keycloak; pengguna menerima password awal/tautan atur password terpisah.', s: 'wrap' }],
    [{ v: '8. Menghapus baris dari file TIDAK menghapus data di sistem. Untuk menonaktifkan, isi kolom aktif = Tidak.', s: 'wrap' }],
    [{ v: '9. File boleh diimpor berulang kali: data yang sama tidak digandakan, data yang berubah diperbarui (tercatat di audit log).', s: 'wrap' }],
    [{ v: '10. File berisi data pribadi (nomor rekening, No. HP): kirim hanya lewat saluran yang disepakati dengan Lead, jangan diunggah ke tempat umum.', s: 'wrap' }],
    [{ v: '11. Simpan sebagai .xlsx (Excel Workbook). Jangan menambah sheet lain; sheet yang tidak dikenal diabaikan.', s: 'wrap' }],
    [],
    [{ v: 'Isi per sheet', s: 'bold' }],
    [{ v: 'Sheet', s: 'header' }, { v: 'Kolom', s: 'header' }, { v: 'Wajib', s: 'header' }, { v: 'Keterangan', s: 'header' }],
  ]
  for (const sh of SHEETS) {
    rows.push([{ v: sh.name, s: 'bold' }, null, null, { v: `${sh.title}: ${sh.description}`, s: 'wrap' }])
    if (sh.key === 'pengaturan') {
      for (const s of SETTINGS) rows.push([null, s.key, 'Ya', { v: s.label, s: 'wrap' }])
      continue
    }
    for (const c of sh.columns) rows.push([null, c.key, c.required ? 'Ya' : '', { v: c.hint, s: 'wrap' }])
  }
  return { name: 'Petunjuk', rows, cols: [{ width: 14 }, { width: 22 }, { width: 7 }, { width: 100 }], tabColor: 'FF1F3A5F' }
}

export function buildWorkbook(content: WorkbookContent, opts: { sample?: boolean } = {}): Uint8Array {
  const sheets: WriteSheet[] = [petunjuk(opts.sample === true)]
  for (const sh of SHEETS) {
    const header: WriteCell[] = sh.columns.map((c) => ({ v: c.required ? `${c.key} *` : c.key, s: c.required ? 'headerRequired' : 'header' }))
    let body: WriteCell[][]
    if (sh.key === 'pengaturan') {
      body = SETTINGS.map((s) => [s.key, V(content.settings[s.key] ?? s.defaultValue), { v: s.label, s: 'wrap' }])
    } else {
      body = (content.rows[sh.key] ?? []).map((r) => sh.columns.map((c) => V(r[c.key])))
    }
    sheets.push({
      name: sh.name,
      rows: [header, ...body],
      cols: sh.columns.map((c) => ({ width: c.width ?? 16, text: isTextColumn(c) })),
      freezeHeader: true,
      validations: sh.key === 'pengaturan' ? [] : sh.columns.map((c, i) => ({ col: i, rule: validationFor(c) })),
      validationRows: 2000,
    })
  }
  return writeXlsx(sheets)
}

/** Blank client template (standard banks/UoMs/categories pre-filled, PB start 229). */
export function buildTemplate(): Uint8Array {
  return buildWorkbook({ settings: {}, rows: standardRows() })
}

/** Clearly fictional sample (tests, training, staging rehearsal). */
export function buildSample(over: Partial<WorkbookContent> = {}): Uint8Array {
  return buildWorkbook({ settings: { ...SAMPLE.settings, ...(over.settings ?? {}) }, rows: { ...SAMPLE.rows, ...(over.rows ?? {}) } }, { sample: true })
}
