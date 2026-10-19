import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/rap_edit.dart';

/// The RAP endpoints of the web "RAP proyek" page (one project = one PT: no PT switcher header).
class RapApi {
  RapApi(this.client);
  final ApiClient client;

  Options _idem(String key) => ApiClient.allCompanies(Options(headers: {'Idempotency-Key': key}));

  Future<RapEditData> load(int projectId) => client.run(
    (d) => d.get<dynamic>('/projects/$projectId/rap', options: ApiClient.allCompanies()),
    (data) => RapEditData.fromJson(data as Map<String, dynamic>),
  );

  /// Active units of measure (`GET /masters?types=uoms`, shared masters).
  Future<List<(int, String)>> uoms() => client.run(
    (d) => d.get<dynamic>('/masters', queryParameters: {'types': 'uoms'}, options: ApiClient.allCompanies()),
    (data) => [
      for (final u in (((data as Map<String, dynamic>)['types'] as Map?)?['uoms'] as List? ?? const []))
        if ((u as Map)['active'] != false)
          ((u['id'] as num).toInt(), [u['code'], u['name']].whereType<String>().join(' — ')),
    ],
  );

  Future<void> createItem(int projectId, Map<String, Object?> body, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/projects/$projectId/rap/items', data: body, options: _idem(idempotencyKey)),
    (_) {},
  );

  Future<void> updateItem(int itemId, Map<String, Object?> body, {required String idempotencyKey}) =>
      client.run((d) => d.patch<dynamic>('/rap-items/$itemId', data: body, options: _idem(idempotencyKey)), (_) {});

  FormData _file(Uint8List bytes, String name, [Map<String, Object?>? payload]) => FormData.fromMap({
    'file': MultipartFile.fromBytes(
      bytes,
      filename: name,
      contentType: DioMediaType.parse('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ),
    '_payload': ?(payload == null ? null : jsonEncode(payload)),
  });

  Future<RapPreviewData> preview(int projectId, Uint8List bytes, String name) => client.run(
    (d) => d.post<dynamic>(
      '/projects/$projectId/rap/import/preview',
      data: _file(bytes, name),
      options: ApiClient.allCompanies(),
    ),
    (data) => RapPreviewData.fromJson(data as Map<String, dynamic>),
  );

  Future<void> commit(int projectId, Uint8List bytes, String name, {required String fileHash, String? reason}) =>
      client.run(
        (d) => d.post<dynamic>(
          '/projects/$projectId/rap/import/commit',
          data: _file(bytes, name, {
            'fileHash': fileHash,
            if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
          }),
          options: ApiClient.allCompanies(),
        ),
        (_) {},
      );

  /// RAP templates readable by the caller (`GET /data/rap-templates`, the generic list).
  Future<List<(int, String)>> templates() => client.run(
    (d) => d.get<dynamic>('/data/rap-templates', queryParameters: {'limit': 50}),
    (data) => [
      for (final i in ((data as Map<String, dynamic>)['items'] as List? ?? const []))
        if (int.tryParse('${(i as Map)['id']}') case final id?) (id, '${i['title'] ?? ''}'),
    ],
  );

  Future<void> applyTemplate(int projectId, int templateId, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>(
      '/projects/$projectId/rap/apply-template',
      data: {'templateId': templateId},
      options: _idem(idempotencyKey),
    ),
    (_) {},
  );

  Future<void> saveTemplate(int projectId, String name, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>(
      '/projects/$projectId/rap/save-template',
      data: {'name': name.trim()},
      options: _idem(idempotencyKey),
    ),
    (_) {},
  );

  /// `GET /rap/template.xlsx` or `GET /projects/{id}/rap.xlsx` → bytes.
  Future<Uint8List> xlsx(String path) => client.run(
    (d) => d.get<dynamic>(path, options: ApiClient.allCompanies(Options(responseType: ResponseType.bytes))),
    (data) => Uint8List.fromList(data as List<int>),
  );
}
