import 'dart:convert';

import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/approvals/presentation/inbox_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/companies/application/company_selection.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

import '../support/fixtures.dart';
import '../support/widget_harness.dart';

const _sub = 'user-sub-1';

CompanyMembership _pt(int id, String code, Set<Role> roles, {int? employee}) => CompanyMembership(
  id: id,
  code: code,
  name: 'PT Contoh $code',
  roles: roles,
  capabilities: Capabilities.fromRoles(roles),
  employee: employee == null ? null : Employee(id: employee, code: 'E$employee', name: 'Rina Contoh'),
);

/// Fictional account: CS6 Staff/PM (employee 12), CS7 Finance (employee 40).
UserProfile _multi({List<CompanyMembership>? companies}) => UserProfile(
  id: 5,
  email: 'rina@example.test',
  name: 'Rina Contoh',
  roles: const {Role.staff, Role.pm, Role.finance},
  capabilities: Capabilities.fromRoles(const {Role.staff, Role.pm, Role.finance}),
  employee: const Employee(id: 12, code: 'E12', name: 'Rina Contoh'),
  companies:
      companies ??
      [
        _pt(1, 'CS6', const {Role.staff, Role.pm}, employee: 12),
        _pt(2, 'CS7', const {Role.finance}, employee: 40),
      ],
);

final _homeStubs = [
  inboxProvider.overrideWith((ref) async => const InboxPage([], 85)),
  lpjQueueProvider.overrideWith((ref) async => const []),
  financeDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
  pmDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
  direkturDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
];

/// Drift query streams leave a zero-length timer when the scope is disposed: dispose inside the test.
Future<void> _unmount(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(milliseconds: 10));
  await tester.pump(const Duration(milliseconds: 10));
}

ProviderContainer _container(WidgetTester tester, Type screen) =>
    ProviderScope.containerOf(tester.element(find.byType(screen)));

void main() {
  testWidgets('PT switcher: "Semua PT" → only CS6 → menus follow CS6, choice stored per user', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      auth: AuthSignedIn(profile: _multi(), sub: _sub),
      overrides: _homeStubs,
    );
    expect(find.byKey(const Key('pt-switcher')), findsOneWidget);
    expect(find.text('Semua PT'), findsOneWidget);
    expect(find.byKey(const Key('home-inbox')), findsOneWidget, reason: 'Finance in CS7 → union shows the inbox');
    expect(find.text('Staff, PM · CS6   Finance · CS7'), findsOneWidget);

    await tester.tap(find.byKey(const Key('pt-switcher')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pt-option-all')), findsOneWidget);
    await tester.tap(find.byKey(const Key('pt-option-2')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pt-apply')));
    await tester.pumpAndSettle();

    final c = _container(tester, HomeScreen);
    expect(c.read(companySelectionProvider), {1});
    expect(c.read(companyHeaderProvider), '1');
    expect(find.text('CS6'), findsWidgets);
    expect(find.byKey(const Key('home-inbox')), findsNothing, reason: 'no Direktur/Finance role in CS6');
    expect(find.byKey(const Key('home-new-advance')), findsOneWidget);
    final stored = await c.read(databaseProvider).kvGetJson(CompanySelection.storageKey(_sub));
    expect(stored, {
      'ids': [1],
    });
    await _unmount(tester);
  });

  testWidgets('PT switcher: at least one PT must stay checked', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      auth: AuthSignedIn(profile: _multi(), sub: _sub),
      overrides: _homeStubs,
    );
    await tester.tap(find.byKey(const Key('pt-switcher')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pt-option-all'))); // all → none
    await tester.pumpAndSettle();
    expect(find.text('Pilih minimal satu PT.'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('pt-apply'))).onPressed, isNull);
    await _unmount(tester);
  });

  testWidgets('one PT: static code in the app bar, no menu', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      auth: AuthSignedIn(
        profile: _multi(
          companies: [
            _pt(1, 'CS6', const {Role.staff}, employee: 12),
          ],
        ),
        sub: _sub,
      ),
      overrides: _homeStubs,
    );
    expect(find.byKey(const Key('pt-switcher-static')), findsOneWidget);
    expect(find.byKey(const Key('pt-switcher')), findsNothing);
  });

  testWidgets('offline rows without PT (v2 upgrade, several PTs): home banner → choose PT', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      auth: AuthSignedIn(profile: _multi(), sub: _sub),
      overrides: _homeStubs,
    );
    expect(find.byKey(const Key('unassigned-banner')), findsNothing);
    final db = _container(tester, HomeScreen).read(databaseProvider);
    await tester.runAsync(
      () => db
          .into(db.outbox)
          .insert(
            OutboxCompanion.insert(
              opUuid: 'a-1',
              userSub: _sub,
              type: SyncItemType.attendanceCheckIn,
              targetUuid: 'a-1',
              payloadJson: jsonEncode({'project_id': 70}),
              deviceTime: '2026-09-21T12:00:00+08:00',
              elapsedMs: 1,
              bootId: 'b-1',
              createdAt: DateTime(2026, 9, 21, 12),
              status: const Value('pending'),
            ),
          ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('unassigned-banner')), findsOneWidget);
    expect(find.textContaining('1 data offline belum punya PT'), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets('new request under "Semua PT" with two request PTs: PT is chosen first, then fixed', (tester) async {
    final p = _multi(
      companies: [
        _pt(1, 'CS6', const {Role.staff}, employee: 12),
        _pt(3, 'CS8', const {Role.pm}, employee: 55),
      ],
    );
    await pumpScreen(
      tester,
      const DraftEditorRoute(type: RequestType.advance),
      auth: AuthSignedIn(profile: p, sub: _sub),
    );
    expect(find.byKey(const Key('pt-choice')), findsOneWidget);
    await tester.tap(find.byKey(const Key('pt-pick-3')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pt-choice')), findsNothing);
    expect(find.byKey(const Key('draft-company')), findsOneWidget);
    expect(find.text('PT Contoh CS8'), findsOneWidget);
  });

  testWidgets('one request PT in the scope: no question', (tester) async {
    await pumpScreen(
      tester,
      const DraftEditorRoute(type: RequestType.advance),
      auth: AuthSignedIn(profile: _multi(), sub: _sub), // CS7 = Finance only → CS6 is the only request PT
    );
    expect(find.byKey(const Key('pt-choice')), findsNothing);
    expect(find.byKey(const Key('draft-company')), findsOneWidget);
  });

  testWidgets('inbox: PT chip on each card when several PTs are shown, LPJ queue listed', (tester) async {
    final item = inboxItemFromJson({
      ...(inboxJson()['items'] as List).first as Map<String, dynamic>,
      'company': {'id': 2, 'shortCode': 'CS7', 'name': 'PT Contoh CS7'},
    });
    await pumpScreen(
      tester,
      const InboxScreen(),
      auth: AuthSignedIn(profile: _multi(), sub: _sub),
      overrides: [
        inboxProvider.overrideWith((ref) async => InboxPage([item], 85)),
        lpjQueueProvider.overrideWith(
          (ref) async => [
            summaryFromJson({
              'id': 88,
              'company': {'id': 1, 'shortCode': 'CS6', 'name': 'PT Contoh CS6'},
              'docNo': 'UM-01',
              'type': 'advance',
              'status': 'lpj_submitted',
              'statusLabel': 'LPJ Diajukan',
              'title': 'Uang muka survey',
              'grandTotal': 1000000,
              'approvedAmount': 900000,
            }),
          ],
        ),
      ],
    );
    expect(item.companyId, 2);
    expect(find.byKey(const Key('pt-chip-2')), findsOneWidget);
    expect(find.byKey(const Key('lpj-queue')), findsOneWidget);
    expect(find.byKey(const Key('lpj-88')), findsOneWidget);
    expect(find.byKey(const Key('pt-chip-1')), findsOneWidget);
  });
}
