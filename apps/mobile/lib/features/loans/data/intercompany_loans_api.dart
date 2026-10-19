import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/intercompany_loan.dart';

/// `/api/v1/intercompany-loans` (ADR 0029 "Pinjaman antar-PT"). Online only; every write carries an Idempotency-Key
/// (one per opened form / distinct body). The APK instructs (Owner), disburses (Finance of the lender) and — phase 3,
/// user 2026-10-19 — lists, records repayments (Finance of the borrower) and voids them / the disbursement; cancel stays
/// on the web.
class IntercompanyLoansApi {
  IntercompanyLoansApi(this.client);
  final ApiClient client;

  /// One loan belongs to two PTs: the role IN its PTs counts, not the PT switcher (no `X-Company-Ids`).
  Options _idem(String key) => ApiClient.allCompanies(Options(headers: {'Idempotency-Key': key}));
  IcLoan _one(dynamic data) => IcLoan.fromJson(data as Map<String, dynamic>);

  /// "Pencairan pinjaman antar-PT" of the PT switcher selection (lender Finance), instruction date ascending.
  Future<IcLoanQueue> queue() => client.run(
    (d) => d.get<dynamic>('/intercompany-loans/queue'),
    (data) => IcLoanQueue.fromJson(data as Map<String, dynamic>),
  );

  /// Lender list of the instruction form (Owner of [borrowerCompanyId]): the borrower's availability and waiting
  /// requests, every other PT where the caller is Owner with its "Dana tersedia", the default due date.
  Future<IcLenderOptions> lenders(int borrowerCompanyId, {int? amount}) => client.run(
    (d) => d.get<dynamic>(
      '/intercompany-loans/lenders',
      queryParameters: {'borrower': borrowerCompanyId, if (amount != null && amount > 0) 'amount': amount},
      options: ApiClient.allCompanies(),
    ),
    (data) => IcLenderOptions.fromJson(data as Map<String, dynamic>),
  );

  Future<IcLoan> detail(int id) =>
      client.run((d) => d.get<dynamic>('/intercompany-loans/$id', options: ApiClient.allCompanies()), _one);

  /// `POST /intercompany-loans` ([icLoanCreateBody]) → the new loan (201, `PJA/{LENDER}/…`).
  Future<IcLoan> instruct(Map<String, dynamic> body, {required String idempotencyKey}) =>
      client.run((d) => d.post<dynamic>('/intercompany-loans', data: body, options: _idem(idempotencyKey)), _one);

  /// `POST /intercompany-loans/{id}/disburse` ([icLoanDisburseBody]) → the loan, now "Dicairkan". A 409
  /// `CASH_OVERDRAFT_CONFIRM_REQUIRED` asks for a confirmation (`confirmOverdraft`).
  Future<IcLoan> disburse(int id, Map<String, dynamic> body, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/intercompany-loans/$id/disburse', data: body, options: _idem(idempotencyKey)),
    _one,
  );

  /// `GET /intercompany-loans` of the PT switcher selection (`role` lender / borrower, `status` comma list).
  Future<IcLoanPage> list({
    String? role,
    String? status,
    bool overdue = false,
    String? q,
    int page = 1,
    int limit = 25,
    bool summary = false,
  }) => client.run(
    (d) => d.get<dynamic>(
      '/intercompany-loans',
      queryParameters: {
        'role': ?role,
        'status': ?status,
        if (overdue) 'overdue': '1',
        if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
        'page': page,
        'limit': limit,
        if (summary) 'summary': '1',
      },
    ),
    (data) => IcLoanPage.fromJson(data as Map<String, dynamic>),
  );

  /// `POST /intercompany-loans/{id}/repayments` ([icLoanRepayBody]) — Finance of the BORROWER pays back.
  Future<IcLoan> repay(int id, Map<String, dynamic> body, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/intercompany-loans/$id/repayments', data: body, options: _idem(idempotencyKey)),
    _one,
  );

  /// `POST /intercompany-loans/{id}/disbursement/void` {reason, confirmBorrowerShortfall?}. A 409
  /// `LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED` asks for the confirmation.
  Future<IcLoan> voidDisbursement(
    int id, {
    required String reason,
    bool confirmBorrowerShortfall = false,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/intercompany-loans/$id/disbursement/void',
      data: {'reason': reason.trim(), if (confirmBorrowerShortfall) 'confirmBorrowerShortfall': true},
      options: _idem(idempotencyKey),
    ),
    _one,
  );

  /// `POST /intercompany-loans/{id}/repayments/{mid}/void` {reason}.
  Future<IcLoan> voidRepayment(int id, int movementId, {required String reason, required String idempotencyKey}) =>
      client.run(
        (d) => d.post<dynamic>(
          '/intercompany-loans/$id/repayments/$movementId/void',
          data: {'reason': reason.trim()},
          options: _idem(idempotencyKey),
        ),
        _one,
      );
}
