// D2510 "akun" group preview (Laporan list, report viewer, generic record form) WITHOUT a device: pumps the screens
// with fake providers and the bundled fonts, 390×844 logical px, light and dark, and writes PNGs.
//
// Not part of CI's `flutter test` (lives outside test/); the mobile-preview workflow runs it:
//   flutter test test_preview/akun_reports_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
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
import 'package:proyekkas/app/theme.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/features/records/data/records_providers.dart';
import 'package:proyekkas/features/records/domain/record_form.dart';
import 'package:proyekkas/features/records/presentation/record_form_screen.dart';
import 'package:proyekkas/features/reports/data/reports_providers.dart';
import 'package:proyekkas/features/reports/domain/report.dart';
import 'package:proyekkas/features/reports/presentation/report_screens.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../test/support/widget_harness.dart' show FakeConnectivity;

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

Map<String, dynamic> _pageJson() => {
  'code': 'rekap-pengajuan',
  'title': 'Rekap pengajuan',
  'kpi': 'K-10',
  'description': 'Pengajuan per status, nominal dan tanggal transfer.',
  'scope': 'all',
  'count': 3,
  'nextCursor': 'c2',
  'main': {
    'key': 'main',
    'title': 'Daftar pengajuan',
    'columns': [
      {'key': 'docNo', 'label': 'Nomor', 'type': 'text', 'primary': true},
      {'key': 'judul', 'label': 'Judul', 'type': 'text'},
      {'key': 'tanggal', 'label': 'Tanggal', 'type': 'date'},
      {'key': 'nominal', 'label': 'Nominal', 'type': 'money'},
    ],
    'rows': [
      {
        'docNo': 'PB/CS1/2026/10/0003',
        'judul': 'Pembelian semen dan besi untuk pengecoran lantai 2 gudang',
        'tanggal': '2026-10-02',
        'nominal': 1250000,
      },
      {'docNo': 'PB/CS1/2026/10/0004', 'judul': 'Sewa genset', 'tanggal': '2026-10-03', 'nominal': 50000},
      {'docNo': 'RB/CS1/2026/10/0001', 'judul': 'Bensin operasional', 'tanggal': '2026-10-05', 'nominal': 325000},
    ],
    'totals': {'docNo': null, 'nominal': 1625000},
    'rowLinks': [
      {'docNo': '/admin/collections/expense-requests/88'},
      null,
      null,
    ],
    'empty': null,
  },
  'extra': [],
  'notes': ['Draft tidak dihitung.', 'Nominal = grand total setelah PPN.'],
  'formats': ['csv', 'xlsx', 'pdf'],
  'filters': [
    {'name': 'dari', 'label': 'Dari', 'kind': 'date', 'value': '2026-10-01'},
    {
      'name': 'jenis',
      'label': 'Jenis',
      'kind': 'select',
      'value': '',
      'options': [
        {'value': 'advance', 'label': 'Pengajuan Baru'},
        {'value': 'reimburse', 'label': 'Reimburse'},
      ],
    },
  ],
  'letterhead': {'kind': 'company', 'name': 'PT Contoh Satu', 'companies': []},
  'rowCount': 3,
  'limits': {'xlsx': 10000, 'pdf': 500},
};

final _index = (
  items: [
    for (final (code, title, desc, formats) in [
      ('rekap-pengajuan', 'Rekap pengajuan', 'Pengajuan per status', ['csv', 'xlsx', 'pdf']),
      ('rekap-kas', 'Rekap kas & bank', 'Mutasi kas per akun dan saldo akhir', ['csv', 'xlsx']),
      ('rekap-lpj', 'LPJ belum selesai', '', ['pdf']),
      ('rekap-aftersales', 'Rekap aftersales', 'Laporan servis per kontrak dan unit', ['csv']),
    ])
      ReportSummary.fromJson({'code': code, 'title': title, 'description': desc, 'formats': formats}),
  ],
  auditLog: true,
);

const _formJson = {
  'collection': 'clients',
  'label': 'Klien',
  'id': null,
  'canCreate': true,
  'canUpdate': false,
  'canDelete': false,
  'supported': true,
  'fields': [
    {'key': 'name', 'label': 'Nama', 'type': 'text', 'required': true, 'maxLength': 120},
    {
      'key': 'kind',
      'label': 'Jenis',
      'type': 'select',
      'required': false,
      'options': [
        {'value': 'swasta', 'label': 'Swasta'},
        {'value': 'pemerintah', 'label': 'Pemerintah'},
      ],
    },
    {'key': 'notes', 'label': 'Catatan', 'type': 'textarea', 'help': 'Tampil di detail klien.'},
    {'key': 'active', 'label': 'Aktif', 'type': 'checkbox', 'value': true},
    {'key': 'company', 'label': 'PT', 'type': 'relationship', 'required': true, 'relationTo': 'companies'},
    {'key': 'since', 'label': 'Klien sejak', 'type': 'date'},
    {'key': 'code', 'label': 'Kode', 'type': 'text', 'readOnly': true, 'value': 'KL-01'},
  ],
};

Future<void> _shot(
  WidgetTester tester, {
  required String name,
  required Brightness brightness,
  required Widget screen,
  Future<void> Function(WidgetTester tester)? act,
}) async {
  debugDisableShadows = false;
  await initializeDateFormatting('id');
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final key = GlobalKey();
  final overrides = <Override>[
    connectivityProvider.overrideWith(() => FakeConnectivity(true)),
    reportIndexProvider.overrideWith((ref) async => _index),
    reportPageProvider.overrideWith((ref, q) async => ReportPage.fromJson(_pageJson())),
    recordFormProvider.overrideWith((ref, k) async => RecordFormDef.fromJson(_formJson)),
  ];
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: overrides,
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
          home: screen,
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
}

void main() {
  setUpAll(_loadFonts);

  final shots = <String, (Widget, Future<void> Function(WidgetTester)?)>{
    'akun-reports': (const ReportListScreen(), null),
    'akun-report-view': (const ReportScreen(code: 'rekap-pengajuan'), null),
    'akun-report-view-scrolled': (
      const ReportScreen(code: 'rekap-pengajuan'),
      (tester) => tester.drag(find.byKey(const Key('report-page')), const Offset(0, -500)),
    ),
    'akun-record-form': (const RecordFormScreen(collection: 'clients'), null),
    'akun-record-form-error': (
      const RecordFormScreen(collection: 'clients'),
      (tester) async {
        final save = find.byKey(const Key('record-save'));
        final list = find.descendant(of: find.byKey(const Key('record-form')), matching: find.byType(Scrollable));
        await tester.scrollUntilVisible(save, 200, scrollable: list.first);
        await tester.tap(save);
        await tester.pumpAndSettle();
        await tester.drag(find.byKey(const Key('record-form')), const Offset(0, 2000));
      },
    ),
  };
  for (final MapEntry(key: name, value: (screen, act)) in shots.entries) {
    for (final b in Brightness.values) {
      testWidgets('$name ${b.name}', (tester) async {
        await _shot(tester, name: name, brightness: b, screen: screen, act: act);
      });
    }
  }
}
