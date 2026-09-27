# Matriks keterlacakan UAT Fase 1 — User story → skenario

Dihasilkan dari kolom **US** di tiap file skrip (`00-persiapan.md`, `web-*.md`, `apk-*.md`) pada 2026-09-26.
Setiap US IN scope punya ≥ 1 skenario non-persiapan (AC E12). Kolom **Selisih** menunjuk `README.md` §Selisih yang diketahui.

| US | Ringkas | Web | APK | Persiapan | Selisih | Hasil UAT |
|---|---|---|---|---|---|---|
| US-01 | Check-in/out lokasi + selfie | WD-12, WA-10 | AS-07, AS-09, AS-10 | P-06, P-09 | S-19 | |
| US-02 | Absen offline | – | AS-08, AS-16 | P-06 | S-22 | |
| US-03 | Buat pengajuan lengkap | WS-03, WS-08, WP-03 | AS-02 | – | – | |
| US-04 | Edit/tarik kembali/batal | WS-10, WS-11 | AS-05 | – | – | |
| US-05 | Posisi & notifikasi status | WS-08 | AS-04 | – | S-04 | |
| US-06 | Alasan tolak & ajukan ulang | WS-12 | AS-05 | – | S-26 | |
| US-07 | Upload nota | WS-07, WS-13 | AS-03, AS-06 | – | S-27 | |
| US-08 | Kirim/revisi LPJ | WS-13 | AS-06 | – | – | |
| US-09 | Rekap absensi bulanan | WS-17, WF-20, WA-10 | AS-11 | P-12 | – | |
| US-10 | Laporan progress + foto | WP-06 | AP-03, AP-04, AP-05 | P-06 | S-14 | |
| US-11 | Pengingat laporan terlambat | WP-12, WA-13 | AP-11 | – | S-28 | |
| US-12 | Progress vs anggaran | WP-04, WP-11, WD-11 | AP-06 | – | – | |
| US-13 | Kehadiran tim hari ini | WP-08, WF-20 | AP-07, AD-08 | – | – | |
| US-14 | Diabsenkan PM | WA-14 | AP-08 | – | S-20 | |
| US-15 | Koreksi jam absensi | WP-09, WA-14 | AP-09 | – | S-21 | |
| US-16 | Anggota & penugasan tim | WP-10 | – | P-10 | S-18 | |
| US-17 | PM memantau tanpa approve | WS-18, WP-01, WP-02, WP-03 | AP-01, AP-02 | – | S-01 | |
| US-18 | Ajukan addendum RAB | WP-07 | AP-10 | – | – | |
| US-19 | Antrian transfer | WF-06 | – | – | S-07 | |
| US-20 | Catat transfer | WF-07, WF-08 | – | – | S-29 | |
| US-21 | Verifikasi/revisi LPJ | WF-09 | – | – | S-08 | |
| US-22 | Selesaikan selisih LPJ | WF-10, WF-11 | – | – | S-09 | |
| US-23 | Kas masuk/keluar manual | WF-12, WF-13, WF-15 | – | P-05 | S-13 | |
| US-24 | Void kas | WF-08, WF-14, WF-15, WD-09 | – | – | – | |
| US-25 | Rekap & export | WP-11, WF-16 | – | – | – | |
| US-26 | Setujui/tolak (Direktur/Finance) | WS-12, WF-02, WF-03, WD-02, WD-03, WD-04 | AD-02, AD-03, AD-04, AD-05 | – | S-05, S-06 | |
| US-27 | Dashboard KPI | WF-01, WD-01 | AD-01, AD-09 | – | S-10 | |
| US-28 | Grafik kas bulanan | WD-01 | AD-01 | – | S-11 | |
| US-29 | Project & tahapan | WP-05, WD-05, WD-06 | – | P-07, P-08 | – | |
| US-30 | Approve addendum | WF-21, WD-08 | AD-06 | – | S-15 | |
| US-31 | Baca laporan progress | WP-06, WD-07 | AD-07 | – | S-14 | |
| US-32 | User, peran, status aktif | WA-01, WA-02 | – | P-01 | – | |
| US-33 | Master data | WA-03 | – | P-03, P-04 | S-16 | |
| US-34 | Aturan approval | WA-06 | – | P-11 | – | |
| US-35 | Riwayat dokumen | WS-16, WD-10 | AS-12 | – | – | |
| US-36 | Jenis Uang Muka/Reimburse | WS-03 | AS-02 | – | – | |
| US-37 | Baris item | WS-03 | AS-02 | – | – | |
| US-38 | Nota saat pengajuan Reimburse | WS-07 | AS-03 | – | – | |
| US-39 | Verifikasi nota Reimburse | WS-14, WF-04, WF-05 | – | – | – | |
| US-40 | Multi pemohon | WS-06, WF-19 | AS-03 | – | – | |
| US-41 | Atas nama pemohon | WF-18, WA-09 | – | – | S-04 | |
| US-42 | "Diketahui" = persetujuan Direktur | WF-02, WF-19, WD-02, WD-03 | AD-02, AD-03 | – | – | |
| US-43 | Tanda tangan digital | WS-02, WS-16, WD-02 | AD-02, AD-04 | P-02 | S-02 | |
| US-44 | Rekening milik pemohon | WS-05 | – | P-04 | S-03 | |
| US-45 | Format penomoran | WS-08, WA-05 | – | – | – | |
| US-46 | PDF Pengajuan Biaya | WS-15 | – | – | – | |
| US-47 | Flag selisih nominal | WS-09, WF-04, WA-07 | – | – | – | |
| US-48 | Flag tanggal nota | WS-20 | – | – | S-30 | |
| US-49 | Flag satuan | WS-09, WF-04, WA-07 | – | – | – | |
| US-50 | Flag nota ganda | WS-19 | – | – | – | |
| US-51 | Kendaraan | WS-21, WA-04 | AS-03 | – | – | |
| US-52 | Biaya per kendaraan | WF-13, WF-17 | – | – | S-12 | |
| US-53 | Project ATAU pusat biaya | WS-04 | – | P-09 | – | |
| US-54 | OCR nota | – | – | – | – | **OUT** (F7) |
| US-55 | CRUD panel admin + negatif per peran | WS-01, WS-18, WA-03, WA-11 | – | – | S-16 | |
| US-56 | Login SSO & cabut perangkat | WS-01, WA-02, WA-08 | AS-01, AS-14, AS-15 | – | – | |
| US-57 | Resize foto | WA-12 | AS-13 | – | S-24 | |
| US-58 | Mirror Odoo | – | – | – | – | **OUT** (F7) |
| US-59 | Flag tampil ke approver | WF-02, WD-02 | AD-02 | – | S-05 | |

**Ringkasan:** 57 US IN scope, semuanya tercakup; 2 US OUT (US-54 OCR, US-58 mirror Odoo — F7, `plans/fase1-golive.md` §3).
Kolom **Hasil UAT** diisi saat sesi (PASS bila semua skenario US tersebut PASS).
