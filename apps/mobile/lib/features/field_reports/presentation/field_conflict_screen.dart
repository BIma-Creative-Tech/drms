import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_lapangan.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/expense_mappers.dart' show Json;
import '../../sync/application/sync_coordinator.dart';
import '../application/field_providers.dart';
import '../domain/field_models.dart';
import 'widgets/field_widgets.dart' show fieldReportIcon;

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
    if (!await confirmAction(context, action: t.fieldUseServer, note: t.fieldUsedServer) || !mounted) return;
    setState(() => _busy = true);
    await ref.read(fieldServiceProvider).useServerVersion(sub, widget.uuid);
    ref.invalidate(myFieldRecordsProvider);
    if (!mounted) return;
    await showActionResult(context, message: t.fieldUsedServer, action: t.fieldUseServer);
    if (mounted) Navigator.of(context).maybePop();
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
      await showActionResult(context, message: t.fieldResent, action: t.fieldResendMine);
      if (mounted) Navigator.of(context).maybePop();
    } on Object catch (e) {
      if (mounted) await showActionError(context, e, action: t.fieldResendMine);
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
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              PkNotice(text: d.lastError ?? t.fieldConflictHint, tone: PkTone.warn, icon: Icons.call_split),
              const SizedBox(height: 6),
              Row(
                children: [
                  PkIconChip(icon: fieldReportIcon(d.type), tone: PkTone.primary, size: 40),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          d.type.label,
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          [d.projectLabel, d.reportDate].where((e) => e.isNotEmpty).join(' · '),
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              for (final row in _rows(t, d, c, names)) _Compare(label: row.$1, server: row.$2, mine: row.$3),
              const SizedBox(height: 8),
              FilledButton.icon(
                key: const Key('field-conflict-use-server'),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                onPressed: _busy ? null : _useServer,
                icon: const Icon(Icons.cloud_done),
                label: Text(t.fieldUseServer),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const Key('field-conflict-resend'),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                onPressed: _busy || !editable ? null : _resend,
                icon: const Icon(Icons.upload),
                label: Text(t.fieldResendMine),
              ),
              if (!editable)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    t.fieldNotEditableAnymore,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
                  ),
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
    final pk = context.pk;
    Widget cell(String title, String text, IconData icon) => Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: differs ? pk.warnBg : theme.colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(PkRadius.sm + 2),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 16, color: differs ? pk.warnOn : theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    title,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: differs ? pk.warnOn : theme.colorScheme.onSurfaceVariant,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(text, style: TextStyle(color: differs ? pk.warnOn : null)),
          ],
        ),
      ),
    );
    return PkCard(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$label${differs ? ' · ${t.fieldDiffers}' : ''}',
            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
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
          child: Text(t.confirmActionYes(actionPhrase(t.fieldResendMine))),
        ),
      ],
    );
  }
}
