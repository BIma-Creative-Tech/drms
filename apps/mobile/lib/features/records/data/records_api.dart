import '../../../core/network/api_client.dart';
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
}
