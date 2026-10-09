import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../../expense/data/expense_mappers.dart' show Json;
import '../domain/field_models.dart';

/// `/api/v1` FR1 endpoints (openapi: /service-reports, /unit-timesheets, /aftersales-activities, /units,
/// /projects/{id}/contract-units, /aftersales/open-pos). Writes go through the offline queue
/// (`POST /sync/batch` items `service_report.upsert` / `unit_timesheet.upsert` / `aftersales_activity.upsert`),
/// which runs the same domain services as POST / PATCH. Reads of ONE project are role-checked IN its PT by the
/// server (no `X-Company-Ids`, MC3); "Riwayat saya" follows the PT switcher.
class FieldApi {
  FieldApi(this.client);
  final ApiClient client;

  Future<FieldRecordPage> list(
    FieldReportType type, {
    int? projectId,
    bool mine = false,
    String? from,
    String? to,
    String? cursor,
    int limit = 25,
    ActivityKind? kind,
    bool allCompanies = false,
  }) => client.run(
    (d) => d.get<dynamic>(
      type.path,
      queryParameters: {
        'project': ?projectId,
        if (mine) 'mine': '1',
        'from': ?from,
        'to': ?to,
        'cursor': ?cursor,
        'limit': limit,
        'kind': ?kind?.code,
      },
      options: allCompanies ? ApiClient.allCompanies() : null,
    ),
    (data) => FieldRecordPage.fromJson(type, data as Json),
  );

  Future<FieldRecord> detail(FieldReportType type, int id) => client.run(
    (d) => d.get<dynamic>('${type.path}/$id', options: ApiClient.allCompanies()),
    (data) => FieldRecord(type, data as Json),
  );

  /// `GET /units?project=` — kontrak_unit: units in an active contract today; aftersales: every active unit of
  /// the PT. [updatedSince] = delta (incl. deactivated units). No contract rates.
  Future<({String? serverTime, List<FieldUnit> units})> units({required int projectId, String? updatedSince}) =>
      client.run(
        (d) => d.get<dynamic>(
          '/units',
          queryParameters: {'project': projectId, 'updatedSince': ?updatedSince},
          options: ApiClient.allCompanies(),
        ),
        (data) {
          final j = data as Json;
          return (
            serverTime: fStrN(j['serverTime']),
            units: [for (final u in fList(j['items'])) FieldUnit.fromJson(fMap(u))],
          );
        },
      );

  /// `GET /projects/{id}/contract-units` — rates are dropped while parsing (never kept on the phone).
  Future<List<FieldContractUnit>> contractUnits(int projectId) => client.run(
    (d) => d.get<dynamic>('/projects/$projectId/contract-units', options: ApiClient.allCompanies()),
    (data) => [
      for (final c in fList((data as Json)['items'])) FieldContractUnit.fromJson(fMap(c), projectId: projectId),
    ],
  );

  /// `GET /aftersales/open-pos?project=` — incoming POs still to deliver (oldest first).
  Future<List<FieldOpenPo>> openPos({required int projectId, int? clientId}) => client.run(
    (d) => d.get<dynamic>(
      '/aftersales/open-pos',
      queryParameters: {'project': projectId, 'client': ?clientId},
      options: ApiClient.allCompanies(Options()),
    ),
    (data) => [for (final p in fList((data as Json)['items'])) FieldOpenPo.fromJson(fMap(p))],
  );
}
