import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/addendum/data/addendum_api.dart';
import 'package:proyekkas/features/addendum/domain/addendum.dart';

import '../support/e4_e6_fixtures.dart';
import '../support/harness.dart';
import '../support/mock_server.dart';

/// E5 Addendum RAB (APK): parsing, validation and the request shapes (Idempotency-Key on every write).
void main() {
  test('parsing: status, step, budget impact, allowed actions, decisions', () {
    final a = Addendum.fromJson(
      addendumJson(status: 'pending_approval', step: 'approve', actions: ['approve', 'reject']),
    );
    expect(a.status, AddendumStatus.pendingApproval);
    expect(a.status.isOpen, isTrue);
    expect(a.step, 'approve');
    expect(a.projectLabel, 'P-07 — Gudang Contoh');
    expect(a.budget!.afterAddition, 1750000000);
    expect(a.budget!.committedPctAfter, 44.57);
    expect(a.allowedActions, {AddendumAction.approve, AddendumAction.reject});
    expect(a.decisions.single.actorName, 'Direktur Contoh');
    expect(
      Addendum.fromJson({
        'allowedActions': ['unknown'],
      }).allowedActions,
      isEmpty,
    );
  });

  test('validation', () {
    expect(validateAddendum(projectId: 7, addition: 1000, reason: 'Tanah lunak'), isEmpty);
    final e = validateAddendum(projectId: null, addition: 0, reason: 'x');
    expect(e.keys, containsAll(['project', 'addition', 'reason']));
    expect(validateAddendum(projectId: 7, addition: 2000000000000, reason: 'abc')['addition'], isNotNull);
  });

  test('requests: inbox, create (submit), acknowledge, approve, reject/cancel with reason', () async {
    final server = await MockServer.start();
    addTearDown(server.close);
    final api = AddendumApi(testClient(server.base, StaticTokens()));
    final seen = <String, (String?, String)>{};
    Handler record(String name) => (req, body) {
      seen[name] = (req.headers.value('idempotency-key'), body);
      return (200, addendumJson());
    };
    server.on(
      'GET',
      '/api/v1/budget-addenda/inbox',
      (req, body) => (
        200,
        {
          'items': [addendumJson()],
        },
      ),
    );
    server.on('POST', '/api/v1/budget-addenda', record('create'));
    server.on('POST', '/api/v1/budget-addenda/61/acknowledge', record('ack'));
    server.on('POST', '/api/v1/budget-addenda/61/approve', record('approve'));
    server.on('POST', '/api/v1/budget-addenda/61/reject', record('reject'));
    server.on('POST', '/api/v1/budget-addenda/61/cancel', record('cancel'));
    server.on('POST', '/api/v1/budget-addenda/61/submit', record('submit'));
    expect((await api.inbox()).single.step, 'acknowledge');
    await api.create(projectId: 7, addition: 250000000, reason: ' Tanah lunak ', submit: true, idempotencyKey: 'k1');
    expect(seen['create']!.$1, 'k1');
    expect(jsonDecode(seen['create']!.$2), {
      'projectId': 7,
      'addition': 250000000,
      'reason': 'Tanah lunak',
      'submit': true,
    });
    await api.acknowledge(61, idempotencyKey: 'k2');
    await api.approve(61, idempotencyKey: 'k3');
    await api.reject(61, reason: 'Belum ada BoQ', idempotencyKey: 'k4');
    await api.cancel(61, reason: 'Salah project', idempotencyKey: 'k5');
    await api.submit(61, idempotencyKey: 'k6');
    expect(seen['ack']!.$1, 'k2');
    expect(seen['approve']!.$1, 'k3');
    expect(jsonDecode(seen['reject']!.$2), {'reason': 'Belum ada BoQ'});
    expect(jsonDecode(seen['cancel']!.$2), {'reason': 'Salah project'});
    expect(seen['submit']!.$1, 'k6');
  });
}
