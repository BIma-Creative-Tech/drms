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
    bank: [...BANKS.map((b) => ({ kode: b.code, nama: b.name })), { kode: 'BPD-CTH', nama: 'Bank Daerah Contoh (FIKTIF)' }],
    satuan: UOMS.map((u) => ({ kode: u.code, nama: u.name, kelompok: u.category })),
    kategori: CATEGORIES.map((c) => ({
      kode: c.code,
      nama: c.name,
      satuan_default: (c as { defaultUom?: string }).defaultUom ?? null,
      satuan_wajar: c.allowed.join(', '),
      perlu_kendaraan: (c as { requiresVehicle?: boolean }).requiresVehicle ? 'Ya' : 'Tidak',
      aktif: 'Ya',
    })),
    karyawan: [
      { kode: 'CTH-001', nama: 'Andi Contoh', nama_panggilan: 'Andi', jabatan: 'Direktur', no_hp: '081200000001', aktif: 'Ya' },
      { kode: 'CTH-002', nama: 'Bunga Fiktif', nama_panggilan: 'Bunga', jabatan: 'Finance', no_hp: '081200000002', aktif: 'Ya' },
      { kode: 'CTH-003', nama: 'Candra Contoh', nama_panggilan: 'Candra', jabatan: 'Project Manager', no_hp: '081200000003', aktif: 'Ya' },
      { kode: 'CTH-004', nama: 'Dewi Fiktif', nama_panggilan: 'Dewi', jabatan: 'Staff lapangan', no_hp: '081200000004', aktif: 'Ya' },
      { kode: 'CTH-005', nama: 'Eko Contoh', nama_panggilan: 'Eko', jabatan: 'Mandor', no_hp: null, aktif: 'Ya' },
      { kode: 'CTH-006', nama: 'Fitri Fiktif', nama_panggilan: 'Fitri', jabatan: 'Admin', no_hp: null, aktif: 'Ya' },
    ],
    pengguna: [
      { username: 'andi.contoh', email: 'andi@drms-contoh.test', nama: 'Andi Contoh', kode_karyawan: 'CTH-001', peran: 'Direktur', aktif: 'Ya' },
      { username: 'bunga.fiktif', email: 'bunga@drms-contoh.test', nama: 'Bunga Fiktif', kode_karyawan: 'CTH-002', peran: 'Finance', aktif: 'Ya' },
      { username: 'candra.contoh', email: 'candra@drms-contoh.test', nama: 'Candra Contoh', kode_karyawan: 'CTH-003', peran: 'PM, Staff', aktif: 'Ya' },
      { username: 'dewi.fiktif', email: null, nama: 'Dewi Fiktif', kode_karyawan: 'CTH-004', peran: 'Staff', aktif: 'Ya' },
      { username: 'fitri.fiktif', email: 'fitri@drms-contoh.test', nama: 'Fitri Fiktif', kode_karyawan: 'CTH-006', peran: 'Admin', aktif: 'Ya' },
    ],
    rekening: [
      { kode_karyawan: 'CTH-003', kode_bank: 'BCA', no_rekening: '9990000301', atas_nama: 'Candra Contoh', rekening_default: 'Ya', aktif: 'Ya' },
      { kode_karyawan: 'CTH-004', kode_bank: 'MANDIRI', no_rekening: '0990000000401', atas_nama: 'Dewi Fiktif', rekening_default: 'Ya', aktif: 'Ya' },
      { kode_karyawan: 'CTH-004', kode_bank: 'BPD-CTH', no_rekening: '9990000402', atas_nama: 'Dewi Fiktif', rekening_default: 'Tidak', aktif: 'Ya' },
      { kode_karyawan: 'CTH-005', kode_bank: 'BRI', no_rekening: '999000000501', atas_nama: 'Eko Contoh', rekening_default: 'Ya', aktif: 'Ya' },
    ],
    pusatBiaya: [
      { kode: 'CTH-OPS', nama: 'Ops Contoh Palangka (FIKTIF)', jenis: 'Operasional', penanggung_jawab: 'candra.contoh', latitude: -2.2101, longitude: 113.9202, radius_m: 150, aktif: 'Ya' },
      { kode: 'CTH-KANTOR', nama: 'Kantor Contoh (FIKTIF)', jenis: 'Departemen', penanggung_jawab: 'andi.contoh', latitude: null, longitude: null, radius_m: null, aktif: 'Ya' },
    ],
    project: [
      {
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
        kode: 'CTH-PRJ-02',
        nama: 'Jalan Akses Contoh (FIKTIF)',
        klien: 'PT Klien Contoh (FIKTIF)',
        alamat: null,
        pm: 'candra.contoh',
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
      { kode_project: 'CTH-PRJ-01', urutan: 1, nama: 'Persiapan', bobot_persen: 10 },
      { kode_project: 'CTH-PRJ-01', urutan: 2, nama: 'Pondasi', bobot_persen: 30 },
      { kode_project: 'CTH-PRJ-01', urutan: 3, nama: 'Struktur', bobot_persen: 40 },
      { kode_project: 'CTH-PRJ-01', urutan: 4, nama: 'Finishing', bobot_persen: 20 },
      { kode_project: 'CTH-PRJ-02', urutan: 1, nama: 'Galian & timbunan', bobot_persen: 45.5 },
      { kode_project: 'CTH-PRJ-02', urutan: 2, nama: 'Perkerasan', bobot_persen: 54.5 },
    ],
    rab: [
      { kode_project: 'CTH-PRJ-01', kode_kategori: 'MAT', nominal: 150000000 },
      { kode_project: 'CTH-PRJ-01', kode_kategori: 'UPH', nominal: 80000000 },
      { kode_project: 'CTH-PRJ-01', kode_kategori: 'ALT', nominal: 20000000 },
      { kode_project: 'CTH-PRJ-02', kode_kategori: 'MAT', nominal: 200000000 },
    ],
    kendaraan: [
      { no_polisi: 'DA 9001 ZZ', jenis: 'Hilux', merek_model: 'Toyota Hilux (contoh)', kode_pusat_biaya: 'CTH-OPS', kode_project: null, aktif: 'Ya' },
      { no_polisi: 'KH 9002 ZZ', jenis: 'Tronton', merek_model: null, kode_pusat_biaya: null, kode_project: 'CTH-PRJ-01', aktif: 'Ya' },
    ],
    penugasan: [
      { kode_karyawan: 'CTH-004', kode_project: 'CTH-PRJ-01', kode_pusat_biaya: null, peran: 'Staff', tanggal_mulai: '2026-11-01', tanggal_selesai: null },
      { kode_karyawan: 'CTH-005', kode_project: 'CTH-PRJ-01', kode_pusat_biaya: null, peran: 'Mandor', tanggal_mulai: '2026-11-01', tanggal_selesai: null },
      { kode_karyawan: 'CTH-004', kode_project: null, kode_pusat_biaya: 'CTH-OPS', peran: 'Staff', tanggal_mulai: null, tanggal_selesai: null },
    ],
    akunKas: [
      { nama: 'Kas Kecil Contoh (FIKTIF)', jenis: 'Kas', kode_bank: null, no_rekening: null, atas_nama: null, saldo_awal: 5000000, kode_jurnal_odoo: null, aktif: 'Ya' },
      { nama: 'Bank Operasional Contoh (FIKTIF)', jenis: 'Bank', kode_bank: 'BCA', no_rekening: '9990001234', atas_nama: 'PT Contoh Fiktif', saldo_awal: 125750000, kode_jurnal_odoo: 'BNK1', aktif: 'Ya' },
    ],
  },
}
