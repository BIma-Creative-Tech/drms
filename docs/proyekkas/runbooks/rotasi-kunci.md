# Runbook — Rotasi kunci & rahasia ProyekKas

- **Status:** draf E12 · **Tanggal:** 2026-09-26 · **Basis:** `develop` @ `c468bbe`, `deploy/staging/docker-compose.yml`,
  `apps/web/src/lib/env.ts` (`FILE_SECRETS`), `.github/workflows/mobile.yml`, ADR 0003/0004/0010/0012.
- **Pelaksana:** infra Lead (rahasia di VPS/Keycloak/Postgres) · pemilik repo GitHub (secret CI) · 2 custodian kunci
  APK (klien + vendor, ADR 0010 keputusan 13).
- **Kapan:** (a) terjadwal — lihat kolom "Frekuensi usulan"; (b) **segera** bila ada dugaan bocor (laptop hilang,
  mantan staf vendor, rahasia ter-commit, log berisi rahasia).

Prinsip: satu rahasia sekali rotasi; catat tanggal & alasan di bagian "Catatan" runbook onboarding infra
(tanpa nilai rahasia); jangan pernah menulis nilai rahasia di repo, tiket, atau chat.

## Daftar rahasia

| # | Rahasia | Lokasi (staging; prod = pola sama, **menyusul** E10) | Dampak saat dirotasi | Frekuensi usulan | Prosedur |
|---|---|---|---|---|---|
| R1 | Password role DB `pk_drms_stg_{owner,app,ro}` (dalam DSN `database_url_{owner,app}.secret`) | `postgres/.env` infra + `/opt/infra/staging/drms-proyekkas/secrets/` | web/worker restart ±15 s | 12 bulan / bila bocor | §A |
| R2 | `payload_secret` (Payload + kunci enkripsi cookie transaksi login OIDC, `auth/oidc.ts:50`) | `secrets/payload_secret.secret` | Pengguna yang **sedang** di tengah proses login harus mengulang login; sesi web berjalan disimpan sebagai hash di DB (ESTIMASI: tidak terputus — verifikasi di staging) | 12 bulan / bila bocor | §B |
| R3 | Secret client OIDC web `proyekkas-web` | Keycloak realm `drms-staging`/`drms` + `secrets/oidc_web_client_secret.secret` | Login web baru gagal sampai file app diperbarui (jendela beberapa menit) | 12 bulan / bila bocor | §C |
| R4 | Secret client Admin API `proyekkas-admin-api` (sinkron user, cabut sesi) | Keycloak + `secrets/kc_admin_client_secret.secret` | Selama jendela: nonaktifkan user / cabut sesi dari panel gagal | 12 bulan / bila bocor | §C |
| R5 | `smtp_password` (email notifikasi) | `secrets/smtp_password.secret` + akun mail infra | Email tertunda selama jendela | ikut kebijakan mail infra | §D |
| R6 | Password repo restic | `/etc/restic/password` | tidak ada | bila bocor | `/opt/infra/docs/03-operations/backup.md` §Rotasi password repo |
| R7 | Kunci penandatangan APK **staging** | GitHub secret `ANDROID_STAGING_KEYSTORE_B64`, `…_PASSWORD`, `…_KEY_ALIAS`; server `ANDROID_APP_CERT_SHA256` | **Semua HP uji harus uninstall + install ulang** (Android menolak update dengan tanda tangan berbeda) | hanya bila bocor | §E |
| R8 | Kunci penandatangan APK **prod** | GitHub environment secret `ANDROID_KEYSTORE_*`, cadangan offline 2 custodian | Sama dengan R7 tetapi di HP karyawan → hindari; rotasi = rilis APK baru + instal ulang terkoordinasi | hanya bila bocor | **menyusul** (E3-c) |
| R9 | Kunci HMAC signed media URL (ADR 0004 §4, rotasi lewat env dengan 2 kunci tumpang-tindih) | env web | URL media lama (TTL 5 menit) kedaluwarsa lebih cepat | 12 bulan | **menyusul** (E9, `feat/s3a-e9-hardening`) |
| R10 | Kunci Firebase / service account FCM | — | — | — | **menyusul** (E8, bergantung Firebase klien) |
| R11 | Password pengguna aplikasi | Keycloak realm (bukan ProyekKas) | — | kebijakan realm | Admin mengirim reset lewat Keycloak; lihat `/opt/infra/docs/03-operations/keycloak.md` |

## A. Password role DB (R1)

Ikuti `/opt/infra/docs/03-operations/postgres.md` §Rotasi password untuk `ALTER ROLE … PASSWORD`, lalu:
1. Tulis ulang DSN (password di-URL-encode): `printf '%s' 'postgres://pk_drms_stg_app:<pw>@postgres:5432/pk_drms_stg' > secrets/database_url_app.secret`
   (sama untuk `database_url_owner.secret`), `chown 1001:1001`, `chmod 0400`.
2. `docker compose up -d --force-recreate drms-pk-stg drms-pk-stg-worker` (runbook onboarding §Langkah 5 "Secret salah/berubah").
3. Verifikasi: `curl …/api/v1/health` = 200; `pg_stat_activity` hanya menampilkan role app.
Role `owner` hanya dipakai container migrate; rotasinya berlaku pada deploy berikutnya.

## B. `payload_secret` (R2)

1. `openssl rand -hex 32` → tulis ke `secrets/payload_secret.secret` (tanpa newline, 1001:1001, 0400).
2. Recreate web + worker (seperti §A langkah 2). Container migrate membaca secret yang sama saat deploy berikutnya.
3. Verifikasi: login web SSO berhasil; buka satu pengajuan; APK tetap berfungsi (APK tidak memakai secret ini).
4. Uji dampak pada sesi berjalan **di staging dulu** sebelum melakukannya di prod.

## C. Secret client Keycloak (R3, R4)

1. Konsol admin Keycloak (akses lewat tunnel: `/opt/infra/docs/03-operations/keycloak.md` §Akses admin console) → realm
   `drms-staging` (prod: `drms`) → Clients → `proyekkas-web` / `proyekkas-admin-api` → Credentials → **Regenerate**.
2. Salin ke `identity/keycloak/secrets/drms-staging-proyekkas-{web,admin-api}.secret` dan ke file app
   `secrets/oidc_web_client_secret.secret` / `kc_admin_client_secret.secret` (1001:1001, 0400).
3. Recreate web + worker. Verifikasi: login web; di panel admin, ubah status aktif satu user uji (memanggil Admin API)
   dan cek Audit Log tidak mencatat kegagalan.
4. Client APK `proyekkas-mobile` adalah client publik (tanpa secret) — tidak dirotasi.

## D. Password SMTP (R5)

Ikuti `/opt/infra/docs/03-operations/mail.md` untuk akun pengirim; tulis `secrets/smtp_password.secret`, recreate
web + worker, lalu kirim satu notifikasi uji (mis. ajukan pengajuan uji → email ke Direktur uji).

## E. Kunci APK staging (R7)

1. Buat keystore baru (`keytool -genkeypair …`), simpan cadangan offline.
2. Perbarui secret GitHub `ANDROID_STAGING_KEYSTORE_B64`, `ANDROID_STAGING_KEYSTORE_PASSWORD`, `ANDROID_STAGING_KEY_ALIAS`
   (dan password key bila dipisah).
3. Jalankan workflow `mobile`; catat SHA-256 sertifikat yang dicetak langkah "Decode staging keystore".
4. Perbarui `ANDROID_APP_CERT_SHA256` di `.env` staging (Digital Asset Links, `lib/assetlinks.ts`) → recreate web.
5. Umumkan ke penguji: **uninstall** "ProyekKas STG" lalu instal APK baru; antrean offline yang belum terkirim di HP
   **hilang** saat uninstall — minta penguji mengirim antrean dulu (layar **Antrean kirim** → **Kirim sekarang**).

## Riwayat dokumen

| Tanggal | Perubahan |
|---|---|
| 2026-09-26 | Versi awal (E12). |
