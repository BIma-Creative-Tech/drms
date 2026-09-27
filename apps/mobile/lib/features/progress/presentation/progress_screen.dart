import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../../masters/domain/master_item.dart';
import '../application/progress_providers.dart';
import '../domain/progress.dart';
import 'widgets/progress_widgets.dart';

/// E4 hub (US-10/12/31): "Laporan" = reports waiting on this phone + the server list (newest first,
/// filter per project); "Project" = progress fisik vs anggaran per project (PM team, Direktur/Finance all).
class ProgressScreen extends ConsumerStatefulWidget {
  const ProgressScreen({super.key, this.initialTab = 0});
  final int initialTab;

  @override
  ConsumerState<ProgressScreen> createState() => _ProgressScreenState();
}

class _ProgressScreenState extends ConsumerState<ProgressScreen> {
  int? _projectFilter;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(currentProfileProvider);
    final canCreate = profile?.canCreateProgress ?? false;
    return DefaultTabController(
      length: 2,
      initialIndex: widget.initialTab.clamp(0, 1),
      child: Scaffold(
        appBar: AppBar(
          title: Text(t.progressTitle),
          bottom: TabBar(
            labelColor: Theme.of(context).colorScheme.onPrimary,
            unselectedLabelColor: Theme.of(context).colorScheme.onPrimary.withValues(alpha: 0.75),
            indicatorColor: Theme.of(context).colorScheme.onPrimary,
            tabs: [
              Tab(key: const Key('progress-tab-reports'), text: t.progressTabReports),
              Tab(key: const Key('progress-tab-projects'), text: t.progressTabProjects),
            ],
          ),
        ),
        floatingActionButton: canCreate
            ? FloatingActionButton.extended(
                key: const Key('progress-new'),
                onPressed: () => context.push('/progress/new'),
                icon: const Icon(Icons.add_a_photo),
                label: Text(t.progressNew),
              )
            : null,
        body: TabBarView(
          children: [
            _ReportsTab(projectFilter: _projectFilter, onFilter: (v) => setState(() => _projectFilter = v)),
            const _ProjectsTab(),
          ],
        ),
      ),
    );
  }
}

class _ReportsTab extends ConsumerWidget {
  const _ReportsTab({required this.projectFilter, required this.onFilter});
  final int? projectFilter;
  final ValueChanged<int?> onFilter;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final local = ref.watch(openProgressDraftsProvider).value ?? const <ProgressDraft>[];
    final online = ref.watch(connectivityProvider);
    final projects = ref.watch(progressProjectsProvider).value ?? const <MasterItem>[];
    final page = ref.watch(progressReportsProvider(projectFilter));
    final zone = ref.watch(currentProfileProvider)?.timezone;
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(progressReportsProvider(projectFilter)),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          if (local.isNotEmpty) ...[
            Text(t.progressLocalTitle, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final d in local) _LocalCard(draft: d),
            const SizedBox(height: 16),
          ],
          Row(
            children: [Expanded(child: Text(t.progressServerTitle, style: Theme.of(context).textTheme.titleMedium))],
          ),
          const SizedBox(height: 8),
          if (projects.length > 1)
            DropdownButtonFormField<int?>(
              key: const Key('progress-filter'),
              initialValue: projectFilter,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: t.progressFilterProject,
                prefixIcon: const Icon(Icons.filter_list),
              ),
              items: [
                DropdownMenuItem<int?>(value: null, child: Text(t.progressFilterAll)),
                for (final p in projects) DropdownMenuItem<int?>(value: p.id, child: Text(p.label)),
              ],
              onChanged: onFilter,
            ),
          const SizedBox(height: 8),
          if (!online && !page.hasValue)
            _Notice(icon: Icons.cloud_off, text: t.progressListOffline)
          else
            AsyncBody(
              value: page,
              onRetry: () => ref.invalidate(progressReportsProvider(projectFilter)),
              data: (p) => p.items.isEmpty
                  ? _Notice(icon: Icons.inbox_outlined, text: t.progressListEmpty)
                  : Column(
                      children: [for (final r in p.items) _ReportCard(report: r, zone: zone)],
                    ),
            ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 24),
    child: Column(
      children: [
        Icon(icon, size: 40, color: Theme.of(context).colorScheme.outline),
        const SizedBox(height: 8),
        Text(text, textAlign: TextAlign.center),
      ],
    ),
  );
}

class _LocalCard extends ConsumerWidget {
  const _LocalCard({required this.draft});
  final ProgressDraft draft;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final d = draft;
    final needsDecision =
        d.conflictCopy != null &&
        (d.syncState == ProgressSyncState.conflict || d.syncState == ProgressSyncState.rejected);
    return Card(
      key: Key('progress-local-${d.clientUuid}'),
      child: InkWell(
        onTap: () =>
            context.push(needsDecision ? '/progress/conflict/${d.clientUuid}' : '/progress/draft/${d.clientUuid}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      d.projectLabel.isEmpty ? '#${d.projectId}' : d.projectLabel,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                  ),
                  ProgressStateChip(state: d.syncState),
                ],
              ),
              Text(
                [
                  if (d.stageLabel.isNotEmpty) d.stageLabel,
                  '${d.pctBefore == null ? '' : '${fmtPct(d.pctBefore!)} → '}${fmtPct(d.pctAfter)}',
                  if (d.isEdit) t.progressEditTag,
                  t.progressPhotoCount(d.photoTotal),
                ].join(' · '),
              ),
              if (d.lastError != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(d.lastError!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
              if (needsDecision)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(t.progressConflictHint, style: Theme.of(context).textTheme.bodySmall),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReportCard extends StatelessWidget {
  const _ReportCard({required this.report, this.zone});
  final ProgressReport report;
  final String? zone;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final r = report;
    final theme = Theme.of(context);
    return Card(
      key: Key('progress-report-${r.id}'),
      child: InkWell(
        onTap: () => context.push('/progress/report/${r.id}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (r.photos.isNotEmpty) ...[
                ServerPhotoThumb(photoId: r.photos.first.id, size: 64),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      [r.docNo ?? '', formatDateOnly(r.reportDate)].where((e) => e.isNotEmpty).join(' · '),
                      style: theme.textTheme.labelMedium,
                    ),
                    Text(r.projectLabel, style: theme.textTheme.titleSmall),
                    Text('${r.stageName ?? '-'} · ${fmtPct(r.pctBefore)} → ${fmtPct(r.pctAfter)}'),
                    Text(r.work, maxLines: 2, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      children: [
                        if (r.photos.length > 1)
                          Text(t.progressPhotoCount(r.photos.length), style: theme.textTheme.bodySmall),
                        if (r.offline) Text(t.progressOfflineTag, style: theme.textTheme.bodySmall),
                        if (r.editable) Text(t.progressEditableTag, style: theme.textTheme.bodySmall),
                        if (r.reporterName != null) Text(r.reporterName!, style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProjectsTab extends ConsumerWidget {
  const _ProjectsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final data = ref.watch(projectProgressProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(projectProgressProvider),
      child: AsyncBody(
        value: data,
        onRetry: () => ref.invalidate(projectProgressProvider),
        data: (list) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            Text(t.progressProjectsIntro, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Wrap(
              spacing: 16,
              children: [
                _Legend(color: progressSeriesPhysical, label: t.progressPhysical),
                _Legend(color: progressSeriesBudget, label: t.progressBudgetUsed),
              ],
            ),
            const SizedBox(height: 12),
            if (list.projects.isEmpty) _Notice(icon: Icons.domain_disabled, text: t.progressProjectsEmpty),
            for (final p in list.projects)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: ProjectProgressCard(item: p),
              ),
          ],
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 12,
        height: 12,
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3)),
      ),
      const SizedBox(width: 6),
      Text(label, style: Theme.of(context).textTheme.bodySmall),
    ],
  );
}
