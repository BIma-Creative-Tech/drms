import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/intercompany_loan.dart';

/// `/api/v1/intercompany-loans` (ADR 0029 "Pinjaman antar-PT"). Online only; every write carries an Idempotency-Key
/// (one per opened form / distinct body). The APK instructs (Owner) and disburses (Finance of the lender); cancel,
/// repayments and both voids are web-only in this phase.
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
  Future<IcLoan> instruct(Map<String, dynamic> body, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/intercompany-loans', data: body, options: _idem(idempotencyKey)),
    _one,
  );

  /// `POST /intercompany-loans/{id}/disburse` ([icLoanDisburseBody]) → the loan, now "Dicairkan". A 409
  /// `CASH_OVERDRAFT_CONFIRM_REQUIRED` asks for a confirmation (`confirmOverdraft`).
  Future<IcLoan> disburse(int id, Map<String, dynamic> body, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/intercompany-loans/$id/disburse', data: body, options: _idem(idempotencyKey)),
    _one,
  );
}
