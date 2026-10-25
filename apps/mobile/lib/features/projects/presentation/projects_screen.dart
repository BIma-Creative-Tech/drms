import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_proyek.dart';
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
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
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
                          PkEmptyState(
                            icon: Icons.apartment,
                            message: _q.isEmpty && _status == null ? t.projectsEmpty : t.projectsNoMatch,
                          ),
                        ],
                      )
                    : ListView.builder(
                        key: const Key('projects-list'),
                        padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
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

/// Tone of a project status (Berjalan ok, Ditunda warn, Perencanaan info, Selesai / Arsip neutral).
PkTone projectStatusTone(String? status) => switch (status) {
  'berjalan' => PkTone.ok,
  'ditunda' => PkTone.warn,
  'perencanaan' => PkTone.info,
  _ => PkTone.neutral,
};

/// Status pill of a project (Berjalan green, Ditunda amber, Selesai / Arsip muted).
class ProjectStatusChip extends StatelessWidget {
  const ProjectStatusChip({super.key, required this.project});
  final ProjectSummary project;

  @override
  Widget build(BuildContext context) => PkPill(label: project.statusText, tone: projectStatusTone(project.status));
}

/// One project in the list (Banani "ProjectCard"): icon chip, code (+ PT chip), bold name, status pill, PM and
/// contract value, then the RAP realisation bar with "Rp realisasi / Rp rencana" and the percentage.
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
    final muted = theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return PkCard(
      key: Key('project-${p.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push('/projects/${p.id}'),
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
                    Row(
                      children: [
                        CompanyChipLead(companyId: p.companyId),
                        Flexible(
                          child: Text(
                            p.code,
                            style: muted?.copyWith(fontWeight: FontWeight.w700),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      p.name,
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700, height: 1.25),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              ProjectStatusChip(project: p),
            ],
          ),
          const SizedBox(height: 6),
          Padding(
            padding: const EdgeInsets.only(left: 52),
            child: Text(
              [
                '${t.projectPm}: ${p.pm?.name ?? '-'}',
                if (p.contractValue != null) formatRupiah(p.contractValue!),
              ].join(' · '),
              style: pkMetaStyle(context),
            ),
          ),
          if (pct != null) ...[
            const SizedBox(height: 12),
            PkProgressBar(value: pct / 100, color: over ? context.pk.badText : null),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: Text(
                    p.rapPlanned == null
                        ? t.projectRapUsed
                        : '${formatRupiah(p.rapRealised ?? 0)} / ${formatRupiah(p.rapPlanned!)}',
                    style: muted,
                  ),
                ),
                if (p.rapPlanned != null) Text('${t.projectRapUsed} ', style: muted),
                Text(
                  formatPercent(pct, digits: 0),
                  style: theme.textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: over ? context.pk.badText : null,
                  ),
                ),
              ],
            ),
            if ((p.rapOverBudgetItems ?? 0) > 0)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: PkPill(
                    key: Key('project-${p.id}-over'),
                    label: t.projectRapOverItems(p.rapOverBudgetItems!),
                    tone: PkTone.bad,
                    icon: Icons.warning_amber_rounded,
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
