import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_id.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'gen/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[Locale('id')];

  /// No description provided for @appTitle.
  ///
  /// In id, this message translates to:
  /// **'ProyekKas'**
  String get appTitle;

  /// No description provided for @loading.
  ///
  /// In id, this message translates to:
  /// **'Memuat…'**
  String get loading;

  /// No description provided for @retry.
  ///
  /// In id, this message translates to:
  /// **'Coba lagi'**
  String get retry;

  /// No description provided for @cancel.
  ///
  /// In id, this message translates to:
  /// **'Batal'**
  String get cancel;

  /// No description provided for @save.
  ///
  /// In id, this message translates to:
  /// **'Simpan'**
  String get save;

  /// No description provided for @close.
  ///
  /// In id, this message translates to:
  /// **'Tutup'**
  String get close;

  /// No description provided for @delete.
  ///
  /// In id, this message translates to:
  /// **'Hapus'**
  String get delete;

  /// No description provided for @yes.
  ///
  /// In id, this message translates to:
  /// **'Ya'**
  String get yes;

  /// No description provided for @no.
  ///
  /// In id, this message translates to:
  /// **'Tidak'**
  String get no;

  /// No description provided for @next.
  ///
  /// In id, this message translates to:
  /// **'Lanjut'**
  String get next;

  /// No description provided for @needsInternet.
  ///
  /// In id, this message translates to:
  /// **'Butuh koneksi internet'**
  String get needsInternet;

  /// No description provided for @offlineBanner.
  ///
  /// In id, this message translates to:
  /// **'Offline — data disimpan di HP dan dikirim otomatis saat online.'**
  String get offlineBanner;

  /// No description provided for @pendingQueue.
  ///
  /// In id, this message translates to:
  /// **'{count} data menunggu dikirim'**
  String pendingQueue(int count);

  /// No description provided for @failedQueue.
  ///
  /// In id, this message translates to:
  /// **'{count} data gagal dikirim — buka Antrean'**
  String failedQueue(int count);

  /// No description provided for @loginTitle.
  ///
  /// In id, this message translates to:
  /// **'Masuk ke ProyekKas'**
  String get loginTitle;

  /// No description provided for @loginSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Gunakan akun DRMS Anda. Halaman masuk dibuka di browser HP.'**
  String get loginSubtitle;

  /// No description provided for @loginButton.
  ///
  /// In id, this message translates to:
  /// **'Masuk'**
  String get loginButton;

  /// No description provided for @loginCancelled.
  ///
  /// In id, this message translates to:
  /// **'Login dibatalkan. Jika halaman login tidak kembali ke aplikasi, tutup browser lalu tekan Masuk lagi.'**
  String get loginCancelled;

  /// No description provided for @loginFailed.
  ///
  /// In id, this message translates to:
  /// **'Login gagal. Coba lagi.'**
  String get loginFailed;

  /// No description provided for @loginNeedsInternet.
  ///
  /// In id, this message translates to:
  /// **'Login pertama kali butuh koneksi internet.'**
  String get loginNeedsInternet;

  /// No description provided for @sessionEnded.
  ///
  /// In id, this message translates to:
  /// **'Sesi berakhir atau perangkat dicabut. Silakan masuk kembali.'**
  String get sessionEnded;

  /// No description provided for @deviceRevoked.
  ///
  /// In id, this message translates to:
  /// **'Perangkat ini sudah dicabut dari akun Anda oleh Admin/Direktur. Silakan masuk kembali atau hubungi Admin.'**
  String get deviceRevoked;

  /// No description provided for @stagingBadge.
  ///
  /// In id, this message translates to:
  /// **'STAGING'**
  String get stagingBadge;

  /// No description provided for @loginSubtitlePassword.
  ///
  /// In id, this message translates to:
  /// **'Gunakan akun DRMS Anda.'**
  String get loginSubtitlePassword;

  /// No description provided for @loginUsernameLabel.
  ///
  /// In id, this message translates to:
  /// **'Email atau username'**
  String get loginUsernameLabel;

  /// No description provided for @loginUsernameRequired.
  ///
  /// In id, this message translates to:
  /// **'Isi email atau username.'**
  String get loginUsernameRequired;

  /// No description provided for @loginPasswordLabel.
  ///
  /// In id, this message translates to:
  /// **'Kata sandi'**
  String get loginPasswordLabel;

  /// No description provided for @loginPasswordRequired.
  ///
  /// In id, this message translates to:
  /// **'Isi kata sandi.'**
  String get loginPasswordRequired;

  /// No description provided for @loginShowPassword.
  ///
  /// In id, this message translates to:
  /// **'Tampilkan kata sandi'**
  String get loginShowPassword;

  /// No description provided for @loginHidePassword.
  ///
  /// In id, this message translates to:
  /// **'Sembunyikan kata sandi'**
  String get loginHidePassword;

  /// No description provided for @loginForgotPassword.
  ///
  /// In id, this message translates to:
  /// **'Lupa kata sandi? Hubungi Admin.'**
  String get loginForgotPassword;

  /// No description provided for @updateRequiredTitle.
  ///
  /// In id, this message translates to:
  /// **'Perbarui aplikasi'**
  String get updateRequiredTitle;

  /// No description provided for @updateRequiredBody.
  ///
  /// In id, this message translates to:
  /// **'Versi aplikasi ini ({current}) sudah tidak didukung. Versi minimal: {minimum}.'**
  String updateRequiredBody(String current, String minimum);

  /// No description provided for @updateDownloadHint.
  ///
  /// In id, this message translates to:
  /// **'Unduh versi terbaru dari:'**
  String get updateDownloadHint;

  /// No description provided for @copyLink.
  ///
  /// In id, this message translates to:
  /// **'Salin tautan'**
  String get copyLink;

  /// No description provided for @updateContactAdmin.
  ///
  /// In id, this message translates to:
  /// **'Hubungi admin untuk mendapatkan APK terbaru.'**
  String get updateContactAdmin;

  /// No description provided for @updateAvailable.
  ///
  /// In id, this message translates to:
  /// **'Versi baru tersedia ({version}).'**
  String updateAvailable(String version);

  /// No description provided for @navHome.
  ///
  /// In id, this message translates to:
  /// **'Beranda'**
  String get navHome;

  /// No description provided for @navRequests.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan'**
  String get navRequests;

  /// No description provided for @navInbox.
  ///
  /// In id, this message translates to:
  /// **'Persetujuan'**
  String get navInbox;

  /// No description provided for @navQueue.
  ///
  /// In id, this message translates to:
  /// **'Antrean'**
  String get navQueue;

  /// No description provided for @navProfile.
  ///
  /// In id, this message translates to:
  /// **'Profil'**
  String get navProfile;

  /// No description provided for @greeting.
  ///
  /// In id, this message translates to:
  /// **'Halo, {name}'**
  String greeting(String name);

  /// No description provided for @actionNewAdvance.
  ///
  /// In id, this message translates to:
  /// **'Ajukan Uang Muka'**
  String get actionNewAdvance;

  /// No description provided for @actionNewReimburse.
  ///
  /// In id, this message translates to:
  /// **'Ajukan Reimburse'**
  String get actionNewReimburse;

  /// No description provided for @actionMyRequests.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan Saya'**
  String get actionMyRequests;

  /// No description provided for @actionInbox.
  ///
  /// In id, this message translates to:
  /// **'Menunggu Persetujuan'**
  String get actionInbox;

  /// No description provided for @actionAttendance.
  ///
  /// In id, this message translates to:
  /// **'Absensi'**
  String get actionAttendance;

  /// No description provided for @actionAttendanceOff.
  ///
  /// In id, this message translates to:
  /// **'Absensi (belum diaktifkan Admin)'**
  String get actionAttendanceOff;

  /// No description provided for @actionAllRequests.
  ///
  /// In id, this message translates to:
  /// **'Semua Pengajuan'**
  String get actionAllRequests;

  /// No description provided for @financeHint.
  ///
  /// In id, this message translates to:
  /// **'Transfer, verifikasi nota/LPJ, dan buku kas dikerjakan di web admin.'**
  String get financeHint;

  /// No description provided for @inboxCount.
  ///
  /// In id, this message translates to:
  /// **'{count} menunggu'**
  String inboxCount(int count);

  /// No description provided for @requestsTitle.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan'**
  String get requestsTitle;

  /// No description provided for @tabDrafts.
  ///
  /// In id, this message translates to:
  /// **'Draft di HP'**
  String get tabDrafts;

  /// No description provided for @tabSent.
  ///
  /// In id, this message translates to:
  /// **'Terkirim'**
  String get tabSent;

  /// No description provided for @noDrafts.
  ///
  /// In id, this message translates to:
  /// **'Belum ada draft.'**
  String get noDrafts;

  /// No description provided for @noRequests.
  ///
  /// In id, this message translates to:
  /// **'Belum ada pengajuan.'**
  String get noRequests;

  /// No description provided for @loadMore.
  ///
  /// In id, this message translates to:
  /// **'Muat lagi'**
  String get loadMore;

  /// No description provided for @draftUntitled.
  ///
  /// In id, this message translates to:
  /// **'(tanpa judul)'**
  String get draftUntitled;

  /// No description provided for @syncStateLocal.
  ///
  /// In id, this message translates to:
  /// **'Belum dikirim'**
  String get syncStateLocal;

  /// No description provided for @syncStateQueued.
  ///
  /// In id, this message translates to:
  /// **'Menunggu sinkron'**
  String get syncStateQueued;

  /// No description provided for @syncStateSynced.
  ///
  /// In id, this message translates to:
  /// **'Tersimpan di server'**
  String get syncStateSynced;

  /// No description provided for @syncStateConflict.
  ///
  /// In id, this message translates to:
  /// **'Konflik — diubah di web'**
  String get syncStateConflict;

  /// No description provided for @syncStateRejected.
  ///
  /// In id, this message translates to:
  /// **'Ditolak server'**
  String get syncStateRejected;

  /// No description provided for @syncStateSubmitted.
  ///
  /// In id, this message translates to:
  /// **'Sudah diajukan'**
  String get syncStateSubmitted;

  /// No description provided for @detailTitle.
  ///
  /// In id, this message translates to:
  /// **'Detail Pengajuan'**
  String get detailTitle;

  /// No description provided for @turnLabel.
  ///
  /// In id, this message translates to:
  /// **'Giliran'**
  String get turnLabel;

  /// No description provided for @timelineTitle.
  ///
  /// In id, this message translates to:
  /// **'Posisi tanda tangan'**
  String get timelineTitle;

  /// No description provided for @linesTitle.
  ///
  /// In id, this message translates to:
  /// **'Baris item'**
  String get linesTitle;

  /// No description provided for @receiptsTitle.
  ///
  /// In id, this message translates to:
  /// **'Nota'**
  String get receiptsTitle;

  /// No description provided for @flagsTitle.
  ///
  /// In id, this message translates to:
  /// **'Flag validasi'**
  String get flagsTitle;

  /// No description provided for @grandTotal.
  ///
  /// In id, this message translates to:
  /// **'Grand total'**
  String get grandTotal;

  /// No description provided for @approvedAmount.
  ///
  /// In id, this message translates to:
  /// **'Disetujui'**
  String get approvedAmount;

  /// No description provided for @neededDate.
  ///
  /// In id, this message translates to:
  /// **'Tanggal dibutuhkan'**
  String get neededDate;

  /// No description provided for @requestDate.
  ///
  /// In id, this message translates to:
  /// **'Tanggal pengajuan'**
  String get requestDate;

  /// No description provided for @requesters.
  ///
  /// In id, this message translates to:
  /// **'Diajukan oleh'**
  String get requesters;

  /// No description provided for @createdBy.
  ///
  /// In id, this message translates to:
  /// **'Dibuat oleh'**
  String get createdBy;

  /// No description provided for @bankAccount.
  ///
  /// In id, this message translates to:
  /// **'Rekening tujuan'**
  String get bankAccount;

  /// No description provided for @scopeLabel.
  ///
  /// In id, this message translates to:
  /// **'Project / pusat biaya'**
  String get scopeLabel;

  /// No description provided for @rejectReasonLabel.
  ///
  /// In id, this message translates to:
  /// **'Alasan ditolak'**
  String get rejectReasonLabel;

  /// No description provided for @budgetImpact.
  ///
  /// In id, this message translates to:
  /// **'Dampak anggaran'**
  String get budgetImpact;

  /// No description provided for @budgetNone.
  ///
  /// In id, this message translates to:
  /// **'Tanpa anggaran'**
  String get budgetNone;

  /// No description provided for @budgetChange.
  ///
  /// In id, this message translates to:
  /// **'{before} → {after}'**
  String budgetChange(String before, String after);

  /// No description provided for @receiptThumbFailed.
  ///
  /// In id, this message translates to:
  /// **'Gambar tidak dapat dimuat'**
  String get receiptThumbFailed;

  /// No description provided for @totalPreview.
  ///
  /// In id, this message translates to:
  /// **'Total (pratinjau)'**
  String get totalPreview;

  /// No description provided for @previewNote.
  ///
  /// In id, this message translates to:
  /// **'Nilai final dihitung server.'**
  String get previewNote;

  /// No description provided for @editorNewTitle.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan baru'**
  String get editorNewTitle;

  /// No description provided for @editorEditTitle.
  ///
  /// In id, this message translates to:
  /// **'Ubah draft'**
  String get editorEditTitle;

  /// No description provided for @fieldType.
  ///
  /// In id, this message translates to:
  /// **'Jenis'**
  String get fieldType;

  /// No description provided for @fieldTitle.
  ///
  /// In id, this message translates to:
  /// **'Judul'**
  String get fieldTitle;

  /// No description provided for @fieldProject.
  ///
  /// In id, this message translates to:
  /// **'Project'**
  String get fieldProject;

  /// No description provided for @fieldCostCenter.
  ///
  /// In id, this message translates to:
  /// **'Pusat biaya'**
  String get fieldCostCenter;

  /// No description provided for @fieldNeededDate.
  ///
  /// In id, this message translates to:
  /// **'Tanggal dibutuhkan'**
  String get fieldNeededDate;

  /// No description provided for @fieldNotes.
  ///
  /// In id, this message translates to:
  /// **'Keterangan'**
  String get fieldNotes;

  /// No description provided for @fieldRequesters.
  ///
  /// In id, this message translates to:
  /// **'Diajukan oleh (pemohon)'**
  String get fieldRequesters;

  /// No description provided for @fieldBankAccount.
  ///
  /// In id, this message translates to:
  /// **'Rekening tujuan'**
  String get fieldBankAccount;

  /// No description provided for @scopeProject.
  ///
  /// In id, this message translates to:
  /// **'Project'**
  String get scopeProject;

  /// No description provided for @scopeCostCenter.
  ///
  /// In id, this message translates to:
  /// **'Pusat biaya'**
  String get scopeCostCenter;

  /// No description provided for @none.
  ///
  /// In id, this message translates to:
  /// **'— Tidak ada —'**
  String get none;

  /// No description provided for @choose.
  ///
  /// In id, this message translates to:
  /// **'Pilih…'**
  String get choose;

  /// No description provided for @addLine.
  ///
  /// In id, this message translates to:
  /// **'Tambah baris'**
  String get addLine;

  /// No description provided for @saveDraft.
  ///
  /// In id, this message translates to:
  /// **'Simpan draft'**
  String get saveDraft;

  /// No description provided for @submit.
  ///
  /// In id, this message translates to:
  /// **'Ajukan'**
  String get submit;

  /// No description provided for @submitConfirm.
  ///
  /// In id, this message translates to:
  /// **'Ajukan pengajuan ini? Setelah diajukan, nomor dokumen dibuat server dan draft tidak bisa diubah bebas.'**
  String get submitConfirm;

  /// No description provided for @submitted.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan berhasil diajukan.'**
  String get submitted;

  /// No description provided for @draftSaved.
  ///
  /// In id, this message translates to:
  /// **'Draft disimpan di HP.'**
  String get draftSaved;

  /// No description provided for @draftSavedQueued.
  ///
  /// In id, this message translates to:
  /// **'Draft disimpan dan akan dikirim saat online.'**
  String get draftSavedQueued;

  /// No description provided for @deleteDraftConfirm.
  ///
  /// In id, this message translates to:
  /// **'Hapus draft ini dari HP?'**
  String get deleteDraftConfirm;

  /// No description provided for @mastersMissing.
  ///
  /// In id, this message translates to:
  /// **'Data master belum tersedia. Buka aplikasi saat online sekali untuk mengunduhnya.'**
  String get mastersMissing;

  /// No description provided for @lineTitle.
  ///
  /// In id, this message translates to:
  /// **'Baris {no}'**
  String lineTitle(int no);

  /// No description provided for @fieldDescription.
  ///
  /// In id, this message translates to:
  /// **'Uraian'**
  String get fieldDescription;

  /// No description provided for @fieldQty.
  ///
  /// In id, this message translates to:
  /// **'Jumlah'**
  String get fieldQty;

  /// No description provided for @fieldUom.
  ///
  /// In id, this message translates to:
  /// **'Satuan'**
  String get fieldUom;

  /// No description provided for @fieldUnitPrice.
  ///
  /// In id, this message translates to:
  /// **'Harga satuan'**
  String get fieldUnitPrice;

  /// No description provided for @fieldTotal.
  ///
  /// In id, this message translates to:
  /// **'Total'**
  String get fieldTotal;

  /// No description provided for @fieldCategory.
  ///
  /// In id, this message translates to:
  /// **'Kategori'**
  String get fieldCategory;

  /// No description provided for @fieldVehicle.
  ///
  /// In id, this message translates to:
  /// **'Kendaraan'**
  String get fieldVehicle;

  /// No description provided for @fieldLineNotes.
  ///
  /// In id, this message translates to:
  /// **'Keterangan baris'**
  String get fieldLineNotes;

  /// No description provided for @unitPriceHint.
  ///
  /// In id, this message translates to:
  /// **'Informasi saja — total tidak dihitung otomatis.'**
  String get unitPriceHint;

  /// No description provided for @receiptDiff.
  ///
  /// In id, this message translates to:
  /// **'Selisih total baris vs nota: {amount}'**
  String receiptDiff(String amount);

  /// No description provided for @addReceiptCamera.
  ///
  /// In id, this message translates to:
  /// **'Foto nota (kamera)'**
  String get addReceiptCamera;

  /// No description provided for @addReceiptGallery.
  ///
  /// In id, this message translates to:
  /// **'Dari galeri'**
  String get addReceiptGallery;

  /// No description provided for @receiptNo.
  ///
  /// In id, this message translates to:
  /// **'Nomor nota'**
  String get receiptNo;

  /// No description provided for @receiptVendor.
  ///
  /// In id, this message translates to:
  /// **'Toko / vendor'**
  String get receiptVendor;

  /// No description provided for @receiptDate.
  ///
  /// In id, this message translates to:
  /// **'Tanggal nota'**
  String get receiptDate;

  /// No description provided for @receiptTime.
  ///
  /// In id, this message translates to:
  /// **'Jam nota'**
  String get receiptTime;

  /// No description provided for @receiptAmount.
  ///
  /// In id, this message translates to:
  /// **'Nominal di nota'**
  String get receiptAmount;

  /// No description provided for @receiptDetailsTitle.
  ///
  /// In id, this message translates to:
  /// **'Data nota'**
  String get receiptDetailsTitle;

  /// No description provided for @photoCompressing.
  ///
  /// In id, this message translates to:
  /// **'Mengompres foto…'**
  String get photoCompressing;

  /// No description provided for @searchHint.
  ///
  /// In id, this message translates to:
  /// **'Cari…'**
  String get searchHint;

  /// No description provided for @draftNotFound.
  ///
  /// In id, this message translates to:
  /// **'Draft tidak ditemukan.'**
  String get draftNotFound;

  /// No description provided for @cameraUnavailable.
  ///
  /// In id, this message translates to:
  /// **'Kamera belakang tidak tersedia.'**
  String get cameraUnavailable;

  /// No description provided for @cameraPermission.
  ///
  /// In id, this message translates to:
  /// **'Izin kamera ditolak. Aktifkan di Pengaturan HP.'**
  String get cameraPermission;

  /// No description provided for @takePhoto.
  ///
  /// In id, this message translates to:
  /// **'Ambil foto'**
  String get takePhoto;

  /// No description provided for @invalidAmount.
  ///
  /// In id, this message translates to:
  /// **'Nominal tidak valid'**
  String get invalidAmount;

  /// No description provided for @required.
  ///
  /// In id, this message translates to:
  /// **'Wajib diisi'**
  String get required;

  /// No description provided for @inboxTitle.
  ///
  /// In id, this message translates to:
  /// **'Menunggu Persetujuan'**
  String get inboxTitle;

  /// No description provided for @inboxEmpty.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada pengajuan yang menunggu Anda.'**
  String get inboxEmpty;

  /// No description provided for @stepAcknowledge.
  ///
  /// In id, this message translates to:
  /// **'Diketahui'**
  String get stepAcknowledge;

  /// No description provided for @stepApprove.
  ///
  /// In id, this message translates to:
  /// **'Approval level {level}'**
  String stepApprove(int level);

  /// No description provided for @flagsCount.
  ///
  /// In id, this message translates to:
  /// **'{warning} peringatan · {info} info'**
  String flagsCount(int warning, int info);

  /// No description provided for @actionAcknowledge.
  ///
  /// In id, this message translates to:
  /// **'Diketahui'**
  String get actionAcknowledge;

  /// No description provided for @actionApprove.
  ///
  /// In id, this message translates to:
  /// **'Setujui'**
  String get actionApprove;

  /// No description provided for @actionReject.
  ///
  /// In id, this message translates to:
  /// **'Tolak'**
  String get actionReject;

  /// No description provided for @decisionTitleAcknowledge.
  ///
  /// In id, this message translates to:
  /// **'Tandai diketahui'**
  String get decisionTitleAcknowledge;

  /// No description provided for @decisionTitleApprove.
  ///
  /// In id, this message translates to:
  /// **'Setujui pengajuan'**
  String get decisionTitleApprove;

  /// No description provided for @decisionTitleReject.
  ///
  /// In id, this message translates to:
  /// **'Tolak pengajuan'**
  String get decisionTitleReject;

  /// No description provided for @rejectReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan penolakan'**
  String get rejectReason;

  /// No description provided for @rejectReasonTooShort.
  ///
  /// In id, this message translates to:
  /// **'Alasan wajib diisi (minimal 3 karakter).'**
  String get rejectReasonTooShort;

  /// No description provided for @signatureMode.
  ///
  /// In id, this message translates to:
  /// **'Tanda tangan'**
  String get signatureMode;

  /// No description provided for @signatureProfile.
  ///
  /// In id, this message translates to:
  /// **'Pakai tanda tangan profil'**
  String get signatureProfile;

  /// No description provided for @signatureDraw.
  ///
  /// In id, this message translates to:
  /// **'Tanda tangan di layar'**
  String get signatureDraw;

  /// No description provided for @signatureClear.
  ///
  /// In id, this message translates to:
  /// **'Ulangi'**
  String get signatureClear;

  /// No description provided for @signatureEmpty.
  ///
  /// In id, this message translates to:
  /// **'Tanda tangan belum dibuat.'**
  String get signatureEmpty;

  /// No description provided for @signatureTooLarge.
  ///
  /// In id, this message translates to:
  /// **'Tanda tangan terlalu besar. Ulangi dengan goresan lebih sederhana.'**
  String get signatureTooLarge;

  /// No description provided for @confirm.
  ///
  /// In id, this message translates to:
  /// **'Konfirmasi'**
  String get confirm;

  /// No description provided for @decisionDone.
  ///
  /// In id, this message translates to:
  /// **'Keputusan tersimpan.'**
  String get decisionDone;

  /// No description provided for @transferTitle.
  ///
  /// In id, this message translates to:
  /// **'Transfer dari Finance'**
  String get transferTitle;

  /// No description provided for @transferNone.
  ///
  /// In id, this message translates to:
  /// **'Belum ada transfer.'**
  String get transferNone;

  /// No description provided for @transferTotal.
  ///
  /// In id, this message translates to:
  /// **'Total ditransfer'**
  String get transferTotal;

  /// No description provided for @transferRef.
  ///
  /// In id, this message translates to:
  /// **'Ref. bank'**
  String get transferRef;

  /// No description provided for @transferPosted.
  ///
  /// In id, this message translates to:
  /// **'Tercatat'**
  String get transferPosted;

  /// No description provided for @transferVoid.
  ///
  /// In id, this message translates to:
  /// **'Dibatalkan'**
  String get transferVoid;

  /// No description provided for @transferVoidReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan batal: {reason}'**
  String transferVoidReason(String reason);

  /// No description provided for @lpjTitle.
  ///
  /// In id, this message translates to:
  /// **'LPJ (Laporan Pertanggungjawaban)'**
  String get lpjTitle;

  /// No description provided for @lpjStatus.
  ///
  /// In id, this message translates to:
  /// **'Status LPJ'**
  String get lpjStatus;

  /// No description provided for @lpjReceiptsTotal.
  ///
  /// In id, this message translates to:
  /// **'Total nota'**
  String get lpjReceiptsTotal;

  /// No description provided for @lpjVerifiedTotal.
  ///
  /// In id, this message translates to:
  /// **'Nota terverifikasi'**
  String get lpjVerifiedTotal;

  /// No description provided for @lpjDifference.
  ///
  /// In id, this message translates to:
  /// **'Selisih'**
  String get lpjDifference;

  /// No description provided for @lpjSettlement.
  ///
  /// In id, this message translates to:
  /// **'Penyelesaian'**
  String get lpjSettlement;

  /// No description provided for @lpjUsageNotes.
  ///
  /// In id, this message translates to:
  /// **'Keterangan penggunaan dana'**
  String get lpjUsageNotes;

  /// No description provided for @lpjFinanceNotes.
  ///
  /// In id, this message translates to:
  /// **'Catatan Finance'**
  String get lpjFinanceNotes;

  /// No description provided for @requesterActionsTitle.
  ///
  /// In id, this message translates to:
  /// **'Nota & LPJ'**
  String get requesterActionsTitle;

  /// No description provided for @addReceiptOnlineCamera.
  ///
  /// In id, this message translates to:
  /// **'Tambah nota (kamera)'**
  String get addReceiptOnlineCamera;

  /// No description provided for @addReceiptOnlineGallery.
  ///
  /// In id, this message translates to:
  /// **'Tambah nota dari galeri'**
  String get addReceiptOnlineGallery;

  /// No description provided for @chooseLine.
  ///
  /// In id, this message translates to:
  /// **'Nota ini untuk baris mana?'**
  String get chooseLine;

  /// No description provided for @uploadingReceipt.
  ///
  /// In id, this message translates to:
  /// **'Mengunggah nota…'**
  String get uploadingReceipt;

  /// No description provided for @receiptSaved.
  ///
  /// In id, this message translates to:
  /// **'Nota tersimpan.'**
  String get receiptSaved;

  /// No description provided for @receiptRemove.
  ///
  /// In id, this message translates to:
  /// **'Hapus nota'**
  String get receiptRemove;

  /// No description provided for @receiptRemoveReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan menghapus nota'**
  String get receiptRemoveReason;

  /// No description provided for @receiptRemoved.
  ///
  /// In id, this message translates to:
  /// **'Nota dihapus.'**
  String get receiptRemoved;

  /// No description provided for @reasonTooShort.
  ///
  /// In id, this message translates to:
  /// **'Wajib diisi (minimal 3 karakter).'**
  String get reasonTooShort;

  /// No description provided for @actionReceiptsComplete.
  ///
  /// In id, this message translates to:
  /// **'Nota sudah lengkap'**
  String get actionReceiptsComplete;

  /// No description provided for @actionReceiptsCompleteConfirm.
  ///
  /// In id, this message translates to:
  /// **'Tandai semua nota sudah lengkap? Setelah itu Anda bisa mengirim LPJ.'**
  String get actionReceiptsCompleteConfirm;

  /// No description provided for @actionLpjSubmit.
  ///
  /// In id, this message translates to:
  /// **'Kirim LPJ'**
  String get actionLpjSubmit;

  /// No description provided for @actionLpjResubmit.
  ///
  /// In id, this message translates to:
  /// **'Kirim ulang LPJ'**
  String get actionLpjResubmit;

  /// No description provided for @lpjUsageNotesHint.
  ///
  /// In id, this message translates to:
  /// **'Jelaskan penggunaan dana (wajib pada pengiriman pertama).'**
  String get lpjUsageNotesHint;

  /// No description provided for @actionReceiptsResubmit.
  ///
  /// In id, this message translates to:
  /// **'Kirim ulang nota'**
  String get actionReceiptsResubmit;

  /// No description provided for @actionReceiptsResubmitConfirm.
  ///
  /// In id, this message translates to:
  /// **'Kirim ulang nota yang sudah diperbaiki ke Finance?'**
  String get actionReceiptsResubmitConfirm;

  /// No description provided for @actionComplete.
  ///
  /// In id, this message translates to:
  /// **'Tandai selesai'**
  String get actionComplete;

  /// No description provided for @actionCompleteConfirm.
  ///
  /// In id, this message translates to:
  /// **'Dana sudah diterima dan pengajuan ini selesai?'**
  String get actionCompleteConfirm;

  /// No description provided for @actionSaved.
  ///
  /// In id, this message translates to:
  /// **'Tersimpan.'**
  String get actionSaved;

  /// No description provided for @integrityWarning.
  ///
  /// In id, this message translates to:
  /// **'HP ini terdeteksi di-root atau berupa emulator. Aktivitas dari HP ini ditandai untuk ditinjau Admin.'**
  String get integrityWarning;

  /// No description provided for @attendanceTitle.
  ///
  /// In id, this message translates to:
  /// **'Absensi'**
  String get attendanceTitle;

  /// No description provided for @attendanceDisabled.
  ///
  /// In id, this message translates to:
  /// **'Absensi dari aplikasi belum diaktifkan Admin (Setting perusahaan).'**
  String get attendanceDisabled;

  /// No description provided for @attendanceNoProjects.
  ///
  /// In id, this message translates to:
  /// **'Anda belum ditugaskan di project atau pusat biaya mana pun. Hubungi PM/Admin.'**
  String get attendanceNoProjects;

  /// No description provided for @attendanceProject.
  ///
  /// In id, this message translates to:
  /// **'Project'**
  String get attendanceProject;

  /// No description provided for @attendanceCheckIn.
  ///
  /// In id, this message translates to:
  /// **'Absen masuk'**
  String get attendanceCheckIn;

  /// No description provided for @attendanceCheckOut.
  ///
  /// In id, this message translates to:
  /// **'Absen pulang'**
  String get attendanceCheckOut;

  /// No description provided for @attendanceLocating.
  ///
  /// In id, this message translates to:
  /// **'Membaca lokasi GPS…'**
  String get attendanceLocating;

  /// No description provided for @attendanceOutside.
  ///
  /// In id, this message translates to:
  /// **'Anda di luar radius lokasi ({distance} m dari titik, radius {radius} m). Absen hanya bisa di lokasi.'**
  String attendanceOutside(int distance, int radius);

  /// No description provided for @attendanceInside.
  ///
  /// In id, this message translates to:
  /// **'Di dalam radius lokasi ({distance} m dari titik, radius {radius} m).'**
  String attendanceInside(int distance, int radius);

  /// No description provided for @attendanceNoGeofence.
  ///
  /// In id, this message translates to:
  /// **'Titik lokasi/radius belum diatur Admin. Absen belum bisa dilakukan di lokasi ini.'**
  String get attendanceNoGeofence;

  /// No description provided for @attendanceMocked.
  ///
  /// In id, this message translates to:
  /// **'Lokasi palsu (mock location) terdeteksi. Matikan aplikasi lokasi palsu. Absen ditolak.'**
  String get attendanceMocked;

  /// No description provided for @attendanceSelfieTitle.
  ///
  /// In id, this message translates to:
  /// **'Selfie absensi'**
  String get attendanceSelfieTitle;

  /// No description provided for @attendanceSavedOnline.
  ///
  /// In id, this message translates to:
  /// **'Absen tersimpan dan sedang dikirim.'**
  String get attendanceSavedOnline;

  /// No description provided for @attendanceSavedOffline.
  ///
  /// In id, this message translates to:
  /// **'Absen tersimpan di HP (offline). Dikirim otomatis saat ada sinyal; jam absen dihitung server.'**
  String get attendanceSavedOffline;

  /// No description provided for @attendanceHistory.
  ///
  /// In id, this message translates to:
  /// **'Riwayat absen di HP ini'**
  String get attendanceHistory;

  /// No description provided for @attendanceHistoryEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada absen dari HP ini.'**
  String get attendanceHistoryEmpty;

  /// No description provided for @attendanceOfflineTag.
  ///
  /// In id, this message translates to:
  /// **'offline'**
  String get attendanceOfflineTag;

  /// No description provided for @frontCameraUnavailable.
  ///
  /// In id, this message translates to:
  /// **'Kamera depan tidak tersedia. Absen butuh selfie dengan kamera depan.'**
  String get frontCameraUnavailable;

  /// No description provided for @notificationsTitle.
  ///
  /// In id, this message translates to:
  /// **'Notifikasi'**
  String get notificationsTitle;

  /// No description provided for @notificationsEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada notifikasi.'**
  String get notificationsEmpty;

  /// No description provided for @notificationsReadAll.
  ///
  /// In id, this message translates to:
  /// **'Tandai semua dibaca'**
  String get notificationsReadAll;

  /// No description provided for @queueTitle.
  ///
  /// In id, this message translates to:
  /// **'Antrean kirim'**
  String get queueTitle;

  /// No description provided for @queueEmpty.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada data yang menunggu dikirim.'**
  String get queueEmpty;

  /// No description provided for @syncNow.
  ///
  /// In id, this message translates to:
  /// **'Kirim sekarang'**
  String get syncNow;

  /// No description provided for @retryFailed.
  ///
  /// In id, this message translates to:
  /// **'Coba lagi yang gagal'**
  String get retryFailed;

  /// No description provided for @syncServerUnsupported.
  ///
  /// In id, this message translates to:
  /// **'Server belum mendukung sinkron offline. Data tetap aman di HP.'**
  String get syncServerUnsupported;

  /// No description provided for @syncDone.
  ///
  /// In id, this message translates to:
  /// **'Sinkron selesai.'**
  String get syncDone;

  /// No description provided for @queueStatusPending.
  ///
  /// In id, this message translates to:
  /// **'Menunggu'**
  String get queueStatusPending;

  /// No description provided for @queueStatusApplied.
  ///
  /// In id, this message translates to:
  /// **'Terkirim'**
  String get queueStatusApplied;

  /// No description provided for @queueStatusRejected.
  ///
  /// In id, this message translates to:
  /// **'Ditolak'**
  String get queueStatusRejected;

  /// No description provided for @queueStatusConflict.
  ///
  /// In id, this message translates to:
  /// **'Konflik'**
  String get queueStatusConflict;

  /// No description provided for @queueStatusFailed.
  ///
  /// In id, this message translates to:
  /// **'Gagal dikirim'**
  String get queueStatusFailed;

  /// No description provided for @queueStatusSuperseded.
  ///
  /// In id, this message translates to:
  /// **'Diganti'**
  String get queueStatusSuperseded;

  /// No description provided for @queueUsage.
  ///
  /// In id, this message translates to:
  /// **'Penyimpanan offline: {used} dari 100 MB'**
  String queueUsage(String used);

  /// No description provided for @profileTitle.
  ///
  /// In id, this message translates to:
  /// **'Profil'**
  String get profileTitle;

  /// No description provided for @profileRoles.
  ///
  /// In id, this message translates to:
  /// **'Peran'**
  String get profileRoles;

  /// No description provided for @profileEmployee.
  ///
  /// In id, this message translates to:
  /// **'Karyawan'**
  String get profileEmployee;

  /// No description provided for @profileVersion.
  ///
  /// In id, this message translates to:
  /// **'Versi aplikasi'**
  String get profileVersion;

  /// No description provided for @profileDevice.
  ///
  /// In id, this message translates to:
  /// **'ID perangkat'**
  String get profileDevice;

  /// No description provided for @pushDisabled.
  ///
  /// In id, this message translates to:
  /// **'Notifikasi push belum aktif.'**
  String get pushDisabled;

  /// No description provided for @logout.
  ///
  /// In id, this message translates to:
  /// **'Keluar'**
  String get logout;

  /// No description provided for @logoutConfirm.
  ///
  /// In id, this message translates to:
  /// **'Keluar dari aplikasi?'**
  String get logoutConfirm;

  /// No description provided for @logoutPendingWarning.
  ///
  /// In id, this message translates to:
  /// **'Masih ada {count} data belum terkirim ke server. Data ini TIDAK dihapus: tetap tersimpan terenkripsi di HP dan baru dikirim setelah Anda masuk lagi dengan akun yang sama. Jika ada sinyal, kirim dulu lewat menu Antrean.'**
  String logoutPendingWarning(int count);

  /// No description provided for @logoutAnyway.
  ///
  /// In id, this message translates to:
  /// **'Tetap keluar'**
  String get logoutAnyway;

  /// No description provided for @logoutInProgress.
  ///
  /// In id, this message translates to:
  /// **'Sedang keluar…'**
  String get logoutInProgress;

  /// No description provided for @offlineRecheck.
  ///
  /// In id, this message translates to:
  /// **'Ketuk untuk cek koneksi.'**
  String get offlineRecheck;

  /// No description provided for @stepAcknowledgeDirektur.
  ///
  /// In id, this message translates to:
  /// **'Persetujuan Direktur (Diketahui)'**
  String get stepAcknowledgeDirektur;

  /// No description provided for @budgetOverWarn.
  ///
  /// In id, this message translates to:
  /// **'Melewati batas peringatan anggaran'**
  String get budgetOverWarn;

  /// No description provided for @decisionForbidden.
  ///
  /// In id, this message translates to:
  /// **'Anda tidak dapat memutuskan pengajuan ini. Hanya Direktur (Diketahui) dan Finance (Approval) yang memutuskan, dan hanya pada gilirannya. Data dimuat ulang.'**
  String get decisionForbidden;

  /// No description provided for @decisionTitleAcknowledgeDirektur.
  ///
  /// In id, this message translates to:
  /// **'Setujui sebagai Direktur (Diketahui)'**
  String get decisionTitleAcknowledgeDirektur;

  /// No description provided for @decisionHintDirektur.
  ///
  /// In id, this message translates to:
  /// **'Persetujuan Direktur tercatat sebagai \"Diketahui\". Setelah itu pengajuan diteruskan ke Finance untuk Approval.'**
  String get decisionHintDirektur;

  /// No description provided for @actionAcknowledgeDirektur.
  ///
  /// In id, this message translates to:
  /// **'Setujui (Diketahui)'**
  String get actionAcknowledgeDirektur;

  /// No description provided for @historyTitle.
  ///
  /// In id, this message translates to:
  /// **'Riwayat'**
  String get historyTitle;

  /// No description provided for @historyEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada riwayat.'**
  String get historyEmpty;

  /// No description provided for @historyField.
  ///
  /// In id, this message translates to:
  /// **'Field'**
  String get historyField;

  /// No description provided for @historyChange.
  ///
  /// In id, this message translates to:
  /// **'Lama → Baru'**
  String get historyChange;

  /// No description provided for @historyReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan'**
  String get historyReason;

  /// No description provided for @historySource.
  ///
  /// In id, this message translates to:
  /// **'Sumber'**
  String get historySource;

  /// No description provided for @serverReceiptLocked.
  ///
  /// In id, this message translates to:
  /// **'Nota sudah di server — tidak dapat diubah dari HP.'**
  String get serverReceiptLocked;

  /// No description provided for @lifecycleActionsTitle.
  ///
  /// In id, this message translates to:
  /// **'Aksi pengajuan'**
  String get lifecycleActionsTitle;

  /// No description provided for @actionEditOnPhone.
  ///
  /// In id, this message translates to:
  /// **'Ubah & ajukan di HP'**
  String get actionEditOnPhone;

  /// No description provided for @actionResubmit.
  ///
  /// In id, this message translates to:
  /// **'Ajukan ulang (buat draft baru)'**
  String get actionResubmit;

  /// No description provided for @actionWithdraw.
  ///
  /// In id, this message translates to:
  /// **'Tarik kembali ke Draft'**
  String get actionWithdraw;

  /// No description provided for @actionCancelRequest.
  ///
  /// In id, this message translates to:
  /// **'Batalkan pengajuan'**
  String get actionCancelRequest;

  /// No description provided for @editOnWebHint.
  ///
  /// In id, this message translates to:
  /// **'Draft ini diubah lewat web (peran Anda tidak membuat pengajuan di HP).'**
  String get editOnWebHint;

  /// No description provided for @withdrawReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan tarik kembali'**
  String get withdrawReason;

  /// No description provided for @withdrawHint.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan kembali ke Draft; ubah lalu ajukan lagi.'**
  String get withdrawHint;

  /// No description provided for @cancelReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan pembatalan'**
  String get cancelReason;

  /// No description provided for @cancelHint.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan dibatalkan dan tidak diproses lagi.'**
  String get cancelHint;

  /// No description provided for @withdrawDone.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan ditarik kembali ke Draft; silakan ubah lalu kirim lagi.'**
  String get withdrawDone;

  /// No description provided for @cancelDone.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan dibatalkan.'**
  String get cancelDone;

  /// No description provided for @resubmitConfirm.
  ///
  /// In id, this message translates to:
  /// **'Buat draft baru dari pengajuan yang ditolak ini?'**
  String get resubmitConfirm;

  /// No description provided for @resubmitDone.
  ///
  /// In id, this message translates to:
  /// **'Draft baru dibuat dari pengajuan yang ditolak. Periksa, ubah bila perlu, lalu ajukan.'**
  String get resubmitDone;

  /// No description provided for @tabTeam.
  ///
  /// In id, this message translates to:
  /// **'Tim'**
  String get tabTeam;

  /// No description provided for @teamReadOnlyHint.
  ///
  /// In id, this message translates to:
  /// **'Pantauan tim — hanya lihat. Persetujuan dilakukan Direktur dan Finance.'**
  String get teamReadOnlyHint;

  /// No description provided for @teamNoScope.
  ///
  /// In id, this message translates to:
  /// **'Anda belum menjadi PM project atau penanggung jawab pusat biaya.'**
  String get teamNoScope;

  /// No description provided for @kpiSummaryTitle.
  ///
  /// In id, this message translates to:
  /// **'Ringkasan'**
  String get kpiSummaryTitle;

  /// No description provided for @kpiTeamTitle.
  ///
  /// In id, this message translates to:
  /// **'Pantauan tim'**
  String get kpiTeamTitle;

  /// No description provided for @homeActionsTitle.
  ///
  /// In id, this message translates to:
  /// **'Aksi'**
  String get homeActionsTitle;

  /// No description provided for @kpiUnavailable.
  ///
  /// In id, this message translates to:
  /// **'Ringkasan belum bisa dimuat'**
  String get kpiUnavailable;

  /// No description provided for @kpiCashTotal.
  ///
  /// In id, this message translates to:
  /// **'Saldo kas total'**
  String get kpiCashTotal;

  /// No description provided for @kpiMonthInOut.
  ///
  /// In id, this message translates to:
  /// **'Bulan ini +{cashIn} / −{cashOut}'**
  String kpiMonthInOut(String cashIn, String cashOut);

  /// No description provided for @kpiBalanceTrend.
  ///
  /// In id, this message translates to:
  /// **'Tren saldo akhir bulan'**
  String get kpiBalanceTrend;

  /// No description provided for @kpiWaiting.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan menunggu'**
  String get kpiWaiting;

  /// No description provided for @kpiWaitingSplit.
  ///
  /// In id, this message translates to:
  /// **'Diketahui {ack} · Approval {approval}'**
  String kpiWaitingSplit(int ack, int approval);

  /// No description provided for @kpiWaitingForMe.
  ///
  /// In id, this message translates to:
  /// **'{count} menunggu saya'**
  String kpiWaitingForMe(int count);

  /// No description provided for @kpiOldest.
  ///
  /// In id, this message translates to:
  /// **'tertua {days} hari'**
  String kpiOldest(int days);

  /// No description provided for @kpiDisbursedMonth.
  ///
  /// In id, this message translates to:
  /// **'Pencairan bulan ini'**
  String get kpiDisbursedMonth;

  /// No description provided for @kpiDisbursedNet.
  ///
  /// In id, this message translates to:
  /// **'{amount} dicairkan bersih'**
  String kpiDisbursedNet(String amount);

  /// No description provided for @kpiDisbursedTrend.
  ///
  /// In id, this message translates to:
  /// **'Tren pencairan bersih per bulan'**
  String get kpiDisbursedTrend;

  /// No description provided for @kpiBudgetRealized.
  ///
  /// In id, this message translates to:
  /// **'Realisasi vs anggaran'**
  String get kpiBudgetRealized;

  /// No description provided for @kpiOfBudget.
  ///
  /// In id, this message translates to:
  /// **'{realized} dari RAB {budget}'**
  String kpiOfBudget(String realized, String budget);

  /// No description provided for @kpiBudgetAlerts.
  ///
  /// In id, this message translates to:
  /// **'{over} lewat RAB · {warn} waspada'**
  String kpiBudgetAlerts(int over, int warn);

  /// No description provided for @kpiCashFlowTitle.
  ///
  /// In id, this message translates to:
  /// **'Arus kas bulanan'**
  String get kpiCashFlowTitle;

  /// No description provided for @kpiCashFlowSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Masuk vs keluar, tanpa transaksi yang di-void. Ketuk bulan untuk melihat angkanya.'**
  String get kpiCashFlowSubtitle;

  /// No description provided for @kpiCashFlowSubtitleFinance.
  ///
  /// In id, this message translates to:
  /// **'Buku kas, termasuk koreksi void. Ketuk bulan untuk melihat angkanya.'**
  String get kpiCashFlowSubtitleFinance;

  /// No description provided for @kpiIn.
  ///
  /// In id, this message translates to:
  /// **'Masuk'**
  String get kpiIn;

  /// No description provided for @kpiOut.
  ///
  /// In id, this message translates to:
  /// **'Keluar'**
  String get kpiOut;

  /// No description provided for @kpiTransferQueue.
  ///
  /// In id, this message translates to:
  /// **'Antrian transfer'**
  String get kpiTransferQueue;

  /// No description provided for @kpiOverdue.
  ///
  /// In id, this message translates to:
  /// **'{count} lewat tanggal dibutuhkan'**
  String kpiOverdue(int count);

  /// No description provided for @kpiOnTime.
  ///
  /// In id, this message translates to:
  /// **'Tepat waktu'**
  String get kpiOnTime;

  /// No description provided for @kpiToVerify.
  ///
  /// In id, this message translates to:
  /// **'Menunggu verifikasi'**
  String get kpiToVerify;

  /// No description provided for @kpiToVerifySplit.
  ///
  /// In id, this message translates to:
  /// **'{lpj} LPJ · {reimburse} nota reimburse'**
  String kpiToVerifySplit(int lpj, int reimburse);

  /// No description provided for @kpiLpjToSettle.
  ///
  /// In id, this message translates to:
  /// **'Selisih LPJ'**
  String get kpiLpjToSettle;

  /// No description provided for @kpiAdvancesOverdue.
  ///
  /// In id, this message translates to:
  /// **'{count} uang muka terlambat LPJ'**
  String kpiAdvancesOverdue(int count);

  /// No description provided for @kpiTeamMonth.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan tim bulan ini'**
  String get kpiTeamMonth;

  /// No description provided for @kpiTeamWaiting.
  ///
  /// In id, this message translates to:
  /// **'{count} menunggu persetujuan'**
  String kpiTeamWaiting(int count);

  /// No description provided for @kpiTeamTrend.
  ///
  /// In id, this message translates to:
  /// **'Tren jumlah pengajuan tim'**
  String get kpiTeamTrend;

  /// No description provided for @kpiTeamLpj.
  ///
  /// In id, this message translates to:
  /// **'Uang muka tim belum LPJ'**
  String get kpiTeamLpj;

  /// No description provided for @kpiLpjOverdue.
  ///
  /// In id, this message translates to:
  /// **'{count} terlambat'**
  String kpiLpjOverdue(int count);

  /// No description provided for @kpiLpjNoneOverdue.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada yang terlambat'**
  String get kpiLpjNoneOverdue;

  /// No description provided for @kpiTeamBudget.
  ///
  /// In id, this message translates to:
  /// **'Realisasi anggaran project saya'**
  String get kpiTeamBudget;

  /// No description provided for @routeErrorTitle.
  ///
  /// In id, this message translates to:
  /// **'Halaman tidak bisa dibuka'**
  String get routeErrorTitle;

  /// No description provided for @routeErrorBody.
  ///
  /// In id, this message translates to:
  /// **'Terjadi kesalahan saat membuka halaman ini. Kembali ke beranda lalu coba lagi.'**
  String get routeErrorBody;

  /// No description provided for @routeErrorHome.
  ///
  /// In id, this message translates to:
  /// **'Ke beranda'**
  String get routeErrorHome;

  /// No description provided for @actionProgress.
  ///
  /// In id, this message translates to:
  /// **'Laporan progress'**
  String get actionProgress;

  /// No description provided for @actionProgressRead.
  ///
  /// In id, this message translates to:
  /// **'Progress project'**
  String get actionProgressRead;

  /// No description provided for @progressPendingCount.
  ///
  /// In id, this message translates to:
  /// **'{count} laporan belum terkirim'**
  String progressPendingCount(int count);

  /// No description provided for @actionAttendanceSub.
  ///
  /// In id, this message translates to:
  /// **'Absen masuk/pulang, rekap bulanan'**
  String get actionAttendanceSub;

  /// No description provided for @actionAttendanceOffSub.
  ///
  /// In id, this message translates to:
  /// **'Rekap bulanan (absen dari aplikasi belum diaktifkan Admin)'**
  String get actionAttendanceOffSub;

  /// No description provided for @actionAttendanceTeamSub.
  ///
  /// In id, this message translates to:
  /// **'Kehadiran tim hari ini'**
  String get actionAttendanceTeamSub;

  /// No description provided for @seeAll.
  ///
  /// In id, this message translates to:
  /// **'Lihat semua'**
  String get seeAll;

  /// No description provided for @attendanceTabCheck.
  ///
  /// In id, this message translates to:
  /// **'Absen'**
  String get attendanceTabCheck;

  /// No description provided for @attendanceTabRecap.
  ///
  /// In id, this message translates to:
  /// **'Rekap'**
  String get attendanceTabRecap;

  /// No description provided for @attendanceTabTeam.
  ///
  /// In id, this message translates to:
  /// **'Tim'**
  String get attendanceTabTeam;

  /// No description provided for @attendanceLocation.
  ///
  /// In id, this message translates to:
  /// **'Lokasi (project / pusat biaya)'**
  String get attendanceLocation;

  /// No description provided for @attendanceRadius.
  ///
  /// In id, this message translates to:
  /// **'radius {meters} m'**
  String attendanceRadius(int meters);

  /// No description provided for @attendanceCheckDistance.
  ///
  /// In id, this message translates to:
  /// **'Cek jarak ke lokasi'**
  String get attendanceCheckDistance;

  /// No description provided for @siteProject.
  ///
  /// In id, this message translates to:
  /// **'Project'**
  String get siteProject;

  /// No description provided for @siteCostCenter.
  ///
  /// In id, this message translates to:
  /// **'Pusat biaya'**
  String get siteCostCenter;

  /// No description provided for @distanceInside.
  ///
  /// In id, this message translates to:
  /// **'Di dalam area absen'**
  String get distanceInside;

  /// No description provided for @distanceOutside.
  ///
  /// In id, this message translates to:
  /// **'Di luar area absen'**
  String get distanceOutside;

  /// No description provided for @distanceDetail.
  ///
  /// In id, this message translates to:
  /// **'Radius {radius} m + toleransi GPS {allowance} m (akurasi GPS ±{accuracy} m, maks. 50 m dihitung).'**
  String distanceDetail(int radius, int allowance, int accuracy);

  /// No description provided for @dowMon.
  ///
  /// In id, this message translates to:
  /// **'Sen'**
  String get dowMon;

  /// No description provided for @dowTue.
  ///
  /// In id, this message translates to:
  /// **'Sel'**
  String get dowTue;

  /// No description provided for @dowWed.
  ///
  /// In id, this message translates to:
  /// **'Rab'**
  String get dowWed;

  /// No description provided for @dowThu.
  ///
  /// In id, this message translates to:
  /// **'Kam'**
  String get dowThu;

  /// No description provided for @dowFri.
  ///
  /// In id, this message translates to:
  /// **'Jum'**
  String get dowFri;

  /// No description provided for @dowSat.
  ///
  /// In id, this message translates to:
  /// **'Sab'**
  String get dowSat;

  /// No description provided for @dowSun.
  ///
  /// In id, this message translates to:
  /// **'Min'**
  String get dowSun;

  /// No description provided for @recapPrevMonth.
  ///
  /// In id, this message translates to:
  /// **'Bulan sebelumnya'**
  String get recapPrevMonth;

  /// No description provided for @recapNextMonth.
  ///
  /// In id, this message translates to:
  /// **'Bulan berikutnya'**
  String get recapNextMonth;

  /// No description provided for @recapSchedule.
  ///
  /// In id, this message translates to:
  /// **'Jadwal {name}: {start}–{end}, toleransi {tolerance} menit'**
  String recapSchedule(String name, String start, String end, int tolerance);

  /// No description provided for @recapPresent.
  ///
  /// In id, this message translates to:
  /// **'Hadir'**
  String get recapPresent;

  /// No description provided for @recapWorkingDays.
  ///
  /// In id, this message translates to:
  /// **'dari hari kerja s.d. hari ini'**
  String get recapWorkingDays;

  /// No description provided for @recapWorkHours.
  ///
  /// In id, this message translates to:
  /// **'Total jam kerja'**
  String get recapWorkHours;

  /// No description provided for @recapLate.
  ///
  /// In id, this message translates to:
  /// **'Terlambat'**
  String get recapLate;

  /// No description provided for @recapEarlyLeave.
  ///
  /// In id, this message translates to:
  /// **'Pulang cepat'**
  String get recapEarlyLeave;

  /// No description provided for @recapAbsent.
  ///
  /// In id, this message translates to:
  /// **'Tidak hadir'**
  String get recapAbsent;

  /// No description provided for @recapIncomplete.
  ///
  /// In id, this message translates to:
  /// **'Belum absen pulang'**
  String get recapIncomplete;

  /// No description provided for @recapDays.
  ///
  /// In id, this message translates to:
  /// **'{count} hari'**
  String recapDays(int count);

  /// No description provided for @recapMinutes.
  ///
  /// In id, this message translates to:
  /// **'{count} menit'**
  String recapMinutes(int count);

  /// No description provided for @recapStatusDone.
  ///
  /// In id, this message translates to:
  /// **'Selesai'**
  String get recapStatusDone;

  /// No description provided for @recapStatusPresent.
  ///
  /// In id, this message translates to:
  /// **'Hadir'**
  String get recapStatusPresent;

  /// No description provided for @recapStatusNotYet.
  ///
  /// In id, this message translates to:
  /// **'Belum absen'**
  String get recapStatusNotYet;

  /// No description provided for @recapStatusAbsent.
  ///
  /// In id, this message translates to:
  /// **'Tidak hadir'**
  String get recapStatusAbsent;

  /// No description provided for @recapStatusHoliday.
  ///
  /// In id, this message translates to:
  /// **'Libur'**
  String get recapStatusHoliday;

  /// No description provided for @recapStatusNoSchedule.
  ///
  /// In id, this message translates to:
  /// **'Tanpa jadwal'**
  String get recapStatusNoSchedule;

  /// No description provided for @recapLegendMark.
  ///
  /// In id, this message translates to:
  /// **'terlambat / oleh PM / dikoreksi'**
  String get recapLegendMark;

  /// No description provided for @recapInOut.
  ///
  /// In id, this message translates to:
  /// **'Masuk {checkIn} · Pulang {checkOut}'**
  String recapInOut(String checkIn, String checkOut);

  /// No description provided for @recapWorked.
  ///
  /// In id, this message translates to:
  /// **'Jam kerja: {duration}'**
  String recapWorked(String duration);

  /// No description provided for @recapLateBy.
  ///
  /// In id, this message translates to:
  /// **'Terlambat {minutes} menit'**
  String recapLateBy(int minutes);

  /// No description provided for @recapEarlyBy.
  ///
  /// In id, this message translates to:
  /// **'Pulang cepat {minutes} menit'**
  String recapEarlyBy(int minutes);

  /// No description provided for @recapOnBehalf.
  ///
  /// In id, this message translates to:
  /// **'Diabsenkan oleh PM: {names}'**
  String recapOnBehalf(String names);

  /// No description provided for @recapCorrected.
  ///
  /// In id, this message translates to:
  /// **'Jam absen dikoreksi (T10).'**
  String get recapCorrected;

  /// No description provided for @recapFlags.
  ///
  /// In id, this message translates to:
  /// **'Penanda: {flags}'**
  String recapFlags(String flags);

  /// No description provided for @recapMemberTitle.
  ///
  /// In id, this message translates to:
  /// **'Rekap absensi karyawan'**
  String get recapMemberTitle;

  /// No description provided for @teamStatusNotYet.
  ///
  /// In id, this message translates to:
  /// **'Belum absen'**
  String get teamStatusNotYet;

  /// No description provided for @teamStatusPresent.
  ///
  /// In id, this message translates to:
  /// **'Hadir'**
  String get teamStatusPresent;

  /// No description provided for @teamStatusDone.
  ///
  /// In id, this message translates to:
  /// **'Selesai'**
  String get teamStatusDone;

  /// No description provided for @teamAll.
  ///
  /// In id, this message translates to:
  /// **'Semua {count}'**
  String teamAll(int count);

  /// No description provided for @teamEmpty.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada anggota tim dengan status ini.'**
  String get teamEmpty;

  /// No description provided for @teamIn.
  ///
  /// In id, this message translates to:
  /// **'Masuk'**
  String get teamIn;

  /// No description provided for @teamOut.
  ///
  /// In id, this message translates to:
  /// **'Pulang'**
  String get teamOut;

  /// No description provided for @teamOnBehalfTag.
  ///
  /// In id, this message translates to:
  /// **'Oleh PM'**
  String get teamOnBehalfTag;

  /// No description provided for @teamCorrectedTag.
  ///
  /// In id, this message translates to:
  /// **'Dikoreksi'**
  String get teamCorrectedTag;

  /// No description provided for @onBehalfAction.
  ///
  /// In id, this message translates to:
  /// **'Absenkan anggota tim'**
  String get onBehalfAction;

  /// No description provided for @onBehalfTitle.
  ///
  /// In id, this message translates to:
  /// **'Diabsenkan PM'**
  String get onBehalfTitle;

  /// No description provided for @onBehalfIntro.
  ///
  /// In id, this message translates to:
  /// **'Untuk anggota tim yang tidak bisa absen sendiri. Lokasi diambil dari HP Anda, foto karyawan diambil dengan kamera HP Anda. Nama Anda dan alasannya tercatat.'**
  String get onBehalfIntro;

  /// No description provided for @onBehalfNoTeam.
  ///
  /// In id, this message translates to:
  /// **'Belum ada anggota tim yang ditugaskan hari ini (data tim dari server; tarik ulang di Beranda saat online).'**
  String get onBehalfNoTeam;

  /// No description provided for @onBehalfEmployee.
  ///
  /// In id, this message translates to:
  /// **'Karyawan'**
  String get onBehalfEmployee;

  /// No description provided for @onBehalfReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan (wajib)'**
  String get onBehalfReason;

  /// No description provided for @onBehalfReasonHint.
  ///
  /// In id, this message translates to:
  /// **'Contoh: tidak punya HP / HP rusak'**
  String get onBehalfReasonHint;

  /// No description provided for @onBehalfCamera.
  ///
  /// In id, this message translates to:
  /// **'Kamera untuk foto karyawan'**
  String get onBehalfCamera;

  /// No description provided for @lensBack.
  ///
  /// In id, this message translates to:
  /// **'Belakang'**
  String get lensBack;

  /// No description provided for @lensFront.
  ///
  /// In id, this message translates to:
  /// **'Depan'**
  String get lensFront;

  /// No description provided for @onBehalfCheckIn.
  ///
  /// In id, this message translates to:
  /// **'Absenkan masuk'**
  String get onBehalfCheckIn;

  /// No description provided for @onBehalfCheckOut.
  ///
  /// In id, this message translates to:
  /// **'Absenkan pulang'**
  String get onBehalfCheckOut;

  /// No description provided for @onBehalfPhotoTitle.
  ///
  /// In id, this message translates to:
  /// **'Foto {name}'**
  String onBehalfPhotoTitle(String name);

  /// No description provided for @onBehalfSavedOnline.
  ///
  /// In id, this message translates to:
  /// **'Absen {name} tersimpan dan sedang dikirim.'**
  String onBehalfSavedOnline(String name);

  /// No description provided for @onBehalfSavedOffline.
  ///
  /// In id, this message translates to:
  /// **'Absen {name} tersimpan di HP (offline). Dikirim otomatis saat ada sinyal.'**
  String onBehalfSavedOffline(String name);

  /// No description provided for @correctionTitleIn.
  ///
  /// In id, this message translates to:
  /// **'Koreksi jam masuk'**
  String get correctionTitleIn;

  /// No description provided for @correctionTitleOut.
  ///
  /// In id, this message translates to:
  /// **'Koreksi jam pulang'**
  String get correctionTitleOut;

  /// No description provided for @correctionOld.
  ///
  /// In id, this message translates to:
  /// **'Tercatat: {date} {time}'**
  String correctionOld(String date, String time);

  /// No description provided for @correctionNew.
  ///
  /// In id, this message translates to:
  /// **'Jam baru: {time}'**
  String correctionNew(String time);

  /// No description provided for @correctionReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan koreksi (wajib)'**
  String get correctionReason;

  /// No description provided for @correctionReasonHelp.
  ///
  /// In id, this message translates to:
  /// **'Tanggal tetap sama; jam lama dan baru tercatat di audit.'**
  String get correctionReasonHelp;

  /// No description provided for @correctionSaved.
  ///
  /// In id, this message translates to:
  /// **'Koreksi absensi tersimpan.'**
  String get correctionSaved;

  /// No description provided for @progressTitle.
  ///
  /// In id, this message translates to:
  /// **'Progress project'**
  String get progressTitle;

  /// No description provided for @progressTabReports.
  ///
  /// In id, this message translates to:
  /// **'Laporan'**
  String get progressTabReports;

  /// No description provided for @progressTabProjects.
  ///
  /// In id, this message translates to:
  /// **'Project'**
  String get progressTabProjects;

  /// No description provided for @progressNew.
  ///
  /// In id, this message translates to:
  /// **'Laporan baru'**
  String get progressNew;

  /// No description provided for @progressHomeTitle.
  ///
  /// In id, this message translates to:
  /// **'Progress fisik vs anggaran'**
  String get progressHomeTitle;

  /// No description provided for @progressLocalTitle.
  ///
  /// In id, this message translates to:
  /// **'Di HP ini (belum diterima server)'**
  String get progressLocalTitle;

  /// No description provided for @progressServerTitle.
  ///
  /// In id, this message translates to:
  /// **'Laporan terbaru'**
  String get progressServerTitle;

  /// No description provided for @progressFilterProject.
  ///
  /// In id, this message translates to:
  /// **'Filter project'**
  String get progressFilterProject;

  /// No description provided for @progressFilterAll.
  ///
  /// In id, this message translates to:
  /// **'Semua project'**
  String get progressFilterAll;

  /// No description provided for @progressListOffline.
  ///
  /// In id, this message translates to:
  /// **'Daftar laporan butuh koneksi internet. Laporan baru tetap bisa dibuat offline.'**
  String get progressListOffline;

  /// No description provided for @progressListEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada laporan progress.'**
  String get progressListEmpty;

  /// No description provided for @progressProjectsIntro.
  ///
  /// In id, this message translates to:
  /// **'Selisih = % anggaran terpakai − % progress fisik. Hijau aman, kuning perlu dicek, merah anggaran jauh mendahului pekerjaan.'**
  String get progressProjectsIntro;

  /// No description provided for @progressProjectsEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada project.'**
  String get progressProjectsEmpty;

  /// No description provided for @progressPhysical.
  ///
  /// In id, this message translates to:
  /// **'Progress fisik'**
  String get progressPhysical;

  /// No description provided for @progressBudgetUsed.
  ///
  /// In id, this message translates to:
  /// **'Anggaran terpakai'**
  String get progressBudgetUsed;

  /// No description provided for @progressGap.
  ///
  /// In id, this message translates to:
  /// **'Selisih {value}'**
  String progressGap(String value);

  /// No description provided for @progressStagesIncomplete.
  ///
  /// In id, this message translates to:
  /// **'Bobot tahapan baru {value} (harus 100%).'**
  String progressStagesIncomplete(String value);

  /// No description provided for @progressNoReportYet.
  ///
  /// In id, this message translates to:
  /// **'Belum ada laporan progress.'**
  String get progressNoReportYet;

  /// No description provided for @progressLastReport.
  ///
  /// In id, this message translates to:
  /// **'Laporan terakhir {date} · {count} laporan'**
  String progressLastReport(String date, int count);

  /// No description provided for @progressToneOk.
  ///
  /// In id, this message translates to:
  /// **'Sesuai'**
  String get progressToneOk;

  /// No description provided for @progressToneWarn.
  ///
  /// In id, this message translates to:
  /// **'Perlu dicek'**
  String get progressToneWarn;

  /// No description provided for @progressToneBad.
  ///
  /// In id, this message translates to:
  /// **'Anggaran mendahului'**
  String get progressToneBad;

  /// No description provided for @progressToneNone.
  ///
  /// In id, this message translates to:
  /// **'Belum bisa dihitung'**
  String get progressToneNone;

  /// No description provided for @progressRemovePhoto.
  ///
  /// In id, this message translates to:
  /// **'Hapus foto'**
  String get progressRemovePhoto;

  /// No description provided for @progressStateQueued.
  ///
  /// In id, this message translates to:
  /// **'Menunggu kirim'**
  String get progressStateQueued;

  /// No description provided for @progressStateLocal.
  ///
  /// In id, this message translates to:
  /// **'Belum terkirim'**
  String get progressStateLocal;

  /// No description provided for @progressStateConflict.
  ///
  /// In id, this message translates to:
  /// **'Konflik'**
  String get progressStateConflict;

  /// No description provided for @progressStateRejected.
  ///
  /// In id, this message translates to:
  /// **'Ditolak'**
  String get progressStateRejected;

  /// No description provided for @progressStateSynced.
  ///
  /// In id, this message translates to:
  /// **'Terkirim'**
  String get progressStateSynced;

  /// No description provided for @progressEditTag.
  ///
  /// In id, this message translates to:
  /// **'edit'**
  String get progressEditTag;

  /// No description provided for @progressPhotoCount.
  ///
  /// In id, this message translates to:
  /// **'{count} foto'**
  String progressPhotoCount(int count);

  /// No description provided for @progressConflictHint.
  ///
  /// In id, this message translates to:
  /// **'Ketuk untuk memilih versi yang dipakai.'**
  String get progressConflictHint;

  /// No description provided for @progressOfflineTag.
  ///
  /// In id, this message translates to:
  /// **'offline'**
  String get progressOfflineTag;

  /// No description provided for @progressEditableTag.
  ///
  /// In id, this message translates to:
  /// **'bisa diedit'**
  String get progressEditableTag;

  /// No description provided for @progressPhotoTitle.
  ///
  /// In id, this message translates to:
  /// **'Foto progress'**
  String get progressPhotoTitle;

  /// No description provided for @progressEditTitle.
  ///
  /// In id, this message translates to:
  /// **'Edit laporan progress'**
  String get progressEditTitle;

  /// No description provided for @progressNewTitle.
  ///
  /// In id, this message translates to:
  /// **'Laporan progress harian'**
  String get progressNewTitle;

  /// No description provided for @progressNotFound.
  ///
  /// In id, this message translates to:
  /// **'Laporan tidak ditemukan di HP ini.'**
  String get progressNotFound;

  /// No description provided for @progressPickProject.
  ///
  /// In id, this message translates to:
  /// **'Pilih project.'**
  String get progressPickProject;

  /// No description provided for @progressPickStage.
  ///
  /// In id, this message translates to:
  /// **'Pilih tahapan.'**
  String get progressPickStage;

  /// No description provided for @progressPhotoFailed.
  ///
  /// In id, this message translates to:
  /// **'Foto gagal diproses. Ambil ulang foto.'**
  String get progressPhotoFailed;

  /// No description provided for @progressSent.
  ///
  /// In id, this message translates to:
  /// **'Laporan terkirim.'**
  String get progressSent;

  /// No description provided for @progressQueuedOnline.
  ///
  /// In id, this message translates to:
  /// **'Laporan tersimpan dan sedang dikirim.'**
  String get progressQueuedOnline;

  /// No description provided for @progressQueuedOffline.
  ///
  /// In id, this message translates to:
  /// **'Laporan tersimpan di HP (offline). Dikirim otomatis saat ada sinyal.'**
  String get progressQueuedOffline;

  /// No description provided for @progressKeptLocal.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada koneksi. Laporan disimpan di HP; kirim dari menu Progress saat online.'**
  String get progressKeptLocal;

  /// No description provided for @progressDiscardTitle.
  ///
  /// In id, this message translates to:
  /// **'Hapus laporan ini?'**
  String get progressDiscardTitle;

  /// No description provided for @progressDiscardBody.
  ///
  /// In id, this message translates to:
  /// **'Laporan dan fotonya dihapus dari HP. Server belum menerimanya.'**
  String get progressDiscardBody;

  /// No description provided for @progressOnlineOnlyNote.
  ///
  /// In id, this message translates to:
  /// **'Server belum mengizinkan kirim offline: laporan dikirim langsung (butuh internet).'**
  String get progressOnlineOnlyNote;

  /// No description provided for @progressOnlineOnlyOffline.
  ///
  /// In id, this message translates to:
  /// **'Anda offline dan server belum mengizinkan kirim offline. Laporan disimpan di HP dan dikirim saat online.'**
  String get progressOnlineOnlyOffline;

  /// No description provided for @progressEditWindow.
  ///
  /// In id, this message translates to:
  /// **'Bisa diedit sampai {time}.'**
  String progressEditWindow(String time);

  /// No description provided for @progressProject.
  ///
  /// In id, this message translates to:
  /// **'Project'**
  String get progressProject;

  /// No description provided for @progressNoProjects.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada project untuk Anda.'**
  String get progressNoProjects;

  /// No description provided for @progressStagesCached.
  ///
  /// In id, this message translates to:
  /// **'Offline: tahapan dan % dari data terakhir di HP; server memeriksa ulang saat kirim.'**
  String get progressStagesCached;

  /// No description provided for @progressStage.
  ///
  /// In id, this message translates to:
  /// **'Tahapan'**
  String get progressStage;

  /// No description provided for @progressStageOption.
  ///
  /// In id, this message translates to:
  /// **'{name} (bobot {weight}, sekarang {pct})'**
  String progressStageOption(String name, String weight, String pct);

  /// No description provided for @progressPctTitle.
  ///
  /// In id, this message translates to:
  /// **'Progress tahapan {stage}'**
  String progressPctTitle(String stage);

  /// No description provided for @progressPctBefore.
  ///
  /// In id, this message translates to:
  /// **'Sebelum laporan: {value}'**
  String progressPctBefore(String value);

  /// No description provided for @progressPctAfterLabel.
  ///
  /// In id, this message translates to:
  /// **'Progress setelah pekerjaan'**
  String get progressPctAfterLabel;

  /// No description provided for @progressPctDelta.
  ///
  /// In id, this message translates to:
  /// **'Naik {value} dari sebelumnya.'**
  String progressPctDelta(String value);

  /// No description provided for @progressWork.
  ///
  /// In id, this message translates to:
  /// **'Pekerjaan'**
  String get progressWork;

  /// No description provided for @progressWorkHint.
  ///
  /// In id, this message translates to:
  /// **'Pekerjaan yang dilakukan hari ini'**
  String get progressWorkHint;

  /// No description provided for @progressIssues.
  ///
  /// In id, this message translates to:
  /// **'Kendala (opsional)'**
  String get progressIssues;

  /// No description provided for @progressPhotosTitle.
  ///
  /// In id, this message translates to:
  /// **'Foto ({count}/{max})'**
  String progressPhotosTitle(int count, int max);

  /// No description provided for @progressPhotosOnServer.
  ///
  /// In id, this message translates to:
  /// **'{count} foto sudah di server (foto tidak bisa dihapus, hanya ditambah).'**
  String progressPhotosOnServer(int count);

  /// No description provided for @progressAddPhoto.
  ///
  /// In id, this message translates to:
  /// **'Foto'**
  String get progressAddPhoto;

  /// No description provided for @progressReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan edit (wajib)'**
  String get progressReason;

  /// No description provided for @progressReasonHelp.
  ///
  /// In id, this message translates to:
  /// **'Tercatat di riwayat audit laporan.'**
  String get progressReasonHelp;

  /// No description provided for @progressSaveQueue.
  ///
  /// In id, this message translates to:
  /// **'Simpan & kirim'**
  String get progressSaveQueue;

  /// No description provided for @progressSendOnline.
  ///
  /// In id, this message translates to:
  /// **'Kirim laporan'**
  String get progressSendOnline;

  /// No description provided for @progressDetailTitle.
  ///
  /// In id, this message translates to:
  /// **'Laporan progress'**
  String get progressDetailTitle;

  /// No description provided for @progressWeight.
  ///
  /// In id, this message translates to:
  /// **'bobot {value}'**
  String progressWeight(String value);

  /// No description provided for @progressStageBeforeAfter.
  ///
  /// In id, this message translates to:
  /// **'Tahapan (sebelumnya {before})'**
  String progressStageBeforeAfter(String before);

  /// No description provided for @progressProjectBeforeAfter.
  ///
  /// In id, this message translates to:
  /// **'Project (sebelumnya {before})'**
  String progressProjectBeforeAfter(String before);

  /// No description provided for @progressNoPhotos.
  ///
  /// In id, this message translates to:
  /// **'Tanpa foto.'**
  String get progressNoPhotos;

  /// No description provided for @progressDate.
  ///
  /// In id, this message translates to:
  /// **'Tanggal'**
  String get progressDate;

  /// No description provided for @progressReporter.
  ///
  /// In id, this message translates to:
  /// **'Pelapor'**
  String get progressReporter;

  /// No description provided for @progressReceivedAt.
  ///
  /// In id, this message translates to:
  /// **'Diterima server'**
  String get progressReceivedAt;

  /// No description provided for @progressTimeTrust.
  ///
  /// In id, this message translates to:
  /// **'dibuat offline (waktu: {trust})'**
  String progressTimeTrust(String trust);

  /// No description provided for @progressFlags.
  ///
  /// In id, this message translates to:
  /// **'Penanda'**
  String get progressFlags;

  /// No description provided for @progressEditableUntil.
  ///
  /// In id, this message translates to:
  /// **'Bisa diedit s.d.'**
  String get progressEditableUntil;

  /// No description provided for @progressEdit.
  ///
  /// In id, this message translates to:
  /// **'Edit laporan (≤ 24 jam)'**
  String get progressEdit;

  /// No description provided for @progressConflictTitle.
  ///
  /// In id, this message translates to:
  /// **'Konflik laporan'**
  String get progressConflictTitle;

  /// No description provided for @progressConflictGone.
  ///
  /// In id, this message translates to:
  /// **'Konflik sudah diselesaikan.'**
  String get progressConflictGone;

  /// No description provided for @progressPhotosLabel.
  ///
  /// In id, this message translates to:
  /// **'Foto'**
  String get progressPhotosLabel;

  /// No description provided for @progressNewPhotos.
  ///
  /// In id, this message translates to:
  /// **'+{count} foto baru'**
  String progressNewPhotos(int count);

  /// No description provided for @progressUseServer.
  ///
  /// In id, this message translates to:
  /// **'Pakai versi server'**
  String get progressUseServer;

  /// No description provided for @progressResendMine.
  ///
  /// In id, this message translates to:
  /// **'Kirim versi HP (dengan alasan)'**
  String get progressResendMine;

  /// No description provided for @progressNotEditableAnymore.
  ///
  /// In id, this message translates to:
  /// **'Batas edit 24 jam sudah lewat: hanya versi server yang berlaku.'**
  String get progressNotEditableAnymore;

  /// No description provided for @progressDiffers.
  ///
  /// In id, this message translates to:
  /// **'berbeda'**
  String get progressDiffers;

  /// No description provided for @progressServerVersion.
  ///
  /// In id, this message translates to:
  /// **'Server'**
  String get progressServerVersion;

  /// No description provided for @progressMyVersion.
  ///
  /// In id, this message translates to:
  /// **'HP ini'**
  String get progressMyVersion;

  /// No description provided for @progressUsedServer.
  ///
  /// In id, this message translates to:
  /// **'Versi server dipakai; salinan di HP dihapus.'**
  String get progressUsedServer;

  /// No description provided for @progressResent.
  ///
  /// In id, this message translates to:
  /// **'Versi HP dikirim sebagai edit.'**
  String get progressResent;

  /// No description provided for @addendumTitle.
  ///
  /// In id, this message translates to:
  /// **'Addendum RAB'**
  String get addendumTitle;

  /// No description provided for @addendumInboxTitle.
  ///
  /// In id, this message translates to:
  /// **'Addendum RAB menunggu Anda ({count})'**
  String addendumInboxTitle(int count);

  /// No description provided for @addendumWaitingCount.
  ///
  /// In id, this message translates to:
  /// **'{count} menunggu keputusan Anda'**
  String addendumWaitingCount(int count);

  /// No description provided for @addendumNew.
  ///
  /// In id, this message translates to:
  /// **'Addendum baru'**
  String get addendumNew;

  /// No description provided for @addendumNewTitle.
  ///
  /// In id, this message translates to:
  /// **'Ajukan addendum RAB'**
  String get addendumNewTitle;

  /// No description provided for @addendumEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada addendum RAB.'**
  String get addendumEmpty;

  /// No description provided for @addendumAddition.
  ///
  /// In id, this message translates to:
  /// **'Tambahan RAB'**
  String get addendumAddition;

  /// No description provided for @addendumReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan'**
  String get addendumReason;

  /// No description provided for @addendumSubmit.
  ///
  /// In id, this message translates to:
  /// **'Ajukan'**
  String get addendumSubmit;

  /// No description provided for @addendumSaveDraft.
  ///
  /// In id, this message translates to:
  /// **'Simpan sebagai draft'**
  String get addendumSaveDraft;

  /// No description provided for @addendumSubmitted.
  ///
  /// In id, this message translates to:
  /// **'Addendum diajukan. Menunggu Direktur.'**
  String get addendumSubmitted;

  /// No description provided for @addendumSavedDraft.
  ///
  /// In id, this message translates to:
  /// **'Draft addendum tersimpan.'**
  String get addendumSavedDraft;

  /// No description provided for @addendumRabBeforeAfter.
  ///
  /// In id, this message translates to:
  /// **'RAB {before} → {after}'**
  String addendumRabBeforeAfter(String before, String after);

  /// No description provided for @addendumCommittedPct.
  ///
  /// In id, this message translates to:
  /// **'Komitmen terhadap RAB {before} → {after}'**
  String addendumCommittedPct(String before, String after);

  /// No description provided for @addendumWaiting.
  ///
  /// In id, this message translates to:
  /// **'Menunggu: {step}'**
  String addendumWaiting(String step);

  /// No description provided for @addendumRejectedBecause.
  ///
  /// In id, this message translates to:
  /// **'Ditolak: {reason}'**
  String addendumRejectedBecause(String reason);

  /// No description provided for @addendumCancelledBecause.
  ///
  /// In id, this message translates to:
  /// **'Dibatalkan: {reason}'**
  String addendumCancelledBecause(String reason);

  /// No description provided for @addendumBy.
  ///
  /// In id, this message translates to:
  /// **'Diajukan oleh {name}'**
  String addendumBy(String name);

  /// No description provided for @addendumSubmittedAt.
  ///
  /// In id, this message translates to:
  /// **'diajukan {time}'**
  String addendumSubmittedAt(String time);

  /// No description provided for @addendumTimeline.
  ///
  /// In id, this message translates to:
  /// **'Riwayat keputusan'**
  String get addendumTimeline;

  /// No description provided for @addendumDecAck.
  ///
  /// In id, this message translates to:
  /// **'Disetujui Direktur'**
  String get addendumDecAck;

  /// No description provided for @addendumDecApproved.
  ///
  /// In id, this message translates to:
  /// **'Disetujui Finance'**
  String get addendumDecApproved;

  /// No description provided for @addendumDecRejected.
  ///
  /// In id, this message translates to:
  /// **'Ditolak'**
  String get addendumDecRejected;

  /// No description provided for @addendumAcknowledge.
  ///
  /// In id, this message translates to:
  /// **'Setujui (Direktur)'**
  String get addendumAcknowledge;

  /// No description provided for @addendumApprove.
  ///
  /// In id, this message translates to:
  /// **'Setujui (Finance)'**
  String get addendumApprove;

  /// No description provided for @addendumReject.
  ///
  /// In id, this message translates to:
  /// **'Tolak'**
  String get addendumReject;

  /// No description provided for @addendumCancel.
  ///
  /// In id, this message translates to:
  /// **'Batalkan addendum'**
  String get addendumCancel;

  /// No description provided for @addendumConfirmBody.
  ///
  /// In id, this message translates to:
  /// **'Keputusan dicatat dengan nama dan tanda tangan profil Anda. Setelah persetujuan terakhir, RAB project bertambah.'**
  String get addendumConfirmBody;

  /// No description provided for @addendumDone.
  ///
  /// In id, this message translates to:
  /// **'Tersimpan.'**
  String get addendumDone;
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['id'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'id':
      return AppLocalizationsId();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
