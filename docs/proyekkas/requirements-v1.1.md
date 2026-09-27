# ProyekKas — Kebutuhan Pengembangan v1.1 (APK + Web Admin)

Klien: PT Double Rezki Makmur Sejahtera (DRMS) · Tanggal: 23 September 2026 · Status: **draf untuk review klien**
Penyusun: Business & System Analyst (Fase 0, dokumen saja)

Sumber:
- `reference/proyekkas-kebutuhan-pengembangan.md` (v1.0, 23 Sep 2026)
- `reference/prompt-lead-proyekkas.md` bagian "Temuan tambahan dari form asli klien" butir 1–10
- `reference/contoh-form-pengajuan-biaya-drms.jpg` (form asli "228/PB-DRMS/20/IX/2026", diamati langsung)
- `f0-brief.md` (keputusan user yang mengikat, 2026-09-23)
- `proyekkas-prototipe.html` **tidak tersedia** di sesi ini. Semua rujukan ke prototipe di dokumen ini berasal dari v1.0, bukan pengamatan langsung. Detail tata letak dashboard ditandai "prototipe tidak tersedia".

Penanda:
- `[Tambahan dari form klien]`: tambahan yang berasal dari form asli klien (prompt Lead butir 1–10 dan pengamatan gambar form).
- `[Keputusan user 2026-09-23]`: tambahan yang berasal dari keputusan user di `f0-brief.md` §2.
- `[Diubah v1.1]`: isi v1.0 yang diubah.
- `[Usulan]`: nilai atau aturan yang diusulkan Analyst dan **belum** dikonfirmasi klien. Lihat `open-questions-client.md` (dirujuk sebagai `Q-xx`).

---

## Changelog v1.0 → v1.1

| # | Perubahan | Bagian | Sumber |
|---|---|---|---|
| 1 | Arsitektur ditulis ulang: backend = Payload CMS (panel admin + API) di dalam aplikasi Next.js, bukan backend Odoo. Mirror satu arah ke Odoo 19 sebagai fase transisi berikutnya. Login lewat Keycloak realm `drms`. File di volume lokal dengan abstraksi S3-compatible. | 2, 9 | [Keputusan user 2026-09-23] |
| 2 | Dua jenis pengajuan: **Uang Muka** dan **Reimburse**, masing-masing punya alur status sendiri. Status "Menunggu Owner" diganti "Menunggu Approval" (approver dari aturan approval, default Owner). | 7 (T1), 5 | [Tambahan dari form klien] |
| 3 | Pengajuan punya **baris item** (uraian, jumlah, satuan, harga satuan, total, keterangan, kategori per baris, tautan kendaraan opsional). Grand total = jumlah baris. | 5, 6, 7 | [Tambahan dari form klien] |
| 4 | Jejak persetujuan **4 posisi tanda tangan**: Diajukan Oleh (bisa lebih dari satu orang), Dibuat Oleh, Diketahui Oleh, Approval. Tanda tangan digital. | 4, 5, 7 (T2) | [Tambahan dari form klien] |
| 5 | Penomoran gaya klien `228/PB-DRMS/20/IX/2026`, format bisa diatur per jenis dokumen (master `document-sequences`). Default `PG/YYMM/####` v1.0 diganti untuk pengajuan. | 6, 7 | [Tambahan dari form klien] |
| 6 | Rekening tujuan transfer diambil dari master rekening karyawan dan boleh milik pemohon mana pun. | 5, 7 | [Tambahan dari form klien] |
| 7 | Cetak PDF "Pengajuan Biaya" yang meniru form klien, termasuk lampiran foto nota. | 3 (M16), 5 | [Tambahan dari form klien] |
| 8 | Validasi otomatis nota vs baris item (berupa flag, bukan blokir): selisih nominal, tanggal nota, satuan tidak wajar, nota ganda. | 5, 7 (T4) | [Tambahan dari form klien] |
| 9 | Master baru: Satuan (`uoms`), Kendaraan (`vehicles`), Pusat Biaya (`cost-centers`), Penomoran (`document-sequences`). Laporan biaya per kendaraan. | 6, 3 (M17) | [Tambahan dari form klien] |
| 10 | Pengajuan ditautkan ke **Project ATAU Pusat Biaya** (lokasi operasional). | 7 (T1) | [Tambahan dari form klien] |
| 11 | OCR nota sebagai *nice to have* (fase akhir). | 3 (M19) | [Tambahan dari form klien] |
| 12 | Target resize foto dijadikan kebutuhan non-fungsional (sisi perangkat dan server). | 9 | [Keputusan user 2026-09-23] |
| 13 | Matriks peran, user story (US-36…US-59), audit log, dan NFR diperbarui. US-03, US-04, US-05, US-07, US-17, US-19, US-20, US-26, US-32, US-34 diubah. | 4, 5, 8, 9 | campuran |
| 14 | Temuan konflik v1.0 vs form klien dicatat sebagai pertanyaan terbuka, tidak diputuskan diam-diam. | 1.3, `open-questions-client.md` | Analyst |
| 15 | [Keputusan user 2026-09-25/26, ADR 0013, Epik E1] Peran Owner **ditampilkan "Direktur"** (peran Keycloak tetap `pk-owner`). "Diketahui Oleh" = **persetujuan Direktur**, lalu **Approval Finance**, untuk semua nominal; **PM hanya memantau** (tidak ada hak memutuskan). Posisi yang satu-satunya pemegangnya adalah pemohon/pembuat dilewati dan dicatat; tanpa keputusan independen pengajuan ditolak (409). Revisi nota Reimburse dengan total berubah kembali ke "Menunggu Diketahui (Direktur)". | 4, 5 (US-17, US-26, US-30, US-42), 7 (T2) | [Keputusan user 2026-09-25] |

---

## Ringkasan

**Tentang aplikasi.** ProyekKas adalah aplikasi kontrol kas dan progress untuk usaha konstruksi/renovasi dan operasional lapangan DRMS dengan 5 peran: Staff lapangan, PM, Finance, Owner, dan Admin. Ada **dua** alur pengajuan [Tambahan dari form klien]:
- **Uang Muka:** pengajuan → persetujuan → transfer finance → upload nota → LPJ & verifikasi → settlement.
- **Reimburse:** karyawan membayar dulu → pengajuan dengan nota terlampir → persetujuan → verifikasi nota oleh finance → transfer → selesai.

Di sekitarnya ada absensi berbasis lokasi, project dengan tahapan berbobot, laporan progress harian, kas masuk/keluar, dan cetak form "Pengajuan Biaya" gaya klien.

**Penekanan user (2026-09-23):** tujuan utama adalah pemantauan progress lewat HP; cakupan kontrol kas di dokumen ini tetap berlaku kecuali klien memutuskan lain (lihat Q-01) [Keputusan user 2026-09-23].

**Feedback utama v1.0 tetap berlaku** (backend terpusat & waktu server, settlement LPJ, tanpa hard delete, progress hanya lewat laporan, peran Admin & master data, pembatasan akses, absensi yang bisa dipercaya, audit log append-only).

**Cakupan v1.1:** 19 modul (M01–M19), 5 peran, 59 user story, 22 master + 1 setting global (`company-settings`), transaksi T1–T12 (T1 dipecah per jenis), aturan log per transaksi.

**Platform:** APK Android (Flutter) untuk kerja lapangan (Staff, PM, approval cepat Owner). Web = panel admin + dashboard (Payload CMS dalam Next.js) untuk Finance, Owner, Admin, dan PM [Keputusan user 2026-09-23].

---

## Daftar isi

1. Temuan dari prototipe dan form klien
2. Pembagian platform & arsitektur
3. Module list
4. Role & permission
5. User story
6. Master data
7. Transaksi
8. Log changes per transaksi
9. Kebutuhan non-fungsional

---

## 1. Temuan dari prototipe dan form klien

### 1.1 Yang sudah baik (dari v1.0, tidak berubah)
- Alur pengajuan dari awal sampai LPJ sudah lengkap dan divisualkan sebagai timeline status.
- Dashboard dibedakan per peran, dan setiap kartu bisa diklik menuju halaman terkait.
- Owner melihat dampak persetujuan terhadap anggaran (% sekarang → % bila disetujui).
- Progress project dihitung dari bobot tahapan, lalu dibandingkan dengan anggaran terpakai.
- Penolakan wajib disertai alasan, dan pemohon bisa mengajukan ulang dari data lama.
- Notifikasi diturunkan dari data (pengajuan menunggu, laporan terlambat, anggaran > 85%).

Catatan: prototipe HTML tidak tersedia di sesi ini; butir di atas dikutip dari v1.0.

### 1.2 Yang perlu diperbaiki (dari v1.0)

| # | Temuan di prototipe | Rekomendasi untuk produksi |
|---|---|---|
| 1 | Data disimpan di `localStorage`, pemohon di-hardcode "Rizky", tanggal di-hardcode "22 Sep" | Backend + database terpusat. Waktu selalu diambil dari **server**, bukan jam HP. |
| 2 | Tidak ada peran Admin. Master data tidak bisa dikelola | Tambah peran **Admin** dan modul master data (panel admin web) [Keputusan user 2026-09-23]. |
| 3 | PM melihat semua project | Akses PM dibatasi ke project yang dia pegang. |
| 4 | Persetujuan hanya satu level (Owner) | Aturan approval berbasis nominal yang bisa dikonfigurasi, ditambah posisi tanda tangan [Tambahan dari form klien]. Default: Owner saja. |
| 5 | Selisih nota tidak punya alur | **Settlement LPJ** (khusus Uang Muka). |
| 6 | Transaksi kas & project bisa dihapus | Tidak ada hard delete. **Void/reversal** dengan alasan. Project diarsipkan. |
| 7 | Progress diubah lewat slider | Progress hanya lewat **laporan progress**. |
| 8 | Nomor `PG-00`+counter rusak setelah 99 | [Diubah v1.1] Penomoran per jenis dokumen yang bisa diatur; default pengajuan mengikuti format klien `228/PB-DRMS/20/IX/2026` [Tambahan dari form klien]. |
| 9 | Absensi tanpa geofence sungguhan, selfie tidak disimpan | Geofence (koordinat + radius per project), simpan selfie (di-resize), deteksi *mock location*. |
| 10 | Satu pengajuan satu nota | Banyak nota per pengajuan, dan nota ditautkan ke **baris item** [Tambahan dari form klien]. |
| 11 | Anggaran terpakai dihitung dari dana ditransfer | Tampilkan dana dicairkan dan realisasi terverifikasi. |
| 12 | Belum ada tampilan mobile khusus | Layar APK dengan navigasi bawah dan tombol aksi besar. |

### 1.3 Temuan dari form asli klien `228/PB-DRMS/20/IX/2026` [Tambahan dari form klien]

Fakta yang terbaca dari gambar form (dipakai sebagai data uji/seed):

| Elemen | Isi di form |
|---|---|
| Judul | "PENGAJUAN BIAYA", "PT DOUBLE REZKI MAKMUR SEJAHTERA", subjek "228-PB DRMS-Pengajuan Reimburse Ops Palangka Banjar keperluan Service Tronton (" (terpotong di gambar) |
| Tanggal / Nomor | 20 September 2026 (hari Minggu) / `228/PB-DRMS/20/IX/2026` |
| Logo | Logo "DRMS" bulat di kanan atas |
| Baris 1 | BBM Hilux Banjarmasin-Palangka · Jumlah 1 · Satuan "bulan" · Harga satuan kosong · Total Rp 600.000 |
| Baris 2 | Penginapan · Jumlah 2 · Satuan "kamar" · Harga satuan 339.000 · Total Rp 677.000 |
| Baris 3 | Makan siang · Jumlah, satuan, harga satuan kosong · Total Rp 170.500 |
| Grand total | Rp 1.447.500 (= 600.000 + 677.000 + 170.500) |
| Kolom Keterangan | Kosong di semua baris |
| Tanda tangan | Diajukan Oleh "Budi, Doni" (satu gambar tanda tangan untuk dua nama) · Dibuat Oleh "Citra" · Diketahui Oleh "Budi Hartono" · Approval "sari" |
| Info transfer | Transfer via Mandiri · Doni Pratama · 1234567890123 |
| Nota 1 (hotel) | POP! Hotel Banjarmasin via Traveloka, No. Pesanan 9876543210, dibeli Min 20 Sep 2026, BCA Virtual Account, 2 × Pop Room Rp 338.438, total Rp 676.876 |
| Nota 2 (makan) | Soto "Mas Joko", Banjarmasin, Tgl 10:47 21/09/26, No. TX0101.0001.000123, subtotal 155.000 + pajak restoran 15.500 = total 170.500, Cash |
| Nota 3 (BBM) | Pertamina SPBU 61234501, No. Trans 7654321, 21/09/2026 11:42:59, Dexlite, Rp 24.200/L × 24,80 L, total Rp 600.000, Cash, No. Plat DA1234XY |

Tambahan kebutuhan yang diturunkan (butir 1–10 prompt Lead), semua [Tambahan dari form klien]:

| # | Kebutuhan | Tercakup di |
|---|---|---|
| F1 | Dua jenis pengajuan: Uang Muka dan Reimburse, masing-masing punya alur status | §7 T1, US-36, US-38, US-39 |
| F2 | Baris item: No, Uraian, Jumlah, Satuan, Harga Satuan, Total, Keterangan; kategori per baris; grand total | §7 T1, US-37 |
| F3 | 4 posisi tanda tangan; "Diajukan Oleh" bisa banyak orang; "Dibuat Oleh" bisa admin; tanda tangan digital | §4, §7 T2, US-40…US-43 |
| F4 | Penomoran gaya klien, bisa diatur per jenis dokumen, token bulan romawi | §6 `document-sequences`, US-45 |
| F5 | Rekening tujuan dari master rekening karyawan, bisa milik pemohon mana pun | US-44 |
| F6 | Cetak PDF "Pengajuan Biaya" meniru form, termasuk lampiran foto nota | M16, US-46 |
| F7 | Validasi otomatis nota vs baris (flag): selisih nominal + toleransi, tanggal, satuan, nota ganda | §7 T4, US-47…US-50 |
| F8 | Master Kendaraan, tautan baris BBM/service ke kendaraan, laporan biaya per kendaraan | §6 `vehicles`, M17, US-51, US-52 |
| F9 | Pengajuan ke Project ATAU Pusat Biaya / lokasi operasional | §6 `cost-centers`, US-53 |
| F10 | OCR nota (*nice to have*, fase akhir) | M19, US-54 |

### 1.4 Konflik & kejanggalan yang ditemukan (tidak diputuskan diam-diam)

| # | Temuan | Dampak | Pertanyaan |
|---|---|---|---|
| K1 | ~~Aritmetika baris 2 tidak konsisten~~ **TERJAWAB (user 2026-09-23):** 677.000 adalah **pembulatan oleh user** dari tagihan hotel Rp 676.876 untuk 2 kamar. Harga satuan 339.000 hanya tampilan (677.000 ÷ 2 = 338.500, dibulatkan). | **Total baris = nilai utama yang diinput user** (boleh dibulatkan dari nota). Harga satuan bersifat informatif, tidak dipakai untuk menghitung total. Grand total seed tetap **Rp 1.447.500**. | Q-05 (terjawab) |
| K2 | Subjek form menyebut **"Reimburse"**, tetapi tanggal pengajuan 20 Sep 2026 sedangkan nota BBM dan makan bertanggal 21 Sep 2026 (sesudah tanggal pengajuan). | Untuk reimburse, nota semestinya sudah ada sebelum pengajuan. Arti "tanggal pengajuan" dan pemilihan jenis perlu dikonfirmasi. | Q-03, Q-04 |
| K3 | Subjek menyebut "keperluan **Service Tronton**", tetapi tidak ada baris service; baris BBM untuk **Hilux**; plat di struk DA1234XY. | Tautan kendaraan perlu di tingkat baris, bukan hanya header. Perlu tahu apakah DA1234XY = Hilux. | Q-22 |
| K4 | Diketahui Oleh "**Budi** Hartono" kemungkinan orang yang sama dengan pemohon "**Budi**". | Bertentangan dengan aturan v1.0 "pemohon tidak boleh meng-approve sendiri" bila aturan itu juga berlaku untuk "Diketahui". | Q-08 |
| K5 | v1.0 T1 punya satu langkah "Menunggu Owner"; form punya rantai Diketahui Oleh → Approval, dan approver "sari" belum tentu Owner. | Nama status dan urutan langkah perlu ditetapkan. v1.1 memakai "Menunggu Diketahui" (opsional) → "Menunggu Approval" sebagai **usulan**. | Q-06, Q-07 |
| K6 | v1.0 US-03: rekening default dari profil pemohon; form: rekening milik pemohon kedua (Doni Pratama), dibuat oleh admin (Citra). | Rekening harus dipilih dari rekening salah satu pemohon, bukan otomatis milik pembuat. | Q-11 |
| K7 | v1.0: Admin tidak punya akses ke pengajuan; form: "Dibuat Oleh" Citra (diduga admin). | Admin (atau peran lain) perlu hak membuat pengajuan atas nama orang lain. | Q-09 |
| K8 | Satu gambar tanda tangan untuk dua nama pemohon. | Apakah setiap pemohon wajib tanda tangan sendiri? | Q-10 |
| K9 | BBM satuan "bulan" (jumlah 1) padahal struk menunjukkan satu kali isi 24,80 L. Bisa salah input, bisa juga memang jatah BBM bulanan. | Karena itu validasi satuan berupa flag, bukan blokir. | Q-20 |
| K10 | Di struk Pertamina, 24,80 L × Rp 24.200 = Rp 600.160, sedangkan total tercetak Rp 600.000. | Validasi memakai **total tercetak di nota** (yang diinput/OCR), bukan hasil kali liter × harga. | – (keputusan desain, lihat T4) |
| K11 | Baris 3 (makan siang) hanya punya total, tanpa jumlah/satuan/harga satuan. | Baris "lump sum" perlu diizinkan. | Q-05 |
| K12 | v1.0 §9: file di object storage (S3/MinIO); user memutuskan volume lokal dulu. | NFR diubah. | – (keputusan user) |
| K13 | v1.0 §2 menawarkan Odoo sebagai backend; user memutuskan dibangun di luar Odoo. | §2 ditulis ulang. | – (keputusan user) |
| K14 | Form bertanggal hari Minggu. | Relevan untuk jam kerja dan hari libur (pengajuan di luar jam kerja). | Q-30 |

---

## 2. Pembagian platform & arsitektur [Diubah v1.1] [Keputusan user 2026-09-23]

### 2.1 Pembagian platform

| Peran | APK (Android) | Web (panel admin + dashboard) |
|---|---|---|
| Staff lapangan | **Utama**: absensi, pengajuan (Uang Muka/Reimburse) dengan baris item, foto nota, LPJ, tanda tangan | Opsional |
| PM | **Utama**: laporan progress + foto, absensi tim, "Diketahui Oleh" (bila ditetapkan, Q-07) | Dashboard, project, tim |
| Finance | Notifikasi + lihat saja | **Utama**: verifikasi nota & flag, transfer, verifikasi LPJ, kas, cetak PDF |
| Owner | **Approval cepat** + tanda tangan + dashboard | Dashboard lengkap, laporan |
| Admin | – | **Utama**: CRUD master data, user, setting, penomoran; membuat pengajuan atas nama pemohon (Q-09) |

### 2.2 Arsitektur (arah; detail di dokumen arsitektur & ADR oleh agent lain)

- **Backend + panel admin:** Payload CMS 3 di dalam aplikasi Next.js. Panel admin Payload dipakai sebagai halaman CRUD administrasi ("CMS" = halaman admin) untuk Admin/Finance/Owner; dashboard per peran dibuat sebagai halaman kustom. [Keputusan user 2026-09-23]
- **Tidak ada backend Odoo** di fase ini. Logika bisnis (state machine, guard, aturan akses) dijalankan di server (hook/akses kontrol Payload + endpoint/service kustom). UI tidak pernah dipercaya.
- **API:** namespace kustom `/api/v1/...` untuk aksi domain dan APK. Apakah REST bawaan Payload (`/api/<slug>`) juga dibuka ke APK diputuskan ADR API.
- **APK:** Flutter, memanggil REST API.
- **Database:** PostgreSQL 16 cluster bersama di VPS, DB baru `pk_drms` (prod) dan `pk_drms_stg` (staging) — nama tidak boleh cocok dengan pola DB Odoo (ADR 0006).
- **Identitas:** Keycloak realm terpisah **`drms`**, OIDC Authorization Code + PKCE untuk web dan APK; logout jarak jauh lewat pencabutan sesi Keycloak. Lupa/ganti password ditangani Keycloak. [Keputusan user 2026-09-23]
- **File:** volume lokal dulu (tanpa MinIO/S3), dengan abstraksi penyimpanan S3-compatible agar pindah ke object storage cukup lewat konfigurasi. Foto **wajib** di-resize/kompres di perangkat **dan** di server. [Keputusan user 2026-09-23]
- **Mirror ke Odoo (fase transisi berikutnya):** data dicerminkan satu arah (ProyekKas → Odoo 19) lewat tabel outbox + worker yang memanggil API JSON-2 Odoo 19. Skema dirancang ramah-Odoo sejak hari pertama (mis. satuan, kendaraan, pusat biaya, kategori dengan mapping akun) agar transisi mudah. Pemetaan model Odoo ditentukan di dokumen arsitektur. Waktu migrasi: Q-27. [Keputusan user 2026-09-23]
- **Push notification:** FCM (perlu ADR).
- **Tata letak dashboard:** prototipe tidak tersedia; tata letak kartu mengikuti deskripsi v1.0 (US-27) dan dirancang ulang di fase web.

---

## 3. Module list

| Kode | Modul | Isi | Platform |
|---|---|---|---|
| M01 | Autentikasi & Akun | Login SSO Keycloak realm `drms` [Keputusan user 2026-09-23], lupa/ganti password (Keycloak), sesi perangkat, logout jarak jauh, profil, rekening, **tanda tangan tersimpan** [Tambahan dari form klien] | APK + Web |
| M02 | Dashboard | Dashboard per peran (4 varian; tata letak: prototipe tidak tersedia) | APK + Web |
| M03 | Pengajuan Dana | [Diubah v1.1] Jenis Uang Muka/Reimburse, baris item, multi pemohon, atas nama, project/pusat biaya, draft, edit, batal, ajukan ulang, lampiran, riwayat [Tambahan dari form klien] | APK + Web |
| M04 | Persetujuan | Inbox approval, posisi Diketahui/Approval, tanda tangan, dampak anggaran, flag validasi, setujui/tolak dengan alasan [Tambahan dari form klien] | APK + Web |
| M05 | Pencairan / Transfer | Antrian transfer (Uang Muka setelah approval; Reimburse setelah verifikasi nota), nomor referensi, bukti transfer, posting kas keluar | Web |
| M06 | Nota & LPJ | Upload nota per baris, flag validasi otomatis [Tambahan dari form klien], kirim LPJ (Uang Muka), verifikasi/revisi, settlement | APK + Web |
| M07 | Kas & Bank | Kas masuk/keluar, akun kas, saldo, void/reversal, tutup buku, rekap (cakupan: Q-01) | Web |
| M08 | Project & Tahapan | Project, RAB, tahapan & bobot, status, arsip, addendum anggaran | Web (+ lihat di APK) |
| M09 | Laporan Progress | Laporan harian, foto (di-resize), kendala, update % tahapan | APK + Web |
| M10 | Tim & Penugasan | Anggota tim, penugasan ke project | Web |
| M11 | Absensi | Check-in/out geofence + selfie, absen oleh PM, koreksi, rekap | APK + Web |
| M12 | Notifikasi | Push, in-app, pengingat terjadwal | APK + Web |
| M13 | Laporan & Export | Rekap kas, realisasi vs RAB, absensi, pengajuan, **biaya per kendaraan & per pusat biaya** [Tambahan dari form klien]. Export Excel/PDF | Web |
| M14 | Master Data & Setting | Bagian 6; CRUD lewat panel admin web [Keputusan user 2026-09-23]; aturan approval dengan posisi tanda tangan; penomoran per dokumen | Web |
| M15 | Audit Log | Riwayat per dokumen dan log global | Web |
| M16 | Cetak Dokumen | PDF "Pengajuan Biaya" gaya form klien + lampiran foto nota [Tambahan dari form klien] | Web (+ unduh di APK, Q-16) |
| M17 | Kendaraan & Biaya Unit | Master kendaraan, tautan baris item ke kendaraan, laporan biaya per kendaraan [Tambahan dari form klien] | Web |
| M18 | Sinkronisasi Odoo (mirror) | Outbox, worker, status sinkron, retry, log gagal — fase transisi [Keputusan user 2026-09-23] | Server + Web (monitor) |
| M19 | OCR Nota (*nice to have*) | Ekstraksi tanggal, total, nama toko dari foto nota untuk pre-fill [Tambahan dari form klien] | APK + Web |

---

## 4. Role & permission [Diubah v1.1]

Kode: **C** buat, **R** lihat, **U** ubah, **X** batal/void, **A** approve, **K** diketahui (acknowledge), **V** verifikasi, **P** cetak.
Cakupan: *own* = milik sendiri (pemohon atau pembuat), *team* = project/pusat biaya yang dipegang, *assigned* = project tempat ditugaskan, *all* = semua.

Kolom "Direktur" = peran `pk-owner` (label "Direktur" sejak E1, ADR 0013 — tidak ada peran Keycloak baru).

| Modul | Staff | PM | Finance | Direktur | Admin |
|---|---|---|---|---|---|
| Pengajuan dana | C, R/U/X *own* (selama belum ada keputusan approval) | R *team*, C *own* | R *all* | R *all* | R *all*; **C atas nama pemohon** [Tambahan dari form klien] (usulan, Q-09) |
| Baris item & nota pengajuan [Tambahan dari form klien] | C/U *own* (sebelum diajukan; Reimburse: saat revisi nota) | R *team* | R, **V** *all* | R *all* | C/U untuk pengajuan yang dia buat (sebelum diajukan) |
| Diketahui Oleh [Tambahan dari form klien] [Diubah ADR 0013] | – | – (memantau saja) | – | **K = A** *all* (persetujuan Direktur) | – |
| Persetujuan (Approval) [Diubah ADR 0013] | – | – | **A** *all* | – (sudah memutuskan di "Diketahui") | – |
| Flag validasi nota [Tambahan dari form klien] | R *own* | R *team* | R, tandai "sudah diperiksa" *all* | R *all* | R *all* |
| Transfer | R *own* | R *team* | C/R/U *all* | R *all* | – |
| Nota & LPJ | C/U *own* | R *team* | R, **V** *all* | R *all* | – |
| Cetak PDF Pengajuan Biaya [Tambahan dari form klien] | P *own* (usulan) | P *team* | P *all* | P *all* | P *all* |
| Kas & bank | – | R ringkas *team* | C/R/X *all* | R *all* (+X opsional) | – |
| Project & tahapan | R *assigned* | R/U *team* | R *all* | C/R/U/arsip *all* | R |
| Pusat biaya [Tambahan dari form klien] | R *assigned* | R *team* | R *all* | C/R/U *all* | C/R/U *all* |
| Kendaraan [Tambahan dari form klien] | R | R | R | R/U | C/R/U |
| Addendum RAB | – | C *team* | R | **A** | – |
| Laporan progress | – | C/R *team* | R | C/R *all* | – |
| Tim & penugasan | – | C/R/U *team* | – | R/U *all* | C/R/U |
| Absensi | C/R *own* | C (atas nama tim), U koreksi *team* | R (untuk upah) | R *all* | R/U |
| Laporan & export | – | R *team* | R *all* | R *all* | – |
| Master data | – | – | C/R/U (kategori, akun kas, bank, satuan) | R/U | C/R/U *all* |
| Penomoran dokumen [Tambahan dari form klien] | – | – | R | R | C/R/U (perubahan format tercatat di log) |
| User & role | – | – | – | R | C/R/U (di ProyekKas; identitas di Keycloak realm `drms`) [Keputusan user 2026-09-23] |
| Sinkronisasi Odoo [Keputusan user 2026-09-23] | – | – | R status | R status | R status, retry |
| Audit log | R dokumen *own* | R dokumen *team* | R *all* | R *all* | R *all* |

**Aturan tambahan:**
- Pemohon tidak boleh meng-approve pengajuannya sendiri. [Diubah v1.1] "Pemohon" = **setiap** orang di "Diajukan Oleh" **dan** "Dibuat Oleh". Larangan ini juga berlaku untuk posisi "Diketahui Oleh" (Q-08, diterapkan; server + DB).
- [ADR 0013, keputusan user 2026-09-25] **Alur keputusan:** "Diketahui" = persetujuan **Direktur** (tombol "Setujui"), lalu **Approval Finance** level 1 — untuk semua nominal (ambang Q-31 belum ada; bisa ditambah lewat aturan approval). Hanya Direktur/Finance yang boleh memberi keputusan: aturan approval menolak PM/Staff/Admin sebagai pemutus, pengisi "PM project / penanggung jawab" tidak dipakai lagi, dan persetujuan Direktur tidak boleh opsional. PM/Staff/Admin yang mencoba acknowledge/approve/reject → 403 + audit `access_denied`.
- [ADR 0013, G1-2] Bila **satu-satunya** Direktur (atau Finance) aktif adalah pemohon/pembuat, posisinya **dilewati** (audit `approval_skipped`, PDF "(tidak berlaku — pemohon)"); minimal satu keputusan independen wajib ada, bila tidak → pengajuan tidak dapat diajukan (409). Bila ada Direktur/Finance lain, merekalah yang memutuskan.
- Pengajuan yang sudah diajukan sebelum perubahan alur tetap selesai dengan aturan (snapshot) lama (US-34).
- Finance tidak boleh mengubah nominal atau baris item yang sudah disetujui. Koreksi = kembalikan ke pemohon (revisi) dan, bila grand total berubah, approval diulang [Usulan].
- Satu orang tidak boleh mengisi dua posisi tanda tangan yang berbeda pada pengajuan yang sama, kecuali "Diajukan Oleh" + "Dibuat Oleh" (staff membuat pengajuannya sendiri) [Usulan, Q-08].
- Semua aksi dicatat di audit log.

---

## 5. User story

Kriteria penerimaan ditulis agar bisa diuji (unit/API/e2e/manual). "Server menolak" berarti API mengembalikan error dan tidak ada perubahan data, dibuktikan oleh test API.

### Staff lapangan

| ID | User story | Kriteria penerimaan |
|---|---|---|
| US-01 | Sebagai staff, saya ingin check-in dan check-out dengan lokasi dan selfie, agar kehadiran saya sah. | Tombol aktif hanya dalam radius project. Selfie wajib (kamera depan, tanpa galeri). Waktu dari server. Mock location ditolak. Check-in hanya sekali per hari per project. Selfie tersimpan setelah resize sesuai §9. |
| US-02 | Sebagai staff, saya ingin absen saat sinyal lemah. | Data disimpan offline dengan waktu dan GPS perangkat, lalu disinkron dengan penanda "offline"; waktu server saat sinkron tersimpan terpisah dari waktu perangkat. |
| US-03 | [Diubah v1.1] Sebagai staff, saya ingin membuat pengajuan dana lengkap dengan jenis, project **atau** pusat biaya, judul, baris item, tanggal dibutuhkan, keterangan, rekening, dan lampiran. | Wajib: jenis (US-36), tepat satu dari project/pusat biaya (US-53), judul, minimal 1 baris item dengan total > 0 (US-37), rekening tujuan (US-44). Nominal pengajuan = grand total (dihitung server, tidak bisa diisi manual). Bisa disimpan sebagai draft. Pengajuan dengan project **dan** pusat biaya sekaligus ditolak server. |
| US-04 | [Diubah v1.1] Sebagai staff, saya ingin mengedit atau membatalkan pengajuan selama belum ada keputusan approval. | Edit bebas pada Draft. Pada "Menunggu Diketahui"/"Menunggu Approval" sebelum ada baris T2 berkeputusan: pemohon/pembuat bisa **tarik kembali** ke Draft lalu edit, atau batal dengan alasan. Setelah ada keputusan (diketahui/disetujui), server menolak edit/batal oleh pemohon. Setiap perubahan tercatat di log (nilai lama → baru per field dan per baris). |
| US-05 | [Diubah v1.1] Sebagai staff, saya ingin tahu posisi pengajuan saya. | Timeline status sesuai jenis (Uang Muka/Reimburse, §7 T1) dan posisi tanda tangan yang sudah/belum terisi. Push notification di setiap perpindahan status ke semua pemohon di "Diajukan Oleh" yang punya akun. |
| US-06 | Sebagai staff, saya ingin melihat alasan penolakan dan mengajukan ulang. | Form terisi dari pengajuan lama (termasuk baris item, pemohon, rekening), dengan referensi ke nomor lama; nomor baru diambil dari penomoran saat diajukan. |
| US-07 | [Diubah v1.1] Sebagai staff, saya ingin upload satu atau lebih foto nota. | Uang Muka: setelah dana cair. Reimburse: **saat pengajuan** (US-38). Tiap nota: nomor nota, tanggal, vendor/toko, nominal total, foto wajib; ditautkan ke satu baris item. Foto dikompres di perangkat dan di-resize ulang di server (§9). Total nota per baris, total per pengajuan, dan selisihnya ditampilkan. |
| US-08 | Sebagai staff, saya ingin mengirim LPJ dan memperbaikinya bila diminta revisi. | Hanya untuk Uang Muka. Catatan revisi dari finance terlihat. LPJ bisa dikirim ulang. |
| US-09 | Sebagai staff, saya ingin melihat rekap absensi bulanan saya. | Tampil tanggal, project, jam masuk/pulang, dan durasi. |

### PM

| ID | User story | Kriteria penerimaan |
|---|---|---|
| US-10 | Sebagai PM, saya ingin membuat laporan progress harian dengan foto. | Pilih project dan tahapan, isi %, pekerjaan, kendala, maksimal 5 foto (di-resize, §9). Progress project dihitung ulang (bobot × %). |
| US-11 | Sebagai PM, saya ingin diingatkan bila laporan belum dibuat. | Notifikasi bila tidak ada laporan selama N hari (setting, default 3). |
| US-12 | Sebagai PM, saya ingin membandingkan progress fisik dengan anggaran terpakai. | Warna: hijau ≤ 0, kuning ≤ 8%, merah > 8%. Ambang bisa diatur. |
| US-13 | Sebagai PM, saya ingin memantau kehadiran tim hari ini. | Tampil hadir, belum absen, dan selesai per anggota. |
| US-14 | Sebagai PM, saya ingin mengabsenkan anggota yang tidak punya HP. | Tercatat sebagai "diabsenkan oleh PM" beserta nama PM. (Keberadaan staff tanpa HP: Q-29.) |
| US-15 | Sebagai PM, saya ingin mengoreksi jam absensi. | Alasan wajib. Nilai lama dan baru tersimpan di log. |
| US-16 | Sebagai PM, saya ingin mengelola anggota dan penugasan tim ke project. | Tambah, nonaktifkan, pindah project, dengan periode penugasan. |
| US-17 | [Diubah v1.1] [Diubah ADR 0013] Sebagai PM, saya ingin memantau pengajuan tim tanpa bisa meng-approve. | Hanya lihat, terbatas pada project/pusat biaya yang dipegang (daftar tim, dashboard, laporan). PM **tidak** memberi "Diketahui" maupun Approval: server menolak acknowledge/approve/reject oleh PM (403, tercatat `access_denied`); PM tidak menerima notifikasi persetujuan dan tidak punya kotak masuk Persetujuan. |
| US-18 | Sebagai PM, saya ingin mengajukan addendum RAB. | Nominal tambahan dan alasan wajib, lalu masuk ke approval owner. |

### Finance

| ID | User story | Kriteria penerimaan |
|---|---|---|
| US-19 | [Diubah v1.1] Sebagai finance, saya ingin antrian pengajuan yang siap ditransfer. | Uang Muka: status "Disetujui (Antri Transfer)". Reimburse: status "Nota Terverifikasi (Antri Transfer)". Urut tanggal dibutuhkan. Badge jumlah antrian. Kolom jenis dan jumlah flag terbuka tampil. |
| US-20 | [Diubah v1.1] Sebagai finance, saya ingin mencatat transfer. | Akun kas sumber, nomor referensi, bukti wajib. Rekening tujuan terisi dari pengajuan (read-only). Nominal = nominal disetujui (Reimburse: lihat Q-13 untuk selisih dalam toleransi). Kas keluar ter-posting otomatis. Tidak bisa dihapus manual. |
| US-21 | Sebagai finance, saya ingin memverifikasi LPJ atau meminta revisi. | Uang Muka saja. Catatan wajib saat revisi. Selisih nota vs transfer dan flag validasi ditampilkan. |
| US-22 | Sebagai finance, saya ingin menyelesaikan selisih LPJ. | Sisa lebih → kas masuk "pengembalian". Kekurangan → transfer reimburse. Status akhir **Selesai**. |
| US-23 | Sebagai finance, saya ingin mencatat kas masuk dan kas keluar manual. | Nominal, keterangan, akun kas, kategori/sumber wajib. Bukti opsional. |
| US-24 | Sebagai finance, saya ingin membatalkan transaksi kas yang salah input. | Void/jurnal balik dengan alasan. Transaksi asli tetap terlihat. |
| US-25 | Sebagai finance, saya ingin rekap per kategori, project, pusat biaya, periode, dan export Excel. | Filter tanggal, project/pusat biaya, jenis. Saldo per akun kas. Kategori dihitung dari **baris item** [Tambahan dari form klien]. |

### Direktur (peran `pk-owner`, dulu "Owner")

| ID | User story | Kriteria penerimaan |
|---|---|---|
| US-26 | [Diubah v1.1] [Diubah ADR 0013] Sebagai Direktur (langkah "Diketahui") atau Finance (langkah Approval), saya ingin menyetujui atau menolak pengajuan dari HP. | Tampil jenis, baris item, nota (Reimburse), flag validasi, posisi tanda tangan yang sudah terisi, dan dampak anggaran (% sekarang → % bila disetujui, merah bila > 85%; untuk pusat biaya tanpa anggaran: tampil "tanpa anggaran", Q-24). Alasan wajib saat menolak. Tanda tangan terekam (US-43). |
| US-27 | Sebagai owner, saya ingin melihat saldo kas, anggaran terpakai, kelengkapan nota/LPJ, dan pengajuan yang menunggu. | 4 kartu dashboard dengan data real-time (tata letak: prototipe tidak tersedia). |
| US-28 | Sebagai owner, saya ingin grafik kas masuk vs keluar per bulan. | Periode bisa dipilih. |
| US-29 | Sebagai owner, saya ingin membuat, mengedit, dan mengarsipkan project beserta tahapannya. | Total bobot wajib 100%. Project dengan transaksi tidak bisa dihapus. |
| US-30 | [Diubah ADR 0013] Sebagai Direktur, saya ingin meng-approve addendum RAB. | Anggaran bertambah dan riwayat tersimpan. Memakai mesin approval yang sama (`docType: budget_addendum`); usulan: Direktur menyetujui, Finance diberi tahu (ADR 0013 O-3, diputuskan di Epik E5). |
| US-31 | Sebagai owner, saya ingin membaca semua laporan progress beserta fotonya. | Terbaru di atas. Filter per project. |

### Admin & umum

| ID | User story | Kriteria penerimaan |
|---|---|---|
| US-32 | [Diubah v1.1] Sebagai admin, saya ingin mengelola user, peran, dan status aktif. | Satu user bisa punya lebih dari satu peran. User nonaktif tidak bisa login (akun di Keycloak realm `drms` dinonaktifkan dan sesi dicabut) [Keputusan user 2026-09-23]. |
| US-33 | Sebagai admin, saya ingin mengelola master data (bagian 6). | Data yang sudah dipakai tidak bisa dihapus, hanya dinonaktifkan. |
| US-34 | [Diubah v1.1] Sebagai admin, saya ingin mengatur aturan approval berdasarkan nominal, jenis pengajuan, dan posisi tanda tangan. | Contoh: di atas Rp 10 juta perlu dua approver (nilai ambang: Q-31). Aturan menentukan siapa/peran untuk "Diketahui Oleh" dan "Approval", urutan, dan apakah "Diketahui" wajib. Perubahan aturan tidak mengubah pengajuan yang sudah diajukan (snapshot aturan disimpan di pengajuan) [Usulan]. |
| US-35 | Sebagai semua peran, saya ingin melihat riwayat perubahan sebuah dokumen. | Tab "Riwayat": siapa, kapan, apa yang berubah (lama → baru), dari perangkat apa. |

### Tambahan v1.1 — Pengajuan, tanda tangan, cetak, validasi

| ID | User story | Kriteria penerimaan |
|---|---|---|
| US-36 | [Tambahan dari form klien] Sebagai pemohon, saya ingin memilih jenis pengajuan **Uang Muka** atau **Reimburse**. | Jenis wajib dan tidak bisa diubah setelah diajukan. Server menerapkan alur status sesuai jenis (§7 T1). Reimburse tanpa nota di setiap baris ditolak saat diajukan (US-38). Uang Muka boleh diajukan tanpa nota. |
| US-37 | [Tambahan dari form klien] Sebagai pemohon, saya ingin mengisi banyak baris item. | Tiap baris: No (otomatis), Uraian (wajib), Jumlah, Satuan (dari master `uoms`), Harga Satuan, Total, Keterangan, Kategori (wajib, per baris), Kendaraan (opsional). Grand total = Σ total baris, dihitung server. [Keputusan user 2026-09-23] **Total baris diinput user** (boleh hasil pembulatan dari nota). Harga satuan informatif; bila kosong, sistem menampilkan Total ÷ Jumlah. Sistem **tidak** memaksa Jumlah × Harga Satuan = Total. **Uji seed:** form contoh menghasilkan grand total **Rp 1.447.500** (baris 2 = 677.000). Baris "lump sum" (hanya total, seperti "Makan siang" Rp 170.500) diterima. Minimal 1 baris; total baris > 0. |
| US-38 | [Tambahan dari form klien] Sebagai pemohon reimburse, saya ingin melampirkan nota **saat pengajuan**. | Setiap baris Reimburse wajib punya ≥ 1 nota sebelum status berpindah dari Draft (server menolak bila tidak). Flag validasi (US-47…US-50) dihitung saat diajukan dan tampil ke approver dan Finance. |
| US-39 | [Tambahan dari form klien] Sebagai finance, saya ingin memverifikasi nota reimburse sebelum transfer. | Reimburse "Disetujui" → Finance verifikasi per nota (valid/ditolak dengan alasan). Semua flag terbuka harus ditandai "sudah diperiksa" (dengan catatan opsional) sebelum status "Nota Terverifikasi (Antri Transfer)". Bila ada nota ditolak → status "Revisi Nota", pemohon memperbaiki; bila grand total berubah, pengajuan kembali ke "Menunggu Approval" [Usulan]. Urutan verifikasi vs approval: Q-12. |
| US-40 | [Tambahan dari form klien] Sebagai pembuat pengajuan, saya ingin mencantumkan lebih dari satu pemohon di "Diajukan Oleh". | Minimal 1 pemohon, semuanya karyawan aktif (master `employees`). Urutan nama tersimpan dan tampil di PDF seperti "Budi, Doni". Setiap pemohon mendapat akses R *own* ke pengajuan. Tak satu pun pemohon bisa memberi Approval (server menolak). |
| US-41 | [Tambahan dari form klien] Sebagai admin, saya ingin membuat pengajuan atas nama pemohon ("Dibuat Oleh"). | "Dibuat Oleh" diisi otomatis oleh server dengan user yang login (tidak bisa diisi manual). Bila pembuat ≠ pemohon, pemohon utama dinotifikasi. Peran yang boleh membuat atas nama: Q-09 (usulan default: Admin dan Finance). |
| US-42 | [Tambahan dari form klien] [Diubah ADR 0013] Sebagai Direktur (pihak "Diketahui Oleh"), saya ingin menyetujui pengajuan pada langkah "Diketahui". | "Diketahui" adalah **persetujuan Direktur** (peran `pk-owner`, label "Direktur"; Q-07 dijawab user 2026-09-25): semua Direktur aktif yang bukan pemohon/pembuat menerima notifikasi, salah satu cukup. Aksi merekam nama, waktu server, tanda tangan, dampak anggaran dan flag terbuka. Status tidak bisa ke "Menunggu Approval" (Finance) sebelum disetujui Direktur (server menolak). Menolak wajib alasan. |
| US-43 | [Tambahan dari form klien] Sebagai penanda tangan, saya ingin tanda tangan digital saya terekam di pengajuan. | Dua cara (pilihan klien, Q-15): (a) gambar tanda tangan tersimpan di profil, (b) gambar di layar HP saat aksi. Tersimpan: gambar (PNG, §9), user, posisi, waktu server, perangkat. Gambar tanda tangan pada dokumen yang sudah ditandatangani tidak berubah bila profil diganti kemudian (salinan/snapshot). |
| US-44 | [Tambahan dari form klien] Sebagai pembuat pengajuan, saya ingin memilih rekening tujuan dari rekening milik salah satu pemohon. | Dropdown hanya berisi rekening aktif (master `employee-bank-accounts`) milik karyawan di "Diajukan Oleh"; server menolak rekening milik orang lain (pengecualian: Q-11). Default = rekening default pemohon pertama. Info bank, atas nama, nomor tersimpan sebagai snapshot di pengajuan (uji: Mandiri · Doni Pratama · 1234567890123). |
| US-45 | [Tambahan dari form klien] Sebagai admin, saya ingin mengatur format penomoran per jenis dokumen. | Token minimal: nomor urut, kode dokumen, kode perusahaan, hari, bulan (angka dan romawi), tahun (2 & 4 digit). Default pengajuan: `{seq}/PB-DRMS/{DD}/{MM_ROMAN}/{YYYY}` → uji: seq 228, tanggal 20-09-2026 menghasilkan `228/PB-DRMS/20/IX/2026`. Periode reset counter bisa diatur (tidak/tahunan/bulanan; default: Q-17). Nomor diambil saat pertama kali diajukan (bukan saat draft), unik, tanpa lompat pada transaksi yang gagal [Usulan]; uji konkurensi 50 pengajuan paralel → 50 nomor unik berurutan. Nomor awal bisa diset (untuk melanjutkan nomor manual klien, Q-17). |
| US-46 | [Tambahan dari form klien] Sebagai finance/owner, saya ingin mencetak PDF "Pengajuan Biaya" yang meniru form klien. | PDF berisi: kop + logo perusahaan, "PENGAJUAN BIAYA", nama perusahaan, subjek "`<no urut>`-PB DRMS-`<judul>`", TGL, NO, tabel (No, Uraian, Jumlah, Satuan, Harga Satuan, Total, Keterangan), GRAND TOTAL, kotak 4 tanda tangan dengan nama, kotak info transfer (bank, atas nama, nomor), lalu foto nota di halaman yang sama/berikutnya. Uji dengan data seed: angka dan nama sama dengan form contoh; format Rupiah `Rp 1.447.500`. PDF bisa dibuat pada status apa pun setelah diajukan; posisi yang belum ditandatangani kosong. Pembuatan PDF tercatat di audit log. |
| US-47 | [Tambahan dari form klien] Sebagai finance, saya ingin flag bila total nota berbeda dari total baris. | Flag per baris: selisih = total baris − Σ nota baris. |selisih| ≤ toleransi → flag level "info" (tampil, tidak perlu tindakan); > toleransi → "peringatan". Toleransi di setting (usulan Rp 1.000 per baris, Q-14). **Uji seed:** baris Penginapan 677.000 vs nota 676.876 → selisih Rp 124 → "info" dengan toleransi Rp 1.000, "peringatan" dengan toleransi 0. Baris BBM 600.000 vs 600.000 dan Makan 170.500 vs 170.500 → tanpa flag. Flag tidak memblokir alur. |
| US-48 | [Tambahan dari form klien] Sebagai finance, saya ingin flag bila tanggal nota tidak wajar. | Reimburse: flag bila tanggal nota > tanggal pengajuan, atau lebih tua dari N hari (setting, usulan 30). Uang Muka: flag bila tanggal nota < tanggal transfer − N hari atau di luar periode kegiatan (bila diisi). **Uji seed** (anggap Reimburse, tanggal 20-09-2026): nota Soto 21/09/2026 10:47 dan Pertamina 21/09/2026 11:42 → flag; nota hotel 20 Sep 2026 → tanpa flag. |
| US-49 | [Tambahan dari form klien] Sebagai finance, saya ingin master satuan dan flag satuan tidak wajar. | Satuan dipilih dari master `uoms` (tidak bisa ketik bebas). Tiap kategori bisa punya daftar satuan wajar; satuan di luar daftar → flag "satuan tidak wajar". **Uji seed:** kategori Transport/BBM dengan satuan wajar {liter, kali isi} dan baris BBM satuan "bulan" → flag (daftar final: Q-20). |
| US-50 | [Tambahan dari form klien] Sebagai finance, saya ingin flag nota ganda. | Flag bila kombinasi (nomor nota ternormalisasi + vendor + nominal) sudah dipakai di pengajuan lain yang tidak dibatalkan/ditolak. Uji: mengunggah ulang nota Soto No. TX0101.0001.000123, Rp 170.500 di pengajuan kedua → flag menunjuk nomor pengajuan pertama. Usulan tambahan: hash gambar identik → flag (Q-21). |
| US-59 | [Tambahan dari form klien] Sebagai approver, saya ingin melihat flag validasi sebelum memutuskan. | Layar approval (APK & web) menampilkan jumlah dan daftar flag per baris; approve tetap bisa walau ada flag, dan jumlah flag terbuka saat keputusan tersimpan di T2. |

### Tambahan v1.1 — Master & laporan baru

| ID | User story | Kriteria penerimaan |
|---|---|---|
| US-51 | [Tambahan dari form klien] Sebagai admin, saya ingin mengelola master kendaraan dan menautkan baris item ke kendaraan. | Field: plat (unik, dinormalisasi tanpa spasi: "DA 1234 XY" = "DA1234XY"), jenis (Hilux, Tronton, dll.), status aktif. Baris item bisa memilih kendaraan aktif; kendaraan nonaktif tidak muncul di pilihan tapi tetap tampil di data lama. Uji: seed kendaraan DA1234XY (jenis: Q-22). |
| US-52 | [Tambahan dari form klien] Sebagai owner/finance, saya ingin laporan biaya per kendaraan. | Filter periode, kendaraan, kategori; sumber = baris item pengajuan dengan status minimal "Ditransfer" (usulan) dan kas keluar manual yang ditautkan ke kendaraan. Export Excel. Uji: seed menghasilkan Rp 600.000 untuk DA1234XY bila baris BBM ditautkan. |
| US-53 | [Tambahan dari form klien] Sebagai pemohon, saya ingin menautkan pengajuan ke project **atau** pusat biaya / lokasi operasional. | Tepat satu wajib diisi (server menolak keduanya/kosong). Master `cost-centers`: kode, nama (mis. "Ops Palangka Banjar"), penanggung jawab, status. Akses PM/staff ke pengajuan pusat biaya mengikuti penugasan (Q-23). Laporan kas bisa difilter per pusat biaya. |
| US-54 | [Tambahan dari form klien] *(Nice to have)* Sebagai pemohon, saya ingin tanggal, total, dan nama toko terisi otomatis dari foto nota. | Hasil OCR hanya **usulan** yang harus dikonfirmasi user; nilai yang dikonfirmasi dan nilai OCR asli sama-sama tersimpan. Uji dengan 3 foto nota seed: dilaporkan akurasi per field; tidak ada syarat akurasi minimal untuk rilis. Tidak memblokir fase utama. |

### Tambahan v1.1 — Keputusan user (platform)

| ID | User story | Kriteria penerimaan |
|---|---|---|
| US-55 | [Keputusan user 2026-09-23] Sebagai admin, saya ingin mengelola master data dan user lewat panel admin web (CRUD). | Semua master di §6 punya daftar, cari, tambah, ubah, nonaktifkan di panel admin. Hapus hanya untuk data yang belum dipakai; selain itu server menolak. Peran non-admin tidak bisa membuka koleksi yang bukan haknya (uji negatif per peran). |
| US-56 | [Keputusan user 2026-09-23] Sebagai pengguna, saya ingin login satu kali lewat Keycloak realm `drms` di web dan APK, dan admin bisa logout-kan perangkat yang hilang. | Login web dan APK memakai OIDC Authorization Code + PKCE. Setelah admin mencabut sesi user/perangkat, request API berikutnya dari perangkat itu ditolak (batas waktu penolakan: ditetapkan ADR auth). Login gagal tercatat di audit log. |
| US-57 | [Keputusan user 2026-09-23] Sebagai owner (pembayar server), saya ingin foto disimpan dalam ukuran hemat tanpa kehilangan keterbacaan nota. | APK mengompres sebelum upload; server me-resize ulang semua upload gambar sesuai target §9 (tidak percaya klien). Uji: upload foto 4000×3000 px → file tersimpan ≤ target sisi terpanjang dan ≤ target ukuran; teks nota seed tetap terbaca manusia (uji manual). Metadata lokasi EXIF dihapus dari file tersimpan. |
| US-58 | [Keputusan user 2026-09-23] Sebagai owner, saya ingin data ProyekKas dicerminkan ke Odoo agar transisi ke Odoo mudah. | (Fase transisi.) Setiap perubahan pada entitas yang dipetakan menulis 1 baris outbox dalam transaksi DB yang sama. Worker mengirim ke Odoo secara idempoten (kirim ulang tidak menggandakan data). Kegagalan tercatat dan bisa di-retry dari panel admin. Arah satu arah: perubahan di Odoo tidak ditarik kembali. Pemetaan model: dokumen arsitektur. |

---

## 6. Master data [Diubah v1.1]

Slug koleksi mengikuti `f0-brief.md` §3 (bisa disesuaikan ADR).

| Master | Slug | Field utama | Dipakai di |
|---|---|---|---|
| Setting perusahaan | `company-settings` (global) | Nama, logo, **kop PDF** [Tambahan dari form klien], zona waktu (default `Asia/Makassar`), radius geofence default, batas hari laporan terlambat, ambang warna anggaran (85%/100%), **toleransi pembulatan nota** (usulan Rp 1.000/baris) [Tambahan dari form klien], **batas umur nota N hari** (usulan 30) [Tambahan dari form klien], **target resize foto** (§9) [Keputusan user 2026-09-23] | Semua |
| User | `users` | Username/email, no HP, peran, status aktif, perangkat terdaftar, ID Keycloak (`sub`) [Keputusan user 2026-09-23], **gambar tanda tangan** [Tambahan dari form klien]. Password tidak disimpan di ProyekKas (Keycloak). | M01 |
| Karyawan / Staff | `employees` | Kode, nama, jabatan, no HP, foto wajah referensi, status aktif, user terkait (opsional: karyawan tanpa akun tetap bisa menjadi pemohon) | Absensi, tim, pengajuan |
| Rekening karyawan | `employee-bank-accounts` | Karyawan, bank, no rekening, atas nama, default, status verifikasi | Pengajuan, transfer |
| Bank | `banks` | Kode, nama bank (mis. Mandiri, BCA) | Rekening |
| Klien | `clients` | Nama, kontak, alamat | Project, kas masuk |
| Vendor (opsional) | `vendors` | Nama, kontak, NPWP | Nota (duplikat) |
| Project | `projects` | Kode, nama, klien, alamat, lat/long + radius, PM, RAB, tanggal mulai, target selesai, status | Hampir semua |
| Template tahapan | `stage-templates` | Nama template, tahapan + bobot + urutan | Project baru |
| Tahapan project | `project-stages` | Project, nama, bobot %, urutan, % progress (hanya dari laporan) | Progress |
| RAB per kategori (opsional) | `budget-lines` | Project, kategori, nominal | Kontrol anggaran |
| Kategori pengeluaran | `expense-categories` | Material, Upah, Alat, Transport, Operasional (+ usulan: BBM, Penginapan, Konsumsi, Service Kendaraan; Q-19), mapping akun (COA), **daftar satuan wajar** [Tambahan dari form klien], **perlu kendaraan?** [Tambahan dari form klien] | Baris item, kas keluar |
| Sumber kas masuk | `cash-in-sources` | Termin, DP klien, Modal owner, Pengembalian LPJ, Lainnya | Kas masuk |
| Akun kas/bank perusahaan | `cash-accounts` | Nama, nomor rekening, saldo awal | Transfer, kas |
| Penugasan tim | `team-assignments` | Karyawan, project **atau pusat biaya** [Tambahan dari form klien], tanggal mulai/selesai, peran | Absensi, akses |
| Jadwal kerja | `work-schedules` | Jam masuk/pulang standar, toleransi terlambat (Q-30) | Rekap absensi |
| Hari libur | `holidays` | Tanggal, nama | Rekap absensi |
| Aturan approval | `approval-rules` | Rentang nominal, **jenis pengajuan**, urutan approver, **posisi tanda tangan** (Diketahui Oleh wajib/opsional, siapa/peran; Approval level 1..n) [Tambahan dari form klien], kategori/project/pusat biaya (opsional) | Persetujuan |
| Template notifikasi | `notification-templates` | Event, judul, isi, channel | Notifikasi |
| **Satuan (UoM)** [Tambahan dari form klien] | `uoms` | Kode, nama (liter, kamar, malam, porsi, kali isi, unit, paket, bulan, LS/lumpsum, dll.; daftar final Q-20), status. Ramah-Odoo: bisa dipetakan ke `uom` Odoo [Keputusan user 2026-09-23] | Baris item |
| **Kendaraan / Unit** [Tambahan dari form klien] | `vehicles` | Plat (unik, dinormalisasi), jenis (Hilux, Tronton, …), merek/model (opsional), status aktif, pusat biaya/project default (opsional). Ramah-Odoo: modul `fleet` ada di image Odoo | Baris item, laporan per kendaraan |
| **Pusat biaya / lokasi operasional** [Tambahan dari form klien] | `cost-centers` | Kode, nama (mis. "Ops Palangka Banjar"), penanggung jawab, status. Ramah-Odoo: kandidat akun analitik (`analytic`) | Pengajuan, kas, laporan |
| **Penomoran dokumen** [Tambahan dari form klien] | `document-sequences` | Jenis dokumen (PB, TRF, LPJ, KM, KK, LP, ADD), pola format dengan token, counter berikut, periode reset, nomor awal | Semua dokumen bernomor |

Default penomoran (usulan; PB dari form klien, lainnya dari v1.0):

| Dokumen | Default |
|---|---|
| Pengajuan (Uang Muka & Reimburse) | `{seq}/PB-DRMS/{DD}/{MM_ROMAN}/{YYYY}` → `228/PB-DRMS/20/IX/2026` [Tambahan dari form klien]. Arti token `{DD}` (= tanggal dokumen) disimpulkan dari contoh (tanggal 20, nomor memuat "20"); konfirmasi Q-17. Apakah Uang Muka dan Reimburse berbagi counter: Q-18. |
| Transfer | `TRF/YYMM/####` |
| LPJ | `LPJ/YYMM/####` |
| Kas masuk / keluar | `KM/YYMM/####` / `KK/YYMM/####` |
| Laporan progress | `LP/YYMM/####` |
| Addendum | `ADD/YYMM/####` |

---

## 7. Transaksi [Diubah v1.1]

### T1. Pengajuan biaya · slug `expense-requests` · nomor `document-sequences` PB

**Header:**
- **Jenis:** Uang Muka / Reimburse [Tambahan dari form klien]
- **Project ATAU pusat biaya** (tepat satu) [Tambahan dari form klien]
- Judul/subjek (mis. "Pengajuan Reimburse Ops Palangka Banjar keperluan Service Tronton")
- Tanggal pengajuan (server), tanggal dibutuhkan, periode kegiatan dari–sampai (opsional, usulan untuk validasi tanggal; Q-04)
- Keterangan
- **Diajukan Oleh:** daftar karyawan (≥ 1, berurutan) [Tambahan dari form klien]
- **Dibuat Oleh:** user login, diisi server [Tambahan dari form klien]
- **Rekening tujuan:** dari `employee-bank-accounts` milik salah satu pemohon, disimpan juga sebagai snapshot (bank, atas nama, nomor) [Tambahan dari form klien]
- Grand total (dihitung server), referensi pengajuan lama, lampiran umum
- Snapshot aturan approval yang berlaku [Usulan]

**Baris item (`lines`)** [Tambahan dari form klien]:

| Field | Aturan |
|---|---|
| No | Otomatis berurutan |
| Uraian | Wajib |
| Jumlah | Opsional (baris lump sum), > 0 bila diisi |
| Satuan | Dari `uoms`; wajib bila Jumlah diisi |
| Harga Satuan | Opsional |
| Total | Wajib > 0; **nilai utama, diinput user** (boleh pembulatan nota). Harga Satuan informatif, tidak mengubah Total [Keputusan user 2026-09-23] |
| Keterangan | Opsional |
| Kategori | Wajib, dari `expense-categories` |
| Kendaraan | Opsional; wajib bila kategori ditandai "perlu kendaraan" [Usulan] |
| Nota | 0..n nota (T4); Reimburse: ≥ 1 saat diajukan |

**Status — Uang Muka** (dari v1.0, nama langkah persetujuan disesuaikan):
`Draft → [Menunggu Diketahui]* → Menunggu Approval → Disetujui (Antri Transfer) → Ditransfer → Nota Lengkap → LPJ Diajukan ⇄ LPJ Revisi → LPJ Terverifikasi → Selesai`

**Status — Reimburse** [Tambahan dari form klien]:
`Draft → [Menunggu Diketahui]* → Menunggu Approval → Disetujui → Nota Terverifikasi (Antri Transfer) → Ditransfer → Selesai`, dengan cabang `Disetujui → Revisi Nota → (Menunggu Approval bila grand total berubah, atau Disetujui bila tidak)` [Usulan].
Prompt Lead menyebut alur `Draft → Menunggu Approval → Disetujui → Ditransfer → Selesai` dengan catatan "Finance tetap memverifikasi nota sebelum transfer"; v1.1 menjadikan verifikasi itu status tersendiri agar bisa diantrikan dan diaudit. Apakah verifikasi Finance sebaiknya **sebelum** approval Owner: Q-12.

**Status cabang (kedua jenis):** `Ditolak` (dari langkah Diketahui atau Approval, alasan wajib), `Dibatalkan` (alasan wajib).

\* `Menunggu Diketahui` hanya ada bila aturan approval mewajibkan posisi "Diketahui Oleh".

**Rekonsiliasi dengan v1.0:** status v1.0 "Menunggu Owner" diganti "Menunggu Approval" karena approver ditentukan aturan approval (default Owner, sesuai v1.0 §1.2 #4). Posisi "Diketahui Oleh" di form tidak ada padanannya di v1.0; v1.1 **mengusulkan** langkah opsional sebelum Approval. Siapa pengisinya, apakah wajib, dan urutannya belum dikonfirmasi (Q-06, Q-07, Q-08). Tidak ada keputusan final di dokumen ini.

### T2. Approval & tanda tangan · slug `approvals` [Diubah v1.1]
- Baris per pengajuan dan per addendum, **satu baris per posisi tanda tangan** [Tambahan dari form klien]:

| Posisi | Diisi oleh | Kapan | Keputusan |
|---|---|---|---|
| Diajukan Oleh (1..n) | Setiap pemohon | Saat diajukan (cara tanda tangan pemohon yang tidak membuat sendiri: Q-10) | – (konfirmasi) |
| Dibuat Oleh | User pembuat | Saat diajukan | – |
| Diketahui Oleh | Direktur (`pk-owner`, ADR 0013; dulu usulan PM — tidak berlaku lagi) | Setelah diajukan | Disetujui (Diketahui) / Ditolak |
| Approval (level 1..n) | Sesuai aturan (default Finance, ADR 0013) | Setelah Diketahui | Disetujui / Ditolak |

- **Field:** posisi, level, user, nama tampil, keputusan, alasan, waktu server, gambar tanda tangan (snapshot) + sumber (profil/layar), perangkat, % anggaran sebelum dan sesudah, jumlah flag terbuka saat keputusan.

### T3. Transfer / pencairan · slug `transfers` · `TRF/YYMM/####`
- **Field:** pengajuan, akun kas sumber, nominal, rekening tujuan (snapshot dari pengajuan), nomor referensi bank, file bukti (di-resize bila gambar), tanggal, finance.
- Otomatis membuat **kas keluar** (T7) dengan link ke pengajuan; kategori kas keluar diturunkan dari **baris item** (satu entri per kategori atau per baris: diputuskan ADR/arsitektur, TBD).
- Reimburse: hanya bila status "Nota Terverifikasi (Antri Transfer)". Nominal bila ada selisih dalam toleransi: Q-13.

### T4. Nota · slug `receipts` [Diubah v1.1]
- Banyak nota per pengajuan, **ditautkan ke satu baris item** [Tambahan dari form klien].
- **Field:** nomor nota, vendor/toko, tanggal & jam nota, nominal total (sesuai total tercetak), foto, status (valid/ditolak + alasan), sumber isian (manual/OCR), flag.
- **Flag validasi otomatis** (tidak memblokir; tersimpan per nota/baris; Finance menandai "sudah diperiksa" + catatan) [Tambahan dari form klien]:

| Flag | Aturan | Contoh dari form (data seed) |
|---|---|---|
| Selisih nominal | |total baris − Σ nota baris| dibandingkan toleransi (setting) | Penginapan: 677.000 − 676.876 = **Rp 124** (harga satuan 339.000 vs 338.438 = selisih Rp 562/kamar). Dengan toleransi usulan Rp 1.000 → info. Selisih ini adalah pembulatan wajar oleh user (K1 terjawab). |
| Tanggal nota | Reimburse: nota setelah tanggal pengajuan atau lebih tua dari N hari. Uang Muka: di luar periode kegiatan/terlalu jauh sebelum transfer | Tanggal pengajuan 20/09/2026; nota Soto 21/09/2026 10:47 dan Pertamina 21/09/2026 11:42:59 → flag (bila Reimburse). Hotel 20/09/2026 → tidak. |
| Satuan tidak wajar | Satuan baris tidak termasuk daftar satuan wajar kategori | BBM satuan "bulan", struk 24,80 L → flag. |
| Nota ganda | (nomor nota ternormalisasi + vendor + nominal) sudah ada di pengajuan aktif lain | Kunci seed: Soto `TX0101.0001.000123`/170.500; Pertamina `7654321`/600.000; Traveloka `9876543210`/676.876. |

- Nilai yang dibandingkan adalah **total tercetak** di nota. Contoh: struk Pertamina 24,80 L × Rp 24.200 = Rp 600.160, tetapi total tercetak Rp 600.000 → yang dipakai Rp 600.000 (K10).
- Pajak di nota (mis. pajak restoran Rp 15.500 dari subtotal Rp 155.000) tidak dipecah di v1.1; nota dicatat dengan totalnya (perlu tidaknya pencatatan pajak: Q-26).

### T5. LPJ & Settlement · slug `settlements` · `LPJ/YYMM/####`
- **Hanya untuk Uang Muka** [Diubah v1.1]. Field dan settlement sama dengan v1.0: sisa lebih → T6 (pengembalian), kekurangan → T3 reimburse.

### T6. Kas masuk · slug `cash-entries` (arah masuk) · `KM/YYMM/####`
- Tanggal, akun kas, sumber, project/klien **atau pusat biaya**, nominal, keterangan, bukti.

### T7. Kas keluar · slug `cash-entries` (arah keluar) · `KK/YYMM/####`
- Tanggal, akun kas, kategori, project **atau pusat biaya** (atau kas umum), **kendaraan (opsional)** [Tambahan dari form klien], nominal, keterangan, bukti, link pengajuan.

### T8. Void / reversal kas · slug `cash-reversals`
- Transaksi asli, alasan, user. Membuat jurnal balik; asli berstatus `Void`.
- Tutup buku bulanan · slug `period-closings` (dari v1.0 §9; cakupan Q-01).

### T9. Absensi · slug `attendances`
- Karyawan, project, tanggal, jam masuk/pulang, GPS masuk/pulang, jarak, selfie (di-resize), sumber (APK/offline/oleh PM), status.

### T10. Koreksi absensi · slug `attendance-corrections`
- Absensi, nilai lama, nilai baru, alasan, oleh PM.

### T11. Laporan progress · slug `progress-reports` · `LP/YYMM/####`
- Project, tahapan, % sebelum → sesudah, tanggal, pekerjaan, kendala, foto (maks. 5, di-resize), pelapor.

### T12. Addendum RAB · slug `budget-addenda` · `ADD/YYMM/####`
- Project, RAB lama, tambahan, RAB baru, alasan, status approval (baris T2).

---

## 8. Log changes per transaksi

### Struktur audit log (append-only) · slug `audit-logs`

Sama dengan v1.0: `id`, `waktu_server`, `doc_type`/`doc_id`/`doc_no`, `action`, `field`/`nilai_lama`/`nilai_baru`, `status_dari`/`status_ke`, `alasan`, `user_id`/`peran`, `sumber` (web/apk + versi), `ip`/`device_id`, `lat`/`long`.
[Diubah v1.1] Tambahan nilai `action`: `sign`, `acknowledge`, `print`, `flag_raised`, `flag_reviewed`, `sync_odoo`, `login`/`logout`/`session_revoked`. Tambahan kolom: `line_no` (untuk perubahan baris item) [Tambahan dari form klien].

### Event per transaksi

| Transaksi | Event yang dicatat | Field yang di-track | Wajib alasan |
|---|---|---|---|
| T1 Pengajuan | Dibuat, diedit, dikirim, ditarik kembali ke draft, dibatalkan, diajukan ulang, setiap perubahan status; **baris item ditambah/diubah/dihapus** (sebelum diajukan) [Tambahan dari form klien]; **pemohon (Diajukan Oleh) diubah** [Tambahan dari form klien]; **rekening tujuan diubah** [Tambahan dari form klien]; **nomor dokumen diterbitkan** [Tambahan dari form klien] | Jenis, judul, project/pusat biaya, pemohon, pembuat, rekening (snapshot), tanggal butuh, lampiran, status; per baris: uraian, jumlah, satuan, harga satuan, total, kategori, kendaraan | Batal, tarik kembali |
| T2 Approval & tanda tangan | Ditandatangani per posisi, diketahui, disetujui, ditolak, (didelegasikan) [Tambahan dari form klien] | Posisi, keputusan, level, sumber tanda tangan, % anggaran sebelum/sesudah, jumlah flag terbuka | Tolak |
| T3 Transfer | Dicatat, bukti diganti, dibatalkan | Akun sumber, nominal, rekening tujuan, nomor referensi, file bukti | Batal / ganti bukti |
| T4 Nota | Upload, edit, hapus sebelum LPJ/diajukan, ditolak finance, **flag muncul, flag ditandai sudah diperiksa**, **hasil OCR diterima/diubah** [Tambahan dari form klien] | Nomor, tanggal, nominal, vendor, file, baris tertaut, jenis flag, catatan finance, nilai OCR vs nilai final | Ditolak |
| T5 LPJ | Dikirim, revisi diminta, dikirim ulang, diverifikasi, settlement | Keterangan, total nota, selisih, status, catatan | Revisi |
| T6/T7 Kas | Dibuat, diedit (sebelum tutup buku), di-void | Tanggal, akun, kategori/sumber, project/pusat biaya, kendaraan, nominal, keterangan, bukti | Edit & void |
| T8 Void | Void dibuat | Transaksi asli, nominal balik | Ya |
| Tutup buku | Periode ditutup / dibuka kembali | Periode, user | Buka kembali |
| T9 Absensi | Check-in, check-out, sinkron offline, diabsenkan PM, percobaan di luar radius/mock location | Jam, GPS, jarak, selfie, sumber | – |
| T10 Koreksi | Dikoreksi | Jam lama → baru, project | Ya |
| T11 Laporan progress | Dibuat, diedit (≤ 24 jam), foto ditambah | Tahapan, % sebelum → sesudah, pekerjaan, kendala | Edit |
| T12 Addendum | Diajukan, disetujui, ditolak | RAB lama/baru, tambahan | Ya |
| Cetak PDF [Tambahan dari form klien] | PDF Pengajuan Biaya dibuat/diunduh | Nomor pengajuan, user, status saat dicetak | – |
| Project & tahapan | Dibuat, diedit, status berubah, diarsipkan, bobot diubah | Nama, PM, RAB, tanggal, status, bobot | Ubah bobot / arsip |
| Master baru: satuan, kendaraan, pusat biaya [Tambahan dari form klien] | Dibuat, diedit, dinonaktifkan | Semua field | Nonaktif |
| Penomoran dokumen [Tambahan dari form klien] | Format/counter/periode reset diubah | Pola lama → baru, counter lama → baru | Ya |
| Aturan approval | Dibuat, diedit, dinonaktifkan | Rentang, jenis, posisi, approver | Ya |
| Tanda tangan profil [Tambahan dari form klien] | Diunggah, diganti | File (hash) lama → baru | – |
| User & role | Dibuat, peran berubah, dinonaktifkan, login/login gagal, **sesi/perangkat dicabut** [Keputusan user 2026-09-23] | Peran, status, perangkat | Nonaktif, cabut sesi |
| Sinkronisasi Odoo [Keputusan user 2026-09-23] | Terkirim, gagal, di-retry manual | Entitas, ID, ID Odoo, pesan error | Retry manual |

### Tampilan log
- Tab "Riwayat" di setiap dokumen dengan detail nilai lama → baru, termasuk per baris item.
- Halaman Audit Log global dengan filter (tanggal, user, jenis dokumen, aksi) untuk Owner dan Admin.

---

## 9. Kebutuhan non-fungsional [Diubah v1.1]

| Area | Kebutuhan |
|---|---|
| Offline | Absensi dan draft pengajuan (termasuk baris item dan foto nota) tetap bisa dibuat tanpa sinyal, lalu disinkron |
| Waktu | Semua cap waktu dari server. Waktu perangkat hanya data pembanding offline. Zona waktu default `Asia/Makassar`, bisa diubah |
| Keamanan lokasi | Deteksi mock location dan perangkat root |
| Penyimpanan file [Keputusan user 2026-09-23] | Volume lokal di server, di luar webroot, diakses lewat URL bertanda tangan & berbatas waktu atau endpoint terotorisasi. Abstraksi S3-compatible agar pindah ke object storage cukup lewat konfigurasi. Masuk backup harian (restic). |
| Resize foto [Keputusan user 2026-09-23] | Resize/kompres **di perangkat dan di server** (server tidak percaya hasil perangkat). Target di bawah; semuanya **[Usulan]**, bisa diubah di setting. Metadata EXIF lokasi dihapus dari file (lokasi yang dibutuhkan disimpan sebagai field DB). |
| Format angka | Rupiah `Rp 1.447.500`; UI Bahasa Indonesia |
| Notifikasi | Push (FCM, perlu ADR) dan in-app |
| Keuangan | Tutup buku bulanan: setelah ditutup, transaksi kas terkunci (cakupan Q-01) |
| Laporan | Export Excel/PDF; PDF Pengajuan Biaya gaya klien [Tambahan dari form klien] |
| Keandalan | Backup harian DB dan file |
| Keamanan akses | Identitas di Keycloak realm `drms` (password tidak disimpan di ProyekKas), sesi per perangkat, logout jarak jauh [Keputusan user 2026-09-23] |
| Transisi Odoo [Keputusan user 2026-09-23] | Skema ramah-Odoo; outbox ditulis dalam transaksi yang sama dengan perubahan data; mirror tidak boleh memperlambat atau menggagalkan aksi user (asinkron) |
| Kapasitas | Menurut brief F0, sisa RAM untuk semua beban klien di VPS ≈ 2,5 GiB; target RAM ProyekKas ditetapkan di dokumen arsitektur |

### Target resize foto [Usulan] [Keputusan user 2026-09-23]

| Jenis file | Slug media | Sisi terpanjang maks. | Format & kualitas | Target ukuran | Catatan |
|---|---|---|---|---|---|
| Foto nota | `media-receipts` | 1600 px | JPEG/WebP q≈80 | ≤ 400 KB | Harus tetap terbaca untuk verifikasi & OCR (uji manual dengan 3 nota seed) |
| Selfie absensi | `media-selfies` | 720 px | JPEG/WebP q≈75 | ≤ 150 KB | Retensi: Q-33 |
| Bukti transfer | `media-transfer-proofs` | 1600 px (gambar); PDF diterima apa adanya ≤ 2 MB | JPEG/WebP q≈80 | ≤ 400 KB | |
| Foto progress | `media-progress-photos` | 1600 px | JPEG/WebP q≈80 | ≤ 400 KB | Maks. 5 per laporan |
| Tanda tangan | `media-signatures` | 800 × 300 px maks. | PNG transparan | ≤ 50 KB | [Tambahan dari form klien] |
| Logo/kop | `media-company` (slug final, ADR 0004 §2) | 1024 px | PNG | ≤ 300 KB | Untuk PDF (Q-32) |
| Semua | – | Upload mentah ditolak bila > 15 MB | – | – | Validasi MIME di server |

Perkiraan kasar (estimasi, bukan pengukuran): 100 nota/bulan × 400 KB ≈ 40 MB/bulan; 30 karyawan × 2 selfie × 25 hari × 150 KB ≈ 225 MB/bulan. Angka volume transaksi belum dikonfirmasi klien (Q-34).
