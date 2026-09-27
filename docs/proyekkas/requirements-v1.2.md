# ProyekKas — Kebutuhan Pengembangan v1.2 (Multi-perusahaan / multi-PT)

Klien: grup DRMS (PT Double Rezki Makmur Sejahtera dan PT lain dalam grup) · Tanggal: 27 September 2026 · Status: **draf untuk review user & klien (gerbang MC0)**
Penyusun: Analyst (fase MC0, dokumen saja)

Sumber:
- Keputusan user 2026-09-27 (multi-PT, lihat §1) dan desain yang disetujui user → `adr/0016-multi-company.md`
- `requirements-v1.1.md` (dasar dokumen ini), `open-questions-client.md` §L (Q-51…Q-61)
- Kode `develop` @ `74cf7f2` (bukti per baris ada di ADR 0016 dan `mc/impact-inventory.md`)

**Hubungan dengan v1.1.** Dokumen ini adalah **tambahan bertingkat (delta)** terhadap v1.1, sama seperti v1.1 terhadap
v1.0 dicatat dengan changelog. Semua isi v1.1 **tetap berlaku**, kecuali bagian yang di sini ditandai
`[Diubah v1.2]`; aturan baru ditandai `[Tambahan v1.2]`. Setiap aturan v1.1 yang berbunyi "semua" (*all*) dibaca
"semua **dalam PT tempat peran itu dimiliki**" (§3).

Penanda:
- `[Keputusan user 2026-09-27]`: keputusan user yang mengikat.
- `[Usulan]`: nilai/aturan usulan Analyst yang belum dikonfirmasi klien (lihat `Q-xx`).
- Nama PT dan orang selain DRMS di dokumen ini **fiktif**: "PT Contoh Satu" (kode `CS1`), "PT Contoh Dua" (kode `CS2`),
  pengguna "Rina Uji", "Andi Uji", "Budi Uji".

---

## Changelog v1.1 → v1.2

| # | Perubahan | Bagian | Sumber |
|---|---|---|---|
| 1 | Satu aplikasi ProyekKas untuk **beberapa PT**; satu akun login bisa mengelola lebih dari satu PT dengan **peran berbeda per PT** (matriks peran pengguna × PT). | 1, 3 | [Keputusan user 2026-09-27] |
| 2 | **1 data karyawan = 1 PT.** Orang yang bekerja di 2 PT punya 2 data karyawan tetapi 1 akun login. | 1, 2 | [Keputusan user 2026-09-27] |
| 3 | Master **bersama** semua PT: bank, satuan (UoM), hari libur nasional. **Semua master lain per PT** (kategori/COA, vendor, klien, akun kas, kendaraan, project, pusat biaya, jadwal kerja, aturan approval, penomoran, tutup buku, identitas/kop/logo/zona waktu/flag operasional). | 2 | [Keputusan user 2026-09-27] |
| 4 | **Konsolidasi penuh:** daftar, kotak persetujuan, dashboard dan laporan boleh menampilkan beberapa PT sekaligus (rincian per PT + total gabungan, satu mata uang IDR). **Perubahan data selalu di dalam satu PT** dan dicek terhadap peran pengguna di PT dokumen tersebut. | 4, 5 | [Keputusan user 2026-09-27] |
| 5 | Setting perusahaan (`company-settings`) dipecah: identitas + setting operasional → master baru **Perusahaan** (`companies`); setting aplikasi (versi APK, target resize foto, kop grup) tetap global. | 2, 6 | ADR 0016 §1 |
| 6 | Peran tidak lagi disimpan per pengguna di Keycloak: Keycloak hanya identitas + peran kasar `pk-user` (boleh login). Peran per PT disimpan di ProyekKas (`company-memberships`). US-32 diubah. | 3, 12 | ADR 0016 §2 |
| 7 | Penomoran, tutup buku, aturan approval, job terjadwal dan kop PDF berlaku **per PT**. | 7, 8, 9, 10 | ADR 0016 §4–§7 |
| 8 | User story baru US-MC-01…US-MC-19. | 12 | Analyst |
| 9 | Dikerjakan **sebelum go-live** (belum ada data produksi). | — | [Keputusan user 2026-09-27] |

---

## 1. Konsep [Tambahan v1.2]

| Istilah | Arti | Aturan |
|---|---|---|
| **PT / Perusahaan** | Badan usaha dalam grup (master `companies`). PT #1 = DRMS. | Kode singkat unik 2–16 huruf besar/angka (token `{COMPANY}`, mis. `DRMS`, `CS1`). PT nonaktif tidak bisa dipilih untuk transaksi baru; datanya tetap bisa dibaca. |
| **Akun login** | Satu orang = satu akun (`users`), login lewat Keycloak realm `drms`. | Akun perlu peran Keycloak `pk-user` dan minimal satu **keanggotaan PT** aktif untuk bisa memakai aplikasi. |
| **Keanggotaan PT** (`company-memberships`) | Baris "akun × PT": peran di PT itu (Staff/PM/Finance/Direktur/Admin, boleh lebih dari satu) + data karyawan di PT itu + aktif. | Maksimal satu keanggotaan per akun per PT; satu data karyawan hanya boleh dipakai satu akun. Karyawan harus milik PT yang sama. |
| **Data karyawan** (`employees`) | Selalu milik **satu** PT (wajib). | Orang di 2 PT = 2 data karyawan (kode, rekening, absensi, jadwal, penugasan masing-masing). |
| **Pilihan PT** | PT yang sedang ditampilkan (satu, beberapa, atau semua PT tempat pengguna menjadi anggota). | Hanya mempersempit tampilan; tidak pernah menambah hak. |
| **Admin grup** [Usulan] | Penanda khusus pada akun (bukan peran Keycloak). | Membuat/menonaktifkan PT dan mengubah setting aplikasi. Admin biasa hanya mengelola PT tempat ia Admin. (Q-60) |

## 2. Data bersama vs per PT [Tambahan v1.2] [Diubah v1.2 atas §6 v1.1]

| Kelompok | Master / transaksi (slug) | Cakupan |
|---|---|---|
| Bersama (grup) | `banks`, `uoms`, `holidays` | Satu daftar untuk semua PT. Diubah oleh peran yang sama seperti v1.1, dimiliki **di PT mana pun**; tercatat di audit log. |
| Setting aplikasi | `company-settings` (global, isinya dikurangi) | Versi APK minimum/terbaru, URL unduh, umur sesi offline, target resize foto di perangkat, **nama/logo/kop grup** untuk laporan konsolidasi. Diubah oleh Admin grup. |
| Identitas & setting PT | `companies` (baru) | Nama, nama legal, kode singkat, logo, kop PDF, alamat, telepon, zona waktu, radius geofence default, batas laporan terlambat, ambang anggaran & progress, toleransi & umur nota, tutup otomatis reimburse, batas LPJ, flag sinkronisasi APK (draft, absensi, progress), jadwal kerja default, retensi selfie, pengingat terjadwal, notifikasi status. |
| Master per PT | `projects`, `project-stages`, `stage-templates`, `budget-lines`, `cost-centers`, `clients`, `vendors`, `expense-categories` (termasuk COA), `cash-in-sources`, `cash-accounts`, `vehicles`, `work-schedules`, `approval-rules`, `document-sequences`, `employees`, `employee-bank-accounts`, `team-assignments`, `period-closings` | Kolom PT wajib. Kode unik **per PT** (dua PT boleh sama-sama punya project `P-001`). Plat kendaraan tetap unik di seluruh grup [Usulan, Q-61]. |
| Transaksi per PT | `expense-requests` (+ baris, snapshot), `approvals`, `receipts`, `receipt-flags`, `transfers`, `cash-entries`, `settlements`, `budget-addenda`, `progress-reports`, `attendances`, `attendance-corrections` | PT diambil dari induknya (project/pusat biaya/akun kas/karyawan), tidak bisa diubah. Server dan database menolak referensi ke data PT lain. |
| Per pengguna | `users`, `devices`, `web-sessions`, tanda tangan | Tidak terikat PT. Notifikasi dan audit log diberi label PT bila menyangkut dokumen PT. |

## 3. Matriks peran per PT [Diubah v1.2 atas §4 v1.1]

**Aturan dasar.** Matriks §4 v1.1 (peran × modul × aksi) tetap sama, tetapi **berlaku per PT**:
- Peran dicek terhadap **PT dokumen**. Finance di PT A tidak punya hak Finance di PT B kecuali juga Finance di PT B.
- Cakupan *all* = semua data **PT tempat pengguna memegang peran itu** (dan yang termasuk pilihan PT).
  *team* / *assigned* / *own* dihitung per PT dari data karyawan pengguna di PT itu.
- Aturan "satu orang satu posisi" dan larangan pemohon/pembuat memutuskan (ADR 0013) tetap berlaku; "satu-satunya
  Direktur/Finance" dihitung **di PT dokumen**.

**Baris baru matriks** (kode aksi sama dengan v1.1):

| Modul | Staff | PM | Finance | Direktur | Admin | Admin grup [Usulan] |
|---|---|---|---|---|---|---|
| Master Perusahaan (identitas & setting PT) | – | – | R (PT sendiri) | R/U (PT sendiri) | R/U (PT sendiri) | C/R/U/nonaktif semua PT |
| Matriks peran & keanggotaan PT | – | – | – | R (PT sendiri) | C/R/U untuk PT tempat ia Admin (tidak bisa memberi peran di PT lain) | C/R/U semua PT |
| Pemetaan karyawan ↔ PT ↔ akun | – | – | – | R | C/R/U (PT sendiri) | C/R/U |
| Master bersama (bank, satuan, libur) | sesuai v1.1 | sesuai v1.1 | sesuai v1.1, dicek "di PT mana pun" | sesuai v1.1 | sesuai v1.1 | C/R/U |
| Setting aplikasi (versi APK, resize, kop grup) | – | – | – | R | R | R/U |

**Contoh matriks pengguna × PT (fiktif):**

| Pengguna | DRMS | CS1 — PT Contoh Satu | CS2 — PT Contoh Dua |
|---|---|---|---|
| Rina Uji | Direktur | Finance | – |
| Andi Uji | Finance, Admin | Finance | Finance |
| Budi Uji | Staff (karyawan `DRMS-014`) | PM (karyawan `CS1-003`) | – |

Akibatnya: Rina menyetujui "Diketahui" pengajuan DRMS dan meng-approve (Finance) pengajuan CS1, tetapi tidak
bisa mencatat transfer DRMS. Budi punya dua data karyawan; pengajuan yang ia buat di CS1 memakai karyawan `CS1-003`
dan rekening CS1-nya.

## 4. Pilihan PT (konteks akses) [Tambahan v1.2]

- **Web:** pemilih PT di bar modul (centang beberapa PT atau "Semua PT"), disimpan di cookie sesi server. Default =
  semua PT keanggotaan. Pilihan terlihat di setiap halaman (chip "PT: DRMS, CS1").
- **APK:** pemilih PT (satu PT atau "Semua PT") di bilah atas / Profil. Membuat draft, laporan progress, absensi
  selalu di satu PT (ditanya bila "Semua PT" aktif; absensi mengikuti PT project/pusat biaya).
- **API:** header `X-Company-Ids` (daftar id PT). Server selalu mengiriskan dengan keanggotaan aktif; id PT yang bukan
  keanggotaan → ditolak 403.
- **Membuat data:** bila pilihan berisi lebih dari satu PT, formulir menampilkan field **PT** wajib (default: PT
  pertama yang ditandai).

## 5. Aturan konsolidasi per layar & laporan [Tambahan v1.2]

Umum: kolom/label **PT** (kode singkat) tampil di setiap daftar bila pilihan > 1 PT; filter PT tersedia; total
gabungan hanya dijumlahkan dalam IDR; angka per PT selalu bisa dibuka. Klik angka membuka daftar dengan filter PT
yang sama.

| Layar / laporan | Konsolidasi | Aturan |
|---|---|---|
| Daftar koleksi (Pengajuan, Transfer, Kas, Nota, Project, master per PT, …) | Ya | Kolom PT + filter PT; hanya PT tempat pengguna berhak membaca koleksi itu. |
| Kotak Persetujuan (web `/admin/persetujuan`, APK) | Ya | Satu daftar untuk semua PT pilihan; tiap baris bertanda PT; tombol Setujui/Tolak dicek terhadap peran di PT baris itu. |
| Antrian Transfer, Verifikasi LPJ | Ya (daftar) | Mencatat transfer/verifikasi = satu dokumen, satu PT; akun kas sumber hanya dari PT dokumen. |
| Kas (buku kas, catat kas, void) | Buku kas: ya, per akun (akun milik satu PT) | Catat/void di satu PT; saldo gabungan = Σ saldo per PT (rincian per PT wajib tampil). |
| Tutup buku | Tidak | Selalu satu PT; layar menampilkan status periode per PT. |
| Beranda Direktur / Finance | Ya | Kartu KPI: total gabungan + rincian per PT; grafik arus kas: satu seri per PT atau gabungan (pilihan); tabel anggaran project bertanda PT. |
| Beranda PM / Staff | Ya | Hanya project/pusat biaya tim (PM) atau milik sendiri (Staff) di PT tempat peran itu dimiliki. |
| Laporan (rekap kas, buku kas, pengeluaran per kategori, anggaran project, rekap pengajuan, kelengkapan, biaya kendaraan, absensi) | Ya | Parameter PT (satu/beberapa); hasil dikelompokkan per PT + baris total; kategori digabung **per PT** (kategori tidak dijumlahkan lintas PT kecuali kode sama dan pengguna memilih "gabungkan kategori berkode sama" [Usulan]). |
| Audit log global | Ya | Filter PT; baris tanpa PT (master bersama, akun) terlihat oleh Admin grup/Admin. |
| Notifikasi | Ya | Semua notifikasi pengguna; label PT pada notifikasi dokumen. |
| PDF Pengajuan Biaya | Tidak | Selalu satu dokumen = kop PT dokumen. |
| Export CSV/XLSX | Ya | Kolom `PT` (kode) di setiap baris bila > 1 PT. |

## 6. Kop & logo [Tambahan v1.2]

| Dokumen | Kop |
|---|---|
| PDF Pengajuan Biaya | Logo + kop + alamat/telepon **PT dokumen**; nama perusahaan = nama PT; subjek memakai kode PT (`229-PB DRMS-…`, `1-PB CS1-…`). |
| Laporan/Export satu PT | Kop PT tersebut. |
| Laporan/Export beberapa PT | **Kop grup** (nama/logo/kop grup dari setting aplikasi; Q-56), ditambah daftar PT yang tercakup dan subtotal per PT. Bila kop grup kosong: teks "Laporan gabungan: DRMS, CS1". |

## 7. Penomoran per PT [Diubah v1.2 atas US-45 dan §6 v1.1]

- Setiap PT punya set penomoran sendiri (7 jenis dokumen), counter sendiri, nomor awal sendiri.
- `{COMPANY}` = kode singkat PT dokumen.
- Contoh pada tanggal 27-09-2026:

| PT | Pengajuan (PB, tidak pernah reset) | Transfer (reset bulanan) |
|---|---|---|
| DRMS | `229/PB-DRMS/27/IX/2026` (melanjutkan seri kertas, Q-17) | `TRF/2609/0001` |
| CS1 — PT Contoh Satu | `1/PB-CS1/27/IX/2026` (seri baru; nomor awal: Q-54) | `TRF/2609/0001` (boleh sama dengan DRMS; dibedakan kolom PT) |

- Nomor unik **per PT**; uji konkurensi v1.1 (50 pengajuan paralel) diulang dengan 2 PT paralel → nomor tiap PT
  unik dan tanpa lompatan, dan counter PT lain tidak berubah.
- Apakah TRF/LPJ/KM/KK/LP/ADD juga memakai kode PT (mis. `TRF-CS1/2609/0001`): Q-54 (konfigurasi saja).

## 8. Tutup buku per PT [Diubah v1.2 atas §7 T6–T8]

Tutup/buka buku dilakukan per PT (Finance tutup, Direktur buka — di PT itu). Periode tertutup di PT A tidak
mengunci PT B. Database menolak posting kas/transfer bertanggal ≤ tanggal kunci **PT baris itu**.

## 9. Approval per PT [Diubah v1.2 atas US-34, US-42, ADR 0013]

Aturan approval dibuat per PT; pemegang posisi (Direktur = `pk-owner`, Finance) dan penerima notifikasi diambil dari
anggota aktif **PT dokumen**. Pengguna bernama di aturan harus anggota PT itu dengan peran Direktur/Finance. Alur
Direktur → Finance tidak berubah. Aturan per PT dari klien: Q-57 (default: salinan aturan DRMS).

## 10. Notifikasi & job terjadwal [Diubah v1.2 atas US-11, M12]

Pengingat harian, tutup otomatis reimburse dan retensi selfie berjalan per PT dengan setting PT itu (jam kirim,
batas hari, retensi). Satu kali jalan per hari **per PT**. Penerima = anggota PT dengan peran terkait. Notifikasi
membawa kode PT ("[CS1] 12/PB-CS1/… menunggu persetujuan Anda").

## 11. Impor data go-live [Diubah v1.2 atas Q-36 / runbook impor]

Workbook impor mendapat sheet **Perusahaan** (kode, nama, nama legal, alamat, telepon, zona waktu) dan kolom
**`kode_pt`** di setiap sheet data per PT (Karyawan, Rekening, PusatBiaya, Project, Tahapan, RAB, Kendaraan,
Penugasan, AkunKas, Kategori, …). Sheet Pengguna → sheet **AksesPT** (username, kode_pt, peran, kode_karyawan).
Bank dan Satuan tetap tanpa PT.

## 12. User story [Tambahan v1.2]

"Server menolak" = API mengembalikan error, tidak ada perubahan data, dibuktikan test API (sama dengan v1.1).
"Isolasi" = pengguna tanpa keanggotaan PT X mendapat **404** (bukan data) untuk dokumen PT X.

| ID | User story | Kriteria penerimaan |
|---|---|---|
| US-MC-01 | Sebagai Admin grup, saya ingin mengelola master Perusahaan (PT). | Field §2 baris "Identitas & setting PT". Kode singkat unik, format `^[A-Z0-9]{2,16}$`, tidak bisa diubah setelah ada dokumen bernomor. PT baru mendapat salinan default: 7 penomoran, aturan approval Direktur → Finance, jadwal kerja default (dari DRMS, bisa diubah). Nonaktif = tidak bisa dipilih untuk data baru. Semua perubahan tercatat di audit log (lama → baru). |
| US-MC-02 | Sebagai Admin PT, saya ingin mengatur peran setiap pengguna di PT saya (matriks pengguna × PT × peran). | Layar matriks (wireframe `mc/wireframes.md` §2). Admin PT A hanya bisa mengubah kolom PT A; mencoba mengubah PT B → server menolak (403 + `access_denied`). Perubahan berlaku pada permintaan berikutnya (tanpa menunggu token). Tercatat `role_change` dengan PT. Tidak ada peran yang disinkron ke Keycloak; akun baru mendapat `pk-user`. |
| US-MC-03 | Sebagai Admin PT, saya ingin memetakan data karyawan ke PT dan ke akun login. | Karyawan wajib punya PT. Keanggotaan hanya boleh menautkan karyawan dari PT yang sama (server + DB menolak). Satu karyawan hanya untuk satu akun. Satu akun boleh punya karyawan berbeda di PT berbeda. |
| US-MC-04 | Sebagai pengguna web, saya ingin login sekali lalu memilih PT yang ditampilkan (satu, beberapa, semua). | Pemilih PT di bar modul; pilihan tersimpan di sesi. Pilihan hanya berisi PT keanggotaan aktif. Mengubah cookie/permintaan untuk PT lain → 403, tidak ada data PT lain. Chip PT tampil di setiap halaman. |
| US-MC-05 | Sebagai pengguna APK, saya ingin memilih satu PT atau semua PT, dan melihat menu sesuai peran di PT itu. | `/api/v1/me` mengembalikan daftar PT + peran + kapabilitas per PT. Menu Persetujuan tampil bila di salah satu PT terpilih pengguna Direktur/Finance. Header `X-Company-Ids` dikirim; server menolak PT bukan keanggotaan (403). |
| US-MC-06 | Sebagai Direktur/Finance di beberapa PT, saya ingin satu daftar/kotak persetujuan untuk semua PT saya. | Daftar pengajuan dan kotak persetujuan menampilkan kolom PT + filter PT; hanya PT tempat pengguna berhak. Uji: Rina (Direktur DRMS, Finance CS1) melihat pengajuan DRMS di langkah "Diketahui" dan pengajuan CS1 di langkah Approval, tidak sebaliknya. |
| US-MC-07 | Sebagai pemilik data, saya ingin setiap perubahan hanya berlaku di satu PT dan dicek terhadap peran di PT dokumen. | Approve/transfer/void/tutup buku/verifikasi oleh pengguna yang punya peran itu hanya di PT lain → 403 + `access_denied`. Membuat dokumen dengan project PT A dan akun kas/rekening/kategori PT B → server menolak dan DB menolak (`cross-company reference`). PT dokumen tidak bisa diubah setelah dibuat. |
| US-MC-08 | Sebagai Admin PT, saya ingin penomoran dokumen per PT. | §7; `{COMPANY}` = kode PT dokumen; counter per PT; nomor awal per PT; uji konkurensi 2 PT paralel. |
| US-MC-09 | Sebagai Finance/Direktur PT, saya ingin menutup/membuka buku per PT. | §8; posting bertanggal di periode tertutup PT A ditolak DB; posting PT B di periode yang sama diterima. |
| US-MC-10 | Sebagai Direktur/Finance grup, saya ingin dashboard konsolidasi (per PT + total). | Wireframe `mc/wireframes.md` §5. Setiap kartu: total gabungan + baris per PT; angka rekonsiliasi dengan query SQL per PT dan Σ = total. PM hanya melihat timnya per PT. |
| US-MC-11 | Sebagai Finance/Direktur, saya ingin laporan dan export untuk satu atau beberapa PT dengan kop yang benar. | §5, §6. Export > 1 PT punya kolom PT; PDF > 1 PT memakai kop grup + subtotal per PT; PDF 1 PT memakai kop PT itu. |
| US-MC-12 | Sebagai pemohon, saya ingin pengajuan saya hanya diputuskan dan dinotifikasikan ke Direktur/Finance PT saya. | Pemegang posisi & penerima notifikasi = anggota aktif PT dokumen; aturan "satu-satunya Direktur" dihitung per PT (ADR 0013 revisi). Uji: Direktur DRMS yang bukan anggota CS1 tidak menerima notifikasi CS1 dan mendapat 404 atas pengajuan CS1. |
| US-MC-13 | Sebagai Admin PT, saya ingin master per PT dan master bersama. | §2. Kode unik per PT (dua PT boleh punya kode sama). Dropdown di formulir hanya menampilkan master PT dokumen + master bersama. Aksi "salin dari PT lain" untuk kategori, penomoran, aturan approval, jadwal [Usulan]. |
| US-MC-14 | Sebagai pemilik sistem, saya ingin isolasi data antar PT di semua jalur. | Suite uji isolasi: untuk setiap koleksi per PT dan setiap endpoint `/api/v1` yang memuat id, pengguna PT A saja → 404 atas id PT B (REST, `/api/v1`, file media, PDF, export, laporan). Query laporan PT A tidak berubah saat data PT B ditambah. Header/cookie palsu → 403. |
| US-MC-15 | Sebagai pengelola, saya ingin job terjadwal berjalan per PT dengan setting PT itu. | Pengingat: satu kali per hari per PT pada jam kirim PT; tutup otomatis reimburse & retensi selfie memakai hari/bulan PT; kegagalan satu PT tidak menghentikan PT lain (log per PT tanpa data pribadi). |
| US-MC-16 | Sebagai Admin grup, saya ingin mengimpor data go-live beberapa PT dari satu workbook. | §11; dry-run melaporkan kesalahan per PT; referensi silang PT (mis. project CS1 dengan PM tanpa keanggotaan CS1) ditolak; `nomor_pb_mulai` per PT. |
| US-MC-17 | Sebagai pengguna APK, saya ingin draft dan antrian offline tetap di PT-nya masing-masing. | Draft/outbox/laporan progress lokal menyimpan PT; sinkron dikirim per PT; item yang referensinya milik PT lain → `rejected COMPANY_MISMATCH`, tidak ada data tercampur. Upgrade APK (skema lokal v3) tidak menghilangkan draft lama. |
| US-MC-18 | Sebagai auditor, saya ingin audit log mencatat PT. | Baris audit dokumen per PT membawa PT; filter PT di log global dan tab Riwayat; perubahan master bersama dan akun tanpa PT. |
| US-MC-19 | Sebagai tim, saya ingin data staging yang ada dipindahkan ke PT #1 DRMS tanpa kehilangan data. | Migrasi: semua baris per PT = DRMS; peran lama → keanggotaan DRMS; `users.employee` → keanggotaan; penomoran & counter tetap (PB lanjut 229…); jumlah baris & saldo sebelum = sesudah (uji rekonsiliasi); down migration tersedia sebelum go-live. |

**User story v1.1 yang diubah [Diubah v1.2]:**
- **US-32:** peran diatur **per PT** (US-MC-02); "user nonaktif tidak bisa login" tetap; peran tidak lagi disinkron
  ke Keycloak.
- **US-34 / US-42:** aturan approval dan pemegang posisi per PT (§9).
- **US-45:** penomoran per PT (§7).
- **US-46:** kop PDF = kop PT dokumen (§6).
- **US-25 / US-27 / US-28 / US-52:** laporan & dashboard bisa konsolidasi (§5).

## 13. Kebutuhan non-fungsional tambahan [Tambahan v1.2]

| Topik | Kebutuhan |
|---|---|
| Isolasi | Pertahanan berlapis: aturan akses (server), kolom PT wajib + trigger database penolak referensi lintas PT, uji isolasi otomatis di CI (US-MC-14). |
| Kinerja | Dashboard/laporan konsolidasi 3 PT dengan volume Q-34 × 3 memenuhi target p95 E9 (< 2 s, sinkron < 5 s). Indeks `(company_id, …)` pada tabel transaksi besar. |
| Zona waktu | Semua PT memakai zona waktu yang sama dengan server (`Asia/Makassar`) pada rilis ini (Q-59). |
| Mata uang | Hanya IDR; tidak ada konversi. |
| Transaksi antar-PT | Di luar cakupan (catat kas keluar di PT A dan kas masuk di PT B secara manual). |
