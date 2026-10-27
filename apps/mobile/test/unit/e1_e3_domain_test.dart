import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/domain/dashboard.dart';
import 'package:proyekkas/features/dashboard/presentation/charts.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/draft_validation.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/domain/turn_timeline.dart';
import 'package:proyekkas/features/expense/presentation/history_screen.dart';

import '../support/fixtures.dart';

void main() {
  group('E1 timeline (ADR 0013)', () {
    test('Direktur "Diketahui" is the current turn, Finance approval pending', () {
      final d = detailFromJson(
        e1DetailJson(
          approvals: [
            {'id': 1, 'cycle': 1, 'position': 'diajukan', 'level': 0, 'actorName': 'Budi', 'decision': 'signed'},
            {'id': 2, 'cycle': 1, 'position': 'dibuat', 'level': 0, 'actorName': 'Citra', 'decision': 'signed'},
          ],
        ),
      );
      expect(d.approvalRule!.decisionFlow, isTrue);
      final steps = buildTimeline(d);
      expect(steps.map((s) => s.title), ['Diajukan Oleh', 'Dibuat Oleh', 'Diketahui (Direktur)', 'Approval (Finance)']);
      expect(steps[2].state, TurnState.current);
      expect(steps[3].state, TurnState.pending);
      expect(currentTurn(d), 'Direktur — persetujuan (Diketahui)');
    });

    test('after the Direktur: Finance has the turn', () {
      final d = detailFromJson(e1DetailJson(status: 'pending_approval', allowed: const ['approve', 'reject']));
      expect(buildTimeline(d)[2].state, TurnState.done);
      expect(currentTurn(d), 'Approval (Finance)');
    });

    test('Diketahui skipped (the only Direktur is the requester): "(tidak berlaku — pemohon)"', () {
      final d = detailFromJson(
        e1DetailJson(
          status: 'pending_approval',
          rule: e1RuleJson(
            skipped: [
              {
                'position': 'diketahui',
                'level': 0,
                'role': 'pk-owner',
                'userId': null,
                'reason': 'pemohon/pembuat adalah satu-satunya Direktur',
              },
            ],
          ),
        ),
      );
      final ack = buildTimeline(d).firstWhere((s) => s.title == 'Diketahui (Direktur)');
      expect(ack.state, TurnState.skipped);
      expect(ack.note, '(tidak berlaku — pemohon)');
    });

    test('approval skipped (the only Finance is the requester): one skipped Finance row', () {
      final d = detailFromJson(
        e1DetailJson(
          rule: e1RuleJson(
            withApproval: false,
            skipped: [
              {'position': 'approval', 'level': 1, 'role': 'pk-finance', 'userId': null, 'reason': 'x'},
            ],
          ),
        ),
      );
      final steps = buildTimeline(d);
      final approvals = steps.where((s) => s.title.startsWith('Approval')).toList();
      expect(approvals, hasLength(1));
      expect(approvals.single.title, 'Approval (Finance)');
      expect(approvals.single.state, TurnState.skipped);
      expect(approvals.single.note, skippedNote);
    });

    test('pre-E1 snapshot keeps the PM label for "Diketahui"', () {
      final legacy = {...(detailJson()['approvalRule'] as Map<String, dynamic>), 'acknowledgeBy': 'scope_manager'};
      final d = detailFromJson({...detailJson(status: 'pending_ack'), 'approvalRule': legacy});
      expect(d.approvalRule!.decisionFlow, isFalse);
      expect(buildTimeline(d)[2].title, 'Diketahui Oleh (PM / penanggung jawab)');
      expect(currentTurn(d), 'Diketahui Oleh (PM / penanggung jawab)');
    });
  });

  group('ADR 0021: PM project → Direktur, Finance transfers', () {
    test('PM step is current: "Persetujuan PM" before the Direktur (scope_manager checked before decisionFlow)', () {
      final d = detailFromJson(
        pmDetailJson(
          approvals: [
            {'id': 1, 'cycle': 1, 'position': 'diajukan', 'level': 0, 'actorName': 'Budi', 'decision': 'signed'},
            {'id': 2, 'cycle': 1, 'position': 'dibuat', 'level': 0, 'actorName': 'Budi', 'decision': 'signed'},
          ],
        ),
      );
      expect(d.approvalRule!.decisionFlow, isTrue);
      expect(d.approvalRule!.pmApproval, isTrue);
      expect(d.approvalRule!.legacyPmAcknowledge, isTrue);
      expect(d.statusLabel, 'Menunggu persetujuan PM');
      final steps = buildTimeline(d);
      // same steps as the web ApprovalTimeline (ADR 0021 snapshot)
      expect(steps.map((s) => s.title), ['Diajukan', 'Persetujuan PM', 'Persetujuan Direktur', 'Transfer Finance']);
      expect(steps.map((s) => s.state), [TurnState.done, TurnState.current, TurnState.pending, TurnState.pending]);
      expect(steps[0].actor, 'Budi');
      expect(currentTurn(d), 'PM project — persetujuan PM');
      expect(acknowledgeTitle(d.approvalRule), 'Persetujuan PM');
    });

    test('after the PM: the Direktur has the (final) turn, no Finance approval level', () {
      final d = detailFromJson(pmDetailJson(status: 'pending_approval', allowed: const ['approve', 'reject']));
      final rule = d.approvalRule!;
      expect(rule.roleOfLevel(1), 'pk-owner');
      expect(rule.lastLevel, 1);
      expect(currentTurn(d), 'Persetujuan Direktur');
      // Finance only transfers: no "Approval (Finance)" level, the last step is "Transfer Finance"
      expect(buildTimeline(d).where((s) => s.title.startsWith('Approval')), isEmpty);
      expect(buildTimeline(d).last.title, 'Transfer Finance');
    });

    test('PM requester: PM step skipped "(tidak berlaku — pemohon)", Direktur decides', () {
      final d = detailFromJson(
        pmDetailJson(
          status: 'pending_approval',
          allowed: const ['approve', 'reject'],
          rule: pmRuleJson(
            skipped: [
              {
                'position': 'diketahui',
                'level': 0,
                'role': null,
                'userId': 31,
                'reason': 'PM project adalah pemohon/pembuat',
              },
            ],
          ),
        ),
      );
      final ack = buildTimeline(d).firstWhere((s) => s.title == 'Persetujuan PM');
      expect(ack.state, TurnState.skipped);
      expect(ack.note, skippedNote);
    });

    test('Direktur request filed by the PM: selfApproval parsed (exception note)', () {
      final d = detailFromJson(pmDetailJson(rule: pmRuleJson(selfApproval: 'direktur_via_pm')));
      expect(d.approvalRule!.direkturViaPm, isTrue);
      expect(d.approvalRule!.direkturViaPmSelf, isFalse);
      final self = detailFromJson(pmDetailJson(rule: pmRuleJson(selfApproval: 'direktur_via_pm_self')));
      expect(self.approvalRule!.direkturViaPm, isTrue);
      expect(self.approvalRule!.direkturViaPmSelf, isTrue);
      expect(detailFromJson(pmDetailJson()).approvalRule!.direkturViaPm, isFalse);
    });

    test('old servers / old snapshots: no selfApproval, ADR 0013 labels unchanged', () {
      final d = detailFromJson(e1DetailJson());
      expect(d.approvalRule!.pmApproval, isFalse);
      expect(d.approvalRule!.selfApproval, isNull);
      expect(acknowledgeTitle(d.approvalRule), 'Diketahui (Direktur)');
    });

    test('pk-pm gets the approval inbox (fallback for a cached /me without capabilities)', () {
      expect(Capabilities.fromRoles({Role.pm}).approvalInbox, isTrue);
      expect(Capabilities.fromRoles({Role.staff}).approvalInbox, isFalse);
      expect(Capabilities.fromRoles({Role.owner}).approvalInbox, isTrue);
      expect(Capabilities.fromRoles({Role.finance}).approvalInbox, isTrue);
    });
  });

  group('server draft → local editor (withdraw / Ajukan ulang, US-04/06)', () {
    ExpenseDetail serverDraft() => detailFromJson({
      ...detailJson(status: 'draft', allowed: const ['edit', 'submit', 'cancel']),
      'rev': 7,
      'clientUuid': null,
      'bankAccountId': 21,
      // D2/D4: project request, the line charged to a RAP item.
      'project': {'id': 9, 'code': 'PRJ-09', 'name': 'Jalan Tambang Blok B'},
      'costCenter': null,
      // D2410 (point 6): a general attachment uploaded on the web
      'attachments': [
        {'id': 77, 'fileName': 'rekap.pdf', 'mimeType': 'application/pdf'},
      ],
      'lines': [
        {
          'id': '66f0a1b2c3d4e5f601234567', // web-created line: Payload row id, not a UUID
          'no': 1,
          'description': 'BBM',
          'qty': 1,
          'uom': {'id': 3, 'name': 'bulan'},
          'unitPrice': 600000,
          'total': 600000,
          'category': {'id': 1, 'name': 'BBM'},
          'vehicle': {'id': 5, 'plateNo': 'DA1234XY'},
          'rapItem': {'id': 501, 'code': 'A.1', 'name': 'BBM alat berat'},
        },
      ],
      'receipts': [
        {
          'id': 501,
          'lineId': '66f0a1b2c3d4e5f601234567',
          'receiptNo': '7654321',
          'vendorName': 'SPBU',
          'receiptDate': '2026-09-21',
          'amount': 600000,
          'imageId': 901,
          'status': 'pending',
        },
        {
          'id': 502,
          'lineId': '66f0a1b2c3d4e5f601234567',
          'vendorName': 'Dihapus',
          'receiptDate': '2026-09-21',
          'amount': 1,
          'imageId': 902,
          'status': 'removed',
        },
      ],
    });

    test('lines keep the server id, receipts stay on the server (read-only), rev + id kept', () {
      final d = draftFromServer(
        serverDraft(),
        clientUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000999',
        receiptUuid: (i) => 'r-$i',
      );
      expect(d.serverId, 42);
      expect(d.serverRev, 7);
      expect(d.syncState, DraftSyncState.synced);
      expect(d.bankAccountId, 21);
      expect(d.requesterIds, [11, 12]);
      final line = d.lines.single;
      expect(line.clientUuid, '66f0a1b2c3d4e5f601234567');
      expect(line.vehicleId, 5);
      expect((d.projectId, line.rapItemId), (9, 501));
      expect(line.receipts.single.isServerReceipt, isTrue);
      expect(line.receipts.single.serverReceiptId, 501);
      expect(d.mediaUuids, isEmpty, reason: 'no local photo to upload');
      expect(validateForSubmit(d), isEmpty, reason: 'server receipts / attachment satisfy "min. 1 nota" / "Lampiran"');
      expect((d.attachments.single.serverFileId, d.attachments.single.isLocal), (77, false));

      final p = draftToSyncPayload(d);
      expect(p['request_id'], 42, reason: 'a web-created draft has no APK id; the server id identifies it');
      expect(p['attachment_ids'], [77], reason: 'D2410: the web attachment stays on the draft');
      final l = (p['lines'] as List).single as Map<String, dynamic>;
      expect(l['id'], '66f0a1b2c3d4e5f601234567');
      expect(l.containsKey('client_uuid'), isFalse);
      expect(l['receipts'], isEmpty, reason: 'server receipts are never re-sent (missing ≠ removed)');
    });

    test('a new local receipt next to a server receipt is still sent', () {
      final d = draftFromServer(
        serverDraft(),
        clientUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000999',
        receiptUuid: (i) => 'r-$i',
      );
      final withNew = d.copyWith(
        lines: [
          d.lines.single.copyWith(
            receipts: [
              ...d.lines.single.receipts,
              const DraftReceipt(
                clientUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000777',
                vendorName: 'SPBU',
                receiptDate: '2026-09-25',
                amount: 1000,
                mediaUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000778',
              ),
            ],
          ),
        ],
      );
      expect(withNew.mediaUuids, ['0192f6d0-aaaa-7bbb-8ccc-000000000778']);
      final rs = (((draftToSyncPayload(withNew)['lines'] as List).single as Map)['receipts'] as List);
      expect(rs, hasLength(1));
      expect((rs.single as Map)['client_uuid'], '0192f6d0-aaaa-7bbb-8ccc-000000000777');
    });

    test('drafts made on the phone keep sending client_uuid lines and no request_id before sync', () {
      expect(isUuid('0192f6d0-aaaa-7bbb-8ccc-000000000011'), isTrue);
      expect(isUuid('66f0a1b2c3d4e5f601234567'), isFalse);
    });
  });

  group('dashboards (US-27, US-17)', () {
    test('Direktur / Finance / PM parse the web dashboard data', () {
      final o = DirekturDashboard.fromJson(direkturDashboardJson());
      expect(o.cashTotal, 152500000);
      expect(o.waitingForMe, 2);
      expect(o.pendingAckCount, 2);
      expect(o.cashFlow.last.masuk, 40000000);
      expect(o.balanceTrend.map((p) => p.value), [140000000, 138000000, 152500000]);
      expect(share(o.budgetTotals.realized, o.budgetTotals.budget), 42.5);

      final f = FinanceDashboard.fromJson(financeDashboardJson());
      expect(f.transferCount, 4);
      expect(f.transferOverdue, 1);
      expect(f.lpjToVerify + f.reimburseToVerify, 5);
      expect(f.advancesOverdue, 1);

      final pm = PmDashboard.fromJson(pmDashboardJson());
      expect(pm.teamCount, 6);
      expect(pm.withoutLpj, 3);
      expect(pm.requestTrend.last.value, 6);
      expect(PmDashboard.fromJson(const {}).teamCount, 0, reason: 'tolerant parsing');
    });

    test('MC4 per-PT split: joined by companyId in companies[] order; none for one PT', () {
      final o = DirekturDashboard.fromJson(direkturDashboardTwoPtJson()).byCompany;
      expect(o.map((r) => r.code), ['DRMS', 'CS1']);
      expect(o.map((r) => r.cash), [100000000, 52500000]);
      expect(o.map((r) => (r.count, r.sum)), [(2, 5000000), (1, 2250000)]);

      final f = FinanceDashboard.fromJson(financeDashboardTwoPtJson()).byCompany;
      expect(f.map((r) => r.cash), [60000000, 38000000]);
      expect(f.map((r) => (r.count, r.sum)), [(3, 7000000), (1, 1200000)]);

      final pm = PmDashboard.fromJson(pmDashboardTwoPtJson()).byCompany;
      expect(pm.map((r) => (r.code, r.count, r.sum, r.waiting)), [('DRMS', 4, 12000000, 1), ('CS1', 0, 0, null)]);
      expect(pm.first.cash, isNull);

      expect(DirekturDashboard.fromJson(direkturDashboardJson()).byCompany, isEmpty, reason: 'pre-MC2 payload');
      expect(
        FinanceDashboard.fromJson({
          ...financeDashboardTwoPtJson(),
          'companies': [twoCompaniesJson.first],
        }).byCompany,
        isEmpty,
        reason: 'one PT = the totals already',
      );
    });

    test('short rupiah matches the web (rules.ts shortRupiah)', () {
      expect(formatRupiahShort(152500000), 'Rp 152,5 jt');
      expect(formatRupiahShort(2000000000), 'Rp 2 M');
      expect(formatRupiahShort(-250000), '−Rp 250 rb');
      expect(formatRupiahShort(900), 'Rp 900');
      expect(share(1, 0), isNull);
      expect(pctText(88.25), '88,3%');
    });
  });

  group('Riwayat (US-35)', () {
    test('history rows parse; labels and old → new follow the web Riwayat view', () {
      final rows = [for (final i in historyJson()['items'] as List) historyFromJson(i as Map<String, dynamic>)];
      expect(rows, hasLength(3));
      expect(historyActionLabels[rows[2].action], 'disetujui (Diketahui: PM/Direktur)');
      expect(historyActionLabels['approval_policy_exception'], 'pengecualian kebijakan (Direktur via PM)');
      expect(historyChange(rows[0]), 'draft → pending_ack');
      expect(historyChange(rows[1]), '677000 → 676876');
      expect(historyDocLabels[rows[1].docType], 'Nota');
      expect(historyActor(rows[1]), 'Citra');
      expect(historyValue('x' * 200).length, 158);
      expect(historyValue({'a': 1}), '{"a":1}');
    });
  });
}
