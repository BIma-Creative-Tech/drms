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
    expect(l.lender?.label, 'PRJ-A Gudang Balikpapan');
    expect(l.lenderLabel, 'PRJ-A Gudang Balikpapan');
    // ADR 0031: a server before the fields → a manual claim without cash
    expect((l.origin, l.cashBacked, l.awaitingDisbursement, l.disbursement), ('manual', false, false, null));
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

  test('ADR 0031: automatic loan — null lender project, the paying account lends; cash numbers', () {
    final l = Loan.fromJson(loanAutoJson());
    expect(l.lender, isNull);
    expect(l.automatic, isTrue);
    expect(l.lenderLabel, 'Akun Kas Kecil');
    expect((l.lenderCashAccount?.id, l.borrowerCashAccount?.label), (4, 'Bank Mandiri Operasional'));
    expect((l.origin, l.originLabel, l.transfer?.label), ('transfer', 'Otomatis (transfer)', 'TRF/DRMS/2610/0012'));
    expect(l.cashBacked, isTrue);
    expect((l.disbursement?.kk, l.disbursement?.km), ('KK/DRMS/2610/0021', 'KM/DRMS/2610/0022'));
    expect((l.disbursedAt, l.disbursedBy?.name), ('2026-10-05T02:10:00.000Z', 'Fina Keuangan'));
    expect((l.repayments.single.cash?.kk, l.repayments.single.cash?.km), ('KK/DRMS/2610/0031', 'KM/DRMS/2610/0032'));
    expect(l.borrowedBy(10), isTrue);
    // a lender without project nor account (malformed) still renders
    final bare = Loan.fromJson({...loanAutoJson(), 'lenderCashAccount': null});
    expect(bare.lenderLabel, 'Akun —');

    final w = Loan.fromJson(loanAwaitingJson());
    expect((w.awaitingDisbursement, w.statusLabel), (true, 'Disetujui – menunggu transfer Finance'));
    expect(w.allowedActions, {LoanAction.disburse});
    expect(w.lender?.label, 'PRJ-A Gudang Balikpapan');
    expect(Loan.fromJson(loanJson(actions: ['disburse', 'repay'])).allowedActions, {
      LoanAction.disburse,
      LoanAction.repay,
    });
  });

  test('2026-10-24: levels, submitter role, repayable amount, repayment requests; older server defaults', () {
    final old = Loan.fromJson(loanApprovedJson());
    expect((old.approvalLevel, old.submitterRole, old.waitingOwner), (null, null, false));
    expect(old.repayableAmount, old.outstanding, reason: 'older server: the outstanding');
    expect(old.repaymentNeedsApproval, isFalse);
    expect(old.decisions.single.level, 1, reason: 'the single decision of the one-level flow');
    expect(old.repayments.first.status, LoanRepaymentStatus.posted);
    expect(old.repayments.last.status, LoanRepaymentStatus.voided);
    expect(old.repayments.first.allowedActions, isEmpty);

    final owner = Loan.fromJson({...loanJson(), 'approvalLevel': 2});
    expect(owner.waitingOwner, isTrue);

    final l = Loan.fromJson(loanCashRepaymentJson(rowActions: const ['approve', 'reject', 'bogus']));
    expect((l.submitterRole, l.repayableAmount, l.repaymentNeedsApproval), ('finance', 110000000, true));
    final r = l.repayments.first;
    expect((r.status, r.approvalLevel, r.plannedDate), (LoanRepaymentStatus.pendingApproval, 2, '2026-10-30'));
    expect((r.posted, r.open), (false, true));
    expect(r.allowedActions, {LoanRepaymentAction.approve, LoanRepaymentAction.reject});
    expect((r.decisions.single.level, r.decisions.single.levelLabel), (1, 'Direktur'));
    final rejected = l.repayments.last;
    expect((rejected.status, rejected.status.closed), (LoanRepaymentStatus.rejected, true));
    expect(rejected.rejectReason, 'Saldo belum cukup');
    expect(LoanRepaymentStatus.fromCode(null), LoanRepaymentStatus.posted, reason: 'older rows without a code');
    expect(LoanRepaymentStatus.fromCode('on_hold'), LoanRepaymentStatus.pendingApproval, reason: 'never as paid');
    expect(LoanRepaymentAction.fromCode('void'), LoanRepaymentAction.voidRepayment);
    expect(Loan.fromJson(loanAwaitingJson()).decisions.map((d) => d.level), [1, 2]);
  });

  test('2026-10-24: inbox with repayment requests (older server: loans only) and the transfer orders', () {
    final inbox = LoanInbox.fromJson(loanInboxJson());
    expect((inbox.loans.single.approvalLevel, inbox.repayments.single.loanId, inbox.count), (2, 45, 2));
    final rq = inbox.repayments.single;
    expect((rq.amount, rq.plannedDate, rq.approvalLevel), (40000000, '2026-10-30', 1));
    expect(rq.submittedBy?.name, 'Fina Keuangan');
    expect(rq.borrower.label, 'PRJ-B Jalan Tambang Blok B');
    expect((rq.lender?.label, rq.loanDocNo), ('PRJ-A Gudang Balikpapan', 'PJ/DRMS/2610/0009'));
    final older = LoanInbox.fromJson({
      'items': [loanJson()],
    });
    expect((older.loans.length, older.repayments.length, older.count), (1, 0, 1));

    final orders = LoanTransferOrders.fromJson(loanTransferOrdersJson()).items;
    expect(orders.map((o) => o.key), ['loan-43', 'repayment-7']);
    final loan = orders.first;
    expect((loan.repayment, loan.loanId, loan.amount), (false, 43, 150000000));
    expect((loan.minDate, loan.today), ('2026-10-05', '2026-10-21'));
    expect((loan.fromAccount?.label, loan.toAccount?.label), ('Bank Mandiri Operasional', 'Bank BRI Blok B'));
    expect((loan.selfSubmitted, loan.canExecute), (true, true));
    final rep = orders.last;
    expect((rep.repayment, rep.id, rep.loanId), (true, 7, 45));
    expect((rep.fromProject?.label, rep.note), ('PRJ-B Jalan Tambang Blok B', 'Termin klien B cair'));
    expect(LoanTransferOrders.fromJson(const {}).items, isEmpty);
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
