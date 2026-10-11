// DRMS 10/10 Phase B-2 visual preview WITHOUT a device: line editor (computed total, "Nominal sesuai nota",
// "Selisih nota"), draft lines list, request detail lines, LPJ submit screen with photos and the LPJ section on
// the detail. 390×844 logical px, light and dark, bundled fonts.
//
// Not part of CI (outside test/). Run by hand:
//   flutter test test_preview/d1010_b2_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
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
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/line_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/lpj_submit_screen.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../test/support/fixtures.dart';
import '../test/support/harness.dart';
import '../test/support/seed.dart';
import '../test/support/widget_harness.dart' show FakeAuth, FakeConnectivity, profile;
import '../test/widget/requester_flow_test.dart' show advanceJson;

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

final _masters = <String, List<MasterItem>>{
  MasterTypes.categories: [
    const MasterItem(1, 'BBM'),
    const MasterItem(2, 'Penginapan'),
    const MasterItem(3, 'Konsumsi'),
  ],
  MasterTypes.uoms: [const MasterItem(3, 'liter'), const MasterItem(4, 'kamar')],
  MasterTypes.costCenters: [const MasterItem(7, 'OPS-PB — Ops Palangka Banjar')],
};

/// A small grey JPEG-like placeholder (decodable PNG) for photo thumbnails.
Future<Uint8List> _photo(Color c) async {
  final rec = ui.PictureRecorder();
  Canvas(rec).drawRect(const Rect.fromLTWH(0, 0, 120, 160), Paint()..color = c);
  final img = await rec.endRecording().toImage(120, 160);
  final b = await img.toByteData(format: ui.ImageByteFormat.png);
  return b!.buffer.asUint8List();
}

Future<void> _shot(
  WidgetTester tester, {
  required String name,
  required Brightness brightness,
  required Widget child,
  List<Override> overrides = const [],
  Future<void> Function(WidgetTester tester)? act,
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
        authControllerProvider.overrideWith(
          () => FakeAuth(AuthSignedIn(profile: profile({Role.staff}), sub: 'preview-sub')),
        ),
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

void main() {
  setUpAll(_loadFonts);
  final photoIds = [for (var i = 1; i <= 10; i++) 800 + i];
  late List<Uint8List> photos;
  setUpAll(() async {
    photos = [
      for (final c in [Colors.blueGrey, Colors.brown, Colors.teal]) await _photo(c),
    ];
  });
  List<Override> photoOverrides() => [
    for (final (i, id) in photoIds.indexed) receiptThumbProvider(id).overrideWith((ref) async => photos[i % 3]),
    receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
  ];
  final settlement = {
    'id': 3,
    'docNo': 'LPJ/CS6/2610/0003',
    'status': 'submitted',
    'statusLabel': 'LPJ Diajukan',
    'usageNotes': 'BBM dan penginapan tim survei',
    'transferredTotal': 1447500,
    'receiptsTotal': 1447376,
    'submitCount': 1,
    'photos': photoIds.take(3).toList(),
  };

  final shots = <String, (Widget, List<Override> Function(), Future<void> Function(WidgetTester)?)>{
    'b2-line-editor': (LineEditorScreen(line: seedDraft().lines[1], masters: _masters), () => const [], null),
    'b2-line-editor-legacy': (
      LineEditorScreen(
        line: const DraftLine(clientUuid: 'l-old', no: 3, description: 'Makan siang', total: 170500, categoryId: 3),
        masters: _masters,
      ),
      () => const [],
      null,
    ),
    'b2-draft-lines': (
      DraftEditorScreen(
        initial: seedDraft().copyWith(
          lines: [
            ...seedDraft().lines.sublist(0, 2),
            seedDraft().lines[2].copyWith(qty: null, uomId: null, unitPrice: null),
          ],
        ),
        masters: _masters,
        isNew: false,
      ),
      () => const [],
      (t) => _scrollTo(t, const Key('line-3')),
    ),
    'b2-detail-lines': (
      const RequestDetailScreen(id: 42),
      () => [requestDetailProvider(42).overrideWith((ref) async => detailFromJson(detailJson())), ...photoOverrides()],
      (t) => _scrollTo(t, const Key('line-2-receipt-mismatch')),
    ),
    'b2-detail-lpj-photos': (
      const RequestDetailScreen(id: 42),
      () => [
        requestDetailProvider(42).overrideWith(
          (ref) async => detailFromJson({
            ...detailJson(),
            'type': 'advance',
            'typeLabel': 'Pengajuan Baru',
            ...advanceJson(status: 'lpj_submitted', allowed: const [], settlement: settlement),
          }),
        ),
        ...photoOverrides(),
      ],
      (t) => _scrollTo(t, const Key('lpj-photos')),
    ),
    'b2-lpj-submit': (
      LpjSubmitScreen(
        settlement: settlementFromJson({...settlement, 'status': 'revision', 'statusLabel': 'LPJ Revisi'}),
        first: false,
      ),
      photoOverrides,
      null,
    ),
    'b2-lpj-submit-full': (
      LpjSubmitScreen(
        settlement: settlementFromJson({...settlement, 'status': 'revision', 'photos': photoIds}),
        first: false,
      ),
      photoOverrides,
      null,
    ),
  };
  for (final MapEntry(key: name, value: (child, overrides, act)) in shots.entries) {
    for (final b in Brightness.values) {
      testWidgets('$name ${b.name}', (tester) async {
        await _shot(tester, name: name, brightness: b, child: child, overrides: overrides(), act: act);
      });
    }
  }
}
