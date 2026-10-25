import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/dates.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/photo_viewer.dart';
import '../../../../shared/widgets/pk_ui.dart';
import '../../../dashboard/presentation/charts.dart' show VizColors;
import '../../application/progress_providers.dart';
import '../../domain/progress.dart';

/// Series colours (dataviz reference palette, categorical slots 1 and 2 — same as the KPI charts).
const progressSeriesPhysical = VizColors.series1;
const progressSeriesBudget = VizColors.series2;

/// Horizontal percentage bar (0–100) with its label and value always written beside it (dataviz: the
/// number is never colour-only; the track is a light step of the same hue). D2510: rounded 8 dp bar, muted label.
class PctBar extends StatelessWidget {
  const PctBar({super.key, required this.label, required this.value, required this.color});
  final String label;
  final double? value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final v = value;
    return Semantics(
      label: '$label ${v == null ? 'tidak ada data' : fmtPct(v)}',
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                v == null ? '—' : fmtPct(v),
                style: theme.textTheme.titleSmall?.copyWith(fontFamily: PkFonts.heading, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: v == null ? 0 : (v / 100).clamp(0, 1).toDouble(),
              minHeight: 8,
              color: color,
              backgroundColor: color.withValues(alpha: 0.16),
            ),
          ),
        ],
      ),
    );
  }
}

/// [PkTone] of a K-09 status.
PkTone progressPkTone(ProgressTone tone) => switch (tone) {
  ProgressTone.ok => PkTone.ok,
  ProgressTone.warn => PkTone.warn,
  ProgressTone.bad => PkTone.bad,
  ProgressTone.none => PkTone.neutral,
};

/// K-09 status: icon + label + soft tone pill (never colour alone).
class ToneChip extends StatelessWidget {
  const ToneChip({super.key, required this.tone, required this.label});
  final ProgressTone tone;
  final String label;

  @override
  Widget build(BuildContext context) {
    final icon = switch (tone) {
      ProgressTone.ok => Icons.check_circle,
      ProgressTone.warn => Icons.warning_amber_rounded,
      ProgressTone.bad => Icons.error,
      ProgressTone.none => Icons.help_outline,
    };
    return PkPill(label: label, tone: progressPkTone(tone), icon: icon);
  }
}

/// One project: physical progress vs budget used, the gap and its tone (US-12 / K-09).
class ProjectProgressCard extends StatelessWidget {
  const ProjectProgressCard({super.key, required this.item, this.onTap});
  final ProjectProgress item;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final gap = item.gap;
    final toneText = item.toneLabel.isNotEmpty
        ? item.toneLabel
        : switch (item.tone) {
            ProgressTone.ok => t.progressToneOk,
            ProgressTone.warn => t.progressToneWarn,
            ProgressTone.bad => t.progressToneBad,
            ProgressTone.none => t.progressToneNone,
          };
    final muted = theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant);
    return PkCard(
      key: Key('project-progress-${item.id}'),
      onTap: onTap,
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
                    if (item.code.isNotEmpty)
                      Text(
                        item.code,
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: scheme.onSurfaceVariant,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    Text(
                      item.name,
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700, height: 1.25),
                    ),
                  ],
                ),
              ),
              if (onTap != null) Icon(Icons.chevron_right, color: scheme.outline),
            ],
          ),
          const SizedBox(height: 14),
          PctBar(label: t.progressPhysical, value: item.progressPct, color: progressSeriesPhysical),
          const SizedBox(height: 12),
          PctBar(label: t.progressBudgetUsed, value: item.budgetPct, color: progressSeriesBudget),
          const SizedBox(height: 14),
          Wrap(
            spacing: 10,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              ToneChip(tone: item.tone, label: toneText),
              if (gap != null)
                Text(
                  t.progressGap('${gap >= 0 ? '+' : '−'}${fmtPct(gap.abs())}'),
                  style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700),
                ),
            ],
          ),
          if (!item.stagesComplete) ...[
            const SizedBox(height: 8),
            Text(
              t.progressStagesIncomplete(fmtPct(item.weightSum)),
              style: theme.textTheme.bodySmall?.copyWith(color: context.pk.warnText),
            ),
          ],
          const SizedBox(height: 10),
          const Divider(height: 1),
          const SizedBox(height: 10),
          Row(
            children: [
              Icon(Icons.event_note_outlined, size: 16, color: scheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  item.lastReportDate == null
                      ? t.progressNoReportYet
                      : t.progressLastReport(formatDateOnly(item.lastReportDate), item.reportCount),
                  style: muted,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// D2510 Beranda project card (Banani "ProjectCard"): icon, code, name, tone pill, budget-used bar and the
/// physical / budget percentages on one line.
class ProjectProgressCompactCard extends StatelessWidget {
  const ProjectProgressCompactCard({super.key, required this.item, this.onTap});
  final ProjectProgress item;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final pk = context.pk;
    final tone = switch (item.tone) {
      ProgressTone.ok => PkTone.ok,
      ProgressTone.warn => PkTone.warn,
      ProgressTone.bad => PkTone.bad,
      ProgressTone.none => PkTone.neutral,
    };
    final toneText = item.toneLabel.isNotEmpty
        ? item.toneLabel
        : switch (item.tone) {
            ProgressTone.ok => t.progressToneOk,
            ProgressTone.warn => t.progressToneWarn,
            ProgressTone.bad => t.progressToneBad,
            ProgressTone.none => t.progressToneNone,
          };
    final barColor = switch (item.tone) {
      ProgressTone.bad => pk.badText,
      ProgressTone.warn => pk.warnText,
      _ => theme.colorScheme.primary,
    };
    final muted = theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return PkCard(
      key: Key('project-progress-${item.id}'),
      onTap: onTap,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const PkIconChip(icon: Icons.apartment, tone: PkTone.primary, size: 40),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (item.code.isNotEmpty) Text(item.code, style: muted?.copyWith(fontWeight: FontWeight.w700)),
                    Text(
                      item.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700, height: 1.25),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              PkPill(label: toneText, tone: tone),
            ],
          ),
          const SizedBox(height: 12),
          PkProgressBar(value: (item.budgetPct ?? 0) / 100, color: barColor),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: Text('${t.progressPhysical} ${fmtPct(item.progressPct)}', style: muted)),
              Text(
                '${t.progressBudgetUsed} ${item.budgetPct == null ? '—' : fmtPct(item.budgetPct!)}',
                style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Thumbnail of a server photo (authorized file endpoint, never cached on disk). Tap = fullscreen viewer;
/// [group] = ids of the photos the viewer swipes through (default: this photo only).
class ServerPhotoThumb extends ConsumerWidget {
  const ServerPhotoThumb({super.key, required this.photoId, this.size = 88, this.group});
  final int photoId;
  final double size;
  final List<int>? group;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = ref.watch(progressPhotoProvider((photoId, true)));
    final ids = (group == null || !group!.contains(photoId)) ? [photoId] : group!;
    return _Thumb(
      size: size,
      bytes: value.value,
      error: value.hasError,
      onTap: () => showPhotoViewer(context, [
        for (final id in ids) ViewerPhoto(builder: (_) => _ServerFull(photoId: id)),
      ], initialIndex: ids.indexOf(photoId)),
    );
  }
}

class _ServerFull extends ConsumerWidget {
  const _ServerFull({required this.photoId});
  final int photoId;
  @override
  Widget build(BuildContext context, WidgetRef ref) => switch (ref.watch(progressPhotoProvider((photoId, false)))) {
    AsyncData(:final value) => Image.memory(value, fit: BoxFit.contain),
    AsyncError() => const Icon(Icons.broken_image, size: 64, color: Colors.white),
    _ => const CircularProgressIndicator(),
  };
}

class _LocalFull extends ConsumerWidget {
  const _LocalFull({required this.uuid});
  final String uuid;
  @override
  Widget build(BuildContext context, WidgetRef ref) => switch (ref.watch(localPhotoProvider(uuid))) {
    AsyncData(:final value?) => Image.memory(value, fit: BoxFit.contain),
    AsyncData() || AsyncError() => const Icon(Icons.broken_image, size: 64, color: Colors.white),
    _ => const CircularProgressIndicator(),
  };
}

/// Thumbnail of a photo still on the phone (encrypted DB). [group] = local ids the viewer swipes through.
class LocalPhotoThumb extends ConsumerWidget {
  const LocalPhotoThumb({super.key, required this.uuid, this.size = 88, this.onRemove, this.group});
  final String uuid;
  final double size;
  final VoidCallback? onRemove;
  final List<String>? group;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(localPhotoProvider(uuid));
    final bytes = value.value;
    final ids = (group == null || !group!.contains(uuid)) ? [uuid] : group!;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        _Thumb(
          size: size,
          bytes: bytes,
          error: value.hasError || (value.hasValue && bytes == null),
          onTap: bytes == null
              ? null
              : () => showPhotoViewer(context, [
                  for (final id in ids) ViewerPhoto(builder: (_) => _LocalFull(uuid: id)),
                ], initialIndex: ids.indexOf(uuid)),
        ),
        if (onRemove != null)
          Positioned(
            right: -6,
            top: -6,
            child: Material(
              color: Theme.of(context).colorScheme.errorContainer,
              shape: const CircleBorder(),
              child: IconButton(
                key: Key('remove-photo-$uuid'),
                visualDensity: VisualDensity.compact,
                tooltip: t.progressRemovePhoto,
                icon: const Icon(Icons.close, size: 18),
                onPressed: onRemove,
              ),
            ),
          ),
      ],
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.size, required this.bytes, required this.error, this.onTap});
  final double size;
  final Uint8List? bytes;
  final bool error;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final b = bytes;
    return SizedBox.square(
      dimension: size,
      child: Material(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: b != null
              ? Image.memory(b, fit: BoxFit.cover, gaplessPlayback: true)
              : Center(
                  child: error
                      ? const Icon(Icons.broken_image)
                      : const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                ),
        ),
      ),
    );
  }
}

/// Local report state as a soft pill (icon + text).
class ProgressStateChip extends StatelessWidget {
  const ProgressStateChip({super.key, required this.state, this.queueEnabled = true});
  final ProgressSyncState state;
  final bool queueEnabled;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final (IconData icon, PkTone tone, String label) = switch (state) {
      ProgressSyncState.queued => (Icons.schedule, PkTone.info, t.progressStateQueued),
      ProgressSyncState.local => (Icons.cloud_off, PkTone.warn, t.progressStateLocal),
      ProgressSyncState.conflict => (Icons.call_split, PkTone.warn, t.progressStateConflict),
      ProgressSyncState.rejected => (Icons.error, PkTone.bad, t.progressStateRejected),
      ProgressSyncState.synced => (Icons.cloud_done, PkTone.ok, t.progressStateSynced),
    };
    return PkPill(icon: icon, tone: tone, label: label);
  }
}

/// `21 Sep 2026 12.05 WITA` for a server instant (kept here so screens stay short).
String reportTime(String? iso, String? zone) => formatServerDateTime(iso, zone: zone);
