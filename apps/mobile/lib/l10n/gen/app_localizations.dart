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
  /// **'RR Teams'**
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
  /// **'Masuk ke RR Teams'**
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

  /// No description provided for @loginTotpLabel.
  ///
  /// In id, this message translates to:
  /// **'Kode autentikator (bila 2FA aktif)'**
  String get loginTotpLabel;

  /// No description provided for @loginTotpHelper.
  ///
  /// In id, this message translates to:
  /// **'Isi 6 digit dari aplikasi autentikator hanya bila Anda mengaktifkan 2FA untuk akun ini. Tanpa 2FA, biarkan kosong.'**
  String get loginTotpHelper;

  /// No description provided for @loginTotpInvalidLength.
  ///
  /// In id, this message translates to:
  /// **'Kode autentikator terdiri dari 6 digit.'**
  String get loginTotpInvalidLength;

  /// No description provided for @loginInvalidWithTotp.
  ///
  /// In id, this message translates to:
  /// **'Email/username, kata sandi, atau kode autentikator salah. Gagal berulang kali dapat mengunci akun sementara; tunggu sebentar sebelum mencoba lagi.'**
  String get loginInvalidWithTotp;

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

  /// No description provided for @updateAvailableTap.
  ///
  /// In id, this message translates to:
  /// **'Ketuk untuk melihat yang baru dan cara memperbarui.'**
  String get updateAvailableTap;

  /// No description provided for @updateHowTo.
  ///
  /// In id, this message translates to:
  /// **'Pasang APK versi baru di atas aplikasi ini, tanpa menghapusnya. Data dan login tetap tersimpan.'**
  String get updateHowTo;

  /// No description provided for @releaseNotesTitle.
  ///
  /// In id, this message translates to:
  /// **'Yang baru di versi {version}'**
  String releaseNotesTitle(String version);

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
  /// **'Pengajuan Baru'**
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
  /// **'Tahapan saat ini'**
  String get turnLabel;

  /// No description provided for @turnYours.
  ///
  /// In id, this message translates to:
  /// **'Menunggu keputusan Anda'**
  String get turnYours;

  /// No description provided for @timelineTitle.
  ///
  /// In id, this message translates to:
  /// **'Alur pengajuan'**
  String get timelineTitle;

  /// No description provided for @linesTitle.
  ///
  /// In id, this message translates to:
  /// **'Rincian item'**
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

  /// No description provided for @fieldUrgency.
  ///
  /// In id, this message translates to:
  /// **'Tingkat urgensi'**
  String get fieldUrgency;

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
  /// **'Qty'**
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

  /// No description provided for @lineTotalHelper.
  ///
  /// In id, this message translates to:
  /// **'Qty × Harga satuan — dihitung otomatis, tidak bisa diubah.'**
  String get lineTotalHelper;

  /// No description provided for @fieldReceiptAmount.
  ///
  /// In id, this message translates to:
  /// **'Nominal sesuai nota'**
  String get fieldReceiptAmount;

  /// No description provided for @receiptAmountHelper.
  ///
  /// In id, this message translates to:
  /// **'Opsional. Persetujuan dan transfer tetap memakai Total (Qty × Harga satuan).'**
  String get receiptAmountHelper;

  /// No description provided for @receiptMismatchChip.
  ///
  /// In id, this message translates to:
  /// **'Selisih nota'**
  String get receiptMismatchChip;

  /// No description provided for @receiptMismatchDetail.
  ///
  /// In id, this message translates to:
  /// **'Nominal sesuai nota {receipt} ≠ Total {total}'**
  String receiptMismatchDetail(String receipt, String total);

  /// No description provided for @lineNeedsUnitPrice.
  ///
  /// In id, this message translates to:
  /// **'Baris ini dibuat sebelum Total dihitung otomatis. Isi Qty, Satuan dan Harga satuan (total lama: {amount}).'**
  String lineNeedsUnitPrice(String amount);

  /// No description provided for @lineNeedsUnitPriceShort.
  ///
  /// In id, this message translates to:
  /// **'Lengkapi Qty & Harga satuan'**
  String get lineNeedsUnitPriceShort;

  /// No description provided for @linesIncompleteResubmit.
  ///
  /// In id, this message translates to:
  /// **'Lengkapi Qty & Harga satuan pada baris {lines} (Ubah di web) sebelum mengirim ulang nota.'**
  String linesIncompleteResubmit(String lines);

  /// No description provided for @receiptMismatchCount.
  ///
  /// In id, this message translates to:
  /// **'Selisih nota ({count})'**
  String receiptMismatchCount(int count);

  /// No description provided for @fieldLineNo.
  ///
  /// In id, this message translates to:
  /// **'No'**
  String get fieldLineNo;

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

  /// No description provided for @direkturSignatureTitle.
  ///
  /// In id, this message translates to:
  /// **'Tanda tangan Direktur PT'**
  String get direkturSignatureTitle;

  /// No description provided for @direkturSignatureHint.
  ///
  /// In id, this message translates to:
  /// **'Ditandatangani dengan tanda tangan dan nama Direktur definitif PT.'**
  String get direkturSignatureHint;

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

  /// No description provided for @lpjPhotos.
  ///
  /// In id, this message translates to:
  /// **'Foto LPJ'**
  String get lpjPhotos;

  /// No description provided for @lpjPhotosCount.
  ///
  /// In id, this message translates to:
  /// **'{count} / {max} foto'**
  String lpjPhotosCount(int count, int max);

  /// No description provided for @lpjPhotosHint.
  ///
  /// In id, this message translates to:
  /// **'Opsional, maks. {max} foto (kamera atau galeri). Tidak bisa diubah setelah LPJ dikirim.'**
  String lpjPhotosHint(int max);

  /// No description provided for @lpjPhotosFull.
  ///
  /// In id, this message translates to:
  /// **'Maksimal {max} foto LPJ.'**
  String lpjPhotosFull(int max);

  /// No description provided for @lpjPhotoCaption.
  ///
  /// In id, this message translates to:
  /// **'Foto LPJ {no}'**
  String lpjPhotoCaption(int no);

  /// No description provided for @lpjPhotoRemove.
  ///
  /// In id, this message translates to:
  /// **'Hapus foto'**
  String get lpjPhotoRemove;

  /// No description provided for @lpjPhotoCamera.
  ///
  /// In id, this message translates to:
  /// **'Kamera'**
  String get lpjPhotoCamera;

  /// No description provided for @lpjUploadingPhotos.
  ///
  /// In id, this message translates to:
  /// **'Mengunggah foto LPJ…'**
  String get lpjUploadingPhotos;

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
  /// **'Anda belum ditugaskan di site, project, atau pusat biaya mana pun. Hubungi PM/Admin.'**
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

  /// No description provided for @profileAppearance.
  ///
  /// In id, this message translates to:
  /// **'Tampilan'**
  String get profileAppearance;

  /// No description provided for @profileAppearanceHint.
  ///
  /// In id, this message translates to:
  /// **'Sistem = ikuti pengaturan terang/gelap HP.'**
  String get profileAppearanceHint;

  /// No description provided for @themeSystem.
  ///
  /// In id, this message translates to:
  /// **'Sistem'**
  String get themeSystem;

  /// No description provided for @themeLight.
  ///
  /// In id, this message translates to:
  /// **'Terang'**
  String get themeLight;

  /// No description provided for @themeDark.
  ///
  /// In id, this message translates to:
  /// **'Gelap'**
  String get themeDark;

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
  /// **'Anda tidak dapat memutuskan pengajuan ini. Hanya PM project pengajuan ini, Direktur dan Finance yang memutuskan, masing-masing hanya pada tahapannya. Data dimuat ulang.'**
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

  /// No description provided for @decisionTitleAcknowledgePm.
  ///
  /// In id, this message translates to:
  /// **'Setujui sebagai PM project'**
  String get decisionTitleAcknowledgePm;

  /// No description provided for @decisionHintPm.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan diteruskan ke Direktur.'**
  String get decisionHintPm;

  /// No description provided for @decisionTitleApproveDirektur.
  ///
  /// In id, this message translates to:
  /// **'Setujui sebagai Direktur'**
  String get decisionTitleApproveDirektur;

  /// No description provided for @decisionHintDirekturFinal.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan diteruskan ke Finance untuk transfer.'**
  String get decisionHintDirekturFinal;

  /// No description provided for @actionAcknowledgePm.
  ///
  /// In id, this message translates to:
  /// **'Setujui'**
  String get actionAcknowledgePm;

  /// No description provided for @direkturViaPmNote.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan Direktur — diajukan oleh PM (kebijakan owner 2026-10-10)'**
  String get direkturViaPmNote;

  /// No description provided for @noApprovalNote.
  ///
  /// In id, this message translates to:
  /// **'Tanpa persetujuan — pengajuan Direktur (kebijakan PT)'**
  String get noApprovalNote;

  /// No description provided for @noApprovalBadge.
  ///
  /// In id, this message translates to:
  /// **'Tanpa persetujuan (Direktur)'**
  String get noApprovalBadge;

  /// No description provided for @draftDirekturNoApprovalInfo.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan Anda langsung ke antrian transfer Finance'**
  String get draftDirekturNoApprovalInfo;

  /// No description provided for @draftDirekturNoApprovalHint.
  ///
  /// In id, this message translates to:
  /// **'Tanpa persetujuan — kebijakan PT; Finance tetap memeriksa sebelum transfer.'**
  String get draftDirekturNoApprovalHint;

  /// No description provided for @direkturViaPmSelfNote.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan Direktur — diajukan oleh PM; disetujui Direktur pemohon karena satu-satunya Direktur PT (kebijakan owner 2026-10-10)'**
  String get direkturViaPmSelfNote;

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
  /// **'Pantauan tim — hanya lihat. Pengajuan yang menunggu persetujuan Anda sebagai PM project ada di menu Persetujuan.'**
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
  /// **'{count} pengajuan baru terlambat LPJ'**
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

  /// No description provided for @kpiPerCompanyTitle.
  ///
  /// In id, this message translates to:
  /// **'Per PT'**
  String get kpiPerCompanyTitle;

  /// No description provided for @kpiSplitCash.
  ///
  /// In id, this message translates to:
  /// **'Kas {amount}'**
  String kpiSplitCash(String amount);

  /// No description provided for @kpiSplitWaiting.
  ///
  /// In id, this message translates to:
  /// **'{count} menunggu · {amount}'**
  String kpiSplitWaiting(int count, String amount);

  /// No description provided for @kpiSplitTransfer.
  ///
  /// In id, this message translates to:
  /// **'{count} antri transfer · {amount}'**
  String kpiSplitTransfer(int count, String amount);

  /// No description provided for @kpiSplitTeam.
  ///
  /// In id, this message translates to:
  /// **'{count} pengajuan · {amount}'**
  String kpiSplitTeam(int count, String amount);

  /// No description provided for @kpiTeamLpj.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan Baru tim belum LPJ'**
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

  /// No description provided for @kpiMineTitle.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan saya'**
  String get kpiMineTitle;

  /// No description provided for @kpiCountSum.
  ///
  /// In id, this message translates to:
  /// **'{count} · {amount}'**
  String kpiCountSum(int count, String amount);

  /// No description provided for @kpiPipelineTitle.
  ///
  /// In id, this message translates to:
  /// **'Status pengajuan'**
  String get kpiPipelineTitle;

  /// No description provided for @kpiPipelineSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Posisi semua pengajuan saat ini'**
  String get kpiPipelineSubtitle;

  /// No description provided for @kpiPipelineTeamTitle.
  ///
  /// In id, this message translates to:
  /// **'Status pengajuan tim'**
  String get kpiPipelineTeamTitle;

  /// No description provided for @kpiPipelineTeamSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Posisi pengajuan tim saat ini'**
  String get kpiPipelineTeamSubtitle;

  /// No description provided for @kpiPipelineMineTitle.
  ///
  /// In id, this message translates to:
  /// **'Status pengajuan saya'**
  String get kpiPipelineMineTitle;

  /// No description provided for @kpiPipelineMineSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Semua pengajuan yang pernah diajukan'**
  String get kpiPipelineMineSubtitle;

  /// No description provided for @kpiPipelineEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada pengajuan yang diajukan.'**
  String get kpiPipelineEmpty;

  /// No description provided for @kpiCategoriesTitle.
  ///
  /// In id, this message translates to:
  /// **'Komposisi biaya per kategori'**
  String get kpiCategoriesTitle;

  /// No description provided for @kpiCategoriesSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Dicairkan {from} – sekarang'**
  String kpiCategoriesSubtitle(String from);

  /// No description provided for @kpiCategoriesSubtitleTeam.
  ///
  /// In id, this message translates to:
  /// **'Dicairkan 6 bulan terakhir, tim Anda'**
  String get kpiCategoriesSubtitleTeam;

  /// No description provided for @kpiCategoriesSubtitleFinance.
  ///
  /// In id, this message translates to:
  /// **'Dicairkan 6 bulan terakhir'**
  String get kpiCategoriesSubtitleFinance;

  /// No description provided for @kpiCategoriesEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada biaya yang dicairkan di rentang ini.'**
  String get kpiCategoriesEmpty;

  /// No description provided for @kpiSlaTitle.
  ///
  /// In id, this message translates to:
  /// **'SLA transfer'**
  String get kpiSlaTitle;

  /// No description provided for @kpiSlaSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Disetujui → ditransfer, bulan ini'**
  String get kpiSlaSubtitle;

  /// No description provided for @kpiSlaSubtitleTarget.
  ///
  /// In id, this message translates to:
  /// **'Disetujui → ditransfer, bulan ini · target {hours} jam'**
  String kpiSlaSubtitleTarget(int hours);

  /// No description provided for @kpiSlaOf.
  ///
  /// In id, this message translates to:
  /// **'dari {count} transfer dalam SLA'**
  String kpiSlaOf(int count);

  /// No description provided for @kpiSlaNone.
  ///
  /// In id, this message translates to:
  /// **'Belum ada transfer bulan ini.'**
  String get kpiSlaNone;

  /// No description provided for @kpiSlaAvgLate.
  ///
  /// In id, this message translates to:
  /// **'Rata-rata {avg} · terlambat {late}'**
  String kpiSlaAvgLate(String avg, int late);

  /// No description provided for @kpiRapMonitorTitle.
  ///
  /// In id, this message translates to:
  /// **'Monitoring RAP'**
  String get kpiRapMonitorTitle;

  /// No description provided for @kpiRapMonitorSubtitle.
  ///
  /// In id, this message translates to:
  /// **'{projects} project ber-RAP · {over} dengan item melebihi RAP'**
  String kpiRapMonitorSubtitle(int projects, int over);

  /// No description provided for @kpiRapMonitorSubtitleEmpty.
  ///
  /// In id, this message translates to:
  /// **'Realisasi pengajuan per item RAP'**
  String get kpiRapMonitorSubtitleEmpty;

  /// No description provided for @kpiRapMonitorEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada project dengan RAP.'**
  String get kpiRapMonitorEmpty;

  /// No description provided for @kpiRapRealised.
  ///
  /// In id, this message translates to:
  /// **'Realisasi {realised} dari rencana {planned}'**
  String kpiRapRealised(String realised, String planned);

  /// No description provided for @kpiRapOverItems.
  ///
  /// In id, this message translates to:
  /// **'{count} item melebihi RAP'**
  String kpiRapOverItems(int count);

  /// No description provided for @kpiRapSafe.
  ///
  /// In id, this message translates to:
  /// **'Aman'**
  String get kpiRapSafe;

  /// No description provided for @kpiLoansTitle.
  ///
  /// In id, this message translates to:
  /// **'Pinjaman antar project'**
  String get kpiLoansTitle;

  /// No description provided for @kpiLoansSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Sisa {outstanding} · {overdue} terlambat · {pending} menunggu persetujuan'**
  String kpiLoansSubtitle(String outstanding, int overdue, int pending);

  /// No description provided for @kpiLoansOverdueSum.
  ///
  /// In id, this message translates to:
  /// **'Terlambat {amount}'**
  String kpiLoansOverdueSum(String amount);

  /// No description provided for @kpiLoansWaiting.
  ///
  /// In id, this message translates to:
  /// **'{count} pinjaman menunggu keputusan Anda'**
  String kpiLoansWaiting(int count);

  /// No description provided for @kpiLoansEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada pinjaman antar project yang disetujui.'**
  String get kpiLoansEmpty;

  /// No description provided for @kpiLoanRow.
  ///
  /// In id, this message translates to:
  /// **'Diterima (sisa) {borrowed} · Diberikan (sisa) {lent}'**
  String kpiLoanRow(String borrowed, String lent);

  /// No description provided for @kpiLoanOverdue.
  ///
  /// In id, this message translates to:
  /// **'{count} terlambat · {amount}'**
  String kpiLoanOverdue(int count, String amount);

  /// No description provided for @kpiLoanOnTime.
  ///
  /// In id, this message translates to:
  /// **'Tepat waktu'**
  String get kpiLoanOnTime;

  /// No description provided for @kpiRapMissingTitle.
  ///
  /// In id, this message translates to:
  /// **'Project ber-RAB belum punya RAP'**
  String get kpiRapMissingTitle;

  /// No description provided for @kpiRapMissingTeamTitle.
  ///
  /// In id, this message translates to:
  /// **'Project Anda belum punya RAP'**
  String get kpiRapMissingTeamTitle;

  /// No description provided for @kpiRapMissingSubtitle.
  ///
  /// In id, this message translates to:
  /// **'{count} project · pengajuan project ini belum bisa dikirim sampai RAP diisi (minta PM mengisi)'**
  String kpiRapMissingSubtitle(int count);

  /// No description provided for @kpiRapMissingTeamSubtitle.
  ///
  /// In id, this message translates to:
  /// **'{count} project · pengajuan project ini belum bisa dikirim sampai RAP diisi'**
  String kpiRapMissingTeamSubtitle(int count);

  /// No description provided for @kpiRapMissingBudget.
  ///
  /// In id, this message translates to:
  /// **'{kind} · RAB {budget}'**
  String kpiRapMissingBudget(String kind, String budget);

  /// No description provided for @kpiRapFill.
  ///
  /// In id, this message translates to:
  /// **'Isi RAP'**
  String get kpiRapFill;

  /// No description provided for @kpiTrendTitle.
  ///
  /// In id, this message translates to:
  /// **'Tren pengajuan'**
  String get kpiTrendTitle;

  /// No description provided for @kpiTrendSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Jumlah pengajuan per bulan (tanggal pengajuan). Ketuk bulan untuk melihat angkanya.'**
  String get kpiTrendSubtitle;

  /// No description provided for @kpiTrendTeamTitle.
  ///
  /// In id, this message translates to:
  /// **'Tren pengajuan tim'**
  String get kpiTrendTeamTitle;

  /// No description provided for @kpiTrendTeamSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Jumlah pengajuan per bulan, 6 bulan. Ketuk bulan untuk melihat angkanya.'**
  String get kpiTrendTeamSubtitle;

  /// No description provided for @kpiTrendMineTitle.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan saya per bulan'**
  String get kpiTrendMineTitle;

  /// No description provided for @kpiTrendMineSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Jumlah dan nilai pengajuan saya, 6 bulan, tanpa draft. Ketuk bulan untuk melihat angkanya.'**
  String get kpiTrendMineSubtitle;

  /// No description provided for @kpiTrendEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada pengajuan di rentang ini.'**
  String get kpiTrendEmpty;

  /// No description provided for @kpiTrendReadout.
  ///
  /// In id, this message translates to:
  /// **'{period}: {count} pengajuan'**
  String kpiTrendReadout(String period, int count);

  /// No description provided for @kpiTrendReadoutSum.
  ///
  /// In id, this message translates to:
  /// **'{period}: {count} pengajuan · {amount}'**
  String kpiTrendReadoutSum(String period, int count, String amount);

  /// No description provided for @kpiAccountsTitle.
  ///
  /// In id, this message translates to:
  /// **'Saldo per akun'**
  String get kpiAccountsTitle;

  /// No description provided for @kpiAccountsSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Akun nonaktif bersaldo 0 disembunyikan'**
  String get kpiAccountsSubtitle;

  /// No description provided for @kpiAccountsEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada akun kas.'**
  String get kpiAccountsEmpty;

  /// No description provided for @kpiAccountInactive.
  ///
  /// In id, this message translates to:
  /// **'{name} (nonaktif)'**
  String kpiAccountInactive(String name);

  /// No description provided for @kpiAccountMonth.
  ///
  /// In id, this message translates to:
  /// **'Bulan ini masuk {cashIn} · keluar {cashOut}'**
  String kpiAccountMonth(String cashIn, String cashOut);

  /// No description provided for @kpiCompletenessTitle.
  ///
  /// In id, this message translates to:
  /// **'Kelengkapan nota/LPJ'**
  String get kpiCompletenessTitle;

  /// No description provided for @kpiCompletenessRatio.
  ///
  /// In id, this message translates to:
  /// **'pengajuan baru bulan ini sudah LPJ'**
  String get kpiCompletenessRatio;

  /// No description provided for @kpiCompletenessOverdue.
  ///
  /// In id, this message translates to:
  /// **'{count} LPJ terlambat'**
  String kpiCompletenessOverdue(int count);

  /// No description provided for @kpiCompletenessNoneOverdue.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada LPJ terlambat'**
  String get kpiCompletenessNoneOverdue;

  /// No description provided for @kpiCompletenessWithoutLpj.
  ///
  /// In id, this message translates to:
  /// **'{count} pengajuan baru belum LPJ'**
  String kpiCompletenessWithoutLpj(int count);

  /// No description provided for @kpiCompletenessReimburse.
  ///
  /// In id, this message translates to:
  /// **'{count} nota reimburse menunggu verifikasi'**
  String kpiCompletenessReimburse(int count);

  /// No description provided for @kpiCompletenessWarnings.
  ///
  /// In id, this message translates to:
  /// **'{count} flag peringatan terbuka'**
  String kpiCompletenessWarnings(int count);

  /// No description provided for @kpiRecentCashTitle.
  ///
  /// In id, this message translates to:
  /// **'Transaksi kas terbaru'**
  String get kpiRecentCashTitle;

  /// No description provided for @kpiRecentCashSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Buku kas, termasuk void & jurnal balik'**
  String get kpiRecentCashSubtitle;

  /// No description provided for @kpiRecentCashEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada transaksi kas.'**
  String get kpiRecentCashEmpty;

  /// No description provided for @kpiVoid.
  ///
  /// In id, this message translates to:
  /// **'Void'**
  String get kpiVoid;

  /// No description provided for @kpiCostCentersTitle.
  ///
  /// In id, this message translates to:
  /// **'Pusat biaya bulan ini'**
  String get kpiCostCentersTitle;

  /// No description provided for @kpiCostCentersTeamTitle.
  ///
  /// In id, this message translates to:
  /// **'Pusat biaya saya bulan ini'**
  String get kpiCostCentersTeamTitle;

  /// No description provided for @kpiCostCentersEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada biaya pusat biaya bulan ini.'**
  String get kpiCostCentersEmpty;

  /// No description provided for @kpiAdvancesTitle.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan baru belum LPJ'**
  String get kpiAdvancesTitle;

  /// No description provided for @kpiAdvancesSubtitle.
  ///
  /// In id, this message translates to:
  /// **'Terlambat bila lebih dari {days} hari sejak transfer pertama'**
  String kpiAdvancesSubtitle(int days);

  /// No description provided for @kpiAdvancesEmpty.
  ///
  /// In id, this message translates to:
  /// **'Semua pengajuan baru sudah ber-LPJ.'**
  String get kpiAdvancesEmpty;

  /// No description provided for @kpiAdvanceAge.
  ///
  /// In id, this message translates to:
  /// **'{days} hr'**
  String kpiAdvanceAge(int days);

  /// No description provided for @kpiAdvanceLate.
  ///
  /// In id, this message translates to:
  /// **'{days} hr terlambat'**
  String kpiAdvanceLate(int days);

  /// No description provided for @kpiPeriodCloseTitle.
  ///
  /// In id, this message translates to:
  /// **'Tutup buku'**
  String get kpiPeriodCloseTitle;

  /// No description provided for @kpiPeriodClosed.
  ///
  /// In id, this message translates to:
  /// **'Bulan terakhir ditutup: {period}'**
  String kpiPeriodClosed(String period);

  /// No description provided for @kpiPeriodNever.
  ///
  /// In id, this message translates to:
  /// **'Belum pernah tutup buku.'**
  String get kpiPeriodNever;

  /// No description provided for @kpiPeriodNext.
  ///
  /// In id, this message translates to:
  /// **'Bulan yang bisa ditutup: {period} (bulan lampau saja).'**
  String kpiPeriodNext(String period);

  /// No description provided for @kpiMyActions.
  ///
  /// In id, this message translates to:
  /// **'Perlu tindakan saya'**
  String get kpiMyActions;

  /// No description provided for @kpiMyActionsNone.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada yang perlu Anda kerjakan'**
  String get kpiMyActionsNone;

  /// No description provided for @kpiMyActionsHint.
  ///
  /// In id, this message translates to:
  /// **'draft, revisi, nota atau LPJ'**
  String get kpiMyActionsHint;

  /// No description provided for @kpiMyProcess.
  ///
  /// In id, this message translates to:
  /// **'Sedang diproses'**
  String get kpiMyProcess;

  /// No description provided for @kpiMyProcessWaiting.
  ///
  /// In id, this message translates to:
  /// **'menunggu persetujuan {count}'**
  String kpiMyProcessWaiting(int count);

  /// No description provided for @kpiMyMonth.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan {month}'**
  String kpiMyMonth(String month);

  /// No description provided for @kpiMyLatestTitle.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan terbaru saya'**
  String get kpiMyLatestTitle;

  /// No description provided for @kpiMyLatestSubtitle.
  ///
  /// In id, this message translates to:
  /// **'10 terbaru · nominal = grand total'**
  String get kpiMyLatestSubtitle;

  /// No description provided for @kpiMyLatestEmpty.
  ///
  /// In id, this message translates to:
  /// **'Anda belum punya pengajuan.'**
  String get kpiMyLatestEmpty;

  /// No description provided for @kpiMyDraftTitle.
  ///
  /// In id, this message translates to:
  /// **'Draft \"{title}\"'**
  String kpiMyDraftTitle(String title);

  /// No description provided for @kpiMyDone.
  ///
  /// In id, this message translates to:
  /// **'Selesai'**
  String get kpiMyDone;

  /// No description provided for @kpiMyExit.
  ///
  /// In id, this message translates to:
  /// **'{count} ditolak/dibatalkan'**
  String kpiMyExit(int count);

  /// No description provided for @kpiAdminUsers.
  ///
  /// In id, this message translates to:
  /// **'User tanpa karyawan/peran'**
  String get kpiAdminUsers;

  /// No description provided for @kpiAdminProjects.
  ///
  /// In id, this message translates to:
  /// **'Project tanpa PM'**
  String get kpiAdminProjects;

  /// No description provided for @kpiAdminCostCenters.
  ///
  /// In id, this message translates to:
  /// **'Pusat biaya tanpa penanggung jawab'**
  String get kpiAdminCostCenters;

  /// No description provided for @kpiAdminComplete.
  ///
  /// In id, this message translates to:
  /// **'Lengkap'**
  String get kpiAdminComplete;

  /// No description provided for @kpiAdminIncomplete.
  ///
  /// In id, this message translates to:
  /// **'Perlu dilengkapi'**
  String get kpiAdminIncomplete;

  /// No description provided for @kpiAdminWebHint.
  ///
  /// In id, this message translates to:
  /// **'Lengkapi data master dan lihat audit log di web admin.'**
  String get kpiAdminWebHint;

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
  /// **'Lokasi (site / project / pusat biaya)'**
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

  /// No description provided for @siteSite.
  ///
  /// In id, this message translates to:
  /// **'Site'**
  String get siteSite;

  /// No description provided for @siteHome.
  ///
  /// In id, this message translates to:
  /// **'Site penempatan'**
  String get siteHome;

  /// No description provided for @siteHomeBadge.
  ///
  /// In id, this message translates to:
  /// **'Penempatan'**
  String get siteHomeBadge;

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

  /// No description provided for @onBehalfDisabled.
  ///
  /// In id, this message translates to:
  /// **'Absen atas nama belum bisa: absensi dari aplikasi belum diaktifkan Admin (Setting perusahaan).'**
  String get onBehalfDisabled;

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

  /// No description provided for @addendumEdit.
  ///
  /// In id, this message translates to:
  /// **'Ubah draft'**
  String get addendumEdit;

  /// No description provided for @addendumEditTitle.
  ///
  /// In id, this message translates to:
  /// **'Ubah draft addendum'**
  String get addendumEditTitle;

  /// No description provided for @addendumSaveChanges.
  ///
  /// In id, this message translates to:
  /// **'Simpan perubahan'**
  String get addendumSaveChanges;

  /// No description provided for @addendumSaveAndSubmit.
  ///
  /// In id, this message translates to:
  /// **'Simpan & ajukan'**
  String get addendumSaveAndSubmit;

  /// No description provided for @addendumEdited.
  ///
  /// In id, this message translates to:
  /// **'Perubahan draft addendum tersimpan.'**
  String get addendumEdited;

  /// No description provided for @addendumNotEditable.
  ///
  /// In id, this message translates to:
  /// **'Addendum ini sudah tidak bisa diubah (bukan Draft lagi atau bukan milik Anda).'**
  String get addendumNotEditable;

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

  /// No description provided for @companyAll.
  ///
  /// In id, this message translates to:
  /// **'Semua PT'**
  String get companyAll;

  /// No description provided for @companyAllMine.
  ///
  /// In id, this message translates to:
  /// **'Semua PT saya'**
  String get companyAllMine;

  /// No description provided for @companySwitcherTitle.
  ///
  /// In id, this message translates to:
  /// **'Pilih PT'**
  String get companySwitcherTitle;

  /// No description provided for @companySwitcherHint.
  ///
  /// In id, this message translates to:
  /// **'Daftar, persetujuan dan ringkasan mengikuti PT yang dipilih. Draft & antrean offline tetap tersimpan di PT masing-masing.'**
  String get companySwitcherHint;

  /// No description provided for @companySwitcherApply.
  ///
  /// In id, this message translates to:
  /// **'Terapkan'**
  String get companySwitcherApply;

  /// No description provided for @companySwitcherNone.
  ///
  /// In id, this message translates to:
  /// **'Pilih minimal satu PT.'**
  String get companySwitcherNone;

  /// No description provided for @companySwitcherTooltip.
  ///
  /// In id, this message translates to:
  /// **'Ganti PT'**
  String get companySwitcherTooltip;

  /// No description provided for @companySwitcherMore.
  ///
  /// In id, this message translates to:
  /// **'{code}+{more}'**
  String companySwitcherMore(String code, int more);

  /// No description provided for @companySwitcherApplied.
  ///
  /// In id, this message translates to:
  /// **'Tampilan: {label}'**
  String companySwitcherApplied(String label);

  /// No description provided for @profileCompanies.
  ///
  /// In id, this message translates to:
  /// **'PT aktif'**
  String get profileCompanies;

  /// No description provided for @profileCompanyRoles.
  ///
  /// In id, this message translates to:
  /// **'{code} — {roles}'**
  String profileCompanyRoles(String code, String roles);

  /// No description provided for @companyPickTitle.
  ///
  /// In id, this message translates to:
  /// **'Untuk PT mana?'**
  String get companyPickTitle;

  /// No description provided for @companyPickHint.
  ///
  /// In id, this message translates to:
  /// **'Project, pusat biaya, kategori dan rekening diambil dari data PT ini.'**
  String get companyPickHint;

  /// No description provided for @companyPickNone.
  ///
  /// In id, this message translates to:
  /// **'Anda tidak bisa membuat pengajuan di PT yang dipilih. Ganti PT di beranda.'**
  String get companyPickNone;

  /// No description provided for @draftCompany.
  ///
  /// In id, this message translates to:
  /// **'PT'**
  String get draftCompany;

  /// No description provided for @companyNeedsChoiceBanner.
  ///
  /// In id, this message translates to:
  /// **'{count} data offline belum punya PT — pilih PT agar bisa dikirim'**
  String companyNeedsChoiceBanner(int count);

  /// No description provided for @companyNeedsChoiceTitle.
  ///
  /// In id, this message translates to:
  /// **'Pilih PT untuk data offline'**
  String get companyNeedsChoiceTitle;

  /// No description provided for @companyNeedsChoiceHint.
  ///
  /// In id, this message translates to:
  /// **'Data ini dibuat sebelum aplikasi mendukung beberapa PT. Pilih PT yang benar untuk setiap data; data tidak dikirim sebelum PT dipilih.'**
  String get companyNeedsChoiceHint;

  /// No description provided for @companyNeedsChoiceAction.
  ///
  /// In id, this message translates to:
  /// **'Pilih PT'**
  String get companyNeedsChoiceAction;

  /// No description provided for @companyAssigned.
  ///
  /// In id, this message translates to:
  /// **'PT disimpan. Data akan dikirim.'**
  String get companyAssigned;

  /// No description provided for @lpjQueueTitle.
  ///
  /// In id, this message translates to:
  /// **'LPJ menunggu verifikasi'**
  String get lpjQueueTitle;

  /// No description provided for @lpjQueueCount.
  ///
  /// In id, this message translates to:
  /// **'{count} LPJ'**
  String lpjQueueCount(int count);

  /// No description provided for @privacyTitle.
  ///
  /// In id, this message translates to:
  /// **'Pemberitahuan privasi'**
  String get privacyTitle;

  /// No description provided for @privacyIntro.
  ///
  /// In id, this message translates to:
  /// **'Baca bagaimana data Anda (termasuk selfie dan lokasi saat absen) dipakai dan disimpan.'**
  String get privacyIntro;

  /// No description provided for @privacyAcknowledge.
  ///
  /// In id, this message translates to:
  /// **'Saya mengerti'**
  String get privacyAcknowledge;

  /// No description provided for @privacyLater.
  ///
  /// In id, this message translates to:
  /// **'Nanti'**
  String get privacyLater;

  /// No description provided for @privacyLaterHint.
  ///
  /// In id, this message translates to:
  /// **'Absensi tetap terkunci sampai Anda menekan \"Saya mengerti\". Pemberitahuan ini muncul lagi saat aplikasi dibuka berikutnya.'**
  String get privacyLaterHint;

  /// No description provided for @privacySending.
  ///
  /// In id, this message translates to:
  /// **'Mengirim…'**
  String get privacySending;

  /// No description provided for @privacyAckDone.
  ///
  /// In id, this message translates to:
  /// **'Terima kasih. Pemberitahuan privasi sudah tercatat dibaca.'**
  String get privacyAckDone;

  /// No description provided for @privacyAckOffline.
  ///
  /// In id, this message translates to:
  /// **'Belum terkirim: tidak ada koneksi. Dikirim ulang otomatis saat online — absensi tetap terkunci sampai terkirim.'**
  String get privacyAckOffline;

  /// No description provided for @privacyAckVersionChanged.
  ///
  /// In id, this message translates to:
  /// **'Pemberitahuan privasi sudah diperbarui. Bacalah versi terbaru lalu tekan \"Saya mengerti\" lagi.'**
  String get privacyAckVersionChanged;

  /// No description provided for @privacyAckUnavailable.
  ///
  /// In id, this message translates to:
  /// **'Server belum mendukung pemberitahuan privasi. Tidak ada yang perlu dikonfirmasi.'**
  String get privacyAckUnavailable;

  /// No description provided for @privacyRetry.
  ///
  /// In id, this message translates to:
  /// **'Coba lagi'**
  String get privacyRetry;

  /// No description provided for @privacyContinue.
  ///
  /// In id, this message translates to:
  /// **'Lanjut'**
  String get privacyContinue;

  /// No description provided for @privacyClose.
  ///
  /// In id, this message translates to:
  /// **'Tutup'**
  String get privacyClose;

  /// No description provided for @privacyNotAvailable.
  ///
  /// In id, this message translates to:
  /// **'Pemberitahuan privasi belum tersedia di server ini.'**
  String get privacyNotAvailable;

  /// No description provided for @privacyNoticeOffline.
  ///
  /// In id, this message translates to:
  /// **'Pemberitahuan privasi belum tersimpan di HP ini. Sambungkan ke internet untuk membacanya.'**
  String get privacyNoticeOffline;

  /// No description provided for @privacyAcknowledgedOn.
  ///
  /// In id, this message translates to:
  /// **'Sudah Anda baca (versi {version}, {date}).'**
  String privacyAcknowledgedOn(int version, String date);

  /// No description provided for @privacyNotAcknowledged.
  ///
  /// In id, this message translates to:
  /// **'Belum Anda baca — absensi terkunci.'**
  String get privacyNotAcknowledged;

  /// No description provided for @privacyOutdated.
  ///
  /// In id, this message translates to:
  /// **'Ada versi baru (versi {version}) — baca dan tekan \"Saya mengerti\".'**
  String privacyOutdated(int version);

  /// No description provided for @privacyAttendanceBlocked.
  ///
  /// In id, this message translates to:
  /// **'Absensi (selfie dan lokasi) belum bisa dipakai. Baca pemberitahuan privasi lalu tekan \"Saya mengerti\".'**
  String get privacyAttendanceBlocked;

  /// No description provided for @privacyRead.
  ///
  /// In id, this message translates to:
  /// **'Baca pemberitahuan privasi'**
  String get privacyRead;

  /// No description provided for @fieldHubTitle.
  ///
  /// In id, this message translates to:
  /// **'Laporan Lapangan'**
  String get fieldHubTitle;

  /// No description provided for @fieldHubSub.
  ///
  /// In id, this message translates to:
  /// **'Servis unit, timesheet, aftersales'**
  String get fieldHubSub;

  /// No description provided for @fieldPendingCount.
  ///
  /// In id, this message translates to:
  /// **'{count} belum terkirim'**
  String fieldPendingCount(int count);

  /// No description provided for @fieldTabNew.
  ///
  /// In id, this message translates to:
  /// **'Buat laporan'**
  String get fieldTabNew;

  /// No description provided for @fieldTabHistory.
  ///
  /// In id, this message translates to:
  /// **'Riwayat saya'**
  String get fieldTabHistory;

  /// No description provided for @fieldOfflineCache.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada sinyal: data unit, kontrak dan PO dari penyimpanan HP (bisa belum terbaru). Laporan tetap bisa dibuat dan dikirim otomatis saat ada sinyal.'**
  String get fieldOfflineCache;

  /// No description provided for @fieldNoProjectsHub.
  ///
  /// In id, this message translates to:
  /// **'Belum ada project kontrak unit atau aftersales yang ditugaskan ke Anda. Hubungi PM/Admin bila ini keliru.'**
  String get fieldNoProjectsHub;

  /// No description provided for @fieldLocalTitle.
  ///
  /// In id, this message translates to:
  /// **'Di HP ini'**
  String get fieldLocalTitle;

  /// No description provided for @fieldServerTitle.
  ///
  /// In id, this message translates to:
  /// **'Terkirim ke server'**
  String get fieldServerTitle;

  /// No description provided for @fieldHistoryOffline.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada sinyal — riwayat dari server tampil saat online.'**
  String get fieldHistoryOffline;

  /// No description provided for @fieldHistoryEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada laporan lapangan Anda.'**
  String get fieldHistoryEmpty;

  /// No description provided for @fieldEditTag.
  ///
  /// In id, this message translates to:
  /// **'Ubah {doc}'**
  String fieldEditTag(String doc);

  /// No description provided for @fieldConflictHint.
  ///
  /// In id, this message translates to:
  /// **'Sudah ada perubahan di server. Ketuk untuk memilih versi yang dipakai.'**
  String get fieldConflictHint;

  /// No description provided for @fieldEditableTag.
  ///
  /// In id, this message translates to:
  /// **'Bisa diubah ≤ 24 jam'**
  String get fieldEditableTag;

  /// No description provided for @fieldFlagOffline.
  ///
  /// In id, this message translates to:
  /// **'Offline'**
  String get fieldFlagOffline;

  /// No description provided for @fieldFlagBackdated.
  ///
  /// In id, this message translates to:
  /// **'Tanggal mundur'**
  String get fieldFlagBackdated;

  /// No description provided for @fieldFlagHmGap.
  ///
  /// In id, this message translates to:
  /// **'Selisih HM'**
  String get fieldFlagHmGap;

  /// No description provided for @fieldFlagBreakdown.
  ///
  /// In id, this message translates to:
  /// **'Breakdown ≥ 4 jam'**
  String get fieldFlagBreakdown;

  /// No description provided for @fieldFlagCorrected.
  ///
  /// In id, this message translates to:
  /// **'Dikoreksi'**
  String get fieldFlagCorrected;

  /// No description provided for @fieldValueShown.
  ///
  /// In id, this message translates to:
  /// **'Nilai: {value}'**
  String fieldValueShown(String value);

  /// No description provided for @fieldReporter.
  ///
  /// In id, this message translates to:
  /// **'Pelapor: {name}'**
  String fieldReporter(String name);

  /// No description provided for @fieldEditUntil.
  ///
  /// In id, this message translates to:
  /// **'Ubah (sampai {time})'**
  String fieldEditUntil(String time);

  /// No description provided for @fieldNotEditable.
  ///
  /// In id, this message translates to:
  /// **'Sudah lewat 24 jam: perubahan hanya lewat koreksi PM/Direktur di web.'**
  String get fieldNotEditable;

  /// No description provided for @fieldNotFound.
  ///
  /// In id, this message translates to:
  /// **'Laporan tidak ditemukan di HP ini.'**
  String get fieldNotFound;

  /// No description provided for @fieldStateDraft.
  ///
  /// In id, this message translates to:
  /// **'Draft'**
  String get fieldStateDraft;

  /// No description provided for @fieldStateQueued.
  ///
  /// In id, this message translates to:
  /// **'Menunggu sinyal'**
  String get fieldStateQueued;

  /// No description provided for @fieldStateSent.
  ///
  /// In id, this message translates to:
  /// **'Terkirim'**
  String get fieldStateSent;

  /// No description provided for @fieldStateConflict.
  ///
  /// In id, this message translates to:
  /// **'Konflik'**
  String get fieldStateConflict;

  /// No description provided for @fieldStateRejected.
  ///
  /// In id, this message translates to:
  /// **'Ditolak'**
  String get fieldStateRejected;

  /// No description provided for @fieldDraftSaved.
  ///
  /// In id, this message translates to:
  /// **'Draft tersimpan'**
  String get fieldDraftSaved;

  /// No description provided for @fieldQueuedOnline.
  ///
  /// In id, this message translates to:
  /// **'Laporan disimpan dan sedang dikirim.'**
  String get fieldQueuedOnline;

  /// No description provided for @fieldQueuedOffline.
  ///
  /// In id, this message translates to:
  /// **'Laporan disimpan di HP dan dikirim otomatis saat ada sinyal.'**
  String get fieldQueuedOffline;

  /// No description provided for @fieldFixErrors.
  ///
  /// In id, this message translates to:
  /// **'Periksa isian yang ditandai merah.'**
  String get fieldFixErrors;

  /// No description provided for @fieldDiscardTitle.
  ///
  /// In id, this message translates to:
  /// **'Hapus draft?'**
  String get fieldDiscardTitle;

  /// No description provided for @fieldDiscardBody.
  ///
  /// In id, this message translates to:
  /// **'Draft dan fotonya dihapus dari HP ini. Server belum menerima laporan ini.'**
  String get fieldDiscardBody;

  /// No description provided for @fieldDiscarded.
  ///
  /// In id, this message translates to:
  /// **'Draft dihapus.'**
  String get fieldDiscarded;

  /// No description provided for @fieldPhotoFailed.
  ///
  /// In id, this message translates to:
  /// **'Foto gagal disimpan. Coba lagi.'**
  String get fieldPhotoFailed;

  /// No description provided for @fieldAddPhoto.
  ///
  /// In id, this message translates to:
  /// **'Ambil foto'**
  String get fieldAddPhoto;

  /// No description provided for @fieldEditWindow.
  ///
  /// In id, this message translates to:
  /// **'Bisa diubah sampai {time}.'**
  String fieldEditWindow(String time);

  /// No description provided for @fieldEditReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan perubahan (opsional)'**
  String get fieldEditReason;

  /// No description provided for @fieldEditReasonHelp.
  ///
  /// In id, this message translates to:
  /// **'Tercatat di riwayat audit.'**
  String get fieldEditReasonHelp;

  /// No description provided for @fieldSaveEdit.
  ///
  /// In id, this message translates to:
  /// **'Simpan perubahan'**
  String get fieldSaveEdit;

  /// No description provided for @fieldReportNotes.
  ///
  /// In id, this message translates to:
  /// **'Catatan'**
  String get fieldReportNotes;

  /// No description provided for @fieldDate.
  ///
  /// In id, this message translates to:
  /// **'Tanggal'**
  String get fieldDate;

  /// No description provided for @fieldProjectContract.
  ///
  /// In id, this message translates to:
  /// **'Project / kontrak'**
  String get fieldProjectContract;

  /// No description provided for @fieldNoProjects.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada project kontrak unit / aftersales untuk Anda.'**
  String get fieldNoProjects;

  /// No description provided for @fieldProjectUnavailable.
  ///
  /// In id, this message translates to:
  /// **'Project ini tidak lagi tersedia untuk laporan lapangan Anda (penugasan atau jenis project berubah).'**
  String get fieldProjectUnavailable;

  /// No description provided for @fieldUnit.
  ///
  /// In id, this message translates to:
  /// **'Unit'**
  String get fieldUnit;

  /// No description provided for @fieldPickUnit.
  ///
  /// In id, this message translates to:
  /// **'Pilih unit'**
  String get fieldPickUnit;

  /// No description provided for @fieldChoose.
  ///
  /// In id, this message translates to:
  /// **'Pilih'**
  String get fieldChoose;

  /// No description provided for @fieldChange.
  ///
  /// In id, this message translates to:
  /// **'Ganti'**
  String get fieldChange;

  /// No description provided for @fieldNoUnits.
  ///
  /// In id, this message translates to:
  /// **'Belum ada unit untuk project ini di HP. Buka saat online untuk memuat data unit.'**
  String get fieldNoUnits;

  /// No description provided for @fieldUnitSearch.
  ///
  /// In id, this message translates to:
  /// **'Cari kode unit / plat / tipe'**
  String get fieldUnitSearch;

  /// No description provided for @fieldUnitNone.
  ///
  /// In id, this message translates to:
  /// **'Unit tidak ditemukan.'**
  String get fieldUnitNone;

  /// No description provided for @fieldUnitOwnerOwn.
  ///
  /// In id, this message translates to:
  /// **'Milik sendiri'**
  String get fieldUnitOwnerOwn;

  /// No description provided for @fieldUnitOwnerCustomer.
  ///
  /// In id, this message translates to:
  /// **'Milik pelanggan ({name})'**
  String fieldUnitOwnerCustomer(String name);

  /// No description provided for @fieldUnitLastHm.
  ///
  /// In id, this message translates to:
  /// **'HM terakhir {hm}'**
  String fieldUnitLastHm(String hm);

  /// No description provided for @fieldHmAtService.
  ///
  /// In id, this message translates to:
  /// **'HM saat servis'**
  String get fieldHmAtService;

  /// No description provided for @fieldHmLast.
  ///
  /// In id, this message translates to:
  /// **'HM terakhir unit {hm}'**
  String fieldHmLast(String hm);

  /// No description provided for @fieldHmBelow.
  ///
  /// In id, this message translates to:
  /// **'Lebih kecil dari HM terakhir unit ({hm}). Server akan menolak; koreksi HM lama oleh PM/Direktur.'**
  String fieldHmBelow(String hm);

  /// No description provided for @fieldStart.
  ///
  /// In id, this message translates to:
  /// **'Mulai'**
  String get fieldStart;

  /// No description provided for @fieldEnd.
  ///
  /// In id, this message translates to:
  /// **'Selesai'**
  String get fieldEnd;

  /// No description provided for @fieldWork.
  ///
  /// In id, this message translates to:
  /// **'Pekerjaan'**
  String get fieldWork;

  /// No description provided for @fieldServiceType.
  ///
  /// In id, this message translates to:
  /// **'Jenis servis'**
  String get fieldServiceType;

  /// No description provided for @fieldComplaint.
  ///
  /// In id, this message translates to:
  /// **'Keluhan'**
  String get fieldComplaint;

  /// No description provided for @fieldAction.
  ///
  /// In id, this message translates to:
  /// **'Tindakan / pekerjaan'**
  String get fieldAction;

  /// No description provided for @fieldHelpers.
  ///
  /// In id, this message translates to:
  /// **'Helper (opsional)'**
  String get fieldHelpers;

  /// No description provided for @fieldSpareparts.
  ///
  /// In id, this message translates to:
  /// **'Sparepart dipakai'**
  String get fieldSpareparts;

  /// No description provided for @fieldPartNameHeader.
  ///
  /// In id, this message translates to:
  /// **'Nama / no. part'**
  String get fieldPartNameHeader;

  /// No description provided for @fieldPartNameHint.
  ///
  /// In id, this message translates to:
  /// **'Nama sparepart'**
  String get fieldPartNameHint;

  /// No description provided for @fieldPartNoHint.
  ///
  /// In id, this message translates to:
  /// **'No. part (opsional)'**
  String get fieldPartNoHint;

  /// No description provided for @fieldUomHint.
  ///
  /// In id, this message translates to:
  /// **'set'**
  String get fieldUomHint;

  /// No description provided for @fieldAddSparepart.
  ///
  /// In id, this message translates to:
  /// **'Tambah sparepart'**
  String get fieldAddSparepart;

  /// No description provided for @fieldSparepartsNote.
  ///
  /// In id, this message translates to:
  /// **'Catatan saja — stok sparepart tidak dikelola di aplikasi.'**
  String get fieldSparepartsNote;

  /// No description provided for @fieldUnitStatusAfter.
  ///
  /// In id, this message translates to:
  /// **'Status unit setelah servis'**
  String get fieldUnitStatusAfter;

  /// No description provided for @fieldPmNotified.
  ///
  /// In id, this message translates to:
  /// **'PM akan diberi notifikasi: unit {unit} menunggu part.'**
  String fieldPmNotified(String unit);

  /// No description provided for @fieldPhotos.
  ///
  /// In id, this message translates to:
  /// **'Foto'**
  String get fieldPhotos;

  /// No description provided for @fieldPhotoBefore.
  ///
  /// In id, this message translates to:
  /// **'Foto sebelum servis'**
  String get fieldPhotoBefore;

  /// No description provided for @fieldPhotoAfter.
  ///
  /// In id, this message translates to:
  /// **'Foto sesudah servis'**
  String get fieldPhotoAfter;

  /// No description provided for @fieldPhotoBeforeCount.
  ///
  /// In id, this message translates to:
  /// **'Sebelum ({count})'**
  String fieldPhotoBeforeCount(int count);

  /// No description provided for @fieldPhotoAfterCount.
  ///
  /// In id, this message translates to:
  /// **'Sesudah ({count})'**
  String fieldPhotoAfterCount(int count);

  /// No description provided for @fieldPhotoLimit.
  ///
  /// In id, this message translates to:
  /// **'Maksimal {max} foto per laporan.'**
  String fieldPhotoLimit(int max);

  /// No description provided for @fieldPhotosOnServer.
  ///
  /// In id, this message translates to:
  /// **'{count} foto sudah ada di server (foto tidak bisa dihapus).'**
  String fieldPhotosOnServer(int count);

  /// No description provided for @fieldPartsCount.
  ///
  /// In id, this message translates to:
  /// **'{count} sparepart'**
  String fieldPartsCount(int count);

  /// No description provided for @fieldPhotoCount.
  ///
  /// In id, this message translates to:
  /// **'{count} foto'**
  String fieldPhotoCount(int count);

  /// No description provided for @fieldServiceTitle.
  ///
  /// In id, this message translates to:
  /// **'Laporan Servis Unit'**
  String get fieldServiceTitle;

  /// No description provided for @fieldServiceEditTitle.
  ///
  /// In id, this message translates to:
  /// **'Ubah Laporan Servis'**
  String get fieldServiceEditTitle;

  /// No description provided for @fieldServiceSubmit.
  ///
  /// In id, this message translates to:
  /// **'Kirim laporan servis'**
  String get fieldServiceSubmit;

  /// No description provided for @fieldTimesheetTitle.
  ///
  /// In id, this message translates to:
  /// **'Timesheet Unit'**
  String get fieldTimesheetTitle;

  /// No description provided for @fieldTimesheetEditTitle.
  ///
  /// In id, this message translates to:
  /// **'Ubah Timesheet Unit'**
  String get fieldTimesheetEditTitle;

  /// No description provided for @fieldContract.
  ///
  /// In id, this message translates to:
  /// **'Kontrak'**
  String get fieldContract;

  /// No description provided for @fieldNoContracts.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada project kontrak unit untuk Anda.'**
  String get fieldNoContracts;

  /// No description provided for @fieldNoContractUnits.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada unit kontrak yang aktif pada {date}. Buka saat online untuk memuat data kontrak.'**
  String fieldNoContractUnits(String date);

  /// No description provided for @fieldTabFilled.
  ///
  /// In id, this message translates to:
  /// **'terisi'**
  String get fieldTabFilled;

  /// No description provided for @fieldTabMissing.
  ///
  /// In id, this message translates to:
  /// **'belum'**
  String get fieldTabMissing;

  /// No description provided for @fieldTimesheetAlreadySent.
  ///
  /// In id, this message translates to:
  /// **'Timesheet unit ini untuk tanggal tersebut sudah ada di server. Perubahan lewat Riwayat saya (≤ 24 jam) atau koreksi PM.'**
  String get fieldTimesheetAlreadySent;

  /// No description provided for @fieldHourMeter.
  ///
  /// In id, this message translates to:
  /// **'Hour meter (HM)'**
  String get fieldHourMeter;

  /// No description provided for @fieldHmStart.
  ///
  /// In id, this message translates to:
  /// **'HM awal'**
  String get fieldHmStart;

  /// No description provided for @fieldHmEnd.
  ///
  /// In id, this message translates to:
  /// **'HM akhir'**
  String get fieldHmEnd;

  /// No description provided for @fieldHmPrefilled.
  ///
  /// In id, this message translates to:
  /// **'HM awal diisi otomatis dari HM akhir {date} ({hm}).'**
  String fieldHmPrefilled(String date, String hm);

  /// No description provided for @fieldHmUsed.
  ///
  /// In id, this message translates to:
  /// **'Selisih HM: {hours} jam'**
  String fieldHmUsed(String hours);

  /// No description provided for @fieldHmGap.
  ///
  /// In id, this message translates to:
  /// **'HM awal berbeda dengan HM akhir sebelumnya ({hm}). Boleh dikirim, akan ditandai \"Selisih HM\" untuk dicek PM.'**
  String fieldHmGap(String hm);

  /// No description provided for @fieldHmPhoto.
  ///
  /// In id, this message translates to:
  /// **'Foto meter HM'**
  String get fieldHmPhoto;

  /// No description provided for @fieldHmPhotoRequired.
  ///
  /// In id, this message translates to:
  /// **'Foto meter HM akhir (wajib)'**
  String get fieldHmPhotoRequired;

  /// No description provided for @fieldHmPhotoFixed.
  ///
  /// In id, this message translates to:
  /// **'Foto meter HM sudah di server (tidak bisa diganti).'**
  String get fieldHmPhotoFixed;

  /// No description provided for @fieldOperatingHours.
  ///
  /// In id, this message translates to:
  /// **'Jam operasi'**
  String get fieldOperatingHours;

  /// No description provided for @fieldWorkHours.
  ///
  /// In id, this message translates to:
  /// **'Kerja'**
  String get fieldWorkHours;

  /// No description provided for @fieldStandbyHours.
  ///
  /// In id, this message translates to:
  /// **'Standby'**
  String get fieldStandbyHours;

  /// No description provided for @fieldBreakdownHours.
  ///
  /// In id, this message translates to:
  /// **'Breakdown'**
  String get fieldBreakdownHours;

  /// No description provided for @fieldHoursTotal.
  ///
  /// In id, this message translates to:
  /// **'Total {total} dari 24 jam'**
  String fieldHoursTotal(String total);

  /// No description provided for @fieldHoursOver.
  ///
  /// In id, this message translates to:
  /// **'Total {total} jam — melebihi 24 jam'**
  String fieldHoursOver(String total);

  /// No description provided for @fieldHoursLegend.
  ///
  /// In id, this message translates to:
  /// **'kerja (biru) · standby (kuning) · breakdown (merah)'**
  String get fieldHoursLegend;

  /// No description provided for @fieldBreakdownReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan breakdown'**
  String get fieldBreakdownReason;

  /// No description provided for @fieldBreakdownReasonHint.
  ///
  /// In id, this message translates to:
  /// **'Mis. hidrolik bocor, menunggu part'**
  String get fieldBreakdownReasonHint;

  /// No description provided for @fieldNoBreakdown.
  ///
  /// In id, this message translates to:
  /// **'— (tidak ada breakdown)'**
  String get fieldNoBreakdown;

  /// No description provided for @fieldSuggestService.
  ///
  /// In id, this message translates to:
  /// **'Breakdown {hours} jam. Sebaiknya buat laporan servis untuk unit ini.'**
  String fieldSuggestService(String hours);

  /// No description provided for @fieldCreateServiceReport.
  ///
  /// In id, this message translates to:
  /// **'Buat laporan servis'**
  String get fieldCreateServiceReport;

  /// No description provided for @fieldOperatorFuel.
  ///
  /// In id, this message translates to:
  /// **'Operator & BBM'**
  String get fieldOperatorFuel;

  /// No description provided for @fieldCopyYesterday.
  ///
  /// In id, this message translates to:
  /// **'Salin dari kemarin'**
  String get fieldCopyYesterday;

  /// No description provided for @fieldCopyNone.
  ///
  /// In id, this message translates to:
  /// **'Belum ada timesheet sebelumnya untuk unit ini.'**
  String get fieldCopyNone;

  /// No description provided for @fieldCopied.
  ///
  /// In id, this message translates to:
  /// **'Operator dan lokasi disalin dari {date}.'**
  String fieldCopied(String date);

  /// No description provided for @fieldOperatorName.
  ///
  /// In id, this message translates to:
  /// **'Nama operator'**
  String get fieldOperatorName;

  /// No description provided for @fieldFuel.
  ///
  /// In id, this message translates to:
  /// **'BBM (liter)'**
  String get fieldFuel;

  /// No description provided for @fieldLocation.
  ///
  /// In id, this message translates to:
  /// **'Lokasi'**
  String get fieldLocation;

  /// No description provided for @fieldNextUnit.
  ///
  /// In id, this message translates to:
  /// **'Unit berikutnya: {unit} belum diisi'**
  String fieldNextUnit(String unit);

  /// No description provided for @fieldNextNone.
  ///
  /// In id, this message translates to:
  /// **'Semua unit kontrak sudah terisi untuk tanggal ini.'**
  String get fieldNextNone;

  /// No description provided for @fieldSaveAndNext.
  ///
  /// In id, this message translates to:
  /// **'Simpan & lanjut ke {unit}'**
  String fieldSaveAndNext(String unit);

  /// No description provided for @fieldTimesheetSave.
  ///
  /// In id, this message translates to:
  /// **'Simpan timesheet'**
  String get fieldTimesheetSave;

  /// No description provided for @fieldActivityTitle.
  ///
  /// In id, this message translates to:
  /// **'Aktivitas Aftersales'**
  String get fieldActivityTitle;

  /// No description provided for @fieldActivityEditTitle.
  ///
  /// In id, this message translates to:
  /// **'Ubah Aktivitas Aftersales'**
  String get fieldActivityEditTitle;

  /// No description provided for @fieldActivityNew.
  ///
  /// In id, this message translates to:
  /// **'Aktivitas baru'**
  String get fieldActivityNew;

  /// No description provided for @fieldActivityEdit.
  ///
  /// In id, this message translates to:
  /// **'Ubah aktivitas'**
  String get fieldActivityEdit;

  /// No description provided for @fieldNoAftersalesProjects.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada project aftersales untuk Anda.'**
  String get fieldNoAftersalesProjects;

  /// No description provided for @fieldCustomer.
  ///
  /// In id, this message translates to:
  /// **'Pelanggan'**
  String get fieldCustomer;

  /// No description provided for @fieldNoCustomers.
  ///
  /// In id, this message translates to:
  /// **'Belum ada daftar pelanggan di HP. Buka saat online untuk memuat daftar pelanggan PT (perlu ditugaskan ke project aftersales).'**
  String get fieldNoCustomers;

  /// No description provided for @fieldActivityKind.
  ///
  /// In id, this message translates to:
  /// **'Jenis aktivitas'**
  String get fieldActivityKind;

  /// No description provided for @fieldForPo.
  ///
  /// In id, this message translates to:
  /// **'Untuk PO (PO terbuka pelanggan ini)'**
  String get fieldForPo;

  /// No description provided for @fieldNoOpenPos.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada PO terbuka untuk pelanggan ini.'**
  String get fieldNoOpenPos;

  /// No description provided for @fieldDocQuote.
  ///
  /// In id, this message translates to:
  /// **'No. penawaran'**
  String get fieldDocQuote;

  /// No description provided for @fieldDocPo.
  ///
  /// In id, this message translates to:
  /// **'No. PO'**
  String get fieldDocPo;

  /// No description provided for @fieldDocDelivery.
  ///
  /// In id, this message translates to:
  /// **'No. surat jalan'**
  String get fieldDocDelivery;

  /// No description provided for @fieldDocInvoice.
  ///
  /// In id, this message translates to:
  /// **'No. invoice'**
  String get fieldDocInvoice;

  /// No description provided for @fieldDocOther.
  ///
  /// In id, this message translates to:
  /// **'No. dokumen'**
  String get fieldDocOther;

  /// No description provided for @fieldItems.
  ///
  /// In id, this message translates to:
  /// **'Item'**
  String get fieldItems;

  /// No description provided for @fieldItemsDelivered.
  ///
  /// In id, this message translates to:
  /// **'Item dikirim'**
  String get fieldItemsDelivered;

  /// No description provided for @fieldAddItem.
  ///
  /// In id, this message translates to:
  /// **'Tambah item'**
  String get fieldAddItem;

  /// No description provided for @fieldPoDelivered.
  ///
  /// In id, this message translates to:
  /// **'PO ini sudah terkirim semua'**
  String get fieldPoDelivered;

  /// No description provided for @fieldPoDeliveredHelp.
  ///
  /// In id, this message translates to:
  /// **'Tidak dicentang = terkirim sebagian (PO tetap terbuka).'**
  String get fieldPoDeliveredHelp;

  /// No description provided for @fieldFollowUpPick.
  ///
  /// In id, this message translates to:
  /// **'Tanggal follow-up (opsional)'**
  String get fieldFollowUpPick;

  /// No description provided for @fieldFollowUpOn.
  ///
  /// In id, this message translates to:
  /// **'Follow-up {date}'**
  String fieldFollowUpOn(String date);

  /// No description provided for @fieldFollowUpShort.
  ///
  /// In id, this message translates to:
  /// **'follow-up {date}'**
  String fieldFollowUpShort(String date);

  /// No description provided for @fieldFollowUpHelp.
  ///
  /// In id, this message translates to:
  /// **'Anda dan PM diingatkan pada tanggal follow-up.'**
  String get fieldFollowUpHelp;

  /// No description provided for @fieldReceiver.
  ///
  /// In id, this message translates to:
  /// **'Penerima'**
  String get fieldReceiver;

  /// No description provided for @fieldValue.
  ///
  /// In id, this message translates to:
  /// **'Nilai Rp (opsional)'**
  String get fieldValue;

  /// No description provided for @fieldValueHelp.
  ///
  /// In id, this message translates to:
  /// **'Hanya terlihat oleh Anda dan Direktur/Finance.'**
  String get fieldValueHelp;

  /// No description provided for @fieldProofPhoto.
  ///
  /// In id, this message translates to:
  /// **'Foto surat jalan / serah terima'**
  String get fieldProofPhoto;

  /// No description provided for @fieldProofPhotos.
  ///
  /// In id, this message translates to:
  /// **'Foto surat jalan / serah terima ({count}/{max})'**
  String fieldProofPhotos(int count, int max);

  /// No description provided for @fieldActivitySubmit.
  ///
  /// In id, this message translates to:
  /// **'Simpan aktivitas'**
  String get fieldActivitySubmit;

  /// No description provided for @fieldToday.
  ///
  /// In id, this message translates to:
  /// **'Hari ini ({count})'**
  String fieldToday(int count);

  /// No description provided for @fieldTodayEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada aktivitas pada tanggal ini.'**
  String get fieldTodayEmpty;

  /// No description provided for @fieldTodayOffline.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada sinyal — aktivitas di server tampil saat online.'**
  String get fieldTodayOffline;

  /// No description provided for @fieldNeedsFollowUp.
  ///
  /// In id, this message translates to:
  /// **'Perlu ditindaklanjuti'**
  String get fieldNeedsFollowUp;

  /// No description provided for @fieldOpenPosCount.
  ///
  /// In id, this message translates to:
  /// **'{count} PO belum terkirim'**
  String fieldOpenPosCount(int count);

  /// No description provided for @fieldFollowUpsToday.
  ///
  /// In id, this message translates to:
  /// **'{count} penawaran follow-up hari ini'**
  String fieldFollowUpsToday(int count);

  /// No description provided for @fieldPoStatus.
  ///
  /// In id, this message translates to:
  /// **'Status PO'**
  String get fieldPoStatus;

  /// No description provided for @fieldConflictTitle.
  ///
  /// In id, this message translates to:
  /// **'Konflik laporan lapangan'**
  String get fieldConflictTitle;

  /// No description provided for @fieldConflictGone.
  ///
  /// In id, this message translates to:
  /// **'Konflik sudah selesai.'**
  String get fieldConflictGone;

  /// No description provided for @fieldUseServer.
  ///
  /// In id, this message translates to:
  /// **'Pakai versi server'**
  String get fieldUseServer;

  /// No description provided for @fieldResendMine.
  ///
  /// In id, this message translates to:
  /// **'Kirim ulang versi saya'**
  String get fieldResendMine;

  /// No description provided for @fieldNotEditableAnymore.
  ///
  /// In id, this message translates to:
  /// **'Sudah lewat 24 jam: versi HP tidak bisa dikirim ulang. Minta koreksi PM/Direktur.'**
  String get fieldNotEditableAnymore;

  /// No description provided for @fieldUsedServer.
  ///
  /// In id, this message translates to:
  /// **'Versi server dipakai; salinan di HP dihapus.'**
  String get fieldUsedServer;

  /// No description provided for @fieldResent.
  ///
  /// In id, this message translates to:
  /// **'Versi HP dikirim ulang.'**
  String get fieldResent;

  /// No description provided for @fieldResendReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan kirim ulang'**
  String get fieldResendReason;

  /// No description provided for @fieldResendReasonHelp.
  ///
  /// In id, this message translates to:
  /// **'Wajib, min. 3 karakter (tercatat di audit).'**
  String get fieldResendReasonHelp;

  /// No description provided for @fieldDiffers.
  ///
  /// In id, this message translates to:
  /// **'berbeda'**
  String get fieldDiffers;

  /// No description provided for @fieldServerVersion.
  ///
  /// In id, this message translates to:
  /// **'Server'**
  String get fieldServerVersion;

  /// No description provided for @fieldMyVersion.
  ///
  /// In id, this message translates to:
  /// **'HP ini'**
  String get fieldMyVersion;

  /// No description provided for @fieldNewPhotos.
  ///
  /// In id, this message translates to:
  /// **'{count} foto baru'**
  String fieldNewPhotos(int count);

  /// No description provided for @dailyTitle.
  ///
  /// In id, this message translates to:
  /// **'Laporan Harian'**
  String get dailyTitle;

  /// No description provided for @dailyEditTitle.
  ///
  /// In id, this message translates to:
  /// **'Ubah Laporan Harian'**
  String get dailyEditTitle;

  /// No description provided for @dailyWeather.
  ///
  /// In id, this message translates to:
  /// **'Cuaca & jam hilang'**
  String get dailyWeather;

  /// No description provided for @dailyMorning.
  ///
  /// In id, this message translates to:
  /// **'Pagi'**
  String get dailyMorning;

  /// No description provided for @dailyNoon.
  ///
  /// In id, this message translates to:
  /// **'Siang'**
  String get dailyNoon;

  /// No description provided for @dailyAfternoon.
  ///
  /// In id, this message translates to:
  /// **'Sore'**
  String get dailyAfternoon;

  /// No description provided for @dailyRainHours.
  ///
  /// In id, this message translates to:
  /// **'Jam hujan'**
  String get dailyRainHours;

  /// No description provided for @dailyStopHours.
  ///
  /// In id, this message translates to:
  /// **'Jam kerja berhenti'**
  String get dailyStopHours;

  /// No description provided for @dailyWorkSection.
  ///
  /// In id, this message translates to:
  /// **'Volume pekerjaan hari ini'**
  String get dailyWorkSection;

  /// No description provided for @dailyPickProject.
  ///
  /// In id, this message translates to:
  /// **'Pilih project konstruksi dulu.'**
  String get dailyPickProject;

  /// No description provided for @dailyNoRap.
  ///
  /// In id, this message translates to:
  /// **'Project ini belum punya RAP di HP. Tarik ke bawah untuk memuat ulang; bila tetap kosong, minta PM/Direktur mengisi RAP di web.'**
  String get dailyNoRap;

  /// No description provided for @dailyRealised.
  ///
  /// In id, this message translates to:
  /// **'Realisasi {done} / {volume} {uom}'**
  String dailyRealised(String done, String volume, String uom);

  /// No description provided for @dailyOverRap.
  ///
  /// In id, this message translates to:
  /// **'Melebihi RAP: {total} dari {volume} {uom} — isi catatan.'**
  String dailyOverRap(String total, String volume, String uom);

  /// No description provided for @dailyOverRapNotify.
  ///
  /// In id, this message translates to:
  /// **'Ada volume melebihi RAP: laporan tetap dikirim, ditandai \"melebihi RAP\" dan PM project diberi notifikasi.'**
  String get dailyOverRapNotify;

  /// No description provided for @dailyMaterialSection.
  ///
  /// In id, this message translates to:
  /// **'Material'**
  String get dailyMaterialSection;

  /// No description provided for @dailyMaterialHelp.
  ///
  /// In id, this message translates to:
  /// **'Masuk = diterima di lokasi hari ini; terpakai = dipakai hari ini. Material tidak dihitung ke progress.'**
  String get dailyMaterialHelp;

  /// No description provided for @dailyReceived.
  ///
  /// In id, this message translates to:
  /// **'Masuk'**
  String get dailyReceived;

  /// No description provided for @dailyUsed.
  ///
  /// In id, this message translates to:
  /// **'Terpakai'**
  String get dailyUsed;

  /// No description provided for @dailyStock.
  ///
  /// In id, this message translates to:
  /// **'Stok {stock} {uom}'**
  String dailyStock(String stock, String uom);

  /// No description provided for @dailyManpower.
  ///
  /// In id, this message translates to:
  /// **'Tenaga & alat'**
  String get dailyManpower;

  /// No description provided for @dailyEquipment.
  ///
  /// In id, this message translates to:
  /// **'Alat (unit · jam kerja)'**
  String get dailyEquipment;

  /// No description provided for @dailyHours.
  ///
  /// In id, this message translates to:
  /// **'Jam'**
  String get dailyHours;

  /// No description provided for @dailyWorkers.
  ///
  /// In id, this message translates to:
  /// **'{count} pekerja'**
  String dailyWorkers(int count);

  /// No description provided for @dailyNoResources.
  ///
  /// In id, this message translates to:
  /// **'Jenis tenaga/alat belum dimuat. Tarik ke bawah saat ada sinyal.'**
  String get dailyNoResources;

  /// No description provided for @dailyNotesSection.
  ///
  /// In id, this message translates to:
  /// **'Kendala, catatan & foto'**
  String get dailyNotesSection;

  /// No description provided for @dailyIssues.
  ///
  /// In id, this message translates to:
  /// **'Kendala'**
  String get dailyIssues;

  /// No description provided for @dailyNotesRequired.
  ///
  /// In id, this message translates to:
  /// **'Wajib karena ada volume melebihi RAP.'**
  String get dailyNotesRequired;

  /// No description provided for @dailyPhoto.
  ///
  /// In id, this message translates to:
  /// **'Foto pekerjaan'**
  String get dailyPhoto;

  /// No description provided for @dailyPhotos.
  ///
  /// In id, this message translates to:
  /// **'Foto pekerjaan ({count}/{max})'**
  String dailyPhotos(int count, int max);

  /// No description provided for @dailySubmit.
  ///
  /// In id, this message translates to:
  /// **'Kirim laporan harian'**
  String get dailySubmit;

  /// No description provided for @dailySummary.
  ///
  /// In id, this message translates to:
  /// **'{items} item pekerjaan · {workers} pekerja · {photos} foto'**
  String dailySummary(int items, int workers, int photos);

  /// No description provided for @dailyNoProjects.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada project konstruksi yang bisa Anda laporkan (Staff: project yang ditugaskan; PM: project tim).'**
  String get dailyNoProjects;

  /// No description provided for @dailySameDay.
  ///
  /// In id, this message translates to:
  /// **'Sudah ada laporan harian Anda untuk project & tanggal ini di HP. Buka laporan itu.'**
  String get dailySameDay;

  /// No description provided for @dailyFlagOverRap.
  ///
  /// In id, this message translates to:
  /// **'Melebihi RAP'**
  String get dailyFlagOverRap;

  /// No description provided for @dailyFlagDuplicate.
  ///
  /// In id, this message translates to:
  /// **'Kemungkinan dobel'**
  String get dailyFlagDuplicate;

  /// No description provided for @dailyWorkItem.
  ///
  /// In id, this message translates to:
  /// **'Volume {item}'**
  String dailyWorkItem(String item);

  /// No description provided for @dailyWorkerCount.
  ///
  /// In id, this message translates to:
  /// **'Jumlah pekerja'**
  String get dailyWorkerCount;

  /// No description provided for @sectionRequestDetails.
  ///
  /// In id, this message translates to:
  /// **'Rincian pengajuan'**
  String get sectionRequestDetails;

  /// No description provided for @sectionRequester.
  ///
  /// In id, this message translates to:
  /// **'Pemohon'**
  String get sectionRequester;

  /// No description provided for @bankNameLabel.
  ///
  /// In id, this message translates to:
  /// **'Bank'**
  String get bankNameLabel;

  /// No description provided for @bankHolderLabel.
  ///
  /// In id, this message translates to:
  /// **'Atas nama'**
  String get bankHolderLabel;

  /// No description provided for @bankNumberLabel.
  ///
  /// In id, this message translates to:
  /// **'Nomor rekening'**
  String get bankNumberLabel;

  /// No description provided for @bankShowNumber.
  ///
  /// In id, this message translates to:
  /// **'Tampilkan nomor rekening'**
  String get bankShowNumber;

  /// No description provided for @bankHideNumber.
  ///
  /// In id, this message translates to:
  /// **'Sembunyikan nomor rekening'**
  String get bankHideNumber;

  /// No description provided for @docNoCopied.
  ///
  /// In id, this message translates to:
  /// **'Nomor {docNo} disalin.'**
  String docNoCopied(String docNo);

  /// No description provided for @docNoCopyHint.
  ///
  /// In id, this message translates to:
  /// **'Ketuk untuk menyalin nomor'**
  String get docNoCopyHint;

  /// No description provided for @docNoOpenHint.
  ///
  /// In id, this message translates to:
  /// **'Ketuk untuk membuka dokumen'**
  String get docNoOpenHint;

  /// No description provided for @receiptOpenPhoto.
  ///
  /// In id, this message translates to:
  /// **'Buka foto nota'**
  String get receiptOpenPhoto;

  /// No description provided for @receiptLineCaption.
  ///
  /// In id, this message translates to:
  /// **'Baris {no}'**
  String receiptLineCaption(int no);

  /// No description provided for @attendanceSelfieView.
  ///
  /// In id, this message translates to:
  /// **'Lihat selfie'**
  String get attendanceSelfieView;

  /// No description provided for @attendanceSelfieUnavailable.
  ///
  /// In id, this message translates to:
  /// **'Selfie tidak tersedia (mungkin sudah melewati masa retensi).'**
  String get attendanceSelfieUnavailable;

  /// No description provided for @pickHint.
  ///
  /// In id, this message translates to:
  /// **'Pilih {field}'**
  String pickHint(String field);

  /// No description provided for @pickEmployee.
  ///
  /// In id, this message translates to:
  /// **'Pilih karyawan'**
  String get pickEmployee;

  /// No description provided for @pickPo.
  ///
  /// In id, this message translates to:
  /// **'Pilih PO terbuka'**
  String get pickPo;

  /// No description provided for @pickLocation.
  ///
  /// In id, this message translates to:
  /// **'Pilih lokasi'**
  String get pickLocation;

  /// No description provided for @fieldRapItem.
  ///
  /// In id, this message translates to:
  /// **'Item RAP'**
  String get fieldRapItem;

  /// No description provided for @rapPickHint.
  ///
  /// In id, this message translates to:
  /// **'Pilih item RAP'**
  String get rapPickHint;

  /// No description provided for @rapOverBudgetChip.
  ///
  /// In id, this message translates to:
  /// **'Melebihi RAP'**
  String get rapOverBudgetChip;

  /// No description provided for @rapOverDetail.
  ///
  /// In id, this message translates to:
  /// **'Total {total} melebihi sisa RAP {remaining}'**
  String rapOverDetail(String total, String remaining);

  /// No description provided for @rapRemaining.
  ///
  /// In id, this message translates to:
  /// **'Sisa {amount}'**
  String rapRemaining(String amount);

  /// No description provided for @rapOf.
  ///
  /// In id, this message translates to:
  /// **'dari {amount}'**
  String rapOf(String amount);

  /// No description provided for @rapPickProjectFirst.
  ///
  /// In id, this message translates to:
  /// **'Pilih project pengajuan dulu.'**
  String get rapPickProjectFirst;

  /// No description provided for @rapOfflineNoBudget.
  ///
  /// In id, this message translates to:
  /// **'Offline: sisa anggaran RAP tampil lagi saat online.'**
  String get rapOfflineNoBudget;

  /// No description provided for @rapNoItems.
  ///
  /// In id, this message translates to:
  /// **'Project ini belum punya RAP (project tanpa RAB: item RAP tidak wajib).'**
  String get rapNoItems;

  /// D4 (owner 2026-10-11): project with a RAB but no RAP — submit is refused. Same text as the server and the web.
  ///
  /// In id, this message translates to:
  /// **'Project belum punya RAP — hubungi PM'**
  String get rapMissingBlock;

  /// No description provided for @rapMissingBlockDetail.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan ini bisa disimpan sebagai draft, tetapi baru bisa dikirim setelah PM mengisi RAP project.'**
  String get rapMissingBlockDetail;

  /// No description provided for @rapMissingProjectDetail.
  ///
  /// In id, this message translates to:
  /// **'Project ini punya RAB, jadi wajib punya RAP: pengajuan project ini baru bisa dikirim setelah PM / Direktur mengisi RAP.'**
  String get rapMissingProjectDetail;

  /// No description provided for @noSearchResults.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada yang cocok.'**
  String get noSearchResults;

  /// No description provided for @lineNeedsRapItem.
  ///
  /// In id, this message translates to:
  /// **'Baris ini belum terhubung ke item RAP. Pilih item RAP project sebelum diajukan.'**
  String get lineNeedsRapItem;

  /// No description provided for @lineNeedsRapItemShort.
  ///
  /// In id, this message translates to:
  /// **'Pilih item RAP'**
  String get lineNeedsRapItemShort;

  /// No description provided for @projectChangeClearsRap.
  ///
  /// In id, this message translates to:
  /// **'Item RAP pada {count} baris milik project sebelumnya dan akan dikosongkan. Tetap ganti project?'**
  String projectChangeClearsRap(int count);

  /// No description provided for @projectChangeConfirm.
  ///
  /// In id, this message translates to:
  /// **'Ganti project'**
  String get projectChangeConfirm;

  /// No description provided for @draftCostCenterLegacy.
  ///
  /// In id, this message translates to:
  /// **'Draft ini dibuat dengan pusat biaya. Pengajuan sekarang wajib memakai project — pilih project; pusat biaya diisi Finance saat transfer.'**
  String get draftCostCenterLegacy;

  /// No description provided for @draftLinesNeedRap.
  ///
  /// In id, this message translates to:
  /// **'{count} baris belum memilih item RAP — lengkapi sebelum diajukan.'**
  String draftLinesNeedRap(int count);

  /// No description provided for @searchClear.
  ///
  /// In id, this message translates to:
  /// **'Hapus pencarian'**
  String get searchClear;

  /// No description provided for @projectsTitle.
  ///
  /// In id, this message translates to:
  /// **'Proyek'**
  String get projectsTitle;

  /// No description provided for @projectsSearchHint.
  ///
  /// In id, this message translates to:
  /// **'Cari kode atau nama project…'**
  String get projectsSearchHint;

  /// No description provided for @projectStatusActive.
  ///
  /// In id, this message translates to:
  /// **'Semua aktif'**
  String get projectStatusActive;

  /// No description provided for @projectsEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada project yang dapat Anda lihat.'**
  String get projectsEmpty;

  /// No description provided for @projectsNoMatch.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada yang cocok dengan pencarian / filter.'**
  String get projectsNoMatch;

  /// No description provided for @projectPm.
  ///
  /// In id, this message translates to:
  /// **'PM'**
  String get projectPm;

  /// No description provided for @projectRapUsed.
  ///
  /// In id, this message translates to:
  /// **'Realisasi RAP'**
  String get projectRapUsed;

  /// No description provided for @projectRapOverItems.
  ///
  /// In id, this message translates to:
  /// **'{count} item RAP melebihi rencana'**
  String projectRapOverItems(int count);

  /// No description provided for @projectTitle.
  ///
  /// In id, this message translates to:
  /// **'Project'**
  String get projectTitle;

  /// No description provided for @projectTabInfo.
  ///
  /// In id, this message translates to:
  /// **'Proyek'**
  String get projectTabInfo;

  /// No description provided for @projectTabRap.
  ///
  /// In id, this message translates to:
  /// **'RAP'**
  String get projectTabRap;

  /// No description provided for @projectTabRequests.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan'**
  String get projectTabRequests;

  /// No description provided for @projectCode.
  ///
  /// In id, this message translates to:
  /// **'Kode'**
  String get projectCode;

  /// No description provided for @projectName.
  ///
  /// In id, this message translates to:
  /// **'Nama project'**
  String get projectName;

  /// No description provided for @projectKind.
  ///
  /// In id, this message translates to:
  /// **'Jenis project'**
  String get projectKind;

  /// No description provided for @projectStatus.
  ///
  /// In id, this message translates to:
  /// **'Status'**
  String get projectStatus;

  /// No description provided for @projectContractValue.
  ///
  /// In id, this message translates to:
  /// **'Nilai kontrak (RAB)'**
  String get projectContractValue;

  /// No description provided for @projectNoCostCenter.
  ///
  /// In id, this message translates to:
  /// **'Belum ada — dipilih Finance saat transfer'**
  String get projectNoCostCenter;

  /// No description provided for @projectClient.
  ///
  /// In id, this message translates to:
  /// **'Klien'**
  String get projectClient;

  /// No description provided for @projectPeriod.
  ///
  /// In id, this message translates to:
  /// **'Periode'**
  String get projectPeriod;

  /// No description provided for @projectProgress.
  ///
  /// In id, this message translates to:
  /// **'Progress fisik'**
  String get projectProgress;

  /// No description provided for @projectAddress.
  ///
  /// In id, this message translates to:
  /// **'Alamat'**
  String get projectAddress;

  /// No description provided for @projectRapSummary.
  ///
  /// In id, this message translates to:
  /// **'Ringkasan RAP'**
  String get projectRapSummary;

  /// No description provided for @rapItemsCount.
  ///
  /// In id, this message translates to:
  /// **'{count} item RAP'**
  String rapItemsCount(int count);

  /// No description provided for @rapPlanned.
  ///
  /// In id, this message translates to:
  /// **'Rencana'**
  String get rapPlanned;

  /// No description provided for @rapRealised.
  ///
  /// In id, this message translates to:
  /// **'Realisasi'**
  String get rapRealised;

  /// No description provided for @rapRemainingLabel.
  ///
  /// In id, this message translates to:
  /// **'Sisa'**
  String get rapRemainingLabel;

  /// No description provided for @rapNoPrices.
  ///
  /// In id, this message translates to:
  /// **'Nilai RAP hanya terlihat oleh Direktur, Admin, Finance dan PM project.'**
  String get rapNoPrices;

  /// No description provided for @rapNoItemsProject.
  ///
  /// In id, this message translates to:
  /// **'Project ini belum punya item RAP.'**
  String get rapNoItemsProject;

  /// No description provided for @rapInactive.
  ///
  /// In id, this message translates to:
  /// **'Nonaktif'**
  String get rapInactive;

  /// No description provided for @requestsSearchHint.
  ///
  /// In id, this message translates to:
  /// **'Cari nomor atau judul…'**
  String get requestsSearchHint;

  /// No description provided for @filterStatus.
  ///
  /// In id, this message translates to:
  /// **'Status'**
  String get filterStatus;

  /// No description provided for @filterAllStatuses.
  ///
  /// In id, this message translates to:
  /// **'Semua status'**
  String get filterAllStatuses;

  /// No description provided for @projectNoRequests.
  ///
  /// In id, this message translates to:
  /// **'Belum ada pengajuan untuk project ini.'**
  String get projectNoRequests;

  /// No description provided for @homeProjectsSub.
  ///
  /// In id, this message translates to:
  /// **'Info, RAP & pengajuan'**
  String get homeProjectsSub;

  /// No description provided for @financeTitle.
  ///
  /// In id, this message translates to:
  /// **'Finance'**
  String get financeTitle;

  /// No description provided for @homeFinanceSub.
  ///
  /// In id, this message translates to:
  /// **'Antrian transfer & LPJ'**
  String get homeFinanceSub;

  /// No description provided for @financeQueueCount.
  ///
  /// In id, this message translates to:
  /// **'{count} siap ditransfer'**
  String financeQueueCount(int count);

  /// No description provided for @transferQueueTitle.
  ///
  /// In id, this message translates to:
  /// **'Antrian Transfer'**
  String get transferQueueTitle;

  /// No description provided for @lpjVerifyTitle.
  ///
  /// In id, this message translates to:
  /// **'Verifikasi LPJ'**
  String get lpjVerifyTitle;

  /// No description provided for @slaAgeUnknown.
  ///
  /// In id, this message translates to:
  /// **'Umur sejak disetujui: —'**
  String get slaAgeUnknown;

  /// No description provided for @slaAge.
  ///
  /// In id, this message translates to:
  /// **'{age} sejak disetujui'**
  String slaAge(String age);

  /// No description provided for @slaOver.
  ///
  /// In id, this message translates to:
  /// **'lewat SLA {hours} jam'**
  String slaOver(String hours);

  /// No description provided for @transferSearchHint.
  ///
  /// In id, this message translates to:
  /// **'Nomor, judul, pemilik rekening…'**
  String get transferSearchHint;

  /// No description provided for @filterAllTypes.
  ///
  /// In id, this message translates to:
  /// **'Semua jenis'**
  String get filterAllTypes;

  /// No description provided for @slaOverFilter.
  ///
  /// In id, this message translates to:
  /// **'Lewat SLA'**
  String get slaOverFilter;

  /// No description provided for @transferQueueEmpty.
  ///
  /// In id, this message translates to:
  /// **'Antrian transfer kosong.'**
  String get transferQueueEmpty;

  /// No description provided for @listShownOf.
  ///
  /// In id, this message translates to:
  /// **'{shown} dari {total} pengajuan'**
  String listShownOf(int shown, int total);

  /// No description provided for @costCenterByFinance.
  ///
  /// In id, this message translates to:
  /// **'dipilih Finance saat transfer'**
  String get costCenterByFinance;

  /// No description provided for @bankVerified.
  ///
  /// In id, this message translates to:
  /// **'Terverifikasi'**
  String get bankVerified;

  /// No description provided for @bankUnverified.
  ///
  /// In id, this message translates to:
  /// **'Belum diverifikasi'**
  String get bankUnverified;

  /// No description provided for @openFlags.
  ///
  /// In id, this message translates to:
  /// **'Flag terbuka: {count}'**
  String openFlags(int count);

  /// No description provided for @transferRecord.
  ///
  /// In id, this message translates to:
  /// **'Catat transfer'**
  String get transferRecord;

  /// No description provided for @lpjQueueEmpty.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada LPJ yang menunggu verifikasi.'**
  String get lpjQueueEmpty;

  /// No description provided for @lpjReadOnlyHint.
  ///
  /// In id, this message translates to:
  /// **'Hanya lihat: buka pengajuan untuk melihat LPJ-nya. Verifikasi LPJ dilakukan di web (Verifikasi LPJ).'**
  String get lpjReadOnlyHint;

  /// No description provided for @transferNotInQueue.
  ///
  /// In id, this message translates to:
  /// **'Pengajuan ini tidak lagi ada di antrian transfer (mungkin sudah ditransfer).'**
  String get transferNotInQueue;

  /// No description provided for @transferAtLabel.
  ///
  /// In id, this message translates to:
  /// **'Tanggal & jam transfer'**
  String get transferAtLabel;

  /// No description provided for @transferAtHelp.
  ///
  /// In id, this message translates to:
  /// **'Sesuai bukti transfer bank.'**
  String get transferAtHelp;

  /// No description provided for @transferAtHint.
  ///
  /// In id, this message translates to:
  /// **'Pilih tanggal & jam'**
  String get transferAtHint;

  /// No description provided for @transferRecorded.
  ///
  /// In id, this message translates to:
  /// **'Transfer tercatat.'**
  String get transferRecorded;

  /// No description provided for @transferRecordedNo.
  ///
  /// In id, this message translates to:
  /// **'Transfer {no} tercatat.'**
  String transferRecordedNo(String no);

  /// No description provided for @overrideConfirm.
  ///
  /// In id, this message translates to:
  /// **'Tetap simpan'**
  String get overrideConfirm;

  /// No description provided for @overrideCancelled.
  ///
  /// In id, this message translates to:
  /// **'Belum disimpan — konfirmasi dibatalkan.'**
  String get overrideCancelled;

  /// No description provided for @transferAmountText.
  ///
  /// In id, this message translates to:
  /// **'Transfer {amount}'**
  String transferAmountText(String amount);

  /// No description provided for @transferAmountHelp.
  ///
  /// In id, this message translates to:
  /// **'Nominal disetujui — ditetapkan server, tidak dapat diubah.'**
  String get transferAmountHelp;

  /// No description provided for @bankDestination.
  ///
  /// In id, this message translates to:
  /// **'Rekening tujuan'**
  String get bankDestination;

  /// No description provided for @cashAccountLabel.
  ///
  /// In id, this message translates to:
  /// **'Akun kas'**
  String get cashAccountLabel;

  /// No description provided for @costCenterPickHint.
  ///
  /// In id, this message translates to:
  /// **'Pilih pusat biaya…'**
  String get costCenterPickHint;

  /// No description provided for @costCenterSuggested.
  ///
  /// In id, this message translates to:
  /// **'Usulan: pusat biaya default project. Ubah bila perlu.'**
  String get costCenterSuggested;

  /// No description provided for @costCenterNoDefault.
  ///
  /// In id, this message translates to:
  /// **'Project belum punya pusat biaya default — pilih.'**
  String get costCenterNoDefault;

  /// No description provided for @bankRefLabel.
  ///
  /// In id, this message translates to:
  /// **'No. referensi bank'**
  String get bankRefLabel;

  /// No description provided for @bankRefHint.
  ///
  /// In id, this message translates to:
  /// **'mis. nomor referensi di bukti'**
  String get bankRefHint;

  /// No description provided for @transferProofLabel.
  ///
  /// In id, this message translates to:
  /// **'Bukti transfer'**
  String get transferProofLabel;

  /// No description provided for @proofRetake.
  ///
  /// In id, this message translates to:
  /// **'Foto ulang'**
  String get proofRetake;

  /// No description provided for @transferProofHelp.
  ///
  /// In id, this message translates to:
  /// **'Foto bukti transfer bank (kamera atau galeri); dikompres sebelum diunggah.'**
  String get transferProofHelp;

  /// No description provided for @processing.
  ///
  /// In id, this message translates to:
  /// **'Memproses…'**
  String get processing;

  /// No description provided for @overdraftTitle.
  ///
  /// In id, this message translates to:
  /// **'Saldo akun kas akan minus'**
  String get overdraftTitle;

  /// No description provided for @overdraftFigures.
  ///
  /// In id, this message translates to:
  /// **'Saldo saat ini {balance}; sesudah transaksi ini {after}.'**
  String overdraftFigures(String balance, String after);

  /// No description provided for @overdraftGeneric.
  ///
  /// In id, this message translates to:
  /// **'Saldo akun akan menjadi minus.'**
  String get overdraftGeneric;

  /// No description provided for @overdraftNote.
  ///
  /// In id, this message translates to:
  /// **'Pastikan dana memang tersedia (mis. setoran belum dicatat). Konfirmasi Anda tercatat di audit log.'**
  String get overdraftNote;

  /// No description provided for @unverifiedTitle.
  ///
  /// In id, this message translates to:
  /// **'Rekening tujuan belum diverifikasi'**
  String get unverifiedTitle;

  /// No description provided for @unverifiedLine.
  ///
  /// In id, this message translates to:
  /// **'Rekening {account} berstatus \"Belum diverifikasi\".'**
  String unverifiedLine(String account);

  /// No description provided for @unverifiedDestination.
  ///
  /// In id, this message translates to:
  /// **'tujuan'**
  String get unverifiedDestination;

  /// No description provided for @unverifiedNote.
  ///
  /// In id, this message translates to:
  /// **'Periksa nomor rekening dan nama pemilik dengan karyawan sebelum mentransfer. Konfirmasi Anda tercatat di audit log.'**
  String get unverifiedNote;

  /// No description provided for @proofCamera.
  ///
  /// In id, this message translates to:
  /// **'Kamera'**
  String get proofCamera;

  /// No description provided for @rapOverBy.
  ///
  /// In id, this message translates to:
  /// **'Lebih {amount}'**
  String rapOverBy(String amount);

  /// No description provided for @loanTitle.
  ///
  /// In id, this message translates to:
  /// **'Pinjaman antar project'**
  String get loanTitle;

  /// No description provided for @loanTab.
  ///
  /// In id, this message translates to:
  /// **'Pinjaman'**
  String get loanTab;

  /// No description provided for @loanEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada pinjaman antar project.'**
  String get loanEmpty;

  /// No description provided for @loanInboxEmpty.
  ///
  /// In id, this message translates to:
  /// **'Tidak ada pinjaman antar project yang menunggu keputusan Anda.'**
  String get loanInboxEmpty;

  /// No description provided for @loanInboxTitle.
  ///
  /// In id, this message translates to:
  /// **'Pinjaman antar project ({count})'**
  String loanInboxTitle(int count);

  /// No description provided for @loanNew.
  ///
  /// In id, this message translates to:
  /// **'Ajukan pinjaman'**
  String get loanNew;

  /// No description provided for @loanNewTitle.
  ///
  /// In id, this message translates to:
  /// **'Ajukan pinjaman antar project'**
  String get loanNewTitle;

  /// No description provided for @loanEditTitle.
  ///
  /// In id, this message translates to:
  /// **'Ubah draft pinjaman'**
  String get loanEditTitle;

  /// No description provided for @loanNotEditable.
  ///
  /// In id, this message translates to:
  /// **'Pinjaman ini sudah tidak bisa diubah (bukan Draft lagi atau bukan milik Anda).'**
  String get loanNotEditable;

  /// No description provided for @loanNoBorrower.
  ///
  /// In id, this message translates to:
  /// **'Pinjaman antar project diajukan oleh PM project peminjam. Anda belum menjadi PM project yang aktif.'**
  String get loanNoBorrower;

  /// No description provided for @loanBorrower.
  ///
  /// In id, this message translates to:
  /// **'Project peminjam'**
  String get loanBorrower;

  /// No description provided for @loanLender.
  ///
  /// In id, this message translates to:
  /// **'Project pemberi pinjaman'**
  String get loanLender;

  /// No description provided for @loanKind.
  ///
  /// In id, this message translates to:
  /// **'Jenis'**
  String get loanKind;

  /// No description provided for @loanKindDana.
  ///
  /// In id, this message translates to:
  /// **'Dana'**
  String get loanKindDana;

  /// No description provided for @loanKindBarang.
  ///
  /// In id, this message translates to:
  /// **'Barang/material'**
  String get loanKindBarang;

  /// No description provided for @loanAmount.
  ///
  /// In id, this message translates to:
  /// **'Nilai pinjaman'**
  String get loanAmount;

  /// No description provided for @loanReason.
  ///
  /// In id, this message translates to:
  /// **'Alasan'**
  String get loanReason;

  /// No description provided for @loanDate.
  ///
  /// In id, this message translates to:
  /// **'Tanggal pinjaman'**
  String get loanDate;

  /// No description provided for @loanDueDate.
  ///
  /// In id, this message translates to:
  /// **'Jatuh tempo'**
  String get loanDueDate;

  /// No description provided for @loanRepaid.
  ///
  /// In id, this message translates to:
  /// **'Sudah kembali'**
  String get loanRepaid;

  /// No description provided for @loanOutstanding.
  ///
  /// In id, this message translates to:
  /// **'Sisa pinjaman'**
  String get loanOutstanding;

  /// No description provided for @loanSaveDraft.
  ///
  /// In id, this message translates to:
  /// **'Simpan draft'**
  String get loanSaveDraft;

  /// No description provided for @loanSaveChanges.
  ///
  /// In id, this message translates to:
  /// **'Simpan perubahan'**
  String get loanSaveChanges;

  /// No description provided for @loanSubmit.
  ///
  /// In id, this message translates to:
  /// **'Ajukan ke Direktur'**
  String get loanSubmit;

  /// No description provided for @loanSubmitConfirmTitle.
  ///
  /// In id, this message translates to:
  /// **'Ajukan pinjaman?'**
  String get loanSubmitConfirmTitle;

  /// No description provided for @loanSubmitConfirmBody.
  ///
  /// In id, this message translates to:
  /// **'Nomor PJ diberikan dan Direktur diberi tahu. Isi pinjaman tidak dapat diubah lagi.'**
  String get loanSubmitConfirmBody;

  /// No description provided for @loanSubmitted.
  ///
  /// In id, this message translates to:
  /// **'Pinjaman diajukan. Menunggu persetujuan Direktur.'**
  String get loanSubmitted;

  /// No description provided for @loanSavedDraft.
  ///
  /// In id, this message translates to:
  /// **'Draft pinjaman tersimpan.'**
  String get loanSavedDraft;

  /// No description provided for @loanEdit.
  ///
  /// In id, this message translates to:
  /// **'Ubah draft'**
  String get loanEdit;

  /// No description provided for @loanCancel.
  ///
  /// In id, this message translates to:
  /// **'Batalkan'**
  String get loanCancel;

  /// No description provided for @loanCancelTitle.
  ///
  /// In id, this message translates to:
  /// **'Batalkan pinjaman?'**
  String get loanCancelTitle;

  /// No description provided for @loanCancelPrompt.
  ///
  /// In id, this message translates to:
  /// **'Pinjaman dibatalkan (tidak dihapus). Alasan wajib.'**
  String get loanCancelPrompt;

  /// No description provided for @loanApprove.
  ///
  /// In id, this message translates to:
  /// **'Setujui'**
  String get loanApprove;

  /// No description provided for @loanReject.
  ///
  /// In id, this message translates to:
  /// **'Tolak'**
  String get loanReject;

  /// No description provided for @loanApproveTitle.
  ///
  /// In id, this message translates to:
  /// **'Setujui {docNo}?'**
  String loanApproveTitle(String docNo);

  /// No description provided for @loanApproveBody.
  ///
  /// In id, this message translates to:
  /// **'{borrower} meminjam {amount} dari {lender}. Tidak ada transaksi kas yang dibuat; pinjaman tercatat sebagai piutang antar project.'**
  String loanApproveBody(String borrower, String amount, String lender);

  /// No description provided for @loanRejectTitle.
  ///
  /// In id, this message translates to:
  /// **'Tolak {docNo}?'**
  String loanRejectTitle(String docNo);

  /// No description provided for @loanRejectPrompt.
  ///
  /// In id, this message translates to:
  /// **'Alasan penolakan dikirim ke PM peminjam.'**
  String get loanRejectPrompt;

  /// No description provided for @loanDone.
  ///
  /// In id, this message translates to:
  /// **'Tersimpan.'**
  String get loanDone;

  /// No description provided for @loanOverdueDays.
  ///
  /// In id, this message translates to:
  /// **'Terlambat · {days} hari'**
  String loanOverdueDays(int days);

  /// No description provided for @loanRoleBorrower.
  ///
  /// In id, this message translates to:
  /// **'Meminjam'**
  String get loanRoleBorrower;

  /// No description provided for @loanRoleLender.
  ///
  /// In id, this message translates to:
  /// **'Meminjamkan'**
  String get loanRoleLender;

  /// No description provided for @loanFlow.
  ///
  /// In id, this message translates to:
  /// **'{lender} → {borrower}'**
  String loanFlow(String lender, String borrower);

  /// No description provided for @loanRepayments.
  ///
  /// In id, this message translates to:
  /// **'Pengembalian'**
  String get loanRepayments;

  /// No description provided for @loanRepaymentSeq.
  ///
  /// In id, this message translates to:
  /// **'Pengembalian ke-{n}'**
  String loanRepaymentSeq(int n);

  /// No description provided for @loanRepaymentVoid.
  ///
  /// In id, this message translates to:
  /// **'Dibatalkan (void)'**
  String get loanRepaymentVoid;

  /// No description provided for @loanRepaymentVoidReason.
  ///
  /// In id, this message translates to:
  /// **'Dibatalkan (void): {reason}'**
  String loanRepaymentVoidReason(String reason);

  /// No description provided for @loanRepaymentsEmpty.
  ///
  /// In id, this message translates to:
  /// **'Belum ada pengembalian.'**
  String get loanRepaymentsEmpty;

  /// No description provided for @loanRepaymentsWebHint.
  ///
  /// In id, this message translates to:
  /// **'Pengembalian dicatat di web oleh PM peminjam atau Finance.'**
  String get loanRepaymentsWebHint;

  /// No description provided for @loanRecordedBy.
  ///
  /// In id, this message translates to:
  /// **'dicatat {name}'**
  String loanRecordedBy(String name);

  /// No description provided for @loanTimeline.
  ///
  /// In id, this message translates to:
  /// **'Alur persetujuan'**
  String get loanTimeline;

  /// No description provided for @loanStepSubmitted.
  ///
  /// In id, this message translates to:
  /// **'Diajukan PM peminjam'**
  String get loanStepSubmitted;

  /// No description provided for @loanStepDirektur.
  ///
  /// In id, this message translates to:
  /// **'Persetujuan Direktur'**
  String get loanStepDirektur;

  /// No description provided for @loanStepWaiting.
  ///
  /// In id, this message translates to:
  /// **'Menunggu'**
  String get loanStepWaiting;

  /// No description provided for @loanStepNotYet.
  ///
  /// In id, this message translates to:
  /// **'Belum'**
  String get loanStepNotYet;

  /// No description provided for @loanDecApproved.
  ///
  /// In id, this message translates to:
  /// **'Disetujui'**
  String get loanDecApproved;

  /// No description provided for @loanDecRejected.
  ///
  /// In id, this message translates to:
  /// **'Ditolak'**
  String get loanDecRejected;

  /// No description provided for @loanOutstandingOf.
  ///
  /// In id, this message translates to:
  /// **'Sisa {amount}'**
  String loanOutstandingOf(String amount);

  /// No description provided for @loanDueOn.
  ///
  /// In id, this message translates to:
  /// **'Jatuh tempo {date}'**
  String loanDueOn(String date);

  /// No description provided for @fieldPayeeType.
  ///
  /// In id, this message translates to:
  /// **'Jenis penerima'**
  String get fieldPayeeType;

  /// No description provided for @payeeKaryawan.
  ///
  /// In id, this message translates to:
  /// **'Karyawan'**
  String get payeeKaryawan;

  /// No description provided for @payeeVendor.
  ///
  /// In id, this message translates to:
  /// **'Vendor'**
  String get payeeVendor;

  /// No description provided for @fieldVendor.
  ///
  /// In id, this message translates to:
  /// **'Vendor'**
  String get fieldVendor;

  /// No description provided for @fieldVendorBankAccount.
  ///
  /// In id, this message translates to:
  /// **'Rekening vendor'**
  String get fieldVendorBankAccount;

  /// No description provided for @fieldInvoiceNo.
  ///
  /// In id, this message translates to:
  /// **'Nomor invoice'**
  String get fieldInvoiceNo;

  /// No description provided for @fieldInvoiceDate.
  ///
  /// In id, this message translates to:
  /// **'Tanggal invoice'**
  String get fieldInvoiceDate;

  /// No description provided for @fieldInvoiceDueDate.
  ///
  /// In id, this message translates to:
  /// **'Jatuh tempo'**
  String get fieldInvoiceDueDate;

  /// No description provided for @fieldInvoiceFile.
  ///
  /// In id, this message translates to:
  /// **'Foto invoice'**
  String get fieldInvoiceFile;

  /// No description provided for @invoiceCamera.
  ///
  /// In id, this message translates to:
  /// **'Kamera'**
  String get invoiceCamera;

  /// No description provided for @invoiceGallery.
  ///
  /// In id, this message translates to:
  /// **'Galeri'**
  String get invoiceGallery;

  /// No description provided for @invoiceAttached.
  ///
  /// In id, this message translates to:
  /// **'Foto invoice terlampir'**
  String get invoiceAttached;

  /// No description provided for @invoiceOnServer.
  ///
  /// In id, this message translates to:
  /// **'Invoice tersimpan di server'**
  String get invoiceOnServer;

  /// No description provided for @invoiceMissing.
  ///
  /// In id, this message translates to:
  /// **'Belum ada foto invoice'**
  String get invoiceMissing;

  /// No description provided for @vendorPaymentHint.
  ///
  /// In id, this message translates to:
  /// **'Pembayaran vendor: Finance mentransfer ke rekening vendor; invoice = bukti — tanpa nota per baris dan tanpa LPJ.'**
  String get vendorPaymentHint;

  /// No description provided for @sectionVendorPayment.
  ///
  /// In id, this message translates to:
  /// **'Pembayaran vendor'**
  String get sectionVendorPayment;

  /// No description provided for @vendorAccountsNone.
  ///
  /// In id, this message translates to:
  /// **'Vendor ini belum punya rekening aktif — minta Finance / Admin menambahkannya.'**
  String get vendorAccountsNone;

  /// No description provided for @vendorCostCenterHint.
  ///
  /// In id, this message translates to:
  /// **'Tanpa project: pilih pusat biaya (mis. tagihan kantor).'**
  String get vendorCostCenterHint;
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
