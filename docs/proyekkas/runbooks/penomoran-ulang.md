# Runbook — Penomoran ulang dokumen (SATU KALI)

- **Status:** berlaku (DRMS 13/10 Wave 4, Umum #1) · **Tanggal:** 2026-10-13 · **Dasar:** ADR 0007
  [§ "Amendment 2026-10-13"](../adr/0007-document-numbering.md), migrasi `20261013_610000_d1310_renumber`, CLI
  `apps/web/src/renumber/cli.ts` (+ `plan.ts`, `db.ts`).
- **Permintaan klien:** "Reset penomoran dari 1 dan bentuk ulang nomor yang sudah ada berdasarkan tanggal dibuat. Kas
  Masuk belum ada kode singkat PT."
- **Pelaksana:** **infra Lead** (staging dan prod). Prod **hanya** setelah *go* tertulis dari owner (Direktur) atas
  daftar perubahan nomor (CSV dry-run). Developer/agent **tidak** menjalankan apa pun di staging/prod.
- **Sifat:** sekali per PT, **satu transaksi**, tidak berjalan otomatis saat deploy. Migrasi `20261013_610000` (ikut
  deploy biasa) hanya memasang prasyarat (aksi audit `renumbered`, tabel `document_renumber_runs`, pengaman
  `pk_renumber_bypass`) — **tidak mengubah nomor apa pun**.

## Apa yang dilakukan

| Aspek | Aturan |
|---|---|
| Dokumen | Semua nomor terbit milik kita di PT yang dipilih: PB (`expense_requests`), TRF (`transfers`), LPJ (`settlements`), KM/KK (`cash_entries.entry_no`), LP, ADD, SV, LH, PJ — termasuk dokumen dibatalkan/void/jurnal balik dan periode yang sudah tutup buku (nominal, tanggal, akun **tidak** berubah). Draft (belum bernomor) dan nomor eksternal aktivitas purna jual (Q/PO/SJ/INV) tidak disentuh. |
| Kelompok | PT × jenis dokumen × **bulan dokumen** (tanggal yang sama yang dipakai saat nomor terbit: tanggal pengajuan / transfer / kas / laporan / pinjaman; LPJ & addendum: saat nomor pertama kali terbit), zona waktu penomoran. |
| Urutan | **Tanggal dibuat** (`created_at`), seri dengan id → 1, 2, 3 … |
| Bentuk | Pola penomoran PT saat ini, mis. `PB/DRMS/2610/0001`. Pola tanpa `{COMPANY}` (mis. KM `KM/{YY}{MM}/{seq}`) lebih dulu diganti ke default `KM/{COMPANY}/{YY}{MM}/{seq}` (4 digit, reset bulanan, mulai 1; diaudit). |
| Salinan nomor | Diganti dalam transaksi yang sama: keterangan kas ("Transfer TRF/… — PB/…", "Jurnal balik KM/…", "Pengembalian LPJ …"), notifikasi (nomor, judul, isi), flag nota ganda (pesan + `otherDocNo`). **Tidak** diubah: log audit lama (append-only; baris baru `renumbered` menautkan lama → baru), catatan/alasan yang diketik pengguna, PDF/cetakan yang sudah dibagikan (PDF baru dari sistem langsung memakai nomor baru). |
| Counter | Per kelompok = nomor terakhir + 1 (boleh turun: celah lama ditutup); bulan yang tidak punya dokumen → 1; kunci lama `ALL` dibiarkan. |
| Audit | Satu baris `renumbered` per dokumen yang berubah (lama → baru, `tx_id` sama), satu per keterangan kas yang ditulis ulang; satu baris per PT di `document_renumber_runs` (operator, sha256 rencana, jumlah). Log perubahan menampilkan **"Nomor diubah: lama → baru"**. |
| Sekali saja | Run kedua untuk PT yang sama **ditolak** DB (`document_renumber_runs` unik per PT; kode keluar 3). |

## Perintah

CLI berjalan di **image migrate** dengan **DSN role OWNER** (`DATABASE_URL` / `DATABASE_URL_FILE`), sama seperti
`payload migrate` — **bukan** role app (apply/verify menolak selain `*_owner`). Argumen setelah `--`:

```
node /app/node_modules/payload/bin.js run src/renumber/cli.ts -- --dry-run --all --out /out
node /app/node_modules/payload/bin.js run src/renumber/cli.ts -- --apply   --all --out /out --operator "<nama Lead>" --expect-sha256 <sha256 dry-run>
node /app/node_modules/payload/bin.js run src/renumber/cli.ts -- --verify  --all --out /out
```

| Opsi | Arti |
|---|---|
| `--dry-run` / `--apply` / `--verify` | wajib, pilih satu |
| `--all` / `--company KODE[,KODE…]` | semua PT, atau PT tertentu (kode singkat PT) — pilih satu |
| `--out` | folder laporan `penomoran-ulang-<mode>-<waktu>.json` (+ `.csv` untuk dry-run/apply), mode 0600 |
| `--operator` | wajib untuk apply; masuk ke alasan audit dan `document_renumber_runs` |
| `--expect-sha256` | wajib untuk apply: sha256 dari dry-run yang **sudah direview**; beda = data berubah → ditolak (kode 4), ulangi dry-run |

Kode keluar: `0` lulus · `1` error (rencana berisi error / apply gagal → ROLLBACK, tidak ada yang berubah / verifikasi
gagal) · `2` argumen salah · `3` sudah pernah dijalankan untuk PT itu · `4` rencana berbeda dari yang direview.

Contoh pemanggilan lewat Compose (nama service persis diverifikasi infra Lead; service migrate memakai DSN owner):

```bash
install -d -m 0700 -o 1001 -g 1001 /srv/drms-renumber/out
cd <folder compose>
docker compose run --rm -v /srv/drms-renumber/out:/out drms-pk-migrate \
  node /app/node_modules/payload/bin.js run src/renumber/cli.ts -- --dry-run --all --out /out
```

**Laporan berisi nomor dokumen, judul dan isi notifikasi (data klien)** → simpan di luar repo (mis.
`/opt/src/proyekkas-private/penomoran-ulang/`, mode 0600). Jangan pernah commit laporan (`.gitignore`:
`penomoran-ulang-*`).

## Langkah

### 0. Prasyarat

- [ ] Web dengan migrasi `20261013_610000_d1310_renumber` sudah ter-deploy di lingkungan itu (`migrate` Exited 0).
- [ ] Setiap PT punya **kode singkat** (Perusahaan (PT)); dry-run menolak PT bernomor tanpa kode.
- [ ] Penomoran dokumen per PT diperiksa (Sistem › Penomoran dokumen): pola Admin yang memuat `{COMPANY}` dipertahankan
      apa adanya — bila reset bukan bulanan atau nomor awal bukan 1, dry-run memberi PERINGATAN; ubah dulu bila klien
      ingin "mulai dari 1 per bulan" untuk jenis itu.
- [ ] Jendela pemeliharaan disepakati (sebaiknya di luar jam kerja). Apply mengunci tabel dokumen untuk **tulis**
      (baca tetap jalan) selama transaksi berlangsung (detik–menit); permintaan simpan yang menunggu lebih dari
      `lock_timeout` 15 s di sisi CLI membatalkan apply tanpa perubahan → ulangi.

### 1. Staging

1. **Backup**: `backup.sh run` (dump `pk_drms_stg` sebelum apply) — catat nama file dump.
2. **Dry-run** `--all` → baca ringkasan: jumlah dokumen / berubah per PT × jenis, pola yang diperbaiki, counter,
   teks turunan, PERINGATAN, **ERROR (harus 0)**, `sha256 rencana`.
3. **Review** CSV (`kode_pt;tabel;jenis;id;dibuat;tanggal_dokumen;periode;urut;nomor_lama;nomor_baru;berubah`):
   urutan per bulan mengikuti kolom `dibuat`; KM/KK bernomor dengan kode PT; tidak ada baris tak terduga.
4. **Apply** `--operator "<nama>" --expect-sha256 <sha256 dari langkah 2>` → otomatis diikuti verifikasi.
5. **Verifikasi** (boleh diulang kapan saja) `--verify --all`: semua baris `[OK]`:
   run tercatat per PT; rencana tanpa error; nomor sesuai urutan tanggal dibuat (0 akan berubah); tidak ada nomor ganda
   per PT × jenis; semua pola memuat `{COMPANY}`; counter = nomor terakhir + 1; jumlah audit `renumbered` = jumlah
   dokumen berubah; trigger pengaman aktif; perubahan nomor biasa tetap ditolak DB (percobaan di transaksi yang selalu
   di-*rollback* — tidak ada yang tersimpan).
6. **Cek manual (read-only)** di web staging: buka beberapa pengajuan/kas → nomor baru; "Log perubahan" menampilkan
   "Nomor diubah: lama → baru"; buat satu dokumen baru di bulan berjalan → nomornya = terakhir + 1; PDF memakai nomor
   baru. APK: tarik-ulang daftar (sinkron) → nomor baru.
7. Kirim CSV dry-run staging + hasil verifikasi ke owner sebagai contoh.

### 2. Produksi (infra Lead, setelah *go* owner)

1. *Go* tertulis owner atas CSV dry-run **prod** (bukan staging) — tanggal + nama dicatat.
2. **Backup** `pk_drms` tepat sebelum apply (dump oleh infra Lead) — satu-satunya titik rollback.
3. Dry-run prod (tepat sebelum apply, di jendela pemeliharaan) → 0 ERROR → sha256 sama dengan yang disetujui owner
   (bila data berubah sejak persetujuan, tunjukkan perbedaannya ke owner).
4. Apply prod dengan `--expect-sha256` yang disetujui → verifikasi otomatis semua `[OK]`.
5. Simpan laporan JSON/CSV (folder privat), catat txid, nama file dump, jam mulai/selesai di catatan rilis.
6. Umumkan ke pengguna: nomor lama → baru (CSV untuk Finance/Direktur); cetakan lama tidak lagi cocok dengan sistem —
   cetak ulang bila perlu.

## Bila gagal

- **Apply gagal / ditolak** → transaksi di-*rollback*, tidak ada yang berubah (DB tetap seperti sebelum apply). Baca
  pesan: kode 3 = sudah pernah, kode 4 = data berubah (ulangi dry-run + review), kode 1 = error rencana / lock timeout /
  nomor ganda (laporkan ke developer dengan laporan JSON).
- **Verifikasi gagal setelah apply sukses** → jangan ulangi apply (ditolak). Laporkan ke developer; keputusan
  perbaikan maju atau restore dump oleh infra Lead + owner.
- **Rollback** setelah COMMIT = restore dump pra-apply ke DB baru lalu tukar (destruktif, konfirmasi owner). Tidak ada
  perintah "batalkan penomoran ulang"; `down` migrasi menolak setelah ada run.

## Rujukan

- ADR 0007 § "Amendment 2026-10-13"; ADR 0006 (audit append-only); ADR 0005 (buku kas).
- Tes: `apps/web/tests/unit/d1310-w4-renumber.test.ts` (perencanaan), `apps/web/tests/integration/d1310-w4-renumber.int.test.ts`
  (dry-run tanpa tulis, apply, teks turunan, audit, counter n + 1, idempoten, pengaman tetap aktif, Log perubahan).

## Riwayat dokumen

| Tanggal | Perubahan |
|---|---|
| 2026-10-13 | Versi awal (DRMS 13/10 Wave 4). |
