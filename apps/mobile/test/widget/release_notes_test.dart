import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/app_config/presentation/update_required_screen.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';

import '../support/widget_harness.dart';

/// "Yang baru di versi X" (release notes from GET /app/config) on the home update banner sheet and on the
/// blocking update screen. The installed test APK is 0.1.0 (testDevice()).
const _url = 'https://drms-kas.example.test/unduh/proyekkas.apk';
const _notes = ['Bisa masuk dengan kode Authenticator.', 'Pesan salah login lebih jelas.'];

void main() {
  testWidgets('home: banner when a newer version exists → sheet with notes, link and copy button', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      overrides: [
        appConfigProvider.overrideWith(
          (ref) async => AppConfig.fromJson({'latestVersion': '0.2.1', 'downloadUrl': _url, 'releaseNotes': _notes}),
        ),
      ],
    );
    expect(find.byKey(const Key('update-available-banner')), findsOneWidget);
    expect(find.text('Versi baru tersedia (0.2.1).'), findsOneWidget);
    expect(find.text('Ketuk untuk melihat yang baru dan cara memperbarui.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('update-available-banner')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('update-sheet')), findsOneWidget);
    expect(find.text('Yang baru di versi 0.2.1'), findsOneWidget);
    for (final n in _notes) {
      expect(find.text(n), findsOneWidget);
    }
    expect(find.text(_url), findsOneWidget);
    expect(find.byKey(const Key('update-copy-link')), findsOneWidget);
  });

  testWidgets('home: sheet without notes (older server) still shows the link', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      overrides: [
        appConfigProvider.overrideWith((ref) async => const AppConfig(latestAppVersion: '0.2.1', appDownloadUrl: _url)),
      ],
    );
    await tester.tap(find.byKey(const Key('update-available-banner')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('update-sheet')), findsOneWidget);
    expect(find.byKey(const Key('release-notes')), findsNothing);
    expect(find.text(_url), findsOneWidget);
  });

  testWidgets('home: no banner when the installed version is the latest', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      overrides: [
        appConfigProvider.overrideWith(
          (ref) async => const AppConfig(latestAppVersion: '0.1.0', appDownloadUrl: _url, releaseNotes: _notes),
        ),
      ],
    );
    expect(find.byKey(const Key('update-available-banner')), findsNothing);
  });

  testWidgets('update required screen: notes of the latest version + download link', (tester) async {
    await pumpScreen(
      tester,
      const UpdateRequiredScreen(),
      overrides: [
        appConfigProvider.overrideWith(
          (ref) async => const AppConfig(
            minAppVersion: '0.2.0',
            latestAppVersion: '0.2.1',
            appDownloadUrl: _url,
            releaseNotes: _notes,
          ),
        ),
      ],
    );
    expect(find.text('Perbarui aplikasi'), findsOneWidget);
    expect(find.text('Yang baru di versi 0.2.1'), findsOneWidget);
    expect(find.text(_notes.first), findsOneWidget);
    expect(find.text(_url), findsOneWidget);
    expect(find.text('Hubungi admin untuk mendapatkan APK terbaru.'), findsNothing);
  });

  testWidgets('update required screen: 15 long notes scroll instead of overflowing on a phone', (tester) async {
    await pumpScreen(
      tester,
      const UpdateRequiredScreen(),
      overrides: [
        appConfigProvider.overrideWith(
          (ref) async => AppConfig(
            minAppVersion: '0.2.0',
            latestAppVersion: '0.2.1',
            releaseNotes: List.generate(15, (i) => 'Catatan $i ${'panjang ' * 30}'.trim()),
          ),
        ),
      ],
    );
    // pumpScreen uses a tall test view; shrink it to a 390 × 780 phone.
    tester.view.physicalSize = const Size(390, 780);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('release-notes')), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Hubungi admin untuk mendapatkan APK terbaru.'), 300);
    expect(find.text('Hubungi admin untuk mendapatkan APK terbaru.'), findsOneWidget);
  });
}
