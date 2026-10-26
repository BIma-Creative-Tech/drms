import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/domain/project_loan_instruction.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/project_loan_instruct_sheet.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';

import '../support/d1310_c_fixtures.dart';
import '../support/d2610_fixtures.dart';
import '../support/harness.dart';
import '../support/widget_harness.dart';

/// DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26) on the APK: "Setujui" disabled while the project's cash account is
/// short + "Instruksi pinjam antar proyek" (project list with the dana bebas, amount, confirm popup, result popup).
/// Fictional PTs and numbers.

AuthSignedIn _owner() => AuthSignedIn(profile: profile(Role.effective({Role.principal})), sub: 's');

VoidCallback? _onPressed(WidgetTester tester, Finder f) => tester.widget<ButtonStyleButton>(f).onPressed;

class _Api extends ApprovalsApi {
  _Api({this.info, this.refuse}) : super(testClient('http://127.0.0.1:9', StaticTokens()));
  final Map<String, dynamic>? info;
  final ProblemException? refuse;
  final calls = <Map<String, Object?>>[];

  @override
  Future<ProjectLoanInstruction> projectLoanLenders(int requestId) async =>
      ProjectLoanInstruction.fromJson(info ?? pliJson());

  @override
  Future<ExpenseDetail> instructProjectLoan(
    int requestId, {
    required int lenderProjectId,
    required int amount,
    required String reason,
    String? dueDate,
    required String idempotencyKey,
  }) async {
    calls.add({
      'id': requestId,
      'lender': lenderProjectId,
      'amount': amount,
      'reason': reason,
      'due': dueDate,
      'key': idempotencyKey,
    });
    if (refuse != null) throw refuse!;
    return detailFromJson(fundDetailJson(allowed: const ['approve', 'reject']));
  }
}

Map<String, dynamic> _pbShortDetail() => fundDetailJson(
  allowed: const ['approve', 'reject', instructProjectLoanAction],
  fundCheck: fundCheckPbJson(route: 'short'),
);

/// The sheet opened from its button (as on the detail / Beranda), so the sheet's own pop after the result works.
Future<void> _open(WidgetTester tester, ApprovalsApi api) async {
  await pumpScreen(
    tester,
    const Scaffold(
      body: Center(child: ProjectLoanInstructButton(requestId: 42, docNo: 'PB/DRMS/2610/0042')),
    ),
    auth: _owner(),
    overrides: [approvalsApiProvider.overrideWithValue(api)],
  );
  await tester.tap(find.byKey(const Key('pli-open-42')));
  await tester.pumpAndSettle();
  expect(find.byKey(const Key('pli-sheet')), findsOneWidget);
}

void main() {
  testWidgets('detail: Setujui disabled with the account text + the instruction button for the final decider', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      const RequestDetailScreen(id: 42),
      auth: _owner(),
      overrides: [
        requestDetailProvider(42).overrideWith((ref) async => detailFromJson(_pbShortDetail())),
        receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
      ],
    );
    expect(_onPressed(tester, find.byKey(const Key('action-approve'))), isNull);
    expect(tester.widget<Text>(find.byKey(const Key('decision-blocked-text'))).data, contains('Dana bebas akun kas'));
    expect(find.byKey(const Key('pli-open-42')), findsOneWidget);
  });

  testWidgets('detail: without instruct_project_loan no button', (tester) async {
    await pumpScreen(
      tester,
      const RequestDetailScreen(id: 42),
      auth: _owner(),
      overrides: [
        requestDetailProvider(42).overrideWith(
          (ref) async => detailFromJson(
            fundDetailJson(
              allowed: const ['approve', 'reject'],
              fundCheck: fundCheckPbJson(route: 'short'),
            ),
          ),
        ),
        receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
      ],
    );
    expect(find.byKey(const Key('pli-open-42')), findsNothing);
  });

  testWidgets('sheet: candidates with dana bebas, not eligible disabled with the reason; confirm → instruct → result', (
    tester,
  ) async {
    final api = _Api();
    await _open(tester, api);
    expect(find.text('Rp 10.000.000'), findsOneWidget); // borrower dana bebas
    expect(tester.widget<Text>(find.byKey(const Key('pli-shortfall'))).data, 'Rp 20.000.000');
    expect(find.byKey(const Key('pli-candidate-6')), findsOneWidget);
    expect(find.text('Rp 100.000.000'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('pli-candidate-reason-8'))).data,
      'Dana bebas akun kas kurang dari kekurangan pengajuan.',
    );
    expect(find.byKey(const Key('pli-candidate-reason-10')), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('pli-amount'))).controller?.text, '20000000');
    // an amount below the shortfall is refused locally (server text)
    await tester.enterText(find.byKey(const Key('pli-amount')), '19000000');
    await tester.pumpAndSettle();
    expect(find.text('Nilai pinjaman minimal Rp 20.000.000 (kekurangan dana akun kas pengajuan).'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('pli-amount')), '25000000');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('pli-submit')));
    await tester.tap(find.byKey(const Key('pli-submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('confirm-dialog')), findsOneWidget);
    expect(find.textContaining('Pemberi: Q-B · Proyek B — akun kas Kas Contoh B'), findsOneWidget);
    expect(find.textContaining('Nilai pinjaman: Rp 25.000.000'), findsOneWidget);
    await tester.tap(find.byKey(const Key('pli-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, hasLength(1));
    expect(api.calls.single, containsPair('lender', 6));
    expect(api.calls.single, containsPair('amount', 25000000));
    expect(api.calls.single, containsPair('due', '2026-11-25'));
    expect(api.calls.single['reason'], contains('Kas Contoh A'));
    expect(find.byKey(const Key('result-success')), findsOneWidget);
    await tester.tap(find.byKey(const Key('result-ok')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pli-sheet')), findsNothing);
  });

  testWidgets('sheet: a 409 stays in the sheet and pops up; a waiting loan → no submit', (tester) async {
    final api = _Api(
      refuse: ProblemException.fromJson(409, {
        'title': 'Dana bebas akun kas Kas Contoh B (Rp 1.000) tidak cukup untuk menutup kekurangan Rp 20.000.000. Pilih project lain.',
        'code': 'FUND_INSUFFICIENT',
      }),
    );
    await _open(tester, api);
    await tester.ensureVisible(find.byKey(const Key('pli-submit')));
    await tester.tap(find.byKey(const Key('pli-submit')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pli-confirm')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('result-failed')), findsOneWidget);
    await tester.tap(find.byKey(const Key('result-ok')));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const Key('pli-error'))).data, contains('Pilih project lain'));

    final waiting = _Api(
      info: pliJson(
        canInstruct: false,
        pending: {
          'id': 7,
          'docNo': 'PJ/DRMS/2610/0007',
          'amount': 25000000,
          'statusLabel': 'Disetujui – menunggu transfer Finance',
        },
      ),
    );
    await _open(tester, waiting);
    expect(find.byKey(const Key('pli-pending')), findsOneWidget);
    expect(find.byKey(const Key('pli-cannot')), findsOneWidget);
    expect(find.byKey(const Key('pli-submit')), findsNothing);
  });
}
