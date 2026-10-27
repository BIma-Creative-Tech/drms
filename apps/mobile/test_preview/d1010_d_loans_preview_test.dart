// ADR 0022 visual preview WITHOUT a device: project "Pinjaman" tab, loan form, loan detail (PM Draft, Direktur
// pending with the decision bar, approved with repayments + overdue) and the Direktur inbox with loans.
// 390×844 logical px, light and dark, bundled fonts.
//
// Not part of CI (outside test/). Run by hand:
//   flutter test test_preview/d1010_d_loans_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
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
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/addendum/domain/addendum.dart';
import 'package:proyekkas/features/addendum/presentation/addendum_providers.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/approvals/presentation/inbox_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/loans/domain/loan.dart';
import 'package:proyekkas/features/loans/presentation/loan_providers.dart';
import 'package:proyekkas/features/loans/presentation/loan_screens.dart';
import 'package:proyekkas/features/projects/application/projects_providers.dart';
import 'package:proyekkas/features/projects/presentation/project_detail_screen.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../test/support/d1010_c_fixtures.dart' show FakeProjectsApi;
import '../test/support/d1010_d_loans_fixtures.dart';
import '../test/support/harness.dart';
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

List<Override> _common() => [
  projectsApiProvider.overrideWithValue(FakeProjectsApi()..totalPages = 1),
  loanOptionsProvider.overrideWith((ref) async => loanOptionsFixture()),
  projectLoansProvider.overrideWith(
    (ref, id) async => LoanPage(
      items: [
        Loan.fromJson(loanApprovedJson()),
        Loan.fromJson(loanJson()),
        Loan.fromJson(loanJson(id: 43, status: 'draft', amount: 12500000)),
      ],
    ),
  ),
  addendumInboxProvider.overrideWith((ref) async => const <Addendum>[]),
  lpjQueueProvider.overrideWith((ref) async => const <ExpenseSummary>[]),
];

void main() {
  setUpAll(_loadFonts);

  for (final b in Brightness.values) {
    testWidgets('loans preview ${b.name}', (tester) async {
      await _shot(
        tester,
        name: '01-project-loans-tab',
        brightness: b,
        roles: {Role.pm},
        overrides: _common(),
        child: const ProjectDetailScreen(id: 10, initialTab: 3),
      );
      await _shot(
        tester,
        name: '02-loan-form',
        brightness: b,
        roles: {Role.pm},
        overrides: _common(),
        child: const LoanFormScreen(projectId: 10),
        act: (t) async {
          await t.enterText(find.byKey(const Key('loan-amount')), '150000000');
          await t.enterText(
            find.byKey(const Key('loan-reason')),
            'Termin pertama klien B belum cair; upah pekerja minggu ini.',
          );
          await t.tap(find.byKey(const Key('loan-submit')));
          await t.pumpAndSettle();
        },
      );
      await _shot(
        tester,
        name: '03-loan-detail-pm-draft',
        brightness: b,
        roles: {Role.pm},
        overrides: [
          ..._common(),
          loanDetailProvider.overrideWith(
            (ref, id) async => Loan.fromJson(loanJson(status: 'draft', actions: ['edit', 'submit', 'cancel'])),
          ),
        ],
        child: const LoanDetailScreen(id: 41),
      );
      await _shot(
        tester,
        name: '04-loan-detail-direktur-pending',
        brightness: b,
        roles: {Role.owner},
        overrides: [
          ..._common(),
          loanDetailProvider.overrideWith(
            (ref, id) async => Loan.fromJson(loanJson(actions: ['approve', 'reject'], samePm: true)),
          ),
        ],
        child: const LoanDetailScreen(id: 41),
      );
      await _shot(
        tester,
        name: '05-loan-detail-approved-overdue',
        brightness: b,
        roles: {Role.pm},
        overrides: [
          ..._common(),
          loanDetailProvider.overrideWith((ref, id) async => Loan.fromJson(loanApprovedJson())),
        ],
        child: const LoanDetailScreen(id: 42),
        act: (t) => _scrollTo(t, const Key('loan-repayments')),
      );
      await _shot(
        tester,
        name: '06-inbox-loans',
        brightness: b,
        roles: {Role.owner},
        overrides: [
          ..._common(),
          inboxProvider.overrideWith((ref) async => const InboxPage([], 85)),
          loanInboxProvider.overrideWith(
            (ref) async => LoanInbox(
              loans: [
                Loan.fromJson(loanJson()),
                Loan.fromJson(loanJson(id: 44, docNo: 'PJ/DRMS/2610/0002', amount: 45000000)),
              ],
            ),
          ),
        ],
        child: const InboxScreen(),
      );
    });
  }
}
