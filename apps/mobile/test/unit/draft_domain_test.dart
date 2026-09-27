import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/draft_validation.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';

import '../support/seed.dart';

void main() {
  test('seed form: 3 lines 600.000 + 677.000 + 170.500 = 1.447.500 (preview)', () {
    final d = seedDraft();
    expect(d.lines, hasLength(3));
    expect(d.previewGrandTotal, 1447500);
    expect(validateForSubmit(d), isEmpty);
  });

  test('lump-sum line (total only, no qty/uom) is valid (US-37)', () {
    final line = seedDraft().lines[2];
    expect(line.qty, isNull);
    expect(line.uomId, isNull);
    expect(validateForSubmit(seedDraft()).where((i) => i.lineNo == 3), isEmpty);
  });

  test('receipt difference line 2: 677.000 − 676.876 = 124 (US-47 preview)', () {
    expect(receiptDifference(seedDraft().lines[1]), 124);
    expect(receiptDifference(seedDraft().lines[0]), 0);
  });

  test('reimburse needs ≥ 1 receipt per line; advance does not (US-36/US-38)', () {
    final r = validateForSubmit(seedDraft(withReceipts: false));
    expect(r.where((i) => i.field == 'receipts'), hasLength(3));
    final a = validateForSubmit(seedDraft(type: RequestType.advance, withReceipts: false));
    expect(a.where((i) => i.field == 'receipts'), isEmpty);
  });

  test('exactly one of project / cost center (US-53)', () {
    final both = seedDraft().copyWith(projectId: 3);
    expect(validateForSubmit(both).map((e) => e.field), contains('scope'));
    final none = seedDraft().copyWith(costCenterId: null);
    expect(validateForSubmit(none).map((e) => e.field), contains('scope'));
  });

  test('required fields: title, bank account, lines, description, category, total > 0', () {
    final d = seedDraft().copyWith(
      title: ' ',
      bankAccountId: null,
      lines: [seedDraft().lines.first.copyWith(description: '', categoryId: null, total: 0)],
    );
    final fields = validateForSubmit(d).map((e) => e.field).toSet();
    expect(fields, containsAll(['title', 'bankAccountId', 'description', 'categoryId', 'total']));
    expect(validateForSubmit(seedDraft().copyWith(lines: const [])).map((e) => e.field), contains('lines'));
  });

  test('save needs only a title (offline drafts can be incomplete)', () {
    expect(validateForSave(DraftRequest(clientUuid: 'x', type: RequestType.advance, title: 'Uang muka')), isEmpty);
    expect(validateForSave(const DraftRequest(clientUuid: 'x', type: RequestType.advance)), isNotEmpty);
  });

  test('renumber keeps order 1..n', () {
    final lines = seedDraft().lines.sublist(1);
    expect(renumber(lines).map((l) => l.no), [1, 2]);
  });

  test('issue text mentions the line', () {
    expect(
      const DraftIssue('total', 'Total harus lebih dari 0.', lineNo: 2).toString(),
      'Baris 2: Total harus lebih dari 0.',
    );
  });
}
