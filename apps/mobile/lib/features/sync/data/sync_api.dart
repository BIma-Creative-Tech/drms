import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/sync_models.dart';

/// `/api/v1/sync/*` (ADR 0010 "Sync contract").
class SyncApi {
  SyncApi(this.client);
  final ApiClient client;

  Future<BatchResponse> postBatch({
    required String batchId,
    required String deviceId,
    required ClockInfo clock,
    required List<QueuedItem> items,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/sync/batch',
      data: {
        'batch_id': batchId,
        'device_id': deviceId,
        'clock': clock.toJson(),
        'items': [for (final i in items) i.toJson()],
      },
      options: Options(headers: {'Idempotency-Key': batchId}),
    ),
    (data) => BatchResponse.fromJson(data as Map<String, dynamic>),
  );
}
