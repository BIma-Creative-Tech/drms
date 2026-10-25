import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../auth/application/auth_controller.dart';
import '../../masters/domain/master_item.dart';
import '../../companies/presentation/company_chip.dart';
import '../application/progress_providers.dart';
import '../domain/progress.dart';
import 'widgets/progress_widgets.dart';

/// E4 hub (US-10/12/31): "Laporan" = reports waiting on this phone + the server list (newest first,
/// filter per project); "Project" = progress fisik vs anggaran per project (PM team, Direktur/Finance all).
class ProgressScreen extends ConsumerStatefulWidget {
  const ProgressScreen({super.key, this.initialTab = 0, this.initialProject});
  final int initialTab;

  /// Reports tab filtered to this project (notification "laporan progress terlambat").
  final int? initialProject;

  @override
  ConsumerState<ProgressScreen> createState() => _ProgressScreenState();
}

class _ProgressScreenState extends ConsumerState<ProgressScreen> {
  late int? _projectFilter = widget.initialProject;

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
            PkSectionHeader(title: t.progressLocalTitle, padding: const EdgeInsets.only(bottom: 10)),
            for (final d in local) _LocalCard(draft: d),
            const SizedBox(height: 6),
          ],
          PkSectionHeader(
            title: t.progressServerTitle,
            padding: EdgeInsets.only(top: local.isEmpty ? 0 : 14, bottom: 10),
          ),
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
                // Opened from a notification for a project outside the picker list: keep the filter visible.
                if (projectFilter != null && !projects.any((p) => p.id == projectFilter))
                  DropdownMenuItem<int?>(value: projectFilter, child: Text('#$projectFilter')),
              ],
              onChanged: onFilter,
            ),
          const SizedBox(height: 12),
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
  Widget build(BuildContext context) => PkEmptyState(icon: icon, message: text);
}

class _LocalCard extends ConsumerWidget {
  const _LocalCard({required this.draft});
  final ProgressDraft draft;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final d = draft;
    final needsDecision =
        d.conflictCopy != null &&
        (d.syncState == ProgressSyncState.conflict || d.syncState == ProgressSyncState.rejected);
    return PkCard(
      key: Key('progress-local-${d.clientUuid}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () =>
          context.push(needsDecision ? '/progress/conflict/${d.clientUuid}' : '/progress/draft/${d.clientUuid}'),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PkIconChip(icon: needsDecision ? Icons.call_split : Icons.phone_android, tone: PkTone.warn, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CompanyChipLead(companyId: d.companyId, always: true),
                    Expanded(
                      child: Text(
                        d.projectLabel.isEmpty ? '#${d.projectId}' : d.projectLabel,
                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ProgressStateChip(state: d.syncState),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  [
                    if (d.stageLabel.isNotEmpty) d.stageLabel,
                    '${d.pctBefore == null ? '' : '${fmtPct(d.pctBefore!)} → '}${fmtPct(d.pctAfter)}',
                    if (d.isEdit) t.progressEditTag,
                    t.progressPhotoCount(d.photoTotal),
                  ].join(' · '),
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
                if (d.lastError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(d.lastError!, style: theme.textTheme.bodySmall?.copyWith(color: context.pk.badText)),
                  ),
                if (needsDecision)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      t.progressConflictHint,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
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
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return PkCard(
      key: Key('progress-report-${r.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push('/progress/report/${r.id}'),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (r.photos.isNotEmpty)
            ServerPhotoThumb(photoId: r.photos.first.id, size: 64, group: [for (final p in r.photos) p.id])
          else
            const PkIconChip(icon: Icons.trending_up, tone: PkTone.info, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CompanyChipLead(companyId: r.companyId),
                    Expanded(
                      child: Text(
                        [r.docNo ?? '', formatDateOnly(r.reportDate)].where((e) => e.isNotEmpty).join(' · '),
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                Text(r.projectLabel, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(
                  '${r.stageName ?? '-'} · ${fmtPct(r.pctBefore)} → ${fmtPct(r.pctAfter)}',
                  style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                ),
                Text(r.work, maxLines: 2, overflow: TextOverflow.ellipsis, style: muted),
                if (r.photos.length > 1 || r.offline || r.editable || r.reporterName != null) ...[
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (r.photos.length > 1) PkPill(label: t.progressPhotoCount(r.photos.length), icon: Icons.photo),
                      if (r.offline) PkPill(label: t.progressOfflineTag, tone: PkTone.warn, icon: Icons.cloud_off),
                      if (r.editable) PkPill(label: t.progressEditableTag, tone: PkTone.info, icon: Icons.edit),
                      if (r.reporterName != null) Text(r.reporterName!, style: muted),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
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
            Text(
              t.progressProjectsIntro,
              style: Theme.of(context).textTheme.bodySmall
                  ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 16,
              runSpacing: 6,
              children: [
                _Legend(color: progressSeriesPhysical, label: t.progressPhysical),
                _Legend(color: progressSeriesBudget, label: t.progressBudgetUsed),
              ],
            ),
            const SizedBox(height: 14),
            if (list.projects.isEmpty) _Notice(icon: Icons.domain_disabled, text: t.progressProjectsEmpty),
            for (final p in list.projects)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
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
