import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
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

  /// Active cash accounts of PT [companyId] (`GET /cash-accounts/balances?company=`; Finance / Direktur). The
  /// balances list also carries inactive accounts (`active: false`) — they cannot take a transfer, so the picker
  /// never offers them.
  Future<List<CashAccountOption>> cashAccounts(int? companyId) => client.run(
    (d) => d.get<dynamic>(
      '/cash-accounts/balances',
      queryParameters: {'company': ?companyId},
      options: ApiClient.allCompanies(),
    ),
    (data) => [
      for (final i in _list(_map(data)?['items']))
        if (_map(i) case final j?) cashAccountFromJson(j),
    ].where((a) => a.active).toList(),
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

  /// `POST /expense-requests/{id}/transfer` ([transferBody]) → the updated request and, ADR 0031, the automatic
  /// inter-project loan when paid from another account than the Pusat Biaya. A 409 with
  /// `CASH_OVERDRAFT_CONFIRM_REQUIRED` / `BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED` asks for a confirmation.
  Future<TransferOutcome> recordTransfer(int requestId, Map<String, dynamic> body, {required String idempotencyKey}) =>
      client.run(
        (d) => d.post<dynamic>(
          '/expense-requests/$requestId/transfer',
          data: body,
          // One document (MC3): the Finance role IN its PT counts, not the PT switcher.
          options: ApiClient.allCompanies(Options(headers: {'Idempotency-Key': idempotencyKey})),
        ),
        (data) => transferOutcomeFromJson(data as Map<String, dynamic>),
      );
}
