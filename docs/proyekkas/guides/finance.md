# Panduan Finance

Tugas Anda di ProyekKas: **Approval** pengajuan (setelah Direktur), **verifikasi nota Reimburse**, **mencatat
transfer**, **verifikasi LPJ** dan penyelesaian selisih, **kas masuk/keluar manual**, **void**, **tutup buku**, dan
**laporan**. Sebagian besar di **web**; APK untuk persetujuan cepat. Baca juga [Hal umum](README.md#hal-umum-untuk-semua-peran).

Menu web **Alur kerja**: Persetujuan · Antrian Transfer · Verifikasi LPJ · Kas · Tutup buku · Laporan · Audit Log · …
Badge merah di menu = jumlah pekerjaan menunggu.

![TODO screenshot: Beranda web Finance](img/finance-beranda.png)

## 1. Approval pengajuan

Urutan: **Direktur** menyetujui dulu ("Diketahui"), baru pengajuan masuk ke Anda.

- **Web:** **Persetujuan** → periksa Jenis, Grand total, **Dampak anggaran** (merah = anggaran project sesudah
  disetujui > 85%), **Flag** → buka **Rincian baris, nota & flag** di bawah baris pengajuan (tiap baris item dengan
  foto nota — klik untuk ukuran penuh —, total nota & selisih per baris, flag per baris) → **Setujui** atau
  **Tolak** (alasan wajib, minimal 3 huruf; alasan yang terlalu pendek langsung ditolak dengan pesan "Alasan wajib
  diisi, minimal 3 karakter."). Rincian yang sama ada di halaman detail pengajuan.
- Angka **Flag** = flag **terbuka** (peringatan + info). Angka inilah yang tersimpan bersama keputusan Anda; flag
  yang sudah "diperiksa" tidak dihitung.
- **APK:** **Menunggu Persetujuan** → buka → **Setujui** → pilih **Pakai tanda tangan profil** atau **Tanda tangan
  di layar** → Konfirmasi.
- Anda tidak bisa memutuskan pengajuan yang Anda buat/ajukan sendiri; bila Anda satu-satunya Finance, posisi
  Approval otomatis dilewati dan tercatat "(tidak berlaku — pemohon)".

## 2. Reimburse: verifikasi nota

**Antrian Transfer** → **Verifikasi nota Reimburse**:
1. Tiap nota: **Valid**, atau **Tolak** + alasan (pengajuan kembali ke pemohon sebagai **Revisi Nota**).
2. Tiap flag **peringatan**: **Tandai flag diperiksa** (catatan opsional). Flag **info** tidak perlu tindakan.
3. **Verifikasi semua nota** → status **Nota Terverifikasi (Antri Transfer)**.

Arti flag: *Selisih nominal nota vs baris* (info bila ≤ toleransi Rp 1.000) · *Nota terlalu lama* (> 30 hari) ·
*Satuan tidak wajar* · *Nota ganda* (nota sama sudah dipakai di pengajuan lain) · *Tanggal nota di luar periode
kegiatan*. Flag tidak menghalangi, tetapi wajib diperiksa.

![TODO screenshot: Verifikasi nota Reimburse dengan tombol Valid/Tolak dan flag](img/finance-verifikasi-nota.png)

## 3. Mencatat transfer

Angka di menu **Antrian Transfer** = jumlah **Siap ditransfer** (sama dengan judul halaman); Reimburse yang notanya
belum diverifikasi ada di bagian atas halaman tetapi tidak dihitung di angka menu.

**Antrian Transfer** → **Siap ditransfer** (urut tanggal dibutuhkan) → **Catat transfer**:
Akun kas, Tanggal (kosong = hari ini), **No. referensi bank**, **Bukti** (foto/PDF) → simpan.
- Nominal otomatis = nominal disetujui; rekening tujuan dari pengajuan.
- Kotak **"Anda juga yang menyetujui"**: Anda sendiri yang memberi Approval pada pengajuan ini. Boleh tetap
  dicatat (tercatat di audit), tetapi bila ada Finance lain sebaiknya transfer dicatat orang lain.
- Kas keluar (KK) tercatat otomatis; status **Ditransfer**.
- Salah catat? **Void transfer** (di bagian "Transfer tercatat — dapat dibatalkan" atau di detail pengajuan) + alasan:
  KK dibalik, pengajuan kembali ke antrian.

## 4. LPJ Uang Muka

**Verifikasi LPJ** → **LPJ diajukan**:
1. Periksa Ditransfer / Nota / Selisih. Tiap nota **Valid**/**Tolak**. Tiap flag terbuka (mis. *Nota terlalu
   lama*): **Tandai flag diperiksa** (catatan opsional, tercatat di Riwayat/Audit).
2. **Verifikasi LPJ**, atau **Minta revisi** dengan catatan untuk pemohon.
3. Bagian **Menunggu penyelesaian selisih**:
   - Sisa dana → **Catat pengembalian & selesaikan** (kas masuk "Pengembalian LPJ").
   - Kekurangan → **Transfer kekurangan & selesaikan** (ref bank + bukti wajib).
   - Selisih 0 → langsung **Selesai**.

Catatan: kas masuk pengembalian LPJ tidak bisa di-void; bila salah, laporkan ke tim.

## 5. Kas masuk / keluar manual

**Kas** → **↓ Kas masuk** atau **↑ Kas keluar** → isi Tanggal, Akun kas, Nominal, Sumber (masuk) / Kategori biaya
(keluar), Project atau Pusat biaya (opsional), Kendaraan (opsional), **Keterangan**, Bukti (opsional) → Simpan.
Nomor `KM/…` atau `KK/…` terbit dan saldo langsung berubah.

- **Ubah:** hanya kas manual di periode terbuka; alasan wajib; nominal/tanggal/akun tidak bisa diubah → pakai void.
- **Void:** tombol **Void** + alasan → baris asli bertanda *Void* dan muncul *Jurnal balik*. Kas dari transfer
  dibatalkan lewat **Void transfer**.

![TODO screenshot: halaman Kas dengan saldo per akun dan Buku kas](img/finance-kas.png)

## 6. Tutup buku bulanan

**Tutup buku** → bulan lalu → **Tutup buku**. Setelah ditutup, transaksi di bulan itu terkunci. Membuka kembali
hanya **Direktur**. Langkah lengkap: [runbook tutup buku](../runbooks/tutup-buku.md).

## 7. Laporan

**Laporan**: Rekap Kas · Buku Kas · Pengeluaran per Kategori · Anggaran Project · Rekap Pengajuan · Kelengkapan
Nota/LPJ · Biaya per Kendaraan · Laporan Absensi. Atur filter → unduh **CSV**, **Excel (.xlsx)** atau **PDF**
(Excel maks. 10.000 baris, PDF maks. 500 baris). **Audit Log** untuk menelusuri siapa melakukan apa.

## 8. Lain-lain

- **Pengajuan atas nama karyawan:** **+ Buat pengajuan** → Diajukan Oleh = karyawan tersebut (Anda tercatat
  sebagai "Dibuat Oleh"). Beri tahu karyawan secara langsung (tidak ada notifikasi otomatis).
- **Addendum RAB:** setelah Direktur setuju, addendum masuk **Persetujuan** Anda → **Setujui (Finance)** / Tolak.
- **Master keuangan:** Akun kas/bank, Sumber kas masuk, Kategori, Satuan, Bank, Rekening karyawan.
