import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/loan.dart';

/// `/api/v1/project-loans` (ADR 0022). Online only; every write carries an Idempotency-Key (one per opened form /
/// action). Phase 3 (user 2026-10-19): repayments and their void too.
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

  Future<List<Loan>> inbox() => client.run(
    (d) => d.get<dynamic>('/project-loans/inbox'),
    (data) => LoanPage.fromJson(data as Map<String, dynamic>).items,
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

  /// Direktur "Setujui" (one level). The profile signature is used by the server.
  Future<Loan> approve(int id, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/project-loans/$id/approve', data: <String, dynamic>{}, options: _idem(idempotencyKey)),
    _one,
  );

  Future<Loan> reject(int id, {required String reason, required String idempotencyKey}) => client.run(
    (d) =>
        d.post<dynamic>('/project-loans/$id/reject', data: {'reason': reason.trim()}, options: _idem(idempotencyKey)),
    _one,
  );

  /// `POST /project-loans/{id}/repayments` {amount, repayDate, note?} — borrower PM / Finance ("Catat pengembalian").
  Future<Loan> addRepayment(
    int id, {
    required int amount,
    required String repayDate,
    String? note,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/project-loans/$id/repayments',
      data: {'amount': amount, 'repayDate': repayDate, if (note != null && note.trim().isNotEmpty) 'note': note.trim()},
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
