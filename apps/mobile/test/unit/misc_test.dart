import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/router.dart';
import 'package:proyekkas/core/logging/log.dart';
import 'package:proyekkas/core/media/compress_plan.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/jwt.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';

String fakeJwt(Map<String, dynamic> claims) =>
    'eyJhbGciOiJub25lIn0.${base64Url.encode(utf8.encode(jsonEncode(claims))).replaceAll('=', '')}.sig';

void main() {
  group('compression plan (longest side ≤ target with the plugin scaling rule)', () {
    for (final size in [(4000, 3000), (3000, 4000), (4032, 1816), (1200, 900), (1600, 1600), (9000, 1000)]) {
      test('${size.$1}×${size.$2}', () {
        final b = boundsFor(size.$1, size.$2, 1600);
        final out = scaledSize(size.$1, size.$2, b.minWidth, b.minHeight);
        final longest = out.width > out.height ? out.width : out.height;
        expect(longest, lessThanOrEqualTo(1600));
        if (size.$1 <= 1600 && size.$2 <= 1600) expect(out, (width: size.$1, height: size.$2));
        if (size.$1 > 1600 || size.$2 > 1600) expect(longest, greaterThan(1590));
      });
    }

    test('ladder lowers quality before size', () {
      final l = compressionLadder(PhotoTarget.receipt);
      expect(l.first, (maxSide: 1600, quality: 80));
      expect(l[1].maxSide, 1600);
      expect(l.last.maxSide, lessThan(1600));
    });
  });

  group('versions', () {
    test('compare', () {
      expect(compareVersions('0.1.10', '0.1.9'), 1);
      expect(compareVersions('1.0.0+5', '1.0.0'), 0);
      expect(compareVersions('0.9', '1.0.0'), -1);
    });

    test('gate', () {
      expect(evaluateVersion('0.1.0', null), VersionGate.ok);
      expect(evaluateVersion('0.1.0', const AppConfig(minAppVersion: '0.2.0')), VersionGate.updateRequired);
      expect(
        evaluateVersion('0.2.0', const AppConfig(minAppVersion: '0.2.0', latestAppVersion: '0.3.0')),
        VersionGate.updateAvailable,
      );
      expect(AppConfig.fromJson({'minAppVersion': '', 'latestAppVersion': 3}).minAppVersion, isNull);
    });
  });

  test('jwt claims (unverified, only for sub/exp)', () {
    final t = fakeJwt({'sub': 'abc', 'exp': 1790000000});
    expect(subjectOf(t), 'abc');
    expect(expiryOf(t)!.isUtc, isTrue);
    expect(decodeJwtClaims('nope'), isNull);
  });

  test('log redaction hides tokens and long numbers', () {
    final t = fakeJwt({'sub': 'x'});
    expect(Log.redact('Bearer $t acct 1234567890123'), 'Bearer <redacted> acct <num>');
    expect(Log.redact('token=$t'), 'token=<jwt>');
  });

  group('router redirect', () {
    const signedOut = AuthSignedOut();
    final signedIn = AuthSignedIn(
      profile: UserProfile(id: 1, email: 'a@b', roles: {Role.staff}),
      sub: 's',
    );
    String? r(String loc, AuthState a, {VersionGate g = VersionGate.ok}) =>
        redirectFor(location: loc, auth: a, gate: g);

    test('update gate wins', () => expect(r('/home', signedIn, g: VersionGate.updateRequired), '/update'));
    test('starting → splash', () => expect(r('/home', const AuthStarting()), '/splash'));
    // Regression (slow first load): /app/config loads in the background, it never holds the splash.
    test('config not awaited: signed out goes straight to login', () => expect(r('/splash', signedOut), '/login'));
    test('signed out → login', () => expect(r('/requests/1', signedOut), '/login'));
    test('signed in leaves login', () => expect(r('/login', signedIn), '/home'));
    test('signed in stays', () => expect(r('/requests/1', signedIn), isNull));
  });
}
