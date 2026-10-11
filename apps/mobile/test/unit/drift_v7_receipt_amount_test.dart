import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/draft_validation.dart';

import '../support/schema_v2.dart';

/// DRMS 10/10 D3: drift schema v7 adds `local_lines.receipt_amount` ("Nominal sesuai nota", nullable). A v6 phone
/// (mobile-v0.5.x) keeps every draft line; a line typed before D3 (total without harga satuan) still opens and
/// asks for qty / harga satuan before it can be submitted.
const sub = 'kc-sub-v7';

void main() {
  test('v6 → v7: lines survive with receipt_amount NULL; the new value round-trips into both payloads', () async {
    const ts = 1790000000;
    final db = oldPhoneDb(6, (raw) {
      raw.execute(
        'INSERT INTO local_drafts (client_uuid, user_sub, company_id, type, title, cost_center_id, requester_ids_json, '
        "bank_account_id, sync_state, created_at, updated_at) VALUES ('d-7', '$sub', 1, 'advance', 'BBM genset', 7, "
        "'[12]', 21, 'local', $ts, $ts)",
      );
      // Pre-D3 lines: one with qty × harga satuan, one lump sum (typed total only).
      raw.execute(
        'INSERT INTO local_lines (client_uuid, draft_uuid, no, description, qty, uom_id, unit_price, total, category_id) '
        "VALUES ('l-1', 'd-7', 1, 'Solar', 20, 3, 15000, 300000, 1)",
      );
      raw.execute(
        'INSERT INTO local_lines (client_uuid, draft_uuid, no, description, total, category_id) '
        "VALUES ('l-2', 'd-7', 2, 'Makan', 170500, 3)",
      );
    });
    addTearDown(db.close);
    expect(db.schemaVersion, 7);
    final repo = DraftRepository(db);
    final before = await repo.load(sub, 'd-7');
    expect(before!.lines, hasLength(2));
    final (solar, makan) = (before.lines[0], before.lines[1]);
    expect((solar.computedTotal, solar.receiptAmount, solar.needsUnitPrice), (300000, null, false));
    expect((makan.total, makan.computedTotal, makan.needsUnitPrice), (170500, null, true));
    expect(before.previewGrandTotal, 470500, reason: 'the old typed total is kept until the line is completed');
    expect(validateForSubmit(before).where((i) => i.lineNo == 2).map((i) => i.field).toSet(), {
      'qty',
      'unitPrice',
    }, reason: 'old draft opens, but must be completed (prompt to fill harga satuan)');

    final fixed = before.copyWith(
      lines: [
        solar.copyWith(receiptAmount: 299500),
        makan.copyWith(qty: 1, uomId: 3, unitPrice: 170500, total: 170500),
      ],
    );
    await repo.save(sub, fixed);
    final after = await repo.load(sub, 'd-7');
    expect(after!.lines.first.receiptAmount, 299500);
    expect(after.lines.first.receiptMismatch, isTrue);
    expect(validateForSubmit(after), isEmpty);
    final line = (draftToSyncPayload(after)['lines'] as List).first as Map<String, dynamic>;
    expect((line['total'], line['receipt_amount']), (300000, 299500));
    final body = (draftToCreateBody(after)['lines'] as List).first as Map<String, dynamic>;
    expect((body['total'], body['receiptAmount']), (300000, 299500));
  });
}
