import 'package:flutter/material.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/dates.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../domain/turn_timeline.dart';

/// DRMS 13/10 Persetujuan #3: ONE vertical stepper of the request — the overall flow and the approval steps
/// together ([buildRequestStepper]). Each step shows who acted, when, the decision and the note; the current
/// step is highlighted and labelled "Tahapan saat ini"; Ditolak / Dibatalkan end the flow in red.
class RequestStepper extends StatelessWidget {
  const RequestStepper({super.key, required this.steps, this.zone});
  final List<TimelineStep> steps;

  /// Time zone of the request's PT (decision times).
  final String? zone;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const Key('request-stepper'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, s) in steps.indexed)
          _StepTile(key: Key('step-$i'), step: s, last: i == steps.length - 1, zone: zone),
      ],
    );
  }
}

class _StepTile extends StatelessWidget {
  const _StepTile({super.key, required this.step, required this.last, this.zone});
  final TimelineStep step;
  final bool last;
  final String? zone;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final s = step;
    final current = s.state == TurnState.current;
    final color = switch (s.state) {
      TurnState.done => context.pk.okText,
      TurnState.current => scheme.primary,
      TurnState.rejected => context.pk.badText,
      TurnState.pending || TurnState.skipped => scheme.outline,
    };
    final icon = switch (s.state) {
      TurnState.done => Icons.check_circle,
      TurnState.current => Icons.play_circle_fill,
      TurnState.rejected => Icons.cancel,
      TurnState.skipped => Icons.remove_circle_outline,
      TurnState.pending => Icons.radio_button_unchecked,
    };
    final at = s.at == null ? null : formatServerDateTime(s.at, zone: zone);
    final meta = [?s.actor, ?at, ?s.decision, ?s.note].join(' · ');
    final titleStyle = theme.textTheme.bodyLarge?.copyWith(
      fontWeight: current ? FontWeight.w700 : FontWeight.w500,
      color: s.state == TurnState.rejected ? context.pk.badText : null,
    );
    final badgeStyle = theme.textTheme.labelSmall?.copyWith(color: scheme.primary, fontWeight: FontWeight.w700);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 28,
            child: Column(
              children: [
                Icon(icon, color: color, size: 22),
                if (!last)
                  Expanded(
                    child: Center(child: Container(width: 2, color: scheme.outlineVariant)),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.title, style: titleStyle),
                  if (current)
                    Container(
                      key: const Key('step-current'),
                      margin: const EdgeInsets.only(top: 2),
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: scheme.primary.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(t.turnLabel, style: badgeStyle),
                    ),
                  if (meta.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(meta, style: theme.textTheme.bodySmall),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
