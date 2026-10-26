import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/attendance/application/attendance_providers.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance_recap.dart';
import 'package:proyekkas/features/attendance/presentation/attendance_screen.dart';
import 'package:proyekkas/features/attendance/presentation/team_recap_view.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/home/application/menu_providers.dart';
import 'package:proyekkas/features/home/domain/web_route_map.dart';

import '../support/e4_e6_fixtures.dart';
import '../support/widget_harness.dart';

/// DRMS 26/10 #3: "Absensi → Rekap bulanan" of an office user without an own employee loaded for ~30 s and ended in
/// "Akun Anda belum terhubung ke data karyawan" (GET /attendance/me → 409, retried). Now: team month for roles with a
/// team / office scope, own recap for an own employee, both with "Tim" / "Saya", neither → the message without a call.
Map<String, dynamic> _teamMonthJson() => {
  'month': '2026-09',
  'from': '2026-09-01',
  'to': '2026-09-30',
  'timezone': 'Asia/Makassar',
  'scope': 'all',
  'employees': [
    {
      'employee': {'id': 44, 'code': 'E44', 'name': 'Budi Contoh'},
      'companyId': 1,
      'summary': {
        'presentDays': 18,
        'workingDays': 22,
        'absentDays': 4,
        'lateDays': 2,
        'lateMinutes': 35,
        'incompleteDays': 1,
      },
    },
    {
      'employee': {'id': 45, 'code': 'E45', 'name': 'Sari Contoh dengan nama yang sangat panjang sekali'},
      'companyId': 1,
      'summary': {'presentDays': 22, 'workingDays': 22, 'absentDays': 0, 'lateDays': 0},
    },
  ],
};

UserProfile _noEmployee(Set<Role> roles) => profile(roles).copyWith(employee: null);

class _Calls {
  final own = <(int?, String?)>[];
  final team = <(String, int?)>[];
}

Future<_Calls> _pumpRecapTab(WidgetTester tester, UserProfile p) async {
  final calls = _Calls();
  await pumpScreen(
    tester,
    const AttendanceScreen(initialTab: AttendanceTab.recap),
    auth: AuthSignedIn(profile: p, sub: 'user-sub-1'),
    overrides: [
      appConfigProvider.overrideWith((ref) async => const AppConfig(syncAttendance: true)),
      attendanceSitesProvider.overrideWith((ref) async => const []),
      attendanceItemsProvider.overrideWith((ref) => Stream.value(const [])),
      attendanceRecapProvider.overrideWith((ref, key) async {
        calls.own.add(key);
        return AttendanceRecap.fromJson(recapJson());
      }),
      teamMonthProvider.overrideWith((ref, key) async {
        calls.team.add(key);
        return TeamMonth.fromJson(_teamMonthJson());
      }),
      teamTodayProvider.overrideWith((ref, date) async => TeamToday.fromJson(teamTodayJson())),
    ],
  );
  return calls;
}

void main() {
  group('menu "Rekap bulanan" → recap tab per role', () {
    test('the menu item opens the recap tab; label per role', () {
      expect(apkTargetFor('/absensi/rekap')?.route, '/attendance?tab=recap');
      String label(Set<Role> roles) =>
          fallbackMenu(profile(roles))
              .expand((m) => m.sections)
              .expand((s) => s.items)
              .firstWhere((i) => i.href == '/absensi/rekap')
              .label;
      expect(label({Role.staff}), 'Rekap absensi saya');
      expect(label({Role.finance}), 'Rekap bulanan');
      expect(label({Role.principal}), 'Rekap bulanan');
    });

    for (final (name, roles) in [
      ('Owner', {Role.principal, Role.owner}),
      ('Direktur', {Role.owner}),
      ('Finance', {Role.finance}),
      ('Admin', {Role.admin}),
      ('Admin Staff', {Role.adminStaff}),
    ]) {
      testWidgets('$name without employee: team month at once, never GET /attendance/me', (tester) async {
        final calls = await _pumpRecapTab(tester, _noEmployee(roles));
        expect(find.byKey(const Key('team-recap-44')), findsOneWidget);
        expect(find.byKey(const Key('recap-mode')), findsNothing);
        expect(find.byKey(const Key('recap-no-employee')), findsNothing);
        expect(calls.own, isEmpty);
        expect(calls.team.single, (monthOf(DateTime.now()), null));
      });
    }

    testWidgets('PM with employee: "Tim" first, "Saya" opens the own recap', (tester) async {
      final calls = await _pumpRecapTab(tester, profile({Role.pm}));
      expect(find.byKey(const Key('recap-mode')), findsOneWidget);
      expect(find.byKey(const Key('team-recap-44')), findsOneWidget);
      expect(calls.own, isEmpty);
      await tester.tap(find.byKey(const Key('recap-mode-own')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('recap-month')), findsOneWidget);
      expect(find.byKey(const Key('team-recap-44')), findsNothing);
      expect(calls.own.single.$1, isNull); // own recap = GET /attendance/me
    });

    testWidgets('Staff with employee: own recap only (no team call, no switch)', (tester) async {
      final calls = await _pumpRecapTab(tester, profile({Role.staff}));
      expect(find.byKey(const Key('recap-month')), findsOneWidget);
      expect(find.byKey(const Key('recap-mode')), findsNothing);
      expect(calls.team, isEmpty);
      expect(calls.own, hasLength(1));
    });

    testWidgets('Operator without employee: the message at once, no network call', (tester) async {
      final calls = await _pumpRecapTab(tester, _noEmployee({Role.operator}));
      expect(find.byKey(const Key('recap-no-employee')), findsOneWidget);
      expect(find.text('Akun Anda belum terhubung ke data karyawan. Hubungi Admin.'), findsOneWidget);
      expect(calls.own, isEmpty);
      expect(calls.team, isEmpty);
    });
  });

  group('team recap list', () {
    testWidgets('summary per employee, long names wrap, search, month switcher', (tester) async {
      final calls = await _pumpRecapTab(tester, _noEmployee({Role.finance}));
      expect(find.text('2 karyawan'), findsOneWidget);
      expect(find.text('Hadir 18/22'), findsOneWidget);
      expect(find.text('Tidak hadir 4 hari'), findsOneWidget);
      expect(find.text('Terlambat 2 hari'), findsOneWidget);
      expect(find.text('Belum absen pulang 1 hari'), findsOneWidget);
      final long = tester.widget<Text>(find.text('Sari Contoh dengan nama yang sangat panjang sekali'));
      expect(long.overflow, isNot(TextOverflow.ellipsis));
      expect(long.maxLines, isNull);

      await tester.enterText(find.byType(TextField), 'sari');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('team-recap-44')), findsNothing);
      expect(find.byKey(const Key('team-recap-45')), findsOneWidget);
      expect(find.text('1 karyawan'), findsOneWidget);

      expect(tester.widget<IconButton>(find.byKey(const Key('team-recap-next'))).onPressed, isNull);
      await tester.tap(find.byKey(const Key('team-recap-prev')));
      await tester.pumpAndSettle();
      expect(calls.team.last, (shiftMonth(monthOf(DateTime.now()), -1), null));
    });

    testWidgets('PT filter when the team scope spans several selected PTs', (tester) async {
      final p = _noEmployee({Role.finance}).copyWith(
        companies: const [
          CompanyMembership(id: 1, code: 'DRMS', name: 'PT DRMS Contoh', roles: {Role.finance}),
          CompanyMembership(id: 2, code: 'TBK', name: 'PT TBK Contoh', roles: {Role.finance}),
          CompanyMembership(id: 3, code: 'LAS', name: 'PT LAS Contoh', roles: {Role.staff}),
        ],
      );
      final calls = await _pumpRecapTab(tester, p);
      expect(find.byKey(const Key('team-recap-pt-all')), findsOneWidget);
      expect(find.byKey(const Key('team-recap-pt-2')), findsOneWidget);
      expect(find.byKey(const Key('team-recap-pt-3')), findsNothing, reason: 'Staff there: no team scope');
      await tester.tap(find.byKey(const Key('team-recap-pt-2')));
      await tester.pumpAndSettle();
      expect(calls.team.last.$2, 2);
    });

    testWidgets('tap → the employee recap of the shown month', (tester) async {
      final router = GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (_, _) => const Scaffold(body: TeamRecapView(initialMonth: '2026-09')),
          ),
          GoRoute(
            path: '/attendance/recap/:id',
            builder: (_, s) => Text('recap ${s.pathParameters['id']} ${s.uri.queryParameters['month']}'),
          ),
        ],
      );
      addTearDown(router.dispose);
      await pumpScreen(
        tester,
        Router.withConfig(config: router),
        auth: AuthSignedIn(profile: _noEmployee({Role.owner}), sub: 'user-sub-1'),
        overrides: [teamMonthProvider.overrideWith((ref, key) async => TeamMonth.fromJson(_teamMonthJson()))],
      );
      await tester.tap(find.byKey(const Key('team-recap-44')));
      await tester.pumpAndSettle();
      expect(find.text('recap 44 2026-09'), findsOneWidget);
    });
  });
}
