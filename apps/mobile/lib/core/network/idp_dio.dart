import 'package:dio/dio.dart';

/// dio for the Keycloak issuer host (token / logout endpoints). Deliberately separate from the
/// `/api/v1` [ApiClient]: no auth interceptor, no device headers, and every status code is returned
/// to the caller (`validateStatus: (_) => true`) so OAuth error bodies (RFC 6749 §5.2) can be mapped.
/// No logging interceptor: these requests carry passwords and refresh tokens.
Dio createIdpDio() => Dio(
  BaseOptions(
    connectTimeout: const Duration(seconds: 15),
    sendTimeout: const Duration(seconds: 20),
    receiveTimeout: const Duration(seconds: 20),
    responseType: ResponseType.json,
  ),
);

/// Form-encoded POST options for the Keycloak token / logout endpoints.
Options idpFormOptions() => Options(contentType: Headers.formUrlEncodedContentType, validateStatus: (_) => true);
