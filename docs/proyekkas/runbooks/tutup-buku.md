# Runbook — Tutup buku bulanan & buka kembali

- **Status:** draf E12, diperbarui 2026-09-30 (tutup buku per PT, menu baru, cut-over) · **Tanggal:** 2026-09-26 ·
  **Basis:** `develop` @ `5415f45` (`admin/views/Kas.tsx`, `admin/modules/registry.ts`, `domain/cash/ledger.ts`,
  `domain/cash/book.ts`, `api/v1/endpoints/cash.ts`), ADR 0005 §6, ADR 0016 §4.
- **Pelaksana:** **Finance** atau **Direktur** PT itu (tutup buku) · **Direktur PT itu** (**buka kembali**). Hak
  dihitung **per PT**: Finance di PT A tidak bisa menutup buku PT B. Admin dan PM tidak punya akses ke halaman ini.
- **Tempat:** web, layar modul → **Keuangan** → menu **Tutup buku ▾** → **Tutup buku** (`/admin/tutup-buku`; daftar
  mentah: **Tutup buku ▾ → Riwayat tutup buku**). Tidak ada di APK.
- **Kapan:** setiap awal bulan, setelah semua transaksi bulan lalu tercatat (usulan: paling lambat tanggal 5).

## Per PT (sejak web 0.5.0)

- Tutup buku berlaku **per PT**: menutup PT A **tidak** mengunci PT B. Setiap PT punya **tanggal kunci** sendiri.
- **Satu layar = satu PT.** Bila Anda Finance/Direktur di lebih dari satu PT, `/admin/tutup-buku` lebih dulu
  menampilkan kartu **Pilih PT** (per PT: "terkunci s/d …" atau "belum pernah tutup buku") → klik PT → layar tutup
  buku PT itu (`/admin/tutup-buku?pt=<id>`). Pindah PT lewat baris **PT:** di atas halaman. Dengan satu PT, layar
  langsung terbuka.
- Bila Anda memegang beberapa PT, konfirmasi tutup buku menyebut "Hanya PT … yang dikunci." Ulangi bagian A untuk
  **setiap** PT.
- Halaman **Kas** menampilkan tanggal kunci per PT (mis. "tutup buku DRMS s/d … · CS1 s/d …").
- API: `POST /api/v1/period-closings` dan `…/{period}/reopen` selalu membawa PT (`company`); tanpa PT saat Anda punya
  lebih dari satu PT → 400 "PT wajib dipilih."

## Apa yang terjadi saat buku ditutup

- Semua transaksi kas **PT itu** (kas masuk/keluar manual, KK dari transfer, KM pengembalian LPJ, jurnal balik) dengan
  tanggal **sampai akhir bulan yang ditutup** terkunci. Mencatat, mengubah, atau mentransfer dengan tanggal di periode
  itu ditolak dengan pesan: *"Periode YYYY-MM sudah ditutup (tutup buku s/d YYYY-MM-DD)."*
- Transaksi yang salah di periode tertutup dikoreksi dengan **Void**: jurnal balik dicatat pada tanggal **hari ini**
  (periode berjalan), bukan di periode tertutup.
- Periode ditutup **berurutan**: hanya bulan yang sudah lewat yang bisa ditutup; status per bulan tampil di tabel
  **Per bulan**: *Ditutup / Terkunci / Berjalan / Terbuka*.

## A. Tutup buku (Finance atau Direktur PT itu)

| Langkah | Tindakan | Hasil yang diharapkan |
|---|---|---|
| 0 | Beberapa PT: **Keuangan → Tutup buku ▾ → Tutup buku** → kartu **Pilih PT** → klik PT yang akan ditutup. Untuk langkah 1–4, saring ke PT yang sama (tombol PT di bar atas / filter **PT** di laporan). | Layar tutup buku PT itu terbuka. |
| 1 | **Persetujuan → Antrian Transfer**: pastikan tidak ada transfer bulan lalu yang belum dicatat (bukti sudah ada tetapi belum diinput). | Tidak ada tunggakan bertanggal bulan lalu. |
| 2 | **Persetujuan → Verifikasi LPJ** → bagian *Menunggu penyelesaian selisih*: selesaikan pengembalian/kekurangan yang terjadi bulan lalu. | Tidak ada selisih bulan lalu yang menggantung. |
| 3 | **Keuangan → Kas ▾ → Buku kas** (halaman **Kas**) → filter periode = bulan lalu → cocokkan saldo tiap akun dengan rekening koran / kas fisik. | Saldo sama. Bila beda: catat kas masuk/keluar manual atau void transaksi salah **sebelum** ditutup. |
| 4 | **Laporan → Semua laporan → Rekap Kas** (periode bulan lalu) → unduh **Excel** dan **PDF**, arsipkan. | File tersimpan di arsip keuangan. |
| 5 | **Tutup buku** → baris bulan lalu → tombol **Tutup buku** → isi **Catatan** (opsional, mis. "Rekonsiliasi BCA & kas kecil OK") → konfirmasi. | Kartu **Terkunci s/d** = akhir bulan lalu; status baris = *Ditutup*. |
| 6 | Uji singkat: coba **Kas → ↓ Kas masuk** di PT yang sama dengan tanggal di bulan yang baru ditutup. | Ditolak dengan pesan "Periode … sudah ditutup …". Batalkan formulir. PT lain tetap bisa memposting di bulan itu sampai bukunya ditutup. |

## B. Buka kembali (Direktur PT itu saja)

Dipakai hanya bila ada kesalahan material yang **tidak bisa** dikoreksi dengan void di periode berjalan
(mis. auditor meminta transaksi berada di bulan yang benar).

| Langkah | Tindakan | Hasil |
|---|---|---|
| 1 | Masuk web sebagai **Direktur PT itu** → **Keuangan → Tutup buku ▾ → Tutup buku** → (beberapa PT: **Pilih PT**). | Tombol **Buka kembali** hanya muncul pada **periode tertutup terakhir** PT itu. Yang bukan Direktur di PT itu (termasuk Direktur PT lain) melihat tulisan "Buka kembali: Direktur". |
| 2 | **Buka kembali** → isi **alasan** (wajib) → konfirmasi. | Periode kembali *Terbuka*; kartu **Riwayat** mencatat "Dibuka kembali" dengan alasan; Audit Log mencatat aksinya. |
| 3 | Finance melakukan koreksi. | — |
| 4 | Ulangi **A** langkah 3–5 untuk periode itu. | Periode tertutup lagi. |

Untuk membuka periode yang lebih lama dari periode tertutup terakhir, buka kembali satu per satu dari yang
terbaru (aturan server: "Hanya periode tertutup terakhir yang dapat dibuka kembali.").

## C. Cut-over go-live

Dijalankan oleh alat impor — langkah lengkap: [`import-data-golive.md`](import-data-golive.md) §3–§4 (beberapa PT:
§4.1, cut-over per PT).
- **Saldo awal:** field **Saldo awal (Rp)** pada **Akun kas/bank** (bukan transaksi kas) diisi `saldo_awal`, dan
  `openingBalanceDate` = `tanggal_golive`. Transaksi kas bertanggal **sebelum** tanggal saldo awal akun ditolak DB
  (`import-data-golive.md` §4).
- **Periode sebelum go-live ditutup** oleh impor bila `tutup_periode_sebelum_golive = Ya` (audit `period_close`).
  Tutup buku ini sengaja **tidak** mengunci saldo awal.
- **Kunci saldo awal** (keputusan S3b, ADR 0005 "As implemented (S3b)", `import-data-golive.md` §6): saldo awal
  **terkunci** setelah periode yang memuat tanggal saldo awal (atau periode sesudahnya) ditutup. Sebelum itu Finance
  masih boleh mengoreksi (alasan wajib, diaudit); sesudahnya koreksi lewat **kas masuk/keluar manual** beralasan.
  Artinya: tutup buku **bulan go-live** yang pertama mengunci saldo awal — cocokkan saldo awal sebelum menutupnya.
- Tutup buku cut-over keliru: Direktur PT itu membuka kembali (bagian B; hanya periode tertutup terakhir).

## Masalah umum

| Gejala | Penyebab | Tindakan |
|---|---|---|
| Transfer pengajuan ditolak "Periode … sudah ditutup" | Tanggal transfer di bulan tertutup | Isi tanggal hari ini (kosongkan = hari ini). |
| Tombol **Tutup buku** tidak ada untuk bulan ini | Bulan berjalan belum boleh ditutup | Tunggu bulan berikutnya. |
| KM pengembalian LPJ salah | KM pengembalian LPJ tidak bisa di-void ("Bagian dari LPJ") | Catat kas keluar manual koreksi dengan keterangan nomor LPJ; laporkan ke tim (reversal settlement **menyusul** E9). |
| Admin/PM tidak melihat menu | Menu Kas & Tutup buku hanya untuk Finance dan Direktur | Sesuai desain. |
| PT yang dicari tidak ada di kartu **Pilih PT** | Anda bukan Finance/Direktur di PT itu, atau PT itu tidak dicentang di tombol PT (bar atas) | Centang PT itu di tombol PT; bila tetap tidak ada, minta Admin PT memeriksa akses Anda (**Pengguna & Akses → Akses PT (matriks)**). |
| Buku PT A sudah ditutup tetapi PT B masih bisa memposting bulan itu | Tutup buku per PT | Sesuai desain — tutup buku PT B juga. |
