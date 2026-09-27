import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/features/app_config/presentation/update_required_screen.dart';
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

  testWidgets('update required screen: current vs minimum version, contact admin without a link', (tester) async {
    await pumpScreen(tester, const UpdateRequiredScreen());
    expect(find.byIcon(Icons.system_update), findsOneWidget);
    expect(find.textContaining('0.1.0'), findsOneWidget);
  });
}
