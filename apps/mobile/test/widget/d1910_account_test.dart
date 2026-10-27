import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/platform/browser.dart';
import 'package:proyekkas/features/account/application/account_providers.dart';
import 'package:proyekkas/features/account/data/account_api.dart';
import 'package:proyekkas/features/account/domain/account.dart';
import 'package:proyekkas/features/account/presentation/account_screen.dart';
import 'package:proyekkas/features/account/presentation/security_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/home/domain/web_route_map.dart';
import 'package:proyekkas/features/settings/presentation/profile_screen.dart';
import 'package:proyekkas/features/sync/application/sync_coordinator.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';

import '../support/widget_harness.dart';

final _png = Uint8List.fromList(
  base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
);

MeAccount _account({int? signatureId}) => MeAccount.fromJson({
  'id': 5,
  'email': 'doni@example.test',
  'name': 'Doni Pratama',
  'phone': null,
  'displayName': 'Doni',
  'signature': signatureId == null ? null : {'id': signatureId, 'width': 800, 'height': 300},
  'editable': ['signature'],
});

MeSecurity _security(String state, [List<Map<String, dynamic>> authenticators = const []]) => MeSecurity.fromJson({
  'twoFactor': {'state': state, 'authenticators': authenticators},
  'manageUrl': 'https://drms.example.test/admin/keamanan-akun',
});

class _FakeApi implements AccountApi {
  _FakeApi(this.current);
  MeAccount current;
  final calls = <String>[];

  @override
  ApiClient get client => throw UnimplementedError();

  @override
  Future<MeAccount> account() async => current;

  @override
  Future<MeAccount> setSignature(int? mediaId) async {
    calls.add('set:$mediaId');
    if (mediaId == 99)
      throw const ProblemException(status: 403, detail: 'Tanda tangan harus gambar yang Anda unggah sendiri.');
    return current = _account(signatureId: mediaId);
  }

  @override
  Future<int> uploadSignature(Uint8List png) async {
    calls.add('upload:${png.length}');
    return 41;
  }

  @override
  Future<Uint8List> signatureImage(int id) async => _png;

  @override
  Future<MeSecurity> security() async => _security('inactive');
}

class _FakeBrowser implements Browser {
  _FakeBrowser({this.ok = true});
  final bool ok;
  final opened = <String>[];

  @override
  Future<bool> open(String url) async {
    opened.add(url);
    return ok;
  }
}

/// User 2026-10-19 (APK ↔ web parity, phase 2): "Profil & tanda tangan" and "Keamanan akun" from Profil.
void main() {
  group('domain', () {
    test('MeAccount / MeSecurity from the server JSON', () {
      expect(_account().signatureId, isNull);
      expect(_account(signatureId: 7).signatureId, 7);
      final s = _security('active', [
        {'id': 'cred-1', 'label': 'HP pribadi', 'createdAt': '2026-10-01T00:00:00.000Z'},
      ]);
      expect(s.state, TwoFactorState.active);
      expect(s.authenticators.single.label, 'HP pribadi');
      expect(_security('weird').state, TwoFactorState.unknown);
    });

    test('web avatar menu maps to the APK screen', () {
      expect(apkTargetFor('/keamanan-akun')?.route, '/security');
      expect(isPng(_png), isTrue);
      expect(isPng(Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0])), isFalse);
    });
  });

  group('Profil & tanda tangan', () {
    Future<_FakeApi> pump(WidgetTester tester, MeAccount a) async {
      final api = _FakeApi(a);
      await pumpScreen(tester, const AccountScreen(), overrides: [accountApiProvider.overrideWithValue(api)]);
      return api;
    }

    testWidgets('account data read-only (Admin manages it); no signature yet', (tester) async {
      await pump(tester, _account());
      expect(find.text('Doni Pratama'), findsOneWidget);
      expect(find.text('doni@example.test'), findsOneWidget);
      expect(find.text('Nama, email, dan No. HP hanya dapat diubah oleh Admin.'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      expect(find.byKey(const Key('account-signature-none')), findsOneWidget);
      expect(find.byKey(const Key('account-signature-remove')), findsNothing);
      expect(find.byKey(const Key('account-signature-draw')), findsOneWidget);
      expect(find.byKey(const Key('account-signature-upload')), findsOneWidget);
    });

    testWidgets('profile signature shown; Hapus asks first, then removes it', (tester) async {
      final api = await pump(tester, _account(signatureId: 7));
      expect(find.byKey(const Key('account-signature-image')), findsOneWidget);
      await tester.tap(find.byKey(const Key('account-signature-remove')));
      await tester.pumpAndSettle();
      expect(api.calls, isEmpty, reason: 'nothing before the confirmation');
      await confirmPopup(tester, key: const Key('account-signature-remove-confirm'));
      expect(api.calls, ['set:null']);
      expect(find.text('Tanda tangan dihapus.'), findsOneWidget);
      await dismissResult(tester);
      expect(find.byKey(const Key('account-signature-none')), findsOneWidget);
    });

    testWidgets('drawing: an empty pad is not saved', (tester) async {
      final api = await pump(tester, _account());
      await tester.tap(find.byKey(const Key('account-signature-draw')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('account-signature-pad')), findsOneWidget);
      await tester.tap(find.byKey(const Key('account-signature-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('account-signature-pad')), findsOneWidget, reason: 'sheet stays open');
      expect(api.calls, isEmpty);
    });
  });

  group('Keamanan akun', () {
    Future<_FakeBrowser> pump(WidgetTester tester, MeSecurity s, {bool browserOk = true}) async {
      final browser = _FakeBrowser(ok: browserOk);
      await pumpScreen(
        tester,
        const SecurityScreen(),
        overrides: [meSecurityProvider.overrideWith((ref) async => s), browserProvider.overrideWithValue(browser)],
      );
      return browser;
    }

    testWidgets('inactive: steps + "Aktifkan 2FA" opens the web page', (tester) async {
      final browser = await pump(tester, _security('inactive'));
      expect(find.byKey(const Key('security-2fa-inactive')), findsOneWidget);
      expect(find.textContaining('Pasang aplikasi autentikator'), findsOneWidget);
      await tester.tap(find.byKey(const Key('security-enable')));
      await tester.pumpAndSettle();
      expect(browser.opened, ['https://drms.example.test/admin/keamanan-akun']);
    });

    testWidgets('active: authenticators listed, manage on the web', (tester) async {
      final browser = await pump(
        tester,
        _security('active', [
          {'id': 'cred-0001-aaaa', 'label': 'HP pribadi', 'createdAt': '2026-10-01T00:00:00.000Z'},
        ]),
      );
      expect(find.byKey(const Key('security-2fa-active')), findsOneWidget);
      expect(find.text('HP pribadi'), findsOneWidget);
      expect(find.byKey(const Key('security-enable')), findsNothing);
      await tester.tap(find.byKey(const Key('security-manage')));
      await tester.pumpAndSettle();
      expect(browser.opened, hasLength(1));
    });

    testWidgets('unknown status; no browser → the URL is shown', (tester) async {
      await pump(tester, _security('unknown'), browserOk: false);
      expect(find.byKey(const Key('security-2fa-unknown')), findsOneWidget);
      await tester.tap(find.byKey(const Key('security-enable')));
      await tester.pumpAndSettle();
      expect(find.textContaining('https://drms.example.test/admin/keamanan-akun'), findsOneWidget);
    });
  });

  testWidgets('Profil lists both entries for every role', (tester) async {
    for (final roles in [
      {Role.operator},
      {Role.principal, Role.owner},
    ]) {
      await pumpScreen(
        tester,
        const ProfileScreen(),
        auth: AuthSignedIn(profile: profile(roles), sub: 'user-sub-1'),
        overrides: [outboxCountsProvider.overrideWith((ref) => Stream.value(const OutboxCounts()))],
      );
      expect(find.byKey(const Key('profile-account')), findsOneWidget);
      expect(find.byKey(const Key('profile-security')), findsOneWidget);
    }
  });
}
