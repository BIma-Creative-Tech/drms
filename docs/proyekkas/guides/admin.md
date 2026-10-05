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
dicentang; bila lebih dari satu PT tampil, daftar punya kolom dan filter **PT**.

### Navigasi: layar modul (gaya Odoo)

Buka `/admin` → **layar modul**: kotak-kotak berwarna, satu per modul. Klik modul → menu modul tampil di **bar atas**
(bukan menu kiri). Menu dengan ▾ membuka daftar turunan. Tombol **⊞** di kiri bar kembali ke layar modul; di kanan
bar ada **tombol PT**, **lonceng Notifikasi** dan **menu akun** (inisial nama: Profil & tanda tangan, Keamanan akun,
Tema terang/gelap, Keluar). Di HP (layar sempit) menu modul dibuka dengan tombol **☰**. Modul hanya tampil bila Anda
punya akses ke minimal satu isinya; angka merah = jumlah yang menunggu tindakan.

Di halaman daftar dan formulir data, baris kecil di bawah bar menunjukkan **lokasi halaman**, mis.
**Keuangan › Pengajuan biaya › PB-2026-0001**: klik nama modul untuk ke menu pertamanya, klik nama daftar untuk
kembali ke daftar. Halaman khusus (Kas, Antrian Transfer, Laporan, dst.) tidak punya baris ini — judul halaman sudah
cukup. Di HP, tabel lebar bisa digeser ke samping di dalam kotaknya (bayangan di tepi = masih ada kolom); Antrian
Transfer tampil sebagai kartu per pengajuan.

| Modul | Isi menu |
|---|---|
| **Dashboard** | Ringkasan per peran (tab peran bila punya lebih dari satu), `/admin/dashboard` |
| **Persetujuan** | Persetujuan · Antrian Transfer · Verifikasi LPJ (Direktur/Finance) · Approval & tanda tangan |
| **Proyek** | Project · RAB per kategori · Tahapan ▾ (Tahapan project, Template tahapan) · Data pendukung ▾ (Klien, Pusat biaya, Penugasan tim) · Progress ▾ · Addendum ▾ |
| **Keuangan** | Pengajuan ▾ (Pengajuan biaya, + Buat pengajuan, Snapshot, Nota, Flag nota) · Kas ▾ · Transfer & LPJ ▾ · Tutup buku ▾ |
| **Absensi** | Tim hari ini · Rekap bulanan · Jadwal & hari libur · Absensi · Koreksi absensi · Konfigurasi ▾ (Jadwal kerja, Hari libur) |
| **Laporan** | Semua laporan (Admin: laporan absensi) |
| **Pengguna & Akses** | Akses PT (matriks) · Pengguna · Data akses PT · Karyawan · Rekening karyawan · Perangkat & sesi ▾ (Perangkat, Sesi web) |
| **Master Data** | Bank · Satuan · Kategori pengeluaran · Kendaraan · Vendor |
| **Media** | Foto nota · Bukti transfer · Selfie absensi · Foto progress · Tanda tangan · Logo perusahaan · Lampiran |
| **Pengaturan** | Perusahaan (PT) · Setting aplikasi · Aturan approval · Template notifikasi · Penomoran dokumen |
| **Sistem** | Audit Log · Data audit log · Notifikasi saya · Data notifikasi |

Tautan lama tetap berlaku (mis. `/admin/kas`, `/admin/collections/...`); hanya beranda `/admin` yang kini layar modul.

![TODO screenshot: layar modul Admin + bar menu modul Pengguna & Akses](img/admin-menu.png)

## 1. Pengguna, karyawan dan akses PT

Urutan: **Karyawan** → **Pengguna** → **akses PT** (peran + karyawan per PT).

1. **Karyawan:** **Pengguna & Akses → Karyawan** → buat baru → pilih **PT** (paling atas; wajib bila Anda mencentang
   lebih dari satu PT) → isi data. **1 data karyawan = 1 PT**; orang yang bekerja di 2 PT punya 2 data karyawan. PT
   karyawan tidak bisa diubah setelah dibuat. Lalu isi **Rekening karyawan** (untuk transfer).
2. **Pengguna (akun login):** **Pengguna & Akses → Pengguna** → buat baru (atau tombol **+ Undang pengguna** di
   matriks akses) → **Email**, **Nama**, **No. HP**, **Aktif** → Simpan. Akun login dibuat otomatis di sistem login
   DRMS. Satu orang = satu akun, walau bekerja di beberapa PT.
3. **Akses PT:** **Pengguna & Akses → Akses PT (matriks)** (halaman **Pengguna & akses PT**, `/admin/akses-pt`):
   baris = pengguna, kolom = PT.
   - Sel **bukan anggota** → **+ Tambah** → centang peran di PT itu (**Staff**, **PM**, **Fin**, **Dir**, **Adm**;
     boleh lebih dari satu) → pilih **Karyawan** PT itu (tanda ↗ membuka data karyawannya).
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

- **Karyawan keluar:** buka **Pengguna** → hilangkan centang **Aktif** + alasan. Sesi web, HP, dan login langsung
  dicabut (di semua PT). Langkah lengkap & pemeriksaan (Direktur/Finance/PM pengganti):
  [runbook cabut perangkat](../runbooks/cabut-perangkat.md) §B. Keluar dari **satu PT saja**: kosongkan perannya di
  kolom PT itu di matriks.
- Pastikan **setiap PT** selalu punya **minimal satu Direktur dan satu Finance aktif** selain pemohon, agar pengajuan
  bisa diputuskan.
- **Data akses PT** (`Pengguna & Akses → Data akses PT`) = daftar mentah isi matriks, untuk pencarian/pemeriksaan.
- **Pemberitahuan privasi (Q-46):** daftar **Pengguna** punya kolom **Privasi dibaca (versi/tanggal)**: `v1 · 05/10/26
  10.12` = sudah dibaca, **Belum** = belum pernah, `(terbaru vN)` = membaca versi lama. Hanya pengguna sendiri yang bisa
  mengisinya (tombol **Saya mengerti** di web/APK); di form pengguna kolomnya hanya-baca. Tiap konfirmasi tercatat di
  **Audit Log** (aksi `privacy_ack`). Teks pemberitahuan ada di halaman publik **`/privasi`**; isinya diubah tim teknis
  dari dokumen HR/legal (bukan dari panel). Pengguna yang belum membaca: absensi APK terkunci; di web tampil
  pemberitahuan yang harus dikonfirmasi sebelum memakai panel.

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
| **Master Data** | Bank, Satuan (dipakai bersama semua PT); Kategori pengeluaran (satuan wajar, perlu kendaraan), Kendaraan (nomor polisi unik di seluruh grup, contoh `DA 1234 XY`), Vendor — per PT |
| **Absensi → Konfigurasi** | Jadwal kerja (per PT), Hari libur (bersama) |
| **Proyek** | Project (dibuat Direktur), Pusat biaya, Klien, Template tahapan, Penugasan tim — per PT |
| **Keuangan → Kas** | Akun kas/bank (saldo awal), Sumber kas masuk — per PT |
| **Pengaturan** | Perusahaan (PT), Setting aplikasi, Aturan approval, Template notifikasi, Penomoran dokumen |
| **Pengguna & Akses** | Akses PT (matriks), Pengguna, Karyawan, Rekening karyawan, Perangkat |

- Master per PT punya kolom **PT** di atas formulir (wajib bila Anda mencentang lebih dari satu PT; tidak bisa diubah
  setelah dibuat). Kode yang sama boleh dipakai di dua PT, tetapi tidak dua kali dalam satu PT.
- Pilihan di formulir (project, pusat biaya, karyawan, rekening, jadwal) hanya berisi data **PT dokumen itu**.
- Data yang sudah dipakai tetap tampil di dokumen lama walau dinonaktifkan.

## 4. Aturan approval

**Pengaturan → Aturan approval**. Aturan berlaku **per PT** (kolom **PT**). Aturan standar (ADR 0013): **Diketahui
Oleh (persetujuan Direktur) = Wajib** oleh peran Direktur, lalu **Level 1 = Finance** — yang memutuskan adalah
Direktur/Finance **di PT pengajuan**. Sistem menolak PM/Staff sebagai pemberi keputusan dan menolak "Diketahui"
opsional. Setiap perubahan wajib alasan dan hanya berlaku untuk pengajuan **baru** (yang sudah diajukan memakai aturan
lama). Direktur cuti: buat/ubah aturan sementara dengan pengganti bernama, lalu kembalikan.

## 5. Penomoran dokumen

**Pengaturan → Penomoran dokumen**: pola nomor **per PT** dan per jenis dokumen (PB pengajuan, TRF, LPJ, KM, KK, LP,
ADD), token `{seq}` `{DD}` `{MM_ROMAN}` `{YYYY}` `{COMPANY}` dll., **Reset nomor**, **Nomor awal**.
- Tiap PT punya nomor urut sendiri. `{COMPANY}` = **Kode singkat** PT dokumen (mis. `229/PB-DRMS/…`,
  `1/PB-CS1/27/IX/2026`).
- Pengajuan DRMS di produksi dimulai dari **229** (melanjutkan nomor manual, Q-17). Nomor PB pertama PT lain diisi saat
  impor (sheet **Perusahaan**, kolom `nomor_pb_mulai`).
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

![TODO screenshot: Perusahaan (PT) tab Absensi & retensi](img/admin-setting.png)

### 6b. Setting aplikasi — seluruh grup (Admin grup saja)

**Pengaturan → Setting aplikasi**: berlaku untuk semua PT.

| Setting | Nilai |
|---|---|
| **Versi APK minimum / terbaru, URL unduh APK** | Isi saat rilis APK baru (minimum yang terlalu tinggi mengunci semua HP) |
| **Target resize foto di perangkat → Nota** | 1600 px (spesifikasi §9) |
| **Nama grup (kop laporan konsolidasi)**, **Logo grup**, **Kop PDF grup** | Kop laporan/ekspor yang memuat lebih dari satu PT |
| Maks. selfie dihapus per malam, Umur maksimal sesi offline APK (hari) | Biarkan default kecuali diminta tim teknis |

## 7. Absensi

- **Absensi → Jadwal & hari libur:** jadwal default (08.00–17.00, toleransi 15 menit, Senin–Sabtu), jadwal per
  karyawan, **hari libur**, dan **Geofence pusat biaya** (Latitude, Longitude, Radius, tombol **Cek di peta ↗**).
  Jadwal kerja default diatur per PT (**Perusahaan (PT) → Operasional → Jadwal kerja default**).
- Titik & radius **project** diisi di **Proyek → Project**. Lokasi tanpa titik tidak bisa dipakai absen; titik tanpa
  radius memakai **Radius geofence default** PT itu. Server menambah toleransi akurasi GPS HP (maks. 50 m) ke radius.
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
