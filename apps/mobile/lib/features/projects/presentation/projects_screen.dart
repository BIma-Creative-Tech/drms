import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../companies/presentation/company_chip.dart';
import '../application/projects_providers.dart';
import '../domain/project.dart';

/// Loads the next page; a failure is shown as a snack bar (the loaded rows stay).
Future<void> loadMoreSafely(BuildContext context, Future<void> Function() loadMore) async {
  try {
    await loadMore();
  } on Object catch (e) {
    if (context.mounted) showSnack(context, errorText(e));
  }
}

/// DRMS 10/10 point 6: "Proyek" — projects of the PT switcher selection with search, status filter and infinite
/// scroll (D8); a tap opens the project with the web tabs Proyek / RAP / Pengajuan. Online read: offline shows the
/// connection error with a retry.
class ProjectsScreen extends ConsumerStatefulWidget {
  const ProjectsScreen({super.key});

  @override
  ConsumerState<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends ConsumerState<ProjectsScreen> {
  String _q = '';

  /// null = server default (every status except Arsip).
  String? _status;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final provider = projectListProvider((q: _q, status: _status));
    final value = ref.watch(provider);
    return Scaffold(
      appBar: AppBar(title: Text(t.projectsTitle)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: ListSearchField(
              key: const Key('projects-search'),
              hint: t.projectsSearchHint,
              onChanged: (v) => setState(() => _q = v),
            ),
          ),
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                for (final s in <ProjectStatus?>[null, ...ProjectStatus.values])
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: ChoiceChip(
                      key: Key('project-status-${s?.code ?? 'aktif'}'),
                      label: Text(s?.label ?? t.projectStatusActive),
                      selected: _status == s?.code,
                      onSelected: (_) => setState(() => _status = s?.code),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => ref.refresh(provider.future),
              child: AsyncBody(
                value: value,
                onRetry: () => ref.invalidate(provider),
                data: (s) => s.items.isEmpty
                    ? ListView(
                        children: [
                          Padding(
                            padding: const EdgeInsets.all(32),
                            child: Center(
                              child: Text(
                                _q.isEmpty && _status == null ? t.projectsEmpty : t.projectsNoMatch,
                                textAlign: TextAlign.center,
                              ),
                            ),
                          ),
                        ],
                      )
                    : ListView.builder(
                        key: const Key('projects-list'),
                        padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                        itemCount: s.items.length + (s.hasMore ? 1 : 0),
                        itemBuilder: (_, i) => i == s.items.length
                            ? LoadMoreTrigger(
                                key: ValueKey('more-${s.items.length}'),
                                onLoad: () => loadMoreSafely(context, () => ref.read(provider.notifier).loadMore()),
                              )
                            : ProjectCard(project: s.items[i]),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Status pill of a project (Berjalan green, Ditunda amber, Selesai / Arsip muted).
class ProjectStatusChip extends StatelessWidget {
  const ProjectStatusChip({super.key, required this.project});
  final ProjectSummary project;

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    final color = switch (project.status) {
      'berjalan' => pk.okText,
      'ditunda' => pk.warnText,
      'perencanaan' => Theme.of(context).colorScheme.primary,
      _ => Theme.of(context).colorScheme.outline,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
      child: Text(
        project.statusText,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w700),
      ),
    );
  }
}

/// One project in the list: PT chip, code + status, name, PM, contract value and the RAP realisation bar.
class ProjectCard extends StatelessWidget {
  const ProjectCard({super.key, required this.project});
  final ProjectSummary project;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final p = project;
    final pct = p.rapPercent;
    // the bar turns red only when the whole RAP is over plan; single items over plan are named below it
    final over = (pct ?? 0) > 100;
    return Card(
      key: Key('project-${p.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/projects/${p.id}'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CompanyChipLead(companyId: p.companyId),
                  Expanded(
                    child: Text(
                      p.code,
                      style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  ProjectStatusChip(project: p),
                ],
              ),
              const SizedBox(height: 4),
              Text(p.name, style: theme.textTheme.titleMedium),
              const SizedBox(height: 2),
              Text(
                [
                  '${t.projectPm}: ${p.pm?.name ?? '-'}',
                  if (p.contractValue != null) formatRupiah(p.contractValue!),
                ].join(' · '),
                style: theme.textTheme.bodySmall,
              ),
              if (pct != null) ...[
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(child: Text(t.projectRapUsed, style: theme.textTheme.labelMedium)),
                    Text(
                      formatPercent(pct, digits: 0),
                      style: theme.textTheme.labelMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: over ? context.pk.badText : null,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: (pct / 100).clamp(0, 1).toDouble(),
                    minHeight: 6,
                    color: over ? context.pk.badText : theme.colorScheme.primary,
                    backgroundColor: theme.colorScheme.surfaceContainerHighest,
                  ),
                ),
                if ((p.rapOverBudgetItems ?? 0) > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      t.projectRapOverItems(p.rapOverBudgetItems!),
                      key: Key('project-${p.id}-over'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: context.pk.badText,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
