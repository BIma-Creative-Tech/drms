import 'dart:async';

import 'package:dio/dio.dart';

import '../logging/log.dart';
import 'api_exception.dart';

/// Supplies and renews the Keycloak access token (implemented by the auth repository).
abstract interface class TokenSource {
  /// Current access token (memory only), or null when logged out.
  Future<String?> accessToken();

  /// Single-flight refresh with rotation; returns the new access token or null when the session
  /// can no longer be renewed (the implementation then ends the session).
  Future<String?> refreshAccessToken();

  /// Called when the server still answers 401 after a refresh (revoked device/user).
  Future<void> onUnauthorized();

  /// Called on 401 `DEVICE_REVOKED` (no refresh attempted): end the session immediately.
  Future<void> onDeviceRevoked();
}

/// Headers every `/api/v1` call carries (ADR 0003 §4, ADR 0010 "Sync contract").
abstract interface class ClientHeaders {
  String get deviceId;
  String get appVersion;
}

typedef ReachabilityListener = void Function(bool reachable);
typedef UpgradeListener = void Function(String? minVersion);

/// dio wrapper for `/api/v1`: auth header, device headers, 401 → refresh → retry once
/// (401 `DEVICE_REVOKED` → immediate logout, no refresh), RFC 9457 problem → [ApiException].
class ApiClient {
  ApiClient({
    required String baseUrl,
    required this.tokens,
    required this.headers,
    Dio? dio,
    this.onReachability,
    this.onUpgradeRequired,
  }) : dio =
           dio ??
           Dio(
             BaseOptions(
               baseUrl: baseUrl,
               connectTimeout: const Duration(seconds: 15),
               receiveTimeout: const Duration(seconds: 30),
               sendTimeout: const Duration(seconds: 60),
               responseType: ResponseType.json,
             ),
           ) {
    this.dio.interceptors.add(_AuthInterceptor(this));
  }

  final Dio dio;
  final TokenSource tokens;
  final ClientHeaders headers;
  final ReachabilityListener? onReachability;
  final UpgradeListener? onUpgradeRequired;

  static const _noAuth = 'pk.noAuth';

  /// Options for endpoints called before login (e.g. `/app/config`).
  static Options publicOptions() => Options(extra: {_noAuth: true});

  /// Runs [call] and parses the body. On 401 the token is refreshed (single-flight, rotation) and
  /// [call] is invoked once more — the closure rebuilds multipart bodies, which cannot be re-sent.
  /// A second 401 ends the session ([TokenSource.onUnauthorized]).
  Future<T> run<T>(
    Future<Response<dynamic>> Function(Dio dio) call,
    T Function(dynamic data) parse, {
    bool auth = true,
  }) async {
    try {
      return await _once(call, parse);
    } on DeviceRevokedException {
      // Refreshing cannot help (the device, not the token, is rejected): ≤ 1 request to logout.
      if (auth) await tokens.onDeviceRevoked();
      rethrow;
    } on UnauthorizedException {
      if (!auth) rethrow;
      final fresh = await tokens.refreshAccessToken();
      if (fresh == null) rethrow;
      try {
        return await _once(call, parse);
      } on DeviceRevokedException {
        await tokens.onDeviceRevoked();
        rethrow;
      } on UnauthorizedException {
        Log.w('api: 401 after refresh');
        await tokens.onUnauthorized();
        rethrow;
      }
    }
  }

  Future<T> _once<T>(Future<Response<dynamic>> Function(Dio dio) call, T Function(dynamic data) parse) async {
    try {
      final res = await call(dio);
      onReachability?.call(true);
      return parse(res.data);
    } on DioException catch (e) {
      throw _map(e);
    }
  }

  ApiException _map(DioException e) {
    final inner = e.error;
    if (inner is ApiException) return inner;
    final res = e.response;
    if (res == null) {
      // A cancelled request says nothing about the network; everything else without an answer does.
      if (e.type != DioExceptionType.cancel) onReachability?.call(false);
      return const NetworkException();
    }
    onReachability?.call(true);
    final status = res.statusCode ?? 0;
    if (status == 401) {
      final body = res.data;
      final revoked = body is Map<String, dynamic> && body['code'] == 'DEVICE_REVOKED';
      return revoked ? const DeviceRevokedException() : const UnauthorizedException();
    }
    if (status == 426) {
      final body = res.data;
      final min = body is Map<String, dynamic> ? body['minAppVersion'] as String? : null;
      onUpgradeRequired?.call(min);
      return UpgradeRequiredException(min);
    }
    return ProblemException.fromJson(status, res.data);
  }
}

class _AuthInterceptor extends Interceptor {
  _AuthInterceptor(this.client);
  final ApiClient client;

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    options.headers['X-Device-Id'] = client.headers.deviceId;
    options.headers['X-App-Version'] = client.headers.appVersion;
    options.headers['Accept'] = 'application/json';
    if (options.extra[ApiClient._noAuth] != true) {
      final token = await client.tokens.accessToken();
      if (token != null) options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }
}
