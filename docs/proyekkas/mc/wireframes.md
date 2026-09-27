# ProyekKas MC: wireframe multi-PT (low-fi)

- **Status:** usulan Analyst untuk gerbang MC0 (belum disetujui user). Desain data & akses: `../adr/0016-multi-company.md`;
  kebutuhan: `../requirements-v1.2.md` (US-MC-xx).
- **Tanggal:** 2026-09-27 · **Penulis:** Analyst · **Basis:** `develop` `74cf7f2` (bar modul gaya Odoo,
  `apps/web/src/admin/shell/ModuleBar.tsx`; beranda `/admin/dashboard`; APK 0.2.0 launcher)
- Semua nama dan angka **fiktif**: PT "DRMS" (PT #1), "PT Contoh Satu" (`CS1`), "PT Contoh Dua" (`CS2`); pengguna
  "Rina Uji", "Andi Uji", "Budi Uji", "Dewi Uji"; project "Proyek Uji" `UJI-PRJ`, "Gudang Uji" `CS1-GDG`.
- Konvensi tetap seperti `../f3/wireframes.md` §0: render server, filter lewat query string, warna status selalu
  dengan teks, tabel dalam `TableScroll`, tanpa scroll horizontal halaman di 390 px.

Legenda: `[ … ]` = kartu/widget, `→` = tujuan saat diklik, `☑/☐` = centang, `(●)` = pilihan tunggal.

---

## 1. Pemilih PT (US-MC-04, US-MC-05)

### 1a. Web — bar modul (`ModuleBar.tsx`, di kiri lonceng)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▦ Keuangan   Pengajuan biaya ▾  Antrian transfer  Verifikasi LPJ  Kas ▾      [PT: DRMS +1 ▾] 🔔3  (RU) │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Keuangan › Pengajuan biaya                                                                     │
└────────────────────────────────────────────────────────────────────────────────────────────────┘

 klik [PT: DRMS +1 ▾] →
                                        ┌──────────────────────────────────────┐
                                        │ Tampilkan data PT                    │
                                        │ ☑ Semua PT saya (3)                  │
                                        │ ──────────────────────────────────── │
                                        │ ☑ DRMS  PT Double Rezki …  Direktur  │
                                        │ ☑ CS1   PT Contoh Satu     Finance   │
                                        │ ☐ CS2   PT Contoh Dua      Finance   │
                                        │ ──────────────────────────────────── │
                                        │ [ Terapkan ]            [ Batal ]    │
                                        └──────────────────────────────────────┘
```

| Elemen | Aturan |
|---|---|
| Label tombol | 1 PT: kode PT ("PT: CS1"); beberapa: kode pertama + jumlah lain ("PT: DRMS +1"); semua: "Semua PT". |
| Daftar | Hanya PT dengan keanggotaan **aktif**; peran di PT itu tampil sebagai teks kecil (label peran v1.1: Direktur, Finance, …). |
| Terapkan | `POST /api/v1/me/companies` (usulan) → server set cookie `__Host-pk-companies` → halaman dimuat ulang. Minimal 1 PT tercentang (tombol nonaktif bila 0). |
| Satu keanggotaan | Tombol tetap tampil (teks "PT: DRMS") tetapi tanpa menu — tidak ada pilihan. |
| Lebar HP (< 768 px) | Tombol menjadi ikon gedung + kode ("DRMS+1"); menu terbuka sebagai *sheet* dari bawah (pola `Sheet` di `ModuleBar.tsx`). |
| Aksesibilitas | Tombol `aria-haspopup="menu"`, daftar `role="menu"` dengan `menuitemcheckbox`; navigasi panah seperti `Dropdown` yang ada. |

### 1b. APK — app bar & Profil

```
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│ ProyekKas            [DRMS ▾] 🔔 │     │ Pilih PT                         │
│ Selamat pagi, Rina               │     │ (●) Semua PT saya                │
│ Direktur · DRMS  Finance · CS1   │     │ ( ) DRMS — Direktur              │
│ ┌──────────┐ ┌──────────┐        │ ──▶ │ ( ) CS1 — Finance                │
│ │Persetujuan│ │ Pengajuan│        │     │                                  │
│ │    5      │ │          │        │     │ Draft & antrian offline tetap    │
│ └──────────┘ └──────────┘        │     │ tersimpan di PT masing-masing.   │
│ KPI (gabungan: DRMS + CS1) …     │     │ [ Simpan ]                       │
└─────────────────────────────────┘     └─────────────────────────────────┘
```

- Pilihan: **satu PT** atau **Semua PT** (APK tidak memakai centang ganda, supaya sederhana di lapangan).
- Kotak launcher dan menu mengikuti kapabilitas per PT dari `/me` (`companies[].capabilities`): tile "Persetujuan"
  tampil bila di salah satu PT terpilih pengguna Direktur/Finance.
- Saat "Semua PT" dan pengguna menekan "+ Pengajuan": langkah pertama formulir = **pilih PT** (hanya PT dengan
  keanggotaan + karyawan); master (project, kategori, rekening) dimuat dari cache PT itu.
- Setiap kartu pengajuan/notifikasi memakai *chip* kode PT (mis. `CS1`) di kiri atas.

---

## 2. Matriks peran (US-MC-02) — custom view `/admin/akses-pt`

Modul **Sistem › Pengguna & akses PT**. Admin melihat kolom PT tempat ia Admin; Admin grup melihat semua PT.

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ Pengguna & akses PT                            Cari: [ nama/email      ]  [☐ tampilkan nonaktif]│
│ Kolom PT: [☑ DRMS] [☑ CS1] [☐ CS2]                                            [ + Undang pengguna ]│
├───────────────────┬──────────────────────────────┬──────────────────────────────┬────────────┤
│ Pengguna          │ DRMS                         │ CS1 — PT Contoh Satu         │ Status     │
├───────────────────┼──────────────────────────────┼──────────────────────────────┼────────────┤
│ Rina Uji          │ ☐Staff ☐PM ☐Fin ☑Dir ☐Adm    │ ☐Staff ☐PM ☑Fin ☐Dir ☐Adm    │ Aktif      │
│ rina.uji@…        │ Karyawan: – (tanpa)       ✎  │ Karyawan: –               ✎  │            │
├───────────────────┼──────────────────────────────┼──────────────────────────────┼────────────┤
│ Budi Uji          │ ☑Staff ☐PM ☐Fin ☐Dir ☐Adm    │ ☐Staff ☑PM ☐Fin ☐Dir ☐Adm    │ Aktif      │
│ budi.uji@…        │ Karyawan: DRMS-014 Budi U. ✎ │ Karyawan: CS1-003 Budi U. ✎  │            │
├───────────────────┼──────────────────────────────┼──────────────────────────────┼────────────┤
│ Andi Uji          │ ☐Staff ☐PM ☑Fin ☐Dir ☑Adm    │ (bukan anggota)  [+ Tambah]  │ Aktif      │
├───────────────────┴──────────────────────────────┴──────────────────────────────┴────────────┤
│ 2 perubahan belum disimpan                         Alasan: [ ........................ ] [ Simpan ]│
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Elemen | Aturan |
|---|---|
| Sel PT | Satu sel = satu baris `company-memberships`. Kolom PT yang bukan hak Admin tampil **abu, hanya baca** (Admin grup: semua bisa diubah). |
| Karyawan ✎ | Pilihan hanya karyawan **PT kolom itu** yang belum dipakai akun lain; "– (tanpa)" boleh (Direktur/Finance tanpa data karyawan). |
| + Tambah | Membuat keanggotaan di PT itu (peran minimal satu). Menghapus semua centang = keanggotaan **nonaktif** (bukan dihapus; riwayat tetap). |
| Simpan | Semua perubahan satu kali simpan, **alasan wajib**, audit `role_change` per sel (lama → baru, PT). Server menolak sel PT di luar hak (403) — tidak ada simpan sebagian. |
| Peringatan | Bila perubahan membuat PT tanpa Direktur aktif atau tanpa Finance aktif: kotak kuning "PT CS1 tidak punya Finance aktif — pengajuan CS1 tidak bisa diajukan (409)". Tetap boleh disimpan. |
| + Undang pengguna | Formulir akun (email, nama, HP) → Keycloak user + `pk-user`; lalu pengguna muncul di matriks tanpa keanggotaan. |
| Lebar HP | Satu kartu per pengguna; tiap PT sebagai bagian yang bisa dilipat (tanpa tabel lebar). |
| Kosong | "Belum ada pengguna. Tambah dengan + Undang pengguna." |

---

## 3. Master Perusahaan (US-MC-01) — koleksi `companies`

Daftar (Sistem › Perusahaan):

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Perusahaan                                                            [ + Buat baru ] │
├──────┬────────────────────────────────┬──────────────┬───────────┬─────────┬──────────┤
│ Kode │ Nama                           │ Zona waktu   │ Anggota   │ Status  │ Dibuat   │
├──────┼────────────────────────────────┼──────────────┼───────────┼─────────┼──────────┤
│ DRMS │ PT Double Rezki Makmur Sejahtera│ Asia/Makassar│ 18        │ Aktif   │ migrasi  │
│ CS1  │ PT Contoh Satu                 │ Asia/Makassar│ 6         │ Aktif   │ 27/09/26 │
│ CS2  │ PT Contoh Dua                  │ Asia/Makassar│ 0         │ Nonaktif│ 27/09/26 │
└──────┴────────────────────────────────┴──────────────┴───────────┴─────────┴──────────┘
```

Formulir (tab mengikuti kelompok field yang pindah dari "Setting perusahaan"):

```
┌─ PT Contoh Satu (CS1) ────────────────────────────────────────────────────────────────┐
│ [Identitas] [Operasional] [Absensi & retensi] [Pengingat & notifikasi] [Riwayat]      │
│                                                                                       │
│ Identitas                                                                             │
│  Kode singkat*  [CS1      ]  (token {COMPANY}; terkunci setelah ada dokumen bernomor) │
│  Nama*          [PT Contoh Satu                    ]                                  │
│  Nama legal     [PT Contoh Satu                    ]                                  │
│  Logo           [ unggah ]  (PNG/JPG, dipakai di PDF PT ini)                          │
│  Kop PDF        [ Jl. Contoh No. 1, Kota Uji         ]                                │
│  Alamat / Telp  [ …                                  ] [ 0511-000000 ]                 │
│  Zona waktu*    [Asia/Makassar ▾]  (harus sama dengan server pada rilis ini, Q-59)    │
│  Aktif          ☑                                                                     │
│                                                                                       │
│ Saat dibuat (sekali):  ☑ salin penomoran default   ☑ salin aturan approval DRMS       │
│                        ☑ salin kategori & jadwal kerja DRMS                            │
│                                                        Alasan: [ …… ]  [ Simpan ]     │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- Tab **Operasional**: radius geofence, batas laporan terlambat, ambang anggaran/progress, toleransi & umur nota, tutup
  otomatis reimburse, batas LPJ, flag sinkron APK (draft, absensi, progress), jadwal kerja default (hanya jadwal PT ini).
- "Setting aplikasi" (global) tinggal: versi APK minimum/terbaru, URL unduh, umur sesi offline, target resize foto,
  **nama/logo/kop grup**.
- Hak: Admin grup buat/nonaktifkan; Admin & Direktur PT itu ubah identitas/operasional; Finance baca.

---

## 4. Daftar gabungan: Pengajuan biaya (US-MC-06)

Daftar koleksi `expense-requests` dengan pilihan PT "DRMS + CS1":

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Pengajuan biaya                         PT: [Semua pilihan ▾] Status: [Semua ▾]  Cari: [       ] │
│ Menampilkan DRMS, CS1 · 42 pengajuan                                                              │
├─────┬───────────────────────────┬──────────┬───────────────────────┬──────────────┬─────────────┤
│ PT  │ Nomor                     │ Jenis    │ Judul / project        │ Grand total  │ Status      │
├─────┼───────────────────────────┼──────────┼───────────────────────┼──────────────┼─────────────┤
│ DRMS│ 231/PB-DRMS/27/IX/2026    │ Uang Muka│ UJI-PRJ Proyek Uji     │ Rp 2.500.000 │ Menunggu    │
│     │                           │          │                       │              │ Diketahui   │
│ CS1 │ 1/PB-CS1/27/IX/2026       │ Reimburse│ CS1-GDG Gudang Uji     │ Rp   845.000 │ Menunggu    │
│     │                           │          │                       │              │ Approval    │
│ DRMS│ 230/PB-DRMS/26/IX/2026    │ Reimburse│ OPS-PB Ops Palangka B. │ Rp 1.447.500 │ Ditransfer  │
├─────┴───────────────────────────┴──────────┴───────────────────────┴──────────────┴─────────────┤
│ Total per PT: DRMS Rp 3.947.500 (2) · CS1 Rp 845.000 (1) · Gabungan Rp 4.792.500 (3)            │
│                                                                                ‹ 1 2 3 ›        │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Elemen | Aturan |
|---|---|
| Kolom PT | Kolom pertama, kode singkat, `defaultColumns` Payload; hanya tampil bila pilihan > 1 PT (1 PT: disembunyikan, chip PT di judul). |
| Filter PT | Mempersempit dalam pilihan saat ini (query `where[company][in]=…`); tidak bisa memperluas ke PT di luar keanggotaan. |
| Baris total | Hanya di view daftar kustom/laporan (daftar koleksi bawaan Payload tidak punya baris total → cukup di laporan "Rekap pengajuan"). |
| Klik baris | Detail dokumen; tombol aksi (Setujui, Transfer, …) mengikuti peran di **PT dokumen**. |
| Buat baru | Bila pilihan > 1 PT, field **PT** wajib di atas formulir; dropdown project/pusat biaya/rekening/kategori terisi setelah PT dipilih. |
| Kotak Persetujuan | Sama: kolom PT + label langkah per baris ("Persetujuan Direktur (Diketahui)" untuk DRMS, "Approval level 1" untuk CS1). |

---

## 5. Beranda Direktur gabungan (US-MC-10) — `/admin/dashboard?peran=owner`

Contoh pengguna "Dewi Uji" = Direktur di DRMS **dan** CS1, pilihan PT = DRMS + CS1. Untuk pengguna dengan peran
berbeda per PT (Rina: Direktur DRMS, Finance CS1) tab peran tetap seperti F3 ("Direktur · Finance"): tab Direktur
hanya menghitung PT tempat ia Direktur (DRMS), tab Finance hanya PT tempat ia Finance (CS1).

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Dashboard · Direktur             PT: DRMS + CS1                     Periode: [Sep 2026 ▾]     │
├───────────────────────┬───────────────────────┬───────────────────────┬──────────────────────┤
│ [1] SALDO KAS  K-01   │ [2] ANGGARAN TERPAKAI │ [3] KELENGKAPAN       │ [4] MENUNGGU         │
│ Gabungan              │     K-08              │     NOTA/LPJ  K-12    │     PERSETUJUAN K-10 │
│ Rp 61.400.000         │ 5 project berjalan    │ 6 dari 9 uang muka    │ 7 pengajuan          │
│ DRMS   48.250.000     │ DRMS 🔴1 🟡1 🟢1      │ DRMS 4/6 · CS1 2/3    │ DRMS 5 · CS1 2       │
│ CS1    13.150.000     │ CS1  🟢2              │ ⚠ LPJ terlambat: 2    │ menunggu saya: 3     │
│ → Rekap Kas (per PT)  │ → tabel [6]           │ → Kelengkapan         │ → /admin/persetujuan │
├───────────────────────┴───────────────────────┴───────────────────────┴──────────────────────┤
│ [5] ARUS KAS BULANAN (K-02b)      Tampilan: (●) per PT  ( ) gabungan   [12 bln ▾]           │
│  jt                                          ■ DRMS masuk ■ DRMS keluar ■ CS1 masuk ■ CS1 keluar│
│  20 ┤   ▐▌▐▌                                                                               │
│  10 ┤ ▐▌▐▌▐▌▐▌ ...                                                                          │
│   0 ┼──Okt────Nov── … ──Sep                                                                 │
│  ▸ Tabel angka (Bulan · PT · Masuk · Keluar · Selisih · Total gabungan)                     │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ [6] ANGGARAN PROJECT                                                                         │
│ PT   Project              RAB          Komitmen    %      Status        Progress             │
│ DRMS UJI-PRJ Proyek Uji    50.000.000  43.500.000  87,00  🟡 Waspada    62 %                 │
│ CS1  CS1-GDG Gudang Uji    20.000.000   4.100.000  20,50  🟢 Aman       15 %                 │
│ …                                                                                            │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

| # | Aturan gabungan |
|---|---|
| 1 | Angka besar = Σ saldo semua akun kas dari PT tempat pengguna Direktur/Finance (dalam pilihan); baris per PT selalu tampil; klik baris PT → Rekap Kas difilter PT itu. |
| 2 | Warna status per PT (ambang PT masing-masing: `budgetWarnPct`/`budgetOverPct` di master Perusahaan). Tidak ada "persen gabungan". |
| 3 | Rasio per PT + jumlah gabungan untuk yang bisa dijumlahkan (LPJ terlambat, nota menunggu). |
| 4 | Total gabungan + per PT; "menunggu saya" dihitung dengan peran di PT tiap dokumen. |
| 5 | Default **per PT** (satu pasang batang per PT; maksimal 4 PT, lebih → otomatis "gabungan" + tabel per PT). Warna pakai palet kategori F3 (urutan tetap per kode PT), selalu dengan legenda teks. |
| 6 | Kolom PT pertama; urut PT lalu status. |
| Kosong | Per PT: "CS1: belum ada akun kas." (bukan angka 0 tanpa penjelasan). |
| Galat | Satu PT gagal dimuat → kartu menampilkan PT lain + "Data CS1 tidak dapat dimuat (kode permintaan …)". |

APK (KPI home): kartu yang sama dalam satu kolom; baris per PT di bawah angka gabungan; grafik memakai tampilan
"gabungan" (satu pasang batang) dengan tabel per PT di bawahnya.
