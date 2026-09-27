# ProyekKas — Self-assessment OWASP ASVS 4.0.3 Level 1

- **Tanggal:** 2026-09-26
- **Versi yang dinilai:** branch `feat/s3a-e9-hardening` (berbasis `develop` `c468bbe`), termasuk pekerjaan E9 di
  branch yang sama (ditandai **(E9)**, lihat §3 — sudah dikonfirmasi penulis E9 terhadap kode dan test final).
- **Epik:** E9 — Hardening F6 (`docs/proyekkas/plans/fase1-golive.md` §E9: "ASVS L1 checklist + ZAP baseline staging").
- **Penilai:** self-assessment tim pengembang (bukan audit independen).

## 1. Ruang lingkup & metode

**Dalam lingkup:** aplikasi web `apps/web` (Payload CMS 3.90.1 + Next 16: panel admin, route OIDC `/auth/*`, REST
generik Payload `/api/<slug>`, endpoint kustom `/api/v1/*`, worker), image Docker `apps/web/Dockerfile`, migrasi keamanan
DB (`apps/web/src/migrations/*_security.ts`), pipeline CI `.github/workflows/ci.yml`, dan sisi server yang dipakai APK
Flutter (`apps/mobile`, bearer token hanya di `/api/v1`). Sisi APK hanya disinggung bila menyentuh kontrol server.

**Di luar lingkup (dimiliki pihak lain, hanya dirujuk):** Traefik (TLS, HSTS, rate limit tepi, CrowdSec), realm
Keycloak `drms`/`drms-staging` (kebijakan password, brute force, MFA/TOTP, sesi SSO), Postgres platform (role, backup).
Kontrol ini dinilai berdasarkan keputusan tercatat di ADR 0002, ADR 0003 dan `docs/proyekkas/architecture.md` §3.3 —
**bukan** bukti kode — dan ditandai **[infra]** atau **[KC]**. Konfigurasi realm/router **prod** belum ada (E10);
penilaian memakai state staging yang diverifikasi Lead 2026-09-23.

**Metode:** membaca kode dan konfigurasi di worktree; setiap path/fungsi yang dikutip sudah dicek ada (`ls`/`grep`).
Tidak ada pengujian dinamis dalam penilaian awal. **Pembaruan 2026-09-26 (QA E9):** ZAP baseline staging (tanpa login),
load test (hanya jalur tanpa login — load test terautentikasi terblokir kredensial) dan restore drill sudah dijalankan;
laporan `docs/proyekkas/qa/s3-e9-qa-report.md`. Baris yang dulu bertanda "verifikasi ZAP" diperbarui (lihat §8).

**Status:**
- **Terpenuhi** — kontrol ada dan ada bukti (kode/test/CI atau keputusan ADR untuk kontrol infra/KC).
- **Terpenuhi (E9)** — dipenuhi oleh pekerjaan E9 di branch ini; nama file final dikonfirmasi penulis E9 (§3).
- **Sebagian** — kontrol ada tetapi tidak lengkap, belum diverifikasi, atau hanya di staging.
- **Celah** — kontrol tidak ada / menyimpang dari ASVS.
- **N/A** — fitur yang disasar tidak ada di ProyekKas.

## 2. Ringkasan

| Status | Jumlah persyaratan L1 |
|---|---|
| Terpenuhi | 82 |
| Sebagian | 23 |
| Celah | 9 |
| N/A | 13 |
| **Total nomor L1 dinilai** | **127** |
| Terpenuhi (E9) — kontrol tambahan, lihat §3 | 4 (tidak menambah total; memperkuat nomor yang sudah dihitung) |

Catatan hitung: baris yang mengelompokkan beberapa nomor ASVS dihitung per nomor. V1 tidak punya persyaratan L1 di
ASVS 4.0.3 (semua L2/L3) sehingga tidak dihitung. Celah **HIGH/CRITICAL: tidak ada** berdasarkan pembacaan kode; celah
tertinggi berprioritas **Tinggi** adalah MFA untuk antarmuka admin (4.3.1) yang bergantung pada konfigurasi Keycloak.

## 3. Kontrol E9 (branch ini — dikonfirmasi terhadap kode dan test final)

| Kontrol E9 | ASVS terkait | Lokasi | Test | Status |
|---|---|---|---|---|
| URL media bertanda tangan & berbatas waktu, HMAC-SHA256 (ADR 0004 §4b) | 4.2.1, 12.4.1, 13.1.3 | `apps/web/src/lib/signed-url.ts` (`signMedia`, `verifyMedia` dengan `timingSafeEqual`, `signingKeys` rotasi `MEDIA_URL_KEYS` / HKDF dari `PAYLOAD_SECRET`, TTL 300 s); endpoint `GET /api/v1/media/{collection}/{id}/signed-url` (`mediaSignedUrlEndpoint`); verifikasi di `mediaFileEndpoint` (`authenticateSigned`, `src/api/v1/endpoints/media.ts`) — kedaluwarsa → 403 `URL_EXPIRED`, invalid → 403 `URL_INVALID`, `sig` valid tapi tanpa akses / user nonaktif → 403 (+ `access_denied`) | `tests/unit/e9-hardening.test.ts` (sign/verify/rotasi/parse), `tests/integration/e9-hardening.int.test.ts` "signed media URLs" | Terpenuhi (E9) |
| `/admin/*` tanpa sesi → 302 ke `/admin/login?redirect=…` | 4.1.1 (defense in depth), 3.x | `apps/web/src/lib/admin-gate.ts` `adminLoginRedirect`, dipanggil di `apps/web/src/proxy.ts` | `tests/unit/e9-hardening.test.ts`, `tests/unit/e9-proxy.test.ts` | Terpenuhi (E9) |
| Konsistensi 403 sebelum 409 (otorisasi dicek sebelum konflik status, UAT 5.2) | 4.1.5, 7.4.1 | `apps/web/src/domain/expense/state.ts` `mayPerform` + `common.ts` `requireAction`; urutan sama di `domain/addendum/service.ts` `requireAction` | unit "403 before 409", integrasi "403 vs 409 (UAT 5.2)" | Terpenuhi (E9) |
| Reversal settlement (LPJ): Finance saja (bukan pemohon/pembuat), alasan wajib, teraudit, ditolak di periode tertutup, guard DB | 11.1.5 | `apps/web/src/domain/expense/lpj.ts` `reverseSettlement`; endpoint `POST /api/v1/expense-requests/{id}/settle/reverse`; migrasi `20260926_131136_s3a_e9_hardening` (`pk_settlements_guard`) | integrasi "settlement reversal" (refund, shortfall, periode tertutup, guard DB) | Terpenuhi (E9) |
| `login_failed`: log event Keycloak = sumber (password salah/lockout); ProyekKas mencatat login yang ditolak di sisinya (callback OIDC gagal, akun tidak dikenal/nonaktif), throttle 30/menit/IP | 7.x (L2), catatan | ADR 0003 §7; `apps/web/src/auth/sessions.ts` `auditLoginFailed` | integrasi "login_failed on the ProyekKas side" | keputusan + implementasi kecil, di luar hitungan L1 |
| Hash-chain `audit_logs` (ADR 0006 §5) | 7.x (L2) | ADR 0006 §5: **ditunda** (serialisasi semua transaksi tulis; usulan digest harian) | — | keputusan, di luar hitungan L1 |
| Ambang coverage unit test `apps/web` di CI | 14.2.x (proses) | `.github/workflows/ci.yml` job `verify` → `npm run test:coverage`; ambang di `apps/web/vitest.config.ts` | — | di luar hitungan L1 |

**Ambang coverage (§CI).** Baseline terukur 2026-09-26 (unit test, `src/**/*.ts` tanpa migrasi, `payload-types.ts`,
`openapi.generated.ts`, `seed/`): statements 30,5 %, branches 20,5 %, functions 26,8 %, lines 32,1 %. Ambang CI
ditetapkan sedikit di bawahnya — **lines 30, statements 28, functions 25, branches 18** — agar regresi tertangkap tanpa
gagal karena fluktuasi kecil. Angkanya rendah karena view React (`.tsx`) dan servis yang bergantung DB diuji oleh suite
integrasi (Postgres throwaway), bukan unit test; naikkan ambang setiap kali coverage unit bertambah.

Catatan perilaku: tanpa `sig`, `GET /api/v1/media/{collection}/{id}/file` tetap menjawab **404** untuk file yang tidak
boleh dibaca (tidak membocorkan keberadaan, `tests/integration/files.int.test.ts` tidak berubah); **403** hanya pada
jalur URL bertanda tangan (sesuai AC E9: "user tanpa akses → 403 walau `sig` valid").

## 4. Checklist per bab

Singkatan path: `web/` = `apps/web/`, `int/` = `apps/web/tests/integration/`, `unit/` = `apps/web/tests/unit/`.

### V1 — Arsitektur

ASVS 4.0.3 tidak memiliki persyaratan L1 di V1. Sebagai konteks L2: model ancaman & keputusan arsitektur tercatat di
ADR 0001–0013 dan `docs/proyekkas/architecture.md` (§6 API, §7 authz); rule semgrep proyek `.semgrep/proyekkas.yml`
(`payload-local-api-implicit-override-access`) memaksa setiap panggilan Local API menyatakan `overrideAccess` secara
eksplisit.

### V2 — Autentikasi

Seluruh login (password, TOTP, brute force, reset) ada di Keycloak; aplikasi mematikan strategi lokal Payload
(`web/src/collections/Users.ts` `auth.disableLocalStrategy: true`, hanya `oidcSessionStrategy` dan `mobileBearerStrategy`).

| # | Persyaratan (ringkas) | Status | Bukti | Catatan |
|---|---|---|---|---|
| 2.1.1 | Password ≥ 12 karakter | Terpenuhi | [KC] ADR 0003 §1: policy `length(12)` | Realm prod: verifikasi di E10. |
| 2.1.2 | Password ≥ 64 karakter diizinkan, ≤ 128 ditolak | Terpenuhi | [KC] ADR 0003 §1: `maxLength(128)` | |
| 2.1.3, 2.1.4, 2.1.11, 2.1.12 | Tanpa truncation; Unicode diizinkan; paste diizinkan; opsi tampilkan password | Sebagian | [KC] perilaku form login tema Keycloak | Belum diverifikasi eksplisit; QA cek manual di form login `drms-staging` (4 nomor). |
| 2.1.5, 2.1.6 | User dapat mengganti password; wajib password lama | Sebagian | [KC] Account Console Keycloak | Belum dipastikan Account Console aktif untuk realm `drms` dan ditautkan dari aplikasi (2 nomor). |
| 2.1.7 | Password dicek terhadap daftar password bocor | Celah | [KC] policy ADR 0003 §1 tidak memuat `passwordBlacklist` | Usul: policy `passwordBlacklist` dengan daftar top-N. |
| 2.1.8 | Indikator kekuatan password | Celah | — | Tema bawaan Keycloak tidak punya meter. Prioritas rendah. |
| 2.1.9 | Tanpa aturan komposisi karakter | Celah | [KC] policy `upperCase(1) lowerCase(1) digits(1) specialChars(1)` | Menyimpang dari ASVS; kebijakan platform. Perlu keputusan user: terima deviasi atau ubah policy. |
| 2.1.10 | Tanpa rotasi password berkala | Terpenuhi | [KC] policy tanpa `forceExpiredPasswordChange` | |
| 2.2.1 | Anti-otomasi / brute force | Terpenuhi | [KC] `bruteForceProtected true` (ADR 0003 §1); [infra] `ratelimit-login` di router `/auth/` dan `ratelimit-drms-kc-token` (architecture §3.3); `ratelimit-login` 10/min/IP di token endpoint (architecture §3.1) | Staging terverifikasi; prod di E10 (`bruteForceProtected` diverifikasi). |
| 2.2.2 | Autentikator lemah (SMS/email) tidak dipakai sendiri | N/A | — | Tidak ada OTP SMS/email. |
| 2.2.3 | Notifikasi setelah perubahan kredensial | Celah | [KC] realm SMTP masih kosong (ADR 0003 §6 "Onboarding e-mail pending") | Aktifkan SMTP realm + event notifikasi (E10). |
| 2.3.1 | Password awal acak, berumur pendek, wajib diganti | Sebagian | [KC] user dibuat dengan password sementara + required action `UPDATE_PASSWORD` (ADR 0003 §6); `web/src/auth/keycloak-admin.ts` | Password sementara dikirim di luar sistem dan tidak kedaluwarsa otomatis; `execute-actions-email` menunggu SMTP realm. |
| 2.5.1 | Secret pemulihan tidak dikirim cleartext | N/A | [KC] `resetPasswordAllowed false` (ADR 0003 §1) | Tidak ada reset mandiri. |
| 2.5.2, 2.5.3 | Tanpa password hint / pertanyaan rahasia; tidak menampilkan password saat pemulihan | Terpenuhi | [KC] tidak dikonfigurasi; aplikasi tidak menyimpan password (`disableLocalStrategy`) | 2 nomor. |
| 2.5.4 | Tidak ada akun default/bersama | Terpenuhi | `web/src/collections/Users.ts` (tanpa strategi lokal); admin pertama ditautkan lewat seed `SEED_ADMIN_KEYCLOAK_SUB` (ADR 0003 §6) | |
| 2.5.5 | Notifikasi bila faktor autentikasi diganti | Celah | [KC] SMTP realm kosong (ADR 0003 §6) | Sama dengan 2.2.3 (mis. TOTP direset). |
| 2.5.6 | Pemulihan password aman | Sebagian | [KC] reset oleh Admin dengan password sementara | Prosedur belum tertulis di runbook (E12). |
| 2.7.1–2.7.4 | Autentikator out-of-band | N/A | — | 4 nomor. |
| 2.8.1 | OTP berbasis waktu punya masa berlaku | Terpenuhi | [KC] TOTP bawaan Keycloak (required action `CONFIGURE_TOTP`, ADR 0003 §6) | |

### V3 — Manajemen sesi

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 3.1.1 | Token sesi tidak pernah di URL | Terpenuhi | Sesi web di cookie (`web/src/auth/cookies.ts`), APK di header `Authorization` (`mobileBearerStrategy`) | Parameter `exp`/`uid`/`sig` URL media (E9) bukan token sesi: kapabilitas 300 s, akses tetap dicek ulang. |
| 3.2.1 | Token baru saat autentikasi | Terpenuhi | `web/src/app/(auth)/auth/callback/route.ts` → `createWebSession` (`web/src/auth/sessions.ts`) membuat id baru; cookie `pk_oidc_tx` dihapus | |
| 3.2.2 | Entropi token ≥ 64 bit | Terpenuhi | `newSessionId()` = 32 byte `randomBytes` (256 bit); DB hanya menyimpan `hashSessionId` (SHA-256) | `unit/security.test.ts` "generates 256-bit ids and stores only a hash". |
| 3.2.3 | Token disimpan aman di browser | Terpenuhi | Cookie HttpOnly `__Host-pk_session` (`serializeCookie`) | |
| 3.3.1 | Logout & kedaluwarsa membatalkan sesi | Terpenuhi | `POST /auth/logout` (`web/src/app/(auth)/auth/logout/route.ts`) → `revokeWebSession`; hook `afterLogout` → `revokeCurrentWebSession`; `oidcSessionStrategy` menolak sesi `revokedAt`/`expiresAt` lewat; device dicabut → 401 `DEVICE_REVOKED` | `int/api.int.test.ts` "inactive user or revoked session → 401", "self-revoke … device is rejected (401)". |
| 3.3.2 | Re-autentikasi berkala (L1: ≤ 30 hari) | Terpenuhi | `SESSION_MAX_AGE_S` = 10 jam (`web/src/auth/sessions.ts`); APK: offline session max 30 hari, idle 14 hari (ADR 0003 §1) [KC] | |
| 3.4.1 | Atribut `Secure` | Terpenuhi | `serializeCookie`; `AUTH_COOKIE_INSECURE` ditolak di produksi dengan issuer https (`web/src/lib/env.ts`) | `unit/security.test.ts` "refuses insecure cookies…", "uses __Host- prefix + Secure…". |
| 3.4.2 | Atribut `HttpOnly` | Terpenuhi | `serializeCookie` | |
| 3.4.3 | Atribut `SameSite` | Terpenuhi | `SameSite=Lax` default | Lax diperlukan untuk redirect OIDC; CSRF ditutup di 4.2.2. |
| 3.4.4 | Prefix `__Host-` | Terpenuhi | `sessionCookieName`, `oidcTxCookieName` | |
| 3.4.5 | `Path` yang tepat | Terpenuhi | `Path=/` + `__Host-` (tanpa `Domain`) | |
| 3.7.1 | Sesi penuh/valid sebelum transaksi sensitif | Terpenuhi | Setiap request memvalidasi ulang sesi + user aktif (`oidcSessionStrategy`, `loadActiveUser`) atau token + device aktif (`mobileBearerStrategy`); `v1()` menolak tanpa `req.user` | Tidak ada step-up (mis. transfer); bukan syarat L1. |

### V4 — Kontrol akses

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 4.1.1 | Akses ditegakkan di sisi server tepercaya | Terpenuhi | Access function koleksi (`web/src/access/policies.ts` `byRole`, `rolesAllowed`; `web/src/access/scope.ts`); wrapper `v1()` di `web/src/api/v1/http.ts` (auth + `roles`); rule semgrep `payload-local-api-implicit-override-access` (job CI `security`) | `/admin/*` tanpa sesi → 302 (E9) hanya lapis tambahan. |
| 4.1.2 | Atribut akses tidak bisa dimanipulasi user | Terpenuhi | Peran efektif APK = peran token ∩ peran tersimpan (`mobileBearerStrategy`); field `roles`/`active`/`keycloakSub` hanya Admin (`Users.ts` `fieldRoles('pk-admin')`); trigger `pk_protect_columns` (`web/src/migrations/20260923_103219_security.ts`) | `int/api.int.test.ts` "token claiming pk-admin gains nothing"; `int/authz.int.test.ts` "users.roles can only be changed by admin". |
| 4.1.3 | Least privilege | Terpenuhi | Matriks per peran di `byRole`; delete ditolak semua peran (`denyAll`); role DB app tanpa UPDATE/DELETE/TRUNCATE di `audit_logs`, DELETE hanya allow-list (`DELETE_GRANTS`) | `int/db-security.int.test.ts` "grants (least privilege)"; `int/authz.int.test.ts` "delete is forbidden…"; `unit/config-guards.test.ts`. |
| 4.1.5 | Gagal secara aman | Terpenuhi | `byRole` → `false` bila tidak ada rule cocok; `v1()` → 500 generik; guard DB → 409; strategi → `{ user: null }` pada error | E9: 403 dicek sebelum 409 di `requireAction` (`web/src/domain/expense/common.ts`). |
| 4.2.1 | Perlindungan IDOR / akses data | Terpenuhi | Scope own/team/assigned (`scope.ts`, `ownUser`, `teamProjects`); `mediaFileEndpoint` memakai `findByID(overrideAccess:false)`; `visibleRequestIds` | `int/authz.int.test.ts` "read scopes…"; `int/files.int.test.ts` "other user's receipt → 404…". E9: URL media bertanda tangan tetap cek akses ulang. |
| 4.2.2 | Anti-CSRF | Terpenuhi | `oidcSessionStrategy`: metode unsafe dengan `Origin`/`Sec-Fetch-Site` asing → tidak terautentikasi; `SameSite=Lax`; logout hanya POST + cek `Origin` | `int/api.int.test.ts` "cross-origin POST is not authenticated". ZAP terautentikasi 2026-09-27: alert "Absence of Anti-CSRF Tokens" (form logout/edit) = false positive karena kontrol ini (`../qa/s3-e9-qa-report.md` §7.4). |
| 4.3.1 | MFA untuk antarmuka administratif | Sebagian | [KC] required action `CONFIGURE_TOTP` dipakai pada akun admin bootstrap/UAT (ADR 0003 §6; UAT F2 memakai password + TOTP) | Aplikasi **tidak** menegakkan MFA (tidak ada cek `acr`/`amr`); bergantung pada setiap akun diberi TOTP. Usul: OTP wajib di realm untuk peran panel, atau cek `amr` di `auth/callback`. |
| 4.3.2 | Directory listing mati, metadata (.git) tidak terekspos | Terpenuhi | Next standalone tanpa listing; `.dockerignore` mengecualikan `.git`, `.env*`, `docs`; media di `/data/media` tidak disajikan statis | Diverifikasi E9 QA 2026-09-26: `/.git/HEAD`, `/.git/config`, `/.env`, `/package.json` → 403 (WAF), `/server.js` → 404, tanpa listing (`../qa/s3-e9-qa-report.md` §1.4). |

### V5 — Validasi, sanitasi, encoding

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 5.1.1 | HTTP parameter pollution | Sebagian | Query dibaca dengan `searchParams.get` (nilai pertama); body divalidasi zod | E9 QA: `?version=1.0.0&version=abc` di `/api/v1/app/config` → nilai **terakhir** dipakai (`Object.fromEntries`) lalu ditolak zod (400); endpoint lain `searchParams.get` (nilai pertama) → tidak seragam, tanpa dampak (nilai tetap divalidasi). Belum ada test parameter ganda (`../qa/s3-e9-qa-report.md` §1.4). |
| 5.1.2 | Mass assignment | Terpenuhi | Skema zod (`web/src/api/v1/schemas*.ts`, 40 pemakaian `.strict()`/`strictObject`); field access Payload (`Users.ts` `ADMIN_FIELDS`, field `access: { update: () => false }` di media) | |
| 5.1.3 | Validasi input allow-list | Terpenuhi | `v1()` → `opts.body.safeParse` → 400 problem+json; regex id/enum (`FileCollectionEnum`, `MediaKindEnum`, `IDEMPOTENCY_KEY_RE`, `DEVICE_HEADER_RE`) | |
| 5.1.4 | Data terstruktur bertipe kuat | Terpenuhi | zod + tipe Payload (`payload-types.ts`); CI `check:openapi` (kontrak) | |
| 5.1.5 | Redirect hanya ke tujuan yang diizinkan | Terpenuhi | `safeReturnTo` (`web/src/auth/oidc.ts`); `post_logout_redirect_uri` tetap; redirect URI exact di Keycloak (ADR 0003) | `unit/security.test.ts` "open redirect guard". |
| 5.2.1 | Sanitasi HTML dari WYSIWYG | N/A | Tidak ada field `richText` | |
| 5.2.2 | Data tak terstruktur disanitasi | Sebagian | React escaping; `maxLength` di sebagian field (`Users.ts` `name`, `phone`) | Batas panjang belum seragam di semua field teks. |
| 5.2.3 | Injeksi SMTP/IMAP | Terpenuhi | Email teks polos (`web/src/jobs/tasks.ts` `sendEmail({ text })`); `SMTP_FROM_NAME` regex tanpa CR/LF (`web/src/lib/env.ts`) | |
| 5.2.4 | Tanpa `eval`/kode dinamis | Terpenuhi | CSP produksi tanpa `'unsafe-eval'` (`buildCsp`); semgrep `p/typescript` | `unit/security.test.ts` "allows eval only in development". |
| 5.2.5 | Template injection | Terpenuhi | `renderTemplate` (`web/src/domain/notifications.ts`) hanya placeholder allow-list `{docNo|title|amount|status|type}` | |
| 5.2.6 | SSRF | Terpenuhi | `assertNoRemoteSource` + `pasteURL: false` (`web/src/collections/media/factory.ts`); URL keluar hanya dari env (`rewriteToInternal`) | `int/media.int.test.ts` "rejects remote-URL sources…"; `unit/config-guards.test.ts`. |
| 5.2.7 | SVG berisi skrip | Terpenuhi | `mimeTypes` media tanpa `image/svg+xml` (`web/src/collections/media/index.ts`) | |
| 5.2.8 | Template/Markdown/CSS/XSL tak tepercaya | N/A | — | |
| 5.3.1 | Output encoding sesuai konteks | Terpenuhi | React; `Response.json`; CSV `csvCell` menetralkan formula (`web/src/lib/csv.ts`) | `unit/f3-reports.test.ts` "formulas are neutralised". |
| 5.3.2 | Encoding menjaga charset/locale | Terpenuhi | UTF-8 end-to-end (React, JSON, CSV dengan BOM `CSV_BOM`); UI `id` (`payload.config.ts` `i18n`) | |
| 5.3.3 | Perlindungan XSS | Terpenuhi | Tidak ada `dangerouslySetInnerHTML` di `web/src`; CSP nonce tanpa `strict-dynamic` (`web/src/lib/csp.ts`, `web/src/proxy.ts`) | `style-src 'unsafe-inline'` (keputusan user 2026-09-23, Payload admin). |
| 5.3.4 | Query DB terparameter | Terpenuhi | Payload/Drizzle; SQL mentah memakai template `sql\`\`` terparameter (`web/src/lib/idempotency.ts`); `sql.raw` hanya di migrasi | semgrep `p/owasp-top-ten`. |
| 5.3.5 | Encoding bila tanpa parameterisasi | N/A | — | |
| 5.3.6 | JSON injection | Terpenuhi | `Response.json` / `json()` / `problem()` (`http.ts`) | |
| 5.3.7 | LDAP injection | N/A | — | |
| 5.3.8 | OS command injection | Terpenuhi | Tidak ada `child_process` di `web/src` | |
| 5.3.9 | LFI/RFI | Terpenuhi | `mediaPath` + `MEDIA_FILENAME_RE` (`web/src/lib/media-files.ts`): nama dari DB, harus UUID, tidak keluar `staticDir` | `int/files.int.test.ts` "traversal-looking ids". |
| 5.3.10 | XPath/XML injection | N/A | — | |
| 5.5.2 | XXE | N/A | Tidak ada parsing XML (XLSX hanya ditulis, `web/src/lib/xlsx.ts`) | |
| 5.5.3 | Deserialisasi tak tepercaya | Terpenuhi | Hanya `JSON.parse` + zod | |
| 5.5.4 | JSON parse aman | Terpenuhi | `JSON.parse` (tanpa `eval`) di `v1()` | |

### V6 — Kriptografi tersimpan

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 6.2.1 | Modul kripto gagal aman (tanpa padding oracle) | Terpenuhi | `sealTx`/`openTx` (`web/src/auth/oidc.ts`) JWE `dir`/`A256GCM` via `jose`; error → 400 generik di callback; `verifyMedia` (E9) `timingSafeEqual` | Persyaratan V6 lain = L2/L3 (enkripsi data at-rest, manajemen kunci). |

### V7 — Error handling & logging

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 7.1.1 | Kredensial/token sesi tidak di-log | Terpenuhi | `loggerOptions` `redact` (`authorization`, `cookie`, `*.accessToken`, `*.refreshToken`, `*.idToken`, `*.client_secret`) di `web/src/lib/logger.ts`; sesi hanya tersimpan sebagai hash | Tidak ada test yang memverifikasi redaksi. |
| 7.1.2 | Data sensitif lain tidak di-log | Sebagian | `*.accountNo` di-redact; komentar "No tokens, cookies or bodies in logs" | Redact hanya satu level (`*.accountNo`); belum ada review log nyata. QA: periksa log Loki selama ZAP/load test. |
| 7.4.1 | Pesan error generik + id untuk support | Terpenuhi | `problem(500, 'Internal Server Error')` (`http.ts`); callback "Login gagal. Silakan ulangi."; `X-Request-Id` (`web/src/proxy.ts`, `web/src/lib/request-meta.ts`) | E9: urutan 403/409 konsisten. Diverifikasi E9 QA: REST generik (`/api/users`, `/api/users/abc`) → 403 pesan generik; `/api/v1/*` 401 `problem+json`, rute tak dikenal 404 JSON Payload `Route not found` — tanpa stack (`../qa/s3-e9-qa-report.md` §1.4). E9 QA auth 2026-09-27: REST generik dengan body non-JSON → **500** (TypeError di hook; stack hanya di log server) — bug B-1 (Low), seharusnya 400 (`../qa/s3-e9-qa-report.md` §7.4). |

Catatan L2: event `login_failed` bersumber dari log event Keycloak (keputusan E9, ADR 0003 §7); keputusan hash-chain
`audit_logs` dicatat di ADR 0006 §5 (E9). Audit append-only sudah ditegakkan DB (`int/db-security.int.test.ts`).

### V8 — Perlindungan data

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 8.2.1 | Header anti-cache untuk data sensitif | Sebagian | `/api/v1`: `Cache-Control: no-store` (`json()`, `problem()`); file media `private, no-store` (`modifyResponseHeaders`, `mediaFileEndpoint`) | E9 QA: HTML admin `private, no-cache, no-store, max-age=0, must-revalidate` (terverifikasi); REST generik `/api/<slug>` **tanpa** `Cache-Control` (temuan M-3, Low) → G-08. Auth 2026-09-27: `/api/v1` terautentikasi `no-store` (terverifikasi); unduhan laporan `private, no-store`. |
| 8.2.2 | Data sensitif tidak di storage browser | Terpenuhi | Web: sesi hanya cookie HttpOnly, tanpa JWT Payload (`refresh` hook `setCookie: false`); APK: `apps/mobile/lib/core/storage/secure_store.dart`, `allowBackup="false"` | |
| 8.2.3 | Data klien dibersihkan setelah sesi berakhir | Sebagian | Cookie dihapus saat logout (`Max-Age=0`) | Tanpa `Clear-Site-Data`; pembersihan data APK saat logout tidak dinilai di dokumen ini. |
| 8.3.1 | Data sensitif di body/header, bukan query string | Terpenuhi | Token di header; body JSON | `sig` URL media (E9) bukan data sensitif. |
| 8.3.2 | User dapat mengekspor/menghapus datanya | Celah | — | Sistem internal dengan kewajiban retensi keuangan; butuh keputusan user (UU PDP) apa yang berlaku. |
| 8.3.3 | Bahasa jelas tentang pengumpulan data pribadi | Celah | — | Selfie, GPS absensi, rekening karyawan dikumpulkan; belum ada pemberitahuan privasi di web/APK. |
| 8.3.4 | Data sensitif teridentifikasi + kebijakan | Sebagian | ADR 0006 (kelas audit A), `view_sensitive` untuk bukti transfer (`mediaFileEndpoint`), retensi selfie (`retention_purge`, Q-33) | Belum ada inventaris data pribadi formal. |

### V9 — Komunikasi

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 9.1.1 | TLS untuk semua koneksi klien | Terpenuhi | [infra] Traefik + Let's Encrypt (ADR 0002, architecture §3.2–3.3); aplikasi menolak cookie insecure dengan issuer https di produksi (`env.ts`) | Staging `le-http-staging` → prod `le-http` di E10. |
| 9.1.2, 9.1.3 | Cipher suite kuat; hanya TLS 1.2/1.3 | Sebagian | [infra] konfigurasi TLS Traefik platform | E9 QA (staging, dari host): TLS 1.0/1.1 ditolak, 1.2/1.3 diterima; TLS 1.2 masih menerima suite CBC/non-PFS (`ECDHE-RSA-AES128-SHA`, `AES128-SHA256`) = default Traefik (temuan M-2, Low, infra). Host prod belum ada (E10) (2 nomor). |

### V10 — Kode berbahaya

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 10.3.1 | Update aplikasi lewat kanal aman & bertanda tangan | Sebagian | Paksa upgrade APK (426 `minAppVersion`, `v1()`); Android App Links + fingerprint sertifikat (`web/src/lib/env.ts` `parseCertFingerprints`) | Kanal distribusi APK rilis + signing key rilis belum ditetapkan (CI hanya build APK staging, `.github/workflows/mobile.yml`). |
| 10.3.2 | SRI / tanpa skrip pihak ketiga | Terpenuhi | CSP `script-src 'self' 'nonce-…'` tanpa CDN; editor Monaco dilarang (`unit/config-guards.test.ts`) | |
| 10.3.3 | Perlindungan subdomain takeover | Sebagian | DNS dikelola manual user (Hostinger, architecture §3.2) | Tidak ada review record DNS menggantung. |

### V11 — Logika bisnis

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 11.1.1 | Alur berurutan | Terpenuhi | State machine (`web/src/domain/expense/state.ts`, `requireAction` di `common.ts`); guard DB `pk_expense_requests_guard` (ADR 0006) | `int/expense-flow.int.test.ts`, `int/lpj.int.test.ts`. |
| 11.1.2 | Langkah dalam waktu manusiawi | Sebagian | Rate limit per user di 42 dari 64 endpoint `v1()` | Tidak ada cek waktu minimum antar langkah; risiko rendah (alur approval manusia). |
| 11.1.3 | Batas per aksi bisnis | Terpenuhi | Aturan approval (`ApprovalRules`), ≤ 5 foto per laporan (E4), upload 60/menit (`UPLOADS_PER_MINUTE`), Idempotency-Key (`web/src/lib/idempotency.ts`) | |
| 11.1.4 | Anti-otomasi panggilan berlebihan | Terpenuhi | `takeToken` (`web/src/lib/rate-limit.ts`) di `v1()`; [infra] `ratelimit-pk-api` 20/s, `ratelimit-default` untuk REST generik, CrowdSec (architecture §3.3) | Bucket in-memory (hilang saat restart, satu instance). Load test terautentikasi Q-34 (2026-09-27): 0× 429 dari limit app/Traefik pada beban normal; p95 unggah+resize > 2 s (P-1, kapasitas) (`../qa/s3-e9-qa-report.md` §7.3). |
| 11.1.5 | Batas logika bisnis & validasi | Terpenuhi | Tutup buku (G5, DB), nominal dihitung server (`lpj.ts`), guard 42501/23514 → 409 (`http.ts`); E9: reversal settlement Finance saja, teraudit, sadar tutup buku | `int/f2-authz-db.int.test.ts`, `int/f2e-uat-fixes.int.test.ts`. |

### V12 — File & resource

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 12.1.1 | Tolak file besar | Terpenuhi | `MAX_UPLOAD_BYTES` 8 MiB + `maxBytesByMime` (factory); `upload.limits` + `requestSizeLimit` 10 MiB (`payload.config.ts`); [infra] `buffering-pk` 10 MiB | `unit/config-guards.test.ts` "upload limits…". |
| 12.3.1 | Metadata nama file tidak dipakai langsung | Terpenuhi | `req.file.name = \`${randomUUID()}.${ext}\`` (factory `beforeOperation`) | `int/media.int.test.ts` "UUID name". |
| 12.3.2 | Nama file divalidasi (LFI) | Terpenuhi | `MEDIA_FILENAME_RE`, `mediaPath` | |
| 12.3.3 | Tidak ada RFI/SSRF via nama file | Terpenuhi | `assertNoRemoteSource` | |
| 12.3.4 | Reflective file download | Terpenuhi | `Content-Disposition` tetap `…; filename="<kind>-<id><ext>"` (`mediaFileEndpoint`) | |
| 12.3.5 | Metadata tidak dipakai di perintah OS | Terpenuhi | Tanpa `child_process`; sharp in-process | |
| 12.4.1 | File disimpan di luar webroot | Terpenuhi | `staticDir` di `MEDIA_DIR` `/data/media` (factory), diakses via endpoint terautentikasi | E9: URL bertanda tangan. |
| 12.4.2 | File tak tepercaya dipindai antivirus | Celah | Mitigasi: gambar di-re-encode sharp (EXIF/GPS dibuang), PDF dicek magic bytes `%PDF-` | Tidak ada AV; ADR 0004 §Consequences "ClamAV optional later". PDF disimpan apa adanya. |
| 12.5.1 | Web tier hanya menyajikan ekstensi tertentu | Terpenuhi | Media tidak disajikan statis; `MEDIA_FILENAME_RE` hanya `jpg|png|webp|pdf` | |
| 12.5.2 | File upload tidak dieksekusi sebagai HTML/JS | Terpenuhi | `nosniff`, `Content-Disposition`, `Content-Security-Policy: default-src 'none'; sandbox` (`mediaFileEndpoint`) | `int/files.int.test.ts` header check. |
| 12.6.1 | SSRF: allow-list tujuan | Terpenuhi | Tidak ada fetch URL dari input; OIDC/Keycloak admin dari env (`oidc.ts`, `keycloak-admin.ts`, path segment divalidasi) | |

### V13 — API & web service

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 13.1.1 | Encoding/parser konsisten | Terpenuhi | JSON UTF-8 tunggal di `v1()`; multipart lewat `addDataAndFileToRequest` Payload | |
| 13.1.3 | URL API tidak memuat info sensitif | Terpenuhi | Token di header; id numerik | E9 `sig` URL: HMAC terikat `uid` + TTL 300 s. |
| 13.2.1 | Metode HTTP dibatasi | Terpenuhi | `v1()` mendaftarkan per metode; `headOf` eksplisit; delete ditolak semua peran | |
| 13.2.2 | Validasi skema JSON | Terpenuhi | zod di setiap body `v1()`; kontrak OpenAPI (`npm run check:openapi`, job `verify`) | |
| 13.2.3 | CSRF untuk REST berbasis cookie | Terpenuhi | Lihat 4.2.2; bearer tidak pernah di REST generik (`mobileBearerStrategy` hanya `/api/v1/`) | `int/api.int.test.ts` "bearer on generic /api/<slug> NEVER authenticates". |
| 13.3.1 | Validasi XSD SOAP | N/A | — | GraphQL dimatikan (`graphQL.disable`, `unit/config-guards.test.ts`). |

### V14 — Konfigurasi

| # | Persyaratan | Status | Bukti | Catatan |
|---|---|---|---|---|
| 14.2.1 | Komponen up to date | Sebagian | CI: `npm audit --omit=dev --audit-level=high`, `trivy fs` + `trivy image` (gagal pada CRITICAL), image base dipin digest | HIGH di Trivy tidak menggagalkan CI; tidak ada Dependabot/Renovate. |
| 14.2.2 | Fitur tak perlu dimatikan | Terpenuhi | `graphQL.disable`, REST jobs ditutup (`jobs.access`), `disableLocalStrategy`, `poweredByHeader: false`, npm/corepack dihapus dari image (`Dockerfile`), telemetry off | `unit/config-guards.test.ts`. |
| 14.2.3 | SRI aset eksternal | Terpenuhi | Tidak ada aset CDN (CSP `'self'`) | |
| 14.3.2 | Mode debug mati di produksi | Terpenuhi | `NODE_ENV=production` (`Dockerfile`), `'unsafe-eval'` hanya dev | |
| 14.3.3 | Header tidak membocorkan versi | Terpenuhi | `poweredByHeader: false` | Diverifikasi E9 QA: tidak ada header `Server`/`X-Powered-By`/versi di HTML, `/api/v1`, REST generik, aset (`../qa/s3-e9-qa-report.md` §1.4). |
| 14.4.1 | Content-Type + charset aman | Sebagian | `Response.json` (`application/json`), `application/problem+json`; callback `text/plain; charset=utf-8` | Charset tidak eksplisit di JSON/problem+json. |
| 14.4.2 | Respons API `Content-Disposition: attachment` | Celah | — | Tambahkan di `json()`/`problem()` (`http.ts`). Prioritas rendah. |
| 14.4.3 | CSP | Terpenuhi | Nonce CSP per request (`web/src/proxy.ts`, `buildCsp`); `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` | `unit/security.test.ts` "csp …". `style-src 'unsafe-inline'` = deviasi yang diterima (Payload admin). |
| 14.4.4 | `X-Content-Type-Options: nosniff` | Terpenuhi | `next.config.ts` `headers()` (semua path), media | |
| 14.4.5 | HSTS | Sebagian | [infra] komentar `next.config.ts` "HSTS is handled by Traefik"; middleware `security-headers` | E9 QA: HSTS dikirim (Traefik) `max-age=604800` (7 hari) **tanpa** `includeSubDomains` — di bawah contoh ASVS (`max-age=15724800; includeSubDomains`) → temuan M-1 (Low, infra, nilai prod E10). |
| 14.4.6 | `Referrer-Policy` | Terpenuhi | `strict-origin-when-cross-origin` (`next.config.ts`) | |
| 14.4.7 | Anti-framing | Terpenuhi | `X-Frame-Options: DENY` + `frame-ancestors 'none'`; [infra] `frameDeny` | |
| 14.5.1 | Hanya metode HTTP yang diperlukan | Terpenuhi | `v1()` terikat metode; route Payload mengekspor GET/POST/DELETE/PATCH/PUT/OPTIONS (`web/src/app/(payload)/api/[...slug]/route.ts`) | Diverifikasi E9 QA: TRACE/TRACK/PROPFIND/PUT/DELETE ke `/admin/login` → 403 ([infra] CrowdSec AppSec CRS), OPTIONS → 400 (`../qa/s3-e9-qa-report.md` §1.4). |
| 14.5.2 | Header `Origin` tidak dipakai untuk keputusan akses | Terpenuhi | `Origin`/`Sec-Fetch-Site` hanya **menolak** (CSRF) di `oidcSessionStrategy`, tidak pernah memberi akses | |
| 14.5.3 | CORS allow-list ketat | Terpenuhi | `cors` tidak dikonfigurasi di `payload.config.ts` (tanpa `Access-Control-Allow-Origin`) | Diverifikasi E9 QA: `Origin: https://evil.example` (GET & preflight) → tanpa `Access-Control-Allow-Origin`; header `Access-Control-Allow-Headers/-Methods` default Payload tetap terkirim (Info, tanpa dampak). |

### Rekap N/A

13 nomor: 2.2.2, 2.5.1, 2.7.1, 2.7.2, 2.7.3, 2.7.4, 5.2.1, 5.2.8, 5.3.5, 5.3.7, 5.3.10, 5.5.2, 13.3.1.

## 5. Kontrol pendukung (bukti lintas-bab)

| Kontrol | Bukti |
|---|---|
| Rahasia lewat file (`*_FILE`), validasi env fail-fast, tanpa rahasia di `NEXT_PUBLIC_*` | `web/src/lib/env.ts` (`FILE_SECRETS`, `resolveFileSecrets`, `assertNoPublicSecrets`); `deploy/staging/docker-compose.yml` (`*_FILE: /run/secrets/…`); `unit/security.test.ts` "file secrets (*_FILE)" |
| Container hardening | `Dockerfile` non-root `1001:1001`, npm dihapus, `HEALTHCHECK`; compose staging `read_only`, `cap_drop: [ALL]`, `no-new-privileges` |
| Audit append-only (ADR 0006) | `web/src/audit/writer.ts` `writeAudit`, `web/src/audit/hooks.ts` `withAudit`; trigger `pk_reject_mutation`, `pk_audit_server_time` (`20260923_103219_security.ts`); `int/audit.int.test.ts`, `int/db-security.int.test.ts` |
| Migrasi hanya sebagai role owner, app role terbatas | `20260923_103219_security.ts` (cek `current_user`), migrasi `*_security.ts` F2a/F2b/F2e/F4/F4b; job CI `integration` (migrasi owner, test app role) |
| Pipeline keamanan CI | `.github/workflows/ci.yml` job `security`: gitleaks (full history), semgrep (`p/owasp-top-ten`, `p/typescript`, `.semgrep/proyekkas.yml`), `trivy fs`, hadolint; job `build`: `trivy image`; action dipin SHA |

## 6. Celah & tindak lanjut

| # | Celah / Sebagian | ASVS | Pemilik | Prioritas | Usulan |
|---|---|---|---|---|---|
| G-01 | MFA admin tidak ditegakkan (bergantung TOTP per akun) | 4.3.1 | infra + user | **Tinggi** | Wajibkan OTP di realm `drms` untuk semua akun peran panel (atau semua user), atau cek `amr` di `web/src/app/(auth)/auth/callback/route.ts`. Keputusan user. |
| G-02 | Tidak ada cek password bocor; tidak ada meter kekuatan | 2.1.7, 2.1.8 | infra | Sedang | Tambah policy `passwordBlacklist` realm `drms`; meter (tema) opsional. |
| G-03 | Aturan komposisi password (menyimpang ASVS) | 2.1.9 | user + infra | Rendah | Terima sebagai deviasi (kebijakan platform) dan catat di ADR 0003, atau ubah policy. |
| G-04 | Tidak ada notifikasi perubahan kredensial/faktor; onboarding password sementara di luar sistem | 2.2.3, 2.5.5, 2.3.1 | infra | Sedang | SMTP realm + `execute-actions-email` (E10). |
| G-05 | Tidak ada pemindaian antivirus upload (PDF disimpan apa adanya) | 12.4.2 | nextjs + infra | Sedang | ClamAV (sidecar) untuk PDF, atau terima risiko tercatat di ADR 0004. |
| G-06 | Hak subjek data & pemberitahuan privasi (selfie, GPS, rekening) | 8.3.2, 8.3.3, 8.3.4 | user | Sedang | Keputusan UU PDP; teks pemberitahuan di layar login web/APK; inventaris data pribadi. |
| G-07 | TLS cipher/versi & HSTS tidak terbukti di repo | 9.1.2, 9.1.3, 14.4.5 | qa + infra | Sedang | `testssl.sh` + ZAP pada host prod; catat nilai HSTS di architecture §3.3. **E9 QA (staging):** TLS 1.2/1.3 saja, tetapi suite CBC/non-PFS diterima (M-2); HSTS 7 hari tanpa `includeSubDomains` (M-1) → infra: `tls.options` + `stsSeconds` ≥ 180 hari untuk prod. |
| G-08 | Anti-cache REST generik | 8.2.1 | nextjs | Rendah | **E9 QA:** HTML admin sudah `no-store`; REST generik `/api/<slug>` tanpa `Cache-Control` (M-3) → tambah `Cache-Control: no-store` untuk `/api/:path*` di `next.config.ts`. |
| G-09 | Pembaruan dependensi tidak otomatis; HIGH Trivy tidak menggagalkan | 14.2.1 | nextjs | Sedang | Renovate/Dependabot; `trivy --severity HIGH,CRITICAL` (dengan `.trivyignore` terdokumentasi). |
| G-10 | Kanal distribusi & signing APK rilis belum ditetapkan | 10.3.1 | user + infra | Sedang | Tetapkan kanal (Play/MDM/unduhan HTTPS) dan kunci rilis sebelum go-live (E10). |
| G-11 | Form login Keycloak (truncation, Unicode, paste, show password, ganti password) belum diverifikasi | 2.1.3–2.1.6, 2.1.11, 2.1.12 | qa | Rendah | Uji manual di realm staging; catat hasil. |
| G-12 | Prosedur reset password oleh Admin belum tertulis | 2.5.6 | user (runbook E12) | Rendah | Runbook: verifikasi identitas + password sementara + `UPDATE_PASSWORD`. |
| G-13 | Respons API tanpa `Content-Disposition` & charset eksplisit | 14.4.1, 14.4.2 | nextjs | Rendah | Tambah di `json()`/`problem()` (`web/src/api/v1/http.ts`). |
| G-14 | Redaksi log satu level; tidak ada test redaksi | 7.1.1, 7.1.2 | nextjs + qa | Rendah | Unit test `loggerOptions().redact`; review log Loki saat load test. |
| G-15 | ~~Header versi, metode HTTP ekstra~~ (terverifikasi E9 QA: 14.3.3, 14.5.1, 4.3.2); HPP tidak seragam (nilai pertama vs terakhir) | 5.1.1 | nextjs | Rendah | Seragamkan pembacaan query + test parameter ganda. |
| G-16 | Tanpa `Clear-Site-Data` saat logout | 8.2.3 | nextjs | Rendah | Tambah header di `POST /auth/logout`. |
| G-17 | ~~Rate limit belum diuji beban terautentikasi~~ — diuji 2026-09-27 (35 akun `lt-*`): 0× 429, error 0% | 11.1.2, 11.1.4 | qa | — | Tutup. Temuan kapasitas terpisah: P-1 (p95 unggah/resize > 2 s, CPU web 0,75 ter-throttle) — keputusan user 2026-09-27: antre resize (`lib/image-queue.ts`, maks `IMAGE_RESIZE_CONCURRENCY` = 2, antrean penuh → 503 + `Retry-After`), target unggah p95 < 5 s, aksi lain < 2 s; uji ulang (laporan QA §7.3.3). |
| G-21 | ~~REST generik Payload: body non-JSON → 500 (seharusnya 400)~~ — **diperbaiki** (branch `fix/e9-upload-resize-queue`) | 7.4.1, 13.2.x | nextjs | — | `lib/body-guard.ts`: hook `beforeOperation` PERTAMA di setiap koleksi + global `company-settings` — create/update dengan `data` bukan objek (form/text, multipart tanpa `_payload`, JSON array/null) → 400 "Isi permintaan tidak valid: kirim objek JSON …" sebelum hook/akses/DB. Uji: `tests/integration/e9-perf.int.test.ts` (7 koleksi B-1 + global, POST/PATCH), `tests/unit/e9-perf.test.ts`. Tutup setelah deploy + ZAP ulang. |
| G-22 | Nonaktif pengguna lewat impor E11 tidak mencabut sesi Keycloak | 3.3.x, 2.x | nextjs + Lead | Rendah | **Mitigasi prosedural** (branch `fix/e9-upload-resize-queue`): impor tidak lagi mencoba Keycloak per perangkat (audit `device_revoke` = `keycloak_skipped`), laporan CLI menampilkan SATU blok `PERINGATAN KEYCLOAK` + `…-keycloak-tindak-lanjut.csv`; langkah disable + logout + cabut consent via `kc_*` di `runbooks/import-data-golive.md` §3.5 dan `cabut-perangkat.md` §B.1 (B-2). Sisa risiko: bergantung operator menjalankan langkah itu. |
| G-18 | Batas panjang field teks belum seragam | 5.2.2 | nextjs | Rendah | Audit `maxLength` koleksi + zod. |
| G-19 | Kebersihan DNS (subdomain takeover) | 10.3.3 | user | Rendah | Review record Hostinger saat membuat A record prod. |
| G-20 | ~~Kontrol E9 perlu dikonfirmasi~~ — **selesai**: §3 diperbarui dengan file & test final; 404 tetap untuk jalur non-signed (lihat catatan §3) | 3.x/4.x/11.1.5 | nextjs | — | Tutup. |

Temuan tambahan kecil (bukan persyaratan L1): `auth/callback/route.ts` menyimpan IP dari `x-forwarded-for` tanpa
validasi pola seperti `requestMeta` (`IP` regex) — konsistensikan (nextjs, rendah). `web-sessions.idTokenHint` disimpan
plaintext (read access `false`); pertimbangkan tidak menyimpan atau mengenkripsi (L2, nextjs).

## 7. Pending (bukan bagian dokumen ini)

- ~~ZAP baseline staging~~ — selesai tanpa login (2026-09-26) dan **terautentikasi** (2026-09-27, Staff + Direktur), §8.
- ~~Load test terautentikasi~~ — dijalankan 2026-09-27 (laporan QA §7.3): RAM lulus (web 49%), **p95 unggah/resize
  2,1–3,2 s gagal target** → keputusan user P-1 (2026-09-27): antre resize + target unggah p95 < 5 s (latar belakang
  APK), aksi lain < 2 s; **uji ulang setelah deploy** branch `fix/e9-upload-resize-queue`.
- ~~Restore drill DB + media ke `pk_drms_restoretest`~~ — selesai, RTO 6,1 s, baris & checksum cocok (laporan QA §3).
  Ulangi untuk `pk_drms` + `drms_pk_media_prod` setelah prod ada.
- **Verifikasi realm/router prod** (`bruteForceProtected`, TOTP, SMTP, TLS) — infra, E10.

## 8. Hasil ZAP baseline & cek manual (QA E9, 2026-09-26)

Laporan lengkap: `docs/proyekkas/qa/s3-e9-qa-report.md` §1 (bukti mentah `docs/proyekkas/qa/s3-e9-evidence/`).
ZAP 2.17.0 `zap-baseline.py` (pasif) 2 run tanpa login (`/` dan `/admin/login` + AJAX spider): **0 FAIL, 0 High/Critical**.

| Temuan | Severity | Baris ASVS | Status |
|---|---|---|---|
| CSP `style-src 'unsafe-inline'` (ZAP 10055, Medium) | Low — deviasi diterima | 5.3.3, 14.4.3 | Tetap (keputusan user 2026-09-23) |
| CORP tidak ada di aset statis, COEP tidak ada (ZAP 90004) | Low / Info | — (L2+) | Opsional |
| `Content-Type` tidak ada di 302 `/admin` (ZAP 10019) | Info | 14.4.1 | — |
| HSTS 7 hari tanpa `includeSubDomains` (M-1) | Low | 14.4.5 | Sebagian → G-07 |
| TLS 1.2 menerima suite CBC/non-PFS (M-2) | Low | 9.1.2 | Sebagian → G-07 |
| REST generik tanpa `Cache-Control` (M-3) | Low | 8.2.1 | Sebagian → G-08 |
| Tanpa header versi; metode ekstra 403; tanpa ACAO; `.git`/`.env` 403 | — | 14.3.3, 14.5.1, 14.5.3, 4.3.2 | Terpenuhi (diverifikasi) |

Perubahan status: 14.3.3 dan 14.5.1 Sebagian → Terpenuhi (ringkasan §2: Terpenuhi 82, Sebagian 23).

### 8.1 ZAP baseline terautentikasi (QA E9, 2026-09-27)

Sesi web akun uji beban `lt-field-30` (Staff) dan `lt-office-04` (Direktur): 142 / 837 URL, **0 FAIL, 0 High/Critical**.
Temuan baru: B-1 (500 pada body non-JSON di REST generik, Low → G-21); lainnya false positive/Info (CSRF token —
dikendalikan Origin/Sec-Fetch-Site + SameSite; IP privat di audit log = IP hairpin uji; parameter filter dipantulkan
tetapi di-escape React). Detail: `docs/proyekkas/qa/s3-e9-qa-report.md` §7.4. Status ringkasan §2 tidak berubah.

