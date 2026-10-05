import 'dart:convert';

import 'package:dio/dio.dart';

import '../../../core/db/app_database.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../domain/privacy.dart';

/// Answer of `POST /api/v1/me/privacy-ack` (openapi `PrivacyAck`).
class PrivacyAckResult {
  const PrivacyAckResult({required this.version, required this.ackAt, required this.alreadyAcknowledged});
  final int version;
  final String ackAt;
  final bool alreadyAcknowledged;
}

/// 409 `PRIVACY_VERSION_MISMATCH`: the server serves another notice version than the one shown.
const privacyVersionMismatchCode = 'PRIVACY_VERSION_MISMATCH';

/// `GET /privacy-notice` (public) + `POST /me/privacy-ack` (ADR 0018).
class PrivacyApi {
  PrivacyApi(this.client);
  final ApiClient client;

  /// The current notice, or null when the server has none (404: server before ADR 0018 — never an error).
  Future<PrivacyNotice?> notice() async {
    try {
      return await client.run(
        (d) => d.get<dynamic>('/privacy-notice', options: ApiClient.allCompanies(ApiClient.publicOptions())),
        PrivacyNotice.fromJson,
        auth: false,
      );
    } on ProblemException catch (e) {
      if (e.status == 404) return null;
      rethrow;
    }
  }

  /// Acknowledges [version]. [idempotencyKey] stays the same for retries of one acknowledgement. Null when the
  /// server has no such endpoint (404).
  Future<PrivacyAckResult?> acknowledge(int version, {required String idempotencyKey}) async {
    try {
      return await client.run(
        (d) => d.post<dynamic>(
          '/me/privacy-ack',
          data: {'version': version},
          options: ApiClient.allCompanies(Options(headers: {'Idempotency-Key': idempotencyKey})),
        ),
        (data) {
          final m = data is Map ? data : const {};
          final v = m['version'];
          return PrivacyAckResult(
            version: v is num ? v.toInt() : version,
            ackAt: '${m['ackAt'] ?? ''}',
            alreadyAcknowledged: m['alreadyAcknowledged'] == true,
          );
        },
      );
    } on ProblemException catch (e) {
      if (e.status == 404) return null;
      rethrow;
    }
  }
}

/// Last notice the phone received, in the encrypted local DB (offline reading). Not per user: the text is the same
/// for everyone; the acknowledgement lives on the server.
class PrivacyNoticeCache {
  PrivacyNoticeCache(this.db);
  final AppDatabase db;

  static const key = 'privacy.notice';

  Future<PrivacyNotice?> read() async {
    try {
      return PrivacyNotice.fromJson(await db.kvGetJson(key));
    } on Object {
      return null;
    }
  }

  Future<void> write(PrivacyNotice n) => db.kvPut(key, jsonEncode(n.toJson()));
}
