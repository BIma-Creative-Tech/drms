# ProyekKas Fase 1 — Skrip UAT per user story

- **Status:** draf E12 (Sprint S3 track D) + perbaikan S3 track E · **Tanggal:** 2026-09-26 · **Basis kode:** `develop` @ `c468bbe`
  (+ `feat/s3e-uat-gap-fixes`, lihat kolom **Status S3e** di §Selisih)
- **Dasar:** `requirements-v1.1.md` §5 (US-01…US-59), `plans/fase1-golive.md` §3 (scope) & §E12, ADR 0013
  (Direktur memberi "Diketahui" = persetujuan, lalu Finance meng-approve, PM hanya memantau), perilaku kode yang
  sebenarnya di `apps/web` dan `apps/mobile` pada commit di atas.
- **Pelengkap:** `../../f4/f4-e2e-scenario.md` (naskah teknis gerbang HP F4 — lebih rinci untuk offline, cabut
  perangkat, sinkron latar belakang). Skrip di folder ini ditujukan untuk **pengguna klien** saat sesi UAT.

## Isi folder

| File | Isi | Jumlah skenario |
|---|---|---:|
| [`00-persiapan.md`](00-persiapan.md) | Data uji fiktif & persiapan (Admin/Direktur, web) | 12 |
| [`web-staff.md`](web-staff.md) | Web — Staff (pengajuan, nota, LPJ, PDF, riwayat, rekap absensi) | 21 |
| [`web-pm.md`](web-pm.md) | Web — PM (pantau tim, progress, addendum, absensi tim, penugasan) | 12 |
| [`web-finance.md`](web-finance.md) | Web — Finance (approval, verifikasi nota, transfer, LPJ, kas, tutup buku, laporan) | 21 |
| [`web-direktur.md`](web-direktur.md) | Web — Direktur (persetujuan "Diketahui", dashboard, project, addendum, buka buku) | 12 |
| [`web-admin.md`](web-admin.md) | Web — Admin (user, master, penomoran, aturan approval, setting, perangkat) | 14 |
| [`apk-staff.md`](apk-staff.md) | APK — Staff (pengajuan offline, nota, LPJ, absensi, rekap) | 16 |
| [`apk-pm.md`](apk-pm.md) | APK — PM (pantau tim, laporan progress, absensi tim, addendum) | 11 |
| [`apk-direktur-finance.md`](apk-direktur-finance.md) | APK — Direktur & Finance (persetujuan, addendum, KPI) | 9 |
| [`traceability.md`](traceability.md) | Matriks US → skenario | — |
| [`laporan-uat-template.md`](laporan-uat-template.md) | Template laporan UAT + tanda tangan klien | — |

Total **128 skenario** (116 di luar persiapan) untuk **57 user story IN scope**.

## Scope

- **IN (diuji):** US-01…US-53, US-55, US-56, US-57, US-59 (57 US) — seluruh modul go-live (`plans/fase1-golive.md` §3).
- **OUT (tidak diuji, di luar go-live):** **US-54** OCR nota (F7), **US-58** mirror Odoo (F7). Unduh PDF di APK juga
  di luar scope (Q-16: cukup web).
- **Bergantung pekerjaan lain:** push FCM (E8) — bila Firebase klien belum siap, notifikasi diuji lewat lonceng
  in-app (APK) dan **lonceng Notifikasi** di atas menu kiri web (S3e). Signed media URL & reversal settlement (E9) diuji di laporan E9.

## Akun uji (fiktif)

Semua akun dan data di skrip ini **fiktif**. Jangan memakai nama, rekening, atau foto karyawan DRMS yang asli.
Kata sandi tidak ditulis di dokumen; fasilitator membagikannya secara terpisah dan mengganti/menonaktifkan akun
setelah UAT.

| Singkatan di skrip | Akun | Peran (label di aplikasi) | Karyawan terkait |
|---|---|---|---|
| **Staff** | `staff.uji@proyekkas.test` | Staff lapangan | Staff Uji |
| **PM** | `pm.uji@proyekkas.test` | Project Manager | PM Uji |
| **Finance** | `finance.uji@proyekkas.test` | Finance | Finance Uji |
| **Direktur** | `owner.uji@proyekkas.test` | Direktur (peran teknis `pk-owner`) | Direktur Uji |
| **Admin** | `admin.uji@proyekkas.test` | Admin | Admin Uji |
| (opsional) **Finance 2** | `finance2.uji@proyekkas.test` | Finance | Finance Uji Dua |

Catatan: laporan UAT F2 mencatat belum ada akun **Admin Uji** di staging — akun ini (dan Finance 2 bila skenario
opsional dijalankan) harus dibuat sebelum sesi (P-01).

## Data uji fiktif (dibuat di `00-persiapan.md`)

| Data | Nilai |
|---|---|
| Project utama | **PRJ-UJI-01 "Renovasi Gudang Uji"**, PM = PM Uji, RAB **Rp 100.000.000**, status Berjalan, tahapan Persiapan 20% · Struktur 30% · Finishing 50%, titik geofence = lokasi sesi UAT, radius 100 m |
| Project lain | **PRJ-UJI-02 "Project Uji Lain"**, PM = bukan PM Uji (mis. Direktur Uji sebagai PM sementara), RAB Rp 50.000.000 — untuk uji batas akses PM/Staff |
| Pusat biaya | **CC-UJI "Ops Uji Banjar"**, penanggung jawab PM Uji, titik geofence kedua + radius 100 m |
| Karyawan tanpa akun | **Karyawan Tanpa HP** (ditugaskan ke PRJ-UJI-01) |
| Rekening karyawan | Staff Uji — Bank Uji · 1111111111 · a.n. Staff Uji; Karyawan Tanpa HP — Bank Uji · 2222222222 |
| Kendaraan | **DA 9999 UJ** (Hilux) |
| Kategori | Transport/BBM (satuan wajar: liter, kali isi; perlu kendaraan), Penginapan, Konsumsi, Material |
| Akun kas | **Kas Uji Bank** saldo awal Rp 50.000.000 · **Kas Kecil Uji** saldo awal Rp 5.000.000 |
| Pengajuan contoh R1 (Reimburse) | BBM Hilux 1 **bulan** Rp 600.000 · Penginapan 2 kamar Rp 677.000 (nota Rp 676.876) · Makan siang (lump sum) Rp 170.500 → **Grand total Rp 1.447.500** |
| Pengajuan contoh UM1 (Uang Muka) | Semen 10 sak Rp 650.000 · Pasir 1 rit Rp 797.500 → **Rp 1.447.500**; nota nanti Rp 650.000 + Rp 797.376 (selisih Rp 124 dikembalikan) |
| Foto nota / selfie / progress | Foto kertas bertulisan "NOTA UJI" / wajah penguji yang bersedia / foto lokasi uji |

## Cara mengisi

- Kolom **PASS/FAIL**: tulis `PASS`, `FAIL`, atau `Tidak diuji — <alasan>`.
- Kolom **Catatan**: jam (WITA), nomor dokumen yang terbit, pesan error **apa adanya**, nama file tangkapan layar.
- Bila satu skenario FAIL, lanjutkan skenario yang tidak bergantung padanya.
- Hasil dipindahkan ke laporan (`laporan-uat-template.md`) di akhir sesi.
- Format uang: `Rp 1.447.500`. Jam: WITA (Asia/Makassar).
- ID skenario: `P-` persiapan · `WS-/WP-/WF-/WD-/WA-` web Staff/PM/Finance/Direktur/Admin · `AS-/AP-/AD-` APK
  Staff/PM/Direktur & Finance.

## Urutan yang disarankan (1 hari sesi)

1. `00-persiapan.md` (fasilitator + Admin, sebelum klien datang).
2. Alur uang utama lintas peran: WS-01…WS-09 → WD-02 → WF-02 → WF-04 → WF-06/07 → WS-13 → WF-09/10 → WS-15/16.
3. APK di lapangan (butuh berjalan ke titik geofence): AS-* → AP-* → AD-*.
4. Kas & tutup buku: WF-12…WF-17 → WD-09.
5. Admin & negatif: WA-* dan skenario negatif lain.

## Selisih yang diketahui (perilaku aplikasi vs kebutuhan) — dibahas dengan klien saat UAT

Daftar ini hasil membaca kode pada `c468bbe`. Skenario ditulis sesuai **perilaku aplikasi sebenarnya**; bila klien
menganggap selisih ini tidak dapat diterima, catat sebagai temuan di laporan §5.

**Pembaruan Sprint S3 track E (`feat/s3e-uat-gap-fixes`):** kolom **Status S3e** — *Diperbaiki* = perilaku baru
tertulis di kolom itu dan skenario terkait sudah disesuaikan; *Sebagian* = sisa selisih dijelaskan; kosong = tetap
seperti kolom "Perilaku aplikasi sekarang".

| # | US / dokumen | Kebutuhan | Perilaku aplikasi sekarang | Status S3e |
|---|---|---|---|---|
| S-01 | US-17, ADR 0013 | PM tidak punya kotak masuk persetujuan | Beranda web PM masih menampilkan kartu **'Menunggu "Diketahui" saya'** dan tautan ke **Persetujuan** (isinya selalu kosong; keputusan PM tetap ditolak server 403). | **Diperbaiki.** Beranda web PM: kartu **Pengajuan tim menunggu keputusan** (jumlah menunggu Direktur / Finance, umur tertua) + tabel pengajuan tim yang menunggu (Menunggu Direktur/Finance, lama hari, terlama dulu). Tanpa tautan Persetujuan untuk PM. API `dashboard/pm` menambah `teamWaiting` (`waitingForMe` tetap, selalu 0). |
| S-02 | US-43, Q-15 | Tanda tangan: gambar profil **atau** gambar di layar saat aksi | Di **web** hanya tanda tangan profil. Di **APK** gambar di layar hanya saat Direktur/Finance memutuskan; saat **mengajukan** dari APK dipakai tanda tangan profil, dan tanda tangan profil hanya bisa diunggah dari web. Tanpa tanda tangan profil, pengajuan/keputusan ditolak "Tanda tangan wajib…". |  |
| S-03 | US-44 | Pilihan rekening hanya milik pemohon; default rekening pemohon pertama | Web: daftar rekening **tidak difilter** (Admin/Finance melihat semua) dan tanpa default; rekening salah ditolak saat simpan "Rekening harus milik salah satu pemohon (Q-11)." APK: sudah difilter. | **Diperbaiki (web).** Pilihan **Rekening tujuan** hanya rekening aktif milik pemohon (belum ada pemohon = karyawan pembuat); bila dikosongkan saat simpan, dipakai rekening **default** pemohon pertama (atau rekening aktif tertuanya). Validasi server (Q-11) tetap. |
| S-04 | US-05, US-41, plan §7 | Semua pemohon diberi tahu tiap perpindahan status; pemohon utama diberi tahu bila dibuat atas nama | Notifikasi in-app hanya pada sebagian perpindahan (keputusan, transfer, revisi); tidak ada notifikasi ke pemohon saat diajukan/ditarik atau saat dibuat atas nama. Web **tidak punya ikon lonceng** — notifikasi dilihat di menu **Sistem → Notifikasi**. Email hanya untuk pengingat terjadwal (bila diaktifkan), bukan untuk menunggu persetujuan. Push FCM belum aktif. | **Sebagian.** Diperbaiki: notifikasi in-app ke pemohon lain/pembuat saat **diajukan**, **ditarik ke Draft**, dan saat draft **dibuat atas nama** mereka (setting *Beri tahu pemohon…*, default nyala); **email** ke Direktur/Finance saat pengajuan menunggu keputusannya (setting *Email ke Direktur/Finance…*, default mati — saat upgrade mengikuti *Juga kirim email* pengingat; isi tanpa nominal/nama); **lonceng Notifikasi** + jumlah belum dibaca di atas menu kiri web → halaman `/admin/notifikasi`. Tetap: push FCM (E8); lonceng web diperbarui saat pindah halaman (tanpa polling). |
| S-05 | US-26, US-59 (web) | Layar approval menampilkan baris item, nota, daftar flag per baris, posisi tanda tangan | Web **Persetujuan** hanya menampilkan jumlah flag ("n peringatan / n info") dan dampak anggaran; rincian baris/nota/flag harus dibuka di pengajuan/koleksi **Flag validasi nota**. Panel detail menampilkan nota & flag hanya untuk pemohon/pembuat. Jumlah flag yang disimpan saat keputusan = flag **peringatan** terbuka saja. APK menampilkan lebih lengkap. | **Diperbaiki (web).** **Persetujuan**: tiap baris punya **Rincian baris, nota & flag** (baris item, foto nota lewat endpoint media ber-otorisasi, total nota & selisih per baris, flag per baris). Panel detail pengajuan menampilkan rincian yang sama untuk semua pembaca selain pemohon/pembuat (Direktur, Finance, PM, Admin). **Definisi jumlah flag** (kolom Flag & yang disimpan bersama keputusan): flag **terbuka**, peringatan + info; flag *sudah diperiksa*/*tidak berlaku* tidak dihitung (keputusan sebelum S3e: peringatan terbuka saja). |
| S-06 | US-26/US-42 | Alasan tolak wajib | Wajib (≥ 3 karakter) di server; di web kotak prompt tidak memeriksa panjang dan alasan < 3 karakter hanya dijawab "Data tidak valid." | **Diperbaiki.** Web memeriksa minimal 3 karakter sebelum kirim; server menjawab "Alasan wajib diisi, minimal 3 karakter." (juga catatan revisi LPJ, alasan addendum & koreksi absensi). |
| S-07 | US-19 | Badge = jumlah antrian transfer | Badge menu **Antrian Transfer** juga menghitung Reimburse yang masih menunggu verifikasi nota, sehingga bisa lebih besar dari judul halaman "Antrian Transfer (n)". | **Diperbaiki.** Badge = jumlah **Siap ditransfer** (sama dengan judul halaman). Reimburse yang menunggu verifikasi nota tetap di bagian atas halaman, tidak dihitung di badge. |
| S-08 | US-21 | Flag tampil & ditangani saat verifikasi LPJ | Flag tampil, tetapi halaman **Verifikasi LPJ** tidak punya tombol "Tandai flag diperiksa". | **Diperbaiki.** Tombol **Tandai flag diperiksa** (Finance, catatan opsional) per flag terbuka di **Verifikasi LPJ**; tercatat `flag_reviewed` di Riwayat/Audit. |
| S-09 | US-22, E9 | Settlement dapat dikoreksi | KM pengembalian LPJ tidak bisa di-void ("Bagian dari LPJ"); reversal settlement **menyusul** (E9). |  |
| S-10 | US-27 | 4 kartu: saldo kas, anggaran terpakai, kelengkapan nota/LPJ, pengajuan menunggu | Kartu atas Direktur: Saldo kas total, Pengajuan menunggu, **Pencairan bulan ini**, Realisasi vs anggaran; kelengkapan nota/LPJ tampil sebagai kartu terpisah di bawah. |  |
| S-11 | US-28 | Periode grafik bisa dipilih | Beranda web Direktur: 12/6 bulan; Finance: 6 bulan tetap; APK: ketuk bulan. Rentang bebas hanya di **Laporan → Rekap Kas**. |  |
| S-12 | US-52 | Biaya per kendaraan dari baris ≥ "Ditransfer" + kas keluar manual; export Excel | Sesuai (versi dasar); tanpa PDF; catatan di laporan menyebut versi berbasis nota terverifikasi "tersedia di F5". |  |
| S-13 | ADR 0005 §3 | Saldo awal = entri kas `opening` | Saldo awal = field **Saldo awal (Rp)** di Akun kas/bank (bisa diubah dengan alasan). Keputusan E11. |  |
| S-14 | US-10, E4 | Laporan progress di APK + web | Membuat/mengedit laporan progress **hanya dari APK**; web hanya menampilkan. Direktur juga boleh membuat laporan (sesuai matriks §4). |  |
| S-15 | US-30, ADR 0013 O-3 | Usulan: Direktur menyetujui addendum, Finance diberi tahu | Addendum butuh **dua** persetujuan: Direktur lalu **Finance** ("Menunggu Direktur" → "Menunggu Finance"). Addendum hanya bisa diajukan **PM** project. |  |
| S-16 | US-33, US-55 | Data yang belum dipakai boleh dihapus | Tidak ada hapus sama sekali untuk master/transaksi; hanya **nonaktif**/arsip dengan alasan. |  |
| S-17 | US-29 | Direktur membuat & mengedit project dan tahapan | Sesuai; PM hanya boleh mengganti nama/urutan/bobot tahapan project timnya (tidak menambah/menonaktifkan). |  |
| S-18 | US-16 | PM mengelola anggota: tambah, nonaktifkan, **pindah project** | PM bisa menambah & mengakhiri penugasan; **pindah project** = akhiri lalu buat penugasan baru ("Project penugasan tidak dapat dipindah."). Di APK tidak ada layar penugasan (web saja). |  |
| S-19 | US-01 | Tombol aktif dalam radius project | Radius ditambah toleransi akurasi GPS (maks. 50 m). Lokasi **tanpa** titik/radius tidak bisa dipakai absen (radius default perusahaan tidak dipakai untuk absen). | **Diperbaiki.** Lokasi dengan titik tetapi **tanpa radius** memakai **Radius geofence default** perusahaan (server + data master APK). Toleransi akurasi GPS: radius + akurasi yang dilaporkan HP, **maks. 50 m** (akurasi 500 m tetap hanya +50 m). Lokasi tanpa titik tetap ditolak. |
| S-20 | US-14 | PM mengabsenkan anggota | Sesuai, **hanya di APK** dan hanya peran PM (Admin tidak bisa). |  |
| S-21 | US-15 | PM mengoreksi jam | Sesuai; Admin juga bisa mengoreksi; tidak ada yang bisa mengoreksi absensinya sendiri. |  |
| S-22 | E6, Q-33 | Absensi APK aktif di prod; selfie > 12 bulan terhapus | Default **mati**: "Absensi dari APK…" dan "Hapus otomatis selfie melewati retensi (aktif)" harus dinyalakan Admin (P-06). |  |
| S-23 | §4 matriks | Admin R/U absensi | **Laporan Absensi** (export) hanya untuk Finance, Direktur, PM — Admin tidak. | **Diperbaiki.** Admin membuka **Laporan → Laporan Absensi** (semua karyawan) dan mengunduh CSV/Excel; laporan keuangan tetap tertutup untuk Admin. |
| S-24 | US-57, §9 | Foto nota ≤ 1600 px ≤ 400 KB; logo 1024 px | Server: nota **2000 px**, logo 600 px, kualitas 75–82; batas KB tidak dipaksakan server (APK tetap mengompres). | **Sebagian.** Server: foto nota ≤ **1600 px**, logo ≤ **1024 px**; batas upload: 8 MB (logo & tanda tangan 2 MB) dan maks. 50 megapiksel. Target perangkat nota di Setting = 1600 px (migrasi mengganti nilai lama 2000). Batas 400 KB **tidak** dipaksakan server (APK lama & kamera web tetap diterima; hasil re-encode JPEG q82 ≤ 1600 px umumnya < 400 KB). |
| S-25 | §4 matriks | Staff/PM membaca audit log dokumen sendiri/tim | Staff/PM melihat tab **Riwayat** per dokumen; halaman **Audit Log** global hanya Direktur, Finance, Admin. |  |
| S-26 | US-06 | Ajukan ulang menyalin data lama | Baris, pemohon, rekening, lampiran disalin; **nota tidak disalin** (Reimburse harus unggah nota lagi). | **Diperbaiki.** **Ajukan ulang** menyalin nota yang aktif (bukan ditolak/dihapus) ke baris yang sama di draft baru, status "belum diverifikasi"; foto sama; flag dihitung ulang (pengajuan lama yang Ditolak tidak dianggap nota ganda). |
| S-27 | US-07 (web) | Total nota per baris, per pengajuan, dan selisih ditampilkan | Web menampilkan nota per baris & flag selisih, tetapi tidak menampilkan total nota per baris/pengajuan; field nota tidak bisa diedit di web (hapus + unggah ulang). | **Sebagian.** Total nota & selisih per baris dan total nota per pengajuan tampil di **Rincian untuk pemeriksa** (pembaca selain pemohon) dan Persetujuan; field nota tetap tidak bisa diedit di web. |
| S-28 | E7 | Pengingat (a)–(d) | (a) hanya project berstatus **Berjalan**; (b) juga untuk status "Nota Lengkap" dan pembuat ikut diberi tahu; (d) PM juga diberi tahu dan ambang merah 100% juga memicu; email default mati. |  |
| S-29 | ADR 0013 O-2 | Peringatan "Anda juga yang menyetujui" di layar transfer | Belum ada. | **Diperbaiki.** **Antrian Transfer**: kotak "**Anda juga yang menyetujui**" pada pengajuan yang Approval-nya (siklus berjalan) diberikan oleh Finance yang sedang login. Tetap boleh dicatat (O-2: tidak dipaksa berbeda orang). |
| S-30 | US-48, Q-04 | Flag "tanggal nota setelah tanggal pengajuan" | Tanggal pengajuan = tanggal kirim (server), jadi flag ini praktis tidak muncul saat UAT (sama dengan temuan UAT F2 1.3b). Flag "Nota terlalu lama" (> 30 hari) tetap diuji. |  |
| S-31 | APK | Konflik draft | Draft pengajuan yang juga diubah di web: versi web dipakai, salinan HP tidak bisa dibandingkan (layar pembanding hanya untuk laporan progress). |  |
