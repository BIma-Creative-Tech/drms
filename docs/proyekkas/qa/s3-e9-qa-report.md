# ProyekKas — Laporan QA E9 (Sprint S3): ZAP baseline, load test, restore drill

> **Pembaruan 2026-09-27:** load test & ZAP **terautentikasi** dengan akun uji beban `lt-*` — lihat §7 (menggantikan
> blocker BLK-1 di §2.1/§2.5). **Uji ulang 2026-09-27 siang** pada build `dc80237` (antrean resize, B-1, B-2) — §7.7.

- **Tanggal:** 2026-09-26, 23:08–23:30 WIB · **Penguji:** agen QA (Claude) atas permintaan Lead ProyekKas
- **Target:** staging `https://drms-kas.staging.bimacreative.tech` (Traefik v3 + CrowdSec bouncer/AppSec, Keycloak realm
  `drms-staging`), image `ghcr.io/bctech-adm/proyekkas-web:0.2.1-stg-13b1f05` (web `drms-pk-stg` 384 MiB, worker
  `drms-pk-stg-worker` 192 MiB), DB `pk_drms_stg` di container `postgres` (cluster bersama DB prod).
  Container web/worker di-(re)deploy 23:06 WIB (sebelum pengujian; `RestartCount=0`, tidak ada OOM selama pengujian).
- **Dasar AC:** `plans/fase1-golive.md` §E9 dan §6 (aturan RAM web > 80% limit ≈ 307 MiB → flag).
- **Alat:** ZAP 2.17.0 (`zaproxy/zap-stable@sha256:781a2bda…`), k6 v2.3.0 (`grafana/k6@sha256:e66db15b…`),
  restic 0.19.1 + `/opt/infra/scripts/restore.sh` (infra ADR 0006), PostgreSQL 16.15, CrowdSec v1.8.1.
- **Bukti mentah:** `s3-e9-evidence/` (laporan ZAP Markdown + cek header manual). Skrip k6:
  `apps/web/tests/load/q34-mix.js` (+ `fixtures/`).

## 0. Ringkasan

| AC E9 | Hasil | Status |
|---|---|---|
| Tidak ada temuan HIGH/CRITICAL terbuka | ZAP baseline pasif tanpa login (26/9, 2 run) **dan terautentikasi** (27/9, 1 akun lapangan + 1 akun Direktur, 142 / 837 URL): **0 FAIL, 0 High/Critical**. Medium hanya CSP `style-src 'unsafe-inline'` (diterima) dan "Absence of Anti-CSRF Tokens" (false positive, §7.4). Bug baru B-1 (500 pada body non-JSON, Low). | **PASS** |
| Load test (Q-34: 30 lapangan + 5 kantor, termasuk unggah foto/selfie): **unggahan p95 < 5 s** (latar belakang, keputusan user 2026-09-27), **aksi lain p95 < 2 s** | **Uji ulang 27/9 pada `dc80237` (§7.7):** unggah selfie 1,43 s, nota 2,84 s, foto progress 2,04 s → lulus (< 5 s); laporan progress **1,67 s** (sebelumnya 2,71 s) dan semua aksi baca < 1 s → lulus; **draft Reimburse (`/sync/batch`) 2,66 s → masih > 2 s**. 0× 503 `UPLOAD_BUSY`, error 0%, 0× 429. Run pertama (sebelum antrean) di §7.3. | **FAIL tipis** — 1 aksi (draft Reimburse sync) di atas 2 s; uji `IMAGE_RESIZE_CONCURRENCY=1` belum bisa tanpa ubah compose staging (P-1b) |
| RAM puncak web/worker < 80% limit | Run 1 (tanpa antrean): web **189,5 / 384 MiB (49,3%)**, worker 70,1 / 192 MiB (36,5%). Uji ulang `dc80237`: web **150,5 MiB (39,2%)**, worker **61,4 MiB (32,0%)**; di bawah ambang flag 307 MiB. | **PASS** |
| Restore drill `pk_drms_restoretest` (DB + media) < 4 jam, jumlah baris & checksum media cocok | RTO terukur **6,1 s** (DB 5,1 s + media 0,7 s + verifikasi 0,3 s); **68 tabel / 2 078 baris cocok**, **58 sequence cocok**, **46 file media sha256 + owner/mode cocok**. DB uji & direktori sementara dihapus. | **PASS** |

**Keputusan user 2026-09-27 (P-1, §7.3.3):** resize gambar **diantre** di proses web (maks 2 job sharp bersamaan,
`IMAGE_RESIZE_CONCURRENCY`; antrean penuh → 503 + `Retry-After`, APK mencoba ulang di latar belakang), `cpus` web tetap;
target AC menjadi **unggahan p95 < 5 s**, **aksi lain p95 < 2 s**. Ulangi load test terautentikasi setelah deploy.
Bagian §1–§6 = run 26/9 (tanpa login); §7 = run terautentikasi 27/9.

## 1. ZAP baseline (pasif)

### 1.1 Persiapan CrowdSec (sebelum scan/load)

- `docker exec crowdsec cscli decisions list` sebelum uji: hanya `34.84.88.4` (pihak luar, `http-probing`,
  `http-sensitive-files`, `appsec-native`) — bukan dari VPS.
- Parser `crowdsecurity/whitelists` aktif (`/etc/crowdsec/parsers/s02-enrich/whitelists.yaml`, IP privat). Lalu lintas
  dari host ke `drms-kas.staging…` (hairpin ke IP publik VPS) tiba di Traefik sebagai **`10.100.0.1`** (gateway network
  `proxy`, `docs/03-operations/crowdsec.md`) → alert AppSec tetap tercatat tetapi **tanpa decision/ban**.
- Rate limit Traefik per IP sumber berlaku untuk **semua VU bersama** (satu IP hairpin): `ratelimit-pk-api` 20/s burst 40
  (`/api/v1`), `ratelimit-default` 50/s burst 100, `ratelimit-login` 10/menit (`/auth/*`), token Keycloak DRMS 60/menit
  burst 30. Beban Q-34 berjeda (≈ 4,3 req/s total) jauh di bawahnya.
- Sesudah semua uji: `cscli decisions list` tetap hanya `34.84.88.4`; `cscli alerts list --since 30m` berisi 9 alert
  AppSec dari `10.100.0.1` (probe manual §1.4: TRACE/TRACK/PROPFIND, `/.git/HEAD`, `/.env`, path traversal) — **alert
  saja, tanpa decision**. Tidak ada decision yang perlu dihapus.

### 1.2 Perintah

```bash
S=<scratch>; mkdir -p $S/zap && chmod 777 $S/zap
# run 1: dari root
docker run -d --name e9qa-zap-unauth --network host -v $S/zap:/zap/wrk:rw zaproxy/zap-stable \
  zap-baseline.py -t https://drms-kas.staging.bimacreative.tech/ -m 3 -r unauth.html -J unauth.json -w unauth.md -I
# run 2: dari halaman login panel, + AJAX spider (root = 404 sehingga spider run 1 hanya menemukan sedikit URL)
docker run -d --name e9qa-zap-admin --network host -v $S/zap:/zap/wrk:rw zaproxy/zap-stable \
  zap-baseline.py -t https://drms-kas.staging.bimacreative.tech/admin/login -m 3 -j -r admin.html -J admin.json -w admin.md -I
docker rm e9qa-zap-unauth e9qa-zap-admin
```

Run 2: 37 URL; kedua run `FAIL-NEW: 0 · WARN-NEW: 4/5 · PASS: 63/62`. Laporan: `s3-e9-evidence/zap-baseline-*.md`.

### 1.3 Pemindaian terautentikasi — tidak dijalankan

Kata sandi akun uji `*.uji@proyekkas.test` sengaja tidak dicatat (`uat/fase1/README.md` §Akun uji: "fasilitator
membagikannya secara terpisah"; `f4/f4-e2e-scenario.md`: "kata sandi sesuai yang Anda simpan"; `uat/f2-uat-report.md`:
suite Playwright + secret per-run di workspace Lead, di luar repo). Sesuai instruksi, QA **tidak** mereset password dan
**tidak** membuat user Keycloak. Akun juga memakai TOTP (F2 UAT: required action password + TOTP), sehingga cookie/bearer
untuk ZAP butuh login interaktif oleh pemegang akun. → Jalankan ulang dengan `-z "-config replacer…"` (header
`Authorization: Bearer <token proyekkas-mobile>` + `X-Device-Id`) atau cookie sesi web setelah kredensial tersedia.

### 1.4 Triase temuan

| # | Sumber | Temuan | Risiko ZAP | Triase | Severity akhir | Tindak lanjut |
|---|---|---|---|---|---|---|
| Z-1 | ZAP 10055 | CSP `style-src 'self' 'unsafe-inline'` (semua halaman HTML) | Medium | True positive, **deviasi diterima** (keputusan user 2026-09-23, Payload admin butuh inline style); `script-src` memakai nonce, tanpa `unsafe-inline`/`unsafe-eval`, `object-src 'none'`, `frame-ancestors 'none'` | Low (diterima) | Tidak ada; tetap tercatat di ASVS 5.3.3/14.4.3. |
| Z-2 | ZAP 90004 | `Cross-Origin-Resource-Policy` tidak ada pada aset `/_next/static/*` dan font | Low | True positive, dampak kecil (aset publik tanpa data) | Low | Opsional: `Cross-Origin-Resource-Policy: same-origin` di `next.config.ts` `headers()` (nextjs). |
| Z-3 | ZAP 90004 | `Cross-Origin-Embedder-Policy` tidak ada di `/admin/login` | Low | Informasional untuk aplikasi ini (tidak memakai `SharedArrayBuffer`/isolasi lintas origin); COOP `same-origin` sudah ada | Info | Tidak perlu. |
| Z-4 | ZAP 10019 | `Content-Type` tidak ada pada respons 302 `/admin` (gate E9) | Info | True positive, body 72 byte teks redirect; tanpa dampak keamanan | Info | Opsional (nextjs). |
| Z-5 | ZAP 10049 / 10109 | Konten non-storable / storable; "Modern Web Application" | Info | Informasional: HTML `no-store`, aset hash `max-age=31536000` — sesuai harapan | Info | — |
| M-1 | Manual | HSTS `max-age=604800` (7 hari), tanpa `includeSubDomains` (middleware Traefik `security-headers`) | — | True positive vs ASVS 14.4.5 (contoh ASVS `max-age=15724800; includeSubDomains`) | Low | [infra] naikkan `stsSeconds` ≥ 15 552 000 (180 hari) untuk prod (E10), pertimbangkan `includeSubDomains` setelah semua subdomain HTTPS. |
| M-2 | Manual | TLS: hanya 1.2/1.3 (TLS 1.0/1.1 ditolak), tetapi TLS 1.2 masih menerima suite CBC-SHA/non-PFS (`ECDHE-RSA-AES128-SHA`, `AES128-SHA256`) — default Traefik | — | True positive (ASVS 9.1.2 "cipher kuat") | Low | [infra] `tls.options` default: `minVersion VersionTLS12` + daftar `cipherSuites` hanya AEAD/ECDHE (platform-wide, perlu keputusan infra Lead). |
| M-3 | Manual | REST generik Payload `/api/<slug>` (mis. `/api/users`, `/api/users/me`) tanpa header `Cache-Control` | — | True positive (G-08 terkonfirmasi); `/api/v1` sudah `no-store`, HTML admin `private, no-cache, no-store` | Low | nextjs: `Cache-Control: no-store` untuk `/api/:path*` di `next.config.ts` `headers()`. |
| M-4 | Manual | `/api/*` mengirim `Access-Control-Allow-Headers/Methods` (default Payload) tetapi **tanpa** `Access-Control-Allow-Origin`, termasuk untuk `Origin: https://evil.example` | — | False positive untuk CORS (browser menolak tanpa ACAO) | Info | — |
| M-5 | Manual | Akses REST generik tanpa sesi (403) dicatat app sebagai `warn` lengkap dengan stack trace | — | Log noise, bukan kebocoran (tidak ada token/body/PII) | Info | Opsional: log 401/403 tanpa stack (nextjs). |

Cek manual lain (semua sesuai harapan, detail `s3-e9-evidence/manual-header-checks.txt`): `X-Frame-Options: DENY`,
`nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, `X-Request-Id`; **tidak ada** header `Server`/`X-Powered-By`;
`/.git/HEAD`, `/.git/config`, `/.env`, `/package.json` → 403 (WAF), `/server.js` → 404; TRACE/TRACK/PROPFIND/PUT/DELETE
ke `/admin/login` → 403 (WAF), OPTIONS → 400; `/api/v1/*` 401 = `application/problem+json` generik, rute tak dikenal = 404 JSON Payload `Route not found` (tanpa stack);
parameter ganda `?version=1.0.0&version=abc` → nilai terakhir dipakai lalu divalidasi zod (400).

**Kesimpulan ZAP:** tidak ada HIGH/CRITICAL pada permukaan tanpa login. 3 Low (M-1, M-2 infra; M-3 nextjs) + 1 Low
diterima (Z-1).

## 2. Load test (k6)

### 2.1 Blocker kredensial

Mode terautentikasi (password grant client `proyekkas-mobile`, realm `drms-staging`, ADR 0012 — staging saja) **tidak
dijalankan**: kredensial akun uji tidak tersedia di lokasi yang terdokumentasi (lihat §1.3). Selain itu, walaupun
kata sandi tersedia:

1. **Hanya 4–6 akun uji** (Staff, PM, Finance, Direktur, Admin, Finance 2). 30 VU lapangan yang berbagi 1 akun Staff akan
   terkena rate limit **per user** di aplikasi (`/sync/batch` 12/menit, unggah 60/menit — `v1()` `rateLimit`) → 429
   buatan yang tidak mewakili 30 orang. Q-34 butuh **≥ 30 akun lapangan fiktif** (+ 5 kantor) yang ditugaskan ke
   PRJ-UJI-01 — membuat user Keycloak/app = keputusan Lead/user (bukan wewenang QA).
2. Bila akun ber-TOTP, password grant butuh parameter `totp` per login (kode 30 s) → akun load test sebaiknya tanpa OTP
   di realm staging, atau Lead menyediakan kode saat run.
3. Prasyarat data: `syncAttendanceEnabled` & `syncProgressReportsEnabled` aktif, `PROJECT_ID`/`STAGE_ID` PRJ-UJI-01,
   titik geofence (`LAT`/`LNG`).

### 2.2 Skenario (skrip `apps/web/tests/load/q34-mix.js`)

| Grup | VU | `MODE=auth` (disiapkan, belum dijalankan) | `MODE=anon` (dijalankan) |
|---|---:|---|---|
| Lapangan | 30 | login sekali/VU + token reuse (refresh), register device, `/me`, `/masters`, lalu acak: 35% selfie (`POST /media/selfies`, 84 KB, 720×960) + `attendance.check_in` via `/sync/batch`; 30% 1–3 foto progress (`POST /media/progress-photos`, 295 KB, 1600×1200) + `progress_report.draft_upsert`; 35% draft pengajuan + `draft_delete` (bersih sendiri) + daftar pengajuan; jeda 20–40 s | `GET /api/v1/health`, `GET /api/v1/app/config` (publik, baca DB), `GET /api/v1/masters` (401), `POST /api/v1/media/selfies` multipart 84–295 KB tanpa token (401, lewat `buffering-pk` + parser multipart) |
| Kantor | 5 | `/dashboard/finance`, `/dashboard/owner`, `/approvals/inbox`, `/transfer-queue`, `/reports/{rekap-kas,rekap-pengajuan,anggaran-project,absensi}` | `GET /admin` (gate 302), `GET /admin/login` (SSR panel Payload ≈ 56 KB), `GET /api/v1/approvals/inbox` (401) |

Profil: ramp 1 menit → tahan 8 menit → turun 30 s (≈ 10 menit total), batas Q-34 (tidak dinaikkan). Gambar uji
sintetis (gradasi + noise, dibuat dengan `sharp` dari image app), ukuran mengikuti target kompresi APK
(`apps/mobile/lib/core/media/compress_plan.dart`: foto ≤ 400 KB/1600 px, selfie ≤ 150 KB/720 px).

```bash
S=<scratch>/k6; mkdir -p $S/out && chmod 777 $S/out
docker run -d --name e9qa-k6-anon --network host \
  -v /opt/src/proyekkas-wt/e9qa/apps/web/tests/load:/load:ro -v $S/out:/out:rw -e MODE=anon \
  grafana/k6 run --quiet /load/q34-mix.js
# pemantau (tiap 5 s): docker stats drms-pk-stg, worker, postgres, traefik, crowdsec, keycloak, odoo-pool-a,
# web-expomedia-prod, control-plane + /proc/loadavg + probe prod https://cp.bimacreative.tech/ dan
# https://auth.bimacreative.tech/realms/platform/.well-known/openid-configuration
# Nanti (auth): -e MODE=auth -e FIELD_USERS='[…]' -e OFFICE_USERS='[…]' -e PROJECT_ID= -e STAGE_ID= -e LAT= -e LNG=
```

### 2.3 Hasil `MODE=anon` (23:14:59–23:24:50 WIB)

2 566 request (4,35 req/s), 674 iterasi, **checks 100%**, `act_errors` 0%, **HTTP 429: 0**, 403 WAF: 0.
(`http_req_failed` 46,5% = status 401/302 yang memang diharapkan.)

| Aksi | n | p50 | p95 | maks |
|---|---:|---:|---:|---:|
| `GET /api/v1/health` | 508 | 10 ms | 25 ms | 112 ms |
| `GET /api/v1/app/config` (publik, DB) | 508 | 11 ms | 27 ms | 212 ms |
| `GET /admin/login` (SSR panel) | 178 | 44 ms | **109 ms** | 562 ms |
| `GET /admin` → 302 | 178 | 8 ms | 15 ms | 75 ms |
| API tanpa token → 401 | 686 | 10 ms | 25 ms | 65 ms |
| Unggah multipart tanpa token → 401 | 508 | 20 ms | 46 ms | 304 ms |
| Aksi utama terautentikasi (check-in, progress + foto, draft, dashboard, inbox, laporan) | 0 | — | — | — (blocker §2.1) |

### 2.4 Sumber daya (sampel 5 s, 87 sampel)

| Container | Awal | Puncak | % limit | CPU puncak |
|---|---:|---:|---:|---:|
| `drms-pk-stg` (web, 384 MiB) | 91,2 MiB | **111,7 MiB** | **29,1%** (ambang flag 307 MiB) | 33% |
| `drms-pk-stg-worker` (192 MiB) | 59,1 MiB | **69,9 MiB** | **36,4%** | 8% |
| `postgres` (2 GiB) | 204,6 MiB | 212,4 MiB | 10,4% | 13% |
| `traefik` (256 MiB) | 71,0 MiB | 102,6 MiB | 40,1% | 13% |
| `crowdsec` (384 MiB) | 115,6 MiB | 150,6 MiB | 39,2% | 31% |
| `keycloak` / `odoo-pool-a` / `web-expomedia-prod` / `control-plane` | — | tidak berubah berarti | ≤ 31% | ≤ 26% |

Load average host (4 vCPU) maks **1,85**. Probe prod (174 sampel): semua 200/307, p50 44 ms, p95 77 ms, maks 201 ms →
**tidak ada degradasi prod**, run tidak perlu dibatalkan. Log app selama run: tidak ada `error`, tidak ada token/
`Authorization`/password (ASVS 7.1.2 — sampel kecil).

**Catatan:** RAM web tanpa beban sharp jauh di bawah ambang. Spike F1 (ADR 0002 §6) mencatat puncak 205 MiB untuk 10 VU +
foto 12 MP; jalur unggah terautentikasi (resize foto progress/selfie) adalah risiko RAM utama yang **belum** diukur di E9.

### 2.5 Yang dibutuhkan untuk menutup AC load test

1. Lead/user: sediakan akun uji staging untuk beban (usulan: 30 akun lapangan fiktif `lapangan01…30.uji@proyekkas.test`
   + 5 kantor, peran sesuai, ditugaskan ke PRJ-UJI-01, **tanpa OTP** di realm staging atau dengan cara TOTP yang disepakati)
   dan serahkan kredensial lewat env run (bukan repo).
2. Admin staging: aktifkan `syncAttendanceEnabled` + `syncProgressReportsEnabled`; catat `PROJECT_ID`, `STAGE_ID`, titik
   geofence.
3. QA: `MODE=auth` sesuai §2.2 sambil memantau RAM; bila web > 307 MiB → flag sesuai §6 rencana (naik 512 MiB setelah
   persetujuan user, atau resize dipindah ke worker).
4. Data uji yang akan tercipta: absensi (1 check-in/akun/hari), laporan progress + foto, draft pengajuan yang langsung
   dibatalkan. Laporan progress tidak bisa dihapus lewat app (by design) → dicatat, data staging fiktif.

Data uji yang dibuat run ini: **tidak ada** (semua request anon ditolak sebelum menulis data).

## 3. Restore drill (DB + media)

### 3.1 Langkah & perintah

1. Snapshot keadaan live (jumlah baris per tabel semua skema non-sistem, sha256 semua file media volume
   `drms_pk_media_stg`).
2. Backup baru memakai tooling platform (prosedur manual resmi `backup.md` §Menjalankan manual):
   `systemctl start restic-backup.service` 23:10:43 → `RESULT status=ok dbs_ok=10` 23:11:02; snapshot
   `c35a41c3` (`db:pk_drms_stg`, 1,344 MiB) dan `38682a6d` (`files`, termasuk volume media).
3. Keadaan live diukur ulang setelah backup → **identik** dengan langkah 1 (staging diam), jadi pembanding sah.
4. Restore terukur (RTO):
   ```bash
   /opt/infra/scripts/restore.sh pk_drms_stg pk_drms_restoretest --snapshot c35a41c3
   #   → RESULT status=ok db=pk_drms_stg target=pk_drms_restoretest snapshot=c35a41c3 seconds=4
   restic restore 38682a6d --target <scratch>/drill/media-restore \
     --include /var/lib/docker/volumes/drms_pk_media_stg/_data      # 56 file/dir, 413 KiB
   ```
5. Verifikasi, lalu `DROP DATABASE pk_drms_restoretest` (dicek: 0 baris di `pg_database`) dan hapus direktori sementara.

### 3.2 Hasil

| Pemeriksaan | Live | Restore | Hasil |
|---|---:|---:|---|
| Tabel (semua skema non-sistem) | 68 | 68 | cocok |
| Total baris (`count(*)` per tabel, dibandingkan per tabel) | 2 078 | 2 078 | **cocok (diff kosong)** |
| Sequence (`pg_sequences.last_value`) | 58 | 58 | cocok |
| File media (sha256 per file) | 46 | 46 | **cocok (diff kosong)** |
| Owner/mode file media | — | — | cocok |

| Waktu | Detik |
|---|---:|
| Restore DB (`restore.sh`, termasuk CREATE DATABASE + `restic dump \| pg_restore`) | 5,1 |
| Restore media (`restic restore`) | 0,7 |
| Verifikasi | 0,3 |
| **Total RTO terukur** | **6,1 s** (≪ 4 jam) |

### 3.3 Catatan & temuan

- R-1 (Low, infra): `restore.sh --filestore` hanya mengenal tata letak Odoo (`<vol>/_data/filestore/<db>`), tidak
  berlaku untuk volume media ProyekKas (root volume) → drill memakai `restic restore --include <root volume>` langsung.
  Usul: opsi `restore.sh --volume <vol> <target_dir>` + cakupan media di `restore-test.sh` (sudah tercatat di
  `backup.md`: "restore-test.sh belum menguji file media").
- R-2 (Info): data staging kecil (1,3 MiB dump, 413 KiB media), jadi RTO ini membuktikan prosedur, **bukan** kapasitas.
  Estimasi prod (`fase1-golive.md` §6): ≈ 0,8 GB media/bulan → ulangi drill pada `pk_drms` + `drms_pk_media_prod` setelah
  go-live (verifikasi backup prod = bagian E9/E10 lain, belum ada karena prod belum di-deploy).
- R-3 (Info): repo restic masih lokal di disk yang sama (`backup.md` §RISIKO) — di luar scope E9 ProyekKas, tetap
  risiko platform (L4 remote belum aktif).
- Langkah ke volume **live** (menyalin media hasil restore ke `drms_pk_media_*`) tidak diuji (destruktif); prosedurnya
  sama dengan `backup.md` §File filestore (salin manual setelah dicek).

## 4. Pembaruan ASVS L1 (bagian ZAP)

Diterapkan di `security/asvs-l1-checklist.md` (§1 metode, baris terkait, §2 ringkasan, §6 celah, §7 pending, §8 baru):

| # | Sebelum | Sesudah | Bukti |
|---|---|---|---|
| 4.3.2 | Terpenuhi (verifikasi ZAP) | Terpenuhi — diverifikasi | `/.git/*`, `/.env`, `/package.json` 403; tanpa listing |
| 5.1.1 | Sebagian | Sebagian | Parameter ganda: nilai terakhir dipakai + zod; tidak seragam dengan `searchParams.get` (nilai pertama) |
| 7.4.1 | Terpenuhi | Terpenuhi — diverifikasi | REST generik & `/api/v1` mengembalikan pesan generik tanpa stack |
| 8.2.1 | Sebagian | Sebagian | HTML admin `no-store`; REST generik tanpa `Cache-Control` (M-3) |
| 9.1.2, 9.1.3 | Sebagian | Sebagian | TLS 1.2/1.3 saja; suite CBC di TLS 1.2 (M-2) |
| 14.3.3 | Sebagian | **Terpenuhi** | Tidak ada `Server`/`X-Powered-By` |
| 14.4.5 | Sebagian | Sebagian | HSTS ada, `max-age=604800`, tanpa `includeSubDomains` (M-1) |
| 14.5.1 | Sebagian | **Terpenuhi** | TRACE/TRACK/PROPFIND/PUT/DELETE di halaman → 403 (WAF), `v1()` terikat metode |
| 14.5.3 | Terpenuhi | Terpenuhi — diverifikasi | Tanpa `Access-Control-Allow-Origin` untuk origin asing |

Ringkasan berubah: Terpenuhi 80 → **82**, Sebagian 25 → **23** (total tetap 127). G-15 hampir tertutup (sisa 5.1.1),
G-08/G-07 terkonfirmasi dengan detail, G-17 tetap terbuka (load test terautentikasi).

## 5. Daftar temuan / bug

| ID | Severity | Pemilik | Ringkas |
|---|---|---|---|
| BLK-1 | **Blocker (proses)** | Lead/user | Tidak ada kredensial uji staging terdokumentasi + hanya ≤ 6 akun (rate limit per user) → load test & ZAP terautentikasi belum bisa |
| M-1 | Low | infra | HSTS 7 hari tanpa `includeSubDomains` |
| M-2 | Low | infra | TLS 1.2 menerima suite CBC/non-PFS |
| M-3 | Low | nextjs | REST generik `/api/<slug>` tanpa `Cache-Control: no-store` |
| R-1 | Low | infra | `restore.sh` tanpa mode restore volume media non-Odoo; `restore-test.sh` tanpa media |
| Z-1 | Low (diterima) | — | CSP `style-src 'unsafe-inline'` |
| Z-2 | Low | nextjs (opsional) | CORP pada aset statis |
| Z-3, Z-4, Z-5, M-4, M-5, R-2, R-3 | Info | — | lihat §1.4, §3.3 |

Tidak ada bug fungsional aplikasi dan tidak ada HIGH/CRITICAL. Tidak ada perubahan pada konfigurasi staging/prod,
Traefik, CrowdSec, Keycloak, atau kode aplikasi.

## 6. Kebersihan

Container `e9qa-zap-unauth`, `e9qa-zap-admin`, `e9qa-k6-anon` dihapus; tidak ada network baru (`--network host`);
DB `pk_drms_restoretest` di-drop; direktori restore media dihapus; tidak ada decision CrowdSec yang dibuat oleh uji ini.
Snapshot restic tambahan 23:10 (`c35a41c3`, `38682a6d`, dan snapshot DB lain dari run yang sama) akan dirapikan oleh
`restic-prune.timer` sesuai retensi 7d/4w/3m.

## 7. Pembaruan 2026-09-27 — load test & ZAP terautentikasi (BLK-1 ditutup)

- **Persetujuan:** user 2026-09-27 ("lanjutkan") lewat Lead; campuran beban **opsi (b)** diputuskan Lead.
- **Build yang diuji:** staging tetap `0.2.1-stg-13b1f05` (web/worker `RestartCount=0`, tanpa OOM sepanjang uji).
- Kredensial tidak pernah dicetak / di-commit: `/root/drms-loadtest-users.csv` (0600 root) → `--env-file` root-only.

### 7.1 Akun uji beban (Keycloak realm `drms-staging` saja)

| Hal | Nilai |
|---|---|
| Alat | `/opt/infra/scripts/lib/keycloak-admin.sh` (`kc_init drms-staging`, client `automation` realm drms-staging — dibuat infra Lead 2026-09-27), Admin REST via `:8443` |
| Akun | `lt-field-01..30` (`pk-staff`), `lt-office-01..02` (`pk-finance`), `lt-office-03..04` (`pk-owner` = Direktur), `lt-office-05` (`pk-pm`); email `<username>@proyekkas.test`, `emailVerified`, tanpa required action/OTP, password acak 24 karakter sesuai policy realm |
| Penanda | **Grup `loadtest-e9`** (atribut grup `loadtest=e9`), 35 anggota. Atribut user `loadtest=e9` **dibuang** Keycloak: user profile realm memakai kebijakan default (unmanaged attribute nonaktif) dan mengubahnya butuh `manage-realm` → deviasi D-1. |
| Akun lama | 5 user yang sudah ada tidak diubah (diverifikasi). |

### 7.2 Data ProyekKas (impor E11, CLI resmi)

- `docker compose --profile seed run --rm -v /srv/drms-import-e9:/import:ro -v /srv/drms-import-e9/out:/out drms-pk-stg-seed
  node /app/node_modules/payload/bin.js run src/import/cli.ts -- (--dry-run|--commit) --file /import/lt-e9-import.xlsx
  --kc-map /import/kc-map.csv --out /out --operator "QA E9 load test"` — dry-run 0 error lalu commit
  (sha256 `9a6578d9…`, run `b7530312-…`): Karyawan 35, Pengguna 35, Project 1, Tahapan 3, Penugasan 31 baru.
- Sheet Pengaturan dibuat **no-op**: `nomor_pb_mulai` 229 (= `start_at` staging; counter 236 tidak berubah),
  `tutup_periode_sebelum_golive` = Tidak (tidak ada tutup buku) — diverifikasi di DB.
- **Deviasi D-2:** `PRJ-UJI-01` tidak ada di staging (hanya `UJI-PRJ` tanpa koordinat/tahapan). Agar laporan progress
  beban tidak menaikkan % tahapan data UAT, dibuat project fiktif khusus **`PRJ-LT-E9`** (id 4, PM `lt-office-05`,
  titik -3,32 / 114,59, radius 200 m, tahapan Persiapan 20 · Struktur 30 · Finishing 50; 30 akun lapangan ditugaskan Staff).
- `syncAttendanceEnabled` dinyalakan **lewat aplikasi**: login OIDC web `lt-office-03` (Direktur) →
  `POST /api/globals/company-settings` dengan `changeReason`; audit `audit_logs` id 3128 (user 108 `pk-owner`, source
  `web`, false → true). Dump baris setting sebelum/sesudah: hanya kolom itu (+ `updated_at`) yang berubah.
  `syncProgressReportsEnabled` sudah ON, tidak diubah. **Setting dibiarkan ON** (dibutuhkan juga oleh UAT P-06).

### 7.3 Load test terautentikasi (k6 `MODE=auth`)

#### 7.3.1 Campuran (opsi b, keputusan Lead 2026-09-27)

Laporan progress hanya boleh dibuat PM tim / Direktur (`domain/progress/access.ts` `canReportOn`; unggah
`media-progress-photos` hanya `pk-pm`/`pk-owner`), dan akun lapangan tetap `pk-staff` (seperti prod). Karena itu:

| Grup | VU/akun | Aksi per iterasi (jeda manusia) |
|---|---:|---|
| Lapangan (Staff) | 30 | `/me` (+ `/masters` tiap 3 iterasi); 45%: selfie 720 px (`POST /media/selfies`) + `attendance.check_in`/`check_out` via `/sync/batch`; 55%: foto nota 1600 px (`POST /media/receipts`) + draft Reimburse lump sum dengan nota + `draft_delete` (dibatalkan) dalam satu batch, lalu daftar pengajuan + `/dashboard/me`; jeda 20–40 s |
| Finance | 2 | `/dashboard/finance`, `/approvals/inbox`, `/transfer-queue`, laporan (`rekap-kas`, `rekap-pengajuan`, `anggaran-project`, `buku-kas`) |
| Direktur | 2 | `/dashboard/owner`, `/approvals/inbox`, `/projects/progress`, 60%: laporan progress + 1–3 foto 1600 px |
| PM | 1 | `/dashboard/pm`, `/projects/progress`, 60%: laporan progress + 1–3 foto |

**Porsi laporan progress lebih kecil** daripada campuran hipotetis "semua lapangan = PM" (hanya 3 dari 35 akun yang
melapor; 20 laporan / 43 foto progress dalam 10 menit). Beban resize tetap tinggi karena 220 foto nota 1600 px dan
178 selfie ikut di-resize sharp di container web.

Perintah (dua proses k6 paralel — `ONLY=field|office` agar 1 VU = 1 akun deterministik; env-file root-only):

```bash
E=/root/drms-e9-auth/k6-auth.env   # MODE=auth, PROJECT_ID=4, LAT=-3.32, LNG=114.59, FIELD_USERS, OFFICE_USERS (0600)
docker run -d --name e9qa-k6-field  --network host --env-file $E -e ONLY=field  -v <load>:/load:ro -v <out>:/out grafana/k6 run --quiet /load/q34-mix.js
docker run -d --name e9qa-k6-office --network host --env-file $E -e ONLY=office -v <load>:/load:ro -v <out>:/out grafana/k6 run --quiet /load/q34-mix.js
# pemantau 5 s: docker stats + loadavg + probe prod (cp, auth realm platform); abort otomatis (docker stop k6) bila
# 3 sampel berturut-turut probe ≠ 200/307 atau > 2 s, atau load1 > 6 (4 vCPU)
```

Dua smoke run singkat (1+1 VU, lalu 1+5 VU, ±1,5 menit) sebelum run utama memvalidasi payload (perbaikan: baris
draft lump sum — `Satuan wajib bila jumlah diisi`).

#### 7.3.2 Hasil (08:02:43–08:12:34 WIB, ramp 1 m → 8 m → 30 s; **tidak di-abort**)

2 178 request, **error HTTP 0%** (checks 100%), **0× 429**, 0× 403 WAF. Sync: 496 item `applied`, 122 `rejected`
— semuanya `ALREADY_CHECKED_IN/OUT` (aturan bisnis 1× masuk + 1× pulang per hari; diharapkan dari iterasi berulang).
Laporan progress tercipta 20 (0× 409).

| Aksi | n | p50 (ms) | p95 (ms) | maks (ms) | Target p95 < 2 s (saat uji) |
|---|---:|---:|---:|---:|---|
| token (password grant / refresh) | 70 | 66 | 151–191 | 291 | ✓ |
| `/me` | 398 | 30 | 621 | 3 349 | ✓ |
| `/masters` | 144 | 101 | 832 | 6 590 | ✓ |
| unggah selfie 720 px | 178 | 316 | **2 110** | 3 979 | ✗ |
| check-in/out (`/sync/batch`) | 178 | 133 | 1 015 | 2 901 | ✓ |
| unggah nota 1600 px | 220 | 940 | **3 184** | 5 173 | ✗ |
| draft Reimburse + batal (`/sync/batch`) | 220 | 670 | **2 600** | 4 109 | ✗ |
| daftar pengajuan | 220 | 54 | 695 | 4 339 | ✓ |
| `/dashboard/me` | 220 | 56 | 443 | 2 385 | ✓ |
| dashboard kantor (finance/owner/pm) | 66 | 103 | 807 | 3 656 | ✓ |
| `/approvals/inbox` | 53 | 69 | 1 880 | 3 302 | ✓ (tipis) |
| `/transfer-queue` | 27 | 25 | 139 | 174 | ✓ |
| laporan (`/reports/{code}`) | 27 | 82 | 809 | 1 090 | ✓ |
| `/projects/progress` | 39 | 48 | 230 | 510 | ✓ |
| tahapan project | 20 | 34 | 552 | 756 | ✓ |
| unggah foto progress 1600 px | 43 | 611 | **2 195** | 3 357 | ✗ |
| laporan progress (`POST /progress-reports`) | 20 | 451 | **2 708** | 3 802 | ✗ |

> **Target baru (keputusan user 2026-09-27):** unggahan (selfie, nota, foto progress) p95 < 5 s → ketiga baris unggah di
> atas memenuhi; aksi lain p95 < 2 s → draft Reimburse (`/sync/batch`) 2 600 ms dan laporan progress 2 708 ms **tetap ✗**
> sampai uji ulang dengan antrean resize (§7.3.3).

#### 7.3.3 Sumber daya & penyebab

| Container | Awal | Puncak RAM | % limit | CPU p50 / p95 / maks (% 1 core) |
|---|---:|---:|---:|---|
| `drms-pk-stg` (web, 384 MiB, **cpus 0,75**) | 109,9 MiB | **189,5 MiB** | **49,3%** | 41 / **80** / 85 |
| `drms-pk-stg-worker` (192 MiB, cpus 0,25) | 69,7 MiB | 70,1 MiB | 36,5% | 0 / 2 / 9 |
| `postgres` (2 GiB) | 202 MiB | 254 MiB | 12,4% | 6 / 18 / 29 |
| `traefik` / `crowdsec` / `keycloak` | — | 108 / 150 / 559 MiB | ≤ 42% | ≤ 18 (p95) |

- cgroup `cpu.stat` web setelah run: `nr_throttled` **6 205 / 16 183** periode (38%), `throttled_usec` 455,7 s →
  **CPU web jenuh** pada batas 0,75 vCPU; RAM tidak menjadi masalah (ambang flag 307 MiB tidak tercapai, sharp
  menambah ≈ 80 MiB).
- Host (4 vCPU): load1 maks **5,7**; probe prod 166 sampel semua 200/307, p50 50 ms, p95 115 ms, maks 331 ms → tidak ada
  degradasi prod (run tidak di-abort). Container prod lain tidak berubah berarti.
- **P-1 (Medium, kapasitas — keputusan user/Lead):** jalur yang me-resize gambar (nota, selfie, foto progress) dan batch
  sync yang ikut antre di event loop yang sama melewati p95 2 s. Opsi: (a) naikkan `cpus` web ke 1,5 (RAM tetap 384 MiB;
  host masih punya headroom CPU tetapi load1 5,7 perlu dipantau), (b) batasi konkurensi sharp (`sharp.concurrency(1)`,
  antre) atau pindahkan resize ke worker (ADR 0002 §6 (b)), (c) terima target lebih longgar untuk unggahan (mis. p95 < 4 s,
  karena APK mengunggah di latar belakang/antrean offline). Ulangi load test setelah keputusan.
- **Keputusan user 2026-09-27:** (b) + (c) — antrean resize di proses web (`apps/web/src/lib/image-queue.ts`: semafor FIFO
  seproses, maks `IMAGE_RESIZE_CONCURRENCY` = 2 job, antrean maks `IMAGE_RESIZE_MAX_QUEUE` = 20 → 503 + `Retry-After: 5`,
  tunggu maks 30 s; `sharp.concurrency(1)`, cache libvips mati; output resize/format/EXIF tidak berubah) dan target
  **unggahan p95 < 5 s**, **aksi lain p95 < 2 s** (AC `plans/fase1-golive.md` §E9 diperbarui). Uji ulang `MODE=auth`
  setelah deploy; bila laporan progress / `/sync/batch` masih > 2 s, coba `IMAGE_RESIZE_CONCURRENCY=1`.

### 7.4 ZAP baseline terautentikasi

- Sesi web didapat lewat login OIDC aplikasi (`lt-field-30` Staff, `lt-office-04` Direktur); cookie `__Host-pk_session`
  dimasukkan lewat `-configfile` ZAP (0600, uid ZAP; tidak di argv). Spider tradisional (tanpa AJAX spider),
  `logout`/`/auth/` dikecualikan, `-m 3`, target `/admin`.
- Hasil: Staff **142 URL**, Direktur **837 URL** (sesi aktif) — `FAIL-NEW 0`, WARN 11/12.
- **Catatan metode:** walau `spider.postform=false`/`spider.processform=false` diset, ZAP tetap mengirim 8 POST form
  (Direktur/Staff) ke REST generik Payload. Diverifikasi **tidak ada data tersimpan**: setting perusahaan identik
  (dump), 0 baris baru/berubah di `expense_requests`, `budget_lines`, `clients`, `cost_centers`, `projects`,
  `project_stages`, `stage_templates`, `users`, `employees`; audit hanya `login` (2) dan `export` laporan (15, GET unduh).
  Scan berikutnya: pakai akun tanpa hak tulis atau nama kunci konfigurasi ZAP yang benar (`spider.postForm`).

| # | Temuan ZAP (auth) | Risiko ZAP | Triase | Severity akhir |
|---|---|---|---|---|
| B-1 | 500 `Internal Server Error` pada `POST /api/{expense-requests,budget-lines,clients,cost-centers,projects,project-stages,stage-templates}` dan `/api/globals/company-settings` dengan body form (bukan JSON) — ZAP 90022 | Low | **True positive (bug robustness):** hook koleksi membaca `data.project/name/code` saat `data` undefined → `TypeError` (log app level error, stack hanya di log server). Seharusnya 400. Tidak ada data tersimpan. | **Low** (nextjs) |
| Z-6 | HSTS tidak ada pada respons 500 tersebut (10035) | Low | Hanya pada respons error B-1 (respons lain membawa HSTS); tertutup bila B-1 diperbaiki. | Info |
| Z-7 | CSRF token tidak ada pada form logout/edit (10202) | Medium | False positive: CSRF ditangani `Origin`/`Sec-Fetch-Site` di `oidcSessionStrategy` + cookie `SameSite=Lax` (ASVS 4.2.2 Terpenuhi) | Info |
| Z-8 | `Private IP Disclosure` (2) di halaman audit log (Direktur) | Low | Nilai = IP hairpin `10.100.0.1` milik uji dari host; pengguna nyata tercatat IP publik. Data audit untuk peran berwenang. | Info |
| Z-9 | Parameter filter dipantulkan ke atribut HTML (10031: `bulan`, `peran`, `dari`, `sampai`) | Info | React meng-escape nilai, CSP nonce; tanpa eksekusi skrip | Info |
| Z-10 | Email di URL (10024), timestamp Unix (10096), cache-control (10015) | Info | URL dengan email dibuat ZAP sendiri dari form; REST generik tanpa `Cache-Control` = M-3 (sudah tercatat); laporan CSV/XLSX `private, no-store` | Info |
| — | CSP `unsafe-inline` style, CORP/COEP | — | sama seperti §1.4 (Z-1…Z-3) | — |

Cek header API terautentikasi (bearer `lt-field-29`): `/devices/register`, `/me`, `/masters`, 403 dan 404 semuanya
`Cache-Control: no-store`, HSTS, `nosniff`, tanpa `Access-Control-Allow-Origin`, tanpa `Server`/`X-Powered-By`.
CrowdSec: 8 alert AppSec (tanpa decision) dari 10.100.0.1 pada 08:15–08:18 WIB = POST form ZAP di atas; tidak ada
decision untuk IP uji selama seluruh sesi.

### 7.5 Pembersihan & data uji yang tercipta (staging, fiktif)

- **Dinonaktifkan (tidak dihapus):** ProyekKas — 35 pengguna & 35 karyawan `aktif = Tidak` lewat impor E11 kedua
  (`lt-e9-deactivate.xlsx`, sha256 `dcb1615b…`, dry-run lalu commit, alasan audit "QA E9 load test (nonaktif)");
  44 perangkat `revoked`, semua `web_sessions` dicabut. Keycloak — 35 akun `enabled=false` + `logout` (login uji →
  `invalid_grant "Account disabled"`), tetap anggota grup `loadtest-e9` sebagai penanda. Akun dipertahankan sampai
  konfirmasi Lead.
- **B-2 (Low, nextjs/runbook):** saat impor menonaktifkan pengguna, hook mencatat 88× `keycloak device session delete
  failed` (env `APP_URL`/`OIDC_*` tidak ada di service `drms-pk-stg-seed`) → sesi Keycloak **tidak** dicabut oleh impor.
  Di uji ini ditutup manual (disable + logout via `kc_*`). Runbook impor/offboarding harus menambah langkah Keycloak
  atau service seed diberi env OIDC/KC admin.
- **Data yang tersisa di staging** (termasuk dua smoke run): project `PRJ-LT-E9` (id 4, progress 1,6%; tahapan 2,75 /
  2,25 / 0,75%), 31 penugasan, 60 absensi, 182 selfie (4,4 MB), 222 foto nota (54,6 MB), 54 foto progress (11,3 MB),
  221 draft Reimburse berstatus `cancelled`, 25 laporan progress, 44 perangkat (revoked), baris audit terkait,
  `syncAttendanceEnabled = true`. Volume media staging 528 KB → 69 MB. File impor & laporan: `/srv/drms-import-e9/`
  (uid 1001, 0400/0600).
- Tidak ada container/network tersisa; tidak ada perubahan konfigurasi staging/prod, Traefik, CrowdSec, Keycloak realm.

### 7.6 Ringkasan temuan baru

| ID | Severity | Pemilik | Ringkas |
|---|---|---|---|
| P-1 | **Medium (AC gagal)** | user/Lead + nextjs/infra | p95 unggah + resize 2,1–3,2 s pada Q-34; CPU web 0,75 vCPU ter-throttle. **Keputusan 27/9:** antre resize + target unggah < 5 s / lain < 2 s — **uji ulang `dc80237` (§7.7): unggahan & laporan progress lulus; tersisa P-1b** |
| P-1b | **Low/Medium (AC gagal tipis)** | Lead/infra + user | `/sync/batch` draft Reimburse p95 2,66 s (> 2 s) karena CPU web jenuh saat 2 job sharp berjalan (65% periode aktif ter-throttle). Opsi: `IMAGE_RESIZE_CONCURRENCY=1` (perlu entri env di compose staging/prod), naikkan `cpus` web, atau terima 2 s → 3 s untuk sync batch (APK kirim di latar belakang) |
| B-1 | Low | nextjs | REST generik Payload: body non-JSON → 500 (TypeError di hook), seharusnya 400 — **diperbaiki** (`lib/body-guard.ts`, 400 + pesan); **terverifikasi di staging `dc80237`** (POST form ke `/api/clients`, `/api/projects`, `/api/globals/company-settings` → 400, 0 log error) |
| B-2 | Low | nextjs + Lead (runbook) | Nonaktif lewat impor E11 tidak mencabut sesi Keycloak (env OIDC tidak ada di service seed) — **laporan impor merangkum 1 peringatan + CSV; langkah `kc_*` di runbook**; **terverifikasi `dc80237`**: impor nonaktif/aktif → 1 blok `PERINGATAN KEYCLOAK` + CSV tindak lanjut, 0 log `device session delete failed` |
| D-1 | Info (deviasi) | infra | Penanda `loadtest=e9` di grup, bukan atribut user (unmanaged attribute nonaktif) |
| D-2 | Info (deviasi) | — | Project uji beban `PRJ-LT-E9` menggantikan `PRJ-UJI-01` yang tidak ada di staging |
| Z-6…Z-10 | Info | — | §7.4 |

BLK-1 **ditutup**. Tidak ada HIGH/CRITICAL.

### 7.7 Uji ulang 2026-09-27 siang — build `dc80237` (antrean resize P-1, B-1, B-2)

- **Build:** staging `ghcr.io/bctech-adm/proyekkas-web:0.2.1-stg-dc80237` (web/worker start 02:48Z, `RestartCount=0`,
  tanpa OOM); limit tetap web 384 MiB / 0,75 vCPU, worker 192 MiB / 0,25 vCPU. `IMAGE_RESIZE_CONCURRENCY` /
  `IMAGE_RESIZE_MAX_QUEUE` tidak diset di compose → default **2 / 20**.
- **Akun:** 35 akun `lt-*` diaktifkan lagi di Keycloak `drms-staging` (`kc_*`, `enabled=true`) dan di ProyekKas lewat
  impor E11 (`lt-e9-import.xlsx`, dry-run → commit, operator "QA E9 load test rerun"; Karyawan/Pengguna 35 diubah,
  sisanya sama). Setelah uji: impor `lt-e9-deactivate.xlsx` (dry-run → commit, "QA E9 load test rerun (nonaktif)"),
  lalu Keycloak `enabled=false` + `logout` untuk 35 akun (runbook §3.5; login uji → `Account disabled`). Grup
  `loadtest-e9` tetap. 5 akun lama tidak berubah.
- **Skrip k6:** campuran opsi (b) yang sama, durasi & pengaman sama (monitor 5 s, abort otomatis bila probe prod gagal/
  > 2 s 3× berturut-turut atau load1 > 6). Tambahan: unggahan yang mendapat **503 `UPLOAD_BUSY`** menunggu
  `Retry-After` lalu diulang (maks. 3×); percobaan 503 dihitung terpisah (`upload_busy_503`, bukan error);
  `act_upload_*` = latensi request yang diterima, `act_upload_*_e2e` = termasuk tunggu. Ambang: unggahan p95 < 5 s,
  lainnya < 2 s. Smoke 1+5 VU (±1 menit) sebelum run utama.
- **Catatan data:** uji ulang di hari WITA yang sama → **semua 174 check-in/out ditolak `ALREADY_CHECKED_IN/OUT`**
  (jalur tolak aturan bisnis, lebih ringan dari penyimpanan absensi); unggah selfie + resize tetap penuh.

#### 7.7.1 Hasil (09:53:15–10:03:15 WIB, tidak di-abort)

2 191 request, **error HTTP 0%**, **0× 429**, 0× WAF, **0× 503 `UPLOAD_BUSY`** (antrean 20 tidak pernah penuh; tidak ada
unggahan yang menyerah). Sync: 446 `applied` (223 draft + 223 batal), 174 `rejected` (absensi, lihat atas).
Laporan progress tercipta 24.

| Aksi | n | p50 (ms) | p95 (ms) | maks (ms) | Target | Run 1 p95 (sebelum antrean) |
|---|---:|---:|---:|---:|---|---:|
| unggah selfie 720 px | 174 | 307 | 1 430 | 5 646 | < 5 s ✓ | 2 110 |
| unggah nota 1600 px | 223 | 974 | 2 839 | 6 064 | < 5 s ✓ | 3 184 |
| unggah foto progress 1600 px | 46 | 738 | 2 037 | 2 842 | < 5 s ✓ | 2 195 |
| (e2e unggahan, termasuk tunggu 503) | — | = di atas | = di atas | — | — | — |
| check-in/out (`/sync/batch`, ditolak) | 174 | 89 | 462 | 2 462 | < 2 s ✓ | 1 015 |
| **draft Reimburse + batal (`/sync/batch`)** | 223 | 688 | **2 661** | 5 271 | < 2 s **✗** | 2 600 |
| laporan progress (`POST /progress-reports`) | 24 | 398 | **1 667** | 2 784 | < 2 s ✓ | 2 708 |
| `/me` | 397 | 27 | 297 | 1 302 | ✓ | 621 |
| `/masters` | 145 | 110 | 686 | 5 923 | ✓ | 832 |
| daftar pengajuan | 223 | 50 | 732 | 1 955 | ✓ | 695 |
| `/dashboard/me` | 223 | 60 | 577 | 1 358 | ✓ | 443 |
| dashboard kantor | 65 | 102 | 452 | 2 953 | ✓ | 807 |
| `/approvals/inbox` | 52 | 59 | 534 | 1 160 | ✓ | 1 880 |
| `/transfer-queue` | 28 | 26 | 929 | 2 221 | ✓ | 139 |
| laporan (`/reports/{code}`) | 28 | 52 | 451 | 2 137 | ✓ | 809 |
| `/projects/progress` | 37 | 66 | 539 | 1 458 | ✓ | 230 |
| tahapan project | 24 | 32 | 262 | 486 | ✓ | 552 |
| token | 70 | 48–52 | 251–330 | 831 | ✓ | 151–191 |

#### 7.7.2 Sumber daya

| Container | Awal | Puncak RAM | % limit | CPU p50 / p95 / maks (% 1 core) |
|---|---:|---:|---:|---|
| `drms-pk-stg` (web, 384 MiB, cpus 0,75) | 95,4 MiB | **150,5 MiB** | **39,2%** | 38 / 81 / 91 |
| `drms-pk-stg-worker` (192 MiB) | 58,0 MiB | **61,4 MiB** | **32,0%** | 0 / 4 / 9 |
| `postgres` | 233,7 MiB | 275,6 MiB | 13,5% | 7 / 22 / 35 |
| traefik / crowdsec / keycloak | — | 101 / 172 / 562 MiB | ≤ 45% | ≤ 22 (p95) |

- **Throttling CPU web (delta `cpu.stat` selama run, 10 menit):** `usage_usec` +242,0 s (rata-rata 0,40 core),
  `nr_periods` +4 178 periode aktif, `nr_throttled` **+2 737 (65,5%)**, `throttled_usec` **+303,8 s**. (Angka run 1
  "38%" adalah kumulatif sejak container start 26/9 termasuk jam idle → tidak sebanding; throttled time run 1
  kumulatif 455,7 s.) CPU web tetap jenuh pada 0,75 vCPU saat 2 job sharp berjalan; antrean membatasi RAM dan
  latensi unggah, tetapi request lain (sync batch) ikut menunggu CPU.
- Host load1 maks **3,0** (run 1: 5,7); probe prod 168 sampel semua 200/307, p50 50 ms, p95 78 ms, maks 392 ms → tanpa
  degradasi. Log app selama run: 0 baris `error`. CrowdSec: 0 alert/decision dari IP uji.

#### 7.7.3 Langkah 3 — `IMAGE_RESIZE_CONCURRENCY=1`: tidak dijalankan

Draft Reimburse sync masih > 2 s, tetapi variabel tidak ada di daftar `environment:` compose staging
(`/opt/infra/staging/drms-proyekkas/docker-compose.yml`) dan env container tidak bisa diubah tanpa mengedit file itu
(dilarang untuk QA). Jalur draft sync sendiri tidak memproses gambar (hanya tautan nota + SQL deteksi duplikat,
`domain/expense/receipts.ts`) → latensinya murni antre CPU. **Butuh:** infra Lead menambah
`IMAGE_RESIZE_CONCURRENCY: ${IMAGE_RESIZE_CONCURRENCY:-2}` di compose staging (lalu `.env` = 1 dan `up -d`), atau
keputusan target sync batch (P-1b).

#### 7.7.4 Temuan tambahan uji ulang

| ID | Severity | Pemilik | Ringkas |
|---|---|---|---|
| F-1 | Info | flutter | APK tidak membaca `Retry-After`/`UPLOAD_BUSY`: 503 unggahan → item `deferred` dengan backoff eksponensial 5 s × 2ⁿ (±20%) (`sync_engine.dart`, `backoffFor`). Kompatibel dengan `Retry-After: 5`; 503 ikut menambah hitungan percobaan menuju "Gagal dikirim". |
| F-2 | Info | nextjs | Blok `PERINGATAN KEYCLOAK` selalu menulis "realm drms" dan "perangkat & sesi web ProyekKas sudah dicabut" — juga saat staging (`drms-staging`) dan saat baris **diaktifkan** kembali. Kosmetik. |

#### 7.7.5 Data uji kumulatif di staging (fiktif, akun nonaktif)

`PRJ-LT-E9` (progress 3,78%; tahapan 5,25 / 4,5 / 2,75%), 31 penugasan, 60 absensi, 53 laporan progress, 445 draft
Reimburse `cancelled`, 85 perangkat `revoked`, 357 selfie (8,2 MB), 446 foto nota (104,5 MB), 110 foto progress (21,9 MB);
volume media staging **138 MB**; baris audit terkait. File impor/laporan: `/srv/drms-import-e9/out/`.

