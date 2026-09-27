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

/// Attendance location type (E6, Q-40): a project or a cost center ("pusat biaya", e.g. an office).
enum SiteKind {
  project('project_id', 'project'),
  costCenter('cost_center_id', 'cost_center');

  const SiteKind(this.payloadKey, this.code);

  /// Key in `SyncAttendancePayload` / `SyncOnBehalfPayload` (exactly one of the two is sent).
  final String payloadKey;

  /// `AttendanceLocationRef.type`.
  final String code;

  static SiteKind fromCode(String? c) => c == 'cost_center' ? costCenter : project;
}

/// Geofence of an assigned location from the cached masters (`projects` / `cost-centers`: lat, lng,
/// radiusM).
class ProjectSite {
  const ProjectSite({
    required this.id,
    required this.label,
    this.lat,
    this.lng,
    this.radiusM,
    this.kind = SiteKind.project,
  });
  final int id;
  final String label;
  final double? lat;
  final double? lng;
  final double? radiusM;
  final SiteKind kind;

  bool get hasGeofence => lat != null && lng != null && radiusM != null;

  /// Unique across both kinds (`p7`, `c3`) — dropdown value.
  String get key => '${kind == SiteKind.project ? 'p' : 'c'}$id';

  static ProjectSite fromMaster(MasterItem m, {SiteKind kind = SiteKind.project}) {
    double? d(String k) => (m.extra[k] as num?)?.toDouble();
    return ProjectSite(id: m.id, label: m.label, lat: d('lat'), lng: d('lng'), radiusM: d('radiusM'), kind: kind);
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

({SiteCheck check, int? distanceM}) checkSite(ProjectSite site, LocationFix fix) {
  if (fix.isMocked) return (check: SiteCheck.mocked, distanceM: null);
  if (!site.hasGeofence) return (check: SiteCheck.noGeofence, distanceM: null);
  final dist = haversineM(fix.lat, fix.lng, site.lat!, site.lng!);
  final allowance = min(max(fix.accuracyM, 0.0), accuracyAllowanceCapM);
  return (check: dist <= site.radiusM! + allowance ? SiteCheck.ok : SiteCheck.outside, distanceM: dist.round());
}

/// `SyncAttendancePayload` (openapi) with the local selfie id in [selfiePlaceholderKey]; the sync engine
/// uploads the selfie (`POST /media/selfies`) and replaces it with `selfie_media_id` just before sending.
/// Exactly one of `project_id` / `cost_center_id` (E6).
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
