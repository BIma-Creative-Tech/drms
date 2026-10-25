import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../auth/application/auth_controller.dart';
import '../../companies/presentation/company_chip.dart';
import '../application/field_providers.dart';
import '../domain/field_models.dart';
import 'aftersales_screen.dart';
import 'daily_report_screen.dart';
import 'service_report_screen.dart';
import 'timesheet_screen.dart';
import 'widgets/field_widgets.dart';

/// FR1 hub "Laporan Lapangan": the report types of the user's projects by project kind (kontrak_unit →
/// Timesheet Unit + Servis; aftersales → Servis + Aktivitas) and "Riwayat saya" (reports on this phone with
/// their state + the user's records on the server).
class FieldHubScreen extends ConsumerWidget {
  const FieldHubScreen({super.key, this.initialTab = 0});
  final int initialTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final open = ref.watch(openFieldDraftsProvider).value ?? const <FieldDraft>[];
    return DefaultTabController(
      length: 2,
      initialIndex: initialTab.clamp(0, 1),
      child: Scaffold(
        appBar: AppBar(
          title: Text(t.fieldHubTitle),
          bottom: TabBar(
            tabs: [
              Tab(key: const Key('field-tab-new'), text: t.fieldTabNew),
              Tab(
                key: const Key('field-tab-history'),
                text: open.isEmpty ? t.fieldTabHistory : '${t.fieldTabHistory} (${open.length})',
              ),
            ],
          ),
        ),
        body: const TabBarView(children: [_NewTab(), _HistoryTab()]),
      ),
    );
  }
}

class _NewTab extends ConsumerWidget {
  const _NewTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final profile = ref.watch(currentProfileProvider);
    final online = ref.watch(connectivityProvider);
    final refresh = ref.watch(fieldCacheRefreshProvider);
    final projects = ref.watch(fieldProjectsProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(fieldCacheRefreshProvider),
      child: AsyncBody<List<FieldProject>>(
        value: projects,
        onRetry: () => ref.invalidate(fieldProjectsProvider),
        data: (list) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            if (!online) FieldNote(text: t.fieldOfflineCache, warn: true),
            if (refresh.isLoading) const LinearProgressIndicator(),
            if (list.isEmpty) PkEmptyState(icon: Icons.assignment_late_outlined, message: t.fieldNoProjectsHub),
            for (final p in list)
              PkCard(
                key: Key('field-project-${p.id}'),
                margin: const EdgeInsets.only(bottom: 12),
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
                                  Expanded(
                                    child: Text(
                                      p.label,
                                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                                    ),
                                  ),
                                ],
                              ),
                              Text(
                                p.kind.label,
                                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    PkTwoColumnGrid(
                      spacing: 8,
                      children: [
                        for (final type in p.kind.reportTypes)
                          if (canCreateField(profile, type, p.companyId))
                            _NewReportTile(
                              key: Key('field-new-${type.segment}-${p.id}'),
                              icon: fieldReportIcon(type),
                              label: type.label,
                              onTap: () => context.push('/field/${type.segment}/new?project=${p.id}'),
                            ),
                      ],
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// One report type of a project: tonal tile (icon + label), ≥ 56 dp, the whole tile is the target.
class _NewReportTile extends StatelessWidget {
  const _NewReportTile({super.key, required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pk = context.pk;
    return Material(
      color: pk.infoBg,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 56),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Icon(icon, color: pk.infoOn, size: 22),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    label,
                    style: theme.textTheme.labelLarge?.copyWith(color: pk.infoOn, fontWeight: FontWeight.w700),
                  ),
                ),
                Icon(Icons.add, color: pk.infoOn, size: 18),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HistoryTab extends ConsumerWidget {
  const _HistoryTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final local = ref.watch(openFieldDraftsProvider).value ?? const <FieldDraft>[];
    final online = ref.watch(connectivityProvider);
    final server = ref.watch(myFieldRecordsProvider);
    final zone = ref.watch(currentProfileProvider)?.timezone;
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(myFieldRecordsProvider),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (local.isNotEmpty) ...[
            PkSectionHeader(title: t.fieldLocalTitle, padding: const EdgeInsets.only(bottom: 10)),
            for (final d in local) _LocalCard(draft: d),
            const SizedBox(height: 6),
          ],
          PkSectionHeader(
            title: t.fieldServerTitle,
            padding: EdgeInsets.only(top: local.isEmpty ? 0 : 14, bottom: 10),
          ),
          if (!online && !server.hasValue)
            FieldNote(text: t.fieldHistoryOffline, warn: true)
          else
            AsyncBody<List<FieldRecord>>(
              value: server,
              onRetry: () => ref.invalidate(myFieldRecordsProvider),
              data: (items) => items.isEmpty
                  ? PkEmptyState(icon: Icons.history, message: t.fieldHistoryEmpty)
                  : Column(
                      children: [for (final r in items) _ServerCard(record: r, zone: zone)],
                    ),
            ),
        ],
      ),
    );
  }
}

class _LocalCard extends ConsumerWidget {
  const _LocalCard({required this.draft});
  final FieldDraft draft;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final d = draft;
    // service report: the names of its service types from the cache
    final names = d.type == FieldReportType.serviceReport
        ? (ref.watch(fieldServiceTypeNamesProvider).value ?? const <int, String>{})
        : const <int, String>{};
    final summary = d.summaryWith(names);
    final decide =
        d.conflictCopy != null && (d.syncState == FieldSyncState.conflict || d.syncState == FieldSyncState.rejected);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return PkCard(
      key: Key('field-local-${d.clientUuid}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push(decide ? '/field/conflict/${d.clientUuid}' : '/field/draft/${d.clientUuid}'),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PkIconChip(icon: fieldReportIcon(d.type), tone: PkTone.warn, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CompanyChipLead(companyId: d.companyId),
                    Expanded(
                      child: Text(
                        d.type.label,
                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FieldStateChip(state: d.syncState),
                  ],
                ),
                Text(
                  [fieldDateLabel(d.reportDate), d.projectLabel].where((e) => e.isNotEmpty).join(' · '),
                  style: muted,
                ),
                if (summary.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(summary, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                  ),
                if (d.isEdit) Text(t.fieldEditTag(d.docNo ?? '#${d.serverId}'), style: muted),
                if (d.lastError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(d.lastError!, style: theme.textTheme.bodySmall?.copyWith(color: context.pk.badText)),
                  ),
                if (decide)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      t.fieldConflictHint,
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

class _ServerCard extends StatelessWidget {
  const _ServerCard({required this.record, this.zone});
  final FieldRecord record;
  final String? zone;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final r = record;
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return PkCard(
      key: Key('field-server-${r.type.code}-${r.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (_) => FieldRecordSheet(record: r, zone: zone),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PkIconChip(icon: fieldReportIcon(r.type), tone: PkTone.info, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CompanyChipLead(companyId: r.companyId),
                    Expanded(
                      child: Text(
                        r.type.label,
                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                    const SizedBox(width: 8),
                    const FieldStateChip(state: FieldSyncState.synced),
                  ],
                ),
                Text(
                  [r.docNo ?? '', formatDateOnly(r.date), r.projectLabel].where((e) => e.isNotEmpty).join(' · '),
                  style: muted,
                ),
                if (r.title.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(r.title, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                  ),
                if (r.subtitle.isNotEmpty) Text(r.subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: muted),
                if (r.flags.isNotEmpty || r.editable)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        for (final f in r.flags) PkPill(label: flagLabel(t, f), tone: PkTone.warn),
                        if (r.editable) PkPill(label: t.fieldEditableTag, tone: PkTone.info, icon: Icons.edit),
                      ],
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

/// Indonesian label of a server flag.
String flagLabel(AppLocalizations t, String flag) => switch (flag) {
  'OFFLINE' => t.fieldFlagOffline,
  'BACKDATED' => t.fieldFlagBackdated,
  'HM_GAP' => t.fieldFlagHmGap,
  'BREAKDOWN_SUGGEST_SERVICE' => t.fieldFlagBreakdown,
  'CORRECTED' => t.fieldFlagCorrected,
  'MELEBIHI_RAP' => t.dailyFlagOverRap,
  'POSSIBLE_DUPLICATE' => t.dailyFlagDuplicate,
  _ => flag,
};

/// Read-only detail of an own server record (+ "Ubah" while the 24 h window is open).
class FieldRecordSheet extends StatelessWidget {
  const FieldRecordSheet({super.key, required this.record, this.zone});
  final FieldRecord record;
  final String? zone;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final r = record;
    final value = r.value;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                PkIconChip(icon: fieldReportIcon(r.type), tone: PkTone.primary, size: 40),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    r.type.label,
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontFamily: PkFonts.heading,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              [r.docNo ?? '', formatDateOnly(r.date)].where((e) => e.isNotEmpty).join(' · '),
              style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
            ),
            Text(r.projectLabel, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            const Divider(height: 24),
            if (r.title.isNotEmpty) Text(r.title, style: theme.textTheme.titleMedium),
            if (r.subtitle.isNotEmpty) Text(r.subtitle),
            for (final p in r.parts)
              Text('• ${[p.summary, if ((p.partNo ?? '').isNotEmpty) '(${p.partNo})'].join(' ')}'),
            if (value != null) Text(t.fieldValueShown(formatRupiah(value))),
            if ((r.raw['notes'] ?? '').toString().isNotEmpty) Text('${t.fieldReportNotes}: ${r.raw['notes']}'),
            if (r.reporterName != null) Text(t.fieldReporter(r.reporterName!), style: theme.textTheme.bodySmall),
            if (r.flags.isNotEmpty)
              Text(r.flags.map((f) => flagLabel(t, f)).join(' · '), style: theme.textTheme.bodySmall),
            if (r.photoIds.isNotEmpty) Text(t.fieldPhotoCount(r.photoIds.length), style: theme.textTheme.bodySmall),
            const SizedBox(height: 12),
            if (r.editable)
              FilledButton.icon(
                key: const Key('field-record-edit'),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                onPressed: () {
                  Navigator.of(context).pop();
                  context.push('/field/edit/${r.type.segment}/${r.id}');
                },
                icon: const Icon(Icons.edit),
                label: Text(t.fieldEditUntil(formatEditableUntil(r.editableUntil, zone))),
              )
            else
              Text(t.fieldNotEditable, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

/// `/field/draft/:uuid` — the editor of a local field report (any type).
class FieldDraftRoute extends ConsumerWidget {
  const FieldDraftRoute({super.key, required this.uuid});
  final String uuid;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final sub = ref.watch(currentSubProvider);
    if (sub == null) return const SizedBox.shrink();
    final value = ref.watch(_localProvider((sub, uuid)));
    return switch (value) {
      AsyncData(value: final FieldDraft d) => editorFor(d),
      AsyncData() => Scaffold(
        appBar: AppBar(title: Text(t.fieldHubTitle)),
        body: Center(child: Text(t.fieldNotFound)),
      ),
      AsyncError() => Scaffold(
        appBar: AppBar(title: Text(t.fieldHubTitle)),
        body: AsyncBody<FieldDraft?>(value: value, data: (_) => const SizedBox()),
      ),
      _ => const Scaffold(body: Center(child: CircularProgressIndicator())),
    };
  }
}

final _localProvider = FutureProvider.autoDispose.family<FieldDraft?, (String, String)>(
  (ref, key) => ref.read(fieldServiceProvider).load(key.$1, key.$2),
);

Widget editorFor(FieldDraft d) => switch (d.type) {
  FieldReportType.serviceReport => ServiceReportScreen(initial: d),
  FieldReportType.unitTimesheet => TimesheetScreen(initial: d),
  FieldReportType.aftersalesActivity => AftersalesScreen(initial: d),
  FieldReportType.dailyReport => DailyReportScreen(initial: d),
};

/// `/field/edit/:type/:id` — own edit (≤ 24 h) of a server record.
class FieldEditRoute extends ConsumerWidget {
  const FieldEditRoute({super.key, required this.type, required this.id});
  final FieldReportType type;
  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final sub = ref.watch(currentSubProvider);
    if (sub == null) return const SizedBox.shrink();
    final value = ref.watch(_editProvider((sub, type, id)));
    return switch (value) {
      AsyncData(value: final FieldDraft d) => editorFor(d),
      AsyncError() => Scaffold(
        appBar: AppBar(title: Text(type.label)),
        body: AsyncBody<FieldDraft>(
          value: value,
          onRetry: () => ref.invalidate(_editProvider((sub, type, id))),
          data: (_) => const SizedBox(),
        ),
      ),
      _ => Scaffold(
        appBar: AppBar(title: Text(t.fieldHubTitle)),
        body: const Center(child: CircularProgressIndicator()),
      ),
    };
  }
}

final _editProvider = FutureProvider.autoDispose.family<FieldDraft, (String, FieldReportType, int)>((ref, key) async {
  final (sub, type, id) = key;
  final r = await ref.read(fieldApiProvider).detail(type, id);
  return ref.read(fieldServiceProvider).startEdit(sub, r);
});
