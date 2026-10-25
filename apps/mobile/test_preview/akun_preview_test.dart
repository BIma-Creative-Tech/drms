// D2510 "akun" group preview WITHOUT a device: Profil tab, Profil & tanda tangan, Keamanan, Notifikasi, Antrean
// sinkron, PT switcher, module landing page, `/data/:collection` list + detail and the dashboard rows. Pumps the real
// router with fake providers and the bundled fonts, 390×844 logical px, light and dark, and writes PNGs.
//
// Not part of CI's `flutter test` (lives outside test/); the mobile-preview workflow runs it:
//   flutter test test_preview/akun_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/app/router.dart';
import 'package:proyekkas/app/theme.dart';
import 'package:proyekkas/core/config/app_env.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/account/application/account_providers.dart';
import 'package:proyekkas/features/account/domain/account.dart';
import 'package:proyekkas/features/addendum/domain/addendum.dart';
import 'package:proyekkas/features/addendum/presentation/addendum_providers.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/domain/dashboard.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/home/application/menu_providers.dart';
import 'package:proyekkas/features/home/domain/web_modules.dart';
import 'package:proyekkas/features/notifications/application/notifications_providers.dart';
import 'package:proyekkas/features/notifications/domain/app_notification.dart';
import 'package:proyekkas/features/progress/application/progress_providers.dart';
import 'package:proyekkas/features/progress/domain/progress.dart';
import 'package:proyekkas/features/records/data/records_providers.dart';
import 'package:proyekkas/features/records/domain/record_list.dart';
import 'package:proyekkas/features/sync/application/sync_coordinator.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../test/support/d1310_w3_fixtures.dart';
import '../test/support/e4_e6_fixtures.dart';
import '../test/support/fixtures.dart';
import '../test/support/harness.dart';
import '../test/support/widget_harness.dart' show FakeAuth, FakeConnectivity, profile;
import '../test/widget/e1_e3_screens_test.dart' as e1 show inboxPage;

const _dir = String.fromEnvironment('PK_SHOTS_DIR', defaultValue: 'build/preview-shots');
const _sub = 'preview-sub';

Future<void> _loadFonts() async {
  Future<ByteData> asset(String p) => rootBundle.load(p);
  final sg = FontLoader('SpaceGrotesk')
    ..addFont(asset('assets/fonts/SpaceGrotesk-SemiBold.ttf'))
    ..addFont(asset('assets/fonts/SpaceGrotesk-Bold.ttf'));
  final dm = FontLoader('DMSans')
    ..addFont(asset('assets/fonts/DMSans-Regular.ttf'))
    ..addFont(asset('assets/fonts/DMSans-Medium.ttf'))
    ..addFont(asset('assets/fonts/DMSans-Bold.ttf'));
  final root = Platform.environment['FLUTTER_ROOT']!;
  final icons = FontLoader('MaterialIcons')
    ..addFont(
      File('$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf')
          .readAsBytes()
          .then((b) => ByteData.view(b.buffer)),
    );
  await Future.wait([sg.load(), dm.load(), icons.load()]);
}

CompanyMembership _pt(int id, String code, String name, Set<Role> roles, {int? employee}) => CompanyMembership(
  id: id,
  code: code,
  name: name,
  roles: roles,
  capabilities: Capabilities.fromRoles(roles),
  employee: employee == null ? null : Employee(id: employee, code: 'E$employee', name: 'Doni Pratama'),
);

/// Fictional two-PT account (PT switcher row + sheet).
UserProfile _multi() => profile(const {Role.staff, Role.pm}).copyWith(
  companies: [
    _pt(1, 'CS6', 'PT Contoh Sejahtera', const {Role.staff, Role.pm}, employee: 12),
    _pt(2, 'CS7', 'PT Contoh Lestari', const {Role.finance}, employee: 40),
  ],
);

Map<String, dynamic> _n(int id, String title, String body, {String? readAt, String docType = 'expense_request'}) => {
  'id': id,
  'uuid': '0192f5c8-1a2b-7c3d-8e4f-5a6b7c8d9e$id',
  'event': 'transferred',
  'title': title,
  'body': body,
  'docType': docType,
  'docId': '42',
  'docNo': '228/PB-DRMS/20/IX/2026',
  'readAt': readAt,
  'createdAt': '2026-09-22T02:00:00Z',
};

final _notifications = NotificationPage(
  [
    AppNotification.fromJson(
      _n(11, 'Pengajuan ditransfer', 'Dana Rp 1.447.500 untuk 228/PB-DRMS/20/IX/2026 sudah ditransfer.'),
    ),
    AppNotification.fromJson(
      _n(10, 'Menunggu persetujuan Anda', 'PB/DRMS/2609/0007 "Besi beton" menunggu keputusan PM.'),
    ),
    AppNotification.fromJson(
      _n(9, 'Pengajuan disetujui', 'PB/DRMS/2609/0005 disetujui Direktur.', readAt: '2026-09-21T01:00:00Z'),
    ),
    AppNotification.fromJson(
      _n(8, 'Info lain', 'Pengingat tutup buku September.', readAt: '2026-09-20T01:00:00Z', docType: 'settlement'),
    ),
  ],
  2,
  null,
);

final _menu = [
  WebModule.fromJson({
    'id': 'keuangan',
    'label': 'Keuangan',
    'hint': 'Kas, transfer, pinjaman dan tutup buku',
    'sections': [
      {
        'label': 'Kas & bank',
        'items': [
          {'href': '/admin/kas', 'label': 'Buku kas'},
          {'href': '/admin/antrian-transfer', 'label': 'Antrian transfer', 'badge': 3},
          {'href': '/admin/collections/cash-accounts', 'label': 'Akun kas'},
        ],
      },
      {
        'label': 'Pinjaman',
        'items': [
          {'href': '/admin/pinjaman', 'label': 'Pinjaman antar project'},
          {'href': '/admin/pinjaman-antar-pt', 'label': 'Pinjaman antar PT'},
          {'href': '/admin/belum-ada', 'label': 'Rekonsiliasi bank'},
        ],
      },
      {
        'label': 'Data',
        'items': [
          {'href': '/admin/collections/transfers', 'label': 'Data transfer'},
          {'href': '/admin/tutup-buku', 'label': 'Tutup buku'},
        ],
      },
    ],
  }),
];

final _recordPage = RecordPage.fromJson({
  'collection': 'transfers',
  'label': 'Transfer',
  'columns': [
    {'key': 'docNo', 'label': 'No. transfer'},
    {'key': 'amount', 'label': 'Nominal'},
    {'key': 'account', 'label': 'Rekening'},
    {'key': 'date', 'label': 'Tanggal'},
  ],
  'items': [
    for (var i = 0; i < 5; i++)
      {
        'id': 15 + i,
        'title': 'TRF/CS1/2026/10/000${4 + i}',
        'cells': {
          'docNo': 'TRF/CS1/2026/10/000${4 + i}',
          'amount': 'Rp ${900 + i * 125}.000',
          'account': i.isEven ? 'BCA ••••1234 · Kas proyek P-07' : 'Mandiri ••••8765 · Operasional kantor pusat',
          'date': '${3 + i} Okt 2026',
        },
      },
  ],
  'totalDocs': 5,
  'page': 1,
  'totalPages': 1,
});

final _recordDetail = RecordDetail.fromJson({
  'collection': 'transfers',
  'label': 'Transfer',
  'id': '15',
  'title': 'TRF/CS1/2026/10/0004',
  'fields': [
    {'key': 'docNo', 'label': 'No. transfer', 'value': 'TRF/CS1/2026/10/0004'},
    {'key': 'request', 'label': 'Pengajuan', 'value': '228/PB-DRMS/20/IX/2026 — Pembelian semen dan besi beton'},
    {'key': 'amount', 'label': 'Nominal', 'value': 'Rp 900.000'},
    {'key': 'account', 'label': 'Dari rekening', 'value': 'BCA ••••1234 · Kas proyek P-07'},
    {'key': 'note', 'label': 'Catatan', 'value': null},
    {'key': 'createdBy', 'label': 'Dibuat oleh', 'value': 'Fina Finance'},
  ],
});

Future<void> _seedQueue(AppDatabase db) async {
  var n = 0;
  Future<void> add(String type, String status, {int attempts = 0, String? error, int? company}) => db
      .into(db.outbox)
      .insert(
        OutboxCompanion.insert(
          opUuid: 'op-${++n}',
          userSub: _sub,
          type: type,
          targetUuid: 't-$n',
          payloadJson: jsonEncode({'n': n}),
          deviceTime: '2026-10-2${n}T08:00:00+08:00',
          elapsedMs: 1,
          bootId: 'b-1',
          createdAt: DateTime.utc(2026, 10, 20 + n, 1),
          companyId: Value(company),
          status: Value(status),
          attempts: Value(attempts),
          lastErrorMessage: Value(error),
        ),
      );
  await add(SyncItemType.attendanceCheckIn, 'pending');
  await add(SyncItemType.expenseDraftUpsert, 'failed', attempts: 3, error: 'Server tidak dapat dihubungi (timeout).');
  await add(SyncItemType.progressReportUpsert, 'rejected', attempts: 1, error: 'Proyek sudah ditutup.');
  await add(SyncItemType.attendanceCheckOut, 'applied');
}

Future<void> _scrollTo(WidgetTester tester, String key, {double alignment = 0.1}) async {
  final target = find.byKey(Key(key));
  final list = find.byWidgetPredicate((w) => w is Scrollable && axisDirectionToAxis(w.axisDirection) == Axis.vertical);
  final position = tester.state<ScrollableState>(list.first).position;
  while (target.evaluate().isEmpty && position.pixels < position.maxScrollExtent) {
    position.jumpTo(position.pixels + 300);
    await tester.pump();
  }
  await Scrollable.ensureVisible(tester.element(target), alignment: alignment);
  await tester.pumpAndSettle();
}

Future<void> _shot(
  WidgetTester tester, {
  required String name,
  required Brightness brightness,
  required String location,
  Set<Role> roles = const {Role.staff},
  UserProfile? user,
  List<Override> overrides = const [],
  Future<void> Function(AppDatabase db)? seed,
  Future<void> Function(WidgetTester tester)? act,
  AppConfig appConfig = const AppConfig(syncAttendance: true),
  bool online = true,
}) async {
  // flutter_test paints shadows as solid black outlines unless this is off.
  debugDisableShadows = false;
  await initializeDateFormatting('id');
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final db = memoryDb();
  if (seed != null) await tester.runAsync(() => seed(db));
  final key = GlobalKey();
  final auth = AuthSignedIn(profile: user ?? profile(roles), sub: _sub);
  late ProviderContainer container;
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        appEnvProvider.overrideWithValue(
          AppEnv(
            flavor: 'staging',
            apiBaseUrl: 'https://example.test',
            oidcIssuer: 'https://example.test/realms/drms-staging',
            oidcClientId: 'proyekkas-mobile',
            oidcRedirectUri: 'https://example.test/app/callback',
            pushEnabled: false,
            loginMode: LoginMode.password,
          ),
        ),
        secureStoreProvider.overrideWithValue(MemorySecureStore()),
        deviceIdentityProvider.overrideWithValue(testDevice()),
        databaseProvider.overrideWithValue(db),
        connectivityProvider.overrideWith(() => FakeConnectivity(online)),
        authControllerProvider.overrideWith(() => FakeAuth(auth)),
        appConfigProvider.overrideWith((ref) async => appConfig),
        integrityReportProvider.overrideWith((ref) async => null),
        notificationsProvider.overrideWith((ref) async => _notifications),
        outboxCountsProvider.overrideWith(
          (ref) => Stream.value(const OutboxCounts(pending: 1, failed: 1, rejected: 1)),
        ),
        openProgressDraftsProvider.overrideWith((ref) => Stream.value(const <ProgressDraft>[])),
        projectProgressProvider.overrideWith((ref) async => ProjectProgressList.fromJson(projectProgressJson())),
        addendumInboxProvider.overrideWith((ref) async => const <Addendum>[]),
        inboxProvider.overrideWith((ref) async => e1.inboxPage()),
        menuProvider.overrideWith((ref) async => _menu),
        direkturDashboardProvider.overrideWith((ref) async => DirekturDashboard.fromJson(ownerW3Json())),
        financeDashboardProvider.overrideWith((ref) async => FinanceDashboard.fromJson(financeW3Json())),
        staffDashboardProvider.overrideWith((ref) async => StaffDashboard.fromJson(staffW3Json())),
        pmDashboardProvider.overrideWith((ref) async => PmDashboard.fromJson(pmDashboardJson())),
        meAccountProvider.overrideWith(
          (ref) async => MeAccount.fromJson({
            'id': 5,
            'email': 'doni@example.test',
            'name': 'Doni Pratama',
            'phone': '0812 3456 7890',
            'displayName': 'Doni',
            'signature': null,
            'editable': ['signature'],
          }),
        ),
        recordPageProvider.overrideWith((ref, q) async => _recordPage),
        recordDetailProvider.overrideWith((ref, k) async => _recordDetail),
        recordFormProvider.overrideWith((ref, k) async => throw const NetworkException()),
        ...overrides,
      ],
      child: Consumer(
        builder: (context, ref, _) {
          container = ProviderScope.containerOf(context);
          return RepaintBoundary(
            key: key,
            child: MaterialApp.router(
              theme: buildTheme(Brightness.light),
              darkTheme: buildTheme(Brightness.dark),
              themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
              routerConfig: ref.watch(routerProvider),
              locale: const Locale('id'),
              supportedLocales: AppLocalizations.supportedLocales,
              localizationsDelegates: const [
                AppLocalizations.delegate,
                GlobalMaterialLocalizations.delegate,
                GlobalWidgetsLocalizations.delegate,
                GlobalCupertinoLocalizations.delegate,
              ],
              debugShowCheckedModeBanner: false,
            ),
          );
        },
      ),
    ),
  );
  await tester.pumpAndSettle();
  container.read(routerProvider).go(location);
  await tester.pumpAndSettle();
  if (act != null) {
    await act(tester);
    await tester.pumpAndSettle();
  }
  final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(key));
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 2);
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    final f = File('$_dir/$name-${brightness.name}.png');
    f.parent.createSync(recursive: true);
    f.writeAsBytesSync(png!.buffer.asUint8List());
  });
  debugDisableShadows = true; // restored before the binding checks its debug invariants
  // Unmount before the in-memory DB closes (drift stream timers).
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(milliseconds: 50));
  await db.close();
}

MeSecurity _security(String state) => MeSecurity.fromJson({
  'twoFactor': {
    'state': state,
    'authenticators': [
      if (state == 'active') {'id': 'cred-0001-aaaa', 'label': 'HP pribadi', 'createdAt': '2026-10-01T00:00:00.000Z'},
    ],
  },
  'manageUrl': 'https://drms.example.test/admin/keamanan-akun',
});

void main() {
  setUpAll(_loadFonts);

  final shots =
      <
        ({
          String name,
          String location,
          Set<Role> roles,
          UserProfile? user,
          List<Override> overrides,
          Future<void> Function(AppDatabase)? seed,
          Future<void> Function(WidgetTester)? act,
        })
      >[
        (
          name: 'akun-profile',
          location: '/profile',
          roles: const {Role.staff},
          user: _multi(),
          overrides: const [],
          seed: null,
          act: null,
        ),
        (
          name: 'akun-profile-bottom',
          location: '/profile',
          roles: const {Role.staff},
          user: _multi(),
          overrides: const [],
          seed: null,
          act: (t) => _scrollTo(t, 'logout-button', alignment: 0.9),
        ),
        (
          name: 'akun-pt-switcher',
          location: '/profile',
          roles: const {Role.staff},
          user: _multi(),
          overrides: const [],
          seed: null,
          act: (t) => t.tap(find.byKey(const Key('profile-companies'))),
        ),
        (
          name: 'akun-account',
          location: '/account',
          roles: const {Role.staff},
          user: null,
          overrides: const [],
          seed: null,
          act: null,
        ),
        (
          name: 'akun-security-inactive',
          location: '/security',
          roles: const {Role.staff},
          user: null,
          overrides: [meSecurityProvider.overrideWith((ref) async => _security('inactive'))],
          seed: null,
          act: null,
        ),
        (
          name: 'akun-security-active',
          location: '/security',
          roles: const {Role.staff},
          user: null,
          overrides: [meSecurityProvider.overrideWith((ref) async => _security('active'))],
          seed: null,
          act: null,
        ),
        (
          name: 'akun-notifications',
          location: '/notifications',
          roles: const {Role.staff},
          user: null,
          overrides: const [],
          seed: null,
          act: null,
        ),
        (
          name: 'akun-queue',
          location: '/queue',
          roles: const {Role.staff},
          user: null,
          overrides: const [],
          seed: _seedQueue,
          act: null,
        ),
        (
          name: 'akun-module-keuangan',
          location: '/modul/keuangan',
          roles: const {Role.finance},
          user: null,
          overrides: const [],
          seed: null,
          act: null,
        ),
        (
          name: 'akun-records',
          location: '/data/transfers',
          roles: const {Role.finance},
          user: null,
          overrides: const [],
          seed: null,
          act: null,
        ),
        (
          name: 'akun-record-detail',
          location: '/data/transfers/15',
          roles: const {Role.finance},
          user: null,
          overrides: const [],
          seed: null,
          act: null,
        ),
        (
          name: 'akun-dash-owner-rap',
          location: '/dashboard',
          roles: const {Role.owner},
          user: null,
          overrides: const [],
          seed: null,
          act: (t) => _scrollTo(t, 'dash-rap-monitor'),
        ),
        (
          name: 'akun-dash-owner-cash',
          location: '/dashboard',
          roles: const {Role.owner},
          user: null,
          overrides: const [],
          seed: null,
          act: (t) => _scrollTo(t, 'dash-recent-cash'),
        ),
        (
          name: 'akun-dash-finance-accounts',
          location: '/dashboard',
          roles: const {Role.finance},
          user: null,
          overrides: const [],
          seed: null,
          act: (t) => _scrollTo(t, 'dash-accounts'),
        ),
        (
          name: 'akun-dash-staff-requests',
          location: '/dashboard',
          roles: const {Role.staff},
          user: null,
          overrides: const [],
          seed: null,
          act: (t) => _scrollTo(t, 'dash-my-requests'),
        ),
      ];
  // Home banner → "Versi baru tersedia" sheet (release notes + link), restyled here.
  for (final b in Brightness.values) {
    testWidgets('akun-update-sheet ${b.name}', (tester) async {
      await _shot(
        tester,
        name: 'akun-update-sheet',
        brightness: b,
        location: '/home',
        appConfig: const AppConfig(
          latestAppVersion: '0.2.1',
          appDownloadUrl: 'https://drms-kas.bimacreative.tech/unduh/proyekkas.apk',
          releaseNotes: [
            'Bisa masuk dengan kode Authenticator: ketuk "Pakai kode Authenticator" di layar masuk.',
            'Pesan salah masuk lebih jelas: email/username, kata sandi, atau kode Authenticator salah.',
            'Akun tanpa kode Authenticator masuk seperti biasa, tidak ada yang berubah.',
          ],
        ),
        act: (t) => t.tap(find.byKey(const Key('update-available-banner'))),
      );
    });
  }
  for (final s in shots) {
    for (final b in Brightness.values) {
      testWidgets('${s.name} ${b.name}', (tester) async {
        await _shot(
          tester,
          name: s.name,
          brightness: b,
          location: s.location,
          roles: s.roles,
          user: s.user,
          overrides: s.overrides,
          seed: s.seed,
          act: s.act,
          // offline: no automatic sync run (its spinner would never settle without a server)
          online: s.name != 'akun-queue',
        );
      });
    }
  }
}
