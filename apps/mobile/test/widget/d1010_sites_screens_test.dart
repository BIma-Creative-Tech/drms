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

/// ADR 0023 sites on the APK screens — ADR 0032: removed from the product. Neither the project detail nor the profile
/// shows a site any more, even when an older server (or an old cache) still sends one.
class _SiteProjectsApi extends FakeProjectsApi {
  _SiteProjectsApi(this.site);
  final Map<String, dynamic>? site;

  @override
  Future<ProjectDetail> detail(int id) async => projectDetailFromJson({...projectDetailJson(), 'site': site});
}

void main() {
  testWidgets('project detail: no "Site" row, even when the server sends one', (tester) async {
    await pumpRouted(
      tester,
      '/projects/9',
      roles: {Role.pm},
      overrides: [
        projectsApiProvider.overrideWithValue(_SiteProjectsApi({'id': 2, 'code': 'BPN', 'name': 'Cabang Balikpapan'})),
      ],
    );
    expect(find.byKey(const Key('project-site')), findsNothing);
    expect(find.text('BPN Cabang Balikpapan'), findsNothing);
  });

  testWidgets('profile: no "Site penempatan" row, even with a home site from an older server', (tester) async {
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
    expect(find.byKey(const Key('profile-home-site')), findsNothing);
    expect(find.text('Site penempatan'), findsNothing);
  });
}
