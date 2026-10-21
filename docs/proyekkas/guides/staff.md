# Panduan Staff Lapangan

Anda memakai ProyekKas untuk: **absen** (masuk/pulang dengan lokasi dan selfie), **mengajukan dana** (Pengajuan Baru atau
Reimburse), **mengunggah nota**, dan **mengirim LPJ**. Semua bisa dari HP. Baca juga [Hal umum](README.md#hal-umum-untuk-semua-peran).

Sebelum mulai: unggah **tanda tangan** sekali di web (**Profil & tanda tangan**).

![TODO screenshot: Beranda APK Staff (Ajukan Pengajuan Baru, Ajukan Reimburse, Pengajuan Saya, Absensi)](img/staff-beranda.png)

## 1. Absen masuk dan pulang (APK)

0. Pertama kali (APK 0.3.3+): baca **Pemberitahuan privasi** lalu tekan **Saya mengerti**. Sebelum itu tab **Absen**
   menampilkan *"Absensi (selfie dan lokasi) belum bisa dipakai…"* dan tombol absen mati — ketuk **Baca pemberitahuan
   privasi**. Tanpa sinyal: konfirmasi dikirim otomatis saat online; tunggu sampai terkirim.
1. Datang ke lokasi project atau kantor/pusat biaya. Nyalakan **GPS**.
2. Beranda → **Absensi** → tab **Absen**. Aplikasi **mengenali area otomatis**: lokasi tempat Anda berdiri langsung
   terpilih (*"Lokasi terdeteksi otomatis: …"*). Bila beberapa area bertumpuk, pilih salah satu di **Area absen di
   posisi Anda**. Bila tertulis *"Posisi Anda di luar semua area absen terdaftar"*, dekati lokasi atau pilih lokasi
   secara manual (ikon gedung = pusat biaya; label **Pusat** = kantor pusat, **Penempatan** = site penempatan Anda).
   Tombol **Deteksi lokasi otomatis** mengulang pencarian.
3. Tekan **Cek jarak ke lokasi** bila perlu. Harus tertulis **"Di dalam area absen"**.
4. Tekan **Absen masuk** → ambil **selfie** dengan kamera depan (galeri tidak bisa dipakai).
5. Pulang: ulangi dan tekan **Absen pulang**.

![TODO screenshot: kartu jarak "Di dalam area absen" dan tombol Absen masuk](img/staff-absen.png)

- **Tidak ada sinyal?** Tetap absen. Tertulis "Absen tersimpan di HP (offline)…" dan otomatis terkirim saat ada
  sinyal. Jam yang dicatat = jam saat Anda absen, bukan jam kirim.
- **"Di luar area absen"**: dekati titik lokasi. Bila Anda yakin sudah di lokasi, lapor PM/Admin (titik mungkin salah).
- **Di mana boleh absen?** Tergantung **tipe absensi** Anda (diatur Admin): **Karyawan OnSite** — di dalam salah satu
  lokasi terdaftar PT (kantor, site, project, pusat biaya), tanpa perlu ditugaskan; di luar radius ditolak.
  **Karyawan Non-OnSite** — di mana saja: di dalam lokasi terdaftar tercatat di lokasi itu, di luar semua lokasi
  terdaftar pilihan **"Di luar area"** otomatis terpilih dan absen tetap tersimpan (tercatat "Di luar area" dengan
  acuan site penempatan / kantor pusat). Daftar lokasi tersimpan di HP, jadi deteksi area tetap jalan tanpa sinyal.
- **"Lokasi palsu (mock location) terdeteksi"**: matikan aplikasi pengubah lokasi. Absen ditolak.
- **"Sudah absen masuk di … hari ini"**: absen masuk hanya sekali per hari per lokasi.
- **"Titik lokasi … belum diisi Admin"**: lapor Admin. (Bila titik sudah ada tetapi radius kosong, dipakai radius
  default perusahaan.) Radius ditambah toleransi akurasi GPS HP, paling banyak 50 m.
- Tombol absen mati dengan tulisan belum diaktifkan: fitur dimatikan Admin, hubungi Admin.
- **Cap waktu di foto:** server membubuhkan tanggal, jam (waktu absen yang diterima server, zona PT), koordinat GPS,
  lokasi, nama Anda dan "RR Teams" di bagian bawah selfie (beberapa detik setelah absen terkirim).
- **Absen dari web** (Absensi → Absen saya): selfie hanya dari **kamera langsung** (tombol **Buka kamera** → **Ambil
  foto**), bukan dari galeri/file. Bila muncul *"Kamera tidak tersedia — gunakan aplikasi Android"*, absen lewat APK.
- Lupa absen/jam salah: minta **PM** mengoreksi (Anda tidak bisa mengoreksi sendiri).

**Rekap bulanan:** Absensi → tab **Rekap** → geser bulan → ketuk tanggal untuk rincian (jam masuk/pulang, terlambat).
Bila Anda karyawan di lebih dari satu PT, pilih kode PT (mis. **DRMS** / **CS1**) di atas rekap. Di web: **Rekap
absensi saya**.

Absen memakai PT dari lokasi yang Anda pilih — tidak perlu memilih PT sendiri.

## 2. Mengajukan dana (APK)

Pilih jenisnya dulu:

| Jenis | Kapan | Nota |
|---|---|---|
| **Pengajuan Baru** | Butuh uang **sebelum** belanja | Diunggah **setelah** uang ditransfer, lalu kirim LPJ |
| **Reimburse** | Sudah bayar **dengan uang sendiri** | **Wajib** dilampirkan saat mengajukan (tiap baris minimal 1 nota) |

1. Beranda → **Ajukan Pengajuan Baru** atau **Ajukan Reimburse**. Bila Anda bekerja di lebih dari satu PT, muncul
   **Untuk PT mana?** → ketuk PT tempat biaya ini dibebankan. Di editor tertulis **PT: …**. (Pesan "Anda tidak bisa
   membuat pengajuan di PT yang dipilih. Ganti PT di beranda." = ubah pilihan PT di Beranda dulu.)
2. Isi **Judul**, pilih **Project**, **Tanggal dibutuhkan**. (Pusat biaya tidak dipilih lagi — sejak 21 Okt 2026 pusat
   biaya = akun kas project, diisi saat project dibuat.)
3. **Diajukan oleh**: nama Anda sudah terisi. Staff hanya bisa mengajukan **untuk dirinya sendiri** (keputusan
   pemilik 8 Okt 2026): daftar pilihan hanya berisi nama Anda. Pengajuan untuk orang lain dibuat oleh PM, Admin atau
   Finance. Draft lama yang mencantumkan orang lain ditolak saat diajukan dengan pesan "Staff hanya dapat mengajukan
   untuk dirinya sendiri…" — hapus nama lain lalu ajukan lagi.
4. **Rekening tujuan**: pilih rekening salah satu pemohon (di web daftar juga hanya berisi rekening pemohon; bila
   dikosongkan di web, dipakai rekening default pemohon pertama).
5. **Tambah baris** untuk tiap barang/biaya: Uraian, Kategori, **Qty**, **Satuan**, **Harga satuan**, Kendaraan (bila
   BBM/servis). **Total = qty × harga satuan** dihitung otomatis dan tidak bisa diubah (keputusan owner D3, 11 Okt 2026);
   pengajuan, persetujuan dan transfer memakai total ini. Bila nota sudah ada dan nilainya berbeda, isi **Nominal sesuai
   nota** — Finance akan melihat tanda **Selisih nota** (pengajuan tetap memakai total).
6. Reimburse: di tiap baris tekan **Foto nota (kamera)** atau **Dari galeri**, isi nomor nota, toko, tanggal, nominal.
   Tanggal nota tidak boleh setelah hari ini (pesan "Tanggal nota tidak boleh di masa depan").
7. **Simpan draft** (bisa tanpa sinyal) → saat online tekan **Ajukan** → konfirmasi.

![TODO screenshot: editor pengajuan dengan baris item dan Total (pratinjau)](img/staff-editor.png)

Setelah diajukan, nomor dokumen terbit (mis. `PB/DRMS/2611/0001`; `DRMS` = kode PT, `2611` = tahun-bulan, tiap PT
punya nomor urut sendiri yang mulai dari 0001 lagi setiap bulan; semua nomor dokumen lain juga memuat kode PT, mis. `TRF/DRMS/2610/0001`) dan status **Menunggu persetujuan PM**. Yang memutuskan adalah **PM project** (PM di data project;
untuk pusat biaya: manajernya) lalu **Direktur** **di PT pengajuan itu**; setelah itu Finance mentransfer (sejak 10 Okt
2026). Pengajuan yang diajukan sebelumnya tetap diputuskan Direktur lalu Finance. Bila muncul "Project ini belum punya
PM. Hubungi Admin untuk mengisi PM project.", minta Admin mengisi PM project itu. Alur Anda tidak berubah oleh
keputusan owner 11 Okt 2026 (ADR 0024): hanya pengajuan **Direktur untuk dirinya sendiri** yang langsung ke Finance
tanpa persetujuan.
Pantau di **Pengajuan Saya** atau lonceng. Pemohon lain yang Anda cantumkan diberi tahu saat pengajuan dibuat atas
namanya, diajukan, dan ditarik kembali; di web lonceng **Notifikasi** ada di bar atas, kanan.

**RAP (sejak 11 Okt 2026):** project yang punya RAB wajib punya **RAP** — setiap baris memilih **Item RAP**. Bila
project belum punya RAP, editor menampilkan **"Project belum punya RAP — hubungi PM"**: draft tetap bisa disimpan,
tetapi baru bisa diajukan setelah PM mengisi RAP project. Hubungi PM project Anda.

**Pesan yang sering muncul:** "Project belum punya RAP — hubungi PM" · "Reimburse wajib melampirkan minimal 1 nota." · "Pilih salah satu: project atau pusat
biaya." · "Rekening tujuan wajib dipilih." · "Data master belum tersedia…" (buka aplikasi saat online sekali) ·
"Tanggal nota tidak boleh di masa depan" · "Staff hanya dapat mengajukan untuk dirinya sendiri…".

## 2b. Pembayaran vendor (APK dan web, sejak 16 Okt 2026)

Permintaan owner 16 Okt 2026 ("untuk pengajuan vendor dibukakan di level staff"): Staff juga boleh mengajukan
**pembayaran invoice vendor** — dana ditransfer Finance langsung ke **rekening vendor**, tanpa nota per baris dan tanpa
LPJ (invoice adalah buktinya).
- **APK:** Pengajuan → **+** → **Jenis penerima: Vendor** → pilih **Vendor** dan **Rekening vendor** (hanya vendor dan
  rekening aktif PT Anda; rekening dibuat dan diverifikasi oleh Finance / Admin — Anda hanya memilih), isi nomor,
  tanggal dan jatuh tempo invoice, foto / PDF invoice, baris item → **Kirim**. Draft boleh disimpan offline.
- **Web:** **+ Buat pengajuan** → *Jenis penerima* **Vendor** (field yang sama).
- Project wajib (project yang Anda ditugaskan). Tanpa project (mis. tagihan kantor): kosongkan project lalu pilih
  **Pusat biaya** tempat Anda ditugaskan.
- Pemohon = Anda sendiri. Alurnya sama seperti pengajuan Staff lain: **Persetujuan PM** (PM project; untuk pusat biaya:
  manajernya) → **Direktur** → **Owner** → Finance mentransfer ke rekening vendor → **Selesai**.
- Satu invoice hanya bisa diajukan sekali per vendor (selama pengajuan lama belum dibatalkan / ditolak).
- Anda tidak bisa membuat atau mengubah vendor / rekening vendor; bila vendor atau rekeningnya belum ada, minta Finance
  atau Admin. **Pembayaran antar-PT** tetap hanya untuk Finance, PM dan Direktur.

## 3. Mengubah, membatalkan, mengajukan ulang

- **Belum ada keputusan (PM/Direktur)?** Buka pengajuan → **Tarik kembali ke Draft** (isi alasan) → **Ubah & ajukan di HP**
  → Ajukan lagi. Nomor tetap sama.
- **Tidak jadi?** **Batalkan pengajuan** (isi alasan). Setelah ada keputusan, pembatalan hanya oleh Finance/Direktur.
- **Ditolak?** Baca alasannya → **Ajukan ulang (buat draft baru)** → perbaiki → Ajukan. Baris, pemohon, rekening,
  lampiran **dan nota** (yang tidak ditolak/dihapus) ikut disalin; nota berstatus "belum diverifikasi" lagi. Hapus
  atau ganti nota yang menjadi alasan penolakan.
- **Revisi Nota** (Reimburse): Finance menolak salah satu nota. Buka pengajuan (APK atau web) → hapus nota yang
  ditolak → unggah pengganti → **Kirim ulang nota**. Bila total berubah, pengajuan disetujui ulang.

## 4. Nota dan LPJ Pengajuan Baru

1. Setelah status **Ditransfer**, belanjakan dana dan simpan notanya.
2. Buka pengajuan → **Nota & LPJ** → **Tambah nota (kamera)** per baris. Salah foto? Ikon hapus → isi alasan.
   Nota yang sudah **Valid** (divalidasi Finance) terkunci: tidak ada ikon hapus, dan server menolak dengan pesan
   "Nota sudah divalidasi Finance". Hanya nota yang menunggu verifikasi atau ditolak yang bisa dihapus/diganti.
3. Semua nota sudah masuk → **Nota sudah lengkap**.
4. **Kirim LPJ**: tulis uraian penggunaan dana, tambahkan **Foto LPJ** bila perlu (foto barang / lokasi, maks. 10;
   bisa ditambah atau dihapus sampai LPJ dikirim, dan lagi saat Finance meminta revisi) → Konfirmasi.
5. Bila Finance meminta revisi, baca **Catatan Finance**, perbaiki nota, **Kirim ulang LPJ**.
6. Sisa dana dikembalikan ke kas / kekurangan ditransfer oleh Finance → status **Selesai**.

Nota & LPJ hanya bisa dikirim saat online.

![TODO screenshot: bagian Nota & LPJ di detail pengajuan APK](img/staff-lpj.png)

## 5. Di web (opsional)

Menu Anda: **Daftar pengajuan**, **Rekap absensi saya**, **+ Buat pengajuan**, **Profil & tanda tangan**.
Di web Anda juga bisa mencetak **PDF Pengajuan Biaya** (tombol **Cetak** di bar aksi atas pengajuan yang sudah bernomor) —
PDF tidak tersedia di APK. Kop dan logo PDF mengikuti PT pengajuan. Di web, form **+ Buat pengajuan** punya kolom
**PT** di atas — wajib dipilih bila pemilih PT Anda berisi lebih dari satu PT, dan tidak bisa diubah setelah dibuat.
Di form web, baris item tampil sebagai **tabel** (No, Uraian, Kategori, Qty, Satuan, Harga satuan, Total, Nominal sesuai
nota). **+ Tambah baris** dan **Ubah** membuka jendela isian yang sama seperti di APK; total baris dan grand total
langsung terlihat. Tekan **Simpan** untuk menyimpan draft. Pengajuan yang sudah tersimpan selalu terbuka sebagai
ringkasan **Rincian pengajuan** (hanya baca); untuk mengubah draft (atau baris item saat **Revisi Nota**) tekan **Edit** di
bar aksi atas → ubah → **Simpan** (atau **Batal**). **Duplikat** membuat draft baru berisi PT, project, pemohon dan
baris item yang sama (tanpa nomor, persetujuan, nota, lampiran) — praktis untuk pengajuan rutin.

## Pertanyaan umum

- *Kenapa belum disetujui?* Lihat **Giliran** (APK) / **Tahapan saat ini** (web, alur di kolom kanan) di detail
  pengajuan (PM project atau Direktur). Notifikasi ke HP belum aktif (PM/Direktur melihatnya di aplikasi/web, dan
  lewat email bila diaktifkan Admin); ingatkan langsung bila mendesak.
- *Nota berbeda sedikit dengan total baris?* Tidak apa-apa; sistem memberi tanda (flag) untuk diperiksa Finance.
- *Muncul flag "Nota ganda dalam pengajuan ini"?* Foto yang sama, atau nomor nota + toko yang sama, diunggah dua kali
  di pengajuan yang sama. Hapus salah satunya bila memang dobel; bila memang satu nota untuk dua baris, biarkan —
  Finance yang memeriksa.
- *HP hilang?* Lapor Admin segera. Data yang belum terkirim di HP itu harus diinput ulang.
