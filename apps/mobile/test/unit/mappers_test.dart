import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';

import '../support/fixtures.dart';
import '../support/seed.dart';

void main() {
  test('detail JSON → domain', () {
    final d = detailFromJson(detailJson());
    expect(d.id, 42);
    expect(d.type, RequestType.reimburse);
    expect(d.status, RequestStatus.pendingApproval);
    expect(d.grandTotal, 1447500);
    expect(d.costCenter?.name, 'Ops Palangka Banjar');
    expect(d.requesters.map((r) => r.name), ['Budi', 'Doni']);
    expect(d.lines.first.vehiclePlate, 'DA 1234 XY');
    expect(d.lines.first.uom?.name, 'bulan');
    expect(d.receipts.single.imageId, 901);
    expect(d.approvals.map((a) => a.position), [SignPosition.diajukan, SignPosition.dibuat, SignPosition.diketahui]);
    expect(d.approvalRule?.steps.single.level, 1);
    expect(d.flags.single.level, 'warning');
    expect(d.budget.hasBudget, isTrue);
    expect(d.budget.pctAfter, 88.25);
    expect(d.allowedActions, {'approve', 'reject'});
  });

  test('tolerates missing / unknown fields', () {
    final d = detailFromJson({'id': 1, 'status': 'something_new', 'type': 'advance'});
    expect(d.status, RequestStatus.unknown);
    expect(d.lines, isEmpty);
    expect(d.budget.hasBudget, isFalse);
  });

  test('inbox JSON → domain', () {
    final i = inboxItemFromJson(inboxJson()['items'][0] as Map<String, dynamic>);
    expect(i.step, 'approve');
    expect(i.budgetOverWarn, isTrue);
    expect(i.warningFlags, 1);
    expect(i.infoFlags, 2);
  });

  test('me JSON → profile, roles and home', () {
    final p = userProfileFromJson(meJson(roles: ['pk-staff', 'pk-pm', 'unknown-role']));
    expect(p.roles, {Role.staff, Role.pm});
    expect(p.homeKind, HomeKind.pm);
    // ADR 0013: PM monitors only (no inbox); without `capabilities` (cached pre-E1 /me) the roles decide.
    expect(p.hasApprovalInbox, isFalse);
    expect(p.hasTeamMonitor, isTrue);
    expect(p.timezone, 'Asia/Makassar');
    expect(p.imageTargets.receiptsMaxPx, 2000);
    expect(userProfileFromJson(meJson(roles: ['pk-owner'])).homeKind, HomeKind.direktur);
    expect(userProfileFromJson(meJson(roles: ['pk-finance'])).canCreateRequests, isFalse);
  });

  test('me capabilities (E1) drive inbox / team monitor, not role hardcoding', () {
    final fin = userProfileFromJson({
      ...meJson(roles: ['pk-finance']),
      'capabilities': {'approvalInbox': true, 'teamMonitor': false},
    });
    expect(fin.hasApprovalInbox, isTrue);
    expect(fin.hasTeamMonitor, isFalse);
    expect(fin.homeKind, HomeKind.finance);
    // The server is authoritative: a capability the roles would not give is still honoured.
    final pm = userProfileFromJson({
      ...meJson(roles: ['pk-pm']),
      'capabilities': {'approvalInbox': false, 'teamMonitor': true},
    });
    expect(pm.hasApprovalInbox, isFalse);
    expect(pm.hasTeamMonitor, isTrue);
    expect(userProfileFromJson(meJson(roles: ['pk-owner'])).hasApprovalInbox, isTrue);
    expect(userProfileFromJson(meJson(roles: ['pk-owner', 'pk-pm'])).roleLabels, 'PM, Direktur');
  });

  test('inbox item E1 fields: stepLabel and decisionFlow', () {
    final i = inboxItemFromJson({
      ...(inboxJson()['items'] as List).first as Map<String, dynamic>,
      'step': 'acknowledge',
      'level': null,
      'stepLabel': 'Persetujuan Direktur (Diketahui)',
      'decisionFlow': true,
    });
    expect(i.stepLabel, 'Persetujuan Direktur (Diketahui)');
    expect(i.decisionFlow, isTrue);
    final old = inboxItemFromJson((inboxJson()['items'] as List).first as Map<String, dynamic>);
    expect(old.stepLabel, isNull);
    expect(old.decisionFlow, isFalse);
  });

  test('draft → create body (openapi ExpenseRequestCreate)', () {
    final b = draftToCreateBody(seedDraft());
    expect(b['type'], 'reimburse');
    expect(b['clientUuid'], '0192f6d0-aaaa-7bbb-8ccc-000000000100');
    expect(b['costCenterId'], 7);
    expect(b['projectId'], isNull);
    final lines = b['lines'] as List;
    expect(lines, hasLength(3));
    expect((lines[1] as Map)['total'], 677000);
    expect((lines[1] as Map)['unitPrice'], 339000);
    expect(b.containsKey('grandTotal'), isFalse, reason: 'server computes the grand total');
  });

  test('draft → sync payload (SyncDraftUpsertPayload, backend 0.2.1)', () {
    final p = draftToSyncPayload(seedDraft());
    expect(p['kind'], 'reimburse');
    expect(p['cost_center_id'], 7);
    expect(p['requester_ids'], [11, 12]);
    expect(p['client_grand_total'], 1447500);
    expect(p.containsKey('draft_client_uuid'), isFalse);
    final l2 = (p['lines'] as List)[1] as Map<String, dynamic>;
    expect(l2.keys.toSet(), {
      'client_uuid',
      'description',
      'qty',
      'uom_id',
      'unit_price',
      'total',
      'notes',
      'category_id',
      'vehicle_id',
      'receipts',
    });
    expect(l2['client_uuid'], '0192f6d0-aaaa-7bbb-8ccc-000000000012');
    final r = (l2['receipts'] as List).single as Map<String, dynamic>;
    expect(r['amount'], 676876);
    expect(r['receipt_date'], '2026-09-20');
    expect(r['receipt_time'], isNull);
    expect(draftToSyncPayload(seedDraft(), includeDraftId: true)['draft_client_uuid'], seedDraft().clientUuid);
    final adv = draftToSyncPayload(seedDraft(type: RequestType.advance));
    expect(
      ((adv['lines'] as List).first as Map).containsKey('receipts'),
      isFalse,
      reason: 'receipts only on reimburse drafts',
    );
  });

  test('media placeholders are replaced by media_id before sending', () {
    final p = draftToSyncPayload(seedDraft());
    final ids = {for (final (i, m) in seedDraft().mediaUuids.indexed) m: 900 + i};
    final resolved = resolveMediaIds(p, ids)!;
    final r1 = (((resolved['lines'] as List).first as Map)['receipts'] as List).single as Map;
    expect(r1['media_id'], 900);
    expect(r1.containsKey(mediaPlaceholderKey), isFalse);
    expect(r1['receipt_time'], '11:42');
    expect(resolveMediaIds(p, const {}), isNull, reason: 'missing upload → cannot send');
  });

  test('offset string', () {
    expect(offsetString(const Duration(hours: 8)), '+08:00');
    expect(offsetString(const Duration(hours: 7)), '+07:00');
  });
}
