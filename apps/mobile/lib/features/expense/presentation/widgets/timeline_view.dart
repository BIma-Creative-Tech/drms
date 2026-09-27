import 'package:flutter/material.dart';

import '../../../../core/format/dates.dart';
import '../../domain/turn_timeline.dart';

class TimelineView extends StatelessWidget {
  const TimelineView({super.key, required this.steps, this.zone});
  final List<TimelineStep> steps;
  final String? zone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      children: [
        for (final s in steps)
          ListTile(
            dense: true,
            leading: Icon(
              switch (s.state) {
                TurnState.done => Icons.check_circle,
                TurnState.current => Icons.play_circle_fill,
                TurnState.rejected => Icons.cancel,
                TurnState.skipped => Icons.remove_circle_outline,
                TurnState.pending => Icons.radio_button_unchecked,
              },
              color: switch (s.state) {
                TurnState.done => Colors.green.shade700,
                TurnState.current => scheme.primary,
                TurnState.rejected => scheme.error,
                _ => scheme.outline,
              },
            ),
            title: Text(s.title, style: TextStyle(fontWeight: s.state == TurnState.current ? FontWeight.bold : null)),
            subtitle: Text(
              [
                if (s.actor != null) s.actor!,
                if (s.at != null) formatServerDateTime(s.at, zone: zone),
                if (s.note != null) s.note!,
              ].join(' · '),
            ),
          ),
      ],
    );
  }
}
