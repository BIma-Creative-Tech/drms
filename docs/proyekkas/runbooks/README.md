# ProyekKas / DRMS — Indeks runbook operasi

- **Status:** berlaku · **Tanggal:** 2026-09-30 (versi awal E12 2026-09-26) · **Basis kode:** `develop` @ `5415f45`
  (web 0.5.0, APK 0.3.0)
- **Tujuan:** satu pintu masuk untuk tugas operasi ProyekKas. Dokumen ini **menautkan** runbook yang sudah ada
  (di folder ini dan di repo infra `/opt/infra`) dan hanya menulis prosedur baru bila belum ada di mana pun.
- **Pembaca:** infra Lead / operator VPS (deploy, rollback, restore, rotasi kunci, impor) dan Admin/Finance/Direktur
  aplikasi (pencabutan perangkat, tutup buku).
- **Penanda:** **belum diverifikasi** = dirujuk dokumen lain tetapi keberadaan/isinya tidak dapat diperiksa dari repo
  ini (mis. runbook di repo infra pada branch yang belum di-merge).

> Aturan umum: semua perubahan pada container/Traefik/Keycloak/Postgres yang **dipakai bersama** dilakukan oleh
> atau dengan persetujuan **infra Lead** (lihat `/opt/infra/CLAUDE.md`). Langkah destruktif (menimpa DB, menghapus
> volume, `docker compose down -v`) selalu butuh konfirmasi eksplisit user.

## Ringkasan

| # | Tugas | Lingkungan | Runbook | Status |
|---|---|---|---|---|
| 1 | Deploy / upgrade aplikasi | staging | `/opt/infra/docs/runbooks/proyekkas-drms-onboarding.md` §Langkah 5 "Upgrade (image baru)"; image GHCR untuk staging: [`ci-ghcr.md`](ci-ghcr.md) §8 | tersedia |
| 1b | Deploy / upgrade aplikasi | **prod** | [`ci-ghcr.md`](ci-ghcr.md) §3 (tag `vX.Y.Z` → image GHCR ber-digest) + §6a (deploy manual oleh infra Lead: `.env.prev`, `backup.sh run`, `pull`, `up -d`, cek health); runbook infra `docs/runbooks/proyekkas-drms-prod.md` (branch `feat/infra-drms-prod`, **belum diverifikasi**) | tersedia (manual); deploy lewat CI §6b **belum aktif** (INERT, prasyarat §6b) |
| 2 | Rollback aplikasi | staging | runbook onboarding §Langkah 5 "Rollback" (tag image lama; restore dump bila skema tidak kompatibel) | tersedia |
| 2b | Rollback aplikasi | **prod** | [`ci-ghcr.md`](ci-ghcr.md) §7 (kembalikan `.env.prev` / ref@digest rilis lama; skema tidak kompatibel = restore dump pra-deploy) | tersedia |
| 3 | Backup & restore DB + media | semua | `/opt/infra/docs/03-operations/backup.md` §Restore, ADR infra `docs/adr/0006-backup.md` | tersedia (catatan di §3) |
| 3b | Restore drill ProyekKas (RTO ≤ 4 jam) | staging → DB uji | [`../qa/s3-e9-qa-report.md`](../qa/s3-e9-qa-report.md) §3 (langkah & perintah §3.1) | **dijalankan 2026-09-26: PASS** (RTO 6,1 s; baris, sequence & sha256 media cocok); ulangi di prod setelah go-live (§3.3 R-2) |
| 4 | Rotasi kunci & rahasia | semua | [`rotasi-kunci.md`](rotasi-kunci.md) (indeks per rahasia, menautkan runbook infra) | tersedia sebagian |
| 5 | Pencabutan perangkat / user hilang HP / karyawan keluar | aplikasi | [`cabut-perangkat.md`](cabut-perangkat.md) | tersedia |
| 6 | Tutup buku bulanan & buka kembali | aplikasi | [`tutup-buku.md`](tutup-buku.md); tutup buku **per PT**: [panduan Finance](../guides/finance.md) §6 | tersedia (runbook masih tanpa bagian per PT, lihat §6) |
| 7 | Data go-live (impor master, saldo awal, nomor PB mulai 229, beberapa PT) | staging, prod | [`import-data-golive.md`](import-data-golive.md) (dry-run → commit, §3.5 langkah Keycloak, §4.1 beberapa PT dengan `kode_pt`) | tersedia |
| 8 | Monitoring & alert | semua | `/opt/infra/docs/03-operations/observability.md` (Uptime Kuma monitor staging sudah ada: runbook onboarding §Langkah 5) | staging tersedia; prod **belum diverifikasi** |
| 9 | Keycloak realm `drms` (user, SMTP, brute-force; reset 2FA pengguna: ADR 0017 §Recovery) | semua | `/opt/infra/docs/03-operations/keycloak.md`, runbook onboarding §Langkah 3 | tersedia |
| 10 | Menerbitkan APK di halaman unduh `/unduh` (tautan tetap `/unduh/proyekkas.apk`) | staging, prod | [`rilis-apk.md`](rilis-apk.md) | tersedia; butuh web ≥ 0.5.0 di lingkungan tujuan (halaman `/unduh` + syarat APK 0.3.0) |
| 11 | Image & CI (GHCR, Trivy, runner self-hosted) | CI | [`ci-ghcr.md`](ci-ghcr.md) §1–§5, §9–§10 | tersedia |

## 1. Deploy / upgrade

**Staging.** Ikuti runbook onboarding §Langkah 5 "Upgrade (image baru)":
tag image baru (jangan menimpa tag lama) → `backup.sh run` (dump sebelum migrasi) → ubah `PK_WEB_IMAGE` /
`PK_MIGRATE_IMAGE` di `.env` → `docker compose up -d` → cek `docker compose ps -a` (migrate `Exited (0)`),
log migrate, `curl …/api/v1/health` = 200. Staging juga dapat memakai image GHCR `<ver>-stg-<sha7>@sha256:…`
([`ci-ghcr.md`](ci-ghcr.md) §8). Catat setiap upgrade di bagian "Catatan" runbook onboarding
(pola yang sudah dipakai: tanggal, tag, nama file dump pra-migrasi, perintah rollback).

**Prod.** [`ci-ghcr.md`](ci-ghcr.md): rilis = merge `release/*` → `main`, tag `vX.Y.Z` di `main`, run `ci` tag hijau →
ambil baris `PK_WEB_IMAGE` / `PK_MIGRATE_IMAGE` (ref@digest) dari job summary (§3) → deploy manual oleh infra Lead
(§6a). Job `deploy-prod.yml` (§6b) masih **INERT** sampai prasyaratnya (infra-deploy v2, environment `infra-deploy`,
secret, `PROD_DEPLOY_ENABLED=true`) terpenuhi. Migrasi web 0.5.0 (multi-PT) **tidak kompatibel mundur** — rollback =
restore dump pra-deploy (`CHANGELOG.md` [0.5.0]).

Pemeriksaan tambahan setelah upgrade:
- **Pengaturan → Perusahaan (PT)**, per PT: sakelar **"Absensi dari APK (termasuk offline) aktif"** (tab Absensi &
  retensi) dan **"Laporan progress dari APK (termasuk offline) aktif"** (tab Operasional) sesuai keputusan (keduanya
  bisa dimatikan untuk rollback fitur tanpa rollback image; `plans/fase1-golive.md` §11).
- **Pengaturan → Setting aplikasi → Versi APK minimum** ≤ versi APK yang beredar (bila lebih tinggi, semua HP
  terkunci di layar "Perbarui aplikasi"). Jangan naikkan ke 0.3.0 sebelum semua HP bisa memperbarui
  ([`rilis-apk.md`](rilis-apk.md) Prasyarat).
- APK: bila backend menambah field sinkron baru, rilis APK baru dulu atau bersamaan (lihat `apps/mobile/README.md`).
  APK ≥ 0.3.0 hanya diterbitkan setelah web ≥ 0.5.0 berjalan di lingkungan itu.

## 2. Rollback

- **Image saja** (migrasi kompatibel mundur): kembalikan tag di `.env` → `docker compose up -d` (staging: runbook
  onboarding §Langkah 5 "Rollback"; prod: [`ci-ghcr.md`](ci-ghcr.md) §7, `cp -p .env.prev .env`).
- **Skema tidak kompatibel** (mis. naik ke 0.5.0): restore dump pra-migrasi ke DB baru lalu tukar — destruktif,
  konfirmasi Lead/user.
- **Fitur saja tanpa rollback image:** matikan sakelar di **Perusahaan (PT)** PT terkait ("Absensi dari APK…",
  "Laporan progress dari APK…", "Pengingat aktif") atau aktifkan kembali aturan approval lama (ADR 0013 §Rollback —
  pengajuan yang sudah diajukan tetap memakai snapshot aturannya).
- **APK:** tidak ada "rollback" di HP; pasang ulang APK versi sebelumnya (ditandatangani kunci yang sama) atau
  naikkan/turunkan **Versi APK minimum**. APK prod dibangun job `release-prod` pada tag `mobile-vX.Y.Z` dan
  ditandatangani kunci prod ([`rilis-apk.md`](rilis-apk.md) Prasyarat).

## 3. Backup & restore

Sumber utama: `/opt/infra/docs/03-operations/backup.md` (restic, jadwal 01:30, `restore.sh`) dan ADR infra 0006.
Yang khusus ProyekKas:

| Objek | Nama | Masuk backup lewat |
|---|---|---|
| DB staging / prod | `pk_drms_stg` / `pk_drms` | `backup.sh` (daftar DB dinamis) |
| Media (nota, selfie, bukti transfer, foto progress, tanda tangan, logo, APK di `/unduh`) | volume `drms_pk_media_stg` / `drms_pk_media_prod` | `MEDIA_VOLUMES` di `scripts/lib/restic-common.sh` |
| Secret app | `/opt/infra/staging/drms-proyekkas/secrets/`; prod `./secrets/*.secret` di folder compose prod ([`ci-ghcr.md`](ci-ghcr.md) §5) | snapshot `files` (config) |

- Restore DB selalu ke **DB baru** dulu: `sudo /opt/infra/scripts/restore.sh pk_drms_stg pk_drms_stg_rb --owner pk_drms_stg_owner`.
- Konsistensi DB ↔ media: dump DB dan snapshot file tidak atomik; file tanpa baris DB **jangan dihapus otomatis**
  (ADR ProyekKas 0004 §Rollback/§Backup). Setelah restore, cocokkan jumlah baris `media-*` dengan file di volume.
- **Restore drill E9 (2026-09-26, staging):** `restore.sh pk_drms_stg pk_drms_restoretest --snapshot <id>` untuk DB +
  `restic restore <id> --target <dir> --include /var/lib/docker/volumes/drms_pk_media_stg/_data` untuk media →
  68 tabel / 2 078 baris, 58 sequence, 46 file media (sha256 + owner/mode) cocok; RTO terukur 6,1 s (target ≤ 4 jam).
  Langkah persis: [`../qa/s3-e9-qa-report.md`](../qa/s3-e9-qa-report.md) §3.1. Catatan dari laporan itu:
  - `restore.sh --filestore` hanya mengenal tata letak filestore Odoo → media ProyekKas dipulihkan dengan
    `restic restore --include <root volume>` (temuan R-1, usul opsi `--volume` di infra).
  - Data staging kecil → drill membuktikan prosedur, bukan kapasitas; ulangi pada `pk_drms` +
    `drms_pk_media_prod` setelah go-live (R-2).
  - Menyalin media hasil restore ke volume **live** tidak diuji (destruktif).
- Backup masih **di disk yang sama** sampai keputusan G1-6 (S3 offsite atau add-on Hostinger) diterapkan —
  wajib sebelum go-live (`plans/fase1-golive.md` §9 G1-6, risiko R8; laporan E9 §3.3 R-3).
- Retensi selfie (E6) menghapus file selfie lama dari volume; restore snapshot lama bisa **mengembalikan** selfie
  yang seharusnya sudah dihapus → setelah restore, pastikan di **setiap PT** (**Perusahaan (PT) → Absensi & retensi**)
  **"Hapus otomatis selfie melewati retensi (aktif)"** menyala (default **mati** = hanya menghitung) dan tunggu job
  harian 02:30 selesai sebelum membuka akses ke pengguna.

## 4. Rotasi kunci

Lihat [`rotasi-kunci.md`](rotasi-kunci.md).

## 5. Pencabutan perangkat

Lihat [`cabut-perangkat.md`](cabut-perangkat.md).

## 6. Tutup buku

Lihat [`tutup-buku.md`](tutup-buku.md). Sejak web 0.5.0 tutup buku berlaku **per PT** (satu layar = satu PT; menutup
PT A tidak mengunci PT B; Finance/Direktur di beberapa PT memilih PT di kartu **Pilih PT**) — lihat
[panduan Finance](../guides/finance.md) §6. Runbook `tutup-buku.md` (basis `c468bbe`) belum memuat hal ini dan masih
menyebut menu lama "Alur kerja → Tutup buku" serta §C cut-over "menyusul" (cut-over kini di
[`import-data-golive.md`](import-data-golive.md) §4).

## 7. Data go-live

[`import-data-golive.md`](import-data-golive.md): template Excel → dry-run staging sampai 0 error → akun Keycloak
(§3.2) → backup prod → dry-run + commit prod → verifikasi (§3.4) → langkah Keycloak bila pengguna dinonaktifkan
(§3.5). Cut-over (§4): saldo awal per akun = tanggal go-live, periode sebelum go-live ditutup, nomor PB pertama
**229** (Q-17). Beberapa PT (§4.1): sheet **Perusahaan** (`kode_pt`, `nomor_pb_mulai` per PT), kolom `kode_pt` di
sheet data per PT, sheet **AksesPT**; PT baru dibuat lengkap dengan penomoran dan aturan approval standar; cut-over
per PT. Contoh fiktif dua PT: `docs/proyekkas/templates/drms-impor-golive-contoh-fiktif-2pt.xlsx`.

## Riwayat dokumen

| Tanggal | Perubahan |
|---|---|
| 2026-09-26 | Versi awal (E12). |
| 2026-09-27 | Tambah #10 rilis APK ke `/unduh`. |
| 2026-09-30 | Basis `5415f45`: deploy/rollback prod → `ci-ghcr.md`; restore drill E9 (PASS) → laporan QA; impor go-live → `import-data-golive.md` (termasuk beberapa PT); setting per PT (Perusahaan) vs Setting aplikasi; #11 CI/GHCR; catatan tutup buku per PT. |
