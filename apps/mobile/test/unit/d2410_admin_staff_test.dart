import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/home/application/menu_providers.dart';
import 'package:proyekkas/features/home/domain/web_route_map.dart';
import 'package:proyekkas/features/users/onboarding.dart';

import '../support/widget_harness.dart';

/// ADR 0032 (DRMS 24/10): role "Admin Staff" (`pk-admin-staff`) on the APK — the role, its bottom bar (Operator bar
/// with the team tab), the attendance capabilities, the "Absenkan karyawan" menu entry and the on-behalf candidates
/// from `GET /attendance/on-behalf/options` (any employee of the PT, also without an account). Fictional data.
Map<String, dynamic> _emp(int id, String code, String name, String type, bool account) => {
  'id': id,
  'company': 1,
  'code': code,
  'name': name,
  'attendanceType': type,
  'hasAccount': account,
};

Map<String, dynamic> _loc(String kind, int id, int company, String code) => {
  'kind': kind,
  'id': id,
  'company': company,
  'code': code,
  'name': 'Lokasi $code',
  'lat': -2.21,
  'lng': 113.91,
  'radiusM': 100,
};

Map<String, dynamic> _options() => {
  'companies': [
    {'id': 1, 'attendanceEnabled': true},
  ],
  'employees': [
    _emp(44, 'TH-01', 'Budi Harian', 'onsite', false),
    _emp(45, 'K-02', 'Citra Kantor', 'non_onsite', true),
    _emp(12, 'E12', 'Doni Pratama', 'onsite', true),
  ],
  'locations': [_loc('project', 7, 1, 'P-07'), _loc('cost_center', 3, 1, 'CC-3'), _loc('project', 9, 2, 'P-09')],
};

void main() {
  test('role pk-admin-staff: label, parse, onboarding picker', () {
    expect(Role.fromCode('pk-admin-staff'), Role.adminStaff);
    expect(Role.adminStaff.label, 'Admin Staff');
    expect(onboardingRoles.map((r) => r.$1), contains('pk-admin-staff'));
  });

  test('bottom bar = the Operator bar unless a higher role is held; attendance capabilities', () {
    final p = profile({Role.adminStaff});
    expect(p.navKind, NavKind.operator);
    expect(profile({Role.adminStaff, Role.staff}).navKind, NavKind.staff);
    expect((p.canSeeTeamAttendance, p.canAttendOnBehalf, p.canCorrectAttendance), (true, true, true));
    expect((p.isAttendanceOnly, p.isOperatorOnly), (true, false));
    expect((p.canCreateRequests, p.hasFinanceMenu, p.seesProjectMoney), (false, false, false));
  });

  test('menu: "Absenkan karyawan" opens the on-behalf screen; no Keuangan module', () {
    final menu = fallbackMenu(profile({Role.adminStaff}));
    expect(menu.map((m) => m.id), isNot(contains('keuangan')));
    final hrefs = menu.expand((m) => m.items).map((i) => i.href).toList();
    expect(hrefs, containsAll(['/absensi', '/absensi/absenkan']));
    expect(apkTargetFor('/absensi/absenkan'), isNotNull);
    expect(webToApk['/absensi/absenkan'], '/attendance/on-behalf');
  });

  test('on-behalf candidates: every employee of the PT (own left out), its locations, the type on each location', () {
    final list = onBehalfCandidatesFromOptions(_options(), own: const {12});
    expect(list.map((c) => c.employeeId), [44, 45]);
    final budi = list.first;
    expect(budi.name, 'Budi Harian (TH-01)');
    expect(budi.hasAccount, isFalse);
    expect(budi.sites.map((s) => s.key), ['p7', 'c3'], reason: 'only the locations of the PT');
    expect(budi.sites.first.unrestricted, isFalse, reason: 'OnSite: the chosen location');
    expect(list.last.sites.every((s) => s.attendanceType == AttendanceType.nonOnsite), isTrue);
    expect(onBehalfCandidatesFromOptions(null), isEmpty);
  });
}
