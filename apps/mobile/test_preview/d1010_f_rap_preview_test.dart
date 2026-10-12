// DRMS 10/10 D4 amendment (owner 2026-10-11 "RAP wajib untuk semua proyek yang punya RAB") visual preview WITHOUT a
// device: a project with a RAB but no RAP — draft editor card + submit error, line editor helper, project RAP tab.
// 390×844 logical px, light and dark, bundled fonts.
//
// Not part of CI (outside test/). Run by hand:
//   flutter test test_preview/d1010_f_rap_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
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
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/line_editor_screen.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/projects/application/projects_providers.dart';
import 'package:proyekkas/features/projects/presentation/project_detail_screen.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../test/support/d1010_c_fixtures.dart';
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

final _masters = <String, List<MasterItem>>{
  MasterTypes.projects: [const MasterItem(9, 'TRD-09 — Trading semen Palangka')],
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

/// Project with a RAB and NO RAP (server `rapRequired: true`, no items).
List<Override> _missing() => [
  projectsApiProvider.overrideWithValue(FakeProjectsApi()..rapItems = const []),
  projectRapProvider.overrideWith((ref, id) async => const RapLoad([], required: true)),
];

void main() {
  setUpAll(_loadFonts);
  final noRap = seedDraft().copyWith(lines: [for (final l in seedDraft().lines) l.copyWith(rapItemId: null)]);
  final shots = <String, (Widget, Set<Role>, List<Override> Function(), Future<void> Function(WidgetTester)?)>{
    'f-draft-rap-missing': (
      DraftEditorScreen(initial: noRap, masters: _masters, isNew: false),
      {Role.staff},
      _missing,
      null,
    ),
    'f-draft-rap-missing-submit': (
      DraftEditorScreen(initial: noRap, masters: _masters, isNew: false),
      {Role.pm},
      _missing,
      (t) async {
        await t.scrollUntilVisible(
          find.byKey(const Key('submit-draft')),
          300,
          scrollable: find.byType(Scrollable).first,
        );
        await t.tap(
          find.descendant(of: find.byKey(const Key('submit-draft')), matching: find.bySubtype<FilledButton>()),
        );
        await t.pumpAndSettle();
        await t.drag(find.byType(Scrollable).first, const Offset(0, 3000));
      },
    ),
    'f-line-rap-missing': (
      LineEditorScreen(line: seedDraft().lines.first.copyWith(rapItemId: null), masters: _masters, projectId: 9),
      {Role.staff},
      _missing,
      null,
    ),
    'f-project-rap-missing': (const ProjectDetailScreen(id: 9, initialTab: 1), {Role.staff}, _missing, null),
  };
  for (final MapEntry(key: name, value: (child, roles, overrides, act)) in shots.entries) {
    for (final b in Brightness.values) {
      testWidgets('$name ${b.name}', (tester) async {
        await _shot(tester, name: name, brightness: b, child: child, overrides: overrides(), act: act, roles: roles);
      });
    }
  }
}
