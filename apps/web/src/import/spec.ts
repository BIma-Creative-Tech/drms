/**
 * Go-live import workbook specification (E11): one sheet per master, header row 1 = column keys,
 * data from row 2. Single source for the template generator (template.ts), the parser (parse.ts)
 * and the "Petunjuk" sheet. Pure module. Texts shown to the client are Indonesian.
 */
import type { Validation } from './xlsx-io'

export type ColType =
  | 'text'
  | 'code'
  | 'username'
  | 'email'
  | 'phone'
  | 'digits'
  | 'int'
  | 'money'
  | 'decimal'
  | 'date'
  | 'bool'
  | 'enum'
  | 'roles'
  | 'codes'
  | 'plate'
  | 'ptcode'

export type ColSpec = {
  key: string
  type: ColType
  required?: boolean
  /** Short hint (Excel input message + Petunjuk). */
  hint: string
  maxLength?: number
  min?: number
  max?: number
  /** enum/roles: accepted labels (matched case-insensitively; enum keys are also the dropdown) → stored value. */
  options?: Record<string, string>
  /** Dropdown source: inline list is derived from `options`; `ref` = another sheet's key column. */
  ref?: { sheet: SheetKey; col: string }
  width?: number
}

export type SheetKey =
  | 'pengaturan'
  | 'perusahaan'
  | 'bank'
  | 'satuan'
  | 'kategori'
  | 'karyawan'
  | 'pengguna'
  | 'aksesPt'
  | 'rekening'
  | 'pusatBiaya'
  | 'site'
  | 'project'
  | 'tahapan'
  | 'rab'
  | 'kendaraan'
  | 'penugasan'
  | 'akunKas'

export type SheetSpec = {
  key: SheetKey
  /** Excel sheet name (≤ 31 chars, no spaces → usable in validation formulas without quotes). */
  name: string
  title: string
  description: string
  /** Natural key columns (duplicates in the sheet are rejected; upsert key in the DB). */
  naturalKey: string[]
  columns: ColSpec[]
}

export const YA_TIDAK: Record<string, string> = { ya: 'true', tidak: 'false', y: 'true', t: 'false', true: 'true', false: 'false', '1': 'true', '0': 'false' }

/** Role labels, matched case-insensitively (ADR 0013 G1-1: realm role pk-owner is shown as "Direktur"). */
export const ROLE_OPTIONS: Record<string, string> = {
  direktur: 'pk-owner',
  owner: 'pk-owner',
  finance: 'pk-finance',
  keuangan: 'pk-finance',
  pm: 'pk-pm',
  'project manager': 'pk-pm',
  staff: 'pk-staff',
  'staff lapangan': 'pk-staff',
  admin: 'pk-admin',
}
export const ROLE_LIST = ['Direktur', 'Finance', 'PM', 'Staff', 'Admin']

const CC_TYPES = { Operasional: 'operational', Departemen: 'department' }
const PROJECT_STATUS = { Perencanaan: 'perencanaan', Berjalan: 'berjalan', Ditunda: 'ditunda', Selesai: 'selesai' }
const TEAM_ROLES = { Staff: 'staff', Mandor: 'mandor', PM: 'pm' }
const ACCOUNT_KINDS = { Kas: 'cash', Bank: 'bank' }

/**
 * MC2-5 (ADR 0016 §11): PT of a per-PT row = short code of the sheet Perusahaan / an existing PT.
 * Empty = the only PT (only allowed while the workbook + database know exactly one PT).
 */
export const PT_CODE_RE = /^[A-Z0-9]{2,16}$/
const kodePt = (): ColSpec => ({
  key: 'kode_pt',
  type: 'ptcode',
  hint: 'Kode PT (sheet Perusahaan atau PT yang sudah ada), mis. DRMS. Kosong = satu-satunya PT; wajib bila ada lebih dari satu PT.',
  ref: { sheet: 'perusahaan', col: 'kode_pt' },
  width: 10,
})

/** ADR 0023: optional link to a site (kantor cabang) of the row's PT — sheet Site or an existing site. Empty = unchanged. */
const kodeSite = (hint: string): ColSpec => ({ key: 'kode_site', type: 'code', hint, ref: { sheet: 'site', col: 'kode' }, width: 12 })

const aktif = (): ColSpec => ({ key: 'aktif', type: 'bool', hint: 'Ya/Tidak. Kosong = Ya.', options: { Ya: 'true', Tidak: 'false' }, width: 9 })
const coord = (): ColSpec[] => [
  { key: 'latitude', type: 'decimal', min: -90, max: 90, hint: 'Derajat desimal, mis. -2.2136 (Google Maps: klik kanan lokasi → salin angka pertama).', width: 12 },
  { key: 'longitude', type: 'decimal', min: -180, max: 180, hint: 'Derajat desimal, mis. 113.9108 (angka kedua dari Google Maps).', width: 12 },
  { key: 'radius_m', type: 'int', min: 10, max: 5000, hint: 'Radius absen (geofence) dalam meter, 10–5000. Wajib bila koordinat diisi.', width: 10 },
]

export const SHEETS: SheetSpec[] = [
  {
    key: 'pengaturan',
    name: 'Pengaturan',
    title: 'Pengaturan cut-over',
    description: 'Tanggal go-live (= tanggal saldo awal), nomor Pengajuan Biaya (PB) pertama, dan tutup buku periode sebelum go-live.',
    naturalKey: ['pengaturan'],
    columns: [
      { key: 'pengaturan', type: 'text', required: true, hint: 'Jangan diubah.', width: 32 },
      { key: 'nilai', type: 'text', required: true, hint: 'Isi nilai sesuai keterangan.', width: 18 },
      { key: 'keterangan', type: 'text', hint: 'Penjelasan (tidak dibaca sistem).', width: 90 },
    ],
  },
  {
    key: 'perusahaan',
    name: 'Perusahaan',
    title: 'Perusahaan (PT) tujuan impor',
    description:
      'Satu baris per PT yang datanya ada di file ini (MC2-5). PT yang sudah ada dicocokkan lewat kode_pt dan TIDAK diubah (identitas PT diatur di Master Perusahaan); PT baru dibuat aktif lengkap dengan penomoran dan aturan approval default.',
    naturalKey: ['kode_pt'],
    columns: [
      { key: 'kode_pt', type: 'ptcode', required: true, hint: 'Kode singkat PT = token {COMPANY} di nomor dokumen: huruf besar/angka 2–16, mis. DRMS, CS1.', width: 10 },
      { key: 'nama', type: 'text', required: true, maxLength: 160, hint: 'Nama PT (dipakai hanya bila PT baru).', width: 30 },
      { key: 'nama_legal', type: 'text', maxLength: 200, hint: 'Opsional: nama legal PT baru.', width: 30 },
      { key: 'alamat', type: 'text', maxLength: 500, hint: 'Opsional.', width: 28 },
      { key: 'telepon', type: 'phone', hint: 'Opsional.', width: 16 },
      { key: 'nomor_pb_mulai', type: 'int', min: 1, max: 999999, hint: 'Opsional: nomor PB pertama PT ini. Kosong = nilai nomor_pb_mulai di sheet Pengaturan.', width: 12 },
    ],
  },
  {
    key: 'bank',
    name: 'Bank',
    title: 'Bank',
    description: 'Daftar bank untuk rekening karyawan dan akun kas. Sudah terisi bank umum; tambahkan bila perlu (mis. bank daerah).',
    naturalKey: ['kode'],
    columns: [
      { key: 'kode', type: 'code', required: true, hint: 'Kode singkat unik, mis. MANDIRI, BCA, KALSEL.', width: 14 },
      { key: 'nama', type: 'text', required: true, maxLength: 128, hint: 'Nama bank.', width: 36 },
    ],
  },
  {
    key: 'satuan',
    name: 'Satuan',
    title: 'Satuan',
    description: 'Satuan barang/jasa pada baris pengajuan (Q-20).',
    naturalKey: ['kode'],
    columns: [
      { key: 'kode', type: 'code', required: true, hint: 'Kode unik, mis. L, KMR, PRS.', width: 12 },
      { key: 'nama', type: 'text', required: true, maxLength: 64, hint: 'Nama satuan, mis. liter.', width: 22 },
      { key: 'kelompok', type: 'text', maxLength: 64, hint: 'Opsional, mis. volume, waktu, akomodasi.', width: 16 },
    ],
  },
  {
    key: 'kategori',
    name: 'Kategori',
    title: 'Kategori pengeluaran',
    description: 'Kategori baris pengajuan (Q-19) dengan satuan wajar dan penanda wajib kendaraan (Q-22), per PT.',
    naturalKey: ['kode_pt', 'kode'],
    columns: [
      kodePt(),
      { key: 'kode', type: 'code', required: true, hint: 'Kode unik, mis. BBM.', width: 12 },
      { key: 'nama', type: 'text', required: true, maxLength: 128, hint: 'Nama kategori.', width: 24 },
      { key: 'kode_coa', type: 'text', maxLength: 32, hint: 'Opsional: kode akun (COA) untuk Odoo.', width: 12 },
      { key: 'satuan_default', type: 'code', hint: 'Kode satuan default (sheet Satuan).', ref: { sheet: 'satuan', col: 'kode' }, width: 14 },
      { key: 'satuan_wajar', type: 'codes', hint: 'Kode satuan wajar dipisah koma, mis. L, KALI-ISI.', width: 22 },
      { key: 'perlu_kendaraan', type: 'bool', hint: 'Ya bila baris kategori ini wajib memilih kendaraan (BBM, Service Kendaraan).', options: { Ya: 'true', Tidak: 'false' }, width: 10 },
      aktif(),
    ],
  },
  {
    key: 'karyawan',
    name: 'Karyawan',
    title: 'Karyawan',
    description: 'Semua karyawan yang bisa mengajukan biaya atau diabsen, termasuk yang tidak punya akun login. 1 data karyawan = 1 PT: orang yang bekerja di 2 PT ditulis 2 kali (kode_pt berbeda).',
    naturalKey: ['kode_pt', 'kode'],
    columns: [
      kodePt(),
      { key: 'kode', type: 'code', required: true, hint: 'Kode/NIK karyawan unik, mis. K-001.', width: 12 },
      { key: 'nama', type: 'text', required: true, maxLength: 128, hint: 'Nama lengkap.', width: 28 },
      { key: 'nama_panggilan', type: 'text', maxLength: 64, hint: 'Opsional.', width: 14 },
      { key: 'jabatan', type: 'text', maxLength: 128, hint: 'Opsional, mis. Mandor, Driver.', width: 18 },
      { key: 'no_hp', type: 'phone', hint: 'Opsional, mis. 0812xxxx (format teks).', width: 16 },
      kodeSite('Opsional: site penempatan (sheet Site, PT yang sama) — boleh absen di site ini tanpa penugasan. Kosong = tidak diubah.'),
      aktif(),
    ],
  },
  {
    key: 'pengguna',
    name: 'Pengguna',
    title: 'Pengguna (akun login) + peran',
    description:
      'Orang yang login ke web/APK (satu baris per orang). Akun login (password) dibuat oleh Lead di Keycloak realm drms — di file ini TIDAK ADA password. peran + kode_karyawan = akses di PT kode_pt (Direktur, Finance, PM, Staff, Admin; boleh lebih dari satu, dipisah koma). Akses di PT lain: sheet AksesPT.',
    naturalKey: ['username'],
    columns: [
      kodePt(),
      { key: 'username', type: 'username', required: true, hint: 'Nama login: huruf kecil/angka/titik/minus, 3–64 karakter, unik. Mis. budi.h', width: 16 },
      { key: 'email', type: 'email', hint: 'Opsional (Q-37). Dipakai untuk reset password; kosong = reset oleh Admin.', width: 28 },
      { key: 'nama', type: 'text', required: true, maxLength: 128, hint: 'Nama tampilan.', width: 24 },
      { key: 'kode_karyawan', type: 'code', hint: 'Kode karyawan di PT kode_pt (sheet Karyawan). Wajib untuk Staff/PM yang mengajukan atau absen.', ref: { sheet: 'karyawan', col: 'kode' }, width: 14 },
      { key: 'peran', type: 'roles', hint: 'Peran di PT kode_pt: Direktur, Finance, PM, Staff, Admin (pisahkan dengan koma). Kosong = tanpa akses di PT itu (isi sheet AksesPT).', options: ROLE_OPTIONS, width: 18 },
      { key: 'no_hp', type: 'phone', hint: 'Opsional.', width: 16 },
      aktif(),
    ],
  },
  {
    key: 'aksesPt',
    name: 'AksesPT',
    title: 'Akses pengguna di PT lain',
    description:
      'Opsional (MC2-5): peran pengguna di PT SELAIN kode_pt barisnya di sheet Pengguna — satu baris per pengguna per PT. Peran bisa berbeda per PT (mis. Direktur di DRMS, Finance di CS1).',
    naturalKey: ['username', 'kode_pt'],
    columns: [
      { key: 'username', type: 'username', required: true, hint: 'Username (sheet Pengguna).', ref: { sheet: 'pengguna', col: 'username' }, width: 16 },
      { key: 'kode_pt', type: 'ptcode', required: true, hint: 'Kode PT (sheet Perusahaan atau PT yang sudah ada).', ref: { sheet: 'perusahaan', col: 'kode_pt' }, width: 10 },
      { key: 'peran', type: 'roles', required: true, hint: 'Peran di PT ini: Direktur, Finance, PM, Staff, Admin (pisahkan dengan koma).', options: ROLE_OPTIONS, width: 18 },
      { key: 'kode_karyawan', type: 'code', hint: 'Opsional: kode karyawan di PT ini (sheet Karyawan, kode_pt sama).', ref: { sheet: 'karyawan', col: 'kode' }, width: 14 },
      aktif(),
    ],
  },
  {
    key: 'rekening',
    name: 'Rekening',
    title: 'Rekening karyawan',
    description: 'Rekening tujuan transfer pengajuan. Satu karyawan boleh punya beberapa rekening; tandai satu sebagai default.',
    naturalKey: ['kode_bank', 'no_rekening'],
    columns: [
      kodePt(),
      { key: 'kode_karyawan', type: 'code', required: true, hint: 'Kode karyawan (sheet Karyawan).', ref: { sheet: 'karyawan', col: 'kode' }, width: 14 },
      { key: 'kode_bank', type: 'code', required: true, hint: 'Kode bank (sheet Bank).', ref: { sheet: 'bank', col: 'kode' }, width: 12 },
      { key: 'no_rekening', type: 'digits', required: true, hint: 'Hanya angka 5–34 digit (format teks agar nol di depan tidak hilang).', width: 20 },
      { key: 'atas_nama', type: 'text', required: true, maxLength: 128, hint: 'Nama pemilik rekening sesuai buku tabungan.', width: 26 },
      { key: 'rekening_default', type: 'bool', hint: 'Ya untuk rekening utama (maks. satu per karyawan).', options: { Ya: 'true', Tidak: 'false' }, width: 10 },
      aktif(),
    ],
  },
  {
    key: 'pusatBiaya',
    name: 'PusatBiaya',
    title: 'Pusat biaya / lokasi operasional',
    description: 'Lokasi operasional non-project (Q-23), mis. "Ops Palangka Banjar", dengan penanggung jawab dan koordinat absen (Q-40).',
    naturalKey: ['kode_pt', 'kode'],
    columns: [
      kodePt(),
      { key: 'kode', type: 'code', required: true, hint: 'Kode unik per PT, mis. OPS-PB.', width: 12 },
      { key: 'nama', type: 'text', required: true, maxLength: 128, hint: 'Nama lokasi.', width: 26 },
      { key: 'jenis', type: 'enum', hint: 'Operasional atau Departemen. Kosong = Operasional.', options: CC_TYPES, width: 14 },
      { key: 'penanggung_jawab', type: 'username', hint: 'Username penanggung jawab (sheet Pengguna).', ref: { sheet: 'pengguna', col: 'username' }, width: 18 },
      ...coord(),
      aktif(),
    ],
  },
  {
    key: 'site',
    name: 'Site',
    title: 'Site (kantor cabang)',
    description:
      'Kantor cabang PT (ADR 0023), mis. "Cabang Balikpapan": satu site menangani beberapa project. Koordinat = titik absen kantor cabang; pusat biaya default = pusat biaya operasional cabang. Dihubungkan lewat kolom kode_site di sheet Karyawan, Project, Penugasan dan AkunKas.',
    naturalKey: ['kode_pt', 'kode'],
    columns: [
      kodePt(),
      { key: 'kode', type: 'code', required: true, hint: 'Kode site unik per PT, mis. CAB-BPN.', width: 12 },
      { key: 'nama', type: 'text', required: true, maxLength: 128, hint: 'Nama site, mis. Cabang Balikpapan.', width: 26 },
      { key: 'alamat', type: 'text', maxLength: 500, hint: 'Opsional.', width: 28 },
      ...coord(),
      { key: 'kode_pusat_biaya', type: 'code', hint: 'Opsional: pusat biaya default (operasional, sheet PusatBiaya, PT yang sama).', ref: { sheet: 'pusatBiaya', col: 'kode' }, width: 16 },
      aktif(),
    ],
  },
  {
    key: 'project',
    name: 'Project',
    title: 'Project',
    description: 'Project konstruksi yang sedang berjalan saat go-live, dengan PM, koordinat lokasi (absen) dan RAB total.',
    naturalKey: ['kode_pt', 'kode'],
    columns: [
      kodePt(),
      { key: 'kode', type: 'code', required: true, hint: 'Kode project unik per PT, mis. PRJ-2026-01.', width: 14 },
      { key: 'nama', type: 'text', required: true, maxLength: 160, hint: 'Nama project.', width: 30 },
      { key: 'klien', type: 'text', maxLength: 160, hint: 'Opsional: nama klien/pemberi kerja (dibuat otomatis bila belum ada).', width: 22 },
      { key: 'alamat', type: 'text', maxLength: 500, hint: 'Opsional.', width: 28 },
      { key: 'pm', type: 'username', hint: 'Username PM (sheet Pengguna).', ref: { sheet: 'pengguna', col: 'username' }, width: 16 },
      kodeSite('Opsional: site (kantor cabang) yang menangani project ini (sheet Site, PT yang sama). Kosong = tidak diubah.'),
      ...coord(),
      { key: 'rab', type: 'money', min: 0, hint: 'RAB total (Rupiah, bilangan bulat). Kosong = jumlah sheet RAB project ini. Project ber-RAB wajib punya RAP sebelum pengajuan dikirim: isi RAP setelah impor (tab RAP project).', width: 16 },
      { key: 'tanggal_mulai', type: 'date', hint: 'Format YYYY-MM-DD atau DD/MM/YYYY.', width: 13 },
      { key: 'target_selesai', type: 'date', hint: 'Format YYYY-MM-DD atau DD/MM/YYYY.', width: 13 },
      { key: 'status', type: 'enum', hint: 'Perencanaan, Berjalan, Ditunda, Selesai. Kosong = Berjalan.', options: PROJECT_STATUS, width: 13 },
    ],
  },
  {
    key: 'tahapan',
    name: 'Tahapan',
    title: 'Tahapan project + bobot',
    description: 'Tahapan pekerjaan per project. Total bobot tahapan satu project harus tepat 100%. Progress awal tahapan = 0% (diisi lewat laporan progress).',
    naturalKey: ['kode_pt', 'kode_project', 'urutan'],
    columns: [
      kodePt(),
      { key: 'kode_project', type: 'code', required: true, hint: 'Kode project (sheet Project).', ref: { sheet: 'project', col: 'kode' }, width: 14 },
      { key: 'urutan', type: 'int', required: true, min: 1, max: 999, hint: 'Nomor urut tahapan 1, 2, 3, …', width: 8 },
      { key: 'nama', type: 'text', required: true, maxLength: 128, hint: 'Nama tahapan, mis. Pondasi.', width: 26 },
      { key: 'bobot_persen', type: 'decimal', required: true, min: 0, max: 100, hint: 'Bobot 0–100; jumlah per project = 100.', width: 12 },
    ],
  },
  {
    key: 'rab',
    name: 'RAB',
    title: 'RAB per kategori',
    description: 'Opsional: anggaran project per kategori pengeluaran (untuk laporan realisasi vs RAB).',
    naturalKey: ['kode_pt', 'kode_project', 'kode_kategori'],
    columns: [
      kodePt(),
      { key: 'kode_project', type: 'code', required: true, hint: 'Kode project (sheet Project).', ref: { sheet: 'project', col: 'kode' }, width: 14 },
      { key: 'kode_kategori', type: 'code', required: true, hint: 'Kode kategori (sheet Kategori).', ref: { sheet: 'kategori', col: 'kode' }, width: 14 },
      { key: 'nominal', type: 'money', required: true, min: 0, hint: 'Rupiah, bilangan bulat.', width: 16 },
    ],
  },
  {
    key: 'kendaraan',
    name: 'Kendaraan',
    title: 'Kendaraan / unit',
    description: 'Kendaraan untuk baris BBM/Service Kendaraan (Q-22).',
    naturalKey: ['no_polisi'],
    columns: [
      kodePt(),
      { key: 'no_polisi', type: 'plate', required: true, hint: 'Mis. DA 1234 XY (spasi boleh).', width: 14 },
      { key: 'jenis', type: 'text', required: true, maxLength: 64, hint: 'Mis. Hilux, Tronton.', width: 14 },
      { key: 'merek_model', type: 'text', maxLength: 128, hint: 'Opsional.', width: 18 },
      { key: 'kode_pusat_biaya', type: 'code', hint: 'Opsional: pusat biaya default (sheet PusatBiaya).', ref: { sheet: 'pusatBiaya', col: 'kode' }, width: 16 },
      { key: 'kode_project', type: 'code', hint: 'Opsional: project default (sheet Project).', ref: { sheet: 'project', col: 'kode' }, width: 14 },
      aktif(),
    ],
  },
  {
    key: 'penugasan',
    name: 'Penugasan',
    title: 'Penugasan tim',
    description: 'Karyawan yang ditugaskan ke project, pusat biaya ATAU site (menentukan project yang terlihat di APK dan lokasi absen).',
    naturalKey: ['kode_pt', 'kode_karyawan', 'kode_project', 'kode_pusat_biaya', 'kode_site'],
    columns: [
      kodePt(),
      { key: 'kode_karyawan', type: 'code', required: true, hint: 'Kode karyawan (sheet Karyawan).', ref: { sheet: 'karyawan', col: 'kode' }, width: 14 },
      { key: 'kode_project', type: 'code', hint: 'Isi salah satu: kode project …', ref: { sheet: 'project', col: 'kode' }, width: 14 },
      { key: 'kode_pusat_biaya', type: 'code', hint: '… ATAU kode pusat biaya …', ref: { sheet: 'pusatBiaya', col: 'kode' }, width: 16 },
      kodeSite('… ATAU kode site (kantor cabang, sheet Site).'),
      { key: 'peran', type: 'enum', hint: 'Staff, Mandor atau PM. Kosong = Staff.', options: TEAM_ROLES, width: 10 },
      { key: 'tanggal_mulai', type: 'date', hint: 'Opsional, YYYY-MM-DD atau DD/MM/YYYY.', width: 13 },
      { key: 'tanggal_selesai', type: 'date', hint: 'Opsional.', width: 13 },
    ],
  },
  {
    key: 'akunKas',
    name: 'AkunKas',
    title: 'Akun kas/bank perusahaan + saldo awal',
    description: 'Akun kas dan rekening bank perusahaan dengan saldo per tanggal go-live (sheet Pengaturan). Saldo awal dikunci setelah periode pertama sejak go-live ditutup.',
    naturalKey: ['kode_pt', 'nama'],
    columns: [
      kodePt(),
      { key: 'nama', type: 'text', required: true, maxLength: 128, hint: 'Nama akun unik per PT, mis. Kas Kecil, Bank Mandiri Operasional.', width: 28 },
      { key: 'jenis', type: 'enum', required: true, hint: 'Kas atau Bank.', options: ACCOUNT_KINDS, width: 8 },
      { key: 'kode_bank', type: 'code', hint: 'Untuk jenis Bank: kode bank (sheet Bank).', ref: { sheet: 'bank', col: 'kode' }, width: 12 },
      { key: 'no_rekening', type: 'digits', hint: 'Untuk jenis Bank: nomor rekening (teks).', width: 20 },
      { key: 'atas_nama', type: 'text', maxLength: 128, hint: 'Opsional.', width: 24 },
      { key: 'saldo_awal', type: 'money', required: true, min: 0, hint: 'Saldo pada tanggal go-live (Rupiah, bilangan bulat ≥ 0).', width: 16 },
      { key: 'kode_jurnal_odoo', type: 'text', maxLength: 16, hint: 'Opsional.', width: 12 },
      kodeSite('Opsional: kas kecil / rekening site ini (sheet Site, PT yang sama). Kosong = tidak diubah.'),
      aktif(),
    ],
  },
]

export const SHEET_BY_KEY = Object.fromEntries(SHEETS.map((s) => [s.key, s])) as Record<SheetKey, SheetSpec>

/** Settings rows of the Pengaturan sheet (key → hint). */
export const SETTINGS = [
  {
    key: 'tanggal_golive',
    label: 'Tanggal go-live (YYYY-MM-DD). Saldo awal akun kas berlaku per tanggal ini; transaksi kas sebelum tanggal ini ditolak. Disarankan tanggal 1.',
    defaultValue: '',
  },
  {
    key: 'nomor_pb_mulai',
    label: 'Nomor urut Pengajuan Biaya (PB) pertama di BULAN go-live (nomor PB direset tiap bulan mulai 1). Contoh hasil: PB/<kode PT>/2611/0001. Isi lebih dari 1 hanya bila bulan go-live melanjutkan nomor manual. Per PT bisa diganti di sheet Perusahaan (kolom nomor_pb_mulai).',
    defaultValue: '1',
  },
  {
    key: 'tutup_periode_sebelum_golive',
    label: 'Ya = bulan sebelum go-live ditutup (tutup buku) saat impor di setiap PT file ini, sehingga tidak ada transaksi kas sebelum go-live.',
    defaultValue: 'Ya',
  },
] as const
export type SettingKey = (typeof SETTINGS)[number]['key']

/** Dropdown validation for a column (inline list or reference to another sheet's key column). */
export function validationFor(col: ColSpec): Validation {
  const title = col.key.slice(0, 32)
  if (col.ref) {
    const target = SHEET_BY_KEY[col.ref.sheet]
    const idx = target.columns.findIndex((c) => c.key === col.ref!.col)
    const letter = String.fromCharCode(65 + idx)
    return { kind: 'list', source: `${target.name}!$${letter}$2:$${letter}$2000`, allowOther: true, prompt: col.hint, title }
  }
  if (col.type === 'bool') return { kind: 'list', source: '"Ya,Tidak"', prompt: col.hint, title }
  if (col.type === 'roles') return { kind: 'list', source: `"${ROLE_LIST.join(',')}"`, allowOther: true, prompt: col.hint, title }
  if (col.type === 'enum' && col.options) {
    return { kind: 'list', source: `"${Object.keys(col.options).join(',')}"`, prompt: col.hint, title }
  }
  if (col.type === 'int' || col.type === 'money') return { kind: 'whole', min: col.min ?? 0, max: col.max, prompt: col.hint, title }
  if (col.type === 'decimal') return { kind: 'decimal', min: col.min, max: col.max, prompt: col.hint, title }
  return { kind: 'prompt', prompt: col.hint, title }
}

/** Columns whose cells should be Excel TEXT format (codes, account numbers, phones, dates as text). */
export function isTextColumn(col: ColSpec): boolean {
  return ['code', 'digits', 'phone', 'username', 'date', 'codes', 'plate', 'text', 'email', 'ptcode'].includes(col.type)
}
