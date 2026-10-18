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
      // User 2026-10-18: one tile per web module (offline menu here), web gradients + glyphs.
      expect(tile('home-module-dashboard').module, PkModule.dashboard);
      expect(tile('home-module-proyek').module, PkModule.proyek);
      expect(tile('home-module-proyek').icon, PkIcons.project);
      expect(tile('home-module-keuangan').module, PkModule.keuangan);
      expect(tile('home-module-absensi').module, PkModule.absensi);
      expect(find.byKey(const Key('home-module-persetujuan')), findsNothing);
      expect(find.byKey(const Key('kpi-staff')), findsNothing, reason: 'KPIs live in the Dashboard screen');
      // Tiles of a row share its height (first row: Dashboard, Proyek).
      final a = tester.getRect(find.byKey(const Key('home-module-dashboard')));
      final r = tester.getRect(find.byKey(const Key('home-module-proyek')));
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
      final inbox = tester.widget<ModuleTile>(find.byKey(const Key('home-module-persetujuan')));
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
