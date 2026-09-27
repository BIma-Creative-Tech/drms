import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/config/app_env.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/presentation/login_screen.dart';

import '../support/widget_harness.dart';

const _passwordEnv = AppEnv(
  flavor: 'staging',
  apiBaseUrl: 'https://example.test',
  oidcIssuer: 'https://example.test/realms/drms-staging',
  oidcClientId: 'proyekkas-mobile',
  oidcRedirectUri: 'id.co.drms.proyekkas:/oauth2redirect',
  pushEnabled: false,
  loginMode: LoginMode.password,
);

/// Records password logins; each attempt waits for [next] so the loading state can be inspected.
class _RecordingAuth extends FakeAuth {
  _RecordingAuth() : super(const AuthSignedOut());
  final attempts = <(String, String)>[];
  int browserLogins = 0;
  Completer<String?> next = Completer<String?>();

  @override
  Future<String?> loginWithPassword({required String username, required String password}) {
    attempts.add((username, password));
    return next.future;
  }

  @override
  Future<String?> login() async {
    browserLogins++;
    return null;
  }
}

Finder _field(String key) => find.descendant(of: find.byKey(Key(key)), matching: find.byType(EditableText));

void main() {
  late _RecordingAuth auth;

  Future<void> pumpLogin(WidgetTester tester, {bool online = true}) async {
    auth = _RecordingAuth();
    await pumpScreen(tester, const LoginScreen(), env: _passwordEnv, online: online, authController: () => auth);
  }

  group('Login form (PK_LOGIN_MODE=password)', () {
    testWidgets('shows the in-app form in Bahasa Indonesia with autofill + email keyboard', (tester) async {
      await pumpLogin(tester);
      expect(find.text('Email atau username'), findsOneWidget);
      expect(find.text('Kata sandi'), findsOneWidget);
      expect(find.text('Masuk'), findsOneWidget);
      expect(find.text('Lupa kata sandi? Hubungi Admin.'), findsOneWidget);
      expect(find.text('STAGING'), findsOneWidget);
      expect(find.textContaining('browser'), findsNothing, reason: 'no browser hint in password mode');

      final user = tester.widget<EditableText>(_field('login-username'));
      expect(user.keyboardType, TextInputType.emailAddress);
      expect(user.autofillHints, containsAll(<String>['username', 'email']));
      final pass = tester.widget<EditableText>(_field('login-password'));
      expect(pass.obscureText, isTrue);
      expect(pass.autofillHints, ['password']);
    });

    testWidgets('validation: empty fields show messages and no login is attempted', (tester) async {
      await pumpLogin(tester);
      await tester.tap(find.byKey(const Key('login-button')));
      await tester.pump();
      expect(find.text('Isi email atau username.'), findsOneWidget);
      expect(find.text('Isi kata sandi.'), findsOneWidget);
      expect(auth.attempts, isEmpty);

      await tester.enterText(find.byKey(const Key('login-username')), '   ');
      await tester.enterText(find.byKey(const Key('login-password')), 'pw');
      await tester.tap(find.byKey(const Key('login-button')));
      await tester.pump();
      expect(find.text('Isi email atau username.'), findsOneWidget);
      expect(find.text('Isi kata sandi.'), findsNothing);
      expect(auth.attempts, isEmpty);
    });

    testWidgets('show/hide toggle reveals the password', (tester) async {
      await pumpLogin(tester);
      expect(tester.widget<EditableText>(_field('login-password')).obscureText, isTrue);
      await tester.tap(find.byKey(const Key('login-password-toggle')));
      await tester.pump();
      expect(tester.widget<EditableText>(_field('login-password')).obscureText, isFalse);
      expect(find.byTooltip('Sembunyikan kata sandi'), findsOneWidget);
    });

    testWidgets('loading state, then inline error; password is cleared, username kept', (tester) async {
      await pumpLogin(tester);
      await tester.enterText(find.byKey(const Key('login-username')), 'doni@example.test');
      await tester.enterText(find.byKey(const Key('login-password')), 'wrong-pass');
      await tester.tap(find.byKey(const Key('login-button')));
      await tester.pump();

      expect(auth.attempts.single, ('doni@example.test', 'wrong-pass'));
      expect(auth.browserLogins, 0);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(tester.widget<ButtonStyleButton>(find.byKey(const Key('login-button'))).onPressed, isNull);
      expect(tester.widget<EditableText>(_field('login-username')).readOnly, isTrue);

      // A second tap while loading does nothing.
      await tester.tap(find.byKey(const Key('login-button')), warnIfMissed: false);
      await tester.pump();
      expect(auth.attempts, hasLength(1));

      auth.next.complete('Email/username atau kata sandi salah.');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('login-error')), findsOneWidget);
      expect(find.text('Email/username atau kata sandi salah.'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(tester.widget<ButtonStyleButton>(find.byKey(const Key('login-button'))).onPressed, isNotNull);
      expect(tester.widget<EditableText>(_field('login-password')).controller.text, isEmpty);
      expect(tester.widget<EditableText>(_field('login-username')).controller.text, 'doni@example.test');
    });

    testWidgets('network result code shows the internet hint; success clears the password too', (tester) async {
      await pumpLogin(tester);
      await tester.enterText(find.byKey(const Key('login-username')), 'doni');
      await tester.enterText(find.byKey(const Key('login-password')), 'pw-1');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(auth.attempts.single, ('doni', 'pw-1'), reason: 'keyboard "done" submits');
      auth.next.complete('network');
      await tester.pumpAndSettle();
      expect(find.text('Login pertama kali butuh koneksi internet.'), findsOneWidget);

      auth.next = Completer<String?>();
      await tester.enterText(find.byKey(const Key('login-password')), 'pw-2');
      await tester.tap(find.byKey(const Key('login-button')));
      await tester.pump();
      auth.next.complete(null);
      await tester.pumpAndSettle();
      expect(auth.attempts.last, ('doni', 'pw-2'));
      expect(find.byKey(const Key('login-error')), findsNothing);
      expect(tester.widget<EditableText>(_field('login-password')).controller.text, isEmpty);
    });

    testWidgets('offline: Masuk disabled with the internet hint; session-ended notice shown', (tester) async {
      await pumpScreen(
        tester,
        const LoginScreen(),
        env: _passwordEnv,
        online: false,
        auth: const AuthSignedOut(message: 'session_ended'),
      );
      expect(tester.widget<ButtonStyleButton>(find.byKey(const Key('login-button'))).onPressed, isNull);
      expect(find.text('Login pertama kali butuh koneksi internet.'), findsOneWidget);
      expect(find.text('Sesi berakhir atau perangkat dicabut. Silakan masuk kembali.'), findsOneWidget);
    });
  });

  testWidgets('remote device revoke (401 DEVICE_REVOKED) → specific Indonesian notice', (tester) async {
    await pumpScreen(
      tester,
      const LoginScreen(),
      env: _passwordEnv,
      auth: const AuthSignedOut(message: signedOutDeviceRevoked),
    );
    expect(
      find.text(
        'Perangkat ini sudah dicabut dari akun Anda oleh Admin/Direktur. Silakan masuk kembali atau hubungi Admin.',
      ),
      findsOneWidget,
    );
  });

  group('Login (PK_LOGIN_MODE=browser, unchanged)', () {
    testWidgets('one Masuk button, no form fields, opens the browser flow', (tester) async {
      auth = _RecordingAuth();
      await pumpScreen(tester, const LoginScreen(), authController: () => auth);
      expect(find.byKey(const Key('login-username')), findsNothing);
      expect(find.byKey(const Key('login-password')), findsNothing);
      expect(find.text('Gunakan akun DRMS Anda. Halaman masuk dibuka di browser HP.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('login-button')));
      await tester.pumpAndSettle();
      expect(auth.browserLogins, 1);
      expect(auth.attempts, isEmpty);
    });
  });
}
