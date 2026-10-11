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

  group('D3 computed line total (DRMS 10/10)', () {
    test('total = qty × harga satuan, whole rupiah, decimal qty rounds half up', () {
      expect(lineTotalOf(2, 338500), 677000);
      expect(lineTotalOf(24.8, 15000), 372000); // 24,8 L × Rp 15.000 (no float drift)
      expect(lineTotalOf(0.333, 1000), 333);
      expect(lineTotalOf(1.5, 3), 5); // 4,5 → 5
      expect(lineTotalOf(0.001, 499), 0); // 0,499 → 0 (then "Total harus lebih dari 0")
      expect(lineTotalOf(null, 1000), isNull);
      expect(lineTotalOf(2, null), isNull);
      expect(lineTotalOf(0, 1000), isNull);
      expect(lineTotalOf(1e9, 99999999999999), isNull, reason: 'beyond int range → no total');
    });

    test('the typed total is ignored: preview and payloads use qty × harga satuan', () {
      final l = seedDraft().lines[1].copyWith(total: 1); // stale stored total
      expect(l.computedTotal, 677000);
      expect(seedDraft().copyWith(lines: [l]).previewGrandTotal, 677000);
    });

    test('"Nominal sesuai nota" ≠ total → Selisih nota; equal or empty → none', () {
      final l2 = seedDraft().lines[1];
      expect(l2.receiptAmount, 676876);
      expect(l2.receiptMismatch, isTrue);
      expect(l2.copyWith(receiptAmount: 677000).receiptMismatch, isFalse);
      expect(l2.copyWith(receiptAmount: null).receiptMismatch, isFalse);
      expect(seedDraft().lines.first.receiptMismatch, isFalse);
      // A mismatch never blocks the submit (awareness flag for Finance only).
      expect(validateForSubmit(seedDraft()).where((i) => i.lineNo == 2), isEmpty);
    });

    test('pre-D3 line (typed total, no harga satuan) still opens but must be completed before submit', () {
      final old = seedDraft().lines[2].copyWith(qty: null, uomId: null, unitPrice: null, total: 170500);
      expect(old.needsUnitPrice, isTrue);
      expect(old.computedTotal, isNull);
      final d = seedDraft().copyWith(lines: [seedDraft().lines.first, old]);
      expect(d.previewGrandTotal, 600000 + 170500, reason: 'old total kept until completed');
      final fields = validateForSubmit(d).where((i) => i.lineNo == 3).map((i) => i.field).toSet();
      expect(fields, {'qty', 'unitPrice'});
    });

    test('qty without satuan and harga satuan 0 are refused; nota Rp 0 is only a mismatch (server: ≥ 0)', () {
      final l = seedDraft().lines.first.copyWith(uomId: null, unitPrice: 0, receiptAmount: 0);
      final fields = validateForSubmit(seedDraft().copyWith(lines: [l])).map((i) => i.field).toSet();
      expect(fields, containsAll(['uomId', 'unitPrice']));
      expect(fields, isNot(contains('receiptAmount')));
    });
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

  test('D2: project required, no cost center choice (no non-project requests)', () {
    final none = seedDraft().copyWith(projectId: null, costCenterId: 7);
    expect(validateForSubmit(none).map((e) => e.field), contains('projectId'));
    expect(
      validateForSubmit(seedDraft().copyWith(costCenterId: 7)),
      isEmpty,
      reason: 'a legacy cost center is ignored',
    );
  });

  test('D4: every line needs a RAP item; a pre-D4 line opens but blocks submit', () {
    final old = seedDraft().lines[1].copyWith(rapItemId: null);
    expect(old.needsRapItem, isTrue);
    final issues = validateForSubmit(seedDraft().copyWith(lines: [seedDraft().lines.first, old]));
    expect(issues.map((i) => (i.field, i.lineNo)), [('rapItemId', 2)]);
    expect(issues.single.toString(), 'Baris 2: Item RAP wajib dipilih.');
  });

  test('required fields: title, bank account, lines, description, category, total > 0', () {
    final d = seedDraft().copyWith(
      title: ' ',
      bankAccountId: null,
      lines: [seedDraft().lines.first.copyWith(description: '', categoryId: null, qty: 0.001, unitPrice: 1)],
    );
    final fields = validateForSubmit(d).map((e) => e.field).toSet();
    expect(fields, containsAll(['title', 'bankAccountId', 'description', 'categoryId', 'total']));
    expect(validateForSubmit(seedDraft().copyWith(lines: const [])).map((e) => e.field), contains('lines'));
  });

  test('save needs only a title (offline drafts can be incomplete)', () {
    expect(validateForSave(DraftRequest(clientUuid: 'x', type: RequestType.advance, title: 'Pengajuan baru')), isEmpty);
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
