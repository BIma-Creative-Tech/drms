import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/app/router.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/location/location_service.dart';
import 'package:proyekkas/core/media/compress_plan.dart';
import 'package:proyekkas/core/media/photo_compressor.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/companies/data/company_backfill.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/privacy/application/privacy_providers.dart';
import 'package:proyekkas/features/privacy/data/privacy_api.dart';
import 'package:proyekkas/features/privacy/domain/markdown.dart';
import 'package:proyekkas/features/privacy/domain/privacy.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';

import '../support/fake_dio_adapter.dart';
import '../support/harness.dart';
import '../support/widget_harness.dart';

/// Employee privacy notice on the APK (Q-46, ADR 0018): status / gate, `/me` backward compatibility, markdown
/// subset, router prompt, API (404 tolerance, idempotency key), acknowledgement (never faked offline, retried when
/// the server is reachable again, 409 on a version change), notice cache for offline reading, attendance guard.
const _md = '''
# Pemberitahuan Privasi Uji

- **Versi:** 1 (DRAF)

## 1. Data

| Data | Kapan | Keterangan |
|---|---|---|
| **Foto selfie** | Saat absen | EXIF dihapus |

- **Absensi:** memastikan
  hadir di lokasi.
- Data **tidak** dijual.

<script>alert(1)</script> [tautan](http://x)
''';

const _notice = PrivacyNotice(version: 1, title: 'Pemberitahuan Privasi Uji', markdown: _md);

UserProfile _profile(PrivacyStatus? privacy) =>
    UserProfile(id: 5, email: 'doni@example.test', roles: {Role.staff}, privacy: privacy);

class FakePrivacyApi extends Fake implements PrivacyApi {
  FakePrivacyApi({this.noticeAnswer = _notice});
  PrivacyNotice? noticeAnswer;
  Object? noticeError;
  final keys = <String>[];
  final versions = <int>[];

  /// Next ack answers, in order: a [PrivacyAckResult], `null` (404), or an exception to throw.
  final answers = <Object?>[];

  @override
  Future<PrivacyNotice?> notice() async {
    if (noticeError != null) throw noticeError!;
    return noticeAnswer;
  }

  @override
  Future<PrivacyAckResult?> acknowledge(int version, {required String idempotencyKey}) async {
    keys.add(idempotencyKey);
    versions.add(version);
    final a = answers.isEmpty ? null : answers.removeAt(0);
    if (a is Exception) throw a;
    return a as PrivacyAckResult?;
  }
}

class TestAuth extends AuthController {
  TestAuth(this.initial);
  final AuthState initial;
  int refreshes = 0;
  @override
  AuthState build() => initial;
  @override
  Future<void> refreshProfile() async => refreshes++;
  void set(AuthState s) => state = s;
}

class _NoCompressor implements PhotoCompressor {
  int calls = 0;
  @override
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target) async {
    calls++;
    throw StateError('must not be reached');
  }
}

/// Fictional Idempotency-Key for the ack request (not a secret; see .gitleaksignore for the old literal).
const testIdemKey = 'test-idempotency-key-privacy-ack';

void main() {
  // several independent in-memory databases per test (one per container) — no shared executor
  setUpAll(() => driftRuntimeOptions.dontWarnAboutMultipleDatabases = true);

  group('status + gate', () {
    test('null = not available (server without the feature) → nothing blocked', () {
      expect(privacyGateOf(null), PrivacyGate.notAvailable);
      expect(PrivacyStatus.fromJson(null), isNull);
      expect(PrivacyStatus.fromJson({'ackVersion': 1}), isNull, reason: 'currentVersion is required');
    });

    test('never / older version = required; same or newer = acknowledged', () {
      expect(privacyGateOf(PrivacyStatus.fromJson({'currentVersion': 1, 'ackVersion': null})), PrivacyGate.required);
      expect(privacyGateOf(const PrivacyStatus(currentVersion: 2, ackVersion: 1)), PrivacyGate.required);
      expect(privacyGateOf(const PrivacyStatus(currentVersion: 2, ackVersion: 2)), PrivacyGate.acknowledged);
      expect(privacyGateOf(const PrivacyStatus(currentVersion: 1, ackVersion: 3)), PrivacyGate.acknowledged);
      final s = PrivacyStatus.fromJson({
        'currentVersion': 1.0,
        'ackVersion': '1',
        'ackAt': '2026-10-05T02:00:00.000Z',
      })!;
      expect(s.acknowledged, isTrue);
      expect(PrivacyStatus.fromJson(s.toJson()), s);
    });

    test('/me without `privacy` (server before ADR 0018) parses; with it, the status is kept', () {
      final old = userProfileFromJson({
        'id': 5,
        'email': 'a@b',
        'roles': <String>['pk-staff'],
      });
      expect(old.privacy, isNull);
      final now = userProfileFromJson({
        'id': 5,
        'email': 'a@b',
        'roles': <String>['pk-staff'],
        'privacy': {'currentVersion': 1, 'ackVersion': null, 'ackAt': null},
      });
      expect(now.privacy, const PrivacyStatus(currentVersion: 1));
      expect(now.scopedTo([1]).privacy, now.privacy, reason: 'PT scoping keeps the account-wide status');
    });

    test('notice JSON round trip; malformed → null', () {
      expect(PrivacyNotice.fromJson(_notice.toJson())?.markdown, _md);
      expect(PrivacyNotice.fromJson({'version': 1, 'title': 'x', 'markdown': ' '}), isNull);
      expect(PrivacyNotice.fromJson('nope'), isNull);
    });
  });

  group('markdown subset', () {
    test('headings, list continuation, table, inline styles; HTML and links stay literal text', () {
      final b = parseMarkdown(_md);
      expect(b.map((x) => x.runtimeType.toString()).toList(), [
        'MdHeading',
        'MdList',
        'MdHeading',
        'MdTable',
        'MdList',
        'MdParagraph',
      ]);
      final list = b[4] as MdList;
      expect(mdInlineText(list.items[0]), 'Absensi: memastikan hadir di lokasi.');
      expect(list.items[0].first, isA<MdStrong>());
      final table = b[3] as MdTable;
      expect([for (final h in table.head) mdInlineText(h)], ['Data', 'Kapan', 'Keterangan']);
      expect(mdInlineText(table.rows.single[0]), 'Foto selfie');
      expect(mdInlineText((b.last as MdParagraph).inlines), '<script>alert(1)</script> [tautan](http://x)');
      final inl = parseMdInline(r'*a* _b_ `c` \*d\* e**f snake_case');
      expect(inl.whereType<MdEm>(), hasLength(2));
      expect(inl.whereType<MdCode>().single.text, 'c');
      expect(mdInlineText(inl), 'a b c *d* e**f snake_case');
    });
  });

  group('router prompt (re-shown at every start until acknowledged)', () {
    final signedIn = AuthSignedIn(profile: _profile(null), sub: 's');
    String? r(String loc, {bool prompt = false}) =>
        redirectFor(location: loc, auth: signedIn, gate: VersionGate.ok, privacyPrompt: prompt);

    test('after login / start → the notice instead of home', () {
      expect(r('/login', prompt: true), '/privacy');
      expect(r('/splash', prompt: true), '/privacy');
      expect(r('/home', prompt: true), '/privacy');
    });
    test('other screens stay reachable; no prompt = unchanged behaviour', () {
      expect(r('/requests/1', prompt: true), isNull);
      expect(r('/privacy', prompt: true), isNull);
      expect(r('/splash'), '/home');
      expect(r('/home'), isNull);
    });
    test('update gate and sign-out still win', () {
      expect(
        redirectFor(location: '/home', auth: signedIn, gate: VersionGate.updateRequired, privacyPrompt: true),
        '/update',
      );
      expect(
        redirectFor(location: '/home', auth: const AuthSignedOut(), gate: VersionGate.ok, privacyPrompt: true),
        '/login',
      );
    });
  });

  group('PrivacyApi', () {
    late FakeDioAdapter adapter;
    late PrivacyApi api;
    setUp(() {
      adapter = FakeDioAdapter((c) => (404, {'errors': <Object>[]}));
      final client = testClient('https://example.test', StaticTokens(), reach: (_) {});
      client.dio.httpClientAdapter = adapter;
      api = PrivacyApi(client);
    });

    test('404 (server before ADR 0018) = no notice / no endpoint — never an error', () async {
      expect(await api.notice(), isNull);
      expect(await api.acknowledge(1, idempotencyKey: testIdemKey), isNull);
    });

    test('notice is public (no Authorization); ack carries Idempotency-Key + version', () async {
      adapter.respond = (c) => c.uri.path.endsWith('/privacy-notice')
          ? (200, {'version': 1, 'title': 'T', 'html': '<p>x</p>', 'markdown': '# T'})
          : (200, {'version': 1, 'ackAt': '2026-10-05T02:00:00.000Z', 'alreadyAcknowledged': false});
      final n = await api.notice();
      expect(n?.version, 1);
      expect(adapter.calls.last.headers.containsKey('Authorization'), isFalse);
      final r = await api.acknowledge(1, idempotencyKey: testIdemKey);
      expect(r?.ackAt, '2026-10-05T02:00:00.000Z');
      final call = adapter.calls.last;
      expect(call.method, 'POST');
      expect(call.uri.path, '/api/v1/me/privacy-ack');
      expect(call.headers['Idempotency-Key'], testIdemKey);
      expect(call.headers['Authorization'], 'Bearer access-1');
    });

    test('409 PRIVACY_VERSION_MISMATCH surfaces as ProblemException', () async {
      adapter.respond = (c) => (409, {'title': 'Conflict', 'status': 409, 'code': 'PRIVACY_VERSION_MISMATCH'});
      await expectLater(
        api.acknowledge(1, idempotencyKey: 'k'),
        throwsA(isA<ProblemException>().having((e) => e.code, 'code', privacyVersionMismatchCode)),
      );
    });

    test('transport failure = NetworkException', () async {
      adapter.respond = (c) =>
          throw DioException(requestOptions: RequestOptions(), type: DioExceptionType.connectionError);
      await expectLater(api.notice(), throwsA(isA<NetworkException>()));
    });
  });

  group('acknowledgement + notice cache (ProviderContainer)', () {
    late AppDatabase db;
    late FakePrivacyApi api;
    late TestAuth auth;

    ProviderContainer container({PrivacyStatus? status = const PrivacyStatus(currentVersion: 1), bool online = true}) {
      db = memoryDb();
      addTearDown(db.close);
      api = FakePrivacyApi();
      auth = TestAuth(AuthSignedIn(profile: _profile(status), sub: 'user-sub-1'));
      final c = ProviderContainer(
        retry: (_, _) => null,
        overrides: [
          appEnvProvider.overrideWithValue(testEnv('https://example.test')),
          secureStoreProvider.overrideWithValue(MemorySecureStore()),
          deviceIdentityProvider.overrideWithValue(testDevice()),
          databaseProvider.overrideWithValue(db),
          connectivityProvider.overrideWith(() => FakeConnectivity(online)),
          authControllerProvider.overrideWith(() => auth),
          privacyApiProvider.overrideWithValue(api),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    test('success: the server answer unblocks attendance and updates the cached /me', () async {
      final c = container();
      await db.kvPut(
        profileCacheKey('user-sub-1'),
        jsonEncode({'id': 5, 'privacy': const PrivacyStatus(currentVersion: 1).toJson()}),
      );
      expect(c.read(attendanceBlockedByPrivacyProvider), isTrue);
      expect(c.read(privacyPromptProvider), isTrue);
      api.answers.add(
        const PrivacyAckResult(version: 1, ackAt: '2026-10-05T02:00:00.000Z', alreadyAcknowledged: false),
      );
      expect(await c.read(privacyAckControllerProvider.notifier).acknowledge(1), isTrue);
      expect(c.read(privacyAckControllerProvider).phase, PrivacyAckPhase.done);
      expect(c.read(attendanceBlockedByPrivacyProvider), isFalse);
      expect(c.read(privacyPromptProvider), isFalse);
      expect(c.read(privacyGateProvider), PrivacyGate.acknowledged);
      final cached = await db.kvGetJson(profileCacheKey('user-sub-1'));
      expect(cached?['privacy'], {'currentVersion': 1, 'ackVersion': 1, 'ackAt': '2026-10-05T02:00:00.000Z'});
      expect(auth.refreshes, 1);
    });

    test(
      'offline: NOT acknowledged locally, attendance stays blocked, retried with the same key when online',
      () async {
        final c = container(online: false);
        api.answers.add(const NetworkException());
        expect(await c.read(privacyAckControllerProvider.notifier).acknowledge(1), isFalse);
        expect(c.read(privacyAckControllerProvider).phase, PrivacyAckPhase.waitingForNetwork);
        expect(c.read(attendanceBlockedByPrivacyProvider), isTrue);
        expect(c.read(accountProfileProvider)?.privacy?.ackVersion, isNull);
        // the server answers again → automatic retry, same Idempotency-Key
        api.answers.add(
          const PrivacyAckResult(version: 1, ackAt: '2026-10-05T03:00:00.000Z', alreadyAcknowledged: false),
        );
        c.read(connectivityProvider.notifier).reportServerReachable(true);
        for (var i = 0; i < 50 && c.read(privacyAckControllerProvider).phase != PrivacyAckPhase.done; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 5));
        }
        expect(c.read(privacyAckControllerProvider).phase, PrivacyAckPhase.done);
        expect(api.keys, hasLength(2));
        expect(api.keys[0], api.keys[1], reason: 'one acknowledgement = one Idempotency-Key');
        expect(c.read(attendanceBlockedByPrivacyProvider), isFalse);
      },
    );

    test('409 version mismatch: still blocked, notice + profile reloaded, a new key next time', () async {
      final c = container();
      api.answers.add(const ProblemException(status: 409, code: privacyVersionMismatchCode));
      expect(await c.read(privacyAckControllerProvider.notifier).acknowledge(1), isFalse);
      expect(c.read(privacyAckControllerProvider).phase, PrivacyAckPhase.versionChanged);
      expect(c.read(attendanceBlockedByPrivacyProvider), isTrue);
      expect(auth.refreshes, 1);
      api.answers.add(const PrivacyAckResult(version: 1, ackAt: 'x', alreadyAcknowledged: true));
      await c.read(privacyAckControllerProvider.notifier).acknowledge(1);
      expect(api.keys[0], isNot(api.keys[1]));
    });

    test('404 on the ack (old server): reported as unavailable, nothing faked', () async {
      final c = container();
      api.answers.add(null);
      expect(await c.read(privacyAckControllerProvider.notifier).acknowledge(1), isFalse);
      expect(c.read(privacyAckControllerProvider).phase, PrivacyAckPhase.unavailable);
      expect(c.read(accountProfileProvider)?.privacy?.ackVersion, isNull);
    });

    test('version bump: an acknowledged v1 is required again when the server serves v2', () async {
      final c = container(status: const PrivacyStatus(currentVersion: 1, ackVersion: 1, ackAt: '2026-10-05T02:00:00Z'));
      expect(c.read(privacyPromptProvider), isFalse);
      expect(c.read(attendanceBlockedByPrivacyProvider), isFalse);
      auth.set(
        AuthSignedIn(
          profile: _profile(const PrivacyStatus(currentVersion: 2, ackVersion: 1, ackAt: '2026-10-05T02:00:00Z')),
          sub: 'user-sub-1',
        ),
      );
      expect(c.read(privacyGateProvider), PrivacyGate.required);
      expect(c.read(privacyPromptProvider), isTrue);
      expect(c.read(attendanceBlockedByPrivacyProvider), isTrue);
      // "Nanti": hidden for this run only, attendance still blocked
      c.read(privacyPromptDismissedProvider.notifier).dismiss();
      expect(c.read(privacyPromptProvider), isFalse);
      expect(c.read(attendanceBlockedByPrivacyProvider), isTrue);
    });

    test('server without the feature: nothing blocked, no prompt', () {
      final c = container(status: null);
      expect(c.read(privacyGateProvider), PrivacyGate.notAvailable);
      expect(c.read(attendanceBlockedByPrivacyProvider), isFalse);
      expect(c.read(privacyPromptProvider), isFalse);
    });

    test('notice: fetched online and stored; offline the stored copy; nothing stored → error; 404 → null', () async {
      var c = container();
      expect((await c.read(privacyNoticeProvider.future))?.version, 1);
      expect((await PrivacyNoticeCache(db).read())?.markdown, _md);
      // offline (connectivity) → the stored copy without a network call
      final stored = db;
      c = ProviderContainer(
        retry: (_, _) => null,
        overrides: [
          appEnvProvider.overrideWithValue(testEnv('https://example.test')),
          databaseProvider.overrideWithValue(stored),
          connectivityProvider.overrideWith(() => FakeConnectivity(false)),
          authControllerProvider.overrideWith(() => TestAuth(const AuthSignedOut())),
          privacyApiProvider.overrideWithValue(FakePrivacyApi()..noticeError = const NetworkException()),
        ],
      );
      addTearDown(c.dispose);
      expect((await c.read(privacyNoticeProvider.future))?.title, _notice.title);

      final c2 = container(online: true);
      api.noticeError = const NetworkException();
      await expectLater(c2.read(privacyNoticeProvider.future), throwsA(isA<NetworkException>()));

      final c3 = container();
      api.noticeAnswer = null;
      expect(await c3.read(privacyNoticeProvider.future), isNull);
    });
  });

  test(
    'attendance service refuses to record while the notice is not acknowledged (nothing compressed/queued)',
    () async {
      final db = memoryDb();
      addTearDown(db.close);
      final compressor = _NoCompressor();
      var blocked = true;
      final service = AttendanceService(
        drafts: DraftRepository(db),
        outbox: OutboxRepository(db),
        clock: FakeDeviceClock(),
        compressor: compressor,
        privacyBlocked: () => blocked,
      );
      const site = ProjectSite(id: 7, label: 'P-01', lat: -2.21, lng: 113.91, radiusM: 100);
      const fix = LocationFix(lat: -2.21, lng: 113.91, accuracyM: 5, isMocked: false);
      await expectLater(
        service.record(
          sub: 's',
          kind: AttendanceKind.checkIn,
          site: site,
          fix: fix,
          rawSelfie: Uint8List(4),
          online: true,
        ),
        throwsA(isA<PrivacyNoticeRequiredException>()),
      );
      await expectLater(
        service.recordOnBehalf(
          sub: 's',
          employeeId: 3,
          kind: AttendanceKind.checkIn,
          site: site,
          fix: fix,
          rawPhoto: Uint8List(4),
          lens: CameraLens.back,
          reason: 'HP rusak',
          online: true,
        ),
        throwsA(isA<PrivacyNoticeRequiredException>()),
      );
      expect(compressor.calls, 0);
      expect(await OutboxRepository(db).watchAttendance('s').first, isEmpty);
      blocked = false;
      await expectLater(
        service.record(
          sub: 's',
          kind: AttendanceKind.checkIn,
          site: site,
          fix: fix,
          rawSelfie: Uint8List(4),
          online: true,
        ),
        throwsA(isA<StateError>()),
        reason: 'unblocked → proceeds to compression',
      );
    },
  );
}
