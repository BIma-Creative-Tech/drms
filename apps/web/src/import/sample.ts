/**
 * FICTIONAL sample data for the go-live import workbook (E11): tests, training and the staging
 * rehearsal. Every person, account number, plate and coordinate below is invented (names marked
 * "Contoh"/"Fiktif", reserved `.test` email domain, plates in the unused ZZ series).
 */
import { BANKS, CATEGORIES, UOMS } from '@/seed/data'

import type { WorkbookContent } from './template'

export const SAMPLE: WorkbookContent = {
  settings: { tanggal_golive: '2026-11-01', nomor_pb_mulai: 229, tutup_periode_sebelum_golive: 'Ya' },
  rows: {
    // MC2-5: the PT of every per-PT row (company #1 exists after migration → matched, never modified)
    perusahaan: [{ kode_pt: 'DRMS', nama: 'PT Contoh Induk (FIKTIF)', nama_legal: null, alamat: null, telepon: null, nomor_pb_mulai: null }],
    bank: [...BANKS.map((b) => ({ kode: b.code, nama: b.name })), { kode: 'BPD-CTH', nama: 'Bank Daerah Contoh (FIKTIF)' }],
    satuan: UOMS.map((u) => ({ kode: u.code, nama: u.name, kelompok: u.category })),
    kategori: CATEGORIES.map((c) => ({
      kode_pt: 'DRMS',
      kode: c.code,
      nama: c.name,
      satuan_default: (c as { defaultUom?: string }).defaultUom ?? null,
      satuan_wajar: c.allowed.join(', '),
      perlu_kendaraan: (c as { requiresVehicle?: boolean }).requiresVehicle ? 'Ya' : 'Tidak',
      aktif: 'Ya',
    })),
    karyawan: [
      { kode_pt: 'DRMS', kode: 'CTH-001', nama: 'Andi Contoh', nama_panggilan: 'Andi', jabatan: 'Direktur', no_hp: '081200000001', aktif: 'Ya' },
      { kode_pt: 'DRMS', kode: 'CTH-002', nama: 'Bunga Fiktif', nama_panggilan: 'Bunga', jabatan: 'Finance', no_hp: '081200000002', aktif: 'Ya' },
      { kode_pt: 'DRMS', kode: 'CTH-003', nama: 'Candra Contoh', nama_panggilan: 'Candra', jabatan: 'Project Manager', no_hp: '081200000003', aktif: 'Ya' },
      { kode_pt: 'DRMS', kode: 'CTH-004', nama: 'Dewi Fiktif', nama_panggilan: 'Dewi', jabatan: 'Staff lapangan', no_hp: '081200000004', aktif: 'Ya' },
      { kode_pt: 'DRMS', kode: 'CTH-005', nama: 'Eko Contoh', nama_panggilan: 'Eko', jabatan: 'Mandor', no_hp: null, aktif: 'Ya' },
      { kode_pt: 'DRMS', kode: 'CTH-006', nama: 'Fitri Fiktif', nama_panggilan: 'Fitri', jabatan: 'Admin', no_hp: null, kode_site: 'CTH-CAB', aktif: 'Ya' },
    ],
    pengguna: [
      { kode_pt: 'DRMS', username: 'andi.contoh', email: 'andi@drms-contoh.test', nama: 'Andi Contoh', kode_karyawan: 'CTH-001', peran: 'Direktur', aktif: 'Ya' },
      { kode_pt: 'DRMS', username: 'bunga.fiktif', email: 'bunga@drms-contoh.test', nama: 'Bunga Fiktif', kode_karyawan: 'CTH-002', peran: 'Finance', aktif: 'Ya' },
      { kode_pt: 'DRMS', username: 'candra.contoh', email: 'candra@drms-contoh.test', nama: 'Candra Contoh', kode_karyawan: 'CTH-003', peran: 'PM, Staff', aktif: 'Ya' },
      { kode_pt: 'DRMS', username: 'dewi.fiktif', email: null, nama: 'Dewi Fiktif', kode_karyawan: 'CTH-004', peran: 'Staff', aktif: 'Ya' },
      { kode_pt: 'DRMS', username: 'fitri.fiktif', email: 'fitri@drms-contoh.test', nama: 'Fitri Fiktif', kode_karyawan: 'CTH-006', peran: 'Admin', aktif: 'Ya' },
    ],
    rekening: [
      { kode_pt: 'DRMS', kode_karyawan: 'CTH-003', kode_bank: 'BCA', no_rekening: '9990000301', atas_nama: 'Candra Contoh', rekening_default: 'Ya', aktif: 'Ya' },
      { kode_pt: 'DRMS', kode_karyawan: 'CTH-004', kode_bank: 'MANDIRI', no_rekening: '0990000000401', atas_nama: 'Dewi Fiktif', rekening_default: 'Ya', aktif: 'Ya' },
      { kode_pt: 'DRMS', kode_karyawan: 'CTH-004', kode_bank: 'BPD-CTH', no_rekening: '9990000402', atas_nama: 'Dewi Fiktif', rekening_default: 'Tidak', aktif: 'Ya' },
      { kode_pt: 'DRMS', kode_karyawan: 'CTH-005', kode_bank: 'BRI', no_rekening: '999000000501', atas_nama: 'Eko Contoh', rekening_default: 'Ya', aktif: 'Ya' },
    ],
    pusatBiaya: [
      { kode_pt: 'DRMS', kode: 'CTH-OPS', nama: 'Ops Contoh Palangka (FIKTIF)', jenis: 'Operasional', penanggung_jawab: 'candra.contoh', latitude: -2.2101, longitude: 113.9202, radius_m: 150, aktif: 'Ya' },
      { kode_pt: 'DRMS', kode: 'CTH-KANTOR', nama: 'Kantor Contoh (FIKTIF)', jenis: 'Departemen', penanggung_jawab: 'andi.contoh', latitude: null, longitude: null, radius_m: null, aktif: 'Ya' },
    ],
    // ADR 0023: a branch office (kantor cabang) with its point and default operational cost center
    site: [{ kode_pt: 'DRMS', kode: 'CTH-CAB', nama: 'Cabang Contoh (FIKTIF)', alamat: 'Jl. Cabang Contoh No. 3, Kota Fiktif', latitude: -2.2105, longitude: 113.9208, radius_m: 120, kode_pusat_biaya: 'CTH-OPS', aktif: 'Ya' }],
    project: [
      {
        kode_pt: 'DRMS',
        kode: 'CTH-PRJ-01',
        nama: 'Gedung Serbaguna Contoh (FIKTIF)',
        klien: 'PT Klien Contoh (FIKTIF)',
        alamat: 'Jl. Contoh No. 1, Kota Fiktif',
        pm: 'candra.contoh',
        latitude: -3.3199,
        longitude: 114.5901,
        radius_m: 200,
        rab: null,
        tanggal_mulai: '2026-08-01',
        target_selesai: '2027-03-31',
        status: 'Berjalan',
      },
      {
        kode_pt: 'DRMS',
        kode: 'CTH-PRJ-02',
        nama: 'Jalan Akses Contoh (FIKTIF)',
        klien: 'PT Klien Contoh (FIKTIF)',
        alamat: null,
        pm: 'candra.contoh',
        kode_site: 'CTH-CAB',
        latitude: -3.4402,
        longitude: 114.8303,
        radius_m: 300,
        rab: 350000000,
        tanggal_mulai: '2026-10-01',
        target_selesai: '2027-01-31',
        status: 'Berjalan',
      },
    ],
    tahapan: [
      { kode_pt: 'DRMS', kode_project: 'CTH-PRJ-01', urutan: 1, nama: 'Persiapan', bobot_persen: 10 },
      { kode_pt: 'DRMS', kode_project: 'CTH-PRJ-01', urutan: 2, nama: 'Pondasi', bobot_persen: 30 },
      { kode_pt: 'DRMS', kode_project: 'CTH-PRJ-01', urutan: 3, nama: 'Struktur', bobot_persen: 40 },
      { kode_pt: 'DRMS', kode_project: 'CTH-PRJ-01', urutan: 4, nama: 'Finishing', bobot_persen: 20 },
      { kode_pt: 'DRMS', kode_project: 'CTH-PRJ-02', urutan: 1, nama: 'Galian & timbunan', bobot_persen: 45.5 },
      { kode_pt: 'DRMS', kode_project: 'CTH-PRJ-02', urutan: 2, nama: 'Perkerasan', bobot_persen: 54.5 },
    ],
    rab: [
      { kode_pt: 'DRMS', kode_project: 'CTH-PRJ-01', kode_kategori: 'MAT', nominal: 150000000 },
      { kode_pt: 'DRMS', kode_project: 'CTH-PRJ-01', kode_kategori: 'UPH', nominal: 80000000 },
      { kode_pt: 'DRMS', kode_project: 'CTH-PRJ-01', kode_kategori: 'ALT', nominal: 20000000 },
      { kode_pt: 'DRMS', kode_project: 'CTH-PRJ-02', kode_kategori: 'MAT', nominal: 200000000 },
    ],
    kendaraan: [
      { kode_pt: 'DRMS', no_polisi: 'DA 9001 ZZ', jenis: 'Hilux', merek_model: 'Toyota Hilux (contoh)', kode_pusat_biaya: 'CTH-OPS', kode_project: null, aktif: 'Ya' },
      { kode_pt: 'DRMS', no_polisi: 'KH 9002 ZZ', jenis: 'Tronton', merek_model: null, kode_pusat_biaya: null, kode_project: 'CTH-PRJ-01', aktif: 'Ya' },
    ],
    penugasan: [
      { kode_pt: 'DRMS', kode_karyawan: 'CTH-004', kode_project: 'CTH-PRJ-01', kode_pusat_biaya: null, peran: 'Staff', tanggal_mulai: '2026-11-01', tanggal_selesai: null },
      { kode_pt: 'DRMS', kode_karyawan: 'CTH-005', kode_project: 'CTH-PRJ-01', kode_pusat_biaya: null, peran: 'Mandor', tanggal_mulai: '2026-11-01', tanggal_selesai: null },
      { kode_pt: 'DRMS', kode_karyawan: 'CTH-004', kode_project: null, kode_pusat_biaya: 'CTH-OPS', peran: 'Staff', tanggal_mulai: null, tanggal_selesai: null },
      { kode_pt: 'DRMS', kode_karyawan: 'CTH-005', kode_project: null, kode_pusat_biaya: null, kode_site: 'CTH-CAB', peran: 'Mandor', tanggal_mulai: '2026-11-01', tanggal_selesai: null },
    ],
    akunKas: [
      { kode_pt: 'DRMS', nama: 'Kas Kecil Contoh (FIKTIF)', jenis: 'Kas', kode_bank: null, no_rekening: null, atas_nama: null, saldo_awal: 5000000, kode_jurnal_odoo: null, kode_site: 'CTH-CAB', aktif: 'Ya' },
      { kode_pt: 'DRMS', nama: 'Bank Operasional Contoh (FIKTIF)', jenis: 'Bank', kode_bank: 'BCA', no_rekening: '9990001234', atas_nama: 'PT Contoh Fiktif', saldo_awal: 125750000, kode_jurnal_odoo: 'BNK1', aktif: 'Ya' },
    ],
  },
}

/**
 * MC2-5: fictional SECOND PT "CS1" rows (tests / training): same employee + account in two PTs
 * (two employee records, one login), a project and a cash account of CS1. Merge into SAMPLE.rows.
 */
export const SAMPLE_CS1: WorkbookContent['rows'] = {
  perusahaan: [
    { kode_pt: 'DRMS', nama: 'PT Contoh Induk (FIKTIF)', nama_legal: null, alamat: null, telepon: null, nomor_pb_mulai: null },
    { kode_pt: 'CS1', nama: 'PT Contoh Satu (FIKTIF)', nama_legal: 'PT Contoh Satu Makmur (FIKTIF)', alamat: 'Jl. Contoh No. 2, Kota Fiktif', telepon: '0511000002', nomor_pb_mulai: 1 },
  ],
  karyawan: [
    { kode_pt: 'CS1', kode: 'CTH-003', nama: 'Candra Contoh', nama_panggilan: 'Candra', jabatan: 'Project Manager', no_hp: '081200000003', aktif: 'Ya' },
    { kode_pt: 'CS1', kode: 'CS1-001', nama: 'Gilang Fiktif', nama_panggilan: 'Gilang', jabatan: 'Staff lapangan', no_hp: null, aktif: 'Ya' },
  ],
  aksesPt: [
    { username: 'candra.contoh', kode_pt: 'CS1', peran: 'PM', kode_karyawan: 'CTH-003', aktif: 'Ya' },
    { username: 'bunga.fiktif', kode_pt: 'CS1', peran: 'Finance, Direktur', kode_karyawan: null, aktif: 'Ya' },
  ],
  project: [
    { kode_pt: 'CS1', kode: 'CS1-GDG', nama: 'Gudang Contoh (FIKTIF)', klien: null, alamat: null, pm: 'candra.contoh', latitude: -3.3, longitude: 114.6, radius_m: 150, rab: 20000000, tanggal_mulai: '2026-11-01', target_selesai: null, status: 'Berjalan' },
  ],
  penugasan: [{ kode_pt: 'CS1', kode_karyawan: 'CS1-001', kode_project: 'CS1-GDG', kode_pusat_biaya: null, peran: 'Staff', tanggal_mulai: null, tanggal_selesai: null }],
  akunKas: [{ kode_pt: 'CS1', nama: 'Kas Kecil CS1 (FIKTIF)', jenis: 'Kas', kode_bank: null, no_rekening: null, atas_nama: null, saldo_awal: 1000000, kode_jurnal_odoo: null, aktif: 'Ya' }],
}

/** SAMPLE + SAMPLE_CS1 (two PTs). */
export function sampleTwoPts(): WorkbookContent['rows'] {
  const out: WorkbookContent['rows'] = { ...SAMPLE.rows }
  for (const [k, rows] of Object.entries(SAMPLE_CS1) as Array<[keyof WorkbookContent['rows'], Array<Record<string, string | number | null>>]>) {
    out[k] = k === 'perusahaan' ? rows : [...(SAMPLE.rows[k] ?? []), ...rows]
  }
  return out
}
