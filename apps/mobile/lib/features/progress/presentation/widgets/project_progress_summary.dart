import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../l10n/gen/app_localizations.dart';
import '../../../auth/application/auth_controller.dart';
import '../../../../shared/widgets/pk_ui.dart';
import '../../application/progress_providers.dart';
import '../../domain/progress.dart';
import 'progress_widgets.dart';

/// Home card for PM / Direktur / Finance (US-12, K-09): the projects that need attention first (largest gap between
/// budget used and physical progress), up to 3; "Lihat semua" opens the project tab. Hidden offline /
/// on error (the home stays usable).
class ProjectProgressSummary extends ConsumerWidget {
  const ProjectProgressSummary({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final list = ref.watch(projectProgressProvider).value;
    if (list == null || list.projects.isEmpty) return const SizedBox.shrink();
    // D2510: one project → that project (not the whole list) when the user may see it.
    final canOpen = ref.watch(currentProfileProvider)?.canSeeProjects ?? false;
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
        PkSectionHeader(
          title: t.progressHomeTitle,
          actionLabel: t.seeAll,
          onAction: () => context.push('/progress?tab=projects'),
          padding: const EdgeInsets.only(bottom: 10),
        ),
        for (final p in sorted.take(3))
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: ProjectProgressCard(
              item: p,
              onTap: () => context.push(canOpen ? '/projects/${p.id}' : '/progress?tab=projects'),
            ),
          ),
      ],
    );
  }
}
