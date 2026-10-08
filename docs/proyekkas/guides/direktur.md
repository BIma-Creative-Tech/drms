# Panduan Direktur

Sebagai Direktur Anda: **menyetujui pengajuan pada langkah "Diketahui"** (langkah pertama, sebelum Finance),
menyetujui **addendum RAB**, mengelola **project dan tahapan**, **membuka kembali tutup buku**, dan memantau
**dashboard** serta **laporan progress**. Direktur tidak membuat pengajuan dan tidak mencatat kas. Baca juga
[Hal umum](README.md#hal-umum-untuk-semua-peran).

## 1. Menyetujui pengajuan ("Diketahui")

Setiap pengajuan baru menunggu Anda dulu (**Menunggu Diketahui (Direktur)**), lalu diteruskan ke Finance.

**Di HP (paling cepat):**
1. Beranda → **Menunggu Persetujuan** (angka = jumlah menunggu, termasuk addendum).
2. Kartu bertanda **"Persetujuan Direktur (Diketahui)"**: lihat total, **Dampak anggaran** (sekarang → bila
   disetujui; merah + ikon peringatan bila melewati batas), jumlah flag.
3. Buka → periksa baris, nota, flag → **Setujui** → pilih **Pakai tanda tangan profil** atau **Tanda tangan di
   layar** → **Konfirmasi**. Atau **Tolak** dengan alasan.

**Di web:** **Persetujuan** → buka **Rincian baris, nota & flag** di bawah pengajuan (baris item, foto nota, flag per
baris) → **Setujui** / **Tolak** (tanda tangan profil dipakai otomatis; alasan tolak minimal 3 karakter). Pengajuan
baru juga muncul di lonceng **Notifikasi** (bar atas, kanan) dan — bila Admin menyalakan **Email ke Direktur/Finance**
— lewat email berisi nomor pengajuan dan tautan ke Persetujuan.

![TODO screenshot: kartu Menunggu Persetujuan APK dengan Dampak anggaran](img/direktur-inbox.png)

- **Direktur di lebih dari satu PT:** yang masuk ke Anda hanya pengajuan dari PT tempat Anda Direktur. Bila lebih dari
  satu PT tampil (tombol PT di bar atas web / di Beranda APK), setiap baris diberi kode PT (web: kolom **PT** +
  tulisan **Menampilkan PT: …**). Keputusan selalu memakai peran Anda **di PT pengajuan**, dan warna merah Dampak
  anggaran memakai ambang PT itu.
- Anda tidak bisa menyetujui pengajuan di mana Anda tercantum sebagai pemohon. Bila Anda satu-satunya Direktur,
  langkah "Diketahui" dilewati otomatis dan tercatat "(tidak berlaku — pemohon)".
- Bila Anda berhalangan, semua pengajuan tertahan. Sepakati pengganti dengan Admin (aturan approval) sebelum cuti.
- Notifikasi ke HP terkunci belum aktif — buka aplikasi beberapa kali sehari (atau minta Admin menyalakan email
  persetujuan).

## 2. Addendum RAB

HP/Web **Persetujuan** → bagian **Addendum RAB** → buka → **Setujui (Direktur)** atau **Tolak** (alasan wajib).
Setelah Anda, Finance juga menyetujui; RAB project bertambah otomatis dan tercatat.

## 2a. Kekurangan LPJ di atas nominal disetujui (web)

Bila nota LPJ Uang Muka membuat total transfer melebihi nominal yang Anda setujui **+ toleransi** (Pengaturan PT →
*Toleransi kekurangan LPJ*, default 10%), Finance tidak bisa langsung mentransfer kekurangannya. Finance mengajukan
**persetujuan kekurangan** dengan alasan; Anda mendapat notifikasi dan keputusan ada di **web → Persetujuan →
Kekurangan LPJ di atas nominal disetujui** (nominal disetujui, kekurangan, total transfer baru, batas tanpa
persetujuan, alasan Finance) → **Setujui** atau **Tolak** (alasan wajib). Setelah Anda, Finance juga menyetujui
(sama seperti pengajuan). Belum tersedia di APK — notifikasi di HP membuka detail pengajuan, keputusannya di web.
Toleransi diubah oleh Admin/Direktur di data PT (Pengaturan operasional).

## 3. Dashboard

- **Web Beranda:** Saldo kas total, Pengajuan menunggu, Pencairan bulan ini, Realisasi vs anggaran; grafik **Arus
  kas bulanan** (pilih 12 atau 6 bulan), status pengajuan, realisasi vs RAB per project, kelengkapan nota/LPJ,
  saldo per akun. Klik kartu untuk rinciannya. Rentang tanggal bebas: **Laporan → Rekap Kas**.
- **Beberapa PT:** angka besar = gabungan PT tempat Anda Direktur; di bawahnya rincian per PT (saldo kas, pengajuan
  menunggu, project berjalan · merah · kuning, kelengkapan LPJ, antrian transfer). Warna anggaran dihitung dengan
  ambang **masing-masing PT** (tidak ada persentase gabungan). Nama akun kas diberi awalan `[KODE PT]`. Ingin melihat
  satu PT saja: ubah pilihan di tombol PT.
- **HP Beranda "Ringkasan":** angka yang sama; ketuk bulan di grafik untuk melihat kas masuk/keluar.
- **Progress fisik vs anggaran:** web **Progress project** / HP Beranda. Merah = anggaran terpakai jauh mendahului
  progress fisik.

![TODO screenshot: Beranda web Direktur](img/direktur-beranda.png)

## 4. Project dan tahapan (web)

1. **Proyek → Project** → tombol buat baru: **PT** (paling atas; wajib bila pemilih PT berisi lebih dari satu PT,
   tidak bisa diubah setelah dibuat; PM harus punya akses di PT itu), kode, nama, klien, **Project Manager**, **RAB**, status, titik lokasi
   (Latitude/Longitude dari Google Maps) dan **Radius geofence** untuk absensi.
2. **Progress project** → project → **Editor tahapan** → **+ Tambah tahapan** atau **Mulai dari template tahapan** →
   atur bobot hingga **✓ sudah 100%** → **Simpan tahapan**.
3. Mengubah RAB, bobot, atau mengarsipkan project wajib alasan. Project tidak bisa dihapus — pakai status **Arsip**.
4. Progress fisik hanya berubah lewat laporan progress PM (tidak bisa diketik langsung).

## 5. Laporan progress

Web **Laporan progress** atau HP **Laporan progress**: semua project, terbaru di atas, filter project/tahapan/tanggal,
klik foto untuk ukuran penuh. Anda juga boleh membuat laporan dari HP (sama seperti PM).

## 6. Keuangan

- **Kas** (baca saja; transaksi kas yang dikonfirmasi meski saldo menjadi minus dan transfer ke rekening belum
  terverifikasi tercatat di **Audit Log** — aksi `overdraft_confirmed` / `bank_unverified_confirmed`) dan **Laporan** (Rekap Kas, Pengeluaran per Kategori, Anggaran Project, Biaya per Kendaraan,
  dll.) dengan unduh Excel/PDF.
- **Laporan beberapa PT:** filter **PT** mempersempit laporan; bila lebih dari satu PT masuk: kolom **PT** per baris
  dan tabel **Subtotal per PT** + TOTAL. Kop: satu PT = kop PT itu; beberapa PT = kop grup + daftar PT.
- **Tutup buku → Buka kembali**: hanya Anda, hanya periode tertutup terakhir, alasan wajib. Tutup buku berlaku
  **per PT**: bila Anda Direktur di beberapa PT, pilih PT dulu di kartu **Pilih PT**. Lihat
  [runbook tutup buku](../runbooks/tutup-buku.md) §B.
- **Audit Log**: siapa melakukan apa, kapan, dari perangkat apa.

## 7. Absensi & data pribadi

**Absensi → Tim hari ini / Rekap bulanan**. Membuka **selfie** karyawan lain tercatat di audit log (UU PDP) —
buka hanya bila perlu.
