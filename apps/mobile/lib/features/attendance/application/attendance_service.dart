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
import '../../auth/application/auth_controller.dart';
import '../../expense/data/draft_repository.dart';
import '../../expense/presentation/camera_capture_screen.dart';
import '../../masters/domain/master_item.dart';
import '../../sync/data/outbox_repository.dart';
import '../../sync/domain/sync_models.dart';
import '../domain/attendance.dart';

/// Queues own check-in/out: selfie compressed on the device (720 px, ≤ 150 KB, EXIF dropped) and kept
/// encrypted in the local DB, then one outbox item (works without signal; ADR 0010 decisions 5/7).
class AttendanceService {
  AttendanceService({required this.drafts, required this.outbox, required this.clock, required this.compressor});
  final DraftRepository drafts;
  final OutboxRepository outbox;
  final DeviceClock clock;
  final PhotoCompressor compressor;

  Future<String> record({
    required String sub,
    required AttendanceKind kind,
    required ProjectSite site,
    required LocationFix fix,
    required Uint8List rawSelfie,
    required bool online,
  }) async {
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
    );
  }
}

final attendanceServiceProvider = Provider(
  (ref) => AttendanceService(
    drafts: ref.watch(draftRepositoryProvider),
    outbox: ref.watch(outboxRepositoryProvider),
    clock: ref.watch(deviceClockProvider),
    compressor: ref.watch(photoCompressorProvider),
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

/// Locations of the user (masters are access-filtered server-side: Staff = assigned, PM = team), with
/// their geofence: projects (archived hidden) and cost centers ("pusat biaya", E6 Q-40).
final attendanceSitesProvider = FutureProvider<List<ProjectSite>>((ref) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  final masters = await ref.watch(mastersRepositoryProvider).cached(sub);
  return [
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
final onBehalfCandidatesProvider = FutureProvider<List<OnBehalfCandidate>>((ref) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  final own = ref.watch(currentProfileProvider)?.employee?.id;
  final masters = await ref.watch(mastersRepositoryProvider).cached(sub);
  final sites = await ref.watch(attendanceSitesProvider.future);
  final names = {for (final e in masters[MasterTypes.employees] ?? const <MasterItem>[]) e.id: e.label};
  final today = toYmd(DateTime.now());
  final byEmployee = <int, List<ProjectSite>>{};
  for (final a in masters[MasterTypes.teamAssignments] ?? const <MasterItem>[]) {
    final emp = (a.extra['employee'] as num?)?.toInt();
    if (emp == null || emp == own) continue;
    String? day(Object? v) => v is String && v.length >= 10 ? v.substring(0, 10) : null;
    final start = day(a.extra['startDate']);
    final end = day(a.extra['endDate']);
    if (start != null && start.compareTo(today) > 0) continue;
    if (end != null && end.compareTo(today) < 0) continue;
    final project = (a.extra['project'] as num?)?.toInt();
    final cc = (a.extra['costCenter'] as num?)?.toInt();
    final site = sites
        .where(
          (s) =>
              (project != null && s.kind == SiteKind.project && s.id == project) ||
              (cc != null && s.kind == SiteKind.costCenter && s.id == cc),
        )
        .firstOrNull;
    if (site == null) continue;
    final list = byEmployee.putIfAbsent(emp, () => []);
    if (!list.any((s) => s.key == site.key)) list.add(site);
  }
  final out = [
    for (final e in byEmployee.entries)
      OnBehalfCandidate(employeeId: e.key, name: names[e.key] ?? '#${e.key}', sites: e.value),
  ]..sort((a, b) => a.name.compareTo(b.name));
  return out;
});

/// Latest attendance items of this user in the outbox (queued / sent / rejected).
final attendanceItemsProvider = StreamProvider<List<OutboxData>>((ref) {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return Stream.value(const []);
  return ref.watch(outboxRepositoryProvider).watchAttendance(sub);
});
