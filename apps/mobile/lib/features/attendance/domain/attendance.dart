import 'dart:math';

import '../../../core/location/location_service.dart';
import '../../expense/data/expense_mappers.dart' show selfiePlaceholderKey;
import '../../masters/domain/master_item.dart';
import '../../sync/domain/sync_models.dart';

/// Own attendance (F4 slice of US-01/US-02; the server re-checks everything — ADR 0010 decision 8).
enum AttendanceKind {
  checkIn(SyncItemType.attendanceCheckIn, 'Absen masuk'),
  checkOut(SyncItemType.attendanceCheckOut, 'Absen pulang');

  const AttendanceKind(this.itemType, this.label);
  final String itemType;
  final String label;

  static AttendanceKind? fromItemType(String t) => AttendanceKind.values.where((k) => k.itemType == t).firstOrNull;
}

/// Attendance location type (E6, Q-40): a project, a cost center ("pusat biaya", e.g. an office) or — ADR 0023 — a
/// site (kantor cabang of the PT, `masters.sites`).
enum SiteKind {
  project('project_id', 'project', 'p'),
  costCenter('cost_center_id', 'cost_center', 'c'),
  site('site_id', 'site', 's');

  const SiteKind(this.payloadKey, this.code, this.prefix);

  /// Key in `SyncAttendancePayload` / `SyncOnBehalfPayload` (exactly one of the three is sent).
  final String payloadKey;

  /// `AttendanceLocationRef.type`.
  final String code;

  /// Prefix of [ProjectSite.key] (`p7`, `c3`, `s2`).
  final String prefix;

  static SiteKind fromCode(String? c) => switch (c) {
    'cost_center' => costCenter,
    'site' => site,
    _ => project,
  };
}

/// DRMS 13/10 A2: attendance type of the user's employee in a PT (`GET /attendance/locations` → `employees[]`).
/// OnSite = any registered location of the PT with a point (no assignment); Non-OnSite = head office + branch
/// offices (sites) only. The server applies the same rule (apps/web/src/domain/attendance/area.ts).
enum AttendanceType {
  onsite('onsite'),
  nonOnsite('non_onsite');

  const AttendanceType(this.code);
  final String code;

  static AttendanceType fromCode(String? c) => c == 'non_onsite' ? nonOnsite : onsite;
}

/// Geofence of a check-in location: from `GET /attendance/locations` (DRMS 13/10 A2, eligible by attendance type) or,
/// with a server before A2, from the cached masters (`projects` / `cost-centers` / `sites`: lat, lng, radiusM).
class ProjectSite {
  const ProjectSite({
    required this.id,
    required this.label,
    this.lat,
    this.lng,
    this.radiusM,
    this.kind = SiteKind.project,
    this.companyId,
    this.home = false,
    this.assigned = false,
    this.team = false,
    this.isHeadOffice = false,
    this.attendanceType,
  });
  final int id;

  /// MC3: PT of the project / cost center; the attendance item is queued in this PT.
  final int? companyId;
  final String label;
  final double? lat;
  final double? lng;
  final double? radiusM;
  final SiteKind kind;

  /// ADR 0023 (sites only, from `masters.sites`): the user's own employee is stationed here ("Site penempatan").
  final bool home;

  /// ADR 0023 (sites only): the user's own employee has an active team assignment to this site today.
  final bool assigned;

  /// ADR 0023 (sites only): the user may record "diabsenkan PM" here (PM assigned to the site / PM of a project of it).
  final bool team;

  /// DRMS 13/10 A2 (sites only): the PT's head office ("Kantor pusat").
  final bool isHeadOffice;

  /// DRMS 13/10 A2: attendance type of the user's employee in this location's PT (eligible list only; null = from the
  /// masters of a server before A2).
  final AttendanceType? attendanceType;

  bool get hasGeofence => lat != null && lng != null && radiusM != null;

  /// Unique across the kinds (`p7`, `c3`, `s2`) — dropdown value.
  String get key => '${kind.prefix}$id';

  static ProjectSite fromMaster(MasterItem m, {SiteKind kind = SiteKind.project}) {
    double? d(String k) => (m.extra[k] as num?)?.toDouble();
    return ProjectSite(
      id: m.id,
      label: m.label,
      lat: d('lat'),
      lng: d('lng'),
      radiusM: d('radiusM'),
      kind: kind,
      companyId: m.companyId,
      home: m.extra['home'] == true,
      assigned: m.extra['assigned'] == true,
      team: m.extra['team'] == true,
      isHeadOffice: m.extra['isHeadOffice'] == true,
    );
  }

  /// One item of `GET /attendance/locations` (`AttendanceLocations.items[]`): always with a point and the radius the
  /// server checks (own radius, else the PT default).
  static ProjectSite fromEligible(Map<String, dynamic> j, {AttendanceType? type}) {
    String s(String k) => j[k] == null ? '' : '${j[k]}';
    final code = s('code');
    final name = s('name');
    final id = (j['id'] as num?)?.toInt() ?? 0;
    final label = code.isNotEmpty ? '$code — $name' : name;
    return ProjectSite(
      id: id,
      label: label.isEmpty ? '#$id' : label,
      lat: (j['lat'] as num?)?.toDouble(),
      lng: (j['lng'] as num?)?.toDouble(),
      radiusM: (j['radiusM'] as num?)?.toDouble(),
      kind: SiteKind.fromCode(j['kind'] as String?),
      companyId: (j['company'] as num?)?.toInt(),
      home: j['home'] == true,
      isHeadOffice: j['isHeadOffice'] == true,
      attendanceType: type,
    );
  }
}

/// Same rule as the server (apps/web/src/domain/sync/attendance.ts): haversine, radius + accuracy
/// allowance capped at 50 m. Client side it only enables the buttons (US-01); never trusted.
const accuracyAllowanceCapM = 50.0;

double haversineM(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371008.8;
  double rad(double d) => d * pi / 180;
  final dLat = rad(lat2 - lat1);
  final dLng = rad(lng2 - lng1);
  final a = pow(sin(dLat / 2), 2) + cos(rad(lat1)) * cos(rad(lat2)) * pow(sin(dLng / 2), 2);
  return 2 * r * asin(min(1.0, sqrt(a)));
}

enum SiteCheck { ok, outside, noGeofence, mocked }

/// A location whose distance to the fix was measured.
class AreaMatch {
  const AreaMatch(this.site, this.distance);
  final ProjectSite site;

  /// Metres (unrounded; [distanceM] for display).
  final double distance;
  int get distanceM => distance.round();
}

/// DRMS 13/10 A2: result of matching a GPS fix against the eligible locations.
class AreaDetection {
  const AreaDetection({this.inside = const [], this.nearest});

  /// Locations whose geofence contains the fix, nearest first (ties keep the list order: home site first).
  final List<AreaMatch> inside;

  /// Nearest location with a point (inside or not); null when none has a point.
  final AreaMatch? nearest;

  /// Exactly one area → selected automatically.
  bool get single => inside.length == 1;

  /// Overlapping geofences → the nearest is proposed and the user picks among [inside].
  bool get overlap => inside.length > 1;
}

/// Automatic area detection (DRMS 13/10 A2): the location whose geofence contains the fix (nearest when several
/// overlap); none → manual choice (fallback) with [AreaDetection.nearest] as a hint. Same distance and accuracy
/// allowance as [checkSite] and the server; a mocked fix detects nothing (refused anyway).
AreaDetection detectArea(List<ProjectSite> sites, LocationFix fix) {
  if (fix.isMocked) return const AreaDetection();
  final allowance = min(max(fix.accuracyM, 0.0), accuracyAllowanceCapM);
  final measured = <(int, AreaMatch)>[
    for (final (i, s) in sites.indexed)
      if (s.hasGeofence) (i, AreaMatch(s, haversineM(fix.lat, fix.lng, s.lat!, s.lng!))),
  ];
  // List.sort is not stable: the list index breaks ties
  measured.sort((a, b) {
    final d = a.$2.distance.compareTo(b.$2.distance);
    return d != 0 ? d : a.$1.compareTo(b.$1);
  });
  return AreaDetection(
    inside: [
      for (final (_, m) in measured)
        if (m.distance <= m.site.radiusM! + allowance) m,
    ],
    nearest: measured.isEmpty ? null : measured.first.$2,
  );
}

({SiteCheck check, int? distanceM}) checkSite(ProjectSite site, LocationFix fix) {
  if (fix.isMocked) return (check: SiteCheck.mocked, distanceM: null);
  if (!site.hasGeofence) return (check: SiteCheck.noGeofence, distanceM: null);
  final dist = haversineM(fix.lat, fix.lng, site.lat!, site.lng!);
  final allowance = min(max(fix.accuracyM, 0.0), accuracyAllowanceCapM);
  return (check: dist <= site.radiusM! + allowance ? SiteCheck.ok : SiteCheck.outside, distanceM: dist.round());
}

/// `SyncAttendancePayload` (openapi) with the local selfie id in [selfiePlaceholderKey]; the sync engine
/// uploads the selfie (`POST /media/selfies`) and replaces it with `selfie_media_id` just before sending.
/// Exactly one of `project_id` / `cost_center_id` / `site_id` (E6, ADR 0023).
Map<String, dynamic> attendancePayload({
  required ProjectSite site,
  required LocationFix fix,
  required String selfieUuid,
}) => {
  site.kind.payloadKey: site.id,
  'lat': fix.lat,
  'lng': fix.lng,
  'accuracy_m': double.parse(fix.accuracyM.toStringAsFixed(1)),
  'is_mocked': fix.isMocked,
  'camera_lens': 'front',
  selfiePlaceholderKey: selfieUuid,
};

/// Camera used by the PM for an on-behalf photo (the employee may stand in front of the PM's phone).
enum CameraLens { front, back }

/// `SyncOnBehalfPayload` (US-14, PM only): the employee's photo is taken and uploaded by the PM; the
/// GPS fix is the PM's phone; the reason is mandatory (3–500 characters).
Map<String, dynamic> onBehalfPayload({
  required int employeeId,
  required AttendanceKind kind,
  required ProjectSite site,
  required LocationFix fix,
  required String photoUuid,
  required CameraLens lens,
  required String reason,
}) => {
  'employee_id': employeeId,
  'kind': kind == AttendanceKind.checkIn ? 'check_in' : 'check_out',
  site.kind.payloadKey: site.id,
  'lat': fix.lat,
  'lng': fix.lng,
  'accuracy_m': double.parse(fix.accuracyM.toStringAsFixed(1)),
  'is_mocked': fix.isMocked,
  'camera_lens': lens.name,
  'reason': reason.trim(),
  selfiePlaceholderKey: photoUuid,
};
