import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:proyekkas/app/theme.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/home/application/menu_providers.dart';
import 'package:proyekkas/features/home/domain/web_modules.dart';
import 'package:proyekkas/features/home/domain/web_route_map.dart';
import 'package:proyekkas/features/home/presentation/home_shell.dart';
import 'package:proyekkas/features/sync/application/sync_coordinator.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../support/widget_harness.dart';

/// The offline banner above the tabs without the real sync triggers (WorkManager, connectivity streams).
class _IdleSync extends SyncCoordinator {
  @override
  SyncStatus build() => const SyncStatus();
}

/// User 2026-10-18: bottom bar per role, Beranda = the web launcher, Antrean only in Profil.
void main() {
  group('NavKind: highest role of the selected PTs', () {
    NavKind kind(Set<Role> roles) => profile(roles).navKind;

    test('one role each', () {
      expect(kind({Role.principal, Role.owner}), NavKind.owner, reason: '/me lists pk-owner with pk-principal');
      expect(kind({Role.owner}), NavKind.direktur);
      expect(kind({Role.finance}), NavKind.finance);
      expect(kind({Role.pm}), NavKind.pm);
      expect(kind({Role.admin}), NavKind.admin);
      expect(kind({Role.staff}), NavKind.staff);
      expect(kind({Role.operator}), NavKind.operator);
      expect(kind(const {}), NavKind.operator);
    });

    test('several roles: Direktur > Finance > PM > Admin > Staff > Operator', () {
      expect(kind({Role.owner, Role.finance, Role.pm}), NavKind.direktur);
      expect(kind({Role.finance, Role.pm}), NavKind.finance);
      expect(kind({Role.pm, Role.staff}), NavKind.pm);
      expect(kind({Role.admin, Role.staff}), NavKind.admin);
      expect(kind({Role.staff, Role.operator}), NavKind.staff);
    });
  });

  group('bottom bar', () {
    const labels = {
      NavKind.owner: ['Beranda', 'Dashboard', 'Proyek', 'Profil'],
      NavKind.direktur: ['Beranda', 'Dashboard', 'Pengajuan', 'Persetujuan', 'Proyek', 'Profil'],
      NavKind.pm: ['Beranda', 'Dashboard', 'Pengajuan', 'Persetujuan', 'Proyek', 'Profil'],
      NavKind.finance: ['Beranda', 'Dashboard', 'Pengajuan', 'Antrian Transfer', 'Profil'],
      NavKind.admin: ['Beranda', 'Dashboard', 'Proyek', 'Profil'],
      NavKind.staff: ['Beranda', 'Pengajuan', 'Absensi', 'Proyek', 'Profil'],
      NavKind.operator: ['Beranda', 'Absensi', 'Profil'],
    };
    const roles = {
      NavKind.owner: {Role.principal, Role.owner},
      NavKind.direktur: {Role.owner},
      NavKind.pm: {Role.pm},
      NavKind.finance: {Role.finance},
      NavKind.admin: {Role.admin},
      NavKind.staff: {Role.staff},
      NavKind.operator: {Role.operator},
    };

    test('no sync-queue tab for any role (moved to Profil)', () {
      for (final k in NavKind.values) {
        expect(tabsFor(k).toSet().length, tabsFor(k).length, reason: '$k');
        expect(tabsFor(k).first, Tabs.home, reason: '$k');
        expect(tabsFor(k).last, Tabs.profile, reason: '$k');
      }
    });

    for (final k in NavKind.values) {
      testWidgets('$k: ${labels[k]!.join(', ')}', (tester) async {
        tester.view.physicalSize = const Size(360, 780);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);
        final router = GoRouter(
          initialLocation: '/home',
          routes: [
            StatefulShellRoute.indexedStack(
              builder: (_, _, shell) => HomeShell(shell: shell),
              branches: [
                for (final p in [
                  '/home',
                  '/dashboard',
                  '/requests',
                  '/inbox',
                  '/tab/transfer',
                  '/tab/attendance',
                  '/tab/projects',
                  '/profile',
                ])
                  StatefulShellBranch(
                    routes: [GoRoute(path: p, builder: (_, _) => Text('page $p'))],
                  ),
              ],
            ),
          ],
        );
        addTearDown(router.dispose);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              connectivityProvider.overrideWith(() => FakeConnectivity(true)),
              syncCoordinatorProvider.overrideWith(_IdleSync.new),
              outboxCountsProvider.overrideWith((ref) => Stream.value(const OutboxCounts())),
              authControllerProvider.overrideWith(() => FakeAuth(AuthSignedIn(profile: profile(roles[k]!), sub: 's'))),
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
          ),
        );
        await tester.pumpAndSettle();
        final bar = find.byType(NavigationBar);
        final shown = [
          for (final d in tester.widget<NavigationBar>(bar).destinations) (d as NavigationDestination).label,
        ];
        expect(shown, labels[k]);
        expect(tester.takeException(), isNull, reason: 'no overflow at 360 dp');
        // The last tab opens its branch.
        await tester.tap(find.descendant(of: bar, matching: find.text('Profil')));
        await tester.pumpAndSettle();
        expect(find.text('page /profile'), findsOneWidget);
      });
    }
  });

  group('web menu → APK screens', () {
    test('every APK target is a route of app/router.dart (path part)', () {
      const known = {
        '/dashboard',
        '/inbox',
        '/finance',
        '/projects',
        '/progress',
        '/addenda',
        '/field',
        '/requests',
        '/attendance',
        '/profile',
        '/notifications',
        '/security',
        '/cash',
        '/closings',
        '/loans',
        '/intercompany-loans',
      };
      for (final e in webToApk.entries) {
        final path = Uri.parse(e.value).path;
        // phase 3: the generic web collection lists `/data/<slug>`
        expect(known.contains(path) || path.startsWith('/data/'), isTrue, reason: '${e.key} → $path');
      }
    });

    test('bottom-bar branches open with go, the rest is pushed', () {
      expect(isShellRoute('/inbox'), isTrue);
      expect(isShellRoute('/requests?tab=team'), isTrue);
      expect(isShellRoute('/finance?tab=lpj'), isFalse);
      expect(isShellRoute('/attendance?tab=team'), isFalse);
    });

    test('"+ Buat pengajuan" asks Kasbon / Reimburse; web-only items have no target yet', () {
      expect(apkTargetFor('/collections/expense-requests/create')!.pickRequestType, isTrue);
      expect(apkTargetFor('/kas')!.route, '/cash');
      expect(apkTargetFor('/laporan'), isNull);
      expect(apkTargetFor('/persetujuan')!.route, '/inbox');
    });

    test('/me/modules JSON round-trip', () {
      final json = {
        'modules': [
          {
            'id': 'keuangan',
            'label': 'Keuangan',
            'hint': 'Kas, pengajuan',
            'badge': 2,
            'sections': [
              {
                'label': 'Pengajuan',
                'items': [
                  {
                    'href': '/collections/expense-requests',
                    'label': 'Pengajuan biaya',
                    'kind': 'collection',
                    'badge': 0,
                  },
                  {'href': '/antrian-transfer', 'label': 'Antrian Transfer', 'kind': 'view', 'badge': 2},
                ],
              },
            ],
          },
        ],
      };
      final m = webModulesFromJson(json).single;
      expect(m.module, PkModule.keuangan);
      expect(m.items.map((i) => i.href), ['/collections/expense-requests', '/antrian-transfer']);
      expect(m.items.last.badge, 2);
      expect(WebModule.fromJson(m.toJson()).toJson(), m.toJson());
    });

    test('offline menu: Staff has Dashboard, Proyek, Keuangan with "+ Buat pengajuan", Absensi', () {
      final menu = fallbackMenu(profile({Role.staff}));
      expect(menu.map((m) => m.id), ['dashboard', 'proyek', 'keuangan', 'absensi']);
      expect(
        menu.firstWhere((m) => m.id == 'keuangan').items.map((i) => i.href),
        contains('/collections/expense-requests/create'),
      );
      expect(menu.firstWhere((m) => m.id == 'absensi').items.last.label, 'Rekap absensi saya');
      expect(fallbackMenu(profile({Role.operator})).map((m) => m.id), ['dashboard', 'absensi']);
      expect(fallbackMenu(profile(const {})), isEmpty);
    });
  });
}
