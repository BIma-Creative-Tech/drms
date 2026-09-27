# Panduan Admin

Admin mengelola **pengguna, master data, penomoran, aturan approval, setting perusahaan, perangkat, jadwal
absensi**, dan boleh **membuat pengajuan atas nama karyawan**. Admin tidak menyetujui pengajuan dan tidak mengelola
kas. Semua di **web**. Baca juga [Hal umum](README.md#hal-umum-untuk-semua-peran).

Aturan umum panel: data **tidak pernah dihapus** — gunakan centang **Aktif** (nonaktifkan) dengan alasan. Setiap
perubahan tercatat di **Audit Log**.

![TODO screenshot: menu panel admin (Pengguna & Akses, Master Data, Proyek, Keuangan, Sistem)](img/admin-menu.png)

## 1. Pengguna dan peran

**Pengguna & Akses → Pengguna**:
- **Tambah:** Email, Nama, **Peran** (Staff lapangan / Project Manager / Finance / Direktur / Admin — boleh lebih
  dari satu), **Karyawan** terkait, No. HP, Aktif. Akun login dibuat otomatis di sistem login DRMS.
- **Karyawan dulu:** buat di **Pengguna & Akses → Karyawan** dan **Rekening karyawan** (untuk transfer).
  Pengguna tanpa karyawan tidak bisa membuat pengajuan.
- **Karyawan keluar:** hilangkan centang **Aktif** + alasan. Sesi web, HP, dan login langsung dicabut.
  Langkah lengkap & pemeriksaan (Direktur/Finance/PM pengganti): [runbook cabut perangkat](../runbooks/cabut-perangkat.md) §B.
- Pastikan selalu ada **minimal satu Direktur dan satu Finance aktif** selain pemohon, agar pengajuan bisa diputuskan.

## 2. Perangkat (HP hilang)

**Pengguna & Akses → Perangkat** → perangkat pengguna → **Status = Dicabut/Hilang** + alasan → Simpan. HP itu
langsung keluar. Tidak bisa dibatalkan; karyawan cukup login di HP baru. Detail: [runbook cabut perangkat](../runbooks/cabut-perangkat.md).
Kolom **Risiko integritas** tercentang = HP di-root/emulator — tinjau.

## 3. Master data

| Menu | Isi |
|---|---|
| **Master Data** | Bank, Satuan, Kategori pengeluaran (satuan wajar, perlu kendaraan), Kendaraan (nomor polisi unik, contoh `DA 1234 XY`), Vendor, Jadwal kerja, Hari libur |
| **Proyek** | Project (dibuat Direktur), Pusat biaya, Klien, Template tahapan, Penugasan tim |
| **Keuangan** | Akun kas/bank (saldo awal), Sumber kas masuk, Aturan approval |
| **Pengguna & Akses** | Pengguna, Karyawan, Rekening karyawan, Perangkat |

Data yang sudah dipakai tetap tampil di dokumen lama walau dinonaktifkan.

## 4. Aturan approval

**Keuangan → Aturan approval**. Aturan standar (ADR 0013): **Diketahui Oleh (persetujuan Direktur) = Wajib** oleh
peran Direktur, lalu **Level 1 = Finance**. Sistem menolak PM/Staff sebagai pemberi keputusan dan menolak
"Diketahui" opsional. Setiap perubahan wajib alasan dan hanya berlaku untuk pengajuan **baru** (yang sudah diajukan
memakai aturan lama). Direktur cuti: buat/ubah aturan sementara dengan pengganti bernama, lalu kembalikan.

## 5. Penomoran dokumen

**Sistem → Penomoran dokumen**: pola nomor per jenis dokumen (PB pengajuan, TRF, LPJ, KM, KK, LP, ADD), token
`{seq}` `{DD}` `{MM_ROMAN}` `{YYYY}` `{COMPANY}` dll., **Reset nomor**, **Nomor awal**. Pengajuan produksi dimulai
dari **229** (melanjutkan nomor manual). Ubah hanya bila diminta Finance/Direktur; alasan wajib.

## 6. Setting perusahaan

Hal penting yang harus Anda nyalakan/atur sebelum go-live:

| Setting | Nilai |
|---|---|
| **Absensi dari APK (termasuk offline) aktif** | Nyalakan (default mati) |
| **Laporan progress dari APK (termasuk offline) aktif** | Nyala |
| **Retensi selfie absensi (bulan)** | 12 (Q-33) |
| **Hapus otomatis selfie melewati retensi (aktif)** | Nyalakan (default mati = hanya menghitung) |
| **Versi APK minimum / terbaru, URL unduh APK** | Isi saat rilis APK baru (minimum yang terlalu tinggi mengunci semua HP) |
| **Toleransi pembulatan nota per baris (Rp)** | 1.000 |
| **Pengingat terjadwal**: Pengingat aktif, Jam kirim, batas hari, ambang anggaran, Juga kirim email | Sesuai kesepakatan |
| **Notifikasi status pengajuan → Beri tahu pemohon saat diajukan, ditarik, atau dibuat atas namanya** | Nyala (default) |
| **Notifikasi status pengajuan → Email ke Direktur/Finance saat pengajuan menunggu keputusannya** | Default mati (mengikuti "Juga kirim email" saat upgrade); nyalakan setelah alamat email pengguna benar. Batas SMTP 30 email/jam |
| **Radius geofence default (m)** | 100 — dipakai untuk lokasi yang punya titik tetapi radiusnya kosong |
| **Target resize foto di perangkat → Nota** | 1600 px (spesifikasi §9) |
| Nama, Kode singkat, Logo, Kop PDF | Data perusahaan |

![TODO screenshot: Setting perusahaan bagian absensi dan pengingat](img/admin-setting.png)

## 7. Absensi

- **Absensi → Jadwal & hari libur:** jadwal default (08.00–17.00, toleransi 15 menit, Senin–Sabtu), jadwal per
  karyawan, **hari libur**, dan **Geofence pusat biaya** (Latitude, Longitude, Radius, tombol **Cek di peta ↗**).
- Titik & radius **project** diisi di **Proyek → Project**. Lokasi tanpa titik tidak bisa dipakai absen; titik tanpa
  radius memakai **Radius geofence default** (Setting perusahaan). Server menambah toleransi akurasi GPS HP (maks.
  50 m) ke radius.
- **Laporan → Laporan Absensi**: Admin bisa melihat dan mengunduh (CSV/Excel) untuk semua karyawan.
- **Koreksi jam** karyawan: **Absensi → Rekap bulanan** → **Koreksi jam masuk/pulang** + alasan.
- Mengabsenkan karyawan tanpa HP hanya bisa oleh PM dari APK.

## 8. Pengajuan atas nama karyawan

**+ Buat pengajuan** → **Diajukan Oleh** = karyawan → rekening milik karyawan itu → isi baris (& nota untuk
Reimburse) → **Kirim pengajuan**. Anda tercatat sebagai "Dibuat Oleh". Daftar **Rekening tujuan** hanya berisi
rekening pemohon; bila dikosongkan, dipakai rekening default pemohon pertama. Karyawan yang punya akun menerima
notifikasi "Pengajuan atas nama Anda" (dan saat diajukan/ditarik); karyawan tanpa akun tetap diberi tahu langsung.

## 9. Audit Log

**Audit Log** (atau **Sistem → Audit log**): filter tanggal, user, jenis dokumen, aksi → unduh (maks. 31 hari).
