import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../auth/application/auth_controller.dart';
import '../../masters/domain/master_item.dart';
import '../../sync/application/sync_coordinator.dart';
import '../application/draft_service.dart';
import '../application/expense_providers.dart';
import '../domain/draft.dart';
import '../domain/draft_validation.dart';
import '../domain/request_status.dart';
import 'line_editor_screen.dart';
import 'requests_screen.dart' show syncStateLabel;
import 'widgets/master_picker.dart';

final _draftLoadProvider = FutureProvider.autoDispose.family<DraftRequest?, String>((ref, uuid) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return null;
  return ref.watch(draftRepositoryProvider).load(sub, uuid);
});

/// Route entry: `/drafts/new?type=…` or `/drafts/:uuid`.
class DraftEditorRoute extends ConsumerWidget {
  const DraftEditorRoute({super.key, this.uuid, this.type});
  final String? uuid;
  final RequestType? type;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final masters = ref.watch(mastersProvider);
    if (uuid == null) {
      final employeeId = ref.watch(currentProfileProvider)?.employee?.id;
      final draft = ref
          .read(draftServiceProvider)
          .newDraft(type ?? RequestType.reimburse, requesterIds: employeeId == null ? const [] : [employeeId]);
      return _withMasters(masters, (m) => DraftEditorScreen(initial: draft, masters: m, isNew: true));
    }
    return AsyncBody(
      value: ref.watch(_draftLoadProvider(uuid!)),
      data: (d) => d == null
          ? Scaffold(body: Center(child: Text(AppLocalizations.of(context).draftNotFound)))
          : _withMasters(masters, (m) => DraftEditorScreen(initial: d, masters: m, isNew: false)),
    );
  }

  Widget _withMasters(AsyncValue<Map<String, List<MasterItem>>> v, Widget Function(Map<String, List<MasterItem>>) b) =>
      switch (v) {
        AsyncData(:final value) => b(value),
        AsyncError() => b(const {}),
        _ => const Scaffold(body: Center(child: CircularProgressIndicator())),
      };
}

class DraftEditorScreen extends ConsumerStatefulWidget {
  const DraftEditorScreen({super.key, required this.initial, required this.masters, required this.isNew});
  final DraftRequest initial;
  final Map<String, List<MasterItem>> masters;
  final bool isNew;

  @override
  ConsumerState<DraftEditorScreen> createState() => _DraftEditorScreenState();
}

class _DraftEditorScreenState extends ConsumerState<DraftEditorScreen> {
  late DraftRequest _d = widget.initial;
  late final _title = TextEditingController(text: widget.initial.title);
  late final _notes = TextEditingController(text: widget.initial.notes ?? '');
  late bool _useProject = widget.initial.costCenterId == null;
  bool _busy = false;
  List<DraftIssue> _issues = const [];

  @override
  void dispose() {
    _title.dispose();
    _notes.dispose();
    super.dispose();
  }

  DraftRequest _collect() => _d.copyWith(
    title: _title.text,
    notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
    projectId: _useProject ? _d.projectId : null,
    costCenterId: _useProject ? null : _d.costCenterId,
  );

  Future<void> _editLine(DraftLine line, {bool isNew = false}) async {
    final updated = await Navigator.of(context).push<DraftLine>(
      MaterialPageRoute(
        builder: (_) => LineEditorScreen(line: line, masters: widget.masters),
      ),
    );
    if (updated == null) return;
    setState(() {
      final lines = [..._d.lines];
      final i = lines.indexWhere((l) => l.clientUuid == updated.clientUuid);
      if (i >= 0) {
        lines[i] = updated;
      } else {
        lines.add(updated);
      }
      _d = _d.copyWith(lines: renumber(lines));
    });
  }

  Future<bool> _save({bool quiet = false}) async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return false;
    final draft = _collect();
    setState(() => _issues = validateForSave(draft));
    if (_issues.isNotEmpty) return false;
    setState(() => _busy = true);
    try {
      final online = ref.read(connectivityProvider);
      final saved = await ref
          .read(draftServiceProvider)
          .save(sub, draft, online: online, timezone: ref.read(currentProfileProvider)?.timezone ?? 'Asia/Makassar');
      _d = saved;
      ref.read(syncCoordinatorProvider.notifier).requestSync();
      if (mounted && !quiet) showSnack(context, online ? t.draftSaved : t.draftSavedQueued);
      return true;
    } on DraftValidationException catch (e) {
      setState(() => _issues = e.issues);
      return false;
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    final t = AppLocalizations.of(context);
    final draft = _collect();
    final issues = validateForSubmit(draft);
    setState(() => _issues = issues);
    if (issues.isNotEmpty) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(t.submitConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
          FilledButton(
            key: const Key('submit-confirm'),
            onPressed: () => Navigator.pop(c, true),
            child: Text(t.submit),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    if (!await _save(quiet: true)) return;
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    setState(() => _busy = true);
    try {
      final detail = await ref.read(draftServiceProvider).submit(sub, _d);
      if (!mounted) return;
      showSnack(context, t.submitted);
      ref.invalidate(requestListProvider('mine'));
      context.pushReplacement('/requests/${detail.id}');
    } on DraftValidationException catch (e) {
      setState(() => _issues = e.issues);
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(t.deleteDraftConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(t.delete)),
        ],
      ),
    );
    if (ok != true || sub == null) return;
    await ref.read(draftServiceProvider).delete(sub, _d, online: ref.read(connectivityProvider));
    ref.read(syncCoordinatorProvider.notifier).requestSync();
    if (mounted) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final m = widget.masters;
    final employees = m[MasterTypes.employees] ?? const [];
    final accounts = (m[MasterTypes.bankAccounts] ?? const [])
        .where((a) => _d.requesterIds.isEmpty || _d.requesterIds.contains((a.extra['employee'] as num?)?.toInt()))
        .toList();
    String? issueFor(String field) => _issues.where((i) => i.field == field && i.lineNo == null).firstOrNull?.message;
    final editableType = _d.serverId == null;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isNew ? t.editorNewTitle : t.editorEditTitle),
        actions: [
          if (!widget.isNew) IconButton(onPressed: _busy ? null : _delete, icon: const Icon(Icons.delete_outline)),
        ],
      ),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (m.isEmpty)
              Card(
                child: Padding(padding: const EdgeInsets.all(12), child: Text(t.mastersMissing)),
              ),
            if (!widget.isNew)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text('${syncStateLabel(t, _d.syncState)}${_d.lastError != null ? '\n${_d.lastError}' : ''}'),
              ),
            Text(t.fieldType),
            const SizedBox(height: 4),
            SegmentedButton<RequestType>(
              segments: [for (final ty in RequestType.values) ButtonSegment(value: ty, label: Text(ty.label))],
              selected: {_d.type},
              onSelectionChanged: editableType ? (s) => setState(() => _d = _d.copyWith(type: s.first)) : null,
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('draft-title'),
              controller: _title,
              maxLength: 200,
              decoration: InputDecoration(labelText: t.fieldTitle, errorText: issueFor('title')),
            ),
            SegmentedButton<bool>(
              segments: [
                ButtonSegment(value: true, label: Text(t.scopeProject)),
                ButtonSegment(value: false, label: Text(t.scopeCostCenter)),
              ],
              selected: {_useProject},
              onSelectionChanged: (s) => setState(() => _useProject = s.first),
            ),
            const SizedBox(height: 8),
            if (_useProject)
              MasterPickerField(
                label: t.fieldProject,
                items: m[MasterTypes.projects] ?? const [],
                value: _d.projectId,
                errorText: issueFor('scope'),
                onChanged: (v) => setState(() => _d = _d.copyWith(projectId: v)),
              )
            else
              MasterPickerField(
                label: t.fieldCostCenter,
                items: m[MasterTypes.costCenters] ?? const [],
                value: _d.costCenterId,
                errorText: issueFor('scope'),
                onChanged: (v) => setState(() => _d = _d.copyWith(costCenterId: v)),
              ),
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(t.fieldNeededDate),
              subtitle: Text(formatDateOnly(_d.neededDate)),
              trailing: const Icon(Icons.calendar_today),
              onTap: () async {
                final now = DateTime.now();
                final picked = await showDatePicker(
                  context: context,
                  initialDate: DateTime.tryParse(_d.neededDate ?? '') ?? now,
                  firstDate: now.subtract(const Duration(days: 60)),
                  lastDate: now.add(const Duration(days: 365)),
                );
                if (picked != null) setState(() => _d = _d.copyWith(neededDate: toYmd(picked)));
              },
            ),
            Text(t.fieldRequesters),
            Wrap(
              spacing: 6,
              children: [
                for (final id in _d.requesterIds)
                  InputChip(
                    label: Text(employees.where((e) => e.id == id).firstOrNull?.label ?? '#$id'),
                    onDeleted: _d.requesterIds.length > 1
                        ? () => setState(() => _d = _d.copyWith(requesterIds: [..._d.requesterIds]..remove(id)))
                        : null,
                  ),
                ActionChip(
                  avatar: const Icon(Icons.person_add, size: 18),
                  label: Text(t.choose),
                  onPressed: () async {
                    int? chosen;
                    await showDialog<void>(
                      context: context,
                      builder: (c) => AlertDialog(
                        content: MasterPickerField(
                          label: t.fieldRequesters,
                          items: employees,
                          value: null,
                          allowNone: false,
                          onChanged: (v) {
                            chosen = v;
                            Navigator.pop(c);
                          },
                        ),
                      ),
                    );
                    if (chosen != null && !_d.requesterIds.contains(chosen)) {
                      setState(() => _d = _d.copyWith(requesterIds: [..._d.requesterIds, chosen!]));
                    }
                  },
                ),
              ],
            ),
            const SizedBox(height: 12),
            MasterPickerField(
              label: t.fieldBankAccount,
              items: accounts,
              value: _d.bankAccountId,
              errorText: issueFor('bankAccountId'),
              onChanged: (v) => setState(() => _d = _d.copyWith(bankAccountId: v)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notes,
              maxLength: 2000,
              maxLines: 3,
              minLines: 1,
              decoration: InputDecoration(labelText: t.fieldNotes),
            ),
            const Divider(height: 24),
            Row(
              children: [
                Expanded(child: Text(t.linesTitle, style: Theme.of(context).textTheme.titleMedium)),
                TextButton.icon(
                  key: const Key('add-line'),
                  onPressed: () => _editLine(ref.read(draftServiceProvider).newLine(_d.lines.length + 1), isNew: true),
                  icon: const Icon(Icons.add),
                  label: Text(t.addLine),
                ),
              ],
            ),
            if (issueFor('lines') != null)
              Text(issueFor('lines')!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            for (final l in _d.lines)
              Card(
                key: Key('line-${l.no}'),
                child: ListTile(
                  title: Text('${l.no}. ${l.description.isEmpty ? '-' : l.description}'),
                  subtitle: Text(
                    [
                      '${l.receipts.length} nota',
                      for (final i in _issues.where((i) => i.lineNo == l.no)) i.message,
                    ].join('\n'),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(l.total == null ? '-' : formatRupiah(l.total!)),
                      IconButton(
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => setState(
                          () => _d = _d.copyWith(
                            lines: renumber([
                              for (final x in _d.lines)
                                if (x.clientUuid != l.clientUuid) x,
                            ]),
                          ),
                        ),
                      ),
                    ],
                  ),
                  onTap: () => _editLine(l),
                ),
              ),
            const SizedBox(height: 8),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(t.totalPreview),
              subtitle: Text(t.previewNote),
              trailing: Text(
                formatRupiah(_collect().previewGrandTotal),
                key: const Key('preview-total'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            if (_issues.isNotEmpty)
              Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(_issues.map((e) => '• $e').join('\n'), key: const Key('draft-issues')),
                ),
              ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              key: const Key('save-draft'),
              onPressed: _busy ? null : _save,
              icon: const Icon(Icons.save),
              label: Text(t.saveDraft),
            ),
            const SizedBox(height: 12),
            OnlineOnlyButton(
              key: const Key('submit-draft'),
              label: t.submit,
              icon: Icons.send,
              onPressed: _busy ? null : _submit,
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
