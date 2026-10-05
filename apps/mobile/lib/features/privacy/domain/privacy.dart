/// Employee privacy notice (Q-46, UU PDP; ADR 0018). Pure Dart.
///
/// The server bundles one notice with an integer [PrivacyNotice.version]; `GET /api/v1/me` reports
/// [PrivacyStatus] (current version + the version the user acknowledged). A user has to read and acknowledge
/// ("Saya mengerti") the CURRENT version; until then the APK blocks attendance (selfie + GPS). The acknowledgement
/// is only ever recorded by the server — the phone never assumes it.
library;

/// `GET /api/v1/me` `privacy` (openapi `PrivacyStatus`). Null on a server without the feature.
class PrivacyStatus {
  const PrivacyStatus({required this.currentVersion, this.ackVersion, this.ackAt});

  final int currentVersion;

  /// Version the user acknowledged (null = never).
  final int? ackVersion;

  /// When (UTC ISO-8601, server clock).
  final String? ackAt;

  bool get acknowledged => ackVersion != null && ackVersion! >= currentVersion;

  /// Server answer of `POST /me/privacy-ack` applied to this status.
  PrivacyStatus acknowledge(int version, String at) =>
      PrivacyStatus(currentVersion: currentVersion, ackVersion: version, ackAt: at);

  Map<String, Object?> toJson() => {'currentVersion': currentVersion, 'ackVersion': ackVersion, 'ackAt': ackAt};

  /// Lenient parser (cached `/me` of older app versions, numbers as num). Null when absent / malformed.
  static PrivacyStatus? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final current = _int(raw['currentVersion']);
    if (current == null || current < 1) return null;
    final at = raw['ackAt'];
    return PrivacyStatus(currentVersion: current, ackVersion: _int(raw['ackVersion']), ackAt: at is String ? at : null);
  }

  @override
  bool operator ==(Object other) =>
      other is PrivacyStatus &&
      other.currentVersion == currentVersion &&
      other.ackVersion == ackVersion &&
      other.ackAt == ackAt;

  @override
  int get hashCode => Object.hash(currentVersion, ackVersion, ackAt);

  @override
  String toString() => 'PrivacyStatus(current: $currentVersion, ack: $ackVersion)';
}

/// `GET /api/v1/privacy-notice` (openapi `PrivacyNotice`). The APK renders [markdown] (the server's `html` is
/// for web clients) and keeps the last copy in the encrypted local DB for offline reading.
class PrivacyNotice {
  const PrivacyNotice({required this.version, required this.title, required this.markdown});

  final int version;
  final String title;
  final String markdown;

  Map<String, Object?> toJson() => {'version': version, 'title': title, 'markdown': markdown};

  static PrivacyNotice? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final v = _int(raw['version']);
    final title = raw['title'];
    final md = raw['markdown'];
    if (v == null || v < 1 || title is! String || md is! String || md.trim().isEmpty) return null;
    return PrivacyNotice(version: v, title: title, markdown: md);
  }
}

/// What the app does about the notice.
enum PrivacyGate {
  /// The server has no privacy notice (`/me` without `privacy`, e.g. a server before ADR 0018): nothing is blocked.
  notAvailable,

  /// The current version is acknowledged.
  acknowledged,

  /// Not acknowledged (never, or an older version): show the notice; attendance is blocked.
  required,
}

PrivacyGate privacyGateOf(PrivacyStatus? status) => switch (status) {
  null => PrivacyGate.notAvailable,
  final s when s.acknowledged => PrivacyGate.acknowledged,
  _ => PrivacyGate.required,
};

/// Thrown by the attendance service when attendance is attempted while the current notice is not acknowledged
/// (defence in depth behind the disabled buttons). The UI shows `privacyAttendanceBlocked`.
class PrivacyNoticeRequiredException implements Exception {
  const PrivacyNoticeRequiredException();
  @override
  String toString() => 'PrivacyNoticeRequiredException';
}

int? _int(Object? v) => switch (v) {
  final int i => i,
  final num n when n == n.roundToDouble() => n.toInt(),
  final String s => int.tryParse(s),
  _ => null,
};
