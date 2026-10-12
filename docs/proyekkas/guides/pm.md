# Panduan Project Manager (PM)

Sebagai PM Anda: **menyetujui pengajuan biaya** pada project yang Anda pegang (langkah pertama, sebelum Direktur —
berlaku sejak 10 Okt 2026, ADR 0021), **memantau** pengajuan tim, membuat **laporan progress harian**, mengurus
**absensi tim**, mengelola **penugasan tim**, dan mengajukan **addendum RAB**.
Anda juga bisa mengajukan dana untuk diri sendiri (lihat [panduan Staff](staff.md) §2–4). Baca juga
[Hal umum](README.md#hal-umum-untuk-semua-peran).

![TODO screenshot: Beranda APK PM dengan Pantauan tim](img/pm-beranda.png)

## 1. Menyetujui pengajuan (Persetujuan PM)

Alur pengajuan biaya baru: **Staff mengajukan → Anda (PM project) → Direktur → Finance mentransfer**. Finance tidak
lagi menyetujui. Yang masuk ke Anda hanya pengajuan pada project di mana Anda tercatat sebagai **PM** di data project
(untuk pengajuan pusat biaya: bila Anda **manajer** pusat biaya itu). Status pengajuan: **Menunggu persetujuan PM**.

**Di HP (APK 0.4.1):**
1. Beranda → **Menunggu Persetujuan**. Kartu bertanda **"Persetujuan PM"**: total, **Dampak anggaran**, jumlah flag.
2. Buka → periksa baris, nota, flag → **Setujui sebagai PM project** → pilih **Pakai tanda tangan profil** atau
   **Tanda tangan di layar** → **Konfirmasi**. Pengajuan diteruskan ke Direktur.
3. Atau **Tolak** dengan alasan (minimal 3 karakter). Pemohon diberi tahu "Ditolak: …" beserta alasannya.

**Di web:** **Persetujuan** → buka **Rincian baris, nota & flag** → **Setujui** (konfirmasi "Setujui … sebagai PM
project?") / **Tolak** (alasan wajib). Tanda tangan profil dipakai otomatis — unggah dulu di **Profil & tanda
tangan**. Beranda PM juga punya kartu **Menunggu tindakan saya**.

- **Notifikasi:** "Persetujuan PM: {nomor}" (lonceng; email bila Admin menyalakan email persetujuan). Untuk pengajuan
  yang menunggu Anda, notifikasi "Pengajuan tim: …" tidak dikirim lagi (sudah diwakili notifikasi persetujuan).
- **Pengajuan Anda sendiri** (Anda pemohon) atau pengajuan yang **Anda buat untuk Staff**: langkah PM dilewati
  otomatis dan tercatat "(tidak berlaku — pemohon)"; Direktur yang memutuskan.
- **Pengajuan untuk Direktur:** sejak 11 Okt 2026 (keputusan owner, ADR 0024) Anda **tidak lagi** membuatnya atas nama
  Direktur (sistem menolak; APK tidak menawarkan Direktur sebagai pemohon). Direktur mengajukan sendiri dan pengajuannya
  langsung ke antrian transfer Finance tanpa persetujuan; Anda menerima notifikasi "Pengajuan Direktur: …" bila
  pengajuan itu di project Anda. Pengajuan yang dulu Anda buat untuk Direktur tetap Anda setujui seperti biasa.
- **Kekurangan LPJ** di atas nominal disetujui + toleransi: persetujuan ulang juga lewat Anda dulu, lalu Direktur —
  di **web → Persetujuan → Kekurangan LPJ di atas nominal disetujui**.
- PM lain (termasuk PM penugasan tim yang bukan PM di data project) tidak bisa memutuskan: sistem menolak dan
  mencatatnya. Pengajuan yang diajukan **sebelum** aturan baru berlaku tetap diputuskan Direktur lalu Finance.
- Addendum RAB tidak berubah (Direktur lalu Finance).

## 1a. Memantau pengajuan tim

- **APK:** tab **Pengajuan** → **Tim**. Buka untuk melihat status dan **Giliran** (PM, Direktur atau Finance).
  Tombol Setujui/Tolak hanya muncul bila giliran Anda sebagai PM project.
- **Web:** Beranda → kartu **Pengajuan tim menunggu keputusan** (jumlah yang menunggu **PM**, **Direktur** dan
  **Finance**, umur tertua) dan tabel di bawahnya (nomor, pemohon, project, **Menunggu** PM/Direktur/Finance, lama
  dalam hari, terlama dulu). Juga kartu pengajuan tim bulan ini, LPJ tim, realisasi anggaran, dan menu **Keuangan → Pengajuan
  biaya**. Buka pengajuan untuk melihat baris, foto nota, dan flag per baris (bagian **Rincian untuk pemeriksa**).
- **Notifikasi (lonceng, sejak 8 Okt 2026):** untuk pengajuan pada **project** yang Anda pegang (PM project atau
  penugasan tim sebagai PM) Anda diberi tahu saat pengajuan **diajukan** ("Pengajuan tim: …"), **ditolak**,
  **ditransfer**, **LPJ perlu revisi**, dan **selesai**. Hanya bila Anda berperan PM di PT pengajuan itu; pengajuan
  pada pusat biaya tidak dikirim ke PM. Pengajuan Anda sendiri tetap memakai notifikasi pemohon.
- **Mengajukan untuk orang lain:** PM boleh mencantumkan rekan sebagai pemohon tambahan (nama Anda tetap ada).
  Staff hanya bisa mengajukan untuk dirinya sendiri.
- Anda hanya melihat project/pusat biaya yang Anda pegang.
- **PM di lebih dari satu PT:** peran PM berlaku per PT. Daftar mengikuti pilihan PT (web: tombol PT di bar atas;
  APK: tombol PT di Beranda — lihat [Hal umum](README.md#hal-umum-untuk-semua-peran)); bila lebih dari satu PT tampil,
  tiap baris diberi kode PT.

## 2. Laporan progress harian (APK)

1. Beranda → **Laporan progress** → tab **Laporan** → **Laporan baru**.
2. Pilih **project** dan **tahapan**. Tertulis "Sebelum laporan: X%".
3. Isi **% tahapan** (tidak boleh turun), **Pekerjaan**, **Kendala**.
4. Tambah **foto** dengan kamera belakang (maksimal 5).
5. **Simpan & kirim**. Tanpa sinyal: tersimpan di HP dan terkirim otomatis.

![TODO screenshot: form Laporan baru dengan penggeser % dan foto](img/pm-laporan.png)

- Progress project dihitung otomatis: bobot tahapan × %. Contoh: tahapan bobot 30% naik 10 → project naik 3 poin.
- Salah isi? Buka laporan → **Edit laporan (≤ 24 jam)** → isi alasan. Setelah 24 jam tidak bisa diedit.
- "Progress tidak boleh turun…": perbaiki lewat edit laporan terakhir tahapan itu.
- Laporan ditolak karena bobot tahapan belum 100%: atur bobot di web (§4).
- **Konflik** (laporan juga diedit di web): pilih **Kirim versi HP (dengan alasan)** atau **Pakai versi server**.
- Laporan hanya dibuat dari APK. Di web Anda bisa membaca semua laporan tim (**Laporan progress**).
- Laporan progress otomatis masuk ke PT project yang dipilih — tidak perlu memilih PT.

**Progress vs anggaran:** Laporan progress → tab **Project**, atau web **Progress project**. Hijau = sesuai;
kuning = perlu perhatian; merah = anggaran terpakai mendahului progress lebih dari 8 poin.

## 3. Absensi tim

- **Tim hari ini:** APK Absensi → tab **Tim** (atau web **Absensi → Tim hari ini**): Belum absen / Hadir / Selesai.
- **Mengabsenkan anggota tanpa HP (APK saja):** Tim → **Absenkan anggota tim** → pilih karyawan dan lokasi →
  isi **alasan** → foto karyawan dengan kamera **belakang**. Tercatat "Oleh PM". Anda tidak bisa mengabsenkan diri
  sendiri.
- **Pemberitahuan privasi (APK 0.3.3+):** absen sendiri **dan** mengabsenkan anggota terkunci sampai **Anda** menekan
  **Saya mengerti** pada pemberitahuan privasi (layar penuh setelah masuk, atau **Profil → Pemberitahuan privasi**).
  Minta anggota tim tanpa HP membaca halaman **`/privasi`** (atau tunjukkan dari HP Anda) sebelum Anda mengabsenkannya.
- **Koreksi jam:** APK Tim → ketuk jam **Masuk/Pulang** anggota, atau web **Absensi → Rekap bulanan → Koreksi jam
  masuk/pulang**. **Alasan wajib**; jam lama dan baru tercatat. Koreksi butuh internet.

![TODO screenshot: tab Tim dengan tombol Absenkan dan koreksi jam](img/pm-tim.png)

## 4. Project, tahapan, penugasan (web)

- **Data project** (nama, alamat, RAB, status, titik lokasi) **hanya bisa dibaca** oleh PM (keputusan pemilik
  2026-10-08); perubahan diminta ke Direktur. RAB berubah lewat **Addendum RAB**, progress lewat laporan progress.
- **Tahapan:** **Progress project** → pilih project → **Editor tahapan**. PM boleh mengubah **nama, urutan, bobot**
  (total harus 100%, alasan wajib saat bobot berubah). Menambah/menonaktifkan tahapan dan membuat project: Direktur.
- **Penugasan tim:** **Proyek → Penugasan tim** → tambah karyawan ke project/pusat biaya Anda (tanggal mulai).
  Karyawan pindah project: isi **Selesai** (tanggal + alasan) di penugasan lama, lalu buat penugasan baru.

## 5. Addendum RAB

1. APK **Addendum RAB → Addendum baru**, atau web **Addendum RAB → Ajukan addendum RAB**.
2. Pilih project, isi **Tambahan RAB** dan **Alasan** → **Ajukan** (web: **Ajukan ke Direktur**).
3. Status: **Menunggu Direktur** → **Menunggu Finance** → **Disetujui** (RAB project bertambah) atau **Ditolak**
   (alasan tampil).

Butuh internet. Hanya untuk project yang Anda pegang dan sudah punya RAB.

## 6. Laporan & pengingat

- Web **Laporan**: Anggaran Project, Pengeluaran per Kategori, Rekap Pengajuan, Kelengkapan Nota/LPJ, Biaya per
  Kendaraan, Laporan Absensi — untuk project tim Anda; unduh Excel/CSV/PDF. Bila Anda PM di beberapa PT, filter
  **PT** mempersempit laporan; lebih dari satu PT = kolom **PT** + tabel subtotal per PT.
- Pengingat otomatis (lonceng): project Anda belum ada laporan progress beberapa hari, atau anggaran melewati ambang.
  Di web, lonceng **Notifikasi** ada di bar atas, kanan (angka = belum dibaca).
