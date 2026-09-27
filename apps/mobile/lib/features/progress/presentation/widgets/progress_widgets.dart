import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/dates.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../dashboard/presentation/charts.dart' show VizColors;
import '../../application/progress_providers.dart';
import '../../domain/progress.dart';

/// Series colours (dataviz reference palette, categorical slots 1 and 2 — same as the KPI charts).
const progressSeriesPhysical = VizColors.series1;
const progressSeriesBudget = VizColors.series2;

/// Horizontal percentage bar (0–100) with its label and value always written beside it (dataviz: the
/// number is never colour-only; the track is a light step of the same hue).
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
              Expanded(child: Text(label, style: theme.textTheme.bodySmall)),
              Text(
                v == null ? '—' : fmtPct(v),
                style: theme.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: v == null ? 0 : (v / 100).clamp(0, 1).toDouble(),
              minHeight: 10,
              color: color,
              backgroundColor: color.withValues(alpha: 0.16),
            ),
          ),
        ],
      ),
    );
  }
}

/// K-09 status: icon + label + colour (never colour alone).
class ToneChip extends StatelessWidget {
  const ToneChip({super.key, required this.tone, required this.label});
  final ProgressTone tone;
  final String label;

  @override
  Widget build(BuildContext context) {
    final (IconData icon, Color color) = switch (tone) {
      ProgressTone.ok => (Icons.check_circle, StatusColors.ok),
      ProgressTone.warn => (Icons.warning_amber_rounded, StatusColors.warning),
      ProgressTone.bad => (Icons.error, StatusColors.danger),
      ProgressTone.none => (Icons.help_outline, Theme.of(context).colorScheme.outline),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 4),
          Flexible(
            child: Text(label, style: Theme.of(context).textTheme.labelMedium, overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
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
    return Card(
      key: Key('project-progress-${item.id}'),
      elevation: 0,
      color: scheme.surfaceContainerLow,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      item.code.isEmpty ? item.name : '${item.code} — ${item.name}',
                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  if (onTap != null) Icon(Icons.chevron_right, color: scheme.outline),
                ],
              ),
              const SizedBox(height: 12),
              PctBar(label: t.progressPhysical, value: item.progressPct, color: progressSeriesPhysical),
              const SizedBox(height: 10),
              PctBar(label: t.progressBudgetUsed, value: item.budgetPct, color: progressSeriesBudget),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  ToneChip(tone: item.tone, label: toneText),
                  if (gap != null)
                    Text(
                      t.progressGap('${gap >= 0 ? '+' : '−'}${fmtPct(gap.abs())}'),
                      style: theme.textTheme.bodySmall,
                    ),
                ],
              ),
              if (!item.stagesComplete) ...[
                const SizedBox(height: 8),
                Text(t.progressStagesIncomplete(fmtPct(item.weightSum)), style: theme.textTheme.bodySmall),
              ],
              const SizedBox(height: 4),
              Text(
                item.lastReportDate == null
                    ? t.progressNoReportYet
                    : t.progressLastReport(formatDateOnly(item.lastReportDate), item.reportCount),
                style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Thumbnail of a server photo (authorized file endpoint, never cached on disk). Tap = full view.
class ServerPhotoThumb extends ConsumerWidget {
  const ServerPhotoThumb({super.key, required this.photoId, this.size = 88});
  final int photoId;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = ref.watch(progressPhotoProvider((photoId, true)));
    return _Thumb(
      size: size,
      bytes: value.value,
      error: value.hasError,
      onTap: () => showDialog<void>(
        context: context,
        builder: (_) => _FullPhoto(child: _ServerFull(photoId: photoId)),
      ),
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

/// Thumbnail of a photo still on the phone (encrypted DB).
class LocalPhotoThumb extends ConsumerWidget {
  const LocalPhotoThumb({super.key, required this.uuid, this.size = 88, this.onRemove});
  final String uuid;
  final double size;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(localPhotoProvider(uuid));
    final bytes = value.value;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        _Thumb(
          size: size,
          bytes: bytes,
          error: value.hasError || (value.hasValue && bytes == null),
          onTap: bytes == null
              ? null
              : () => showDialog<void>(
                  context: context,
                  builder: (_) => _FullPhoto(child: Image.memory(bytes, fit: BoxFit.contain)),
                ),
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

class _FullPhoto extends StatelessWidget {
  const _FullPhoto({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Dialog.fullscreen(
    backgroundColor: Colors.black,
    child: Stack(
      children: [
        Center(child: InteractiveViewer(maxScale: 5, child: child)),
        SafeArea(
          child: IconButton(
            color: Colors.white,
            tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
            icon: const Icon(Icons.close),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ),
      ],
    ),
  );
}

/// Local report state as chip (icon + text).
class ProgressStateChip extends StatelessWidget {
  const ProgressStateChip({super.key, required this.state, this.queueEnabled = true});
  final ProgressSyncState state;
  final bool queueEnabled;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final (IconData icon, Color? color, String label) = switch (state) {
      ProgressSyncState.queued => (Icons.schedule, null, t.progressStateQueued),
      ProgressSyncState.local => (Icons.cloud_off, StatusColors.warning, t.progressStateLocal),
      ProgressSyncState.conflict => (Icons.call_split, StatusColors.warning, t.progressStateConflict),
      ProgressSyncState.rejected => (Icons.error, StatusColors.danger, t.progressStateRejected),
      ProgressSyncState.synced => (Icons.cloud_done, StatusColors.ok, t.progressStateSynced),
    };
    return Chip(
      avatar: Icon(icon, size: 18, color: color),
      label: Text(label),
      visualDensity: VisualDensity.compact,
    );
  }
}

/// `21 Sep 2026 12.05 WITA` for a server instant (kept here so screens stay short).
String reportTime(String? iso, String? zone) => formatServerDateTime(iso, zone: zone);
