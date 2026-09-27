import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/progress.dart';

/// `/api/v1` E4 endpoints (openapi: /projects/{id}/stages, /progress-reports, /projects/progress).
class ProgressApi {
  ProgressApi(this.client);
  final ApiClient client;

  Options _idem(String key) => Options(headers: {'Idempotency-Key': key});

  Future<ProjectStageSet> stages(int projectId) => client.run(
    (d) => d.get<dynamic>('/projects/$projectId/stages'),
    (data) => ProjectStageSet.fromJson(data as Map<String, dynamic>),
  );

  Future<ProgressReportPage> list({int? projectId, bool mine = false, String? cursor, int limit = 25}) => client.run(
    (d) => d.get<dynamic>(
      '/progress-reports',
      queryParameters: {'project': ?projectId, if (mine) 'mine': '1', 'cursor': ?cursor, 'limit': limit},
    ),
    (data) => ProgressReportPage.fromJson(data as Map<String, dynamic>),
  );

  Future<ProgressReport> detail(int id) => client.run(
    (d) => d.get<dynamic>('/progress-reports/$id'),
    (data) => ProgressReport.fromJson(data as Map<String, dynamic>),
  );

  /// Online create (flag `syncProgressReports` off). Replay with the same clientUuid → 200 existing.
  Future<ProgressReport> create(Map<String, dynamic> body, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/progress-reports', data: body, options: _idem(idempotencyKey)),
    (data) => ProgressReport.fromJson(data as Map<String, dynamic>),
  );

  Future<ProgressReport> update(int id, Map<String, dynamic> body, {required String idempotencyKey}) => client.run(
    (d) => d.patch<dynamic>('/progress-reports/$id', data: body, options: _idem(idempotencyKey)),
    (data) => ProgressReport.fromJson(data as Map<String, dynamic>),
  );

  Future<ProjectProgressList> projectsProgress({int? projectId}) => client.run(
    (d) => d.get<dynamic>('/projects/progress', queryParameters: {'project': ?projectId}),
    (data) => ProjectProgressList.fromJson(data as Map<String, dynamic>),
  );

  /// Photo bytes through the authorized file endpoint (never cached on disk).
  Future<Uint8List> photo(int id, {bool thumb = true}) => client.run(
    (d) => d.get<dynamic>(
      '/media/progress-photos/$id/file',
      queryParameters: {if (thumb) 'variant': 'thumb'},
      options: Options(responseType: ResponseType.bytes),
    ),
    (data) => Uint8List.fromList(data as List<int>),
  );
}
