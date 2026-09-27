import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/addendum.dart';

/// `/api/v1/budget-addenda` (E5). Every write carries an Idempotency-Key (one per opened form / sheet).
class AddendumApi {
  AddendumApi(this.client);
  final ApiClient client;

  Options _idem(String key) => Options(headers: {'Idempotency-Key': key});
  Addendum _one(dynamic data) => Addendum.fromJson(data as Map<String, dynamic>);

  Future<AddendumPage> list({int? projectId, bool mine = false, String? cursor}) => client.run(
    (d) => d.get<dynamic>(
      '/budget-addenda',
      queryParameters: {'project': ?projectId, if (mine) 'mine': '1', 'cursor': ?cursor},
    ),
    (data) => AddendumPage.fromJson(data as Map<String, dynamic>),
  );

  Future<List<Addendum>> inbox() => client.run(
    (d) => d.get<dynamic>('/budget-addenda/inbox'),
    (data) => AddendumPage.fromJson(data as Map<String, dynamic>).items,
  );

  Future<Addendum> detail(int id) => client.run((d) => d.get<dynamic>('/budget-addenda/$id'), _one);

  Future<Addendum> create({
    required int projectId,
    required int addition,
    required String reason,
    required bool submit,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/budget-addenda',
      data: {'projectId': projectId, 'addition': addition, 'reason': reason.trim(), 'submit': submit},
      options: _idem(idempotencyKey),
    ),
    _one,
  );

  Future<Addendum> submit(int id, {required String idempotencyKey}) =>
      client.run((d) => d.post<dynamic>('/budget-addenda/$id/submit', options: _idem(idempotencyKey)), _one);

  Future<Addendum> cancel(int id, {required String reason, required String idempotencyKey}) => client.run(
    (d) =>
        d.post<dynamic>('/budget-addenda/$id/cancel', data: {'reason': reason.trim()}, options: _idem(idempotencyKey)),
    _one,
  );

  /// Direktur "Setujui" (ADR 0013: Diketahui = persetujuan). The profile signature is used by the server.
  Future<Addendum> acknowledge(int id, {required String idempotencyKey}) => client.run(
    (d) =>
        d.post<dynamic>('/budget-addenda/$id/acknowledge', data: <String, dynamic>{}, options: _idem(idempotencyKey)),
    _one,
  );

  Future<Addendum> approve(int id, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/budget-addenda/$id/approve', data: <String, dynamic>{}, options: _idem(idempotencyKey)),
    _one,
  );

  Future<Addendum> reject(int id, {required String reason, required String idempotencyKey}) => client.run(
    (d) =>
        d.post<dynamic>('/budget-addenda/$id/reject', data: {'reason': reason.trim()}, options: _idem(idempotencyKey)),
    _one,
  );
}
