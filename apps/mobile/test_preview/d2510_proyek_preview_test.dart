// D2510 APK UI restyle, group "proyek": visual preview WITHOUT a device of the cash book (+ row sheet), Tutup buku,
// Transfer tercatat, the cash entry form, the loan lists (antar project, antar-PT), the inter-PT loan detail, the
// loan transfer orders and "RAP proyek". 390×844 logical px, light and dark, bundled fonts.
//
// Not part of CI (outside test/). Run by hand:
//   flutter test test_preview/d2510_proyek_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
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
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/cash/application/cash_providers.dart';
import 'package:proyekkas/features/cash/domain/cash_book.dart';
import 'package:proyekkas/features/cash/presentation/cash_book_screen.dart';
import 'package:proyekkas/features/cash/presentation/cash_entry_form_screen.dart';
import 'package:proyekkas/features/cash/presentation/period_closing_screen.dart';
import 'package:proyekkas/features/cash/presentation/voidable_transfers_view.dart';
import 'package:proyekkas/features/loans/domain/intercompany_loan.dart';
import 'package:proyekkas/features/loans/domain/loan.dart';
import 'package:proyekkas/features/loans/presentation/intercompany_loan_providers.dart';
import 'package:proyekkas/features/loans/presentation/intercompany_loan_screens.dart';
import 'package:proyekkas/features/loans/presentation/loan_list_screens.dart';
import 'package:proyekkas/features/loans/presentation/loan_providers.dart';
import 'package:proyekkas/features/loans/presentation/loan_transfer_orders.dart';
import 'package:proyekkas/features/rap/data/rap_providers.dart';
import 'package:proyekkas/features/rap/domain/rap_edit.dart';
import 'package:proyekkas/features/rap/presentation/rap_manage_screen.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../test/support/d1010_d_loans_fixtures.dart';
import '../test/support/d1310_c_fixtures.dart';
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

Map<String, dynamic> _bookJson() => {
  'today': '2026-10-19',
  'canWrite': true,
  'pts': [
    {
      'companyId': 1,
      'lockDate': '2026-08-31',
      'today': '2026-10-19',
      'minDate': '2026-09-01',
      'write': true,
      'reopen': false,
      'intercompanyReceiving': 'BCA Operasional',
    },
  ],
  'lookups': {
    'accounts': [
      {'id': 3, 'label': 'Kas Kecil Site', 'active': true, 'companyId': 1, 'openingDate': '2026-01-01'},
      {'id': 4, 'label': 'Bank Mandiri Operasional', 'active': true, 'companyId': 1, 'openingDate': '2026-01-01'},
    ],
    'projects': [
      {'id': 7, 'label': 'PRJ-07 Gedung A', 'active': true, 'companyId': 1},
    ],
    'costCenters': [],
    'categories': [
      {'id': 9, 'label': 'BBM', 'active': true, 'companyId': 1, 'requiresVehicle': true},
    ],
    'sources': [
      {'id': 2, 'label': 'Setoran klien', 'active': true, 'companyId': 1},
    ],
    'vehicles': [],
    'sites': [],
  },
  'total': 48750000,
  'byPt': [
    {'companyId': 1, 'total': 48750000},
  ],
  'flowPeriod': '2026-10',
  'accounts': [
    {
      'cashAccountId': 4,
      'companyId': 1,
      'name': 'Bank Mandiri Operasional',
      'balance': 47500000,
      'flowIn': 25000000,
      'flowOut': 3200000,
      'n': 6,
    },
    {
      'cashAccountId': 3,
      'companyId': 1,
      'name': 'Kas Kecil Site',
      'balance': 1250000,
      'flowIn': 0,
      'flowOut': 950000,
      'n': 2,
    },
  ],
  'page': {
    'rows': [
      {
        'id': 42,
        'companyId': 1,
        'entryNo': 'KM/CS1/2026/10/0003',
        'entryDate': '2026-10-05',
        'direction': 'in',
        'amount': 25000000,
        'status': 'posted',
        'sourceType': 'manual',
        'description': 'Termin 2 klien Gedung A',
        'cashAccountId': 4,
        'projectId': 7,
        'cashInSourceId': 2,
        'canEdit': true,
        'canVoid': true,
      },
      {
        'id': 41,
        'companyId': 1,
        'entryNo': 'KK/CS1/2026/10/0001',
        'entryDate': '2026-10-02',
        'direction': 'out',
        'amount': 50000,
        'status': 'void',
        'voidReason': 'Salah nominal',
        'sourceType': 'manual',
        'description': 'BBM genset',
        'cashAccountId': 3,
        'projectId': 7,
        'categoryId': 9,
        'reversedBy': {'id': 43, 'entryNo': 'KM/CS1/2026/10/0004'},
        'canEdit': false,
        'canVoid': false,
      },
      {
        'id': 40,
        'companyId': 1,
        'entryNo': 'KK/CS1/2026/10/0000',
        'entryDate': '2026-10-01',
        'direction': 'out',
        'amount': 900000,
        'status': 'posted',
        'sourceType': 'transfer',
        'cashAccountId': 3,
        'request': {'id': 88, 'docNo': 'PB/CS1/2026/10/0003'},
        'canEdit': false,
        'canVoid': false,
        'voidHint': 'Batalkan lewat transfer pengajuan',
      },
    ],
    'totalDocs': 3,
    'page': 1,
    'totalPages': 1,
  },
};

const _periodsJson = {
  'company': 1,
  'pts': [
    {'companyId': 1, 'lockDate': '2026-08-31'},
  ],
  'today': '2026-10-19',
  'lockDate': '2026-08-31',
  'booksStart': '2026-01-01',
  'latestClosed': '2026-08',
  'canReopen': true,
  'closable': ['2026-09'],
  'rows': [
    {'period': '2026-10', 'state': 'current', 'n': 2, 'tin': 0, 'tout': 950000},
    {'period': '2026-09', 'state': 'open', 'n': 4, 'tin': 2000000, 'tout': 500000, 'canClose': true},
    {
      'period': '2026-08',
      'state': 'closed',
      'explicit': true,
      'n': 3,
      'voids': 1,
      'nKoreksi': 2,
      'koreksi': 0,
      'canReopen': true,
    },
  ],
  'history': [
    {'id': 2, 'period': '2026-08', 'status': 'closed', 'closedBy': 'Fina', 'closedAt': '01/09/2026 08:00 WITA'},
  ],
};

const _voidableJson = {
  'items': [
    {
      'transferId': 15,
      'companyId': 1,
      'transferNo': 'TRF/CS1/2026/10/0004',
      'transferDate': '2026-10-03',
      'amount': 900000,
      'requestId': 88,
      'requestNo': 'PB/CS1/2026/10/0003',
      'requestTitle': 'Material besi',
      'requestType': 'advance',
      'canVoid': true,
    },
  ],
  'total': 1,
  'page': 1,
  'totalPages': 1,
};

Map<String, dynamic> _rapJson() => {
  'projectId': 10,
  'kind': 'konstruksi',
  'locked': true,
  'canEdit': true,
  'needsReason': true,
  'drivesProgress': true,
  'items': [
    {
      'id': 5,
      'code': 'A.1',
      'description': 'Galian tanah',
      'kind': 'pekerjaan',
      'stage': {'id': 2, 'name': 'Persiapan'},
      'uom': {'id': 3, 'code': 'm3'},
      'volume': 120,
      'unitPrice': 85000,
      'weightPct': 10,
      'active': true,
      'realised': 20,
    },
    {
      'id': 6,
      'code': 'B.1',
      'description': 'Besi beton D13',
      'kind': 'material',
      'stage': {'id': 3, 'name': 'Struktur'},
      'uom': {'id': 4, 'code': 'kg'},
      'volume': 1500,
      'unitPrice': 14500,
      'active': true,
    },
    {
      'id': 7,
      'code': 'C.9',
      'description': 'Pekerjaan lama (dihapus)',
      'kind': 'pekerjaan',
      'uom': {'id': 3, 'code': 'm3'},
      'volume': 4,
      'active': false,
    },
  ],
  'stages': [
    {'id': 2, 'name': 'Persiapan', 'active': true},
    {'id': 3, 'name': 'Struktur', 'active': true},
  ],
  'totals': {'rapValue': 31950000, 'budget': 30000000, 'overBudget': true},
};

LoanPage _loanPage() => LoanPage.fromJson({
  'items': [loanApprovedJson(), loanJson(), loanJson(id: 43, status: 'draft', amount: 12500000)],
  'summary': {
    'totals': {
      'pending': 1,
      'amount': 312500000,
      'repaid': 50000000,
      'outstanding': 100000000,
      'overdueCount': 1,
      'overdue': 100000000,
    },
    'inboxCount': 1,
    'canCreate': true,
  },
});

IcLoanPage _icPage() => IcLoanPage.fromJson({
  'items': [icLoanDetailJson(status: 'partially_repaid'), icLoanDetailJson()],
  'summary': {'receivable': 2500000, 'payable': 0, 'overdue': 0, 'queueCount': 1},
});

void main() {
  setUpAll(_loadFonts);

  for (final b in Brightness.values) {
    testWidgets('proyek preview ${b.name}', (tester) async {
      final book = CashBook.fromJson(_bookJson());
      final cash = <Override>[
        cashBookProvider.overrideWith((ref, f) async => book),
        periodOverviewProvider.overrideWith((ref, pt) async => PeriodOverview.fromJson(_periodsJson)),
        voidableTransfersProvider.overrideWith((ref, q) async => VoidablePage.fromJson(_voidableJson)),
      ];
      await _shot(
        tester,
        name: 'p-cash-book',
        brightness: b,
        roles: {Role.finance},
        overrides: cash,
        child: const CashBookScreen(),
      );
      await _shot(
        tester,
        name: 'p-cash-book-rows',
        brightness: b,
        roles: {Role.finance},
        overrides: cash,
        child: const CashBookScreen(),
        act: (t) async {
          await t.scrollUntilVisible(
            find.byKey(const Key('cash-row-40')),
            300,
            scrollable: find.byType(Scrollable).first,
          );
        },
      );
      await _shot(
        tester,
        name: 'p-cash-sheet',
        brightness: b,
        roles: {Role.finance},
        overrides: cash,
        child: const CashBookScreen(),
        act: (t) async {
          await t.scrollUntilVisible(
            find.byKey(const Key('cash-row-42')),
            300,
            scrollable: find.byType(Scrollable).first,
          );
          await t.tap(find.byKey(const Key('cash-row-42')));
        },
      );
      await _shot(
        tester,
        name: 'p-cash-form',
        brightness: b,
        roles: {Role.finance},
        overrides: cash,
        child: CashEntryFormScreen(book: book, pt: book.pts.single, inbound: false),
      );
      await _shot(
        tester,
        name: 'p-closings',
        brightness: b,
        roles: {Role.owner},
        overrides: cash,
        child: const PeriodClosingScreen(),
      );
      await _shot(
        tester,
        name: 'p-void-transfers',
        brightness: b,
        roles: {Role.finance},
        overrides: cash,
        child: const Scaffold(body: VoidableTransfersView()),
      );
      await _shot(
        tester,
        name: 'p-loan-list',
        brightness: b,
        roles: {Role.owner},
        overrides: [loanListProvider.overrideWith((ref, f) async => _loanPage())],
        child: const LoanListScreen(),
      );
      await _shot(
        tester,
        name: 'p-icloan-list',
        brightness: b,
        roles: {Role.finance},
        overrides: [icLoanListProvider.overrideWith((ref, f) async => _icPage())],
        child: const IcLoanListScreen(),
      );
      await _shot(
        tester,
        name: 'p-icloan-detail',
        brightness: b,
        roles: {Role.finance},
        overrides: [
          icLoanDetailProvider.overrideWith(
            (ref, id) async => IcLoan.fromJson(icLoanDetailJson(status: 'partially_repaid')),
          ),
          icLoanQueueProvider.overrideWith((ref) async => IcLoanQueue.fromJson(icLoanQueueJson())),
        ],
        child: const IcLoanDetailScreen(id: 77),
      );
      await _shot(
        tester,
        name: 'p-loan-orders',
        brightness: b,
        roles: {Role.finance},
        overrides: [
          loanTransferOrdersProvider.overrideWith((ref) async => LoanTransferOrders.fromJson(loanTransferOrdersJson())),
        ],
        child: Scaffold(
          appBar: AppBar(title: const Text('Antrian Transfer')),
          body: ListView(padding: const EdgeInsets.all(16), children: const [LoanTransferOrderSection()]),
        ),
      );
      await _shot(
        tester,
        name: 'p-rap-manage',
        brightness: b,
        roles: {Role.pm},
        overrides: [
          rapEditProvider.overrideWith((ref, id) async => RapEditData.fromJson(_rapJson())),
          rapUomsProvider.overrideWith((ref) async => const [(3, 'm3'), (4, 'kg')]),
        ],
        child: const RapManageScreen(projectId: 10),
      );
    });
  }
}
