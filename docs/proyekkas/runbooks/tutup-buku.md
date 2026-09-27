# Runbook — Tutup buku bulanan & buka kembali

- **Status:** draf E12 · **Tanggal:** 2026-09-26 · **Basis:** `develop` @ `c468bbe` (`admin/views/Kas.tsx`,
  `domain/cash/ledger.ts`, `domain/cash/book.ts`, `api/v1/endpoints/cash.ts`), ADR 0005 §6.
- **Pelaksana:** **Finance** (tutup buku) · **Direktur** (tutup buku dan **buka kembali**) · Admin hanya membaca buku kas.
- **Tempat:** web, menu **Alur kerja → Tutup buku** (`/admin/tutup-buku`). Tidak ada di APK.
- **Kapan:** setiap awal bulan, setelah semua transaksi bulan lalu tercatat (usulan: paling lambat tanggal 5).

## Apa yang terjadi saat buku ditutup

- Semua transaksi kas (kas masuk/keluar manual, KK dari transfer, KM pengembalian LPJ, jurnal balik) dengan tanggal
  **sampai akhir bulan yang ditutup** terkunci. Mencatat, mengubah, atau mentransfer dengan tanggal di periode itu
  ditolak dengan pesan: *"Periode YYYY-MM sudah ditutup (tutup buku s/d YYYY-MM-DD)."*
- Transaksi yang salah di periode tertutup dikoreksi dengan **Void**: jurnal balik dicatat pada tanggal **hari ini**
  (periode berjalan), bukan di periode tertutup.
- Periode ditutup **berurutan**: hanya bulan yang sudah lewat yang bisa ditutup; status per bulan tampil di tabel
  **Per bulan**: *Ditutup / Terkunci / Berjalan / Terbuka*.

## A. Tutup buku (Finance atau Direktur)

| Langkah | Tindakan | Hasil yang diharapkan |
|---|---|---|
| 1 | **Antrian Transfer**: pastikan tidak ada transfer bulan lalu yang belum dicatat (bukti sudah ada tetapi belum diinput). | Tidak ada tunggakan bertanggal bulan lalu. |
| 2 | **Verifikasi LPJ** → bagian *Menunggu penyelesaian selisih*: selesaikan pengembalian/kekurangan yang terjadi bulan lalu. | Tidak ada selisih bulan lalu yang menggantung. |
| 3 | **Kas** → filter periode = bulan lalu → cocokkan saldo tiap akun dengan rekening koran / kas fisik. | Saldo sama. Bila beda: catat kas masuk/keluar manual atau void transaksi salah **sebelum** ditutup. |
| 4 | **Laporan → Rekap Kas** (periode bulan lalu) → unduh **Excel** dan **PDF**, arsipkan. | File tersimpan di arsip keuangan. |
| 5 | **Tutup buku** → baris bulan lalu → tombol **Tutup buku** → isi **Catatan** (opsional, mis. "Rekonsiliasi BCA & kas kecil OK") → konfirmasi. | Kartu **Terkunci s/d** = akhir bulan lalu; status baris = *Ditutup*. |
| 6 | Uji singkat: coba **Kas → ↓ Kas masuk** dengan tanggal di bulan yang baru ditutup. | Ditolak dengan pesan "Periode … sudah ditutup …". Batalkan formulir. |

## B. Buka kembali (Direktur saja)

Dipakai hanya bila ada kesalahan material yang **tidak bisa** dikoreksi dengan void di periode berjalan
(mis. auditor meminta transaksi berada di bulan yang benar).

| Langkah | Tindakan | Hasil |
|---|---|---|
| 1 | Masuk web sebagai **Direktur** → **Tutup buku**. | Tombol **Buka kembali** hanya muncul pada **periode tertutup terakhir**. Peran lain melihat tulisan "Buka kembali: Direktur". |
| 2 | **Buka kembali** → isi **alasan** (wajib) → konfirmasi. | Periode kembali *Terbuka*; kartu **Riwayat** mencatat "Dibuka kembali" dengan alasan; Audit Log mencatat aksinya. |
| 3 | Finance melakukan koreksi. | — |
| 4 | Ulangi **A** langkah 3–5 untuk periode itu. | Periode tertutup lagi. |

Untuk membuka periode yang lebih lama dari periode tertutup terakhir, buka kembali satu per satu dari yang
terbaru (aturan server: "Hanya periode tertutup terakhir…").

## C. Cut-over go-live — menyusul

Saat go-live, **tanggal saldo awal = tanggal go-live** dan periode sebelum go-live ditutup
(`plans/fase1-golive.md` §E11). Saldo awal saat ini adalah field **Saldo awal (Rp)** pada **Akun kas/bank**
(bisa diubah Admin/Finance/Direktur dengan alasan), bukan transaksi kas. Urutan cut-over final ditulis bersama
alat impor E11 (**menyusul**, `feat/s3b-e11-data-import`). Keputusan terbuka: mengunci field saldo awal setelah
periode pertama ditutup (§E11 Catatan).

## Masalah umum

| Gejala | Penyebab | Tindakan |
|---|---|---|
| Transfer pengajuan ditolak "Periode … sudah ditutup" | Tanggal transfer di bulan tertutup | Isi tanggal hari ini (kosongkan = hari ini). |
| Tombol **Tutup buku** tidak ada untuk bulan ini | Bulan berjalan belum boleh ditutup | Tunggu bulan berikutnya. |
| KM pengembalian LPJ salah | KM pengembalian LPJ tidak bisa di-void ("Bagian dari LPJ") | Catat kas keluar manual koreksi dengan keterangan nomor LPJ; laporkan ke tim (reversal settlement **menyusul** E9). |
| Admin/PM tidak melihat menu | Menu Kas & Tutup buku hanya untuk Finance dan Direktur | Sesuai desain. |
