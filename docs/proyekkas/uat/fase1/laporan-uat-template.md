# ProyekKas Fase 1 — Laporan UAT (TEMPLATE)

> Salin file ini menjadi `laporan-uat-<YYYY-MM-DD>.md` untuk setiap sesi UAT. Isi semua `…`. Jangan menulis
> kata sandi, token, atau data pribadi karyawan/klien yang asli di laporan ini (repo publik). Pola mengikuti
> `../f2-uat-report.md`.

- **Tanggal sesi:** … · **Tempat:** … (kantor DRMS / daring)
- **Lingkungan:** `https://drms-kas.staging.bimacreative.tech` (realm `drms-staging`) / prod `…` (bila UAT di prod sebelum cut-over)
- **Build web yang diuji:** `proyekkas-web:…` (`develop` `…`) · **Build worker:** `…`
- **APK yang diuji:** versi `…` (build `…`), varian staging/prod, ditandatangani kunci `…`
- **HP yang dipakai:** merek/model/Android: …, … (minimal 2 merek, risiko R10)
- **Akun:** akun uji fiktif (`*.uji@proyekkas.test` atau yang disepakati), dibuat lewat UAT seed; tidak ada kredensial di repo.
- **Skrip yang dipakai:** `docs/proyekkas/uat/fase1/` @ commit `…`
- **Peserta:**

| Nama | Perusahaan | Peran di sesi (Staff/PM/Finance/Direktur/Admin/fasilitator) |
|---|---|---|
| … | PT DRMS | … |
| … | vendor | fasilitator / pencatat |

## 1. Ringkasan hasil

| Kelompok | Jumlah skenario | PASS | FAIL | Tidak diuji | Catatan |
|---|---:|---:|---:|---:|---|
| 00 Persiapan | | | | | |
| Web — Staff | | | | | |
| Web — PM | | | | | |
| Web — Finance | | | | | |
| Web — Direktur | | | | | |
| Web — Admin | | | | | |
| APK — Staff | | | | | |
| APK — PM | | | | | |
| APK — Direktur & Finance | | | | | |
| **Total** | | | | | |

**Kesimpulan:** … (mis. "Semua US IN scope lulus; 2 FAIL prioritas rendah dengan keputusan terlampir").

## 2. Metode

- Skenario dijalankan **manual** oleh pengguna klien, didampingi fasilitator; urutan mengikuti `README.md` §Urutan.
- Bukti: tangkapan layar per skenario (tanpa kata sandi), nomor dokumen yang terbit, jam (WITA).
- Satu skenario FAIL tidak menghentikan sesi; skenario yang bergantung padanya ditandai "Tidak diuji — bergantung
  <ID>".
- Prioritas FAIL: **Tinggi** = salah uang/saldo, data hilang, akses tidak sah, alur utama macet; **Sedang** = alur
  bisa diselesaikan dengan cara lain; **Rendah** = tampilan/kata-kata.

## 3. Hasil per skenario

Salin kolom PASS/FAIL/Catatan dari lembar skrip, atau tempelkan tabel di bawah untuk skenario yang FAIL/Tidak diuji saja.

| ID skenario | US | Hasil | Prioritas | Catatan / bukti |
|---|---|---|---|---|
| … | … | PASS/FAIL/Tidak diuji | – / Tinggi / Sedang / Rendah | … |

## 4. Temuan & keputusan

| # | ID skenario | Temuan | Prioritas | Keputusan (perbaiki sebelum go-live / terima / tunda ke versi berikut) | PIC | Target |
|---|---|---|---|---|---|---|
| 1 | … | … | … | … | … | … |

Aturan E12 (`plans/fase1-golive.md` §E12 AC): **tidak boleh ada FAIL prioritas Tinggi tanpa keputusan** saat
tanda tangan di §7.

## 5. Selisih perilaku vs kebutuhan yang diketahui sebelum UAT

Daftar awal ada di `README.md` §Selisih yang diketahui. Catat di sini mana yang **diterima** klien dan mana yang
harus diubah.

| # | Selisih | Diterima klien? (Ya/Tidak) | Catatan |
|---|---|---|---|
| … | … | … | … |

## 6. Tidak dicakup sesi ini

- US di luar scope go-live: US-54 (OCR nota, F7), US-58 (mirror Odoo, F7).
- Push notification FCM (E8) bila Firebase belum siap — notifikasi diuji lewat lonceng in-app + email.
- Uji non-fungsional (load test, ZAP, restore drill) — laporan E9 terpisah.
- …

## 7. Persetujuan (sign-off)

Dengan menandatangani, pihak klien menyatakan bahwa skenario UAT di atas telah dijalankan dengan hasil seperti
tercatat, dan aplikasi **diterima / diterima dengan catatan / belum diterima** (coret yang tidak perlu) untuk
go-live, dengan temuan terbuka di §4 ditangani sesuai keputusan yang tercatat.

| Peran | Nama | Jabatan | Tanda tangan | Tanggal |
|---|---|---|---|---|
| Direktur PT DRMS (pemberi persetujuan) | | | | |
| Finance PT DRMS | | | | |
| PIC klien UAT (G1-7) | | | | |
| Perwakilan vendor (Lead) | | | | |
| QA vendor (pencatat) | | | | |

Keputusan akhir: ☐ Diterima ☐ Diterima dengan catatan (lihat §4) ☐ Belum diterima — sesi ulang tanggal: ……
