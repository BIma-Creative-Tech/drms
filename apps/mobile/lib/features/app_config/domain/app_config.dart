/// `GET /api/v1/app/config` (F4 backend, parsed defensively: every field optional).
class AppConfig {
  const AppConfig({
    this.minAppVersion,
    this.latestAppVersion,
    this.appDownloadUrl,
    this.serverTime,
    this.timezone,
    this.pushEnabled = false,
    this.syncExpenseDrafts = true,
    this.syncAttendance = false,
    this.syncProgressReports = false,
  });
  final String? minAppVersion;
  final String? latestAppVersion;
  final String? appDownloadUrl;
  final String? serverTime;
  final String? timezone;
  final bool pushEnabled;
  final bool syncExpenseDrafts;

  /// Own check-in/out from the APK (company-settings.syncAttendanceEnabled, F4b).
  final bool syncAttendance;

  /// Progress reports through the offline queue (company-settings.syncProgressReportsEnabled, E4). When
  /// false (or an older server without the flag) reports are sent online only (POST /progress-reports).
  final bool syncProgressReports;

  factory AppConfig.fromJson(Map<String, dynamic> j) {
    String? s(String k) => j[k] is String && (j[k] as String).isNotEmpty ? j[k] as String : null;
    final features = j['features'] is Map<String, dynamic> ? j['features'] as Map<String, dynamic> : const {};
    // Backend 0.2.1 names (minSupportedVersion/latestVersion/downloadUrl); older names kept as fallback.
    return AppConfig(
      minAppVersion: s('minSupportedVersion') ?? s('minAppVersion'),
      latestAppVersion: s('latestVersion') ?? s('latestAppVersion'),
      appDownloadUrl: s('downloadUrl') ?? s('appDownloadUrl'),
      serverTime: s('serverTime'),
      timezone: s('timezone'),
      pushEnabled: features['pushEnabled'] == true,
      syncExpenseDrafts: features['syncExpenseDrafts'] != false,
      syncAttendance: features['syncAttendance'] == true,
      syncProgressReports: features['syncProgressReports'] == true,
    );
  }
}

/// Compares dotted numeric versions (`0.1.10` > `0.1.9`); build suffixes (`+12`) are ignored.
int compareVersions(String a, String b) {
  List<int> parts(String v) => v.split('+').first.split('-').first.split('.').map((p) => int.tryParse(p) ?? 0).toList();
  final pa = parts(a);
  final pb = parts(b);
  for (var i = 0; i < (pa.length > pb.length ? pa.length : pb.length); i++) {
    final x = i < pa.length ? pa[i] : 0;
    final y = i < pb.length ? pb[i] : 0;
    if (x != y) return x < y ? -1 : 1;
  }
  return 0;
}

enum VersionGate { ok, updateAvailable, updateRequired }

VersionGate evaluateVersion(String current, AppConfig? cfg) {
  if (cfg == null) return VersionGate.ok;
  if (cfg.minAppVersion != null && compareVersions(current, cfg.minAppVersion!) < 0) {
    return VersionGate.updateRequired;
  }
  if (cfg.latestAppVersion != null && compareVersions(current, cfg.latestAppVersion!) < 0) {
    return VersionGate.updateAvailable;
  }
  return VersionGate.ok;
}
