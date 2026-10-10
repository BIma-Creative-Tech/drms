# UAT staging — Approval pengajuan biaya: Staff → PM project → Direktur → Finance transfer

- **Status:** draf · **Tanggal:** 2026-10-10 · **Basis kode:** branch `feat/approval-pm-direktur` (web, migration
  `20261010_130000_approval_pm_direktur`) + APK **0.4.1**
- **Dasar:** keputusan owner 2026-10-10, `../../adr/0021-approval-pm-direktur.md`, `../../requirements-v1.3.md` §9
  (US-69, US-70). Alur lama (ADR 0013, Direktur → Finance) tetap untuk pengajuan yang sudah diajukan.
- **Lingkungan:** **staging saja**. Produksi menunggu persetujuan owner atas hasil UAT ini.
- **Data:** fiktif. Jangan memakai data karyawan asli.

## Akun dan data uji

| Peran | Akun | Nama tampil | Keterangan |
|---|---|---|---|
| Staff | `staff.uji@proyekkas.test` | Staff Uji | ditugaskan ke PRJ-UJI-01 dan PRJ-UJI-03 |
| PM | `pm.uji@proyekkas.test` | PM Uji | **Project Manager** PRJ-UJI-01; penanggung jawab CC-UJI |
| PM 2 | `pm2.uji@proyekkas.test` | PM Uji Dua | Project Manager PRJ-UJI-02; **penugasan tim sebagai PM** di PRJ-UJI-01 (bukan PM project) |
| Direktur | `owner.uji@proyekkas.test` | Direktur Uji | peran teknis `pk-owner` |
| Finance | `finance.uji@proyekkas.test` | Finance Uji | |
| Admin | `admin.uji@proyekkas.test` | Admin Uji | |

Project: **PRJ-UJI-01** (PM = PM Uji, RAB Rp 100.000.000), **PRJ-UJI-02** (PM = PM Uji Dua), **PRJ-UJI-03**
(**tanpa PM**, hanya untuk skenario AP-08). Pusat biaya **CC-UJI** (penanggung jawab PM Uji). Setiap pemberi keputusan
sudah mengunggah **tanda tangan** di **Profil & tanda tangan** (web) atau membuatnya di APK.

## Hasil

Isi **PASS/FAIL** dan **Catatan** (nomor pengajuan, tangkapan layar, pesan error persis). FAIL → laporkan dengan ID.

## 1. Persiapan oleh Admin (setelah deploy staging)

| ID | US | Prasyarat | Langkah | Hasil yang diharapkan | PASS/FAIL | Catatan |
|---|---|---|---|---|---|---|
| AP-00 | — | Deploy staging selesai | Tim teknis: catat pengajuan yang sedang berjalan di staging (status Menunggu Diketahui / Menunggu Approval) per PT, sebelum aturan diubah. Pilih satu sebagai **R-LAMA** (Menunggu Diketahui (Direktur)) untuk AP-22. | Daftar tercatat di Catatan. | | |
| AP-01 | US-34 | Login Admin | Untuk **setiap PT** (DRMS, LAS, TBK, CS1): pilih PT di tombol PT bar atas → **Proyek → Project**: periksa kolom/isian **Project Manager** setiap project aktif; **Proyek → Data pendukung → Pusat biaya**: periksa **Penanggung jawab**. Isi yang kosong (kecuali PRJ-UJI-03). | Semua project aktif punya PM dan semua pusat biaya punya penanggung jawab (PRJ-UJI-03 sengaja kosong). | | |
| AP-02 | US-34 | AP-01 | **Pengaturan → Aturan approval** → buka **"Default — Direktur lalu Finance (semua nominal)"** PT DRMS. Ubah: **Nama aturan** = `Default — PM project lalu Direktur (semua nominal)`; **Diketahui Oleh** = Wajib; **Pengisi "Diketahui Oleh"** = **PM project (manajer pusat biaya bila tanpa project)**; **Level approval**: level 1 **Peran approver = Direktur**, hapus level Finance. **Alasan** = `Kebijakan owner 2026-10-10: Staff → PM → Direktur → Finance transfer` → Simpan. Ulangi untuk LAS, TBK, CS1. | Tersimpan tanpa error di semua PT; Audit Log mencatat perubahan dengan alasan. | | |
| AP-03 | US-34 | AP-02 | Aturan contoh **"> Rp 10 juta"** (tidak aktif) di setiap PT: ubah dengan cara yang sama (tetap tidak aktif). | Tersimpan; tetap tidak aktif. | | |
| AP-04 | US-30 | AP-02 | Buka aturan **Addendum RAB** — jangan disimpan. Coba (tanpa menyimpan perubahan lain) memilih **Pengisi "Diketahui Oleh"** = PM project → Simpan dengan alasan "uji". | Aturan Addendum tetap Direktur → Finance. Menyimpan "PM project" pada Addendum RAB **ditolak** (pesan error). Batalkan perubahan. | | |
| AP-05 | US-34 | AP-02 | Coba buat aturan pengajuan biaya baru dengan Pengisi = PM project tetapi **Diketahui Oleh = Opsional**, atau dengan level approval peran **PM**. | Keduanya ditolak dengan pesan; tidak tersimpan. | | |

## 2. Alur utama

| ID | US | Prasyarat | Langkah | Hasil yang diharapkan | PASS/FAIL | Catatan |
|---|---|---|---|---|---|---|
| AP-06 | US-69 | AP-02 | **Staff** (APK atau web): buat **Uang Muka** di PRJ-UJI-01, 1 baris Rp 500.000 → **Ajukan**. Catat nomor = **R1**. | Status **Menunggu persetujuan PM**; Giliran = PM Uji. **PM Uji** mendapat notifikasi "Persetujuan PM: R1" (lonceng web/APK). Direktur dan Finance **belum** mendapat notifikasi. PM Uji tidak mendapat notifikasi "Pengajuan tim: R1" ganda. | | |
| AP-07 | US-69 | AP-06 | **PM Uji** web: **Persetujuan** (menu tampil untuk PM) → R1 berlabel **Persetujuan PM** → buka **Rincian baris, nota & flag** → **Setujui** → konfirmasi "Setujui … sebagai PM project?". Lihat juga Beranda PM: kartu **Menunggu tindakan saya** (sebelum menyetujui). | Status **Menunggu persetujuan Direktur**; Giliran = Direktur. **Direktur** mendapat notifikasi. Riwayat mencatat persetujuan PM Uji dengan tanda tangan. | | |
| AP-08 | US-69 | AP-07 | **Direktur** (APK atau web): **Persetujuan** → R1 berlabel **Persetujuan Direktur** → **Setujui**. APK: teks "diteruskan ke Finance untuk transfer". | Status **Disetujui (Antri Transfer)**. Staff mendapat "Disetujui: R1"; **Finance** mendapat "Antri transfer: R1". Finance **tidak** punya tombol Setujui untuk R1. | | |
| AP-09 | US-19 | AP-08 | **Finance** web: **Antrian Transfer** → R1 → **Catat transfer** (akun kas, ref bank, bukti). | Status **Ditransfer**; kotak "Anda juga yang menyetujui" **tidak** muncul. PDF R1: "Diketahui Oleh" = PM Uji, "Approval" = Direktur Uji. | | |
| AP-10 | US-69, US-38 | AP-02 | **Staff**: **Reimburse** di PRJ-UJI-01, 1 baris Rp 150.000 + foto nota → Ajukan (**R2**). PM Uji Setujui, Direktur Setujui. **Finance**: verifikasi nota (valid) → **Verifikasi nota** → **Catat transfer**. | Urutan status: Menunggu persetujuan PM → Menunggu persetujuan Direktur → Disetujui → Nota Terverifikasi (Antri Transfer) → Ditransfer. Finance hanya memverifikasi nota dan mentransfer (tanpa Approval). | | |
| AP-11 | US-69 | AP-02 | **Staff**: Uang Muka di **CC-UJI** (pusat biaya) Rp 200.000 → Ajukan (**R3**). | Status Menunggu persetujuan PM; yang diminta menyetujui = **PM Uji** (penanggung jawab CC-UJI). Lanjutkan Setujui PM → Setujui Direktur → Disetujui. | | |

## 3. Penolakan

| ID | US | Prasyarat | Langkah | Hasil yang diharapkan | PASS/FAIL | Catatan |
|---|---|---|---|---|---|---|
| AP-12 | US-69, US-05 | AP-02 | **Staff**: Uang Muka PRJ-UJI-01 Rp 300.000 (**R4**). **PM Uji**: **Tolak** dengan alasan kosong, lalu "ab", lalu "Belum ada penawaran vendor". | Alasan kosong/terlalu pendek ditolak ("…minimal 3 karakter"). Dengan alasan: status **Ditolak**; alasan tampil di detail (web + APK); Staff mendapat "Ditolak: R4". Direktur tidak mendapat notifikasi. | | |
| AP-13 | US-69, US-05 | AP-02 | **Staff**: Uang Muka PRJ-UJI-01 Rp 350.000 (**R5**). PM Uji **Setujui**. **Direktur**: **Tolak** dengan alasan "Anggaran bulan ini penuh". | Status **Ditolak**; alasan tampil; **Staff** dan **PM Uji** mendapat "Ditolak: R5". Finance tidak mendapat notifikasi. | | |

## 4. Hak memutuskan dan G1

| ID | US | Prasyarat | Langkah | Hasil yang diharapkan | PASS/FAIL | Catatan |
|---|---|---|---|---|---|---|
| AP-14 | US-69, US-17 | AP-02 | **Staff**: Uang Muka PRJ-UJI-01 Rp 100.000 (**R6**), biarkan Menunggu persetujuan PM. Login **PM Uji Dua** (PM PRJ-UJI-02, hanya penugasan tim di PRJ-UJI-01): buka R6 dan **Persetujuan**. (Tim teknis: `POST /api/v1/expense-requests/<id R6>/acknowledge` dengan sesi PM Uji Dua.) | R6 tidak ada di Persetujuan PM Uji Dua, tanpa tombol Setujui/Tolak. API **403**; Audit Log mencatat `access_denied`. Setelah itu PM Uji Setujui → Direktur Setujui (selesai normal). | | |
| AP-15 | US-69 | AP-02 | **PM Uji** membuat Uang Muka untuk **dirinya sendiri** di PRJ-UJI-01 Rp 250.000 → Ajukan (**R7**). | Langsung **Menunggu persetujuan Direktur**; langkah PM tercatat "(tidak berlaku — pemohon)" (panel + PDF), Audit Log `approval_skipped`. Direktur Setujui → Disetujui. | | |
| AP-16 | US-69 | AP-01 (PRJ-UJI-03 tanpa PM) | **Staff**: Uang Muka di **PRJ-UJI-03** → Ajukan. | Ditolak: **"Project ini belum punya PM. Hubungi Admin untuk mengisi PM project."**; tetap Draft, nomor tidak terbit. Admin mengisi PM PRJ-UJI-03 → Ajukan lagi → berhasil (Menunggu persetujuan PM). | | |

## 5. Pengajuan untuk Direktur (pengecualian G1 owner 2026-10-10)

| ID | US | Prasyarat | Langkah | Hasil yang diharapkan | PASS/FAIL | Catatan |
|---|---|---|---|---|---|---|
| AP-17 | US-70 | AP-02; PT uji punya **≥ 2 Direktur aktif** (Direktur Uji + Direktur lain) | **PM Uji** (web **+ Buat pengajuan**): Uang Muka di PRJ-UJI-01, **Diajukan Oleh = Direktur Uji**, Rp 400.000, **Rekening tujuan dikosongkan** (server memakai rekening default Direktur Uji; PM tidak dapat melihat rekening Direktur — Direktur Uji harus sudah punya rekening default) → Ajukan (**R8**). PM Uji **Setujui**. **Direktur Uji** coba **Setujui** R8. Lalu **Direktur lain** **Setujui**. Unduh PDF R8. | Menunggu persetujuan PM → Menunggu persetujuan Direktur. R8 **tidak** muncul di Persetujuan Direktur Uji dan ia tidak mendapat notifikasi; percobaan Setujui oleh Direktur Uji **ditolak (403)** dan tercatat `access_denied` ("Utamakan Direktur lain", owner 2026-10-11). Direktur lain Setujui → Disetujui. Panel dan PDF: **"Pengajuan Direktur — diajukan oleh PM (kebijakan owner 2026-10-10)"**; Audit Log `approval_policy_exception` pada R8. | | |
| AP-17b | US-70 | PT uji dengan **satu** Direktur aktif (nonaktifkan sementara Direktur kedua di PT uji, atau pakai PT uji lain) | **PM Uji**: seperti AP-17 untuk Direktur Uji (**R8b**). PM Uji **Setujui**, lalu **Direktur Uji** **Setujui** sendiri. Kembalikan Direktur kedua bila dinonaktifkan. | Direktur Uji mendapat notifikasi dan melihat R8b di Persetujuan; Setujui → Disetujui. Panel dan PDF: "Pengajuan Direktur — diajukan oleh PM; disetujui Direktur pemohon karena satu-satunya Direktur PT (kebijakan owner 2026-10-10)". | | |
| AP-18 | US-70 | PT uji dengan **satu** Direktur aktif (bila staging punya 2 Direktur, nonaktifkan sementara Direktur kedua di PT uji, atau pakai PT uji lain) | **Finance Uji** (atau Admin) web **+ Buat pengajuan**: Uang Muka PRJ-UJI-01, **Diajukan Oleh = Direktur Uji** (bukan dibuat PM project) → Ajukan. (Direktur sendiri tidak punya menu buat pengajuan; bila akun Direktur juga punya peran pembuat, ulangi dengan akun itu.) | Ditolak **409 "Pengajuan untuk Direktur dibuat oleh PM project. …"** — langkah Direktur tidak dilewati diam-diam; tetap Draft. Kembalikan Direktur kedua bila dinonaktifkan. | | |
| AP-19 | US-70 | AP-17 | Tim teknis (opsional, staging DB): coba memasukkan baris `approvals` posisi `diketahui` dengan actor = pembuat pada pengajuan **tanpa** pengecualian (mis. R7 siklus berjalan) di dalam transaksi yang di-rollback. | DB menolak: "requester/creator cannot hold a decision position (G1)". | | |

## 6. LPJ kekurangan, Addendum RAB, pengajuan lama

| ID | US | Prasyarat | Langkah | Hasil yang diharapkan | PASS/FAIL | Catatan |
|---|---|---|---|---|---|---|
| AP-20 | US-69, US-21 | R1 Ditransfer (AP-09); toleransi PT 10% | **Staff**: unggah nota R1 total Rp 650.000 → Nota lengkap → Kirim LPJ. **Finance**: verifikasi LPJ (kekurangan Rp 150.000 > toleransi) → **Ajukan persetujuan kekurangan** dengan alasan. **PM Uji**: web **Persetujuan → Kekurangan LPJ di atas nominal disetujui** → Setujui. **Direktur**: Setujui. **Finance**: **Transfer kekurangan & selesaikan**. | Persetujuan kekurangan: langkah 1 berlabel **Persetujuan PM** (PM Uji diberi tahu), lalu Direktur. Setelah Direktur: disetujui; Finance mentransfer kekurangan; R1 **Selesai**. | | |
| AP-21 | US-18, US-30 | AP-02 | **PM Uji**: **Addendum RAB** PRJ-UJI-01 Rp 5.000.000, alasan "UAT addendum" → Ajukan. **Direktur** Setujui → **Finance** Setujui. | Alur tetap **Menunggu Direktur → Menunggu Finance → Disetujui**; PM Uji tidak punya tombol keputusan. | | |
| AP-22 | US-34 | R-LAMA dari AP-00 | **Direktur** Setujui R-LAMA → **Finance** Setujui → (Uang Muka) Finance Catat transfer. | R-LAMA tetap memakai alur lama: label "Persetujuan Direktur (Diketahui)", lalu **Approval Finance**; selesai normal. PM tidak mendapat tombol. | | |

## 7. APK 0.4.1

| ID | US | Prasyarat | Langkah | Hasil yang diharapkan | PASS/FAIL | Catatan |
|---|---|---|---|---|---|---|
| AP-23 | US-69 | APK 0.4.1 terpasang; R baru Menunggu persetujuan PM | **PM Uji** APK: Beranda → **Menunggu Persetujuan** → kartu **Persetujuan PM** → buka → **Setujui sebagai PM project** → tanda tangan profil → Konfirmasi. | Teks "Pengajuan diteruskan ke Direktur."; status Menunggu persetujuan Direktur. Detail: Giliran Direktur. | | |
| AP-24 | US-69 | AP-23 | **Direktur** APK: kartu **Persetujuan Direktur** → **Setujui**. | Teks "diteruskan ke Finance untuk transfer"; status Disetujui (Antri Transfer). | | |
| AP-25 | US-69 | APK lama (0.4.0 atau sebelumnya), opsional | PM Uji membuka pengajuan yang menunggunya. | Tombol Setujui/Tolak tampil (dari server) tetapi tulisannya masih Direktur — diketahui, diperbaiki di 0.4.1. | | |

## Penutup

- Setelah UAT: laporkan hasil ke owner. Produksi baru dideploy setelah owner menyetujui; Admin mengulang AP-01…AP-04
  di produksi setelah deploy.
- Kembalikan data uji yang diubah (Direktur kedua, PM PRJ-UJI-03) bila perlu.
