# Runbook — Menerbitkan APK di halaman unduh `/unduh`

- **Status:** berlaku mulai rilis web yang memuat halaman `/unduh` (branch `feat/apk-download-page`) · **Tanggal:** 2026-09-27
- **Pembaca:** infra Lead / operator VPS (langkah 1–4), Admin aplikasi (langkah 5).
- **Tujuan:** karyawan PT DRMS mengunduh APK produksi dari tautan tetap milik server DRMS sendiri:
  - halaman: `https://drms-kas.bimacreative.tech/unduh`
  - file: `https://drms-kas.bimacreative.tech/unduh/proyekkas.apk` (selalu versi terbaru)
  - staging: path yang sama di `https://drms-kas.staging.bimacreative.tech`.

## Cara kerja (ringkas)

- File disimpan di **volume media** yang sudah ada (`drms_pk_media_prod` / `drms_pk_media_stg`, ikut backup harian
  `MEDIA_VOLUMES`), direktori `/data/media/app-release/`:
  `proyekkas-<versi>-arm64.apk` + manifest `latest.json` (`version`, `file`, `sha256`, `certSha256`, `size`,
  `publishedAt`, opsional `notes`). Direktori ini bukan koleksi Payload → tidak disajikan jalur lain.
- **Deskripsi rilis** (`notes`): butir-butir dari `docs/release-notes/apk/<versi>.md` (bahasa Indonesia untuk
  karyawan lapangan), dikirim ke skrip dengan `--notes`. Tampil di `/unduh` sebagai "Yang baru di versi <versi>" dan
  di APK (banner "Versi baru tersedia" di Beranda → lembar rincian, serta layar "Perbarui aplikasi") lewat
  `GET /api/v1/app/config` → `releaseNotes` — **hanya** bila versi di `latest.json` sama dengan Pengaturan →
  **Versi APK terbaru**. Teks polos saja (maks. 15 butir × 300 karakter); file yang tidak valid ditolak sebelum
  apa pun disalin.
- Halaman dan file **publik, tanpa login** (proxy/admin gate hanya berlaku untuk `/admin`), `noindex`. Tidak ada
  unggah lewat admin UI — penerbitan hanya lewat skrip di bawah (butuh akses root VPS).
- Skrip `apps/web/scripts/publish-apk.mjs` (ada di image web, hanya modul bawaan Node): menyalin APK, menghitung
  SHA-256, menulis `latest.json` secara atomik (tmp + rename), menyimpan **versi terbaru + 2 versi sebelumnya**,
  menghapus yang lebih lama. Menolak versi yang sama dengan isi berbeda (pakai versi baru, atau `--force`).
- Unduhan memakai `Cache-Control: no-cache` + `ETag` = SHA-256 → browser/proxy tidak menyajikan versi lama.
  Bila ukuran file tidak sama dengan manifest (salinan belum lengkap) → 404, bukan file rusak.
- Traefik: masuk router catch-all (`drms-pk-web`), tanpa buffering; unduhan tidak terkena batas body upload.
  Tidak ada perubahan infra yang diperlukan.

## Prasyarat

- Web di lingkungan tujuan sudah menjalankan versi yang memuat `/unduh` (cek:
  `curl -sI https://drms-kas.bimacreative.tech/unduh/proyekkas.apk` → `404` berteks "belum tersedia", bukan 404 halaman Next).
- Tag `mobile-vX.Y.Z` sudah di-build hijau oleh workflow `mobile` job `release-prod` (APK ditandatangani kunci prod,
  sertifikat diverifikasi `apksigner` di CI). SHA-256 sertifikat prod:
  `E3:09:A8:92:AE:7F:EB:C2:62:98:EA:4E:60:3F:6A:38:50:86:E5:AA:FF:47:9B:4F:A9:1D:70:18:01:17:02:53`
  (sama dengan `ANDROID_APP_CERT_SHA256` prod dan ringkasan job CI).
- Staging memakai APK **staging** (artefak `proyekkas-staging-release-apk`, sertifikat staging) — jangan menerbitkan
  APK prod di staging atau sebaliknya.

## Langkah (infra Lead, sebagai root di VPS)

### 1. Unduh artefak APK arm64 dari run tag

Dari halaman run tag di GitHub (Actions → workflow **mobile** → run untuk `mobile-vX.Y.Z` → Artifacts →
`proyekkas-prod-release-apk`), atau dengan `gh` (token cukup *Actions: read*):

```sh
V=0.2.0                                   # = pubspec version = tag mobile-v$V
D=/root/apk-release/$V
mkdir -p "$D"
gh run list -R bctech-adm/drms --workflow mobile --branch "mobile-v$V" --limit 1   # catat RUN_ID
gh run download "$RUN_ID" -R bctech-adm/drms -n proyekkas-prod-release-apk -D "$D/artefak"
# Artefak berisi app/outputs/flutter-apk/app-*-prod-release.apk (+ simbol obfuscation) → ambil arm64 saja:
mv "$(find "$D/artefak" -name app-arm64-v8a-prod-release.apk)" "$D"/ && rm -rf "$D/artefak"
ls -l "$D"/app-arm64-v8a-prod-release.apk
# Deskripsi rilis versi yang sama, dari tag (bukan dari branch lain):
gh api "repos/bctech-adm/drms/contents/docs/release-notes/apk/$V.md?ref=mobile-v$V" \
  -H 'Accept: application/vnd.github.raw' > "$D/notes.md"
cat "$D/notes.md"
# Direktori/file harus terbaca oleh uid 1001 (container):
chmod 755 "$D"; chmod 644 "$D"/app-arm64-v8a-prod-release.apk "$D/notes.md"
```

Catatan: token *Actions: read* saja tidak cukup untuk `gh api …/contents` (butuh *Contents: read*). Alternatif:
salin isi `docs/release-notes/apk/<V>.md` dari checkout repo, atau dari teks GitHub Release tag `mobile-v<V>`
(bagian di atas garis `---`), ke `"$D/notes.md"`.

Opsional (ada Android build-tools): `apksigner verify --print-certs "$D"/app-arm64-v8a-prod-release.apk`
→ SHA-256 sertifikat harus sama dengan di atas.

### 2. Terbitkan (container sekali jalan, image web yang sedang berjalan)

Tidak menyentuh container yang berjalan: container `--rm` dari **image yang sama** dengan `drms-pk-web`, hanya
memasang volume media + direktori APK (read-only), tanpa jaringan.

```sh
CERT=E3:09:A8:92:AE:7F:EB:C2:62:98:EA:4E:60:3F:6A:38:50:86:E5:AA:FF:47:9B:4F:A9:1D:70:18:01:17:02:53
IMG="$(docker inspect -f '{{.Config.Image}}' drms-pk-web)"      # staging: drms-pk-stg
VOL=drms_pk_media_prod                                            # staging: drms_pk_media_stg
docker run --rm --user 1001:1001 --read-only --network none --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 128m \
  -v "$VOL":/data/media -v "$D":/in:ro --entrypoint node "$IMG" \
  apps/web/scripts/publish-apk.mjs --apk /in/app-arm64-v8a-prod-release.apk --version "$V" --cert "$CERT" \
  --notes /in/notes.md
```

Tanpa `--notes` rilis tetap terbit, hanya tanpa bagian "Yang baru di versi …" (di `/unduh` maupun di APK).

Keluaran: JSON manifest (catat `sha256`) + daftar file lama yang dihapus. Kode keluar ≠ 0 = tidak ada yang berubah
pada `latest.json` (pesan menjelaskan sebabnya).

### 3. Verifikasi

```sh
curl -sI https://drms-kas.bimacreative.tech/unduh/proyekkas.apk
#   HTTP/2 200, content-type: application/vnd.android.package-archive,
#   content-disposition: attachment; filename="ProyekKas-<V>.apk", content-length = ukuran file, etag = "<sha256>"
curl -s https://drms-kas.bimacreative.tech/unduh/proyekkas.apk | sha256sum     # = sha256 dari langkah 2
```

Buka `https://drms-kas.bimacreative.tech/unduh` di HP: versi, ukuran, tanggal, tombol **Unduh APK**, dan kartu
**Yang baru di versi <V>** berisi butir-butir deskripsi rilis. Setelah langkah 5 (Versi APK terbaru = `<V>`):
`curl -s https://drms-kas.bimacreative.tech/api/v1/app/config | grep -o '"releaseNotes":[^]]*]'` menampilkan butir
yang sama (cache server ≤ 60 detik).

### 4. Bersihkan

```sh
rm -rf "$D"
```

### 5. Setting aplikasi (Admin, web → Pengaturan)

- **URL unduh APK** = `https://drms-kas.bimacreative.tech/unduh/proyekkas.apk` (sekali saja; URL tetap untuk semua
  rilis). Staging: `https://drms-kas.staging.bimacreative.tech/unduh/proyekkas.apk`.
- **Versi APK terbaru** = `<V>` → layar pembaruan di APK menautkan ke URL di atas.
- **Versi APK minimum**: naikkan hanya bila versi lama harus diblokir, dan hanya **setelah** langkah 3 berhasil
  (bila tidak, HP terkunci di layar "Perbarui aplikasi" tanpa file yang bisa diunduh).

## Rollback

- Menjadikan versi sebelumnya (yang masih disimpan) sebagai "terbaru" lagi — `--apk` menunjuk file di volume:
  ```sh
  docker run --rm --user 1001:1001 --read-only --network none --cap-drop ALL \
    --security-opt no-new-privileges:true --memory 128m -v "$VOL":/data/media --entrypoint node "$IMG" \
    apps/web/scripts/publish-apk.mjs --apk /data/media/app-release/proyekkas-<V_LAMA>-arm64.apk \
    --version <V_LAMA> --cert "$CERT"
  ```
  (Deskripsi rilis versi lama ikut hanya bila `--notes` diberikan lagi — pasang `-v <dir>:/in:ro` dengan file
  `docs/release-notes/apk/<V_LAMA>.md` dan tambahkan `--notes /in/notes.md`.)
  Catatan: Android **tidak** memasang versi lebih rendah di atas versi lebih tinggi (harus hapus aplikasi = data
  lokal/antrian offline hilang). Untuk HP yang sudah memasang versi baru, perbaikan = rilis versi lebih tinggi.
- Menyembunyikan unduhan sama sekali: hapus `latest.json` (file APK tetap) → `/unduh` menampilkan "APK belum
  tersedia", `/unduh/proyekkas.apk` → 404. Kosongkan juga **URL unduh APK** di Pengaturan.

## Riwayat dokumen

| Tanggal | Perubahan |
|---|---|
| 2026-09-27 | Versi awal (halaman `/unduh` + skrip `publish-apk.mjs`). |
| 2026-09-28 | Deskripsi rilis: `--notes` dari `docs/release-notes/apk/<V>.md` → `/unduh` + `releaseNotes` untuk APK. |
