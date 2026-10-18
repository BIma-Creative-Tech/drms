import '../../../core/network/api_client.dart';
import '../domain/web_modules.dart';

/// `GET /api/v1/me/modules` — the web launcher modules of the caller for the PTs of `X-Company-Ids`.
class MenuApi {
  MenuApi(this.client);
  final ApiClient client;

  Future<Map<String, dynamic>> raw() =>
      client.run((d) => d.get<dynamic>('/me/modules'), (data) => data as Map<String, dynamic>);
}

List<WebModule> parseMenu(Map<String, dynamic> raw) => webModulesFromJson(raw);
