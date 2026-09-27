import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../l10n/gen/app_localizations.dart';
import '../../application/progress_providers.dart';
import '../../domain/progress.dart';
import 'progress_widgets.dart';

/// Home card for PM / Direktur (US-12, K-09): the projects that need attention first (largest gap between
/// budget used and physical progress), up to 3; "Lihat semua" opens the project tab. Hidden offline /
/// on error (the home stays usable).
class ProjectProgressSummary extends ConsumerWidget {
  const ProjectProgressSummary({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final list = ref.watch(projectProgressProvider).value;
    if (list == null || list.projects.isEmpty) return const SizedBox.shrink();
    int rank(ProgressTone tone) => switch (tone) {
      ProgressTone.bad => 0,
      ProgressTone.warn => 1,
      ProgressTone.ok => 2,
      ProgressTone.none => 3,
    };
    final sorted = [...list.projects]
      ..sort((a, b) {
        final r = rank(a.tone).compareTo(rank(b.tone));
        return r != 0 ? r : (b.gap ?? -999).compareTo(a.gap ?? -999);
      });
    return Column(
      key: const Key('home-project-progress'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text(t.progressHomeTitle, style: Theme.of(context).textTheme.titleMedium)),
            TextButton(onPressed: () => context.push('/progress?tab=projects'), child: Text(t.seeAll)),
          ],
        ),
        for (final p in sorted.take(3))
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: ProjectProgressCard(item: p, onTap: () => context.push('/progress?tab=projects')),
          ),
      ],
    );
  }
}
