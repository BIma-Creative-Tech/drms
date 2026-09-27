# 00 — Persiapan data uji (web)

Dikerjakan fasilitator bersama **Admin** (dan **Direktur** untuk project/tahapan) sebelum sesi UAT. Semua data fiktif
(lihat `README.md` §Data uji fiktif). Menu yang disebut adalah menu panel admin web (`/admin`).

| ID | US | Prasyarat | Langkah | Hasil yang diharapkan | PASS/FAIL | Catatan |
|---|---|---|---|---|---|---|
| P-01 | US-32 | Akses Admin; akun uji dibuat lewat UAT seed | **Pengguna & Akses → Pengguna**: pastikan 5 akun uji (+ Finance 2 bila dipakai) ada, **Aktif**, peran sesuai tabel akun, dan masing-masing terhubung ke **Karyawan**. | Semua akun aktif dengan satu peran dan karyawan terkait. | | |
| P-02 | US-43 | P-01 | Masuk web sebagai tiap akun uji → **Profil & tanda tangan** → unggah gambar tanda tangan (PNG). | Tanda tangan tersimpan untuk Staff, PM, Finance, Direktur, Admin. (Tanpa ini pengajuan/keputusan ditolak "Tanda tangan wajib…".) | | |
| P-03 | US-33 | P-01 | **Master Data**: buat/aktifkan Bank "Bank Uji", Satuan (liter, kali isi, bulan, kamar, sak, rit, LS), Kategori (Transport/BBM dengan satuan wajar liter & kali isi + "perlu kendaraan"; Penginapan; Konsumsi; Material), Kendaraan **DA 9999 UJ** (Hilux); di **Keuangan → Sumber kas masuk** pastikan "Pengembalian LPJ" dan satu sumber lain (mis. "Modal owner") aktif. | Tersimpan dan aktif. | | |
| P-04 | US-33, US-44 | P-03 | **Pengguna & Akses → Karyawan**: buat "Karyawan Tanpa HP". **Rekening karyawan**: Staff Uji (Bank Uji · 1111111111, default) dan Karyawan Tanpa HP (Bank Uji · 2222222222). | Tersimpan. | | |
| P-05 | US-23 | P-03 | **Keuangan → Akun kas/bank**: buat "Kas Uji Bank" saldo awal Rp 50.000.000 dan "Kas Kecil Uji" saldo awal Rp 5.000.000 (isi alasan). | Tersimpan; di **Kas** saldo tampil sesuai. | | |
| P-06 | US-01, US-02, US-10 | Akses Admin | **Setting perusahaan**: centang "Absensi dari APK (termasuk offline) aktif" dan "Laporan progress dari APK (termasuk offline) aktif"; **Versi APK minimum** kosong atau ≤ versi APK uji; "Toleransi pembulatan nota per baris (Rp)" = 1000; "Pengingat aktif" = ya; catat nilai retensi selfie. Simpan dengan alasan. | Tersimpan tanpa error. | | |
| P-07 | US-29 | Masuk sebagai **Direktur** | **Proyek → Project** → buat **PRJ-UJI-01 "Renovasi Gudang Uji"**: PM = PM Uji, RAB Rp 100.000.000, status Berjalan, Latitude/Longitude = titik lokasi sesi (salin dari Google Maps), Radius geofence 100. Buat juga **PRJ-UJI-02** dengan PM bukan PM Uji. | Kedua project tersimpan. | | |
| P-08 | US-29 | P-07 | **Alur kerja → Progress project** → PRJ-UJI-01 → **Editor tahapan** → tambah Persiapan 20, Struktur 30, Finishing 50 → **Simpan tahapan**. | Meter bobot "✓ sudah 100%"; tahapan tersimpan. | | |
| P-09 | US-53, US-01 | Admin/Direktur | **Proyek → Pusat biaya**: buat **CC-UJI "Ops Uji Banjar"**, penanggung jawab PM Uji, aktif. Di **Absensi → Jadwal & hari libur → Geofence pusat biaya** isi titik kedua + radius 100. | Tersimpan. | | |
| P-10 | US-16 | P-07, P-09 | **Proyek → Penugasan tim**: Staff Uji → PRJ-UJI-01 dan CC-UJI; Karyawan Tanpa HP → PRJ-UJI-01. | Penugasan aktif. | | |
| P-11 | US-34 | Admin | **Keuangan → Aturan approval**: pastikan aturan aktif untuk **Pengajuan biaya**: "Diketahui Oleh (persetujuan Direktur)" = Wajib, peran Direktur; Level 1 = Finance. Untuk **Addendum RAB**: Direktur lalu Finance. Tidak ada pengajuan lama berstatus menunggu. | Aturan sesuai ADR 0013. | | |
| P-12 | US-09 | Admin | **Absensi → Jadwal & hari libur**: jadwal default 08.00–17.00, toleransi 15 menit, Senin–Sabtu (Q-30); tambahkan satu **hari libur** fiktif pada tanggal di bulan berjalan. APK uji terpasang di minimal 2 HP (merek berbeda). | Jadwal & libur tersimpan; ikon aplikasi tampil di HP. | | |
