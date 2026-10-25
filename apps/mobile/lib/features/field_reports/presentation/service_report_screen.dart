import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/form_grid.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/draft_repository.dart';
import '../../sync/application/sync_coordinator.dart';
import '../application/field_providers.dart';
import '../domain/field_models.dart';
import '../domain/field_rules.dart';
import 'widgets/field_widgets.dart';
import '../../../shared/widgets/pick_hint.dart';

/// Laporan Servis Unit (mockup "Android-Servis", ADR 0020 §5): project / contract, unit (search by code or
/// plate), date (today, ≤ 14 days back), HM (not below the unit's last HM), start/end, service types (≥ 1 of the
/// PT's master, owner 2026-10-17), complaint, action, helper, spare parts (text only, no part no.), unit status after
/// the service, photos before/after (≤ 25), notes. Autosaved as a draft; "Kirim" queues it for the offline sync.
class ServiceReportScreen extends ConsumerStatefulWidget {
  const ServiceReportScreen({super.key, this.initial, this.projectId, this.unitId});
  final FieldDraft? initial;
  final int? projectId;
  final int? unitId;

  @override
  ConsumerState<ServiceReportScreen> createState() => _ServiceReportScreenState();
}

class _ServiceReportScreenState extends ConsumerState<ServiceReportScreen> {
  final _hm = TextEditingController();
  final _start = TextEditingController();
  final _end = TextEditingController();
  final _complaint = TextEditingController();
  final _action = TextEditingController();
  final _helpers = TextEditingController();
  final _notes = TextEditingController();
  final _reason = TextEditingController();

  late final String _uuid;
  FieldDraft? _base;
  int? _projectId;
  int? _companyId;
  String _projectLabel = '';
  late String _date;
  int? _unitId;
  String _unitLabel = '';
  FieldUnit? _unit;
  List<(String, double)> _readings = const [];
  List<int> _typeIds = const [];
  Map<int, String> _typeNames = const {};
  String? _legacyType;
  UnitStatus? _status;
  List<PartLine> _parts = const [];
  List<String> _before = const [];
  List<String> _after = const [];
  Map<String, String> _errors = const {};
  bool _busy = false;
  DraftAutosaver? _autosave;

  bool get _isEdit => _base?.isEdit ?? false;
  bool get _locked => _isEdit;

  @override
  void initState() {
    super.initState();
    final d = widget.initial;
    _base = d;
    final service = ref.read(fieldServiceProvider);
    final sub = ref.read(currentSubProvider);
    if (sub != null) _autosave = DraftAutosaver(service, sub);
    _date = d?.reportDate ?? ref.read(fieldTodayProvider);
    _uuid =
        d?.clientUuid ?? service.newDraft(FieldReportType.serviceReport, projectId: 0, reportDate: _date).clientUuid;
    if (d != null) {
      final c = d.service;
      _projectId = d.projectId;
      _companyId = d.companyId;
      _projectLabel = d.projectLabel;
      _unitId = c.unitId;
      _unitLabel = c.unitLabel;
      _hm.text = decInput(c.hourMeter);
      _start.text = c.startTime ?? '';
      _end.text = c.endTime ?? '';
      _typeIds = c.serviceTypeIds;
      _typeNames = c.serviceTypeNames;
      _legacyType = c.legacyServiceType;
      _complaint.text = c.complaint;
      _action.text = c.action;
      _helpers.text = c.helpers;
      _parts = c.spareparts;
      _status = c.unitStatusAfter;
      _notes.text = c.notes;
      _before = c.beforePhotos;
      _after = c.afterPhotos;
      _reason.text = d.reason ?? '';
    } else {
      _projectId = widget.projectId;
      _unitId = widget.unitId;
    }
    if (_unitId != null) WidgetsBinding.instance.addPostFrameCallback((_) => _loadReadings());
  }

  @override
  void dispose() {
    _autosave?.dispose();
    for (final c in [_hm, _start, _end, _complaint, _action, _helpers, _notes, _reason]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadReadings() async {
    final sub = ref.read(currentSubProvider);
    final id = _unitId;
    if (sub == null || id == null) return;
    final r = await ref.read(fieldServiceProvider).hmReadings(sub, id, excludeUuid: _uuid);
    if (mounted) setState(() => _readings = r);
  }

  FieldProject? _project(List<FieldProject> list) => list.where((p) => p.id == _projectId).firstOrNull;

  FieldDraft _current() {
    final base = _base;
    return FieldDraft(
      clientUuid: _uuid,
      type: FieldReportType.serviceReport,
      companyId: _companyId ?? base?.companyId,
      projectId: _projectId ?? 0,
      projectLabel: _projectLabel,
      reportDate: _date,
      content: ServiceContent(
        unitId: _unitId,
        unitLabel: _unitLabel,
        hourMeter: parseDec(_hm.text),
        startTime: _start.text.trim().isEmpty ? null : _start.text.trim(),
        endTime: _end.text.trim().isEmpty ? null : _end.text.trim(),
        serviceTypeIds: _typeIds,
        serviceTypeNames: {
          for (final id in _typeIds)
            if (_typeNames[id] case final String name) id: name,
        },
        legacyServiceType: _typeIds.isEmpty ? _legacyType : null,
        complaint: _complaint.text,
        action: _action.text,
        helpers: _helpers.text,
        spareparts: _parts,
        unitStatusAfter: _status,
        notes: _notes.text,
        beforePhotos: _before,
        afterPhotos: _after,
      ),
      serverPhotoCount: base?.serverPhotoCount ?? 0,
      reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
      serverId: base?.serverId,
      serverRev: base?.serverRev,
      docNo: base?.docNo,
      editableUntil: base?.editableUntil,
      syncState: base?.syncState ?? FieldSyncState.local,
    );
  }

  /// Autosave once there is something worth keeping (never a queued / conflicting report: see saveDraft).
  void _changed() {
    if (_projectId == null) return;
    final d = _current();
    final meaningful = _unitId != null || _action.text.trim().isNotEmpty || d.content.photoUuids.isNotEmpty;
    if (meaningful) _autosave?.schedule(d);
  }

  void _set(VoidCallback f, [String? clearError]) {
    setState(() {
      f();
      if (clearError != null) _errors = {..._errors}..remove(clearError);
    });
    _changed();
  }

  double? _floor() {
    final u = _unit;
    return hmFloor(
      lastHourMeter: u?.lastHourMeter,
      lastHourMeterAt: u?.lastHourMeterAt,
      date: _date,
      readings: _readings,
    );
  }

  Future<void> _pickUnit(List<FieldUnit> units) async {
    final u = await pickUnit(context, units);
    if (u == null || !mounted) return;
    _set(() {
      _unitId = u.id;
      _unit = u;
      _unitLabel = u.code;
      _readings = const [];
    }, 'unit');
    await _loadReadings();
  }

  /// Multi-select of the PT's service types (≥ 1); the pseudo type of a legacy code ([_legacyId]) is only removed.
  void _toggleType(ServiceType v) => _set(() {
    if (v.id == _legacyId) {
      _legacyType = null;
    } else if (_typeIds.contains(v.id)) {
      _typeIds = [..._typeIds]..remove(v.id);
    } else {
      _typeIds = [..._typeIds, v.id];
      _typeNames = {..._typeNames, v.id: v.name};
    }
  }, 'serviceType');

  /// Options: the PT's active types + every chosen one (an inactive or not yet cached type stays shown) + the
  /// legacy code of a report from an APK before 0.8.0 that the cache cannot map.
  List<ServiceType> _typeOptions(List<ServiceType> types) {
    final known = {for (final t in types) t.id};
    return [
      for (final t in types)
        if (t.active || _typeIds.contains(t.id)) t,
      for (final id in _typeIds)
        if (!known.contains(id)) ServiceType(id: id, companyId: _companyId ?? 0, name: _typeNames[id] ?? '#$id'),
      if (_typeIds.isEmpty && _legacyType != null)
        ServiceType(id: _legacyId, companyId: _companyId ?? 0, code: _legacyType!, name: _legacyType!),
    ];
  }

  static const _legacyId = -1;

  Future<void> _pickTime(TextEditingController c) async {
    final now = TimeOfDay.now();
    final parts = c.text.split(':');
    final initial = parts.length == 2
        ? TimeOfDay(hour: int.tryParse(parts[0]) ?? now.hour, minute: int.tryParse(parts[1]) ?? 0)
        : now;
    final picked = await showTimePicker(context: context, initialTime: initial);
    if (picked == null || !mounted) return;
    _set(
      () => c.text = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}',
      c == _start ? 'startTime' : 'endTime',
    );
  }

  Future<void> _addPhoto({required bool after}) async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final raw = await ref.read(fieldPhotoCaptureProvider)(context, after ? t.fieldPhotoAfter : t.fieldPhotoBefore);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final uuid = await ref.read(fieldServiceProvider).addPhoto(sub, raw);
      if (!mounted) return;
      _set(() => after ? _after = [..._after, uuid] : _before = [..._before, uuid], 'photos');
      await _autosave?.flush(); // the photo is on the phone now: keep the draft that references it
    } on PhotoTooLargeException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on QueueFullException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on Object {
      if (mounted) showSnack(context, t.fieldPhotoFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final d = _current();
    final errors = validateService(d, today: ref.read(fieldTodayProvider), floor: _floor());
    setState(() => _errors = errors);
    if (errors.isNotEmpty) {
      showSnack(context, t.fieldFixErrors);
      return;
    }
    final label = _isEdit ? t.fieldSaveEdit : t.fieldServiceSubmit;
    final ok = await confirmFieldSubmit(context, label, project: _projectLabel, date: _date, unit: _unitLabel);
    if (!ok || !mounted) return;
    final online = ref.read(connectivityProvider);
    setState(() => _busy = true);
    _autosave?.cancel();
    try {
      await ref.read(fieldServiceProvider).submit(sub, d, online: online);
      ref.read(syncCoordinatorProvider.notifier).requestSync(delay: Duration.zero);
      if (!mounted) return;
      await showFieldSubmitted(context, label, online: online);
      if (mounted) Navigator.of(context).maybePop();
    } on Object catch (e) {
      if (mounted) await showActionError(context, e, action: label);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _discard() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final ok = await confirmDiscard(context);
    if (!ok) return;
    _autosave?.cancel();
    await ref.read(fieldServiceProvider).discard(sub, _uuid);
    if (!mounted) return;
    await showActionResult(context, message: t.fieldDiscarded, action: t.fieldDiscardAction);
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final profile = ref.watch(currentProfileProvider);
    ref.watch(fieldCacheRefreshProvider);
    final projectsAsync = ref.watch(fieldProjectsProvider);
    final projects = [
      for (final p in projectsAsync.value ?? const <FieldProject>[])
        if (p.kind.reportTypes.contains(FieldReportType.serviceReport) &&
            canCreateField(profile, FieldReportType.serviceReport, p.companyId))
          p,
    ];
    final project = _project(projects);
    if (project != null && _companyId == null) {
      // project passed by the route (hub / timesheet suggestion): its PT and label
      _companyId = project.companyId;
      _projectLabel = project.label;
    }
    final unitsAsync = _projectId == null ? null : ref.watch(fieldUnitsProvider((_projectId!, null)));
    final units = unitsAsync?.value ?? const <FieldUnit>[];
    final unit = _unit ?? units.where((u) => u.id == _unitId).firstOrNull;
    if (_unit == null && unit != null) {
      _unit = unit;
      if (_unitLabel.isEmpty) _unitLabel = unit.code;
    }
    final typesAsync = _companyId == null ? null : ref.watch(fieldServiceTypesProvider(_companyId!));
    final types = typesAsync?.value ?? const <ServiceType>[];
    if (_typeIds.isEmpty && _legacyType != null) {
      // a draft of an APK before 0.8.0: its single code becomes the PT's type with that code once the cache has it
      final m = matchLegacyServiceType(types, _legacyType);
      if (m != null) {
        _typeIds = [m.id];
        _typeNames = {m.id: m.name};
        _legacyType = null;
      }
    }
    final typeOptions = _typeOptions(types);
    final noTypes = typeOptions.isEmpty && (typesAsync?.hasValue ?? false);
    final floor = _floor();
    final hm = parseDec(_hm.text);
    final hmBelow = !_isEdit && hm != null && floor != null && hm < floor - 0.005;
    final remaining =
        FieldReportType.serviceReport.maxPhotos - (_base?.serverPhotoCount ?? 0) - _before.length - _after.length;
    final dates = allowedReportDates(ref.watch(fieldTodayProvider));
    final c = _current().service;
    final summary = [
      if (_unitLabel.isNotEmpty) _unitLabel,
      if (hm != null) floor == null ? 'HM ${fmtNum(hm)}' : 'HM ${fmtNum(floor)} → ${fmtNum(hm)}',
      t.fieldPartsCount(c.filledParts.length),
      t.fieldPhotoCount(_before.length + _after.length + (_base?.serverPhotoCount ?? 0)),
    ].join(' · ');

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? t.fieldServiceEditTitle : t.fieldServiceTitle),
        actions: [
          if (_autosave != null) DraftSavedPill(saved: _autosave!.saved),
          if (widget.initial != null && !_isEdit)
            IconButton(
              key: const Key('field-discard'),
              tooltip: t.delete,
              icon: const Icon(Icons.delete_outline),
              onPressed: _busy ? null : _discard,
            ),
        ],
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          color: context.pk.card,
          border: Border(top: BorderSide(color: context.pk.border)),
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  summary,
                  key: const Key('service-summary'),
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall,
                ),
                const SizedBox(height: 8),
                FilledButton(
                  key: const Key('service-submit'),
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(_isEdit ? t.fieldSaveEdit : t.fieldServiceSubmit),
                ),
              ],
            ),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          if (_base?.lastError != null) FieldNote(text: _base!.lastError!, error: true),
          if (_isEdit && _base?.editableUntil != null)
            FieldNote(
              text: t.fieldEditWindow(formatEditableUntil(_base!.editableUntil, profile?.timezone)),
              warn: true,
            ),
          const SizedBox(height: 8),
          AsyncBody<List<FieldProject>>(
            value: projectsAsync,
            data: (_) => DropdownButtonFormField<int>(
              hint: Text(pickHintFor(t, t.fieldProjectContract)),
              key: const Key('service-project'),
              initialValue: projects.any((p) => p.id == _projectId) ? _projectId : null,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: t.fieldProjectContract,
                errorText: _errors['project'],
                helperText: projects.isEmpty ? t.fieldNoProjects : null,
              ),
              items: [
                for (final p in projects)
                  DropdownMenuItem(
                    value: p.id,
                    child: Text(
                      '${(profile?.showCompanyChips ?? false) ? '${profile!.companyCode(p.companyId)} · ' : ''}${p.label} (${p.kind.label.toLowerCase()})',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: _locked || _busy
                  ? null
                  : (v) => _set(() {
                      final p = projects.firstWhere((p) => p.id == v);
                      if (p.companyId != _companyId) {
                        // service types are per PT
                        _typeIds = const [];
                        _typeNames = const {};
                      }
                      _projectId = v;
                      _companyId = p.companyId;
                      _projectLabel = p.label;
                      _unitId = null;
                      _unit = null;
                      _unitLabel = '';
                    }, 'project'),
            ),
          ),
          const SizedBox(height: 12),
          FieldSection(
            title: t.fieldUnit,
            children: [
              _UnitButton(
                unit: unit,
                label: _unitLabel,
                errorText: _errors['unit'],
                onTap: _locked || _busy || _projectId == null ? null : () => _pickUnit(units),
              ),
              if (_projectId != null && unitsAsync?.hasValue == true && units.isEmpty)
                FieldNote(text: t.fieldNoUnits, warn: true),
              const SizedBox(height: 12),
              // DRMS 13/10 Umum #2 / D4: label left of the field, two columns on wide screens.
              FormGrid(
                children: [
                  FormGridCell(
                    label: t.fieldDate,
                    child: FieldDateField(
                      key: const Key('service-date'),
                      value: _date,
                      dates: dates,
                      label: t.fieldDate,
                      errorText: _errors['date'],
                      onChanged: _locked || _busy ? null : (v) => _set(() => _date = v, 'date'),
                    ),
                  ),
                  FormGridCell(
                    label: t.fieldHmAtService,
                    builder: (label) => TextField(
                      key: const Key('service-hm'),
                      controller: _hm,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                      decoration: InputDecoration(
                        labelText: label,
                        errorText: _errors['hourMeter'] ?? (hmBelow ? t.fieldHmBelow(fmtNum(floor)) : null),
                        errorMaxLines: 3,
                        helperText: floor == null ? null : t.fieldHmLast(fmtNum(floor)),
                      ),
                      onChanged: (_) => _set(() {}, 'hourMeter'),
                    ),
                  ),
                  FormGridCell(
                    label: t.fieldStart,
                    builder: (l) => _timeField(_start, t.fieldStart, l, 'startTime', const Key('service-start')),
                  ),
                  FormGridCell(
                    label: t.fieldEnd,
                    builder: (l) => _timeField(_end, t.fieldEnd, l, 'endTime', const Key('service-end')),
                  ),
                ],
              ),
            ],
          ),
          FieldSection(
            title: t.fieldWork,
            children: [
              // D4: label left of the field on wide screens; the long texts span the whole width.
              FormGrid(
                children: [
                  FormGridCell(
                    label: t.fieldServiceType,
                    full: true,
                    stackedLabel: true,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ChoiceGrid<ServiceType>(
                          keyPrefix: 'service-type',
                          options: typeOptions,
                          selected: null,
                          isSelected: (v) => v.id == _legacyId || _typeIds.contains(v.id),
                          label: (v) => v.active ? v.name : t.fieldServiceTypeInactive(v.name),
                          code: (v) => v.code.isEmpty ? '${v.id}' : v.code,
                          onSelected: _busy ? null : _toggleType,
                        ),
                        if (noTypes) FieldNote(text: t.fieldServiceTypesEmpty, warn: true),
                        if (typeOptions.isNotEmpty) FieldNote(text: t.fieldServiceTypeHelp),
                        if (_errors['serviceType'] != null) FieldNote(text: _errors['serviceType']!, error: true),
                      ],
                    ),
                  ),
                  FormGridCell(
                    label: t.fieldComplaint,
                    full: true,
                    builder: (label) => TextField(
                      key: const Key('service-complaint'),
                      controller: _complaint,
                      minLines: 2,
                      maxLines: 4,
                      maxLength: 2000,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(labelText: label, errorText: _errors['complaint']),
                      onChanged: (_) => _changed(),
                    ),
                  ),
                  FormGridCell(
                    label: t.fieldAction,
                    full: true,
                    builder: (label) => TextField(
                      key: const Key('service-action'),
                      controller: _action,
                      minLines: 3,
                      maxLines: 6,
                      maxLength: 4000,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(labelText: label, errorText: _errors['action']),
                      onChanged: (_) => _set(() {}, 'action'),
                    ),
                  ),
                  FormGridCell(
                    label: t.fieldHelpers,
                    builder: (label) => TextField(
                      key: const Key('service-helpers'),
                      controller: _helpers,
                      maxLength: 200,
                      decoration: InputDecoration(labelText: label, errorText: _errors['helpers']),
                      onChanged: (_) => _changed(),
                    ),
                  ),
                ],
              ),
            ],
          ),
          FieldSection(
            title: t.fieldSpareparts,
            children: [
              PartLinesEditor(
                keyPrefix: 'part',
                lines: _parts,
                nameHeader: t.fieldPartNameHeader,
                addLabel: t.fieldAddSparepart,
                enabled: !_busy,
                showPartNo: false,
                onChanged: (v) => _set(() => _parts = v, 'parts'),
              ),
              if (_errors['parts'] != null) FieldNote(text: _errors['parts']!, error: true),
              FieldNote(text: t.fieldSparepartsNote),
            ],
          ),
          FieldSection(
            title: t.fieldUnitStatusAfter,
            children: [
              ChoiceGrid<UnitStatus>(
                keyPrefix: 'unit-status',
                columns: 3,
                options: UnitStatus.values,
                selected: _status,
                label: (v) => v.label,
                code: (v) => v.code,
                // filled status colours carry white text in both themes
                selectedColor: (v) => v == UnitStatus.menungguPart
                    ? context.pk.warn
                    : (v == UnitStatus.rusak ? context.pk.bad : theme.colorScheme.primary),
                onSelected: _busy ? null : (v) => _set(() => _status = v, 'unitStatusAfter'),
              ),
              if (_errors['unitStatusAfter'] != null) FieldNote(text: _errors['unitStatusAfter']!, error: true),
              if (_status == UnitStatus.menungguPart)
                FieldNote(
                  key: const Key('service-pm-hint'),
                  text: t.fieldPmNotified(_unitLabel.isEmpty ? t.fieldUnit.toLowerCase() : _unitLabel),
                  warn: true,
                ),
            ],
          ),
          FieldSection(
            title: t.fieldPhotos,
            children: [
              if ((_base?.serverPhotoCount ?? 0) > 0) FieldNote(text: t.fieldPhotosOnServer(_base!.serverPhotoCount)),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: PhotoGroup(
                      title: t.fieldPhotoBeforeCount(_before.length),
                      photos: _before,
                      canAdd: remaining > 0,
                      addKey: const Key('service-add-before'),
                      onAdd: _busy ? null : () => _addPhoto(after: false),
                      onRemove: _busy ? null : (p) => _set(() => _before = [..._before]..remove(p), 'photos'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: PhotoGroup(
                      title: t.fieldPhotoAfterCount(_after.length),
                      photos: _after,
                      canAdd: remaining > 0,
                      addKey: const Key('service-add-after'),
                      onAdd: _busy ? null : () => _addPhoto(after: true),
                      onRemove: _busy ? null : (p) => _set(() => _after = [..._after]..remove(p), 'photos'),
                    ),
                  ),
                ],
              ),
              FieldNote(text: t.fieldPhotoLimit(FieldReportType.serviceReport.maxPhotos)),
              if (_errors['photos'] != null) FieldNote(text: _errors['photos']!, error: true),
              const SizedBox(height: 12),
              TextField(
                key: const Key('service-notes'),
                controller: _notes,
                minLines: 2,
                maxLines: 4,
                maxLength: 2000,
                decoration: InputDecoration(labelText: t.fieldReportNotes, errorText: _errors['notes']),
                onChanged: (_) => _changed(),
              ),
            ],
          ),
          if (_isEdit)
            TextField(
              key: const Key('field-reason'),
              controller: _reason,
              maxLength: 1000,
              decoration: InputDecoration(
                labelText: t.fieldEditReason,
                helperText: t.fieldEditReasonHelp,
                errorText: _errors['reason'],
              ),
              onChanged: (_) => _changed(),
            ),
          if (project == null && _projectId != null && projectsAsync.hasValue && !_isEdit)
            FieldNote(text: t.fieldProjectUnavailable, warn: true),
        ],
      ),
    );
  }

  /// [inputLabel]: the label inside the input (null while a FormGridCell shows [label] left of it).
  Widget _timeField(TextEditingController c, String label, String? inputLabel, String errorKey, Key key) => TextField(
    key: key,
    controller: c,
    keyboardType: TextInputType.datetime,
    inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9:]')), LengthLimitingTextInputFormatter(5)],
    decoration: InputDecoration(
      labelText: inputLabel,
      hintText: '08:30',
      errorText: _errors[errorKey],
      suffixIcon: IconButton(
        tooltip: label,
        icon: const Icon(Icons.schedule),
        onPressed: _busy ? null : () => _pickTime(c),
      ),
    ),
    onChanged: (_) => _set(() {}, errorKey),
  );
}

class _UnitButton extends StatelessWidget {
  const _UnitButton({required this.unit, required this.label, required this.onTap, this.errorText});
  final FieldUnit? unit;
  final String label;
  final VoidCallback? onTap;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final u = unit;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OutlinedButton(
          key: const Key('field-unit-pick'),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            alignment: Alignment.centerLeft,
            side: BorderSide(color: errorText == null ? context.pk.border : theme.colorScheme.error),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(PkRadius.md)),
          ),
          onPressed: onTap,
          child: Row(
            children: [
              const PkIconChip(icon: Icons.agriculture, tone: PkTone.warn, size: 44),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      u?.title ?? (label.isEmpty ? t.fieldPickUnit : label),
                      style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.onSurface),
                    ),
                    if (u != null) Text(unitSubtitle(t, u), style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
              if (onTap != null)
                Text(
                  u == null ? t.fieldChoose : t.fieldChange,
                  style: TextStyle(color: theme.colorScheme.primary, fontWeight: FontWeight.w600),
                ),
            ],
          ),
        ),
        if (errorText != null) FieldNote(text: errorText!, error: true),
      ],
    );
  }
}

/// "Hapus draft?" confirmation (drafts the server never received).
/// D2410: the shared "Yakin ingin hapus draft?" popup (danger button).
Future<bool> confirmDiscard(BuildContext context) {
  final t = AppLocalizations.of(context);
  return confirmAction(
    context,
    action: t.fieldDiscardAction,
    note: t.fieldDiscardBody,
    confirmKey: const Key('field-discard-ok'),
  );
}
