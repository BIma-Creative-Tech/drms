import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/approvals/presentation/inbox_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/loans/domain/loan.dart';
import 'package:proyekkas/features/loans/presentation/loan_providers.dart';
import 'package:proyekkas/features/loans/presentation/loan_screens.dart';
import 'package:proyekkas/features/loans/presentation/loan_transfer_orders.dart';
import 'package:proyekkas/features/projects/application/projects_providers.dart';
import 'package:proyekkas/features/projects/presentation/project_detail_screen.dart';

import '../support/d1010_c_fixtures.dart' show FakeProjectsApi;

import '../support/d1010_d_loans_fixtures.dart';
import '../support/widget_harness.dart';

/// ADR 0022 APK: project "Pinjaman" tab, PM Draft form + submit/cancel, Direktur decision bar, inbox section. User
/// decision 2026-10-24: Owner level, repayment requests (row actions), inbox repayments, Antrian Transfer orders.
AuthSignedIn _as(Set<Role> roles) => AuthSignedIn(profile: profile(roles), sub: 'user-sub-1');

Loan _loan(Map<String, dynamic> j) => Loan.fromJson(j);

void main() {
  testWidgets('project screen: fourth tab "Pinjaman" for the PM', (tester) async {
    final overrides = [
      projectsApiProvider.overrideWithValue(FakeProjectsApi()),
      loanOptionsProvider.overrideWith((ref) async => loanOptionsFixture()),
      projectLoansProvider.overrideWith((ref, id) async => LoanPage(items: [_loan(loanJson())])),
    ];
    await pumpScreen(tester, const ProjectDetailScreen(id: 10), auth: _as({Role.pm}), overrides: overrides);
    expect(find.byKey(const Key('tab-project-loans')), findsOneWidget);
    await tester.tap(find.byKey(const Key('tab-project-loans')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('loan-41')), findsOneWidget);
    expect(find.byKey(const Key('loan-new')), findsOneWidget);
  });

  testWidgets('project screen: no "Pinjaman" tab for Staff', (tester) async {
    await pumpScreen(
      tester,
      const ProjectDetailScreen(id: 10),
      auth: _as({Role.staff}),
      overrides: [projectsApiProvider.overrideWithValue(FakeProjectsApi())],
    );
    expect(find.byKey(const Key('tab-project-requests')), findsOneWidget);
    expect(find.byKey(const Key('tab-project-loans')), findsNothing);
  });

  testWidgets('project tab: loans as lender and borrower, overdue chip, "Ajukan pinjaman" for the borrower PM', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      const Scaffold(body: ProjectLoansTab(projectId: 10)),
      auth: _as({Role.pm}),
      overrides: [
        loanOptionsProvider.overrideWith((ref) async => loanOptionsFixture()),
        projectLoansProvider.overrideWith(
          (ref, id) async => LoanPage(items: [_loan(loanApprovedJson()), _loan(loanJson())]),
        ),
      ],
    );
    expect(find.byKey(const Key('loan-new')), findsOneWidget);
    expect(find.text('Ajukan pinjaman'), findsOneWidget);
    expect(find.text('PRJ-A Gudang Balikpapan → PRJ-B Jalan Tambang Blok B'), findsNWidgets(2));
    expect(find.text('Meminjam'), findsNWidgets(2), reason: 'project 10 is the borrower');
    expect(find.text('Terlambat · 6 hari'), findsOneWidget);
    expect(find.text('Sebagian kembali'), findsOneWidget);
    expect(find.text('Menunggu persetujuan Direktur'), findsOneWidget);
    expect(find.textContaining('Sisa Rp 100.000.000'), findsOneWidget);
  });

  testWidgets('project tab: lender view and empty list without the create button', (tester) async {
    await pumpScreen(
      tester,
      const Scaffold(body: ProjectLoansTab(projectId: 9)),
      auth: _as({Role.owner}),
      overrides: [
        loanOptionsProvider.overrideWith((ref) async => const LoanOptions()),
        projectLoansProvider.overrideWith((ref, id) async => LoanPage(items: [_loan(loanJson())])),
      ],
    );
    expect(find.byKey(const Key('loan-new')), findsNothing);
    expect(find.text('Meminjamkan'), findsOneWidget);
  });

  testWidgets('project tab: empty text', (tester) async {
    await pumpScreen(
      tester,
      const Scaffold(body: ProjectLoansTab(projectId: 9)),
      auth: _as({Role.finance}),
      overrides: [
        loanOptionsProvider.overrideWith((ref) async => const LoanOptions()),
        projectLoansProvider.overrideWith((ref, id) async => const LoanPage(items: [])),
      ],
    );
    expect(find.text('Belum ada pinjaman antar project.'), findsOneWidget);
  });

  testWidgets('form: validation messages, then "Ajukan ke Direktur" confirmed creates with submit', (tester) async {
    final api = FakeLoansApi();
    await pumpScreen(
      tester,
      const LoanFormScreen(projectId: 10),
      auth: _as({Role.pm}),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanOptionsProvider.overrideWith((ref) async => loanOptionsFixture()),
      ],
    );
    expect(find.byKey(const Key('loan-borrower-fixed')), findsOneWidget);
    expect(find.text('PRJ-B Jalan Tambang Blok B'), findsOneWidget);
    await tester.tap(find.byKey(const Key('loan-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Project pemberi pinjaman wajib dipilih.'), findsOneWidget);
    expect(find.text('Nilai pinjaman wajib diisi (bilangan bulat Rupiah > 0).'), findsOneWidget);
    expect(find.text('Alasan wajib diisi (min. 3 karakter).'), findsOneWidget);
    expect(find.text('Jatuh tempo wajib diisi.'), findsOneWidget);
    expect(api.calls, isEmpty);

    // lender options: same PT, never the borrower itself
    await tester.tap(find.byKey(const ValueKey('loan-lender-10')));
    await tester.pumpAndSettle();
    expect(find.text('LAS-1 Proyek PT lain'), findsNothing);
    await tester.tap(find.text('PRJ-A Gudang Balikpapan').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Barang/material'));
    await tester.enterText(find.byKey(const Key('loan-amount')), '150000000');
    await tester.enterText(find.byKey(const Key('loan-reason')), 'Semen dari gudang A dipakai di B');
    await tester.tap(find.byKey(const Key('loan-due-date')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(MaterialLocalizations.of(tester.element(find.byType(DatePickerDialog))).okButtonLabel));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('loan-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Ajukan pinjaman?'), findsOneWidget);
    expect(
      find.text('Nomor PJ diberikan dan Direktur diberi tahu. Isi pinjaman tidak dapat diubah lagi.'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('loan-submit-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls.single, startsWith('create:10:9:barang:150000000:'));
    expect(api.calls.single, endsWith(':true'));
  });

  testWidgets('form: a user who is no PM of any project gets the notice', (tester) async {
    await pumpScreen(
      tester,
      const LoanFormScreen(),
      auth: _as({Role.finance}),
      overrides: [loanOptionsProvider.overrideWith((ref) async => const LoanOptions())],
    );
    expect(find.byKey(const Key('loan-no-borrower')), findsOneWidget);
  });

  testWidgets('detail PM draft: submit (confirmed) and cancel (reason required); no decision bar', (tester) async {
    final api = FakeLoansApi();
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 41),
      auth: _as({Role.pm}),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanDetailProvider.overrideWith(
          (ref, id) async => _loan(loanJson(status: 'draft', actions: ['edit', 'submit', 'cancel'])),
        ),
      ],
    );
    expect(find.text('Draft #41'), findsWidgets);
    expect(find.byKey(const Key('loan-action-approve')), findsNothing);
    expect(find.byKey(const Key('loan-action-edit')), findsOneWidget);
    expect(find.text('Rp 150.000.000'), findsOneWidget);
    expect(find.byKey(const Key('loan-outstanding-value')), findsNothing, reason: 'nothing owed before approval');
    await tester.tap(find.byKey(const Key('loan-action-submit')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('loan-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, ['submit:41']);
    await tester.tap(find.byKey(const Key('loan-action-cancel')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('loan-reason-ok')));
    await tester.pumpAndSettle();
    expect(find.text('Wajib diisi (minimal 3 karakter).'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('loan-reason-field')), 'Tidak jadi');
    await tester.tap(find.byKey(const Key('loan-reason-ok')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'cancel:41:Tidak jadi');
  });

  testWidgets('detail Direktur: decision bar Setujui (confirm text) and Tolak (reason)', (tester) async {
    final api = FakeLoansApi();
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 41),
      auth: _as({Role.owner}),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanDetailProvider.overrideWith(
          (ref, id) async =>
              _loan(loanJson(actions: ['approve', 'reject'], g1Note: 'Pembuat adalah satu-satunya Direktur PT.')),
        ),
      ],
    );
    expect(find.byKey(const Key('loan-action-approve')), findsOneWidget);
    expect(find.byKey(const Key('loan-action-reject')), findsOneWidget);
    expect(find.byKey(const Key('loan-g1-note')), findsOneWidget);
    expect(find.text('Menunggu'), findsOneWidget, reason: 'Direktur step waiting');
    await tester.tap(find.byKey(const Key('loan-action-approve')));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const Key('loan-decision-step'))).data, 'Persetujuan Direktur');
    expect(find.byKey(const Key('loan-step-owner')), findsOneWidget, reason: 'the Owner decides after the Direktur');
    expect(find.text('Setujui PJ/DRMS/2610/0001?'), findsOneWidget);
    expect(
      find.text(
        'PRJ-B Jalan Tambang Blok B meminjam Rp 150.000.000 dari PRJ-A Gudang Balikpapan. Persetujuan Direktur lalu '
        'Owner; untuk dana, Finance kemudian mentransfer lewat Antrian Transfer: kas keluar dari pusat biaya pemberi '
        'dan kas masuk ke pusat biaya peminjam.',
      ),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('loan-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, ['approve:41']);
    await tester.tap(find.byKey(const Key('loan-action-reject')));
    await tester.pumpAndSettle();
    expect(find.text('Alasan penolakan dikirim ke PM peminjam.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('loan-reason-field')), 'Pakai kas umum');
    await tester.tap(find.byKey(const Key('loan-reason-ok')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'reject:41:Pakai kas umum');
  });

  testWidgets('detail approved: repayments (void struck), overdue, same PM note; no repay / void without the rights', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 42),
      auth: _as({Role.pm}),
      overrides: [loanDetailProvider.overrideWith((ref, id) async => _loan(loanApprovedJson()))],
    );
    expect(find.text('Terlambat · 6 hari'), findsOneWidget);
    expect(find.byKey(const Key('loan-same-pm')), findsOneWidget);
    expect(find.text('PM peminjam = PM pemberi'), findsOneWidget);
    expect(find.text('Pengembalian ke-1'), findsOneWidget);
    expect(find.text('Dibatalkan (void): Salah nominal'), findsOneWidget);
    // phase 3 (user 2026-10-19): recorded on the APK — only when the server allows it (`repay`, `mayVoidRepayment`)
    expect(find.text('Pengembalian dicatat di web oleh PM peminjam atau Finance.'), findsNothing);
    expect(find.byKey(const Key('loan-action-repay')), findsNothing);
    expect(find.widgetWithText(TextButton, 'Void'), findsNothing);
    expect(find.textContaining('Dedi Direktur'), findsOneWidget);
    expect(find.byKey(const Key('loan-action-approve')), findsNothing);
  });

  testWidgets('detail Owner (level 2): Direktur step done, Owner step waiting, decision bar "Persetujuan Owner"', (
    tester,
  ) async {
    final api = FakeLoansApi();
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 41),
      auth: _as({Role.principal, Role.owner}),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanDetailProvider.overrideWith(
          (ref, id) async => _loan({
            ...loanJson(actions: ['approve', 'reject'], decisions: [levelDecisionJson(1)]),
            'approvalLevel': 2,
            'statusLabel': 'Menunggu persetujuan Owner',
            'submitterRole': 'finance',
          }),
        ),
      ],
    );
    expect(find.text('Menunggu persetujuan Owner'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('loan-decision-step'))).data, 'Persetujuan Owner');
    expect(find.text('Diajukan Finance'), findsOneWidget);
    expect(find.textContaining('Dedi Direktur'), findsOneWidget, reason: 'the Direktur approved level 1');
    expect(find.text('Menunggu'), findsOneWidget, reason: 'only the Owner step waits');
    await tester.tap(find.byKey(const Key('loan-action-approve')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('loan-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, ['approve:41']);
  });

  testWidgets('detail Finance: no "Cairkan" any more — "Buka Antrian Transfer", no call', (tester) async {
    final api = FakeLoansApi();
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 43),
      auth: _as({Role.finance}),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanDetailProvider.overrideWith((ref, id) async => _loan(loanAwaitingJson())),
      ],
    );
    expect(find.text('Disetujui – menunggu transfer Finance'), findsWidgets);
    expect(
      tester.widget<Text>(find.byKey(const Key('loan-cash-value'))).data,
      'Menunggu transfer Finance (Antrian Transfer)',
    );
    expect(tester.widget<Text>(find.byKey(const Key('loan-lender-pb-value'))).data, 'Bank Mandiri Operasional');
    expect(tester.widget<Text>(find.byKey(const Key('loan-borrower-pb-value'))).data, 'Bank BRI Blok B');
    expect(find.byKey(const Key('loan-awaiting-disbursement')), findsOneWidget);
    expect(find.byKey(const Key('loan-step-owner')), findsOneWidget);
    expect(find.byKey(const Key('loan-step-disburse')), findsOneWidget);
    expect(find.text('Transfer Finance'), findsOneWidget);
    expect(find.byKey(const Key('loan-action-repay')), findsNothing, reason: 'repay only after the transfer');
    expect(find.text('Cairkan'), findsNothing);
    expect(find.text('Buka Antrian Transfer'), findsOneWidget);
    await tester.tap(find.byKey(const Key('loan-action-disburse')));
    await tester.pumpAndSettle();
    expect(api.calls, isEmpty, reason: 'executed in the Antrian Transfer, not on the loan page');
  });

  testWidgets('cash-backed repayment request: "Ajukan pengembalian" with a planned date and the repayable amount', (
    tester,
  ) async {
    final api = FakeLoansApi();
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 45),
      auth: _as({Role.pm}),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanDetailProvider.overrideWith((ref, id) async => _loan(loanCashRepaymentJson())),
      ],
    );
    expect(find.text('Ajukan pengembalian'), findsOneWidget);
    await tester.tap(find.byKey(const Key('loan-action-repay')));
    await tester.pumpAndSettle();
    expect(find.text('Ajukan pengembalian PJ/DRMS/2610/0009'), findsOneWidget);
    expect(find.text('Dapat diajukan Rp 110.000.000'), findsOneWidget);
    expect(find.text('Rencana tanggal pengembalian'), findsOneWidget);
    expect(find.byKey(const Key('loan-repay-request-hint')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('loan-repay-amount')), '120000000');
    await tester.tap(find.byKey(const Key('loan-repay-save')));
    await tester.pumpAndSettle();
    expect(find.text('Nominal melebihi sisa pinjaman.'), findsOneWidget, reason: 'above the repayable amount');
    await tester.enterText(find.byKey(const Key('loan-repay-amount')), '60000000');
    await tester.tap(find.byKey(const Key('loan-repay-save')));
    await tester.pumpAndSettle();
    expect(api.calls, ['repay:45:60000000:2026-10-21:']);
    expect(find.text('Pengembalian Rp 60.000.000 diajukan ke Direktur.'), findsOneWidget);
  });

  testWidgets('repayment requests: status, planned date, decisions, reject reason; Owner approves and rejects', (
    tester,
  ) async {
    final api = FakeLoansApi();
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 45),
      auth: _as({Role.principal, Role.owner}),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanDetailProvider.overrideWith(
          (ref, id) async => _loan(loanCashRepaymentJson(actions: const [], rowActions: const ['approve', 'reject'])),
        ),
      ],
    );
    expect(tester.widget<Text>(find.byKey(const Key('loan-repayment-status-7'))).data, 'Menunggu persetujuan Owner');
    expect(find.textContaining('rencana 30'), findsOneWidget);
    expect(find.textContaining('diajukan Fina Keuangan'), findsNWidgets(2));
    expect(
      tester.widget<Text>(find.byKey(const Key('loan-repayment-7-decision-1'))).data,
      startsWith('Direktur · Disetujui'),
    );
    expect(tester.widget<Text>(find.byKey(const Key('loan-repayment-rejected-8'))).data, 'Ditolak: Saldo belum cukup');
    expect(find.byKey(const Key('loan-repayment-8-approve')), findsNothing);
    expect(find.byKey(const Key('loan-repayment-7-void')), findsNothing);

    await tester.tap(find.byKey(const Key('loan-repayment-7-approve')));
    await tester.pumpAndSettle();
    expect(find.text('Setujui pengembalian Rp 40.000.000?'), findsOneWidget);
    await tester.tap(find.byKey(const Key('loan-repayment-approve-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, ['approve-repayment:45:7']);

    await tester.tap(find.byKey(const Key('loan-repayment-7-reject')));
    await tester.pumpAndSettle();
    expect(find.text('Tolak pengembalian Rp 40.000.000?'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('loan-repayment-reject-field')), 'Tunggu termin');
    await tester.tap(find.byKey(const Key('loan-repayment-reject-ok')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'reject-repayment:45:7:Tunggu termin');
  });

  testWidgets('repayment request: the submitter cancels (reason); Finance sees "Buka Antrian Transfer" once approved', (
    tester,
  ) async {
    final api = FakeLoansApi();
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 45),
      auth: _as({Role.finance}),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanDetailProvider.overrideWith(
          (ref, id) async =>
              _loan(loanCashRepaymentJson(rowActions: const ['cancel', 'execute'], repaymentStatus: 'approved')),
        ),
      ],
    );
    expect(
      tester.widget<Text>(find.byKey(const Key('loan-repayment-status-7'))).data,
      'Disetujui – menunggu transfer Finance',
    );
    await tester.tap(find.byKey(const Key('loan-repayment-7-execute')));
    await tester.pumpAndSettle();
    expect(api.calls, isEmpty, reason: 'executed in the Antrian Transfer');
    await tester.tap(find.byKey(const Key('loan-repayment-7-cancel')));
    await tester.pumpAndSettle();
    expect(find.text('Batalkan pengembalian Rp 40.000.000?'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('loan-repayment-cancel-field')), 'Salah nominal');
    await tester.tap(find.byKey(const Key('loan-repayment-cancel-ok')));
    await tester.pumpAndSettle();
    expect(api.calls, ['cancel-repayment:45:7:Salah nominal']);
  });

  testWidgets('Antrian Transfer: loan orders — self note, execute (date, note), overdraft → re-sent confirmed', (
    tester,
  ) async {
    final api = FakeLoansApi()..overdraftFirst = true;
    await pumpScreen(
      tester,
      Scaffold(body: ListView(children: const [LoanTransferOrderSection()])),
      auth: _as({Role.finance}),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanTransferOrdersProvider.overrideWith((ref) async => LoanTransferOrders.fromJson(loanTransferOrdersJson())),
      ],
    );
    expect(find.text('Transfer pinjaman antar project (2)'), findsOneWidget);
    expect(find.text('Pencairan pinjaman'), findsOneWidget);
    expect(find.text('Pengembalian pinjaman'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('loan-order-loan-43-accounts'))).data,
      'Bank Mandiri Operasional → Bank BRI Blok B',
    );
    expect(find.byKey(const Key('loan-order-loan-43-self')), findsOneWidget);
    expect(find.byKey(const Key('loan-order-repayment-7-self')), findsNothing);

    await tester.tap(find.byKey(const Key('loan-order-loan-43-execute')));
    await tester.pumpAndSettle();
    expect(find.text('Catat transfer PJ/DRMS/2610/0004'), findsOneWidget);
    expect(find.byKey(const Key('loan-order-execute-body')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('loan-order-execute-note')), 'BCA ref 123');
    await tester.tap(find.byKey(const Key('loan-order-execute-save')));
    await tester.pumpAndSettle();
    expect(find.text('Saldo akun kas akan minus'), findsOneWidget);
    await tester.tap(find.byKey(const Key('loan-override-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, ['execute:43:2026-10-21:BCA ref 123', 'execute:43:2026-10-21:BCA ref 123:confirm']);
    expect(api.keys.first, isNot(api.keys.last), reason: 'another body, another key');
    expect(find.text('Transfer PJ/DRMS/2610/0004 tercatat.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('loan-order-repayment-7-execute')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('loan-order-execute-save')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'execute-repayment:45:7:2026-10-21');
  });

  testWidgets('Antrian Transfer: read-only orders without "Catat transfer"; hidden when empty', (tester) async {
    await pumpScreen(
      tester,
      Scaffold(body: ListView(children: const [LoanTransferOrderSection()])),
      auth: _as({Role.owner}),
      overrides: [
        loanTransferOrdersProvider.overrideWith(
          (ref) async => LoanTransferOrders.fromJson(loanTransferOrdersJson(canExecute: false)),
        ),
      ],
    );
    expect(find.byKey(const Key('loan-transfer-orders')), findsOneWidget);
    expect(find.byKey(const Key('loan-order-loan-43-execute')), findsNothing);
  });

  testWidgets('ADR 0031 detail: automatic loan of a transfer — lender account, origin, cash numbers, one step', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 44),
      auth: _as({Role.finance}),
      overrides: [loanDetailProvider.overrideWith((ref, id) async => _loan(loanAutoJson()))],
    );
    expect(find.text('Akun Kas Kecil → PRJ-B Jalan Tambang Blok B'), findsOneWidget);
    expect(find.text('Akun pemberi pinjaman'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('loan-lender-value'))).data, 'Akun Kas Kecil');
    expect(find.byKey(const Key('loan-lender-pb-value')), findsNothing, reason: 'the account itself lends');
    expect(
      tester.widget<Text>(find.byKey(const Key('loan-origin-value'))).data,
      'Otomatis (transfer) · transfer TRF/DRMS/2610/0012',
    );
    expect(tester.widget<Text>(find.byKey(const Key('loan-cash-value'))).data, startsWith('Dicairkan '));
    expect(
      tester.widget<Text>(find.byKey(const Key('loan-cash-value'))).data,
      endsWith(' · KK KK/DRMS/2610/0021 · KM KM/DRMS/2610/0022'),
    );
    expect(find.byKey(const Key('loan-step-transfer')), findsOneWidget);
    expect(find.text('Otomatis dari transfer TRF/DRMS/2610/0012'), findsOneWidget);
    expect(find.byKey(const Key('loan-step-direktur')), findsNothing);
    expect(
      tester.widget<Text>(find.byKey(const Key('loan-repayment-cash-1'))).data,
      'KK KK/DRMS/2610/0031 · KM KM/DRMS/2610/0032',
    );
  });

  testWidgets('ADR 0031 repayment of a cash-backed loan: overdraft 409 → "Tetap simpan" → re-sent confirmed', (
    tester,
  ) async {
    final api = FakeLoansApi()..overdraftFirst = true;
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 44),
      auth: _as({Role.finance}),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanDetailProvider.overrideWith((ref, id) async => _loan(loanAutoJson(actions: ['repay']))),
      ],
    );
    await tester.tap(find.byKey(const Key('loan-action-repay')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('loan-repay-save')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('loan-override-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, ['repay:44:100000000:2026-10-21:', 'repay:44:100000000:2026-10-21::confirm']);
    expect(api.keys.first, isNot(api.keys.last));
  });

  testWidgets('offline: decision buttons disabled with "Butuh koneksi internet"', (tester) async {
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 41),
      auth: _as({Role.owner}),
      online: false,
      overrides: [
        loanDetailProvider.overrideWith((ref, id) async => _loan(loanJson(actions: ['approve', 'reject']))),
      ],
    );
    expect(find.text('Butuh koneksi internet'), findsNWidgets(2));
  });

  testWidgets('Direktur inbox: loan section (items, empty text)', (tester) async {
    await pumpScreen(
      tester,
      const InboxScreen(),
      auth: _as({Role.owner}),
      overrides: [
        inboxProvider.overrideWith((ref) async => const InboxPage([], 85)),
        loanInboxProvider.overrideWith((ref) async => LoanInbox(loans: [_loan(loanJson())])),
      ],
    );
    expect(find.byKey(const Key('loan-inbox')), findsOneWidget);
    expect(find.text('Pinjaman antar project (1)'), findsOneWidget);
    expect(find.byKey(const Key('loan-41')), findsOneWidget);
  });

  testWidgets('Owner inbox: loans at level 2 and repayment requests', (tester) async {
    await pumpScreen(
      tester,
      const InboxScreen(),
      auth: _as({Role.principal}),
      overrides: [
        inboxProvider.overrideWith((ref) async => const InboxPage([], 85)),
        loanInboxProvider.overrideWith((ref) async => LoanInbox.fromJson(loanInboxJson())),
      ],
    );
    expect(find.text('Pinjaman antar project (2)'), findsOneWidget);
    expect(find.text('Menunggu persetujuan Owner'), findsOneWidget);
    expect(find.byKey(const Key('loan-repayment-inbox-7')), findsOneWidget);
    expect(find.text('Pengembalian pinjaman PJ/DRMS/2610/0009'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('loan-repayment-inbox-flow-7'))).data,
      'PRJ-B Jalan Tambang Blok B → PRJ-A Gudang Balikpapan',
    );
    expect(find.text('Menunggu persetujuan Direktur'), findsOneWidget);
  });

  testWidgets('Direktur inbox: empty loan text', (tester) async {
    await pumpScreen(
      tester,
      const InboxScreen(),
      auth: _as({Role.owner}),
      overrides: [
        inboxProvider.overrideWith((ref) async => const InboxPage([], 85)),
        loanInboxProvider.overrideWith((ref) async => const LoanInbox()),
      ],
    );
    expect(find.text('Tidak ada pinjaman antar project yang menunggu keputusan Anda.'), findsOneWidget);
  });

  testWidgets('PM inbox: no loan section', (tester) async {
    await pumpScreen(
      tester,
      const InboxScreen(),
      auth: _as({Role.pm}),
      overrides: [
        inboxProvider.overrideWith((ref) async => const InboxPage([], 85)),
        loanInboxProvider.overrideWith((ref) async => const LoanInbox()),
      ],
    );
    expect(find.byKey(const Key('loan-inbox')), findsNothing);
  });
}
