# RR Teams (ProyekKas) — Kebutuhan Pengembangan v1.3 (Laporan lapangan per jenis project)

Klien: grup DRMS (PT Double Rezki Makmur Sejahtera dan PT lain dalam grup) · Tanggal: 9 Oktober 2026 · Status: **disetujui owner untuk P1 (DRMS); konstruksi menyusul (P3)**
Penyusun: nextjs developer (fase P0 dokumen + P1 backend)

Sumber:
- Keputusan owner 2026-10-09 (rencana "Laporan lapangan per jenis usaha — RR Teams") dan klarifikasi sesudahnya:
  jenis laporan mengikuti **jenis project** (PT mana pun boleh punya project jenis apa pun); % progress konstruksi dari
  item pekerjaan (P3).
- `adr/0020-field-reports-per-project-kind.md` (keputusan teknis), `requirements-v1.2.md` (dasar dokumen ini).
- Mockup layar: kanvas mockup laporan lapangan (Android servis/timesheet/aktivitas, web matriks + rekap).

**Hubungan dengan v1.2.** Dokumen ini adalah **tambahan bertingkat (delta)** terhadap v1.2 (dan v1.1). Semua isi v1.2
**tetap berlaku**, kecuali bagian yang ditandai `[Diubah v1.3]`; aturan baru ditandai `[Tambahan v1.3]`.

Penanda: `[Keputusan owner 2026-10-09]` mengikat; `[Usulan]` belum dikonfirmasi klien (lihat §8). Nama orang dan
nomor dokumen di contoh **fiktif**.

---

## Changelog v1.2 → v1.3

| # | Perubahan | Bagian | Sumber |
|---|---|---|---|
| 1 | **Jenis project** `umum / konstruksi / kontrak_unit / aftersales / trading` menentukan laporan lapangan yang tersedia. Project lama = `umum`. | 1 | [Keputusan owner 2026-10-09] |
| 2 | **Staff yang ditugaskan** ke project boleh membuat laporan lapangan (servis, timesheet, aktivitas). Laporan progress manual tetap PM/Direktur. | 4 | [Keputusan owner 2026-10-09] |
| 3 | Master **Kendaraan** menjadi **Unit & Kendaraan** (alat berat, kode unit, pemilik sendiri/pelanggan, status, HM terakhir). | 2 | [Keputusan owner 2026-10-09] |
| 4 | Master baru **Unit kontrak** (unit armada di project kontrak, tarif per jam + minimum jam atau per bulan). | 2 | [Keputusan owner 2026-10-09] |
| 5 | Dokumen baru: **Laporan servis unit** (SV/YYMM/####), **Timesheet harian unit**, **Log aktivitas aftersales**. | 3 | [Keputusan owner 2026-10-09] |
| 6 | Tarif kontrak, estimasi tagihan, dan nilai aftersales **hanya** Direktur/Finance/Admin (nilai aftersales juga pelapornya). | 4 | [Keputusan owner 2026-10-09] |
| 7 | Rekap timesheet bulanan per kontrak dengan **estimasi tagihan (bukan invoice)**; rekap aftersales mingguan + PO terbuka. | 5 | [Keputusan owner 2026-10-09] |
| 8 | Sparepart **tanpa stok** (dicatat sebagai teks di laporan). | 3 | [Keputusan owner 2026-10-09] |
| 9 | Flag per PT **Laporan lapangan aktif** (default mati). | 6 | [Keputusan owner 2026-10-09] |
| 10 | User story US-60…US-68. | 7 | — |

---

## 1. Jenis project [Tambahan v1.3]

| Jenis | Laporan lapangan | Contoh |
|---|---|---|
| `kontrak_unit` | Timesheet unit + Laporan servis | DRMS sewa excavator ke tambang |
| `aftersales` | Laporan servis + Log aktivitas aftersales | DRMS servis & jual sparepart ke pelanggan |
| `konstruksi` | Laporan harian konstruksi (P3, RAP) | LAS / Teams proyek gedung |
| `trading`, `umum` | — (cukup pengajuan biaya & kas) | Teams trading |

- Diubah oleh **Direktur** atau **Admin** PT (Admin hanya boleh mengubah jenis, bukan isian project lain).
- Tidak bisa diubah lagi setelah project punya unit kontrak atau laporan lapangan.
- Laporan pada project berjenis lain ditolak (`WRONG_PROJECT_KIND`).

## 2. Master [Tambahan v1.3] [Diubah v1.3 atas §6 v1.1 "Kendaraan"]

**Unit & Kendaraan** (`vehicles`, per PT): jenis kendaraan/alat berat; kode unit (wajib untuk alat berat, unik per PT,
mis. `EX-01`); nomor polisi (wajib untuk kendaraan, unik bila diisi); tipe, merek/model, no. seri; pemilik **sendiri**
(armada sewa) atau **pelanggan** (wajib pilih pelanggan dari master Klien PT yang sama); status unit
(`siap / rusak / menunggu_part`) dan HM terakhir diisi **sistem** dari laporan.

**Unit kontrak** (`contract-units`, per PT): project (jenis kontrak_unit), unit (milik sendiri), mulai, selesai (kosong =
berjalan), dasar tarif `per_jam` / `per_bulan`, tarif (Rp), minimum jam per bulan, aktif, catatan. Satu unit tidak
boleh aktif di dua kontrak pada tanggal yang sama. Diubah Admin/Direktur; tidak dihapus (nonaktif dengan alasan).

**Satuan** (bersama): ditambah M, M1, M2, M3, KG, TON, SAK, ZAK, BTG, LBR, TITIK, BH, SET, ROLL, KALENG, BKS, OH, JAM,
LTR, HM.

## 3. Dokumen [Tambahan v1.3]

| Dokumen | Isi | Aturan |
|---|---|---|
| **Laporan servis unit** (SV/YYMM/####) | Project, unit, tanggal, mekanik (pelapor) + helper, jam mulai/selesai, HM, jenis servis (`servis_berkala / perbaikan / inspeksi / pemasangan`), keluhan, tindakan, sparepart (nama, no. part, jumlah, satuan, ket.), status unit sesudah servis, catatan, foto ≤ 10. | HM tidak boleh lebih kecil dari HM terakhir unit (`HM_DECREASED`; koreksi PM/Direktur). Unit pelanggan harus milik klien project (bila project punya klien). Status unit ikut berubah; "menunggu part" → notifikasi ke PM project. |
| **Timesheet harian unit** | Project, unit, tanggal, HM awal/akhir, jam kerja/standby/breakdown + alasan, BBM (liter), operator (teks), lokasi, catatan, foto meter HM (wajib 1). | Satu per unit per tanggal; unit harus di unit kontrak aktif project pada tanggal itu; HM akhir ≥ awal; total jam ≤ 24; breakdown wajib alasan; HM awal ≠ HM akhir timesheet sebelumnya → tanda **HM_GAP** (tidak ditolak); breakdown ≥ 4 jam → saran laporan servis; HM terakhir unit diperbarui. |
| **Aktivitas aftersales** | Project, tanggal, pelapor, pelanggan, jenis (`penawaran / po_masuk / pengiriman / penagihan / kunjungan / lainnya`), no. dokumen (Q/PO/SJ/INV), item (nama, no. part, jumlah, satuan), nilai (Rp, opsional), PO terkait, status PO, tanggal follow-up, penerima, foto ≤ 5, catatan. | Pelanggan PT yang sama. Pengiriman wajib mengacu PO masuk pelanggan yang sama; "PO selesai dikirim?" ya → `terkirim`, tidak → `sebagian`; PO terkirim/batal menolak pengiriman baru (`PO_CLOSED`). Follow-up penawaran jatuh tempo → pengingat ke pelapor + PM (sekali). |

Semua dokumen: tidak bisa dihapus; pelapor mengedit ≤ 24 jam; sesudahnya hanya **koreksi PM project / Direktur dengan
alasan** (tercatat di audit log, tanda "Dikoreksi"); tanggal laporan tidak di masa depan dan paling lama 14 hari ke
belakang; data offline ditandai `OFFLINE`, tanggal mundur `BACKDATED`.

## 4. Matriks akses [Diubah v1.3 atas §4 v1.1 / §3 v1.2]

**Baris baru** (per PT; "ditugaskan" = penugasan tim aktif; *team* = project tim PM):

| Modul | Staff | PM | Finance | Direktur | Admin |
|---|---|---|---|---|---|
| Jenis project | R (project ditugaskan) | R (tim) | R | C/R/U | R/U (hanya jenis) |
| Unit & Kendaraan | R | R | R | R/U | C/R/U |
| Unit kontrak (tanpa tarif) | R (ditugaskan) | R (tim) | R | C/R/U | C/R/U |
| **Tarif kontrak, estimasi tagihan** | – | – | R | R | R |
| Laporan servis unit | C (ditugaskan) / R (ditugaskan + sendiri) / U sendiri ≤ 24 jam | C/R (tim) / U sendiri ≤ 24 jam / koreksi (tim) | R | C/R/U sendiri / koreksi (semua) | R |
| Timesheet unit | sama seperti laporan servis | sama | R | sama | R |
| Aktivitas aftersales | sama seperti laporan servis | sama | R | sama | R |
| **Nilai aktivitas aftersales** | R hanya yang ia isi | – (kecuali yang ia isi) | R | R | R |
| Klien (pemilih pelanggan) | R bila ditugaskan ke project aftersales | R | R | C/R/U | C/R/U |
| Rekap timesheet kontrak / rekap aftersales | – | R (tim, tanpa tarif/nilai) | R | R | R |
| Laporan progress manual (E4) | **– (tidak berubah)** | C/R (tim) | R | C/R | R |

Catatan: baris "Laporan progress: Staff –" v1.1 §4 **tetap berlaku untuk laporan progress manual**; hak Staff di atas
hanya untuk dokumen baru v1.3 (ADR 0020 §2).

## 5. Rekap [Tambahan v1.3]

- **Rekap timesheet kontrak** (bulanan, per unit kontrak): hari kontrak, hari timesheet, hari tanpa timesheet, total HM,
  jam kerja/standby/breakdown, ketersediaan % = (kerja + standby) / (kerja + standby + breakdown), jumlah hari HM_GAP;
  untuk Direktur/Finance/Admin: dasar tarif, tarif, jam ditagih, **estimasi tagihan** — per jam: tarif × maks(jam
  kerja, minimum jam; minimum diprorata bila kontrak tidak sebulan penuh); per bulan: tarif × hari kontrak / hari dalam
  bulan. Ditandai **"estimasi, bukan invoice"**. Rincian timesheet harian. CSV/XLSX/PDF.
- **Rekap aftersales** (default minggu berjalan Senin–hari ini, per pelanggan): penawaran, PO masuk, terkirim,
  sebagian, belum kirim, batal, pengiriman, penagihan, kunjungan, nilai PO (Direktur/Finance/Admin); tabel PO terbuka
  dengan umur; follow-up penawaran jatuh tempo.

## 6. Flag & sinkronisasi [Tambahan v1.3]

- Setting perusahaan **"Laporan lapangan per jenis project aktif"** (`fieldReportsEnabled`, default mati, tidak ikut
  disalin ke PT baru). Mati → pembuatan laporan baru ditolak `FEATURE_DISABLED` (web, API, APK); data lama tetap terbaca.
- `GET /api/v1/me`: per PT `capabilities.serviceReportCreate / unitTimesheetCreate / aftersalesActivityCreate` dan
  `settings.fieldReportsEnabled`.
- Sinkronisasi offline APK: item `service_report.upsert`, `unit_timesheet.upsert`, `aftersales_activity.upsert` (aturan
  sama dengan laporan progress: replay idempoten, konflik `base_rev` → versi server menang).

## 7. User story [Tambahan v1.3]

"Server menolak" = API mengembalikan error, tidak ada perubahan data, dibuktikan test API.

| ID | User story | Kriteria penerimaan |
|---|---|---|
| US-60 | Sebagai Direktur/Admin, saya ingin menetapkan jenis project agar laporan lapangan yang tepat tersedia. | Jenis default `umum`; hanya Direktur/Admin PT yang mengubah (Admin tidak bisa mengubah isian lain → 403 menyebut isiannya); jenis terkunci setelah ada unit kontrak/laporan (409); laporan pada jenis lain → 409 `WRONG_PROJECT_KIND`. |
| US-61 | Sebagai Admin, saya ingin mengelola Unit & Kendaraan termasuk alat berat dan unit milik pelanggan. | Alat berat wajib kode unit (unik per PT), kendaraan wajib plat; unit pelanggan wajib pelanggan PT yang sama (DB menolak lintas PT); status & HM terakhir tidak bisa diisi manual. |
| US-62 | Sebagai Admin/Direktur, saya ingin mencatat unit kontrak dengan tarifnya. | Project jenis kontrak_unit, unit milik sendiri; unit yang sama tidak bisa aktif di dua kontrak pada tanggal yang sama (form + DB menolak); tarif & minimum jam tidak terlihat oleh Staff/PM (REST dan API). |
| US-63 | Sebagai mekanik (Staff yang ditugaskan), saya ingin membuat laporan servis unit dengan foto dan sparepart. | Nomor SV/YYMM/####; foto ≤ 10; sparepart baris tervalidasi tanpa stok; HM < HM terakhir → 409 `HM_DECREASED`; status unit ikut berubah; "menunggu part" → notifikasi PM project; Staff yang tidak ditugaskan → 403 (tercatat `access_denied`). |
| US-64 | Sebagai Staff kontrak, saya ingin mengisi timesheet harian unit. | Satu per unit per tanggal (409 `DUPLICATE_DATE`); unit di kontrak aktif (409 `NOT_IN_CONTRACT`); total jam ≤ 24; foto HM wajib 1; HM awal ≠ HM akhir sebelumnya → tanda HM_GAP; HM terakhir unit diperbarui. |
| US-65 | Sebagai staff aftersales, saya ingin mencatat aktivitas harian per pelanggan (penawaran, PO, pengiriman, penagihan, kunjungan). | Pelanggan PT yang sama; pengiriman mengacu PO pelanggan yang sama dan mengubah status PO; PO terbuka bisa dilihat (`GET /aftersales/open-pos`); nilai Rp hanya terlihat Direktur/Finance/Admin dan pelapornya; follow-up jatuh tempo → pengingat pelapor + PM satu kali. |
| US-66 | Sebagai pelapor, saya ingin memperbaiki laporan saya dalam 24 jam; sebagai PM/Direktur, saya ingin mengoreksi sesudahnya dengan alasan. | Pelapor: edit ≤ 24 jam (lewat → 409 `NOT_EDITABLE`); orang lain → 403; koreksi PM tim/Direktur kapan saja, alasan wajib, tercatat audit "Koreksi: …", tanda "Dikoreksi"; tidak ada hapus (DB menolak). |
| US-67 | Sebagai Finance/Direktur, saya ingin rekap timesheet bulanan per kontrak dengan estimasi tagihan. | §5; PM melihat jam tanpa tarif/estimasi; Staff tidak punya akses; export CSV/XLSX/PDF. |
| US-68 | Sebagai Direktur/Finance, saya ingin rekap aftersales mingguan per pelanggan dan daftar PO terbuka. | §5; nilai hanya untuk Direktur/Finance/Admin. |

## 8. Pertanyaan terbuka untuk klien [Usulan]

| ID | Pertanyaan | Dampak |
|---|---|---|
| Q-FR-1 | Daftar **jenis servis** baku DRMS (sekarang: servis berkala, perbaikan, inspeksi, pemasangan) dan **alasan breakdown** baku (sekarang teks bebas)? | Pilihan di APK, rekap breakdown per alasan. |
| Q-FR-2 | Aturan tarif kontrak: ada **lembur** (jam > 8/hari) atau **tarif standby**? Apakah minimum jam diprorata untuk bulan tidak penuh (sekarang: ya)? | Rumus estimasi tagihan. |
| Q-FR-3 | Perlu **tanda tangan klien** di timesheet atau berita acara servis? | Layar APK + PDF (sekarang belum). |
| Q-FR-4 | **PT LAS** dan **PT Teams** sudah ada di aplikasi, atau perlu dibuat Admin grup? | Persiapan P3 (konstruksi). |
| Q-FR-5 | Ketersediaan % memakai jam yang dilaporkan (kerja + standby + breakdown). Perlu **jam rencana per hari** di kontrak (mis. 10 jam/hari) sebagai pembagi? | Rumus ketersediaan. |
| Q-FR-6 | Batas tanggal laporan mundur (sekarang 14 hari) cukup untuk lokasi tanpa sinyal? | Validasi APK offline. |
