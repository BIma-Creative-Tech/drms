import 'dart:typed_data';

import 'package:uuid/uuid.dart';

import '../../../core/format/dates.dart';
import '../../../core/media/compress_plan.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/time/device_clock.dart';
import '../../../core/util/async_lock.dart';
import '../../expense/data/draft_repository.dart';
import '../../sync/data/outbox_repository.dart';
import '../data/field_api.dart';
import '../data/field_repository.dart';
import '../domain/field_models.dart';
import '../domain/field_rules.dart';

/// Writes FR1 field reports (ADR 0020). Offline-first like the E4 progress reports: the report and its
/// compressed photos stay encrypted on the phone (autosaved draft), "Kirim" puts ONE outbox item per report
/// (`service_report.upsert` / `unit_timesheet.upsert` / `aftersales_activity.upsert`) that the sync engine sends
/// when there is signal — photos first (`POST /media/progress-photos`), then the item. There is no separate
/// "online only" path: the server has no queue switch for field reports (the PT flag `fieldReportsEnabled`
/// governs every write and answers FEATURE_DISABLED). Every write runs under the sync lock.
class FieldService {
  FieldService({
    required this.repo,
    required this.drafts,
    required this.outbox,
    required this.api,
    required this.clock,
    required this.compressor,
    required this.lock,
  });

  final FieldRepository repo;
  final DraftRepository drafts;
  final OutboxRepository outbox;
  final FieldApi api;
  final DeviceClock clock;
  final PhotoCompressor compressor;
  final AsyncLock lock;

  /// Rear-camera photo → JPEG ≤ 1600 px / ≤ 400 KB, EXIF dropped (ADR 0010 decision 11), stored encrypted.
  Future<String> addPhoto(String sub, Uint8List raw) async {
    final photo = await compressor.compress(raw, PhotoTarget.receipt);
    final uuid = const Uuid().v7();
    await drafts.addMedia(
      sub,
      uuid: uuid,
      kind: FieldRepository.photoKind,
      bytes: photo.bytes,
      sha256: photo.sha256Hex,
    );
    return uuid;
  }

  FieldDraft newDraft(
    FieldReportType type, {
    required int projectId,
    String projectLabel = '',
    int? companyId,
    required String reportDate,
    FieldContent? content,
  }) => FieldDraft(
    clientUuid: const Uuid().v7(),
    type: type,
    companyId: companyId,
    projectId: projectId,
    projectLabel: projectLabel,
    reportDate: reportDate,
    content:
        content ??
        switch (type) {
          FieldReportType.serviceReport => const ServiceContent(),
          FieldReportType.unitTimesheet => const TimesheetContent(),
          FieldReportType.aftersalesActivity => const ActivityContent(),
        },
  );

  Future<FieldDraft?> load(String sub, String uuid) => repo.load(sub, uuid);

  /// HM readings of a unit known on the phone (service HM floor), without report [excludeUuid] itself.
  Future<List<(String, double)>> hmReadings(String sub, int unitId, {String? excludeUuid}) =>
      repo.hmReadings(sub, unitId, excludeUuid: excludeUuid);

  /// Timesheet of [unitId] on [date]: the local one (any state), the HM awal prefill (previous HM akhir of
  /// the unit from this phone / the server cache / the unit's last HM) and the timesheets known for the unit.
  Future<({FieldDraft? local, double? prevHm, String? prevDate, List<TimesheetMark> marks})> timesheetStart(
    String sub, {
    required int projectId,
    required int unitId,
    required String date,
  }) async {
    final local = await repo.timesheetFor(sub, projectId: projectId, unitId: unitId, date: date);
    final marks = await repo.timesheetMarks(sub, unitIds: [unitId]);
    final unit = (await repo.units(sub, ids: [unitId])).firstOrNull;
    final prev = previousHmEnd(
      unitId: unitId,
      date: date,
      marks: [
        for (final m in marks)
          if (!(m.local && local != null && m.reportDate == date)) m,
      ],
      lastHourMeter: unit?.lastHourMeter,
      lastHourMeterAt: unit?.lastHourMeterAt,
    );
    return (local: local, prevHm: prev.hm, prevDate: prev.date, marks: marks);
  }

  /// Own edit of a server record (only the reporter ≤ 24 h; the server re-checks). An existing local edit of the
  /// same record is continued.
  Future<FieldDraft> startEdit(String sub, FieldRecord r) async {
    final existing = await repo.byServerId(sub, r.type, r.id);
    if (existing != null) return existing;
    return r.toDraft(clientUuid: r.clientUuid ?? const Uuid().v7());
  }

  /// Autosave of a draft that was not sent yet (never touches a queued / conflicting report).
  Future<void> saveDraft(String sub, FieldDraft d) => lock.run(() async {
    final current = await repo.load(sub, d.clientUuid);
    if (current != null && current.syncState != FieldSyncState.local) return;
    await repo.save(sub, d.copyWith(syncState: FieldSyncState.local), now: clock.now());
  });

  /// "Kirim": the report goes into the offline queue (one pending item per report, updated in place while it
  /// was not delivered). An edit carries `base_rev` = the server rev it started from.
  Future<void> submit(String sub, FieldDraft d, {required bool online}) => lock.run(() async {
    final queued = d.copyWith(syncState: FieldSyncState.queued, offline: !online);
    await repo.save(sub, queued, now: clock.now(), clearConflict: true);
    await outbox.enqueueReport(
      type: d.type.syncType,
      sub: sub,
      reportUuid: d.clientUuid,
      payload: fieldSyncPayload(d),
      photoUuids: d.content.photoUuids,
      deviceTime: isoWithOffset(clock.now()),
      elapsedMs: await clock.elapsedMs(),
      bootId: await clock.bootId(),
      offline: !online,
      baseRev: d.isEdit ? d.serverRev : null,
      companyId: d.companyId,
    );
  });

  /// Conflict / NOT_EDITABLE: the server version stays; the local copy and its photos are dropped.
  Future<void> useServerVersion(String sub, String uuid) => lock.run(() async {
    await outbox.closeTarget(sub, uuid);
    await repo.remove(sub, uuid);
  });

  /// Conflict: send the phone's version again as an edit of the CURRENT server version (base_rev = server rev)
  /// with the reason. Only while the 24 h window is open (the server re-checks).
  Future<void> resendMine(String sub, String uuid, {required String reason, required bool online}) async {
    final d = await repo.load(sub, uuid);
    final c = d?.conflictCopy;
    if (d == null || c == null) throw StateError('Tidak ada konflik untuk laporan ini');
    final serverPhotos = d.type == FieldReportType.unitTimesheet
        ? (c['hm_photo_media_id'] == null ? 0 : 1)
        : fList(c['photo_media_ids']).length;
    final rebased = FieldDraft(
      clientUuid: d.clientUuid,
      type: d.type,
      companyId: d.companyId,
      projectId: d.projectId,
      projectLabel: d.projectLabel,
      reportDate: fStrN(c['report_date'] ?? c['activity_date']) ?? d.reportDate,
      content: d.content,
      serverPhotoCount: serverPhotos,
      reason: reason,
      serverId: fIntN(c['id']) ?? d.serverId,
      serverRev: fIntN(c['rev']) ?? d.serverRev,
      docNo: fStrN(c['doc_no']) ?? d.docNo,
      editableUntil: fStrN(c['editable_until']) ?? d.editableUntil,
    );
    await submit(sub, rebased, online: online);
  }

  /// Deletes a report the server never received (draft / queued / rejected new report).
  Future<void> discard(String sub, String uuid) => lock.run(() async {
    await outbox.closeTarget(sub, uuid);
    await repo.remove(sub, uuid);
  });

  /// Refreshes the offline caches of the user's field projects: units (delta), contract units (no rates),
  /// recent timesheets (HM prefill), open POs (no value) and customers seen in units / POs / activities.
  /// A project the server refuses (403/404) is skipped. Returns false when offline.
  Future<bool> refreshCaches(String sub, List<FieldProject> projects, {required String today}) async {
    final from = addDays(today, -(fieldBackdateMaxDays + 1));
    try {
      for (final p in projects) {
        try {
          final since = await repo.unitsSince(sub, p.id);
          final u = await api.units(projectId: p.id, updatedSince: since);
          await repo.putUnits(sub, u.units);
          if (u.serverTime != null) await repo.setUnitsSince(sub, p.id, u.serverTime!);
          final company = p.companyId ?? u.units.firstOrNull?.companyId ?? 0;
          await repo.putClients(sub, [
            for (final x in u.units)
              if (x.clientId != null) FieldClient(id: x.clientId!, companyId: x.companyId, name: x.clientName ?? ''),
          ]);
          if (p.kind == ProjectKind.kontrakUnit) {
            await repo.putContractUnits(sub, p.id, await api.contractUnits(p.id));
            final ts = await api.list(
              FieldReportType.unitTimesheet,
              projectId: p.id,
              from: from,
              limit: 100,
              allCompanies: true,
            );
            await repo.putRecentTimesheets(sub, p.id, from, ts.items);
          }
          if (p.kind == ProjectKind.aftersales) {
            final pos = await api.openPos(projectId: p.id);
            await repo.putOpenPos(sub, p.id, pos);
            final acts = await api.list(
              FieldReportType.aftersalesActivity,
              projectId: p.id,
              from: from,
              limit: 100,
              allCompanies: true,
            );
            await repo.putClients(sub, [
              for (final po in pos) FieldClient(id: po.clientId, companyId: po.companyId, name: po.clientName),
              for (final a in acts.items)
                if (a.clientId != null)
                  FieldClient(id: a.clientId!, companyId: a.companyId ?? company, name: a.clientName),
            ]);
          }
        } on ProblemException catch (e) {
          if (e.status != 403 && e.status != 404 && e.status != 409) rethrow;
        }
      }
      return true;
    } on NetworkException {
      return false;
    }
  }
}
