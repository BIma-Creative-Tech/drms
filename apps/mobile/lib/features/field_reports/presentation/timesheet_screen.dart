import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/draft_repository.dart';
import '../../sync/application/sync_coordinator.dart';
import '../application/field_providers.dart';
import '../domain/field_models.dart';
import '../domain/field_rules.dart';
import 'service_report_screen.dart' show confirmDiscard;
import 'widgets/field_widgets.dart';
import '../../../shared/widgets/pick_hint.dart';

/// Timesheet Unit (mockup "Android-Timesheet", ADR 0020 §5): contract + date, one tab per unit of the contract
/// active on that date (✓ / belum), HM awal prefilled from the last recorded HM akhir (server or this phone), HM akhir,
/// the HM photo — HM optional, recorded about once a week (user 2026-10-24): both or none, the photo only with HM; a
/// prefilled HM awal left untouched is not sent while HM akhir is empty — the date window of the caller (PM project /
/// Direktur: the whole contract period, else 14 days), work / standby / breakdown hours with a 24 h bar and live
/// validation, breakdown reason,
/// operator (text), fuel, location, notes, "Salin dari kemarin", "Simpan & lanjut ke (unit berikutnya)", and the
/// "breakdown ≥ 4 jam → laporan servis" suggestion. One draft per unit and date, autosaved.
class TimesheetScreen extends ConsumerStatefulWidget {
  const TimesheetScreen({super.key, this.initial, this.projectId, this.date});

  /// A local draft / an own server timesheet to edit: contract, date and unit are fixed.
  final FieldDraft? initial;
  final int? projectId;
  final String? date;

  @override
  ConsumerState<TimesheetScreen> createState() => _TimesheetScreenState();
}

class _TimesheetScreenState extends ConsumerState<TimesheetScreen> {
  final _hmStart = TextEditingController();
  final _hmEnd = TextEditingController();
  final _work = TextEditingController();
  final _standby = TextEditingController();
  final _breakdown = TextEditingController();
  final _breakdownReason = TextEditingController();
  final _operator = TextEditingController();
  final _fuel = TextEditingController();
  final _location = TextEditingController();
  final _notes = TextEditingController();
  final _reason = TextEditingController();

  int? _projectId;
  int? _companyId;
  String _projectLabel = '';
  late String _date;
  int? _unitId;
  String _unitLabel = '';

  /// Draft of the selected unit (null = new, not saved yet).
  FieldDraft? _base;
  String? _uuid;
  String? _hmPhoto;
  double? _prevHm;
  String? _prevHmDate;

  /// HM awal typed (or stored) by the user; false = still the prefill (dropped while HM akhir is empty).
  bool _hmStartTouched = false;
  bool _loading = false;
  bool _busy = false;
  Map<String, String> _errors = const {};
  DraftAutosaver? _autosave;

  bool get _single => widget.initial != null;
  bool get _isEdit => _base?.isEdit ?? false;

  @override
  void initState() {
    super.initState();
    final sub = ref.read(currentSubProvider);
    if (sub != null) _autosave = DraftAutosaver(ref.read(fieldServiceProvider), sub);
    final d = widget.initial;
    _date = d?.reportDate ?? widget.date ?? ref.read(fieldTodayProvider);
    if (d != null) {
      _projectId = d.projectId;
      _companyId = d.companyId;
      _projectLabel = d.projectLabel;
      _fill(d);
    } else {
      _projectId = widget.projectId;
    }
  }

  @override
  void dispose() {
    _autosave?.dispose();
    for (final c in _controllers) {
      c.dispose();
    }
    super.dispose();
  }

  List<TextEditingController> get _controllers => [
    _hmStart,
    _hmEnd,
    _work,
    _standby,
    _breakdown,
    _breakdownReason,
    _operator,
    _fuel,
    _location,
    _notes,
    _reason,
  ];

  void _fill(FieldDraft d) {
    final c = d.timesheet;
    _base = d;
    _uuid = d.clientUuid;
    _unitId = c.unitId;
    _unitLabel = c.unitLabel;
    _hmStart.text = decInput(c.hmStart);
    _hmEnd.text = decInput(c.hmEnd);
    _work.text = decInput(c.workHours);
    _standby.text = decInput(c.standbyHours);
    _breakdown.text = decInput(c.breakdownHours);
    _breakdownReason.text = c.breakdownReason;
    _operator.text = c.operatorName;
    _fuel.text = decInput(c.fuelLiters);
    _location.text = c.location;
    _notes.text = c.notes;
    _reason.text = d.reason ?? '';
    _hmPhoto = c.hmPhoto;
    _prevHm = c.previousHmEnd;
    _prevHmDate = c.previousHmDate;
    _hmStartTouched = c.hmStart != null;
  }

  /// Opens unit [unit] on the current date: its local draft (any state) or a new one with HM awal prefilled.
  Future<void> _openUnit(int unitId, String label) async {
    final sub = ref.read(currentSubProvider);
    final projectId = _projectId;
    if (sub == null || projectId == null) return;
    await _autosave?.flush();
    setState(() => _loading = true);
    final st = await ref
        .read(fieldServiceProvider)
        .timesheetStart(sub, projectId: projectId, unitId: unitId, date: _date);
    final local = st.local;
    final prev = (hm: st.prevHm, date: st.prevDate);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _errors = const {};
      if (local != null) {
        _fill(local);
        // the prefill source may have changed since the draft was written (newer server data)
        _prevHm ??= prev.hm;
        _prevHmDate ??= prev.date;
        // a draft without HM: HM awal prefilled again (untouched)
        if (!local.timesheet.hasHm && _prevHm != null) _hmStart.text = decInput(_prevHm);
      } else {
        for (final c in _controllers) {
          c.clear();
        }
        _base = null;
        _uuid = ref
            .read(fieldServiceProvider)
            .newDraft(FieldReportType.unitTimesheet, projectId: projectId, reportDate: _date)
            .clientUuid;
        _unitId = unitId;
        _unitLabel = label;
        _hmPhoto = null;
        _prevHm = prev.hm;
        _prevHmDate = prev.date;
        _hmStartTouched = false;
        _hmStart.text = decInput(prev.hm);
      }
    });
  }

  FieldDraft _current() => FieldDraft(
    clientUuid: _uuid ?? '',
    type: FieldReportType.unitTimesheet,
    companyId: _companyId ?? _base?.companyId,
    projectId: _projectId ?? 0,
    projectLabel: _projectLabel,
    reportDate: _date,
    content: TimesheetContent(
      unitId: _unitId,
      unitLabel: _unitLabel,
      hmStart: effectiveHmStart(
        hmStart: parseDec(_hmStart.text),
        hmEnd: parseDec(_hmEnd.text),
        touched: _hmStartTouched,
      ),
      hmEnd: parseDec(_hmEnd.text),
      workHours: parseDec(_work.text),
      standbyHours: parseDec(_standby.text),
      breakdownHours: parseDec(_breakdown.text),
      breakdownReason: _breakdownReason.text,
      fuelLiters: parseDec(_fuel.text),
      operatorName: _operator.text,
      location: _location.text,
      notes: _notes.text,
      hmPhoto: _hmPhoto,
      previousHmEnd: _prevHm,
      previousHmDate: _prevHmDate,
    ),
    serverPhotoCount: _base?.serverPhotoCount ?? 0,
    reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
    serverId: _base?.serverId,
    serverRev: _base?.serverRev,
    docNo: _base?.docNo,
    editableUntil: _base?.editableUntil,
    syncState: _base?.syncState ?? FieldSyncState.local,
  );

  void _changed([String? clearError]) {
    setState(() {
      if (clearError != null) _errors = {..._errors}..remove(clearError);
    });
    if (_uuid == null || _unitId == null || _projectId == null) return;
    final d = _current();
    final c = d.timesheet;
    if (c.hmEnd != null || c.workHours != null || c.hmPhoto != null || c.operatorName.trim().isNotEmpty) {
      _autosave?.schedule(d);
    }
  }

  void _copyYesterday(List<TimesheetMark> marks) {
    final t = AppLocalizations.of(context);
    final unit = _unitId;
    if (unit == null) return;
    final src = copySource(unitId: unit, date: _date, marks: marks);
    if (src == null) {
      showSnack(context, t.fieldCopyNone);
      return;
    }
    _operator.text = src.operatorName ?? '';
    _location.text = src.location ?? '';
    _changed();
    showSnack(context, t.fieldCopied(fieldDateLabel(src.reportDate)));
  }

  Future<void> _takeHmPhoto() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final raw = await ref.read(fieldPhotoCaptureProvider)(context, t.fieldHmPhoto);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final uuid = await ref.read(fieldServiceProvider).addPhoto(sub, raw);
      if (!mounted) return;
      _hmPhoto = uuid;
      _changed('photos');
      await _autosave?.flush();
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

  Future<void> _submit(({int id, String label})? next) async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null || _uuid == null) return;
    final d = _current();
    final today = ref.read(fieldTodayProvider);
    final minDate = _projectId == null ? null : ref.read(fieldTimesheetMinDateProvider(_projectId!)).value;
    final errors = validateTimesheet(d, today: today, minDate: minDate ?? timesheetMinDate(today, null));
    setState(() => _errors = errors);
    if (errors.isNotEmpty) {
      showSnack(context, t.fieldFixErrors);
      return;
    }
    final label = _isEdit
        ? t.fieldSaveEdit
        : (next == null || _single ? t.fieldTimesheetSave : t.fieldSaveAndNext(next.label));
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
      if (!mounted) return;
      if (next != null && !_single) {
        setState(() => _busy = false);
        await _openUnit(next.id, next.label);
      } else {
        Navigator.of(context).maybePop();
      }
    } on Object catch (e) {
      if (mounted) await showActionError(context, e, action: label);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _discard() async {
    final sub = ref.read(currentSubProvider);
    final uuid = _uuid;
    if (sub == null || uuid == null) return;
    if (!await confirmDiscard(context)) return;
    _autosave?.cancel();
    await ref.read(fieldServiceProvider).discard(sub, uuid);
    if (mounted) Navigator.of(context).maybePop();
  }

  void _selectProject(List<FieldProject> projects, int? id) {
    final p = projects.where((p) => p.id == id).firstOrNull;
    setState(() {
      _projectId = id;
      _companyId = p?.companyId;
      _projectLabel = p?.label ?? '';
      _unitId = null;
      _uuid = null;
      _base = null;
    });
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
        if (p.kind == ProjectKind.kontrakUnit && canCreateField(profile, FieldReportType.unitTimesheet, p.companyId)) p,
    ];
    // A single contract: chosen right away.
    if (_projectId == null && projects.length == 1 && !_single) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _projectId == null) _selectProject(projects, projects.single.id);
      });
    }
    final project = projects.where((p) => p.id == _projectId).firstOrNull;
    if (project != null && _companyId == null) {
      // project passed by the route (hub / "breakdown → servis"): its PT and label
      _companyId = project.companyId;
      _projectLabel = project.label;
    }
    final cusAsync = _projectId == null ? null : ref.watch(fieldContractUnitsProvider(_projectId!));
    final marks = _projectId == null
        ? const <TimesheetMark>[]
        : (ref.watch(fieldTimesheetMarksProvider(_projectId!)).value ?? const <TimesheetMark>[]);
    final drafts = ref.watch(openFieldDraftsProvider).value ?? const <FieldDraft>[];
    final tabs = <({int id, String label})>[
      if (_single)
        (id: _unitId ?? 0, label: _unitLabel)
      else
        for (final c in cusAsync?.value ?? const <FieldContractUnit>[])
          if (c.activeOn(_date)) (id: c.unitId, label: c.code),
    ];
    bool filled(int unitId) =>
        marks.any((m) => m.unitId == unitId && m.reportDate == _date) ||
        drafts.any(
          (d) =>
              d.type == FieldReportType.unitTimesheet &&
              d.projectId == _projectId &&
              d.unitId == unitId &&
              d.reportDate == _date &&
              d.syncState != FieldSyncState.local,
        );
    bool sentToServer(int unitId) =>
        marks.any((m) => m.unitId == unitId && m.reportDate == _date && !m.local) &&
        !(_base?.isEdit ?? false) &&
        (_base == null || _base!.syncState == FieldSyncState.local);
    // First unit without a timesheet is opened automatically.
    if (!_single && _unitId == null && tabs.isNotEmpty && !_loading) {
      final first = tabs.where((u) => !filled(u.id)).firstOrNull ?? tabs.first;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _unitId == null && !_loading) _openUnit(first.id, first.label);
      });
    }
    final idx = tabs.indexWhere((u) => u.id == _unitId);
    final next = idx < 0
        ? null
        : [...tabs.skip(idx + 1), ...tabs.take(idx)].where((u) => !filled(u.id) && u.id != _unitId).firstOrNull;
    final c = _current().timesheet;
    final hints = timesheetHints(c);
    final hmUsed = c.hmStart != null && c.hmEnd != null ? c.hmEnd! - c.hmStart! : null;
    final alreadySent = _unitId != null && sentToServer(_unitId!);
    final today = ref.watch(fieldTodayProvider);
    final minDate = _projectId == null
        ? timesheetMinDate(today, null)
        : (ref.watch(fieldTimesheetMinDateProvider(_projectId!)).value ?? timesheetMinDate(today, null));
    final dates = allowedReportDates(today, minDate: minDate);
    final wideWindow = minDate.compareTo(timesheetMinDate(today, null)) < 0;
    final photoFixed = _isEdit && (_base?.serverPhotoCount ?? 0) > 0;
    final breakdownOn = (c.breakdownHours ?? 0) > 0;

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? t.fieldTimesheetEditTitle : t.fieldTimesheetTitle),
        actions: [
          if (_autosave != null) DraftSavedPill(saved: _autosave!.saved),
          if (_base != null && !_isEdit && _base!.syncState != FieldSyncState.synced)
            IconButton(
              key: const Key('field-discard'),
              tooltip: t.delete,
              icon: const Icon(Icons.delete_outline),
              onPressed: _busy ? null : _discard,
            ),
        ],
      ),
      bottomNavigationBar: _unitId == null
          ? null
          : DecoratedBox(
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
                      if (!_single)
                        Text(
                          next == null ? t.fieldNextNone : t.fieldNextUnit(next.label),
                          key: const Key('timesheet-next'),
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall,
                        ),
                      const SizedBox(height: 8),
                      FilledButton(
                        key: const Key('timesheet-submit'),
                        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                        onPressed: _busy || _loading || alreadySent ? null : () => _submit(next),
                        child: _busy
                            ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                            : Text(
                                _isEdit
                                    ? t.fieldSaveEdit
                                    : (next == null || _single ? t.fieldTimesheetSave : t.fieldSaveAndNext(next.label)),
                              ),
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
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: AsyncBody<List<FieldProject>>(
                  value: projectsAsync,
                  data: (_) => DropdownButtonFormField<int>(
                    hint: Text(pickHintFor(t, t.fieldContract)),
                    key: const Key('timesheet-project'),
                    initialValue: projects.any((p) => p.id == _projectId) ? _projectId : null,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: t.fieldContract,
                      helperText: projects.isEmpty ? t.fieldNoContracts : null,
                      helperMaxLines: 2,
                    ),
                    items: [
                      for (final p in projects)
                        DropdownMenuItem(
                          value: p.id,
                          child: Text(
                            '${(profile?.showCompanyChips ?? false) ? '${profile!.companyCode(p.companyId)} · ' : ''}${p.label}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: _single || _busy ? null : (v) => _selectProject(projects, v),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FieldDateField(
                  key: const Key('timesheet-date'),
                  value: _date,
                  dates: dates,
                  label: t.fieldDate,
                  errorText: _errors['date'],
                  onChanged: _single || _busy
                      ? null
                      : (v) async {
                          await _autosave?.flush();
                          setState(() {
                            _date = v;
                            _unitId = null;
                            _uuid = null;
                            _base = null;
                          });
                        },
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (wideWindow && !_single)
            FieldNote(
              key: const Key('timesheet-date-window'),
              text: t.fieldTimesheetBackdateWide(fieldDateLabel(minDate)),
            ),
          if (_projectId != null && tabs.isEmpty && cusAsync?.hasValue == true)
            FieldNote(text: t.fieldNoContractUnits(fieldDateLabel(_date)), warn: true),
          if (tabs.isNotEmpty && !_single)
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final u in tabs)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: _UnitTab(
                        label: u.label,
                        selected: u.id == _unitId,
                        filled: filled(u.id),
                        onTap: _busy || _loading ? null : () => _openUnit(u.id, u.label),
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 10),
          if (_loading)
            const Center(
              child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()),
            ),
          if (_unitId != null && !_loading) ...[
            if (alreadySent)
              FieldNote(key: const Key('timesheet-already-sent'), text: t.fieldTimesheetAlreadySent, warn: true),
            FieldSection(
              title: _unitLabel,
              children: [
                Text(t.fieldHourMeter, style: theme.textTheme.labelLarge),
                const SizedBox(height: 6),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: _num(_hmStart, t.fieldHmStart, 'hmStart', const Key('timesheet-hm-start'), big: true),
                    ),
                    const SizedBox(width: 8),
                    Expanded(child: _num(_hmEnd, t.fieldHmEnd, 'hmEnd', const Key('timesheet-hm-end'), big: true)),
                  ],
                ),
                FieldNote(
                  key: const Key('timesheet-hm-hint'),
                  text: [
                    t.fieldHmOptional,
                    if (_prevHm != null)
                      t.fieldHmPrefilled(_prevHmDate == null ? '-' : fieldDateLabel(_prevHmDate!), fmtNum(_prevHm!)),
                    if (hmUsed != null && hmUsed >= 0) t.fieldHmUsed(fmtNum(hmUsed)),
                  ].join(' '),
                ),
                if (hints.hmGap)
                  FieldNote(key: const Key('timesheet-hm-gap'), text: t.fieldHmGap(fmtNum(_prevHm ?? 0)), warn: true),
                const SizedBox(height: 10),
                Row(
                  children: [
                    if (_hmPhoto != null)
                      PhotoGroup(
                        title: '',
                        photos: [_hmPhoto!],
                        canAdd: false,
                        onAdd: null,
                        onRemove: _busy ? null : (_) => setState(() => _hmPhoto = null),
                        size: 64,
                      )
                    else if (!photoFixed)
                      SizedBox.square(
                        dimension: 64,
                        child: OutlinedButton(
                          key: const Key('timesheet-hm-photo'),
                          style: OutlinedButton.styleFrom(
                            padding: EdgeInsets.zero,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                          onPressed: _busy ? null : _takeHmPhoto,
                          child: const Icon(Icons.add_a_photo),
                        ),
                      ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        photoFixed ? t.fieldHmPhotoFixed : t.fieldHmPhotoRequired,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: _errors['photos'] != null ? theme.colorScheme.error : null,
                        ),
                      ),
                    ),
                  ],
                ),
                if (_errors['photos'] != null) FieldNote(text: _errors['photos']!, error: true),
              ],
            ),
            FieldSection(
              title: t.fieldOperatingHours,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: _num(_work, t.fieldWorkHours, 'workHours', const Key('timesheet-work'), center: true),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _num(
                        _standby,
                        t.fieldStandbyHours,
                        'standbyHours',
                        const Key('timesheet-standby'),
                        center: true,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _num(
                        _breakdown,
                        t.fieldBreakdownHours,
                        'breakdownHours',
                        const Key('timesheet-breakdown'),
                        center: true,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                HoursBar(work: c.workHours ?? 0, standby: c.standbyHours ?? 0, breakdown: c.breakdownHours ?? 0),
                Text(t.fieldHoursLegend, style: theme.textTheme.bodySmall),
                if (_errors['hours'] != null) FieldNote(text: _errors['hours']!, error: true),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('timesheet-breakdown-reason'),
                  controller: _breakdownReason,
                  enabled: breakdownOn && !_busy,
                  maxLength: 500,
                  decoration: InputDecoration(
                    labelText: t.fieldBreakdownReason,
                    hintText: breakdownOn ? t.fieldBreakdownReasonHint : t.fieldNoBreakdown,
                    errorText: _errors['breakdownReason'],
                  ),
                  onChanged: (_) => _changed('breakdownReason'),
                ),
                if (hints.suggestService)
                  Card(
                    key: const Key('timesheet-suggest-service'),
                    elevation: 0,
                    color: context.pk.warnBg,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            t.fieldSuggestService(fmtNum(c.breakdownHours ?? 0)),
                            style: TextStyle(color: context.pk.warnOn),
                          ),
                          const SizedBox(height: 6),
                          OutlinedButton.icon(
                            key: const Key('timesheet-open-service'),
                            onPressed: () => context.push('/field/service/new?project=$_projectId&unit=$_unitId'),
                            icon: const Icon(Icons.build),
                            label: Text(t.fieldCreateServiceReport),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
            FieldSection(
              title: t.fieldOperatorFuel,
              trailing: OutlinedButton(
                key: const Key('timesheet-copy'),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
                onPressed: _busy ? null : () => _copyYesterday(marks),
                child: Text(t.fieldCopyYesterday),
              ),
              children: [
                TextField(
                  key: const Key('timesheet-operator'),
                  controller: _operator,
                  maxLength: 128,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(labelText: t.fieldOperatorName, errorText: _errors['operatorName']),
                  onChanged: (_) => _changed('operatorName'),
                ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: _num(_fuel, t.fieldFuel, 'fuelLiters', const Key('timesheet-fuel'))),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        key: const Key('timesheet-location'),
                        controller: _location,
                        maxLength: 200,
                        decoration: InputDecoration(labelText: t.fieldLocation, errorText: _errors['location']),
                        onChanged: (_) => _changed('location'),
                      ),
                    ),
                  ],
                ),
                TextField(
                  key: const Key('timesheet-notes'),
                  controller: _notes,
                  minLines: 2,
                  maxLines: 4,
                  maxLength: 2000,
                  decoration: InputDecoration(labelText: t.fieldReportNotes, errorText: _errors['notes']),
                  onChanged: (_) => _changed('notes'),
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
                onChanged: (_) => _changed('reason'),
              ),
          ],
        ],
      ),
    );
  }

  Widget _num(
    TextEditingController c,
    String label,
    String key,
    Key widgetKey, {
    bool big = false,
    bool center = false,
  }) => TextField(
    key: widgetKey,
    controller: c,
    enabled: !_busy,
    textAlign: center ? TextAlign.center : TextAlign.start,
    keyboardType: const TextInputType.numberWithOptions(decimal: true),
    inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
    style: TextStyle(fontWeight: FontWeight.w700, fontSize: big ? 20 : 17),
    decoration: InputDecoration(labelText: label, errorText: _errors[key], errorMaxLines: 3),
    onChanged: (_) {
      if (key == 'hmStart') _hmStartTouched = true;
      _changed(key == 'workHours' || key == 'standbyHours' || key == 'breakdownHours' ? 'hours' : key);
    },
  );
}

class _UnitTab extends StatelessWidget {
  const _UnitTab({required this.label, required this.selected, required this.filled, this.onTap});
  final String label;
  final bool selected;
  final bool filled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final (Color bg, Color fg, String text) = selected
        ? (scheme.primary, scheme.onPrimary, filled ? '$label ✓' : label)
        : filled
        ? (context.pk.okBg, context.pk.okOn, '$label ${t.fieldTabFilled}')
        : (context.pk.badBg, context.pk.badOn, '$label ${t.fieldTabMissing}');
    return Material(
      color: bg,
      shape: const StadiumBorder(),
      child: InkWell(
        key: Key('timesheet-tab-$label'),
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
          child: Text(
            text,
            style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 13),
          ),
        ),
      ),
    );
  }
}
