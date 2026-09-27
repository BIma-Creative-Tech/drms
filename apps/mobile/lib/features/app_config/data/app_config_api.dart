import '../../../core/logging/log.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../domain/app_config.dart';

class AppConfigApi {
  AppConfigApi(this.client);
  final ApiClient client;

  /// Public, called before login. Graceful: 404 (endpoint not deployed yet), network errors and
  /// malformed bodies return null so the app still starts (the server enforces 426 anyway).
  Future<AppConfig?> fetch({String? version}) async {
    try {
      return await client.run(
        (d) => d.get<dynamic>(
          '/app/config',
          queryParameters: {if (version != null && RegExp(r'^\d+\.\d+\.\d+$').hasMatch(version)) 'version': version},
          options: ApiClient.publicOptions(),
        ),
        (data) => data is Map<String, dynamic> ? AppConfig.fromJson(data) : null,
        auth: false,
      );
    } on UpgradeRequiredException catch (e) {
      return AppConfig(minAppVersion: e.minAppVersion ?? '999.0.0');
    } on ApiException catch (e) {
      Log.i('app-config unavailable: ${e.runtimeType}');
      return null;
    }
  }
}
