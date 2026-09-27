# ProyekKas F3: definisi KPI dashboard & laporan

- **Status:** accepted (user 2026-09-24, semua default Q-F3-1…8). **Implemented** di `feat/nextjs-f3-dashboards`
  (`apps/web/src/domain/reports/kpi.ts`, uji rekonsiliasi `apps/web/tests/integration/f3-kpi-reconciliation.int.test.ts`).
- **Tanggal:** 2026-09-24 · **Penulis:** Analyst · **Basis kode:** `develop` `e9c07ab` (F2 selesai)
- **Sumber yang dibaca di sesi ini:** `phase-plan.md` §F3, `requirements-v1.1.md` (US-12, US-13, US-19, US-25,
  US-26, US-27, US-28, US-31, US-52, M02, M13, §4, §8), `traceability-matrix.md`, `architecture.md` §4.1, §7, §9.4, §11,
  `apps/web/src/collections/**`, `apps/web/src/domain/**` (`cash/ledger.ts`, `expense/{types,queues,common,rules,transfers,lpj}.ts`),
  `apps/web/src/access/scope.ts`, `apps/web/src/globals/CompanySettings.ts`, dan migrasi `apps/web/src/migrations/*.ts`
  (nama tabel/kolom SQL di bawah diambil dari migrasi itu).
- Istilah UI memakai Bahasa Indonesia. Catatan teknis ditulis dalam bahasa Inggris.
- Pasangan dokumen: `wireframes.md` (tata letak) dan `export-library-decision.md` (export).

---

## 0. Konvensi (berlaku untuk semua KPI)

| # | Konvensi | Detail teknis |
|---|---|---|
| C1 | **Rupiah = bilangan bulat.** Semua nominal dijumlahkan sebagai `numeric` di SQL, lalu ditampilkan `Rp 1.447.500` tanpa desimal. | Columns are `numeric` (architecture §4.1). Sum in SQL (`sum(x)::text`) then `Number()`. Every value is ≤ `Number.MAX_SAFE_INTEGER`. Never sum floats in JS across pages. |
| C2 | **Zona waktu `Asia/Makassar` (WITA).** "Hari ini", "bulan ini" dan pengelompokan bulan selalu memakai WITA. | Business dates (`entry_date`, `transfer_date`, `request_date`, `needed_date`, `receipt_date`) are text `YYYY-MM-DD` already in company TZ → compare lexically; month = `left(x, 7)`. Timestamps (`submitted_at`, `decided_at`, `verified_at`, `server_time`) are `timestamptz` → bucket with `(ts AT TIME ZONE 'Asia/Makassar')::date`. "Today" = the existing `today(req)` helper (company TZ). |
| C3 | **Periode.** Filter periode = rentang tanggal inklusif `dari..sampai` (default: bulan berjalan). Grafik bulanan = bulan kalender. | `cash_entries.period` (`YYYY-MM`, set by the DB trigger) is the month key for ledger KPIs. |
| C4 | **Void tidak menghapus.** Transaksi kas yang di-void tetap ada; jurnal baliknya (`source_type='reversal'`) menetralkan. Saldo dihitung dari **semua** baris. | Same rule as `balances()` in `domain/cash/ledger.ts`. A void pair = original (`status='void'`) + its reversal row (`reversal_of_id = original.id`). The reversal may be dated in a LATER month when the original month is closed. |
| C5 | **Cakupan (scope).** *own* = pemohon/pembuat; *team* = project/pusat biaya yang dipegang PM; *all* = semua. | Resolved by `resolveScope()` (`access/scope.ts`): team = `projects.pm_id = user` ∪ active `team_assignments.role_in_project='pm'`; cost centers: `cost_centers.manager_id = user` ∪ pm-assignments. Dashboard reads use Local API with `overrideAccess:false` or raw SQL filtered by the same id lists. **An empty scope returns an empty result, never "all".** |
| C6 | **Status pengajuan.** Nama status mengikuti `STATUS_LABELS` (`domain/expense/types.ts`). | Enum `enum_expense_requests_status`: `draft, pending_ack, pending_approval, approved, receipt_revision, receipts_verified, transferred, receipts_complete, lpj_submitted, lpj_revision, lpj_verified, completed, rejected, cancelled`. |
| C7 | **Draft tidak dihitung** di KPI kantor (hanya muncul di "Pengajuan saya"). Ditolak/Dibatalkan hanya dihitung di laporan per status. | |
| C8 | **Real-time saat halaman dibuka.** Tidak ada cache atau data mart di F3; angka dihitung saat request. | Volume (Q-34 default: 100 pengajuan/bulan, 300 nota/bulan) is small. Every dashboard query must use the existing indexes (`status`, `project_id`, `cost_center_id`, `request_id`, `entry_date`). |
| C9 | **Tautan angka.** Setiap angka di dashboard bisa diklik dan membuka daftar yang **menghasilkan angka itu** (filter yang sama), agar selalu bisa dicek. | See `wireframes.md` ("klik →"). |

### 0.1 Tiga dasar "anggaran terpakai" (penting)

Satu pengajuan melewati tiga tahap uang. Dashboard menampilkan ketiganya dengan nama berbeda supaya tidak tertukar
(requirements §1.2 #11: "tampilkan dana dicairkan dan realisasi terverifikasi"):

| Nama UI | Arti | Kapan masuk | Definisi teknis |
|---|---|---|---|
| **Komitmen** | Sudah disetujui, uang mungkin belum keluar | Saat status menjadi `approved` | `grand_total` of requests with status ∈ `BUDGET_COMMITTED` (`types.ts`): `approved, receipt_revision, receipts_verified, transferred, receipts_complete, lpj_submitted, lpj_revision, lpj_verified, completed`. **Same basis as the approval screen's "% sebelum → sesudah"** (`projectCommitted()` + `budgetImpact()`). |
| **Dicairkan** | Uang sudah keluar dari kas perusahaan | Saat transfer dicatat | Σ `transfers.amount` with `status='posted'` (kinds `advance`, `reimburse`, `lpj_shortfall`) − Σ LPJ refunds (`cash_entries.source_type='settlement_refund'`). |
| **Realisasi terverifikasi** | Biaya yang sudah dicek Finance dengan nota | Uang Muka: saat LPJ diverifikasi. Reimburse: saat nota diverifikasi | Uang Muka with status ∈ {`lpj_verified`, `completed`}: `verified_receipts_total`. Reimburse with status ∈ {`receipts_verified`, `transferred`, `completed`}: `approved_amount`. |

Usulan: **warna anggaran (85%/100%) memakai Komitmen**, sama dengan layar approval. Dicairkan dan Realisasi tampil sebagai angka
pendamping. Keputusan: pertanyaan **Q-F3-2**.

---

## 1. Matriks peran × KPI

Scope per requirements §4. PM tidak melihat saldo akun kas ("Kas & bank: R ringkas *team*" = hanya ringkasan pengajuan tim).
Admin tidak punya akses kas/laporan (§4), kecuali Audit Log.

| KPI | Staff | PM | Finance | Owner | Admin |
|---|---|---|---|---|---|
| K-01 Saldo kas per akun | – | – | all | all | – |
| K-02 Kas masuk/keluar per bulan | – | – | all | all | – |
| K-03 Dicairkan / K-04 Pengembalian / K-05 Dicairkan bersih | own (per pengajuan) | team | all | all | – |
| K-06 Realisasi terverifikasi | own | team | all | all | – |
| K-07 Komitmen, K-08 % anggaran terpakai | – | team | all | all | – |
| K-09 Progress vs anggaran (**F5**) | – | team | all | all | – |
| K-10 Menunggu persetujuan | own (status) | team + "menunggu saya" | all | all + "menunggu saya" | – |
| K-11 Antrian transfer | – | – | all | all | – |
| K-12 Kelengkapan nota/LPJ | own | team | all | all | – |
| K-13 Pengajuan per status/jenis/kategori/periode | own | team | all | all | – |
| K-14 Biaya per kendaraan | – | team (kendaraan di pengajuan tim) | all | all | – |
| K-15 Biaya pusat biaya bulan berjalan | – | team | all | all | – |
| K-16 Audit log (filter) | – (tab Riwayat saja) | – (tab Riwayat saja) | lihat Q-F3-4 | all | all |
| K-17 Pengeluaran per kategori | – | team | all | all | – |

---

## 2. Definisi

Setiap KPI punya **aturan rekonsiliasi SQL** untuk QA. Pengujian dijalankan pada data seed dan data yang dibangkitkan
(phase-plan F3 gate). SQL di bawah dipakai sebagai **acuan uji** (dijalankan read-only sebagai `pk_drms_stg_app` atau role baca).
Ini bukan query produksi, dan nama tabel/kolom sudah dicek terhadap migrasi.

### K-01 Saldo kas per akun ("Saldo Kas")
- **Definisi:** per `cash_accounts` (aktif dan nonaktif): `opening_balance` + Σ masuk − Σ keluar atas **semua** baris
  `cash_entries` (posted, void, dan jurnal balik) dengan `entry_date ≤ per_tanggal`. Total = Σ semua akun.
- **Periode:** posisi per tanggal (default hari ini WITA). Kartu dashboard juga menampilkan perubahan bulan berjalan (K-02).
- **Tampilan:** akun nonaktif dengan saldo 0 disembunyikan. Akun nonaktif dengan saldo ≠ 0 tetap tampil dengan label "nonaktif".
- **Rekonsiliasi:** harus sama persis dengan `GET /api/v1/cash-accounts/balances?asOf=` (sudah ada, F2) dan dengan:
  ```sql
  SELECT a.id, coalesce(a.opening_balance,0)
       + coalesce(sum(e.amount) FILTER (WHERE e.direction='in'),0)
       - coalesce(sum(e.amount) FILTER (WHERE e.direction='out'),0) AS balance
  FROM cash_accounts a LEFT JOIN cash_entries e ON e.cash_account_id=a.id AND e.entry_date <= :as_of
  GROUP BY a.id;
  ```
  Invarian tambahan: setiap pasangan void bernilai nol:
  `SELECT count(*) FROM cash_entries o JOIN cash_entries r ON r.reversal_of_id=o.id WHERE o.amount<>r.amount OR o.direction=r.direction OR o.cash_account_id<>r.cash_account_id` → 0.

### K-02 Kas masuk vs keluar per bulan ("Arus Kas Bulanan", US-28)
- **K-02a Arus kas buku** (laporan Rekap Kas, default Finance): per bulan `period`: Masuk = Σ `amount` `direction='in'`,
  Keluar = Σ `amount` `direction='out'`, **semua baris** (termasuk yang di-void dan jurnal balik). Jurnal balik juga tampil di
  kolom tersendiri "Koreksi (void)" supaya terbaca.
- **K-02b Arus kas operasional** (grafik Owner, default): sama dengan K-02a tetapi **tanpa pasangan void**:
  `status='posted' AND source_type <> 'reversal'`. Tombol "Tampilkan koreksi void" berpindah ke K-02a.
- **Filter:** rentang bulan (default 12 bulan terakhir s/d bulan berjalan, maks. 36), akun kas, project/pusat biaya.
  Rincian masuk per `cash_in_source`, keluar per `source_type` (transfer pengajuan / manual).
- **Rekonsiliasi (K-02a):** untuk setiap bulan P: `saldo(akhir P) − saldo(akhir P−1) = Masuk_P − Keluar_P`, per akun dan total (K-01).
  ```sql
  SELECT period, sum(amount) FILTER (WHERE direction='in') AS masuk, sum(amount) FILTER (WHERE direction='out') AS keluar
  FROM cash_entries WHERE period BETWEEN :p1 AND :p2 [AND cash_account_id=:acc] GROUP BY period ORDER BY period;
  ```
  K-02b: sama, ditambah `AND status='posted' AND source_type<>'reversal'`. Selisih K-02a − K-02b per bulan = Σ baris void +
  jurnal balik di bulan itu (QA mencocokkan dengan daftar void).
- **Catatan:** untuk bulan yang sudah ditutup buku, K-02a tidak berubah lagi. K-02b bulan lama **bisa** berubah bila transaksi
  bulan itu di-void kemudian (jurnal baliknya bertanggal bulan berjalan, ADR 0005 §4). Karena itu laporan resmi memakai K-02a.

### K-03 Dana dicairkan · K-04 Pengembalian LPJ · K-05 Dicairkan bersih
- **K-03 (bruto):** Σ `transfers.amount` dengan `status='posted'`. Periode = `transfer_date`. Dimensi = pengajuan → project
  **atau** pusat biaya (`expense_requests.project_id` / `cost_center_id`), jenis (`kind`).
- **K-04:** Σ `cash_entries.amount` dengan `source_type='settlement_refund' AND status='posted'` (tidak bisa di-void terpisah, `voidEntry`).
- **K-05:** K-03 − K-04.
- **Rekonsiliasi:** per pengajuan r:
  `Σ transfers(r, posted) = Σ cash_entries(expense_request_id=r, source_type='transfer', status='posted')` (satu KK per transfer).
  Juga: `K-05(r) = Σ out − Σ in` atas **semua** `cash_entries` dengan `expense_request_id=r` (pasangan void saling menetralkan).
  ```sql
  SELECT er.id, (SELECT coalesce(sum(amount),0) FROM transfers t WHERE t.request_id=er.id AND t.status='posted') AS k03,
         (SELECT coalesce(sum(CASE direction WHEN 'out' THEN amount ELSE -amount END),0) FROM cash_entries c WHERE c.expense_request_id=er.id) AS ledger_net,
         (SELECT coalesce(sum(amount),0) FROM cash_entries c WHERE c.expense_request_id=er.id AND c.source_type='settlement_refund' AND c.status='posted') AS k04
  FROM expense_requests er;   -- expect k03 - k04 = ledger_net for every row
  ```
  Juga `expense_requests.transferred_total = Σ transfers(r, posted)` termasuk `lpj_shortfall` (`settle()` di `lpj.ts` menambahkan
  kekurangan ke `transferredTotal`; void transfer menguranginya).

### K-06 Realisasi terverifikasi
- **Per pengajuan:** lihat §0.1. Pengajuan lain = 0 (belum terverifikasi).
- **Per kategori** (US-25: "kategori dihitung dari baris item"):
  - Uang Muka: Σ `receipts.amount` (`status='valid'`) digabung ke baris lewat `receipts.line_id = expense_requests_lines.id`, dikelompokkan per `category_id` baris.
  - Reimburse: Σ `expense_requests_lines.total` per `category_id` (karena yang dibayar = `approved_amount` = Σ total baris).
- **Periode:** Uang Muka = `settlements.verified_at` (WITA). Reimburse = `max(receipts.verified_at)` dari nota valid pengajuan itu (WITA).
- **Rekonsiliasi:** (1) Σ per kategori = total per pengajuan. (2) Untuk pengajuan `completed`: realisasi = K-05 dari ledger (`ledger_net` di atas).
  Untuk Uang Muka: `transferred − refund + shortfall = verified_receipts_total`. (3) `settlements.verified_receipts_total = expense_requests.verified_receipts_total`.

### K-07 Komitmen · K-08 % anggaran terpakai (US-12, US-26, US-27)
- **K-07:** Σ `grand_total` pengajuan dengan status ∈ `BUDGET_COMMITTED`, per project.
- **K-08:** `round(K-07 / projects.budget × 100, 2)`. Sama dengan `budgetImpact()` (`rules.ts`). Dashboard juga menampilkan
  % Dicairkan (K-05 / RAB) dan % Realisasi (K-06 / RAB).
- **Warna** (setting `company-settings`: `budgetWarnPct` default 85, `budgetOverPct` default 100):
  🟢 **Aman** ≤ 85% · 🟡 **Waspada** > 85% s/d ≤ 100% · 🔴 **Lewat RAB** > 100% · ⚪ **Tanpa RAB** (RAB kosong/0).
  Ambang memakai ">" seperti layar approval (`overWarn = after > warnPct`). Warna selalu disertai label teks.
- **Per kategori (opsional):** bila project punya `budget-lines`, tampil tabel per kategori: RAB kategori vs komitmen dari
  `expense_requests_lines.total` pengajuan berkomitmen dengan kategori itu. Kategori tanpa baris RAB tampil sebagai "di luar RAB kategori".
- **Pusat biaya:** tidak punya anggaran (Q-24 default). Yang tampil adalah K-15, bukan persentase.
- **Rekonsiliasi:** `SELECT project_id, sum(grand_total) FROM expense_requests WHERE status::text IN (<BUDGET_COMMITTED>) GROUP BY project_id`
  harus sama dengan K-07. Nilai `approvals.budget_pct_after` pada keputusan terakhir = K-08 saat itu (cek sampel, tidak wajib sama sekarang).

### K-09 Progress fisik vs anggaran (US-12): **placeholder, data F5**
- **Definisi (disiapkan):** `selisih = K-08 (%) − progress fisik (%)`. Progress = Σ(bobot tahapan × % tahapan) dari `project-stages`
  (hanya berubah lewat laporan progress, F5).
- **Warna** (setting `progressWarnGapPct` default 0, `progressBadGapPct` default 8): 🟢 selisih ≤ 0 · 🟡 ≤ 8 · 🔴 > 8 (US-12).
- **F3:** widget tampil dengan tulisan "Progress fisik tersedia setelah modul laporan progress (F5)". Tidak ada angka palsu.

### K-10 Pengajuan menunggu persetujuan
- **Definisi:** jumlah dan Σ `grand_total` pengajuan dengan status `pending_ack` (Menunggu Diketahui) + `pending_approval`
  (Menunggu Approval), dalam scope peran.
- **"Menunggu saya":** jumlah item di `approvalInbox(req)` (sudah ada di F2; memakai G1/G2 dan delegasi "Diketahui" Q-07/Q-08).
  Angka ini yang tampil sebagai badge nav "Persetujuan".
- **Umur:** item tertua = `now − submitted_at` (hari, WITA).
- **Rekonsiliasi:** `SELECT status, count(*), sum(grand_total) FROM expense_requests WHERE status IN ('pending_ack','pending_approval') GROUP BY status`.
  Untuk "menunggu saya", jumlahnya harus sama dengan `GET /api/v1/approvals/inbox` user tersebut.

### K-11 Antrian transfer (US-19)
- **Definisi:** jumlah dan Σ `approved_amount` untuk (`type='advance' AND status='approved'`) ∪ (`type='reimburse' AND status='receipts_verified'`).
  Sama dengan `transferQueue()`/`transferQueueCount()`.
- **Pendamping:** "Nota reimburse menunggu verifikasi" = `type='reimburse' AND status='approved'`. "Lewat tanggal dibutuhkan" = item dengan `needed_date < hari ini`.
- **Rekonsiliasi:** jumlah = `GET /api/v1/transfer-queue` (panjang `items`), Σ = Σ `approvedAmount` item.

### K-12 Kelengkapan nota / LPJ (US-27 "kelengkapan nota/LPJ")
| ID | Nama UI | Definisi |
|---|---|---|
| K-12a | Uang muka belum LPJ | `type='advance'` dan status ∈ {`transferred`, `receipts_complete`, `lpj_revision`}. Nilai = Σ `transferred_total`. Umur = hari sejak `min(transfer_date)` transfer `posted` (`kind='advance'`). |
| K-12b | **LPJ terlambat** | K-12a dengan umur > `lpjDueDays`. **Setting baru** (usulan default 7 hari) → Q-F3-1. |
| K-12c | LPJ menunggu verifikasi | status `lpj_submitted` (sama dengan badge "Verifikasi LPJ"). |
| K-12d | LPJ menunggu penyelesaian selisih | status `lpj_verified` (settlement refund/shortfall belum dicatat). |
| K-12e | Nota reimburse menunggu verifikasi | `type='reimburse' AND status='approved'`. |
| K-12f | Flag peringatan terbuka | `receipt_flags` dengan `status='open' AND level='warning'`, pengajuan tidak `cancelled`/`rejected`. |
| K-12g | Rasio kelengkapan LPJ | Uang Muka yang ditransfer dalam periode: jumlah dengan status ∈ {`lpj_submitted`, `lpj_verified`, `completed`} / jumlah semua yang ditransfer. Tampil "x dari y". |
- **Rekonsiliasi:** hitung ulang dengan `SELECT status, count(*) FROM expense_requests WHERE type='advance' GROUP BY status` dan
  `SELECT request_id, min(transfer_date) FROM transfers WHERE status='posted' AND kind='advance' GROUP BY request_id`.

### K-13 Pengajuan per status / jenis / kategori / periode (laporan "Rekap Pengajuan")
- **Baris dasar:** pengajuan non-draft. Periode = `request_date` (tanggal pengajuan server, WITA). Filter: jenis, status (multi),
  project/pusat biaya, kategori, pemohon, rentang tanggal.
- **Kolom per pengajuan:** Nomor, Tanggal, Jenis, Judul, Project/Pusat biaya, Pemohon, Status, Grand total, Disetujui, Dicairkan (K-03),
  Realisasi (K-06), Flag terbuka.
- **Per kategori:** jumlah = banyak pengajuan **berbeda** yang punya ≥ 1 baris kategori itu (satu pengajuan bisa di beberapa
  kategori, jadi jumlah per kategori ≠ total pengajuan). Nominal = Σ `expense_requests_lines.total` kategori itu.
- **Rekonsiliasi:** Σ nominal per kategori = Σ `grand_total` pengajuan yang sama (`grand_total = Σ lines.total`, dijaga trigger DB).
  Jumlah per status = `SELECT status, count(*) … GROUP BY status`.

### K-14 Biaya per kendaraan (form butir 8, US-52, versi dasar)
- **Sumber (usulan US-52):**
  (a) baris pengajuan dengan `vehicle_id` terisi, pengajuan berstatus minimal **Ditransfer** (`transferred, receipts_complete, lpj_submitted, lpj_revision, lpj_verified, completed`), nilai = `lines.total`;
  (b) kas keluar manual dengan `vehicle_id`: `source_type='manual' AND direction='out' AND status='posted'`.
  KK dari transfer tidak membawa kendaraan (`recordTransfer`), jadi tidak ada hitung ganda.
- **Kolom:** Plat, Jenis, Dari pengajuan, Dari kas manual, Total, Rincian per kategori. Filter: periode (a: `transfer_date` pertama; b: `entry_date`), kendaraan, kategori.
- **Uji seed:** DA 1234 XY = **Rp 600.000** bila baris BBM ditautkan (US-52).
- **F5:** laporan kendaraan lengkap (mis. realisasi nota per kendaraan) masuk F5 (phase plan F5 "vehicle cost report").
- **Rekonsiliasi:** Σ (a) = `SELECT sum(l.total) FROM expense_requests_lines l JOIN expense_requests er ON er.id=l._parent_id WHERE l.vehicle_id=:v AND er.status::text IN (…)`.

### K-15 Biaya pusat biaya bulan berjalan (Q-24 default)
- **Definisi:** per pusat biaya, bulan berjalan: K-05 (pengajuan pusat biaya itu) + kas keluar manual `cost_center_id` itu
  (`status='posted'`, bukan reversal) − kas masuk manual `cost_center_id` itu.
- **Rekonsiliasi:** = Σ out − Σ in atas `cash_entries` dengan `cost_center_id=:cc AND period=:bulan AND status='posted' AND source_type<>'reversal'`
  (KK transfer membawa `cost_center_id` pengajuan).

### K-16 Audit log (halaman global, §8 "Tampilan log")
- **Bukan metrik.** Jumlah baris `audit_logs` yang cocok dengan filter: rentang waktu (`server_time` dalam WITA), user (`user_id`),
  jenis dokumen (`doc_type`), aksi (`action`, enum `AUDIT_ACTIONS`), nomor dokumen (`doc_no`, awalan), sumber (`source`).
- **Urutan:** `server_time` terbaru di atas. Paging keyset (`server_time, id`), maks. 100 baris per halaman.
- **Rekonsiliasi:** `SELECT count(*) FROM audit_logs WHERE <filter yang sama>` = jumlah yang tampil. Tidak ada baris yang bisa diubah/hapus (ADR 0006).
  **Membuka halaman atau export audit log ditulis sebagai baris audit `export`** (baris baru, bukan perubahan).

### K-17 Pengeluaran per kategori (US-25 "rekap per kategori")
- **Dicairkan per kategori:** untuk pengajuan yang punya transfer `posted` (kind `advance`/`reimburse`): Σ `lines.total` per kategori
  (alokasi dari baris, karena KK transfer hanya punya kategori bila semua baris satu kategori). Ditambah kas keluar manual per
  `category_id` (`status='posted'`, bukan reversal).
- **Realisasi per kategori:** K-06 per kategori + kas keluar manual (sama).
- **Rekonsiliasi:** Σ dicairkan per kategori = Σ KK (`source_type='transfer'`, `status='posted'`, transfer `kind<>'lpj_shortfall'`) + Σ KK manual posted.
  Selisih shortfall/refund LPJ muncul di realisasi, bukan di dicairkan (dijelaskan di catatan kaki laporan).

---

## 3. Kasus uji rekonsiliasi (untuk QA, gate F3)

1. **Seed form 228** (Reimburse Rp 1.447.500, pusat biaya "Ops Palangka Banjar"): setelah transfer, K-03 = K-05 = 1.447.500,
   K-15 bulan transfer bertambah 1.447.500, K-14 DA 1234 XY = 600.000 (bila baris BBM ditautkan), K-13 per kategori menjumlah ke 1.447.500.
2. **Uang Muka "Proyek Uji" (UJI-PRJ, RAB Rp 50.000.000)** dengan transfer 10.000.000, LPJ valid 9.200.000 → refund 800.000:
   K-03 10.000.000, K-04 800.000, K-05 9.200.000 = K-06, K-08 = 20,00% (komitmen = `grand_total` 10.000.000).
3. **Void transfer** lalu transfer ulang: K-03 hanya menghitung transfer posted. K-01 tidak berubah oleh pasangan void. K-02a menampilkan koreksi, K-02b tidak.
4. **Void lintas bulan tertutup:** transaksi Agustus (tutup buku) di-void September → K-02a Agustus tetap, K-02a September berisi jurnal balik.
5. **Scope PM:** PM A tidak melihat angka project PM B di satu pun KPI atau export (uji negatif per endpoint, lanjutan §7.4 architecture).
6. **Data bangkitan:** ≥ 500 pengajuan acak semua status, lalu jalankan semua SQL §2 dan bandingkan dengan response endpoint dashboard/laporan (selisih harus 0).

---

## 4. Pertanyaan F3: dijawab (user 2026-09-24, semua default)

User menyetujui desain ini pada 2026-09-24 dengan **semua usulan default**. Tabel ini sekarang menjadi keputusan.

| No | Pertanyaan | Keputusan (user 2026-09-24) | Implementasi |
|---|---|---|---|
| Q-F3-1 | Kapan Uang Muka dianggap **"LPJ terlambat"**? | **7 hari kalender** setelah transfer uang muka pertama; setting baru `lpjDueDays` (default 7, bisa diubah Admin/Owner) | `company-settings.lpjDueDays`, migrasi `20260924_110138_f3_reports` (aditif) |
| Q-F3-2 | Dasar warna anggaran (85%/100%)? | **Komitmen** (sama dengan layar approval); Dicairkan dan Realisasi sebagai angka pendamping; warna selalu dengan label teks | `budgetTone()` di `domain/reports/rules.ts` |
| Q-F3-3 | Library Excel? | **`write-excel-file` 4.1.1 (MIT)**, maks. **10.000 baris** per XLSX, switch `EXPORT_XLSX_ENABLED`; CSV selalu ada (stream, UTF-8 BOM, `;`); batas bersamaan dibagi dengan PDF (2) | `lib/xlsx.ts`, `lib/csv.ts`, `lib/heavy-gate.ts` |
| Q-F3-4 | Finance boleh membuka **Audit Log global**? | **Ya**, hanya baca (Owner/Admin juga) | `/admin/audit-log`, `/api/v1/reports/audit-log` |
| Q-F3-5 | Laporan dengan **PDF**? | **Rekap Kas, Pengeluaran per Kategori, Anggaran Project** (≤ 500 baris); lainnya Excel/CSV | `@react-pdf/renderer` 4.9.0 yang sudah ada (`pdf/ReportPdf.tsx`) |
| Q-F3-6 | **Beranda Staff** di web? | **Ya**, versi kecil ("Perlu tindakan saya" + pengajuan saya) | Beranda layout Staff, `/api/v1/dashboard/me` |
| Q-F3-7 | Grafik arus kas Owner? | **K-02b** (tanpa pasangan void) di grafik; laporan Rekap Kas resmi tetap **K-02a** (persis buku kas) | `cashFlowMonthly(…, 'operational' \| 'book')` |
| Q-F3-8 | Dasar biaya per kendaraan? | **Total baris pengajuan yang sudah ditransfer + kas keluar manual**; versi nota terverifikasi di F5 | `vehicleCosts()` |

Widget kehadiran dan progress tetap placeholder berlabel **"F5"** (tanpa angka palsu).

### 4.1 Catatan implementasi (dicek terhadap kode, 2026-09-24)
- **K-13 periode:** filter `request_date` (tanggal pengajuan). Pengajuan yang dibatalkan saat masih Draft tidak punya
  `request_date`, sehingga tidak masuk rentang tanggal mana pun (sama dengan Draft, C7).
- **K-17 dicairkan:** pengajuan dihitung pada rentang yang memuat transfer `posted` (kind `advance`/`reimburse`) miliknya;
  alokasi per kategori dari baris. Transfer yang di-void tidak dihitung (KK-nya juga `void`).
- **Filter PM** di laporan diiriskan dengan scope tim: project/pusat biaya di luar tim menghasilkan laporan kosong (bukan 403),
  export ikut kosong.
- **Audit log:** membuka halaman `/admin/audit-log` dan setiap export ditulis sebagai baris `export` (baris baru).
