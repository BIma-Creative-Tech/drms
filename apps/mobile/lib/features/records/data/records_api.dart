import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/record_form.dart';
import '../domain/record_list.dart';

/// `GET /data/{collection}` (PT switcher selection, like the web list) and `GET /data/{collection}/{id}` (one document:
/// its own PT counts).
class RecordsApi {
  RecordsApi(this.client);
  final ApiClient client;

  Future<RecordPage> list(String collection, {String q = '', int page = 1, int limit = 20}) => client.run(
    (d) => d.get<dynamic>(
      '/data/$collection',
      queryParameters: {if (q.trim().isNotEmpty) 'q': q.trim(), 'page': page, 'limit': limit},
    ),
    (data) => RecordPage.fromJson(data as Map<String, dynamic>),
  );

  Future<RecordDetail> detail(String collection, String id) => client.run(
    (d) => d.get<dynamic>('/data/$collection/$id', options: ApiClient.allCompanies()),
    (data) => RecordDetail.fromJson(data as Map<String, dynamic>),
  );

  /// `GET /data/{collection}/form[?id=]` — the edit form of the web admin (fields, access, current values).
  Future<RecordFormDef> form(String collection, {String? id}) => client.run(
    (d) => d.get<dynamic>(
      '/data/$collection/form',
      queryParameters: {'id': ?id},
      options: id == null ? null : ApiClient.allCompanies(),
    ),
    (data) => RecordFormDef.fromJson(data as Map<String, dynamic>),
  );

  /// Relationship picker: `GET /data/{collection}/options?field=&q=&id=`.
  Future<List<(String, String)>> options(String collection, String field, {String q = '', String? id}) => client.run(
    (d) => d.get<dynamic>(
      '/data/$collection/options',
      queryParameters: {'field': field, if (q.trim().isNotEmpty) 'q': q.trim(), 'id': ?id},
    ),
    (data) => [
      for (final i in ((data as Map<String, dynamic>)['items'] as List? ?? const []))
        ('${(i as Map)['id']}', '${i['label'] ?? ''}'),
    ],
  );

  Options _idem(String key) => ApiClient.allCompanies(Options(headers: {'Idempotency-Key': key}));

  /// `POST /data/{collection}` {data} → the new document's detail.
  Future<RecordDetail> create(
    String collection,
    Map<String, Object?> data, {
    String? reason,
    required String idempotencyKey,
  }) => client.run(
    (d) =>
        d.post<dynamic>('/data/$collection', data: {'data': data, 'reason': ?reason}, options: _idem(idempotencyKey)),
    (data) => RecordDetail.fromJson(data as Map<String, dynamic>),
  );

  /// `PATCH /data/{collection}/{id}` {data, reason?} (changed fields only; reason = the audit change reason).
  Future<RecordDetail> update(
    String collection,
    String id,
    Map<String, Object?> data, {
    String? reason,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.patch<dynamic>(
      '/data/$collection/$id',
      data: {'data': data, 'reason': ?reason},
      options: _idem(idempotencyKey),
    ),
    (data) => RecordDetail.fromJson(data as Map<String, dynamic>),
  );

  Future<RecordDeleteCheck> deleteCheck(String collection, String id) => client.run(
    (d) => d.get<dynamic>('/records/$collection/$id/delete-check', options: ApiClient.allCompanies()),
    (data) => RecordDeleteCheck.fromJson(data as Map<String, dynamic>),
  );

  /// Soft delete (D1610): `POST /records/{collection}/{id}/delete` {reason}.
  Future<void> softDelete(String collection, String id, String reason, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>(
      '/records/$collection/$id/delete',
      data: {'reason': reason.trim()},
      options: _idem(idempotencyKey),
    ),
    (_) {},
  );

  /// `POST /devices/{id}/revoke` {reason} (web Perangkat & sesi; owner of the device, Admin, Direktur).
  Future<void> revokeDevice(String id, String reason, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/devices/$id/revoke', data: {'reason': reason.trim()}, options: _idem(idempotencyKey)),
    (_) {},
  );

  /// Bytes of a media file (`GET /media/{kind}/{id}/file`; the document's PT counts).
  Future<Uint8List> fileBytes(String path) => client.run(
    (d) => d.get<dynamic>(path, options: ApiClient.allCompanies(Options(responseType: ResponseType.bytes))),
    (data) => Uint8List.fromList(data as List<int>),
  );

  /// Phase 7: the edit form of a Payload global (`GET /data-globals/{slug}/form`, e.g. company-settings).
  Future<RecordFormDef> globalForm(String slug) => client.run(
    (d) => d.get<dynamic>('/data-globals/$slug/form'),
    (data) => RecordFormDef.fromJson(data as Map<String, dynamic>),
  );

  /// `PATCH /data-globals/{slug}` {data, reason?}.
  Future<RecordDetail> updateGlobal(
    String slug,
    Map<String, Object?> data, {
    String? reason,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.patch<dynamic>(
      '/data-globals/$slug',
      data: {'data': data, 'reason': ?reason},
      options: _idem(idempotencyKey),
    ),
    (data) => RecordDetail.fromJson(data as Map<String, dynamic>),
  );
}
