import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/network/api_exception.dart';
import '../../app_config/application/app_config_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../masters/domain/master_item.dart';
import '../domain/progress.dart';
import 'progress_service.dart';

final progressServiceProvider = Provider(
  (ref) => ProgressService(
    repo: ref.watch(progressRepositoryProvider),
    drafts: ref.watch(draftRepositoryProvider),
    outbox: ref.watch(outboxRepositoryProvider),
    api: ref.watch(progressApiProvider),
    media: ref.watch(expenseApiProvider),
    clock: ref.watch(deviceClockProvider),
    compressor: ref.watch(photoCompressorProvider),
    lock: ref.watch(syncLockProvider),
  ),
);

/// `/app/config` `features.syncProgressReports`: true → offline queue; false/unknown → online only.
final progressQueueEnabledProvider = Provider<bool>(
  (ref) => ref.watch(appConfigProvider).value?.syncProgressReports ?? false,
);

/// Reports written on this phone that the server has not applied yet.
final openProgressDraftsProvider = StreamProvider<List<ProgressDraft>>((ref) {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return Stream.value(const []);
  return ref.watch(progressRepositoryProvider).watchOpen(sub);
});

/// Server list (newest first), optional project filter. Online only.
final progressReportsProvider = FutureProvider.autoDispose.family<ProgressReportPage, int?>(
  (ref, projectId) => ref.watch(progressApiProvider).list(projectId: projectId),
);

final progressDetailProvider = FutureProvider.autoDispose.family<ProgressReport, int>(
  (ref, id) => ref.watch(progressApiProvider).detail(id),
);

/// K-09 progress fisik vs anggaran (PM team, Direktur/Finance all).
final projectProgressProvider = FutureProvider.autoDispose<ProjectProgressList>(
  (ref) => ref.watch(progressApiProvider).projectsProgress(),
);

/// Projects the user may report on: the masters are access-filtered by the server (PM team projects,
/// Direktur all); archived / finished projects are hidden.
final progressProjectsProvider = FutureProvider<List<MasterItem>>((ref) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  final masters = await ref.watch(mastersRepositoryProvider).cached(sub);
  return [
    for (final p in masters[MasterTypes.projects] ?? const <MasterItem>[])
      if (p.extra['status'] != 'arsip' && p.extra['status'] != 'selesai') p,
  ];
});

/// Stage set of a project: the server when online, else the cached `project-stages` masters (the % may
/// be older; the server re-checks "never below" on sync).
final stageSetProvider = FutureProvider.autoDispose.family<ProjectStageSet, int>((ref, projectId) async {
  try {
    return await ref.watch(progressApiProvider).stages(projectId);
  } on NetworkException {
    final sub = ref.read(currentSubProvider);
    if (sub == null) rethrow;
    final masters = await ref.read(mastersRepositoryProvider).cached(sub);
    final rows = [for (final m in masters[MasterTypes.projectStages] ?? const <MasterItem>[]) m.extra];
    return ProjectStageSet.fromMasters(projectId, rows);
  }
});

final progressPhotoProvider = FutureProvider.autoDispose.family<Uint8List, (int, bool)>(
  (ref, key) => ref.watch(progressApiProvider).photo(key.$1, thumb: key.$2),
);

/// Local (not yet uploaded) photo bytes from the encrypted DB.
final localPhotoProvider = FutureProvider.autoDispose.family<Uint8List?, String>(
  (ref, uuid) => ref.watch(progressServiceProvider).photoBytes(uuid),
);
