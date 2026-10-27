import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/loan.dart';

/// `/api/v1/project-loans` (ADR 0022). Online only; every write carries an Idempotency-Key (one per opened form /
/// action). Phase 3 (user 2026-10-19): repayments and their void too. ADR 0031: Finance "Cairkan" of a cash-backed
/// loan; a cash move that takes the paying account below 0 answers 409 `CASH_OVERDRAFT_CONFIRM_REQUIRED` (re-sent with
/// `confirmOverdraft`). User decision 2026-10-24: Direktur → Owner approve loans AND cash-backed repayment requests;
/// the approved cash moves are transfer orders Finance executes from the "Antrian Transfer" (`transferOrders`,
/// `execute`, `executeRepayment`) — without a proof upload on the APK (optional; attached on the web).
class LoansApi {
  LoansApi(this.client);
  final ApiClient client;

  /// One loan (MC3 document class): the role IN its PT counts, not the PT switcher.
  Options _idem(String key) => ApiClient.allCompanies(Options(headers: {'Idempotency-Key': key}));
  Loan _one(dynamic data) => Loan.fromJson(data as Map<String, dynamic>);

  Future<LoanPage> list({
    int? projectId,
    String? role,
    String? status,
    bool overdue = false,
    String? q,
    int page = 1,
    int limit = 50,
    bool summary = false,
  }) => client.run(
    (d) => d.get<dynamic>(
      '/project-loans',
      queryParameters: {
        'project': ?projectId,
        'role': ?role,
        'status': ?status,
        if (overdue) 'overdue': '1',
        if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
        'page': page,
        'limit': limit,
        if (summary) 'summary': '1',
      },
    ),
    (data) => LoanPage.fromJson(data as Map<String, dynamic>),
  );

  /// Loans and repayment requests waiting for the caller (Direktur level 1, Owner level 2).
  Future<LoanInbox> inbox() => client.run(
    (d) => d.get<dynamic>('/project-loans/inbox'),
    (data) => LoanInbox.fromJson(data as Map<String, dynamic>),
  );

  /// Approved cash-backed loans / repayments waiting in the "Antrian Transfer" (PT switcher selection).
  Future<LoanTransferOrders> transferOrders() => client.run(
    (d) => d.get<dynamic>('/project-loans/transfer-orders'),
    (data) => LoanTransferOrders.fromJson(data as Map<String, dynamic>),
  );

  Future<LoanOptions> options() => client.run(
    (d) => d.get<dynamic>('/project-loans/options'),
    (data) => LoanOptions.fromJson(data as Map<String, dynamic>),
  );

  Future<Loan> detail(int id) =>
      client.run((d) => d.get<dynamic>('/project-loans/$id', options: ApiClient.allCompanies()), _one);

  Future<Loan> create({
    required int borrowerProjectId,
    required int lenderProjectId,
    required String kind,
    required int amount,
    required String reason,
    required String loanDate,
    required String dueDate,
    required bool submit,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/project-loans',
      data: {
        'borrowerProjectId': borrowerProjectId,
        'lenderProjectId': lenderProjectId,
        'kind': kind,
        'amount': amount,
        'reason': reason.trim(),
        'loanDate': loanDate,
        'dueDate': dueDate,
        'submit': submit,
      },
      options: _idem(idempotencyKey),
    ),
    _one,
  );

  /// `PATCH /project-loans/{id}` — edit a Draft (creator PM; the borrower project stays fixed).
  Future<Loan> update(
    int id, {
    int? lenderProjectId,
    String? kind,
    int? amount,
    String? reason,
    String? loanDate,
    String? dueDate,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.patch<dynamic>(
      '/project-loans/$id',
      data: {
        'lenderProjectId': ?lenderProjectId,
        'kind': ?kind,
        'amount': ?amount,
        if (reason != null) 'reason': reason.trim(),
        'loanDate': ?loanDate,
        'dueDate': ?dueDate,
      },
      options: _idem(idempotencyKey),
    ),
    _one,
  );

  Future<Loan> submit(int id, {required String idempotencyKey}) =>
      client.run((d) => d.post<dynamic>('/project-loans/$id/submit', options: _idem(idempotencyKey)), _one);

  Future<Loan> cancel(int id, {required String reason, required String idempotencyKey}) => client.run(
    (d) =>
        d.post<dynamic>('/project-loans/$id/cancel', data: {'reason': reason.trim()}, options: _idem(idempotencyKey)),
    _one,
  );

  /// "Setujui" of the caller's level (Direktur level 1, Owner level 2). The profile signature is used by the server.
  Future<Loan> approve(int id, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/project-loans/$id/approve', data: <String, dynamic>{}, options: _idem(idempotencyKey)),
    _one,
  );

  Future<Loan> reject(int id, {required String reason, required String idempotencyKey}) => client.run(
    (d) =>
        d.post<dynamic>('/project-loans/$id/reject', data: {'reason': reason.trim()}, options: _idem(idempotencyKey)),
    _one,
  );

  /// `POST /project-loans/{id}/repayments` {amount, repayDate, note?, confirmOverdraft?} — borrower PM / Finance
  /// ("Catat pengembalian"; ADR 0031: Finance only once a cash-backed loan is disbursed).
  Future<Loan> addRepayment(
    int id, {
    required int amount,
    required String repayDate,
    String? note,
    bool confirmOverdraft = false,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/project-loans/$id/repayments',
      data: {
        'amount': amount,
        'repayDate': repayDate,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        if (confirmOverdraft) 'confirmOverdraft': true,
      },
      options: _idem(idempotencyKey),
    ),
    _one,
  );

  /// ADR 0031 `POST /project-loans/{id}/disburse` (openapi `ProjectLoanDisburse`) — Finance "Cairkan": KK on the
  /// lender's Pusat Biaya + KM on the borrower's, dated [disburseDate] (default today in the PT zone), once.
  Future<Loan> disburse(
    int id, {
    String? disburseDate,
    String? note,
    bool confirmOverdraft = false,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/project-loans/$id/disburse',
      data: {
        'disburseDate': ?disburseDate,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        if (confirmOverdraft) 'confirmOverdraft': true,
      },
      options: _idem(idempotencyKey),
    ),
    _one,
  );

  /// Finance executes the loan's transfer order: KK on the lender's Pusat Biaya (lender project) + KM on the
  /// borrower's (borrower project), dated [executeDate] (default today in the PT zone), once.
  Future<Loan> execute(
    int id, {
    String? executeDate,
    String? note,
    bool confirmOverdraft = false,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/project-loans/$id/execute',
      data: _executeBody(executeDate, note, confirmOverdraft),
      options: _idem(idempotencyKey),
    ),
    _one,
  );

  /// Finance executes an approved repayment's transfer order: KK on the borrower's Pusat Biaya + KM on the lender's.
  Future<Loan> executeRepayment(
    int id,
    int repaymentId, {
    String? executeDate,
    String? note,
    bool confirmOverdraft = false,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/project-loans/$id/repayments/$repaymentId/execute',
      data: _executeBody(executeDate, note, confirmOverdraft),
      options: _idem(idempotencyKey),
    ),
    _one,
  );

  Map<String, dynamic> _executeBody(String? executeDate, String? note, bool confirmOverdraft) => {
    'executeDate': ?executeDate,
    if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    if (confirmOverdraft) 'confirmOverdraft': true,
  };

  /// "Setujui" of a repayment request at the caller's level (Direktur, then Owner).
  Future<Loan> approveRepayment(int id, int repaymentId, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>(
      '/project-loans/$id/repayments/$repaymentId/approve',
      data: <String, dynamic>{},
      options: _idem(idempotencyKey),
    ),
    _one,
  );

  Future<Loan> rejectRepayment(int id, int repaymentId, {required String reason, required String idempotencyKey}) =>
      _repaymentReason(id, repaymentId, 'reject', reason, idempotencyKey);

  /// The submitter cancels a pending request (Finance also an approved one not yet executed).
  Future<Loan> cancelRepayment(int id, int repaymentId, {required String reason, required String idempotencyKey}) =>
      _repaymentReason(id, repaymentId, 'cancel', reason, idempotencyKey);

  Future<Loan> _repaymentReason(int id, int repaymentId, String action, String reason, String idempotencyKey) =>
      client.run(
        (d) => d.post<dynamic>(
          '/project-loans/$id/repayments/$repaymentId/$action',
          data: {'reason': reason.trim()},
          options: _idem(idempotencyKey),
        ),
        _one,
      );

  /// `POST /project-loans/{id}/repayments/{rid}/void` {reason} — Direktur / Finance.
  Future<Loan> voidRepayment(int id, int repaymentId, {required String reason, required String idempotencyKey}) =>
      client.run(
        (d) => d.post<dynamic>(
          '/project-loans/$id/repayments/$repaymentId/void',
          data: {'reason': reason.trim()},
          options: _idem(idempotencyKey),
        ),
        _one,
      );
}
