# Panduan Pengguna ProyekKas

Panduan singkat per peran untuk karyawan PT DRMS (dan PT lain dalam grup yang memakai ProyekKas). Pilih sesuai peran Anda:

| Peran | Panduan | Dipakai terutama di |
|---|---|---|
| Staff lapangan | [staff.md](staff.md) | Aplikasi Android (APK) |
| Project Manager (PM) | [pm.md](pm.md) | APK + web |
| Finance | [finance.md](finance.md) | Web (+ APK untuk persetujuan cepat) |
| Direktur | [direktur.md](direktur.md) | APK + web |
| Owner (di atas Direktur, ADR 0026) | [owner.md](owner.md) | APK + web |
| Admin | [admin.md](admin.md) | Web |

Satu orang bisa punya lebih dari satu peran; baca semua panduan yang sesuai.

## Hal umum untuk semua peran

**Alamat web:** `https://drms-kas.bimacreative.tech/admin` (produksi, menyusul) — selama uji coba:
`https://drms-kas.staging.bimacreative.tech/admin`. Klik **Masuk dengan akun DRMS (SSO)**.

**Panel web = layar modul:** setelah masuk, `/admin` menampilkan kotak modul (Dashboard, Persetujuan, Proyek,
Keuangan, Absensi, Laporan, …) — hanya modul yang bisa Anda pakai. Klik modul → menunya ada di **bar atas**; tombol
**⊞** kembali ke layar modul; di HP menu dibuka dengan **☰**. Ringkasan per peran ada di modul **Dashboard**.
Profil & tanda tangan ada di menu akun (inisial nama), notifikasi di **lonceng** — keduanya selalu di bar atas.
Membuka halaman yang bukan untuk peran Anda menampilkan **"Anda tidak memiliki akses ke halaman ini."** dengan
tautan **← Kembali ke beranda**. Ringkasan hak akses per peran: [admin.md](admin.md#hak-akses-per-peran--perubahan-2026-10-08-laporan-qa-keputusan-pemilik).

**Dialog konfirmasi:** tombol seperti **Tolak**, **Tarik kembali**, **Batalkan**, **Minta revisi** membuka kotak
dialog aplikasi. Alasan wajib minimal 3 karakter; bila kurang, pesan tampil di kotak itu dan kotak tetap terbuka.

**Aplikasi Android:** unduh dari halaman **`/unduh`** di alamat web (mis. `https://drms-kas.bimacreative.tech/unduh`;
uji coba: `https://drms-kas.staging.bimacreative.tech/unduh`) → **Unduh APK** → buka file → bila diminta, ketuk
**Setelan** → aktifkan **Izinkan dari sumber ini** → **Instal** → **Buka**. Bila muncul peringatan Play Protect:
**Detail lainnya → Tetap instal**. Buka aplikasi → **Masuk ke ProyekKas** → isi **Email atau username** dan
**Kata sandi** → **Masuk**. Login pertama butuh internet. Lupa kata sandi: hubungi Admin.

**Pemberitahuan privasi:** menjelaskan data apa yang dicatat (termasuk **selfie** dan **lokasi** saat absen), untuk apa,
siapa yang bisa melihat, berapa lama disimpan (selfie **6 bulan**) dan hak Anda. Bisa dibaca tanpa login di halaman
**`/privasi`** (tautan **Pemberitahuan privasi** di bawah tombol masuk web dan di halaman `/unduh`). Saat pertama
masuk (dan setiap kali isinya berubah versi) Anda diminta membacanya dan menekan **Saya mengerti**:
- **Web:** pemberitahuan tampil di atas semua halaman admin dan tidak bisa ditutup sebelum **Saya mengerti**.
- **APK (0.3.3+):** tampil layar penuh setelah masuk. **Nanti** menunda sampai aplikasi dibuka lagi, tetapi
  **Absensi** (absen masuk/pulang, selfie, absen oleh PM) terkunci sampai Anda menekan **Saya mengerti**. Tanpa
  sinyal, konfirmasi dikirim otomatis saat online kembali — absensi tetap terkunci sampai terkirim. Baca ulang di
  **Profil → Pemberitahuan privasi**.

**Versi baru:** bila ada versi baru, Beranda APK menampilkan **"Versi baru tersedia (…)"**. Ketuk untuk melihat
**"Yang baru di versi …"** dan cara memperbarui: pasang APK versi baru **di atas** aplikasi lama, **tanpa menghapusnya**
— data dan login tetap tersimpan. Bila versi di HP sudah terlalu lama, aplikasi menampilkan layar **Perbarui
aplikasi** dan tidak bisa dipakai sampai diperbarui.

![TODO screenshot: layar Masuk APK dan tombol SSO web](img/umum-login.png)

**Pilih PT (bila Anda bekerja di lebih dari satu PT):** satu akun bisa punya peran di beberapa PT grup.
- **Web:** tombol PT di bar atas, kiri lonceng: **Semua PT**, **PT: DRMS**, atau **PT: DRMS +1**. Klik → kotak
  **Tampilkan data PT** → centang **Semua PT saya** atau PT tertentu → **Terapkan** (minimal satu PT). Daftar,
  antrian, dasbor dan laporan mengikuti PT yang dicentang. Membuat dan menyetujui dokumen selalu mengikuti **PT
  dokumen itu**. Bila Anda hanya di satu PT, yang tampil hanya kode PT (tidak ada pilihan).
- **APK:** tombol PT di kanan atas **Beranda** (mis. **Semua PT** atau **DRMS**) → lembar **Pilih PT** → centang →
  **Terapkan**. Daftar PT dan peran Anda di tiap PT ada di **Profil → PT aktif**.
- **Membuat pengajuan di APK** saat beberapa PT mungkin: aplikasi bertanya **"Untuk PT mana?"** lebih dulu. Project,
  pusat biaya, kategori dan rekening yang muncul diambil dari PT itu. (Absen dan laporan progress otomatis memakai PT
  lokasi/project yang dipilih.)
- **Data offline lama:** bila muncul **"… data offline belum punya PT — pilih PT agar bisa dikirim"** (di Beranda
  atau Antrean), ketuk → layar **Pilih PT untuk data offline** → **Pilih PT** untuk setiap data. Data tidak dikirim
  sebelum PT dipilih.
- Bila lebih dari satu PT tampil, daftar dan antrian memberi **tanda kode PT** (mis. `DRMS`, `CS1`) pada setiap baris.

**Daftar dan tabel (web):** semua daftar data (Pengajuan, Project, Pengguna, Karyawan, Vendor, master lain) dan
halaman kerja (Persetujuan, Antrian Transfer, Verifikasi LPJ, Kas, Pinjaman) memakai bar filter yang sama:
- **Cari** (ketik, daftar menyaring sendiri), lalu filter **dropdown berceklis** per kriteria — mis. **Status ▾** →
  centang **Diajukan** dan **Disetujui** → **Terapkan**. Tombol menampilkan pilihan Anda (**Semua**, satu nama, atau
  **2 dipilih**); **Semua** di dalam dropdown menghapus centang kriteria itu, **Reset** menghapus semua filter.
  Rentang tanggal (**… dari / sampai**) ada pada daftar yang punya tanggal utama (mis. tanggal pengajuan).
- **PT ▾** muncul bila lebih dari satu PT dicentang di tombol PT; filter ini hanya bisa mempersempit, tidak menambah
  PT di luar pilihan tombol PT.
- **Kolom ▾** (daftar data): centang kolom yang ingin ditampilkan → **Terapkan**; pilihan disimpan per pengguna
  dan per daftar (ikut ke perangkat lain). **Default** mengembalikan kolom bawaan. Klik judul kolom untuk mengurutkan
  (▲/▼).
- **Klik baris** (atau Enter) membuka detail; tombol di kolom **Aksi** (**Ubah**, **Buka**, **Lihat**) tetap bekerja.
  Data diubah lewat formulir dokumen (tombol **Ubah**), tidak ada lagi centang baris / ubah massal.
- Di bawah tabel: **1–20 dari 57 data · Halaman 1 dari 3** dengan **‹ Sebelumnya / Berikutnya ›**; jumlah baris per
  halaman 20/50/100 lewat **Per halaman**. Tabel ringkasan di dashboard/laporan yang panjang juga dibagi per 20 baris.

**Keamanan akun — 2FA (pilihan):** Anda boleh menambah kode 6 digit dari aplikasi autentikator di HP (mis. Google
Authenticator, Microsoft Authenticator, FreeOTP) supaya kata sandi yang bocor saja tidak cukup untuk masuk.
- **Menyalakan (web):** menu akun (lingkaran inisial) → **Keamanan akun** → **Aktifkan 2FA** → login ulang → pindai
  kode QR di halaman login → masukkan kode 6 digit dan beri nama perangkat (mis. "HP pribadi").
- **Mematikan (web):** **Keamanan akun** → **Nonaktifkan 2FA** → **Ya, nonaktifkan** → login ulang.
- **Di APK:** bila 2FA aktif, login pertama dengan kata sandi saja akan ditolak; setelah itu muncul kolom
  **Kode autentikator (bila 2FA aktif)** — isi 6 digit dari aplikasi autentikator, lalu **Masuk** lagi.
- HP atau aplikasi autentikator hilang: hubungi Admin untuk mereset 2FA. Setiap perubahan 2FA tercatat di audit log.

**Tanda tangan:** sebelum mengajukan atau menyetujui apa pun, unggah gambar tanda tangan Anda **sekali** di web:
menu akun (lingkaran inisial di kanan atas) → **Profil & tanda tangan** → unggah gambar PNG (tanda tangan di kertas putih, difoto/dipindai). Tanpa tanda
tangan, aplikasi menolak dengan pesan "Tanda tangan wajib…". Tanda tangan tidak bisa diunggah dari APK.

**Notifikasi:** di APK, lihat **ikon lonceng** di kanan atas Beranda (diperbarui tiap ± 2 menit saat aplikasi
terbuka). Notifikasi *push* ke HP yang terkunci **belum aktif** — buka aplikasi secara rutin. Di web, **lonceng
Notifikasi** ada di bar atas, kanan (angka = belum dibaca; diperbarui saat pindah halaman) → halaman Notifikasi:
**Buka** menandai dibaca dan membuka dokumennya, **Tandai semua dibaca**. Direktur/Finance dapat juga menerima email
saat pengajuan menunggu keputusannya (bila dinyalakan Admin).

**Bekerja tanpa sinyal (APK):** draft pengajuan, absen, dan laporan progress bisa disimpan tanpa internet; banner
"Offline — data disimpan di HP dan dikirim otomatis saat online." akan tampil. Cek pengiriman di tab **Antrean**
(**Antrean kirim**): *Menunggu* → *Terkirim*. Bila *Ditolak*, buka datanya, baca alasan, perbaiki, simpan lagi.
**Jangan keluar (logout) atau hapus aplikasi** selama masih ada data *Menunggu*.

**Riwayat:** setiap pengajuan punya tab **Riwayat** (web) / ikon jam (APK): siapa mengubah apa, kapan, dari
perangkat apa. Di web, bagian **Log perubahan** di bawah halaman pengajuan (klik untuk membuka) memuat ringkasan yang
sama beserta waktu dibuat dan terakhir diubah.

**Halaman pengajuan (web):** kiri — nomor, badge PT, status, **Rincian pengajuan**, **Rincian item** (baris, nota,
flag) dan **Log perubahan**; kanan — **Alur pengajuan** (Diajukan → PM → Direktur → Transfer → LPJ → Selesai; yang
sedang berjalan bertanda **Tahapan saat ini**). Di HP alurnya tampil setelah ringkasan. Tombol ada di bar aksi atas:
**Setujui** / **Tolak** (bila giliran Anda), **Cetak**, **Duplikat**, **Edit** → **Simpan** / **Batal** (hanya Draft
atau Revisi Nota milik Anda).

**HP hilang atau ganti HP:** segera lapor Admin agar perangkat dicabut.

**Waktu & uang:** semua jam memakai waktu server (WITA). Format uang `Rp 1.447.500`.

## Status pengajuan

**Alur persetujuan (sejak 10 Okt 2026, ADR 0021):** Staff mengajukan → **PM project** menyetujui → **Direktur**
menyetujui → **Finance** mentransfer (Reimburse: Finance memverifikasi nota dulu). Setiap langkah bisa **Tolak** dengan
alasan; pemohon diberi tahu. Pengajuan yang sudah diajukan sebelum Admin mengubah aturan approval tetap memakai alur
lama (Direktur lalu Finance). Addendum RAB tetap Direktur lalu Finance.

| Status | Artinya | Menunggu siapa |
|---|---|---|
| Draft | Belum dikirim | Pemohon |
| Menunggu persetujuan PM | Alur baru (sejak 10 Okt 2026): menunggu PM project | PM project |
| Menunggu persetujuan Direktur | Alur baru: PM sudah setuju | Direktur |
| Menunggu Diketahui (Direktur) | Alur lama: menunggu persetujuan Direktur | Direktur |
| Menunggu Approval | Alur lama: Direktur sudah setuju | Finance |
| Disetujui (Antri Transfer) | Pengajuan Baru siap ditransfer | Finance |
| Disetujui → Nota Terverifikasi (Antri Transfer) | Reimburse: nota diperiksa, lalu siap transfer | Finance |
| Revisi Nota | Nota Reimburse ditolak Finance | Pemohon |
| Ditransfer | Uang sudah dikirim | Pengajuan Baru: pemohon unggah nota/LPJ · Reimburse: selesai |
| Nota Lengkap → LPJ Diajukan | Pemohon mengirim laporan penggunaan dana | Finance |
| LPJ Revisi | Finance minta perbaikan LPJ | Pemohon |
| LPJ Terverifikasi | Menunggu penyelesaian selisih | Finance |
| Selesai | Tuntas | – |
| Ditolak / Dibatalkan | Berhenti (alasan tercatat) | – |

## Catatan untuk penyusun

- Gambar: taruh di `guides/img/` dengan nama sesuai penanda `![TODO screenshot: …](img/…)`; ambil dari staging
  dengan akun uji fiktif (jangan data asli).
- Panduan mengikuti perilaku aplikasi pada `develop` @ `5415f45` (2026-09-30): web **0.5.0** (multi-PT, 2FA pilihan)
  dan APK **0.3.0** (versi pubspec; tag `mobile-v0.3.0` belum dibuat pada tanggal ini). Label diperiksa terhadap
  `apps/web/src/admin/**` dan `apps/mobile/lib/l10n/app_id.arb`. Perbarui bila UAT mengubah perilaku.
- Alur persetujuan PM project → Direktur (ADR 0021, 2026-10-10) diperbarui di panduan PM, Direktur, Finance, Admin dan
  Staff; label APK sesuai sejak APK **0.4.1** (APK lebih lama sudah menampilkan tombol Setujui/Tolak ke PM, dengan
  tulisan Direktur).
- APK 0.3.0 butuh web ≥ 0.5.0 (`CHANGELOG.md`, bagian APK mobile-v0.3.0). Pemilih PT, kolom kode autentikator dan
  catatan rilis di banner APK hanya ada setelah APK 0.3.0 terpasang.
