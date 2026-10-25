import 'dart:async';

import 'package:camera/camera.dart' show CameraLensDirection;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/dates.dart';
import '../../../../core/logging/log.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/action_feedback.dart';
import '../../../../shared/widgets/form_grid.dart';
import '../../../../shared/widgets/pk_ui.dart';
import '../../../../shared/widgets/pk_ui_lapangan.dart';
import '../../../expense/presentation/camera_capture_screen.dart';
import '../../../progress/presentation/widgets/progress_widgets.dart' show LocalPhotoThumb;
import '../../application/field_service.dart';
import '../../domain/field_models.dart';

typedef FieldPhotoCapture = Future<Uint8List?> Function(BuildContext context, String title);

/// Rear camera, no gallery (ADR 0010 decision 11). Overridden in widget tests.
final fieldPhotoCaptureProvider = Provider<FieldPhotoCapture>(
  (ref) =>
      (context, title) => Navigator.of(context).push<Uint8List>(
        MaterialPageRoute(
          builder: (_) => CameraCaptureScreen(lens: CameraLensDirection.back, title: title),
        ),
      ),
);

/// `21 Sep 2026 12.05 WITA` of a server instant.
String formatEditableUntil(String? iso, String? zone) => formatServerDateTime(iso, zone: zone);

/// Glyph of a report type (hub tiles, history rows, conflict header).
IconData fieldReportIcon(FieldReportType type) => switch (type) {
  FieldReportType.serviceReport => Icons.build_circle_outlined,
  FieldReportType.unitTimesheet => Icons.timer_outlined,
  FieldReportType.aftersalesActivity => Icons.local_shipping_outlined,
  FieldReportType.dailyReport => Icons.engineering_outlined,
};

/// "Kam, 9 Okt 2026".
String fieldDateLabel(String ymd) {
  final d = DateTime.tryParse(ymd);
  return d == null ? ymd : DateFormat('EEE, d MMM yyyy', 'id').format(d);
}

/// D2410: "Yakin ingin <aksi>?" before a field report is stored on the phone (outbox): project, date (+ unit).
Future<bool> confirmFieldSubmit(
  BuildContext context,
  String action, {
  required String project,
  required String date,
  String? unit,
}) {
  return confirmAction(context, action: action, summary: [project, fieldDateLabel(date), unit]);
}

/// D2410: after storing — "Berhasil" while online (being sent now), "Tersimpan di antrian" offline.
Future<void> showFieldSubmitted(BuildContext context, String action, {required bool online}) {
  final t = AppLocalizations.of(context);
  if (online) return showActionResult(context, message: t.fieldQueuedOnline, action: action);
  return showActionQueued(context, action: action, message: t.fieldQueuedOffline);
}

/// Debounced autosave of the draft being edited (only drafts not sent yet; see [FieldService.saveDraft]).
class DraftAutosaver {
  DraftAutosaver(this.service, this.sub, {this.delay = const Duration(milliseconds: 700)});
  final FieldService service;
  final String sub;
  final Duration delay;
  Timer? _timer;
  FieldDraft? _pending;
  final saved = ValueNotifier<bool>(false);

  void schedule(FieldDraft d) {
    _pending = d;
    saved.value = false;
    _timer?.cancel();
    _timer = Timer(delay, flush);
  }

  Future<void> flush() async {
    _timer?.cancel();
    final d = _pending;
    _pending = null;
    if (d == null) return;
    try {
      await service.saveDraft(sub, d);
      saved.value = true;
    } on Object catch (e) {
      Log.w('field: autosave failed', e);
    }
  }

  void cancel() {
    _timer?.cancel();
    _pending = null;
  }

  void dispose() {
    unawaited(flush());
    saved.dispose();
  }
}

/// White card section of the mockups ("Unit", "Pekerjaan", "Sparepart dipakai", …). D2510: hairline card,
/// radius 14, bold title; [highlight] = primary 2 dp border (the section that needs attention).
class FieldSection extends StatelessWidget {
  const FieldSection({super.key, required this.title, required this.children, this.trailing, this.highlight = false});
  final String title;
  final List<Widget> children;
  final Widget? trailing;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pk = context.pk;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: pk.card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PkRadius.md),
          side: BorderSide(color: highlight ? theme.colorScheme.primary : pk.border, width: highlight ? 2 : 1),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                  ),
                  ?trailing,
                ],
              ),
              const SizedBox(height: 12),
              ...children,
            ],
          ),
        ),
      ),
    );
  }
}

/// Small helper / warning line under a field (icon + text, never colour alone): plain muted text, or a soft
/// orange ([warn]) / red ([error]) box.
class FieldNote extends StatelessWidget {
  const FieldNote({super.key, required this.text, this.warn = false, this.error = false});
  final String text;
  final bool warn;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (warn || error) {
      return PkNotice(
        text: text,
        tone: error ? PkTone.bad : PkTone.warn,
        icon: error ? Icons.error_outline : Icons.info_outline,
        dense: true,
        margin: const EdgeInsets.only(top: 6),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Text(text, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
    );
  }
}

/// Grid of options (unit status 3 columns: mutually exclusive; service types 2 columns: several via [isSelected]),
/// ≥ 40 px targets.
class ChoiceGrid<T> extends StatelessWidget {
  const ChoiceGrid({
    super.key,
    required this.options,
    required this.selected,
    required this.label,
    required this.onSelected,
    this.columns = 2,
    this.keyPrefix = 'choice',
    this.code,
    this.selectedColor,
    this.isSelected,
  });
  final List<T> options;
  final T? selected;

  /// Multi-select: whether [T] is chosen (instead of `== selected`); [onSelected] then toggles it.
  final bool Function(T)? isSelected;
  final String Function(T) label;
  final String Function(T)? code;
  final ValueChanged<T>? onSelected;
  final int columns;
  final String keyPrefix;
  final Color Function(T)? selectedColor;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return LayoutBuilder(
      builder: (context, box) {
        final w = (box.maxWidth - (columns - 1) * 6) / columns;
        return Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [for (final o in options) _cell(scheme, o, w, isSelected?.call(o) ?? o == selected)],
        );
      },
    );
  }

  /// One option; at least 44 px high, a long name wraps.
  Widget _cell(ColorScheme scheme, T o, double w, bool sel) => SizedBox(
    width: w,
    child: Material(
      color: sel ? (selectedColor?.call(o) ?? scheme.primary) : scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PkRadius.sm + 2),
        side: sel ? BorderSide.none : BorderSide(color: scheme.outlineVariant),
      ),
      child: InkWell(
        key: Key('$keyPrefix-${code?.call(o) ?? '$o'}'),
        borderRadius: BorderRadius.circular(PkRadius.sm + 2),
        onTap: onSelected == null ? null : () => onSelected!(o),
        child: Semantics(
          selected: sel,
          button: true,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
              child: Center(
                child: Text(
                  label(o),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: sel ? scheme.onPrimary : scheme.onSurface,
                    fontWeight: sel ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/// Spare-part / item rows: name, qty, unit (+ part no. below unless [showPartNo] is off). Text only, no stock.
class PartLinesEditor extends StatefulWidget {
  const PartLinesEditor({
    super.key,
    required this.lines,
    required this.onChanged,
    required this.nameHeader,
    required this.addLabel,
    this.keyPrefix = 'part',
    this.enabled = true,
    this.withNote = false,
    this.showPartNo = true,
  });
  final List<PartLine> lines;
  final ValueChanged<List<PartLine>> onChanged;
  final String nameHeader;
  final String addLabel;
  final String keyPrefix;
  final bool enabled;
  final bool withNote;

  /// "No. part" input under each row. Off for the service report (owner 2026-10-17); the part no. of a row loaded
  /// from an older report is kept unchanged (not shown, not dropped).
  final bool showPartNo;

  @override
  State<PartLinesEditor> createState() => _PartLinesEditorState();
}

class _PartLinesEditorState extends State<PartLinesEditor> {
  final _name = <TextEditingController>[];
  final _qty = <TextEditingController>[];
  final _uom = <TextEditingController>[];
  final _partNo = <TextEditingController>[];
  List<PartLine> _lines = [];

  @override
  void initState() {
    super.initState();
    _reset(widget.lines);
  }

  @override
  void didUpdateWidget(PartLinesEditor old) {
    super.didUpdateWidget(old);
    // Replaced from outside (PO items copied, "Salin"): rebuild the controllers.
    if (!identical(widget.lines, _lines) && !_same(widget.lines, _lines)) _reset(widget.lines);
  }

  static bool _same(List<PartLine> a, List<PartLine> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].name != b[i].name || a[i].qty != b[i].qty || a[i].uom != b[i].uom || a[i].partNo != b[i].partNo) {
        return false;
      }
    }
    return true;
  }

  void _reset(List<PartLine> lines) {
    for (final c in [..._name, ..._qty, ..._uom, ..._partNo]) {
      c.dispose();
    }
    _name.clear();
    _qty.clear();
    _uom.clear();
    _partNo.clear();
    _lines = [...lines];
    for (final l in _lines) {
      _name.add(TextEditingController(text: l.name));
      _qty.add(TextEditingController(text: decInput(l.qty)));
      _uom.add(TextEditingController(text: l.uom ?? ''));
      _partNo.add(TextEditingController(text: l.partNo ?? ''));
    }
  }

  @override
  void dispose() {
    for (final c in [..._name, ..._qty, ..._uom, ..._partNo]) {
      c.dispose();
    }
    super.dispose();
  }

  void _emit() {
    _lines = [
      for (var i = 0; i < _name.length; i++)
        PartLine(
          name: _name[i].text,
          qty: parseDec(_qty[i].text),
          uom: _uom[i].text.trim().isEmpty ? null : _uom[i].text.trim(),
          // hidden input: the controller still holds the loaded part no.
          partNo: _partNo[i].text.trim().isEmpty ? null : _partNo[i].text.trim(),
        ),
    ];
    widget.onChanged(_lines);
  }

  void _add() {
    setState(() {
      _name.add(TextEditingController());
      _qty.add(TextEditingController());
      _uom.add(TextEditingController());
      _partNo.add(TextEditingController());
    });
    _emit();
  }

  void _remove(int i) {
    setState(() {
      for (final l in [_name, _qty, _uom, _partNo]) {
        l.removeAt(i).dispose();
      }
    });
    _emit();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final head = theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_name.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Expanded(child: Text(widget.nameHeader, style: head)),
                SizedBox(
                  width: 64,
                  child: Text(t.fieldQty, style: head, textAlign: TextAlign.center),
                ),
                const SizedBox(width: 6),
                SizedBox(width: 64, child: Text(t.fieldUom, style: head)),
                const SizedBox(width: 40),
              ],
            ),
          ),
        for (var i = 0; i < _name.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: Key('${widget.keyPrefix}-name-$i'),
                        controller: _name[i],
                        enabled: widget.enabled,
                        maxLength: 160,
                        decoration: InputDecoration(isDense: true, counterText: '', hintText: t.fieldPartNameHint),
                        onChanged: (_) => _emit(),
                      ),
                    ),
                    const SizedBox(width: 6),
                    SizedBox(
                      width: 64,
                      child: TextField(
                        key: Key('${widget.keyPrefix}-qty-$i'),
                        controller: _qty[i],
                        enabled: widget.enabled,
                        textAlign: TextAlign.center,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
                        style: const TextStyle(fontWeight: FontWeight.w700),
                        decoration: const InputDecoration(isDense: true),
                        onChanged: (_) => _emit(),
                      ),
                    ),
                    const SizedBox(width: 6),
                    SizedBox(
                      width: 64,
                      child: TextField(
                        key: Key('${widget.keyPrefix}-uom-$i'),
                        controller: _uom[i],
                        enabled: widget.enabled,
                        maxLength: 16,
                        decoration: InputDecoration(isDense: true, counterText: '', hintText: t.fieldUomHint),
                        onChanged: (_) => _emit(),
                      ),
                    ),
                    SizedBox(
                      width: 40,
                      child: IconButton(
                        key: Key('${widget.keyPrefix}-remove-$i'),
                        tooltip: t.delete,
                        icon: const Icon(Icons.close, size: 20),
                        onPressed: widget.enabled ? () => _remove(i) : null,
                      ),
                    ),
                  ],
                ),
                if (widget.showPartNo) ...[
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: Key('${widget.keyPrefix}-partno-$i'),
                          controller: _partNo[i],
                          enabled: widget.enabled,
                          maxLength: 64,
                          style: theme.textTheme.bodySmall,
                          decoration: InputDecoration(isDense: true, counterText: '', hintText: t.fieldPartNoHint),
                          onChanged: (_) => _emit(),
                        ),
                      ),
                      const SizedBox(width: 40),
                    ],
                  ),
                ],
              ],
            ),
          ),
        OutlinedButton.icon(
          key: Key('${widget.keyPrefix}-add'),
          onPressed: widget.enabled && _name.length < maxPartLines ? _add : null,
          icon: const Icon(Icons.add),
          label: Text(widget.addLabel),
        ),
      ],
    );
  }
}

/// Local photos of a group with an "add" tile (rear camera).
class PhotoGroup extends StatelessWidget {
  const PhotoGroup({
    super.key,
    required this.title,
    required this.photos,
    required this.canAdd,
    required this.onAdd,
    required this.onRemove,
    this.addKey = const Key('field-add-photo'),
    this.size = 72,
  });
  final String title;
  final List<String> photos;
  final bool canAdd;
  final VoidCallback? onAdd;
  final ValueChanged<String>? onRemove;
  final Key addKey;
  final double size;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final p in photos)
              LocalPhotoThumb(
                uuid: p,
                size: size,
                group: photos,
                onRemove: onRemove == null ? null : () => onRemove!(p),
              ),
            if (canAdd)
              SizedBox.square(
                dimension: size,
                child: OutlinedButton(
                  key: addKey,
                  style: OutlinedButton.styleFrom(
                    padding: EdgeInsets.zero,
                    foregroundColor: theme.colorScheme.primary,
                    backgroundColor: context.pk.infoBg.withValues(alpha: 0.5),
                    side: BorderSide(color: theme.colorScheme.primary.withValues(alpha: 0.4)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: onAdd,
                  child: Tooltip(message: t.fieldAddPhoto, child: const Icon(Icons.add_a_photo)),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// Report date (today, ≤ 14 days back). d1010 (8c / WA-01): a date picker like every other date field of the
/// APK — only the allowed dates are selectable (plus the stored date of an edited report).
class FieldDateField extends StatelessWidget {
  const FieldDateField({
    super.key,
    required this.value,
    required this.dates,
    required this.onChanged,
    required this.label,
    this.errorText,
  });
  final String value;
  final List<String> dates;
  final ValueChanged<String>? onChanged;
  final String label;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    final options = {value, ...dates}.where((d) => DateTime.tryParse(d) != null).toList()..sort();
    Future<void> pick() async {
      if (options.isEmpty) return;
      final picked = await showDatePicker(
        context: context,
        initialDate: DateTime.tryParse(value) ?? DateTime.parse(options.last),
        firstDate: DateTime.parse(options.first),
        lastDate: DateTime.parse(options.last),
        selectableDayPredicate: (d) => options.contains(toYmd(d)),
      );
      if (picked != null) onChanged?.call(toYmd(picked));
    }

    return InkWell(
      onTap: onChanged == null ? null : pick,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: FormGridCell.inputLabel(context, label),
          errorText: errorText,
          enabled: onChanged != null,
          suffixIcon: const Icon(Icons.calendar_today),
        ),
        child: Text(fieldDateLabel(value), overflow: TextOverflow.ellipsis),
      ),
    );
  }
}

/// Local state of a field report as a soft pill (icon + label; never colour alone).
class FieldStateChip extends StatelessWidget {
  const FieldStateChip({super.key, required this.state});
  final FieldSyncState state;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final (IconData icon, PkTone tone, String label) = switch (state) {
      FieldSyncState.local => (Icons.edit_note, PkTone.neutral, t.fieldStateDraft),
      FieldSyncState.queued => (Icons.schedule, PkTone.warn, t.fieldStateQueued),
      FieldSyncState.synced => (Icons.cloud_done, PkTone.ok, t.fieldStateSent),
      FieldSyncState.conflict => (Icons.call_split, PkTone.warn, t.fieldStateConflict),
      FieldSyncState.rejected => (Icons.error, PkTone.bad, t.fieldStateRejected),
    };
    return PkPill(icon: icon, tone: tone, label: label);
  }
}

/// "Draft tersimpan" pill of the editor header.
class DraftSavedPill extends StatelessWidget {
  const DraftSavedPill({super.key, required this.saved});
  final ValueNotifier<bool> saved;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
    valueListenable: saved,
    builder: (context, ok, _) => !ok
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Center(
              child: PkPill(
                key: const Key('field-draft-saved'),
                label: AppLocalizations.of(context).fieldDraftSaved,
                tone: PkTone.ok,
                icon: Icons.check,
              ),
            ),
          ),
  );
}

/// 24-hour bar: work (blue) · standby (amber) · breakdown (red), with the numbers written beside it.
class HoursBar extends StatelessWidget {
  const HoursBar({super.key, required this.work, required this.standby, required this.breakdown});
  final double work;
  final double standby;
  final double breakdown;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    // work = primary · standby = orange · breakdown = red (theme colours, D2510: no hex in feature code)
    final workColor = theme.colorScheme.primary;
    final standbyColor = context.pk.warn;
    final breakdownColor = context.pk.bad;
    final total = work + standby + breakdown;
    final over = total > maxHoursPerDay + 1e-9;
    int flex(double v) => (v.clamp(0, maxHoursPerDay) * 100).round();
    final rest = (maxHoursPerDay - total).clamp(0, maxHoursPerDay).toDouble();
    return Semantics(
      label: t.fieldHoursTotal(fmtNum(total)),
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: SizedBox(
              height: 12,
              child: Row(
                children: [
                  if (work > 0)
                    Expanded(
                      flex: flex(work),
                      child: ColoredBox(color: workColor),
                    ),
                  if (standby > 0)
                    Expanded(
                      flex: flex(standby),
                      child: ColoredBox(color: standbyColor),
                    ),
                  if (breakdown > 0)
                    Expanded(
                      flex: flex(breakdown),
                      child: ColoredBox(color: breakdownColor),
                    ),
                  if (rest > 0)
                    Expanded(
                      flex: flex(rest),
                      child: ColoredBox(color: theme.colorScheme.surfaceContainerHighest),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            over ? t.fieldHoursOver(fmtNum(total)) : t.fieldHoursTotal(fmtNum(total)),
            key: const Key('field-hours-total'),
            style: theme.textTheme.bodySmall?.copyWith(color: over ? theme.colorScheme.error : null),
          ),
        ],
      ),
    );
  }
}

/// Bottom sheet: pick a unit, search by unit code / plate / type.
Future<FieldUnit?> pickUnit(BuildContext context, List<FieldUnit> units) => showModalBottomSheet<FieldUnit>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => _UnitPicker(units: units),
);

class _UnitPicker extends StatefulWidget {
  const _UnitPicker({required this.units});
  final List<FieldUnit> units;
  @override
  State<_UnitPicker> createState() => _UnitPickerState();
}

class _UnitPickerState extends State<_UnitPicker> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final list = widget.units.where((u) => u.matches(_q)).toList();
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.7,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  key: const Key('unit-search'),
                  autofocus: false,
                  decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: t.fieldUnitSearch),
                  onChanged: (v) => setState(() => _q = v),
                ),
              ),
              Expanded(
                child: list.isEmpty
                    ? Center(child: Text(t.fieldUnitNone))
                    : ListView.builder(
                        itemCount: list.length,
                        itemBuilder: (_, i) {
                          final u = list[i];
                          return ListTile(
                            key: Key('unit-option-${u.id}'),
                            leading: const PkIconChip(icon: Icons.agriculture, tone: PkTone.warn),
                            title: Text(u.title),
                            subtitle: Text(unitSubtitle(t, u)),
                            onTap: () => Navigator.of(context).pop(u),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Milik sendiri · SN KMTPC123 · HM terakhir 1.023".
String unitSubtitle(AppLocalizations t, FieldUnit u) => [
  u.customerOwned ? t.fieldUnitOwnerCustomer(u.clientName ?? '-') : t.fieldUnitOwnerOwn,
  if ((u.serialNo ?? '').isNotEmpty) 'SN ${u.serialNo}',
  if (u.lastHourMeter != null) t.fieldUnitLastHm(fmtNum(u.lastHourMeter!)),
  u.status.label,
].join(' · ');
