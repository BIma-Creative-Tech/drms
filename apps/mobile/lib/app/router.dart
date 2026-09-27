import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/addendum/presentation/addendum_screens.dart';
import '../features/app_config/application/app_config_providers.dart';
import '../features/app_config/domain/app_config.dart';
import '../features/app_config/presentation/update_required_screen.dart';
import '../features/approvals/presentation/inbox_screen.dart';
import '../features/attendance/domain/attendance.dart';
import '../features/attendance/presentation/attendance_screen.dart';
import '../features/attendance/presentation/on_behalf_screen.dart';
import '../features/attendance/presentation/team_view.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/auth/presentation/splash_screen.dart';
import '../features/expense/domain/request_status.dart';
import '../features/expense/presentation/draft_editor_screen.dart';
import '../features/expense/presentation/history_screen.dart';
import '../features/expense/presentation/request_detail_screen.dart';
import '../features/expense/presentation/requests_screen.dart';
import '../features/home/presentation/home_screen.dart';
import '../features/home/presentation/home_shell.dart';
import '../features/notifications/presentation/notifications_screen.dart';
import '../features/progress/presentation/progress_conflict_screen.dart';
import '../features/progress/presentation/progress_detail_screen.dart';
import '../features/progress/presentation/progress_editor_screen.dart';
import '../features/progress/presentation/progress_screen.dart';
import '../features/settings/presentation/profile_screen.dart';
import '../features/sync/presentation/queue_screen.dart';
import 'route_error_screen.dart';

/// Pure redirect rule (unit-tested): update gate → splash while starting → login when signed out.
/// `/app/config` is NOT awaited: it loads in the background and the update gate redirects whenever it
/// resolves (the server enforces the minimum version with 426 anyway), so a slow network never holds
/// the splash screen.
String? redirectFor({required String location, required AuthState auth, required VersionGate gate}) {
  if (gate == VersionGate.updateRequired) return location == '/update' ? null : '/update';
  if (location == '/update') return '/splash';
  if (auth is AuthStarting) return location == '/splash' ? null : '/splash';
  if (auth is AuthSignedOut) return location == '/login' ? null : '/login';
  if (location == '/login' || location == '/splash') return '/home';
  return null;
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(authControllerProvider, (_, _) => refresh.value++);
  ref.listen(versionGateProvider, (_, _) => refresh.value++);
  ref.listen(appConfigProvider, (_, _) => refresh.value++); // also starts the background fetch
  ref.onDispose(refresh.dispose);

  final router = GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) => redirectFor(
      location: state.matchedLocation,
      auth: ref.read(authControllerProvider),
      gate: ref.read(versionGateProvider),
    ),
    // Unknown location (e.g. an unexpected deep link or notification target) → a visible Indonesian
    // error with a way home instead of go_router's default English page (WIP fix/mobile-login-redirect).
    errorBuilder: (_, _) => const RouteErrorScreen(),
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/update', builder: (_, _) => const UpdateRequiredScreen()),
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: '/home', builder: (_, _) => const HomeScreen())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/requests',
                builder: (_, s) => RequestsScreen(initialTab: s.uri.queryParameters['tab']),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/inbox', builder: (_, _) => const InboxScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/queue', builder: (_, _) => const QueueScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/profile', builder: (_, _) => const ProfileScreen())],
          ),
        ],
      ),
      GoRoute(
        path: '/requests/:id',
        builder: (_, s) => RequestDetailScreen(id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
        routes: [
          GoRoute(
            path: 'history',
            builder: (_, s) => HistoryScreen(id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
          ),
        ],
      ),
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
      GoRoute(
        path: '/attendance',
        builder: (_, s) => AttendanceScreen(
          initialTab: AttendanceTab.values.where((t) => t.name == s.uri.queryParameters['tab']).firstOrNull,
        ),
        routes: [
          GoRoute(
            path: 'on-behalf',
            builder: (_, s) => OnBehalfScreen(
              employeeId: int.tryParse(s.uri.queryParameters['employee'] ?? ''),
              kind: s.uri.queryParameters['kind'] == 'check_out' ? AttendanceKind.checkOut : null,
            ),
          ),
          GoRoute(
            path: 'recap/:employeeId',
            builder: (_, s) => MemberRecapScreen(employeeId: int.tryParse(s.pathParameters['employeeId'] ?? '') ?? 0),
          ),
        ],
      ),
      GoRoute(
        path: '/addenda',
        builder: (_, _) => const AddendumListScreen(),
        routes: [
          GoRoute(path: 'new', builder: (_, _) => const AddendumCreateScreen()),
          GoRoute(
            path: ':id',
            builder: (_, s) => AddendumDetailScreen(id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
          ),
        ],
      ),
      GoRoute(
        path: '/progress',
        builder: (_, s) => ProgressScreen(initialTab: s.uri.queryParameters['tab'] == 'projects' ? 1 : 0),
        routes: [
          GoRoute(
            path: 'new',
            builder: (_, s) => ProgressEditorRoute(projectId: int.tryParse(s.uri.queryParameters['project'] ?? '')),
          ),
          GoRoute(
            path: 'draft/:uuid',
            builder: (_, s) => ProgressEditorRoute(localUuid: s.pathParameters['uuid']),
          ),
          GoRoute(
            path: 'conflict/:uuid',
            builder: (_, s) => ProgressConflictScreen(uuid: s.pathParameters['uuid'] ?? ''),
          ),
          GoRoute(
            path: 'report/:id',
            builder: (_, s) => ProgressDetailScreen(id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
            routes: [
              GoRoute(
                path: 'edit',
                builder: (_, s) => ProgressEditorRoute(reportId: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/drafts/new',
        builder: (_, s) => DraftEditorRoute(type: RequestType.fromCode(s.uri.queryParameters['type'])),
      ),
      GoRoute(
        path: '/drafts/:uuid',
        builder: (_, s) => DraftEditorRoute(uuid: s.pathParameters['uuid']),
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});
