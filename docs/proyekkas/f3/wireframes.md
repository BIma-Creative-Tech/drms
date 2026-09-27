# ProyekKas F3: wireframe dashboard, laporan, dan audit log (low-fi)

- **Status:** accepted (user 2026-09-24, semua default Q-F3-1…8), implemented di `feat/nextjs-f3-dashboards`.
  Prototipe HTML klien tidak tersedia; tata letak ini adalah usulan Analyst yang disetujui user.
- **Tanggal:** 2026-09-24 · **Penulis:** Analyst · **Basis:** `develop` `e9c07ab`
- Angka di wireframe adalah **contoh fiktif** ("Proyek Uji" `UJI-PRJ`, pusat biaya "Ops Palangka Banjar", akun "Kas Kecil"/"Bank Operasional").
  Setiap angka mengikuti definisi di `kpi-definitions.md` (kode `K-xx`).

---

## 0. Kerangka teknis (realistis untuk Payload admin 3.90.1)

| Topik | Usulan | Dasar |
|---|---|---|
| Halaman beranda `/admin` | Ganti dashboard bawaan dengan satu komponen `Beranda` lewat `admin.components.views.dashboard`. Komponen memilih tata letak menurut peran. | Verified in Payload 3.90.1 `config/types.d.ts`: `views.dashboard?: AdminViewConfig` ("Replace the admin homepage"). The newer `admin.dashboard` widget API is marked `@experimental` → not used. |
| Pengguna dengan beberapa peran | Tata letak dipilih dengan urutan Owner > Finance > PM > Admin > Staff. Peran lain tampil sebagai tab di atas ("Owner · Finance"). | Roles are a union (architecture §7.1). |
| Halaman baru | `/admin/laporan` (daftar laporan), `/admin/laporan/<kode>` (satu laporan), `/admin/audit-log` (global). Semuanya custom root view, dibungkus `Shell`/`DefaultTemplate` seperti view F2. | Pattern of `admin/views/shared.tsx` (F2). |
| Rendering | Server-rendered (RSC). Filter memakai `<form method="get">` (query string), jadi **tanpa JS klien** untuk filter. Tombol export berupa tautan biasa ke endpoint. | Keeps the nonce-strict script CSP (F1 decision); matches F2 views. |
| Grafik | **SVG inline yang dirender server**, tanpa library grafik. Satu sumbu, batang tipis, legenda + tabel angka di bawahnya (aksesibel). Hover = `<title>` SVG (tooltip bawaan browser). | No new dependency; `style-src 'unsafe-inline'` already approved; SVG needs no script. |
| Data | Endpoint baru `GET /api/v1/dashboard/{owner,finance,pm,me}` dan `GET /api/v1/reports/<kode>` (+ `.csv/.xlsx/.pdf`). APK F4 memakai endpoint dashboard yang sama. | Traceability US-12/25/27/28 "proposed" paths. |
| Warna status | Hijau/kuning/merah/abu **selalu disertai label teks** ("Aman", "Waspada", "Lewat RAB", "Tanpa RAB"). Tidak pernah hanya warna. | `badge()` tones in `shared.tsx`; dataviz rule "status never color alone". |
| Klik angka | Setiap angka membuka daftar koleksi Payload dengan filter `where` di URL, atau halaman laporan dengan filter yang sama (C9). | e.g. `/admin/collections/expense-requests?where[status][in]=pending_ack,pending_approval` |
| Lebar HP (< 768 px) | Kartu KPI menjadi 1 kolom (CSS grid `repeat(auto-fit, minmax(240px, 1fr))`). Tabel dibungkus `overflow-x:auto`, kolom sekunder disembunyikan dan hanya kolom utama tampil. Grafik memakai `viewBox` sehingga ikut lebar layar, dan 12 bulan menjadi 6 bulan dengan tombol "‹ lebih lama". | Staff/PM/Owner mostly use the APK (F4); web mobile only needs to stay usable. Payload nav collapse on narrow screens: **to verify in the build** (not checked this session). |
| Kosong | Setiap widget punya teks kosong sendiri (lihat per halaman). Tidak ada angka 0 tanpa penjelasan. | |
| Galat | Satu widget yang gagal hanya menampilkan "Data tidak dapat dimuat (kode permintaan …)" dan widget lain tetap tampil. | `requestId` from logging (architecture §12). |

Legenda wireframe: `[ … ]` = kartu/widget, `→` = tujuan saat diklik, `(F5)` = placeholder sampai F5.

---

## 1. Beranda Owner (`/admin`, peran `pk-owner`)

US-27 (4 kartu utama), US-28 (grafik), US-12 (anggaran vs progress, bagian progress F5).

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Beranda · Owner                                  Periode: [Sep 2026 ▾]  Per: 24/09/2026 │
├──────────────────────┬──────────────────────┬──────────────────────┬──────────────────┤
│ [1] SALDO KAS  K-01  │ [2] ANGGARAN TERPAKAI │ [3] KELENGKAPAN      │ [4] MENUNGGU     │
│ Rp 48.250.000        │     K-08 (komitmen)   │     NOTA/LPJ  K-12   │     PERSETUJUAN  │
│ Kas Kecil  2.150.000 │ 3 project berjalan    │ 4 dari 6 uang muka   │     K-10         │
│ Bank Ops  46.100.000 │ 🔴 1 Lewat RAB        │   sudah LPJ          │ 5 pengajuan      │
│ Bulan ini: +12,0 jt  │ 🟡 1 Waspada          │ ⚠ 2 LPJ terlambat    │ Rp 18.400.000    │
│            −9,4 jt   │ 🟢 1 Aman             │ 3 nota reimburse     │ 3 menunggu saya  │
│ → Laporan Rekap Kas  │ → daftar §1.[6]       │   menunggu verifikasi│ tertua 4 hari    │
│                      │                       │ → Laporan Kelengkapan│ → /admin/persetujuan│
├──────────────────────┴──────────────────────┴──────────────────────┴──────────────────┤
│ [5] ARUS KAS BULANAN (K-02b)            [12 bln ▾] [Semua akun ▾] [☐ tampilkan koreksi void]│
│  jt                                                                 ■ Masuk  ■ Keluar   │
│  20 ┤        ▐▌                                                                         │
│  10 ┤ ▐▌▐▌   ▐▌▐▌  ▐▌▐▌  ...                                                          │
│   0 ┼──Okt────Nov────Des──── … ────Sep                                                 │
│  ▸ Tabel angka (Bulan · Masuk · Keluar · Selisih)          → klik batang: Rekap Kas bulan itu│
├───────────────────────────────────────────────────────────────────────────────────────┤
│ [6] ANGGARAN PROJECT (K-07/K-08, K-05, K-06, K-09)                                       │
│ Project        RAB          Komitmen   %      Status       Dicairkan  Realisasi  Progress│
│ UJI-PRJ Proyek Uji  50.000.000  43.500.000  87,00  🟡 Waspada  40.000.000  31.200.000  (F5)│
│ …                                                                                        │
│ → klik baris: Laporan Anggaran Project (UJI-PRJ)                                          │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ [7] PUSAT BIAYA BULAN INI (K-15)          [8] ANTRIAN TRANSFER (K-11, lihat saja)        │
│ OPS-PB Ops Palangka Banjar  Rp 3.447.500  │ 2 pengajuan · Rp 4.200.000 · 1 lewat tgl butuh│
│ → Rekap Kas difilter pusat biaya          │ → /admin/antrian-transfer                     │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

| # | Widget | Klik → | Kosong |
|---|---|---|---|
| 1 | Saldo kas total + per akun + perubahan bulan berjalan (masuk/keluar K-02b) | Laporan **Rekap Kas** (bulan berjalan) | "Belum ada akun kas. Admin/Finance menambah di Master Data › Akun kas/bank." |
| 2 | Jumlah project `berjalan` per warna anggaran (K-08) | Scroll ke [6] | "Belum ada project berjalan dengan RAB." |
| 3 | Rasio LPJ (K-12g), LPJ terlambat (K-12b), nota reimburse menunggu (K-12e), flag peringatan terbuka (K-12f) | Laporan **Kelengkapan Nota/LPJ** | "Semua uang muka sudah ber-LPJ. ✓" |
| 4 | K-10 total + "menunggu saya" + umur tertua | `/admin/persetujuan` (F2) | "Tidak ada pengajuan yang menunggu. ✓" |
| 5 | Grafik batang berpasangan Masuk/Keluar per bulan (satu sumbu Rupiah), tabel angka bisa dibuka | Rekap Kas bulan itu | "Belum ada transaksi kas di rentang ini." |
| 6 | Tabel project: RAB, Komitmen, %, label warna, Dicairkan, Realisasi, Progress **(F5)** | Laporan **Anggaran Project** per project | "Belum ada project." |
| 7 | Biaya pusat biaya bulan berjalan (Q-24: tanpa anggaran) | Rekap Kas, filter pusat biaya | "Belum ada biaya pusat biaya bulan ini." |
| 8 | Ringkasan antrian transfer (Owner hanya melihat) | `/admin/antrian-transfer` | "Antrian transfer kosong." |

**Lebar HP:** urutan tumpukan: [4] → [1] → [3] → [2] → [6] (hanya kolom Project, %, Status) → [5] (6 bulan) → [7] → [8].
Kartu "menunggu persetujuan" ditaruh paling atas karena itu aksi Owner.

---

## 2. Beranda Finance (`/admin`, peran `pk-finance`)

Fokus pada pekerjaan hari ini (US-19, US-21, US-39) lalu kas (US-23, US-25).

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Beranda · Finance                                          Per: 24/09/2026 (WITA)       │
├─────────────────────┬─────────────────────┬─────────────────────┬─────────────────────┤
│ [1] ANTRIAN TRANSFER│ [2] VERIFIKASI NOTA │ [3] VERIFIKASI LPJ  │ [4] SELESAIKAN      │
│     K-11            │     REIMBURSE K-12e │     K-12c           │     SELISIH LPJ K-12d│
│ 2 · Rp 4.200.000    │ 3 pengajuan         │ 1 LPJ               │ 1 (refund Rp 800.000)│
│ 1 lewat tgl butuh   │ 2 flag peringatan   │                     │                     │
│ → /admin/antrian-   │ → /admin/antrian-   │ → /admin/verifikasi-│ → /admin/verifikasi-│
│   transfer          │   transfer (bagian  │   lpj               │   lpj               │
│                     │   verifikasi nota)  │                     │                     │
├─────────────────────┴─────────────────────┴─────────────────────┴─────────────────────┤
│ [5] SALDO PER AKUN (K-01)                        [6] UANG MUKA BELUM LPJ (K-12a/b)     │
│ Akun            Saldo        Masuk bln  Keluar bln│ Nomor          Pemohon  Nominal   Umur │
│ Kas Kecil       2.150.000    1.000.000   850.000  │ 231/PB-DRMS/… Budi   5.000.000  9 hr ⚠│
│ Bank Operasional 46.100.000  11.000.000 8.550.000 │ …                                       │
│ → Rekap Kas per akun                              │ → pengajuan (klik baris)                │
├───────────────────────────────────────────────────┴───────────────────────────────────┤
│ [7] ARUS KAS BULANAN (K-02a, 6 bln) — sama dengan Owner [5], default dengan koreksi void │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ [8] TUTUP BUKU: bulan terakhir ditutup Agu 2026 · [Tutup buku Sep 2026] (aksi F2, hanya bulan lampau)│
│ [9] AKSI CEPAT: [+ Kas masuk] [+ Kas keluar] [Laporan] [Buat pengajuan atas nama]       │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

| # | Klik → | Kosong |
|---|---|---|
| 1 | `/admin/antrian-transfer` | "Antrian transfer kosong." |
| 2 | `/admin/antrian-transfer` (bagian "Verifikasi nota reimburse", F2) | "Tidak ada nota reimburse yang menunggu." |
| 3, 4 | `/admin/verifikasi-lpj` | "Tidak ada LPJ yang menunggu." |
| 5 | Rekap Kas, filter akun | "Belum ada akun kas." |
| 6 | Dokumen pengajuan | "Semua uang muka sudah ber-LPJ." |
| 7 | Rekap Kas bulan itu | sama dengan Owner [5] |
| 8 | Daftar `period-closings`. Tombol memanggil `POST /api/v1/period-closings` (F2) | "Belum pernah tutup buku." |
| 9 | Form F2 yang sudah ada | – |

**Lebar HP:** [1]–[4] menjadi baris ringkas 2×2 → [6] → [5] → [8] → [7]. Aksi cepat [9] disembunyikan (entri kas dilakukan di desktop).

---

## 3. Beranda PM (`/admin`, peran `pk-pm`), scope *team* saja

US-12 (progress vs anggaran, bagian progress **F5**), US-13 (kehadiran tim, **F5**), US-17 (pantau pengajuan tim).
PM **tidak** melihat saldo akun kas (§4).

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Beranda · PM            Project/pusat biaya saya: [Semua ▾]           Per: 24/09/2026   │
├──────────────────────┬──────────────────────┬──────────────────────┬──────────────────┤
│ [1] MENUNGGU         │ [2] PENGAJUAN TIM    │ [3] LPJ TIM          │ [4] KEHADIRAN    │
│     "DIKETAHUI" SAYA │     BULAN INI K-13   │     K-12a/b          │     HARI INI     │
│ 2 pengajuan          │ 7 · Rp 12.300.000    │ 2 belum LPJ          │     (F5, US-13)  │
│ → /admin/persetujuan │ 3 menunggu approval  │ 1 terlambat ⚠        │ Tersedia setelah │
│                      │ → daftar pengajuan   │ → daftar             │ modul absensi F5 │
├──────────────────────┴──────────────────────┴──────────────────────┴──────────────────┤
│ [5] PROJECT SAYA: ANGGARAN VS PROGRESS (K-08, K-09)                                     │
│ Project             RAB         Komitmen  %      Status      Progress  Selisih  Warna   │
│ UJI-PRJ Proyek Uji  50.000.000  43.500.000 87,00 🟡 Waspada   (F5)      (F5)     (F5)    │
│ → Laporan Anggaran Project                                                             │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ [6] PUSAT BIAYA SAYA BULAN INI (K-15): OPS-PB  Rp 3.447.500                               │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ [7] PENGAJUAN TIM TERBARU (10): Nomor · Judul · Pemohon · Status · Grand total          │
│ → dokumen; "Lihat semua" → daftar pengajuan (scope team otomatis dari access control)    │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ [8] LAPORAN PROGRESS TERAKHIR (F5, US-31) · placeholder                                 │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

| # | Klik → | Kosong |
|---|---|---|
| 1 | `/admin/persetujuan` (hanya langkah "Diketahui"; PM tidak bisa approve, US-17) | "Tidak ada pengajuan yang menunggu Anda." |
| 2 | `/admin/collections/expense-requests?where[requestDate][greater_than_equal]=2026-09-01` | "Belum ada pengajuan tim bulan ini." |
| 3 | Laporan Kelengkapan (scope team) | "Semua uang muka tim sudah ber-LPJ." |
| 4, 8 | – (F5) | Teks "Tersedia setelah modul absensi/progress (F5)." |
| 5 | Laporan Anggaran Project | "Anda belum ditetapkan sebagai PM project mana pun. Hubungi Owner/Admin." (prasyarat onboarding architecture §5.2) |
| 6 | Rekap Kas tidak tersedia untuk PM → Laporan Rekap Pengajuan difilter pusat biaya | "Anda tidak memegang pusat biaya." |
| 7 | Dokumen pengajuan | "Belum ada pengajuan tim." |

**Lebar HP:** [1] → [3] → [5] (kolom Project, %, Status) → [2] → [7] (Nomor, Status, Nominal) → [6] → [4]/[8] placeholder.

---

## 4. Beranda Staff (`/admin`, peran `pk-staff` saja), **opsional** (Q-F3-6)

Staff terutama memakai APK (F4). Web hanya menampilkan navigasi terbatas (F2c). Usulan beranda kecil:

```
┌──────────────────────────────────────────────────────────────┐
│ Halo, <nama>                                                 │
│ [+ Buat pengajuan]  [Profil & tanda tangan]                  │
├──────────────────────────────────────────────────────────────┤
│ [1] PERLU TINDAKAN SAYA                                      │
│  • 229/PB-DRMS/… Ditransfer: unggah nota & kirim LPJ (umur 5 hr)│
│  • 230/PB-DRMS/… Revisi Nota: perbaiki nota                   │
│  • Draft "BBM Hilux" belum diajukan                           │
├──────────────────────────────────────────────────────────────┤
│ [2] PENGAJUAN SAYA (10 terbaru): Nomor · Status · Nominal     │
│ → dokumen (timeline F2c)                                       │
└──────────────────────────────────────────────────────────────┘
```
- [1] "Perlu tindakan" = pengajuan own dengan status `draft`, `receipt_revision`, `transferred`, `receipts_complete`, `lpj_revision`.
- Kosong: "Tidak ada yang perlu Anda kerjakan. ✓" / "Anda belum punya pengajuan."
- Lebar HP: sudah satu kolom.

## 4a. Beranda Admin (`pk-admin` saja)
Tanpa KPI keuangan (§4). Isinya: [Audit log terbaru (20)] → `/admin/audit-log`; [User tanpa karyawan/peran],
[Project tanpa PM], [Pusat biaya tanpa penanggung jawab] (prasyarat alur approval F2). Setiap item mengarah ke daftar koleksi terfilter.
Kosong: "Data master lengkap ✓".

---

## 5. Laporan (`/admin/laporan`), Finance/Owner (all) dan PM (team)

### 5.1 Daftar laporan

| Kode | Laporan | Peran | Export | KPI |
|---|---|---|---|---|
| `rekap-kas` | Rekap Kas (per akun, per bulan, masuk/keluar, koreksi void) | Finance, Owner | CSV · XLSX · PDF | K-01, K-02a |
| `buku-kas` | Buku Kas (daftar transaksi kas per baris) | Finance, Owner | CSV · XLSX | ledger rows |
| `pengeluaran-kategori` | Pengeluaran per Kategori / Project / Pusat Biaya (US-25) | Finance, Owner, PM (team, tanpa kas manual) | CSV · XLSX · PDF | K-17, K-06 |
| `anggaran-project` | Anggaran Project: RAB vs Komitmen vs Dicairkan vs Realisasi (per kategori bila ada RAB kategori) | Finance, Owner, PM (team) | CSV · XLSX · PDF | K-07, K-08, K-05, K-06 |
| `rekap-pengajuan` | Rekap Pengajuan per status/jenis/kategori/periode | Finance, Owner, PM (team) | CSV · XLSX | K-13 |
| `kelengkapan` | Kelengkapan Nota/LPJ (uang muka belum LPJ, terlambat, flag terbuka) | Finance, Owner, PM (team) | CSV · XLSX | K-12 |
| `biaya-kendaraan` | Biaya per Kendaraan (dasar) | Finance, Owner, PM (team, tanpa kas manual) | CSV · XLSX | K-14 |
| `absensi` | Rekap absensi | **F5** | – | – |

### 5.2 Halaman satu laporan (contoh `pengeluaran-kategori`)

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Laporan › Pengeluaran per Kategori                                                     │
│ ┌ Filter (form GET) ─────────────────────────────────────────────────────────────────┐ │
│ │ Dari [2026-09-01] Sampai [2026-09-30]  Jenis [Semua ▾]  Project/Pusat biaya [Semua ▾]│ │
│ │ Kategori [Semua ▾]  Dasar [Dicairkan ▾ | Realisasi]      [Terapkan] [Reset]          │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│ Export: [CSV] [Excel (.xlsx)] [PDF]        Dibuat 24/09/2026 10:15 WITA · 142 baris      │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ Kategori        Pengajuan  Dicairkan     Kas manual   Total        % total               │
│ Transport/BBM       12     7.200.000     350.000      7.550.000    41,2                  │
│ Penginapan           4     2.708.000           0      2.708.000    14,8                  │
│ …                                                                                        │
│ TOTAL               21    17.900.000     420.000     18.320.000   100,0                  │
│ Catatan kaki: kategori dari baris item; selisih LPJ (refund/kekurangan) ada di dasar Realisasi.│
│ → klik baris kategori: Rekap Pengajuan dengan filter kategori + periode yang sama          │
└───────────────────────────────────────────────────────────────────────────────────────┘
```
- **Filter** ada di URL, sehingga tautan bisa dibagikan dan tombol export memakai filter yang sama persis.
- **Kosong:** "Tidak ada data untuk filter ini." + tombol Reset.
- **Batas:** tampilan layar dipaging 100 baris. Batas export: lihat `export-library-decision.md` (XLSX ≤ 10.000 baris; lebih dari itu
  tombol XLSX nonaktif dengan pesan "Persempit filter atau pakai CSV").
- **Lebar HP:** filter dilipat ke tombol "Filter (3 aktif)". Tabel hanya menampilkan Kategori + Total, dan kolom lain tampil saat baris diketuk (`<details>`).
- **PM:** dropdown project/pusat biaya hanya berisi scope team. Filter di luar scope yang dikirim lewat URL ditolak server (403) atau menghasilkan kosong, tidak pernah data orang lain.

### 5.3 Isi export (umum)
- Baris judul: nama laporan, perusahaan, filter yang dipakai, "Dibuat oleh <nama> · <waktu WITA>".
- Nominal = angka (bukan teks) dengan format ribuan, dan tanggal = tanggal Excel `dd/mm/yyyy` (detail di keputusan export).
- Nomor rekening tujuan **tidak** diekspor, kecuali di Buku Kas untuk Finance/Owner (sama dengan hak baca `employee-bank-accounts`).
- Setiap export menulis baris audit `action='export'` (report, filter, format, jumlah baris).
- PDF: A4 landscape, kop perusahaan, tabel ringkasan (bukan ribuan baris; maks. 500 baris, di atas itu diminta pakai XLSX/CSV).

---

## 6. Audit Log global (`/admin/audit-log`), Owner dan Admin (Finance: Q-F3-4)

Requirements §8 "Tampilan log": filter tanggal, user, jenis dokumen, aksi. Sekarang koleksi `audit-logs` sudah bisa dibaca
Finance/Owner/Admin lewat list view bawaan Payload. View khusus ini menambah filter yang mudah dipakai dan tampilan nilai lama → baru.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Audit Log                                                                              │
│ ┌ Filter ────────────────────────────────────────────────────────────────────────────┐ │
│ │ Dari [2026-09-01 00:00] Sampai [2026-09-24 23:59] (WITA)  User [cari nama ▾]        │ │
│ │ Jenis dokumen [Pengajuan ▾]  Aksi [Semua ▾ (approve, reject, void, export, …)]      │ │
│ │ No. dokumen [228/PB-…]  Sumber [web|apk|system|job]   [Terapkan] [Reset]            │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│ 1.284 baris cocok · Export [CSV] [Excel]                         ‹ Sebelumnya  Berikutnya ›│
├───────────────────────────────────────────────────────────────────────────────────────┤
│ Waktu (WITA)      User (peran)          Aksi           Dokumen              Field / Perubahan│
│ 24/09 10:02:11   Owner Uji (owner)     approve        228/PB-DRMS/20/IX/2026  status: Menunggu Approval → Disetujui│
│ 24/09 09:58:40   Finance Uji (finance) void           KK/2609/0003         alasan: salah akun │
│ 24/09 09:40:02   PM Uji (pm)           acknowledge    228/PB-DRMS/20/IX/2026  —              │
│ ▸ klik baris: detail (semua kolom: IP, perangkat, sumber, versi, request id, JSON lama/baru read-only)│
│ → klik nomor dokumen: dokumen tersebut, tab "Riwayat"                                    │
└───────────────────────────────────────────────────────────────────────────────────────┘
```
- **Paging keyset** (`server_time`, `id`) dengan 100 baris per halaman. Tidak ada `count(*)` tanpa filter tanggal (default 7 hari terakhir supaya cepat).
- **Nilai lama/baru** ditampilkan sebagai teks yang di-escape React (bukan editor JSON; keputusan F1 "no json editors").
- **Kosong:** "Tidak ada aktivitas untuk filter ini."
- **Lebar HP:** satu kartu per baris (Waktu · Aksi · Dokumen, lalu User dan perubahan di baris kedua). Filter dilipat.
- **Keamanan:** hanya baca. Export audit log dibatasi rentang ≤ 31 hari per file dan dicatat sebagai `export`.

---

## 7. Yang sengaja tidak dibuat di F3
- Grafik interaktif dengan JS (zoom, drag): tidak perlu untuk skala data ini, dan CSP skrip ketat.
- Dashboard yang bisa diatur sendiri per user (widget drag-drop Payload `admin.dashboard` masih experimental).
- Data mart/refresh terjadwal: angka dihitung langsung (C8). Data mart ditinjau ulang saat F6 load test bila lambat.
- Absensi, progress, laporan progress, dan addendum RAB (F5): hanya ditampilkan sebagai placeholder berlabel.
