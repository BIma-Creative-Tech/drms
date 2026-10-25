import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
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
    final profile = ref.watch(currentProfileProvider);
    final value = ref.watch(progressDetailProvider(id));
    return Scaffold(
      appBar: AppBar(title: Text(value.value?.docNo ?? t.progressDetailTitle)),
      body: AsyncBody<ProgressReport>(
        value: value,
        onRetry: () => ref.invalidate(progressDetailProvider(id)),
        data: (r) {
          // MC3: time zone and edit right of the report's PT (roles IN that PT).
          final inPt = profile?.forCompany(r.companyId);
          final zone = inPt?.timezone;
          final canCreate = inPt?.canCreateProgress ?? false;
          final theme = Theme.of(context);
          Widget row(String label, String text) => PkInfoRow(label: label, value: Text(text));
          final body = theme.textTheme.bodyMedium?.copyWith(height: 1.45);
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(progressDetailProvider(id)),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                PkCard(
                  margin: const EdgeInsets.only(bottom: 12),
                  radius: PkRadius.lg,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const PkIconChip(icon: Icons.apartment, tone: PkTone.primary, size: 40),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  r.projectLabel,
                                  style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                Text(
                                  '${r.stageName ?? '-'}${r.stageWeightPct == null ? '' : ' · ${t.progressWeight(fmtPct(r.stageWeightPct!))}'}',
                                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
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
                PkSectionCard(
                  title: t.progressWork,
                  icon: Icons.construction_outlined,
                  child: Text(r.work, style: body),
                ),
                if ((r.issues ?? '').isNotEmpty)
                  PkSectionCard(
                    title: t.progressIssues,
                    icon: Icons.report_problem_outlined,
                    child: Text(r.issues!, style: body),
                  ),
                PkSectionCard(
                  title: t.progressPhotosTitle(r.photos.length, maxProgressPhotos),
                  icon: Icons.photo_library_outlined,
                  child: r.photos.isEmpty
                      ? Text(t.progressNoPhotos, style: body?.copyWith(color: theme.colorScheme.onSurfaceVariant))
                      : Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            children: [
                              for (final p in r.photos)
                                ServerPhotoThumb(
                                  key: Key('photo-${p.id}'),
                                  photoId: p.id,
                                  group: [for (final x in r.photos) x.id],
                                ),
                            ],
                          ),
                        ),
                ),
                PkCard(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                  child: Column(
                    children: [
                      row(t.progressDate, formatDateOnly(r.reportDate)),
                      row(t.progressReporter, r.reporterName ?? '-'),
                      row(t.progressReceivedAt, reportTime(r.receivedAt, zone)),
                      if (r.offline) row(t.progressOfflineTag, t.progressTimeTrust(r.timeTrust ?? '-')),
                      if (r.flags.isNotEmpty) row(t.progressFlags, r.flags.join(', ')),
                      if (r.editableUntil != null) row(t.progressEditableUntil, reportTime(r.editableUntil, zone)),
                    ],
                  ),
                ),
                if (r.editable && canCreate) ...[
                  const SizedBox(height: 4),
                  FilledButton.icon(
                    key: const Key('progress-edit'),
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                    onPressed: () => context.push('/progress/report/${r.id}/edit'),
                    icon: const Icon(Icons.edit),
                    label: Text(t.progressEdit),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}
