# Runbook — Penyelarasan alur persetujuan + pengalihan pengajuan berjalan (keputusan owner 2026-10-15)

- **Status:** berlaku (d1510) · **Tanggal:** 2026-10-15 · **Dasar:** ADR 0026
  [§ "Amendment 2026-10-15"](../adr/0026-owner-approval-level-above-direktur.md) (+ catatan di ADR 0021 / 0024),
  migrasi `20261015_200000_d1510_approval_reroute`, kode `apps/web/src/reroute/` (`plan.ts`, `db.ts`, `cli.ts`,
  `preview.sql`).
- **Keputusan owner:** semua PT memakai **Staff → PM project → Direktur → Owner → Finance (hanya transfer)**; pengajuan
  yang **belum diputuskan Direktur** ikut dialihkan ke alur itu.
- **Pelaksana:** infra Lead. Staging dulu, prod **hanya** setelah *go* owner atas hasil dry-run **prod**.
- **Sifat:** migrasi data ikut deploy biasa (`payload migrate`), satu transaksi, idempoten. Tidak mengubah skema.

## Apa yang berubah

| Aspek | Aturan |
|---|---|
| Aturan | Per PT, aturan bernama **"Default — Direktur lalu Finance (semua nominal)"** dan contoh nonaktif **"Contoh — di atas Rp 10 juta: Direktur lalu Finance (Q-31, nonaktif)"** — hanya bila bentuknya **persis** "Diketahui" Direktur → (Owner →) Finance — menjadi bentuk seed: "Diketahui" = **PM project**, level 1 **Direktur**, level 2 **Owner**; nama baru "Default — PM project lalu Direktur (semua nominal)" / "Contoh — … PM project lalu Direktur …". **Id tetap**, prioritas, nominal, aktif/nonaktif tetap. Aturan yang bentuknya sudah diubah Admin dibiarkan (tercantum di dry-run). Aturan lain (Pengajuan Owner/Direktur, vendor, antar-PT) tidak disentuh. |
| Pengajuan | Status **Menunggu persetujuan** di tahap "Diketahui" Direktur (`pending_ack`), **belum ada keputusan** pada siklus ini, di bawah aturan default di atas → aturan + snapshot persetujuan diganti dengan hasil **kirim ulang hari ini** (kode yang sama dengan Kirim). Hasilnya: menunggu **Persetujuan PM**; bila pemohon/pembuat adalah PM project itu sendiri, langkah PM **dilewati** seperti saat Kirim → langsung **Menunggu persetujuan Direktur**; pengajuan Direktur sendiri → aturan "Pengajuan Direktur" (→ Owner). Nomor, baris, nominal, lampiran, tanda tangan, siklus **tidak berubah**. |
| Tidak dialihkan | Pengajuan yang sudah lewat Direktur (Menunggu Owner, Disetujui, …), yang sudah punya keputusan di siklus ini, yang akan ditolak bila dikirim hari ini (409, mis. project tanpa PM — perbaiki data lalu jalankan dry-run lagi; migrasi tidak mengulang sendiri), dan pengajuan Owner sendiri (tanpa persetujuan — diputuskan orang, bukan migrasi). Semua tercantum di dry-run dengan alasannya. |
| Jejak | Per aturan: 1 baris audit (bentuk lama → baru, sumber `system`, alasan "keputusan owner 2026-10-15"). Per pengajuan: baris **"Alur persetujuan"** di Log perubahan (alur lama → baru), baris status bila status pindah, baris "posisi dilewati" bila langkah PM dilewati; di samping stepper: "Alur persetujuan diperbarui ke aturan terbaru (keputusan owner 2026-10-15)". |
| Notifikasi | Seperti saat Kirim, ke penyetuju pertama yang baru: in-app ("Persetujuan PM: …" / "Menunggu Approval: …" / "Persetujuan Owner: …") + email persetujuan bila PT menyalakan "email persetujuan" (antrean job `sendEmail` yang sama). Notifikasi lama ke Direktur tetap ada (riwayat); Direktur tidak lagi melihat pengajuan itu di inbox sampai PM menyetujui. Push FCM: ikut `PUSH_FCM_ENABLED` di environment service migrate. |
| Inbox / hitungan | Dihitung dari snapshot → langsung benar setelah migrasi (tidak ada langkah tambahan). |

## Pratinjau (read-only) — wajib sebelum migrasi

**A. Psql (tanpa image baru)** — dua SELECT, transaksi read-only:

```bash
docker exec -i postgres psql -U postgres -d pk_drms_stg -X -v ON_ERROR_STOP=1 \
  -c "BEGIN READ ONLY;" -f - -c "ROLLBACK;" < apps/web/src/reroute/preview.sql
```

Hasil (1): aturan `UBAH` / `TETAP (bentuk diubah Admin)`. Hasil (2): per pengajuan `ALIH` (aturan baru, status baru,
menunggu siapa, langkah yang dilewati) atau `TETAP` (catatan = alasan). Pratinjau SQL tidak memodelkan approver bernama
dan aturan "satu orang satu posisi" — hasil pasti = B.

**B. Dry-run TS (pasti, sama persis dengan migrasi)** — dengan image migrate **baru**, perintah diganti (CMD bawaan
`payload migrate` TIDAK dijalankan), transaksi `READ ONLY` yang selalu di-rollback:

```bash
install -d -m 0700 -o 1001 -g 1001 /srv/drms-d1510/out
cd <folder compose>
PK_MIGRATE_IMAGE=<image migrate baru@sha256:…> docker compose run --rm --no-deps -v /srv/drms-d1510/out:/out drms-pk-migrate \
  node /app/node_modules/payload/bin.js run src/reroute/cli.ts -- --dry-run --out /out
```

Ringkasan di layar: `[UBAH]` / `[TETAP]` per aturan, `PERINGATAN` (aturan Admin lain yang masih "Diketahui" Direktur —
tidak diubah), `[ALIH]` / `[TETAP]` per pengajuan (alur lama ⇒ alur baru, status, menunggu siapa). Laporan JSON berisi
nomor pengajuan dan nama orang → simpan di luar repo (mode 0600). Kode keluar 0 = OK.

## Langkah

### 1. Staging

1. **Backup**: `backup.sh run` (dump `pk_drms_stg`) — catat nama file.
2. Pratinjau A (dan/atau B) → simpan hasil.
3. Deploy image baru seperti biasa (migrate → web + worker). Log migrate memuat `20261015_200000_d1510_approval_reroute`
   dengan `rulesAligned`, `requestsRerouted`, `notifications` + ringkasan yang sama dengan dry-run.
4. Cek: pratinjau A lagi → (1) tidak ada `UBAH`, (2) kosong (idempoten). Di web: buka 1 pengajuan yang dialihkan →
   stepper "Persetujuan PM" (saat ini) → "Persetujuan Direktur" → "Persetujuan Owner"; catatan "Alur persetujuan
   diperbarui …"; Log perubahan "Alur persetujuan: lama → baru". Login PM → inbox Persetujuan berisi pengajuan itu.
   Pengajuan PM sendiri → "Menunggu persetujuan Direktur" di inbox Direktur.
5. Kirim hasil pratinjau staging + cek ke owner sebagai contoh.

### 2. Produksi (setelah *go* owner)

1. Pratinjau **prod** (A, atau B dengan image baru) → kirim ke owner → *go* tertulis (tanggal + nama).
2. **Backup** `pk_drms` tepat sebelum deploy (dump oleh infra Lead) — satu-satunya titik rollback setelah ada keputusan
   baru di alur baru.
3. Deploy image baru (migrate → web + worker). Bandingkan log migrate dengan pratinjau yang disetujui (pengajuan yang
   berubah status sejak pratinjau tidak dialihkan — tercantum sebagai TETAP / tidak muncul).
4. Cek seperti staging langkah 4. Umumkan ke PM: pengajuan tim yang menunggu kini ada di inbox PM.

## Rollback

- **Sebelum ada keputusan di alur baru:** `payload migrate:down` (service migrate, role owner; membatalkan *batch* migrasi
  terakhir — pastikan batch itu hanya berisi `20261015_200000_d1510_approval_reroute`) → aturan
  kembali ke nama + bentuk lama (selama belum diubah Admin), pengajuan kembali ke snapshot/status lama (dari baris audit).
  Notifikasi yang sudah terkirim tetap ada.
- **Sesudah ada keputusan** (PM/Direktur/Owner sudah memutuskan pengajuan yang dialihkan): `down` **DITOLAK** (pesan
  menyebut nomor pengajuan) — keputusan tidak dibatalkan otomatis. Rollback = restore dump pra-deploy (destruktif,
  konfirmasi owner).

## Rujukan

- Tes: `apps/web/tests/unit/d1510-reroute.test.ts` (pencocok bentuk, rencana per pengajuan, stepper, notifikasi),
  `apps/web/tests/integration/d1510-reroute.int.test.ts` (dry-run tanpa tulis, pratinjau SQL = rencana TS, migrasi:
  snapshot = kirim baru, PM → Direktur → Owner → antrian transfer, idempoten, down memulihkan / ditolak setelah ada
  keputusan).
