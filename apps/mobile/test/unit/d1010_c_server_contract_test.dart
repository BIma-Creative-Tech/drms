import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/presentation/widgets/rap_item_picker.dart';
import 'package:proyekkas/features/finance/data/finance_api.dart';
import 'package:proyekkas/features/finance/domain/transfer_queue.dart';
import 'package:proyekkas/features/projects/data/projects_api.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../support/fake_dio_adapter.dart';
import '../support/harness.dart';

/// DRMS 10/10 Phase C: the APK parsers against responses CAPTURED from the real server (web Phase C, local
/// throwaway DB, fictional data) — test/fixtures/server_d1010_c/*.json. Guards the APK ↔ server contract
/// (docs/proyekkas/plans/drms-1010.md "Phase C API contract"): field names, null money for Staff, `realisedAmount`
/// (not the P3 quantity `realised`), `rapOverBudget` / `rap_over_budget`, transfer queue, transfer form pickers.
Object? _fx(String name) => jsonDecode(File('test/fixtures/server_d1010_c/$name.json').readAsStringSync());
Map<String, dynamic> _map(String name) => _fx(name)! as Map<String, dynamic>;

void main() {
  group('GET /projects, /projects/{id}', () {
    test('Staff: RAP money null, contract fields parsed', () {
      final page = pageFromJson(_fx('projects_staff'), projectFromJson, page: 1);
      expect(page.items, hasLength(1));
      expect(page.hasMore, isFalse);
      expect(page.total, 1);
      final p = page.items.single;
      expect(p.code, 'UJI-PRJ');
      expect(p.kind, 'konstruksi');
      expect(p.statusText, 'Berjalan');
      expect(p.pm?.name, 'Pandu Manajer');
      expect(p.costCenter?.code, 'OPS-PB');
      expect(p.rapItems, 4);
      expect(p.rapPlanned, isNull);
      expect(p.rapRealised, isNull);
      expect(p.rapPercent, isNull);
      expect(p.rapOverBudgetItems, isNull);
    });

    test('Direktur: RAP money present', () {
      final p = pageFromJson(_fx('projects_direktur'), projectFromJson, page: 1).items.single;
      final raw = (_map('projects_direktur')['docs'] as List).single as Map<String, dynamic>;
      expect(p.rapPlanned, raw['rapPlanned']);
      expect(p.rapPlanned, greaterThan(0));
      expect(p.rapRealised, raw['rapRealised']);
      expect(p.rapPercent, (raw['rapPercent'] as num).toDouble());
      expect(p.rapOverBudgetItems, raw['rapOverBudgetItems']);
    });

    test('detail: Staff null RAP summary, Finance the money summary', () {
      final s = projectDetailFromJson(_map('project_detail_staff'));
      expect(s.project.id, 1);
      expect(s.rap.items, 4);
      expect([s.rap.planned, s.rap.realised, s.rap.transferred, s.rap.remaining, s.rap.percent], everyElement(isNull));
      final f = projectDetailFromJson(_map('project_detail_finance'));
      final rap = _map('project_detail_finance')['rap'] as Map<String, dynamic>;
      expect(f.rap.planned, rap['planned']);
      expect(f.rap.realised, rap['realised']);
      expect(f.rap.transferred, rap['transferred']);
      expect(f.rap.remaining, rap['remaining']);
      expect(f.rap.overBudgetItems, rap['overBudgetItems']);
      expect(f.project.rapPlanned, rap['planned']);
    });
  });

  group('GET /projects/{id}/rap', () {
    List<Map<String, dynamic>> raw(String name) => [
      for (final i in _map(name)['items'] as List) i as Map<String, dynamic>,
    ];

    test('Finance: money from planned / realisedAmount / remaining (realised = P3 quantity is NOT money)', () {
      for (final j in raw('project_rap_finance')) {
        final i = rapBudgetItemFromJson(j);
        expect(i.name, j['name']);
        expect(i.qty, (j['qty'] as num).toDouble());
        expect(i.uom, (j['uom'] as Map)['code']);
        expect(i.planned, j['planned']);
        expect(i.realised, j['realisedAmount'], reason: 'money realisation is realisedAmount');
        expect(i.remaining, j['remaining']);
        expect(i.overBudget, j['overBudget'], reason: '${j['code']}');
        expect(i.active, isTrue);
      }
      // the fixture has an item above its plan (A.2) — red bar / "Lebih …"
      expect(raw('project_rap_finance').map(rapBudgetItemFromJson).where((i) => i.overBudget), isNotEmpty);
    });

    test('Staff: no money at all → picker shows no budget text / bar, nothing "over"', () {
      final t = lookupAppLocalizations(const Locale('id'));
      final items = raw('project_rap_staff').map(rapBudgetItemFromJson).toList();
      expect(items, hasLength(4));
      for (final i in items) {
        expect([i.planned, i.realised, i.remaining, i.unitPrice, i.percent], everyElement(isNull));
        expect(i.overBudget, isFalse);
        expect(i.progress, isNull);
        expect(i.exceeds(5000000), isNull);
        expect(i.label, startsWith(i.code));
        expect(rapRemainingText(t, i), isNull, reason: 'no "Sisa Rp …" without money');
      }
      expect(_map('project_rap_staff')['budget'], isNull);
    });
  });

  test('GET /expense-requests?project=&page= → numbered pages', () {
    final page = pageFromJson(_fx('project_requests_staff'), summaryFromJson, page: 1);
    final m = _map('project_requests_staff');
    expect(page.items, hasLength((m['items'] as List).length));
    expect(page.total, m['totalDocs']);
    expect(page.hasMore, (m['totalPages'] as int) > 1);
    expect(page.nextCursor, isNull);
    expect(page.items.first.docNo, isNotNull);
  });

  group('GET /expense-requests/{id}: rapItem, rapOverBudget, flag rap_over_budget', () {
    test('PM sees the live state and the flag; the line keeps its RAP item', () {
      final d = detailFromJson(_map('request_over_pm'));
      final l = d.lines.single;
      expect(l.rapItem?.code, 'B.2');
      expect(l.rapItem?.name, 'Sewa perancah');
      expect(l.rapOverBudget, isTrue);
      expect(d.flags.where((f) => f.kind == rapOverBudgetFlag).single.kindLabel, 'Melebihi RAP');
      expect(lineRapOverBudget(d, l), isTrue);
      // edit body keeps the item
      expect(draftFromServer(d, clientUuid: 'x', receiptUuid: (_) => 'r').lines.single.rapItemId, l.rapItem!.id);
    });

    test('Staff: no flag, rapOverBudget false', () {
      final d = detailFromJson(_map('request_over_staff'));
      expect(d.lines.single.rapItem?.id, isNotNull);
      expect(d.lines.single.rapOverBudget, isFalse);
      expect(d.flags.where((f) => f.kind == rapOverBudgetFlag), isEmpty);
      expect(lineRapOverBudget(d, d.lines.single), isFalse);
    });
  });

  test('GET /transfer-queue: project, cost center suggestion, SLA, flags, bank', () {
    final raw = _map('transfer_queue_finance')['items'] as List;
    final j = raw.first as Map<String, dynamic>;
    final it = transferQueueItemFromJson(j);
    expect(it.project?.code, 'UJI-PRJ');
    expect(it.costCenter?.id, (j['costCenter'] as Map)['id']);
    expect(it.bankName, (j['bank'] as Map)['bankName']);
    expect(it.bankAccountNo, (j['bank'] as Map)['accountNo']);
    expect(it.bankAccountHolder, (j['bank'] as Map)['accountHolder']);
    expect(it.bankVerified, j['bankVerification'] == 'verified');
    expect(it.warningFlags, (j['flags'] as Map)['warning']);
    expect(it.receiptMismatch, (j['flags'] as Map)['receiptMismatch']);
    expect(it.sla.slaHours, ((j['sla'] as Map)['slaHours'] as num).toDouble());
    expect(it.sla.approvedAt, (j['sla'] as Map)['approvedAt']);
    expect(it.sla.over, isFalse);
    expect(it.amount, j['approvedAmount']);
  });

  group('transfer form', () {
    late FakeDioAdapter adapter;
    late FinanceApi api;
    setUp(() {
      adapter = FakeDioAdapter((c) {
        if (c.uri.path.endsWith('/cash-accounts/balances')) return (200, _fx('cash_balances_finance'));
        if (c.uri.path.endsWith('/cost-centers')) {
          // as the server with ?active=all: the APK must still drop the inactive one
          final m = _map('cost_centers_finance');
          return (
            200,
            {
              ...m,
              'docs': [
                ...m['docs'] as List,
                {
                  'id': 99,
                  'code': 'OLD-CC',
                  'name': 'Pusat biaya lama',
                  'type': 'operational',
                  'companyId': 1,
                  'active': false,
                },
              ],
            },
          );
        }
        if (c.uri.path.endsWith('/transfer')) return (201, _fx('transfer_post_finance'));
        return (404, {'errors': <Object>[]});
      });
      final client = testClient('https://example.test', StaticTokens(), reach: (_) {});
      client.dio.httpClientAdapter = adapter;
      api = FinanceApi(client);
    });

    test('cash account picker: inactive accounts (active: false) are left out', () async {
      final all = (_map('cash_balances_finance')['items'] as List).cast<Map<String, dynamic>>();
      expect(all.where((a) => a['active'] == false), isNotEmpty, reason: 'fixture has an inactive account');
      final accounts = await api.cashAccounts(1);
      expect(accounts.map((a) => a.id), [
        for (final a in all)
          if (a['active'] != false) a['cashAccountId'],
      ]);
      expect(accounts.every((a) => a.active), isTrue);
      expect(adapter.calls.single.uri.queryParameters['company'], '1');
    });

    test('cost center picker: active only', () async {
      final ccs = await api.costCenters(1);
      expect(ccs.map((c) => c.code), ['OPS-PB']);
    });

    test('POST body has exactly the fields the server accepted; response → detail with the transfer', () async {
      final accepted = _map('transfer_body');
      final body = transferBody(
        cashAccountId: accepted['cashAccountId'] as int,
        costCenterId: accepted['costCenterId'] as int,
        transferAt: transferAtString(DateTime(2026, 10, 11, 20, 51), const Duration(hours: 8)),
        bankRef: ' ${accepted['bankRef']} ',
        proofMediaId: accepted['proofMediaId'] as int,
        confirmOverdraft: true,
      );
      expect(body.keys.toSet(), accepted.keys.toSet());
      expect(body['bankRef'], accepted['bankRef']);
      expect(body['transferAt'], '2026-10-11T20:51+08:00');
      expect(
        RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})?$').hasMatch(body['transferAt'] as String),
        isTrue,
      );
      final d = await api.recordTransfer(9, body, idempotencyKey: 'k-1');
      final t = d.transfers.single;
      expect(t.docNo, startsWith('TRF/'));
      expect(t.costCenter?.code, 'OPS-PB');
      expect(t.transferAt, isNotNull);
      expect(adapter.calls.single.headers['Idempotency-Key'], 'k-1');
    });
  });
}
