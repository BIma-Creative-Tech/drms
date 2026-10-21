# Panduan Admin

Admin mengelola **pengguna dan akses PT, master data, penomoran, aturan approval, data perusahaan (PT), perangkat,
jadwal absensi**, dan boleh **membuat pengajuan atas nama karyawan**. Admin tidak menyetujui pengajuan dan tidak
mengelola kas. Semua di **web**. Baca juga [Hal umum](README.md#hal-umum-untuk-semua-peran).

Aturan umum panel: data **tidak pernah dihapus** — gunakan centang **Aktif** (nonaktifkan) dengan alasan. Setiap
perubahan tercatat di **Audit Log**.

### Admin PT dan Admin grup

ProyekKas bisa memuat beberapa PT dalam satu grup. Peran berlaku **per PT**:

| Siapa | Boleh |
|---|---|
| **Admin PT** (peran Admin di PT itu) | Mengelola pengguna, akses dan master **di PT tempat ia Admin**. Kolom PT lain di matriks akses hanya bisa dilihat, tidak diubah. |
| **Admin grup** (centang **Admin grup (semua PT)** di data Pengguna) | Membuat dan menonaktifkan PT, mengubah **Setting aplikasi**, dan mengubah akses PT **semua** pengguna. Centang ini hanya bisa diberikan oleh Admin grup lain. |

Di bar atas ada **tombol PT** (lihat [Hal umum](README.md#hal-umum-untuk-semua-peran)). Daftar data mengikuti PT yang
dicentang; bila lebih dari satu PT tampil, daftar punya kolom **PT** dan filter **PT ▾** (bisa beberapa PT sekaligus).
Cara memakai filter, **Kolom ▾**, urutan dan halaman: [Daftar dan tabel](README.md#hal-umum-untuk-semua-peran).

### Navigasi: layar modul (gaya Odoo)

Buka `/admin` → **layar modul**: kotak-kotak berwarna, satu per modul. Klik modul → menu modul tampil di **bar atas**
(bukan menu kiri). Menu dengan ▾ membuka daftar turunan. Tombol **⊞** di kiri bar kembali ke layar modul; di kanan
bar ada **tombol PT**, **lonceng Notifikasi** dan **menu akun** (inisial nama: Profil & tanda tangan, Keamanan akun,
Tema terang/gelap, Keluar). Di HP (layar sempit) menu modul dibuka dengan tombol **☰**. Modul hanya tampil bila Anda
punya akses ke minimal satu isinya; angka merah = jumlah yang menunggu tindakan.

**+ Buat** (bar atas, kiri tombol PT; pintasan **Alt+N**) membuka langsung formulir baru: Pengajuan baru (atas nama karyawan), Proyek baru, Klien baru, Vendor baru, **Pengguna baru** (formulir bertab Pengguna) dan Karyawan baru.

Di halaman daftar dan formulir data, baris kecil di bawah bar menunjukkan **lokasi halaman**, mis.
**Keuangan › Pengajuan biaya › PB-2026-0001**: klik nama modul untuk ke menu pertamanya, klik nama daftar untuk
kembali ke daftar. Halaman khusus (Kas, Antrian Transfer, Laporan, dst.) tidak punya baris ini — judul halaman sudah
cukup. Di HP, tabel lebar bisa digeser ke samping di dalam kotaknya (bayangan di tepi = masih ada kolom); Antrian
Transfer tampil sebagai kartu per pengajuan.

| Modul | Isi menu |
|---|---|
| **Dashboard** | Ringkasan per peran (tab peran bila punya lebih dari satu), `/admin/dashboard` |
| **Persetujuan** | Persetujuan · Antrian Transfer · Verifikasi LPJ (Direktur/Finance) · Approval & tanda tangan |
| **Proyek** | Project · RAB per kategori · Tahapan ▾ (Tahapan project, Template tahapan) · Data pendukung ▾ (Klien, + Klien baru, Pusat biaya, Penugasan tim) · Progress ▾ · Addendum ▾ |
| **Keuangan** | Pengajuan ▾ (Pengajuan biaya, + Buat pengajuan, Snapshot, Nota, Flag nota) · Kas ▾ · Transfer & LPJ ▾ · Tutup buku ▾ |
| **Absensi** | Tim hari ini · Rekap bulanan · Jadwal & hari libur · Absensi · Koreksi absensi · Konfigurasi ▾ (Jadwal kerja, Hari libur) |
| **Laporan** | Semua laporan (Admin: laporan absensi) |
| **Pengguna & Akses** | Akses PT (matriks) · Pengguna · Data akses PT · Karyawan · Rekening karyawan · Perangkat & sesi ▾ (Perangkat, Sesi web) |
| **Master Data** | Bank · Satuan · Kategori pengeluaran · Kendaraan · Vendor |
| **Media** | Foto nota · Bukti transfer · Selfie absensi · Foto progress · Tanda tangan · Logo perusahaan · Lampiran |
| **Pengaturan** | Perusahaan (PT) · Setting aplikasi · Aturan approval · Template notifikasi · Penomoran dokumen |
| **Sistem** | Audit Log · Data audit log · Notifikasi saya · Data notifikasi |

Tautan lama tetap berlaku (mis. `/admin/kas`, `/admin/collections/...`); hanya beranda `/admin` yang kini layar modul.

Modul yang **tidak bisa dipakai** suatu peran tidak tampil (dihitung dari hak akses, bukan daftar tetap): modul yang
isinya hanya profil sendiri / notifikasi sendiri disembunyikan (keduanya sudah ada di bar atas — Staff tidak melihat
**Pengguna & Akses** dan **Sistem**); **Master Data** dan **Pengaturan** hanya tampil bagi yang boleh membuat atau
mengubah salah satu isinya (PM tidak melihat keduanya; Finance tidak melihat Pengaturan). Halaman yang tidak boleh
dibuka menampilkan satu pesan yang sama: **"Anda tidak memiliki akses ke halaman ini."** + **← Kembali ke beranda**.

### Hak akses per peran — perubahan 2026-10-08 (laporan QA, keputusan pemilik)

| Data | Admin | Direktur | Finance | PM | Staff |
|---|---|---|---|---|---|
| **Pengguna** (akun login) | Ubah akun di PT tempat ia Admin (Admin grup: semua) | **Hanya baca** (kecuali tanda tangan sendiri) | Profil sendiri | Profil sendiri | Profil sendiri |
| **Project** (nama, alamat, RAB, status, …) | Baca | Buat & ubah | Baca | **Hanya baca** project timnya | Baca project penugasannya |
| **Addendum RAB / Laporan progress** (data) | **Baca** (baru) | Baca | Baca | Baca timnya | — |
| **Pusat biaya** (pilihan di form pengajuan) | Semua | Semua | Semua | Timnya | Penugasannya — kosong bila belum ditugaskan (tanpa error) |

- Mengubah isian yang tidak boleh diubah (mis. PM mengubah nama/RAB project lewat API) ditolak **403** dengan nama
  isiannya: *"Anda tidak berhak mengubah: Nama project, Alamat. Hanya Direktur yang dapat mengubah isian ini."* —
  tidak lagi "tersimpan" diam-diam tanpa perubahan.
- Pilihan **Project Manager** di form project hanya berisi **PM aktif PT itu**, tampil **nama · email**; begitu juga
  **Penanggung jawab** pusat biaya (anggota aktif PT) dan user di **Aturan approval** (Direktur/Finance PT itu).

![TODO screenshot: layar modul Admin + bar menu modul Pengguna & Akses](img/admin-menu.png)

## 1. Pengguna, karyawan dan akses PT

**Satu form ber-tab (DRMS 13/10, mulai versi berikutnya):** akun login, akses per PT, data karyawan dan rekening
karyawan diisi di **satu halaman** dan disimpan **sekaligus** — tidak perlu lagi membuka Karyawan → Rekening →
Pengguna → Akses PT satu per satu.

1. **Pengguna & Akses → Pengguna** → **+ Buat baru** (atau menu **+ Pengguna baru**, atau tombol **+ Pengguna baru**
   di matriks Akses PT). Klik satu baris di daftar Pengguna = membuka form yang sama untuk mengubah.
2. Isi tab demi tab (label di kiri, isian di kanan; di HP label di atas):
   - **Detail Pengguna:** **Email** (untuk login), **Nama**, **No. HP**, **Status** (Aktif/Nonaktif). Satu orang =
     satu akun, walau bekerja di beberapa PT.
   - **Akses & Peran:** satu baris per PT yang Anda kelola → pilih peran dari **dropdown pilihan ganda** (Staff, PM,
     Finance, Direktur, Admin, Operator/Anggota; boleh lebih dari satu) → **Selesai**. Mengosongkan semua peran di
     satu PT = akses di PT itu dinonaktifkan (riwayat tetap).
   - **Data Karyawan, Rekening Karyawan, Penugasan Proyek** menampilkan **semua PT yang Anda kelola** — tidak perlu
     memilih peran dulu. PT yang belum punya data karyawan tampil satu baris dengan **+ Tambah data karyawan** /
     **+ Tambah rekening** / **+ Tambah penugasan**: data karyawan baru PT itu dibuat sekaligus (lengkapi **Kode**), dan
     bila akun belum punya peran di PT itu, peran **Staff lapangan** otomatis dicentang (terlihat dan bisa diubah di
     **Akses & Peran**; memilih **Tanpa data karyawan** lagi membatalkannya).
   - **Data Karyawan:** per PT → **Buat data karyawan baru** (Kode, Nama lengkap, Nama panggilan,
     Jabatan, No. HP, Status), **Pilih karyawan yang sudah ada** (hanya karyawan PT itu yang belum terhubung ke akun
     lain), atau **Tanpa data karyawan**. Karyawan yang sudah terhubung bisa diubah langsung, atau **Lepas tautan**
     (data karyawannya tetap ada). Jadwal kerja, site penempatan dan foto wajah: tautan **Buka data karyawan
     lengkap ↗**.
   - **Rekening Karyawan:** per PT → **+ Tambah rekening** (Bank, Nomor rekening — hanya
     angka, Atas nama, Status verifikasi, Rekening default, Status). Rekening tidak pernah dihapus — nonaktifkan.
   - **Penugasan Proyek:** per PT (juga karyawan baru di simpan yang sama) → **+ Tambah
     penugasan**: **Jenis lokasi** (Project / Pusat biaya / Site) lalu pilih satu lokasi aktif PT itu, **Peran** (PM /
     Staff / Mandor), **Mulai**, **Selesai** (boleh kosong). Penugasan yang tersimpan: ubah **Peran** atau isi
     **Selesai** untuk mengakhirinya (wajib alasan); tidak dapat dihapus. Detail lain: tautan **Buka ↗**.
3. **Simpan** (satu tombol, di bawah). Semua tab disimpan **bersama atau tidak sama sekali**. Bila ada yang salah,
   tidak ada yang tersimpan: tab yang bermasalah diberi titik merah, isian yang salah ditandai beserta pesannya.
4. **Akun baru:** setelah Simpan tampil **kata sandi sementara** (hanya sekali — salin dan berikan langsung ke
   pengguna, jangan lewat grup chat). Saat login pertama pengguna **wajib mengganti** kata sandinya. Bila email itu
   sudah punya akun di sistem login, akun itu ditautkan dan kata sandinya **tidak** diubah (pesan "sudah ada …
   ditautkan").
5. **Mengubah pengguna:** isi **Alasan perubahan** (bawah) bila menonaktifkan akun/karyawan/rekening, mengubah
   nomor rekening, nama pemilik atau bank, atau mengubah peran / mengakhiri penugasan — tanpa alasan, simpan ditolak dengan pesan di isian Alasan. Semua perubahan
   tercatat di **Audit Log** seperti dari halaman masing-masing.

Aturan yang tetap berlaku (sama seperti halaman lama):

- Hanya **Admin PT** (PT tempat ia Admin) dan **Admin grup** yang bisa membuka form ini. Form hanya menampilkan PT
  yang Anda kelola **dalam pilihan PT** saat ini (pemilih PT di kanan atas).
- Akun yang **juga terdaftar di PT lain** yang bukan wewenang Anda: email, nama, No. HP dan status hanya-baca (pesan
  di tab Detail Pengguna) — peran di PT Anda tetap bisa diubah. Admin grup bisa mengubah semuanya.
- Admin grup tanpa peran Admin di suatu PT hanya mengatur **peran** di PT itu; data karyawan dan rekening PT itu
  diubah oleh Admin PT tersebut.
- **Akun sendiri:** Anda tidak bisa menonaktifkan akun Anda sendiri atau mencabut peran Admin Anda sendiri di form
  ini (minta Admin lain).
- Pesan **"Satu karyawan hanya boleh terhubung ke satu akun per PT …"** = karyawan itu sudah dipakai akun lain.
- **Form akun (tanda tangan, Admin grup) ↗** di kepala halaman membuka form lama pengguna (tanda tangan, Admin grup,
  ID Keycloak, pemberitahuan privasi).

![TODO screenshot: form Pengguna ber-tab (Detail Pengguna · Akses & Peran · Data Karyawan · Rekening Karyawan)](img/admin-pengguna-tab.png)

Halaman lama **tetap bisa dipakai** (mis. untuk banyak pengguna sekaligus):

1. **Karyawan:** **Pengguna & Akses → Karyawan** → buat baru → pilih **PT** (paling atas; wajib bila Anda mencentang
   lebih dari satu PT) → isi data. **1 data karyawan = 1 PT**; orang yang bekerja di 2 PT punya 2 data karyawan. PT
   karyawan tidak bisa diubah setelah dibuat. Lalu isi **Rekening karyawan** (untuk transfer).
2. **Pengguna (akun login):** form lama lewat **Form akun ↗** (lihat di atas) → **Email**, **Nama**, **No. HP**,
   **Aktif** → Simpan. Akun login dibuat otomatis di sistem login DRMS (tautan atur kata sandi lewat email).
3. **Akses PT:** **Pengguna & Akses → Akses PT (matriks)** (halaman **Pengguna & akses PT**, `/admin/akses-pt`):
   baris = pengguna, kolom = PT.
   - Sel **bukan anggota** → **+ Tambah** → pilih peran di PT itu dari **dropdown pilihan ganda** (**Staff**, **PM**,
     **Finance**, **Direktur**, **Admin**, **Operator/Anggota**; boleh lebih dari satu) → pilih **Karyawan** PT itu
     (tanda ↗ membuka data karyawannya). Nama pengguna di kolom kiri membuka form ber-tab.
   - Ubah beberapa sel sekaligus bila perlu → isi **Alasan (wajib)** (mis. "mutasi tugas ke CS1") → **Simpan**.
     Semua perubahan disimpan bersama atau tidak sama sekali; sel yang bermasalah ditandai merah.
   - Mengosongkan semua peran di satu PT = akses di PT itu dinonaktifkan (riwayat tetap).
   - Cari dengan **Cari nama / email**; centang **tampilkan akun nonaktif** untuk melihat akun lama; sembunyikan
     kolom lewat **Kolom PT**.
   - Pesan **"Satu karyawan hanya boleh terhubung ke satu akun per PT."** = karyawan itu sudah dipakai akun lain.
   - Peringatan **"PT … tidak punya … aktif — pengajuan … tidak bisa diajukan (409)"** = PT itu belum punya Direktur
     dan/atau Finance aktif. Tambahkan sebelum karyawan PT itu mulai mengajukan.
   - Pengguna tanpa karyawan di suatu PT tidak bisa membuat pengajuan di PT itu.

![TODO screenshot: matriks Pengguna & akses PT dengan dua kolom PT](img/admin-akses-pt.png)

- **Karyawan keluar:** buka **Pengguna** (klik barisnya) → tab **Detail Pengguna** → **Status = Nonaktif** + **Alasan
  perubahan** → **Simpan**. Sesi web, HP, dan login langsung dicabut (di semua PT). Langkah lengkap & pemeriksaan
  (Direktur/Finance/PM pengganti): [runbook cabut perangkat](../runbooks/cabut-perangkat.md) §B. Keluar dari **satu PT
  saja**: kosongkan perannya di PT itu (tab **Akses & Peran**, atau kolom PT itu di matriks).
- Pastikan **setiap PT** selalu punya **minimal satu Direktur dan satu Finance aktif** selain pemohon, agar pengajuan
  bisa diputuskan.
- **Data akses PT** (`Pengguna & Akses → Data akses PT`) = daftar mentah isi matriks, untuk pencarian/pemeriksaan.
- **Pemberitahuan privasi (Q-46):** daftar **Pengguna** punya kolom **Privasi dibaca (versi/tanggal)**: `v1 · 05/10/26
  10.12` = sudah dibaca, **Belum** = belum pernah, `(terbaru vN)` = membaca versi lama. Hanya pengguna sendiri yang bisa
  mengisinya (tombol **Saya mengerti** di web/APK); di form pengguna kolomnya hanya-baca. Tiap konfirmasi tercatat di
  **Audit Log** (aksi `privacy_ack`). Teks pemberitahuan ada di halaman publik **`/privasi`**; isinya diubah tim teknis
  dari dokumen HR/legal (bukan dari panel). Pengguna yang belum membaca: absensi APK terkunci; di web tampil
  pemberitahuan yang harus dikonfirmasi sebelum memakai panel.
- **Penegakan di server:** naikkan **Versi APK minimum** ke **0.3.3** → absensi tanpa persetujuan ditolak (absen
  masuk/pulang, unggah selfie, dan absen oleh PM — yang dicek PM-nya), kode `PRIVACY_ACK_REQUIRED`, tercatat di
  **Audit Log** sebagai `access_denied`. Di bawah 0.3.3 atau kosong: tidak ada penolakan (APK 0.3.2 tetap jalan). Naikkan
  baru setelah semua HP memakai APK 0.3.3 — HP versi lama juga terkunci oleh versi minimum. Koreksi absensi oleh
  PM/Admin tidak terpengaruh.

## 2. Perangkat (HP hilang)

**Pengguna & Akses → Perangkat & sesi → Perangkat** → perangkat pengguna → **Status = Dicabut/Hilang** + alasan →
Simpan. HP itu langsung keluar. Tidak bisa dibatalkan; karyawan cukup login di HP baru. Detail:
[runbook cabut perangkat](../runbooks/cabut-perangkat.md). Kolom **Risiko integritas** tercentang = HP di-root/emulator — tinjau.

**2FA hilang:** bila karyawan kehilangan HP/aplikasi autentikator, pastikan dulu (di luar aplikasi) bahwa memang
orangnya. Reset dilakukan di **konsol admin Keycloak** (Users → pengguna → Credentials → hapus kredensial OTP), bukan
di panel ProyekKas (ADR 0017). Setelah itu karyawan login dengan kata sandi dan boleh menyalakan 2FA lagi. Siapa yang
memegang akses konsol Keycloak di prod: **belum diverifikasi** — hubungi tim teknis.

## 3. Master data

| Modul | Isi |
|---|---|
| **Master Data** | Bank, Satuan (dipakai bersama semua PT); Kategori pengeluaran (satuan wajar, perlu kendaraan), Kendaraan (nomor polisi unik di seluruh grup, contoh `DA 1234 XY`), Vendor (halaman ber-tab: Detail · **Rekening** · Kontak PIC, lihat 3b), **Rekening vendor** (tujuan pembayaran vendor; verifikasi oleh Admin / Finance) — per PT |
| **Absensi → Konfigurasi** | Jadwal kerja (per PT), Hari libur (bersama) |
| **Proyek** | Project (dibuat Direktur), Pusat biaya, Klien (halaman ber-tab: Detail · Kontak PIC · Proyek, lihat 3b), Template tahapan, Penugasan tim — per PT |
| **Keuangan → Kas** | Akun kas/bank (saldo awal), Sumber kas masuk — per PT |
| **Pengaturan** | Perusahaan (PT), Setting aplikasi, Aturan approval, Template notifikasi, Penomoran dokumen |
| **Pengguna & Akses** | Akses PT (matriks), Pengguna, Karyawan, Rekening karyawan, Perangkat |

- Master per PT punya kolom **PT** di atas formulir (wajib bila Anda mencentang lebih dari satu PT; tidak bisa diubah
  setelah dibuat). Kode yang sama boleh dipakai di dua PT, tetapi tidak dua kali dalam satu PT.
- Pilihan di formulir (project, pusat biaya, karyawan, rekening, jadwal) hanya berisi data **PT dokumen itu**.
- Data yang sudah dipakai tetap tampil di dokumen lama walau dinonaktifkan.

### 3b. Klien dan Vendor — satu halaman ber-tab (DRMS 16/10)

Klien dan vendor dibuat / diubah di **satu halaman ber-tab dengan satu tombol Simpan** — baris kontak dan rekening
ditambah langsung di tabnya, tanpa pindah sub-menu dan tanpa "simpan dulu, baru tambah". Semua isi tab tersimpan
sekaligus; bila satu baris ditolak, **tidak ada yang tersimpan** dan tab yang salah diberi titik merah.

- **Klien** (Proyek → Data pendukung → **Klien** → **+ Buat baru** / klik baris / **Ubah**, atau menu **+ Klien
  baru**; dibuat Admin / Direktur PT): **Detail Klien** (PT, nama, alamat, status) · **Kontak PIC** (banyak orang:
  nama wajib, jabatan, No. HP, email, catatan, *Kontak utama*) · **Proyek** (proyek klien ini yang boleh Anda lihat,
  dengan tautan; **+ Proyek baru** membuka form proyek dengan klien ini dan PT-nya sudah terisi).
- **Vendor** (Master Data → **Vendor**, atau menu **+ Vendor baru**; dibuat Admin / Finance, diubah juga oleh
  Direktur): **Detail Vendor** (PT, nama, NPWP, alamat, status) · **Rekening** (bank, nomor, atas nama, default,
  status verifikasi, aktif — hanya Admin / Finance PT itu; mengubah nomor / atas nama / bank atau menonaktifkan
  rekening wajib dengan alasan) · **Kontak PIC**.
- **Kontak utama** tampil sebagai kolom **Kontak** / **No. HP** di daftar dan di aplikasi (kolom lama diisi otomatis
  dari kontak utama). Kontak yang sudah ada sebelum 16/10 dipindahkan otomatis menjadi kontak utama.
- Menonaktifkan klien / vendor wajib dengan **Alasan perubahan** (bar Simpan). Yang tidak berhak mengubah melihat
  halaman yang sama dalam mode **hanya baca**.
- **Dari formulir lain tanpa pindah halaman:** di bawah pilihan **Klien** (Project, Kendaraan), **Vendor** (Pengajuan,
  Rekening vendor) dan **Karyawan / Pemohon** (Pengajuan, Penugasan tim, Rekening karyawan) ada tombol **+ Klien
  baru** / **+ Vendor baru** / **+ Karyawan baru**: formulir terbuka di panel samping (Klien / Vendor = halaman ber-tab
  di atas, Karyawan = formulir karyawan biasa, tanpa akun pengguna), PT-nya mengikuti formulir, dan setelah **Simpan**
  data baru langsung terpilih. Tombol hanya tampil bila Anda boleh membuat data itu; selama PT formulir belum dipilih
  tombolnya mati dengan keterangan **Pilih PT terlebih dahulu**.

## 4. Aturan approval

**Pengaturan → Aturan approval** (daftar koleksi grup **Keuangan**). Aturan berlaku **per PT** (kolom **PT**). Setiap
perubahan wajib alasan dan hanya berlaku untuk pengajuan **baru** (yang sudah diajukan memakai snapshot aturan lama
sampai selesai).

**Aturan standar sejak 10 Okt 2026 (keputusan owner, ADR 0021):** pengajuan biaya disetujui **PM project** lalu
**Direktur**; Finance hanya mentransfer.

| Isian | Nilai |
|---|---|
| Nama aturan | Default — PM project lalu Direktur (semua nominal) |
| Dokumen | Pengajuan biaya |
| Diketahui Oleh | **Wajib** |
| Pengisi "Diketahui Oleh" | **PM project** (pembayaran vendor / antar-PT tanpa project: langsung Direktur, ADR 0031) |
| Level approval | **1 = Direktur** (tidak ada level Finance) |

- **PM project** = isian **Project Manager** di data project; untuk pengajuan pusat biaya = **Penanggung jawab
  (manajer)** pusat biaya. Orang itu harus pengguna aktif di PT pengajuan. Project tanpa PM → pengajuan tidak bisa
  dikirim ("Project ini belum punya PM. Hubungi Admin untuk mengisi PM project."). **Isi PM di setiap project aktif
  (Proyek → Project) dan manajer di setiap pusat biaya** sebelum aturan diubah.
- "PM project" hanya untuk **pengajuan biaya** dengan Diketahui **Wajib**. Aturan **Addendum RAB** tetap **Direktur
  (Diketahui) → Finance (Level 1)** dan tidak diubah; sistem menolak "PM project" pada aturan Addendum RAB. Level
  approval hanya boleh Direktur/Finance (peran atau user bernama di PT itu).
- G1 tetap berlaku: PM yang menjadi pemohon/pembuat dilewati (Direktur yang memutuskan).

**Sejak 11 Okt 2026 (keputusan owner, ADR 0024) aturan dapat dikonfigurasi per peran pemohon:**

- Isian **Peran pemohon** (Direktur, Project Manager, Staff lapangan, Finance, Admin; kosong = semua): aturan hanya
  berlaku bila **setiap** pemohon memegang salah satu peran itu di PT pengajuan. Aturan dipilih dari aturan aktif yang
  cocok dengan **Prioritas** terkecil (angka kecil dulu); bila sama, yang paling spesifik.
- **Tanpa level approval** ("Tanpa persetujuan — langsung ke antrian transfer Finance") hanya boleh bila Peran pemohon =
  **Direktur saja** dan Diketahui Oleh = **Tidak dipakai**; selain itu sistem (dan database) menolak menyimpan.
  Kotak **Penjelasan aturan** di formulir menunjukkan contoh alurnya, mis. "Contoh: pengajuan oleh Direktur → langsung
  ke Finance".
- Aturan **"Pengajuan Direktur"** (Peran pemohon = Direktur, tanpa level, Prioritas 10) dibuat otomatis oleh migrasi di
  setiap PT yang masih memakai aturan default (PT yang aturannya sudah diubah dicatat di log migrasi — buat aturannya
  sendiri bila owner menghendaki). Akibatnya: pengajuan Direktur sendiri langsung ke antrian transfer Finance (tercatat
  `approval_policy_exception`, panel, PDF, laporan). Pengajuan Direktur hanya boleh dibuat dan dikirim oleh Direktur
  itu sendiri; PM/Admin/Finance atas namanya ditolak.
- Setiap perubahan aturan wajib alasan dan tercatat di Audit Log; hanya berlaku untuk pengajuan baru.

**Sejak 13 Okt 2026 (keputusan owner, ADR 0026): level Owner di atas Direktur.**

- Peran baru **Owner** (kode `pk-principal`; "Direktur" tetap kode `pk-owner`). Owner melihat dan boleh melakukan semua
  yang boleh Direktur (dashboard, daftar, kas, laporan) di PT tempat ia memegang peran Owner; bedanya hanya di alur
  persetujuan. Centang **Owner** untuk orangnya di **setiap PT** (Pengguna → Akses & Peran, atau matriks Akses PT).
  **Hanya Admin grup** yang dapat memberi atau mencabut peran Owner (keputusan owner 14 Okt 2026); Admin PT tidak
  melihat pilihan Owner (bila sudah dipegang: tampil tetapi terkunci), dan server menolak ("Peran Owner hanya dapat
  diberikan atau dicabut oleh Admin grup."). Admin PT tetap boleh mengubah peran lain orang tersebut.
- Alur pengajuan biaya: **Staff → PM project → Direktur → Owner → Finance (transfer)**. Migrasi menambahkan **level
  Owner tepat sesudah level Direktur** (tanpa level Direktur: sebelum level Finance pertama — aturan lama "Diketahui
  Direktur → Finance" menjadi Diketahui Direktur → level 1 Owner → level 2 Finance; tanpa keduanya: di akhir; level
  berikutnya dinomori ulang) pada setiap aturan pengajuan biaya yang aktif (nama aturan tidak diubah) dan pada "Pengajuan
  Direktur", serta membuat aturan **"Pengajuan Owner"** (Peran pemohon = Owner, tanpa level, Prioritas 5) di setiap PT.
  Aturan tidak aktif lain tidak diubah — tambahkan level Owner sendiri bila diaktifkan lagi.
- **Tanpa level approval** sekarang hanya boleh untuk Peran pemohon = **Owner saja** (bukan Direktur lagi). Pengajuan
  Owner sendiri langsung ke antrian transfer Finance ("Tanpa persetujuan — pengajuan Owner (kebijakan PT)", tercatat).
- Level Owner **tidak pernah dilewati diam-diam**: bila satu-satunya Owner PT adalah pemohon/pembuat pengajuan dengan
  level Owner (mis. Owner membuat pengajuan untuk orang lain), pengiriman ditolak dengan pesan. Bila belum ada Owner
  aktif di PT, pengiriman ditolak "Tidak ada pengguna aktif untuk posisi Approval level n (peran Owner)".
- **Addendum RAB** dan **pinjaman antar project** tetap hanya Direktur; aturan Addendum RAB tidak boleh berisi Owner.
- Pengajuan yang sudah diajukan sebelum perubahan tetap memakai snapshot lama (Direktur = keputusan terakhir).

### 4a. Mengubah aturan setelah deploy (sekali, setiap PT: DRMS, LAS, TBK, CS1)

1. Pilih PT di tombol PT bar atas. Periksa **Proyek → Project**: setiap project aktif punya **Project Manager**; dan
   **Proyek → Data pendukung → Pusat biaya**: setiap pusat biaya punya **Penanggung jawab**.
2. **Pengaturan → Aturan approval** → buka **"Default — Direktur lalu Finance (semua nominal)"** (PT itu).
3. Ubah **Nama aturan** → `Default — PM project lalu Direktur (semua nominal)`.
4. **Diketahui Oleh** = **Wajib**; **Pengisi "Diketahui Oleh"** = **PM project (manajer pusat biaya bila tanpa
   project)**.
5. **Level approval**: ubah level 1 menjadi **Peran approver = Direktur**; hapus level Finance (tinggal satu level).
6. **Alasan perubahan**: `Kebijakan owner 2026-10-10: Staff → PM → Direktur → Finance transfer` → **Simpan**.
7. Aturan contoh **"> Rp 10 juta"** (tidak aktif): ubah dengan cara yang sama agar konsisten (biarkan tidak aktif).
8. Aturan **Addendum RAB**: **jangan diubah**.
9. Uji: Staff mengirim satu pengajuan kecil → statusnya **Menunggu persetujuan PM**.

Pengajuan yang sudah diajukan sebelum langkah ini tetap diputuskan Direktur lalu Finance (snapshot lama). Direktur cuti:
buat/ubah aturan sementara dengan level 1 = Direktur pengganti (user bernama), lalu kembalikan.

### 4b. Pembayaran vendor (DRMS 13/10, ADR 0027)

- Aturan approval punya syarat baru **Jenis penerima** (*Semua* / *Karyawan* / *Vendor*). Semua aturan lama =
  *Semua* (tidak berubah).
- Setiap PT mendapat aturan **"Pembayaran vendor oleh Finance — Direktur lalu Owner"** (Jenis penerima *Vendor*, Peran
  pemohon *Finance*, Diketahui *Tidak dipakai*, level 1 *Direktur*, level 2 *Owner*, prioritas 20). Pembayaran vendor oleh
  PM memakai aturan default PT (PM project → Direktur → Owner; langkah PM dilewati karena ia PM project-nya).
- Pembayaran vendor bisa diajukan Finance, PM dan — sejak permintaan owner 16 Okt 2026 — **Staff** (alur Staff biasa:
  aturan default PT, PM project → Direktur → Owner). Admin / Direktur / Owner tidak. Staff hanya **melihat** vendor dan
  rekening vendor PT-nya (untuk memilih); membuat / mengubahnya tetap Admin / Finance.
- Menonaktifkan aturan vendor (dengan alasan) → pembayaran vendor oleh Finance mengikuti aturan default.

### 4c. Pembayaran antar-PT (DRMS 13/10 Phase B, ADR 0028)

- **Jenis penerima** aturan approval punya nilai baru *PT grup*. Setiap PT mendapat aturan **"Pembayaran antar-PT oleh
  Finance — Direktur lalu Owner"** (Jenis penerima *PT grup*, Peran pemohon *Finance*, Diketahui *Tidak dipakai*,
  level 1 *Direktur*, level 2 *Owner*, prioritas 20) dan sumber kas masuk sistem **Antar PT** (kode `ANTAR-PT`) —
  jangan dihapus / dinonaktifkan (kas masuk otomatis memakainya).
- Pembayaran antar-PT hanya bisa diajukan Finance, PM atau Direktur PT pembayar. Admin / Staff / Owner (tanpa salah satu
  peran itu) tidak.
- **Master Data → Akun kas/bank → Rekening penerimaan antar-PT**: centang di satu rekening bank aktif per PT (bank,
  nomor, atas nama wajib terisi; alasan wajib). Kolom daftar menampilkan *Penerimaan antar-PT*. Menonaktifkan rekening
  itu melepas tandanya — PT itu tidak lagi bisa dipilih sebagai PT penerima sampai rekening lain ditandai.
- Notifikasi PT penerima: event `cash.intercompany_received` / `cash.intercompany_reversed` (teks dapat diubah di
  Template notifikasi; placeholder `{entryNo}` `{source}` `{amount}` `{account}` `{reversalNo}`).

### 4d. Cek dana & pinjaman antar-PT (DRMS 13/10 Phase C, ADR 0029)

- **Perusahaan (PT) → tab Operasional → "Cek dana saat persetujuan"** (default **mati**). Hanya **Admin grup**,
  alasan wajib (tercatat di Audit Log). Nyalakan per PT **setelah** Finance memastikan saldo semua akun non-site cocok
  dengan rekening koran (saldo awal, semua kas masuk tercatat), mis. alasan "saldo cocok dengan rekening koran per
  <tanggal>". Mematikan = blokir hilang seketika (panel tetap tampil sebagai informasi).
- Akun kas yang ditandai **site** tidak dihitung sebagai dana PT. Bila rekening cabang harus dihitung, hapus tanda
  site-nya.
- Setiap PT yang bisa meminjamkan / meminjam perlu **Rekening penerimaan antar-PT** (§4c).
- Penomoran baru **Pinjaman antar-PT** `PJA/{COMPANY}/{YY}{MM}/{seq}` (PT pemberi), dibuat otomatis per PT.
- Pengingat harian **"Pinjaman antar-PT terlambat"** per PT peminjam (tab Pengingat & notifikasi, default aktif).
- Teks notifikasi baru dapat diubah di Template notifikasi: `expense.fund_shortfall` (placeholder `{company}` `{docNo}`
  `{needed}` `{available}` `{gap}`), `icloan.instructed`, `icloan.lender_insufficient`, `icloan.disbursed`,
  `icloan.disbursement_voided`, `icloan.repaid`, `icloan.cancelled`, `icloan.overdue` (placeholder `{docNo}` `{lender}`
  `{borrower}` `{amount}` `{dueDate}` `{outstanding}`, plus `{available}` `{payment}` `{days}` `{requests}`).

## 5. Penomoran dokumen

**Pengaturan → Penomoran dokumen**: pola nomor **per PT** dan per jenis dokumen (PB pengajuan, TRF, LPJ, KM, KK, LP,
ADD, SV, LH), token `{seq}` `{DD}` `{MM_ROMAN}` `{YY}` `{MM}` `{YYYY}` `{COMPANY}` dll., **Reset nomor**, **Nomor awal**.
- Sejak 12 Okt 2026 (keputusan D5) **semua** nomor memuat kode PT: pola default `<KODE>/{COMPANY}/{YY}{MM}/{seq}` 4 digit,
  mis. `PB/DRMS/2610/0001`, `TRF/LLAS/2610/0001`. Nomor yang sudah terbit tidak berubah. Pola yang pernah Anda ubah
  sendiri tidak diubah migrasi — periksa dan sesuaikan bila perlu.
- Tiap PT punya nomor urut sendiri. `{COMPANY}` = **Kode singkat** PT dokumen (wajib diisi; terkunci setelah PT punya
  dokumen bernomor). Sejak keputusan owner 11 Okt 2026 **semua** jenis termasuk PB di-reset **tiap bulan mulai 0001 per
  PT** (mis. `PB/DRMS/2611/0001`, `PB/LAS/2611/0001`). Bulan saat perubahan berlaku melanjutkan setelah nomor PB tertinggi
  yang sudah terbit di bulan itu (tidak ada nomor ganda).
- `nomor_pb_mulai` pada impor (sheet **Perusahaan** / **Pengaturan**) hanya menentukan nomor PB pertama di **bulan
  go-live** (bawaan 1).
- Ubah hanya bila diminta Finance/Direktur; alasan wajib.
- PT baru mendapat penomoran dan aturan approval standar secara otomatis: lewat **impor**, atau saat dibuat di layar
  **Perusahaan (PT)** dengan **Salin default saat dibuat** tercentang (bawaan; disalin dari DRMS atau dari PT di
  **Salin dari PT**). Penomoran PT baru mulai dari 1. Aturan yang menunjuk project/kategori/pusat biaya/pengguna
  tertentu tidak ikut disalin — periksa **Penomoran dokumen** dan **Aturan approval** PT itu sebelum dipakai.

## 6. Perusahaan (PT) dan Setting aplikasi

### 6a. Perusahaan (PT) — per PT

**Pengaturan → Perusahaan (PT)**: satu baris per PT (kolom Kode · Nama · Zona waktu · Anggota · Aktif · Dibuat).
Admin/Direktur PT itu boleh mengubah; **membuat** dan **menonaktifkan** PT hanya **Admin grup** (alasan wajib).

- **Buat PT baru (Admin grup):** tombol buat baru → tab **Identitas**: **Kode singkat** (2–16 huruf besar/angka,
  dipakai di nomor dokumen; terkunci setelah PT punya dokumen bernomor), **Nama perusahaan**, Nama legal, **Logo**
  (untuk kop PDF dan ekspor PT ini), **Kop PDF**, Alamat, Telepon, **Zona waktu** (harus sama dengan zona waktu
  server). Biarkan **Salin default saat dibuat** tercentang agar penomoran, aturan approval, jadwal kerja dan setting
  standar ikut disalin (dari DRMS, atau dari PT di **Salin dari PT**). Lalu periksa tab lain, penomoran dan aturan
  approval (§5), dan akses PT (§1).

Hal penting per PT yang harus Anda atur sebelum go-live:

| Tab | Setting | Nilai |
|---|---|---|
| Absensi & retensi | **Absensi dari APK (termasuk offline) aktif** | Nyalakan (default mati) |
| Operasional | **Laporan progress dari APK (termasuk offline) aktif** | Nyala |
| Absensi & retensi | **Retensi selfie absensi (bulan)** | **6** (keputusan owner 2026-10-05, Q-33; sama dengan pemberitahuan privasi). PT yang masih bernilai default lama 12 sudah diubah otomatis ke 6 (tercatat di Audit Log); nilai yang pernah diubah sengaja tidak disentuh — periksa. Nilai lain dari 6 = pemberitahuan privasi harus diperbarui |
| Absensi & retensi | **Hapus otomatis selfie melewati retensi (aktif)** | **Keputusan owner/Direktur** — default mati (job hanya menghitung). Bila dinyalakan, selfie lebih tua dari retensi dihapus permanen setiap malam (02.30), tercatat di audit log |
| Operasional | **Toleransi pembulatan nota per baris (Rp)** | 1.000 |
| Operasional | **Radius geofence default (m)** | 100 — dipakai untuk lokasi yang punya titik tetapi radiusnya kosong |
| Pengingat & notifikasi | **Pengingat terjadwal**: Pengingat aktif, Jam kirim, batas hari, ambang anggaran, Juga kirim email | Sesuai kesepakatan |
| Pengingat & notifikasi | **Notifikasi status pengajuan → Beri tahu pemohon saat diajukan, ditarik, atau dibuat atas namanya** | Nyala (default) |
| Pengingat & notifikasi | **Notifikasi status pengajuan → Email ke Direktur/Finance saat pengajuan menunggu keputusannya** | Default mati; nyalakan setelah alamat email pengguna benar. Batas SMTP 30 email/jam |
| Identitas | Nama, Kode singkat, Logo, Kop PDF | Data perusahaan |

#### Tab "Direktur definitif" (tanda tangan Direktur PT, ADR 0025)

Untuk PT yang Direktur sahnya **tidak memakai aplikasi** dan keputusan Direktur diambil oleh pengguna lain atas
namanya. Hanya **Admin PT itu** (dan Admin grup) yang dapat mengubah tab ini; Direktur dan Finance PT hanya melihat.

1. **Pengaturan → Perusahaan (PT)** → buka PT → tab **Direktur definitif**.
2. Isi **Nama Direktur** dan **Jabatan** (mis. Direktur Utama).
3. **Tanda tangan**: unggah **file PNG baru** (latar transparan, maks. 800 × 300 px) — jangan memilih tanda tangan
   profil pengguna (ditolak). File ini hanya dapat dilihat Admin, Direktur dan Finance PT ini.
4. **Wakil penanda tangan**: pilih pengguna yang memegang peran **Direktur** di PT ini dan boleh memutuskan atas nama
   Direktur definitif (peran Direktur diberikan dulu di Akses PT, §1). → **Simpan**.

Akibatnya: bila salah satu wakil memutuskan **langkah Direktur** (Persetujuan Direktur pengajuan, Diketahui Direktur
pada alur lama dan Addendum RAB, persetujuan kekurangan LPJ, pinjaman antar project — setuju maupun tolak), PDF
mencetak **tanda tangan dan nama (jabatan) Direktur definitif**, dan alur persetujuan, Log perubahan / Riwayat,
aplikasi dan laporan menampilkan nama Direktur tersebut. Siapa yang sebenarnya menekan tombol tetap tersimpan di
database dan di **Audit Log** (kolom user id) untuk penelusuran. Wakil yang memutuskan langkah lain (mis. sebagai PM
project atau Finance) tetap memakai tanda tangan pribadinya; Direktur lain yang bukan wakil juga. Mengubah data tab ini
tidak mengubah dokumen yang sudah ditandatangani (nama, jabatan dan tanda tangan disimpan saat keputusan). Kosongkan
semua isian tab ini untuk kembali ke tanda tangan pribadi.

![TODO screenshot: Perusahaan (PT) tab Absensi & retensi](img/admin-setting.png)

### 6b. Setting aplikasi — seluruh grup (Admin grup saja)

**Pengaturan → Setting aplikasi**: berlaku untuk semua PT.

| Setting | Nilai |
|---|---|
| **Versi APK minimum / terbaru, URL unduh APK** | Isi saat rilis APK baru (minimum yang terlalu tinggi mengunci semua HP). Minimum **≥ 0.3.3** = absensi tanpa persetujuan pemberitahuan privasi ditolak server (§1) |
| **Target resize foto di perangkat → Nota** | 1600 px (spesifikasi §9) |
| **Nama grup (kop laporan konsolidasi)**, **Logo grup**, **Kop PDF grup** | Kop laporan/ekspor yang memuat lebih dari satu PT |
| Maks. selfie dihapus per malam, Umur maksimal sesi offline APK (hari) | Biarkan default kecuali diminta tim teknis |

## 7. Absensi

- **Absensi → Jadwal & hari libur:** jadwal default (08.00–17.00, toleransi 15 menit, Senin–Sabtu), jadwal per
  karyawan, **hari libur**, dan **Geofence pusat biaya** (Latitude, Longitude, Radius, tombol **Cek di peta ↗**).
  Hari libur: **+ Tambah hari libur** di kartu itu; **Ubah** pada baris membuka isian yang sama di tempat yang sama
  (tanggal, keterangan, lalu **Alasan perubahan** wajib) → **Simpan perubahan** / **Batal** (sejak 17 Okt 2026; Direktur
  juga boleh mengubah).
  Jadwal kerja default diatur per PT (**Perusahaan (PT) → Operasional → Jadwal kerja default**).
- Titik & radius **project** diisi di **Proyek → Project**. Lokasi tanpa titik tidak bisa dipakai absen; titik tanpa
  radius memakai **Radius geofence default** PT itu. Server menambah toleransi akurasi GPS HP (maks. 50 m) ke radius.
- **Tipe absensi karyawan** (DRMS 13/10 A2): di **Karyawan** (atau **Pengguna → tab Data Karyawan**) isi **Tipe
  absensi**:
  - **Karyawan OnSite** (default semua karyawan): boleh absen di **semua lokasi terdaftar PT** yang punya titik —
    kantor pusat, kantor cabang (site), project, pusat biaya — **tanpa penugasan** (Team Assignment tidak perlu).
  - **Karyawan Non-OnSite** (staf kantor): **tidak dibatasi lokasi** — boleh absen di site mana pun dan juga di luar
    lokasi terdaftar (tanpa cek radius, tanpa penugasan). Bila posisinya di dalam lokasi terdaftar, absen dicatat di
    lokasi itu; bila tidak, dicatat **"Di luar area"** dengan acuan **site penempatan** karyawan (bila kosong:
    **kantor pusat**) dan jaraknya. Absen pulang menutup absen masuk hari itu. GPS tetap wajib, lokasi palsu tetap
    ditolak. Tanpa site penempatan dan tanpa kantor pusat, absen di luar area ditolak — isi salah satunya.
  - **"Di luar area"** terlihat di Rekap absensi (tanda **Di luar area**), di **Laporan Absensi** (kolom Lokasi
    *Di luar area (ref. …)* dan Keterangan) dan di daftar **Absensi** (kolom/filter **Di luar area**).
  - Daftar Karyawan bisa difilter per **Tipe absensi**.
- **Kantor pusat:** di **Master Data → Site** centang **Kantor pusat** pada site kantor pusat PT (maksimal **1 per
  PT**; untuk memindahkan, hapus centang di site lama dulu) dan isi **titik + radius**. Kantor pusat menjadi acuan
  "Di luar area" untuk karyawan Non-OnSite yang belum punya site penempatan.
- APK dan web **mengenali area otomatis**: lokasi yang geofence-nya memuat posisi GPS karyawan langsung terpilih;
  bila beberapa area bertumpuk, karyawan memilih salah satu; di luar semua area, karyawan OnSite memilih manual
  (server tetap menolak bila di luar radius), karyawan Non-OnSite otomatis memakai pilihan **"Di luar area"**. Lokasi baru/titik baru terbaca di APK setelah sinkron berikutnya (maks. ±15
  menit saat online).
- Bila lebih dari satu PT tampil, halaman absensi punya pilihan **PT** (mis. **Semua PT (DRMS, CS1)**) dan nama lokasi
  diberi awalan `[KODE PT]`.
- **Laporan → Laporan Absensi**: Admin bisa melihat dan mengunduh (CSV/Excel) untuk semua karyawan PT tempat ia Admin.
- **Koreksi jam** karyawan: **Absensi → Rekap bulanan** → **Koreksi jam masuk/pulang** + alasan.
- Mengabsenkan karyawan tanpa HP hanya bisa oleh PM dari APK.

## 8. Pengajuan atas nama karyawan

**+ Buat pengajuan** → **PT** (paling atas, bila Anda mencentang lebih dari satu PT) → **Diajukan Oleh** = karyawan PT
itu → rekening milik karyawan itu → isi baris (& nota untuk Reimburse) → **Kirim pengajuan**. Anda tercatat sebagai
"Dibuat Oleh". Daftar **Rekening tujuan** hanya berisi rekening pemohon; bila dikosongkan, dipakai rekening default
pemohon pertama. Karyawan yang punya akun menerima notifikasi "Pengajuan atas nama Anda" (dan saat diajukan/ditarik);
karyawan tanpa akun tetap diberi tahu langsung.

## 9. Tutup buku per PT

Tutup buku dilakukan **Finance/Direktur**, bukan Admin. Tutup buku berlaku **per PT**: menutup satu PT tidak mengunci
PT lain; satu layar **Tutup buku** = satu PT. Lihat [panduan Finance](finance.md) §6 dan
[runbook tutup buku](../runbooks/tutup-buku.md).

## 10. Impor data go-live per PT

Impor dijalankan oleh tim teknis (Lead) dari file Excel; Admin membantu mengisi dan memeriksa isinya. Untuk beberapa
PT: sheet **Perusahaan** (satu baris per PT: `kode_pt`, nama, nama legal, alamat, telepon, `nomor_pb_mulai`), kolom
**`kode_pt`** di kolom pertama sheet data per PT (Kategori, Karyawan, Pengguna, Rekening, PusatBiaya, Project, Tahapan,
RAB, Kendaraan, Penugasan, AkunKas), dan sheet **AksesPT** untuk akses satu pengguna di PT lain. Langkah lengkap:
[runbook impor data go-live](../runbooks/import-data-golive.md) §4.1.

File impor tidak memuat RAP. Setiap project ber-RAB wajib punya RAP sebelum pengajuannya bisa dikirim (keputusan
pemilik 11 Okt 2026): laporan impor memberi **PERINGATAN** per project ber-RAB yang belum punya RAP. Setelah impor,
PM / Direktur mengisi RAP di menu **Proyek → RAP proyek** (form per item, template atau upload Excel RAP; saring
**RAP: Belum ada (wajib)**) atau di tab **RAP** project.

## 11. Audit Log

**Audit Log** (atau **Sistem → Audit Log**): filter tanggal, user, jenis dokumen, aksi → unduh (maks. 31 hari).
Baris audit menyimpan PT dokumennya.

## 12. Aturan cakupan PT (keputusan pemilik 2026-10-02)

Setiap pengguna hanya melihat dan mencari data PT tempat ia **terdaftar** (punya akses PT aktif di matriks akses).
Terdaftar di 1 PT → hanya data PT itu; terdaftar di 2 PT atau lebih → data gabungan PT-PT itu saja, tidak pernah PT
lain. Membuat, menyetujui dan membayar tetap selalu di satu PT. Akibatnya: cek **nota ganda** hanya membandingkan
dengan pengajuan di PT tempat pengunggah nota terdaftar, dan flag nota ganda yang menunjuk pengajuan PT lain (beserta
nomornya) hanya tampil bagi pengguna yang juga terdaftar di PT itu — pengguna lain tidak melihat flag itu sama
sekali; file dan logo sebuah PT hanya untuk anggota PT itu, dan file PT yang dinonaktifkan tidak terbuka bagi pengguna
PT lain. Admin grup tetap memegang wewenangnya (membuat/menonaktifkan PT, setting aplikasi, akses semua pengguna, audit
log tanpa PT).

## Pusat biaya = akun kas (sejak 21 Okt 2026, ADR 0031)

- Master **Pusat biaya** lama disembunyikan (data lama tetap). Pusat biaya sekarang = **akun kas/bank PT**.
- Saat membuat project (Direktur / Admin / PM) wajib memilih **Pusat biaya (akun kas)**. PM hanya melihat nama akun
  aktif PT-nya (tanpa nomor rekening dan saldo).
- Kartu dashboard Admin **Project tanpa pusat biaya**: project aktif yang belum dipetakan — transfer pengajuannya
  ditolak sampai dipetakan.
- Kendaraan: *Pusat biaya default (akun kas)* menggantikan pusat biaya lama.
