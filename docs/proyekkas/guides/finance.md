# Panduan Finance

Tugas Anda di ProyekKas: **verifikasi nota Reimburse**, **mencatat
transfer**, **verifikasi LPJ** dan penyelesaian selisih, **kas masuk/keluar manual**, **void**, **tutup buku**, dan
**laporan**, serta Approval pengajuan **alur lama** dan **Addendum RAB**. Sejak 10 Okt 2026 (ADR 0021) pengajuan baru
disetujui **PM project lalu Direktur**; Finance **tidak lagi menyetujui** — Anda menerima pengajuan yang sudah disetujui
Direktur untuk diverifikasi notanya (Reimburse) dan ditransfer. Sebagian besar di **web**; APK untuk persetujuan cepat. Baca juga [Hal umum](README.md#hal-umum-untuk-semua-peran).

Modul web (layar modul `/admin`): **Persetujuan** (Persetujuan · Antrian Transfer · Verifikasi LPJ) · **Keuangan** (Pengajuan · Kas · Transfer & LPJ · Tutup buku) · **Laporan** · **Sistem** (Audit Log) · **Dashboard** · …
Badge merah di menu = jumlah pekerjaan menunggu.

![TODO screenshot: Beranda web Finance](img/finance-beranda.png)

### Bila Anda Finance di lebih dari satu PT

- Pilih PT lewat tombol PT di bar atas (**Semua PT** / **PT: …**, lihat [Hal umum](README.md#hal-umum-untuk-semua-peran)).
  Antrian hanya berisi PT tempat Anda Finance/Direktur.
- Bila lebih dari satu PT tampil: **Persetujuan**, **Antrian Transfer** dan **Verifikasi LPJ** punya kolom/tanda
  **PT** di tiap baris dan tulisan **Menampilkan PT: …** di atas tabel.
- **Dashboard Finance:** angka besar = gabungan PT tempat Anda Finance; di bawahnya rincian per PT (saldo kas,
  antrian transfer jumlah · nominal, menunggu verifikasi LPJ/nota, tutup buku terakhir). Nama akun kas diberi awalan
  `[KODE PT]`.
- Satu transaksi (transfer, kas, tutup buku) selalu milik **satu** PT; pilihan akun kas hanya berisi akun PT itu.

## 1. Approval pengajuan (alur lama) — dan alur baru tanpa Approval Finance

**Alur baru (pengajuan yang diajukan setelah Admin mengubah aturan approval PT):** Staff → **PM project** →
**Direktur** → **Disetujui**. Anda diberi tahu setelah Direktur menyetujui: Pengajuan Baru → "Antri transfer: …" (lihat
§3), Reimburse → "Verifikasi nota: …" (lihat §2, verifikasi nota bukan approval). Tidak ada tombol Setujui untuk
Finance pada pengajuan ini. Bila Anda membuat pengajuan atas nama karyawan, pengajuan tetap melewati PM project dan
Direktur.

**Pengajuan Direktur sendiri (sejak 11 Okt 2026, ADR 0024):** langsung masuk **Antrian Transfer** (Reimburse: verifikasi
nota) **tanpa persetujuan**, ditandai **"Tanpa persetujuan (Direktur)"** di antrian (web + APK) dan "Tanpa persetujuan —
pengajuan Direktur (kebijakan PT)" di detail, PDF dan Rekap Pengajuan (kolom **Persetujuan**). **Anda satu-satunya
pemeriksa sebelum uang keluar**: periksa rekening (terverifikasi?), flag/selisih nota dan saldo seperti biasa.
Kekurangan LPJ pengajuan seperti ini disetujui otomatis saat Anda memintanya (tercatat di Audit Log). Pengajuan
Direktur yang dibuat Admin/Finance atas namanya ditolak saat dikirim — minta Direktur mengajukan sendiri.

**Alur lama (pengajuan yang sudah diajukan sebelum aturan diubah — tetap selesai dengan alur lama):**
**Direktur** menyetujui dulu ("Diketahui"), baru pengajuan masuk ke Anda untuk **Approval**.

- **Web:** **Persetujuan** → periksa Jenis, Grand total, **Dampak anggaran** (merah = anggaran project sesudah
  disetujui > 85%), **Flag** → **Setujui** / **Tolak** langsung di baris, atau klik baris untuk membuka halaman
  detail (tiap baris item dengan foto nota — klik untuk ukuran penuh —, total nota & selisih per baris, flag per
  baris; **Setujui** / **Tolak** di bar aksi atas) — **Tolak**: alasan wajib, minimal 3 huruf (alasan yang terlalu
  pendek langsung ditolak dengan pesan "Alasan wajib diisi, minimal 3 karakter.").
- Angka **Flag** = flag **terbuka** (peringatan + info). Angka inilah yang tersimpan bersama keputusan Anda; flag
  yang sudah "diperiksa" tidak dihitung.
- **APK:** **Menunggu Persetujuan** → buka → **Setujui** → pilih **Pakai tanda tangan profil** atau **Tanda tangan
  di layar** → Konfirmasi.
- Anda tidak bisa memutuskan pengajuan yang Anda buat/ajukan sendiri; bila Anda satu-satunya Finance, posisi
  Approval otomatis dilewati dan tercatat "(tidak berlaku — pemohon)".
- Beberapa PT: keputusan memakai peran Anda **di PT pengajuan**; warna merah Dampak anggaran memakai ambang PT itu.

## 2. Reimburse: verifikasi nota

**Antrian Transfer** → **Verifikasi nota Reimburse**:
1. Tiap nota: **Valid**, atau **Tolak** + alasan (pengajuan kembali ke pemohon sebagai **Revisi Nota**).
2. Tiap flag **peringatan**: **Tandai flag diperiksa** (catatan opsional). Flag **info** tidak perlu tindakan.
3. **Verifikasi semua nota** → status **Nota Terverifikasi (Antri Transfer)**.

Arti flag: *Selisih nominal nota vs baris* (info bila ≤ toleransi Rp 1.000) · *Nota terlalu lama* (> 30 hari) ·
*Satuan tidak wajar* · *Nota ganda* (nota sama sudah dipakai di pengajuan lain, **atau** — sejak 8 Okt 2026 — foto
yang sama / No. nota + toko yang sama diunggah dua kali **dalam pengajuan yang sama**: "Nota ganda dalam pengajuan
ini…", flag ada di nota yang diunggah belakangan) · *Tanggal nota di luar periode kegiatan*. Flag tidak menghalangi,
tetapi wajib diperiksa. Nota bertanggal setelah hari ini tidak bisa diunggah sama sekali. Nota yang Anda tandai
**Valid** terkunci: pemohon tidak bisa menghapus atau mengubahnya lagi.

![TODO screenshot: Verifikasi nota Reimburse dengan tombol Valid/Tolak dan flag](img/finance-verifikasi-nota.png)

## 3. Mencatat transfer

Angka di menu **Antrian Transfer** = jumlah **Siap ditransfer** (sama dengan judul halaman); Reimburse yang notanya
belum diverifikasi ada di bagian atas halaman tetapi tidak dihitung di angka menu.

**Antrian Transfer** → **Siap ditransfer** (urut tanggal dibutuhkan) → **Catat transfer**:
Akun kas, **Tanggal & jam transfer (sesuai bukti)** — wajib, tidak boleh di masa depan, dibaca dalam zona waktu PT;
tanggalnya menentukan periode (tutup buku) — **No. referensi bank**, **Bukti** (foto/PDF) → simpan.
- **Umur sejak disetujui** (di bawah tanggal dibutuhkan): hijau = masih dalam **SLA transfer** PT (default 24 jam sejak
  persetujuan final; diatur Admin/Direktur di Perusahaan (PT) › Operasional › SLA transfer), **merah** = sudah lewat SLA.
- Nominal otomatis = nominal disetujui; rekening tujuan dari pengajuan.
- Kotak **"Anda juga yang menyetujui"** (hanya pengajuan alur lama): Anda sendiri yang memberi Approval pada
  pengajuan ini. Boleh tetap dicatat (tercatat di audit), tetapi bila ada Finance lain sebaiknya transfer dicatat
  orang lain.
- Kas keluar (KK) tercatat otomatis; status **Ditransfer**.
- Kolom **Rekening tujuan** menandai **Terverifikasi** / **Belum diverifikasi**. Transfer ke rekening yang **belum
  diverifikasi** memunculkan dialog peringatan (bank, nomor, nama pemilik): periksa dulu dengan karyawan, lalu
  **Tetap simpan** — konfirmasi Anda tercatat di Audit Log. Verifikasi rekening di **Rekening karyawan** (status
  verifikasi) supaya peringatan tidak muncul lagi.
- Bila saldo akun kas yang dipilih akan menjadi **minus**, muncul dialog **Saldo akun kas akan minus** dengan saldo
  sekarang dan sesudah transfer. Pilih akun lain / catat dulu kas masuk yang belum tercatat, atau **Tetap simpan**
  bila dana memang ada (tercatat di Audit Log).
- Salah catat? **Void transfer** (di bagian "Transfer tercatat — dapat dibatalkan" atau di detail pengajuan) + alasan:
  KK dibalik, pengajuan kembali ke antrian.
- Reimburse **Ditransfer**: bila pemohon sudah menerima dana tetapi belum menekan **Konfirmasi selesai**, Anda bisa
  menekannya di detail pengajuan (di bawah "Tahapan saat ini: Pemohon … atau Finance"). Tanpa itu pengajuan ditutup otomatis
  setelah batas hari di Setting perusahaan.

## 3a. Pembayaran vendor (DRMS 13/10, ADR 0027)

Membayar **invoice vendor** langsung ke **rekening vendor** — tanpa nota per baris, tanpa LPJ dan tanpa selisih;
invoice adalah buktinya.

1. **Rekening vendor dulu:** Master Data → **Vendor** → buka vendor → tab **Rekening** → tambah rekening (bank, nomor,
   atas nama, *Rekening default*). Atau Master Data → **Rekening vendor**. Periksa nomor dan nama pemilik lalu ubah
   **Status verifikasi** menjadi *Terverifikasi* (hanya Finance / Admin). Mengubah nomor / nama / bank wajib dengan
   alasan (tercatat di audit).
2. **Buat pengajuan:** Keuangan → Pengajuan biaya → Buat baru → **Jenis penerima: Vendor**. Pilih project — atau,
   tanpa project (mis. tagihan kantor), **Pusat biaya** —, **Vendor**,
   **Rekening vendor** (hanya rekening aktif vendor itu), isi **Nomor invoice**, **Tanggal invoice**, *Jatuh tempo*
   (opsional) dan unggah **File invoice** (foto / PDF). Isi baris item seperti biasa (item RAP per baris). Pemohon =
   Anda sendiri; jenis otomatis *Pengajuan Baru*. **Kirim pengajuan**.
3. **Persetujuan:** pembayaran vendor yang Anda ajukan langsung ke **Direktur** (aturan "Pembayaran vendor oleh
   Finance — Direktur"). Yang diajukan PM: langkah PM dilewati (ia PM project-nya) → Direktur.
4. **Transfer:** muncul di **Antrian Transfer** dengan label *Pembayaran vendor: <nama vendor>*; rekening tujuan =
   rekening vendor yang tercatat saat diajukan. Rekening yang belum diverifikasi meminta konfirmasi seperti rekening
   karyawan. Setelah transfer dicatat, pengajuan langsung **Selesai** (tidak ada LPJ). Salah transfer → **Void
   transfer** di detail pengajuan; pengajuan kembali ke antrian.
5. **Invoice ganda ditolak:** nomor invoice yang sama dari vendor yang sama (huruf besar/kecil, spasi, tanda `/ - .`
   diabaikan) pada pengajuan lain yang belum *Dibatalkan* / *Ditolak* → pesan "Invoice … sudah dipakai di pengajuan …".
   Batalkan pengajuan lama bila memang salah input. *Duplikat* menyalin vendor + rekening, tetapi tidak invoice-nya.

## 4. LPJ Pengajuan Baru

**Verifikasi LPJ** → **LPJ diajukan**:
1. Periksa Ditransfer / Nota / Selisih. Tiap nota **Valid**/**Tolak**. Tiap flag terbuka (mis. *Nota terlalu
   lama*): **Tandai flag diperiksa** (catatan opsional, tercatat di Riwayat/Audit).
   Angka Nota / Selisih dan flag selisih dihitung ulang **setiap kali** nota ditandai Valid, ditolak atau dihapus
   (nota ditolak tidak lagi dihitung) — tidak perlu menunggu pemohon mengirim ulang LPJ.
2. **Verifikasi LPJ**, atau **Minta revisi** dengan catatan untuk pemohon.
3. Bagian **Menunggu penyelesaian selisih**:
   - Sisa dana → **Catat pengembalian & selesaikan** (kas masuk "Pengembalian LPJ").
   - Kekurangan → **Transfer kekurangan & selesaikan** (ref bank + bukti wajib).
   - Selisih 0 → langsung **Selesai**.
4. **Kekurangan melebihi nominal disetujui + toleransi** (Pengaturan PT → *Toleransi kekurangan LPJ*, default
   **10%**): misalnya disetujui Rp 1.350.000, toleransi 10% → total transfer paling banyak Rp 1.485.000 tanpa
   persetujuan. Di atas itu, form transfer kekurangan diganti kotak **Perlu persetujuan kekurangan** → **Ajukan
   persetujuan kekurangan** + alasan (mis. harga material naik). Total baru disetujui ulang dengan alur aturan
   approval yang berlaku saat itu: alur baru **PM project** lalu **Direktur** (alur lama: Direktur lalu Finance) — di
   menu **Persetujuan** (web), bagian **Kekurangan LPJ di atas nominal disetujui**. Setelah disetujui, form **Transfer kekurangan & selesaikan** muncul lagi. Bila
   ditolak, kotak menampilkan alasannya; Anda dapat **Ajukan ulang** dengan penjelasan baru. Persetujuan ini hanya
   di web (belum di APK).

Sebelum bukti diunggah, sistem memeriksa kelengkapan pengaturan (mis. sumber kas masuk **Pengembalian LPJ**, kode
`LPJ`). Bila kurang, pesan muncul **sebelum** file diunggah. Sumber `LPJ` kini dibuat otomatis untuk setiap PT (PT
baru dan PT lama lewat migrasi); bila sengaja dihapus/diganti kodenya, buat lagi di Master → Sumber kas masuk.
Bukti yang terlanjur terunggah tetapi tidak dipakai dokumen apa pun dibersihkan otomatis setelah beberapa hari.

Catatan: kas masuk pengembalian LPJ tidak bisa di-void; bila salah, laporkan ke tim.

## 5. Kas masuk / keluar manual

**Keuangan → Kas → Buku kas** (halaman **Kas**) → **↓ Kas masuk** atau **↑ Kas keluar** → (bila Anda Finance di
beberapa PT: kartu **Pilih PT** → klik PT transaksi ini) → isi Tanggal, Akun kas, Nominal, Sumber (masuk) / Kategori biaya
(keluar), Project atau Pusat biaya (opsional), Kendaraan (opsional), **Keterangan**, Bukti (opsional) → Simpan.
Nomor `KM/…` atau `KK/…` terbit dan saldo langsung berubah.

- **Nominal:** angka Rupiah tanpa desimal; titik boleh sebagai pemisah ribuan (`1.250.000`). Koma (`1.000,50`),
  tanda minus (`-5000`) atau huruf **ditolak** dengan pesan di bawah kolom (tidak lagi diubah diam-diam). Uang
  keluar dicatat dengan jenis **Kas keluar**, bukan dengan tanda minus. Aturan yang sama berlaku untuk nominal nota
  dan nominal tambahan Addendum RAB.
- **Tanggal** tidak boleh sebelum **tanggal saldo awal (go-live)** akun kas yang dipilih — kalender tidak menawarkan
  tanggal itu, dan server menjawab "Tanggal sebelum tanggal saldo awal akun (dd/mm/yyyy)".
- **Kas keluar yang membuat saldo akun minus** memunculkan dialog dengan saldo sekarang dan sesudahnya. **Tetap
  simpan** hanya bila dana memang ada (mis. setoran belum dicatat); konfirmasi tercatat di Audit Log. Void (jurnal
  balik) tidak ditanya.
- **Ubah:** hanya kas manual di periode terbuka; alasan wajib. Halaman ubah memakai tata letak yang sama dengan
  catat kas: tanggal, akun dan nominal tampil **terkunci** (koreksi → void lalu catat ulang); **bukti** bisa ditambah
  atau diganti (**Lihat bukti saat ini** → pilih file baru).
- **Void:** tombol **Void** + alasan → baris asli bertanda *Void* dan muncul *Jurnal balik*. Kas dari transfer
  dibatalkan lewat **Void transfer**.

![TODO screenshot: halaman Kas dengan saldo per akun dan Buku kas](img/finance-kas.png)

## 6. Tutup buku bulanan

**Tutup buku** → bulan lalu → **Tutup buku**. Setelah ditutup, transaksi di bulan itu terkunci. Membuka kembali
hanya **Direktur**. Daftar bulan dimulai dari bulan **saldo awal (go-live)** akun kas paling awal PT — bulan sebelum
PT mulai memakai ProyekKas tidak ditawarkan dan ditolak bila dikirim. Kolom **Masuk/Keluar** = tanpa pasangan void;
pasangan void + jurnal balik ada di kolom **Koreksi (void)** sendiri (bersih buku = Bersih + Koreksi). Langkah lengkap: [runbook tutup buku](../runbooks/tutup-buku.md).

**Tutup buku per PT:** satu layar = satu PT. Bila Anda Finance di beberapa PT, halaman **Tutup buku** menampilkan
kartu **Pilih PT** (dengan "terkunci s/d …" per PT) → klik PT → tutup bulannya. Pindah PT lewat tombol **PT:** di atas
halaman. Menutup buku satu PT **tidak** mengunci PT lain — ulangi untuk setiap PT.

## 7. Laporan

**Rekap Kas:** saldo awal akun dihitung **mulai tanggal saldo awalnya** — bulan sebelum go-live bersaldo 0; di bulan
go-live muncul kolom **Saldo awal akun baru**. Perbandingan "vs akhir <bulan>" di Beranda memakai angka yang sama.

**Laporan**: Rekap Kas · Buku Kas · Pengeluaran per Kategori · Anggaran Project · Rekap Pengajuan · Kelengkapan
Nota/LPJ · **SLA Transfer** (disetujui → ditransfer per PT per bulan: jumlah, rata-rata, P90, % dalam SLA, daftar yang
terlambat) · Biaya per Kendaraan · Laporan Absensi. Atur filter → unduh **CSV**, **Excel (.xlsx)** atau **PDF**
(Excel maks. 10.000 baris, PDF maks. 500 baris). **Audit Log** untuk menelusuri siapa melakukan apa.

**Laporan beberapa PT:** filter **PT** (hanya muncul bila Anda punya akses ke lebih dari satu PT) mempersempit
laporan. Bila lebih dari satu PT masuk laporan: kolom **PT** di setiap baris dan tabel **Subtotal per PT** (+ baris
TOTAL). **Kop** laporan dan file unduhan: satu PT = kop PT itu; beberapa PT = kop grup (diatur Admin grup) + daftar PT.

## 8. Lain-lain

- **Pengajuan atas nama karyawan:** **+ Buat pengajuan** → Diajukan Oleh = karyawan tersebut (Anda tercatat
  sebagai "Dibuat Oleh"). Beri tahu karyawan secara langsung (tidak ada notifikasi otomatis).
- **Addendum RAB:** setelah Direktur setuju, addendum masuk **Persetujuan** Anda → **Setujui (Finance)** / Tolak.
- **Master keuangan:** Akun kas/bank, Sumber kas masuk, Kategori, Satuan, Bank, Rekening karyawan.
