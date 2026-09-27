# Runbook — Impor data go-live (E11)

- **Status:** siap dipakai (S3 track B) · **Tanggal:** 2026-09-26 · **Penyusun:** nextjs-developer (S3b)
- **Rujukan:** `plans/fase1-golive.md` §E11 · ADR 0005 (kas, "As implemented (S3b)") · ADR 0007 (penomoran) ·
  ADR 0003 (Keycloak) · open questions Q-17, Q-19/20, Q-22, Q-23, Q-36, Q-37, Q-40
- **Kode:** `apps/web/src/import/` (spesifikasi sheet, parser, impor), CLI `src/import/cli.ts`, generator template
  `apps/web/scripts/gen-import-template.mjs`, migration `20260926_133934_s3b_data_import`
- **Template:** `docs/proyekkas/templates/drms-impor-golive-template.xlsx` (kosong, untuk klien) dan
  `docs/proyekkas/templates/drms-impor-golive-contoh-fiktif.xlsx` (contoh FIKTIF untuk latihan/uji)

---

## 1. Alur singkat

```
Klien isi template ──► Lead: dry-run STAGING ──► perbaikan (ulang sampai 0 error)
        │                                            │
        │                          file "keycloak-users" ──► Lead buat akun di Keycloak realm drms
        │                                            │        └─► ekspor pemetaan username,id (kc-map)
        ▼                                            ▼
  tanggal go-live disepakati ──► PROD: backup ──► dry-run (dengan kc-map) ──► commit ──► verifikasi
```

Prinsip:
- **Dry-run tidak menyimpan apa pun.** Semua penulisan dijalankan sungguhan di dalam satu transaksi database
  lalu **selalu di-rollback** — validasi Payload, hook dan trigger DB ikut diuji, tetapi tidak ada data tersimpan.
- **Commit** menjalankan dry-run dulu; hanya bila 0 error, impor dijalankan ulang dengan **satu transaksi per master**
  (Bank → Satuan → Kategori → Karyawan → Pengguna → Rekening → Pusat biaya → Project → Tahapan → RAB → Kendaraan →
  Penugasan → Akun kas → Cut-over).
- **Idempoten:** setiap baris dicocokkan dengan kunci alaminya (kode, username/email, bank + no. rekening, no. polisi,
  project + urutan, …). Baris yang sama → tidak ditulis; baris berubah → diperbarui (tercatat di audit log dengan
  alasan `Impor data go-live <file> (sha256 …)`). Impor kedua dengan file yang sama = 0 baru, 0 ubah.
- **Audit:** setiap master yang berubah + ringkasan tiap run dicatat sebagai `audit_logs.action = 'import'`
  (source `system`); setiap baris data juga punya audit per field seperti perubahan lewat admin.
- **Tidak ada password** di file mana pun. Akun login dibuat Lead di Keycloak (di luar alat impor).

## 2. Yang harus disiapkan klien

| Sheet | Isi | Catatan |
|---|---|---|
| Pengaturan | `tanggal_golive`, `nomor_pb_mulai` (229, Q-17), `tutup_periode_sebelum_golive` (Ya) | Disarankan go-live tanggal 1 |
| Bank | Bank umum sudah terisi; tambah bank lain (mis. bank daerah) | Kode bank dipakai di Rekening/AkunKas |
| Satuan, Kategori | Sudah terisi usulan Q-19/Q-20; ubah/tambah seperlunya | `perlu_kendaraan` = Ya untuk BBM & Service Kendaraan (Q-22) |
| Karyawan | Semua karyawan (juga yang tanpa akun login) | Kode karyawan unik |
| Pengguna | Username, email (opsional, Q-37), nama, kode karyawan, peran | Peran: Direktur, Finance, PM, Staff, Admin |
| Rekening | Rekening tujuan transfer per karyawan | Nomor rekening sebagai teks |
| PusatBiaya | Lokasi operasional + penanggung jawab + koordinat/radius absen (Q-23, Q-40) | Koordinat opsional; tanpa koordinat = absen di lokasi itu ditolak |
| Project | Project berjalan + PM + koordinat/radius + RAB total | RAB kosong = jumlah sheet RAB |
| Tahapan | Tahapan + bobot per project (total 100 %) | Progress awal 0 % |
| RAB | Opsional: RAB per kategori | |
| Kendaraan | No. polisi, jenis (Q-22) | |
| Penugasan | Karyawan → project ATAU pusat biaya | Menentukan project yang terlihat di APK & lokasi absen |
| AkunKas | Akun kas/bank perusahaan + **saldo per tanggal go-live** | Saldo bank = saldo rekening koran akhir hari sebelum go-live |

Aturan pengisian ada di sheet **Petunjuk** template (Bahasa Indonesia) dan sebagai pesan bantuan di setiap sel
(muncul saat sel dipilih). Kolom bertanda `*` wajib. Pilihan (Ya/Tidak, peran, jenis, status) berupa dropdown;
kolom kode yang merujuk sheet lain juga punya dropdown dari sheet tersebut.

**Data pribadi** (no. rekening, no. HP): file dikirim hanya lewat saluran yang disepakati; Lead menyimpannya di
luar repo (mis. `/opt/src/proyekkas-private/golive/`, mode `0600`). **Jangan pernah commit file klien atau laporan
impor ke git.**

## 3. Menjalankan impor (Lead)

Alat impor berjalan di **image migrate** (image yang sama dengan seed: berisi `src/` dan dependensi lengkap),
dengan **DSN role APP** (bukan owner — CLI menolak role `*_owner`). Argumen setelah `--` (tanpa `--`,
`payload run` membuang flag):

```
node /app/node_modules/payload/bin.js run src/import/cli.ts -- --dry-run --file /import/<file>.xlsx --out /out
node /app/node_modules/payload/bin.js run src/import/cli.ts -- --commit  --file /import/<file>.xlsx --kc-map /import/kc-map.csv --out /out --operator "<nama Lead>"
```

| Opsi | Arti |
|---|---|
| `--dry-run` / `--commit` | wajib, pilih satu |
| `--file` | file .xlsx klien (maks. 10 MB, 5 000 baris per sheet) |
| `--kc-map` | opsional: pemetaan `username → id Keycloak` (CSV `username,id` dengan/tanpa header, urutan kolom bebas, atau JSON `[{username,id}]` / `{username: id}`) |
| `--out` | folder laporan: `impor-<mode>-<waktu>.json` + (bila ada pengguna tanpa akun) `…-keycloak-users.json/.csv` |
| `--operator` | nama pelaksana, masuk ke alasan audit |

Kode keluar: `0` = lulus/tersimpan, `1` = ada error (lihat laporan), `2` = argumen salah.

### 3.1 Dry-run di staging (berulang sampai 0 error)

```bash
# di host staging, folder milik uid 1001 (user container), mode 0700
install -d -m 0700 -o 1001 -g 1001 /srv/drms-import /srv/drms-import/out
install -m 0400 -o 1001 -g 1001 data-klien.xlsx /srv/drms-import/
sha256sum /srv/drms-import/data-klien.xlsx          # catat, muncul juga di laporan & audit

cd <folder compose staging>
docker compose --profile seed run --rm \
  -v /srv/drms-import:/import:ro -v /srv/drms-import/out:/out \
  drms-pk-stg-seed \
  node /app/node_modules/payload/bin.js run src/import/cli.ts -- --dry-run --file /import/data-klien.xlsx --out /out
```

Membaca hasil:
- Tabel `Sheet / baris / baru / ubah / sama / lewati` = apa yang **akan** terjadi.
- `ERROR` — format `[Sheet baris N kolom X] pesan`; nomor baris = nomor baris di Excel. Kembalikan ke klien
  (atau perbaiki bersama), ulangi dry-run sampai **0 error** (AC E11).
- `PERINGATAN` — tidak memblokir, tetapi harus dibaca: mis. pengguna yang belum punya akun Keycloak, project tanpa
  PM/koordinat, go-live bukan tanggal 1, nomor PB sudah berjalan.
- Error "Saldo awal terkunci" = akun sudah melewati tutup buku (lihat §6).

Opsional — **gladi commit di staging** dengan file yang sama. Staging berisi data UAT: bila tidak ingin
bulan-bulan staging terkunci, set `tutup_periode_sebelum_golive = Tidak` pada salinan file untuk staging.

### 3.2 Akun Keycloak (realm `drms`, di luar alat impor)

1. Dari dry-run, ambil `…-keycloak-users.json` / `.csv`: `username, email (boleh kosong), firstName, enabled,
   realmRoles (pk-owner = Direktur, pk-finance, pk-pm, pk-staff, pk-admin), employeeCode`. **Tanpa password.**
2. Lead membuat user di realm `drms` (username, email bila ada, realm role sesuai `realmRoles`, password awal
   sementara/required action "Update Password" — diserahkan ke pengguna lewat saluran terpisah; tanpa email →
   reset oleh Admin, Q-37).
3. Ekspor pemetaan username → id, mis. `kcadm.sh get users -r drms --fields username,id --format csv --noquotes > kc-map.csv`
   (perintah persis diverifikasi infra Lead). Simpan `kc-map.csv` di `/srv/drms-import/` (0400, uid 1001).
4. Dry-run ulang dengan `--kc-map`: baris Pengguna menjadi "baru" dan PM/penanggung jawab terisi.

Pengguna tanpa pemetaan **tidak dibuat** di ProyekKas (dilewati dengan peringatan); PM/penanggung jawab yang
merujuk pengguna tersebut dikosongkan dulu. Impor ulang dengan `--kc-map` lengkap akan mengisinya (idempoten).
Pengguna tanpa email disimpan di ProyekKas dengan email pengganti `<username>@pengguna.drms.invalid` (domain
`.invalid` tidak pernah terkirim; tidak dikirim ke Keycloak).

### 3.3 Produksi (hari cut-over)

Prasyarat:
- [ ] Migrasi prod termasuk `20260926_133934_s3b_data_import` sudah jalan (`migrate` Exited 0), seed sudah jalan
      (penomoran dokumen, aturan approval).
- [ ] Belum ada transaksi di prod (pengajuan, kas) — impor dilakukan sebelum pengguna mulai bekerja.
- [ ] **Backup** `pk_drms` tepat sebelum impor (dump oleh infra Lead) — titik rollback.
- [ ] File yang sama persis dengan dry-run staging terakhir (bandingkan sha256), `tanggal_golive` = tanggal final.
- [ ] Akun Keycloak prod dibuat, `kc-map.csv` prod siap.

Langkah:
1. Dry-run prod dengan `--kc-map` → harus 0 error; periksa peringatan dan baris "Cut-over".
2. Commit prod (`--commit … --operator "<nama>"`).
3. Simpan laporan JSON (folder privat) dan catat `run` id + sha256 di catatan cut-over.

### 3.4 Verifikasi setelah commit

- [ ] Hasil `TERSIMPAN`, 0 error. Kolom `baru + ubah + sama + lewati` per sheet = jumlah baris Excel (AC E11).
- [ ] **Rekap Kas** (Laporan › Rekap Kas, filter per akun): saldo per akun = saldo awal klien (AC E11).
- [ ] **Tutup buku**: bulan sebelum go-live berstatus Ditutup (Keuangan › Tutup buku).
- [ ] **Nomor PB**: baris cut-over menampilkan "PB pertama: 229/PB-DRMS/<DD>/<MM romawi>/<YYYY>"; pengajuan
      pertama yang dikirim di prod bernomor 229 (AC E11).
- [ ] Audit log: filter aksi `import` → satu baris per master yang berubah + satu ringkasan (`selesai`).
- [ ] Commit kedua dengan file yang sama (opsional, sebagai bukti) → semua `baru 0, ubah 0` (AC E11).
- [ ] Login uji satu pengguna per peran (web + APK).
- [ ] Bila laporan memuat blok **`PERINGATAN KEYCLOAK`**: jalankan §3.5 (wajib sebelum serah terima).

### 3.5 Langkah Keycloak setelah impor menonaktifkan / mengaktifkan pengguna (E9 B-2, ASVS G-22)

Alat impor **tidak pernah memanggil Keycloak** (container `…-seed` sengaja tanpa env OIDC/KC admin). Saat baris
Pengguna berubah `aktif = Tidak`, impor mencabut **perangkat dan sesi web ProyekKas** (audit `device_revoke` dengan
nilai `keycloak_skipped`, `session_revoked`), tetapi **akun Keycloak tetap aktif dan sesi SSO / offline token APK tetap
hidup** sampai langkah ini dijalankan. Laporan impor merangkumnya dalam **satu** blok (bukan satu log per perangkat):

```
PERINGATAN KEYCLOAK (realm drms) — impor TIDAK mengubah Keycloak; perangkat & sesi web ProyekKas sudah dicabut, tetapi akun & sesi Keycloak belum:
  35 pengguna dinonaktifkan → WAJIB disable + logout di Keycloak (runbook import-data-golive §Langkah Keycloak): lt-field-01, …
```

dan (dengan `--out`) menulis `impor-commit-<stamp>-keycloak-tindak-lanjut.csv` (`username,email,keycloakId,action`;
`action` = `disable_logout` atau `enable`; tanpa secret). Pada dry-run blok yang sama berbunyi "akan dinonaktifkan" —
jangan jalankan langkah ini sebelum commit.

Jalankan di host (root), dengan lib infra `kc_*` (client `automation`, Admin REST hanya via `:8443`, token tidak pernah
dicetak; **jangan** `bash -x`). Realm prod `drms`; staging `drms-staging`.

```bash
set -euo pipefail
source /opt/infra/scripts/lib/odoo-pools.sh     # prasyarat lib: die, INFRA_DIR
source /opt/infra/scripts/lib/keycloak-admin.sh
kc_init drms                                    # staging: kc_init drms-staging
CSV=/srv/drms-import/out/impor-commit-<stamp>-keycloak-tindak-lanjut.csv
tail -n +2 "$CSV" | while IFS=, read -r username email kcid action; do
  if [[ -z "$kcid" ]]; then   # id kosong → cari dari username
    kcid="$(kc_get "/users?username=$(kc_urlencode "$username")&exact=true" | kc_json 'd[0]["id"] if d else ""')"
  fi
  [[ "$kcid" =~ ^[0-9a-f-]{36}$ ]] || { echo "LEWATI $username: id Keycloak tidak ditemukan"; continue; }
  case "$action" in
    disable_logout)
      kc_send PUT  "/users/$kcid" '{"enabled":false}' 204          # akun nonaktif → login & refresh ditolak
      kc_send POST "/users/$kcid/logout" "" 204                    # akhiri semua sesi SSO
      kc_send DELETE "/users/$kcid/consents/proyekkas-mobile" "" 204 404   # cabut offline token APK
      echo "OK disable+logout $username" ;;
    enable)
      kc_send PUT "/users/$kcid" '{"enabled":true}' 204
      echo "OK enable $username" ;;
  esac
done
```

Verifikasi (sampel 1–2 pengguna): `kc_get "/users/<id>" | kc_json 'd["enabled"]'` → `False`,
`kc_get "/users/<id>/sessions" | kc_json 'len(d)'` → `0`; login uji akun itu → `invalid_grant "Account disabled"`.
Catat jumlah akun yang diproses di catatan cut-over. Tanpa akses `kc_*`: lakukan hal yang sama di Admin Console realm
(Users → user → **Enabled** off → tab **Sessions** → **Sign out**; tab **Consents** → cabut `proyekkas-mobile`).

Penonaktifan lewat **web admin** (bukan impor) tidak butuh langkah ini: hook pengguna menonaktifkan akun Keycloak dan
mengakhiri sesinya sendiri (runbook `cabut-perangkat.md` §B).

## 4. Cut-over (yang dilakukan alat impor)

- **Saldo awal:** `cash-accounts.openingBalance` = `saldo_awal`, `openingBalanceDate` = `tanggal_golive`.
  Saldo = saldo awal + Σ masuk − Σ keluar (ADR 0005 §7). Transaksi kas bertanggal **sebelum** tanggal saldo awal
  akun ditolak DB (trigger `pk_cash_entries_opening_guard`).
- **Periode sebelumnya ditutup** (bila `tutup_periode_sebelum_golive = Ya`): baris `period-closings` untuk bulan
  sebelum go-live, audit `period_close`. Dilewati bila sudah ditutup, sudah terkunci oleh periode lebih akhir, atau
  pernah dibuka kembali (peringatan).
- **Nomor PB (Q-17):** `document-sequences` `expense_request.startAt = nomor_pb_mulai` (dipakai bila counter belum
  ada). Bila counter sudah ada dan lebih kecil, dinaikkan ke `nomor_pb_mulai` (audit `update` field `nextValue`).
  Counter **tidak pernah turun** (ADR 0007): bila nomor sudah melewati nilai itu → peringatan, tidak diubah.

## 5. Mengubah data setelah impor

- File boleh diimpor ulang kapan saja (idempoten); baris yang berubah diperbarui dengan alasan impor.
- **Menghapus baris dari file tidak menghapus data** di sistem. Nonaktifkan dengan `aktif = Tidak` atau lewat admin.
- Tahapan: sheet Tahapan = set lengkap per project; tahapan lama yang tidak ada di file **dinonaktifkan** (peringatan).
- Pengguna: peran di ProyekKas adalah cermin; sumber kebenaran tetap realm role Keycloak (disinkronkan saat login,
  ADR 0003). Ubah peran di Keycloak juga. `aktif = Tidak` menonaktifkan pengguna di ProyekKas (login ditolak, sesi &
  perangkat dicabut) tetapi alat impor **tidak** menyentuh Keycloak — laporan impor mendaftar pengguna itu dalam blok
  `PERINGATAN KEYCLOAK`; nonaktifkan + logout akunnya di Keycloak dengan §3.5.

## 6. Kunci saldo awal (keputusan S3b)

**Keputusan:** saldo awal **dikunci** setelah periode yang memuat tanggal saldo awal (atau periode sesudahnya)
ditutup. Sebelum itu Finance masih boleh mengoreksi (alasan wajib, diaudit). Setelah terkunci, koreksi dilakukan
dengan **kas masuk/keluar manual** beralasan — jejaknya terlihat di buku kas.

**Alasan:** setelah tutup buku, saldo awal ikut membentuk saldo akhir periode yang sudah dilaporkan; mengubahnya
diam-diam akan mengubah angka periode tertutup (bertentangan dengan tujuan tutup buku, ADR 0005 §6). Tutup buku
bulan **sebelum** go-live (bagian cut-over) sengaja tidak mengunci, agar selisih yang ditemukan pada minggu pertama
masih bisa dikoreksi sampai bulan go-live ditutup. Detail teknis: ADR 0005 "As implemented (S3b)".

Implementasi: hook koleksi (pesan 409 yang jelas) + trigger DB `pk_cash_accounts_opening_lock`; akun tanpa tanggal
saldo awal (akun lama/staging) tetap memakai aturan F2 (ubah dengan alasan).

## 7. Rollback

| Situasi | Tindakan |
|---|---|
| Dry-run gagal | Tidak ada yang disimpan — perbaiki file, ulangi. |
| Commit berhenti di tengah (error tak terduga) | Master sebelum titik gagal **sudah tersimpan** (transaksi per master), master gagal di-rollback. Perbaiki penyebab, jalankan commit lagi (idempoten). |
| Data salah, **belum ada transaksi** di prod | **Pulihkan dump pra-impor** (infra Lead: hentikan web/worker, restore `pk_drms`, jalankan lagi), lalu impor file yang benar. Menghapus baris satu per satu tidak dianjurkan (audit log append-only, banyak relasi). |
| Data salah, **sudah ada transaksi** | Jangan restore. Perbaiki lewat admin (edit beralasan, nonaktifkan) atau impor ulang file yang dikoreksi. Saldo awal terkunci → kas masuk/keluar manual. |
| Tutup buku cut-over keliru | Direktur membuka kembali periode (hanya periode tertutup terakhir, alasan wajib). |
| Nomor PB awal terlalu tinggi | Counter tidak bisa turun — hanya restore dump sebelum go-live. Periksa `nomor_pb_mulai` di dry-run ("PB pertama"). |
| Migration `s3b_data_import` perlu di-rollback | `down` hanya selama belum ada audit `import`; setelah itu restore dump (plan §11). |
| Akun Keycloak salah | Diperbaiki di Keycloak oleh Lead; pengguna ProyekKas ditaut ulang dengan `--kc-map` yang benar (id berbeda untuk email yang sama → error, perbaiki manual oleh Admin). |

## 8. Pertanyaan terbuka (default aman yang dipakai)

| # | Pertanyaan | Default sementara |
|---|---|---|
| I-1 | Tanggal go-live final? | Wajib diisi di Pengaturan; disarankan tanggal 1 (peringatan bila bukan). |
| I-2 | Progress fisik tahapan yang sudah berjalan saat go-live perlu diimpor? | Tidak: progress awal 0 %, diisi lewat laporan progress pertama (E4 — progress hanya berubah lewat laporan). |
| I-3 | Pengajuan yang sedang berjalan saat go-live (sudah ditransfer, LPJ belum)? | Tidak diimpor (Q-36): diselesaikan di kertas; saldo awal kas sudah mencerminkan transfernya. |
| I-4 | Email pengganti `<username>@pengguna.drms.invalid` untuk pengguna tanpa email (Q-37) dapat diterima? | Ya (tidak pernah terkirim; notifikasi email tidak sampai ke pengguna tersebut). |
| I-5 | Status project default saat impor | `Berjalan` bila kolom status kosong. |
| I-6 | Rekening karyawan hasil impor langsung "terverifikasi"? | Tidak: `Belum diverifikasi` — Finance memverifikasi di admin. |
| I-7 | Jadwal kerja per karyawan (E6) diimpor? | Tidak di template ini: semua memakai jadwal default perusahaan; diubah lewat admin. |
| I-8 | Perintah ekspor pemetaan Keycloak (`kcadm.sh …`) | Diverifikasi infra Lead; alat impor menerima CSV `username,id` atau JSON. |

## 9. Referensi teknis

- Spesifikasi sheet/kolom: `apps/web/src/import/spec.ts` (satu sumber untuk template, parser dan Petunjuk).
  Mengubah template: edit `spec.ts`/`sample.ts`, jalankan `npm run gen:import-template -w apps/web`, commit kedua
  file .xlsx (`npm run check:import-template` memastikan file ter-commit sama dengan generator; uji unit juga).
- Uji: `apps/web/tests/unit/s3b-import.test.ts` (parser, xlsx, pemetaan Keycloak) dan
  `apps/web/tests/integration/s3b-import.int.test.ts` (dry-run dengan error, commit, commit kedua no-op, Rekap Kas
  = saldo awal, PB pertama 229, kunci saldo awal, guard tanggal go-live).
