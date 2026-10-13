import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/draft_validation.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/projects/data/projects_api.dart';

import '../support/fixtures.dart';
import '../support/schema_v2.dart';

/// DRMS 10/10 D4: drift schema v8 adds `local_lines.rap_item_id` (nullable). A v7 phone keeps every draft line; a
/// line without a RAP item opens, asks for one ("Pilih item RAP") and blocks submit until it is chosen. D2: the
/// requester sends no cost center any more (a pre-D2 draft must pick a project).
const sub = 'kc-sub-v8';

void main() {
  test('v7 → v8: lines survive with rap_item_id NULL; prompt + submit blocked; the item round-trips', () async {
    const ts = 1790000000;
    final db = oldPhoneDb(7, (raw) {
      raw.execute(
        'INSERT INTO local_drafts (client_uuid, user_sub, company_id, type, title, cost_center_id, requester_ids_json, '
        "bank_account_id, sync_state, created_at, updated_at) VALUES ('d-8', '$sub', 1, 'advance', 'Semen', 7, "
        "'[12]', 21, 'local', $ts, $ts)",
      );
      raw.execute(
        'INSERT INTO local_lines (client_uuid, draft_uuid, no, description, qty, uom_id, unit_price, total, '
        "receipt_amount, category_id) VALUES ('l-1', 'd-8', 1, 'Semen 50 kg', 10, 3, 65000, 650000, 640000, 1)",
      );
    });
    addTearDown(db.close);
    expect(db.schemaVersion, 10);
    final repo = DraftRepository(db);
    final before = (await repo.load(sub, 'd-8'))!;
    final line = before.lines.single;
    expect((line.rapItemId, line.needsRapItem, line.receiptAmount), (null, true, 640000));
    expect(before.costCenterId, 7, reason: 'kept locally, never sent');
    expect(validateForSubmit(before).map((i) => (i.field, i.lineNo)).toSet(), {('projectId', null), ('rapItemId', 1)});

    await repo.save(sub, before.copyWith(projectId: 9, costCenterId: null, lines: [line.copyWith(rapItemId: 501)]));
    final after = (await repo.load(sub, 'd-8'))!;
    expect(after.lines.single.rapItemId, 501);
    expect(validateForSubmit(after), isEmpty);
    final sync = draftToSyncPayload(after);
    expect((sync['project_id'], sync.containsKey('cost_center_id')), (9, false));
    expect(((sync['lines'] as List).single as Map)['rap_item_id'], 501);
    final body = draftToCreateBody(after);
    expect((body['projectId'], body.containsKey('costCenterId')), (9, false));
    expect(((body['lines'] as List).single as Map)['rapItemId'], 501);
  });

  test('read model: rapItem per line, "Melebihi RAP" from the rap_over_budget flag of that line', () {
    final j = detailJson(status: 'draft', allowed: const ['edit', 'submit']);
    final lines = [for (final l in j['lines'] as List) Map<String, dynamic>.of(l as Map<String, dynamic>)];
    lines[0]['rapItem'] = {'id': 501, 'code': 'A.1', 'name': 'Solar alat berat'};
    lines[1]['rapItemId'] = 502; // bare id from a server without the read model
    final d = detailFromJson({
      ...j,
      'lines': lines,
      'flags': [
        {
          'id': 77,
          'kind': rapOverBudgetFlag,
          'kindLabel': 'Melebihi RAP',
          'level': 'warning',
          'status': 'open',
          'lineNo': 2,
          'message': 'Total baris melebihi sisa RAP',
        },
      ],
    });
    expect(d.lines[0].rapItem, const RefItem(id: 501, code: 'A.1', name: 'Solar alat berat'));
    expect(d.lines[1].rapItem?.id, 502);
    expect([for (final l in d.lines) lineRapOverBudget(d, l)], [false, true]);
    expect(lineNeedsRapItem(d, d.lines[0]), isFalse);
    final legacy = detailFromJson(detailJson(status: 'draft'));
    expect(lineNeedsRapItem(legacy, legacy.lines.first), isTrue, reason: 'editable request without a RAP item');
    final locked = detailFromJson(detailJson());
    expect(lineNeedsRapItem(locked, locked.lines.first), isFalse, reason: 'only editable requests ask');
    expect(draftFromServer(d, clientUuid: 'x', receiptUuid: (i) => '$i').lines.first.rapItemId, 501);
  });

  test('RAP item JSON: D4 cost shape and the P3 shape (quantity realisation is not money)', () {
    final cost = rapBudgetItemFromJson({
      'id': 501,
      'code': 'A.1',
      'name': 'Solar alat berat',
      'uom': 'liter',
      'qty': 1000,
      'unitPrice': 15000,
      'planned': 15000000,
      'realised': 950, // litres from daily reports (P3 quantity)
      'realisedAmount': 16200000,
      'remaining': -1200000,
      'percent': 108,
    });
    expect((cost.label, cost.overBudget, cost.progress, cost.exceeds(1)), ('A.1 — Solar alat berat', true, 1.0, true));
    final p3 = rapBudgetItemFromJson({
      'id': 9,
      'code': 'B.2',
      'description': 'Galian tanah',
      'uom': {'id': 1, 'code': 'm3'},
      'volume': 120,
      'value': 6000000,
      'realised': 80, // m3 from daily reports
    });
    expect(
      (p3.name, p3.uom, p3.qty, p3.planned, p3.realised, p3.remaining),
      ('Galian tanah', 'm3', 120.0, 6000000, null, 6000000),
    );
    final noPrices = rapBudgetItemFromJson({'id': 3, 'code': 'C', 'description': 'Besi', 'volume': 4});
    expect((noPrices.remaining, noPrices.progress, noPrices.exceeds(5)), (null, null, null));
  });

  test('pages: Payload {docs, totalPages} and cursor lists', () {
    final a = pageFromJson(
      {
        'docs': [
          {'id': 1, 'code': 'P1', 'name': 'Satu'},
        ],
        'totalDocs': 21,
        'page': 1,
        'totalPages': 2,
      },
      projectFromJson,
      page: 1,
    );
    expect((a.items.single.label, a.hasMore, a.total), ('P1 — Satu', true, 21));
    final b = pageFromJson({'items': const [], 'nextCursor': 'MTI'}, projectFromJson, page: 1);
    expect((b.hasMore, b.nextCursor), (true, 'MTI'));
    expect(pageFromJson({'items': const [], 'nextCursor': null}, projectFromJson, page: 1).hasMore, isFalse);
  });
}
