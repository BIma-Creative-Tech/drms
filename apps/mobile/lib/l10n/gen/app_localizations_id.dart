// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Indonesian (`id`).
class AppLocalizationsId extends AppLocalizations {
  AppLocalizationsId([String locale = 'id']) : super(locale);

  @override
  String get appTitle => 'ProyekKas';

  @override
  String get loading => 'Memuat…';

  @override
  String get retry => 'Coba lagi';

  @override
  String get cancel => 'Batal';

  @override
  String get save => 'Simpan';

  @override
  String get close => 'Tutup';

  @override
  String get delete => 'Hapus';

  @override
  String get yes => 'Ya';

  @override
  String get no => 'Tidak';

  @override
  String get next => 'Lanjut';

  @override
  String get needsInternet => 'Butuh koneksi internet';

  @override
  String get offlineBanner => 'Offline — data disimpan di HP dan dikirim otomatis saat online.';

  @override
  String pendingQueue(int count) {
    return '$count data menunggu dikirim';
  }

  @override
  String failedQueue(int count) {
    return '$count data gagal dikirim — buka Antrean';
  }

  @override
  String get loginTitle => 'Masuk ke ProyekKas';

  @override
  String get loginSubtitle => 'Gunakan akun DRMS Anda. Halaman masuk dibuka di browser HP.';

  @override
  String get loginButton => 'Masuk';

  @override
  String get loginCancelled =>
      'Login dibatalkan. Jika halaman login tidak kembali ke aplikasi, tutup browser lalu tekan Masuk lagi.';

  @override
  String get loginFailed => 'Login gagal. Coba lagi.';

  @override
  String get loginNeedsInternet => 'Login pertama kali butuh koneksi internet.';

  @override
  String get sessionEnded => 'Sesi berakhir atau perangkat dicabut. Silakan masuk kembali.';

  @override
  String get deviceRevoked =>
      'Perangkat ini sudah dicabut dari akun Anda oleh Admin/Direktur. Silakan masuk kembali atau hubungi Admin.';

  @override
  String get stagingBadge => 'STAGING';

  @override
  String get loginSubtitlePassword => 'Gunakan akun DRMS Anda.';

  @override
  String get loginUsernameLabel => 'Email atau username';

  @override
  String get loginUsernameRequired => 'Isi email atau username.';

  @override
  String get loginPasswordLabel => 'Kata sandi';

  @override
  String get loginPasswordRequired => 'Isi kata sandi.';

  @override
  String get loginShowPassword => 'Tampilkan kata sandi';

  @override
  String get loginHidePassword => 'Sembunyikan kata sandi';

  @override
  String get loginForgotPassword => 'Lupa kata sandi? Hubungi Admin.';

  @override
  String get updateRequiredTitle => 'Perbarui aplikasi';

  @override
  String updateRequiredBody(String current, String minimum) {
    return 'Versi aplikasi ini ($current) sudah tidak didukung. Versi minimal: $minimum.';
  }

  @override
  String get updateDownloadHint => 'Unduh versi terbaru dari:';

  @override
  String get copyLink => 'Salin tautan';

  @override
  String get updateContactAdmin => 'Hubungi admin untuk mendapatkan APK terbaru.';

  @override
  String updateAvailable(String version) {
    return 'Versi baru tersedia ($version).';
  }

  @override
  String get navHome => 'Beranda';

  @override
  String get navRequests => 'Pengajuan';

  @override
  String get navInbox => 'Persetujuan';

  @override
  String get navQueue => 'Antrean';

  @override
  String get navProfile => 'Profil';

  @override
  String greeting(String name) {
    return 'Halo, $name';
  }

  @override
  String get actionNewAdvance => 'Ajukan Uang Muka';

  @override
  String get actionNewReimburse => 'Ajukan Reimburse';

  @override
  String get actionMyRequests => 'Pengajuan Saya';

  @override
  String get actionInbox => 'Menunggu Persetujuan';

  @override
  String get actionAttendance => 'Absensi';

  @override
  String get actionAttendanceOff => 'Absensi (belum diaktifkan Admin)';

  @override
  String get actionAllRequests => 'Semua Pengajuan';

  @override
  String get financeHint => 'Transfer, verifikasi nota/LPJ, dan buku kas dikerjakan di web admin.';

  @override
  String inboxCount(int count) {
    return '$count menunggu';
  }

  @override
  String get requestsTitle => 'Pengajuan';

  @override
  String get tabDrafts => 'Draft di HP';

  @override
  String get tabSent => 'Terkirim';

  @override
  String get noDrafts => 'Belum ada draft.';

  @override
  String get noRequests => 'Belum ada pengajuan.';

  @override
  String get loadMore => 'Muat lagi';

  @override
  String get draftUntitled => '(tanpa judul)';

  @override
  String get syncStateLocal => 'Belum dikirim';

  @override
  String get syncStateQueued => 'Menunggu sinkron';

  @override
  String get syncStateSynced => 'Tersimpan di server';

  @override
  String get syncStateConflict => 'Konflik — diubah di web';

  @override
  String get syncStateRejected => 'Ditolak server';

  @override
  String get syncStateSubmitted => 'Sudah diajukan';

  @override
  String get detailTitle => 'Detail Pengajuan';

  @override
  String get turnLabel => 'Giliran';

  @override
  String get timelineTitle => 'Posisi tanda tangan';

  @override
  String get linesTitle => 'Baris item';

  @override
  String get receiptsTitle => 'Nota';

  @override
  String get flagsTitle => 'Flag validasi';

  @override
  String get grandTotal => 'Grand total';

  @override
  String get approvedAmount => 'Disetujui';

  @override
  String get neededDate => 'Tanggal dibutuhkan';

  @override
  String get requestDate => 'Tanggal pengajuan';

  @override
  String get requesters => 'Diajukan oleh';

  @override
  String get createdBy => 'Dibuat oleh';

  @override
  String get bankAccount => 'Rekening tujuan';

  @override
  String get scopeLabel => 'Project / pusat biaya';

  @override
  String get rejectReasonLabel => 'Alasan ditolak';

  @override
  String get budgetImpact => 'Dampak anggaran';

  @override
  String get budgetNone => 'Tanpa anggaran';

  @override
  String budgetChange(String before, String after) {
    return '$before → $after';
  }

  @override
  String get receiptThumbFailed => 'Gambar tidak dapat dimuat';

  @override
  String get totalPreview => 'Total (pratinjau)';

  @override
  String get previewNote => 'Nilai final dihitung server.';

  @override
  String get editorNewTitle => 'Pengajuan baru';

  @override
  String get editorEditTitle => 'Ubah draft';

  @override
  String get fieldType => 'Jenis';

  @override
  String get fieldTitle => 'Judul';

  @override
  String get fieldProject => 'Project';

  @override
  String get fieldCostCenter => 'Pusat biaya';

  @override
  String get fieldNeededDate => 'Tanggal dibutuhkan';

  @override
  String get fieldNotes => 'Keterangan';

  @override
  String get fieldRequesters => 'Diajukan oleh (pemohon)';

  @override
  String get fieldBankAccount => 'Rekening tujuan';

  @override
  String get scopeProject => 'Project';

  @override
  String get scopeCostCenter => 'Pusat biaya';

  @override
  String get none => '— Tidak ada —';

  @override
  String get choose => 'Pilih…';

  @override
  String get addLine => 'Tambah baris';

  @override
  String get saveDraft => 'Simpan draft';

  @override
  String get submit => 'Ajukan';

  @override
  String get submitConfirm =>
      'Ajukan pengajuan ini? Setelah diajukan, nomor dokumen dibuat server dan draft tidak bisa diubah bebas.';

  @override
  String get submitted => 'Pengajuan berhasil diajukan.';

  @override
  String get draftSaved => 'Draft disimpan di HP.';

  @override
  String get draftSavedQueued => 'Draft disimpan dan akan dikirim saat online.';

  @override
  String get deleteDraftConfirm => 'Hapus draft ini dari HP?';

  @override
  String get mastersMissing => 'Data master belum tersedia. Buka aplikasi saat online sekali untuk mengunduhnya.';

  @override
  String lineTitle(int no) {
    return 'Baris $no';
  }

  @override
  String get fieldDescription => 'Uraian';

  @override
  String get fieldQty => 'Jumlah';

  @override
  String get fieldUom => 'Satuan';

  @override
  String get fieldUnitPrice => 'Harga satuan';

  @override
  String get fieldTotal => 'Total';

  @override
  String get fieldCategory => 'Kategori';

  @override
  String get fieldVehicle => 'Kendaraan';

  @override
  String get fieldLineNotes => 'Keterangan baris';

  @override
  String get unitPriceHint => 'Informasi saja — total tidak dihitung otomatis.';

  @override
  String receiptDiff(String amount) {
    return 'Selisih total baris vs nota: $amount';
  }

  @override
  String get addReceiptCamera => 'Foto nota (kamera)';

  @override
  String get addReceiptGallery => 'Dari galeri';

  @override
  String get receiptNo => 'Nomor nota';

  @override
  String get receiptVendor => 'Toko / vendor';

  @override
  String get receiptDate => 'Tanggal nota';

  @override
  String get receiptTime => 'Jam nota';

  @override
  String get receiptAmount => 'Nominal di nota';

  @override
  String get receiptDetailsTitle => 'Data nota';

  @override
  String get photoCompressing => 'Mengompres foto…';

  @override
  String get searchHint => 'Cari…';

  @override
  String get draftNotFound => 'Draft tidak ditemukan.';

  @override
  String get cameraUnavailable => 'Kamera belakang tidak tersedia.';

  @override
  String get cameraPermission => 'Izin kamera ditolak. Aktifkan di Pengaturan HP.';

  @override
  String get takePhoto => 'Ambil foto';

  @override
  String get invalidAmount => 'Nominal tidak valid';

  @override
  String get required => 'Wajib diisi';

  @override
  String get inboxTitle => 'Menunggu Persetujuan';

  @override
  String get inboxEmpty => 'Tidak ada pengajuan yang menunggu Anda.';

  @override
  String get stepAcknowledge => 'Diketahui';

  @override
  String stepApprove(int level) {
    return 'Approval level $level';
  }

  @override
  String flagsCount(int warning, int info) {
    return '$warning peringatan · $info info';
  }

  @override
  String get actionAcknowledge => 'Diketahui';

  @override
  String get actionApprove => 'Setujui';

  @override
  String get actionReject => 'Tolak';

  @override
  String get decisionTitleAcknowledge => 'Tandai diketahui';

  @override
  String get decisionTitleApprove => 'Setujui pengajuan';

  @override
  String get decisionTitleReject => 'Tolak pengajuan';

  @override
  String get rejectReason => 'Alasan penolakan';

  @override
  String get rejectReasonTooShort => 'Alasan wajib diisi (minimal 3 karakter).';

  @override
  String get signatureMode => 'Tanda tangan';

  @override
  String get signatureProfile => 'Pakai tanda tangan profil';

  @override
  String get signatureDraw => 'Tanda tangan di layar';

  @override
  String get signatureClear => 'Ulangi';

  @override
  String get signatureEmpty => 'Tanda tangan belum dibuat.';

  @override
  String get signatureTooLarge => 'Tanda tangan terlalu besar. Ulangi dengan goresan lebih sederhana.';

  @override
  String get confirm => 'Konfirmasi';

  @override
  String get decisionDone => 'Keputusan tersimpan.';

  @override
  String get transferTitle => 'Transfer dari Finance';

  @override
  String get transferNone => 'Belum ada transfer.';

  @override
  String get transferTotal => 'Total ditransfer';

  @override
  String get transferRef => 'Ref. bank';

  @override
  String get transferPosted => 'Tercatat';

  @override
  String get transferVoid => 'Dibatalkan';

  @override
  String transferVoidReason(String reason) {
    return 'Alasan batal: $reason';
  }

  @override
  String get lpjTitle => 'LPJ (Laporan Pertanggungjawaban)';

  @override
  String get lpjStatus => 'Status LPJ';

  @override
  String get lpjReceiptsTotal => 'Total nota';

  @override
  String get lpjVerifiedTotal => 'Nota terverifikasi';

  @override
  String get lpjDifference => 'Selisih';

  @override
  String get lpjSettlement => 'Penyelesaian';

  @override
  String get lpjUsageNotes => 'Keterangan penggunaan dana';

  @override
  String get lpjFinanceNotes => 'Catatan Finance';

  @override
  String get requesterActionsTitle => 'Nota & LPJ';

  @override
  String get addReceiptOnlineCamera => 'Tambah nota (kamera)';

  @override
  String get addReceiptOnlineGallery => 'Tambah nota dari galeri';

  @override
  String get chooseLine => 'Nota ini untuk baris mana?';

  @override
  String get uploadingReceipt => 'Mengunggah nota…';

  @override
  String get receiptSaved => 'Nota tersimpan.';

  @override
  String get receiptRemove => 'Hapus nota';

  @override
  String get receiptRemoveReason => 'Alasan menghapus nota';

  @override
  String get receiptRemoved => 'Nota dihapus.';

  @override
  String get reasonTooShort => 'Wajib diisi (minimal 3 karakter).';

  @override
  String get actionReceiptsComplete => 'Nota sudah lengkap';

  @override
  String get actionReceiptsCompleteConfirm => 'Tandai semua nota sudah lengkap? Setelah itu Anda bisa mengirim LPJ.';

  @override
  String get actionLpjSubmit => 'Kirim LPJ';

  @override
  String get actionLpjResubmit => 'Kirim ulang LPJ';

  @override
  String get lpjUsageNotesHint => 'Jelaskan penggunaan dana (wajib pada pengiriman pertama).';

  @override
  String get actionReceiptsResubmit => 'Kirim ulang nota';

  @override
  String get actionReceiptsResubmitConfirm => 'Kirim ulang nota yang sudah diperbaiki ke Finance?';

  @override
  String get actionComplete => 'Tandai selesai';

  @override
  String get actionCompleteConfirm => 'Dana sudah diterima dan pengajuan ini selesai?';

  @override
  String get actionSaved => 'Tersimpan.';

  @override
  String get integrityWarning =>
      'HP ini terdeteksi di-root atau berupa emulator. Aktivitas dari HP ini ditandai untuk ditinjau Admin.';

  @override
  String get attendanceTitle => 'Absensi';

  @override
  String get attendanceDisabled => 'Absensi dari aplikasi belum diaktifkan Admin (Setting perusahaan).';

  @override
  String get attendanceNoProjects => 'Anda belum ditugaskan di project atau pusat biaya mana pun. Hubungi PM/Admin.';

  @override
  String get attendanceProject => 'Project';

  @override
  String get attendanceCheckIn => 'Absen masuk';

  @override
  String get attendanceCheckOut => 'Absen pulang';

  @override
  String get attendanceLocating => 'Membaca lokasi GPS…';

  @override
  String attendanceOutside(int distance, int radius) {
    return 'Anda di luar radius lokasi ($distance m dari titik, radius $radius m). Absen hanya bisa di lokasi.';
  }

  @override
  String attendanceInside(int distance, int radius) {
    return 'Di dalam radius lokasi ($distance m dari titik, radius $radius m).';
  }

  @override
  String get attendanceNoGeofence =>
      'Titik lokasi/radius belum diatur Admin. Absen belum bisa dilakukan di lokasi ini.';

  @override
  String get attendanceMocked =>
      'Lokasi palsu (mock location) terdeteksi. Matikan aplikasi lokasi palsu. Absen ditolak.';

  @override
  String get attendanceSelfieTitle => 'Selfie absensi';

  @override
  String get attendanceSavedOnline => 'Absen tersimpan dan sedang dikirim.';

  @override
  String get attendanceSavedOffline =>
      'Absen tersimpan di HP (offline). Dikirim otomatis saat ada sinyal; jam absen dihitung server.';

  @override
  String get attendanceHistory => 'Riwayat absen di HP ini';

  @override
  String get attendanceHistoryEmpty => 'Belum ada absen dari HP ini.';

  @override
  String get attendanceOfflineTag => 'offline';

  @override
  String get frontCameraUnavailable => 'Kamera depan tidak tersedia. Absen butuh selfie dengan kamera depan.';

  @override
  String get notificationsTitle => 'Notifikasi';

  @override
  String get notificationsEmpty => 'Belum ada notifikasi.';

  @override
  String get notificationsReadAll => 'Tandai semua dibaca';

  @override
  String get queueTitle => 'Antrean kirim';

  @override
  String get queueEmpty => 'Tidak ada data yang menunggu dikirim.';

  @override
  String get syncNow => 'Kirim sekarang';

  @override
  String get retryFailed => 'Coba lagi yang gagal';

  @override
  String get syncServerUnsupported => 'Server belum mendukung sinkron offline. Data tetap aman di HP.';

  @override
  String get syncDone => 'Sinkron selesai.';

  @override
  String get queueStatusPending => 'Menunggu';

  @override
  String get queueStatusApplied => 'Terkirim';

  @override
  String get queueStatusRejected => 'Ditolak';

  @override
  String get queueStatusConflict => 'Konflik';

  @override
  String get queueStatusFailed => 'Gagal dikirim';

  @override
  String get queueStatusSuperseded => 'Diganti';

  @override
  String queueUsage(String used) {
    return 'Penyimpanan offline: $used dari 100 MB';
  }

  @override
  String get profileTitle => 'Profil';

  @override
  String get profileRoles => 'Peran';

  @override
  String get profileEmployee => 'Karyawan';

  @override
  String get profileVersion => 'Versi aplikasi';

  @override
  String get profileDevice => 'ID perangkat';

  @override
  String get pushDisabled => 'Notifikasi push belum aktif.';

  @override
  String get logout => 'Keluar';

  @override
  String get logoutConfirm => 'Keluar dari aplikasi?';

  @override
  String logoutPendingWarning(int count) {
    return 'Masih ada $count data belum terkirim ke server. Data ini TIDAK dihapus: tetap tersimpan terenkripsi di HP dan baru dikirim setelah Anda masuk lagi dengan akun yang sama. Jika ada sinyal, kirim dulu lewat menu Antrean.';
  }

  @override
  String get logoutAnyway => 'Tetap keluar';

  @override
  String get logoutInProgress => 'Sedang keluar…';

  @override
  String get offlineRecheck => 'Ketuk untuk cek koneksi.';

  @override
  String get stepAcknowledgeDirektur => 'Persetujuan Direktur (Diketahui)';

  @override
  String get budgetOverWarn => 'Melewati batas peringatan anggaran';

  @override
  String get decisionForbidden =>
      'Anda tidak dapat memutuskan pengajuan ini. Hanya Direktur (Diketahui) dan Finance (Approval) yang memutuskan, dan hanya pada gilirannya. Data dimuat ulang.';

  @override
  String get decisionTitleAcknowledgeDirektur => 'Setujui sebagai Direktur (Diketahui)';

  @override
  String get decisionHintDirektur =>
      'Persetujuan Direktur tercatat sebagai \"Diketahui\". Setelah itu pengajuan diteruskan ke Finance untuk Approval.';

  @override
  String get actionAcknowledgeDirektur => 'Setujui (Diketahui)';

  @override
  String get historyTitle => 'Riwayat';

  @override
  String get historyEmpty => 'Belum ada riwayat.';

  @override
  String get historyField => 'Field';

  @override
  String get historyChange => 'Lama → Baru';

  @override
  String get historyReason => 'Alasan';

  @override
  String get historySource => 'Sumber';

  @override
  String get serverReceiptLocked => 'Nota sudah di server — tidak dapat diubah dari HP.';

  @override
  String get lifecycleActionsTitle => 'Aksi pengajuan';

  @override
  String get actionEditOnPhone => 'Ubah & ajukan di HP';

  @override
  String get actionResubmit => 'Ajukan ulang (buat draft baru)';

  @override
  String get actionWithdraw => 'Tarik kembali ke Draft';

  @override
  String get actionCancelRequest => 'Batalkan pengajuan';

  @override
  String get editOnWebHint => 'Draft ini diubah lewat web (peran Anda tidak membuat pengajuan di HP).';

  @override
  String get withdrawReason => 'Alasan tarik kembali';

  @override
  String get withdrawHint => 'Pengajuan kembali ke Draft; ubah lalu ajukan lagi.';

  @override
  String get cancelReason => 'Alasan pembatalan';

  @override
  String get cancelHint => 'Pengajuan dibatalkan dan tidak diproses lagi.';

  @override
  String get withdrawDone => 'Pengajuan ditarik kembali ke Draft; silakan ubah lalu kirim lagi.';

  @override
  String get cancelDone => 'Pengajuan dibatalkan.';

  @override
  String get resubmitConfirm => 'Buat draft baru dari pengajuan yang ditolak ini?';

  @override
  String get resubmitDone => 'Draft baru dibuat dari pengajuan yang ditolak. Periksa, ubah bila perlu, lalu ajukan.';

  @override
  String get tabTeam => 'Tim';

  @override
  String get teamReadOnlyHint => 'Pantauan tim — hanya lihat. Persetujuan dilakukan Direktur dan Finance.';

  @override
  String get teamNoScope => 'Anda belum menjadi PM project atau penanggung jawab pusat biaya.';

  @override
  String get kpiSummaryTitle => 'Ringkasan';

  @override
  String get kpiTeamTitle => 'Pantauan tim';

  @override
  String get homeActionsTitle => 'Aksi';

  @override
  String get kpiUnavailable => 'Ringkasan belum bisa dimuat';

  @override
  String get kpiCashTotal => 'Saldo kas total';

  @override
  String kpiMonthInOut(String cashIn, String cashOut) {
    return 'Bulan ini +$cashIn / −$cashOut';
  }

  @override
  String get kpiBalanceTrend => 'Tren saldo akhir bulan';

  @override
  String get kpiWaiting => 'Pengajuan menunggu';

  @override
  String kpiWaitingSplit(int ack, int approval) {
    return 'Diketahui $ack · Approval $approval';
  }

  @override
  String kpiWaitingForMe(int count) {
    return '$count menunggu saya';
  }

  @override
  String kpiOldest(int days) {
    return 'tertua $days hari';
  }

  @override
  String get kpiDisbursedMonth => 'Pencairan bulan ini';

  @override
  String kpiDisbursedNet(String amount) {
    return '$amount dicairkan bersih';
  }

  @override
  String get kpiDisbursedTrend => 'Tren pencairan bersih per bulan';

  @override
  String get kpiBudgetRealized => 'Realisasi vs anggaran';

  @override
  String kpiOfBudget(String realized, String budget) {
    return '$realized dari RAB $budget';
  }

  @override
  String kpiBudgetAlerts(int over, int warn) {
    return '$over lewat RAB · $warn waspada';
  }

  @override
  String get kpiCashFlowTitle => 'Arus kas bulanan';

  @override
  String get kpiCashFlowSubtitle =>
      'Masuk vs keluar, tanpa transaksi yang di-void. Ketuk bulan untuk melihat angkanya.';

  @override
  String get kpiCashFlowSubtitleFinance => 'Buku kas, termasuk koreksi void. Ketuk bulan untuk melihat angkanya.';

  @override
  String get kpiIn => 'Masuk';

  @override
  String get kpiOut => 'Keluar';

  @override
  String get kpiTransferQueue => 'Antrian transfer';

  @override
  String kpiOverdue(int count) {
    return '$count lewat tanggal dibutuhkan';
  }

  @override
  String get kpiOnTime => 'Tepat waktu';

  @override
  String get kpiToVerify => 'Menunggu verifikasi';

  @override
  String kpiToVerifySplit(int lpj, int reimburse) {
    return '$lpj LPJ · $reimburse nota reimburse';
  }

  @override
  String get kpiLpjToSettle => 'Selisih LPJ';

  @override
  String kpiAdvancesOverdue(int count) {
    return '$count uang muka terlambat LPJ';
  }

  @override
  String get kpiTeamMonth => 'Pengajuan tim bulan ini';

  @override
  String kpiTeamWaiting(int count) {
    return '$count menunggu persetujuan';
  }

  @override
  String get kpiTeamTrend => 'Tren jumlah pengajuan tim';

  @override
  String get kpiTeamLpj => 'Uang muka tim belum LPJ';

  @override
  String kpiLpjOverdue(int count) {
    return '$count terlambat';
  }

  @override
  String get kpiLpjNoneOverdue => 'Tidak ada yang terlambat';

  @override
  String get kpiTeamBudget => 'Realisasi anggaran project saya';

  @override
  String get routeErrorTitle => 'Halaman tidak bisa dibuka';

  @override
  String get routeErrorBody => 'Terjadi kesalahan saat membuka halaman ini. Kembali ke beranda lalu coba lagi.';

  @override
  String get routeErrorHome => 'Ke beranda';

  @override
  String get actionProgress => 'Laporan progress';

  @override
  String get actionProgressRead => 'Progress project';

  @override
  String progressPendingCount(int count) {
    return '$count laporan belum terkirim';
  }

  @override
  String get actionAttendanceSub => 'Absen masuk/pulang, rekap bulanan';

  @override
  String get actionAttendanceOffSub => 'Rekap bulanan (absen dari aplikasi belum diaktifkan Admin)';

  @override
  String get actionAttendanceTeamSub => 'Kehadiran tim hari ini';

  @override
  String get seeAll => 'Lihat semua';

  @override
  String get attendanceTabCheck => 'Absen';

  @override
  String get attendanceTabRecap => 'Rekap';

  @override
  String get attendanceTabTeam => 'Tim';

  @override
  String get attendanceLocation => 'Lokasi (project / pusat biaya)';

  @override
  String attendanceRadius(int meters) {
    return 'radius $meters m';
  }

  @override
  String get attendanceCheckDistance => 'Cek jarak ke lokasi';

  @override
  String get siteProject => 'Project';

  @override
  String get siteCostCenter => 'Pusat biaya';

  @override
  String get distanceInside => 'Di dalam area absen';

  @override
  String get distanceOutside => 'Di luar area absen';

  @override
  String distanceDetail(int radius, int allowance, int accuracy) {
    return 'Radius $radius m + toleransi GPS $allowance m (akurasi GPS ±$accuracy m, maks. 50 m dihitung).';
  }

  @override
  String get dowMon => 'Sen';

  @override
  String get dowTue => 'Sel';

  @override
  String get dowWed => 'Rab';

  @override
  String get dowThu => 'Kam';

  @override
  String get dowFri => 'Jum';

  @override
  String get dowSat => 'Sab';

  @override
  String get dowSun => 'Min';

  @override
  String get recapPrevMonth => 'Bulan sebelumnya';

  @override
  String get recapNextMonth => 'Bulan berikutnya';

  @override
  String recapSchedule(String name, String start, String end, int tolerance) {
    return 'Jadwal $name: $start–$end, toleransi $tolerance menit';
  }

  @override
  String get recapPresent => 'Hadir';

  @override
  String get recapWorkingDays => 'dari hari kerja s.d. hari ini';

  @override
  String get recapWorkHours => 'Total jam kerja';

  @override
  String get recapLate => 'Terlambat';

  @override
  String get recapEarlyLeave => 'Pulang cepat';

  @override
  String get recapAbsent => 'Tidak hadir';

  @override
  String get recapIncomplete => 'Belum absen pulang';

  @override
  String recapDays(int count) {
    return '$count hari';
  }

  @override
  String recapMinutes(int count) {
    return '$count menit';
  }

  @override
  String get recapStatusDone => 'Selesai';

  @override
  String get recapStatusPresent => 'Hadir';

  @override
  String get recapStatusNotYet => 'Belum absen';

  @override
  String get recapStatusAbsent => 'Tidak hadir';

  @override
  String get recapStatusHoliday => 'Libur';

  @override
  String get recapStatusNoSchedule => 'Tanpa jadwal';

  @override
  String get recapLegendMark => 'terlambat / oleh PM / dikoreksi';

  @override
  String recapInOut(String checkIn, String checkOut) {
    return 'Masuk $checkIn · Pulang $checkOut';
  }

  @override
  String recapWorked(String duration) {
    return 'Jam kerja: $duration';
  }

  @override
  String recapLateBy(int minutes) {
    return 'Terlambat $minutes menit';
  }

  @override
  String recapEarlyBy(int minutes) {
    return 'Pulang cepat $minutes menit';
  }

  @override
  String recapOnBehalf(String names) {
    return 'Diabsenkan oleh PM: $names';
  }

  @override
  String get recapCorrected => 'Jam absen dikoreksi (T10).';

  @override
  String recapFlags(String flags) {
    return 'Penanda: $flags';
  }

  @override
  String get recapMemberTitle => 'Rekap absensi karyawan';

  @override
  String get teamStatusNotYet => 'Belum absen';

  @override
  String get teamStatusPresent => 'Hadir';

  @override
  String get teamStatusDone => 'Selesai';

  @override
  String teamAll(int count) {
    return 'Semua $count';
  }

  @override
  String get teamEmpty => 'Tidak ada anggota tim dengan status ini.';

  @override
  String get teamIn => 'Masuk';

  @override
  String get teamOut => 'Pulang';

  @override
  String get teamOnBehalfTag => 'Oleh PM';

  @override
  String get teamCorrectedTag => 'Dikoreksi';

  @override
  String get onBehalfAction => 'Absenkan anggota tim';

  @override
  String get onBehalfTitle => 'Diabsenkan PM';

  @override
  String get onBehalfIntro =>
      'Untuk anggota tim yang tidak bisa absen sendiri. Lokasi diambil dari HP Anda, foto karyawan diambil dengan kamera HP Anda. Nama Anda dan alasannya tercatat.';

  @override
  String get onBehalfNoTeam =>
      'Belum ada anggota tim yang ditugaskan hari ini (data tim dari server; tarik ulang di Beranda saat online).';

  @override
  String get onBehalfEmployee => 'Karyawan';

  @override
  String get onBehalfReason => 'Alasan (wajib)';

  @override
  String get onBehalfReasonHint => 'Contoh: tidak punya HP / HP rusak';

  @override
  String get onBehalfCamera => 'Kamera untuk foto karyawan';

  @override
  String get lensBack => 'Belakang';

  @override
  String get lensFront => 'Depan';

  @override
  String get onBehalfCheckIn => 'Absenkan masuk';

  @override
  String get onBehalfCheckOut => 'Absenkan pulang';

  @override
  String onBehalfPhotoTitle(String name) {
    return 'Foto $name';
  }

  @override
  String onBehalfSavedOnline(String name) {
    return 'Absen $name tersimpan dan sedang dikirim.';
  }

  @override
  String onBehalfSavedOffline(String name) {
    return 'Absen $name tersimpan di HP (offline). Dikirim otomatis saat ada sinyal.';
  }

  @override
  String get correctionTitleIn => 'Koreksi jam masuk';

  @override
  String get correctionTitleOut => 'Koreksi jam pulang';

  @override
  String correctionOld(String date, String time) {
    return 'Tercatat: $date $time';
  }

  @override
  String correctionNew(String time) {
    return 'Jam baru: $time';
  }

  @override
  String get correctionReason => 'Alasan koreksi (wajib)';

  @override
  String get correctionReasonHelp => 'Tanggal tetap sama; jam lama dan baru tercatat di audit.';

  @override
  String get correctionSaved => 'Koreksi absensi tersimpan.';

  @override
  String get progressTitle => 'Progress project';

  @override
  String get progressTabReports => 'Laporan';

  @override
  String get progressTabProjects => 'Project';

  @override
  String get progressNew => 'Laporan baru';

  @override
  String get progressHomeTitle => 'Progress fisik vs anggaran';

  @override
  String get progressLocalTitle => 'Di HP ini (belum diterima server)';

  @override
  String get progressServerTitle => 'Laporan terbaru';

  @override
  String get progressFilterProject => 'Filter project';

  @override
  String get progressFilterAll => 'Semua project';

  @override
  String get progressListOffline => 'Daftar laporan butuh koneksi internet. Laporan baru tetap bisa dibuat offline.';

  @override
  String get progressListEmpty => 'Belum ada laporan progress.';

  @override
  String get progressProjectsIntro =>
      'Selisih = % anggaran terpakai − % progress fisik. Hijau aman, kuning perlu dicek, merah anggaran jauh mendahului pekerjaan.';

  @override
  String get progressProjectsEmpty => 'Belum ada project.';

  @override
  String get progressPhysical => 'Progress fisik';

  @override
  String get progressBudgetUsed => 'Anggaran terpakai';

  @override
  String progressGap(String value) {
    return 'Selisih $value';
  }

  @override
  String progressStagesIncomplete(String value) {
    return 'Bobot tahapan baru $value (harus 100%).';
  }

  @override
  String get progressNoReportYet => 'Belum ada laporan progress.';

  @override
  String progressLastReport(String date, int count) {
    return 'Laporan terakhir $date · $count laporan';
  }

  @override
  String get progressToneOk => 'Sesuai';

  @override
  String get progressToneWarn => 'Perlu dicek';

  @override
  String get progressToneBad => 'Anggaran mendahului';

  @override
  String get progressToneNone => 'Belum bisa dihitung';

  @override
  String get progressRemovePhoto => 'Hapus foto';

  @override
  String get progressStateQueued => 'Menunggu kirim';

  @override
  String get progressStateLocal => 'Belum terkirim';

  @override
  String get progressStateConflict => 'Konflik';

  @override
  String get progressStateRejected => 'Ditolak';

  @override
  String get progressStateSynced => 'Terkirim';

  @override
  String get progressEditTag => 'edit';

  @override
  String progressPhotoCount(int count) {
    return '$count foto';
  }

  @override
  String get progressConflictHint => 'Ketuk untuk memilih versi yang dipakai.';

  @override
  String get progressOfflineTag => 'offline';

  @override
  String get progressEditableTag => 'bisa diedit';

  @override
  String get progressPhotoTitle => 'Foto progress';

  @override
  String get progressEditTitle => 'Edit laporan progress';

  @override
  String get progressNewTitle => 'Laporan progress harian';

  @override
  String get progressNotFound => 'Laporan tidak ditemukan di HP ini.';

  @override
  String get progressPickProject => 'Pilih project.';

  @override
  String get progressPickStage => 'Pilih tahapan.';

  @override
  String get progressPhotoFailed => 'Foto gagal diproses. Ambil ulang foto.';

  @override
  String get progressSent => 'Laporan terkirim.';

  @override
  String get progressQueuedOnline => 'Laporan tersimpan dan sedang dikirim.';

  @override
  String get progressQueuedOffline => 'Laporan tersimpan di HP (offline). Dikirim otomatis saat ada sinyal.';

  @override
  String get progressKeptLocal => 'Tidak ada koneksi. Laporan disimpan di HP; kirim dari menu Progress saat online.';

  @override
  String get progressDiscardTitle => 'Hapus laporan ini?';

  @override
  String get progressDiscardBody => 'Laporan dan fotonya dihapus dari HP. Server belum menerimanya.';

  @override
  String get progressOnlineOnlyNote =>
      'Server belum mengizinkan kirim offline: laporan dikirim langsung (butuh internet).';

  @override
  String get progressOnlineOnlyOffline =>
      'Anda offline dan server belum mengizinkan kirim offline. Laporan disimpan di HP dan dikirim saat online.';

  @override
  String progressEditWindow(String time) {
    return 'Bisa diedit sampai $time.';
  }

  @override
  String get progressProject => 'Project';

  @override
  String get progressNoProjects => 'Tidak ada project untuk Anda.';

  @override
  String get progressStagesCached =>
      'Offline: tahapan dan % dari data terakhir di HP; server memeriksa ulang saat kirim.';

  @override
  String get progressStage => 'Tahapan';

  @override
  String progressStageOption(String name, String weight, String pct) {
    return '$name (bobot $weight, sekarang $pct)';
  }

  @override
  String progressPctTitle(String stage) {
    return 'Progress tahapan $stage';
  }

  @override
  String progressPctBefore(String value) {
    return 'Sebelum laporan: $value';
  }

  @override
  String get progressPctAfterLabel => 'Progress setelah pekerjaan';

  @override
  String progressPctDelta(String value) {
    return 'Naik $value dari sebelumnya.';
  }

  @override
  String get progressWork => 'Pekerjaan';

  @override
  String get progressWorkHint => 'Pekerjaan yang dilakukan hari ini';

  @override
  String get progressIssues => 'Kendala (opsional)';

  @override
  String progressPhotosTitle(int count, int max) {
    return 'Foto ($count/$max)';
  }

  @override
  String progressPhotosOnServer(int count) {
    return '$count foto sudah di server (foto tidak bisa dihapus, hanya ditambah).';
  }

  @override
  String get progressAddPhoto => 'Foto';

  @override
  String get progressReason => 'Alasan edit (wajib)';

  @override
  String get progressReasonHelp => 'Tercatat di riwayat audit laporan.';

  @override
  String get progressSaveQueue => 'Simpan & kirim';

  @override
  String get progressSendOnline => 'Kirim laporan';

  @override
  String get progressDetailTitle => 'Laporan progress';

  @override
  String progressWeight(String value) {
    return 'bobot $value';
  }

  @override
  String progressStageBeforeAfter(String before) {
    return 'Tahapan (sebelumnya $before)';
  }

  @override
  String progressProjectBeforeAfter(String before) {
    return 'Project (sebelumnya $before)';
  }

  @override
  String get progressNoPhotos => 'Tanpa foto.';

  @override
  String get progressDate => 'Tanggal';

  @override
  String get progressReporter => 'Pelapor';

  @override
  String get progressReceivedAt => 'Diterima server';

  @override
  String progressTimeTrust(String trust) {
    return 'dibuat offline (waktu: $trust)';
  }

  @override
  String get progressFlags => 'Penanda';

  @override
  String get progressEditableUntil => 'Bisa diedit s.d.';

  @override
  String get progressEdit => 'Edit laporan (≤ 24 jam)';

  @override
  String get progressConflictTitle => 'Konflik laporan';

  @override
  String get progressConflictGone => 'Konflik sudah diselesaikan.';

  @override
  String get progressPhotosLabel => 'Foto';

  @override
  String progressNewPhotos(int count) {
    return '+$count foto baru';
  }

  @override
  String get progressUseServer => 'Pakai versi server';

  @override
  String get progressResendMine => 'Kirim versi HP (dengan alasan)';

  @override
  String get progressNotEditableAnymore => 'Batas edit 24 jam sudah lewat: hanya versi server yang berlaku.';

  @override
  String get progressDiffers => 'berbeda';

  @override
  String get progressServerVersion => 'Server';

  @override
  String get progressMyVersion => 'HP ini';

  @override
  String get progressUsedServer => 'Versi server dipakai; salinan di HP dihapus.';

  @override
  String get progressResent => 'Versi HP dikirim sebagai edit.';

  @override
  String get addendumTitle => 'Addendum RAB';

  @override
  String addendumInboxTitle(int count) {
    return 'Addendum RAB menunggu Anda ($count)';
  }

  @override
  String addendumWaitingCount(int count) {
    return '$count menunggu keputusan Anda';
  }

  @override
  String get addendumNew => 'Addendum baru';

  @override
  String get addendumNewTitle => 'Ajukan addendum RAB';

  @override
  String get addendumEmpty => 'Belum ada addendum RAB.';

  @override
  String get addendumAddition => 'Tambahan RAB';

  @override
  String get addendumReason => 'Alasan';

  @override
  String get addendumSubmit => 'Ajukan';

  @override
  String get addendumSaveDraft => 'Simpan sebagai draft';

  @override
  String get addendumSubmitted => 'Addendum diajukan. Menunggu Direktur.';

  @override
  String get addendumSavedDraft => 'Draft addendum tersimpan.';

  @override
  String addendumRabBeforeAfter(String before, String after) {
    return 'RAB $before → $after';
  }

  @override
  String addendumCommittedPct(String before, String after) {
    return 'Komitmen terhadap RAB $before → $after';
  }

  @override
  String addendumWaiting(String step) {
    return 'Menunggu: $step';
  }

  @override
  String addendumRejectedBecause(String reason) {
    return 'Ditolak: $reason';
  }

  @override
  String addendumCancelledBecause(String reason) {
    return 'Dibatalkan: $reason';
  }

  @override
  String addendumBy(String name) {
    return 'Diajukan oleh $name';
  }

  @override
  String addendumSubmittedAt(String time) {
    return 'diajukan $time';
  }

  @override
  String get addendumTimeline => 'Riwayat keputusan';

  @override
  String get addendumDecAck => 'Disetujui Direktur';

  @override
  String get addendumDecApproved => 'Disetujui Finance';

  @override
  String get addendumDecRejected => 'Ditolak';

  @override
  String get addendumAcknowledge => 'Setujui (Direktur)';

  @override
  String get addendumApprove => 'Setujui (Finance)';

  @override
  String get addendumReject => 'Tolak';

  @override
  String get addendumCancel => 'Batalkan addendum';

  @override
  String get addendumConfirmBody =>
      'Keputusan dicatat dengan nama dan tanda tangan profil Anda. Setelah persetujuan terakhir, RAB project bertambah.';

  @override
  String get addendumDone => 'Tersimpan.';
}
