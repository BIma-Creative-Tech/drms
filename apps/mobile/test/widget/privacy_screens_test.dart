import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/app/theme.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/location/location_service.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/attendance/presentation/attendance_screen.dart';
import 'package:proyekkas/features/attendance/presentation/on_behalf_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/privacy/application/privacy_providers.dart';
import 'package:proyekkas/features/privacy/data/privacy_api.dart';
import 'package:proyekkas/features/privacy/domain/privacy.dart';
import 'package:proyekkas/features/privacy/presentation/privacy_notice_screen.dart';
import 'package:proyekkas/features/settings/presentation/profile_screen.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../support/harness.dart';
import '../support/widget_harness.dart';

/// Privacy notice on the APK (Q-46, ADR 0018): attendance blocked until acknowledged, full-screen notice with
/// "Saya mengerti" / "Nanti", offline acknowledgement never faked, 404 tolerance, profile entry.
const _md =
    '# Pemberitahuan Privasi Uji\n\n- **Versi:** 1\n\n## 4. Berapa lama disimpan\n\n- **Foto selfie absensi: 6 bulan**.\n';
const _notice = PrivacyNotice(version: 1, title: 'Pemberitahuan Privasi Uji', markdown: _md);
const _site = ProjectSite(id: 7, label: 'P-01 — Gudang Contoh', lat: -2.21, lng: 113.91, radiusM: 100);
const _required = PrivacyStatus(currentVersion: 1);
const _acked = PrivacyStatus(currentVersion: 1, ackVersion: 1, ackAt: '2026-10-05T02:12:00.000Z');

UserProfile _profile(Set<Role> roles, PrivacyStatus? privacy) => profile(roles).copyWith(privacy: privacy);

class TestAuth extends AuthController {
  TestAuth(this.initial);
  final AuthState initial;
  @override
  AuthState build() => initial;
  @override
  Future<void> refreshProfile() async {}
}

class FakePrivacyApi extends Fake implements PrivacyApi {
  final answers = <Object?>[];
  int calls = 0;
  @override
  Future<PrivacyNotice?> notice() async => _notice;
  @override
  Future<PrivacyAckResult?> acknowledge(int version, {required String idempotencyKey}) async {
    calls++;
    final a = answers.isEmpty ? null : answers.removeAt(0);
    if (a is Exception) throw a;
    return a as PrivacyAckResult?;
  }
}

class _NoAttendance extends Fake implements AttendanceService {
  int calls = 0;
  @override
  Future<String> record({
    required String sub,
    required AttendanceKind kind,
    required ProjectSite site,
    required LocationFix fix,
    required Uint8List rawSelfie,
    required bool online,
  }) async {
    calls++;
    return 'op-1';
  }
}

ButtonStyleButton _button(WidgetTester tester, String key) => tester.widget<ButtonStyleButton>(find.byKey(Key(key)));

/// The notice screen inside a GoRouter (it navigates with go / pop): `/privacy` (start-up prompt) and `/home`.
Future<ProviderContainer> _pumpNotice(
  WidgetTester tester, {
  required PrivacyStatus? status,
  FakePrivacyApi? api,
  bool online = true,
  List<Override> overrides = const [],
}) async {
  await initializeDateFormatting('id');
  tester.view.physicalSize = const Size(1200, 3200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final db = memoryDb();
  addTearDown(db.close);
  final router = GoRouter(
    initialLocation: '/privacy',
    routes: [
      GoRoute(
        path: '/privacy',
        builder: (_, s) => PrivacyNoticeScreen(pushed: s.uri.queryParameters['from'] != null),
      ),
      GoRoute(
        path: '/home',
        builder: (_, _) => const Scaffold(body: Text('HOME')),
      ),
    ],
  );
  addTearDown(router.dispose);
  final scope = ProviderScope(
    retry: (_, _) => null,
    overrides: [
      appEnvProvider.overrideWithValue(testEnv('https://example.test')),
      secureStoreProvider.overrideWithValue(MemorySecureStore()),
      deviceIdentityProvider.overrideWithValue(testDevice()),
      databaseProvider.overrideWithValue(db),
      connectivityProvider.overrideWith(() => FakeConnectivity(online)),
      authControllerProvider.overrideWith(
        () => TestAuth(AuthSignedIn(profile: _profile({Role.staff}, status), sub: 'user-sub-1')),
      ),
      privacyApiProvider.overrideWithValue(api ?? FakePrivacyApi()),
      ...overrides,
    ],
    child: MaterialApp.router(
      theme: buildTheme(),
      locale: const Locale('id'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      routerConfig: router,
    ),
  );
  await tester.pumpWidget(scope);
  await tester.pumpAndSettle();
  return ProviderScope.containerOf(tester.element(find.byType(MaterialApp)));
}

void main() {
  group('attendance is blocked until the notice is acknowledged', () {
    late _NoAttendance service;
    late int selfies;
    setUp(() {
      service = _NoAttendance();
      selfies = 0;
    });

    Future<void> pumpCheck(WidgetTester tester, PrivacyStatus? status) => pumpScreen(
      tester,
      const AttendanceScreen(),
      auth: AuthSignedIn(profile: _profile({Role.staff}, status), sub: 'user-sub-1'),
      overrides: [
        appConfigProvider.overrideWith((ref) async => const AppConfig(syncAttendance: true)),
        attendanceSitesProvider.overrideWith((ref) async => const [_site]),
        attendanceItemsProvider.overrideWith((ref) => Stream.value(const [])),
        attendanceServiceProvider.overrideWithValue(service),
        locationServiceProvider.overrideWithValue(
          FixedLocationService(const LocationFix(lat: -2.2102, lng: 113.91, accuracyM: 8, isMocked: false)),
        ),
        selfieCaptureProvider.overrideWithValue((context, title) async {
          selfies++;
          return Uint8List(4);
        }),
      ],
    );

    testWidgets('not acknowledged: clear Indonesian message, check-in/out + distance disabled, no camera', (
      tester,
    ) async {
      await pumpCheck(tester, _required);
      expect(find.byKey(const Key('privacy-attendance-block')), findsOneWidget);
      expect(find.textContaining('Absensi (selfie dan lokasi) belum bisa dipakai'), findsOneWidget);
      expect(find.text('Baca pemberitahuan privasi'), findsOneWidget);
      expect(_button(tester, 'attendance-checkIn').onPressed, isNull);
      expect(_button(tester, 'attendance-checkOut').onPressed, isNull);
      expect(_button(tester, 'attendance-check-distance').onPressed, isNull);
      await tester.tap(find.byKey(const Key('attendance-checkIn')));
      await tester.pumpAndSettle();
      expect(selfies, 0);
      expect(service.calls, 0);
    });

    testWidgets('acknowledged: unchanged attendance (selfie taken, item queued)', (tester) async {
      await pumpCheck(tester, _acked);
      expect(find.byKey(const Key('privacy-attendance-block')), findsNothing);
      await tester.tap(find.byKey(const Key('attendance-checkIn')));
      await tester.pumpAndSettle();
      expect(selfies, 1);
      expect(service.calls, 1);
    });

    testWidgets('server without the notice (APK 0.3.3 against an older server): not blocked', (tester) async {
      await pumpCheck(tester, null);
      expect(find.byKey(const Key('privacy-attendance-block')), findsNothing);
      expect(_button(tester, 'attendance-checkIn').onPressed, isNotNull);
    });

    testWidgets('PM on-behalf attendance is blocked by the PM\'s own acknowledgement', (tester) async {
      await pumpScreen(
        tester,
        const OnBehalfScreen(employeeId: 44),
        auth: AuthSignedIn(profile: _profile({Role.pm}, _required), sub: 'user-sub-1'),
        overrides: [
          appConfigProvider.overrideWith((ref) async => const AppConfig(syncAttendance: true)),
          onBehalfCandidatesProvider.overrideWith(
            (ref) async => const [
              OnBehalfCandidate(employeeId: 44, name: 'Budi Contoh', sites: [_site]),
            ],
          ),
          attendanceServiceProvider.overrideWithValue(service),
        ],
      );
      expect(find.byKey(const Key('privacy-attendance-block')), findsOneWidget);
      expect(_button(tester, 'on-behalf-submit').onPressed, isNull);
    });
  });

  group('full-screen notice', () {
    testWidgets('renders the markdown; "Saya mengerti" → server ack → home, attendance unblocked', (tester) async {
      final api = FakePrivacyApi()
        ..answers.add(
          const PrivacyAckResult(version: 1, ackAt: '2026-10-05T02:12:00.000Z', alreadyAcknowledged: false),
        );
      final c = await _pumpNotice(tester, status: _required, api: api);
      expect(find.text('Pemberitahuan Privasi Uji'), findsOneWidget);
      expect(find.textContaining('Foto selfie absensi: 6 bulan'), findsOneWidget);
      expect(find.byKey(const Key('privacy-later')), findsOneWidget);
      expect(c.read(attendanceBlockedByPrivacyProvider), isTrue);
      await tester.tap(find.byKey(const Key('privacy-ack')));
      await tester.pumpAndSettle();
      expect(api.calls, 1);
      expect(find.text('HOME'), findsOneWidget);
      expect(find.text('Terima kasih. Pemberitahuan privasi sudah tercatat dibaca.'), findsOneWidget);
      expect(c.read(attendanceBlockedByPrivacyProvider), isFalse);
    });

    testWidgets('offline: stays on the notice with a retry message; attendance stays blocked', (tester) async {
      final api = FakePrivacyApi()..answers.add(const NetworkException());
      final c = await _pumpNotice(tester, status: _required, api: api, online: false);
      await tester.tap(find.byKey(const Key('privacy-ack')));
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsNothing);
      expect(find.byKey(const Key('privacy-ack-waitingForNetwork')), findsOneWidget);
      expect(find.textContaining('Belum terkirim: tidak ada koneksi'), findsOneWidget);
      expect(c.read(attendanceBlockedByPrivacyProvider), isTrue);
      expect(c.read(accountProfileProvider)?.privacy?.ackVersion, isNull);
      // still offline: the button stays usable as a manual retry
      expect(_button(tester, 'privacy-ack').onPressed, isNotNull);
    });

    testWidgets('"Nanti": goes home for this run, attendance stays blocked', (tester) async {
      final c = await _pumpNotice(tester, status: _required);
      await tester.tap(find.byKey(const Key('privacy-later')));
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
      expect(c.read(privacyPromptProvider), isFalse);
      expect(c.read(attendanceBlockedByPrivacyProvider), isTrue);
    });

    testWidgets('no stored copy and no connection: explained, acknowledgement impossible', (tester) async {
      await _pumpNotice(
        tester,
        status: _required,
        online: false,
        overrides: [privacyNoticeProvider.overrideWith((ref) async => throw const NetworkException())],
      );
      expect(find.byKey(const Key('privacy-offline')), findsOneWidget);
      expect(find.textContaining('belum tersimpan di HP ini'), findsOneWidget);
      expect(_button(tester, 'privacy-ack').onPressed, isNull);
    });

    testWidgets('404 (server without the notice): "belum tersedia", nothing to acknowledge', (tester) async {
      await _pumpNotice(tester, status: null, overrides: [privacyNoticeProvider.overrideWith((ref) async => null)]);
      expect(find.byKey(const Key('privacy-not-available')), findsOneWidget);
      expect(find.byKey(const Key('privacy-ack')), findsNothing);
      await tester.tap(find.byKey(const Key('privacy-close')));
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
    });

    testWidgets('already acknowledged: shows when, "Lanjut" closes', (tester) async {
      await _pumpNotice(tester, status: _acked);
      expect(find.byKey(const Key('privacy-acknowledged')), findsOneWidget);
      expect(find.textContaining('Sudah Anda baca (versi 1, 5 Okt 2026 10.12 WITA)'), findsOneWidget);
      expect(find.byKey(const Key('privacy-ack')), findsNothing);
    });
  });

  group('profile entry', () {
    testWidgets('"Pemberitahuan privasi" with the acknowledgement status', (tester) async {
      await pumpScreen(
        tester,
        const ProfileScreen(),
        auth: AuthSignedIn(profile: _profile({Role.staff}, _required), sub: 'user-sub-1'),
      );
      expect(find.byKey(const Key('profile-privacy')), findsOneWidget);
      expect(find.text('Belum Anda baca — absensi terkunci.'), findsOneWidget);
    });

    testWidgets('outdated version and acknowledged texts', (tester) async {
      await pumpScreen(
        tester,
        const ProfileScreen(),
        auth: AuthSignedIn(
          profile: _profile({Role.staff}, const PrivacyStatus(currentVersion: 2, ackVersion: 1, ackAt: 'x')),
          sub: 'user-sub-1',
        ),
      );
      expect(find.textContaining('Ada versi baru (versi 2)'), findsOneWidget);
    });
  });
}
