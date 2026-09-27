# ProyekKas / DRMS — Indeks runbook operasi

- **Status:** draf E12 (Sprint S3 track D) · **Tanggal:** 2026-09-26 · **Basis kode:** `develop` @ `c468bbe`
- **Tujuan:** satu pintu masuk untuk tugas operasi ProyekKas. Dokumen ini **menautkan** runbook yang sudah ada
  (terutama di repo infra `/opt/infra`) dan hanya menulis prosedur baru bila belum ada di mana pun.
- **Pembaca:** infra Lead / operator VPS (deploy, rollback, restore, rotasi kunci) dan Admin/Finance/Direktur
  aplikasi (pencabutan perangkat, tutup buku).
- **Penanda:** **menyusul** = bergantung pekerjaan S3 yang belum di-merge ke `develop` pada tanggal dokumen ini
  (`feat/s3c-e10-ghcr-ci` GHCR + CI deploy, `feat/s3b-e11-data-import` alat impor, `feat/s3a-e9-hardening`
  signed media URL / reversal settlement / restore drill, dan infra prod E10). Jangan menjalankan langkah
  "menyusul" sebelum runbook terkait diperbarui.

> Aturan umum: semua perubahan pada container/Traefik/Keycloak/Postgres yang **dipakai bersama** dilakukan oleh
> atau dengan persetujuan **infra Lead** (lihat `/opt/infra/CLAUDE.md`). Langkah destruktif (menimpa DB, menghapus
> volume, `docker compose down -v`) selalu butuh konfirmasi eksplisit user.

## Ringkasan

| # | Tugas | Lingkungan | Runbook | Status |
|---|---|---|---|---|
| 1 | Deploy / upgrade aplikasi | staging | `/opt/infra/docs/runbooks/proyekkas-drms-onboarding.md` §Langkah 5 "Upgrade (image baru)" | tersedia |
| 1b | Deploy / upgrade aplikasi | **prod** | compose prod + image GHCR + job deploy CI ber-approval (E10) | **menyusul** |
| 2 | Rollback aplikasi | staging | runbook onboarding §Langkah 5 "Rollback" (tag image lama; restore dump bila skema tidak kompatibel) | tersedia |
| 2b | Rollback aplikasi | **prod** | pola sama dengan staging, tag GHCR ber-digest; rollback setelah cut-over = restore dump pra-migrasi (`plans/fase1-golive.md` §11) | **menyusul** |
| 3 | Backup & restore DB + media | semua | `/opt/infra/docs/03-operations/backup.md` §Restore, ADR infra `docs/adr/0006-backup.md` | tersedia (catatan di §3) |
| 3b | Restore drill ProyekKas (RTO ≤ 4 jam) | staging → DB uji | E9 restore drill `pk_drms_restoretest` | **menyusul** |
| 4 | Rotasi kunci & rahasia | semua | [`rotasi-kunci.md`](rotasi-kunci.md) (indeks per rahasia, menautkan runbook infra) | tersedia sebagian |
| 5 | Pencabutan perangkat / user hilang HP / karyawan keluar | aplikasi | [`cabut-perangkat.md`](cabut-perangkat.md) | tersedia |
| 6 | Tutup buku bulanan & buka kembali | aplikasi | [`tutup-buku.md`](tutup-buku.md) | tersedia |
| 7 | Data go-live (impor master, saldo awal, nomor PB mulai 229) | prod | E11 alat impor (dry-run → commit) | **menyusul** |
| 8 | Monitoring & alert | semua | `/opt/infra/docs/03-operations/observability.md` (Uptime Kuma monitor staging sudah ada: runbook onboarding §Langkah 5) | staging tersedia, prod **menyusul** |
| 9 | Keycloak realm `drms` (user, SMTP, brute-force) | semua | `/opt/infra/docs/03-operations/keycloak.md`, runbook onboarding §Langkah 3 | tersedia |

## 1. Deploy / upgrade

**Staging (berlaku sekarang).** Ikuti runbook onboarding §Langkah 5 "Upgrade (image baru)":
tag image baru (jangan menimpa tag lama) → `backup.sh run` (dump sebelum migrasi) → ubah `PK_WEB_IMAGE` /
`PK_MIGRATE_IMAGE` di `.env` → `docker compose up -d` → cek `docker compose ps -a` (migrate `Exited (0)`),
log migrate, `curl …/api/v1/health` = 200. Catat setiap upgrade di bagian "Catatan" runbook onboarding
(pola yang sudah dipakai: tanggal, tag, nama file dump pra-migrasi, perintah rollback).

Pemeriksaan tambahan setelah upgrade yang memuat migrasi F5/E-epik (dari pengalaman S2):
- Setting perusahaan: status sakelar **"Absensi dari APK (termasuk offline) aktif"** dan **"Laporan progress
  dari APK (termasuk offline) aktif"** sesuai keputusan (keduanya bisa dimatikan untuk rollback fitur tanpa
  rollback image; `plans/fase1-golive.md` §11).
- **Versi APK minimum** di Setting perusahaan ≤ versi APK yang beredar (bila lebih tinggi, semua HP terkunci di
  layar "Perbarui aplikasi").
- APK: bila backend menambah field sinkron baru, rilis APK baru dulu atau bersamaan (lihat `apps/mobile/README.md`).

**Prod — menyusul (E10, `feat/s3c-e10-ghcr-ci`).** Yang sudah diputuskan (`plans/fase1-golive.md` §E10): image
dibangun di runner GitHub dan di-push ke **GHCR** dengan tag semver, deploy lewat job CI manual ber-approval
(`infra-deploy`), compose `deploy/prod/docker-compose.yml` (web `drms-pk-web` 384 MiB, worker 192 MiB), host
`drms-kas.bimacreative.tech`, realm `drms`. Runbook prod ditulis setelah branch tersebut dan paket infra prod
di-merge; sampai saat itu **tidak ada** deploy prod.

## 2. Rollback

- **Image saja** (migrasi kompatibel mundur): kembalikan tag di `.env` → `docker compose up -d` (runbook onboarding
  §Langkah 5 "Rollback").
- **Skema tidak kompatibel:** restore dump pra-migrasi ke DB baru lalu tukar — destruktif, konfirmasi Lead/user.
- **Fitur saja tanpa rollback image:** matikan sakelar di Setting perusahaan ("Absensi dari APK…", "Laporan progress dari APK…",
  "Pengingat aktif") atau aktifkan kembali aturan approval lama (ADR 0013 §Rollback — pengajuan yang sudah
  diajukan tetap memakai snapshot aturannya).
- **APK:** tidak ada "rollback" di HP; pasang ulang APK versi sebelumnya (ditandatangani kunci yang sama) atau
  naikkan/turunkan **Versi APK minimum**. Rilis APK prod bertanda tangan kunci prod **menyusul** (E3-c).

## 3. Backup & restore

Sumber utama: `/opt/infra/docs/03-operations/backup.md` (restic, jadwal 01:30, `restore.sh`) dan ADR infra 0006.
Yang khusus ProyekKas:

| Objek | Nama | Masuk backup lewat |
|---|---|---|
| DB staging / prod | `pk_drms_stg` / `pk_drms` | `backup.sh` (daftar DB dinamis) |
| Media (nota, selfie, bukti transfer, foto progress, tanda tangan, logo) | volume `drms_pk_media_stg` / `drms_pk_media_prod` | `MEDIA_VOLUMES` di `scripts/lib/restic-common.sh` |
| Secret app | `/opt/infra/staging/drms-proyekkas/secrets/` (prod: menyusul) | snapshot `files` (config) |

- Restore DB selalu ke **DB baru** dulu: `sudo /opt/infra/scripts/restore.sh pk_drms_stg pk_drms_stg_rb --owner pk_drms_stg_owner`.
- Konsistensi DB ↔ media: dump DB dan snapshot file tidak atomik; file tanpa baris DB **jangan dihapus otomatis**
  (ADR ProyekKas 0004 §Rollback/§Backup). Setelah restore, cocokkan jumlah baris `media-*` dengan file di volume.
- `restore.sh --filestore` dirancang untuk tata letak filestore Odoo; pemakaiannya untuk volume media ProyekKas
  **belum diuji** → diverifikasi dalam restore drill E9 (**menyusul**, target RTO ≤ 4 jam, DB uji
  `pk_drms_restoretest`).
- Backup masih **di disk yang sama** sampai keputusan G1-6 (S3 offsite atau add-on Hostinger) diterapkan —
  wajib sebelum go-live (`plans/fase1-golive.md` §9 G1-6, risiko R8).
- Retensi selfie (E6) menghapus file selfie lama dari volume; restore snapshot lama bisa **mengembalikan** selfie
  yang seharusnya sudah dihapus → setelah restore, pastikan **Setting perusahaan → "Hapus otomatis selfie melewati
  retensi (aktif)"** menyala (default **mati** = hanya menghitung) dan tunggu job harian 02:30 selesai sebelum membuka
  akses ke pengguna.

## 4. Rotasi kunci

Lihat [`rotasi-kunci.md`](rotasi-kunci.md).

## 5. Pencabutan perangkat

Lihat [`cabut-perangkat.md`](cabut-perangkat.md).

## 6. Tutup buku

Lihat [`tutup-buku.md`](tutup-buku.md).

## 7. Data go-live — menyusul

Alat impor idempoten (dry-run → laporan error → commit, audit `import`) dari template Excel per master sedang
dikerjakan di `feat/s3b-e11-data-import`. Yang sudah pasti (`plans/fase1-golive.md` §E11): nomor pengajuan
prod dimulai **229** (`document-sequences` → PB → nomor awal), tanggal saldo awal = tanggal go-live, periode
sebelum go-live ditutup (lihat [`tutup-buku.md`](tutup-buku.md)). Runbook cut-over ditulis setelah branch
di-merge.

## Riwayat dokumen

| Tanggal | Perubahan |
|---|---|
| 2026-09-26 | Versi awal (E12). |
