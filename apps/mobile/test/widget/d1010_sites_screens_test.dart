import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/projects/application/projects_providers.dart';
import 'package:proyekkas/features/projects/data/projects_api.dart';
import 'package:proyekkas/features/projects/domain/project.dart';
import 'package:proyekkas/features/settings/presentation/profile_screen.dart';
import 'package:proyekkas/features/sync/application/sync_coordinator.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';

import '../support/d1010_c_fixtures.dart';
import 'd1010_c_menus_test.dart' show pumpRouted;
import '../support/widget_harness.dart';

/// ADR 0023 on the APK screens: the project detail shows its site (kantor cabang) when set, the profile shows the
/// employee's "Site penempatan"; both rows are absent without a site (older servers / PTs without sites).
class _SiteProjectsApi extends FakeProjectsApi {
  _SiteProjectsApi(this.site);
  final Map<String, dynamic>? site;

  @override
  Future<ProjectDetail> detail(int id) async => projectDetailFromJson({...projectDetailJson(), 'site': site});
}

void main() {
  testWidgets('project detail: "Site" row with code and name', (tester) async {
    await pumpRouted(
      tester,
      '/projects/9',
      roles: {Role.pm},
      overrides: [
        projectsApiProvider.overrideWithValue(_SiteProjectsApi({'id': 2, 'code': 'BPN', 'name': 'Cabang Balikpapan'})),
      ],
    );
    expect(tester.widget<Text>(find.byKey(const Key('project-site'))).data, 'BPN Cabang Balikpapan');
  });

  testWidgets('project detail without a site: no row', (tester) async {
    await pumpRouted(
      tester,
      '/projects/9',
      roles: {Role.pm},
      overrides: [projectsApiProvider.overrideWithValue(_SiteProjectsApi(null))],
    );
    expect(find.byKey(const Key('project-site')), findsNothing);
  });

  testWidgets('profile: "Site penempatan" of the employee', (tester) async {
    final p = profile({Role.staff}).copyWith(
      employee: const Employee(
        id: 12,
        code: 'E12',
        name: 'Doni Pratama',
        homeSiteId: 2,
        homeSiteLabel: 'BPN — Cabang Balikpapan',
      ),
    );
    await pumpScreen(
      tester,
      const ProfileScreen(),
      auth: AuthSignedIn(profile: p, sub: 'user-sub-1'),
      overrides: [outboxCountsProvider.overrideWith((ref) => Stream.value(const OutboxCounts()))],
    );
    expect(find.byKey(const Key('profile-home-site')), findsOneWidget);
    expect(find.text('Site penempatan'), findsOneWidget);
    expect(find.text('BPN — Cabang Balikpapan'), findsOneWidget);
  });

  testWidgets('profile without a home site: no row', (tester) async {
    await pumpScreen(
      tester,
      const ProfileScreen(),
      overrides: [outboxCountsProvider.overrideWith((ref) => Stream.value(const OutboxCounts()))],
    );
    expect(find.byKey(const Key('profile-home-site')), findsNothing);
  });
}
