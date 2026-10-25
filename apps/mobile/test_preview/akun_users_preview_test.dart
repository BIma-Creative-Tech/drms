// D2510 "akun" group preview (users + clients/vendors) WITHOUT a device: pumps the real screens with fake providers
// and the bundled fonts, 390×844 logical px, light and dark, and writes PNGs (same harness as
// screens_preview_test.dart, but the screens are pumped directly instead of through the router).
//
// Not part of CI's `flutter test` (lives outside test/); the mobile-preview workflow runs it:
//   flutter test test_preview/akun_users_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
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
import 'package:proyekkas/features/clients/client_form.dart';
import 'package:proyekkas/features/clients/client_form_screen.dart';
import 'package:proyekkas/features/clients/vendor_form.dart';
import 'package:proyekkas/features/clients/vendor_form_screen.dart';
import 'package:proyekkas/features/users/access_matrix_screen.dart';
import 'package:proyekkas/features/users/onboarding.dart';
import 'package:proyekkas/features/users/onboarding_screen.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

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

Map<String, dynamic> _pt(int id, String code, String name, {Map<String, dynamic>? membership, bool rich = false}) => {
  'id': id,
  'shortCode': code,
  'name': name,
  'canManageEmployees': true,
  'membership': membership,
  'employee': rich
      ? {'id': 12, 'code': 'E12', 'name': 'Doni Pratama', 'attendanceType': 'onsite', 'active': true}
      : null,
  'bankAccounts': rich
      ? [
          {
            'id': 4,
            'bank': 1,
            'bankName': 'BCA',
            'accountNo': '1234567890',
            'accountHolder': 'Doni Pratama',
            'isDefault': true,
            'verificationStatus': 'verified',
            'active': true,
          },
          {
            'id': 5,
            'bank': 2,
            'bankName': 'Mandiri',
            'accountNo': '9876543210',
            'accountHolder': 'Doni Pratama',
            'isDefault': false,
            'verificationStatus': 'pending',
            'active': true,
          },
        ]
      : [],
  'employeeChoices': [],
  'canManageAssignments': true,
  'assignments': rich
      ? [
          {'id': 1, 'label': 'P-07 — Gudang Contoh', 'roleInProject': 'staff', 'startDate': '2026-01-05'},
        ]
      : [],
  'assignmentChoices': {'projects': [], 'costCenters': [], 'sites': []},
};

OnbDetail _newUser() => OnbDetail({
  'user': null,
  'companies': [_pt(1, 'CS1', 'PT Contoh Satu'), _pt(2, 'CS2', 'PT Contoh Dua')],
});

OnbDetail _editUser() => OnbDetail({
  'user': {
    'id': 21,
    'email': 'doni@example.test',
    'name': 'Doni Pratama',
    'phone': '0812 3456 7890',
    'active': true,
    'identityEditable': true,
  },
  'companies': [
    _pt(
      1,
      'CS1',
      'PT Contoh Satu',
      membership: {
        'id': 3,
        'roles': ['pk-staff', 'pk-pm'],
      },
      rich: true,
    ),
    _pt(2, 'CS2', 'PT Contoh Dua'),
  ],
});

Map<String, dynamic> _matrix() => {
  'viewer': {
    'groupAdmin': false,
    'adminOf': [1],
  },
  'roles': [
    {'value': 'pk-staff', 'label': 'Staff', 'short': 'Staff'},
    {'value': 'pk-pm', 'label': 'PM', 'short': 'PM'},
    {'value': 'pk-finance', 'label': 'Finance', 'short': 'Fin'},
    {'value': 'pk-principal', 'label': 'Owner', 'short': 'Own'},
    {'value': 'pk-operator', 'label': 'Operator', 'short': 'Opr'},
  ],
  'companies': [
    {'id': 1, 'shortCode': 'CS1', 'name': 'PT Contoh Satu'},
    {'id': 2, 'shortCode': 'CS2', 'name': 'PT Contoh Dua'},
  ],
  'users': {
    'items': [
      {'id': 21, 'name': 'Sari Wulandari', 'email': 'sari@x.test', 'active': true},
      {'id': 22, 'name': 'Budi Santoso', 'email': 'budi@x.test', 'active': false},
    ],
    'page': 1,
    'totalPages': 1,
    'totalDocs': 2,
  },
  'cells': [
    {
      'id': 3,
      'user': 21,
      'company': 1,
      'roles': ['pk-staff', 'pk-pm'],
      'employee': 9,
      'active': true,
    },
    {'id': 4, 'user': 22, 'company': 1, 'roles': <String>[], 'employee': null, 'active': false},
    {
      'id': 5,
      'user': 22,
      'company': 2,
      'roles': ['pk-finance'],
      'employee': null,
      'active': true,
    },
  ],
  'employees': [
    {'id': 9, 'company': 1, 'code': 'E09', 'name': 'Sari Wulandari', 'active': true},
  ],
  'warnings': ['PT CS2 tidak punya Direktur aktif — pengajuan CS2 tidak bisa diajukan (409).'],
};

ClientFormData _client() => ClientFormData(
  id: 8,
  name: 'PT Bangun Sejahtera',
  address: 'Jl. Ahmad Yani No. 12, Balikpapan',
  canEdit: true,
  companies: const [(1, 'CS1 — PT Contoh Satu')],
  contacts: [
    ClientContact(id: 'a', name: 'Rina Kusuma', position: 'Manajer Proyek', phone: '0812 1111 2222', isPrimary: true),
    ClientContact(id: 'b', name: 'Agus Salim', position: 'Keuangan', email: 'agus@bangun.test'),
  ],
  projects: const ['P-07 Gudang Contoh', 'P-09 Kantor Cabang'],
);

VendorFormData _vendor() => VendorFormData({
  'vendor': {
    'id': 3,
    'name': 'CV Sumber Baja',
    'address': 'Jl. Soekarno Hatta Km 5, Balikpapan',
    'npwp': '01.234.567.8-901.000',
    'active': true,
    'contacts': [
      {'id': 'c', 'name': 'Hendra', 'position': 'Sales', 'phone': '0813 2222 3333', 'isPrimary': true},
    ],
  },
  'companies': [
    {'id': 1, 'shortCode': 'CS1', 'name': 'PT Contoh Satu', 'canManageBankAccounts': true},
  ],
  'canEdit': true,
  'bankAccounts': [
    {
      'id': 7,
      'bank': 1,
      'bankName': 'BRI',
      'accountNo': '0011223344',
      'accountHolder': 'CV Sumber Baja',
      'isDefault': true,
      'verificationStatus': 'verified',
      'active': true,
    },
  ],
});

Future<void> _shot(
  WidgetTester tester, {
  required String name,
  required Brightness brightness,
  required Widget screen,
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
          () => FakeAuth(AuthSignedIn(profile: profile({Role.admin}), sub: 'preview-sub')),
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
  await db.close();
}

/// Jumps the first scrollable under [listKey] by [dy] logical px.
Future<void> _scroll(WidgetTester tester, String listKey, double dy) async {
  final list = find.descendant(of: find.byKey(Key(listKey)), matching: find.byType(Scrollable)).first;
  final position = tester.state<ScrollableState>(list).position;
  position.jumpTo((position.pixels + dy).clamp(0, position.maxScrollExtent));
  await tester.pump();
}

void main() {
  setUpAll(_loadFonts);

  final onbNew = onboardingProvider(null).overrideWith((ref) async => _newUser());
  final onbEdit = onboardingProvider(21).overrideWith((ref) async => _editUser());
  final shots = <String, (Widget, List<Override>, Future<void> Function(WidgetTester)?)>{
    'akun-user-new': (const OnboardingScreen(), [onbNew], null),
    'akun-user-new-errors': (
      const OnboardingScreen(),
      [onbNew],
      (tester) async {
        await tester.ensureVisible(find.byKey(const Key('onb-save')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('onb-save')), warnIfMissed: false);
        await tester.pumpAndSettle();
        await _scroll(tester, 'onb-form', -100000);
      },
    ),
    'akun-user-edit': (const OnboardingScreen(id: 21), [onbEdit], null),
    'akun-user-edit-scrolled': (
      const OnboardingScreen(id: 21),
      [onbEdit],
      (tester) => _scroll(tester, 'onb-form', 520),
    ),
    'akun-access-matrix': (
      const AccessMatrixScreen(),
      [accessMatrixProvider.overrideWith((ref, m) async => _matrix())],
      null,
    ),
    'akun-client-form': (
      const ClientFormScreen(id: 8),
      [clientFormProvider(8).overrideWith((ref) async => _client())],
      null,
    ),
    'akun-client-form-scrolled': (
      const ClientFormScreen(id: 8),
      [clientFormProvider(8).overrideWith((ref) async => _client())],
      (tester) => _scroll(tester, 'client-form', 400),
    ),
    'akun-vendor-form': (
      const VendorFormScreen(id: 3),
      [vendorFormProvider(3).overrideWith((ref) async => _vendor())],
      null,
    ),
    'akun-vendor-form-scrolled': (
      const VendorFormScreen(id: 3),
      [vendorFormProvider(3).overrideWith((ref) async => _vendor())],
      (tester) => _scroll(tester, 'vendor-form', 450),
    ),
  };
  for (final MapEntry(key: name, value: (screen, overrides, act)) in shots.entries) {
    for (final b in Brightness.values) {
      testWidgets('$name ${b.name}', (tester) async {
        await _shot(tester, name: name, brightness: b, screen: screen, overrides: overrides, act: act);
      });
    }
  }
}
