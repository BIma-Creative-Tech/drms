# APK — Direktur & Finance

Akun: **Direktur** dan **Finance** di HP Android. Keduanya punya tab **Persetujuan** (Direktur = "Diketahui",
Finance = Approval), kartu **Ringkasan** di Beranda, tanpa tab Antrean dan tanpa tombol buat pengajuan. Rinci teknis:
`../../f4/f4-e2e-scenario.md` bagian D, P, S.14, T.12, U.

| ID | US | Prasyarat | Langkah | Hasil yang diharapkan | PASS/FAIL | Catatan |
|---|---|---|---|---|---|---|
| AD-01 | US-27, US-28 | Ada transaksi | Login **Direktur** → Beranda **Ringkasan**; ketuk satu bulan di grafik **Arus kas bulanan**. Bandingkan dengan Beranda web Direktur. | Kartu Saldo kas total, Pengajuan menunggu ("Diketahui n · Approval n"), Pencairan bulan ini, Realisasi vs anggaran; angka Masuk/Keluar bulan terpilih; sama dengan web (WD-01). | | |
| AD-02 | US-26, US-42, US-43, US-59 | Pengajuan AS-02 menunggu Direktur | **Menunggu Persetujuan** → kartu AS-02 ("Persetujuan Direktur (Diketahui)", total, **Dampak anggaran** sebelum → sesudah, flag "n peringatan · n info") → buka → **Setujui** → **Tanda tangan di layar** → gambar → Konfirmasi. | "Keputusan tersimpan."; status **Menunggu Approval**; timeline Diketahui (Direktur) ✓; tanda tangan gambar layar tersimpan di posisi Diketahui (lihat PDF di web). | | |
| AD-03 | US-26, US-42 | Pengajuan lain menunggu Direktur | **Tolak** tanpa alasan; lalu alasan "Tidak mendesak". | "Alasan wajib diisi (minimal 3 karakter)."; dengan alasan: Ditolak. | | |
| AD-04 | US-26, US-43 | AD-02 | Login **Finance** → Menunggu Persetujuan → AS-02 ("Approval level 1") → **Setujui** → **Pakai tanda tangan profil** → Konfirmasi. | Status **Disetujui**; timeline Diketahui (Direktur) ✓, Approval (Finance) ✓. | | |
| AD-05 | US-26 | Pengajuan lain masih menunggu Direktur | Finance membuka pengajuan itu dari tab **Pengajuan** (bukan inbox). | Tidak ada tombol keputusan (bukan giliran Finance). | | |
| AD-06 | US-30 | AP-10 | Direktur → Persetujuan → bagian "Addendum RAB menunggu Anda" → **Setujui (Direktur)**. Finance → Persetujuan → **Setujui (Finance)**. Addendum kedua: Direktur **Tolak** tanpa/dengan alasan. | Setelah Direktur: "Menunggu Finance"; setelah Finance: Disetujui, RAB bertambah Rp 25.000.000 (web). Tolak tanpa alasan ditolak; dengan alasan: Ditolak, PM melihat alasan, RAB tetap. | | |
| AD-07 | US-31 | AP-03 | Direktur → **Laporan progress** → filter project → buka laporan → foto layar penuh. Finance → **Progress project**. | Direktur melihat semua laporan + tombol Laporan baru; Finance hanya melihat (tanpa Laporan baru/Edit). | | |
| AD-08 | US-13 | AS-07 | Direktur/Finance → Beranda → **Absensi** ("Kehadiran tim hari ini"). | Langsung ke **Tim hari ini** semua karyawan; tanpa Absenkan; Finance tanpa koreksi. | | |
| AD-09 | US-27 | Ada antrian transfer/LPJ | Finance → Beranda **Ringkasan**; bandingkan dengan Beranda web Finance. Mode pesawat → tarik Beranda. | Saldo kas total, Antrian transfer, Menunggu verifikasi ("n LPJ · n nota reimburse"), Selisih LPJ sama dengan web. Offline: "Ringkasan belum bisa dimuat" + tombol muat ulang. | | |
