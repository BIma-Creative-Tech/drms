import 'package:drift/drift.dart';

import '../../../core/db/app_database.dart';
import '../../auth/domain/user_profile.dart';
import '../../sync/domain/sync_models.dart';

/// Offline data written before schema v3 has no PT (`company_id` NULL). What kind of row waits for a PT.
enum UnassignedKind { draft, progress, attendance }

/// One draft / report / attendance item without PT (shown in "Pilih PT untuk data offline").
class UnassignedItem {
  const UnassignedItem({required this.kind, required this.targetUuid, required this.label, required this.createdAt});
  final UnassignedKind kind;

  /// Draft / report uuid, or the outbox `op_uuid` of an attendance item.
  final String targetUuid;
  final String label;
  final DateTime createdAt;
}

/// PT assignment of offline rows written before MC3 (drift v2 → v3, ADR 0010 MC revision).
///
/// - User with exactly ONE PT: every NULL row of that user gets it ([assignSoleCompany], after `/me`;
///   the sync engine does the same right before sending).
/// - User with SEVERAL PTs: nothing is guessed. The rows stay NULL, the sync engine holds their outbox
///   items (never sent without `company_id`, which the server would refuse with 409 `COMPANY_REQUIRED`
///   anyway) and the user picks the PT per draft / report / attendance ([unassigned], [assign]).
class CompanyBackfill {
  CompanyBackfill(this.db);
  final AppDatabase db;

  /// Assigns the only PT of [profile] to every row of [sub] without PT. Returns the number of rows changed
  /// (0 when the user has none or several PTs, or the server predates MC3).
  Future<int> assignSoleCompany(String sub, UserProfile profile) async {
    if (profile.companies.length != 1) return 0;
    return assignAll(sub, profile.companies.single.id);
  }

  /// Every NULL row of [sub] → [companyId] (drafts, progress reports, outbox items).
  Future<int> assignAll(String sub, int companyId) => db.transaction(() async {
    var n = 0;
    n += await (db.update(db.localDrafts)..where((t) => t.userSub.equals(sub) & t.companyId.isNull())).write(
      LocalDraftsCompanion(companyId: Value(companyId)),
    );
    n += await (db.update(db.localProgressReports)..where((t) => t.userSub.equals(sub) & t.companyId.isNull())).write(
      LocalProgressReportsCompanion(companyId: Value(companyId)),
    );
    n += await (db.update(
      db.outbox,
    )..where((t) => t.userSub.equals(sub) & t.companyId.isNull())).write(OutboxCompanion(companyId: Value(companyId)));
    return n;
  });

  /// Open rows of [sub] that still need a PT, oldest first. Drafts and reports are listed once (with all
  /// their queued operations); attendance items one by one.
  Future<List<UnassignedItem>> unassigned(String sub) async {
    final drafts =
        await (db.select(db.localDrafts)..where(
              (t) =>
                  t.userSub.equals(sub) &
                  t.companyId.isNull() &
                  t.deleted.equals(false) &
                  t.syncState.isNotValue('submitted'),
            ))
            .get();
    final reports = await (db.select(
      db.localProgressReports,
    )..where((t) => t.userSub.equals(sub) & t.companyId.isNull() & t.syncState.isNotValue('synced'))).get();
    final items = await (db.select(
      db.outbox,
    )..where((t) => t.userSub.equals(sub) & t.companyId.isNull() & t.status.isIn(const ['pending', 'failed']))).get();
    final draftIds = {for (final d in drafts) d.clientUuid};
    final reportIds = {for (final r in reports) r.clientUuid};
    final out = <UnassignedItem>[
      for (final d in drafts)
        UnassignedItem(
          kind: UnassignedKind.draft,
          targetUuid: d.clientUuid,
          label: d.title.trim().isEmpty ? SyncItemType.label(SyncItemType.expenseDraftUpsert) : d.title.trim(),
          createdAt: d.createdAt,
        ),
      for (final r in reports)
        UnassignedItem(
          kind: UnassignedKind.progress,
          targetUuid: r.clientUuid,
          label: [
            SyncItemType.label(SyncItemType.progressReportUpsert),
            r.projectLabel,
          ].where((e) => e.isNotEmpty).join(' · '),
          createdAt: r.createdAt,
        ),
      for (final o in items)
        if (SyncItemType.isAttendance(o.type))
          UnassignedItem(
            kind: UnassignedKind.attendance,
            targetUuid: o.opUuid,
            label: SyncItemType.label(o.type),
            createdAt: o.createdAt,
          )
        // Queue items of a draft / report whose local row is gone (e.g. draft_delete): the item itself.
        else if (!draftIds.contains(o.targetUuid) && !reportIds.contains(o.targetUuid))
          UnassignedItem(
            kind: SyncItemType.isProgress(o.type) ? UnassignedKind.progress : UnassignedKind.draft,
            targetUuid: o.targetUuid,
            label: SyncItemType.label(o.type),
            createdAt: o.createdAt,
          ),
    ];
    final seen = <String>{};
    out.retainWhere((e) => seen.add('${e.kind.name}:${e.targetUuid}'));
    out.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return out;
  }

  /// Number of rows of [sub] without PT (0 = nothing to ask). Live, for the home / queue banner.
  Stream<int> watchUnassignedCount(String sub) {
    final q = db.customSelect(
      'SELECT '
      '(SELECT COUNT(*) FROM local_drafts WHERE user_sub = ?1 AND company_id IS NULL AND deleted = 0 '
      "AND sync_state <> 'submitted') + "
      "(SELECT COUNT(*) FROM local_progress_reports WHERE user_sub = ?1 AND company_id IS NULL AND sync_state <> 'synced') + "
      "(SELECT COUNT(*) FROM outbox WHERE user_sub = ?1 AND company_id IS NULL AND status IN ('pending','failed') "
      'AND target_uuid NOT IN (SELECT client_uuid FROM local_drafts) '
      'AND target_uuid NOT IN (SELECT client_uuid FROM local_progress_reports)) AS n',
      variables: [Variable.withString(sub)],
      readsFrom: {db.localDrafts, db.localProgressReports, db.outbox},
    );
    return q.watchSingle().map((r) => r.read<int>('n'));
  }

  /// The user chose [companyId] for one item: the draft / report row and every open queue item of it
  /// (or the single attendance item). Delivered or refused items keep their history untouched.
  Future<void> assign(String sub, UnassignedKind kind, String targetUuid, int companyId) => db.transaction(() async {
    switch (kind) {
      case UnassignedKind.draft:
        await (db.update(db.localDrafts)
              ..where((t) => t.userSub.equals(sub) & t.clientUuid.equals(targetUuid) & t.companyId.isNull()))
            .write(LocalDraftsCompanion(companyId: Value(companyId)));
      case UnassignedKind.progress:
        await (db.update(db.localProgressReports)
              ..where((t) => t.userSub.equals(sub) & t.clientUuid.equals(targetUuid) & t.companyId.isNull()))
            .write(LocalProgressReportsCompanion(companyId: Value(companyId)));
      case UnassignedKind.attendance:
        await (db.update(
          db.outbox,
        )..where((t) => t.userSub.equals(sub) & t.opUuid.equals(targetUuid) & t.companyId.isNull())).write(
          OutboxCompanion(
            companyId: Value(companyId),
            nextAttemptAt: const Value(null),
            lastErrorCode: const Value(null),
            lastErrorMessage: const Value(null),
          ),
        );
        return;
    }
    await (db.update(db.outbox)..where(
          (t) =>
              t.userSub.equals(sub) &
              t.targetUuid.equals(targetUuid) &
              t.companyId.isNull() &
              t.status.isIn(const ['pending', 'failed']),
        ))
        .write(
          OutboxCompanion(
            companyId: Value(companyId),
            nextAttemptAt: const Value(null),
            lastErrorCode: const Value(null),
            lastErrorMessage: const Value(null),
          ),
        );
  });
}

/// Key of the cached `/me` JSON of [sub] in `kv_entries` (written by the auth controller).
String profileCacheKey(String sub) => 'profile:$sub';

/// Membership PT ids of [sub] from the cached `/me` (usable in the background isolate). Null = unknown:
/// no cached profile, or a server before MC3 without `companies[]`.
Future<List<int>?> cachedMembershipIds(AppDatabase db, String sub) async {
  try {
    final raw = await db.kvGetJson(profileCacheKey(sub));
    final list = raw?['companies'];
    if (list is! List) return null;
    final ids = [
      for (final c in list)
        if (c is Map<String, dynamic> && c['id'] is num) (c['id'] as num).toInt(),
    ];
    return ids.isEmpty ? null : ids;
  } on Object {
    return null;
  }
}
