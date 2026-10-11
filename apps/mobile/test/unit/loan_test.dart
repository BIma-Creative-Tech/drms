import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/loans/domain/loan.dart';

import '../support/d1010_d_loans_fixtures.dart';

/// ADR 0022: parsing of the loan contract and the client form checks.
void main() {
  test('summary/detail: status, overdue, samePm, g1 note, repayments, decisions, actions', () {
    final l = Loan.fromJson(loanApprovedJson());
    expect(l.status, LoanStatus.partiallyRepaid);
    expect(l.statusLabel, 'Sebagian kembali');
    expect(l.title, 'PJ/DRMS/2609/0003');
    expect(l.overdue, isTrue);
    expect(l.daysOverdue, 6);
    expect(l.samePm, isTrue);
    expect(l.samePmNote, 'PM peminjam = PM pemberi');
    expect(l.lender.label, 'PRJ-A Gudang Balikpapan');
    expect(l.borrower.pm?.name, 'Doni Pratama');
    expect(l.amount, 150000000);
    expect(l.repaidTotal, 50000000);
    expect(l.outstanding, 100000000);
    expect(l.repayments, hasLength(2));
    expect(l.repayments.first.seq, 1);
    expect(l.repayments.last.posted, isFalse);
    expect(l.repayments.last.voidReason, 'Salah nominal');
    expect(l.decisions.single.approved, isTrue);
    expect(l.borrowedBy(10), isTrue);
    expect(l.borrowedBy(9), isFalse);

    final d = Loan.fromJson(loanJson(status: 'draft', actions: ['edit', 'submit', 'cancel', 'unknown']));
    expect(d.title, 'Draft #41');
    expect(d.allowedActions, {LoanAction.edit, LoanAction.submit, LoanAction.cancel});

    final g = Loan.fromJson(loanJson(g1Note: 'Disetujui Direktur pembuat karena satu-satunya Direktur PT'));
    expect(g.g1Exception, 'direktur_self');
    expect(g.g1Note, contains('satu-satunya Direktur'));
    expect(Loan.fromJson(const {}).status, LoanStatus.draft, reason: 'tolerant parsing');
  });

  test('options: borrower PM check and lenders of the same PT without the borrower', () {
    final o = loanOptionsFixture();
    expect(o.canBorrowFor(10), isTrue);
    expect(o.canBorrowFor(9), isFalse);
    expect(o.lendersFor(10).map((l) => l.id), [9]);
    expect(o.lendersFor(null), isEmpty);
  });

  test('validateLoan: same messages as the server', () {
    const today = '2026-10-11';
    expect(
      validateLoan(
        borrowerId: 10,
        lenderId: 9,
        amount: 1,
        reason: 'abc',
        loanDate: today,
        dueDate: today,
        today: today,
      ),
      isEmpty,
    );
    final e = validateLoan(
      borrowerId: 10,
      lenderId: 10,
      amount: 0,
      reason: ' x ',
      loanDate: '2026-10-12',
      dueDate: '2026-10-01',
      today: today,
    );
    expect(e['lender'], 'Project pemberi dan peminjam harus berbeda.');
    expect(e['amount'], 'Nilai pinjaman wajib diisi (bilangan bulat Rupiah > 0).');
    expect(e['reason'], 'Alasan wajib diisi (min. 3 karakter).');
    expect(e['loanDate'], 'Tanggal pinjaman tidak boleh di masa depan.');
    expect(e['dueDate'], 'Jatuh tempo tidak boleh sebelum tanggal pinjaman.');
    expect(
      validateLoan(
        borrowerId: null,
        lenderId: null,
        amount: null,
        reason: '',
        loanDate: today,
        dueDate: null,
        today: today,
      )['dueDate'],
      'Jatuh tempo wajib diisi.',
    );
  });
}
