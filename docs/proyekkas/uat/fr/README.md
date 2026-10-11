# RR Teams — Skrip UAT staging "Laporan Lapangan" (web 0.7.0 + APK 0.4.0)

- **Status:** draf untuk sesi UAT staging · **Tanggal:** 2026-10-10
- **Basis kode:** tag **`v0.7.0` @ `3bc8b94`** (yang berjalan di staging; `main` berisi perubahan lain yang belum
  dirilis). APK **mobile-v0.4.0** (pubspec `0.4.0+1`, catatan rilis `docs/release-notes/apk/0.4.0.md`).
- **Dasar:** ADR 0020 (`../../adr/0020-field-reports-per-project-kind.md`), `../../requirements-v1.3.md`
  (US-60…US-68), CHANGELOG `[0.7.0]`, keputusan owner 2026-10-09, dan **perilaku kode sebenarnya** pada tag di atas
  (`apps/web/src/domain/field/**`, koleksi `ContractUnits/ServiceReports/UnitTimesheets/AftersalesActivities/
  Vehicles/Projects/Companies`, view `admin/views/Field*.tsx`, migrasi `20261010_1*_fr1_*`, test
  `tests/integration/fr1-*.int.test.ts`, `apps/mobile/lib/features/field_reports/**`).
- Skrip ini untuk **pengguna klien** saat sesi UAT; pesan dan label dikutip dari kode.

## Isi folder

| File | Isi | Jumlah skenario |
|---|---|---:|
| [`00-persiapan.md`](00-persiapan.md) | Data uji fiktif di staging: PT UJI, akun & peran, flag per PT, jenis project, unit (Unit & Kendaraan), klien, unit kontrak + tarif, penugasan tim, laporan "lama" untuk uji 24 jam | 16 |
| [`web.md`](web.md) | Web per peran (Direktur, PM, Staff/mekanik, Finance, Admin): Unit & kontrak (matriks, rekap, estimasi tagihan), Laporan servis, Aftersales (PO terbuka, rekap mingguan), timeline project, jendela edit 24 jam + koreksi PM/Direktur, read-only Finance/Admin, nilai tersembunyi dari Staff, flag OFF | 33 |
| [`apk.md`](apk.md) | APK 0.4.0: timesheet unit (HM awal otomatis, "Salin dari kemarin", total ≤ 24 jam), laporan servis dengan foto, aktivitas aftersales (pengiriman mengacu PO terbuka), offline → sinkron, konflik, ditolak | 20 |
| [`../fase1/laporan-uat-template.md`](../fase1/laporan-uat-template.md) | Template laporan UAT + tanda tangan klien (dipakai ulang) | — |

Total **69 skenario** (53 di luar persiapan). ID: `FR-P-` persiapan · `FR-W-` web · `FR-A-` APK.

## Scope

- **IN:** jenis project (`projects.kind`), Unit & Kendaraan (alat berat, pemilik), unit kontrak + tarif, laporan servis
  unit (SV/YYMM/####), timesheet harian unit, log aktivitas aftersales, rekap timesheet kontrak + **estimasi tagihan**,
  rekap aftersales mingguan + PO terbuka, timeline project, notifikasi "menunggu part" dan pengingat follow-up,
  offline/sinkron/konflik APK, flag per PT, hak akses per peran.
- **OUT:** laporan harian konstruksi + RAP (P3, web 0.8.0), **PDF berita acara servis** (belum ada di 0.7.0 — S-07),
  tanda tangan klien di timesheet (Q-FR-3), stok sparepart (memang tidak dikelola).

## Prasyarat

1. Staging menjalankan **web `v0.7.0`** (migrasi `20261010_100000_fr1_foundation`, `…110000_fr1_field_reports`,
   `…120000_fr1_security` sudah jalan) dan worker (pengingat harian).
2. APK **0.4.0 varian staging** terpasang di **minimal 2 HP** (merek berbeda bila bisa).
3. Akun `admin.uji@proyekkas.test` dengan **Admin grup (semua PT)** (untuk membuat PT UJI dan akun).
4. Persiapan (`00-persiapan.md`) dijalankan **minimal 1 hari sebelum** sesi (FR-P-16 butuh laporan berumur > 24 jam).
5. Kata sandi dibagikan fasilitator secara terpisah; tidak ada kredensial di repo.

## Akun uji (fiktif, semua di PT UJI)

| Singkatan | Akun | Peran di PT UJI | Karyawan |
|---|---|---|---|
| **Admin** | `admin.uji@proyekkas.test` (sudah ada, Admin grup) | Admin | Admin Uji |
| **Direktur** | `dir-fr.uji@proyekkas.test` | Direktur | Direktur Uji FR |
| **PM** | `pm-fr.uji@proyekkas.test` | Project Manager (PM K-001, K-002, AS-001) | PM Uji |
| **Mekanik** | `mekanik-fr.uji@proyekkas.test` | Staff — ditugaskan ke K-001 dan AS-001 | Mekanik Uji |
| **Staff 2** | `staff2-fr.uji@proyekkas.test` | Staff — ditugaskan ke AS-001 saja | Staff Uji Dua |
| **Finance** | `finance-fr.uji@proyekkas.test` | Finance | Finance Uji |
| — | tanpa akun | Mandor (penugasan peran Mandor) | Mandor Uji |
| — | tanpa akun | (nama operator, teks di timesheet) | Operator Uji Satu |

## Data uji fiktif

| Data | Nilai |
|---|---|
| PT | **PT UJI Alat Berat**, kode singkat `UJI`, flag laporan lapangan **ON** (setelah FR-P-12) |
| Klien | **PT Pelanggan Uji Satu**, **PT Pelanggan Uji Dua** |
| Project | **K-001** "Sewa Excavator Tambang Uji" (Kontrak unit, klien Pelanggan Uji Satu) · **K-002** "Kontrak Uji Bentrok" (Kontrak unit) · **AS-001** "Aftersales Sparepart Uji" (Aftersales, klien Pelanggan Uji Satu) · **UM-001** "Project Umum Uji" (Umum) |
| Unit | **EX-01** Excavator 20 t, milik sendiri · **EX-02** Excavator 30 t, milik sendiri · **CU-01** Wheel loader, milik PT Pelanggan Uji Satu |
| Unit kontrak K-001 | EX-01 **per jam Rp 350.000, minimum 200 jam/bulan**, mulai tanggal 1 bulan berjalan · EX-02 **per bulan Rp 45.000.000**, mulai tanggal 1 |
| Timesheet EX-01 (APK) | H1 HM 1.000→1.008 kerja 8, standby 1 · H2 1.008→1.015 kerja 7, breakdown 4 ("Selang hidrolik bocor") · H3 1.015→1.023 kerja 8, standby 2 → **rekap 23 jam kerja**, estimasi **200 × Rp 350.000 = Rp 70.000.000** · H4 HM awal **1.020** (≠ 1.023) → **selisih HM** |
| Aftersales | **PO-0912** (PT Pelanggan Uji Satu, 2 item: Filter oli 10 PCS, Filter solar 10 PCS, **Rp 4.250.000**) → pengiriman **SJ-0441** "terkirim semua" → PO tertutup; rekap per pelanggan **PO 1 / terkirim 1 / belum 0** · PO-0913 (Pelanggan Uji Dua, sebagian lalu batal) · penawaran **Q-0077** follow-up = H |
| Foto | kertas bertulisan "HM UJI …", "SJ UJI", "SERVIS UJI" — tanpa wajah/dokumen asli |

Catatan: **jam kerja** di rekap = jumlah isian **Kerja** (bukan selisih HM), jadi isi 8 / 7 / 8 persis seperti di atas.

## Tanggal

| Penanda | Arti | Contoh (sesi Rabu 14 Okt 2026) |
|---|---|---|
| **HP** | hari persiapan, ≥ 1 hari sebelum sesi | Senin 12 Okt |
| **H** | hari sesi (hari ini) = **H4** | Rabu 14 Okt |
| **H1 / H2 / H3** | H−3 / H−2 / H−1, harus **di bulan yang sama** dengan H | 11 / 12 / 13 Okt |

Bila sesi jatuh tanggal 1–3, geser sesi atau pakai bulan sebelumnya pada pilihan **Bulan** di Rekap (kontrak K-001
harus sudah mulai tanggal 1 bulan itu agar minimum 200 jam berlaku penuh).

## Cara mengisi dan melapor

- Kolom **PASS/FAIL**: `PASS`, `FAIL`, atau `Tidak diuji — <alasan>`. Kolom **Catatan**: jam (WITA), nomor dokumen
  (SV/…, PO/SJ), pesan error **apa adanya**, nama file tangkapan layar.
- Satu FAIL tidak menghentikan sesi; skenario yang bergantung padanya ditandai "Tidak diuji — bergantung <ID>".
- Laporan: salin [`../fase1/laporan-uat-template.md`](../fase1/laporan-uat-template.md) menjadi
  `laporan-uat-fr-<YYYY-MM-DD>.md` di folder ini; di §1 ganti baris kelompok menjadi **00 Persiapan FR**,
  **Web FR — Direktur / PM / Staff / Finance / Admin / Lintas peran**, **APK FR**; isi build web `v0.7.0` dan APK
  `0.4.0`; tulis skrip yang dipakai = `docs/proyekkas/uat/fr/` @ commit skrip ini.
- Prioritas FAIL sama dengan fase 1 (Tinggi = salah angka/uang, data rusak/hilang, akses tidak sah, alur utama macet).
  FAIL karena **T-01** = Tinggi (HM bisa berubah tanpa disadari).

## Urutan yang disarankan

1. **HP (hari persiapan):** FR-P-01…FR-P-16 (FR-P-03 sebelum FR-P-12).
2. **H pagi (APK, Mekanik):** FR-A-01…FR-A-06 (H1 online, H2–H3 offline, sinkron).
3. **Web Direktur:** FR-W-01…FR-W-04 (rekap 23 jam, estimasi Rp 70.000.000) — **sebelum** H4.
4. **APK:** FR-A-07 (H4 selisih HM), FR-A-08…FR-A-11 (servis, menunggu part, unit pelanggan).
5. **Web PM:** FR-W-11, FR-W-12 (koreksi H4), FR-W-13, FR-W-16; **web Staff:** FR-W-18…FR-W-22.
6. **Aftersales:** FR-A-12, FR-A-13, FR-A-14 → web FR-W-08, FR-W-09, FR-W-23, FR-W-24, FR-W-25, FR-W-15.
7. **Sisa web:** FR-W-05…FR-W-07, FR-W-10, FR-W-14, FR-W-17, FR-W-26…FR-W-30; APK FR-A-15, FR-A-16, FR-A-17,
   FR-A-19, FR-A-20.
8. **Terakhir:** flag OFF/ON FR-W-31, FR-W-32 (+ FR-A-18), uji API opsional FR-W-33.

## Aturan owner → kode → skenario

| # | Aturan owner | Perilaku kode (v0.7.0) | Status | Skenario |
|---|---|---|---|---|
| R-01 | Backdate ≤ 14 hari, tidak boleh masa depan | `reportDateError`: "Tanggal laporan tidak boleh di masa depan (hari ini YYYY-MM-DD)." / "Tanggal laporan paling lama 14 hari ke belakang." Web: pemilih tanggal H−14…H; APK: daftar 15 tanggal | Sesuai (catatan S-09) | FR-A-02, FR-W-19 |
| R-02 | HM tidak boleh di bawah `lastHourMeter` unit | Hanya **laporan servis** (409 `HM_DECREASED` "HM x lebih kecil dari HM terakhir unit (y). Periksa angka HM; koreksi HM lama oleh PM/Direktur."); timesheet **tidak** diperiksa | **Selisih S-01** | FR-A-10, FR-W-20 |
| R-03 | HM awal ≠ HM akhir kemarin → tanda selisih HM | Tanda `HM_GAP` ("⚠ selisih HM" / APK "Selisih HM") bila HM awal ≠ HM akhir timesheet **sebelumnya** unit itu; laporan tetap tersimpan | Sesuai (catatan S-02) | FR-A-07, FR-W-12 |
| R-04 | Ketersediaan = (kerja+standby)/(kerja+standby+breakdown) | `availabilityPct`, 1 desimal; web Rekap/matriks dan ekspor | Sesuai | FR-W-03 |
| R-05 | Estimasi: per jam = tarif × maks(jam kerja, minimum diprorata hari kontrak); per bulan = tarif prorata hari kontrak; "estimasi, bukan invoice" | `billingEstimate`; label web "Estimasi — bukan invoice", ekspor "ESTIMASI, BUKAN INVOICE …"; minimum dan per bulan diprorata hanya bila kontrak tidak menutup sebulan penuh | Sesuai | FR-W-03, FR-W-04, FR-W-05 |
| R-06 | Breakdown ≥ 4 jam → saran `BREAKDOWN_SUGGEST_SERVICE` | `BREAKDOWN_SUGGEST_SERVICE_HOURS = 4` (≥ 4); tanda "saran laporan servis", kotak saran + tombol **Buat laporan servis** (web & APK) | Sesuai | FR-A-04, FR-W-02, FR-W-18 |
| R-07 | Unit tidak boleh aktif di dua kontrak pada tanggal sama | Hook + trigger DB (periode bertumpuk, kontrak aktif): "Unit ini sudah aktif di kontrak lain pada periode yang sama." | Sesuai | FR-P-09 |
| R-08 | Timesheet unik per unit + tanggal | Index unik + 409 `DUPLICATE_DATE`; form web/APK mencegah lebih dulu | Sesuai | FR-A-08, FR-W-19 |
| R-09 | Servis "menunggu part" → notifikasi PM, status unit ikut | Notifikasi "Unit menunggu part: …" ke PM project (bukan ke pelaku); `vehicles.status` = status laporan servis terakhir | Sesuai | FR-A-09, FR-W-11, FR-W-06, FR-W-20 |
| R-10 | Finance & Admin read-only; mandor tanpa akun; stok sparepart tidak dikelola | Buat/ubah/koreksi hanya Staff ditugaskan / PM tim / Direktur; Finance/Admin 403 dan form "Tidak ada akses"; peran penugasan "Mandor" tanpa akun; sparepart = baris teks | Sesuai (catatan S-11) | FR-W-27, FR-W-29, FR-W-33, FR-A-20, FR-P-11 |
| R-11 | Nilai aftersales opsional, hanya Direktur/Finance/Admin + pelapor | Field access + DTO + view; Staff/PM lain `value: null` | Sesuai (catatan S-06, S-10) | FR-A-12, FR-A-13, FR-W-09, FR-W-24, FR-W-25, FR-W-15 |
| R-12 | Staff tidak ditugaskan → ditolak | 403 `FORBIDDEN` "… hanya dapat dibuat oleh Staff yang ditugaskan ke project ini, PM project, atau Direktur." + Audit `access_denied`; UI tidak menawarkan project | Sesuai | FR-W-25, FR-W-33, FR-A-17 |
| R-13 | Flag per PT default OFF → menu tersembunyi | `companies.fieldReportsEnabled` default false, tidak disalin ke PT baru; diatur **Admin/Direktur PT** (atau Admin grup) di Pengaturan → Perusahaan (PT) → tab Operasional; view + tile APK tersembunyi, buat laporan 403 `FEATURE_DISABLED` | **Sebagian — S-03, S-05** | FR-P-01, FR-P-03, FR-P-12, FR-W-31, FR-A-18 |
| R-14 | Jenis project diatur Direktur/Admin, terkunci bila ada data lapangan | Ubah jenis: hanya Direktur/Admin; terkunci 409 "Jenis project tidak dapat diubah: project ini sudah punya laporan lapangan atau unit kontrak." (hook + trigger DB) | **Sebagian — S-04** | FR-P-07, FR-P-10, FR-W-10 |
| R-15 | Skenario rencana: EX-01/K-001, 23 jam, estimasi 200 × tarif; H4 1020 → tanda; PO-0912 → SJ-0441 → PO tertutup; rekap PO 1/1/0 | Seluruhnya didukung kode (rekap per pelanggan menghitung PO berdasarkan **tanggal PO** dalam minggu itu, status = status saat ini) | Sesuai (kecuali PDF berita acara, S-07) | FR-A-03…07, FR-W-03, FR-A-12…14, FR-W-08 |

## Selisih (aturan owner / rencana vs kode v0.7.0) — dibahas dengan klien

Skenario ditulis sesuai **perilaku aplikasi sebenarnya**; bila klien tidak menerima selisih di bawah, catat sebagai
temuan di laporan §5.

| # | Topik | Aturan / rencana | Perilaku kode v0.7.0 | Dampak / skenario |
|---|---|---|---|---|
| S-01 | HM tidak boleh turun | HM tidak boleh di bawah `lastHourMeter` unit | Hanya **laporan servis** yang ditolak `HM_DECREASED`, dan pembandingnya adalah bacaan HM terbaru **pada/sebelum tanggal laporan** (bukan `lastHourMeter` saat ini). **Timesheet tidak diperiksa**: HM awal/akhir di bawah HM terakhir diterima (paling-paling bertanda selisih HM bila ≠ HM akhir timesheet sebelumnya). Karena `lastHourMeter` dihitung ulang dari dokumen terbaru menurut tanggal, HM terakhir unit **bisa turun** lewat timesheet. | Tinggi untuk dasar tagihan. Uji tambahan (opsional, APK, setelah FR-W-18): timesheet **EX-02 tanggal H2** dengan HM 4.000→4.004 (di bawah HM terakhir 5.006) → **diterima**, tanpa penolakan dan tanpa tanda selisih HM (belum ada timesheet EX-02 sebelum H2; HM awal di APK kosong, tanpa peringatan). |
| S-02 | Selisih HM | Pembanding = HM akhir **kemarin** | Pembanding = HM akhir **timesheet terakhir sebelum tanggal itu** (bisa beberapa hari lalu); HM laporan servis tidak dipakai. | Rendah. FR-A-07. |
| S-03 | Flag OFF → menu tersembunyi | Semua menu laporan lapangan tersembunyi | View **Unit & kontrak / Laporan servis / Rekap aftersales / Aktivitas aftersales**, tab Timeline, dan tile APK tersembunyi; tetapi entri koleksi **Data laporan servis / Data timesheet unit / Data aktivitas aftersales / Unit kontrak** di Proyek → Laporan lapangan tetap tampil bagi peran yang boleh membaca (daftar kosong), dan isian **Jenis project** tetap ada di form project. | Rendah. FR-P-03, FR-W-31. |
| S-04 | Jenis project | Hanya Direktur/Admin yang menetapkan jenis | Pembatasan hanya saat **ubah**. Saat **membuat** project, siapa pun yang boleh membuat project (Direktur, Admin, dan **PM** sejak 0.7.0) dapat memilih jenis. | Sedang. FR-P-07 (d). |
| S-05 | Siapa menyalakan flag | Admin/Direktur PT (catatan rilis APK) | Kode: Admin/Direktur PT itu atau Admin grup (benar). Teks halaman "Tidak ada akses" menyebut "**Admin grup** dapat menyalakannya di Pengaturan › Perusahaan." | Rendah (kata-kata). FR-P-03, FR-P-12. |
| S-06 | Teks nilai aftersales di APK | Nilai terlihat Direktur/Finance/Admin + pelapor | Server sesuai; teks bantuan APK "Hanya terlihat oleh Anda dan **Direktur/Finance**." (Admin tidak disebut). Web: "Hanya terlihat oleh Direktur/Finance/Admin dan Anda." | Rendah. FR-A-12. |
| S-07 | PDF berita acara servis | Rencana UAT #3 "PDF berita acara" | Belum ada di 0.7.0 (CHANGELOG: "The service PDF … follow"). Rekap timesheet dan rekap aftersales sudah punya PDF. | Rencana UAT #3 tanpa langkah PDF. |
| S-08 | Timeline project | Detail project menampilkan timeline | Tab **Timeline** di **Progress project** (`?tab=timeline`) hanya untuk **Direktur, Finance, PM**. **Admin dan Staff** mendapat "Tidak ada akses"; mereka hanya bisa memakai tab Timeline di detail kontrak (**project kontrak unit saja**) — timeline project aftersales tidak tersedia bagi Admin/Staff. | Sedang. FR-W-26, FR-W-30. |
| S-09 | Batas 14 hari untuk data offline | 14 hari ke belakang | Untuk laporan offline, "hari ini" = waktu laporan **diisi di HP** (perkiraan jam server/HP), bukan waktu sampai di server. Laporan yang diisi tepat waktu tetap diterima walau terkirim belakangan. | Informasi. |
| S-10 | Tampilan nilai di rekap aftersales | — | Nilai ringkas dibulatkan 1 desimal: Rp 4.250.000 tampil "**Rp 4,3 jt**" (nilai penuh di tooltip/detail). | Rendah (tampilan). FR-W-08. |
| S-11 | Operator tanpa akun | Operator/mandor tidak punya akun | Sesuai untuk laporan lapangan. Catatan: 0.7.0 menambah peran **Operator/Anggota** (absensi saja); akun seperti itu **tidak** bisa membuat laporan lapangan dan tidak melihat menu/tile-nya. | Informasi. |
| S-12 | Unit di laporan servis kontrak | Unit project kontrak = unit kontraknya | Form web/APK hanya menawarkan unit kontrak, tetapi server tidak memeriksa unit ada di kontrak project (hanya PT sama, aktif, dan pemilik = klien project). | Rendah (hanya lewat API). |

## Temuan pra-UAT dari pembacaan kode (bukan aturan owner — perlu keputusan sebelum sesi)

| # | Temuan | Rincian | Skenario yang terdampak |
|---|---|---|---|
| **T-01** | **Angka HM ≥ 1.000 di form/dialog web terbaca salah** | Web menampilkan desimal dengan `fmtNum` (titik ribuan: 1023 → "1.023") tetapi membaca isian dengan `parseDecimalId` yang menganggap **satu titik = desimal**. Akibat: (a) **Isi timesheet**: HM awal yang terisi otomatis "1.023" ditolak "Angka tidak valid…", dan "5.000" terbaca **5**; (b) dialog **Koreksi / Ubah (24 jam)**: isian HM yang tidak diubah ikut terkirim sebagai angka kecil ("1.030" → 1,03; "5.000" → 5) — pada **koreksi** tidak ada pemeriksaan HM sehingga HM laporan (dan HM terakhir unit) **bisa rusak tanpa disadari**; pada **ubah** pelapor ditolak `HM_DECREASED` dengan angka aneh. Diverifikasi dengan menjalankan salinan kedua fungsi: 1000→"1.000"→1; 1020→"1.020"→1,02; 1023→"1.023"→tidak valid. APK tidak terdampak (`parseDec` membaca "1.023" sebagai ribuan). Belum diperbaiki di `main`. | FR-W-12, FR-W-14, FR-W-18, FR-W-21, FR-A-16 (koreksi PM) — ditandai **[T-01]** |
