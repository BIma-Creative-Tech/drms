import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
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
            if (list.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Column(
                  children: [
                    Icon(Icons.assignment_late_outlined, size: 40, color: theme.colorScheme.outline),
                    const SizedBox(height: 8),
                    Text(t.fieldNoProjectsHub, textAlign: TextAlign.center),
                  ],
                ),
              ),
            for (final p in list)
              Card(
                key: Key('field-project-${p.id}'),
                elevation: 0,
                color: theme.colorScheme.surfaceContainerLow,
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          CompanyChipLead(companyId: p.companyId),
                          Expanded(child: Text(p.label, style: theme.textTheme.titleSmall)),
                        ],
                      ),
                      Text(p.kind.label, style: theme.textTheme.bodySmall),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final type in p.kind.reportTypes)
                            if (canCreateField(profile, type, p.companyId))
                              FilledButton.tonalIcon(
                                key: Key('field-new-${type.segment}-${p.id}'),
                                onPressed: () => context.push('/field/${type.segment}/new?project=${p.id}'),
                                icon: Icon(_icon(type)),
                                label: Text(type.label),
                              ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

IconData _icon(FieldReportType type) => switch (type) {
  FieldReportType.serviceReport => Icons.build_circle_outlined,
  FieldReportType.unitTimesheet => Icons.timer_outlined,
  FieldReportType.aftersalesActivity => Icons.local_shipping_outlined,
  FieldReportType.dailyReport => Icons.engineering_outlined,
};

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
            Text(t.fieldLocalTitle, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final d in local) _LocalCard(draft: d),
            const SizedBox(height: 16),
          ],
          Text(t.fieldServerTitle, style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          if (!online && !server.hasValue)
            FieldNote(text: t.fieldHistoryOffline, warn: true)
          else
            AsyncBody<List<FieldRecord>>(
              value: server,
              onRetry: () => ref.invalidate(myFieldRecordsProvider),
              data: (items) => items.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      child: Text(t.fieldHistoryEmpty, textAlign: TextAlign.center),
                    )
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
    return Card(
      key: Key('field-local-${d.clientUuid}'),
      child: InkWell(
        onTap: () => context.push(decide ? '/field/conflict/${d.clientUuid}' : '/field/draft/${d.clientUuid}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CompanyChipLead(companyId: d.companyId),
                  Expanded(child: Text(d.type.label, style: theme.textTheme.labelLarge)),
                  FieldStateChip(state: d.syncState),
                ],
              ),
              Text(
                [fieldDateLabel(d.reportDate), d.projectLabel].where((e) => e.isNotEmpty).join(' · '),
                style: theme.textTheme.bodySmall,
              ),
              if (summary.isNotEmpty) Text(summary, style: theme.textTheme.titleSmall),
              if (d.isEdit) Text(t.fieldEditTag(d.docNo ?? '#${d.serverId}'), style: theme.textTheme.bodySmall),
              if (d.lastError != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(d.lastError!, style: TextStyle(color: theme.colorScheme.error)),
                ),
              if (decide)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(t.fieldConflictHint, style: theme.textTheme.bodySmall),
                ),
            ],
          ),
        ),
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
    return Card(
      key: Key('field-server-${r.type.code}-${r.id}'),
      child: InkWell(
        onTap: () => showModalBottomSheet<void>(
          context: context,
          showDragHandle: true,
          isScrollControlled: true,
          builder: (_) => FieldRecordSheet(record: r, zone: zone),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CompanyChipLead(companyId: r.companyId),
                  Expanded(child: Text(r.type.label, style: theme.textTheme.labelLarge)),
                  const FieldStateChip(state: FieldSyncState.synced),
                ],
              ),
              Text(
                [r.docNo ?? '', formatDateOnly(r.date), r.projectLabel].where((e) => e.isNotEmpty).join(' · '),
                style: theme.textTheme.bodySmall,
              ),
              if (r.title.isNotEmpty) Text(r.title, style: theme.textTheme.titleSmall),
              if (r.subtitle.isNotEmpty) Text(r.subtitle, maxLines: 2, overflow: TextOverflow.ellipsis),
              if (r.flags.isNotEmpty || r.editable)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Wrap(
                    spacing: 6,
                    children: [
                      for (final f in r.flags)
                        Text(flagLabel(t, f), style: theme.textTheme.bodySmall?.copyWith(color: context.pk.warnText)),
                      if (r.editable) Text(t.fieldEditableTag, style: theme.textTheme.bodySmall),
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
            Text(r.type.label, style: theme.textTheme.titleLarge),
            Text([r.docNo ?? '', formatDateOnly(r.date)].where((e) => e.isNotEmpty).join(' · ')),
            Text(r.projectLabel, style: theme.textTheme.bodySmall),
            const Divider(),
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
