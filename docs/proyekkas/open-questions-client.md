# ProyekKas — Pertanyaan Terbuka untuk Klien (DRMS)

Tanggal: 23 September 2026 (diperbarui 25 September 2026: keputusan user untuk go-live, lihat `plans/fase1-golive.md` §1 dan ADR 0013) · Terkait: `requirements-v1.1.md` (nomor `Q-xx` dirujuk dari sana)

Cara membaca:
- **Usulan default** = yang akan dipakai tim bila klien tidak menjawab sebelum fase yang diblokir dimulai. Semua default bisa diubah di setting kecuali disebut lain.
- **Blok fase** memakai penomoran fase usulan (menunggu rencana fase Lead):
  F1 Fondasi (auth, user & peran, master, audit log, penomoran, media) · F2 Alur pengajuan inti (T1–T8, approval & tanda tangan, PDF, validasi nota, tutup buku) · F3 Web dashboard, laporan, export · F4 APK Flutter · F5 Project/progress/absensi lanjutan/laporan kendaraan (T9–T12) · F6 Hardening, UAT & rilis · F7 Pasca-rilis: mirror Odoo, OCR.
- Data contoh diambil dari form `228/PB-DRMS/20/IX/2026`.

---

## A. Cakupan & prioritas

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-01 | Apakah kontrol kas penuh — modul Kas & Bank (M07: kas masuk/keluar, saldo akun, void) dan **tutup buku bulanan** — tetap masuk cakupan, mengingat penekanan utama adalah memantau progress lewat HP? Atau cukup pencatatan transfer pengajuan saja? | Menentukan besarnya fase F2/F3 dan apakah ProyekKas menjadi "buku kas" resmi atau hanya alat kontrol pengajuan. Bila DRMS nanti pindah ke Odoo, kas mungkin lebih tepat dipegang Odoo. | Tetap masuk cakupan sesuai v1.0 (kas masuk/keluar, void, tutup buku), tetapi dikerjakan setelah alur pengajuan inti. **TERJAWAB (user 2026-09-25):** kas penuh masuk cakupan go-live, dan Finance membutuhkan **UI web** untuk kas masuk/keluar manual, void kas, void transfer (dengan alasan) serta tutup/buka buku (epik E2). | F2 |
| Q-02 | Fitur mana yang paling ingin dipakai lebih dulu: pemantauan progress & absensi di lapangan, atau alur pengajuan biaya? | Urutan fase bisa ditukar agar nilai paling penting cepat dipakai. | Alur pengajuan biaya dulu (ada contoh form nyata), lalu progress & absensi. **TERJAWAB (user 2026-09-25):** **semua modul wajib di go-live**, termasuk progress harian (T11), addendum RAB (T12), absensi lengkap, pengingat terjadwal dan dashboard progress/kehadiran (`plans/fase1-golive.md` §1 K1). | F1 |
| Q-35 | Seberapa penting OCR nota (baca otomatis tanggal/total/nama toko)? | Menentukan apakah OCR dianggarkan. | *Nice to have*, fase akhir, tidak memblokir rilis. | F7 |

## B. Pengajuan biaya (M03)

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-03 | Form contoh berjudul "Pengajuan **Reimburse**", tetapi nota BBM dan makan bertanggal 21/09/2026, sesudah tanggal form 20/09/2026. Apakah pengajuan ini sebenarnya uang muka, atau form memang dibuat sebelum perjalanan lalu nota menyusul? | Dua jenis pengajuan punya alur berbeda: reimburse = nota ada saat pengajuan; uang muka = dana dulu, nota menyusul lewat LPJ. | Sistem menyediakan dua jenis. Pengajuan yang notanya menyusul wajib memakai jenis Uang Muka. | F2 |
| Q-04 | "TGL." di form berarti tanggal apa: tanggal dibuat, tanggal diajukan, atau tanggal kegiatan? Perlukah field periode kegiatan (dari–sampai)? | Validasi tanggal nota (flag "nota setelah tanggal pengajuan") bergantung pada arti tanggal ini. | TGL = tanggal diajukan (dari server). Tambahkan field opsional "periode kegiatan" untuk validasi. | F2 |
| Q-05 | ~~Total baris vs jumlah × harga satuan~~ **TERJAWAB (user 2026-09-23):** 677.000 adalah pembulatan user dari tagihan Rp 676.876 (2 kamar). | Total baris adalah nilai yang diinput user; harga satuan informatif. Grand total seed Rp 1.447.500. | — (keputusan final) | — |
| Q-11 | Rekening tujuan transfer boleh milik siapa? Di contoh, pemohon "Budi, Doni" dan uang ditransfer ke Doni Pratama (Mandiri). Bolehkah transfer ke rekening orang yang **bukan** pemohon (mis. vendor)? | Membatasi rekening ke pemohon mencegah salah transfer/penyelewengan. | Hanya rekening terdaftar milik salah satu pemohon. Pembayaran ke vendor di luar cakupan. | F2 |
| Q-28 | Apakah ada pemohon yang tidak punya akun aplikasi (mis. sopir, helper)? | Pemohon tanpa akun tidak bisa tanda tangan di aplikasi dan tidak menerima notifikasi. | Karyawan tanpa akun boleh dicantumkan sebagai pemohon; tanda tangannya diwakili pembuat (dicatat "diwakili"). | F1 |
| Q-19 | Apa daftar kategori pengeluaran yang dipakai sekarang (contoh baris: BBM, Penginapan, Makan)? | Kategori diisi per baris dan dipakai di laporan dan mapping akun. | Material, Upah, Alat, Transport, Operasional + BBM, Penginapan, Konsumsi, Service Kendaraan. | F1 |

## C. Persetujuan & tanda tangan (M04)

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-06 | Dokumen kebutuhan v1.0 hanya punya satu langkah "Menunggu Owner". Form punya rantai **Diketahui Oleh → Approval**. Apakah urutannya memang: diketahui dulu, baru approval? Apakah "Approval" selalu Owner? (Di contoh approval oleh "sari".) | Menentukan status dan siapa menerima notifikasi pada tiap langkah. | Urutan: Diketahui (bila aturan mewajibkan) → Approval. Approver dari aturan approval, default Owner. **TERJAWAB (user 2026-09-25):** "Diketahui" adalah **approval oleh level Direktur**, lalu **Finance meng-approve**; PM tidak punya hak approval. Usulan urutan Direktur → Finance untuk semua nominal (ADR 0013, konfirmasi di GATE 1 G1-2). | F2 |
| Q-07 | Siapa yang mengisi "**Diketahui Oleh**"? PM project, atasan langsung, kepala lokasi operasional, atau orang tertentu? Apakah wajib untuk semua pengajuan? | Menentukan aturan akses dan layar di APK untuk peran tersebut. | PM project, atau penanggung jawab pusat biaya untuk pengajuan operasional. Wajib untuk semua pengajuan. **Kasus khusus TERJAWAB (user 2026-09-24, opsi a):** bila PM/penanggung jawab belum diatur, "Diketahui" dilimpahkan (lihat Q-08). ~~Pertanyaan utama (siapa pengisi "Diketahui" menurut klien) tetap terbuka.~~ **TERJAWAB (user 2026-09-25):** pengisi "Diketahui" = **Direktur** (dan merupakan approval), **bukan PM**; PM hanya memantau pengajuan tim (baca saja). Usulan: Direktur = peran Owner yang ada, diberi label "Direktur" (ADR 0013, GATE 1 G1-1). Pelimpahan F2e ke Owner/Admin hanya berlaku untuk pengajuan lama. | F2 |
| Q-08 | Di contoh, "Diketahui Oleh" diisi **Budi** Hartono, sedangkan pemohon "**Budi**, Doni". Apakah ini orang yang sama? Bolehkah pemohon sekaligus menjadi pihak yang mengetahui? | Aturan v1.0 melarang pemohon meng-approve pengajuannya sendiri; perlu dipastikan apakah larangan juga berlaku untuk "Diketahui". | Tidak boleh: pemohon dan pembuat tidak bisa mengisi posisi Diketahui maupun Approval pada pengajuan yang sama. **Kasus khusus TERJAWAB (user 2026-09-24, opsi a):** bila PM/penanggung jawab adalah pemohon/pembuat (atau belum diatur), "Diketahui" dilimpahkan ke Owner yang memenuhi syarat, bila tidak ada ke Admin — bukan pemohon/pembuat, dan orang yang mengetahui tidak boleh sekaligus menjadi approver. Pelimpahan ditetapkan saat pengajuan dikirim, tercatat di log (`acknowledge_delegated`) dan PDF menulis "(dilimpahkan)". Bila tidak ada yang memenuhi syarat, pengajuan tetap ditolak (409). Nama pengisi "Diketahui" menurut klien tetap ditanyakan (Q-07). **Diperbarui (user 2026-09-25, ADR 0013):** larangan pemohon/pembuat tetap berlaku; bila satu-satunya Direktur atau Finance adalah pemohon/pembuat, usulan: posisi itu dilewati dan tercatat, minimal satu keputusan independen tetap wajib (konfirmasi GATE 1 G1-2). | F2 |
| Q-09 | Apakah "**Dibuat Oleh**" selalu admin (seperti Citra di contoh)? Peran apa saja yang boleh membuat pengajuan atas nama orang lain? | v1.0 tidak memberi Admin akses ke pengajuan. | Staff/PM membuat untuk dirinya sendiri; Admin dan Finance boleh membuat atas nama pemohon. | F1 |
| Q-10 | Pemohon ada dua (Budi, Doni) tetapi hanya ada satu tanda tangan. Apakah setiap pemohon wajib tanda tangan sendiri? | Menentukan apakah pengajuan menunggu konfirmasi semua pemohon sebelum diproses. | Cukup pemohon pertama (atau pembuat, bila pemohon tidak punya akun). Pemohon lain hanya dinotifikasi. | F2 |
| Q-15 | Bagaimana cara tanda tangan digital: (a) unggah gambar tanda tangan sekali di profil lalu dipakai otomatis, (b) tanda tangan di layar HP setiap kali menyetujui, atau keduanya? | Menentukan layar APK dan tingkat keabsahan jejak persetujuan. | Keduanya: gambar profil sebagai default; approver boleh menggambar ulang di layar. Setiap tanda tangan disertai nama, waktu server, dan perangkat. | F2 |
| Q-31 | Berapa ambang nominal untuk approval berjenjang (mis. > Rp 10 juta perlu dua approver)? Siapa approver kedua? | Aturan approval harus diisi sebelum go-live. | Satu approver (Owner) untuk semua nominal sampai klien menentukan ambang. **Sebagian terjawab (user 2026-09-25):** approver = Direktur (posisi Diketahui) lalu Finance; **ambang nominal tetap terbuka** (usulan: tanpa ambang saat go-live, ADR 0013 O-4). | F2 |
| Q-38 | Bila Owner/approver berhalangan (cuti, sakit), apakah boleh didelegasikan? Kepada siapa? | Mencegah pengajuan macet. | Belum ada delegasi di rilis awal; Admin bisa mengubah aturan approval sementara (tercatat di log). **Menjadi penting (2026-09-25):** dengan alur ADR 0013 semua pengajuan menunggu Direktur; **memblokir go-live** sampai jumlah Direktur/pengganti jelas (GATE 1 G1-5). | F2 |

## D. Transfer & verifikasi nota (M05, M06)

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-12 | Untuk reimburse, kapan Finance memeriksa nota: **sebelum** Owner menyetujui (Owner melihat nota yang sudah dicek), atau **sesudah** disetujui dan sebelum transfer? | Menentukan urutan status. Bila sesudah approval dan ada nota ditolak, pengajuan mungkin perlu disetujui ulang. | Sesudah approval, sebelum transfer. Bila nominal berubah karena nota ditolak, pengajuan kembali ke approval. | F2 |
| Q-13 | Bila nota sedikit berbeda dari nilai yang diajukan (contoh: hotel diajukan Rp 677.000, nota Rp 676.876, selisih Rp 124), yang ditransfer nilai pengajuan atau nilai nota? | Menentukan nominal transfer reimburse dan pencatatan kas. | Selisih dalam toleransi: transfer sesuai nilai yang disetujui. Di luar toleransi: dikembalikan ke pemohon untuk revisi. | F2 |
| Q-14 | Berapa **toleransi pembulatan** selisih nota vs baris yang dianggap wajar? Per baris atau per pengajuan? Rupiah tetap atau persentase? | Terlalu ketat menghasilkan terlalu banyak peringatan; terlalu longgar menyembunyikan selisih. | Rp 1.000 per baris (bisa diubah di setting). | F2 |
| Q-21 | Nota dianggap **ganda** bila nomor nota + toko + nominal sama. Apakah perlu juga deteksi foto yang sama persis? Berapa lama ke belakang dicek? | Mencegah satu nota dipakai dua kali. | Nomor + toko + nominal, dicek terhadap semua pengajuan yang tidak dibatalkan/ditolak, tanpa batas waktu; ditambah deteksi foto identik. | F2 |
| Q-26 | Perlukah pajak di nota dicatat terpisah (contoh: pajak restoran Rp 15.500 di nota Soto)? | Berpengaruh ke pencatatan akuntansi dan mapping ke Odoo nanti. | Tidak; nota dicatat total saja. | F2 |
| Q-36 | Apakah ada saldo awal akun kas, pengajuan yang sedang berjalan, atau data lama yang perlu dimasukkan saat go-live? | Menentukan kebutuhan impor data. | Hanya saldo awal akun kas dan master (karyawan, rekening, kendaraan) yang diimpor dari Excel. | F6 |

## E. Penomoran & cetak (M14, M16)

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-17 | Pada nomor `228/PB-DRMS/20/IX/2026`: apakah "20" = tanggal dokumen? Apakah nomor urut 228 direset per tahun, per bulan, atau terus berlanjut? Nomor urut berapa yang dipakai saat go-live (melanjutkan nomor manual)? | Nomor harus unik dan sesuai kebiasaan arsip klien. | "20" = tanggal dokumen; **nomor urut tidak pernah direset, go-live melanjutkan dari 229** (keputusan user 2026-09-23 — tetap bisa diubah lewat setting bila klien menjawab lain). | F1 |
| Q-18 | Apakah Uang Muka dan Reimburse memakai satu seri nomor "PB" yang sama? Apakah transfer, LPJ, kas masuk/keluar, laporan progress, dan addendum juga perlu format gaya klien? | Menentukan jumlah seri penomoran. | Satu seri PB untuk kedua jenis. Dokumen lain memakai format v1.0 (`TRF/YYMM/####`, dll.). | F1 |
| Q-32 | Mohon file **logo** DRMS resolusi tinggi dan contoh **kop** surat resmi (alamat, telepon) untuk PDF. Apakah perlu stempel? | Logo di contoh adalah gambar berukuran kecil; PDF resmi butuh aset asli. | Logo dari form contoh sementara; tanpa stempel; kop berisi nama perusahaan saja. | F2 |
| Q-16 | Apakah PDF Pengajuan Biaya perlu bisa diunduh/dibagikan dari APK, atau cukup dari web? | Menentukan fitur APK. | Cukup dari web; APK hanya menampilkan status dan detail. | F4 |

## F. Master data (M14, M17)

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-20 | Mohon daftar **satuan** yang biasa dipakai, dan satuan wajar per kategori. Contoh: BBM ditulis "1 bulan", padahal struk menunjukkan satu kali isi 24,80 liter. Apakah "bulan" memang dimaksudkan (jatah BBM bulanan)? | Satuan dipilih dari daftar, dan satuan tak wajar ditandai untuk Finance. | Liter, kali isi, kamar, malam, porsi, orang, unit, paket, bulan, LS (lumpsum). BBM wajar: liter, kali isi. | F1 |
| Q-22 | Mohon daftar **kendaraan/unit** (plat, jenis). Apakah plat DA1234XY di struk Pertamina adalah Hilux yang disebut di baris BBM? Judul form menyebut "Service Tronton" tetapi tidak ada baris service; apakah biaya service ditagihkan di pengajuan lain? | Biaya per kendaraan hanya akurat bila baris ditautkan ke unit yang benar. | Admin mengisi daftar kendaraan dari Excel. Tautan kendaraan per baris, wajib untuk kategori BBM dan Service Kendaraan. | F1 |
| Q-23 | Mohon daftar **pusat biaya / lokasi operasional** (contoh: "Ops Palangka Banjar") beserta penanggung jawabnya. Siapa yang boleh melihat pengajuan per pusat biaya? | Pengajuan operasional tidak terkait project konstruksi; akses dan laporan butuh daftar ini. | Admin mengisi daftar; penanggung jawab dan karyawan yang ditugaskan bisa melihat; Finance/Owner melihat semua. | F1 |
| Q-24 | Apakah pusat biaya punya **anggaran** seperti RAB project? | Owner melihat "dampak anggaran" saat approve; tanpa anggaran indikator ini tidak bisa dihitung. | Tidak ada anggaran untuk pusat biaya di rilis awal; layar approval menampilkan "tanpa anggaran" dan total biaya bulan berjalan. | F2 |
| Q-25 | Apakah DRMS sudah punya **daftar akun (COA)** yang dipakai akuntan? Apakah kategori pengeluaran perlu dipetakan ke akun sekarang? | Diperlukan untuk laporan dan untuk mirror ke Odoo. | Field mapping akun disediakan tetapi boleh kosong sampai COA diberikan. | F1 |

## G. Integrasi Odoo (M18)

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-27 | Kapan rencana pindah ke Odoo? Modul Odoo apa yang akan dipakai (akuntansi penuh, expense, project, absensi, armada)? Setelah pindah, apakah ProyekKas tetap dipakai sebagai aplikasi lapangan? | Menentukan data mana yang dicerminkan lebih dulu dan kapan mirror dibangun. | Mirror satu arah dibangun setelah rilis utama; urutan: master (karyawan, satuan, kendaraan, pusat biaya, project) → pengajuan & nota → kas. | F7 |

## H. Absensi & jam kerja (M11)

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-29 | Apakah ada staff lapangan yang **tidak punya HP** (atau HP bukan Android)? Berapa orang? | Menentukan kebutuhan fitur "diabsenkan oleh PM" (US-14) dan dukungan perangkat. | Ada; PM bisa mengabsenkan dengan foto dari HP PM. Hanya Android yang didukung. **Catatan 2026-09-25:** fitur "diabsenkan PM" (US-14) dibangun untuk go-live; jumlah staff tanpa HP tetap ditanyakan. | F5 |
| Q-30 | Berapa **jam kerja** standar, toleransi terlambat, dan hari kerja? Apakah kerja hari Minggu/libur umum biasa terjadi? (Form contoh bertanggal Minggu, 20 Sep 2026.) | Rekap absensi dan pengingat bergantung pada jadwal. | 08.00–17.00 WITA, Senin–Sabtu, toleransi 15 menit; absen di hari libur tetap diterima dan ditandai. | F5 |
| Q-33 | Berapa lama **selfie absensi** disimpan? Siapa yang boleh melihatnya? | Selfie adalah data pribadi (UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi); menyimpan tanpa batas menambah risiko dan penggunaan disk. | Disimpan 12 bulan lalu dihapus otomatis (data absensinya tetap); hanya PM tim, Finance, Owner, Admin yang bisa melihat. **Catatan 2026-09-25:** fitur retensi wajib di go-live (user); **lama retensi tetap menunggu klien** dan memblokir go-live (UU PDP). | F5 |

## I. Pengguna, volume & perangkat

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-34 | Perkiraan jumlah pengguna per peran, jumlah pengajuan dan nota per bulan, jumlah project aktif? | Server punya sisa kapasitas terbatas; perkiraan disk untuk foto bergantung pada volume. | 30 pengguna, 100 pengajuan/bulan, 300 nota/bulan, 10 project aktif. | F1 |
| Q-37 | Apakah setiap pengguna punya email? Login memakai email, nomor HP, atau username? | Akun dikelola di Keycloak; reset password biasanya lewat email. | Username + password; email opsional; reset password oleh Admin bila tidak ada email. | F1 |

## J. Aplikasi HP & notifikasi (dari ADR 0010 & 0011)

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-39 | Apakah PM perlu membuat **laporan progress (dengan foto) saat offline**? | Menentukan apa saja yang masuk antrian offline di HP. | Ya, disimpan sebagai draft lalu dikirim saat online. **TERJAWAB (user 2026-09-25):** ya, laporan progress offline wajib di go-live (epik E4). | F4 |
| Q-40 | Apakah absensi di **lokasi operasional** (pusat biaya, mis. "Ops Palangka Banjar") juga memakai geofence? | Pusat biaya perlu koordinat + radius bila ya. | Ya, pusat biaya bisa diberi koordinat + radius (opsional per lokasi). **TERJAWAB (user 2026-09-25):** geofence pusat biaya masuk cakupan go-live (epik E6); koordinat per lokasi tetap dari klien (Q-23). | F5 |
| Q-41 | Bolehkah **foto nota diambil dari galeri** (mis. screenshot bukti pesan hotel Traveloka), atau wajib kamera? | Form contoh memakai screenshot Traveloka sebagai bukti hotel. | Nota boleh dari galeri; **selfie absensi wajib kamera depan**. | F4 |
| Q-42 | Untuk **absensi offline**, jam mana yang dipakai sebagai jam masuk resmi: perkiraan server (dari jam internal HP yang tidak bisa diubah user) atau jam HP dengan tinjauan PM? | Jam HP bisa dimanipulasi; berpengaruh ke upah. | Perkiraan server; bila tidak tersedia, jam HP ditandai "perlu tinjauan PM". | F4 |
| Q-43 | **HP ter-root**: cukup diperingatkan dan ditandai, atau absensi diblokir? | Deteksi root bisa diakali dan bisa mengunci staff yang sah. | Diperingatkan + ditandai di data absensi; **lokasi palsu tetap diblokir**. | F4 |
| Q-44 | Akun Google milik siapa yang dipakai untuk **proyek Firebase** (push notification)? | Pemilik akun mengontrol notifikasi & kredensial. | Akun perusahaan DRMS; tim diberi akses terbatas. | F4 |
| Q-45 | Apakah DRMS keberatan memakai **layanan Google (FCM)** untuk notifikasi? Isi notifikasi tidak memuat data pribadi atau nominal. | Alternatif tanpa Google membebani baterai/UX staff dan butuh aplikasi tambahan. | Memakai FCM. | F4 |
| Q-46 | Siapa yang menyiapkan **pemberitahuan privasi untuk karyawan** (selfie, lokasi, notifikasi via Google)? | Kewajiban UU PDP No. 27/2022. | Tim menyiapkan draf, DRMS (HR/legal) menyetujui. | F4 |

## K. Alur approval baru (ADR 0013, ditambahkan 2026-09-25)

| No | Pertanyaan | Kenapa penting | Usulan default | Blok |
|---|---|---|---|---|
| Q-47 | Siapa saja yang berperan **Direktur** (pemberi "Diketahui"/approval) dan **Finance** (approval), berapa orang masing-masing? Apakah Direktur sama dengan Owner/pemilik? | Satu Direktur berarti semua pengajuan berhenti saat ia berhalangan; aturan "satu orang satu posisi" butuh orang berbeda untuk Diketahui dan Approval. | Direktur = peran Owner yang ada (label "Direktur"); minimal 2 orang Direktur atau pengganti bernama; minimal 1 Finance selain yang biasa mengajukan. | Go-live |
| Q-48 | Label kotak tanda tangan PDF: tetap "Diketahui Oleh" / "Approval" seperti form, atau diganti "Disetujui Direktur" / "Disetujui Finance"? | Kesesuaian dengan arsip kertas klien. | Tetap seperti form; nama Direktur di "Diketahui Oleh", nama Finance di "Approval". | Tidak memblokir |
| Q-49 | Addendum RAB (T12): cukup disetujui Direktur, atau Direktur lalu Finance seperti pengajuan biaya? | Menentukan aturan approval `budget_addendum`. | Direktur saja; Finance menerima notifikasi. | Tidak memblokir |
| Q-50 | Bolehkah Finance yang meng-approve sebuah pengajuan juga yang mencatat transfernya? | Pemisahan tugas vs ukuran tim. | Boleh (tercatat di audit, ada peringatan di layar); bila ada ≥ 2 Finance bisa diwajibkan berbeda. | Tidak memblokir |

