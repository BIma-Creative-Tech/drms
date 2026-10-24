import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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

/// P3 Laporan Harian (konstruksi; owner decisions 2026-10-10) — same fields as the web form, simple and
/// offline-first: project + date, weather pagi / siang / sore, rain / stop hours, volume pekerjaan per RAP item
/// (grouped by stage, realisation shown, over-RAP warning → notes required), material masuk / terpakai, manpower
/// per type, equipment units + hours, issues, notes, ≤ 10 photos. Autosaved encrypted draft; "Kirim" queues ONE
/// `daily_report.upsert` item. One report per project, reporter and date (server DAILY_EXISTS).
class DailyReportScreen extends ConsumerStatefulWidget {
  const DailyReportScreen({super.key, this.initial, this.projectId});
  final FieldDraft? initial;
  final int? projectId;

  @override
  ConsumerState<DailyReportScreen> createState() => _DailyReportScreenState();
}

class _DailyReportScreenState extends ConsumerState<DailyReportScreen> {
  final _issues = TextEditingController();
  final _notes = TextEditingController();
  final _reason = TextEditingController();

  late String _uuid;
  FieldDraft? _base;
  int? _projectId;
  int? _companyId;
  String _projectLabel = '';
  late String _date;
  DailyContent _c = const DailyContent();
  Map<String, String> _errors = const {};
  bool _busy = false;
  DraftAutosaver? _autosave;

  bool get _isEdit => _base?.isEdit ?? false;
  bool get _single => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final sub = ref.read(currentSubProvider);
    if (sub != null) _autosave = DraftAutosaver(ref.read(fieldServiceProvider), sub);
    final d = widget.initial;
    _date = d?.reportDate ?? ref.read(fieldTodayProvider);
    _projectId = d?.projectId ?? widget.projectId;
    if (d != null) {
      _base = d;
      _uuid = d.clientUuid;
      _companyId = d.companyId;
      _projectLabel = d.projectLabel;
      _c = d.daily;
      _issues.text = _c.issues;
      _notes.text = _c.notes;
      _reason.text = d.reason ?? '';
    } else {
      _uuid = ref
          .read(fieldServiceProvider)
          .newDraft(FieldReportType.dailyReport, projectId: 0, reportDate: _date)
          .clientUuid;
    }
  }

  @override
  void dispose() {
    _autosave?.dispose();
    for (final c in [_issues, _notes, _reason]) {
      c.dispose();
    }
    super.dispose();
  }

  FieldDraft _current() => FieldDraft(
    clientUuid: _uuid,
    type: FieldReportType.dailyReport,
    companyId: _companyId ?? _base?.companyId,
    projectId: _projectId ?? 0,
    projectLabel: _projectLabel,
    reportDate: _date,
    content: _c.copyWith(issues: _issues.text, notes: _notes.text),
    serverPhotoCount: _base?.serverPhotoCount ?? 0,
    reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
    serverId: _base?.serverId,
    serverRev: _base?.serverRev,
    docNo: _base?.docNo,
    editableUntil: _base?.editableUntil,
    syncState: _base?.syncState ?? FieldSyncState.local,
  );

  void _set(DailyContent c, [String? clearError]) {
    setState(() {
      _c = c;
      if (clearError != null) _errors = {..._errors}..remove(clearError);
    });
    _schedule();
  }

  void _schedule() {
    if (_projectId == null) return;
    _autosave?.schedule(_current());
  }

  Future<void> _addPhoto() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final raw = await ref.read(fieldPhotoCaptureProvider)(context, t.dailyPhoto);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final uuid = await ref.read(fieldServiceProvider).addPhoto(sub, raw);
      if (!mounted) return;
      _set(_c.copyWith(photos: [..._c.photos, uuid]), 'photos');
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

  Future<void> _submit(Map<int, RapItem> items) async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final d = _current();
    final errors = validateDaily(d, today: ref.read(fieldTodayProvider), items: items);
    setState(() => _errors = errors);
    if (errors.isNotEmpty) {
      showSnack(context, t.fieldFixErrors);
      return;
    }
    final label = _isEdit ? t.fieldSaveEdit : t.dailySubmit;
    if (!await confirmFieldSubmit(context, label, project: _projectLabel, date: _date) || !mounted) return;
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
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    if (!await confirmDiscard(context)) return;
    _autosave?.cancel();
    await ref.read(fieldServiceProvider).discard(sub, _uuid);
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final profile = ref.watch(currentProfileProvider);
    final refresh = ref.watch(fieldCacheRefreshProvider);
    final online = ref.watch(connectivityProvider);
    final projectsAsync = ref.watch(fieldProjectsProvider);
    final projects = [
      for (final p in projectsAsync.value ?? const <FieldProject>[])
        if (p.kind == ProjectKind.konstruksi && canCreateField(profile, FieldReportType.dailyReport, p.companyId)) p,
    ];
    if (_projectId == null && projects.length == 1 && !_single) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _projectId == null) {
          setState(() {
            _projectId = projects.single.id;
            _companyId = projects.single.companyId;
            _projectLabel = projects.single.label;
          });
        }
      });
    }
    final project = projects.where((p) => p.id == _projectId).firstOrNull;
    if (project != null && _projectLabel.isEmpty) {
      _projectLabel = project.label;
      _companyId ??= project.companyId;
    }
    final rap = _projectId == null
        ? const <RapItem>[]
        : (ref.watch(fieldRapItemsProvider(_projectId!)).value ?? const <RapItem>[]);
    final itemsById = {for (final i in rap) i.id: i};
    final work = [
      for (final i in rap)
        if (i.isWork) i,
    ];
    final material = [
      for (final i in rap)
        if (!i.isWork) i,
    ];
    final stages = <String>[
      for (final i in work)
        if (!work.takeWhile((x) => x != i).any((x) => x.stageName == i.stageName)) i.stageName,
    ];
    final company = _companyId ?? project?.companyId;
    final resources = company == null
        ? const <ResourceType>[]
        : (ref.watch(fieldResourceTypesProvider(company)).value ?? const <ResourceType>[]);
    final tenaga = [
      for (final r in resources)
        if (r.isManpower) r,
    ];
    final alat = [
      for (final r in resources)
        if (!r.isManpower) r,
    ];
    final over = {for (final i in overRapItems(_c, itemsById)) i.id};
    final drafts = ref.watch(openFieldDraftsProvider).value ?? const <FieldDraft>[];
    final sameDay = [
      for (final d in drafts)
        if (d.type == FieldReportType.dailyReport &&
            d.projectId == _projectId &&
            d.reportDate == _date &&
            d.clientUuid != _uuid &&
            !d.isEdit)
          d,
    ].firstOrNull;
    final remaining = FieldReportType.dailyReport.maxPhotos - (_base?.serverPhotoCount ?? 0) - _c.photos.length;
    final dates = allowedReportDates(ref.watch(fieldTodayProvider));
    final weatherOptions = Weather.values;

    Widget weatherRow(String label, String key, Weather? value, void Function(Weather?) onPick) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          SizedBox(width: 56, child: Text(label, style: theme.textTheme.labelLarge)),
          Expanded(
            child: ChoiceGrid<Weather>(
              keyPrefix: 'daily-weather-$key',
              columns: 3,
              options: weatherOptions,
              selected: value,
              code: (w) => w.code,
              label: (w) => w.label,
              onSelected: _busy ? null : (w) => onPick(w == value ? null : w),
            ),
          ),
        ],
      ),
    );

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? t.dailyEditTitle : t.dailyTitle),
        actions: [
          if (_autosave != null) DraftSavedPill(saved: _autosave!.saved),
          if (_base != null && !_isEdit)
            IconButton(
              key: const Key('field-discard'),
              tooltip: t.delete,
              icon: const Icon(Icons.delete_outline),
              onPressed: _busy ? null : _discard,
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(fieldCacheRefreshProvider),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
          children: [
            if (refresh.isLoading) const LinearProgressIndicator(),
            if (!online) FieldNote(text: t.fieldOfflineCache, warn: true),
            if (_base?.lastError != null) FieldNote(text: _base!.lastError!, error: true),
            if (_isEdit && _base?.editableUntil != null)
              FieldNote(
                text: t.fieldEditWindow(formatEditableUntil(_base!.editableUntil, profile?.timezone)),
                warn: true,
              ),
            if (projects.isEmpty && projectsAsync.hasValue && !_single) FieldNote(text: t.dailyNoProjects, warn: true),
            if (projects.length > 1 && !_single)
              AsyncBody<List<FieldProject>>(
                value: projectsAsync,
                data: (_) => DropdownButtonFormField<int>(
                  hint: Text(pickHintFor(t, t.fieldProject)),
                  key: const Key('daily-project'),
                  initialValue: projects.any((p) => p.id == _projectId) ? _projectId : null,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: t.fieldProject, errorText: _errors['project']),
                  items: [
                    for (final p in projects)
                      DropdownMenuItem(
                        value: p.id,
                        child: Text(p.label, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: _busy
                      ? null
                      : (v) {
                          final p = projects.firstWhere((p) => p.id == v);
                          _projectId = v;
                          _companyId = p.companyId;
                          _projectLabel = p.label;
                          // volumes / materials belong to the RAP of the previous project
                          _set(_c.copyWith(work: const {}, materials: const {}), 'project');
                        },
                ),
              ),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      [_projectLabel, fieldDateLabel(_date)].where((e) => e.isNotEmpty).join(' · '),
                      key: const Key('daily-header'),
                      style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ),
                  if (!_isEdit)
                    SizedBox(
                      width: 170,
                      child: FieldDateField(
                        key: const Key('daily-date'),
                        value: _date,
                        dates: dates,
                        label: t.fieldDate,
                        errorText: _errors['date'],
                        onChanged: _busy
                            ? null
                            : (v) {
                                setState(() => _date = v);
                                _schedule();
                              },
                      ),
                    ),
                ],
              ),
            ),
            if (sameDay != null)
              Card(
                key: const Key('daily-same-day'),
                color: theme.colorScheme.surfaceContainerLow,
                child: ListTile(
                  leading: const Icon(Icons.info_outline),
                  title: Text(t.dailySameDay),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.pushReplacement('/field/draft/${sameDay.clientUuid}'),
                ),
              ),
            FieldSection(
              title: t.dailyWeather,
              children: [
                weatherRow(
                  t.dailyMorning,
                  'morning',
                  _c.weatherMorning,
                  (w) => _set(_c.copyWith(weatherMorning: w, clearMorning: w == null)),
                ),
                weatherRow(
                  t.dailyNoon,
                  'noon',
                  _c.weatherNoon,
                  (w) => _set(_c.copyWith(weatherNoon: w, clearNoon: w == null)),
                ),
                weatherRow(
                  t.dailyAfternoon,
                  'afternoon',
                  _c.weatherAfternoon,
                  (w) => _set(_c.copyWith(weatherAfternoon: w, clearAfternoon: w == null)),
                ),
                Row(
                  children: [
                    Expanded(
                      child: _DecField(
                        key: const Key('daily-rain'),
                        label: t.dailyRainHours,
                        value: _c.rainHours,
                        error: _errors['rainHours'],
                        enabled: !_busy,
                        onChanged: (v) => _set(_c.copyWith(rainHours: v, clearRain: v == null), 'rainHours'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _DecField(
                        key: const Key('daily-stop'),
                        label: t.dailyStopHours,
                        value: _c.stopHours,
                        error: _errors['stopHours'],
                        enabled: !_busy,
                        onChanged: (v) => _set(_c.copyWith(stopHours: v, clearStop: v == null), 'stopHours'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
            FieldSection(
              title: t.dailyWorkSection,
              highlight: true,
              children: [
                if (_projectId == null)
                  Text(t.dailyPickProject, style: theme.textTheme.bodySmall)
                else if (work.isEmpty)
                  FieldNote(text: t.dailyNoRap, warn: true),
                for (final st in stages) ...[
                  Padding(
                    padding: const EdgeInsets.only(top: 6, bottom: 4),
                    child: Text(st, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary)),
                  ),
                  for (final i in work)
                    if (i.stageName == st)
                      _DecField(
                        key: Key('daily-work-${i.code}'),
                        label: '${i.code} ${i.description}',
                        suffix: i.uom,
                        value: _c.work[i.id],
                        enabled: !_busy,
                        helper: t.dailyRealised(fmtNum(i.realised), fmtNum(i.volume), i.uom),
                        error: over.contains(i.id)
                            ? t.dailyOverRap(
                                fmtNum(i.realised - (_c.baseWork[i.id] ?? 0) + (_c.work[i.id] ?? 0)),
                                fmtNum(i.volume),
                                i.uom,
                              )
                            : null,
                        onChanged: (v) {
                          final m = {..._c.work};
                          if (v == null || (v == 0 && !_c.baseWork.containsKey(i.id))) {
                            m.remove(i.id);
                          } else {
                            m[i.id] = v;
                          }
                          _set(_c.copyWith(work: m), 'work');
                        },
                      ),
                ],
                if (_errors['work'] != null) FieldNote(text: _errors['work']!, error: true),
              ],
            ),
            if (material.isNotEmpty)
              FieldSection(
                title: t.dailyMaterialSection,
                children: [
                  FieldNote(text: t.dailyMaterialHelp),
                  for (final i in material)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${i.code} ${i.description}', style: theme.textTheme.bodyMedium),
                          Text(t.dailyStock(fmtNum(i.stock), i.uom), style: theme.textTheme.bodySmall),
                          Row(
                            children: [
                              Expanded(
                                child: _DecField(
                                  key: Key('daily-mat-in-${i.code}'),
                                  label: t.dailyReceived,
                                  suffix: i.uom,
                                  value: _c.materials[i.id]?.received,
                                  enabled: !_busy,
                                  onChanged: (v) => _set(
                                    _c.copyWith(
                                      materials: {
                                        ..._c.materials,
                                        i.id: DailyMaterial(received: v, used: _c.materials[i.id]?.used),
                                      },
                                    ),
                                    'materials',
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _DecField(
                                  key: Key('daily-mat-used-${i.code}'),
                                  label: t.dailyUsed,
                                  suffix: i.uom,
                                  value: _c.materials[i.id]?.used,
                                  enabled: !_busy,
                                  onChanged: (v) => _set(
                                    _c.copyWith(
                                      materials: {
                                        ..._c.materials,
                                        i.id: DailyMaterial(received: _c.materials[i.id]?.received, used: v),
                                      },
                                    ),
                                    'materials',
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  if (_errors['materials'] != null) FieldNote(text: _errors['materials']!, error: true),
                ],
              ),
            FieldSection(
              title: t.dailyManpower,
              trailing: Text(t.dailyWorkers(_c.workerCount), style: theme.textTheme.labelMedium),
              children: [
                if (tenaga.isEmpty && alat.isEmpty) Text(t.dailyNoResources, style: theme.textTheme.bodySmall),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final r in tenaga)
                      SizedBox(
                        width: 150,
                        child: _IntField(
                          key: Key('daily-men-${r.code}'),
                          label: r.name,
                          value: _c.manpower[r.id],
                          enabled: !_busy,
                          onChanged: (v) {
                            final m = {..._c.manpower};
                            if (v == null || v == 0) {
                              m.remove(r.id);
                            } else {
                              m[r.id] = v;
                            }
                            _set(_c.copyWith(manpower: m), 'manpower');
                          },
                        ),
                      ),
                  ],
                ),
                if (_errors['manpower'] != null) FieldNote(text: _errors['manpower']!, error: true),
                if (alat.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(t.dailyEquipment, style: theme.textTheme.labelLarge),
                  for (final r in alat)
                    Row(
                      children: [
                        Expanded(
                          flex: 3,
                          child: _IntField(
                            key: Key('daily-eq-${r.code}'),
                            label: r.name,
                            value: _c.equipment[r.id]?.count,
                            enabled: !_busy,
                            onChanged: (v) => _set(
                              _c.copyWith(
                                equipment: {
                                  ..._c.equipment,
                                  r.id: DailyEquipment(count: v, hours: _c.equipment[r.id]?.hours),
                                },
                              ),
                              'equipment',
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          flex: 2,
                          child: _DecField(
                            key: Key('daily-eq-hours-${r.code}'),
                            label: t.dailyHours,
                            value: _c.equipment[r.id]?.hours,
                            enabled: !_busy,
                            onChanged: (v) => _set(
                              _c.copyWith(
                                equipment: {
                                  ..._c.equipment,
                                  r.id: DailyEquipment(count: _c.equipment[r.id]?.count, hours: v),
                                },
                              ),
                              'equipment',
                            ),
                          ),
                        ),
                      ],
                    ),
                  if (_errors['equipment'] != null) FieldNote(text: _errors['equipment']!, error: true),
                ],
              ],
            ),
            FieldSection(
              title: t.dailyNotesSection,
              children: [
                TextField(
                  key: const Key('daily-issues'),
                  controller: _issues,
                  minLines: 1,
                  maxLines: 3,
                  maxLength: 2000,
                  decoration: InputDecoration(labelText: t.dailyIssues, errorText: _errors['issues']),
                  onChanged: (_) => _schedule(),
                ),
                TextField(
                  key: const Key('daily-notes'),
                  controller: _notes,
                  minLines: 1,
                  maxLines: 3,
                  maxLength: 2000,
                  decoration: InputDecoration(
                    labelText: over.isEmpty ? t.fieldReportNotes : '${t.fieldReportNotes} *',
                    errorText: _errors['notes'],
                    helperText: over.isEmpty ? null : t.dailyNotesRequired,
                    helperMaxLines: 2,
                  ),
                  onChanged: (_) {
                    setState(() => _errors = {..._errors}..remove('notes'));
                    _schedule();
                  },
                ),
                PhotoGroup(
                  title: t.dailyPhotos(
                    _c.photos.length + (_base?.serverPhotoCount ?? 0),
                    FieldReportType.dailyReport.maxPhotos,
                  ),
                  photos: _c.photos,
                  canAdd: remaining > 0,
                  addKey: const Key('daily-add-photo'),
                  onAdd: _busy ? null : _addPhoto,
                  onRemove: _busy ? null : (p) => _set(_c.copyWith(photos: [..._c.photos]..remove(p)), 'photos'),
                ),
                if (_errors['photos'] != null) FieldNote(text: _errors['photos']!, error: true),
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
                    onChanged: (_) => _schedule(),
                  ),
              ],
            ),
            if (over.isNotEmpty) FieldNote(text: t.dailyOverRapNotify, warn: true),
            const SizedBox(height: 8),
            FilledButton(
              key: const Key('daily-submit'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              onPressed: _busy || _projectId == null ? null : () => _submit(itemsById),
              child: _busy
                  ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(_isEdit ? t.fieldSaveEdit : t.dailySubmit),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                t.dailySummary(_c.workItems, _c.workerCount, _c.photos.length),
                key: const Key('daily-summary'),
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Decimal input (decimal comma, ≤ 2 decimals checked on submit) keeping its own controller.
class _DecField extends StatefulWidget {
  const _DecField({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.suffix,
    this.helper,
    this.error,
    this.enabled = true,
  });
  final String label;
  final double? value;
  final ValueChanged<double?> onChanged;
  final String? suffix;
  final String? helper;
  final String? error;
  final bool enabled;

  @override
  State<_DecField> createState() => _DecFieldState();
}

class _DecFieldState extends State<_DecField> {
  late final _c = TextEditingController(text: decInput(widget.value));

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: TextField(
      controller: _c,
      enabled: widget.enabled,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
      decoration: InputDecoration(
        labelText: widget.label,
        suffixText: widget.suffix,
        helperText: widget.helper,
        errorText: widget.error,
        errorMaxLines: 2,
        isDense: true,
      ),
      onChanged: (s) => widget.onChanged(parseDec(s)),
    ),
  );
}

/// Whole-number input (people / units).
class _IntField extends StatefulWidget {
  const _IntField({super.key, required this.label, required this.value, required this.onChanged, this.enabled = true});
  final String label;
  final int? value;
  final ValueChanged<int?> onChanged;
  final bool enabled;

  @override
  State<_IntField> createState() => _IntFieldState();
}

class _IntFieldState extends State<_IntField> {
  late final _c = TextEditingController(text: widget.value == null || widget.value == 0 ? '' : '${widget.value}');

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: TextField(
      controller: _c,
      enabled: widget.enabled,
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
      decoration: InputDecoration(labelText: widget.label, isDense: true),
      onChanged: (s) => widget.onChanged(int.tryParse(s)),
    ),
  );
}
