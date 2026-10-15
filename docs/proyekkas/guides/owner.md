# Panduan Owner

Peran **Owner** (sejak 13 Okt 2026, keputusan owner, ADR 0026) adalah satu tingkat **di atas Direktur**. Owner
**melihat dan boleh melakukan semua yang boleh Direktur** (dashboard Direktur, daftar pengajuan, kas, laporan, project,
tutup buku) di setiap PT tempat Anda diberi peran Owner. Yang berbeda hanya **alur persetujuan pengajuan biaya**: Anda
memberi **persetujuan terakhir** sebelum Finance mentransfer. Baca juga [Panduan Direktur](direktur.md) (semua menu
Direktur berlaku untuk Anda) dan [Hal umum](README.md#hal-umum-untuk-semua-peran).
Tombol **+ Buat** di bar atas sama dengan milik Direktur.

## 1. Persetujuan Owner

Alur pengajuan biaya: **Staff → PM project → Direktur → Owner (Anda) → Finance mentransfer**.

- Setelah Direktur menyetujui, pengajuan berstatus **Menunggu persetujuan Owner** dan Anda diberi notifikasi
  "Persetujuan Owner: …" (dan email bila Admin menyalakan email persetujuan).
- **Di HP:** Beranda → **Menunggu Persetujuan** → kartu **"Persetujuan Owner"** → periksa → **Setujui sebagai Owner**
  (tertulis "diteruskan ke Finance untuk transfer") atau **Tolak** dengan alasan.
- **Di web:** **Persetujuan** → baris pengajuan → **Setujui** / **Tolak** di bar aksi. Alur persetujuan di halaman
  detail menampilkan Persetujuan PM → Persetujuan Direktur → **Persetujuan Owner** → Transfer Finance.
- Anda **tidak** memutuskan langkah Direktur (walau melihat semua yang dilihat Direktur), dan Direktur tidak memutuskan
  langkah Anda. Pengajuan yang diajukan sebelum 13 Okt 2026 tetap selesai di Direktur — tidak masuk ke kotak Anda.
- Kekurangan LPJ di atas nominal disetujui mengikuti alur yang sama (PM → Direktur → Owner), di web → Persetujuan.
- Persetujuan Owner hanya ada di alur sistem: **PDF Pengajuan Biaya tidak mencetak nama maupun tanda tangan Owner** —
  tanda tangan dokumen berhenti di Direktur. Bila Anda menolak, kotak Approval di PDF tetap bertanda DITOLAK.

## 2. Pengajuan Anda sendiri

Buat dan kirim sendiri (web atau APK, Anda sebagai pemohon). Dengan aturan **"Pengajuan Owner"** pengajuan **langsung ke
antrian transfer Finance tanpa persetujuan**; status **Tanpa persetujuan (Antri Transfer)** (Reimburse: **Tanpa
persetujuan (Verifikasi Nota)**), tercatat "Tanpa persetujuan — pengajuan Owner (kebijakan PT)" di alur persetujuan, PDF,
laporan dan Audit Log. Finance tetap memeriksa rekening, nota dan saldo. Pengajuan Owner hanya boleh dibuat dan dikirim
oleh Owner itu sendiri.

## 2a. Cek dana sebelum Anda menyetujui (ADR 0029)

Bila Admin grup menyalakan **"Cek dana saat persetujuan"** untuk sebuah PT, persetujuan terakhir Anda (dan pengajuan Anda
sendiri saat **Kirim**) **ditolak bila dana PT tidak cukup**:

- **Dana tersedia** = saldo semua akun kas/bank PT yang **tidak** ditandai site (kas kecil / rekening cabang tidak
  dihitung) − **komitmen**: pengajuan yang sudah disetujui tetapi belum ditransfer, kekurangan LPJ yang belum dibayar,
  dan perintah pinjaman antar-PT dari PT ini yang belum dicairkan. Pengajuan yang masih menunggu persetujuan belum
  dihitung — yang disetujui lebih dulu memakai dana lebih dulu.
- Di halaman pengajuan ada panel **"Ketersediaan dana PT …"** (saldo, komitmen + rinciannya, dana tersedia, dibutuhkan,
  **kurang Rp …**). Saat dana kurang tombol **Setujui** nonaktif dengan alasannya; **Tolak** tetap bisa. Di kotak
  Persetujuan baris itu bertanda **"Dana kurang Rp …"**. Anda juga mendapat notifikasi "Dana PT … tidak cukup" saat
  pengajuan sampai di langkah Anda.
- Pengajuan Anda sendiri yang dananya kurang **tetap Draft** saat dikirim; panel yang sama tampil di Draft.
- **Perintahkan pinjaman antar-PT** (tombol di panel, atau Keuangan → **Pinjaman antar-PT** → + Perintahkan pinjaman):
  pilih **PT pemberi** (daftar PT tempat Anda Owner dengan dana tersedianya; PT yang kurang tidak bisa dipilih), nilai
  (default = kekurangannya; **"Hitung untuk semua pengajuan yang menunggu"** menjumlahkan semua pengajuan yang tertahan),
  **jatuh tempo** (default 30 hari), alasan. Tanpa bunga. Nomor `PJA/<PT pemberi>/…`; nilai itu langsung dicadangkan di
  PT pemberi dan **Finance PT pemberi** mendapat tugas mencairkan (Anda sendiri tidak boleh mencairkannya walau juga
  Finance di sana).
- Setelah dana masuk Anda mendapat notifikasi "Dana pinjaman … masuk … siap disetujui". **Setujui ulang** pengajuannya —
  cek dana diulang saat itu; tidak ada yang disetujui otomatis.
- Perintah yang belum dicairkan bisa Anda **batalkan** (alasan) di detail pinjaman. Pengembalian dicatat Finance PT
  peminjam tanpa persetujuan; Anda mendapat notifikasi setiap pengembalian dan pengingat harian bila terlambat.
- Dashboard Direktur/Owner: kartu **"Dana tersedia & pinjaman antar-PT"** (dana tersedia, piutang / hutang antar-PT,
  terlambat per PT).

## 3. Yang tetap hanya Direktur

**Addendum RAB** dan **pinjaman antar project** tetap diputuskan Direktur; Anda dapat melihatnya.
