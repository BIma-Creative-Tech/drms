import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/connectivity/connectivity_controller.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/expense_mappers.dart' show Json;
import '../../sync/application/sync_coordinator.dart';
import '../application/field_providers.dart';
import '../domain/field_models.dart';

final _draftProvider = Provider.autoDispose.family<AsyncValue<FieldDraft?>, String>(
  (ref, uuid) => ref.watch(openFieldDraftsProvider).whenData((l) => l.where((d) => d.clientUuid == uuid).firstOrNull),
);

/// Conflict / NOT_EDITABLE of a field report (ADR 0010: server wins by default). The server version and the
/// phone's version are shown side by side; the user keeps the server version (local copy deleted) or sends the
/// phone's version again as an edit of the current server version with a reason (only within 24 h).
class FieldConflictScreen extends ConsumerStatefulWidget {
  const FieldConflictScreen({super.key, required this.uuid});
  final String uuid;

  @override
  ConsumerState<FieldConflictScreen> createState() => _FieldConflictScreenState();
}

class _FieldConflictScreenState extends ConsumerState<FieldConflictScreen> {
  bool _busy = false;

  Future<void> _useServer() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    setState(() => _busy = true);
    await ref.read(fieldServiceProvider).useServerVersion(sub, widget.uuid);
    ref.invalidate(myFieldRecordsProvider);
    if (!mounted) return;
    showSnack(context, t.fieldUsedServer);
    Navigator.of(context).maybePop();
  }

  Future<void> _resend() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final reason = await showDialog<String>(context: context, builder: (_) => const _ReasonDialog());
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(fieldServiceProvider)
          .resendMine(sub, widget.uuid, reason: reason, online: ref.read(connectivityProvider));
      ref.read(syncCoordinatorProvider.notifier).requestSync(delay: Duration.zero);
      if (!mounted) return;
      showSnack(context, t.fieldResent);
      Navigator.of(context).maybePop();
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(_draftProvider(widget.uuid));
    final service = value.value?.type == FieldReportType.serviceReport;
    final names = service
        ? (ref.watch(fieldServiceTypeNamesProvider).value ?? const <int, String>{})
        : const <int, String>{};
    return Scaffold(
      appBar: AppBar(title: Text(t.fieldConflictTitle)),
      body: AsyncBody<FieldDraft?>(
        value: value,
        data: (d) {
          final c = d?.conflictCopy;
          if (d == null || c == null) return Center(child: Text(t.fieldConflictGone));
          final until = DateTime.tryParse(fStr(c['editable_until']));
          final editable = until != null && until.isAfter(DateTime.now());
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(padding: const EdgeInsets.all(12), child: Text(d.lastError ?? t.fieldConflictHint)),
              ),
              const SizedBox(height: 8),
              Text(d.type.label, style: Theme.of(context).textTheme.titleMedium),
              Text([d.projectLabel, d.reportDate].where((e) => e.isNotEmpty).join(' · ')),
              const SizedBox(height: 12),
              for (final row in _rows(t, d, c, names)) _Compare(label: row.$1, server: row.$2, mine: row.$3),
              const SizedBox(height: 16),
              FilledButton.icon(
                key: const Key('field-conflict-use-server'),
                onPressed: _busy ? null : _useServer,
                icon: const Icon(Icons.cloud_done),
                label: Text(t.fieldUseServer),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const Key('field-conflict-resend'),
                onPressed: _busy || !editable ? null : _resend,
                icon: const Icon(Icons.upload),
                label: Text(t.fieldResendMine),
              ),
              if (!editable)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(t.fieldNotEditableAnymore, textAlign: TextAlign.center),
                ),
            ],
          );
        },
      ),
    );
  }

  /// (label, server, mine) of the fields the server copy carries. [names]: id → name of the cached service types.
  List<(String, String, String)> _rows(AppLocalizations t, FieldDraft d, Json c, Map<int, String> names) {
    String n(Object? v) => fDblN(v) == null ? '-' : fmtNum(fDblN(v)!);
    String s(Object? v) => (v == null || '$v'.isEmpty) ? '-' : '$v';
    final photos = d.type == FieldReportType.unitTimesheet
        ? (c['hm_photo_media_id'] == null ? 0 : 1)
        : fList(c['photo_media_ids']).length;
    switch (d.content) {
      case final ServiceContent m:
        return [
          (t.fieldHmAtService, n(c['hour_meter']), m.hourMeter == null ? '-' : fmtNum(m.hourMeter!)),
          (t.fieldServiceType, s(serviceTypesOfCopy(c, names)), s(m.serviceTypeLabel(names))),
          (t.fieldAction, s(c['action']), m.action.trim().isEmpty ? '-' : m.action.trim()),
          (
            t.fieldUnitStatusAfter,
            UnitStatus.fromCode(c['unit_status_after'])?.label ?? '-',
            m.unitStatusAfter?.label ?? '-',
          ),
          (t.fieldPhotos, '$photos', t.fieldNewPhotos(m.photoUuids.length)),
        ];
      case final TimesheetContent m:
        return [
          (t.fieldHmStart, n(c['hm_start']), m.hmStart == null ? '-' : fmtNum(m.hmStart!)),
          (t.fieldHmEnd, n(c['hm_end']), m.hmEnd == null ? '-' : fmtNum(m.hmEnd!)),
          (t.fieldWorkHours, n(c['work_hours']), m.workHours == null ? '-' : fmtNum(m.workHours!)),
          (t.fieldStandbyHours, n(c['standby_hours']), m.standbyHours == null ? '-' : fmtNum(m.standbyHours!)),
          (t.fieldBreakdownHours, n(c['breakdown_hours']), m.breakdownHours == null ? '-' : fmtNum(m.breakdownHours!)),
        ];
      case final ActivityContent m:
        return [
          (t.fieldActivityKind, ActivityKind.fromCode(c['kind'])?.label ?? '-', m.kind?.label ?? '-'),
          (t.fieldDocOther, s(c['doc_no']), m.docNo.trim().isEmpty ? '-' : m.docNo.trim()),
          (t.fieldPoStatus, PoStatus.fromCode(c['po_status'])?.label ?? '-', '-'),
          (t.fieldPhotos, '$photos', t.fieldNewPhotos(m.photoUuids.length)),
        ];
      case final DailyContent m:
        final serverWork = {for (final w in fList(c['work'])) fInt(fMap(w)['rap_item_id']): fDblN(fMap(w)['qty']) ?? 0};
        final ids = {...serverWork.keys, ...m.work.keys}.toList()..sort();
        return [
          for (final id in ids)
            (t.dailyWorkItem('#$id'), n(serverWork[id]), m.work[id] == null ? '-' : fmtNum(m.work[id]!)),
          (t.dailyWorkerCount, n(c['worker_count']), '${m.workerCount}'),
          (t.fieldPhotos, '$photos', t.fieldNewPhotos(m.photoUuids.length)),
        ];
    }
  }
}

/// Service types of a server copy (`SyncServiceReportCopy`): names of `service_type_ids` from the cache ("#id" when
/// unknown), else the legacy `service_type` code.
String serviceTypesOfCopy(Json c, Map<int, String> names) {
  final ids = [for (final e in fList(c['service_type_ids'])) ?fIntN(e)];
  return ids.isEmpty ? fStr(c['service_type']) : ids.map((id) => names[id] ?? '#$id').join(', ');
}

class _Compare extends StatelessWidget {
  const _Compare({required this.label, required this.server, required this.mine});
  final String label;
  final String server;
  final String mine;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final differs = server.trim() != mine.trim();
    Widget cell(String title, String text, IconData icon) => Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
          border: differs ? Border.all(color: theme.colorScheme.outline) : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 16),
                const SizedBox(width: 4),
                Text(title, style: theme.textTheme.labelSmall),
              ],
            ),
            const SizedBox(height: 4),
            Text(text),
          ],
        ),
      ),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$label${differs ? ' · ${t.fieldDiffers}' : ''}', style: theme.textTheme.titleSmall),
          const SizedBox(height: 4),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                cell(t.fieldServerVersion, server, Icons.cloud),
                const SizedBox(width: 8),
                cell(t.fieldMyVersion, mine, Icons.phone_android),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog();
  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _c = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(t.fieldResendReason),
      content: TextField(
        key: const Key('field-reason-input'),
        controller: _c,
        autofocus: true,
        maxLength: 1000,
        decoration: InputDecoration(helperText: t.fieldResendReasonHelp, errorText: _error),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: const Key('field-reason-ok'),
          onPressed: () {
            final v = _c.text.trim();
            if (v.length < 3) {
              setState(() => _error = t.reasonTooShort);
              return;
            }
            Navigator.pop(context, v);
          },
          child: Text(t.next),
        ),
      ],
    );
  }
}
