import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/masters/data/masters_repository.dart';

import '../support/harness.dart';
import '../support/widget_harness.dart';

/// E6: offline candidates for "diabsenkan PM" come from the cached masters (team-assignments, employees,
/// projects + cost centers); archived projects, ended assignments and the PM's own employee are left out.
void main() {
  test('team members with their team locations, today only, never the PM self', () async {
    final db = memoryDb();
    addTearDown(db.close);
    final today = DateTime.now();
    String ymd(DateTime d) => d.toIso8601String().substring(0, 10);
    Map<String, dynamic> items(List<Map<String, dynamic>> rows) => {'items': rows, 'hasMore': false};
    await db.kvPut(
      'masters:pm-sub',
      jsonEncode({
        'projects': items([
          {
            'id': 7,
            'code': 'P-07',
            'name': 'Gudang Contoh',
            'lat': -2.21,
            'lng': 113.91,
            'radiusM': 100,
            'status': 'berjalan',
          },
          {'id': 9, 'code': 'P-09', 'name': 'Arsip', 'lat': 0, 'lng': 0, 'radiusM': 50, 'status': 'arsip'},
        ]),
        'cost-centers': items([
          {'id': 3, 'code': 'CC-3', 'name': 'Ops Palangka', 'lat': -2.2, 'lng': 113.9, 'radiusM': 80, 'active': true},
        ]),
        'employees': items([
          {'id': 12, 'name': 'Doni Pratama'},
          {'id': 44, 'name': 'Budi Contoh'},
          {'id': 45, 'name': 'Citra Contoh', 'nickname': 'Cici'},
          {'id': 46, 'name': 'Eko Contoh'},
        ]),
        'team-assignments': items([
          {'id': 1, 'employee': 12, 'project': 7}, // the PM (profile employee 12) → excluded
          {'id': 2, 'employee': 44, 'project': 7, 'startDate': '2026-01-01T00:00:00.000Z'},
          {'id': 3, 'employee': 44, 'costCenter': 3},
          {'id': 4, 'employee': 45, 'project': 9}, // archived project → no site
          {
            'id': 5,
            'employee': 46,
            'project': 7,
            'endDate': '${ymd(today.subtract(const Duration(days: 3)))}T00:00:00Z',
          },
          {
            'id': 6,
            'employee': 45,
            'costCenter': 3,
            'startDate': '${ymd(today.add(const Duration(days: 5)))}T00:00:00Z',
          },
        ]),
      }),
    );
    final c = ProviderContainer(
      overrides: [
        databaseProvider.overrideWithValue(db),
        authControllerProvider.overrideWith(() => FakeAuth(AuthSignedIn(profile: profile({Role.pm}), sub: 'pm-sub'))),
        mastersRepositoryProvider.overrideWith(
          (ref) => MastersRepository(testClient('http://127.0.0.1:9', StaticTokens()), db),
        ),
      ],
    );
    addTearDown(c.dispose);
    final sites = await c.read(attendanceSitesProvider.future);
    expect(sites.map((s) => s.key), ['p7', 'c3'], reason: 'archived project hidden');
    final list = await c.read(onBehalfCandidatesProvider.future);
    expect(list.map((e) => e.employeeId), [44]);
    expect(list.single.name, 'Budi Contoh');
    expect(list.single.sites.map((s) => s.key), ['p7', 'c3']);
    expect(list.single.sites.last.kind, SiteKind.costCenter);
  });
}
