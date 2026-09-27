# ProyekKas F3: keputusan library export (CSV / XLSX / PDF)

- **Status:** accepted (user 2026-09-24, Q-F3-3 default). Ringkasan "As decided" ada di `architecture.md` §9.4.
  Keputusan ini tidak mengganti stack §3, hanya menambah satu dependency app.
- **Tanggal:** 2026-09-24 · **Penulis:** Analyst · **Basis:** `develop` `e9c07ab`, `architecture.md` §9.3–§9.4, ADR 0008 (PDF).
- **Aturan yang berlaku:** `/opt/infra/CLAUDE.md` §0.10 (lisensi MIT/Apache/BSD/LGPL/AGPL, commit terakhir < 6 bulan, dipakai luas), §0.12 (pin versi).

## 1. Konteks
- M13 / US-25 / US-52 meminta "export Excel". Architecture §9.4 membiarkan library belum diputuskan: `exceljs` gagal aturan
  maintenance, dan `xlsx` di npm sudah basi.
- Kontainer web staging: `mem_limit: 384m`, `NODE_OPTIONS=--max-old-space-size=256` (`deploy/staging/docker-compose.yml`).
  Idle terukur 82 MiB (architecture §3.1). Render PDF memuncak ≈ 149 MiB cgroup (ADR 0008). Karena itu export tidak boleh memakan
  RAM besar, apalagi bila berbarengan dengan PDF.
- Runtime: Node 24 (image app: `node -v` → `v24.21.0`, dicek di sesi ini).

## 2. Fakta registry (diambil di sesi ini, 2026-09-24)
Sumber: `https://registry.npmjs.org/<pkg>`, `https://api.npmjs.org/downloads/point/last-week/<pkg>`, GitHub/GitLab/Gitea API,
GitHub Advisory API, `https://cdn.sheetjs.com/xlsx.lst`.

| Paket | Versi terbaru | Lisensi | Terbit (latest) | Aktivitas repo terakhir | Unduhan/minggu | Dependensi | Catatan |
|---|---|---|---|---|---|---|---|
| `exceljs` | 4.4.0 | MIT | 2023-10-19 | GitHub push 2025-01-21 | 10,67 jt | 9 (archiver, unzipper, tmp, jszip, saxes, fast-csv, …) | **Gagal §0.10** (> 6 bulan). Satu-satunya dengan writer streaming sejati (`WorkbookWriter`). 809 issue terbuka. |
| `@protobi/exceljs` (fork) | 4.4.0-protobi.10 | MIT | 2026-05-07 | GitHub push 2026-06-09 | 16,9 rb | 9 (sama) | Fork aktif tapi kecil (46 bintang). Belum "dipakai luas". |
| `@zurmokeeper/exceljs` (fork) | 4.4.9 | MIT | 2025-02-26 | – | 4,5 rb | 10 | Gagal §0.10. |
| `xlsx` (npm) | 0.18.5 | Apache-2.0 | 2022-03-24 | – | 9,31 jt | 7 | **Rentan:** CVE-2023-30533 (prototype pollution, < 0.19.3), CVE-2024-22363 (ReDoS, < 0.20.2), dan belum ada perbaikan di npm. Ditolak. |
| SheetJS CE (CDN `cdn.sheetjs.com`) | 0.20.3 | Apache-2.0 | tag 2024-07-18 | commit git.sheetjs.com 2026-02-09 | – (bukan npm) | 0 | Rilis terakhir > 2 tahun (commit ada, rilis tidak). Distribusi lewat URL tarball, bukan registry. RAM lebih boros (lihat §3). |
| `@e965/xlsx` (republish SheetJS) | 0.20.3 | Apache-2.0 | 2024-07-19 | – | – | 0 | Republish pihak ketiga dan tidak resmi. Ditolak (rantai pasok). |
| `@cj-tech-master/excelts` | 10.2.0 | MIT (npm) | 2026-06-12 | repo pindah ke `documonster/documonster`, push 2026-09-22, **Apache-2.0** di GitHub | 11,8 rb | 0 | Proyek muda (dibuat 2025-10-25), 321 versi dalam 11 bulan, metadata lisensi npm ≠ repo. Ditolak untuk sekarang. |
| `excel4node` | 1.8.2 | MIT | 2023-05-02 | – | – | 11 | Gagal §0.10. |
| `xlsx-populate` | 1.21.0 | MIT | 2020-03-01 | – | – | 4 | Gagal §0.10. |
| **`write-excel-file`** | **4.1.1** | **MIT** | **2026-06-08** | **GitLab aktivitas 2026-09-18** | **655 rb** | **1 (`fflate` ^0.8.2)** | Lolos §0.10. Node ≥ 18. Rilis rutin (4.0.3 → 4.1.1 antara April dan Juni 2026). Hanya satu maintainer (lihat risiko). |
| `fflate` (dependensi) | 0.8.3 | MIT | 2026-05-16 | – | – | 0 | GHSA-px8p-9vwx-vf98 (CVE-2026-45820) hanya mengenai **`unzipSync`** (membaca ZIP) < 0.8.3. Kita hanya menulis ZIP. Tetap di-pin ≥ 0.8.3 lewat lockfile. |

Advisory `write-excel-file`: tidak ada (GitHub Advisory API, ecosystem npm, 2026-09-24).

## 3. Pengukuran RAM (dijalankan di sesi ini)
- **Metode:** container sekali pakai dari image app `proyekkas-migrate:0.1.0-stg-e9c07ab` (Node v24.21.0), `--memory 384m --network none`.
  Tarball paket diunduh dari registry/CDN (sha256 tercatat di bawah), lalu script uji (scratchpad, **bukan kode app**) membuat N baris
  mirip buku kas (8 kolom: nomor, tanggal, akun, arah, kategori, project, keterangan 60 karakter, nominal) ke file XLSX.
  Angka = `process.resourceUsage().maxRSS` dan termasuk array baris sumber. Baseline Node kosong = 49 MiB.
- **Tarball:** `write-excel-file-4.1.1.tgz` `993e92f7…9fe8`, `fflate-0.8.3.tgz` `38c2cd82…7d92`, `xlsx-0.20.3.tgz` (CDN) `8dc73fc3…9fe8`.

| Library | 1.000 baris | 10.000 baris | 50.000 baris | Ukuran file 10k / 50k |
|---|---|---|---|---|
| write-excel-file 4.1.1 | puncak 73,7 MiB (+24) · 0,2 s | **94,5 MiB (+45)** · 0,7 s | 194 MiB (+145) · 2,7 s | 343 KiB / 1,7 MiB |
| SheetJS CE 0.20.3 | 74,7 MiB (+25) · 0,2 s | 116,6 MiB (+67) · 0,6 s | 309,4 MiB (+260) · 3,3 s | 887 KiB / 4,4 MiB |

Kesimpulan: kedua library membangun workbook di memori (bukan streaming baris demi baris). Pada **≤ 10.000 baris** tambahan RAM
write-excel-file ≈ 45 MiB. Web idle 82 MiB + 45 MiB + (bila bersamaan) PDF, jadi masih jauh di bawah 384 MiB. Pada 50.000 baris
tambahannya ≈ 145 MiB dan terlalu berisiko di web. Skala klien (Q-34 default: 100 pengajuan dan 300 nota per bulan) membuat laporan
setahun penuh tetap jauh di bawah 10.000 baris.

Validitas output dicek: file berisi `xl/styles.xml` dengan `<numFmt formatCode="#,##0"/>` dan `formatCode="dd/mm/yyyy"`. Nominal
tersimpan sebagai angka (`<v>1447500</v>`), dan tanggal sebagai serial Excel (`46266` = 2026-09-01). Konversi tanggal library
memakai `date.getTime()` (UTC), jadi tidak bergeser oleh `TZ` proses.

## 4. Keputusan (usulan)
1. **XLSX: `write-excel-file@4.1.1`** (MIT, pin exact, lockfile menarik `fflate@0.8.3`). Dipakai **server-side saja** (`write-excel-file/node`,
   `toBuffer()`), tidak masuk bundle klien.
2. **Batas XLSX: 10.000 baris data per file.** Di atas itu endpoint mengembalikan 413 dengan pesan "Persempit filter atau pakai CSV".
   Export XLSX dan PDF berbagi **semaphore yang sama (2 bersamaan, antre 10 s → 503)** seperti PDF (ADR 0008).
3. **CSV sebagai baseline** (tanpa library): ditulis sebagai stream, dibaca dengan **paging keyset 1.000 baris** sehingga RAM tetap
   konstan. Batas 100.000 baris.
   - UTF-8 **dengan BOM**, pemisah **`;`** (Excel id-ID memakai koma sebagai desimal, sehingga membuka CSV koma sebagai satu kolom), CRLF, quote RFC 4180.
   - Nominal = bilangan bulat polos tanpa pemisah ribuan (`1447500`), jadi tidak ambigu di locale mana pun.
   - Tanggal = `YYYY-MM-DD` (ISO). Tanggal-waktu = `YYYY-MM-DD HH:MM` WITA dengan header menyebut "(WITA)".
4. **Format id-ID di XLSX:** nominal `#,##0` (Excel menampilkan pemisah sesuai locale pengguna, jadi di Excel id-ID tampil `1.447.500`).
   Kolom diberi header "Nominal (Rp)". Tanggal `dd/mm/yyyy` dari `Date.UTC(y, m-1, d)`. Tanggal-waktu dikonversi dulu ke jam dinding WITA.
   Baris header tebal dan beku (`stickyRowsCount: 1`), serta lebar kolom diatur.
   *Belum diverifikasi:* tampilan di Microsoft Excel dengan regional Indonesia. Ini **wajib diuji QA** (gate F3: "exports open in Excel (id-ID locale) correctly"),
   juga di LibreOffice.
5. **PDF laporan:** memakai **`@react-pdf/renderer@4.9.0` yang sudah ada** (ADR 0008), tanpa dependency baru. A4 landscape, maks. 500 baris
   (ringkasan), semaphore yang sama.
6. **Keamanan (wajib saat build):**
   - Authz: endpoint export memakai scope yang sama dengan tampilan (`overrideAccess:false` atau filter id scope). Uji negatif: PM export project lain → 403/kosong.
   - **Formula injection:** di CSV, sel teks yang diawali `=`, `+`, `-`, `@`, TAB, atau CR diberi awalan `'`. Di XLSX, teks ditulis sebagai string
     (shared string, bukan formula), sehingga tidak dieksekusi. Library tidak menulis formula kecuali `type: 'Formula'`, dan tipe itu dilarang lewat review/Semgrep.
   - Audit: satu baris `action='export'` per unduhan (laporan, filter, format, jumlah baris). Nama file berisi kode laporan + periode, tanpa data pribadi.
   - `Content-Disposition: attachment`, `Cache-Control: no-store`.
7. **Pekerjaan worker/antrian untuk export besar:** tidak di F3 (worker 192 MiB juga tidak cukup untuk 50k baris in-memory). Ditinjau ulang
   hanya bila batas 10.000 baris terbukti kurang.

## 5. Alternatif yang ditolak
- **`exceljs`**: gagal aturan maintenance §0.10 (terbit terakhir 2023-10, push terakhir 2025-01) dan dependensi berat (`archiver`, `unzipper`, `tmp`).
  Streaming-nya bagus, tetapi tidak dibutuhkan pada skala ini. Fork-nya belum dipakai luas.
- **`xlsx` npm 0.18.5**: CVE high tanpa perbaikan di npm.
- **SheetJS CE dari CDN**: rilis terakhir 2024-07 (> 6 bulan), dipasang dari URL tarball di luar registry (lebih sulit diaudit Trivy/Dependabot),
  dan RAM +67 MiB pada 10k baris (vs +45).
- **`@cj-tech-master/excelts`**: proyek muda, versi berganti sangat cepat, lisensi npm (MIT) ≠ repo (Apache-2.0).
- **CSV saja:** aman dan tanpa dependency, tetapi pengguna Excel id-ID perlu "Data › From Text" bila BOM/pemisah tidak dikenali dan
  format ribuan hilang. Tetap tersedia sebagai **fallback** (lihat Rollback).

## 6. Konsekuensi & risiko
- **Satu maintainer** (`catamphetamine`, GitLab). Mitigasi: pin exact, API yang dipakai kecil (array baris → buffer),
  fungsi export dibungkus satu modul `lib/xlsx.ts` sehingga mudah diganti (atau dimatikan).
- Major 4.x mengubah API dari 3.x (README). Upgrade major dibutuhkan review.
- Tambahan image: `write-excel-file` unpacked 1,8 MB + `fflate`. Tidak berpengaruh ke RAM idle karena di-import secara dinamis hanya saat export.

## 7. Rollback
Env/flag `EXPORT_XLSX_ENABLED=false` → tombol Excel disembunyikan dan endpoint `.xlsx` membalas 404. CSV dan PDF tetap jalan. Menghapus dependency
tidak memerlukan migrasi data.

## 8. Verifikasi yang harus dilakukan saat build/QA
- `npm ls write-excel-file fflate` menunjukkan 4.1.1 / ≥ 0.8.3. Trivy tanpa CRITICAL/HIGH.
- Unduhan XLSX dan CSV dari data seed dibuka di Excel (regional Indonesia) dan LibreOffice: nominal `1.447.500` sebagai angka (bisa di-SUM), tanggal benar,
  tidak ada pergeseran hari.
- `docker stats` web saat 2 export XLSX 10.000 baris + 1 PDF bersamaan tetap < 300 MiB. Bila terlewati, turunkan batas baris.
- Baris audit `export` ada untuk setiap unduhan.

## 9. As implemented (F3, `feat/nextjs-f3-dashboards`, 2026-09-24)
- Registry re-checked at build time: `write-excel-file` 4.1.1 = `latest`, MIT, published 2026-06-08 (older than
  `.npmrc` `min-release-age=7`), one dependency `fflate` → lockfile 0.8.3 (`npm ls`: `write-excel-file@4.1.1`,
  `fflate@0.8.3` deduped with pdfkit). `fflate` 0.8.3 also pinned as devDependency (tests unzip the XLSX).
- Code: `lib/xlsx.ts` (lazy import, cap `XLSX_MAX_ROWS = 10 000`, `EXPORT_XLSX_ENABLED`), `lib/csv.ts`,
  `lib/heavy-gate.ts`, `domain/reports/export.ts`, endpoint `GET /api/v1/reports/{code}/{csv|xlsx|pdf}`.
- Verified by tests: amounts stored as numbers (`<v>1447500</v>`), `#,##0` / `dd/mm/yyyy` formats, 2026-09-01 →
  serial 46266, formula-looking text stored as shared string (no `<f>`), CSV BOM/`;`/CRLF and `'` prefix, 413 above
  the caps (no audit row), 404 with the switch off, audit row per download, 429 after 10 exports/min.
- RAM (production image `pk-f3-web:measure` (target `runner`, built with `docker build --memory 2g`: OK, 6 min 57 s),
  `--memory 384m --memory-swap 384m --cpus 0.75`, `NODE_OPTIONS=--max-old-space-size=256` (= staging), app role on a
  throwaway DB with 597 requests, 49 624 audit rows and 10 000 ledger rows in one month. cgroup v2 `memory.current` /
  `memory.peak`: idle **70 MiB** (peak 108 MiB during start-up); Owner Beranda HTML ×3 (heaviest dashboard: 9 KPI
  queries + approval inbox + SVG chart) **107 MiB**, peak 147 MiB, 1.3–3.3 s; dashboard APIs owner/finance ×3 106 MiB;
  report pages 117 MiB; **XLSX 10 000 rows** (Buku Kas, 387 KB, 2.5 s) 137 MiB, second run peak **213 MiB**;
  **2 × XLSX 10 000 rows + 1 report PDF concurrently**: cgroup peak **223 MiB** (58 % of 384 MiB; process VmHWM
  271 MiB incl. shared file pages), third request waited on the shared gate (5.0 s / 7.8 s); CSV 10 000 rows
  (streamed, 916 KB) 156 MiB; back to 105 MiB after 20 s. No OOM, no error log. `write-excel-file` is bundled into
  the server chunks by webpack (not needed in the traced `node_modules`); verified by a real XLSX download.)
- **Not verified (QA gate):** opening the files in Microsoft Excel with Indonesian regional settings and LibreOffice.
