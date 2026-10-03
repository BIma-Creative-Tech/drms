import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/features/app_config/presentation/update_required_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/notifications/application/notifications_providers.dart';
import 'package:proyekkas/features/notifications/data/notifications_api.dart';
import 'package:proyekkas/features/notifications/domain/app_notification.dart';
import 'package:proyekkas/features/notifications/presentation/notifications_screen.dart';

import '../support/fake_dio_adapter.dart';
import '../support/harness.dart';
import '../support/widget_harness.dart';

/// In-app notifications (ADR 0011 fallback while push is off) + the blocking update screen.
Map<String, dynamic> _n(int id, {String? readAt, String title = 'Pengajuan ditransfer'}) => {
  'id': id,
  'uuid': '0192f5c8-1a2b-7c3d-8e4f-5a6b7c8d9e$id',
  'event': 'transferred',
  'title': title,
  'body': 'Dana Rp 1.447.500 untuk 228/PB-DRMS/20/IX/2026 sudah ditransfer.',
  'docType': 'expense_request',
  'docId': '42',
  'docNo': '228/PB-DRMS/20/IX/2026',
  'readAt': readAt,
  'createdAt': '2026-09-22T02:00:00Z',
};

void main() {
  late FakeDioAdapter adapter;
  late NotificationsApi api;
  setUp(() {
    adapter = FakeDioAdapter(
      (c) => c.method == 'GET'
          ? (
              200,
              {
                'items': [_n(11), _n(10, readAt: '2026-09-21T01:00:00Z', title: 'Pengajuan disetujui')],
                'unreadCount': 1,
                'nextCursor': null,
              },
            )
          : (200, {'updated': 1}),
    );
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))..httpClientAdapter = adapter;
    api = NotificationsApi(
      ApiClient(baseUrl: 'https://example.test/api/v1', tokens: StaticTokens(), headers: testDevice(), dio: dio),
    );
  });

  testWidgets('bell shows the unread count; list shows server texts; tap marks read', (tester) async {
    await pumpScreen(
      tester,
      const Scaffold(
        body: Column(
          children: [
            NotificationBell(),
            Expanded(child: NotificationsScreen()),
          ],
        ),
      ),
      overrides: [notificationsApiProvider.overrideWithValue(api)],
    );
    expect(find.text('1'), findsOneWidget);
    expect(find.text('Pengajuan ditransfer'), findsOneWidget);
    expect(find.text('Pengajuan disetujui'), findsOneWidget);
    expect(find.textContaining('22 Sep 2026 10.00 WITA'), findsWidgets);
    adapter.calls.clear();
    await tester.tap(find.byKey(const Key('notification-11')));
    await tester.pumpAndSettle();
    expect(adapter.calls.map((c) => '${c.method} ${c.uri.path}'), contains('POST /api/v1/notifications/11/read'));
    adapter.calls.clear();
    await tester.tap(find.byKey(const Key('notifications-read-all')));
    await tester.pumpAndSettle();
    expect(adapter.calls.map((c) => '${c.method} ${c.uri.path}'), contains('POST /api/v1/notifications/read-all'));
  });

  test('mapping: request link, unread flag', () {
    final n = AppNotification.fromJson(_n(3));
    expect(n.unread, isTrue);
    expect(n.requestId, 42);
    expect(AppNotification.fromJson({..._n(4), 'docType': 'settlement'}).requestId, isNull);
  });

  group('tap routing (doc types the server emits)', () {
    String? route(String? docType, String? docId, {String event = 'x', bool progress = true, bool own = true}) =>
        AppNotification.fromJson({..._n(5), 'event': event, 'docType': docType, 'docId': docId})
            .route(canReadProgress: progress, ownAttendance: own);

    test('expense request (expense.*, reminder.lpj_overdue / revision_pending) → request detail', () {
      expect(route('expense_request', '42', event: 'expense.approved'), '/requests/42');
      expect(route('expense_request', '42', event: 'reminder.lpj_overdue'), '/requests/42');
    });

    test('budget addendum (addendum.*) → addendum detail', () {
      expect(route('budget_addendum', '61', event: 'addendum.pending_ack'), '/addenda/61');
      expect(route('budget_addendum', '61', event: 'addendum.rejected'), '/addenda/61');
    });

    test('project: late progress report → that project\'s reports; budget threshold → progress vs budget', () {
      expect(route('project', '7', event: 'progress.late_report'), '/progress?project=7');
      expect(route('project', '7', event: 'reminder.budget_threshold'), '/progress?tab=projects');
      expect(route('project', '7', event: 'progress.late_report', progress: false), isNull);
    });

    test('progress report → report detail', () {
      expect(route('progress_report', '501'), '/progress/report/501');
      expect(route('progress_report', '501', progress: false), isNull);
    });

    test('attendance → attendance (team tab without own attendance)', () {
      expect(route('attendance', null), '/attendance');
      expect(route('attendance', '9', own: false), '/attendance?tab=team');
    });

    test('unknown type, missing or non-numeric id → not tappable', () {
      expect(route('settlement', '4'), isNull);
      expect(route(null, null), isNull);
      expect(route('expense_request', null), isNull);
      expect(route('budget_addendum', 'abc'), isNull);
      expect(route('project', '1/../2'), isNull);
    });
  });

  testWidgets('tap an addendum notification → /addenda/:id; unknown read row is not tappable', (tester) async {
    adapter.respond = (c) => c.method == 'GET'
        ? (
            200,
            {
              'items': [
                {..._n(21), 'event': 'addendum.pending_ack', 'docType': 'budget_addendum', 'docId': '61'},
                {..._n(22, readAt: '2026-09-21T01:00:00Z', title: 'Info lain'), 'docType': 'settlement'},
              ],
              'unreadCount': 1,
              'nextCursor': null,
            },
          )
        : (200, {'updated': 1});
    final router = GoRouter(
      routes: [
        GoRoute(path: '/', builder: (_, _) => const NotificationsScreen()),
        GoRoute(path: '/addenda/:id', builder: (_, s) => Text('addendum ${s.pathParameters['id']}')),
      ],
    );
    addTearDown(router.dispose);
    await pumpScreen(
      tester,
      Router.withConfig(config: router),
      auth: AuthSignedIn(profile: profile({Role.owner}), sub: 'user-sub-1'),
      overrides: [notificationsApiProvider.overrideWithValue(api)],
    );
    expect(tester.widget<ListTile>(find.byKey(const Key('notification-22'))).onTap, isNull);
    expect(
      find.descendant(of: find.byKey(const Key('notification-21')), matching: find.byIcon(Icons.chevron_right)),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('notification-21')));
    await tester.pumpAndSettle();
    expect(find.text('addendum 61'), findsOneWidget);
    expect(adapter.calls.map((c) => '${c.method} ${c.uri.path}'), contains('POST /api/v1/notifications/21/read'));
  });

  testWidgets('update required screen: current vs minimum version, contact admin without a link', (tester) async {
    await pumpScreen(tester, const UpdateRequiredScreen());
    expect(find.byIcon(Icons.system_update), findsOneWidget);
    expect(find.textContaining('0.1.0'), findsOneWidget);
  });
}
