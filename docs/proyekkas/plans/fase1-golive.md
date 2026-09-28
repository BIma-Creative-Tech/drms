# ProyekKas / DRMS — Rencana Fase 1 (Go-Live Produksi)

- **Status:** APPROVED GATE 1 (user 2026-09-26 "lanjutkan" = rekomendasi G1-1..G1-6; G1-7 PIC klien MENUNGGU nama) — eksekusi S0 dimulai · **Tanggal:** 2026-09-25 · **Penyusun:** Analyst
- **Basis kode:** `develop` @ `8712964` · **Branch dokumen:** `docs/plan-fase1-golive`
- **Input:** audit gap `/opt/src/proyekkas-private/proyekkas-gap-audit-20260925.md` (privat, tidak dikutip data
  pribadinya), `requirements-v1.1.md`, `phase-plan.md`, `traceability-matrix.md`, `open-questions-client.md`,
  `f4/f4-gap-analysis.md`, ADR 0001–0012, platform infra ADR 0004 (T19) & plan 06, `CHANGELOG.md`.
- **ADR baru:** `adr/0013-approval-flow-direktur-finance.md` (status *proposed*).
- **Konvensi:** semua estimasi = **ESTIMASI** hari-agen (hari kerja fokus satu agen termasuk test), tanpa data
  velocity historis tim ini. "Fase 1" di dokumen ini = **rilis go-live produksi** (bukan fase F1 fondasi di
  `phase-plan.md`); isinya menutup sisa F4, seluruh F5, F6 dan infra prod.
- **Lokasi file:** `docs/proyekkas/plans/` (mengikuti konvensi repo: semua dokumen proyek di `docs/proyekkas/`).

---

## 1. Keputusan user 2026-09-25 (mengikat)

| # | Keputusan | Dampak di rencana | Pertanyaan klien yang terjawab |
|---|---|---|---|
| K1 | **Semua modul wajib di go-live**, termasuk F5: laporan progress harian T11 (APK + web, foto, hitung ulang progress dari bobot tahapan, offline), addendum RAB T12 + approval, absensi lengkap (rekap bulanan, tim hari ini, diabsenkan PM, koreksi T10, jadwal/libur/terlambat, geofence pusat biaya, retensi selfie, laporan absensi), pengingat terjadwal (laporan terlambat, nota/LPJ terlambat, anggaran lewat ambang), dashboard progress vs anggaran & kehadiran | Epik E4–E7 | Q-02, Q-39, Q-40 (fitur dibangun). Q-29 (keberadaan staff tanpa HP) tetap terbuka; fitur US-14 tetap dibangun. |
| K2 | **Finance butuh UI web** untuk kas masuk/keluar manual (US-23), void kas & void transfer dengan alasan (US-24), tutup/buka buku | Epik E2 | Q-01 |
| K3 | **Login APK prod "disamakan"** → ditafsirkan: sama dengan staging (form username+password di aplikasi, Direct Access Grant pada client `proyekkas-mobile`, ADR 0012) juga di realm `drms` prod | Epik E10 + revisi ADR 0012; **konfirmasi eksplisit di GATE 1 (G1-3)** | — (backlog F6 phase-plan) |
| K4 | **Alur approval baru:** "Diketahui" diisi level **Direktur** dan merupakan **approval**; **Finance juga meng-approve**; **PM hanya memantau** | Epik E1, ADR 0013 | Q-06, Q-07 (sebagian Q-08, Q-31) |

Tafsiran K3 dan detail K4 yang masih ambigu ada di §9 (GATE 1).

---

## 2. Fakta kondisi saat ini (ringkas, dengan bukti)

| Area | Fakta | Bukti |
|---|---|---|
| Web F0–F3 | Selesai di `develop`; staging image `0.1.0-stg-e7e997a` = develop untuk `apps/web` | audit gap §STATUS |
| APK F4/F4b | Di-merge (`e7e997a`, `8712964`); **gate HP fisik belum lulus**; WorkManager *partial*; signing prod belum ada (hanya kunci staging) | `f4/f4-gap-analysis.md` §1–2; `.github/workflows/mobile.yml:15-16,132` |
| F5 | Belum ada koleksi `progress-reports`, `budget-addenda`, `attendance-corrections`; sync `syncProgressReports:false`; dashboard placeholder "(F5)" | audit gap temuan 2; `api/v1/endpoints/app.ts:78` |
| Absensi | Slice F4b ada (check-in/out sendiri, geofence project, selfie, offline), default **OFF** (`syncAttendanceEnabled=false`) | `globals/CompanySettings.ts:112` |
| Pusat biaya | Tidak punya lat/lng/radius (geofence pusat biaya butuh field baru) | `collections/CostCenters.ts:32-44` |
| Jadwal/libur | Master `work-schedules` (jam masuk/pulang, toleransi 15 mnt) dan `holidays` ada, belum dipakai | `collections/WorkSchedules.ts:24-27` |
| Jobs | Hanya `auditDailyAnchor`, `sendEmail`, `reimburseAutoClose` | `jobs/tasks.ts` |
| Kas | API ada (`POST /cash-entries`, `PATCH /cash-entries/:id`, `POST /cash-entries/:id/void`, `POST|GET /period-closings`, `POST /period-closings/:period/reopen`, `POST …/transfers/:tid/void`); **tanpa UI** | `api/v1/endpoints/cash.ts:49-171`, `expense-requests.ts:353` |
| Saldo awal | Dihitung dari field `cash_accounts.opening_balance` (bisa diubah dengan alasan), **bukan** entri `opening` seperti ADR 0005 §3 | `domain/cash/ledger.ts:252-263`, `collections/CashAccounts.ts:36,44`; ADR 0005 L46 |
| Penomoran | `document-sequences.startAt` tersedia; keputusan PB lanjut dari 229 (Q-17) | `collections/DocumentSequences.ts:63` |
| Push | `PUSH_FCM_ENABLED=false` (true ditolak), APK `PK_PUSH_ENABLED=false`; in-app polling 2 menit | `lib/env.ts:152,170`; ADR 0011 |
| Infra prod | Belum ada `deploy/prod`; CI belum push GHCR (hanya komentar); DB `pk_drms` + role sudah ada; network `drms-kas-edge-prod` 10.100.14.0/24 dan `db-drms` 10.100.25.0/24 **dicadangkan**; record A prod **belum ada** | `deploy/` hanya `staging/`; `.github/workflows/ci.yml:151-152`; infra plan 06 L138-154,173; runbook onboarding L33 |
| Kapasitas | Sisa perencanaan RAM platform ≈ 1 160 MiB → **≈ 584 MiB setelah DRMS prod** dengan asumsi prod web 384 + worker 192 | infra `docs/adr/0004-capacity.md:299` |
| Backup | restic lokal **di disk yang sama**; S3 offsite belum berlangganan; L2 Hostinger mingguan | infra `docs/adr/0006-backup.md:9,33,83` |
| Outbox Odoo | Tidak ada (US-58, F7); traceability menjadwalkan skema outbox di F1 → deviasi | audit gap temuan 5 |

---

## 3. Scope go-live (IN / OUT)

**IN (wajib go-live):**
1. E0 — Housekeeping gate F3/F4 (catat gate, perbarui `phase-plan.md`, rilis `0.3.0`).
2. E1 — Perubahan alur approval (ADR 0013).
3. E2 — UI web Finance: kas masuk/keluar manual, edit sebelum tutup buku, void kas, void transfer, tutup/buka buku.
4. E3 — Sisa F4 + kesetaraan APK: gate HP fisik, WorkManager, signing rilis prod, withdraw/batal/ajukan ulang,
   daftar tim PM, inbox approval sesuai ADR 0013, ringkasan KPI Direktur/Finance, riwayat field-level.
5. E4 — Project & laporan progress (T11) + editor tahapan (bobot = 100%) + dashboard progress vs anggaran (US-12).
6. E5 — Addendum RAB (T12) + approval.
7. E6 — Absensi lengkap (US-09, 13, 14, 15, jadwal/libur/terlambat, geofence pusat biaya, retensi selfie, laporan absensi).
8. E7 — Pengingat terjadwal (M12).
9. E8 — Push FCM (**bergantung Firebase klien**; lihat §7 untuk go-live tanpa FCM).
10. E9 — Hardening F6 (signed media URL, redirect admin, reversal settlement, ASVS/ZAP, load test, restore drill,
    verifikasi backup, keputusan hash-chain, audit `login_failed`).
11. E10 — Infra prod (compose prod, GHCR + deploy CI, DNS, Traefik, realm `drms` prod, network, secrets, backup, monitoring).
12. E11 — Data go-live (saldo awal, impor master dari Excel, nomor PB mulai 229).
13. E12 — UAT per user story bersama klien + panduan pengguna per peran + runbook operasi.

**OUT (tetap setelah go-live, kecuali user memutuskan lain):** mirror Odoo/outbox (US-58, F7 — lihat R9),
OCR nota (US-54, F7), delegasi approver otomatis (Q-38, lihat G1-5), unduh PDF di APK (Q-16 default: web saja).

---

## 4. Epik, acceptance criteria, estimasi

Agen: **nextjs-developer** (web), **flutter-developer** (`.claude/agents/flutter-developer.md` di repo ini),
**infra-engineer** (hanya lewat branch/plan di `/opt/infra`, direview infra Lead), **qa-security**,
**docs-versioning**, **analyst**. Semua angka **ESTIMASI hari-agen**.

### E0 — Housekeeping gate F3/F4
- Isi: catat keputusan gate F2/F3 (user), perbaiki `phase-plan.md` §F4 ("not merged" → merged `e7e997a`), CHANGELOG `0.3.0`.
- AC: `phase-plan.md` menyebut status gate F2/F3/F4 dengan tanggal; tag `v0.3.0` ada setelah gate F4 (E3-a) lulus.
- Estimasi: docs 0,5–1.

### E1 — Alur approval Direktur → Finance, PM memantau (ADR 0013)
- Isi: migrasi data aturan default; hook `ApprovalRules` (tolak `pk-pm`/`pk-staff`, `scope_manager`, `optional` untuk
  Direktur); guard servis peran pemutus ∈ {Direktur, Finance}; cek pihak pemutus di submit + aturan *skip* (G1-2);
  re-approval via `pending_ack`; label "Direktur" (web, APK, PDF, notifikasi); inbox web/APK (Finance masuk, PM keluar);
  seed/UAT seed; update test (daftar di ADR 0013); update requirements §4/US-17/US-26/US-30/US-42 + architecture §5.2.
- AC (bisa diuji):
  1. Pengajuan baru (aturan default) → `pending_ack`; notifikasi ke semua Direktur aktif (bukan pemohon); PM **tidak** menerima.
  2. PM memanggil `POST …/acknowledge|approve|reject` → **403** dan baris audit `access_denied`; PM tetap bisa `GET` pengajuan tim.
  3. Direktur "Setujui" → `pending_approval` level 1; Finance approve → `approved`; tanda tangan kedua posisi tersimpan.
  4. Direktur/Finance menolak tanpa alasan → 400; dengan alasan → `rejected`.
  5. Admin menyimpan aturan dengan `acknowledgeRole=pk-pm`, `approverRole=pk-pm` atau `acknowledgeBy=scope_manager` → 400.
  6. Satu-satunya Direktur adalah pemohon → posisi Diketahui dilewati, audit `approval_skipped`, PDF "(tidak berlaku — pemohon)"
     (sesuai jawaban G1-2); kedua posisi tidak dapat diisi → submit 409.
  7. Reimburse revisi nota dengan total berubah → kembali ke `pending_ack` (bukan langsung `pending_approval`).
  8. Pengajuan staging yang diajukan sebelum migrasi tetap selesai dengan snapshot lama (uji regresi).
  9. PDF form 228: kotak "Diketahui Oleh" = nama Direktur, "Approval" = nama Finance; golden test diperbarui.
  10. APK: inbox tampil untuk Direktur & Finance, tidak untuk PM-only; timeline "Diketahui (Direktur)".
- Estimasi: nextjs 3–5 · flutter 1–2 · qa 1,5–2 · analyst/docs 0,5–1 → **6–10**.

### E2 — UI web Finance untuk kas
- Isi: view admin "Kas" (form kas masuk: tanggal, akun, sumber, project XOR pusat biaya, nominal, keterangan, bukti;
  kas keluar: + kategori, kendaraan opsional), edit sebelum tutup buku (alasan wajib), tombol **Void** (alasan wajib)
  di buku kas, tombol **Void transfer** di detail pengajuan/antrian transfer, halaman **Tutup buku** (tutup periode,
  buka kembali = Direktur saja per ADR 0005 §6 "Owner only" → label Direktur), semua lewat `/api/v1` + `Idempotency-Key`.
- AC: Finance membuat KM/KK dari panel → nomor `KM/YYMM/####`/`KK/…`, saldo akun berubah, audit ada; void → baris reversal
  terlihat, baris asli tetap tampil "Void"; void transfer → status pengajuan kembali (Uang Muka `approved`, Reimburse
  `receipts_verified`) dan KK dibalik; posting ke periode tertutup ditolak dengan pesan Indonesia; PM/Staff tidak melihat
  menu (uji negatif per peran); `create/update: denyAll` di koleksi tetap (UI memakai endpoint domain).
- Estimasi: nextjs 4–6 · qa 1–1,5 · docs 0,5 → **5,5–8**.

### E3 — Sisa F4 + kesetaraan APK
- E3-a **Gate HP fisik** (`f4/f4-e2e-scenario.md`) setelah redeploy staging — user/QA di HP nyata.
- E3-b **WorkManager** sync latar belakang (isolate membuka DB terenkripsi + token store).
- E3-c **Signing rilis prod**: keystore prod (2 custodian, ADR 0010 keputusan 13), job CI `main`/tag `mobile-vX.Y.Z` dengan
  environment approval, SHA-256 dicatat (untuk Firebase/App Links).
- E3-d Kesetaraan requester: withdraw/batal/ajukan ulang (US-04/06), daftar tim PM (US-17), riwayat field-level (US-35),
  ringkasan KPI Direktur/Finance di home (US-27, baca `/api/v1/dashboard/*`).
- AC: skrip E2E HP lulus seluruh langkah (bukti: tangkapan layar + audit log); dengan app ditutup, item antrean offline
  terkirim ≤ 15 menit setelah online (batas periodik WorkManager — ESTIMASI, diverifikasi di HP); APK prod ditandatangani
  kunci prod (`apksigner verify --print-certs`), scan rahasia APK hijau; withdraw/batal/ajukan ulang dari HP menghasilkan
  status & audit yang sama dengan web.
- Estimasi: flutter 9–14 · qa 2–3 · infra/user 0,5 (custodian kunci) → **11,5–17,5**.

### E4 — Project, tahapan & laporan progress (T11, US-10/11/12/29/31)
- Isi: editor tahapan project (bobot total = 100% saat simpan, G11), koleksi `progress-reports` (`LP/YYMM/####`, project,
  tahapan, % sebelum→sesudah, pekerjaan, kendala, ≤ 5 foto `media-progress-photos`, edit ≤ 24 jam), hitung ulang progress
  project = Σ(bobot × % tahapan) di transaksi yang sama + audit before→after, sync offline (`progress_report` di `/sync/batch`,
  `syncProgressReports:true`), daftar/penampil laporan + foto di web (US-31, terbaru di atas, filter project), layar APK
  (daftar project PM, buat laporan offline + foto kamera belakang), dashboard US-12 (warna hijau/kuning/merah dengan ambang
  di setting) menggantikan placeholder "(F5)".
- AC: bobot ≠ 100% ditolak; laporan 50% pada tahapan bobot 30% → progress project naik 15 poin (uji unit + integrasi);
  foto ke-6 ditolak; foto disimpan ≤ 1600 px/≤ 400 KB tanpa EXIF lokasi; % tahapan hanya berubah lewat laporan (PATCH langsung
  ditolak, audit menunjukkan before→after); laporan offline tersinkron sekali (idempotent) dengan penanda offline; PM hanya
  project timnya, Staff tidak bisa membuat (uji negatif); dashboard US-12 cocok dengan SQL rekonsiliasi.
- Estimasi: nextjs 9–13 · flutter 5–7 · qa 2–3 · docs 0,5 → **16,5–23,5**.

### E5 — Addendum RAB (T12, US-18/30)
- Isi: koleksi `budget-addenda` (`ADD/YYMM/####`), ajukan (PM tim) → approval lewat `approval-rules` `docType: budget_addendum`
  (default ADR 0013 O-3: Direktur), setelah disetujui anggaran project bertambah + riwayat; web + inbox APK Direktur.
- AC: nominal & alasan wajib; PM di luar tim → 403; setelah approve `projects.budget` = lama + tambahan dalam satu transaksi,
  audit before→after; tolak wajib alasan; dampak ke K-xx anggaran di dashboard terekonsiliasi.
- Estimasi: nextjs 3–4 · flutter 1–2 · qa 1 → **5–7**.

### E6 — Absensi lengkap (US-01/02/09/13/14/15, M13 laporan absensi)
- Isi: rekap bulanan pribadi (web + APK), kehadiran tim hari ini (PM, web + APK), **diabsenkan PM** (`attendance.on_behalf`,
  foto dari HP PM, tercatat nama PM), **koreksi T10** (`attendance-corrections`, alasan wajib, lama→baru), jadwal kerja &
  hari libur → menit terlambat / pulang cepat / hadir di hari libur (ditandai), **geofence pusat biaya** (lat/lng/radius
  opsional di `cost-centers`), **retensi selfie** (job hapus file selfie > N bulan, data absensi tetap; penampil selfie
  hanya PM tim/Finance/Direktur/Admin + audit `view_sensitive`), **laporan absensi** + export, lalu nyalakan
  `syncAttendanceEnabled` di prod.
- AC: di luar radius project/pusat biaya → ditolak dengan jarak; mock location → ditolak; check-in 2× sehari → ditolak;
  terlambat dihitung dari jadwal + toleransi (uji tabel waktu termasuk hari libur); koreksi tanpa alasan → 400, audit lama→baru;
  on-behalf tercatat `source=pm` + nama PM; selfie > retensi terhapus dari volume, baris absensi tetap (uji job dengan jam
  palsu); Staff tidak bisa melihat selfie orang lain (uji negatif); laporan absensi = SQL rekonsiliasi.
- Estimasi: nextjs 8–11 · flutter 5–7 · qa 2–3 · docs 0,5 → **15,5–21,5**.

### E7 — Pengingat terjadwal (M12, US-11)
- Isi: job worker harian (jam di setting, TZ `Asia/Makassar`): (a) project tanpa laporan progress N hari (default 3) → PM +
  Direktur; (b) Uang Muka `transferred` tanpa nota/LPJ > N hari → pemohon + Finance; (c) Reimburse/ LPJ revisi menggantung >
  N hari → pemohon; (d) komitmen anggaran project > ambang (default 85% sesuai US-26) → Direktur + Finance, sekali per
  ambang per project. Setting N & ambang di `company-settings`; template di `notification-templates`; dedup per hari.
- AC: dengan jam palsu, tiap aturan menghasilkan tepat satu notifikasi per penerima per hari; tidak ada notifikasi untuk
  project `archived`; job gagal tercatat di log worker tanpa PII; setting berubah → berlaku di run berikutnya.
- Estimasi: nextjs 3–4 · qa 1 → **4–5**.

### E8 — Push FCM (ADR 0011) — **bergantung Firebase klien (Q-44/45)**
- Isi: sesuai `f4-gap-analysis.md` §4 langkah 1–5 (proyek Firebase klien, secret CI/Docker, `FcmPushService`, dispatcher
  HTTP v1 dengan retry, cabut token `UNREGISTERED`, hapus penolakan `PUSH_FCM_ENABLED=true`), plus draf **pemberitahuan
  privasi karyawan** (Q-46; wajib juga untuk selfie & lokasi — lihat G1-6).
- AC: notifikasi status sampai di HP terkunci ≤ 1 menit (uji di 2 HP); payload tanpa nama/nominal (ADR 0011); logout
  menghapus token; `UNREGISTERED` menghapus `fcmToken`; scan APK hijau (allow-list API key Firebase dengan alasan tertulis).
- Estimasi: nextjs 2–3 · flutter 2–3 · infra 0,5 · qa 1 · docs 1 → **6,5–8,5**.

### E9 — Hardening F6
- Isi: signed media URL HMAC (ADR 0004 §4), redirect 302 `/admin/*` bagi yang belum login, reversal settlement (void
  refund KM / transfer kekurangan, saat ini 409), 409 vs 403 (UAT 5.2), audit `login_failed` via event Keycloak (atau catat
  keputusan bahwa log Keycloak = sumbernya), keputusan hash-chain (ADR 0006 §5), ASVS L1 checklist + ZAP baseline staging,
  **load test** (target Q-34 default: 30 pengguna lapangan + 5 kantor, termasuk unggah foto progress/selfie), **restore drill**
  (DB + media, RTO ≤ 4 jam), verifikasi backup `pk_drms` + `drms_pk_media_prod`, ambang coverage di CI.
- AC: tidak ada temuan HIGH/CRITICAL terbuka; URL media kedaluwarsa → 403 dan user tanpa akses → 403 walau `sig` valid;
  `/admin/collections/...` tanpa sesi → 302 ke login; reversal settlement mengembalikan saldo & status dengan audit;
  load test p95 < 5 s untuk **unggahan** (foto nota, selfie, foto progress, tanda tangan, lampiran, logo — APK mengunggah
  di latar belakang/antrean offline; resize gambar diantre di proses web, antrean penuh → 503 + `Retry-After` yang
  dicoba ulang APK; **keputusan user 2026-09-27**, P-1) serta **sinkron latar belakang APK `/sync/batch`** (keputusan user
  2026-09-27, P-1b), dan p95 < 2 s untuk **semua aksi lain** (laporan progress, dashboard, inbox approval, laporan), serta RAM puncak web/worker < 80% limit; restore drill ke DB uji
  `pk_drms_restoretest` selesai < 4 jam dengan jumlah baris & checksum media cocok.
- Estimasi: nextjs 6–9 · qa 6–8 · infra 1–1,5 · analyst 0,5 → **13,5–19**.

### E10 — Infra produksi
- Isi (repo ProyekKas): `deploy/prod/docker-compose.yml` (web `drms-pk-web`, worker, migrate, seed profil; networks
  `drms-kas-edge-prod`, `db-drms`, `drms-kc-admin`; secrets file uid 1001; `NODE_OPTIONS` sesuai limit); CI: push image ke
  **GHCR** (build di runner GitHub, bukan di VPS) + job deploy manual ber-approval (`infra-deploy`), tag semver; `config/prod.json`
  APK (`PK_LOGIN_MODE` sesuai G1-3).
- Isi (repo infra, lewat infra-engineer + review infra Lead): network `drms-kas-edge-prod`/`db-drms` diaktifkan (plan 06),
  router Traefik prod `drms-kas.bimacreative.tech` (+ `auth-drms-token` rate limit prod), realm `drms`: redirect URI web prod,
  `proyekkas-mobile` Direct Access Grants **ON hanya bila G1-3 = ya**, `bruteForceProtected` diverifikasi, SMTP realm,
  secret client prod; `MEDIA_VOLUMES` + dump `pk_drms`; Uptime Kuma + alert Prometheus (health, disk, container restart);
  **DNS A record** dibuat manual oleh user di Hostinger (ADR infra 0002).
- AC: `curl -I https://drms-kas.bimacreative.tech/api/v1/health` 200 dengan sertifikat LE produksi; `docker compose ps`
  web/worker healthy, migrate `Exited (0)`; login web SSO realm `drms` berhasil; login APK prod berhasil; `docker inspect`
  limit = nilai yang disetujui (§6); `restic ls latest` memuat dump `pk_drms` & volume media prod; alert uji terkirim;
  image di GHCR ber-tag semver, tanpa CRITICAL Trivy.
- Estimasi: infra 4–6 · nextjs 1–2 · flutter 0,5 · qa 1 · user (DNS, approval) → **6,5–9,5**.

### E11 — Data go-live
- Isi: template Excel per master (karyawan, user+peran, rekening karyawan, kendaraan, pusat biaya + penanggung jawab + koordinat,
  project + PM + koordinat + tahapan/bobot + RAB, kategori/satuan, akun kas + saldo awal), skrip impor idempoten (dry-run →
  laporan error → commit, audit `import`), `document-sequences` PB `startAt = 229` (Q-17), cut-over: tanggal saldo awal =
  tanggal go-live, periode sebelumnya ditutup.
- AC: dry-run di staging dengan file klien menghasilkan 0 error; jumlah baris per master = jumlah baris Excel; saldo per akun
  di laporan Rekap Kas = saldo awal klien; pengajuan pertama di prod bernomor `229/PB-DRMS/<DD>/<MM>/<YYYY>`; impor kedua
  tidak menggandakan data.
- **Catatan:** saldo awal saat ini = field `openingBalance` (bisa diubah dengan alasan) — usul: kunci field setelah periode
  pertama ditutup, dan revisi ADR 0005 §3 agar sesuai implementasi (atau ubah ke entri `opening`). Keputusan analyst+Lead
  di S1, tidak memblokir. **S3b (2026-09-26):** tetap field + `openingBalanceDate`; dikunci setelah periode sejak tanggal
  saldo awal ditutup (hook + trigger DB) — ADR 0005 "As implemented (S3b)"; runbook `runbooks/import-data-golive.md`.
- Estimasi: nextjs 2–4 · analyst 1 · qa 0,5 · docs 0,5 → **4–6**.

### E12 — UAT & dokumentasi pengguna
- Isi: skrip UAT per user story (US-01…US-59 yang IN scope) dengan data fiktif, sesi UAT bersama klien (web + HP), laporan
  UAT (pola `uat/f2-uat-report.md`); panduan pengguna Bahasa Indonesia per peran (Staff, PM, Finance, Direktur, Admin) +
  runbook ops (deploy, rollback, restore, rotasi kunci, pencabutan perangkat, tutup buku).
- AC: setiap US IN scope punya minimal satu skenario dengan hasil PASS/FAIL tercatat; tidak ada FAIL berprioritas tinggi
  tanpa keputusan; panduan per peran tersedia; klien menandatangani UAT.
- Estimasi: qa 4–6 · docs 4–6 · analyst 1–2 → **9–14**.

### Rekap estimasi (ESTIMASI hari-agen)

| Epik | nextjs | flutter | infra | qa | docs/analyst | Total |
|---|---:|---:|---:|---:|---:|---:|
| E0 | – | – | – | – | 0,5–1 | 0,5–1 |
| E1 | 3–5 | 1–2 | – | 1,5–2 | 0,5–1 | 6–10 |
| E2 | 4–6 | – | – | 1–1,5 | 0,5 | 5,5–8 |
| E3 | – | 9–14 | 0,5 | 2–3 | – | 11,5–17,5 |
| E4 | 9–13 | 5–7 | – | 2–3 | 0,5 | 16,5–23,5 |
| E5 | 3–4 | 1–2 | – | 1 | – | 5–7 |
| E6 | 8–11 | 5–7 | – | 2–3 | 0,5 | 15,5–21,5 |
| E7 | 3–4 | – | – | 1 | – | 4–5 |
| E8 | 2–3 | 2–3 | 0,5 | 1 | 1 | 6,5–8,5 |
| E9 | 6–9 | – | 1–1,5 | 6–8 | 0,5 | 13,5–19 |
| E10 | 1–2 | 0,5 | 4–6 | 1 | – | 6,5–9,5 |
| E11 | 2–4 | – | – | 0,5 | 1,5 | 4–6 |
| E12 | – | – | – | 4–6 | 5–8 | 9–14 |
| **Total** | **41–61** | **23,5–35,5** | **6–8,5** | **23–31** | **10,5–14,5** | **≈ 104–151** |

Pembanding: `phase-plan.md` F5 + F6 = 48–70 hari-agen; selisih berasal dari E1, E2, E3-d, E10–E12 yang dulu tidak dirinci.

---

## 5. Urutan, dependency, paralelisme

Jalur kritis = **track web (nextjs)** ≈ 41–61 hari-agen. Bila dijalankan **dua agen nextjs paralel** pada file berbeda,
kalender web ≈ 25–35 hari kerja (ESTIMASI). **Batasan paralel:** migrasi Payload dibuat berurutan (satu migrasi per branch,
di-rebase sebelum merge) karena timestamp & snapshot JSON migrasi saling bergantung; `payload-types.ts` dan
`collections/index`/`payload.config.ts` adalah titik konflik — merge serial.

| Sprint (ESTIMASI kalender) | Track web A | Track web B | Track mobile | Track infra/QA/docs | Gate sprint |
|---|---|---|---|---|---|
| **S0** (± 1 minggu) | E1 approval (ADR 0013) | E2 UI Finance kas | E3-a gate HP (setelah redeploy) · E1 sisi APK | E0 · E10 mulai: compose prod + GHCR CI · minta Firebase & data Excel ke klien | ADR 0013 accepted; gate F4 lulus; `v0.3.0` |
| **S1** (± 2 minggu) | E4 backend (tahapan, progress-reports, sync) | E6 backend (on-behalf, koreksi, jadwal, geofence pusat biaya) | E3-d kesetaraan requester · E3-b WorkManager | E10 infra repo (network, Traefik, realm prod) · E11 template Excel | staging berisi E1/E2/E4-backend; demo ke user |
| **S2** (± 2 minggu) | E4 web (penampil, dashboard US-12) · E5 addendum | E6 web (rekap, tim hari ini, laporan, retensi) · E7 pengingat | E4 & E6 layar APK (offline progress, rekap, tim, on-behalf) · E5 approve APK · E3-c signing prod | E8 bila Firebase siap · E12 skrip UAT | semua fitur *code complete* di staging |
| **S3** (± 1–2 minggu) | E9 web (signed URL, redirect, reversal settlement, 409/403) | E11 skrip impor + dry-run | E8 APK / perbaikan | E9 QA (ASVS/ZAP, load test, restore drill) · E10 prod up (tanpa data) · panduan pengguna | 0 HIGH/CRITICAL; load test & restore drill lulus |
| **S4** (± 1 minggu + latensi klien) | perbaikan UAT | perbaikan UAT | perbaikan UAT, APK rilis prod | UAT klien · impor data prod · cut-over · `v1.0.0` | GATE 2: UAT ditandatangani klien |

Total kalender kasar **7–9 minggu** (ESTIMASI) — bergantung latensi review user di tiap gate, jawaban klien (§8) dan
ketersediaan Firebase.

**Dependency utama:**
- E1 sebelum E5 (addendum memakai engine approval yang sama) dan sebelum UAT.
- E4-backend sebelum E4-APK; E6-backend sebelum E6-APK; E3-d (inbox) setelah E1.
- E3-a (gate HP) butuh redeploy staging (3 migrasi aditif F4b, `f4-gap-analysis.md` §5).
- E8 butuh proyek Firebase + SHA-256 kunci prod (E3-c).
- E10 butuh DNS A record (user) dan keputusan G1-3 (Direct Access Grants realm `drms`).
- E11 butuh file Excel klien (Q-19/20/22/23/36/37).
- E9 load test butuh E4/E6 (unggah foto progress & selfie) agar angka RAM relevan.

---

## 6. Dampak kapasitas VPS

| Item | Nilai | Sumber |
|---|---|---|
| Sisa perencanaan platform sekarang | ≈ 1 160 MiB | infra ADR 0004 T19 §3 |
| Reservasi DRMS prod di T19 | web **384** + worker **192** = 576 MiB (+ migrate 384 sementara saat deploy) | infra ADR 0004:299 |
| Sisa setelah DRMS prod | **≈ 584 MiB** | idem |
| Rencana lama ADR 0002 ProyekKas (F0) | web 640 + worker 320 = 960 MiB | `adr/0002-hosting-deployment-capacity.md` §2/§6 |
| Pengukuran nyata | spike F1: web idle 108 MiB, puncak 205 MiB (10 VU + 3 foto 12 MP); staging idle web 82 / worker 47 MiB | ADR 0002 §6 |

**Usulan:** prod **384/192** (sama dengan staging dan reservasi T19), `NODE_OPTIONS` 256/128 seperti staging
(`deploy/staging/docker-compose.yml:111,141`). Bila ADR 0002 lama (640/320) dipakai, reservasi terlampaui **+384 MiB** →
sisa platform turun ke **≈ 200 MiB** dan melanggar rencana "≤ 2 website baru" di T19 — **perlu persetujuan user**.
F5 menambah beban sharp (foto progress ≤ 5/laporan, selfie) di web dan job pengingat/retensi di worker; angka akhir
ditetapkan dari load test E9. Aturan: bila puncak web > 80% limit (≈ 307 MiB) → naikkan web ke 512 (memakai 128 MiB dari
584) **setelah persetujuan user**, atau pindahkan resize ke worker (langkah ADR 0002 §6 (b)).

**Disk (ESTIMASI, volume Q-34 default):** foto progress 10 project × 26 hari × ≤ 5 × 400 KB ≈ ≤ 520 MB/bulan; selfie
≈ 225 MB/bulan (dibatasi retensi 12 bulan ≈ 2,7 GB); nota ≈ 40–120 MB/bulan → **≈ 0,8 GB/bulan, ≈ 10 GB/tahun** + restic
lokal 1–1,5× di disk yang sama. Risiko disk terbesar tetap build lokal (T19 §4) → E10 memindahkan build ke GHCR.

**DB:** role `pk_drms_app` memakai limit koneksi (prod 30 total role; target ≤ 15 koneksi aktual, runbook onboarding
L316-317) → pool web 5 + worker 3 cukup.

---

## 7. Push FCM vs go-live

- **Usulan:** go-live **boleh** tanpa FCM bila Firebase belum siap di akhir S2. Pengganti: notifikasi in-app (polling
  2 menit saat app terbuka + saat app dibuka/resume, sudah ada) + **email** untuk kejadian kritis (menunggu persetujuan
  Direktur/Finance, pengingat E7) lewat adapter SMTP yang sudah ada. Risiko: Direktur/Finance tidak tahu ada pengajuan
  sampai membuka app → SLA approval lebih lambat. FCM menyusul sebagai rilis `1.1.0` (APK baru; `minAppVersion` memaksa update).
- Syarat: pemberitahuan privasi (Q-46) tetap wajib sebelum go-live karena **selfie + lokasi** (bukan hanya FCM).

---

## 8. Pertanyaan klien (Q-01…Q-46) — status setelah keputusan user

**Terjawab oleh user 2026-09-25** (dicatat di `open-questions-client.md`): Q-01, Q-02, Q-06, Q-07, Q-39, Q-40
(fitur), sebagian Q-08 dan Q-31 (lihat ADR 0013).

**MEMBLOKIR go-live** (default tidak cukup; butuh data/izin klien):

| No | Kenapa memblokir | Dibutuhkan paling lambat |
|---|---|---|
| Q-36 | Saldo awal akun kas, tanggal cut-over | S3 (dry-run impor) |
| Q-19, Q-20 | Daftar kategori & satuan nyata (default ada, tapi laporan kategori harus sesuai klien) | S3 |
| Q-22 | Daftar kendaraan (plat, jenis) | S3 |
| Q-23 | Daftar pusat biaya + penanggung jawab (+ koordinat bila geofence, Q-40) | S2 (uji geofence) / S3 |
| Q-37 | Login pakai username/email; daftar user & peran (termasuk siapa Direktur dan Finance) | S3 |
| Q-30 | Jam kerja/toleransi/hari kerja — dipakai untuk "terlambat" (dasar upah) | S2 |
| Q-33 | Lama retensi selfie & siapa boleh melihat (UU PDP) | S2 |
| Q-46 | Pemberitahuan privasi karyawan disetujui HR/legal DRMS (selfie, lokasi, notifikasi) | sebelum UAT (S4) |
| Q-38 | Delegasi bila Direktur berhalangan — dengan alur baru **semua** pengajuan menunggu Direktur | S0 (lihat G1-5) |

**Tidak memblokir** (default dipakai): Q-03, Q-04, Q-09, Q-10, Q-11, Q-12, Q-13, Q-14, Q-15, Q-16, Q-18, Q-21, Q-24,
Q-25 (field COA boleh kosong), Q-26, Q-27, Q-28, Q-29 (fitur on-behalf tetap dibangun), Q-31 (ambang tambahan), Q-32
(logo sementara), Q-34, Q-35, Q-41, Q-42, Q-43, **Q-44/Q-45** (hanya memblokir FCM, lihat §7).

---

## 9. GATE 1 — ringkasan (≤ 1 layar)

**Rencana:** go-live semua modul (F5 penuh + UI kas Finance + alur approval baru + sisa F4 + hardening F6 + infra prod +
data + UAT) ≈ **104–151 hari-agen, 7–9 minggu kalender** (ESTIMASI), 5 sprint S0–S4, 3 track paralel (web ×2, APK,
infra/QA/docs). RAM prod 384/192 MiB (sesuai reservasi platform, sisa ≈ 584 MiB). Belum ada implementasi.

**Pertanyaan yang harus dijawab sebelum eksekusi (dengan rekomendasi):**

| # | Pertanyaan | Rekomendasi |
|---|---|---|
| G1-1 | "Direktur" = peran **Owner** yang sudah ada (diganti label jadi Direktur), atau peran baru terpisah? Apakah Owner tetap meng-approve di samping Direktur? | **Pakai peran Owner, label "Direktur"**; tidak ada approver Owner terpisah. Peran baru hanya bila Owner ≠ Direktur (biaya +134 titik kode). |
| G1-2 | Urutan & ambang: **Direktur (Diketahui) → Finance (Approval)** untuk semua nominal? Bila satu-satunya Direktur/Finance adalah pemohon, posisinya dilewati (tercatat) dan satu keputusan independen cukup? | **Ya**: urutan sesuai kotak form, tanpa ambang dulu (Q-31 bisa ditambah via aturan), aturan *skip* + audit; bila tak ada keputusan independen → ditolak (409). |
| G1-3 | Login APK prod = form username+password di aplikasi (seperti staging, Direct Access Grant) — diterima dengan konsekuensi: tidak bisa MFA/OTP di APK, app menangani password (RFC 9700 §2.4 melarang), perlindungan hanya brute-force Keycloak + rate limit token endpoint? | **Ya, terima** dengan mitigasi: verifikasi `bruteForceProtected` realm `drms`, rate limit `auth-drms-token` prod, DAG hanya di `proyekkas-mobile`, password minimal 10 karakter, sesi offline 14/30 hari tetap, pencabutan perangkat; ADR 0012 direvisi untuk prod. Alternatif: Custom Tab (loop process-death di beberapa HP). **Revisi 2026-09-28 (ADR 0017):** 2FA TOTP kini *opsional per user, swalayan* — APK menampilkan kolom "Kode autentikator (bila 2FA aktif)" setelah login gagal dan mengirim `totp`; web: halaman "Keamanan akun". |
| G1-4 | Boleh go-live **tanpa FCM** bila Firebase klien belum siap (in-app polling + email untuk persetujuan/pengingat)? | **Ya**; FCM menyusul di `1.1.0`. |
| G1-5 | Direktur berhalangan: siapkan delegasi (Q-38) sebelum go-live, atau cukup Admin mengubah aturan sementara (tercatat)? Berapa orang Direktur & Finance? | **Minimal 2 pemegang peran Direktur atau aturan pengganti bernama**; delegasi otomatis tetap di luar scope. |
| G1-6 | Backup offsite untuk data keuangan prod: aktifkan S3 offsite (B2/Wasabi) **atau** add-on backup harian Hostinger sebelum go-live? | **Wajib salah satu** sebelum go-live (sekarang restic hanya di disk yang sama, RPO kehilangan host s.d. 7 hari). |
| G1-7 | Siapa PIC klien untuk data master Excel, saldo awal, jam kerja, retensi selfie, dan persetujuan pemberitahuan privasi (daftar §8), dan target tanggal go-live? | Tetapkan PIC + tenggat S2/S3; tanggal go-live ditetapkan setelah data diterima. |

---

## 10. Risiko

| # | Risiko | Kemungkinan / dampak | Mitigasi | Pemilik |
|---|---|---|---|---|
| R1 | Scope besar (≈ 104–151 hari-agen) + satu jalur web kritis | T / T | 2 agen web paralel, migrasi serial, gate per sprint, fitur di balik flag bila perlu | Lead |
| R2 | Data klien terlambat (Excel, saldo awal, jam kerja, privasi) | T / T | minta di S0, template E11, dry-run staging, tanggal go-live setelah data | Lead + user |
| R3 | Firebase tidak tersedia | S / S | go-live dengan polling + email (§7) | Lead |
| R4 | Satu Direktur → semua pengajuan macet saat berhalangan | S / T | G1-5; pengingat E7 ke Direktur; Admin bisa ubah aturan (tercatat) | user/klien |
| R5 | Login password di APK (RFC 9700) | S / S | mitigasi G1-3, revisi ADR 0012, pantau event `LOGIN_ERROR` Keycloak | infra + flutter |
| R6 | RAM: F5 foto/selfie menaikkan puncak web | S / S | load test E9; aturan naik limit hanya dengan persetujuan user (§6) | analyst + infra |
| R7 | Disk: build lokal menghabiskan disk (T19 runway 1,3–2 hari saat itu) | T / T | build di GHCR (E10), bersihkan build cache, worktree lama | infra |
| R8 | Backup hanya di disk yang sama | S / Sangat T | G1-6 | infra + user |
| R9 | Tanpa outbox sejak hari pertama, mirror Odoo (F7) harus backfill | S / S | ADR 0009 satu arah: sinkron awal dari data historis; catat deviasi traceability | analyst |
| R10 | Gate HP fisik gagal pada perangkat klien (Android vendor, process-death) | S / T | E3-a di S0, uji di ≥ 2 merek HP klien | flutter + QA |
| R11 | Perubahan approval mengganggu pengajuan in-flight di staging | R / R | snapshot lama tetap berlaku; staging dibersihkan sebelum UAT (ADR 0013) | nextjs |
| R12 | Shared infra (Keycloak, Traefik, pg_hba) bentrok dengan sesi infra lain | S / S | perubahan hanya via branch infra + review infra Lead, staging dulu | infra |

---

## 11. Rollback

- Per epik: fitur baru di balik setting/flag (`syncProgressReports`, `syncAttendanceEnabled`, `PUSH_FCM_ENABLED`, job
  pengingat bisa dimatikan di setting); migrasi aditif; rollback kode = image tag sebelumnya lewat `infra-deploy`.
- Alur approval: lihat ADR 0013 §Rollback (aturan lama diaktifkan kembali, snapshot menjaga dokumen berjalan).
- Prod go-live: sebelum cut-over, prod bisa dimatikan tanpa kehilangan data (belum ada data); setelah cut-over, rollback =
  restore dump pra-migrasi (runbook infra) — migrasi tidak otomatis reversibel.
