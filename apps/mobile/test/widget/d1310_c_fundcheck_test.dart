import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/approvals/presentation/decision_sheet.dart';
import 'package:proyekkas/features/approvals/presentation/inbox_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/finance/application/finance_providers.dart';
import 'package:proyekkas/features/finance/domain/transfer_queue.dart';
import 'package:proyekkas/features/finance/presentation/finance_screen.dart';
import 'package:proyekkas/features/loans/data/intercompany_loans_api.dart';
import 'package:proyekkas/features/loans/domain/intercompany_loan.dart';
import 'package:proyekkas/features/loans/presentation/intercompany_loan_providers.dart';
import 'package:proyekkas/features/loans/presentation/intercompany_loan_screens.dart';

import '../support/d1010_c_fixtures.dart';
import '../support/d1310_c_fixtures.dart';
import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/widget_harness.dart';

/// DRMS 13/10 Phase C (ADR 0029) on the APK: the Owner's shortfall panel on the request detail and in the decision
/// sheet (Setujui disabled with the reason, the 409 on a race), the inbox badge "Dana kurang", the loan instruction
/// form, the read-only loan detail, Finance's disbursement section and form. Fictional PTs and numbers.

final _png = Uint8List.fromList(
  base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
);

AuthSignedIn _owner() => AuthSignedIn(profile: profile(Role.effective({Role.principal})), sub: 's');

AuthSignedIn _financeWith({bool disburse = true}) {
  final p = profile(const {Role.finance});
  return AuthSignedIn(
    profile: p.copyWith(capabilities: p.capabilities.copyWith(disburseIntercompanyLoan: disburse)),
    sub: 's',
  );
}

Finder _button(String key) => find.descendant(of: find.byKey(Key(key)), matching: find.bySubtype<ButtonStyleButton>());

VoidCallback? _onPressed(WidgetTester tester, Finder f) => tester.widget<ButtonStyleButton>(f).onPressed;

String? _text(WidgetTester tester, String key) => tester.widget<Text>(find.byKey(Key(key))).data;

/// Approvals API whose decision is refused with 409 FUND_INSUFFICIENT (the PT's funds dropped meanwhile).
class _ShortApprovalsApi extends ApprovalsApi {
  _ShortApprovalsApi() : super(testClient('http://127.0.0.1:9', StaticTokens()));
  var decisions = 0;

  @override
  Future<int> uploadSignature(Uint8List png) async => 1;

  @override
  Future<ExpenseDetail> decide(
    int requestId,
    Decision decision, {
    required String idempotencyKey,
    int? signatureMediaId,
    String? reason,
  }) async {
    decisions++;
    throw ProblemException.fromJson(409, fundInsufficientProblem());
  }
}

class _FakeLoansApi extends Fake implements IntercompanyLoansApi {
  final instructed = <({Map<String, dynamic> body, String key})>[];
  final disbursed = <({int id, Map<String, dynamic> body, String key})>[];

  /// Problems to answer first (instruction / disbursement).
  final refuse = <ProblemException>[];

  @override
  Future<IcLoan> instruct(Map<String, dynamic> body, {required String idempotencyKey}) async {
    instructed.add((body: body, key: idempotencyKey));
    if (refuse.isNotEmpty) throw refuse.removeAt(0);
    return IcLoan.fromJson(icLoanDetailJson());
  }

  @override
  Future<IcLoan> disburse(int id, Map<String, dynamic> body, {required String idempotencyKey}) async {
    disbursed.add((id: id, body: body, key: idempotencyKey));
    if (refuse.isNotEmpty) throw refuse.removeAt(0);
    return IcLoan.fromJson(icLoanDetailJson(status: 'disbursed'));
  }
}

/// The lender's accounts: a head-office bank account and a site petty-cash account (not in the fund pool).
class _LenderFinanceApi extends FakeFinanceApi {
  @override
  Future<List<CashAccountOption>> cashAccounts(int? companyId) async => const [
    CashAccountOption(id: 3, name: 'Bank Operasional LAS', companyId: 2, balance: 4000000),
    CashAccountOption(id: 4, name: 'Kas Kecil Site', companyId: 2, balance: 1500000, siteId: 7),
  ];
}

void main() {
  group('request detail — Owner shortfall panel', () {
    testWidgets('blocked: figures, commitments, linked loan, Setujui disabled with the reason, Tolak and the loan '
        'action stay', (tester) async {
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        auth: _owner(),
        overrides: [
          requestDetailProvider(42).overrideWith((ref) async => detailFromJson(fundDetailJson())),
          receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(find.byKey(const Key('fund-check')), findsOneWidget);
      expect(_text(tester, 'fund-title'), 'Ketersediaan dana PT DRMS');
      expect(
        _text(tester, 'fund-balance'),
        'Rp 5.000.000 (2 akun, tanpa akun site — 1 akun site Rp 750.000 tidak dihitung)',
      );
      expect(_text(tester, 'fund-commitments'), '− Rp 4.000.000');
      expect(_text(tester, 'fund-available'), 'Rp 1.000.000');
      expect(_text(tester, 'fund-needed'), 'Rp 1.447.500');
      expect(_text(tester, 'fund-gap'), 'Kurang Rp 447.500');
      expect(find.byKey(const Key('fund-waiting')), findsOneWidget);
      expect(_text(tester, 'fund-loan-77'), 'PJA/LAS/2610/0002 · LAS · Rp 500.000 · Menunggu pencairan');
      expect(
        _text(tester, 'fund-blocked-text'),
        'Dana PT tidak cukup — kurang Rp 447.500. Tolak, atau perintahkan pinjaman antar-PT.',
      );
      expect(find.byKey(const Key('fund-not-enabled')), findsNothing);
      expect(find.byKey(const Key('fund-not-final')), findsNothing);

      // commitment list (expandable)
      expect(find.byKey(const Key('fund-commitment-loan-5')), findsNothing);
      await tester.tap(find.byKey(const Key('fund-commitment-list')));
      await tester.pumpAndSettle();
      expect(
        _text(tester, 'fund-commitment-loan-5'),
        'PJA/DRMS/2610/0001 · Rp 1.000.000 · Perintah pinjaman (PT ini pemberi), belum dicairkan',
      );

      // decision bar: Setujui disabled with the reason, Tolak enabled
      expect(find.byKey(const Key('decision-blocked-text')), findsOneWidget);
      expect(_onPressed(tester, find.byKey(const Key('action-approve'))), isNull);
      expect(_onPressed(tester, find.byKey(const Key('action-reject'))), isNotNull);
      // instruct_loan → "Perintahkan pinjaman antar-PT"
      expect(find.byKey(const Key('fund-instruct-loan')), findsOneWidget);
    });

    testWidgets('Direktur before the Owner level: read-only panel ("cek akhir di Owner"), Setujui enabled, no loan '
        'action', (tester) async {
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        auth: AuthSignedIn(profile: profile(const {Role.owner}), sub: 's'),
        overrides: [
          requestDetailProvider(42).overrideWith(
            (ref) async => detailFromJson(
              fundDetailJson(
                allowed: const ['approve', 'reject'],
                fundCheck: fundCheckJson(blocked: false, applies: false),
              ),
            ),
          ),
          receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(find.byKey(const Key('fund-not-final')), findsOneWidget);
      expect(_text(tester, 'fund-gap'), 'Kurang Rp 447.500');
      expect(find.byKey(const Key('fund-blocked-text')), findsNothing);
      expect(find.byKey(const Key('decision-blocked-text')), findsNothing);
      expect(find.byKey(const Key('fund-instruct-loan')), findsNothing);
      expect(_onPressed(tester, find.byKey(const Key('action-approve'))), isNotNull);
    });

    testWidgets('PT with the check off: "informasi saja", nothing blocked', (tester) async {
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        auth: _owner(),
        overrides: [
          requestDetailProvider(42).overrideWith(
            (ref) async => detailFromJson(
              fundDetailJson(
                allowed: const ['approve', 'reject'],
                fundCheck: fundCheckJson(blocked: false, enabled: false),
              ),
            ),
          ),
          receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(find.byKey(const Key('fund-not-enabled')), findsOneWidget);
      expect(_onPressed(tester, find.byKey(const Key('action-approve'))), isNotNull);
    });

    testWidgets('no fundCheck (Staff, older server): no panel', (tester) async {
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        auth: AuthSignedIn(profile: profile(const {Role.owner}), sub: 's'),
        overrides: [
          requestDetailProvider(42).overrideWith((ref) async => detailFromJson(detailJson())),
          receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(find.byKey(const Key('fund-check')), findsNothing);
    });
  });

  group('decision sheet', () {
    testWidgets('blocked: the panel (compact) and "Setujui" disabled', (tester) async {
      final d = detailFromJson(fundDetailJson());
      await pumpScreen(
        tester,
        Scaffold(
          body: DecisionSheet(detail: d, decision: Decision.approve),
        ),
        auth: _owner(),
      );
      expect(find.byKey(const Key('fund-check')), findsOneWidget);
      expect(find.byKey(const Key('fund-blocked-text')), findsOneWidget);
      expect(find.byKey(const Key('fund-commitment-list')), findsNothing, reason: 'compact');
      expect(_onPressed(tester, _button('decision-confirm')), isNull);
    });

    testWidgets('blocked: "Tolak" stays possible', (tester) async {
      await pumpScreen(
        tester,
        Scaffold(
          body: DecisionSheet(detail: detailFromJson(fundDetailJson()), decision: Decision.reject),
        ),
        auth: _owner(),
      );
      expect(find.byKey(const Key('fund-check')), findsOneWidget);
      expect(_onPressed(tester, _button('decision-confirm')), isNotNull);
    });

    testWidgets('race: the funds dropped after loading → the 409 FUND_INSUFFICIENT in Indonesian', (tester) async {
      final api = _ShortApprovalsApi();
      final d = detailFromJson(
        fundDetailJson(
          allowed: const ['approve', 'reject'],
          fundCheck: {...fundCheckJson(blocked: false), 'status': 'ok', 'gap': 0, 'available': 2000000},
        ),
      );
      await pumpScreen(
        tester,
        Scaffold(
          body: DecisionSheet(detail: d, decision: Decision.approve),
        ),
        auth: _owner(),
        overrides: [approvalsApiProvider.overrideWithValue(api)],
      );
      expect(_text(tester, 'fund-gap'), 'Cukup');
      await tester.tap(_button('decision-confirm'));
      await tester.pumpAndSettle();
      expect(api.decisions, 1);
      expect(_text(tester, 'decision-error'), startsWith('Dana PT DRMS tidak cukup: tersedia Rp 1.000.000'));
    });
  });

  testWidgets('approval inbox: badge "Dana kurang Rp X" from fundShort', (tester) async {
    final row = (inboxJson()['items'] as List).first as Map<String, dynamic>;
    await pumpScreen(
      tester,
      const InboxScreen(),
      auth: _owner(),
      overrides: [
        inboxProvider.overrideWith(
          (ref) async => InboxPage([
            inboxItemFromJson({...row, 'fundShort': 447500}),
            inboxItemFromJson({...row, 'id': 43, 'docNo': 'PB/DRMS/2610/0013', 'fundShort': null}),
          ], 85),
        ),
        lpjQueueProvider.overrideWith((ref) async => const []),
      ],
    );
    expect(find.byKey(const Key('inbox-fund-short-42')), findsOneWidget);
    expect(find.text('Dana kurang Rp 447.500'), findsOneWidget);
    expect(find.byKey(const Key('inbox-fund-short-43')), findsNothing);
  });

  group('loan instruction (Owner)', () {
    Future<_FakeLoansApi> open(WidgetTester tester, {bool borrowerHasAccount = true, int? amount = 447500}) async {
      final api = _FakeLoansApi();
      await pumpScreen(
        tester,
        IcLoanInstructScreen(borrowerId: 1, amount: amount, requestIds: const [42]),
        auth: _owner(),
        overrides: [
          intercompanyLoansApiProvider.overrideWithValue(api),
          icLenderOptionsProvider.overrideWith(
            (ref, q) async => IcLenderOptions.fromJson(
              icLenderOptionsJson(borrowerHasAccount: borrowerHasAccount, defaultDueDate: '2099-12-31'),
            ),
          ),
        ],
      );
      return api;
    }

    testWidgets('lenders with availability (short PT disabled), amount = gap, due date default, reason required; '
        'submit → POST with the linked request', (tester) async {
      final api = await open(tester);
      expect(find.byKey(const Key('icloan-borrower')), findsOneWidget);
      expect(_text(tester, 'icloan-lender-2-available'), 'Dana tersedia Rp 3.000.000');
      expect(find.byKey(const Key('icloan-lender-2-short')), findsNothing);
      expect(find.byKey(const Key('icloan-lender-3-short')), findsOneWidget);
      expect(find.byKey(const Key('icloan-lender-3-warning')), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(const Key('icloan-amount'))).controller!.text, '447.500');
      expect(_text(tester, 'icloan-due-value'), isNot('-'));
      expect(tester.widget<CheckboxListTile>(find.byKey(const Key('icloan-request-42'))).value, isTrue);
      expect(tester.widget<CheckboxListTile>(find.byKey(const Key('icloan-request-43'))).value, isFalse);

      // nothing picked, no reason → the form's checks, no call
      await tester.tap(_button('icloan-submit'));
      await tester.pumpAndSettle();
      expect(_text(tester, 'icloan-lender-error'), 'Pilih PT pemberi.');
      expect(find.text('Alasan wajib diisi, minimal 3 karakter.'), findsOneWidget);
      expect(api.instructed, isEmpty);

      // the short PT cannot be picked
      await tester.tap(find.byKey(const Key('icloan-lender-3')));
      await tester.pumpAndSettle();
      await tester.tap(_button('icloan-submit'));
      await tester.pumpAndSettle();
      expect(_text(tester, 'icloan-lender-error'), 'Pilih PT pemberi.');

      await tester.tap(find.byKey(const Key('icloan-lender-2')));
      await tester.enterText(find.byKey(const Key('icloan-reason')), 'Menutup kekurangan dana PB/DRMS/2610/0012');
      await tester.pumpAndSettle();
      await tester.tap(_button('icloan-submit'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'PT LAS meminjamkan Rp 447.500 ke PT DRMS. Nilai dicadangkan di PT pemberi sampai Finance-nya '
          'mencairkan.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('icloan-confirm')));
      await tester.pumpAndSettle();
      expect(api.instructed, hasLength(1));
      expect(api.instructed.single.body, {
        'borrowerCompanyId': 1,
        'lenderCompanyId': 2,
        'amount': 447500,
        'dueDate': '2099-12-31',
        'reason': 'Menutup kekurangan dana PB/DRMS/2610/0012',
        'requestIds': [42],
      });
      expect(find.text('Perintah pinjaman PJA/LAS/2610/0002 dikirim ke Finance PT pemberi.'), findsOneWidget);
    });

    testWidgets('"Hitung untuk semua": every waiting request, amount = Σ needed − available', (tester) async {
      await open(tester, amount: null);
      // opened without an amount: the gap of the pre-ticked request
      expect(tester.widget<TextField>(find.byKey(const Key('icloan-amount'))).controller!.text, '447.500');
      await tester.tap(find.byKey(const Key('icloan-calc-all')));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byKey(const Key('icloan-amount'))).controller!.text, '2.947.500');
      expect(tester.widget<CheckboxListTile>(find.byKey(const Key('icloan-request-43'))).value, isTrue);
      // LAS still has enough; above its availability it would be shown short
      await tester.enterText(find.byKey(const Key('icloan-amount')), '3500000');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('icloan-lender-2-short')), findsOneWidget);
    });

    testWidgets('the lender ran short meanwhile: 409 LOAN_LENDER_INSUFFICIENT shown in Indonesian', (tester) async {
      final api = await open(tester);
      api.refuse.add(
        ProblemException.fromJson(409, {
          'title': 'Dana tersedia PT LAS Rp 300.000 — kurang untuk pinjaman Rp 447.500. Pilih PT lain atau kurangi nilainya.',
          'code': 'LOAN_LENDER_INSUFFICIENT',
          'lenderCompanyId': 2,
          'available': 300000,
          'needed': 447500,
          'gap': 147500,
        }),
      );
      await tester.tap(find.byKey(const Key('icloan-lender-2')));
      await tester.enterText(find.byKey(const Key('icloan-reason')), 'Dana proyek');
      await tester.pumpAndSettle();
      await tester.tap(_button('icloan-submit'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('icloan-confirm')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('icloan-error')), findsOneWidget);
      expect(find.textContaining('Dana tersedia PT LAS Rp 300.000 — kurang untuk pinjaman'), findsOneWidget);
    });

    testWidgets('borrower without a receiving account: explained, submit disabled', (tester) async {
      await open(tester, borrowerHasAccount: false);
      expect(find.byKey(const Key('icloan-borrower-no-account')), findsOneWidget);
      expect(_onPressed(tester, _button('icloan-submit')), isNull);
    });
  });

  group('loan detail (read-only)', () {
    testWidgets('disbursed: figures, linked request, movement with KK / KM, "Void pencairan" (server action)', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        const IcLoanDetailScreen(id: 77),
        auth: _owner(),
        overrides: [
          icLoanDetailProvider(77).overrideWith((ref) async => IcLoan.fromJson(icLoanDetailJson(status: 'disbursed'))),
        ],
      );
      expect(_text(tester, 'icloan-flow'), 'PT LAS → PT DRMS');
      expect(_text(tester, 'icloan-amount-value'), 'Rp 500.000');
      expect(_text(tester, 'icloan-outstanding-value'), 'Rp 500.000');
      expect(find.byKey(const Key('icloan-own-request')), findsOneWidget);
      expect(find.byKey(const Key('icloan-request-42')), findsOneWidget);
      expect(_text(tester, 'icloan-movement-301-entries'), 'KK KK/LAS/2610/0004 · KM KM/DRMS/2610/0011');
      // phase 3: the web-only hint is shown only for "Batalkan perintah" (the other actions are on the APK)
      expect(find.byKey(const Key('icloan-web-hint')), findsNothing);
      expect(find.byKey(const Key('icloan-action-disburse')), findsNothing);
      expect(find.byKey(const Key('icloan-action-repay')), findsNothing);
      // phase 3: `void_disbursement` of the server → the movement's "Void pencairan"
      expect(find.byKey(const Key('icloan-movement-301-void')), findsOneWidget);
    });

    testWidgets('instructed, Finance of the lender: "Catat pencairan"', (tester) async {
      await pumpScreen(
        tester,
        const IcLoanDetailScreen(id: 77),
        auth: _financeWith(),
        overrides: [icLoanDetailProvider(77).overrideWith((ref) async => IcLoan.fromJson(icLoanDetailJson()))],
      );
      expect(find.byKey(const Key('icloan-movements-empty')), findsOneWidget);
      expect(find.byKey(const Key('icloan-action-disburse')), findsOneWidget);
      expect(find.byKey(const Key('icloan-outstanding-value')), findsNothing, reason: 'nothing owed yet');
    });

    testWidgets('instructed, the instruction\'s creator (G1): the note instead of the action', (tester) async {
      await pumpScreen(
        tester,
        const IcLoanDetailScreen(id: 77),
        auth: _financeWith(),
        overrides: [icLoanDetailProvider(77).overrideWith((ref) async => IcLoan.fromJson(icLoanDetailJson(g1: true)))],
      );
      expect(find.byKey(const Key('icloan-g1')), findsOneWidget);
      expect(find.byKey(const Key('icloan-action-disburse')), findsNothing);
    });
  });

  group('Finance disbursement', () {
    testWidgets('transfer queue: "Pencairan pinjaman antar-PT" section; G1 card without the button', (tester) async {
      await pumpScreen(
        tester,
        const FinanceScreen(),
        auth: _financeWith(),
        overrides: [
          transferQueueProvider.overrideWith((ref) async => queueFixture()),
          lpjQueueProvider.overrideWith((ref) async => const []),
          icLoanQueueProvider.overrideWith((ref) async => IcLoanQueue.fromJson(icLoanQueueJson())),
        ],
      );
      expect(find.byKey(const Key('icloan-queue')), findsOneWidget);
      expect(find.text('Pencairan pinjaman antar-PT (2)'), findsOneWidget);
      expect(find.byKey(const Key('icloan-q-77-disburse')), findsOneWidget);
      expect(_text(tester, 'icloan-q-77-destination'), 'Rekening tujuan: Mandiri · ••••0123 · PT Contoh Dirgantara');
      expect(find.byKey(const Key('icloan-q-78-disburse')), findsNothing);
      expect(find.byKey(const Key('icloan-q-78-g1')), findsOneWidget);
      expect(find.byKey(const Key('tq-42')), findsOneWidget, reason: 'the request queue stays below');
    });

    testWidgets('no disbursement capability: no section', (tester) async {
      await pumpScreen(
        tester,
        const FinanceScreen(),
        auth: _financeWith(disburse: false),
        overrides: [
          transferQueueProvider.overrideWith((ref) async => queueFixture()),
          lpjQueueProvider.overrideWith((ref) async => const []),
          icLoanQueueProvider.overrideWith((ref) async => IcLoanQueue.fromJson(icLoanQueueJson())),
        ],
      );
      expect(find.byKey(const Key('icloan-queue')), findsNothing);
    });

    testWidgets('form: head-office accounts only, overdraft confirmation, then the KK / KM numbers', (tester) async {
      final loans = _FakeLoansApi()..refuse.add(problem409('CASH_OVERDRAFT_CONFIRM_REQUIRED'));
      final finance = _LenderFinanceApi();
      final loan = IcLoan.fromJson(icLoanDetailJson());
      await pumpScreen(
        tester,
        IcLoanDisburseScreen(
          loan: loan,
          destination: const IcLoanDestination(
            bankName: 'Mandiri',
            accountNoMasked: '••••0123',
            accountHolder: 'PT Contoh Dirgantara',
          ),
        ),
        auth: _financeWith(),
        overrides: [
          intercompanyLoansApiProvider.overrideWithValue(loans),
          financeApiProvider.overrideWithValue(finance),
          photoCompressorProvider.overrideWithValue(FakeCompressor()),
          proofPickerProvider.overrideWithValue((context, {required fromCamera}) async => _png),
        ],
      );
      expect(
        _text(tester, 'icloan-disburse-amount'),
        'Transfer Rp 500.000 dari PT LAS ke rekening penerimaan antar-PT PT DRMS',
      );
      expect(_text(tester, 'icloan-destination'), 'Rekening tujuan: Mandiri · ••••0123 · PT Contoh Dirgantara');
      // the site account is not offered
      await tester.tap(find.byKey(const Key('icloan-cash-account')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Kas Kecil Site'), findsNothing);
      expect(find.textContaining('Bank Operasional LAS'), findsWidgets);
      await tester.tap(find.text('Batal').last);
      await tester.pumpAndSettle();

      // nothing filled → the transfer form's checks (no cost center asked)
      await tester.tap(_button('icloan-disburse-submit'));
      await tester.pumpAndSettle();
      expect(find.text('Pilih pusat biaya.'), findsNothing);
      expect(find.text('No. referensi bank wajib diisi.'), findsOneWidget);
      expect(loans.disbursed, isEmpty);

      await tester.tap(find.byKey(const Key('transfer-at')));
      await tester.pumpAndSettle();
      final ok = MaterialLocalizations.of(tester.element(find.byType(IcLoanDisburseScreen))).okButtonLabel;
      await tester.tap(find.text(ok));
      await tester.pumpAndSettle();
      await tester.tap(find.text(ok));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('transfer-bank-ref')), 'REF-9');
      await tester.tap(find.byKey(const Key('transfer-proof-gallery')));
      await tester.pumpAndSettle();
      await tester.tap(_button('icloan-disburse-submit'));
      await tester.pumpAndSettle();

      // 409 CASH_OVERDRAFT_CONFIRM_REQUIRED → "Tetap simpan" → second call with confirmOverdraft
      expect(find.byKey(const Key('icloan-override-confirm')), findsOneWidget);
      await tester.tap(find.byKey(const Key('icloan-override-confirm')));
      await tester.pumpAndSettle();
      expect(loans.disbursed, hasLength(2));
      expect(loans.disbursed.first.body.containsKey('confirmOverdraft'), isFalse);
      final body = loans.disbursed.last.body;
      expect(body['confirmOverdraft'], isTrue);
      expect(body['cashAccountId'], 3);
      expect(body['bankRef'], 'REF-9');
      expect(body['proofMediaId'], 9001);
      expect(body.containsKey('amount'), isFalse);
      expect(body.containsKey('costCenterId'), isFalse);
      expect(loans.disbursed.last.key, isNot(loans.disbursed.first.key), reason: 'another body, another key');
      expect(finance.uploads, 1, reason: 'the proof is uploaded once');
      expect(
        find.text(
          'Pencairan PJA/LAS/2610/0002 tercatat: KK/LAS/2610/0004 di PT pemberi, KM/DRMS/2610/0011 di PT peminjam.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('the borrower\'s closed period: its message, the form stays', (tester) async {
      final loans = _FakeLoansApi()
        ..refuse.add(
          ProblemException.fromJson(409, {
            'title': 'Conflict',
            'code': 'INTERCOMPANY_PERIOD_CLOSED',
            'lockDate': '2026-10-31',
          }),
        );
      await pumpScreen(
        tester,
        IcLoanDisburseScreen(loan: IcLoan.fromJson(icLoanDetailJson()), destinationKnown: false),
        auth: _financeWith(),
        overrides: [
          intercompanyLoansApiProvider.overrideWithValue(loans),
          financeApiProvider.overrideWithValue(_LenderFinanceApi()),
          photoCompressorProvider.overrideWithValue(FakeCompressor()),
          proofPickerProvider.overrideWithValue((context, {required fromCamera}) async => _png),
        ],
      );
      expect(find.byKey(const Key('icloan-destination-none')), findsNothing, reason: 'queue not loaded: unknown');
      await tester.tap(find.byKey(const Key('transfer-at')));
      await tester.pumpAndSettle();
      final ok = MaterialLocalizations.of(tester.element(find.byType(IcLoanDisburseScreen))).okButtonLabel;
      await tester.tap(find.text(ok));
      await tester.pumpAndSettle();
      await tester.tap(find.text(ok));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('transfer-bank-ref')), 'REF-9');
      await tester.tap(find.byKey(const Key('transfer-proof-gallery')));
      await tester.pumpAndSettle();
      await tester.tap(_button('icloan-disburse-submit'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('icloan-disburse-error')), findsOneWidget);
      expect(find.textContaining('tutup buku s/d 2026-10-31'), findsOneWidget);
      expect(find.byType(IcLoanDisburseScreen), findsOneWidget);
    });
  });
}
