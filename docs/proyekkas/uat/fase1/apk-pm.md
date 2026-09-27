# APK — Project Manager (PM)

Akun: **PM** di HP Android. PM memantau pengajuan tim (tanpa keputusan), membuat laporan progress harian (juga
offline), memantau & mengabsenkan tim, mengoreksi jam absensi, dan mengajukan addendum RAB. Rinci teknis:
`../../f4/f4-e2e-scenario.md` bagian C, S, T, U.

| ID | US | Prasyarat | Langkah | Hasil yang diharapkan | PASS/FAIL | Catatan |
|---|---|---|---|---|---|---|
| AP-01 | US-17 | Login PM | Lihat **Beranda** dan tab bawah. | Tidak ada tombol/tab **Persetujuan**; header **Pantauan tim** (Pengajuan tim bulan ini, Uang muka tim belum LPJ, Realisasi anggaran project saya); tombol Ajukan Uang Muka/Reimburse, Laporan progress, Addendum RAB, Absensi. | | |
| AP-02 | US-17 | Ada pengajuan Staff di PRJ-UJI-01 | **Pengajuan** → tab **Tim** → buka pengajuan Staff. | Keterangan "Pantauan tim — hanya lihat…"; detail tanpa tombol Setujui/Tolak; Giliran = Direktur atau Finance. | | |
| AP-03 | US-10 | P-06, P-08; di lokasi PRJ-UJI-01 | **Laporan progress** → tab Laporan → **Laporan baru** (mode pesawat): project PRJ-UJI-01, tahapan Struktur, % = sebelumnya + 10, Pekerjaan "UAT pengecoran kolom", Kendala "hujan", 3 foto kamera belakang → **Simpan & kirim**. Matikan mode pesawat. | Offline: "Laporan tersimpan di HP (offline)…", status Menunggu kirim. Online: nomor `LP/YYMM/####`, tanda offline; progress project naik = bobot × kenaikan (30% × 10 = 3 poin). Web (WP-06/WD-07) menampilkan laporan & foto. | | |
| AP-04 | US-10 | AP-03 | Laporan baru untuk Struktur dengan % di bawah nilai sekarang. Tambah foto sampai 5. | "Progress tidak boleh turun (sebelumnya X%)."; tombol Foto hilang setelah 5 foto (galeri tidak tersedia). | | |
| AP-05 | US-10 | AP-03 (≤ 24 jam) | Buka laporan AP-03 → **Edit laporan (≤ 24 jam)** → ubah pekerjaan tanpa alasan, lalu dengan alasan "Tambah keterangan" → simpan. Opsional: konflik HP vs web (f4 S.10–S.11). | Tanpa alasan: "Alasan edit wajib diisi…". Dengan alasan: tersimpan, audit web berisi alasan. Laporan > 24 jam tidak punya tombol Edit. | | |
| AP-06 | US-12 | AP-03 | **Laporan progress** → tab **Project**; Beranda kartu "Progress fisik vs anggaran". | Batang Progress fisik & Anggaran terpakai (% tertulis), label warna + ikon (Sesuai / Perlu dicek / merah), "Selisih …%". | | |
| AP-07 | US-13 | Staff sudah absen (AS-07) | **Absensi** → tab **Tim**; pakai chip filter. | Jumlah Semua / Belum absen / Hadir / Selesai; anggota tim dengan jam; filter bekerja. | | |
| AP-08 | US-14 | Karyawan Tanpa HP ditugaskan (P-10); di lokasi PRJ-UJI-01 | Tim → **Absenkan anggota tim** → Karyawan Tanpa HP → PRJ-UJI-01 → Absen masuk tanpa alasan, lalu alasan "Tidak punya HP" → foto kamera belakang. Cari nama PM sendiri di daftar. | Tanpa alasan ditolak "Wajib diisi (minimal 3 karakter)."; berhasil: status Hadir + tanda **"Oleh PM"**; web: sumber "Diabsenkan oleh PM", nama PM, alasan, foto. Nama PM sendiri tidak ada di daftar. | | |
| AP-09 | US-15 | AP-07 | Tim → Staff Uji → tombol jam **Masuk hh.mm** → ubah jam tanpa alasan → Simpan; lalu alasan "Lupa absen tepat waktu". | Tanpa alasan ditolak; dengan alasan "Koreksi absensi tersimpan." dan tanda "Dikoreksi"; web: lama → baru + alasan. Offline: Simpan mati. | | |
| AP-10 | US-18 | PRJ-UJI-01 punya RAB | **Addendum RAB** → **Addendum baru** → Ajukan tanpa isian; lalu project PRJ-UJI-01, Tambahan RAB 25.000.000, alasan "UAT tambahan pondasi" → Ajukan. | Kosong: "Pilih project.", "Tambahan RAB harus lebih dari Rp 0.", "Alasan wajib diisi…". Berhasil: "Addendum diajukan. Menunggu Direktur."; nomor `ADD/YYMM/####`, RAB lama → baru. | | |
| AP-11 | US-11 | Seperti WP-12 | Buka lonceng Beranda PM keesokan harinya setelah jam kirim pengingat. | Notifikasi pengingat laporan progress terlambat (satu per hari). | | |
