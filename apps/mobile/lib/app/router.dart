import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/companies/presentation/unassigned_screen.dart';
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
import '../features/field_reports/domain/field_models.dart';
import '../features/finance/presentation/finance_screen.dart';
import '../features/finance/presentation/transfer_form_screen.dart';
import '../features/field_reports/presentation/aftersales_screen.dart';
import '../features/field_reports/presentation/daily_report_screen.dart';
import '../features/field_reports/presentation/field_conflict_screen.dart';
import '../features/field_reports/presentation/field_hub_screen.dart';
import '../features/field_reports/presentation/service_report_screen.dart';
import '../features/field_reports/presentation/timesheet_screen.dart';
import '../features/home/presentation/home_screen.dart';
import '../features/home/presentation/home_shell.dart';
import '../features/notifications/presentation/notifications_screen.dart';
import '../features/privacy/application/privacy_providers.dart';
import '../features/privacy/presentation/privacy_notice_screen.dart';
import '../features/progress/presentation/progress_conflict_screen.dart';
import '../features/loans/presentation/intercompany_loan_screens.dart';
import '../features/loans/presentation/loan_screens.dart';
import '../features/projects/presentation/project_detail_screen.dart';
import '../features/projects/presentation/projects_screen.dart';
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
/// ADR 0018: [privacyPrompt] (current privacy notice not acknowledged, not postponed in this app run) shows the
/// full-screen notice instead of the home screen — after login, at a (cached) start, and when a background `/me`
/// reveals a new notice version while the home screen is open. Other screens stay reachable.
String? redirectFor({
  required String location,
  required AuthState auth,
  required VersionGate gate,
  bool privacyPrompt = false,
}) {
  if (gate == VersionGate.updateRequired) return location == '/update' ? null : '/update';
  if (location == '/update') return '/splash';
  if (auth is AuthStarting) return location == '/splash' ? null : '/splash';
  if (auth is AuthSignedOut) return location == '/login' ? null : '/login';
  if (location == '/login' || location == '/splash') return privacyPrompt ? privacyRoute : '/home';
  if (privacyPrompt && location == '/home') return privacyRoute;
  return null;
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(authControllerProvider, (_, _) => refresh.value++);
  ref.listen(versionGateProvider, (_, _) => refresh.value++);
  ref.listen(appConfigProvider, (_, _) => refresh.value++); // also starts the background fetch
  ref.listen(privacyPromptProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  final router = GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) => redirectFor(
      location: state.matchedLocation,
      auth: ref.read(authControllerProvider),
      gate: ref.read(versionGateProvider),
      privacyPrompt: ref.read(privacyPromptProvider),
    ),
    // Unknown location (e.g. an unexpected deep link or notification target) → a visible Indonesian
    // error with a way home instead of go_router's default English page (WIP fix/mobile-login-redirect).
    errorBuilder: (_, _) => const RouteErrorScreen(),
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/update', builder: (_, _) => const UpdateRequiredScreen()),
      // ADR 0018: privacy notice — start-up prompt (no `from`) or opened from profile / attendance (`?from=…`)
      GoRoute(
        path: privacyRoute,
        builder: (_, s) => PrivacyNoticeScreen(pushed: s.uri.queryParameters['from'] != null),
      ),
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
      // DRMS 10/10 point 10: "Finance" — Antrian Transfer (`?tab=lpj` = Verifikasi LPJ) and "Catat transfer".
      GoRoute(
        path: '/finance',
        builder: (_, s) => FinanceScreen(initialTab: s.uri.queryParameters['tab'] == 'lpj' ? 1 : 0),
        routes: [
          GoRoute(
            path: 'transfer/:id',
            builder: (_, s) => TransferFormRoute(id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
          ),
        ],
      ),
      // DRMS 10/10 point 6: "Proyek" (list) → project with the tabs Proyek / RAP / Pengajuan (`?tab=rap|requests`).
      GoRoute(
        path: '/projects',
        builder: (_, _) => const ProjectsScreen(),
        routes: [
          GoRoute(
            path: ':id',
            builder: (_, s) => ProjectDetailScreen(
              id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0,
              initialTab: switch (s.uri.queryParameters['tab']) {
                'rap' => 1,
                'requests' => 2,
                'loans' => 3,
                _ => 0,
              },
            ),
          ),
        ],
      ),
      GoRoute(path: '/companies/unassigned', builder: (_, _) => const UnassignedScreen()),
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
            routes: [
              GoRoute(
                path: 'edit',
                builder: (_, s) => AddendumEditRoute(id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
              ),
            ],
          ),
        ],
      ),
      // ADR 0022: inter-project loans (online only; repayments on the web in v1)
      GoRoute(
        path: '/loans/new',
        builder: (_, s) => LoanFormScreen(projectId: int.tryParse(s.uri.queryParameters['project'] ?? '')),
      ),
      GoRoute(
        path: '/loans/:id',
        builder: (_, s) => LoanDetailScreen(id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
        routes: [
          GoRoute(
            path: 'edit',
            builder: (_, s) => LoanEditRoute(id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
          ),
        ],
      ),
      // ADR 0029: inter-PT loans — the Owner's instruction (`?borrower=&amount=&requests=1,2`), the read-only detail
      // (notifications icloan.*) and Finance's disbursement (online only; repayments / voids on the web)
      GoRoute(
        path: '/intercompany-loans/new',
        builder: (_, s) {
          final q = s.uri.queryParameters;
          final borrower = int.tryParse(q['borrower'] ?? '');
          if (borrower == null) return const RouteErrorScreen();
          return IcLoanInstructScreen(
            borrowerId: borrower,
            amount: int.tryParse(q['amount'] ?? ''),
            requestIds: [for (final r in (q['requests'] ?? '').split(',')) ?int.tryParse(r)],
          );
        },
      ),
      GoRoute(
        path: '/intercompany-loans/:id',
        builder: (_, s) => IcLoanDetailScreen(id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
        routes: [
          GoRoute(
            path: 'disburse',
            builder: (_, s) => IcLoanDisburseRoute(id: int.tryParse(s.pathParameters['id'] ?? '') ?? 0),
          ),
        ],
      ),
      GoRoute(
        path: '/progress',
        builder: (_, s) => ProgressScreen(
          initialTab: s.uri.queryParameters['tab'] == 'projects' ? 1 : 0,
          initialProject: int.tryParse(s.uri.queryParameters['project'] ?? ''),
        ),
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
      // FR1 "Laporan Lapangan" (ADR 0020): hub, editors per type, local draft, own edit ≤ 24 h, conflict.
      GoRoute(
        path: '/field',
        builder: (_, s) => FieldHubScreen(initialTab: s.uri.queryParameters['tab'] == 'history' ? 1 : 0),
        routes: [
          GoRoute(
            path: 'service/new',
            builder: (_, s) => ServiceReportScreen(
              projectId: int.tryParse(s.uri.queryParameters['project'] ?? ''),
              unitId: int.tryParse(s.uri.queryParameters['unit'] ?? ''),
            ),
          ),
          GoRoute(
            path: 'timesheet/new',
            builder: (_, s) => TimesheetScreen(
              projectId: int.tryParse(s.uri.queryParameters['project'] ?? ''),
              date: s.uri.queryParameters['date'],
            ),
          ),
          GoRoute(
            path: 'aftersales/new',
            builder: (_, s) => AftersalesScreen(projectId: int.tryParse(s.uri.queryParameters['project'] ?? '')),
          ),
          GoRoute(
            path: 'daily/new',
            builder: (_, s) => DailyReportScreen(projectId: int.tryParse(s.uri.queryParameters['project'] ?? '')),
          ),
          GoRoute(
            path: 'draft/:uuid',
            builder: (_, s) => FieldDraftRoute(uuid: s.pathParameters['uuid'] ?? ''),
          ),
          GoRoute(
            path: 'conflict/:uuid',
            builder: (_, s) => FieldConflictScreen(uuid: s.pathParameters['uuid'] ?? ''),
          ),
          GoRoute(
            path: 'edit/:type/:id',
            builder: (_, s) {
              final type = FieldReportType.fromSegment(s.pathParameters['type']);
              final id = int.tryParse(s.pathParameters['id'] ?? '');
              if (type == null || id == null) return const RouteErrorScreen();
              return FieldEditRoute(type: type, id: id);
            },
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
