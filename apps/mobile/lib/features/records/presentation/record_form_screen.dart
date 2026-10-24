import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../data/records_providers.dart';
import '../domain/record_form.dart';

/// `/data/:collection/new` and `/data/:collection/:id/edit` (user 2026-10-19, phase 5a): the web admin edit form of
/// the collection — fields, labels, required / read-only and field-level access from the server; saved through
/// Payload like the web (hooks, validation, audit). Online only.
class RecordFormScreen extends ConsumerWidget {
  const RecordFormScreen({super.key, required this.collection, this.id, this.global = false});
  final String collection;
  final String? id;

  /// Phase 7: [collection] is a Payload global slug (one document, update only).
  final bool global;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final provider = global ? recordGlobalFormProvider(collection) : recordFormProvider((collection, id));
    return AsyncBody<RecordFormDef>(
      value: ref.watch(provider),
      onRetry: () => ref.invalidate(provider),
      data: (def) {
        final allowed = global || id != null ? def.canUpdate : def.canCreate;
        if (!allowed || !def.supported) {
          return Scaffold(
            appBar: AppBar(title: Text(def.label)),
            body: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(!allowed ? t.recordNoRight : t.recordWebOnly, key: const Key('record-form-blocked')),
            ),
          );
        }
        // a reloaded definition (global saved in place) = fresh initial values
        return _RecordForm(key: ObjectKey(def), def: def, collection: collection, id: global ? '' : id, global: global);
      },
    );
  }
}

class _RecordForm extends ConsumerStatefulWidget {
  const _RecordForm({super.key, required this.def, required this.collection, this.id, this.global = false});
  final RecordFormDef def;
  final String collection;
  final String? id;
  final bool global;

  @override
  ConsumerState<_RecordForm> createState() => _RecordFormState();
}

class _RecordFormState extends ConsumerState<_RecordForm> {
  late final Map<String, Object?> _initial = {for (final f in widget.def.fields) f.key: _normalize(f, f.value)};
  late final Map<String, Object?> _values = {..._initial};
  late final Map<String, List<String>> _labels = {
    for (final f in widget.def.fields)
      if (f.isRelation) f.key: f.valueLabels,
  };
  late final Map<String, TextEditingController> _text = {
    for (final f in widget.def.fields)
      if (const {'text', 'textarea', 'email', 'number', 'money'}.contains(f.type))
        f.key: TextEditingController(
          text: switch (f.type) {
            'money' => groupRupiah(_initial[f.key] is num ? (_initial[f.key] as num).round() : null),
            _ => _initial[f.key] == null ? '' : '${_initial[f.key]}',
          },
        ),
  };
  final _reason = TextEditingController();
  Map<String, String> _errors = const {};
  String? _summary;
  bool _busy = false;
  final _keys = <String, String>{};

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    _reason.dispose();
    super.dispose();
  }

  /// The audit rule asks for a reason: every change (onUpdate) or a deactivation (`active` true → false).
  bool get _needsReason =>
      widget.id != null &&
      (widget.def.reasonOnUpdate ||
          (widget.def.reasonOnDeactivate && _initial['active'] == true && _values['active'] == false));

  /// Relationship ids as strings / lists; everything else as it came.
  static Object? _normalize(RecordFieldDef f, Object? v) {
    if (f.type == 'relationships' || f.type == 'multiselect') {
      return v is List ? [for (final x in v) '${x is Map ? x['id'] : x}'] : <String>[];
    }
    if (f.type == 'relationship') return v == null ? null : '${v is Map ? v['id'] : v}';
    return v;
  }

  /// Text inputs → typed values.
  void _readText() {
    for (final f in widget.def.fields) {
      final c = _text[f.key];
      if (c == null) continue;
      final s = c.text.trim();
      _values[f.key] = switch (f.type) {
        // id-ID: "1.031,5" (comma decimal) — without a comma the text is read as typed ("2.5", "1200")
        'number' =>
          s.isEmpty ? null : num.tryParse(s.contains(',') ? s.replaceAll('.', '').replaceAll(',', '.') : s) ?? s,
        'money' => s.isEmpty ? null : parseRupiah(s),
        _ => s.isEmpty ? (f.required ? '' : null) : s,
      };
    }
  }

  /// Body value of a field (relationship ids back to numbers where they are numeric).
  Object? _out(RecordFieldDef f, Object? v) {
    Object id(String x) => int.tryParse(x) ?? x;
    if (f.type == 'relationships') return [for (final x in (v as List? ?? const [])) id('$x')];
    if (f.type == 'relationship') return v == null ? null : id('$v');
    return v;
  }

  Future<void> _save() async {
    final t = AppLocalizations.of(context);
    _readText();
    final editable = widget.def.fields.where((f) => !f.readOnly).toList();
    final errors = validateRecord(editable, _values);
    if (_needsReason && _reason.text.trim().length < 3) errors['changeReason'] = t.reasonTooShort;
    setState(() {
      _errors = errors;
      _summary = errors.isEmpty ? null : t.recordCheckFields;
    });
    if (errors.isNotEmpty) return;
    final edit = widget.id != null;
    final data = <String, Object?>{
      for (final f in editable)
        if (!edit || jsonEncode(_values[f.key]) != jsonEncode(_initial[f.key])) f.key: _out(f, _values[f.key]),
    };
    if (edit && data.isEmpty) {
      setState(() => _summary = t.recordNoChanges);
      return;
    }
    final heading = edit || widget.global ? t.recordEditTitle(widget.def.label) : t.recordNewTitle(widget.def.label);
    final name = _values['name'] ?? _values['title'];
    if (!await confirmAction(context, action: t.save, summary: [heading, name?.toString()]) || !mounted) return;
    setState(() => _busy = true);
    final api = ref.read(recordsApiProvider);
    try {
      final key = _keys.putIfAbsent(jsonEncode(data), () => const Uuid().v4());
      final reason = _reason.text.trim().isEmpty ? null : _reason.text.trim();
      final saved = widget.global
          ? await api.updateGlobal(widget.collection, data, reason: reason, idempotencyKey: key)
          : edit
          ? await api.update(widget.collection, widget.id!, data, reason: reason, idempotencyKey: key)
          : await api.create(widget.collection, data, reason: reason, idempotencyKey: key);
      ref.invalidate(recordPageProvider);
      ref.invalidate(recordDetailProvider);
      ref.invalidate(recordFormProvider);
      ref.invalidate(recordGlobalFormProvider);
      if (!mounted) return;
      final done = t.recordSaved(saved.title.isEmpty ? widget.def.label : saved.title);
      await showActionResult(context, message: done, action: t.save);
      // one document (global): stay on the form, its values reload
      if (widget.global || !mounted) return;
      context.pop(saved.id);
    } on ProblemException catch (e) {
      if (!mounted) return;
      setState(() {
        _errors = {for (final x in e.errors) x.path: x.message};
        _summary = e.message;
      });
      await showActionError(context, e, action: t.save);
    } on Object catch (e) {
      if (!mounted) return;
      setState(() => _summary = errorText(e));
      await showActionError(context, e, action: t.save);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickRelation(RecordFieldDef f) async {
    final multi = f.type == 'relationships';
    final current = multi ? [...(_values[f.key] as List? ?? const []).map((x) => '$x')] : [?_values[f.key]?.toString()];
    final picked = await showModalBottomSheet<List<(String, String)>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => _RelationPicker(
        collection: widget.collection,
        field: f,
        id: widget.id,
        selected: {
          for (var i = 0; i < current.length; i++)
            current[i]: (_labels[f.key] ?? const []).elementAtOrNull(i) ?? '#${current[i]}',
        },
      ),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _values[f.key] = multi ? [for (final p in picked) p.$1] : picked.firstOrNull?.$1;
      _labels[f.key] = [for (final p in picked) p.$2];
    });
  }

  Future<void> _pickDate(RecordFieldDef f) async {
    final cur = DateTime.tryParse('${_values[f.key] ?? ''}')?.toLocal();
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: cur ?? now,
      firstDate: DateTime(now.year - 20),
      lastDate: DateTime(now.year + 20),
      helpText: f.label,
    );
    if (d == null || !mounted) return;
    var at = DateTime(d.year, d.month, d.day, 12); // noon: the calendar day survives any zone
    if (f.type == 'datetime') {
      final tm = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(cur ?? now),
        builder: (c, child) => MediaQuery(data: MediaQuery.of(c).copyWith(alwaysUse24HourFormat: true), child: child!),
      );
      if (tm == null || !mounted) return;
      at = DateTime(d.year, d.month, d.day, tm.hour, tm.minute);
    }
    setState(() => _values[f.key] = at.toUtc().toIso8601String());
  }

  String _dateText(RecordFieldDef f) {
    final d = DateTime.tryParse('${_values[f.key] ?? ''}')?.toLocal();
    if (d == null) return '—';
    final day = formatDateOnly(toYmd(d));
    return f.type == 'datetime'
        ? '$day ${d.hour.toString().padLeft(2, '0')}.${d.minute.toString().padLeft(2, '0')}'
        : day;
  }

  Widget _field(RecordFieldDef f) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final label = f.required && !f.readOnly ? '${f.label} *' : f.label;
    final err = _errors[f.key];
    final key = Key('record-field-${f.key}');
    switch (f.type) {
      case 'text' || 'email' || 'textarea' || 'number' || 'money':
        return TextField(
          key: key,
          controller: _text[f.key],
          enabled: !f.readOnly,
          minLines: f.type == 'textarea' ? 2 : 1,
          maxLines: f.type == 'textarea' ? 6 : 1,
          maxLength: f.maxLength,
          keyboardType: switch (f.type) {
            'number' => const TextInputType.numberWithOptions(decimal: true),
            'money' => TextInputType.number,
            'email' => TextInputType.emailAddress,
            _ => TextInputType.text,
          },
          inputFormatters: f.type == 'money' ? const [RupiahInputFormatter()] : null,
          decoration: InputDecoration(
            labelText: label,
            prefixText: f.type == 'money' ? 'Rp ' : null,
            helperText: f.help,
            helperMaxLines: 3,
            errorText: err,
          ),
        );
      case 'checkbox':
        return SwitchListTile(
          key: key,
          contentPadding: EdgeInsets.zero,
          title: Text(f.label),
          subtitle: f.help == null ? null : Text(f.help!),
          value: _values[f.key] == true,
          onChanged: f.readOnly ? null : (v) => setState(() => _values[f.key] = v),
        );
      case 'select':
        final v = '${_values[f.key] ?? ''}';
        return DropdownButtonFormField<String>(
          key: key,
          initialValue: f.options.any((o) => o.$1 == v) ? v : null,
          isExpanded: true,
          decoration: InputDecoration(labelText: label, helperText: f.help, errorText: err),
          items: [
            if (!f.required) DropdownMenuItem(value: '', child: Text(t.recordNone)),
            for (final (value, l) in f.options) DropdownMenuItem(value: value, child: Text(l)),
          ],
          onChanged: f.readOnly ? null : (x) => setState(() => _values[f.key] = x == null || x.isEmpty ? null : x),
        );
      case 'multiselect':
        final list = [...(_values[f.key] as List? ?? const []).map((x) => '$x')];
        return InputDecorator(
          key: key,
          decoration: InputDecoration(labelText: label, helperText: f.help, errorText: err, border: InputBorder.none),
          child: Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final (value, l) in f.options)
                FilterChip(
                  label: Text(l),
                  selected: list.contains(value),
                  onSelected: f.readOnly
                      ? null
                      : (on) => setState(() => _values[f.key] = on ? [...list, value] : (list..remove(value))),
                ),
            ],
          ),
        );
      case 'date' || 'datetime':
        return InkWell(
          key: key,
          onTap: f.readOnly ? null : () => _pickDate(f),
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: label,
              enabled: !f.readOnly,
              helperText: f.help,
              errorText: err,
              suffixIcon: _values[f.key] != null && !f.readOnly && !f.required
                  ? IconButton(icon: const Icon(Icons.clear), onPressed: () => setState(() => _values[f.key] = null))
                  : const Icon(Icons.event),
            ),
            child: Text(_dateText(f)),
          ),
        );
      case 'relationship' || 'relationships':
        final names = _labels[f.key] ?? const [];
        return InkWell(
          key: key,
          onTap: f.readOnly ? null : () => _pickRelation(f),
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: label,
              enabled: !f.readOnly,
              helperText: f.help,
              errorText: err,
              suffixIcon: const Icon(Icons.arrow_drop_down),
            ),
            child: Text(names.isEmpty ? t.recordPick : names.join(', ')),
          ),
        );
      default:
        return Text('${f.label}: ${_values[f.key] ?? '—'}', style: theme.textTheme.bodySmall);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final edit = widget.id != null;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.global
              ? widget.def.label
              : edit
              ? t.recordEditTitle(widget.def.label)
              : t.recordNewTitle(widget.def.label),
        ),
      ),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          key: const Key('record-form'),
          padding: const EdgeInsets.all(16),
          children: [
            if (_summary != null)
              Card(
                key: const Key('record-form-error'),
                color: theme.colorScheme.errorContainer,
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_summary!),
                      for (final e in _errors.entries)
                        Text(
                          '• ${e.key == 'changeReason' ? t.cashReason : widget.def.fields.where((f) => f.key == e.key).firstOrNull?.label ?? e.key}: ${e.value}',
                        ),
                    ],
                  ),
                ),
              ),
            for (final f in widget.def.fields) Padding(padding: const EdgeInsets.only(bottom: 12), child: _field(f)),
            if (_needsReason)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TextField(
                  key: const Key('record-reason'),
                  controller: _reason,
                  maxLength: 1000,
                  minLines: 1,
                  maxLines: 3,
                  decoration: InputDecoration(
                    labelText: '${t.cashReason} *',
                    helperText: t.cashReasonHelp,
                    errorText: _errors['changeReason'],
                  ),
                ),
              ),
            const SizedBox(height: 8),
            OnlineOnlyButton(
              key: const Key('record-save'),
              label: _busy ? t.cashSaving : t.save,
              icon: Icons.save_outlined,
              onPressed: _busy ? null : _save,
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

/// Relationship picker: server search (`/data/{collection}/options`), one or several picks.
class _RelationPicker extends ConsumerStatefulWidget {
  const _RelationPicker({required this.collection, required this.field, required this.selected, this.id});
  final String collection;
  final RecordFieldDef field;
  final String? id;
  final Map<String, String> selected;

  @override
  ConsumerState<_RelationPicker> createState() => _RelationPickerState();
}

class _RelationPickerState extends ConsumerState<_RelationPicker> {
  late final Map<String, String> _sel = {...widget.selected};
  List<(String, String)>? _items;
  String? _error;
  int _seq = 0;

  bool get _multi => widget.field.type == 'relationships';

  @override
  void initState() {
    super.initState();
    _load('');
  }

  Future<void> _load(String q) async {
    final seq = ++_seq;
    try {
      final items = await ref
          .read(recordsApiProvider)
          .options(widget.collection, widget.field.key, q: q, id: widget.id);
      if (mounted && seq == _seq) setState(() => _items = items);
    } on Object catch (e) {
      if (mounted && seq == _seq) setState(() => _error = errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final items = _items;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.75,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: TextField(
                key: const Key('record-picker-search'),
                autofocus: true,
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search),
                  hintText: t.searchHint,
                  isDense: true,
                ),
                onChanged: _load,
              ),
            ),
            Expanded(
              child: _error != null
                  ? Center(child: Text(_error!))
                  : items == null
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(
                      children: [
                        if (!_multi && !widget.field.required)
                          ListTile(
                            key: const Key('record-picker-none'),
                            title: Text(t.recordNone),
                            onTap: () => Navigator.pop(context, const <(String, String)>[]),
                          ),
                        for (final (id, label) in items)
                          _multi
                              ? CheckboxListTile(
                                  key: Key('record-picker-$id'),
                                  value: _sel.containsKey(id),
                                  title: Text(label),
                                  onChanged: (on) => setState(() => on == true ? _sel[id] = label : _sel.remove(id)),
                                )
                              : ListTile(
                                  key: Key('record-picker-$id'),
                                  title: Text(label),
                                  trailing: _sel.containsKey(id) ? const Icon(Icons.check) : null,
                                  onTap: () => Navigator.pop(context, [(id, label)]),
                                ),
                        if (items.isEmpty)
                          Padding(padding: const EdgeInsets.all(24), child: Text(t.recordsEmptySearch)),
                      ],
                    ),
            ),
            if (_multi)
              Padding(
                padding: const EdgeInsets.all(16),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    key: const Key('record-picker-done'),
                    onPressed: () => Navigator.pop(context, [for (final e in _sel.entries) (e.key, e.value)]),
                    child: Text(t.recordPickDone(_sel.length)),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
