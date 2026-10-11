// DRMS 10/10 Phase C visual preview WITHOUT a device: "Proyek" (list, project tabs Proyek / RAP / Pengajuan),
// line editor "Item RAP" (picker, remaining budget, "Melebihi RAP"), draft lines with RAP items, request detail
// with RAP chips, "Finance" (Antrian Transfer, Catat transfer form, Verifikasi LPJ) and the home tiles.
// 390×844 logical px, light and dark, bundled fonts.
//
// Not part of CI (outside test/). Run by hand:
//   flutter test test_preview/d1010_c_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/app/theme.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/addendum/domain/addendum.dart';
import 'package:proyekkas/features/addendum/presentation/addendum_providers.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/line_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/finance/application/finance_providers.dart';
import 'package:proyekkas/features/finance/presentation/finance_screen.dart';
import 'package:proyekkas/features/finance/presentation/transfer_form_screen.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/progress/application/progress_providers.dart';
import 'package:proyekkas/features/progress/domain/progress.dart';
import 'package:proyekkas/features/projects/application/projects_providers.dart';
import 'package:proyekkas/features/projects/presentation/project_detail_screen.dart';
import 'package:proyekkas/features/projects/presentation/projects_screen.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../test/support/d1010_c_fixtures.dart';
import '../test/support/fixtures.dart';
import '../test/support/harness.dart';
import '../test/support/seed.dart';
import '../test/support/widget_harness.dart' show FakeAuth, FakeConnectivity, profile;

const _dir = String.fromEnvironment('PK_SHOTS_DIR', defaultValue: 'build/preview-shots');

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

Future<void> _shot(
  WidgetTester tester, {
  required String name,
  required Brightness brightness,
  required Widget child,
  List<Override> overrides = const [],
  Future<void> Function(WidgetTester tester)? act,
  Set<Role> roles = const {Role.staff},
}) async {
  debugDisableShadows = false;
  await initializeDateFormatting('id');
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final db = memoryDb();
  final key = GlobalKey();
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        appEnvProvider.overrideWithValue(testEnv('https://example.test')),
        secureStoreProvider.overrideWithValue(MemorySecureStore()),
        deviceIdentityProvider.overrideWithValue(testDevice()),
        databaseProvider.overrideWithValue(db),
        connectivityProvider.overrideWith(() => FakeConnectivity(true)),
        authControllerProvider.overrideWith(() => FakeAuth(AuthSignedIn(profile: profile(roles), sub: 'preview-sub'))),
        ...overrides,
      ],
      child: RepaintBoundary(
        key: key,
        child: MaterialApp(
          theme: buildTheme(Brightness.light),
          darkTheme: buildTheme(Brightness.dark),
          themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
          locale: const Locale('id'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          debugShowCheckedModeBanner: false,
          home: child,
        ),
      ),
    ),
  );
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
  debugDisableShadows = true;
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(milliseconds: 50));
  await db.close();
}

Future<void> _scrollTo(WidgetTester tester, Key key) async {
  await tester.scrollUntilVisible(find.byKey(key), 300, scrollable: find.byType(Scrollable).first);
  await Scrollable.ensureVisible(tester.element(find.byKey(key)), alignment: 0.3);
}

final _masters = <String, List<MasterItem>>{
  MasterTypes.projects: [const MasterItem(9, 'PRJ-09 — Jalan Tambang Blok B')],
  MasterTypes.categories: [
    const MasterItem(1, 'BBM'),
    const MasterItem(2, 'Penginapan'),
    const MasterItem(3, 'Konsumsi'),
  ],
  MasterTypes.uoms: [const MasterItem(3, 'liter'), const MasterItem(4, 'kamar')],
  MasterTypes.employees: [const MasterItem(11, 'Budi'), const MasterItem(12, 'Doni Pratama')],
  MasterTypes.bankAccounts: [
    const MasterItem(21, 'Mandiri · Doni Pratama · •••0123', extra: {'employee': 12}),
  ],
};

List<Override> _api() => [
  projectsApiProvider.overrideWithValue(FakeProjectsApi()..totalPages = 1),
  financeApiProvider.overrideWithValue(FakeFinanceApi()),
  projectRapProvider.overrideWith((ref, id) async => const RapLoad(rapItemsFixture)),
  lpjQueueProvider.overrideWith(
    (ref) async => [
      summaryFromJson({
        ...detailJson(),
        'id': 51,
        'type': 'advance',
        'typeLabel': 'Pengajuan Baru',
        'status': 'lpj_submitted',
        'statusLabel': 'LPJ Diajukan',
        'title': 'Uang muka survei Blok C',
        'approvedAmount': 3500000,
      }),
    ],
  ),
];

Map<String, dynamic> _rapDetail() {
  final j = pmDetailJson(status: 'pending_approval', allowed: const ['approve', 'reject']);
  final lines = [for (final l in j['lines'] as List) Map<String, dynamic>.of(l as Map<String, dynamic>)];
  lines[0]['rapItem'] = {'id': 501, 'code': 'A.1', 'name': 'Solar alat berat'};
  lines[0]['rapOverBudget'] = true;
  lines[1]['rapItem'] = {'id': 502, 'code': 'A.2', 'name': 'Akomodasi tim'};
  return {
    ...j,
    'project': {'id': 9, 'code': 'PRJ-09', 'name': 'Jalan Tambang Blok B'},
    'costCenter': null,
    'lines': lines,
  };
}

Future<void> _tapKey(WidgetTester t, String key) async {
  await t.tap(find.byKey(Key(key)));
  await t.pumpAndSettle();
}

void main() {
  setUpAll(_loadFonts);
  final homeStubs = <Override>[
    inboxProvider.overrideWith((ref) async => const InboxPage([], 85)),
    transferQueueProvider.overrideWith((ref) async => queueFixture()),
    direkturDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
    financeDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
    pmDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
    openProgressDraftsProvider.overrideWith((ref) => Stream.value(const <ProgressDraft>[])),
    projectProgressProvider.overrideWith((ref) async => throw const NetworkException()),
    addendumInboxProvider.overrideWith((ref) async => const <Addendum>[]),
  ];
  final shots = <String, (Widget, Set<Role>, List<Override> Function(), Future<void> Function(WidgetTester)?)>{
    'c-home-finance': (const HomeScreen(), {Role.finance}, () => [...homeStubs, ..._api()], null),
    'c-projects': (const ProjectsScreen(), {Role.pm}, _api, null),
    'c-project-info': (const ProjectDetailScreen(id: 9), {Role.finance}, _api, null),
    'c-project-rap': (const ProjectDetailScreen(id: 9, initialTab: 1), {Role.finance}, _api, null),
    'c-project-requests': (const ProjectDetailScreen(id: 9, initialTab: 2), {Role.finance}, _api, null),
    'c-line-rap': (
      LineEditorScreen(line: seedDraft().lines.first.copyWith(rapItemId: 501), masters: _masters, projectId: 9),
      {Role.staff},
      _api,
      null,
    ),
    'c-line-rap-picker': (
      LineEditorScreen(line: seedDraft().lines.first.copyWith(rapItemId: null), masters: _masters, projectId: 9),
      {Role.staff},
      _api,
      (t) => _tapKey(t, 'line-rap-item'),
    ),
    'c-draft-rap': (
      DraftEditorScreen(
        initial: seedDraft().copyWith(
          lines: [for (final l in seedDraft().lines) l.no == 3 ? l.copyWith(rapItemId: null) : l],
        ),
        masters: _masters,
        isNew: false,
      ),
      {Role.staff},
      _api,
      (t) => _scrollTo(t, const Key('line-2')),
    ),
    'c-detail-rap': (
      const RequestDetailScreen(id: 42),
      {Role.owner},
      () => [requestDetailProvider(42).overrideWith((ref) async => detailFromJson(_rapDetail()))],
      (t) => _scrollTo(t, const Key('line-1-rap-over')),
    ),
    'c-finance-queue': (const FinanceScreen(), {Role.finance}, _api, null),
    'c-finance-lpj': (const FinanceScreen(initialTab: 1), {Role.finance}, _api, null),
    'c-transfer-form': (TransferFormScreen(item: queueFixture().first), {Role.finance}, _api, null),
    'c-transfer-form-errors': (
      TransferFormScreen(item: queueFixture()[1]),
      {Role.finance},
      _api,
      (t) async {
        await t.tap(
          find.descendant(of: find.byKey(const Key('transfer-submit')), matching: find.bySubtype<FilledButton>()),
        );
        await t.pumpAndSettle();
      },
    ),
  };
  for (final MapEntry(key: name, value: (child, roles, overrides, act)) in shots.entries) {
    for (final b in Brightness.values) {
      testWidgets('$name ${b.name}', (tester) async {
        await _shot(tester, name: name, brightness: b, child: child, overrides: overrides(), act: act, roles: roles);
      });
    }
  }
}
