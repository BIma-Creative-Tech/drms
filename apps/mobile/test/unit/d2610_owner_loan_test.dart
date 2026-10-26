import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/format/rupiah.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/fund_check.dart';
import 'package:proyekkas/features/expense/domain/project_loan_instruction.dart';

import '../support/d2610_fixtures.dart';
import '../support/fixtures.dart';

/// DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26): the project's cash account only + "Instruksi pinjam antar proyek".
void main() {
  group('lender list', () {
    test('parses the account figures, the candidates (eligible first) and the waiting loan', () {
      final i = ProjectLoanInstruction.fromJson(pliJson());
      expect(i.docLabel, 'PB/DRMS/2610/0042');
      expect(i.borrowerAccountName, 'Kas Contoh A');
      expect(i.borrowerAvailable, 10000000);
      expect([i.needed, i.shortfall, i.minAmount], [30000000, 20000000, 20000000]);
      expect(i.canInstruct, isTrue);
      expect(i.pendingLoan, isNull);
      expect(i.candidates, hasLength(3));
      expect(i.firstEligible?.project.id, 6);
      expect(i.candidates[0].project.label, 'Q-B · Proyek B');
      expect(i.candidates[2].accountId, isNull);
      expect(i.candidates[2].reason, 'no_account');
      final p = ProjectLoanInstruction.fromJson(
        pliJson(
          canInstruct: false,
          pending: {
            'id': 7,
            'docNo': 'PJ/DRMS/2610/0007',
            'amount': 25000000,
            'statusLabel': 'Disetujui – menunggu transfer Finance',
          },
        ),
      );
      expect(p.canInstruct, isFalse);
      expect(p.pendingLoan?.label, 'PJ/DRMS/2610/0007');
      expect(p.cannotReason, contains('menunggu transfer Finance'));
    });

    test('amount: shortfall ≤ amount ≤ the lender dana bebas (server texts)', () {
      String? err(int? v, {int? max = 50}) => pliAmountError(v, min: 20, max: max, rupiah: formatRupiah);
      expect(err(20), isNull);
      expect(err(50), isNull);
      expect(err(19), 'Nilai pinjaman minimal Rp 20 (kekurangan dana akun kas pengajuan).');
      expect(err(51), 'Nilai pinjaman melebihi dana bebas akun kas pemberi (Rp 50).');
      expect(err(null), startsWith('Nilai pinjaman wajib diisi'));
      expect(err(51, max: null), isNull);
      expect(parseDigits('25.000.000'), 25000000);
      expect(parseDigits(''), isNull);
    });
  });

  group('texts and inbox fields', () {
    test('a short project account names it and the way out (no "dana PT")', () {
      expect(
        fundBlockedText(5000, pbName: 'Kas A'),
        'Dana bebas akun kas Kas A tidak cukup — kurang Rp 5.000. Tolak, atau Owner menginstruksikan pinjaman antar '
        'proyek ke akun ini lalu menyetujui setelah Finance mentransfernya.',
      );
      expect(
        fundBlockedText(5000),
        'Dana PT tidak cukup — kurang Rp 5.000. Tolak, atau perintahkan pinjaman antar-PT.',
      );
    });

    test('inbox: instructProjectLoan / projectLoanPending (absent on older servers)', () {
      final base = (inboxJson()['items'] as List).first as Map<String, dynamic>;
      final old = inboxItemFromJson(base);
      expect(old.instructProjectLoan, isFalse);
      expect(old.projectLoanPendingDocNo, isNull);
      final now = inboxItemFromJson({
        ...base,
        'fundShort': 20000000,
        'instructProjectLoan': true,
        'projectLoanPending': null,
      });
      expect(now.instructProjectLoan, isTrue);
      final pending = inboxItemFromJson({
        ...base,
        'fundShort': 20000000,
        'instructProjectLoan': false,
        'projectLoanPending': {'id': 7, 'docNo': null},
      });
      expect(pending.projectLoanPendingDocNo, '#7');
    });
  });
}
