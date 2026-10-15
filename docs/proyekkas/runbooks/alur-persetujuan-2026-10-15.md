# Runbook — Penyelarasan alur persetujuan + pengalihan pengajuan berjalan (keputusan owner 2026-10-15)

- **Status:** berlaku (d1510) · **Tanggal:** 2026-10-15 · **Dasar:** ADR 0026
  [§ "Amendment 2026-10-15"](../adr/0026-owner-approval-level-above-direktur.md) (+ catatan di ADR 0021 / 0024),
  migrasi (urutan deploy) `20261015_150000_d1510_finance_rule_data` → `20261015_200000_d1510_approval_reroute` →
  `20261015_210000_d1510_approval_inflight_trim`, kode `apps/web/src/reroute/` (`plan.ts`, `db.ts`, `cli.ts`,
  `preview.sql`; `trim-plan.ts`, `trim-db.ts`, `trim-finalize.ts`, `preview-trim.sql`).
- **Keputusan owner:** semua PT memakai **Staff → PM project → Direktur → Owner → Finance (hanya transfer)**; pengajuan
  yang **belum diputuskan Direktur** ikut dialihkan ke alur itu (200000). Pengajuan Finance: **Finance → Direktur →
  Owner → Finance transfer**, tanpa persetujuan Finance lagi (150000). Lanjutan (owner, 2026-10-15: "Pastikan ini
  berlaku dengan transaksi yg existing; jika masih berjalan lanjutkan penyesuaian approval flow"): pengajuan berjalan
  yang **sudah lewat Direktur** pun tidak lagi disetujui Finance — alur berakhir di Owner (210000, bagian di bawah).
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

### Lanjutan: level Finance pada pengajuan berjalan (`20261015_210000_d1510_approval_inflight_trim`)

Berjalan **sesudah** 200000 (pengajuan yang dialihkan 200000 sudah memakai alur baru tanpa Finance). Menyentuh semua
pengajuan berstatus **menunggu keputusan** (`pending_ack` / `pending_approval`), **aturan apa pun**, yang snapshot-nya
masih punya **level approval Finance yang belum diputuskan**. Tidak pernah: Draft, Ditolak, Dibatalkan, Disetujui dan
sesudahnya, pengecualian G1; nomor, baris, nominal, tanda tangan, siklus, keputusan yang sudah ada.

| Kasus | Sekarang | Sesudah migrasi |
|---|---|---|
| 1. Menunggu sebelum level Finance (mis. **PB/DRMS/2610/0004**: Diketahui Direktur ✓ → menunggu Owner → Finance) | level Finance di belakang | level Finance **dibuang** (`steps` + `decisionRoles`); status, level saat ini, keputusan tetap. Saat Owner menyetujui → **Disetujui** → antrian transfer Finance. Juga pengajuan yang masih menunggu "Diketahui" Direktur dan tidak dialihkan 200000 (status tetap). |
| 2. Menunggu di level Finance, snapshot **tanpa** level Owner (ADR 0013: Diketahui Direktur ✓ → Finance) | Finance yang menunggu | level itu menjadi level **Owner** (nomor level sama); Owner PT diberi notifikasi seperti "level berikutnya" (in-app + email persetujuan bila PT menyalakannya). Tetap bila PT tanpa Owner aktif / semua Owner adalah pemohon/pembuat / sudah memutuskan posisi lain (G1) — tercantum. |
| 3. Menunggu di level Finance **sesudah Owner menyetujui** | Finance yang menunggu | **Disetujui** lewat kode finalisasi persetujuan terakhir yang sama (approved_at, approved_amount, baris status, notifikasi, antrian transfer Finance) — **cek dana ADR 0029 dulu** bila PT menyalakannya: ditolak → tetap menunggu, tercantum (putuskan manual). Hanya lewat `payload migrate` (dry-run menyebutnya `[SETUJU]`). |
| 4. Alur lama tanpa langkah PM project, Direktur sudah memutuskan | — | **tidak** dikembalikan ke PM; Log perubahan / catatan stepper: "PM project: tidak berlaku — alur lama — Direktur sudah memutuskan". |

Jejak per pengajuan: baris **"Alur persetujuan"** di Log perubahan (alur lama → baru; nilai lama = yang dipulihkan
`down`), baris status bila status pindah (kasus 3, alasan "keputusan owner 2026-10-15"), catatan stepper "Alur
persetujuan diperbarui (keputusan owner 2026-10-15): Finance tidak lagi menyetujui — hanya transfer" (+ catatan kasus 4).

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
tidak diubah), `[ALIH]` / `[TETAP]` per pengajuan (alur lama ⇒ alur baru, status, menunggu siapa); lalu bagian
**210000** (dihitung untuk keadaan SESUDAH 200000 — pengajuan yang dialihkan 200000 hanya dihitung): `[POTONG]` (kasus
1), `[OWNER]` (kasus 2), `[SETUJU]` (kasus 3 — cek dana baru dijalankan saat migrasi), `[TETAP]` + alasan. Laporan JSON
(kunci `trim` untuk 210000) berisi nomor pengajuan dan nama orang → simpan di luar repo (mode 0600). Kode keluar 0 = OK.
Catatan: dry-run sebelum 150000 berjalan tidak melihat aturan "Pengajuan Finance" (pengajuan yang SEMUA pemohonnya
Finance akan memakai aturan itu saat migrasi).

**C. Psql untuk 210000** — satu SELECT, transaksi read-only:

```bash
docker exec -i postgres psql -U postgres -d pk_drms_stg -X -v ON_ERROR_STOP=1 \
  -c "BEGIN READ ONLY;" -f - -c "ROLLBACK;" < apps/web/src/reroute/preview-trim.sql
```

`prediksi`: `POTONG` / `OWNER` / `SETUJU` / `TETAP`, atau `LEWAT` = masih "Diketahui" Direktur di bawah aturan default
lama → dialihkan dulu oleh 200000 (alur barunya tanpa Finance; bila 200000 justru MEMBIARKAN-nya — lihat pratinjau A —
210000 memotong level Finance-nya). Kolom `level_baru_peran`, `status_baru`, `menunggu`, `pm` (kasus 4), `catatan`.
Batas: syarat G1 Owner baru hanya sebagian (kolom `owner_aktif`) — hasil pasti = B.

## Langkah

### 1. Staging

1. **Backup**: `backup.sh run` (dump `pk_drms_stg`) — catat nama file.
2. Pratinjau A (dan/atau B) → simpan hasil.
3. Deploy image baru seperti biasa (migrate → web + worker). Log migrate memuat, berurutan,
   `20261015_150000_d1510_finance_rule_data` (aturan "Pengajuan Finance" per PT), `20261015_200000_d1510_approval_reroute`
   (`rulesAligned`, `requestsRerouted`, `notifications` + ringkasan) dan `20261015_210000_d1510_approval_inflight_trim`
   (`trimmed`, `ownerLevels`, `approved`, `kept`, `notifications` + ringkasan `[POTONG]`/`[OWNER]`/`[SETUJU]`/`[TETAP]`).
4. Cek: pratinjau A lagi → (1) tidak ada `UBAH`, (2) kosong (idempoten); pratinjau C lagi → hanya `TETAP`. Di web: buka 1 pengajuan yang dialihkan →
   stepper "Persetujuan PM" (saat ini) → "Persetujuan Direktur" → "Persetujuan Owner"; catatan "Alur persetujuan
   diperbarui …"; Log perubahan "Alur persetujuan: lama → baru". Login PM → inbox Persetujuan berisi pengajuan itu.
   Pengajuan PM sendiri → "Menunggu persetujuan Direktur" di inbox Direktur. Pengajuan kasus 1 (prod: PB/DRMS/2610/0004)
   → stepper tanpa "Approval Finance", catatan "… Finance tidak lagi menyetujui — hanya transfer · PM project: tidak
   berlaku — …"; inbox Owner berisi pengajuan itu, inbox Finance (Persetujuan) tidak.
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
  terakhir — satu deploy = satu batch berisi 150000, 200000 dan 210000; `down` berjalan dari yang terakhir) → 210000:
  level Finance kembali ke snapshot (dari baris audit); 200000: aturan kembali ke nama + bentuk lama (selama belum
  diubah Admin), pengajuan kembali ke snapshot/status lama; 150000: aturan "Pengajuan Finance" dihapus (dinonaktifkan
  bila sudah dipakai). Notifikasi yang sudah terkirim tetap ada.
- **210000 dengan kasus 3** (pengajuan langsung **Disetujui** oleh migrasi): `down` 210000 **DITOLAK** — persetujuan
  tidak dibatalkan otomatis → restore dump pra-deploy (prod 2026-10-15: tidak ada kasus 3).
- **Sesudah ada keputusan** (PM/Direktur/Owner sudah memutuskan pengajuan yang dialihkan): `down` **DITOLAK** (pesan
  menyebut nomor pengajuan) — keputusan tidak dibatalkan otomatis. Rollback = restore dump pra-deploy (destruktif,
  konfirmasi owner).

## Rujukan

- Tes: `apps/web/tests/unit/d1510-reroute.test.ts` (pencocok bentuk, rencana per pengajuan, stepper, notifikasi),
  `apps/web/tests/integration/d1510-reroute.int.test.ts` (dry-run tanpa tulis, pratinjau SQL = rencana TS, migrasi:
  snapshot = kirim baru, PM → Direktur → Owner → antrian transfer, idempoten, down memulihkan / ditolak setelah ada
  keputusan).
- Tes 210000: `apps/web/tests/unit/d1510-trim.test.ts` (perencana: kasus 1–4, G1, teks, catatan stepper),
  `apps/web/tests/integration/d1510-trim.int.test.ts` (dry-run tanpa tulis, pratinjau SQL = rencana TS, cek dana
  menolak kasus 3 → tetap, migrasi seperti `payload migrate`: kasus 1 → Owner menyetujui → antrian transfer tanpa
  Finance, kasus 2 Owner diberi notifikasi, kasus 3 Disetujui lewat finalisasi aplikasi, idempoten, down memulihkan /
  ditolak setelah keputusan).

## Pratinjau prod 2026-10-15 (read-only, sebelum deploy)

- 17 pengajuan berjalan, semuanya dengan level Finance. 16 (`pending_ack`, "Diketahui" Direktur, aturan default LAS /
  PMK) dialihkan **200000**: 1/PB-LAS/12/X/2026, PB/LAS/2610/0002–0011, 0013, 0014, PB/PMK/2610/0001 → "Menunggu
  persetujuan Direktur" (PM project = pemohon/pembuat → langkah PM dilewati); PB/LAS/2610/0012 dan 0015 (Staff) →
  "Persetujuan PM". 150000 tidak mengubah satu pun (tidak ada pengajuan yang semua pemohonnya Finance).
- **210000**: hanya **PB/DRMS/2610/0004** (Diketahui Direktur ✓ → menunggu Owner → Finance) → kasus 1 `[POTONG]`:
  Direktur (Diketahui) → Owner; menunggu Persetujuan Owner; catatan kasus 4. Tidak ada kasus 2 / 3.
