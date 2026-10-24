import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../app/theme.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/platform/report_files.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../../shared/widgets/reason_dialog.dart';
import '../../expense/presentation/widgets/master_picker.dart';
import '../../masters/domain/master_item.dart';
import '../../projects/application/projects_providers.dart';
import '../data/rap_providers.dart';
import '../domain/rap_edit.dart';

const _xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/// `/projects/:id/rap` (user 2026-10-19, phase 5b): the web "RAP proyek" page — the items (search, "Sudah terpakai",
/// inactive ones), "Tambah item" / edit (reason when the RAP is locked or the item is used), and the menu: Impor Excel
/// (pick .xlsx → preview → commit), Unduh template / RAP (.xlsx), Terapkan template, Simpan sebagai template. Edit only
/// while the server allows it (`canEdit`: Direktur, or the PM before the RAP is locked).
class RapManageScreen extends ConsumerStatefulWidget {
  const RapManageScreen({super.key, required this.projectId});
  final int projectId;

  @override
  ConsumerState<RapManageScreen> createState() => _RapManageScreenState();
}

class _RapManageScreenState extends ConsumerState<RapManageScreen> {
  String _q = '';
  bool _busy = false;

  void _refresh() {
    ref.invalidate(rapEditProvider(widget.projectId));
    ref.invalidate(projectRapProvider(widget.projectId));
    ref.invalidate(projectDetailProvider(widget.projectId));
  }

  Future<void> _run(Future<void> Function() action, String done, String label) async {
    setState(() => _busy = true);
    try {
      await action();
      _refresh();
      if (mounted) await showActionResult(context, message: done, action: label);
    } on Object catch (e) {
      if (mounted) await showActionError(context, e, action: label);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit(RapEditData rap, [RapEditItem? item]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => _ItemSheet(rap: rap, item: item),
    );
    if (saved == true) _refresh();
  }

  Future<void> _import(RapEditData rap) async {
    final t = AppLocalizations.of(context);
    final picked = await ref.read(filePickerProvider).pick(mimeTypes: const [_xlsxMime], maxBytes: 2 * 1024 * 1024);
    if (picked == null || !mounted) return;
    final bytes = picked.bytes;
    if (picked.tooLarge || bytes == null) {
      showSnack(context, t.rapImportTooLarge);
      return;
    }
    final api = ref.read(rapApiProvider);
    setState(() => _busy = true);
    RapPreviewData p;
    try {
      p = await api.preview(widget.projectId, bytes, picked.name);
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
      return;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => _PreviewDialog(preview: p, fileName: picked.name),
    );
    if (reason == null) return;
    await _run(
      () => api.commit(widget.projectId, bytes, picked.name, fileHash: p.fileHash, reason: reason),
      t.rapImported,
      t.rapImportCommit,
    );
  }

  Future<void> _download(String path, String name) async {
    final t = AppLocalizations.of(context);
    final files = ref.read(reportFilesProvider);
    setState(() => _busy = true);
    try {
      final bytes = await ref.read(rapApiProvider).xlsx(path);
      if (!await files.save(name, bytes)) {
        if (mounted) showSnack(context, t.reportsSaveFailed);
        return;
      }
      if (!await files.share(name) && mounted) showSnack(context, t.reportsNoApp);
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _applyTemplate() async {
    final t = AppLocalizations.of(context);
    final api = ref.read(rapApiProvider);
    List<(int, String)> list;
    try {
      list = await api.templates();
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
      return;
    }
    if (!mounted) return;
    final id = await showModalBottomSheet<int>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
              child: Text(t.rapApplyTemplateHint, style: Theme.of(c).textTheme.bodySmall),
            ),
            if (list.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Text(t.rapNoTemplates)),
            for (final (tid, name) in list)
              ListTile(key: Key('rap-template-$tid'), title: Text(name), onTap: () => Navigator.pop(c, tid)),
          ],
        ),
      ),
    );
    if (id == null || !mounted) return;
    final name = list.where((e) => e.$1 == id).firstOrNull?.$2;
    if (!await confirmAction(context, action: t.rapApplyTemplate, summary: [name]) || !mounted) return;
    await _run(
      () => api.applyTemplate(widget.projectId, id, idempotencyKey: const Uuid().v4()),
      t.rapTemplateApplied,
      t.rapApplyTemplate,
    );
  }

  Future<void> _saveTemplate() async {
    final t = AppLocalizations.of(context);
    final name = await showReasonDialog(
      context,
      title: t.rapSaveTemplate,
      description: t.rapSaveTemplateHint,
      confirm: t.rapSaveTemplate,
      fieldLabel: t.rapTemplateName,
      keyPrefix: 'rap-template-name',
    );
    if (name == null) return;
    await _run(
      () => ref.read(rapApiProvider).saveTemplate(widget.projectId, name, idempotencyKey: const Uuid().v4()),
      t.rapTemplateSaved(name),
      t.rapSaveTemplate,
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(rapEditProvider(widget.projectId));
    final rap = value.value;
    return Scaffold(
      appBar: AppBar(
        title: Text(t.rapManageTitle),
        actions: [
          if (rap != null)
            PopupMenuButton<String>(
              key: const Key('rap-menu'),
              enabled: !_busy,
              onSelected: (v) => switch (v) {
                'import' => _import(rap),
                'template' => _download('/rap/template.xlsx', 'template-rap.xlsx'),
                'export' => _download('/projects/${widget.projectId}/rap.xlsx', 'rap-project-${widget.projectId}.xlsx'),
                'apply' => _applyTemplate(),
                'save' => _saveTemplate(),
                _ => null,
              },
              itemBuilder: (_) => [
                if (rap.canEdit)
                  PopupMenuItem(value: 'import', key: const Key('rap-menu-import'), child: Text(t.rapImport)),
                PopupMenuItem(value: 'template', child: Text(t.rapDownloadTemplate)),
                PopupMenuItem(value: 'export', key: const Key('rap-menu-export'), child: Text(t.rapDownloadRap)),
                if (rap.canEdit && rap.items.isEmpty)
                  PopupMenuItem(value: 'apply', key: const Key('rap-menu-apply'), child: Text(t.rapApplyTemplate)),
                if (rap.items.isNotEmpty)
                  PopupMenuItem(value: 'save', key: const Key('rap-menu-save'), child: Text(t.rapSaveTemplate)),
              ],
            ),
        ],
      ),
      floatingActionButton: rap != null && rap.canEdit
          ? FloatingActionButton.extended(
              key: const Key('rap-add'),
              onPressed: _busy ? null : () => _edit(rap),
              icon: const Icon(Icons.add),
              label: Text(t.rapAddItem),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(rapEditProvider(widget.projectId).future),
        child: AsyncBody<RapEditData>(
          value: value,
          onRetry: () => ref.invalidate(rapEditProvider(widget.projectId)),
          data: (rap) {
            final theme = Theme.of(context);
            final q = _q.toLowerCase();
            final items = rap.items
                .where((i) => q.isEmpty || '${i.code} ${i.description} ${i.stageName ?? ''}'.toLowerCase().contains(q))
                .toList();
            return ListView(
              key: const Key('rap-manage'),
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
              children: [
                if (_busy) const LinearProgressIndicator(),
                if (rap.locked)
                  Card(
                    key: const Key('rap-locked'),
                    color: theme.colorScheme.secondaryContainer,
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(rap.canEdit ? t.rapLockedDirektur : t.rapLockedPm),
                    ),
                  )
                else if (!rap.canEdit)
                  Card(
                    child: Padding(padding: const EdgeInsets.all(12), child: Text(t.rapReadOnly)),
                  ),
                if (rap.prices && rap.rapValue != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Text(
                      rap.budget == null
                          ? t.rapValueLine(formatRupiah(rap.rapValue!))
                          : t.rapValueVsBudget(formatRupiah(rap.rapValue!), formatRupiah(rap.budget!)),
                      key: const Key('rap-value'),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: rap.budget != null && rap.rapValue! > rap.budget! ? context.pk.badText : null,
                      ),
                    ),
                  ),
                ListSearchField(key: const Key('rap-manage-search'), onChanged: (v) => setState(() => _q = v)),
                const SizedBox(height: 8),
                if (rap.items.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Text(t.rapNoItemsProject)),
                for (final i in items)
                  Card(
                    key: Key('rap-item-${i.id}'),
                    margin: const EdgeInsets.only(bottom: 8),
                    color: i.active ? null : theme.colorScheme.surfaceContainerHighest,
                    child: InkWell(
                      onTap: rap.canEdit && !_busy ? () => _edit(rap, i) : null,
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text('${i.code} · ${i.description}', style: theme.textTheme.titleSmall),
                                ),
                                if (!i.active) Text(t.rapInactive, style: theme.textTheme.labelSmall),
                              ],
                            ),
                            Text(
                              [
                                i.kind == 'material' ? t.rapKindMaterial : t.rapKindWork,
                                ?i.stageName,
                                '${formatDecimal(i.volume, digits: 2)} ${i.uomCode}',
                                if (i.unitPrice != null) '@ ${formatRupiah(i.unitPrice!)}',
                                if (i.weightPct != null) t.rapWeight(formatDecimal(i.weightPct!, digits: 2)),
                              ].join(' · '),
                              style: theme.textTheme.bodySmall,
                            ),
                            if (i.inUse)
                              Text(t.rapInUse, style: theme.textTheme.labelSmall?.copyWith(color: context.pk.warnText)),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// "Tambah item" / edit: Kode, Uraian, Jenis (fixed after create), Tahapan, Satuan, Volume, Harga satuan (price
/// roles), Bobot, Aktif (edit), Alasan (locked RAP or used item).
class _ItemSheet extends ConsumerStatefulWidget {
  const _ItemSheet({required this.rap, this.item});
  final RapEditData rap;
  final RapEditItem? item;

  @override
  ConsumerState<_ItemSheet> createState() => _ItemSheetState();
}

class _ItemSheetState extends ConsumerState<_ItemSheet> {
  late final _i = widget.item;
  late final _code = TextEditingController(text: _i?.code ?? '');
  late final _desc = TextEditingController(text: _i?.description ?? '');
  late final _volume = TextEditingController(text: _i == null ? '' : formatDecimal(_i.volume, digits: 2));
  late final _price = TextEditingController(text: groupRupiah(_i?.unitPrice));
  late final _weight = TextEditingController(
    text: _i?.weightPct == null ? '' : formatDecimal(_i!.weightPct!, digits: 2),
  );
  final _reason = TextEditingController();
  late String _kind = _i?.kind ?? 'pekerjaan';
  late int? _stageId = _i?.stageId;
  late int? _uomId = _i?.uomId;
  late bool _active = _i?.active ?? true;
  Map<String, String> _errors = const {};
  String? _summary;
  bool _busy = false;
  final _keys = <String, String>{};

  bool get _needsReason => widget.rap.needsReason || (_i?.inUse ?? false);

  @override
  void dispose() {
    for (final c in [_code, _desc, _volume, _price, _weight, _reason]) {
      c.dispose();
    }
    super.dispose();
  }

  static double? _dec(String s) {
    final t = s.trim();
    if (t.isEmpty) return null;
    return double.tryParse(t.contains(',') ? t.replaceAll('.', '').replaceAll(',', '.') : t);
  }

  Future<void> _save() async {
    final t = AppLocalizations.of(context);
    final volume = _dec(_volume.text);
    final weight = _dec(_weight.text);
    final errors = validateRapItem(
      code: _code.text,
      description: _desc.text,
      uomId: _uomId,
      volume: volume,
      stageId: _stageId,
      stageRequired: widget.rap.stageRequired,
      weightPct: weight,
      needsReason: _needsReason,
      reason: _reason.text,
    );
    setState(() {
      _errors = errors;
      _summary = errors.isEmpty ? null : t.recordCheckFields;
    });
    if (errors.isNotEmpty) return;
    final price = _price.text.trim().isEmpty ? null : parseRupiah(_price.text);
    final body = <String, Object?>{
      'code': _code.text.trim(),
      'description': _desc.text.trim(),
      if (_i == null) 'kind': _kind,
      'stageId': _stageId,
      'uomId': _uomId,
      'volume': volume,
      if (widget.rap.prices) 'unitPrice': price,
      'weightPct': weight,
      if (_i != null && _active != _i.active) 'active': _active,
      if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
    };
    final label = _i == null ? t.rapAddItem : t.rapEditItem(_code.text.trim());
    final summary = [_code.text.trim(), _desc.text.trim(), _volume.text.trim()];
    if (!await confirmAction(context, action: label, summary: summary) || !mounted) return;
    setState(() => _busy = true);
    final api = ref.read(rapApiProvider);
    try {
      final key = _keys.putIfAbsent(jsonEncode(body), () => const Uuid().v4());
      if (_i == null) {
        await api.createItem(widget.rap.projectId, body, idempotencyKey: key);
      } else {
        await api.updateItem(_i.id, body, idempotencyKey: key);
      }
      if (!mounted) return;
      await showActionResult(context, message: t.rapItemSaved(_code.text.trim()), action: label);
      if (mounted) Navigator.pop(context, true);
    } on ProblemException catch (e) {
      if (!mounted) return;
      setState(() {
        _errors = {for (final x in e.errors) x.path: x.message};
        _summary = e.message;
      });
      await showActionError(context, e, action: label);
    } on Object catch (e) {
      if (!mounted) return;
      setState(() => _summary = errorText(e));
      await showActionError(context, e, action: label);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final uoms = ref.watch(rapUomsProvider).value ?? const <(int, String)>[];
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          shrinkWrap: true,
          children: [
            Text(_i == null ? t.rapAddItem : t.rapEditItem(_i.code), style: theme.textTheme.titleMedium),
            if (_summary != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _summary!,
                  key: const Key('rap-item-error'),
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            const SizedBox(height: 8),
            TextField(
              key: const Key('rap-item-code'),
              controller: _code,
              maxLength: 32,
              decoration: InputDecoration(labelText: t.rapCode, errorText: _errors['code']),
            ),
            TextField(
              key: const Key('rap-item-description'),
              controller: _desc,
              maxLength: 300,
              minLines: 1,
              maxLines: 3,
              decoration: InputDecoration(labelText: t.rapDescription, errorText: _errors['description']),
            ),
            SegmentedButton<String>(
              key: const Key('rap-item-kind'),
              segments: [
                ButtonSegment(value: 'pekerjaan', label: Text(t.rapKindWork)),
                ButtonSegment(value: 'material', label: Text(t.rapKindMaterial)),
              ],
              selected: {_kind},
              onSelectionChanged: _i != null ? null : (s) => setState(() => _kind = s.first),
            ),
            const SizedBox(height: 12),
            MasterPickerField(
              key: const Key('rap-item-stage'),
              label: t.rapStage,
              items: [for (final (id, name) in widget.rap.stages) MasterItem(id, name)],
              value: _stageId,
              allowNone: !widget.rap.stageRequired,
              errorText: _errors['stageId'],
              onChanged: (v) => setState(() => _stageId = v),
            ),
            const SizedBox(height: 12),
            MasterPickerField(
              key: const Key('rap-item-uom'),
              label: t.rapUom,
              items: [for (final (id, name) in uoms) MasterItem(id, name)],
              value: _uomId,
              allowNone: false,
              errorText: _errors['uomId'],
              onChanged: (v) => setState(() => _uomId = v),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('rap-item-volume'),
              controller: _volume,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: t.rapVolume, errorText: _errors['volume']),
            ),
            if (widget.rap.prices)
              TextField(
                key: const Key('rap-item-price'),
                controller: _price,
                keyboardType: TextInputType.number,
                inputFormatters: const [RupiahInputFormatter()],
                decoration: InputDecoration(
                  labelText: t.rapUnitPrice,
                  prefixText: 'Rp ',
                  errorText: _errors['unitPrice'],
                ),
              ),
            TextField(
              key: const Key('rap-item-weight'),
              controller: _weight,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: t.rapWeightLabel,
                suffixText: '%',
                errorText: _errors['weightPct'],
              ),
            ),
            if (_i != null)
              SwitchListTile(
                key: const Key('rap-item-active'),
                contentPadding: EdgeInsets.zero,
                title: Text(t.rapActive),
                subtitle: Text(t.rapActiveHint),
                value: _active,
                onChanged: (v) => setState(() => _active = v),
              ),
            if (_needsReason)
              TextField(
                key: const Key('rap-item-reason'),
                controller: _reason,
                maxLength: 1000,
                decoration: InputDecoration(
                  labelText: t.rapReason,
                  helperText: widget.rap.needsReason ? t.rapReasonLocked : t.rapReasonUsed,
                  helperMaxLines: 2,
                  errorText: _errors['reason'],
                ),
              ),
            const SizedBox(height: 12),
            FilledButton(key: const Key('rap-item-save'), onPressed: _save, child: Text(_busy ? t.cashSaving : t.save)),
            TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
          ],
        ),
      ),
    );
  }
}

/// Import preview (web): counts, issues, deactivated items, new stages; a reason when the RAP is locked or used items
/// change. Pops the reason ('' = none needed), null = cancelled. Issues block the commit.
class _PreviewDialog extends StatefulWidget {
  const _PreviewDialog({required this.preview, required this.fileName});
  final RapPreviewData preview;
  final String fileName;

  @override
  State<_PreviewDialog> createState() => _PreviewDialogState();
}

class _PreviewDialogState extends State<_PreviewDialog> {
  final _reason = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final p = widget.preview;
    final c = p.counts;
    final blocked = p.issues.isNotEmpty;
    return AlertDialog(
      title: Text(t.rapPreviewTitle(widget.fileName)),
      content: SingleChildScrollView(
        child: Column(
          key: const Key('rap-preview'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t.rapPreviewCounts(c['new'] ?? 0, c['changed'] ?? 0, c['unchanged'] ?? 0, c['deactivated'] ?? 0)),
            if (p.newStages.isNotEmpty) Text(t.rapPreviewNewStages(p.newStages.join(', '))),
            for (final d in p.deactivated) Text('− $d'),
            if (p.usedChanged.isNotEmpty) Text(t.rapPreviewUsed(p.usedChanged.join(', '))),
            if (blocked) ...[
              const SizedBox(height: 8),
              Text(t.rapPreviewIssues, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              for (final i in p.issues) Text('• $i'),
            ],
            if (!blocked && p.needsReason)
              TextField(
                key: const Key('rap-preview-reason'),
                controller: _reason,
                maxLength: 1000,
                decoration: InputDecoration(labelText: t.rapReason, errorText: _error),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        if (!blocked)
          FilledButton(
            key: const Key('rap-preview-commit'),
            onPressed: () {
              if (p.needsReason && _reason.text.trim().length < 3) {
                setState(() => _error = t.reasonTooShort);
                return;
              }
              Navigator.pop(context, _reason.text.trim());
            },
            child: Text(t.rapImportCommit),
          ),
      ],
    );
  }
}
