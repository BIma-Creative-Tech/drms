import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/app/theme.dart';
import 'package:proyekkas/app/theme_mode.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';
import 'package:proyekkas/features/settings/presentation/profile_screen.dart';
import 'package:proyekkas/features/sync/application/sync_coordinator.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/shared/icons/iconsax.dart';
import 'package:proyekkas/shared/widgets/module_tile.dart';

import '../support/widget_harness.dart';

/// ADR 0015 visual refresh: Tampilan setting (persisted locally), launcher tiles, reduced motion.
void main() {
  group('Tampilan (theme mode)', () {
    test('stored value ↔ ThemeMode; unknown/missing = follow the system', () async {
      final store = MemorySecureStore();
      expect(await loadThemeMode(store), ThemeMode.system);
      for (final m in ThemeMode.values) {
        store.data[themeModeKey] = themeModeToStored(m);
        expect(await loadThemeMode(store), m);
      }
      store.data[themeModeKey] = 'sepia';
      expect(await loadThemeMode(store), ThemeMode.system);
    });

    testWidgets('Profil → Gelap / Terang / Sistem updates the app mode and is stored on the phone', (tester) async {
      await pumpScreen(
        tester,
        const ProfileScreen(),
        overrides: [outboxCountsProvider.overrideWith((ref) => Stream.value(const OutboxCounts()))],
      );
      final container = ProviderScope.containerOf(tester.element(find.byType(ProfileScreen)));
      final store = container.read(secureStoreProvider) as MemorySecureStore;
      expect(find.text('Tampilan'), findsOneWidget);
      expect(container.read(themeModeProvider), ThemeMode.system);

      await tester.tap(find.byKey(const Key('theme-mode-dark')));
      await tester.pumpAndSettle();
      expect(container.read(themeModeProvider), ThemeMode.dark);
      expect(store.data[themeModeKey], 'dark');

      await tester.tap(find.byKey(const Key('theme-mode-light')));
      await tester.pumpAndSettle();
      expect(store.data[themeModeKey], 'light');

      await tester.tap(find.byKey(const Key('theme-mode-system')));
      await tester.pumpAndSettle();
      expect(container.read(themeModeProvider), ThemeMode.system);
      expect(store.data[themeModeKey], 'system');
    });
  });

  group('home launcher', () {
    testWidgets('staff: tiles with the web module gradients, greeting + role pill', (tester) async {
      await pumpScreen(tester, const HomeScreen());
      expect(find.text('Halo, Doni Pratama'), findsOneWidget);
      expect(find.byKey(const Key('home-roles')), findsOneWidget);
      ModuleTile tile(String key) => tester.widget<ModuleTile>(find.byKey(Key(key)));
      expect(tile('home-new-advance').module, PkModule.keuangan);
      expect(tile('home-new-advance').icon, PkIcons.advance);
      expect(tile('home-new-reimburse').module, PkModule.keuangan);
      expect(tile('home-requests').module, PkModule.laporan);
      expect(tile('home-attendance').module, PkModule.absensi);
      // Two columns: advance and reimburse share a row.
      final a = tester.getRect(find.byKey(const Key('home-new-advance')));
      final r = tester.getRect(find.byKey(const Key('home-new-reimburse')));
      expect(a.top, r.top);
      expect(a.height, r.height);
      expect(a.height, greaterThanOrEqualTo(48));
    });

    testWidgets('Direktur: approval tile in the persetujuan gradient with the count badge', (tester) async {
      await pumpScreen(
        tester,
        const HomeScreen(),
        auth: AuthSignedIn(profile: profile({Role.owner}), sub: 's'),
      );
      final inbox = tester.widget<ModuleTile>(find.byKey(const Key('home-inbox')));
      expect(inbox.module, PkModule.persetujuan);
      expect(inbox.icon, PkIcons.approval);
    });

    testWidgets('reduced motion: tiles are fully shown on the first frame (no entrance animation)', (tester) async {
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: MaterialApp(
            theme: buildTheme(),
            home: const Scaffold(
              body: ModuleGrid(
                children: [
                  ModuleTile(module: PkModule.proyek, icon: PkIcons.progress, label: 'A'),
                  ModuleTile(module: PkModule.absensi, icon: PkIcons.attendance, label: 'B'),
                ],
              ),
            ),
          ),
        ),
      );
      final fades = tester.widgetList<FadeTransition>(
        find.ancestor(of: find.byType(ModuleTile), matching: find.byType(FadeTransition)),
      );
      expect(fades, isNotEmpty);
      expect(fades.every((f) => f.opacity.value == 1), isTrue);
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('dark theme: tiles use the dark gradient stops', (tester) async {
      late Color from;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildTheme(Brightness.dark),
          home: Builder(
            builder: (context) {
              from = context.pk.gradient(PkModule.persetujuan).from;
              return const SizedBox();
            },
          ),
        ),
      );
      expect(from, PkGradients.all[PkModule.persetujuan]!.dark.from);
    });
  });
}
