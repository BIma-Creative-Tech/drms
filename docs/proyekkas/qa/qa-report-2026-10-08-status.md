# Status perbaikan — Laporan QA 2026-10-08 (staging, uji 6–7 Okt 2026)

Status per tiket dari laporan QA developer (`LAPORAN-QA-DEVELOPER.md`, 31 temuan). Rilis **0.6.2** (web) + APK
**0.3.4** menggabungkan tiga branch perbaikan: keuangan (`fix/qa-finance-integrity`), alur & nota
(`fix/qa-workflow-receipts`), hak akses & UX (`fix/qa-rbac-ux`). Rincian per tiket ada di bagian masing-masing.

## Ringkasan 31 tiket

| Tiket | Judul (singkat) | Status | Bagian |
|---|---|---|---|
| QA-01 | Staging down 2× saat uji berurutan | Bukan cacat aplikasi — IP penguji diblokir CrowdSec karena pola uji (infra-lead 2026-10-08) | Infrastruktur |
| QA-02 | Semua HTTP PUT diblokir (403) | Selesai — perubahan WAF (CrowdSec AppSec mengizinkan PUT ke `/api/`; infra `main` 1c2c57c) | Infrastruktur |
| QA-03 | "1.000,50" tersimpan Rp 100.050 | Selesai | Keuangan |
| QA-04 | Kas keluar tanpa cek saldo | Selesai (peringatan + konfirmasi) | Keuangan |
| QA-05 | Tanggal sebelum go-live → 500 | Selesai | Keuangan |
| QA-06 | Kekurangan LPJ melebihi disetujui | Selesai (toleransi + persetujuan ulang, ADR 0019) | Keuangan |
| QA-07 | Nota bertanggal masa depan | Selesai | Alur & nota |
| QA-08 | Nota ganda di pengajuan yang sama | Selesai | Alur & nota |
| QA-09 | Ringkasan/flag LPJ tidak dihitung ulang | Selesai | Alur & nota |
| QA-10 | Race "Tambah Baris" | Keterbatasan upstream (Payload 3.90.1), didokumentasikan | Alur & nota |
| QA-11 | Sumber kas "Pengembalian LPJ" belum ada | Selesai | Alur & nota |
| QA-12 | "-5000" menjadi kas masuk | Selesai | Keuangan |
| QA-13 | Total baris bukan Jumlah × Harga | Sesuai desain — keputusan Q-05 (2026-09-23): total baris = nilai utama yang diinput (boleh dibulatkan dari nota), harga satuan informatif; total > 0 sudah wajib saat kirim (`domain/expense/lines.ts`) | — |
| QA-14 | Saldo awal sebelum go-live di Rekap Kas | Selesai | Keuangan |
| QA-15 | Staff memilih karyawan lain | Selesai (Staff hanya diri sendiri) | Alur & nota |
| QA-16 | Dropdown PM semua user, hanya email | Selesai | Hak akses & UX |
| QA-17 | Transfer ke rekening belum diverifikasi | Selesai (peringatan + konfirmasi) | Keuangan |
| QA-18 | PM tanpa notifikasi | Selesai | Alur & nota |
| QA-19 | "Konfirmasi selesai" Reimburse untuk Finance | Selesai | Alur & nota |
| QA-20 | Hak akses per peran | Selesai (a–d) | Hak akses & UX |
| QA-21 | Pesan teknis | Selesai | Hak akses & UX |
| QA-22 | Alasan terlalu pendek diabaikan | Selesai | Hak akses & UX |
| QA-23 | confirm()/prompt() bawaan browser | Selesai (termasuk keputusan kekurangan LPJ di Persetujuan) | Hak akses & UX |
| QA-24 | "Tidak sah…" walau sudah login | Selesai | Hak akses & UX |
| QA-25 | Hydration #418 | Selesai (dari analisis; belum diuji di browser) | Hak akses & UX |
| QA-26 | Field baris baru muncul ±3 detik | Keterbatasan upstream (sama dengan QA-10), didokumentasikan | Alur & nota |
| QA-27 | Hapus nota yang sudah valid | Selesai (nota valid terkunci) | Alur & nota |
| QA-28 | Staff 403 di /api/cost-centers | Selesai | Hak akses & UX |
| QA-29 | Isu tampilan minor | Sebagian | Hak akses & UX |
| QA-30 | Tutup buku sebelum go-live | Selesai | Keuangan |
| QA-31 | Edit ≠ buat baru | Sebagian (sesuai ADR 0005) | Hak akses & UX |

<!-- section: keuangan (fix/qa-finance-integrity) -->
## Keuangan — branch `fix/qa-finance-integrity`

Ditulis dalam bahasa Inggris oleh branch-nya (istilah kode/API dipertahankan). Keputusan pemilik 2026-10-08: overdraft
dan rekening tujuan belum diverifikasi = peringatan + konfirmasi eksplisit (diaudit); kekurangan LPJ = toleransi, lalu
persetujuan ulang (ADR 0019).

| Tiket | Status | Perubahan | Bukti uji |
|---|---|---|---|
| QA-03 "1.000,50" saved as Rp 100.050 | fixed | One Rupiah parser (`lib/rupiah-input.ts`) + field (`admin/components/RupiahInput.tsx`) for Kas masuk/keluar, Addendum RAB and the receipt amount: "." = thousands, "," → "Rupiah tanpa desimal", other characters refused inline, submit blocked; server still rejects non-integers / ≤ 0. | unit `qa-finance.test.ts` (parser) |
| QA-12 "-5000" saved as cash-in 5.000 | fixed | Same parser: minus refused ("Gunakan jenis Kas keluar, bukan tanda minus" on the cash form). | unit `qa-finance.test.ts` |
| QA-05 Cash date before go-live → 500 | fixed | `pgCode()` unwraps drizzle `cause` (http.ts, sync service, memberships) → 409 not 500; `postEntry` / transfer / settle answer 400 "Tanggal sebelum tanggal saldo awal akun (dd/mm/yyyy)" on the date field before any number is allocated; cash form `min` = later of lock + 1 and the account opening date. Void reversals are dated ≥ the original. | unit `qa-finance.test.ts`; int `qa-finance.int.test.ts` (cash entry, transfer, wrapped guard → 409), `s3b-import` updated |
| QA-14 Opening balance before go-live | fixed | Opening balance counts from its date on: K-01 `cashBalances`, `balances()` (API), K-02 `cashFlowMonthly` (start balance + `saldoAwalAkun` in the go-live month; Rekap Kas column "Saldo awal akun baru"); dashboard "vs akhir <bulan>" follows. | int `qa-finance.int.test.ts` (K-01, K-02 reconciliation, balances API) |
| QA-30 Tutup buku offers months before go-live; gross summary | fixed | Books start = earliest opening date of the PT cash accounts (`booksStartDate`); list + closable months start there; `closePeriod` → 400 before it; summary Masuk/Keluar without void pairs (K-02b) + "Bersih" + "Koreksi (void)". | unit (closable/recent periods); int (400 + go-live month closable) |
| QA-04 Cash-out without balance check | fixed (owner decision: warning + confirmation) | Cash-out / transfer / shortfall transfer making the balance < 0 → 409 `CASH_OVERDRAFT_CONFIRM_REQUIRED` {balance, after} unless `confirmOverdraft: true`; confirmed → audit `overdraft_confirmed` (old/new balance); per-account advisory lock; app dialog "Tetap simpan" (cash form, transfer, settle). Reversals never asked. APK posts no cash entries/transfers — unaffected. | unit (prompt, problem extras); int (409, confirm + audit, cash-in, transfer, void) |
| QA-17 Transfer to unverified account | fixed (owner decision: warning + confirmation) | Antrian Transfer shows Terverifikasi / Belum diverifikasi; transfer (and LPJ shortfall transfer) to an unverified account → 409 `BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED` unless `confirmUnverifiedAccount: true`; confirmed → audit `bank_unverified_confirmed`; same app dialog. | int (queue state, 409, confirm + audit) |
| QA-06 Shortfall above approved without re-approval | fixed (owner decision: tolerance, then re-approval; ADR 0019) | `companies.shortfallTolerancePct` (default 10); above approved + tolerance → settle 409 `SHORTFALL_REAPPROVAL_REQUIRED`; Finance asks "persetujuan kekurangan" → request rule for the new total, Direktur → Finance, rows `approvals` doc_type `expense_shortfall`; web inbox section; DB guards (settlement graph, G1, tolerance trigger on transfers). Web only (APK unchanged, see ADR 0019 §APK). | unit (ceiling, rule, guards); int (409, request, inbox, guards, approve → settle, reject → ask again, DB triggers, migration) |

Migrasi: `20261008_090000_qa_finance_integrity`. Penggabungan rilis 0.6.2: `20261009_090000_qa_settlements_guard_merge`
memasang `pk_settlements_guard` yang memuat aturan QA-06 (status persetujuan kekurangan) **dan** QA-09 (total
sementara LPJ terbuka) — migrasi QA-09 (`20261008_120000`) berjalan sesudah migrasi ini dan menimpa fungsinya.
<!-- /section: keuangan -->

<!-- section: alur & nota (fix/qa-workflow-receipts) -->
## Alur & nota — branch `fix/qa-workflow-receipts`

| Tiket | Status | Perubahan | Bukti uji |
|---|---|---|---|
| QA-07 Nota bertanggal di masa depan | Selesai | `validateReceipt` menolak `receiptDate` > hari ini (zona waktu PT dokumen) → **400** "Tanggal nota tidak boleh di masa depan" (tambah, ubah, dan item sinkron APK → `rejected`). Form web: `max` = hari ini + cek sebelum unggah foto. APK: pemilih tanggal sudah dibatasi hari ini; pesan server ditampilkan. | `qa-flow.int` QA-07; `qa-flow.test` validateReceipt |
| QA-08 Nota ganda dalam pengajuan yang sama | Selesai | `duplicateHits`: dalam pengajuan yang sama → foto sama **atau** No. nota + toko sama (`o.id < r.id`: satu flag per pasangan, di nota yang belakangan, pesan "Nota ganda dalam pengajuan ini: sama dengan nota baris N"). Antar-pengajuan tetap nomor + toko + nominal / foto; aturan cakupan PT (ADR 0016 "Scope rule") tidak berubah. | `qa-flow.int` QA-08 (3 kasus); `qa-flow.test` computeFlags |
| QA-09 Ringkasan & flag selisih LPJ tidak dihitung ulang | Selesai | Setiap tambah/ubah/hapus/valid/tolak nota → `recomputeFlags` + total sementara LPJ terbuka (Σ nota menunggu + valid, selisih = ditransfer − total; diaudit). Migrasi `20261008_120000_qa_flow_lpj_totals`: `pk_settlements_guard` mengizinkan hanya `receipts_total` + `difference` yang konsisten (= Σ nota aktif) selama LPJ draft/diajukan/revisi. | `qa-flow.int` QA-09 (tolak → 700.000/50.000, valid lagi, hapus saat revisi, guard DB 23514/42501) |
| QA-10 / QA-26 Race "Tambah Baris" | Keterbatasan upstream (didokumentasikan) | Payload 3.90.1: baris baru mendapat field-nya dari respons form-state server; status permintaan form-state yang sedang berjalan tidak diekspos (`useQueue` lokal di `Form`, abort di Edit view), jadi tombol tidak dapat dinonaktifkan dengan bersih tanpa menambal internal Payload. Petunjuk "Tunggu sebentar…" tetap; panduan Staff menjelaskan cara memulihkan. APK tidak terdampak. | — |
| QA-11 Sumber kas "Pengembalian LPJ" (LPJ) | Selesai | `copyCompanyDefaults` + PT tanpa "Salin default" membuat sumber `LPJ` (sistem); migrasi `20261008_120100_qa_flow_lpj_source` mengisi PT lama (idempoten, diaudit). `GET /api/v1/expense-requests/{id}/settle/precheck` (Finance, baca saja): 409 bila sumber `LPJ` tidak ada / rekening kosong → form web memeriksa **sebelum** unggah bukti. Job `mediaOrphanCleanup` (03:10; migrasi `20261008_120200_qa_flow_orphan_job`): lampiran tak terpakai > 7 hari, dry run default, `MEDIA_ORPHAN_PURGE_ENABLED=true` → tombstone + hapus file + audit `retention_purge`. | `qa-flow.int` QA-11 (4 kasus); `qa-flow.test` config |
| QA-15 Staff memilih karyawan lain | Selesai (keputusan pemilik 2026-10-08) | Pengguna yang perannya di PT itu hanya Staff: "Diajukan Oleh" = karyawannya sendiri saja → **403** saat buat/ubah (API, form admin, sinkron APK) dan saat **ajukan** draft lama. PM boleh menambah rekan (Q-09), Admin/Finance mewakili (QA-MC4-09). Pemilih admin (`requesterOptions`) dan APK hanya menampilkan diri sendiri. | `qa-flow.int` QA-15 (3 kasus); `qa-flow.test` requesterOptions; Flutter `qa_flow_test` |
| QA-18 PM tanpa notifikasi | Selesai (keputusan pemilik 2026-10-08) | PM tim project (PM project + penugasan PM aktif) yang berperan PM di PT pengajuan (anggota aktif, PT aktif) menerima: `expense.team_submitted`, `expense.rejected`, `expense.transferred`, `expense.lpj_revision`, `expense.completed`. Pemohon/aktor tidak digandakan; pusat biaya tanpa PM. Email tidak berubah (hanya event keputusan). | `qa-flow.int` QA-18 (2 kasus, termasuk PM di PT lain); `qa-flow.test` eventsFor |
| QA-19 "Konfirmasi selesai" Reimburse untuk Finance | Selesai | Panel alur kerja menampilkan tombol untuk Finance bila `allowedActions` berisi `complete` (aturan server tidak berubah). | `qa-flow.int` QA-19; `qa-flow.test` allowedActions |
| QA-27 Hapus nota yang sudah valid | Selesai (keputusan pemilik 2026-10-08) | Nota `valid` terkunci: hapus/ubah oleh pemohon → **409** "Nota sudah divalidasi Finance". Web & APK menyembunyikan tombol hapus; APK menampilkan pesan 409 lalu memuat ulang. | `qa-flow.int` QA-27; Flutter `qa_flow_test` |

APK: **0.3.4** (`docs/release-notes/apk/0.3.4.md`) — QA-15 (pemilih + validasi), QA-27 (tombol hapus), QA-07 (sudah
dibatasi di 0.3.3; pesan server).
<!-- /section: alur & nota -->

<!-- section: hak akses & UX (fix/qa-rbac-ux) -->
## Hak akses & UX — branch `fix/qa-rbac-ux`

| Tiket | Status | Perubahan | Bukti uji |
|---|---|---|---|
| QA-20(a) Direktur mengedit user lain | Selesai (keputusan pemilik 2026-10-08) | Diverifikasi: `users` update = Admin PT (akun yang SELURUH keanggotaan aktifnya di PT tempat ia Admin) / Admin grup; Direktur hanya profil sendiri (tanda tangan). PATCH user lain → 403, izin dokumen `update = false` (form hanya baca). | `qa-rbac-ux.int` QA-20(a) (2 kasus) |
| QA-20(b) PM mengubah project / perubahan diabaikan diam-diam | Selesai (keputusan pemilik 2026-10-08) | PM **hanya baca** project. Update = Direktur PT project. `readOnlyFieldsGuard` (beforeOperation): PATCH yang MENGUBAH isian oleh pembaca lain (PM, Finance, Admin) → **403** "Anda tidak berhak mengubah: Nama project, Alamat. Hanya Direktur …" (`errors[].path` per isian); pemanggil yang tidak bisa membaca project → 403/404 biasa (tanpa nama isian). | `qa-rbac-ux.int` QA-20(b) (4 kasus); `qa-rbac-ux.test` changedFields |
| QA-20(c) Modul yang tidak bisa dipakai / penolakan tidak seragam | Selesai | Launcher & bar modul dihitung dari izin Payload: modul yang hanya berisi pintasan pribadi (profil, notifikasi — sudah di bar atas) disembunyikan (Staff: Pengguna & Akses, Sistem); **Master Data** / **Pengaturan** hanya bagi yang boleh membuat/mengubah salah satu isinya (PM: keduanya hilang; Finance: Pengaturan hilang). Satu halaman **"Anda tidak memiliki akses ke halaman ini."** + **← Kembali ke beranda** untuk semua view khusus (tanpa kode peran). `companies.update` tanpa PT Admin/Direktur → `false` (bukan `IN ()` kosong). | `admin-modules.test` (Staff/PM/Finance/registry); `qa-rbac-ux.test` no-access |
| QA-20(d) Admin tidak bisa membaca Addendum RAB & Laporan progress | Selesai (keputusan pemilik 2026-10-08) | `budget-addenda` + `progress-reports` read: Admin = semua baris PT-nya (hanya baca; tulis tetap lewat service). | `qa-rbac-ux.int` QA-20(d) |
| QA-24 "Tidak sah, Anda harus masuk…" walau sudah login | Selesai | `admin.components.views.unauthorized` = halaman tanpa akses yang sama. `/admin/collections/<slug>/create` tanpa izin buat (Payload 3.90.1 memakai view bawaan yang di-hardcode) → redirect ke `/admin/unauthorized` (`src/admin/denied-create.ts`). Teks 401 API tidak diubah. | `qa-rbac-ux.test` (view terdaftar, rute) |
| QA-16 Dropdown Project Manager semua user, hanya email | Selesai | `users.displayName` (virtual, `useAsTitle`) = "Nama · email"; select/pencarian pemilih dipetakan ke `name`/`email` (beforeOperation). `projects.pm` = PM aktif PT project; `cost-centers.manager` = anggota aktif PT; `approval-rules` user = Direktur/Finance aktif PT. Pemilih lain diperiksa: `company-memberships.user` sengaja tidak difilter (onboarding akun baru), sisanya hanya baca/sistem. | `qa-rbac-ux.int` QA-16 (2 kasus); `qa-rbac-ux.test` |
| QA-28 Staff 403 di /api/cost-centers | Selesai | `inIds` / `ownEmployee` → `NO_ROWS` (Where tanpa baris) bila cakupan kosong, bukan `false` → daftar kosong (200), bukan 403. Peran tanpa aturan tetap 403. Suite isolasi tetap hijau. | `qa-rbac-ux.int` QA-28 (2 kasus); `qa-rbac-ux.test` inIds |
| QA-21 Pesan teknis | Selesai | `problemText`/`payloadError`/matriks akses: path → label form (`lib/field-labels.ts`) atau dibuang; tanpa "HTTP 403". Pesan domain tanpa kode US-xx/ADR/G-x/Q-x (tanda tangan: tanpa `signatureMediaId`). Semua `ValidationError` lewat `validationError(req, …)` = `req.t` + label ("Isian berikut tidak valid: Alasan perubahan"). Kode duplikat per PT dicek sebelum insert → path `code`, "Kode … sudah dipakai di PT ini". | `qa-rbac-ux.int` QA-21 (2 kasus); `qa-rbac-ux.test` |
| QA-22 Alasan terlalu pendek diabaikan | Selesai | Dialog aplikasi: alasan < 3 karakter → "… wajib diisi (minimal 3 karakter)." dan dialog tetap terbuka; galat server tampil di dialog. | `qa-rbac-ux.test` |
| QA-23 confirm()/prompt() bawaan browser | Selesai | `ActionDialog` (gaya Void/Addendum, `<dialog>` modal tanpa `<form>` karena juga di dalam form dokumen Payload) dipakai `ActionButton` (Persetujuan, Verifikasi LPJ, review nota Reimburse) dan `RequesterActions` (kirim, tarik kembali, batalkan, ajukan ulang, nota, selesai, hapus nota). | `qa-rbac-ux.test` (tanpa window.prompt/confirm/alert) |
| QA-25 Hydration #418 di detail pengajuan | Selesai (dari analisis; belum diuji di browser) | Dua sumber teks yang berbeda server/klien: (1) tanggal-jam hanya-baca (`submittedAt` dst.) diformat zona server saat SSR dan zona browser saat hidrasi → kini teks tetap WITA ("8 Okt 2026 14:30 WITA") di form + daftar (`ServerTimeField`/`ServerTimeCell`); (2) Rupiah panel pemohon `toLocaleString('id-ID')` (bergantung ICU) → `formatRupiah`. Meta "Dibuat/Diubah" bawaan Payload tetap diformat di browser (di luar kendali kita). | `qa-rbac-ux.test` (format tidak bergantung TZ proses) |
| QA-29 Isu tampilan minor | Sebagian | Selesai: format tanggal `d MMM yyyy HH:mm`; boolean "Aktif/Nonaktif" / "Ya/Tidak"; field teknis media disembunyikan saat unggah (hanya baca di sidebar file tersimpan); kontrol panel pengajuan dibatasi lebar kolom di 390 px (CSS, belum diukur di browser). Tidak diubah: simpan hari libur (view Jadwal sudah menampilkan "Hari libur … ditambahkan."), widget audit Dashboard, nama PT "Sejahteraa" (data). | `qa-rbac-ux.test` |
| QA-31 Edit ≠ buat baru | Sebagian (sesuai ADR 0005) | Kas: tata letak sama; tanggal/akun/nominal tampil **terkunci**; **bukti bisa ditambah/diganti** (`CashEntryUpdate.proofId`, unggahan sendiri yang belum dipakai, diaudit). Karyawan: **No. HP** tampil di form buat untuk Admin/Direktur/Finance/PM. Addendum: tetap (edit hanya Draft, by design; APK 0.3.1 punya edit). | `qa-rbac-ux.int` QA-31 (2 kasus); `qa-rbac-ux.test` |
<!-- /section: hak akses & UX -->
