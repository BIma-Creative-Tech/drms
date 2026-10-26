// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Indonesian (`id`).
class AppLocalizationsId extends AppLocalizations {
  AppLocalizationsId([String locale = 'id']) : super(locale);

  @override
  String get appTitle => 'RR Teams';

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
  String get loginTitle => 'Masuk ke RR Teams';

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
  String get loginTotpLabel => 'Kode autentikator (bila 2FA aktif)';

  @override
  String get loginTotpHelper =>
      'Isi 6 digit dari aplikasi autentikator hanya bila Anda mengaktifkan 2FA untuk akun ini. Tanpa 2FA, biarkan kosong.';

  @override
  String get loginTotpInvalidLength => 'Kode autentikator terdiri dari 6 digit.';

  @override
  String get loginInvalidWithTotp =>
      'Email/username, kata sandi, atau kode autentikator salah. Gagal berulang kali dapat mengunci akun sementara; tunggu sebentar sebelum mencoba lagi.';

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
  String get updateAvailableTap => 'Ketuk untuk melihat yang baru dan cara memperbarui.';

  @override
  String get updateHowTo =>
      'Pasang APK versi baru di atas aplikasi ini, tanpa menghapusnya. Data dan login tetap tersimpan.';

  @override
  String releaseNotesTitle(String version) {
    return 'Yang baru di versi $version';
  }

  @override
  String get navHome => 'Beranda';

  @override
  String get navRequests => 'Pengajuan';

  @override
  String get navInbox => 'Persetujuan';

  @override
  String get navQueue => 'Antrean sinkron';

  @override
  String get navProfile => 'Profil';

  @override
  String get navDashboard => 'Dashboard';

  @override
  String get navTransfer => 'Antrian Transfer';

  @override
  String get navAttendance => 'Absensi';

  @override
  String get navProjects => 'Proyek';

  @override
  String greeting(String name) {
    return 'Halo, $name';
  }

  @override
  String get actionNewAdvance => 'Pengajuan Baru';

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
  String get turnLabel => 'Tahapan saat ini';

  @override
  String get turnYours => 'Menunggu keputusan Anda';

  @override
  String get timelineTitle => 'Alur pengajuan';

  @override
  String get linesTitle => 'Rincian item';

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
  String get fieldUrgency => 'Tingkat urgensi';

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
  String get fieldQty => 'Qty';

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
  String get lineTotalHelper => 'Qty × Harga satuan — dihitung otomatis, tidak bisa diubah.';

  @override
  String get fieldReceiptAmount => 'Nominal sesuai nota';

  @override
  String get receiptAmountHelper => 'Opsional. Persetujuan dan transfer tetap memakai Total (Qty × Harga satuan).';

  @override
  String get receiptMismatchChip => 'Selisih nota';

  @override
  String receiptMismatchDetail(String receipt, String total) {
    return 'Nominal sesuai nota $receipt ≠ Total $total';
  }

  @override
  String lineNeedsUnitPrice(String amount) {
    return 'Baris ini dibuat sebelum Total dihitung otomatis. Isi Qty, Satuan dan Harga satuan (total lama: $amount).';
  }

  @override
  String get lineNeedsUnitPriceShort => 'Lengkapi Qty & Harga satuan';

  @override
  String linesIncompleteResubmit(String lines) {
    return 'Lengkapi Qty & Harga satuan pada baris $lines (Ubah di web) sebelum mengirim ulang nota.';
  }

  @override
  String receiptMismatchCount(int count) {
    return 'Selisih nota ($count)';
  }

  @override
  String get fieldLineNo => 'No';

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
  String get direkturSignatureTitle => 'Tanda tangan Direktur PT';

  @override
  String get direkturSignatureHint => 'Ditandatangani dengan tanda tangan dan nama Direktur definitif PT.';

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
  String get lpjPhotos => 'Foto LPJ';

  @override
  String lpjPhotosCount(int count, int max) {
    return '$count / $max foto';
  }

  @override
  String lpjPhotosHint(int max) {
    return 'Opsional, maks. $max foto (kamera atau galeri). Tidak bisa diubah setelah LPJ dikirim.';
  }

  @override
  String lpjPhotosFull(int max) {
    return 'Maksimal $max foto LPJ.';
  }

  @override
  String lpjPhotoCaption(int no) {
    return 'Foto LPJ $no';
  }

  @override
  String get lpjPhotoRemove => 'Hapus foto';

  @override
  String get lpjPhotoCamera => 'Kamera';

  @override
  String get lpjUploadingPhotos => 'Mengunggah foto LPJ…';

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
  String get attendanceNoProjects =>
      'Belum ada lokasi absen untuk Anda (lokasi terdaftar dengan titik sesuai tipe absensi, atau penugasan). Hubungi PM/Admin.';

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
  String get profileAppearance => 'Tampilan';

  @override
  String get profileAppearanceHint => 'Sistem = ikuti pengaturan terang/gelap HP.';

  @override
  String get themeSystem => 'Sistem';

  @override
  String get themeLight => 'Terang';

  @override
  String get themeDark => 'Gelap';

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
      'Anda tidak dapat memutuskan pengajuan ini. Hanya PM project pengajuan ini, Direktur dan Finance yang memutuskan, masing-masing hanya pada tahapannya. Data dimuat ulang.';

  @override
  String get decisionTitleAcknowledgeDirektur => 'Setujui sebagai Direktur (Diketahui)';

  @override
  String get decisionHintDirektur =>
      'Persetujuan Direktur tercatat sebagai \"Diketahui\". Setelah itu pengajuan diteruskan ke Finance untuk Approval.';

  @override
  String get actionAcknowledgeDirektur => 'Setujui (Diketahui)';

  @override
  String get decisionTitleAcknowledgePm => 'Setujui sebagai PM project';

  @override
  String get decisionHintPm => 'Pengajuan diteruskan ke Direktur.';

  @override
  String get decisionTitleApproveDirektur => 'Setujui sebagai Direktur';

  @override
  String get decisionHintDirekturFinal => 'Pengajuan diteruskan ke Finance untuk transfer.';

  @override
  String get actionAcknowledgePm => 'Setujui';

  @override
  String get direkturViaPmNote => 'Pengajuan Direktur — diajukan oleh PM (kebijakan owner 2026-10-10)';

  @override
  String get noApprovalNote => 'Tanpa persetujuan — pengajuan Direktur (kebijakan PT)';

  @override
  String get noApprovalBadge => 'Tanpa persetujuan (Direktur)';

  @override
  String get draftDirekturNoApprovalInfo => 'Pengajuan Anda langsung ke antrian transfer Finance';

  @override
  String get draftDirekturNoApprovalHint =>
      'Tanpa persetujuan — kebijakan PT; Finance tetap memeriksa sebelum transfer.';

  @override
  String get direkturViaPmSelfNote =>
      'Pengajuan Direktur — diajukan oleh PM; disetujui Direktur pemohon karena satu-satunya Direktur PT (kebijakan owner 2026-10-10)';

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
  String get teamReadOnlyHint =>
      'Pantauan tim — hanya lihat. Pengajuan yang menunggu persetujuan Anda sebagai PM project ada di menu Persetujuan.';

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
    return '$count pengajuan baru terlambat LPJ';
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
  String get kpiPerCompanyTitle => 'Per PT';

  @override
  String kpiSplitCash(String amount) {
    return 'Kas $amount';
  }

  @override
  String kpiSplitWaiting(int count, String amount) {
    return '$count menunggu · $amount';
  }

  @override
  String kpiSplitTransfer(int count, String amount) {
    return '$count antri transfer · $amount';
  }

  @override
  String kpiSplitTeam(int count, String amount) {
    return '$count pengajuan · $amount';
  }

  @override
  String get kpiTeamLpj => 'Pengajuan Baru tim belum LPJ';

  @override
  String kpiLpjOverdue(int count) {
    return '$count terlambat';
  }

  @override
  String get kpiLpjNoneOverdue => 'Tidak ada yang terlambat';

  @override
  String get kpiTeamBudget => 'Realisasi anggaran project saya';

  @override
  String get kpiMineTitle => 'Pengajuan saya';

  @override
  String kpiCountSum(int count, String amount) {
    return '$count · $amount';
  }

  @override
  String get kpiPipelineTitle => 'Status pengajuan';

  @override
  String get kpiPipelineSubtitle => 'Posisi semua pengajuan saat ini';

  @override
  String get kpiPipelineTeamTitle => 'Status pengajuan tim';

  @override
  String get kpiPipelineTeamSubtitle => 'Posisi pengajuan tim saat ini';

  @override
  String get kpiPipelineMineTitle => 'Status pengajuan saya';

  @override
  String get kpiPipelineMineSubtitle => 'Semua pengajuan yang pernah diajukan';

  @override
  String get kpiPipelineEmpty => 'Belum ada pengajuan yang diajukan.';

  @override
  String get kpiCategoriesTitle => 'Komposisi biaya per kategori';

  @override
  String kpiCategoriesSubtitle(String from) {
    return 'Dicairkan $from – sekarang';
  }

  @override
  String get kpiCategoriesSubtitleTeam => 'Dicairkan 6 bulan terakhir, tim Anda';

  @override
  String get kpiCategoriesSubtitleFinance => 'Dicairkan 6 bulan terakhir';

  @override
  String get kpiCategoriesEmpty => 'Belum ada biaya yang dicairkan di rentang ini.';

  @override
  String get kpiSlaTitle => 'SLA transfer';

  @override
  String get kpiSlaSubtitle => 'Disetujui → ditransfer, bulan ini';

  @override
  String kpiSlaSubtitleTarget(int hours) {
    return 'Disetujui → ditransfer, bulan ini · target $hours jam';
  }

  @override
  String kpiSlaOf(int count) {
    return 'dari $count transfer dalam SLA';
  }

  @override
  String get kpiSlaNone => 'Belum ada transfer bulan ini.';

  @override
  String kpiSlaAvgLate(String avg, int late) {
    return 'Rata-rata $avg · terlambat $late';
  }

  @override
  String get kpiRapMonitorTitle => 'Monitoring RAP';

  @override
  String kpiRapMonitorSubtitle(int projects, int over) {
    return '$projects project ber-RAP · $over dengan item melebihi RAP';
  }

  @override
  String get kpiRapMonitorSubtitleEmpty => 'Realisasi pengajuan per item RAP';

  @override
  String get kpiRapMonitorEmpty => 'Belum ada project dengan RAP.';

  @override
  String kpiRapRealised(String realised, String planned) {
    return 'Realisasi $realised dari rencana $planned';
  }

  @override
  String kpiRapOverItems(int count) {
    return '$count item melebihi RAP';
  }

  @override
  String get kpiRapSafe => 'Aman';

  @override
  String get kpiLoansTitle => 'Pinjaman antar project';

  @override
  String kpiLoansSubtitle(String outstanding, int overdue, int pending) {
    return 'Sisa $outstanding · $overdue terlambat · $pending menunggu persetujuan';
  }

  @override
  String kpiLoansOverdueSum(String amount) {
    return 'Terlambat $amount';
  }

  @override
  String kpiLoansWaiting(int count) {
    return '$count pinjaman menunggu keputusan Anda';
  }

  @override
  String get kpiLoansEmpty => 'Belum ada pinjaman antar project yang disetujui.';

  @override
  String kpiLoanRow(String borrowed, String lent) {
    return 'Diterima (sisa) $borrowed · Diberikan (sisa) $lent';
  }

  @override
  String kpiLoanOverdue(int count, String amount) {
    return '$count terlambat · $amount';
  }

  @override
  String get kpiLoanOnTime => 'Tepat waktu';

  @override
  String get kpiRapMissingTitle => 'Project ber-RAB belum punya RAP';

  @override
  String get kpiRapMissingTeamTitle => 'Project Anda belum punya RAP';

  @override
  String kpiRapMissingSubtitle(int count) {
    return '$count project · pengajuan project ini belum bisa dikirim sampai RAP diisi (minta PM mengisi)';
  }

  @override
  String kpiRapMissingTeamSubtitle(int count) {
    return '$count project · pengajuan project ini belum bisa dikirim sampai RAP diisi';
  }

  @override
  String kpiRapMissingBudget(String kind, String budget) {
    return '$kind · RAB $budget';
  }

  @override
  String get kpiRapFill => 'Isi RAP';

  @override
  String get kpiTrendTitle => 'Tren pengajuan';

  @override
  String get kpiTrendSubtitle => 'Jumlah pengajuan per bulan (tanggal pengajuan). Ketuk bulan untuk melihat angkanya.';

  @override
  String get kpiTrendTeamTitle => 'Tren pengajuan tim';

  @override
  String get kpiTrendTeamSubtitle => 'Jumlah pengajuan per bulan, 6 bulan. Ketuk bulan untuk melihat angkanya.';

  @override
  String get kpiTrendMineTitle => 'Pengajuan saya per bulan';

  @override
  String get kpiTrendMineSubtitle =>
      'Jumlah dan nilai pengajuan saya, 6 bulan, tanpa draft. Ketuk bulan untuk melihat angkanya.';

  @override
  String get kpiTrendEmpty => 'Belum ada pengajuan di rentang ini.';

  @override
  String kpiTrendReadout(String period, int count) {
    return '$period: $count pengajuan';
  }

  @override
  String kpiTrendReadoutSum(String period, int count, String amount) {
    return '$period: $count pengajuan · $amount';
  }

  @override
  String get kpiAccountsTitle => 'Saldo per akun';

  @override
  String get kpiAccountsSubtitle => 'Akun nonaktif bersaldo 0 disembunyikan';

  @override
  String get kpiAccountsEmpty => 'Belum ada akun kas.';

  @override
  String kpiAccountInactive(String name) {
    return '$name (nonaktif)';
  }

  @override
  String kpiAccountMonth(String cashIn, String cashOut) {
    return 'Bulan ini masuk $cashIn · keluar $cashOut';
  }

  @override
  String get kpiCompletenessTitle => 'Kelengkapan nota/LPJ';

  @override
  String get kpiCompletenessRatio => 'pengajuan baru bulan ini sudah LPJ';

  @override
  String kpiCompletenessOverdue(int count) {
    return '$count LPJ terlambat';
  }

  @override
  String get kpiCompletenessNoneOverdue => 'Tidak ada LPJ terlambat';

  @override
  String kpiCompletenessWithoutLpj(int count) {
    return '$count pengajuan baru belum LPJ';
  }

  @override
  String kpiCompletenessReimburse(int count) {
    return '$count nota reimburse menunggu verifikasi';
  }

  @override
  String kpiCompletenessWarnings(int count) {
    return '$count flag peringatan terbuka';
  }

  @override
  String get kpiRecentCashTitle => 'Transaksi kas terbaru';

  @override
  String get kpiRecentCashSubtitle => 'Buku kas, termasuk void & jurnal balik';

  @override
  String get kpiRecentCashEmpty => 'Belum ada transaksi kas.';

  @override
  String get kpiVoid => 'Void';

  @override
  String get kpiCostCentersTitle => 'Pusat biaya bulan ini';

  @override
  String get kpiCostCentersTeamTitle => 'Pusat biaya project saya bulan ini';

  @override
  String get kpiCostCentersEmpty => 'Belum ada biaya pusat biaya bulan ini.';

  @override
  String get kpiAdvancesTitle => 'Pengajuan baru belum LPJ';

  @override
  String kpiAdvancesSubtitle(int days) {
    return 'Terlambat bila lebih dari $days hari sejak transfer pertama';
  }

  @override
  String get kpiAdvancesEmpty => 'Semua pengajuan baru sudah ber-LPJ.';

  @override
  String kpiAdvanceAge(int days) {
    return '$days hr';
  }

  @override
  String kpiAdvanceLate(int days) {
    return '$days hr terlambat';
  }

  @override
  String get kpiPeriodCloseTitle => 'Tutup buku';

  @override
  String kpiPeriodClosed(String period) {
    return 'Bulan terakhir ditutup: $period';
  }

  @override
  String get kpiPeriodNever => 'Belum pernah tutup buku.';

  @override
  String kpiPeriodNext(String period) {
    return 'Bulan yang bisa ditutup: $period (bulan lampau saja).';
  }

  @override
  String get kpiMyActions => 'Perlu tindakan saya';

  @override
  String get kpiMyActionsNone => 'Tidak ada yang perlu Anda kerjakan';

  @override
  String get kpiMyActionsHint => 'draft, revisi, nota atau LPJ';

  @override
  String get kpiMyProcess => 'Sedang diproses';

  @override
  String kpiMyProcessWaiting(int count) {
    return 'menunggu persetujuan $count';
  }

  @override
  String kpiMyMonth(String month) {
    return 'Pengajuan $month';
  }

  @override
  String get kpiMyLatestTitle => 'Pengajuan terbaru saya';

  @override
  String get kpiMyLatestSubtitle => '10 terbaru · nominal = grand total';

  @override
  String get kpiMyLatestEmpty => 'Anda belum punya pengajuan.';

  @override
  String kpiMyDraftTitle(String title) {
    return 'Draft \"$title\"';
  }

  @override
  String get kpiMyDone => 'Selesai';

  @override
  String kpiMyExit(int count) {
    return '$count ditolak/dibatalkan';
  }

  @override
  String get kpiAdminUsers => 'User tanpa karyawan/peran';

  @override
  String get kpiAdminProjects => 'Project tanpa PM';

  @override
  String get kpiAdminComplete => 'Lengkap';

  @override
  String get kpiAdminIncomplete => 'Perlu dilengkapi';

  @override
  String get kpiAdminWebHint => 'Lengkapi data master dan lihat audit log di web admin.';

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
  String get attendanceLocation => 'Lokasi (site / project / pusat biaya)';

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
  String get siteSite => 'Site';

  @override
  String get siteHome => 'Site penempatan';

  @override
  String get siteHomeBadge => 'Penempatan';

  @override
  String get siteHeadOffice => 'Kantor pusat';

  @override
  String get siteHeadOfficeBadge => 'Pusat';

  @override
  String get attendanceDetect => 'Deteksi lokasi otomatis';

  @override
  String attendanceDetected(String name, int distance) {
    return 'Lokasi terdeteksi otomatis: $name ($distance m dari titik).';
  }

  @override
  String attendanceDetectedOverlap(int count) {
    return 'Anda berada di $count area absen yang bertumpuk. Dipilih yang terdekat; pilih lokasi lain di bawah bila perlu.';
  }

  @override
  String attendanceDetectNone(String name, int distance) {
    return 'Posisi Anda di luar semua area absen terdaftar. Terdekat: $name ($distance m). Mendekatlah ke lokasi atau pilih lokasi secara manual.';
  }

  @override
  String get attendanceDetectNoPoint => 'Belum ada lokasi absen dengan titik koordinat. Hubungi Admin.';

  @override
  String get attendanceAreaChoice => 'Area absen di posisi Anda';

  @override
  String get attendanceTypeOnsite =>
      'Karyawan OnSite: absen di dalam radius lokasi yang dipilih (project / pusat biaya terdaftar PT).';

  @override
  String get attendanceTypeNonOnsite =>
      'Karyawan Non-OnSite: absen masuk / pulang di mana saja — di dalam radius lokasi terdaftar PT tercatat di lokasi itu (dipilih otomatis), di luar semua lokasi dicatat \"Di luar area\".';

  @override
  String get attendanceOutsideArea => 'Di luar area';

  @override
  String get attendanceOutsideAreaHint =>
      'Karyawan Non-OnSite: di luar lokasi terdaftar, absen tetap bisa dan dicatat \"Di luar area\".';

  @override
  String attendanceDetectOutsideArea(String name) {
    return 'Di luar lokasi terdaftar — absen dicatat \"Di luar area\" (ref. $name).';
  }

  @override
  String get attendanceNoReference =>
      'Absen \"Di luar area\" belum bisa: site penempatan / kantor pusat PT belum ditetapkan Admin.';

  @override
  String get attendanceNonOnsiteOutside => 'Di luar lokasi terdaftar — absen dicatat \"Di luar area\"';

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
  String get recapViewOwn => 'Saya';

  @override
  String get recapViewTeam => 'Tim';

  @override
  String get recapNoEmployee => 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin.';

  @override
  String get teamRecapEmpty => 'Belum ada karyawan dalam rekap bulan ini.';

  @override
  String teamRecapCount(int count) {
    return '$count karyawan';
  }

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
  String get onBehalfDisabled =>
      'Absen atas nama belum bisa: absensi dari aplikasi belum diaktifkan Admin (Setting perusahaan).';

  @override
  String get onBehalfTitle => 'Absenkan karyawan';

  @override
  String get onBehalfIntro =>
      'Untuk karyawan yang tidak bisa absen sendiri (PM: anggota tim; Admin Staff: semua karyawan PT, juga tanpa akun). Lokasi diambil dari HP Anda, foto karyawan diambil dengan kamera HP Anda. Nama Anda dan alasannya tercatat.';

  @override
  String get onBehalfNoTeam =>
      'Belum ada anggota tim yang ditugaskan hari ini (data tim dari server; tarik ulang di Beranda saat online).';

  @override
  String get onBehalfEmployee => 'Karyawan';

  @override
  String get onBehalfNoAccount => 'tanpa akun';

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
  String get addendumEdit => 'Ubah draft';

  @override
  String get addendumEditTitle => 'Ubah draft addendum';

  @override
  String get addendumSaveChanges => 'Simpan perubahan';

  @override
  String get addendumSaveAndSubmit => 'Simpan & ajukan';

  @override
  String get addendumEdited => 'Perubahan draft addendum tersimpan.';

  @override
  String get addendumNotEditable => 'Addendum ini sudah tidak bisa diubah (bukan Draft lagi atau bukan milik Anda).';

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

  @override
  String get companyAll => 'Semua PT';

  @override
  String get companyAllMine => 'Semua PT saya';

  @override
  String get companySwitcherTitle => 'Pilih PT';

  @override
  String get companySwitcherHint =>
      'Daftar, persetujuan dan ringkasan mengikuti PT yang dipilih. Draft & antrean offline tetap tersimpan di PT masing-masing.';

  @override
  String get companySwitcherApply => 'Terapkan';

  @override
  String get companySwitcherNone => 'Pilih minimal satu PT.';

  @override
  String get companySwitcherTooltip => 'Ganti PT';

  @override
  String companySwitcherMore(String code, int more) {
    return '$code+$more';
  }

  @override
  String companySwitcherApplied(String label) {
    return 'Tampilan: $label';
  }

  @override
  String get profileCompanies => 'PT aktif';

  @override
  String profileCompanyRoles(String code, String roles) {
    return '$code — $roles';
  }

  @override
  String get companyPickTitle => 'Untuk PT mana?';

  @override
  String get companyPickHint => 'Project, pusat biaya, kategori dan rekening diambil dari data PT ini.';

  @override
  String get companyPickNone => 'Anda tidak bisa membuat pengajuan di PT yang dipilih. Ganti PT di beranda.';

  @override
  String get draftCompany => 'PT';

  @override
  String companyNeedsChoiceBanner(int count) {
    return '$count data offline belum punya PT — pilih PT agar bisa dikirim';
  }

  @override
  String get companyNeedsChoiceTitle => 'Pilih PT untuk data offline';

  @override
  String get companyNeedsChoiceHint =>
      'Data ini dibuat sebelum aplikasi mendukung beberapa PT. Pilih PT yang benar untuk setiap data; data tidak dikirim sebelum PT dipilih.';

  @override
  String get companyNeedsChoiceAction => 'Pilih PT';

  @override
  String get companyAssigned => 'PT disimpan. Data akan dikirim.';

  @override
  String get lpjQueueTitle => 'LPJ menunggu verifikasi';

  @override
  String lpjQueueCount(int count) {
    return '$count LPJ';
  }

  @override
  String get privacyTitle => 'Pemberitahuan privasi';

  @override
  String get privacyIntro => 'Baca bagaimana data Anda (termasuk selfie dan lokasi saat absen) dipakai dan disimpan.';

  @override
  String get privacyAcknowledge => 'Saya mengerti';

  @override
  String get privacyLater => 'Nanti';

  @override
  String get privacyLaterHint =>
      'Absensi tetap terkunci sampai Anda menekan \"Saya mengerti\". Pemberitahuan ini muncul lagi saat aplikasi dibuka berikutnya.';

  @override
  String get privacySending => 'Mengirim…';

  @override
  String get privacyAckDone => 'Terima kasih. Pemberitahuan privasi sudah tercatat dibaca.';

  @override
  String get privacyAckOffline =>
      'Belum terkirim: tidak ada koneksi. Dikirim ulang otomatis saat online — absensi tetap terkunci sampai terkirim.';

  @override
  String get privacyAckVersionChanged =>
      'Pemberitahuan privasi sudah diperbarui. Bacalah versi terbaru lalu tekan \"Saya mengerti\" lagi.';

  @override
  String get privacyAckUnavailable =>
      'Server belum mendukung pemberitahuan privasi. Tidak ada yang perlu dikonfirmasi.';

  @override
  String get privacyRetry => 'Coba lagi';

  @override
  String get privacyContinue => 'Lanjut';

  @override
  String get privacyClose => 'Tutup';

  @override
  String get privacyNotAvailable => 'Pemberitahuan privasi belum tersedia di server ini.';

  @override
  String get privacyNoticeOffline =>
      'Pemberitahuan privasi belum tersimpan di HP ini. Sambungkan ke internet untuk membacanya.';

  @override
  String privacyAcknowledgedOn(int version, String date) {
    return 'Sudah Anda baca (versi $version, $date).';
  }

  @override
  String get privacyNotAcknowledged => 'Belum Anda baca — absensi terkunci.';

  @override
  String privacyOutdated(int version) {
    return 'Ada versi baru (versi $version) — baca dan tekan \"Saya mengerti\".';
  }

  @override
  String get privacyAttendanceBlocked =>
      'Absensi (selfie dan lokasi) belum bisa dipakai. Baca pemberitahuan privasi lalu tekan \"Saya mengerti\".';

  @override
  String get privacyRead => 'Baca pemberitahuan privasi';

  @override
  String get fieldHubTitle => 'Laporan Lapangan';

  @override
  String get fieldHubSub => 'Servis unit, timesheet, aftersales';

  @override
  String fieldPendingCount(int count) {
    return '$count belum terkirim';
  }

  @override
  String get fieldTabNew => 'Buat laporan';

  @override
  String get fieldTabHistory => 'Riwayat saya';

  @override
  String get fieldOfflineCache =>
      'Tidak ada sinyal: data unit, kontrak dan PO dari penyimpanan HP (bisa belum terbaru). Laporan tetap bisa dibuat dan dikirim otomatis saat ada sinyal.';

  @override
  String get fieldNoProjectsHub =>
      'Belum ada project kontrak unit atau aftersales yang ditugaskan ke Anda. Hubungi PM/Admin bila ini keliru.';

  @override
  String get fieldLocalTitle => 'Di HP ini';

  @override
  String get fieldServerTitle => 'Terkirim ke server';

  @override
  String get fieldHistoryOffline => 'Tidak ada sinyal — riwayat dari server tampil saat online.';

  @override
  String get fieldHistoryEmpty => 'Belum ada laporan lapangan Anda.';

  @override
  String fieldEditTag(String doc) {
    return 'Ubah $doc';
  }

  @override
  String get fieldConflictHint => 'Sudah ada perubahan di server. Ketuk untuk memilih versi yang dipakai.';

  @override
  String get fieldEditableTag => 'Bisa diubah ≤ 24 jam';

  @override
  String get fieldFlagOffline => 'Offline';

  @override
  String get fieldFlagBackdated => 'Tanggal mundur';

  @override
  String get fieldFlagHmGap => 'Selisih HM';

  @override
  String get fieldFlagBreakdown => 'Breakdown ≥ 4 jam';

  @override
  String get fieldFlagCorrected => 'Dikoreksi';

  @override
  String fieldValueShown(String value) {
    return 'Nilai: $value';
  }

  @override
  String fieldReporter(String name) {
    return 'Pelapor: $name';
  }

  @override
  String fieldEditUntil(String time) {
    return 'Ubah (sampai $time)';
  }

  @override
  String get fieldNotEditable => 'Sudah lewat 24 jam: perubahan hanya lewat koreksi PM/Direktur di web.';

  @override
  String get fieldNotFound => 'Laporan tidak ditemukan di HP ini.';

  @override
  String get fieldStateDraft => 'Draft';

  @override
  String get fieldStateQueued => 'Menunggu sinyal';

  @override
  String get fieldStateSent => 'Terkirim';

  @override
  String get fieldStateConflict => 'Konflik';

  @override
  String get fieldStateRejected => 'Ditolak';

  @override
  String get fieldDraftSaved => 'Draft tersimpan';

  @override
  String get fieldQueuedOnline => 'Laporan disimpan dan sedang dikirim.';

  @override
  String get fieldQueuedOffline => 'Laporan disimpan di HP dan dikirim otomatis saat ada sinyal.';

  @override
  String get fieldFixErrors => 'Periksa isian yang ditandai merah.';

  @override
  String get fieldDiscardTitle => 'Hapus draft?';

  @override
  String get fieldDiscardBody => 'Draft dan fotonya dihapus dari HP ini. Server belum menerima laporan ini.';

  @override
  String get fieldDiscarded => 'Draft dihapus.';

  @override
  String get fieldPhotoFailed => 'Foto gagal disimpan. Coba lagi.';

  @override
  String get fieldAddPhoto => 'Ambil foto';

  @override
  String fieldEditWindow(String time) {
    return 'Bisa diubah sampai $time.';
  }

  @override
  String get fieldEditReason => 'Alasan perubahan (opsional)';

  @override
  String get fieldEditReasonHelp => 'Tercatat di riwayat audit.';

  @override
  String get fieldSaveEdit => 'Simpan perubahan';

  @override
  String get fieldReportNotes => 'Catatan';

  @override
  String get fieldDate => 'Tanggal';

  @override
  String get fieldProjectContract => 'Project / kontrak';

  @override
  String get fieldNoProjects => 'Tidak ada project kontrak unit / aftersales untuk Anda.';

  @override
  String get fieldProjectUnavailable =>
      'Project ini tidak lagi tersedia untuk laporan lapangan Anda (penugasan atau jenis project berubah).';

  @override
  String get fieldUnit => 'Unit';

  @override
  String get fieldPickUnit => 'Pilih unit';

  @override
  String get fieldChoose => 'Pilih';

  @override
  String get fieldChange => 'Ganti';

  @override
  String get fieldNoUnits => 'Belum ada unit untuk project ini di HP. Buka saat online untuk memuat data unit.';

  @override
  String get fieldUnitSearch => 'Cari kode unit / plat / tipe';

  @override
  String get fieldUnitNone => 'Unit tidak ditemukan.';

  @override
  String get fieldUnitOwnerOwn => 'Milik sendiri';

  @override
  String fieldUnitOwnerCustomer(String name) {
    return 'Milik pelanggan ($name)';
  }

  @override
  String fieldUnitLastHm(String hm) {
    return 'HM terakhir $hm';
  }

  @override
  String get fieldHmAtService => 'HM saat servis';

  @override
  String fieldHmLast(String hm) {
    return 'HM terakhir unit $hm';
  }

  @override
  String fieldHmBelow(String hm) {
    return 'Lebih kecil dari HM terakhir unit ($hm). Server akan menolak; koreksi HM lama oleh PM/Direktur.';
  }

  @override
  String get fieldStart => 'Mulai';

  @override
  String get fieldEnd => 'Selesai';

  @override
  String get fieldWork => 'Pekerjaan';

  @override
  String get fieldServiceType => 'Jenis servis';

  @override
  String get fieldServiceTypeHelp => 'Boleh pilih lebih dari satu.';

  @override
  String fieldServiceTypeInactive(String name) {
    return '$name (nonaktif)';
  }

  @override
  String get fieldServiceTypesEmpty =>
      'Belum ada jenis servis untuk PT ini. Buka Laporan Lapangan saat online (tarik ke bawah), atau minta Admin menambahkannya di web.';

  @override
  String get fieldComplaint => 'Keluhan';

  @override
  String get fieldAction => 'Tindakan / pekerjaan';

  @override
  String get fieldHelpers => 'Helper (opsional)';

  @override
  String get fieldSpareparts => 'Sparepart dipakai';

  @override
  String get fieldPartNameHeader => 'Nama sparepart';

  @override
  String get fieldPartNameHint => 'Nama sparepart';

  @override
  String get fieldPartNoHint => 'No. part (opsional)';

  @override
  String get fieldUomHint => 'set';

  @override
  String get fieldAddSparepart => 'Tambah sparepart';

  @override
  String get fieldSparepartsNote => 'Catatan saja — stok sparepart tidak dikelola di aplikasi.';

  @override
  String get fieldUnitStatusAfter => 'Status unit setelah servis';

  @override
  String fieldPmNotified(String unit) {
    return 'PM akan diberi notifikasi: unit $unit menunggu part.';
  }

  @override
  String get fieldPhotos => 'Foto';

  @override
  String get fieldPhotoBefore => 'Foto sebelum servis';

  @override
  String get fieldPhotoAfter => 'Foto sesudah servis';

  @override
  String fieldPhotoBeforeCount(int count) {
    return 'Sebelum ($count)';
  }

  @override
  String fieldPhotoAfterCount(int count) {
    return 'Sesudah ($count)';
  }

  @override
  String fieldPhotoLimit(int max) {
    return 'Maksimal $max foto per laporan.';
  }

  @override
  String fieldPhotosOnServer(int count) {
    return '$count foto sudah ada di server (foto tidak bisa dihapus).';
  }

  @override
  String fieldPartsCount(int count) {
    return '$count sparepart';
  }

  @override
  String fieldPhotoCount(int count) {
    return '$count foto';
  }

  @override
  String get fieldServiceTitle => 'Laporan Servis Unit';

  @override
  String get fieldServiceEditTitle => 'Ubah Laporan Servis';

  @override
  String get fieldServiceSubmit => 'Kirim laporan servis';

  @override
  String get fieldTimesheetTitle => 'Timesheet Unit';

  @override
  String get fieldTimesheetEditTitle => 'Ubah Timesheet Unit';

  @override
  String get fieldContract => 'Kontrak';

  @override
  String get fieldNoContracts => 'Tidak ada project kontrak unit untuk Anda.';

  @override
  String fieldNoContractUnits(String date) {
    return 'Tidak ada unit kontrak yang aktif pada $date. Buka saat online untuk memuat data kontrak.';
  }

  @override
  String get fieldTabFilled => 'terisi';

  @override
  String get fieldTabMissing => 'belum';

  @override
  String get fieldTimesheetAlreadySent =>
      'Timesheet unit ini untuk tanggal tersebut sudah ada di server. Perubahan lewat Riwayat saya (≤ 24 jam) atau koreksi PM.';

  @override
  String get fieldHourMeter => 'Hour meter (HM)';

  @override
  String get fieldHmStart => 'HM awal';

  @override
  String get fieldHmEnd => 'HM akhir';

  @override
  String fieldHmPrefilled(String date, String hm) {
    return 'HM awal otomatis dari HM akhir terakhir yang tercatat: $date ($hm).';
  }

  @override
  String fieldHmUsed(String hours) {
    return 'Selisih HM: $hours jam';
  }

  @override
  String fieldHmGap(String hm) {
    return 'HM awal berbeda dengan HM akhir sebelumnya ($hm). Boleh dikirim, akan ditandai \"Selisih HM\" untuk dicek PM.';
  }

  @override
  String get fieldHmPhoto => 'Foto meter HM';

  @override
  String get fieldHmPhotoRequired => 'Foto meter HM akhir (wajib bila HM diisi)';

  @override
  String get fieldHmPhotoFixed => 'Foto meter HM sudah di server (tidak bisa diganti).';

  @override
  String get fieldHmOptional =>
      'HM opsional — isi saat pencatatan HM mingguan. Bila diisi, HM awal dan HM akhir wajib keduanya, plus foto meter HM. HM awal otomatis tidak dikirim selama HM akhir kosong.';

  @override
  String fieldTimesheetBackdateWide(String date) {
    return 'Sebagai PM project / Direktur Anda dapat mengisi timesheet sejak $date (selama periode kontrak unit).';
  }

  @override
  String get fieldOperatingHours => 'Jam operasi';

  @override
  String get fieldWorkHours => 'Kerja';

  @override
  String get fieldStandbyHours => 'Standby';

  @override
  String get fieldBreakdownHours => 'Breakdown';

  @override
  String fieldHoursTotal(String total) {
    return 'Total $total dari 24 jam';
  }

  @override
  String fieldHoursOver(String total) {
    return 'Total $total jam — melebihi 24 jam';
  }

  @override
  String get fieldHoursLegend => 'kerja (biru) · standby (kuning) · breakdown (merah)';

  @override
  String get fieldBreakdownReason => 'Alasan breakdown';

  @override
  String get fieldBreakdownReasonHint => 'Mis. hidrolik bocor, menunggu part';

  @override
  String get fieldNoBreakdown => '— (tidak ada breakdown)';

  @override
  String fieldSuggestService(String hours) {
    return 'Breakdown $hours jam. Sebaiknya buat laporan servis untuk unit ini.';
  }

  @override
  String get fieldCreateServiceReport => 'Buat laporan servis';

  @override
  String get fieldOperatorFuel => 'Operator & BBM';

  @override
  String get fieldCopyYesterday => 'Salin dari kemarin';

  @override
  String get fieldCopyNone => 'Belum ada timesheet sebelumnya untuk unit ini.';

  @override
  String fieldCopied(String date) {
    return 'Operator dan lokasi disalin dari $date.';
  }

  @override
  String get fieldOperatorName => 'Nama operator';

  @override
  String get fieldFuel => 'BBM (liter)';

  @override
  String get fieldLocation => 'Lokasi';

  @override
  String fieldNextUnit(String unit) {
    return 'Unit berikutnya: $unit belum diisi';
  }

  @override
  String get fieldNextNone => 'Semua unit kontrak sudah terisi untuk tanggal ini.';

  @override
  String fieldSaveAndNext(String unit) {
    return 'Simpan & lanjut ke $unit';
  }

  @override
  String get fieldTimesheetSave => 'Simpan timesheet';

  @override
  String get fieldActivityTitle => 'Aktivitas Aftersales';

  @override
  String get fieldActivityEditTitle => 'Ubah Aktivitas Aftersales';

  @override
  String get fieldActivityNew => 'Aktivitas baru';

  @override
  String get fieldActivityEdit => 'Ubah aktivitas';

  @override
  String get fieldNoAftersalesProjects => 'Tidak ada project aftersales untuk Anda.';

  @override
  String get fieldCustomer => 'Pelanggan';

  @override
  String get fieldNoCustomers =>
      'Belum ada daftar pelanggan di HP. Buka saat online untuk memuat daftar pelanggan PT (perlu ditugaskan ke project aftersales).';

  @override
  String get fieldActivityKind => 'Jenis aktivitas';

  @override
  String get fieldForPo => 'Untuk PO (PO terbuka pelanggan ini)';

  @override
  String get fieldNoOpenPos => 'Tidak ada PO terbuka untuk pelanggan ini.';

  @override
  String get fieldDocQuote => 'No. penawaran';

  @override
  String get fieldDocPo => 'No. PO';

  @override
  String get fieldDocDelivery => 'No. surat jalan';

  @override
  String get fieldDocInvoice => 'No. invoice';

  @override
  String get fieldDocOther => 'No. dokumen';

  @override
  String get fieldItems => 'Item';

  @override
  String get fieldItemsDelivered => 'Item dikirim';

  @override
  String get fieldAddItem => 'Tambah item';

  @override
  String get fieldPoDelivered => 'PO ini sudah terkirim semua';

  @override
  String get fieldPoDeliveredHelp => 'Tidak dicentang = terkirim sebagian (PO tetap terbuka).';

  @override
  String get fieldFollowUpPick => 'Tanggal follow-up (opsional)';

  @override
  String fieldFollowUpOn(String date) {
    return 'Follow-up $date';
  }

  @override
  String fieldFollowUpShort(String date) {
    return 'follow-up $date';
  }

  @override
  String get fieldFollowUpHelp => 'Anda dan PM diingatkan pada tanggal follow-up.';

  @override
  String get fieldReceiver => 'Penerima';

  @override
  String get fieldValue => 'Nilai Rp (opsional)';

  @override
  String get fieldValueHelp => 'Hanya terlihat oleh Anda dan Direktur/Finance.';

  @override
  String get fieldProofPhoto => 'Foto surat jalan / serah terima';

  @override
  String fieldProofPhotos(int count, int max) {
    return 'Foto surat jalan / serah terima ($count/$max)';
  }

  @override
  String get fieldActivitySubmit => 'Simpan aktivitas';

  @override
  String fieldToday(int count) {
    return 'Hari ini ($count)';
  }

  @override
  String get fieldTodayEmpty => 'Belum ada aktivitas pada tanggal ini.';

  @override
  String get fieldTodayOffline => 'Tidak ada sinyal — aktivitas di server tampil saat online.';

  @override
  String get fieldNeedsFollowUp => 'Perlu ditindaklanjuti';

  @override
  String fieldOpenPosCount(int count) {
    return '$count PO belum terkirim';
  }

  @override
  String fieldFollowUpsToday(int count) {
    return '$count penawaran follow-up hari ini';
  }

  @override
  String get fieldPoStatus => 'Status PO';

  @override
  String get fieldConflictTitle => 'Konflik laporan lapangan';

  @override
  String get fieldConflictGone => 'Konflik sudah selesai.';

  @override
  String get fieldUseServer => 'Pakai versi server';

  @override
  String get fieldResendMine => 'Kirim ulang versi saya';

  @override
  String get fieldNotEditableAnymore =>
      'Sudah lewat 24 jam: versi HP tidak bisa dikirim ulang. Minta koreksi PM/Direktur.';

  @override
  String get fieldUsedServer => 'Versi server dipakai; salinan di HP dihapus.';

  @override
  String get fieldResent => 'Versi HP dikirim ulang.';

  @override
  String get fieldResendReason => 'Alasan kirim ulang';

  @override
  String get fieldResendReasonHelp => 'Wajib, min. 3 karakter (tercatat di audit).';

  @override
  String get fieldDiffers => 'berbeda';

  @override
  String get fieldServerVersion => 'Server';

  @override
  String get fieldMyVersion => 'HP ini';

  @override
  String fieldNewPhotos(int count) {
    return '$count foto baru';
  }

  @override
  String get dailyTitle => 'Laporan Harian';

  @override
  String get dailyEditTitle => 'Ubah Laporan Harian';

  @override
  String get dailyWeather => 'Cuaca & jam hilang';

  @override
  String get dailyMorning => 'Pagi';

  @override
  String get dailyNoon => 'Siang';

  @override
  String get dailyAfternoon => 'Sore';

  @override
  String get dailyRainHours => 'Jam hujan';

  @override
  String get dailyStopHours => 'Jam kerja berhenti';

  @override
  String get dailyWorkSection => 'Volume pekerjaan hari ini';

  @override
  String get dailyPickProject => 'Pilih project konstruksi dulu.';

  @override
  String get dailyNoRap =>
      'Project ini belum punya RAP di HP. Tarik ke bawah untuk memuat ulang; bila tetap kosong, minta PM/Direktur mengisi RAP di web.';

  @override
  String dailyRealised(String done, String volume, String uom) {
    return 'Realisasi $done / $volume $uom';
  }

  @override
  String dailyOverRap(String total, String volume, String uom) {
    return 'Melebihi RAP: $total dari $volume $uom — isi catatan.';
  }

  @override
  String get dailyOverRapNotify =>
      'Ada volume melebihi RAP: laporan tetap dikirim, ditandai \"melebihi RAP\" dan PM project diberi notifikasi.';

  @override
  String get dailyMaterialSection => 'Material';

  @override
  String get dailyMaterialHelp =>
      'Masuk = diterima di lokasi hari ini; terpakai = dipakai hari ini. Material tidak dihitung ke progress.';

  @override
  String get dailyReceived => 'Masuk';

  @override
  String get dailyUsed => 'Terpakai';

  @override
  String dailyStock(String stock, String uom) {
    return 'Stok $stock $uom';
  }

  @override
  String get dailyManpower => 'Tenaga & alat';

  @override
  String get dailyEquipment => 'Alat (unit · jam kerja)';

  @override
  String get dailyHours => 'Jam';

  @override
  String dailyWorkers(int count) {
    return '$count pekerja';
  }

  @override
  String get dailyNoResources => 'Jenis tenaga/alat belum dimuat. Tarik ke bawah saat ada sinyal.';

  @override
  String get dailyNotesSection => 'Kendala, catatan & foto';

  @override
  String get dailyIssues => 'Kendala';

  @override
  String get dailyNotesRequired => 'Wajib karena ada volume melebihi RAP.';

  @override
  String get dailyPhoto => 'Foto pekerjaan';

  @override
  String dailyPhotos(int count, int max) {
    return 'Foto pekerjaan ($count/$max)';
  }

  @override
  String get dailySubmit => 'Kirim laporan harian';

  @override
  String dailySummary(int items, int workers, int photos) {
    return '$items item pekerjaan · $workers pekerja · $photos foto';
  }

  @override
  String get dailyNoProjects =>
      'Tidak ada project konstruksi yang bisa Anda laporkan (Staff: project yang ditugaskan; PM: project tim).';

  @override
  String get dailySameDay => 'Sudah ada laporan harian Anda untuk project & tanggal ini di HP. Buka laporan itu.';

  @override
  String get dailyFlagOverRap => 'Melebihi RAP';

  @override
  String get dailyFlagDuplicate => 'Kemungkinan dobel';

  @override
  String dailyWorkItem(String item) {
    return 'Volume $item';
  }

  @override
  String get dailyWorkerCount => 'Jumlah pekerja';

  @override
  String get sectionRequestDetails => 'Rincian pengajuan';

  @override
  String get sectionRequester => 'Pemohon';

  @override
  String get bankNameLabel => 'Bank';

  @override
  String get bankHolderLabel => 'Atas nama';

  @override
  String get bankNumberLabel => 'Nomor rekening';

  @override
  String get bankShowNumber => 'Tampilkan nomor rekening';

  @override
  String get bankHideNumber => 'Sembunyikan nomor rekening';

  @override
  String docNoCopied(String docNo) {
    return 'Nomor $docNo disalin.';
  }

  @override
  String get docNoCopyHint => 'Ketuk untuk menyalin nomor';

  @override
  String get docNoOpenHint => 'Ketuk untuk membuka dokumen';

  @override
  String get receiptOpenPhoto => 'Buka foto nota';

  @override
  String receiptLineCaption(int no) {
    return 'Baris $no';
  }

  @override
  String get attendanceSelfieView => 'Lihat selfie';

  @override
  String get attendanceSelfieUnavailable => 'Selfie tidak tersedia (mungkin sudah melewati masa retensi).';

  @override
  String pickHint(String field) {
    return 'Pilih $field';
  }

  @override
  String get pickEmployee => 'Pilih karyawan';

  @override
  String get pickPo => 'Pilih PO terbuka';

  @override
  String get pickLocation => 'Pilih lokasi';

  @override
  String get fieldRapItem => 'Item RAP';

  @override
  String get rapPickHint => 'Pilih item RAP';

  @override
  String get rapOverBudgetChip => 'Melebihi RAP';

  @override
  String rapOverDetail(String total, String remaining) {
    return 'Total $total melebihi sisa RAP $remaining';
  }

  @override
  String rapRemaining(String amount) {
    return 'Sisa $amount';
  }

  @override
  String rapOf(String amount) {
    return 'dari $amount';
  }

  @override
  String get rapPickProjectFirst => 'Pilih project pengajuan dulu.';

  @override
  String get rapOfflineNoBudget => 'Offline: sisa anggaran RAP tampil lagi saat online.';

  @override
  String get rapNoItems => 'Project ini belum punya RAP (project tanpa RAB: item RAP tidak wajib).';

  @override
  String get rapMissingBlock => 'Project belum punya RAP — hubungi PM';

  @override
  String get rapMissingBlockDetail =>
      'Pengajuan ini bisa disimpan sebagai draft, tetapi baru bisa dikirim setelah PM mengisi RAP project.';

  @override
  String get rapMissingProjectDetail =>
      'Project ini punya RAB, jadi wajib punya RAP: pengajuan project ini baru bisa dikirim setelah PM / Direktur mengisi RAP.';

  @override
  String get noSearchResults => 'Tidak ada yang cocok.';

  @override
  String get lineNeedsRapItem => 'Baris ini belum terhubung ke item RAP. Pilih item RAP project sebelum diajukan.';

  @override
  String get lineNeedsRapItemShort => 'Pilih item RAP';

  @override
  String projectChangeClearsRap(int count) {
    return 'Item RAP pada $count baris milik project sebelumnya dan akan dikosongkan. Tetap ganti project?';
  }

  @override
  String get projectChangeConfirm => 'Ganti project';

  @override
  String get draftCostCenterLegacy =>
      'Pusat biaya lama tidak dipakai lagi: pusat biaya kini akun kas project. Pilih project (pembayaran vendor / antar-PT boleh tanpa project).';

  @override
  String draftLinesNeedRap(int count) {
    return '$count baris belum memilih item RAP — lengkapi sebelum diajukan.';
  }

  @override
  String get searchClear => 'Hapus pencarian';

  @override
  String get projectsTitle => 'Proyek';

  @override
  String get projectsSearchHint => 'Cari kode atau nama project…';

  @override
  String get projectStatusActive => 'Semua aktif';

  @override
  String get projectsEmpty => 'Belum ada project yang dapat Anda lihat.';

  @override
  String get projectsNoMatch => 'Tidak ada yang cocok dengan pencarian / filter.';

  @override
  String get projectPm => 'PM';

  @override
  String get projectRapUsed => 'Realisasi RAP';

  @override
  String projectRapOverItems(int count) {
    return '$count item RAP melebihi rencana';
  }

  @override
  String get projectTitle => 'Project';

  @override
  String get projectTabInfo => 'Proyek';

  @override
  String get projectTabRap => 'RAP';

  @override
  String get projectTabRequests => 'Pengajuan';

  @override
  String get projectCode => 'Kode';

  @override
  String get projectName => 'Nama project';

  @override
  String get projectKind => 'Jenis project';

  @override
  String get projectStatus => 'Status';

  @override
  String get projectContractValue => 'Nilai kontrak (RAB)';

  @override
  String get projectClient => 'Klien';

  @override
  String get projectPeriod => 'Periode';

  @override
  String get projectProgress => 'Progress fisik';

  @override
  String get projectAddress => 'Alamat';

  @override
  String get projectRapSummary => 'Ringkasan RAP';

  @override
  String rapItemsCount(int count) {
    return '$count item RAP';
  }

  @override
  String get rapPlanned => 'Rencana';

  @override
  String get rapRealised => 'Realisasi';

  @override
  String get rapRemainingLabel => 'Sisa';

  @override
  String get rapNoPrices => 'Nilai RAP hanya terlihat oleh Direktur, Admin, Finance dan PM project.';

  @override
  String get rapNoItemsProject => 'Project ini belum punya item RAP.';

  @override
  String get rapInactive => 'Nonaktif';

  @override
  String get requestsSearchHint => 'Cari nomor atau judul…';

  @override
  String get filterStatus => 'Status';

  @override
  String get filterAllStatuses => 'Semua status';

  @override
  String get projectNoRequests => 'Belum ada pengajuan untuk project ini.';

  @override
  String get homeProjectsSub => 'Info, RAP & pengajuan';

  @override
  String get financeTitle => 'Finance';

  @override
  String get homeFinanceSub => 'Antrian transfer & LPJ';

  @override
  String financeQueueCount(int count) {
    return '$count siap ditransfer';
  }

  @override
  String get transferQueueTitle => 'Antrian Transfer';

  @override
  String get lpjVerifyTitle => 'Verifikasi LPJ';

  @override
  String get slaAgeUnknown => 'Umur sejak disetujui: —';

  @override
  String slaAge(String age) {
    return '$age sejak disetujui';
  }

  @override
  String slaOver(String hours) {
    return 'lewat SLA $hours jam';
  }

  @override
  String get transferSearchHint => 'Nomor, judul, pemilik rekening…';

  @override
  String get filterAllTypes => 'Semua jenis';

  @override
  String get slaOverFilter => 'Lewat SLA';

  @override
  String get transferQueueEmpty => 'Antrian transfer kosong.';

  @override
  String listShownOf(int shown, int total) {
    return '$shown dari $total pengajuan';
  }

  @override
  String get costCenterByFinance => 'dipilih Finance (tanpa project)';

  @override
  String get bankVerified => 'Terverifikasi';

  @override
  String get bankUnverified => 'Belum diverifikasi';

  @override
  String openFlags(int count) {
    return 'Flag terbuka: $count';
  }

  @override
  String get transferRecord => 'Catat transfer';

  @override
  String get lpjQueueEmpty => 'Tidak ada LPJ yang menunggu verifikasi.';

  @override
  String get lpjReadOnlyHint => 'Buka pengajuan untuk memeriksa nota dan memverifikasi LPJ.';

  @override
  String get transferNotInQueue => 'Pengajuan ini tidak lagi ada di antrian transfer (mungkin sudah ditransfer).';

  @override
  String get transferAtLabel => 'Tanggal & jam transfer';

  @override
  String get transferAtHelp => 'Sesuai bukti transfer bank.';

  @override
  String get transferAtHint => 'Pilih tanggal & jam';

  @override
  String get transferRecorded => 'Transfer tercatat.';

  @override
  String transferRecordedNo(String no) {
    return 'Transfer $no tercatat.';
  }

  @override
  String get overrideConfirm => 'Tetap simpan';

  @override
  String get overrideCancelled => 'Belum disimpan — konfirmasi dibatalkan.';

  @override
  String transferAmountText(String amount) {
    return 'Transfer $amount';
  }

  @override
  String get transferAmountHelp => 'Nominal disetujui — ditetapkan server, tidak dapat diubah.';

  @override
  String get bankDestination => 'Rekening tujuan';

  @override
  String get cashAccountLabel => 'Akun kas';

  @override
  String get bankRefLabel => 'No. referensi bank';

  @override
  String get bankRefHint => 'mis. nomor referensi di bukti';

  @override
  String get transferProofLabel => 'Bukti transfer';

  @override
  String get proofRetake => 'Foto ulang';

  @override
  String get transferProofHelp => 'Foto bukti transfer bank (kamera atau galeri); dikompres sebelum diunggah.';

  @override
  String get processing => 'Memproses…';

  @override
  String get overdraftTitle => 'Saldo akun kas akan minus';

  @override
  String overdraftFigures(String balance, String after) {
    return 'Saldo saat ini $balance; sesudah transaksi ini $after.';
  }

  @override
  String get overdraftGeneric => 'Saldo akun akan menjadi minus.';

  @override
  String get overdraftNote =>
      'Pastikan dana memang tersedia (mis. setoran belum dicatat). Konfirmasi Anda tercatat di audit log.';

  @override
  String get unverifiedTitle => 'Rekening tujuan belum diverifikasi';

  @override
  String unverifiedLine(String account) {
    return 'Rekening $account berstatus \"Belum diverifikasi\".';
  }

  @override
  String get unverifiedDestination => 'tujuan';

  @override
  String get unverifiedNote =>
      'Periksa nomor rekening dan nama pemilik dengan karyawan sebelum mentransfer. Konfirmasi Anda tercatat di audit log.';

  @override
  String get proofCamera => 'Kamera';

  @override
  String rapOverBy(String amount) {
    return 'Lebih $amount';
  }

  @override
  String get loanTitle => 'Pinjaman antar project';

  @override
  String get loanTab => 'Pinjaman';

  @override
  String get loanEmpty => 'Belum ada pinjaman antar project.';

  @override
  String get loanInboxEmpty => 'Tidak ada pinjaman antar project yang menunggu keputusan Anda.';

  @override
  String loanInboxTitle(int count) {
    return 'Pinjaman antar project ($count)';
  }

  @override
  String get loanNew => 'Ajukan pinjaman';

  @override
  String get loanNewTitle => 'Ajukan pinjaman antar project';

  @override
  String get loanEditTitle => 'Ubah draft pinjaman';

  @override
  String get loanNotEditable => 'Pinjaman ini sudah tidak bisa diubah (bukan Draft lagi atau bukan milik Anda).';

  @override
  String get loanNoBorrower =>
      'Pinjaman antar project diajukan oleh PM project peminjam atau Finance. Anda belum menjadi PM project yang aktif.';

  @override
  String get loanBorrower => 'Project peminjam';

  @override
  String get loanLender => 'Project pemberi pinjaman';

  @override
  String get loanKind => 'Jenis';

  @override
  String get loanKindDana => 'Dana';

  @override
  String get loanKindBarang => 'Barang/material';

  @override
  String get loanAmount => 'Nilai pinjaman';

  @override
  String get loanReason => 'Alasan';

  @override
  String get loanDate => 'Tanggal pinjaman';

  @override
  String get loanDueDate => 'Jatuh tempo';

  @override
  String get loanRepaid => 'Sudah kembali';

  @override
  String get loanOutstanding => 'Sisa pinjaman';

  @override
  String get loanSaveDraft => 'Simpan draft';

  @override
  String get loanSaveChanges => 'Simpan perubahan';

  @override
  String get loanSubmit => 'Ajukan ke Direktur';

  @override
  String get loanSubmitConfirmTitle => 'Ajukan pinjaman?';

  @override
  String get loanSubmitConfirmBody =>
      'Nomor PJ diberikan dan Direktur diberi tahu. Isi pinjaman tidak dapat diubah lagi.';

  @override
  String get loanSubmitted => 'Pinjaman diajukan. Menunggu persetujuan Direktur.';

  @override
  String get loanSavedDraft => 'Draft pinjaman tersimpan.';

  @override
  String get loanEdit => 'Ubah draft';

  @override
  String get loanCancel => 'Batalkan';

  @override
  String get loanCancelTitle => 'Batalkan pinjaman?';

  @override
  String get loanCancelPrompt => 'Pinjaman dibatalkan (tidak dihapus). Alasan wajib.';

  @override
  String get loanApprove => 'Setujui';

  @override
  String get loanReject => 'Tolak';

  @override
  String loanApproveTitle(String docNo) {
    return 'Setujui $docNo?';
  }

  @override
  String loanApproveBody(String borrower, String amount, String lender) {
    return '$borrower meminjam $amount dari $lender. Persetujuan Direktur lalu Owner; untuk dana, Finance kemudian mentransfer lewat Antrian Transfer: kas keluar dari pusat biaya pemberi dan kas masuk ke pusat biaya peminjam.';
  }

  @override
  String loanRejectTitle(String docNo) {
    return 'Tolak $docNo?';
  }

  @override
  String get loanRejectPrompt => 'Alasan penolakan dikirim ke PM peminjam.';

  @override
  String get loanDone => 'Tersimpan.';

  @override
  String loanOverdueDays(int days) {
    return 'Terlambat · $days hari';
  }

  @override
  String get loanRoleBorrower => 'Meminjam';

  @override
  String get loanRoleLender => 'Meminjamkan';

  @override
  String loanFlow(String lender, String borrower) {
    return '$lender → $borrower';
  }

  @override
  String get loanRepayments => 'Pengembalian';

  @override
  String loanRepaymentSeq(int n) {
    return 'Pengembalian ke-$n';
  }

  @override
  String get loanRepaymentVoid => 'Dibatalkan (void)';

  @override
  String loanRepaymentVoidReason(String reason) {
    return 'Dibatalkan (void): $reason';
  }

  @override
  String get loanRepaymentsEmpty => 'Belum ada pengembalian.';

  @override
  String get loanRepaymentsWebHint => 'Pengembalian dicatat di web oleh PM peminjam atau Finance.';

  @override
  String loanRecordedBy(String name) {
    return 'dicatat $name';
  }

  @override
  String get loanTimeline => 'Alur persetujuan';

  @override
  String get loanStepSubmitted => 'Diajukan PM peminjam';

  @override
  String get loanStepDirektur => 'Persetujuan Direktur';

  @override
  String get loanStepWaiting => 'Menunggu';

  @override
  String get loanStepNotYet => 'Belum';

  @override
  String get loanDecApproved => 'Disetujui';

  @override
  String get loanDecRejected => 'Ditolak';

  @override
  String loanOutstandingOf(String amount) {
    return 'Sisa $amount';
  }

  @override
  String loanDueOn(String date) {
    return 'Jatuh tempo $date';
  }

  @override
  String get fieldPayeeType => 'Jenis penerima';

  @override
  String get payeeKaryawan => 'Karyawan';

  @override
  String get payeeVendor => 'Vendor';

  @override
  String get fieldVendor => 'Vendor';

  @override
  String get fieldVendorBankAccount => 'Rekening vendor';

  @override
  String get fieldInvoiceNo => 'Nomor invoice';

  @override
  String get fieldInvoiceDate => 'Tanggal invoice';

  @override
  String get fieldInvoiceDueDate => 'Jatuh tempo';

  @override
  String get fieldInvoiceFile => 'Foto invoice';

  @override
  String get invoiceCamera => 'Kamera';

  @override
  String get invoiceGallery => 'Galeri';

  @override
  String get invoiceAttached => 'Foto invoice terlampir';

  @override
  String get invoiceOnServer => 'Invoice tersimpan di server';

  @override
  String get invoiceMissing => 'Belum ada foto invoice';

  @override
  String get vendorPaymentHint =>
      'Pembayaran vendor: Finance mentransfer ke rekening vendor; invoice = bukti — tanpa nota per baris dan tanpa LPJ.';

  @override
  String get sectionVendorPayment => 'Pembayaran vendor';

  @override
  String get vendorAccountsNone => 'Vendor ini belum punya rekening aktif — minta Finance / Admin menambahkannya.';

  @override
  String get payeePtGrup => 'PT grup';

  @override
  String get fieldPayeeCompany => 'PT penerima';

  @override
  String get payeeCompanyPickHint => 'Pilih PT penerima';

  @override
  String get intercompanyPaymentHint =>
      'Pembayaran antar-PT: Finance mentransfer ke rekening penerimaan antar-PT milik PT penerima; kas masuk di PT itu tercatat otomatis. Dokumen PT penerima (tagihan / memo) = bukti — tanpa nota per baris dan tanpa LPJ.';

  @override
  String get intercompanyPayeesNone =>
      'Belum ada PT lain yang menetapkan rekening penerimaan antar-PT — minta Finance / Admin PT penerima menandainya.';

  @override
  String get intercompanyPayeeGone =>
      'PT ini tidak ada lagi di daftar penerima antar-PT (mis. rekening penerimaannya dicabut). Pilih ulang PT penerima.';

  @override
  String get intercompanyReceivingAccount => 'Rekening penerimaan antar-PT';

  @override
  String get fieldDocumentNo => 'Nomor dokumen';

  @override
  String get fieldDocumentDate => 'Tanggal dokumen';

  @override
  String get fieldDocumentFile => 'Foto dokumen';

  @override
  String get documentNoHelp => 'Tagihan / memo dari PT penerima';

  @override
  String get documentAttached => 'Foto dokumen terlampir';

  @override
  String get documentOnServer => 'Dokumen tersimpan di server';

  @override
  String get documentMissing => 'Belum ada foto dokumen';

  @override
  String get sectionIntercompanyPayment => 'Pembayaran antar-PT';

  @override
  String intercompanyEntryLabel(String pt) {
    return 'Kas masuk di PT $pt';
  }

  @override
  String intercompanyEntryVoided(String no) {
    return '$no (dibatalkan — jurnal balik tercatat)';
  }

  @override
  String intercompanyBadge(String pt) {
    return 'Antar PT: $pt';
  }

  @override
  String transferIntercompanyNote(String pt) {
    return 'Antar PT: kas masuk di PT $pt tercatat otomatis dengan tanggal transfer ini.';
  }

  @override
  String transferRecordedIntercompany(String trf, String km, String pt) {
    return 'Transfer $trf tercatat. Kas masuk $km dibuat di PT $pt.';
  }

  @override
  String kpiCashFlowAntarPt(String masuk, String keluar) {
    return 'Termasuk Antar PT: masuk $masuk · keluar $keluar';
  }

  @override
  String get kpiCashFlowWithoutAntarPt => 'Tanpa antar-PT';

  @override
  String kpiCashFlowAntarPtExcluded(String masuk, String keluar) {
    return 'Tanpa antar-PT: masuk $masuk · keluar $keluar tidak dihitung';
  }

  @override
  String fundPanelTitle(String pt) {
    return 'Ketersediaan dana PT $pt';
  }

  @override
  String get fundNotEnabled => 'Cek dana PT ini belum aktif (informasi saja).';

  @override
  String get fundNotFinal => 'Cek akhir di persetujuan Owner.';

  @override
  String get fundBalance => 'Saldo dana';

  @override
  String fundAccounts(int count) {
    return '$count akun';
  }

  @override
  String fundPbTitle(String name) {
    return 'Pusat biaya: $name';
  }

  @override
  String get fundPbBalance => 'Saldo akun';

  @override
  String get fundPbAvailable => 'Dana bebas';

  @override
  String fundPtSection(String pt) {
    return 'Seluruh PT $pt';
  }

  @override
  String get fundCommitments => 'Komitmen';

  @override
  String fundCommitmentDetails(int count) {
    return 'Rincian komitmen ($count)';
  }

  @override
  String get fundAvailable => 'Dana tersedia';

  @override
  String get fundNeeded => 'Dibutuhkan';

  @override
  String get fundShortLabel => 'Kurang';

  @override
  String get fundStatusLabel => 'Status';

  @override
  String fundGap(String amount) {
    return 'Kurang $amount';
  }

  @override
  String get fundEnough => 'Cukup';

  @override
  String fundWaiting(int count, String amount) {
    return 'Pengajuan lain menunggu persetujuan akhir di PT ini: $count, total $amount (belum dicadangkan — yang disetujui lebih dulu memakai dana lebih dulu).';
  }

  @override
  String get fundLoansTitle => 'Pinjaman antar-PT untuk pengajuan ini';

  @override
  String get fundInstructLoan => 'Perintahkan pinjaman antar-PT';

  @override
  String fundShortBadge(String amount) {
    return 'Dana kurang $amount';
  }

  @override
  String get icLoanTitle => 'Pinjaman antar-PT';

  @override
  String get icLoanInstructTitle => 'Perintahkan pinjaman antar-PT';

  @override
  String get icLoanInstructNote =>
      'Nomor PJA dari PT pemberi. Finance PT pemberi mencairkan dari Antrian Transfer; Owner menyetujui ulang pengajuan setelah dana masuk.';

  @override
  String get icLoanBorrower => 'PT peminjam';

  @override
  String get icLoanLender => 'PT pemberi';

  @override
  String icLoanAvailable(String amount) {
    return 'Dana tersedia $amount';
  }

  @override
  String get icLoanBorrowerNoAccount =>
      'PT peminjam belum menetapkan rekening penerimaan antar-PT — pinjaman tidak dapat diterima.';

  @override
  String get icLoanNoLenders => 'Tidak ada PT lain di mana Anda Owner.';

  @override
  String get icLoanLenderShort => 'Dana tersedia tidak cukup untuk nilai ini';

  @override
  String get icLoanLenderNoAccount =>
      'Pengembalian belum dapat dicatat sampai PT ini menetapkan rekening penerimaan antar-PT.';

  @override
  String get icLoanAmount => 'Nilai pinjaman';

  @override
  String icLoanAmountGap(String amount) {
    return 'Default = kekurangan dana $amount';
  }

  @override
  String get icLoanAmountAbove => 'Di atas kekurangan dana — sisanya menambah dana tersedia PT peminjam.';

  @override
  String icLoanAmountBelow(String amount) {
    return 'Di bawah kekurangan dana — masih kurang $amount; pinjaman dari PT lain dapat menutupnya.';
  }

  @override
  String get icLoanDueDate => 'Jatuh tempo';

  @override
  String get icLoanDueHelp => 'Default 30 hari · tanpa bunga';

  @override
  String get icLoanReason => 'Alasan';

  @override
  String get icLoanRequests => 'Pengajuan terkait';

  @override
  String get icLoanRequestsNone => 'Tidak ada pengajuan yang menunggu persetujuan akhir di PT ini.';

  @override
  String icLoanCalcAll(String amount) {
    return 'Hitung untuk semua ($amount)';
  }

  @override
  String get icLoanSubmit => 'Perintahkan pinjaman';

  @override
  String get icLoanConfirmTitle => 'Perintahkan pinjaman antar-PT?';

  @override
  String icLoanConfirmBody(String lender, String amount, String borrower) {
    return 'PT $lender meminjamkan $amount ke PT $borrower. Nilai dicadangkan di PT pemberi sampai Finance-nya mencairkan.';
  }

  @override
  String icLoanInstructed(String docNo) {
    return 'Perintah pinjaman $docNo dikirim ke Finance PT pemberi.';
  }

  @override
  String icLoanFlow(String lender, String borrower) {
    return 'PT $lender → PT $borrower';
  }

  @override
  String get icLoanSideLender => 'Piutang antar-PT';

  @override
  String get icLoanSideBorrower => 'Hutang antar-PT';

  @override
  String get icLoanRepaid => 'Sudah kembali';

  @override
  String get icLoanOutstanding => 'Sisa pinjaman';

  @override
  String get icLoanInstructionDate => 'Tanggal perintah';

  @override
  String get icLoanNoInterest => 'tanpa bunga';

  @override
  String get icLoanCreatedBy => 'Diperintahkan oleh';

  @override
  String get icLoanG1Blocked => 'Anda yang memerintahkan pinjaman ini — pencairan harus dicatat Finance lain (G1).';

  @override
  String icLoanNoLenderAccount(String pt) {
    return 'PT $pt belum menetapkan rekening penerimaan antar-PT — pengembalian belum dapat dicatat.';
  }

  @override
  String icLoanCancelledBecause(String reason) {
    return 'Perintah dibatalkan: $reason';
  }

  @override
  String get icLoanMovements => 'Pencairan & pengembalian';

  @override
  String get icLoanMovementsEmpty => 'Belum dicairkan.';

  @override
  String get icLoanMovementVoid => 'Dibatalkan (void)';

  @override
  String icLoanMovementVoidReason(String reason) {
    return 'Dibatalkan (void): $reason';
  }

  @override
  String get icLoanWebOnlyHint =>
      'Pembatalan perintah, pengembalian dan void dicatat di web (Keuangan → Pinjaman antar-PT).';

  @override
  String get icLoanDisburse => 'Catat pencairan';

  @override
  String get icLoanDisburseTitle => 'Pencairan pinjaman antar-PT';

  @override
  String icLoanDisburseAmount(String amount, String lender, String borrower) {
    return 'Transfer $amount dari PT $lender ke rekening penerimaan antar-PT PT $borrower';
  }

  @override
  String get icLoanDisburseHelp =>
      'Nilai = nilai pinjaman (satu kali pencairan). KK di PT pemberi; kas masuk \"Antar PT\" di PT peminjam tercatat otomatis.';

  @override
  String get icLoanDestinationNone =>
      'PT peminjam belum menetapkan rekening penerimaan antar-PT — pencairan akan ditolak.';

  @override
  String get icLoanAccountHelp => 'Hanya akun kantor pusat (tanpa site).';

  @override
  String get icLoanNoAccounts => 'Tidak ada akun kas aktif tanpa site di PT pemberi.';

  @override
  String get icLoanNotInQueue => 'Pinjaman ini tidak (lagi) menunggu pencairan oleh Anda.';

  @override
  String icLoanDisbursed(String docNo, String kk, String km) {
    return 'Pencairan $docNo tercatat: $kk di PT pemberi, $km di PT peminjam.';
  }

  @override
  String icLoanDisbursedShort(String docNo) {
    return 'Pencairan $docNo tercatat.';
  }

  @override
  String icLoanQueueTitle(int count) {
    return 'Pencairan pinjaman antar-PT ($count)';
  }

  @override
  String get homeMenuTitle => 'Menu';

  @override
  String get homeMenuEmpty => 'Akun Anda belum punya akses ke modul mana pun. Hubungi Admin.';

  @override
  String get dashboardEmpty => 'Belum ada dashboard untuk peran Anda.';

  @override
  String menuComingSoon(String label) {
    return '$label segera hadir di APK. Sementara buka lewat web.';
  }

  @override
  String get menuComingSoonShort => 'Segera hadir di APK';

  @override
  String get profileQueueEmpty => 'Semua data sudah terkirim';

  @override
  String profileQueueCount(int count) {
    return '$count item belum terkirim';
  }

  @override
  String get accountTitle => 'Profil & tanda tangan';

  @override
  String get accountSubtitle => 'Data akun dan tanda tangan untuk pengajuan';

  @override
  String get accountName => 'Nama';

  @override
  String get accountEmail => 'Email';

  @override
  String get accountPhone => 'No. HP';

  @override
  String get accountDisplayName => 'Nama tampilan';

  @override
  String get accountAdminManaged => 'Nama, email, dan No. HP hanya dapat diubah oleh Admin.';

  @override
  String get accountSignature => 'Tanda tangan';

  @override
  String get accountSignatureHint =>
      'Dipakai otomatis saat mengirim atau menyetujui pengajuan. Gambar PNG berlatar putih/transparan.';

  @override
  String get accountSignatureNone => 'Belum ada tanda tangan profil.';

  @override
  String get accountSignatureDraw => 'Gambar';

  @override
  String get accountSignatureUpload => 'Pilih gambar';

  @override
  String get accountSignatureRemove => 'Hapus';

  @override
  String get accountSignatureRemoveConfirm =>
      'Hapus tanda tangan profil? Saat memutuskan pengajuan, Anda perlu menggambar tanda tangan di layar.';

  @override
  String get accountSignatureSaved => 'Tanda tangan disimpan.';

  @override
  String get accountSignatureRemoved => 'Tanda tangan dihapus.';

  @override
  String get accountSignatureDrawTitle => 'Gambar tanda tangan';

  @override
  String get accountSignatureNotPng => 'Gambar tidak dapat dibaca. Pilih file PNG atau JPG lain.';

  @override
  String get securityTitle => 'Keamanan akun';

  @override
  String get securityLead =>
      'Pengaturan ini hanya untuk akun Anda sendiri. 2FA bersifat pilihan: Anda yang memutuskan untuk mengaktifkan atau menonaktifkannya.';

  @override
  String get security2faTitle => 'Verifikasi dua langkah (2FA)';

  @override
  String get security2faActive => '2FA aktif';

  @override
  String get security2faInactive => '2FA nonaktif';

  @override
  String get security2faUnknown => 'Status tidak diketahui';

  @override
  String get security2faActiveText =>
      'Setiap login di web dan aplikasi Android meminta kode 6 digit dari aplikasi autentikator Anda setelah kata sandi.';

  @override
  String get security2faInactiveText =>
      'Dengan 2FA, login juga meminta kode 6 digit dari aplikasi autentikator di HP Anda — kata sandi yang bocor saja tidak cukup untuk masuk.';

  @override
  String get security2faUnknownText =>
      'Status 2FA tidak dapat diperiksa saat ini (server login tidak terjangkau). Anda tetap dapat mengaktifkan 2FA lewat web; menonaktifkan hanya bisa setelah status terbaca.';

  @override
  String get securityStep1 =>
      'Pasang aplikasi autentikator di HP (mis. Google Authenticator, Microsoft Authenticator, atau FreeOTP).';

  @override
  String get securityStep2 =>
      'Tekan Aktifkan 2FA. Halaman Keamanan akun di web terbuka di browser; login, lalu pindai kode QR.';

  @override
  String get securityStep3 =>
      'Masukkan kode 6 digit dari aplikasi dan beri nama perangkat, lalu kembali ke aplikasi ini.';

  @override
  String get securityEnable => 'Aktifkan 2FA';

  @override
  String get securityManage => 'Nonaktifkan / kelola di web';

  @override
  String get securityWebNote =>
      'Perubahan 2FA dilakukan di halaman web Keamanan akun (Anda diminta login ulang di browser). Status di sini diperbarui saat Anda kembali ke aplikasi.';

  @override
  String get securityAuthenticatorDefault => 'Aplikasi autentikator';

  @override
  String get securityTipsTitle => 'Perlu diketahui';

  @override
  String get securityTip1 =>
      'Aplikasi Android: bila 2FA aktif, isi kolom \"Kode autentikator\" yang muncul setelah login pertama gagal.';

  @override
  String get securityTip2 =>
      'HP hilang atau aplikasi autentikator terhapus? Hubungi Admin untuk mereset 2FA akun Anda.';

  @override
  String get securityTip3 => 'Setiap perubahan 2FA dicatat di audit log.';

  @override
  String securityRegisteredOn(String date) {
    return 'Didaftarkan $date';
  }

  @override
  String securityBrowserFailed(String url) {
    return 'Browser tidak dapat dibuka. Buka $url di browser HP.';
  }

  @override
  String get reasonLabel => 'Alasan';

  @override
  String get inactiveSuffix => '(nonaktif)';

  @override
  String get cashTitle => 'Buku kas';

  @override
  String get closingTitle => 'Tutup buku';

  @override
  String get cashIn => 'Kas masuk';

  @override
  String get cashOut => 'Kas keluar';

  @override
  String get cashInLower => 'kas masuk';

  @override
  String get cashOutLower => 'kas keluar';

  @override
  String cashLockOne(String text) {
    return 'tutup buku $text';
  }

  @override
  String get cashLockNone => 'belum ada';

  @override
  String cashLockUntil(String date) {
    return 's/d $date';
  }

  @override
  String cashAsOf(String date) {
    return 'Buku kas per $date (WITA)';
  }

  @override
  String cashIcReceiving(String text) {
    return 'Rekening penerimaan antar-PT: $text';
  }

  @override
  String get cashIcReceivingNone => 'belum ditetapkan (Master Data › Akun kas/bank)';

  @override
  String get cashReadOnly => 'Tampilan baca untuk Direktur. Pencatatan, edit dan void kas dilakukan oleh Finance.';

  @override
  String get cashReadOnlyMulti =>
      'Tampilan baca untuk Direktur. Pencatatan, edit dan void kas dilakukan oleh Finance PT tersebut.';

  @override
  String get cashSearchHint => 'Cari nomor atau keterangan';

  @override
  String cashBookSub(int count, String filtered) {
    return '$count transaksi$filtered · terbaru dulu · baris void tetap tampil, jurnal baliknya tertaut';
  }

  @override
  String get cashFiltered => ' (terfilter)';

  @override
  String get cashEmpty => 'Belum ada transaksi kas.';

  @override
  String get cashEmptyFiltered => 'Tidak ada transaksi untuk filter ini.';

  @override
  String get cashClearFilter => 'Hapus filter';

  @override
  String cashShownOf(int shown, int total) {
    return '$shown dari $total transaksi';
  }

  @override
  String get cashTotal => 'Saldo kas total';

  @override
  String cashTotalSub(int count) {
    return '$count akun · saldo awal + masuk − keluar';
  }

  @override
  String cashFlows(String period, String tin, String tout) {
    return '$period: masuk $tin · keluar $tout';
  }

  @override
  String get cashFilterPt => 'PT';

  @override
  String get cashAllPts => 'Semua PT';

  @override
  String get cashFilterAccount => 'Akun';

  @override
  String cashFilterAccounts(int count) {
    return '$count akun';
  }

  @override
  String get cashAllAccounts => 'Semua akun';

  @override
  String get cashFilterPeriod => 'Periode';

  @override
  String get cashAllPeriods => 'Semua periode';

  @override
  String get cashFilterSource => 'Sumber';

  @override
  String get cashAllSources => 'Semua sumber';

  @override
  String get cashStatusVoid => 'Void';

  @override
  String get cashStatusReversal => 'Jurnal balik';

  @override
  String get cashStatusPosted => 'Posted';

  @override
  String cashVoidReason(String reason) {
    return 'Void: $reason';
  }

  @override
  String cashReversedBy(String no) {
    return 'dibalik oleh $no';
  }

  @override
  String cashReversalOf(String no) {
    return 'Jurnal balik dari $no';
  }

  @override
  String cashRequestLink(String no) {
    return 'Pengajuan $no';
  }

  @override
  String cashVoidTitle(String no) {
    return 'Void $no?';
  }

  @override
  String cashVoidBody(String dir, String amount, String dated) {
    return 'Transaksi asli tetap tercatat dengan status Void, dan sistem membuat jurnal balik $dir $amount $dated. Saldo akun kembali seperti sebelum transaksi ini.';
  }

  @override
  String get cashVoidDatedToday => 'bertanggal hari ini (periode aslinya sudah ditutup)';

  @override
  String cashVoidDatedOn(String date) {
    return 'bertanggal $date';
  }

  @override
  String get cashVoidConfirm => 'Void transaksi';

  @override
  String cashVoided(String no) {
    return '$no di-void.';
  }

  @override
  String cashVoidedWith(String no, String reversal) {
    return '$no di-void · jurnal balik $reversal.';
  }

  @override
  String cashProofOf(String no) {
    return 'Bukti $no';
  }

  @override
  String get cashProofNotImage => 'Bukti ini bukan gambar (PDF). Buka di web untuk melihatnya.';

  @override
  String get cashPt => 'PT';

  @override
  String get cashDate => 'Tanggal';

  @override
  String get cashKind => 'Jenis transaksi';

  @override
  String get cashAmount => 'Nominal';

  @override
  String get cashSourceIn => 'Sumber kas masuk';

  @override
  String get cashCategory => 'Kategori biaya';

  @override
  String get cashProject => 'Project';

  @override
  String get cashCostCenter => 'Pusat biaya';

  @override
  String get cashVehicle => 'Kendaraan';

  @override
  String get cashDescription => 'Keterangan';

  @override
  String get cashSource => 'Sumber';

  @override
  String get cashProof => 'Bukti';

  @override
  String get cashEdit => 'Edit';

  @override
  String get cashVoid => 'Void';

  @override
  String get cashNewTitle => 'Catat kas masuk / keluar';

  @override
  String get cashNoWrite => 'Pencatatan kas hanya oleh Finance PT ini.';

  @override
  String get cashPickPt =>
      'Anda Finance di beberapa PT. Pilih PT transaksi ini — akun, project, pusat biaya dan kategori mengikuti PT tersebut.';

  @override
  String get cashEntryNotFound => 'Transaksi tidak ditemukan. Buka Edit dari Buku kas.';

  @override
  String cashEditTitle(String no) {
    return 'Edit $no';
  }

  @override
  String get cashNotEditableVoid => 'Transaksi sudah di-void.';

  @override
  String get cashNotEditableSource => 'Hanya transaksi kas manual yang dapat diedit.';

  @override
  String cashNotEditableClosed(String date) {
    return 'Periode transaksi sudah ditutup (tutup buku s/d $date). Koreksi dengan Void — jurnal balik dicatat di periode berjalan.';
  }

  @override
  String get cashCheckFields => 'Periksa isian yang ditandai.';

  @override
  String get cashNoChanges => 'Tidak ada perubahan untuk disimpan.';

  @override
  String cashSaved(String no, String dir, String amount) {
    return '$no tersimpan · $dir $amount.';
  }

  @override
  String cashUpdated(String no) {
    return '$no diperbarui.';
  }

  @override
  String get cashOverdraftCancelled =>
      'Belum disimpan — saldo akun akan minus. Periksa nominal atau akun, lalu simpan lagi.';

  @override
  String get cashEditNote =>
      'Keterangan, sumber/kategori, pembebanan, kendaraan dan bukti. Tanggal, akun dan nominal terkunci. Alasan wajib.';

  @override
  String get cashNewNote => 'Nomor KM/KK diberikan otomatis saat disimpan. Saldo akun langsung berubah.';

  @override
  String get cashDateNoLock => 'Belum ada periode yang ditutup.';

  @override
  String cashDateLock(String date) {
    return 'Tutup buku s/d $date: tanggal sebelumnya ditolak.';
  }

  @override
  String cashDateOpening(String date) {
    return 'Saldo awal akun per $date: tanggal sebelumnya ditolak.';
  }

  @override
  String get cashDateNoFuture => 'Tidak boleh di masa depan.';

  @override
  String get cashLockedHelp => 'Tanggal, akun dan nominal terkunci — koreksi dengan Void lalu catat ulang.';

  @override
  String get cashAmountHelp => 'Rupiah tanpa desimal; titik sebagai pemisah ribuan';

  @override
  String get cashScope => 'Dibebankan ke';

  @override
  String get cashScopeNone => 'Tidak ada';

  @override
  String get cashScopeHelp =>
      'Pusat biaya = akun kas yang dipilih. Pilih project bila biaya ini milik project tertentu.';

  @override
  String get cashVehicleOptional => 'Kendaraan (opsional)';

  @override
  String get cashVehicleNone => '— tanpa kendaraan —';

  @override
  String get cashVehicleHint => 'Kategori ini biasanya dicatat per kendaraan.';

  @override
  String get cashProofReplace => 'Ganti bukti (opsional)';

  @override
  String get cashProofOptional => 'Bukti (opsional)';

  @override
  String get cashProofCurrent => 'Lihat bukti saat ini';

  @override
  String get cashProofHelp => 'Foto bukti dari kamera atau galeri, diperkecil otomatis. Bukti PDF diunggah lewat web.';

  @override
  String get cashReason => 'Alasan perubahan';

  @override
  String get cashReasonHelp => 'Tercatat di audit log bersama nilai lama dan baru.';

  @override
  String get cashRulesTitle => 'Aturan';

  @override
  String get cashRule1 => 'Kas masuk wajib sumber; kas keluar wajib kategori.';

  @override
  String get cashRule2 => 'Pusat biaya = akun kas transaksi; pilih project bila biayanya milik project tertentu.';

  @override
  String get cashRule3 => 'Tanggal tidak boleh di masa depan atau di periode yang sudah ditutup.';

  @override
  String cashRule3Lock(String date) {
    return 'Tanggal tidak boleh di masa depan atau di periode yang sudah ditutup (s/d $date).';
  }

  @override
  String get cashRule4 => 'Setelah tersimpan, nominal/tanggal/akun tidak bisa diedit — gunakan Void lalu catat ulang.';

  @override
  String get cashSaving => 'Menyimpan…';

  @override
  String get cashSaveChanges => 'Simpan perubahan';

  @override
  String get cashSaveIn => 'Simpan kas masuk';

  @override
  String get cashSaveOut => 'Simpan kas keluar';

  @override
  String closingCloseTitle(String period, String pt) {
    return 'Tutup buku $period$pt?';
  }

  @override
  String closingCloseBody(String date) {
    return 'Semua transaksi kas dan transfer bertanggal s/d $date dikunci: tidak dapat dicatat, diedit, atau di-void dengan tanggal itu. Koreksi setelahnya dicatat sebagai jurnal balik di periode berjalan. Membuka kembali hanya oleh Direktur.';
  }

  @override
  String closingOnlyPt(String name) {
    return 'Hanya PT $name yang dikunci.';
  }

  @override
  String get closingNote => 'Catatan (opsional)';

  @override
  String closingClosed(String period) {
    return '$period ditutup.';
  }

  @override
  String closingReopenTitle(String period, String pt) {
    return 'Buka kembali $period$pt?';
  }

  @override
  String get closingReopenBody =>
      'Periode ini dapat diposting dan dikoreksi lagi sampai ditutup kembali. Alasan wajib dan tercatat di audit log.';

  @override
  String get closingReopen => 'Buka kembali';

  @override
  String closingReopened(String period) {
    return '$period dibuka kembali.';
  }

  @override
  String get closingPickPt =>
      'Tutup buku dilakukan per PT: menutup satu PT tidak mengunci PT lain. Pilih PT yang akan dikelola.';

  @override
  String closingLockedUntil(String date) {
    return 'Terkunci s/d $date';
  }

  @override
  String get closingNoLock => 'belum ada';

  @override
  String get closingNoLockShort => 'Belum ada';

  @override
  String get closingLead =>
      'Tutup bulan yang sudah lewat. Buka kembali hanya oleh Direktur, untuk periode tertutup terakhir, dengan alasan.';

  @override
  String get closingKpiLock => 'Terkunci s/d';

  @override
  String get closingKpiLockSub => 'Posting bertanggal ≤ tanggal ini ditolak.';

  @override
  String get closingKpiLast => 'Periode tertutup terakhir';

  @override
  String closingKpiLastSub(int count) {
    return '$count kali tutup/buka tercatat';
  }

  @override
  String get closingKpiClosable => 'Bulan siap ditutup';

  @override
  String get closingKpiClosableNone => 'Tidak ada — bulan berjalan belum bisa ditutup.';

  @override
  String get closingPerMonth => 'Per bulan';

  @override
  String get closingPerMonthSub1 => '13 bulan terakhir';

  @override
  String closingBooksStart(String date) {
    return 'sejak buku kas dimulai ($date).';
  }

  @override
  String get closingPerMonthSub2 => 'Masuk/Keluar tanpa pasangan void; koreksi void terpisah.';

  @override
  String get closingNoData => 'Belum ada data.';

  @override
  String get closingHistory => 'Riwayat';

  @override
  String get closingHistorySub => 'Tutup & buka kembali';

  @override
  String get closingHistoryEmpty => 'Belum pernah tutup buku.';

  @override
  String get closingStateClosed => 'Ditutup';

  @override
  String get closingStateReopened => 'Dibuka kembali';

  @override
  String get closingStateLocked => 'Terkunci';

  @override
  String get closingStateCurrent => 'Berjalan';

  @override
  String get closingStateOpen => 'Terbuka';

  @override
  String closingNoteText(String note) {
    return 'Catatan: $note';
  }

  @override
  String closingReopenedBy(String name, String at, String reason) {
    return 'Dibuka $name · $at — $reason';
  }

  @override
  String closingCount(int count, String voids) {
    return '$count transaksi$voids';
  }

  @override
  String closingVoids(int count) {
    return ' ($count void)';
  }

  @override
  String closingFigures(String tin, String tout, String net) {
    return 'Masuk $tin · Keluar $tout · Bersih $net';
  }

  @override
  String closingKoreksi(String amount, int count) {
    return 'Koreksi (void): $amount ($count baris)';
  }

  @override
  String get closingReopenDirektur => 'Buka kembali: Direktur';

  @override
  String get voidTransferTab => 'Transfer tercatat';

  @override
  String voidTransferTitle(String no) {
    return 'Void transfer $no?';
  }

  @override
  String voidTransferBody(String request, String back) {
    return 'KK transfer ini dibalik dengan jurnal balik (saldo akun kembali), transfer ditandai Void, dan pengajuan $request kembali ke $back untuk ditransfer ulang.';
  }

  @override
  String get voidTransferBackAdvance => 'Disetujui (Antri Transfer)';

  @override
  String get voidTransferBackReimburse => 'Nota Terverifikasi (Antri Transfer)';

  @override
  String get voidTransfer => 'Void transfer';

  @override
  String voidTransferDone(String no) {
    return 'Transfer $no di-void. Pengajuan kembali ke Antrian Transfer.';
  }

  @override
  String get voidTransferSearchHint => 'Cari nomor transfer atau pengajuan';

  @override
  String voidTransferLead(int count) {
    return 'Transfer tercatat — dapat dibatalkan ($count)';
  }

  @override
  String get voidTransferNote =>
      'Void transfer membuat jurnal balik untuk KK-nya (KK asli tetap tampil sebagai Void) dan mengembalikan pengajuan ke antrian: Pengajuan Baru → Disetujui, Reimburse → Nota Terverifikasi.';

  @override
  String get voidTransferEmpty => 'Tidak ada transfer yang bisa dibatalkan.';

  @override
  String get voidTransferFinanceOnly => 'Void: Finance PT ini';

  @override
  String get loanListTitle => 'Pinjaman antar project';

  @override
  String get loanListNote =>
      'Diajukan PM project peminjam · disetujui Direktur · dana antar pusat biaya berbeda dicairkan Finance (kas keluar/masuk) · otomatis bila transfer dibayar dari akun lain';

  @override
  String get loanKpiPending => 'Menunggu persetujuan';

  @override
  String get loanKpiPendingNone => 'Tidak ada yang menunggu Anda ✓';

  @override
  String loanKpiPendingMine(int count) {
    return '$count menunggu keputusan Anda';
  }

  @override
  String loanKpiOutstandingSub(String amount, String repaid) {
    return 'Disetujui $amount · kembali $repaid';
  }

  @override
  String get loanOverdueOnly => 'Terlambat';

  @override
  String get loanKpiOverdueNone => 'Tidak ada yang terlambat ✓';

  @override
  String loanKpiOverdueSum(String amount) {
    return 'Sisa terlambat $amount';
  }

  @override
  String loanWaitingMine(int count) {
    return 'Menunggu saya ($count)';
  }

  @override
  String get loanListSearchHint => 'Nomor atau alasan…';

  @override
  String get loanFilterBorrower => 'Peminjam';

  @override
  String get loanFilterLender => 'Pemberi';

  @override
  String get loanListEmpty => 'Belum ada pinjaman antar project.';

  @override
  String get loanListEmptyFiltered => 'Tidak ada pinjaman untuk filter ini.';

  @override
  String get icLoanListTitle => 'Pinjaman antar-PT';

  @override
  String get icLoanListNote =>
      'Diperintahkan Owner · dicairkan Finance PT pemberi · dikembalikan Finance PT peminjam · uang nyata antar PT grup (KK + KM otomatis), tanpa bunga';

  @override
  String get icLoanKpiReceivable => 'Piutang antar-PT (sisa)';

  @override
  String get icLoanKpiPayable => 'Hutang antar-PT (sisa)';

  @override
  String get icLoanKpiOverdueSub => 'Sisa yang lewat jatuh tempo';

  @override
  String icLoanQueueWaiting(int count) {
    return 'Menunggu pencairan Anda ($count)';
  }

  @override
  String get icLoanListSearchHint => 'Nomor, alasan, kode PT…';

  @override
  String get icLoanListEmpty => 'Belum ada pinjaman antar-PT.';

  @override
  String get icLoanListEmptyFiltered => 'Tidak ada pinjaman untuk filter ini.';

  @override
  String icLoanCardFigures(String amount, String outstanding) {
    return '$amount · sisa $outstanding';
  }

  @override
  String get loanRepay => 'Catat pengembalian';

  @override
  String loanRepayTitle(String title) {
    return 'Catat pengembalian $title';
  }

  @override
  String loanRepayOutstanding(String amount) {
    return 'Sisa pinjaman $amount';
  }

  @override
  String get loanRepayDate => 'Tanggal pengembalian';

  @override
  String get loanRepayNote => 'Catatan';

  @override
  String get loanRepaySave => 'Simpan pengembalian';

  @override
  String loanRepayDone(String amount) {
    return 'Pengembalian $amount tercatat.';
  }

  @override
  String loanRepaymentVoidTitle(int seq) {
    return 'Void pengembalian ke-$seq?';
  }

  @override
  String loanRepaymentVoidBody(String amount) {
    return 'Pengembalian $amount dibatalkan (tidak dihapus); sisa pinjaman bertambah lagi. Alasan wajib.';
  }

  @override
  String get loanRepaymentVoidConfirm => 'Void pengembalian';

  @override
  String get loanRepaymentVoided => 'Pengembalian di-void.';

  @override
  String get icLoanCancelWebHint => 'Pembatalan perintah pinjaman dilakukan di web (Keuangan → Pinjaman antar-PT).';

  @override
  String icLoanVoidDisbursementTitle(String no) {
    return 'Void pencairan $no?';
  }

  @override
  String icLoanVoidDisbursementBody(String lender, String borrower) {
    return 'KK di PT $lender dan KM di PT $borrower dibalik (jurnal balik), pinjaman kembali menunggu pencairan. Pengajuan yang sudah disetujui tetap disetujui. Untuk pengembalian dana pakai Catat pengembalian, bukan void.';
  }

  @override
  String get icLoanVoidDisbursement => 'Void pencairan';

  @override
  String icLoanVoidRepaymentTitle(String label) {
    return 'Void $label?';
  }

  @override
  String icLoanVoidRepaymentBody(String borrower, String lender) {
    return 'KK di PT $borrower dan KM di PT $lender dibalik; sisa pinjaman bertambah lagi.';
  }

  @override
  String icLoanVoidShortfallConfirm(String borrower) {
    return 'Saya mengerti dana tersedia PT $borrower bisa menjadi minus (dana sudah terpakai / dijanjikan).';
  }

  @override
  String get icLoanVoidedDisbursement => 'Pencairan di-void. Pinjaman kembali menunggu pencairan.';

  @override
  String get icLoanRepayTitle => 'Catat pengembalian';

  @override
  String get icLoanNotRepayable => 'Pengembalian pinjaman ini dicatat oleh Finance PT peminjam.';

  @override
  String icLoanRepayAmount(String amount, String borrower, String lender) {
    return 'Sisa $amount · PT $borrower → PT $lender';
  }

  @override
  String get icLoanRepayHelp =>
      'Dibayar dari akun PT peminjam ke rekening penerimaan antar-PT PT pemberi; KK dan KM dicatat otomatis.';

  @override
  String icLoanRepayDone(String no, String amount) {
    return '$no: pengembalian $amount tercatat.';
  }

  @override
  String get recordsTitle => 'Data';

  @override
  String recordsCount(int count) {
    return '$count data · terbaru dulu';
  }

  @override
  String get recordsEmpty => 'Belum ada data.';

  @override
  String get recordsEmptySearch => 'Tidak ada data untuk pencarian ini.';

  @override
  String recordsShownOf(int shown, int total) {
    return '$shown dari $total data';
  }

  @override
  String get recordsReadOnly => 'Tampilan baca. Data ini diubah lewat alurnya masing-masing (atau di web).';

  @override
  String get reportsTitle => 'Laporan';

  @override
  String get reportsNone => 'Laporan kantor tidak tersedia untuk peran Anda.';

  @override
  String reportsExportLine(String formats) {
    return 'Export: $formats';
  }

  @override
  String get reportsFilter => 'Filter';

  @override
  String get reportsApply => 'Terapkan';

  @override
  String get reportsReset => 'Reset';

  @override
  String get reportsAll => 'Semua';

  @override
  String reportsTooBig(String format) {
    return '$format (terlalu banyak baris)';
  }

  @override
  String reportsRowCount(int count) {
    return '$count baris';
  }

  @override
  String get reportsTeamScope => 'cakupan tim saya';

  @override
  String get reportsFirstPage => '« Halaman pertama';

  @override
  String get reportsNextPage => 'Berikutnya ›';

  @override
  String get reportsEmpty => 'Tidak ada data untuk filter ini.';

  @override
  String get reportsTotal => 'Total';

  @override
  String reportsDownloaded(String name) {
    return '$name sudah diunduh.';
  }

  @override
  String get reportsOpen => 'Buka';

  @override
  String get reportsShare => 'Bagikan';

  @override
  String get reportsSaveDownloads => 'Simpan ke folder Unduhan';

  @override
  String get reportsSavedDownloads => 'Tersimpan di Unduhan/ProyekKas.';

  @override
  String get reportsSaveDownloadsFailed => 'Tidak dapat menyimpan ke Unduhan (Android 10 ke atas). Pakai Bagikan.';

  @override
  String get reportsSaveFailed => 'File tidak dapat disimpan di HP.';

  @override
  String get reportsNoApp => 'Tidak ada aplikasi di HP yang dapat membuka file ini.';

  @override
  String get recordAdd => 'Tambah';

  @override
  String get recordEdit => 'Ubah';

  @override
  String get recordDelete => 'Hapus';

  @override
  String recordNewTitle(String label) {
    return '$label baru';
  }

  @override
  String recordEditTitle(String label) {
    return 'Ubah $label';
  }

  @override
  String get recordNoRight => 'Anda tidak berhak mengubah data ini.';

  @override
  String get recordWebOnly => 'Data ini memiliki isian yang hanya dapat diubah di web.';

  @override
  String get recordCheckFields => 'Periksa isian yang ditandai.';

  @override
  String get recordNoChanges => 'Tidak ada perubahan untuk disimpan.';

  @override
  String recordSaved(String title) {
    return '$title tersimpan.';
  }

  @override
  String get recordNone => '— tidak ada —';

  @override
  String get recordPick => 'Pilih…';

  @override
  String recordPickDone(int count) {
    return 'Pilih ($count)';
  }

  @override
  String get recordDeleteTitle => 'Hapus data ini?';

  @override
  String get recordDeleteBody =>
      'Data dihapus (soft delete) dan tidak tampil lagi di daftar; Admin dapat memulihkannya. Alasan wajib dan tercatat di audit log.';

  @override
  String get recordDeleted => 'Data dihapus.';

  @override
  String get recordDeactivateTitle => 'Data masih dipakai — nonaktifkan?';

  @override
  String get recordDeactivate => 'Nonaktifkan';

  @override
  String get recordDeactivated => 'Data dinonaktifkan.';

  @override
  String get rapManageTitle => 'Kelola RAP';

  @override
  String get rapImport => 'Impor Excel';

  @override
  String get rapImportTooLarge => 'File RAP maksimal 2 MB (.xlsx).';

  @override
  String get rapImported => 'RAP diperbarui dari file Excel.';

  @override
  String get rapImportCommit => 'Terapkan file';

  @override
  String get rapDownloadTemplate => 'Unduh template (.xlsx)';

  @override
  String get rapDownloadRap => 'Unduh RAP (.xlsx)';

  @override
  String get rapApplyTemplate => 'Terapkan template RAP';

  @override
  String get rapApplyTemplateHint => 'Item template disalin ke RAP proyek ini (hanya untuk RAP yang masih kosong).';

  @override
  String get rapNoTemplates => 'Belum ada template RAP.';

  @override
  String get rapTemplateApplied => 'Template diterapkan.';

  @override
  String get rapSaveTemplate => 'Simpan sebagai template';

  @override
  String get rapSaveTemplateHint => 'Item RAP proyek ini disimpan sebagai template baru (tanpa realisasi).';

  @override
  String get rapTemplateName => 'Nama template';

  @override
  String rapTemplateSaved(String name) {
    return 'Template $name tersimpan.';
  }

  @override
  String get rapAddItem => 'Tambah item';

  @override
  String rapEditItem(String code) {
    return 'Ubah item $code';
  }

  @override
  String rapItemSaved(String code) {
    return 'Item $code tersimpan.';
  }

  @override
  String get rapLockedDirektur =>
      'RAP terkunci (sudah ada realisasi laporan harian). Perubahan oleh Direktur/Admin wajib dengan alasan.';

  @override
  String get rapLockedPm => 'RAP terkunci (sudah ada realisasi laporan harian). Perubahan hanya oleh Direktur/Admin.';

  @override
  String get rapReadOnly => 'Tampilan baca. RAP diubah oleh PM proyek atau Direktur.';

  @override
  String rapValueLine(String value) {
    return 'Nilai RAP $value';
  }

  @override
  String rapValueVsBudget(String value, String budget) {
    return 'Nilai RAP $value · RAB $budget';
  }

  @override
  String get rapKindWork => 'Pekerjaan';

  @override
  String get rapKindMaterial => 'Material';

  @override
  String rapWeight(String pct) {
    return 'bobot $pct%';
  }

  @override
  String get rapInUse => 'Sudah terpakai — perubahan wajib alasan';

  @override
  String get rapCode => 'Kode';

  @override
  String get rapDescription => 'Uraian';

  @override
  String get rapStage => 'Tahapan';

  @override
  String get rapUom => 'Satuan';

  @override
  String get rapVolume => 'Volume';

  @override
  String get rapUnitPrice => 'Harga satuan';

  @override
  String get rapWeightLabel => 'Bobot';

  @override
  String get rapActive => 'Aktif';

  @override
  String get rapActiveHint => 'Item tidak pernah dihapus — nonaktifkan bila tidak dipakai lagi.';

  @override
  String get rapReason => 'Alasan perubahan';

  @override
  String get rapReasonLocked => 'Wajib: RAP terkunci. Tercatat di audit log.';

  @override
  String get rapReasonUsed => 'Wajib: item sudah terpakai. Tercatat di audit log.';

  @override
  String rapPreviewTitle(String file) {
    return 'Pratinjau $file';
  }

  @override
  String rapPreviewCounts(int n, int c, int u, int d) {
    return 'Baru $n, berubah $c, tetap $u, dinonaktifkan $d.';
  }

  @override
  String rapPreviewNewStages(String names) {
    return 'Tahapan baru: $names';
  }

  @override
  String rapPreviewUsed(String codes) {
    return 'Item terpakai yang berubah: $codes (alasan wajib).';
  }

  @override
  String get rapPreviewIssues => 'File belum dapat diterapkan — perbaiki baris berikut:';

  @override
  String get clientNewTitle => 'Klien baru';

  @override
  String get clientName => 'Nama';

  @override
  String get clientAddress => 'Alamat';

  @override
  String get clientNameRequired => 'Nama wajib diisi.';

  @override
  String get clientPtRequired => 'PT wajib dipilih.';

  @override
  String get clientContacts => 'Kontak PIC';

  @override
  String get clientContact => 'Kontak PIC';

  @override
  String get clientNoContacts => 'Belum ada kontak PIC.';

  @override
  String get clientPrimary => 'Utama';

  @override
  String get clientPosition => 'Jabatan';

  @override
  String get clientNotes => 'Catatan';

  @override
  String get clientProjects => 'Proyek klien ini';

  @override
  String get contractsTitle => 'Unit & kontrak';

  @override
  String get contractsEmpty => 'Belum ada proyek kontrak unit.';

  @override
  String contractsToday(int filled, int active) {
    return 'Hari ini: $filled dari $active unit sudah diisi';
  }

  @override
  String contractsMonth(String work, int missing) {
    return 'Bulan ini: jam kerja $work · belum diisi $missing';
  }

  @override
  String contractsGaps(int count) {
    return 'Selisih HM: $count';
  }

  @override
  String get contractsFillTimesheet => 'Isi timesheet';

  @override
  String get contractsUnits => 'Unit alat berat';

  @override
  String get onbTitle => 'Pengguna';

  @override
  String get onbNewTitle => 'Pengguna baru';

  @override
  String get onbLead => 'Akun login, akses per PT, data karyawan dan rekening — disimpan sekaligus.';

  @override
  String get onbAccount => 'Akun';

  @override
  String get onbAccess => 'Akses per PT';

  @override
  String get onbEmailInvalid => 'Email tidak valid.';

  @override
  String get onbPickPt => 'Pilih minimal satu PT dan peran.';

  @override
  String get onbIdentityReadOnly =>
      'Akun ini juga milik PT yang tidak Anda kelola — nama, email dan No. HP hanya dapat diubah oleh Admin PT tersebut.';

  @override
  String get onbActiveHint => 'Nonaktif = login diblokir, sesi dan perangkat dicabut (alasan wajib).';

  @override
  String get onbReasonHint =>
      'Wajib bila menonaktifkan akun / karyawan / rekening, mengubah rekening, atau peran / tanggal akhir penugasan.';

  @override
  String get onbMembershipInactive => 'Tanpa peran: akses PT ini dinonaktifkan (riwayat tetap).';

  @override
  String get onbNoEmployee => 'Belum terhubung ke karyawan.';

  @override
  String get onbEmployee => 'Karyawan';

  @override
  String get onbEmployeeExisting => 'Karyawan yang ada';

  @override
  String get onbEmployeeNew => '— karyawan baru —';

  @override
  String get onbEmployeeCode => 'Kode karyawan';

  @override
  String get onbEmployeeRequired => 'Kode dan nama karyawan baru wajib diisi.';

  @override
  String get onbOnsite => 'Onsite';

  @override
  String get onbNonOnsite => 'Non-onsite';

  @override
  String get onbBankAccounts => 'Rekening';

  @override
  String get onbAddBank => 'Tambah rekening';

  @override
  String get onbBank => 'Bank';

  @override
  String get onbAccountNo => 'Nomor rekening';

  @override
  String get onbAccountHolder => 'Atas nama';

  @override
  String get onbBankInvalid => 'Bank, nomor rekening (5–34 digit) dan atas nama wajib diisi.';

  @override
  String get onbDefault => 'Utama';

  @override
  String get onbVerified => 'Terverifikasi';

  @override
  String get onbAssignments => 'Penugasan tim';

  @override
  String get onbAddAssignment => 'Tambah penugasan';

  @override
  String get onbSite => 'Site';

  @override
  String get onbLocation => 'Lokasi';

  @override
  String get onbLocationRequired => 'Lokasi wajib dipilih.';

  @override
  String get onbTempPasswordTitle => 'Kata sandi sementara';

  @override
  String get onbTempPasswordBody =>
      'Berikan kepada pengguna. Kata sandi ini hanya ditampilkan sekali; saat login pertama pengguna wajib menggantinya.';

  @override
  String get onbCopy => 'Salin';

  @override
  String get onbDone => 'Selesai';

  @override
  String get onbLinked => 'Akun login dengan email ini sudah ada dan dihubungkan (kata sandinya tidak berubah).';

  @override
  String get recordRevokeDevice => 'Cabut perangkat';

  @override
  String get recordRevokeBody =>
      'Perangkat ini keluar dari akun dan harus login ulang; antrian yang belum terkirim di HP tersebut tidak dapat dikirim lagi. Alasan wajib dan tercatat di audit log.';

  @override
  String get recordRevoke => 'Cabut';

  @override
  String get recordRevoked => 'Perangkat dicabut.';

  @override
  String get scheduleTitle => 'Jadwal & hari libur';

  @override
  String get scheduleLeadWrite =>
      'Jadwal kerja, hari libur, lokasi absen (geofence) dan jadwal per karyawan. Ketuk untuk mengubah.';

  @override
  String get scheduleLeadRead => 'Tampilan baca. Perubahan oleh Admin atau Direktur.';

  @override
  String get scheduleWork => 'Jadwal kerja';

  @override
  String get scheduleDefault => 'default PT';

  @override
  String get scheduleMakeDefault => 'Jadikan default';

  @override
  String get scheduleDefaultSet => 'Jadwal default PT diperbarui.';

  @override
  String scheduleTolerance(int min) {
    return 'toleransi $min mnt';
  }

  @override
  String scheduleUsed(int count) {
    return '$count karyawan';
  }

  @override
  String get scheduleNone => '—';

  @override
  String scheduleHolidays(int year) {
    return 'Hari libur $year';
  }

  @override
  String get scheduleNoHolidays => 'Belum ada hari libur tahun ini.';

  @override
  String get scheduleGeofence => 'Lokasi absen (geofence)';

  @override
  String scheduleGeofenceHint(int m) {
    return 'Titik dan radius per pusat biaya; tanpa radius dipakai default $m m.';
  }

  @override
  String get scheduleNoLocation => 'Lokasi belum diatur';

  @override
  String scheduleRadius(int m) {
    return 'radius $m m';
  }

  @override
  String get scheduleOpenMap => 'Buka di peta';

  @override
  String get scheduleEmployees => 'Jadwal per karyawan';

  @override
  String get scheduleUseDefault => 'Pakai jadwal default PT';

  @override
  String get scheduleAssigned => 'Jadwal karyawan diperbarui.';

  @override
  String get matrixTitle => 'Akses PT (matriks)';

  @override
  String get matrixShowInactive => 'Tampilkan akun nonaktif';

  @override
  String get matrixNoEmployee => '— tanpa karyawan —';

  @override
  String get matrixDuplicateEmployee => 'Satu karyawan terhubung ke dua akun di PT yang sama. Pilih karyawan lain.';

  @override
  String matrixSaveN(int count) {
    return 'Simpan ($count)';
  }

  @override
  String matrixSaveTitle(int count) {
    return 'Simpan $count perubahan akses?';
  }

  @override
  String get matrixSaveBody =>
      'Semua perubahan disimpan sekaligus (gagal satu = tidak ada yang tersimpan). Alasan tercatat di audit log.';

  @override
  String matrixSaved(int count) {
    return '$count perubahan akses tersimpan.';
  }

  @override
  String get vendorNewTitle => 'Vendor baru';

  @override
  String get vendorReasonHint => 'Wajib bila menonaktifkan vendor atau rekening, atau mengubah rekening.';

  @override
  String get recordFile => 'Buka file';

  @override
  String get settingsAppTitle => 'Setting aplikasi';

  @override
  String get reportsAuditLog => 'Audit Log';

  @override
  String get directPaymentNoProjectHint =>
      'Tanpa project: tanpa pusat biaya — Finance memilih akun pembayar saat transfer.';

  @override
  String get costCenterLegacyLabel => 'Pusat biaya lama';

  @override
  String costCenterLegacyValue(String name) {
    return 'Pusat biaya lama: $name';
  }

  @override
  String get pusatBiayaUnmapped => 'Project belum dipetakan ke pusat biaya (akun kas)';

  @override
  String get pusatBiayaQueueMissing => 'project belum dipetakan';

  @override
  String get paidFromAccountLabel => 'Dibayar dari akun';

  @override
  String paidFromAccountLoan(String account, String loan) {
    return '$account (pinjaman $loan)';
  }

  @override
  String transferPaidFrom(String account) {
    return 'Dibayar dari $account';
  }

  @override
  String transferProjectLoan(String no) {
    return 'Pinjaman antar project $no';
  }

  @override
  String get transferPusatBiayaSuffix => ' (pusat biaya project)';

  @override
  String transferPusatBiayaHelp(String name) {
    return 'Pusat biaya project: $name.';
  }

  @override
  String get transferPusatBiayaMissingHelp =>
      'Project belum punya pusat biaya (akun kas) — transfer ditolak sampai dipetakan di data project.';

  @override
  String get transferLoanReasonLabel => 'Alasan membayar dari akun lain';

  @override
  String get transferLoanReasonHint => 'mis. saldo pusat biaya project belum cukup';

  @override
  String transferLoanNote(String pusatBiaya) {
    return 'Akun ini bukan pusat biaya project ($pusatBiaya). Akan tercatat otomatis pinjaman antar project: kas keluar dari akun pembayar dan kas masuk ke pusat biaya project.';
  }

  @override
  String get transferLoanDueLabel => 'Jatuh tempo pinjaman';

  @override
  String get transferLoanDueHelp => 'Kosong = 30 hari setelah tanggal transfer.';

  @override
  String get transferLoanDueDefault => '30 hari setelah tanggal transfer';

  @override
  String transferRecordedLoan(String trf, String loan) {
    return 'Transfer $trf tercatat. Dibayar dari akun lain: pinjaman antar project $loan tercatat otomatis.';
  }

  @override
  String get loanDisburse => 'Cairkan';

  @override
  String loanDisburseTitle(String title) {
    return 'Cairkan $title?';
  }

  @override
  String loanDisburseBody(String amount, String lender, String borrower) {
    return 'Dicatat hari ini: kas keluar $amount dari $lender dan kas masuk ke $borrower. Pastikan dana sudah dipindahkan di bank.';
  }

  @override
  String loanDisbursed(String title, String kk, String km) {
    return '$title dicairkan: kas keluar $kk, kas masuk $km.';
  }

  @override
  String loanDisbursedShort(String title) {
    return '$title dicairkan.';
  }

  @override
  String get loanLenderAccount => 'Akun pemberi pinjaman';

  @override
  String get loanLenderPusatBiaya => 'Pusat biaya pemberi';

  @override
  String get loanBorrowerPusatBiaya => 'Pusat biaya peminjam';

  @override
  String get loanOrigin => 'Asal';

  @override
  String loanOriginTransfer(String origin, String no) {
    return '$origin · transfer $no';
  }

  @override
  String get loanCash => 'Kas';

  @override
  String loanCashDisbursed(String when, String kk, String km) {
    return 'Dicairkan $when · KK $kk · KM $km';
  }

  @override
  String get loanCashWaiting => 'Menunggu transfer Finance (Antrian Transfer)';

  @override
  String get loanCashCancelled => 'Dibatalkan (jurnal balik)';

  @override
  String get loanCashTbd => 'Ditentukan saat disetujui (dana → ditransfer Finance lewat Antrian Transfer)';

  @override
  String get loanCashNone => 'Tanpa transaksi kas (barang, atau pinjaman lama dengan pusat biaya sama)';

  @override
  String loanAwaitingDisbursement(String lender, String borrower) {
    return 'Disetujui — menunggu Finance mentransfer dana dari $lender ke $borrower lewat Antrian Transfer.';
  }

  @override
  String get loanStepDisburse => 'Transfer Finance';

  @override
  String get loanStepDisbursed => 'Dicairkan';

  @override
  String loanStepAutomatic(String no) {
    return 'Otomatis dari transfer $no';
  }

  @override
  String get loanStepRecorded => 'Dicatat & dicairkan';

  @override
  String get loanStepCancelled => 'Dibatalkan';

  @override
  String loanRepaymentCash(String kk, String km) {
    return 'KK $kk · KM $km';
  }

  @override
  String get kpiAdminPusatBiaya => 'Project tanpa pusat biaya';

  @override
  String get kpiCostCentersTeamEmpty => 'Project Anda belum dipetakan ke pusat biaya (akun kas).';

  @override
  String get sectionAttachments => 'Lampiran';

  @override
  String get attachmentsOptional => 'Lampiran (opsional)';

  @override
  String get attachmentsRequired => 'Lampiran (wajib untuk Reimburse)';

  @override
  String get attachmentsHint => 'Foto atau file JPG / PNG / PDF (PDF maks. 5 MB), maks. 20 lampiran.';

  @override
  String get attachmentFile => 'File';

  @override
  String get attachmentLocal => 'Di HP — terkirim saat sinkron / Ajukan';

  @override
  String get attachmentOnServer => 'Tersimpan di server';

  @override
  String get attachmentRemove => 'Hapus lampiran';

  @override
  String attachmentsLimit(int count) {
    return 'Maksimal $count lampiran.';
  }

  @override
  String get attachmentTypeInvalid => 'Pilih file JPG, PNG atau PDF.';

  @override
  String get attachmentPdfTooLarge => 'File PDF lebih dari 5 MB. Perkecil file-nya atau lampirkan sebagai foto.';

  @override
  String get attachmentPdfInvalid => 'File PDF tidak valid.';

  @override
  String get attachmentTooLarge => 'File terlalu besar (maks. 15 MB).';

  @override
  String get loanStepOwner => 'Persetujuan Owner';

  @override
  String get loanStepSubmittedFinance => 'Diajukan Finance';

  @override
  String get loanOpenTransferQueue => 'Buka Antrian Transfer';

  @override
  String get loanRepayRequest => 'Ajukan pengembalian';

  @override
  String loanRepayRequestTitle(String title) {
    return 'Ajukan pengembalian $title';
  }

  @override
  String get loanRepayRequestHint =>
      'Disetujui Direktur lalu Owner, kemudian ditransfer Finance lewat Antrian Transfer (kas keluar dari pusat biaya peminjam, kas masuk ke pusat biaya pemberi).';

  @override
  String loanRepayable(String amount) {
    return 'Dapat diajukan $amount';
  }

  @override
  String get loanRepayPlannedDate => 'Rencana tanggal pengembalian';

  @override
  String loanRepayRequested(String amount) {
    return 'Pengembalian $amount diajukan ke Direktur.';
  }

  @override
  String loanRepayPlannedOn(String date) {
    return 'rencana $date';
  }

  @override
  String loanSubmittedBy(String name) {
    return 'diajukan $name';
  }

  @override
  String loanRepaymentExecutedBy(String name) {
    return 'ditransfer $name';
  }

  @override
  String loanRepaymentRejected(String reason) {
    return 'Ditolak: $reason';
  }

  @override
  String loanRepaymentCancelled(String reason) {
    return 'Dibatalkan: $reason';
  }

  @override
  String loanRepaymentApproveTitle(String amount) {
    return 'Setujui pengembalian $amount?';
  }

  @override
  String get loanRepaymentApproveBody =>
      'Setelah persetujuan Owner, Finance mentransfer dari pusat biaya peminjam ke pusat biaya pemberi lewat Antrian Transfer.';

  @override
  String loanRepaymentRejectTitle(String amount) {
    return 'Tolak pengembalian $amount?';
  }

  @override
  String loanRepaymentCancelTitle(String amount) {
    return 'Batalkan pengembalian $amount?';
  }

  @override
  String get loanRepaymentCancelBody => 'Pengajuan pengembalian dibatalkan (tidak dihapus). Alasan wajib.';

  @override
  String loanRepaymentInboxTitle(String no) {
    return 'Pengembalian pinjaman $no';
  }

  @override
  String loanTransferOrdersTitle(int count) {
    return 'Transfer pinjaman antar project ($count)';
  }

  @override
  String get loanTransferOrderSelf => 'Anda yang mengajukan; boleh dieksekusi sendiri (tercatat di audit).';

  @override
  String get loanTransferOrderExecute => 'Catat transfer';

  @override
  String loanTransferOrderExecuteTitle(String no) {
    return 'Catat transfer $no';
  }

  @override
  String loanTransferOrderExecuteBody(String amount, String from, String to) {
    return 'Kas keluar $amount dari $from dan kas masuk ke $to, masing-masing ditandai project-nya. Bukti transfer dapat dilampirkan di web.';
  }

  @override
  String get loanTransferOrderDate => 'Tanggal transfer';

  @override
  String loanTransferOrderDone(String no) {
    return 'Transfer $no tercatat.';
  }

  @override
  String confirmActionTitle(String action) {
    return 'Yakin ingin $action?';
  }

  @override
  String confirmActionYes(String action) {
    return 'Ya, $action';
  }

  @override
  String get resultOk => 'OK';

  @override
  String get resultSuccessTitle => 'Berhasil';

  @override
  String resultSuccessAction(String action) {
    return 'Berhasil: $action';
  }

  @override
  String get resultFailedTitle => 'Gagal';

  @override
  String resultFailedAction(String action) {
    return 'Gagal: $action';
  }

  @override
  String get resultQueuedTitle => 'Tersimpan di antrian';

  @override
  String get resultQueuedBody => 'Tersimpan di antrian, akan dikirim saat online.';

  @override
  String get actionReceiptsCompleteVerb => 'Tandai nota lengkap';

  @override
  String get receiptSaveAction => 'Simpan nota';

  @override
  String get correctionSaveAction => 'Simpan koreksi';

  @override
  String get scheduleAssignAction => 'Ubah jadwal karyawan';

  @override
  String get fieldDiscardAction => 'Hapus draft';

  @override
  String get progressDiscardAction => 'Hapus laporan';

  @override
  String get progressResendAction => 'Kirim versi HP';

  @override
  String get accountSignatureSaveAction => 'Simpan tanda tangan';

  @override
  String get accountSignatureRemoveAction => 'Hapus tanda tangan';

  @override
  String get actionDeleteDraft => 'Hapus draft';

  @override
  String get deleteDraftServerConfirm =>
      'Draft dihapus dari daftar dan tidak dapat dikirim lagi; nomor yang sudah terbit tidak dipakai ulang.';

  @override
  String get deleteDraftDone => 'Draft dihapus.';

  @override
  String get homeAccountsTitle => 'Kas & bank';

  @override
  String homeAccountsCount(int count) {
    return '$count rekening';
  }

  @override
  String homeTransferWaiting(int count) {
    return '$count menunggu transfer';
  }

  @override
  String get akunGroupAccount => 'Akun';

  @override
  String get akunGroupApp => 'Aplikasi';

  @override
  String get lpjActionRevision => 'Minta revisi';

  @override
  String get lpjVerifyNote =>
      'Total terverifikasi = jumlah nota valid. Nota yang masih menunggu harus diputuskan dulu (valid / tolak).';

  @override
  String get lpjRevisionNoteLabel => 'Catatan revisi untuk pemohon';

  @override
  String get lpjRevisionNoteHint => 'Wajib, minimal 3 karakter.';

  @override
  String get lpjVerifiedDone => 'LPJ terverifikasi.';

  @override
  String get lpjRevisionDone => 'LPJ dikembalikan ke pemohon untuk direvisi.';

  @override
  String lpjPendingReceipts(int count) {
    return '$count nota belum diputuskan (valid / tolak).';
  }

  @override
  String get receiptActionVerify => 'Validasi nota';

  @override
  String get receiptActionReject => 'Tolak nota';

  @override
  String get receiptValidButton => 'Valid';

  @override
  String get receiptRejectReasonLabel => 'Alasan nota ditolak';

  @override
  String get receiptVerifiedDone => 'Nota ditandai valid.';

  @override
  String get receiptRejectedDone => 'Nota ditolak.';

  @override
  String get flagReviewAction => 'Tandai flag diperiksa';

  @override
  String get flagReviewNoteLabel => 'Catatan pemeriksaan (opsional)';

  @override
  String get flagReviewedDone => 'Flag ditandai sudah diperiksa.';

  @override
  String get flagReviewedLabel => 'Sudah diperiksa';

  @override
  String get mediaOpenPhoto => 'Buka foto';

  @override
  String get mediaOpenFile => 'Buka file';

  @override
  String get mediaNotImage => 'File ini bukan gambar (mis. PDF). Ketuk thumbnail-nya untuk membuka sebagai file.';

  @override
  String get pliAction => 'Instruksi pinjam antar proyek';

  @override
  String pliTitle(String doc) {
    return 'Instruksi pinjam antar proyek — $doc';
  }

  @override
  String get pliBorrowerAccount => 'Akun kas pengajuan';

  @override
  String get pliLenders => 'Project pemberi (PT yang sama)';

  @override
  String get pliNoLenders => 'Tidak ada project lain yang aktif di PT ini.';

  @override
  String pliAccount(String name) {
    return 'Akun kas: $name';
  }

  @override
  String get pliAmount => 'Nilai pinjaman';

  @override
  String pliAmountHelp(String min, String max) {
    return 'Minimal $min (kekurangan), maksimal $max (dana bebas pemberi).';
  }

  @override
  String get pliDueDate => 'Jatuh tempo';

  @override
  String get pliReason => 'Alasan / catatan';

  @override
  String get pliReasonHint => 'Wajib, minimal 3 karakter. Tercatat di pinjaman dan audit log.';

  @override
  String pliReasonDefault(String account, String doc) {
    return 'Menutup kekurangan dana akun kas $account untuk pengajuan $doc';
  }

  @override
  String get pliChooseLender => 'Pilih project pemberi pinjaman.';

  @override
  String get pliContinue => 'Lanjut';

  @override
  String get pliConfirmNote =>
      'Pinjaman langsung disetujui dan masuk Antrian Transfer Finance. Pengajuan tetap menunggu keputusan Anda; setujui setelah Finance mentransfer pinjaman.';

  @override
  String pliConfirmFrom(String project, String account) {
    return 'Pemberi: $project — akun kas $account';
  }

  @override
  String pliConfirmTo(String project, String account) {
    return 'Penerima: $project — akun kas $account';
  }

  @override
  String pliConfirmAmount(String amount) {
    return 'Nilai pinjaman: $amount';
  }

  @override
  String pliConfirmDue(String date) {
    return 'Jatuh tempo: $date';
  }

  @override
  String pliDone(String amount, String project) {
    return 'Pinjaman $amount dari $project masuk Antrian Transfer Finance. Setujui pengajuan setelah transfer dieksekusi.';
  }

  @override
  String pliPending(String doc, String amount, String status) {
    return 'Pinjaman $doc ($amount): $status.';
  }

  @override
  String get pliInboxBlocked => 'Dana bebas akun kas project kurang — instruksikan pinjaman antar proyek atau tolak.';

  @override
  String pliInboxPending(String doc) {
    return 'Pinjaman $doc menunggu transfer Finance — setujui setelah transfer dieksekusi.';
  }

  @override
  String get loanStepInstructedOwner => 'Instruksi Owner';
}
