// ADR 0024 visual preview WITHOUT a device: a Direktur's own request without approval — request detail (note +
// timeline "Persetujuan — Dilewati — Tanpa persetujuan …"), the new-request form with the Direktur info card and the
// Finance transfer queue badge. 390×844 logical px, light and dark, bundled fonts.
//
// Not part of CI (outside test/). Run by hand:
//   flutter test test_preview/adr0024_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
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
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/expense/presentation/widgets/timeline_view.dart';
import 'package:proyekkas/features/finance/application/finance_providers.dart';
import 'package:proyekkas/features/finance/domain/transfer_queue.dart';
import 'package:proyekkas/features/finance/presentation/finance_screen.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/projects/application/projects_providers.dart';
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
  required UserProfile prof,
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
        authControllerProvider.overrideWith(() => FakeAuth(AuthSignedIn(profile: prof, sub: 'preview-sub'))),
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

const _dirEmployee = Employee(id: 15, code: 'E15', name: 'Dedi Direktur');

final _direktur = UserProfile(
  id: 5,
  email: 'dedi@example.test',
  name: 'Dedi Direktur',
  roles: const {Role.owner},
  capabilities: Capabilities.fromRoles(const {Role.owner}),
  employee: _dirEmployee,
  companies: [
    CompanyMembership(
      id: 1,
      code: 'DRMS',
      name: 'PT DRMS',
      roles: const {Role.owner},
      employee: _dirEmployee,
      capabilities: Capabilities.fromRoles(const {Role.owner}),
      ownRequestNoApproval: true,
    ),
  ],
);

final _masters = <String, List<MasterItem>>{
  MasterTypes.projects: [const MasterItem(9, 'PRJ-09 — Jalan Tambang Blok B')],
  MasterTypes.categories: [const MasterItem(1, 'BBM')],
  MasterTypes.uoms: [const MasterItem(3, 'liter')],
  MasterTypes.employees: [
    const MasterItem(15, 'Dedi Direktur', extra: {'direktur': true}),
  ],
  MasterTypes.bankAccounts: [
    const MasterItem(25, 'Mandiri · Dedi Direktur · •••0456', extra: {'employee': 15}),
  ],
};

List<TransferQueueItem> _queue() => [
  transferQueueItemFromJson({
    ...queueJson(44, type: 'advance'),
    'title': 'Biaya perjalanan Direktur ke site Blok B',
    'statusLabel': 'Tanpa persetujuan (Antri Transfer)',
    'bank': {'bankName': 'Mandiri', 'accountNo': '•••0456', 'accountHolder': 'Dedi Direktur'},
    'noApproval': true,
  }),
  ...queueFixture(),
];

void main() {
  setUpAll(_loadFonts);
  final shots = <String, (Widget, UserProfile, List<Override> Function(), Future<void> Function(WidgetTester)?)>{
    'e-detail-no-approval': (
      const RequestDetailScreen(id: 42),
      _direktur,
      () => [
        requestDetailProvider(42).overrideWith((ref) async => detailFromJson(noApprovalDetailJson())),
        receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
      ],
      (t) => _scrollTo(t, const Key('no-approval-note')),
    ),
    'e-detail-timeline': (
      const RequestDetailScreen(id: 42),
      _direktur,
      () => [
        requestDetailProvider(42).overrideWith((ref) async => detailFromJson(noApprovalDetailJson())),
        receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
      ],
      (t) async {
        final timeline = find.byType(TimelineView);
        await t.scrollUntilVisible(timeline, 300, scrollable: find.byType(Scrollable).first);
        await Scrollable.ensureVisible(t.element(timeline), alignment: 0.3);
      },
    ),
    'e-draft-direktur': (
      DraftEditorScreen(
        initial: seedDraft(type: RequestType.advance)
            .copyWith(companyId: 1, requesterIds: const [15], bankAccountId: 25),
        masters: _masters,
        isNew: true,
      ),
      _direktur,
      () => [projectRapProvider.overrideWith((ref, id) async => const RapLoad(rapItemsFixture))],
      null,
    ),
    'e-finance-queue': (
      const FinanceScreen(),
      profile({Role.finance}),
      () => [
        transferQueueProvider.overrideWith((ref) async => _queue()),
        lpjQueueProvider.overrideWith((ref) async => const []),
      ],
      null,
    ),
  };
  for (final MapEntry(key: name, value: (child, prof, overrides, act)) in shots.entries) {
    for (final b in Brightness.values) {
      testWidgets('$name ${b.name}', (tester) async {
        await _shot(tester, name: name, brightness: b, child: child, overrides: overrides(), act: act, prof: prof);
      });
    }
  }
}
