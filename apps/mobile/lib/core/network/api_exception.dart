/// Typed API failures with Bahasa Indonesia messages for the UI (RFC 9457 problem details from
/// `/api/v1`, architecture §6.2). The server message (`detail`) is preferred when it exists.
sealed class ApiException implements Exception {
  const ApiException();
  String get message;
  @override
  String toString() => '$runtimeType';
}

/// No route to the server (offline, DNS, timeout). Online-only actions must stay disabled.
class NetworkException extends ApiException {
  const NetworkException();
  @override
  String get message => 'Tidak ada koneksi ke server. Periksa sinyal atau data internet.';
}

/// 401 after a refresh attempt: token revoked, device revoked or user deactivated.
class UnauthorizedException extends ApiException {
  const UnauthorizedException();
  @override
  String get message => 'Sesi berakhir. Silakan masuk kembali.';
}

/// 401 `code: DEVICE_REVOKED`: the token is still valid but this install was revoked or marked lost
/// (Admin/Direktur or the user on another device, ADR 0003 §5). No refresh is attempted: the session
/// ends at once and the next login registers a fresh install id.
class DeviceRevokedException extends UnauthorizedException {
  const DeviceRevokedException();
  @override
  String get message => deviceRevokedMessage;
}

const deviceRevokedMessage =
    'Perangkat ini sudah dicabut dari akun Anda oleh Admin/Direktur. Silakan masuk kembali atau hubungi Admin.';

/// 426: APK older than company-settings.minAppVersion.
class UpgradeRequiredException extends ApiException {
  const UpgradeRequiredException(this.minAppVersion);
  final String? minAppVersion;
  @override
  String get message => 'Versi aplikasi terlalu lama. Perbarui aplikasi untuk melanjutkan.';
}

class FieldError {
  const FieldError(this.path, this.message);
  final String path;
  final String message;
}

class ProblemException extends ApiException {
  const ProblemException({
    required this.status,
    this.title,
    this.detail,
    this.code,
    this.errors = const [],
    this.body = const {},
  });

  final int status;

  /// Machine code of the problem (`code`, e.g. `COMPANY_NOT_ALLOWED`, `COMPANY_REQUIRED`), if any.
  final String? code;
  final String? title;
  final String? detail;
  final List<FieldError> errors;

  /// The whole problem body (extra members such as `balance` / `after` of a confirmable 409).
  final Map<String, dynamic> body;

  @override
  String get message {
    if (code == 'COMPANY_NOT_ALLOWED') return companyNotAllowedMessage;
    if (code == privacyAckRequiredCode) return privacyAckRequiredMessage;
    if (detail != null && detail!.trim().isNotEmpty) return detail!;
    if (errors.isNotEmpty) return errors.map((e) => e.message).join('\n');
    // QA-15 / QA-27: domain refusals of /api/v1 carry their Indonesian sentence in `title` (e.g. "Nota sudah
    // divalidasi Finance; nota tidak dapat dihapus."); HTTP reason phrases ("Conflict") never end with a period.
    final t = title?.trim();
    if (t != null && t.length > 10 && t.endsWith('.')) return t;
    return switch (status) {
      400 => 'Data yang dikirim tidak valid.',
      403 => 'Anda tidak berhak melakukan aksi ini.',
      404 => 'Data tidak ditemukan.',
      409 => 'Data sudah berubah. Muat ulang lalu coba lagi.',
      413 => 'Ukuran file terlalu besar.',
      422 => 'Permintaan tidak dapat diproses.',
      423 => 'Server sedang dikunci sementara. Coba lagi nanti.',
      429 => 'Terlalu banyak permintaan. Coba lagi sebentar lagi.',
      _ when status >= 500 => 'Server sedang bermasalah. Coba lagi nanti.',
      _ => 'Terjadi kesalahan ($status).',
    };
  }

  static ProblemException fromJson(int status, Object? body) {
    if (body is Map<String, dynamic>) {
      final errs = <FieldError>[];
      final raw = body['errors'];
      if (raw is List) {
        for (final e in raw) {
          if (e is Map<String, dynamic>) {
            errs.add(FieldError('${e['path'] ?? e['field'] ?? ''}', '${e['message'] ?? ''}'));
          }
        }
      }
      return ProblemException(
        status: status,
        title: body['title'] as String?,
        detail: body['detail'] as String?,
        code: body['code'] is String ? body['code'] as String : null,
        errors: errs,
        body: body,
      );
    }
    return ProblemException(status: status);
  }
}

/// 403 `COMPANY_NOT_ALLOWED` of a read (MC3): the PT selection named a PT without membership.
const companyNotAllowedMessage =
    'Akses Anda ke salah satu PT yang dipilih sudah berubah. Pilihan PT dikembalikan ke "Semua PT"; muat ulang.';

/// ADR 0018 (owner 2026-10-05): the server refuses attendance captures (selfie upload `403`, sync item `rejected`)
/// while the minimum APK version is ≥ 0.3.3 and the current privacy notice is not acknowledged. The app normally
/// blocks attendance itself before that; this reaches it e.g. when a new notice version was published while the
/// phone still had the old acknowledgement cached. The app reloads `/me`, which brings the notice screen back.
const privacyAckRequiredCode = 'PRIVACY_ACK_REQUIRED';
const privacyAckRequiredMessage =
    'Absensi ditolak server: pemberitahuan privasi terbaru belum Anda setujui. Buka Profil → Pemberitahuan privasi, '
    'tekan "Saya mengerti", lalu absen ulang.';
