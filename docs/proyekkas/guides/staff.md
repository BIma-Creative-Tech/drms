# Panduan Staff Lapangan

Anda memakai ProyekKas untuk: **absen** (masuk/pulang dengan lokasi dan selfie), **mengajukan dana** (Uang Muka atau
Reimburse), **mengunggah nota**, dan **mengirim LPJ**. Semua bisa dari HP. Baca juga [Hal umum](README.md#hal-umum-untuk-semua-peran).

Sebelum mulai: unggah **tanda tangan** sekali di web (**Profil & tanda tangan**).

![TODO screenshot: Beranda APK Staff (Ajukan Uang Muka, Ajukan Reimburse, Pengajuan Saya, Absensi)](img/staff-beranda.png)

## 1. Absen masuk dan pulang (APK)

0. Pertama kali (APK 0.3.3+): baca **Pemberitahuan privasi** lalu tekan **Saya mengerti**. Sebelum itu tab **Absen**
   menampilkan *"Absensi (selfie dan lokasi) belum bisa dipakai…"* dan tombol absen mati — ketuk **Baca pemberitahuan
   privasi**. Tanpa sinyal: konfirmasi dikirim otomatis saat online; tunggu sampai terkirim.
1. Datang ke lokasi project atau kantor/pusat biaya. Nyalakan **GPS**.
2. Beranda → **Absensi** → tab **Absen** → pilih lokasi (ikon gedung = pusat biaya).
3. Tekan **Cek jarak ke lokasi**. Harus tertulis **"Di dalam area absen"**.
4. Tekan **Absen masuk** → ambil **selfie** dengan kamera depan (galeri tidak bisa dipakai).
5. Pulang: ulangi dan tekan **Absen pulang**.

![TODO screenshot: kartu jarak "Di dalam area absen" dan tombol Absen masuk](img/staff-absen.png)

- **Tidak ada sinyal?** Tetap absen. Tertulis "Absen tersimpan di HP (offline)…" dan otomatis terkirim saat ada
  sinyal. Jam yang dicatat = jam saat Anda absen, bukan jam kirim.
- **"Di luar area absen"**: dekati titik lokasi. Bila Anda yakin sudah di lokasi, lapor PM/Admin (titik mungkin salah).
- **"Lokasi palsu (mock location) terdeteksi"**: matikan aplikasi pengubah lokasi. Absen ditolak.
- **"Sudah absen masuk di … hari ini"**: absen masuk hanya sekali per hari per lokasi.
- **"Titik lokasi … belum diisi Admin"**: lapor Admin. (Bila titik sudah ada tetapi radius kosong, dipakai radius
  default perusahaan.) Radius ditambah toleransi akurasi GPS HP, paling banyak 50 m.
- Tombol absen mati dengan tulisan belum diaktifkan: fitur dimatikan Admin, hubungi Admin.
- **Cap waktu di foto:** server membubuhkan tanggal, jam (waktu absen yang diterima server, zona PT), koordinat GPS,
  lokasi, nama Anda dan "RR Teams" di bagian bawah selfie (beberapa detik setelah absen terkirim).
- **Absen dari web** (Absensi → Absen saya): selfie hanya dari **kamera langsung** (tombol **Buka kamera** → **Ambil
  foto**), bukan dari galeri/file. Bila muncul *"Kamera tidak tersedia — gunakan aplikasi Android"*, absen lewat APK.
- Lupa absen/jam salah: minta **PM** mengoreksi (Anda tidak bisa mengoreksi sendiri).

**Rekap bulanan:** Absensi → tab **Rekap** → geser bulan → ketuk tanggal untuk rincian (jam masuk/pulang, terlambat).
Bila Anda karyawan di lebih dari satu PT, pilih kode PT (mis. **DRMS** / **CS1**) di atas rekap. Di web: **Rekap
absensi saya**.

Absen memakai PT dari lokasi yang Anda pilih — tidak perlu memilih PT sendiri.

## 2. Mengajukan dana (APK)

Pilih jenisnya dulu:

| Jenis | Kapan | Nota |
|---|---|---|
| **Uang Muka** | Butuh uang **sebelum** belanja | Diunggah **setelah** uang ditransfer, lalu kirim LPJ |
| **Reimburse** | Sudah bayar **dengan uang sendiri** | **Wajib** dilampirkan saat mengajukan (tiap baris minimal 1 nota) |

1. Beranda → **Ajukan Uang Muka** atau **Ajukan Reimburse**. Bila Anda bekerja di lebih dari satu PT, muncul
   **Untuk PT mana?** → ketuk PT tempat biaya ini dibebankan. Di editor tertulis **PT: …**. (Pesan "Anda tidak bisa
   membuat pengajuan di PT yang dipilih. Ganti PT di beranda." = ubah pilihan PT di Beranda dulu.)
2. Isi **Judul**, pilih **Project** *atau* **Pusat biaya** (salah satu saja), **Tanggal dibutuhkan**.
3. **Diajukan oleh**: nama Anda sudah terisi. Staff hanya bisa mengajukan **untuk dirinya sendiri** (keputusan
   pemilik 8 Okt 2026): daftar pilihan hanya berisi nama Anda. Pengajuan untuk orang lain dibuat oleh PM, Admin atau
   Finance. Draft lama yang mencantumkan orang lain ditolak saat diajukan dengan pesan "Staff hanya dapat mengajukan
   untuk dirinya sendiri…" — hapus nama lain lalu ajukan lagi.
4. **Rekening tujuan**: pilih rekening salah satu pemohon (di web daftar juga hanya berisi rekening pemohon; bila
   dikosongkan di web, dipakai rekening default pemohon pertama).
5. **Tambah baris** untuk tiap barang/biaya: Uraian, Kategori, (Jumlah, Satuan), **Total**, Kendaraan (bila BBM/servis).
   *Total* adalah angka yang Anda isi (boleh dibulatkan dari nota); harga satuan hanya informasi.
6. Reimburse: di tiap baris tekan **Foto nota (kamera)** atau **Dari galeri**, isi nomor nota, toko, tanggal, nominal.
   Tanggal nota tidak boleh setelah hari ini (pesan "Tanggal nota tidak boleh di masa depan").
7. **Simpan draft** (bisa tanpa sinyal) → saat online tekan **Ajukan** → konfirmasi.

![TODO screenshot: editor pengajuan dengan baris item dan Total (pratinjau)](img/staff-editor.png)

Setelah diajukan, nomor dokumen terbit (mis. `PB/DRMS/2610/0229`; `DRMS` = kode PT, `2610` = tahun-bulan, tiap PT
punya nomor urut sendiri; semua nomor dokumen lain juga memuat kode PT, mis. `TRF/DRMS/2610/0001`) dan status **Menunggu persetujuan PM**. Yang memutuskan adalah **PM project** (PM di data project;
untuk pusat biaya: manajernya) lalu **Direktur** **di PT pengajuan itu**; setelah itu Finance mentransfer (sejak 10 Okt
2026). Pengajuan yang diajukan sebelumnya tetap diputuskan Direktur lalu Finance. Bila muncul "Project ini belum punya
PM. Hubungi Admin untuk mengisi PM project.", minta Admin mengisi PM project itu.
Pantau di **Pengajuan Saya** atau lonceng. Pemohon lain yang Anda cantumkan diberi tahu saat pengajuan dibuat atas
namanya, diajukan, dan ditarik kembali; di web lonceng **Notifikasi** ada di bar atas, kanan.

**Pesan yang sering muncul:** "Reimburse wajib melampirkan minimal 1 nota." · "Pilih salah satu: project atau pusat
biaya." · "Rekening tujuan wajib dipilih." · "Data master belum tersedia…" (buka aplikasi saat online sekali) ·
"Tanggal nota tidak boleh di masa depan" · "Staff hanya dapat mengajukan untuk dirinya sendiri…".

## 3. Mengubah, membatalkan, mengajukan ulang

- **Belum ada keputusan (PM/Direktur)?** Buka pengajuan → **Tarik kembali ke Draft** (isi alasan) → **Ubah & ajukan di HP**
  → Ajukan lagi. Nomor tetap sama.
- **Tidak jadi?** **Batalkan pengajuan** (isi alasan). Setelah ada keputusan, pembatalan hanya oleh Finance/Direktur.
- **Ditolak?** Baca alasannya → **Ajukan ulang (buat draft baru)** → perbaiki → Ajukan. Baris, pemohon, rekening,
  lampiran **dan nota** (yang tidak ditolak/dihapus) ikut disalin; nota berstatus "belum diverifikasi" lagi. Hapus
  atau ganti nota yang menjadi alasan penolakan.
- **Revisi Nota** (Reimburse): Finance menolak salah satu nota. Buka pengajuan (APK atau web) → hapus nota yang
  ditolak → unggah pengganti → **Kirim ulang nota**. Bila total berubah, pengajuan disetujui ulang.

## 4. Nota dan LPJ Uang Muka

1. Setelah status **Ditransfer**, belanjakan dana dan simpan notanya.
2. Buka pengajuan → **Nota & LPJ** → **Tambah nota (kamera)** per baris. Salah foto? Ikon hapus → isi alasan.
   Nota yang sudah **Valid** (divalidasi Finance) terkunci: tidak ada ikon hapus, dan server menolak dengan pesan
   "Nota sudah divalidasi Finance". Hanya nota yang menunggu verifikasi atau ditolak yang bisa dihapus/diganti.
3. Semua nota sudah masuk → **Nota sudah lengkap**.
4. **Kirim LPJ**: tulis uraian penggunaan dana → Konfirmasi.
5. Bila Finance meminta revisi, baca **Catatan Finance**, perbaiki nota, **Kirim ulang LPJ**.
6. Sisa dana dikembalikan ke kas / kekurangan ditransfer oleh Finance → status **Selesai**.

Nota & LPJ hanya bisa dikirim saat online.

![TODO screenshot: bagian Nota & LPJ di detail pengajuan APK](img/staff-lpj.png)

## 5. Di web (opsional)

Menu Anda: **Daftar pengajuan**, **Rekap absensi saya**, **+ Buat pengajuan**, **Profil & tanda tangan**.
Di web Anda juga bisa **Cetak PDF Pengajuan Biaya** (tombol di samping kanan pengajuan yang sudah bernomor) —
PDF tidak tersedia di APK. Kop dan logo PDF mengikuti PT pengajuan. Di web, form **+ Buat pengajuan** punya kolom
**PT** di atas — wajib dipilih bila pemilih PT Anda berisi lebih dari satu PT, dan tidak bisa diubah setelah dibuat.
Di form web, isian baris item dimuat dari server: setelah mengisi kolom, **tunggu sebentar (±1–3 detik) sebelum
menekan Tambah Baris**, dan tunggu sampai kolom baris baru tampil. Menekan terlalu cepat dapat menghasilkan baris
tanpa kolom (keterbatasan Payload CMS, QA-10/QA-26) — bila itu terjadi, muat ulang halaman (isian yang belum disimpan perlu diisi ulang). Di
APK hal ini tidak terjadi.

## Pertanyaan umum

- *Kenapa belum disetujui?* Lihat **Giliran** di detail pengajuan (PM project atau Direktur). Notifikasi ke HP belum
  aktif (PM/Direktur melihatnya di aplikasi/web, dan lewat email bila diaktifkan Admin); ingatkan langsung bila
  mendesak.
- *Nota berbeda sedikit dengan total baris?* Tidak apa-apa; sistem memberi tanda (flag) untuk diperiksa Finance.
- *Muncul flag "Nota ganda dalam pengajuan ini"?* Foto yang sama, atau nomor nota + toko yang sama, diunggah dua kali
  di pengajuan yang sama. Hapus salah satunya bila memang dobel; bila memang satu nota untuk dua baris, biarkan —
  Finance yang memeriksa.
- *HP hilang?* Lapor Admin segera. Data yang belum terkirim di HP itu harus diinput ulang.
