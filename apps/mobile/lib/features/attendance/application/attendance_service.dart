import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:camera/camera.dart' show CameraLensDirection;
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../core/db/app_database.dart';
import '../../../core/format/dates.dart';
import '../../../core/location/location_service.dart';
import '../../../core/media/compress_plan.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../core/time/device_clock.dart';
import '../../app_config/application/app_config_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/draft_repository.dart';
import '../../expense/presentation/camera_capture_screen.dart';
import '../../masters/domain/master_item.dart';
import '../../privacy/application/privacy_providers.dart';
import '../../privacy/domain/privacy.dart';
import '../../sync/data/outbox_repository.dart';
import '../../sync/domain/sync_models.dart';
import '../domain/attendance.dart';

/// Queues own check-in/out: selfie compressed on the device (720 px, ≤ 150 KB, EXIF dropped) and kept
/// encrypted in the local DB, then one outbox item (works without signal; ADR 0010 decisions 5/7).
class AttendanceService {
  AttendanceService({
    required this.drafts,
    required this.outbox,
    required this.clock,
    required this.compressor,
    this.privacyBlocked,
  });
  final DraftRepository drafts;
  final OutboxRepository outbox;
  final DeviceClock clock;
  final PhotoCompressor compressor;

  /// ADR 0018: true while the current privacy notice is not acknowledged on the server → nothing is recorded
  /// ([PrivacyNoticeRequiredException]); the screens already disable the buttons and never open the camera.
  final bool Function()? privacyBlocked;

  void _checkPrivacy() {
    if (privacyBlocked?.call() ?? false) throw const PrivacyNoticeRequiredException();
  }

  Future<String> record({
    required String sub,
    required AttendanceKind kind,
    required ProjectSite site,
    required LocationFix fix,
    required Uint8List rawSelfie,
    required bool online,
  }) async {
    _checkPrivacy();
    final photo = await compressor.compress(rawSelfie, PhotoTarget.selfie);
    final selfieUuid = const Uuid().v7();
    await drafts.addMedia(sub, uuid: selfieUuid, kind: 'selfie', bytes: photo.bytes, sha256: photo.sha256Hex);
    return outbox.enqueueAttendance(
      sub: sub,
      type: kind.itemType,
      payload: attendancePayload(site: site, fix: fix, selfieUuid: selfieUuid),
      selfieUuid: selfieUuid,
      deviceTime: isoWithOffset(clock.now()),
      elapsedMs: await clock.elapsedMs(),
      bootId: await clock.bootId(),
      offline: !online,
      // MC3: the PT of the chosen project / cost center / site (never the switcher selection).
      companyId: site.companyId,
      siteId: site.kind == SiteKind.site ? site.id : null,
    );
  }

  /// US-14 "diabsenkan PM": the PM photographs the employee (front or back camera), the fix is the PM's
  /// phone, reason mandatory. Queued like an own check-in (works offline); the server checks PM role,
  /// team location, assignment of the employee, geofence and mock location.
  Future<String> recordOnBehalf({
    required String sub,
    required int employeeId,
    required AttendanceKind kind,
    required ProjectSite site,
    required LocationFix fix,
    required Uint8List rawPhoto,
    required CameraLens lens,
    required String reason,
    required bool online,
  }) async {
    _checkPrivacy();
    final photo = await compressor.compress(rawPhoto, PhotoTarget.selfie);
    final photoUuid = const Uuid().v7();
    await drafts.addMedia(sub, uuid: photoUuid, kind: 'selfie', bytes: photo.bytes, sha256: photo.sha256Hex);
    return outbox.enqueueAttendance(
      sub: sub,
      type: SyncItemType.attendanceOnBehalf,
      payload: onBehalfPayload(
        employeeId: employeeId,
        kind: kind,
        site: site,
        fix: fix,
        photoUuid: photoUuid,
        lens: lens,
        reason: reason,
      ),
      selfieUuid: photoUuid,
      deviceTime: isoWithOffset(clock.now()),
      elapsedMs: await clock.elapsedMs(),
      bootId: await clock.bootId(),
      offline: !online,
      companyId: site.companyId,
      siteId: site.kind == SiteKind.site ? site.id : null,
    );
  }
}

final attendanceServiceProvider = Provider(
  (ref) => AttendanceService(
    drafts: ref.watch(draftRepositoryProvider),
    outbox: ref.watch(outboxRepositoryProvider),
    clock: ref.watch(deviceClockProvider),
    compressor: ref.watch(photoCompressorProvider),
    privacyBlocked: () => ref.read(attendanceBlockedByPrivacyProvider),
  ),
);

final locationServiceProvider = Provider<LocationService>((ref) => GeolocatorLocationService());

typedef SelfieCapture = Future<Uint8List?> Function(BuildContext context, String title);

/// Front camera only, no gallery (ADR 0010 decision 11). Overridden in widget tests.
final selfieCaptureProvider = Provider<SelfieCapture>(
  (ref) =>
      (context, title) => Navigator.of(context).push<Uint8List>(
        MaterialPageRoute(
          builder: (_) => CameraCaptureScreen(lens: CameraLensDirection.front, title: title),
        ),
      ),
);

typedef LensCapture = Future<Uint8List?> Function(BuildContext context, String title, CameraLens lens);

/// On-behalf photo (US-14): the PM chooses the front or back camera; no gallery. Overridden in tests.
final onBehalfCaptureProvider = Provider<LensCapture>(
  (ref) =>
      (context, title, lens) => Navigator.of(context).push<Uint8List>(
        MaterialPageRoute(
          builder: (_) => CameraCaptureScreen(
            lens: lens == CameraLens.front ? CameraLensDirection.front : CameraLensDirection.back,
            title: title,
          ),
        ),
      ),
);

/// Cached masters of the switcher scope (MC3: locations of the selected PTs; each carries its PT and the
/// attendance item is queued in that PT).
Future<Map<String, List<MasterItem>>> _scopedMasters(Ref ref, String sub) {
  final profile = ref.watch(currentProfileProvider);
  final scope = profile == null || profile.companies.isEmpty ? null : profile.scopedCompanies.map((c) => c.id);
  return ref.watch(mastersRepositoryProvider).cached(sub, companyIds: scope);
}

/// ADR 0023: every cached site of the scope (active only — `cached` drops deactivated rows) with the caller's
/// flags `home` / `assigned` / `team` from the server.
final _masterSitesProvider = FutureProvider<List<ProjectSite>>((ref) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  ref.watch(mastersRevisionProvider);
  final masters = await _scopedMasters(ref, sub);
  return [
    for (final m in masters[MasterTypes.sites] ?? const <MasterItem>[]) ProjectSite.fromMaster(m, kind: SiteKind.site),
  ];
});

/// Locations of the user (masters are access-filtered server-side: Staff = assigned, PM = team), with
/// their geofence: ADR 0023 sites where the user may check in (home site = "Site penempatan" first, then the
/// sites of a team assignment), projects (archived hidden) and cost centers ("pusat biaya", E6 Q-40). The first
/// entry is the default of the picker, so a stationed employee starts at the home site.
final attendanceSitesProvider = FutureProvider<List<ProjectSite>>((ref) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  ref.watch(mastersRevisionProvider);
  final masters = await _scopedMasters(ref, sub);
  final sites = [
    for (final s in await ref.watch(_masterSitesProvider.future))
      if (s.home || s.assigned) s,
  ];
  return [
    for (final s in sites)
      if (s.home) s,
    for (final s in sites)
      if (!s.home) s,
    for (final m in masters[MasterTypes.projects] ?? const <MasterItem>[])
      if (m.extra['status'] != 'arsip') ProjectSite.fromMaster(m),
    for (final m in masters[MasterTypes.costCenters] ?? const <MasterItem>[])
      ProjectSite.fromMaster(m, kind: SiteKind.costCenter),
  ];
});

/// Candidate for "diabsenkan PM": an employee and the team locations they are assigned to today.
class OnBehalfCandidate {
  const OnBehalfCandidate({required this.employeeId, required this.name, required this.sites});
  final int employeeId;
  final String name;
  final List<ProjectSite> sites;
}

/// Team members of the PM from the cached `team-assignments` masters (works offline; the server
/// re-checks the assignment on the local date). The PM's own employee is excluded (never own).
/// ADR 0023 (Q-S5): at a site of the PM's team (`team`), the members are the employees stationed there
/// (`employees.homeSite`) and those with a team assignment to the site.
final onBehalfCandidatesProvider = FutureProvider<List<OnBehalfCandidate>>((ref) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  final profile = ref.watch(currentProfileProvider);
  // MC3: the PM's own employee of EVERY PT is excluded; only locations of PTs where the user is PM.
  final own = profile?.employeeIds ?? const <int>{};
  final masters = await _scopedMasters(ref, sub);
  bool pmIn(ProjectSite s) =>
      profile == null || profile.companies.isEmpty || profile.forCompany(s.companyId).canAttendOnBehalf;
  final sites = [
    for (final s in await ref.watch(attendanceSitesProvider.future))
      if (s.kind != SiteKind.site && pmIn(s)) s,
    for (final s in await ref.watch(_masterSitesProvider.future))
      if (s.team && pmIn(s)) s,
  ];
  final names = {for (final e in masters[MasterTypes.employees] ?? const <MasterItem>[]) e.id: e.label};
  final today = toYmd(DateTime.now());
  final byEmployee = <int, List<ProjectSite>>{};
  void add(int emp, ProjectSite? site) {
    if (site == null || own.contains(emp)) return;
    final list = byEmployee.putIfAbsent(emp, () => []);
    if (!list.any((s) => s.key == site.key)) list.add(site);
  }

  ProjectSite? find(SiteKind kind, int? id) =>
      id == null ? null : sites.where((s) => s.kind == kind && s.id == id).firstOrNull;
  for (final a in masters[MasterTypes.teamAssignments] ?? const <MasterItem>[]) {
    final emp = (a.extra['employee'] as num?)?.toInt();
    if (emp == null) continue;
    String? day(Object? v) => v is String && v.length >= 10 ? v.substring(0, 10) : null;
    final start = day(a.extra['startDate']);
    final end = day(a.extra['endDate']);
    if (start != null && start.compareTo(today) > 0) continue;
    if (end != null && end.compareTo(today) < 0) continue;
    int? id(String k) => (a.extra[k] as num?)?.toInt();
    add(
      emp,
      find(SiteKind.project, id('project')) ??
          find(SiteKind.costCenter, id('costCenter')) ??
          find(SiteKind.site, id('site')),
    );
  }
  // ADR 0023: stationed at a team site (no assignment rows needed)
  for (final e in masters[MasterTypes.employees] ?? const <MasterItem>[]) {
    add(e.id, find(SiteKind.site, (e.extra['homeSite'] as num?)?.toInt()));
  }
  final out = [
    for (final e in byEmployee.entries)
      OnBehalfCandidate(employeeId: e.key, name: names[e.key] ?? '#${e.key}', sites: e.value),
  ]..sort((a, b) => a.name.compareTo(b.name));
  return out;
});

/// MC3: own check-in / on-behalf allowed in PT [companyId] (`companies[].settings.syncAttendanceEnabled`);
/// an unknown PT (server before MC3) falls back to `/app/config` `features.syncAttendance`.
final attendanceEnabledForProvider = Provider.family<bool, int?>((ref, companyId) {
  final c = ref.watch(accountProfileProvider)?.company(companyId);
  return c?.settings.syncAttendanceEnabled ?? (ref.watch(appConfigProvider).value?.syncAttendance ?? false);
});

/// Check-in allowed in at least one PT of the switcher scope (home tile, team tab).
final attendanceEnabledAnyProvider = Provider<bool>((ref) {
  final p = ref.watch(currentProfileProvider);
  if (p == null || p.companies.isEmpty) return ref.watch(appConfigProvider).value?.syncAttendance ?? false;
  return p.scopedCompanies.any((c) => c.settings.syncAttendanceEnabled);
});

/// Latest attendance items of this user in the outbox (queued / sent / rejected).
final attendanceItemsProvider = StreamProvider<List<OutboxData>>((ref) {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return Stream.value(const []);
  return ref.watch(outboxRepositoryProvider).watchAttendance(sub);
});
