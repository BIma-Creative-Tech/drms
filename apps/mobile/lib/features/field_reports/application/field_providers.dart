import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/network/api_exception.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../masters/domain/master_item.dart';
import '../data/field_api.dart';
import '../domain/field_models.dart';
import '../domain/field_rules.dart';
import 'field_service.dart';

final fieldApiProvider = Provider((ref) => FieldApi(ref.watch(apiClientProvider)));

final fieldServiceProvider = Provider(
  (ref) => FieldService(
    repo: ref.watch(fieldRepositoryProvider),
    drafts: ref.watch(draftRepositoryProvider),
    outbox: ref.watch(outboxRepositoryProvider),
    api: ref.watch(fieldApiProvider),
    clock: ref.watch(deviceClockProvider),
    compressor: ref.watch(photoCompressorProvider),
    lock: ref.watch(syncLockProvider),
    masters: ref.watch(mastersRepositoryProvider),
  ),
);

/// Capability of [type] in PT [companyId] (`/me` companies[].capabilities; legacy single-PT profile: top level).
bool canCreateField(UserProfile? profile, FieldReportType type, int? companyId) {
  if (profile == null || profile.isOperatorOnly) return false;
  final c = profile.companies.isEmpty ? null : profile.company(companyId);
  if (profile.companies.isNotEmpty && (c == null || !c.settings.fieldReportsEnabled)) return false;
  final caps = c?.capabilities ?? profile.capabilities;
  return switch (type) {
    FieldReportType.serviceReport => caps.serviceReportCreate,
    FieldReportType.unitTimesheet => caps.unitTimesheetCreate,
    FieldReportType.aftersalesActivity => caps.aftersalesActivityCreate,
    FieldReportType.dailyReport => caps.dailyReportCreate,
  };
}

/// "Today" (company TZ of the scope).
final fieldTodayProvider = Provider<String>((ref) => todayIn(ref.watch(currentProfileProvider)?.timezone));

/// Projects of kind kontrak_unit / aftersales in the PTs where the user may write field reports (masters are
/// access-filtered by the server: Staff assigned, PM team, Direktur all); archived / finished projects hidden.
final fieldProjectsProvider = FutureProvider<List<FieldProject>>((ref) async {
  final sub = ref.watch(currentSubProvider);
  final profile = ref.watch(currentProfileProvider);
  if (sub == null || profile == null || !profile.hasFieldReports) return const [];
  ref.watch(mastersRevisionProvider);
  final pts = profile.companies.isEmpty ? null : profile.fieldCompanies.map((c) => c.id).toSet();
  final masters = await ref.watch(mastersRepositoryProvider).cached(sub, companyIds: pts);
  final out = <FieldProject>[];
  for (final p in masters[MasterTypes.projects] ?? const <MasterItem>[]) {
    final kind = ProjectKind.fromCode(p.extra['kind']);
    if (kind.reportTypes.isEmpty) continue;
    if (p.extra['status'] == 'arsip' || p.extra['status'] == 'selesai') continue;
    if (!kind.reportTypes.any((t) => canCreateField(profile, t, p.companyId))) continue;
    out.add(
      FieldProject(
        id: p.id,
        label: p.label,
        code: p.code,
        name: fStr(p.extra['name']),
        kind: kind,
        companyId: p.companyId,
        clientId: fIntN(p.extra['client']),
      ),
    );
  }
  return out;
});

/// Bumped after every cache refresh: cache readers below re-read the encrypted DB.
final fieldCacheRevisionProvider = NotifierProvider<FieldCacheRevision, int>(FieldCacheRevision.new);

class FieldCacheRevision extends Notifier<int> {
  @override
  int build() => 0;
  void bump() => state++;
}

/// Pulls the caches of every field project when online (hub, editors, pull-to-refresh). False = offline.
final fieldCacheRefreshProvider = FutureProvider.autoDispose<bool>((ref) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null || !ref.watch(connectivityProvider)) return false;
  final projects = await ref.watch(fieldProjectsProvider.future);
  if (projects.isEmpty) return true;
  // Every membership PT (not only the field PTs): the masters index of the phone covers all of them.
  final ids = ref.read(accountProfileProvider)?.companies.map((c) => c.id).toList();
  final ok = await ref
      .read(fieldServiceProvider)
      .refreshCaches(sub, projects, today: ref.read(fieldTodayProvider), membershipIds: ids);
  // Not mastersRevision: fieldProjectsProvider watches it and this provider watches the projects (loop).
  if (ok && ref.mounted) ref.read(fieldCacheRevisionProvider.notifier).bump();
  return ok;
});

FieldProject? _project(Ref ref, int projectId) =>
    ref.watch(fieldProjectsProvider).value?.where((p) => p.id == projectId).firstOrNull;

/// Unit picker of a project: kontrak_unit → units of its contract units (active on [date] when given);
/// aftersales → active units of the PT (own fleet, or customer units of the project's customer when it has one).
final fieldUnitsProvider = FutureProvider.autoDispose.family<List<FieldUnit>, (int, String?)>((ref, key) async {
  final (projectId, date) = key;
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  ref.watch(fieldCacheRevisionProvider);
  final project = _project(ref, projectId);
  final repo = ref.watch(fieldRepositoryProvider);
  if (project?.kind == ProjectKind.kontrakUnit) {
    final cus = await repo.contractUnits(sub, projectId);
    final ids = {
      for (final c in cus)
        if (date == null ? c.active : c.activeOn(date)) c.unitId,
    };
    final units = await repo.units(sub, ids: ids);
    final known = {for (final u in units) u.id};
    // A unit of the contract that the units cache does not know yet (e.g. contract started after the last pull).
    return [
      ...units,
      for (final c in cus)
        if (ids.contains(c.unitId) && !known.contains(c.unitId))
          FieldUnit(id: c.unitId, companyId: c.companyId, label: c.unitLabel, unitCode: c.unitCode),
    ];
  }
  final units = await repo.units(sub, companyId: project?.companyId);
  final client = project?.clientId;
  return [
    for (final u in units)
      if (!u.customerOwned || client == null || u.clientId == client) u,
  ];
});

final fieldContractUnitsProvider = FutureProvider.autoDispose.family<List<FieldContractUnit>, int>((
  ref,
  projectId,
) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  ref.watch(fieldCacheRevisionProvider);
  return ref.watch(fieldRepositoryProvider).contractUnits(sub, projectId);
});

/// Open POs of a customer in an aftersales project (cache; value never shown here).
final fieldOpenPosProvider = FutureProvider.autoDispose.family<List<FieldOpenPo>, (int, int?)>((ref, key) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  ref.watch(fieldCacheRevisionProvider);
  return ref.watch(fieldRepositoryProvider).openPos(sub, projectId: key.$1, clientId: key.$2);
});

/// Customers of PT [companyId] known on the phone (picker of the aftersales activity).
final fieldClientsProvider = FutureProvider.autoDispose.family<List<FieldClient>, int?>((ref, companyId) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  ref.watch(fieldCacheRevisionProvider);
  return ref.watch(fieldRepositoryProvider).clients(sub, companyId: companyId);
});

/// P3: active RAP items of a konstruksi project (cache; no prices).
final fieldRapItemsProvider = FutureProvider.autoDispose.family<List<RapItem>, int>((ref, projectId) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  ref.watch(fieldCacheRevisionProvider);
  ref.watch(openFieldDraftsProvider);
  return ref.watch(fieldRepositoryProvider).rapItems(sub, projectId);
});

/// P3: manpower / equipment types of PT [companyId] (cache).
final fieldResourceTypesProvider = FutureProvider.autoDispose.family<List<ResourceType>, int>((ref, companyId) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  ref.watch(fieldCacheRevisionProvider);
  return ref.watch(fieldRepositoryProvider).resourceTypes(sub, companyId);
});

/// Service types ("Jenis servis") of PT [companyId] (cache; inactive ones included, the picker offers the active ones).
final fieldServiceTypesProvider = FutureProvider.autoDispose.family<List<ServiceType>, int>((ref, companyId) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  ref.watch(fieldCacheRevisionProvider);
  return ref.watch(fieldRepositoryProvider).serviceTypes(sub, companyId: companyId);
});

/// id → name of every cached service type (hub list, conflict screen).
final fieldServiceTypeNamesProvider = FutureProvider.autoDispose<Map<int, String>>((ref) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const {};
  ref.watch(fieldCacheRevisionProvider);
  return {for (final t in await ref.watch(fieldRepositoryProvider).serviceTypes(sub)) t.id: t.name};
});

/// Field reports on this phone not yet applied by the server (drafts, queued, conflicts, rejections).
final openFieldDraftsProvider = StreamProvider<List<FieldDraft>>((ref) {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return Stream.value(const []);
  return ref.watch(fieldRepositoryProvider).watchOpen(sub);
});

/// Timesheets known on the phone (server cache + queued local ones) for the units of a project.
final fieldTimesheetMarksProvider = FutureProvider.autoDispose.family<List<TimesheetMark>, int>((ref, projectId) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  ref.watch(fieldCacheRevisionProvider);
  ref.watch(openFieldDraftsProvider);
  final cus = await ref.watch(fieldRepositoryProvider).contractUnits(sub, projectId);
  return ref.watch(fieldRepositoryProvider).timesheetMarks(sub, unitIds: {for (final c in cus) c.unitId});
});

/// "Riwayat saya": the user's own records of every type they may write (server, newest first). Online only.
final myFieldRecordsProvider = FutureProvider.autoDispose<List<FieldRecord>>((ref) async {
  final profile = ref.watch(currentProfileProvider);
  final api = ref.watch(fieldApiProvider);
  final types = [
    for (final t in FieldReportType.values)
      if (profile != null &&
          (profile.companies.isEmpty
              ? canCreateField(profile, t, null)
              : profile.fieldCompanies.any((c) => canCreateField(profile, t, c.id))))
        t,
  ];
  final out = <FieldRecord>[];
  for (final t in types) {
    out.addAll((await api.list(t, mine: true, limit: 30)).items);
  }
  out.sort((a, b) {
    final byDate = b.date.compareTo(a.date);
    return byDate != 0 ? byDate : (b.createdAt ?? '').compareTo(a.createdAt ?? '');
  });
  return out;
});

/// Today's own activities of an aftersales project + penawaran follow-ups due today (online; offline → null).
final aftersalesDayProvider = FutureProvider.autoDispose
    .family<({List<FieldRecord> today, int followUpsDue})?, (int, String)>((ref, key) async {
      final (projectId, date) = key;
      ref.watch(openFieldDraftsProvider);
      final api = ref.watch(fieldApiProvider);
      try {
        final today = await api.list(
          FieldReportType.aftersalesActivity,
          projectId: projectId,
          mine: true,
          from: date,
          to: date,
          limit: 100,
          allCompanies: true,
        );
        final offers = await api.list(
          FieldReportType.aftersalesActivity,
          projectId: projectId,
          mine: true,
          kind: ActivityKind.penawaran,
          from: addDays(date, -60),
          limit: 100,
          allCompanies: true,
        );
        return (today: today.items, followUpsDue: offers.items.where((o) => o.followUpDate == date).length);
      } on NetworkException {
        return null;
      }
    });

/// Detail of one own server record (edit route).
final fieldRecordProvider = FutureProvider.autoDispose.family<FieldRecord, (FieldReportType, int)>(
  (ref, key) => ref.watch(fieldApiProvider).detail(key.$1, key.$2),
);
