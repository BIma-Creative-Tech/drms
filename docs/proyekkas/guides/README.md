# Panduan Pengguna ProyekKas

Panduan singkat per peran untuk karyawan PT DRMS. Pilih sesuai peran Anda:

| Peran | Panduan | Dipakai terutama di |
|---|---|---|
| Staff lapangan | [staff.md](staff.md) | Aplikasi Android (APK) |
| Project Manager (PM) | [pm.md](pm.md) | APK + web |
| Finance | [finance.md](finance.md) | Web (+ APK untuk persetujuan cepat) |
| Direktur | [direktur.md](direktur.md) | APK + web |
| Admin | [admin.md](admin.md) | Web |

Satu orang bisa punya lebih dari satu peran; baca semua panduan yang sesuai.

## Hal umum untuk semua peran

**Alamat web:** `https://drms-kas.bimacreative.tech/admin` (produksi, menyusul) — selama uji coba:
`https://drms-kas.staging.bimacreative.tech/admin`. Klik **Masuk dengan akun DRMS (SSO)**.

**Aplikasi Android:** pasang APK yang dibagikan Admin. Buka → **Masuk ke ProyekKas** → isi **Email atau username** dan
**Kata sandi** → **Masuk**. Login pertama butuh internet. Lupa kata sandi: hubungi Admin.

![TODO screenshot: layar Masuk APK dan tombol SSO web](img/umum-login.png)

**Tanda tangan:** sebelum mengajukan atau menyetujui apa pun, unggah gambar tanda tangan Anda **sekali** di web:
menu **Profil & tanda tangan** → unggah gambar PNG (tanda tangan di kertas putih, difoto/dipindai). Tanpa tanda
tangan, aplikasi menolak dengan pesan "Tanda tangan wajib…". Tanda tangan tidak bisa diunggah dari APK.

**Notifikasi:** di APK, lihat **ikon lonceng** di kanan atas Beranda (diperbarui tiap ± 2 menit saat aplikasi
terbuka). Notifikasi *push* ke HP yang terkunci **belum aktif** — buka aplikasi secara rutin. Di web, **lonceng
Notifikasi** ada di atas menu kiri (angka = belum dibaca; diperbarui saat pindah halaman) → halaman Notifikasi:
**Buka** menandai dibaca dan membuka dokumennya, **Tandai semua dibaca**. Direktur/Finance dapat juga menerima email
saat pengajuan menunggu keputusannya (bila dinyalakan Admin).

**Bekerja tanpa sinyal (APK):** draft pengajuan, absen, dan laporan progress bisa disimpan tanpa internet; banner
"Offline — data disimpan di HP dan dikirim otomatis saat online." akan tampil. Cek pengiriman di tab **Antrean**
(**Antrean kirim**): *Menunggu* → *Terkirim*. Bila *Ditolak*, buka datanya, baca alasan, perbaiki, simpan lagi.
**Jangan keluar (logout) atau hapus aplikasi** selama masih ada data *Menunggu*.

**Riwayat:** setiap pengajuan punya tab **Riwayat** (web) / ikon jam (APK): siapa mengubah apa, kapan, dari
perangkat apa.

**HP hilang atau ganti HP:** segera lapor Admin agar perangkat dicabut.

**Waktu & uang:** semua jam memakai waktu server (WITA). Format uang `Rp 1.447.500`.

## Status pengajuan

| Status | Artinya | Menunggu siapa |
|---|---|---|
| Draft | Belum dikirim | Pemohon |
| Menunggu Diketahui (Direktur) | Menunggu persetujuan Direktur | Direktur |
| Menunggu Approval | Direktur sudah setuju | Finance |
| Disetujui (Antri Transfer) | Uang Muka siap ditransfer | Finance |
| Disetujui → Nota Terverifikasi (Antri Transfer) | Reimburse: nota diperiksa, lalu siap transfer | Finance |
| Revisi Nota | Nota Reimburse ditolak Finance | Pemohon |
| Ditransfer | Uang sudah dikirim | Uang Muka: pemohon unggah nota/LPJ · Reimburse: selesai |
| Nota Lengkap → LPJ Diajukan | Pemohon mengirim laporan penggunaan dana | Finance |
| LPJ Revisi | Finance minta perbaikan LPJ | Pemohon |
| LPJ Terverifikasi | Menunggu penyelesaian selisih | Finance |
| Selesai | Tuntas | – |
| Ditolak / Dibatalkan | Berhenti (alasan tercatat) | – |

## Catatan untuk penyusun

- Gambar: taruh di `guides/img/` dengan nama sesuai penanda `![TODO screenshot: …](img/…)`; ambil dari staging
  dengan akun uji fiktif (jangan data asli).
- Panduan mengikuti perilaku aplikasi pada `develop` @ `c468bbe` (2026-09-26). Perbarui bila UAT mengubah perilaku.
