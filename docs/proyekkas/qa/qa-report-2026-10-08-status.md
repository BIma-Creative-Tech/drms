# Status perbaikan — Laporan QA 2026-10-08 (staging, uji 6–7 Okt 2026)

Status per tiket dari laporan QA developer (31 temuan). Tiap bagian diisi oleh branch yang mengerjakannya; tiket
lain ada di bagian branch masing-masing.

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
