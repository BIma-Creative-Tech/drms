import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_exception.dart';

/// DRMS 26/10 #3: may a failed provider read be retried automatically? Only failures a later attempt can fix: no
/// connection / timeout ([NetworkException]), 5xx, 408 and 429. A server answer about the request itself (400, 403,
/// 404, 409 "Akun Anda belum terhubung ke data karyawan", 422, …), 401 (the `ApiClient` already refreshed once; a
/// second 401 ends the session) and 426 (old APK) are final — retrying them only kept the screen loading for ~30 s
/// before the message showed. Other exceptions (local DB, parsing) keep Riverpod's default.
bool isRetryableError(Object error) => switch (error) {
  NetworkException() => true,
  ProblemException(:final status) => status >= 500 || status == 408 || status == 429,
  ApiException() => false,
  _ => true,
};

/// Global `ProviderScope.retry` (lib/main.dart): Riverpod 3 retries every failed provider up to 10 times
/// (200 ms … 6.4 s backoff) while the UI shows "loading"; same backoff, but never for a final API answer
/// ([isRetryableError]). The offline sync queue does not use provider retries (its own backoff, sync_engine.dart).
Duration? providerRetry(int retryCount, Object error) {
  if (!isRetryableError(error)) return null;
  return ProviderContainer.defaultRetry(retryCount, error);
}
