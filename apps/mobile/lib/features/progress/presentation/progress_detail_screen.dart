import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../application/progress_providers.dart';
import '../domain/progress.dart';
import 'widgets/progress_widgets.dart';

/// Report detail with photos (US-31). Edit only for the reporter inside 24 h (server `editable`).
class ProgressDetailScreen extends ConsumerWidget {
  const ProgressDetailScreen({super.key, required this.id});
  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final zone = ref.watch(currentProfileProvider)?.timezone;
    final canCreate = ref.watch(currentProfileProvider)?.canCreateProgress ?? false;
    final value = ref.watch(progressDetailProvider(id));
    return Scaffold(
      appBar: AppBar(title: Text(value.value?.docNo ?? t.progressDetailTitle)),
      body: AsyncBody<ProgressReport>(
        value: value,
        onRetry: () => ref.invalidate(progressDetailProvider(id)),
        data: (r) {
          final theme = Theme.of(context);
          Widget row(String label, String text) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 120, child: Text(label, style: theme.textTheme.bodySmall)),
                Expanded(child: Text(text)),
              ],
            ),
          );
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(progressDetailProvider(id)),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(r.projectLabel, style: theme.textTheme.titleMedium),
                Text(
                  '${r.stageName ?? '-'}${r.stageWeightPct == null ? '' : ' · ${t.progressWeight(fmtPct(r.stageWeightPct!))}'}',
                ),
                const SizedBox(height: 12),
                Card(
                  elevation: 0,
                  color: theme.colorScheme.surfaceContainerLow,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        PctBar(
                          label: t.progressStageBeforeAfter(fmtPct(r.pctBefore)),
                          value: r.pctAfter,
                          color: progressSeriesPhysical,
                        ),
                        if (r.projectPctAfter != null) ...[
                          const SizedBox(height: 12),
                          PctBar(
                            label: t.progressProjectBeforeAfter(
                              r.projectPctBefore == null ? '—' : fmtPct(r.projectPctBefore!),
                            ),
                            value: r.projectPctAfter,
                            color: progressSeriesPhysical,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(t.progressWork, style: theme.textTheme.titleSmall),
                Text(r.work),
                if ((r.issues ?? '').isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(t.progressIssues, style: theme.textTheme.titleSmall),
                  Text(r.issues!),
                ],
                const SizedBox(height: 12),
                Text(t.progressPhotosTitle(r.photos.length, maxProgressPhotos), style: theme.textTheme.titleSmall),
                const SizedBox(height: 8),
                if (r.photos.isEmpty)
                  Text(t.progressNoPhotos)
                else
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [for (final p in r.photos) ServerPhotoThumb(key: Key('photo-${p.id}'), photoId: p.id)],
                  ),
                const Divider(height: 32),
                row(t.progressDate, formatDateOnly(r.reportDate)),
                row(t.progressReporter, r.reporterName ?? '-'),
                row(t.progressReceivedAt, reportTime(r.receivedAt, zone)),
                if (r.offline) row(t.progressOfflineTag, t.progressTimeTrust(r.timeTrust ?? '-')),
                if (r.flags.isNotEmpty) row(t.progressFlags, r.flags.join(', ')),
                if (r.editableUntil != null) row(t.progressEditableUntil, reportTime(r.editableUntil, zone)),
                const SizedBox(height: 16),
                if (r.editable && canCreate)
                  FilledButton.icon(
                    key: const Key('progress-edit'),
                    onPressed: () => context.push('/progress/report/${r.id}/edit'),
                    icon: const Icon(Icons.edit),
                    label: Text(t.progressEdit),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}
