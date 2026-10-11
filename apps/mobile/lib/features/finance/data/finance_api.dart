import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../../expense/data/expense_mappers.dart';
import '../../expense/domain/expense_request.dart';
import '../domain/transfer_queue.dart';

List<dynamic> _list(Object? v) => v is List ? v : const [];
Map<String, dynamic>? _map(Object? v) => v is Map<String, dynamic> ? v : null;

/// DRMS 10/10 point 10: Finance reads + "Catat transfer" (online only, like every money action).
class FinanceApi {
  FinanceApi(this.client);
  final ApiClient client;

  /// `GET /transfer-queue` of the PT switcher selection (Finance / Direktur), needed date ascending.
  Future<List<TransferQueueItem>> transferQueue() => client.run(
    (d) => d.get<dynamic>('/transfer-queue'),
    (data) => [
      for (final i in _list(_map(data)?['items']))
        if (_map(i) case final j?) transferQueueItemFromJson(j),
    ],
  );

  /// Cash accounts of PT [companyId] (`GET /cash-accounts/balances?company=`; Finance / Direktur).
  Future<List<CashAccountOption>> cashAccounts(int? companyId) => client.run(
    (d) => d.get<dynamic>(
      '/cash-accounts/balances',
      queryParameters: {'company': ?companyId},
      options: ApiClient.allCompanies(),
    ),
    (data) => [
      for (final i in _list(_map(data)?['items']))
        if (_map(i) case final j?) cashAccountFromJson(j),
    ],
  );

  /// Active cost centers of PT [companyId] (`GET /cost-centers?company=&q=`, D2 picker).
  Future<List<CostCenterOption>> costCenters(int? companyId, {String q = ''}) => client.run(
    (d) => d.get<dynamic>(
      '/cost-centers',
      queryParameters: {'company': ?companyId, if (q.trim().isNotEmpty) 'q': q.trim()},
      options: ApiClient.allCompanies(),
    ),
    (data) => [
      for (final i in _list(_map(data)?['docs'] ?? _map(data)?['items']))
        if (_map(i) case final j?) costCenterFromJson(j),
    ],
  );

  /// Transfer proof (compressed JPEG) → `media-transfer-proofs` id (`POST /media/transfer-proofs`, Finance only).
  Future<int> uploadProof(Uint8List bytes, {required String filename}) => client.run(
    (d) => d.post<dynamic>(
      '/media/transfer-proofs',
      data: FormData.fromMap({
        'file': MultipartFile.fromBytes(bytes, filename: filename, contentType: DioMediaType.parse('image/jpeg')),
      }),
      options: ApiClient.allCompanies(),
    ),
    (data) => ((data as Map<String, dynamic>)['id'] as num).toInt(),
  );

  /// `POST /expense-requests/{id}/transfer` ([transferBody]) → the updated request. A 409 with
  /// `CASH_OVERDRAFT_CONFIRM_REQUIRED` / `BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED` asks for a confirmation.
  Future<ExpenseDetail> recordTransfer(int requestId, Map<String, dynamic> body, {required String idempotencyKey}) =>
      client.run(
        (d) => d.post<dynamic>(
          '/expense-requests/$requestId/transfer',
          data: body,
          // One document (MC3): the Finance role IN its PT counts, not the PT switcher.
          options: ApiClient.allCompanies(Options(headers: {'Idempotency-Key': idempotencyKey})),
        ),
        (data) => detailFromJson(_map(_map(data)?['request']) ?? (data as Map<String, dynamic>)),
      );
}
