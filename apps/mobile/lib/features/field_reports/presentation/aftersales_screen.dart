import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/rupiah.dart';
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

/// Aktivitas Aftersales (mockup "Android-Aftersales", ADR 0020 §5, plan A2): quick daily log per customer —
/// customer, kind (penawaran / PO masuk / pengiriman / penagihan / kunjungan / lainnya), the open PO of that
/// customer for a delivery / invoice (its items copied), document no., items, "PO ini sudah terkirim semua",
/// receiver, optional value (Rp; afterwards readable only by the reporter and Direktur/Finance/Admin), follow-up
/// date of a quotation, ≤ 5 proof photos; below: today's activities and "Perlu ditindaklanjuti".
class AftersalesScreen extends ConsumerStatefulWidget {
  const AftersalesScreen({super.key, this.initial, this.projectId});
  final FieldDraft? initial;
  final int? projectId;

  @override
  ConsumerState<AftersalesScreen> createState() => _AftersalesScreenState();
}

class _AftersalesScreenState extends ConsumerState<AftersalesScreen> {
  final _docNo = TextEditingController();
  final _receiver = TextEditingController();
  final _value = TextEditingController();
  final _notes = TextEditingController();
  final _reason = TextEditingController();

  late String _uuid;
  FieldDraft? _base;
  int? _projectId;
  int? _companyId;
  String _projectLabel = '';
  late String _date;
  int? _clientId;
  String _clientName = '';
  ActivityKind? _kind;
  int? _poId;
  String _poLabel = '';
  List<PartLine> _items = const [];
  bool _poDelivered = false;
  String? _followUp;
  List<String> _photos = const [];
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
      final c = d.activity;
      _clientId = c.clientId;
      _clientName = c.clientName;
      _kind = c.kind;
      _poId = c.relatesTo;
      _poLabel = c.relatesToLabel;
      _items = c.items;
      _poDelivered = c.poDelivered;
      _followUp = c.followUpDate;
      _photos = c.photos;
      _docNo.text = c.docNo;
      _receiver.text = c.receiver;
      _value.text = c.value == null ? '' : formatRupiah(c.value!).replaceFirst('Rp ', '');
      _notes.text = c.notes;
      _reason.text = d.reason ?? '';
    } else {
      _uuid = _newUuid();
    }
  }

  String _newUuid() => ref
      .read(fieldServiceProvider)
      .newDraft(FieldReportType.aftersalesActivity, projectId: 0, reportDate: _date)
      .clientUuid;

  @override
  void dispose() {
    _autosave?.dispose();
    for (final c in [_docNo, _receiver, _value, _notes, _reason]) {
      c.dispose();
    }
    super.dispose();
  }

  int? _parseValue() => parseRupiah(_value.text);

  FieldDraft _current() => FieldDraft(
    clientUuid: _uuid,
    type: FieldReportType.aftersalesActivity,
    companyId: _companyId ?? _base?.companyId,
    projectId: _projectId ?? 0,
    projectLabel: _projectLabel,
    reportDate: _date,
    content: ActivityContent(
      clientId: _clientId,
      clientName: _clientName,
      kind: _kind,
      docNo: _docNo.text,
      items: _items,
      value: _parseValue(),
      relatesTo: _kind?.refersToPo == true ? _poId : null,
      relatesToLabel: _kind?.refersToPo == true ? _poLabel : '',
      poDelivered: _kind == ActivityKind.pengiriman && _poDelivered,
      followUpDate: _kind == ActivityKind.penawaran ? _followUp : null,
      receiver: _receiver.text,
      notes: _notes.text,
      photos: _photos,
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
    if (_projectId == null || (_clientId == null && _kind == null)) return;
    _autosave?.schedule(_current());
  }

  void _selectPo(FieldOpenPo? po) {
    _poId = po?.id;
    _poLabel = po?.docNo ?? (po == null ? '' : 'PO #${po.id}');
    if (po != null) {
      _items = [for (final i in po.items) PartLine(name: i.name, partNo: i.partNo, qty: i.qty, uom: i.uom)];
    }
    _changed('relatesTo');
  }

  Future<void> _pickFollowUp() async {
    final base = DateTime.tryParse(_date) ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_followUp ?? '') ?? base.add(const Duration(days: 3)),
      firstDate: base,
      lastDate: base.add(const Duration(days: 180)),
    );
    if (picked == null || !mounted) return;
    _followUp =
        '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    _changed('followUpDate');
  }

  Future<void> _addPhoto() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final raw = await ref.read(fieldPhotoCaptureProvider)(context, t.fieldProofPhoto);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final uuid = await ref.read(fieldServiceProvider).addPhoto(sub, raw);
      if (!mounted) return;
      _photos = [..._photos, uuid];
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

  Future<void> _submit() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final d = _current();
    final errors = validateActivity(d, today: ref.read(fieldTodayProvider));
    setState(() => _errors = errors);
    if (errors.isNotEmpty) {
      showSnack(context, t.fieldFixErrors);
      return;
    }
    final label = _isEdit ? t.fieldSaveEdit : t.fieldActivitySubmit;
    if (!await confirmFieldSubmit(context, label, project: _projectLabel, date: _date) || !mounted) return;
    final online = ref.read(connectivityProvider);
    setState(() => _busy = true);
    _autosave?.cancel();
    try {
      await ref.read(fieldServiceProvider).submit(sub, d, online: online);
      ref.read(syncCoordinatorProvider.notifier).requestSync(delay: Duration.zero);
      if (!mounted) return;
      await showFieldSubmitted(context, label, online: online);
      if (!mounted) return;
      if (_single) {
        Navigator.of(context).maybePop();
        return;
      }
      // Quick input: the next activity starts empty (same project, date and customer).
      setState(() {
        _uuid = _newUuid();
        _base = null;
        _kind = null;
        _poId = null;
        _poLabel = '';
        _items = const [];
        _poDelivered = false;
        _followUp = null;
        _photos = const [];
        _errors = const {};
        for (final c in [_docNo, _receiver, _value, _notes, _reason]) {
          c.clear();
        }
      });
      _autosave?.saved.value = false;
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

  String _docLabel(AppLocalizations t) => switch (_kind) {
    ActivityKind.penawaran => t.fieldDocQuote,
    ActivityKind.poMasuk => t.fieldDocPo,
    ActivityKind.pengiriman => t.fieldDocDelivery,
    ActivityKind.penagihan => t.fieldDocInvoice,
    _ => t.fieldDocOther,
  };

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final profile = ref.watch(currentProfileProvider);
    ref.watch(fieldCacheRefreshProvider);
    final projectsAsync = ref.watch(fieldProjectsProvider);
    final projects = [
      for (final p in projectsAsync.value ?? const <FieldProject>[])
        if (p.kind == ProjectKind.aftersales &&
            canCreateField(profile, FieldReportType.aftersalesActivity, p.companyId))
          p,
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
    final clients = ref.watch(fieldClientsProvider(_companyId ?? project?.companyId)).value ?? const <FieldClient>[];
    final clientOptions = [
      ...clients,
      if (_clientId != null && !clients.any((c) => c.id == _clientId))
        FieldClient(
          id: _clientId!,
          companyId: _companyId ?? 0,
          name: _clientName.isEmpty ? '#$_clientId' : _clientName,
        ),
    ];
    final pos = _projectId == null
        ? const <FieldOpenPo>[]
        : (ref.watch(fieldOpenPosProvider((_projectId!, _clientId))).value ?? const <FieldOpenPo>[]);
    final allPos = _projectId == null
        ? const <FieldOpenPo>[]
        : (ref.watch(fieldOpenPosProvider((_projectId!, null))).value ?? const <FieldOpenPo>[]);
    final day = _projectId == null ? null : ref.watch(aftersalesDayProvider((_projectId!, _date)));
    final drafts = ref.watch(openFieldDraftsProvider).value ?? const <FieldDraft>[];
    final localToday = [
      for (final d in drafts)
        if (d.type == FieldReportType.aftersalesActivity &&
            d.projectId == _projectId &&
            d.reportDate == _date &&
            d.clientUuid != _uuid)
          d,
    ];
    final serverToday = day?.value?.today ?? const <FieldRecord>[];
    final remaining = FieldReportType.aftersalesActivity.maxPhotos - (_base?.serverPhotoCount ?? 0) - _photos.length;
    final dates = allowedReportDates(ref.watch(fieldTodayProvider));
    final refersToPo = _kind?.refersToPo == true;

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? t.fieldActivityEditTitle : t.fieldActivityTitle),
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
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          if (_base?.lastError != null) FieldNote(text: _base!.lastError!, error: true),
          if (_isEdit && _base?.editableUntil != null)
            FieldNote(
              text: t.fieldEditWindow(formatEditableUntil(_base!.editableUntil, profile?.timezone)),
              warn: true,
            ),
          if (projects.length > 1 && !_single)
            AsyncBody<List<FieldProject>>(
              value: projectsAsync,
              data: (_) => DropdownButtonFormField<int>(
                hint: Text(pickHintFor(t, t.fieldProject)),
                key: const Key('activity-project'),
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
                    : (v) => setState(() {
                        final p = projects.firstWhere((p) => p.id == v);
                        _projectId = v;
                        _companyId = p.companyId;
                        _projectLabel = p.label;
                        _clientId = null;
                        _clientName = '';
                        _selectPo(null);
                      }),
              ),
            ),
          if (projects.isEmpty && projectsAsync.hasValue && !_single)
            FieldNote(text: t.fieldNoAftersalesProjects, warn: true),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    [_projectLabel, fieldDateLabel(_date)].where((e) => e.isNotEmpty).join(' · '),
                    key: const Key('activity-header'),
                    style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ),
                if (!_single)
                  SizedBox(
                    width: 170,
                    child: FieldDateField(
                      key: const Key('activity-date'),
                      value: _date,
                      dates: dates,
                      label: t.fieldDate,
                      errorText: _errors['date'],
                      onChanged: _busy ? null : (v) => setState(() => _date = v),
                    ),
                  ),
              ],
            ),
          ),
          FieldSection(
            title: _isEdit ? t.fieldActivityEdit : t.fieldActivityNew,
            highlight: true,
            children: [
              DropdownButtonFormField<int>(
                hint: Text(pickHintFor(t, t.fieldCustomer)),
                key: const Key('activity-client'),
                initialValue: clientOptions.any((c) => c.id == _clientId) ? _clientId : null,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: t.fieldCustomer,
                  errorText: _errors['client'],
                  helperText: clientOptions.isEmpty ? t.fieldNoCustomers : null,
                  helperMaxLines: 3,
                ),
                items: [
                  for (final c in clientOptions)
                    DropdownMenuItem(
                      value: c.id,
                      child: Text(c.name, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: _isEdit || _busy
                    ? null
                    : (v) {
                        _clientId = v;
                        _clientName = clientOptions.firstWhere((c) => c.id == v).name;
                        _poId = null;
                        _poLabel = '';
                        _changed('client');
                      },
              ),
              const SizedBox(height: 12),
              Text(t.fieldActivityKind, style: theme.textTheme.labelMedium),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final k in ActivityKind.values)
                    ChoiceChip(
                      key: Key('activity-kind-${k.code}'),
                      label: Text(k.label),
                      selected: _kind == k,
                      onSelected: _isEdit || _busy
                          ? null
                          : (_) {
                              _kind = k;
                              if (!k.refersToPo) {
                                _poId = null;
                                _poLabel = '';
                              }
                              _changed('kind');
                            },
                    ),
                ],
              ),
              if (_errors['kind'] != null) FieldNote(text: _errors['kind']!, error: true),
              const SizedBox(height: 12),
              if (refersToPo) ...[
                DropdownButtonFormField<int>(
                  hint: Text(t.pickPo),
                  key: const Key('activity-po'),
                  initialValue: pos.any((p) => p.id == _poId) ? _poId : null,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: t.fieldForPo,
                    errorText: _errors['relatesTo'],
                    helperText: _clientId != null && pos.isEmpty ? (_poId != null ? _poLabel : t.fieldNoOpenPos) : null,
                  ),
                  items: [
                    for (final p in pos)
                      DropdownMenuItem(
                        value: p.id,
                        child: Text(p.label, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: _isEdit || _busy || _clientId == null
                      ? null
                      : (v) => _selectPo(pos.where((p) => p.id == v).firstOrNull),
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                key: const Key('activity-doc'),
                controller: _docNo,
                maxLength: 64,
                decoration: InputDecoration(labelText: _docLabel(t), errorText: _errors['docNo']),
                onChanged: (_) => _changed('docNo'),
              ),
              PartLinesEditor(
                keyPrefix: 'item',
                lines: _items,
                nameHeader: _kind == ActivityKind.pengiriman ? t.fieldItemsDelivered : t.fieldItems,
                addLabel: t.fieldAddItem,
                enabled: !_busy,
                onChanged: (v) {
                  _items = v;
                  _changed('parts');
                },
              ),
              if (_errors['parts'] != null) FieldNote(text: _errors['parts']!, error: true),
              if (_kind == ActivityKind.pengiriman && !_isEdit)
                CheckboxListTile(
                  key: const Key('activity-po-delivered'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _poDelivered,
                  title: Text(t.fieldPoDelivered),
                  subtitle: Text(t.fieldPoDeliveredHelp),
                  onChanged: _busy
                      ? null
                      : (v) {
                          _poDelivered = v ?? false;
                          _changed();
                        },
                ),
              if (_kind == ActivityKind.penawaran) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  key: const Key('activity-follow-up'),
                  onPressed: _busy ? null : _pickFollowUp,
                  icon: const Icon(Icons.event),
                  label: Text(_followUp == null ? t.fieldFollowUpPick : t.fieldFollowUpOn(fieldDateLabel(_followUp!))),
                ),
                if (_errors['followUpDate'] != null) FieldNote(text: _errors['followUpDate']!, error: true),
                FieldNote(text: t.fieldFollowUpHelp),
              ],
              const SizedBox(height: 8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_kind == ActivityKind.pengiriman) ...[
                    Expanded(
                      child: TextField(
                        key: const Key('activity-receiver'),
                        controller: _receiver,
                        maxLength: 128,
                        decoration: InputDecoration(labelText: t.fieldReceiver, errorText: _errors['receiver']),
                        onChanged: (_) => _changed('receiver'),
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: TextField(
                      key: const Key('activity-value'),
                      controller: _value,
                      keyboardType: TextInputType.number,
                      // d1010 (8c): money (Rp value of the offer / PO) — the same Rupiah input as the other money fields.
                      inputFormatters: const [RupiahInputFormatter()],
                      decoration: InputDecoration(
                        labelText: t.fieldValue,
                        prefixText: 'Rp ',
                        errorText: _errors['value'],
                        helperText: t.fieldValueHelp,
                        helperMaxLines: 3,
                      ),
                      onChanged: (_) => _changed('value'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              PhotoGroup(
                title: t.fieldProofPhotos(
                  _photos.length + (_base?.serverPhotoCount ?? 0),
                  FieldReportType.aftersalesActivity.maxPhotos,
                ),
                photos: _photos,
                canAdd: remaining > 0,
                addKey: const Key('activity-add-photo'),
                onAdd: _busy ? null : _addPhoto,
                onRemove: _busy
                    ? null
                    : (p) {
                        _photos = [..._photos]..remove(p);
                        _changed('photos');
                      },
              ),
              if (_errors['photos'] != null) FieldNote(text: _errors['photos']!, error: true),
              const SizedBox(height: 8),
              TextField(
                key: const Key('activity-notes'),
                controller: _notes,
                minLines: 1,
                maxLines: 3,
                maxLength: 2000,
                decoration: InputDecoration(labelText: t.fieldReportNotes, errorText: _errors['notes']),
                onChanged: (_) => _changed('notes'),
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
              const SizedBox(height: 8),
              FilledButton(
                key: const Key('activity-submit'),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                onPressed: _busy || _projectId == null ? null : _submit,
                child: _busy
                    ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(_isEdit ? t.fieldSaveEdit : t.fieldActivitySubmit),
              ),
            ],
          ),
          if (!_single && _projectId != null) ...[
            FieldSection(
              title: t.fieldToday(localToday.length + serverToday.length),
              children: [
                if (localToday.isEmpty && serverToday.isEmpty)
                  Text(
                    day?.hasValue == true && day!.value == null ? t.fieldTodayOffline : t.fieldTodayEmpty,
                    style: theme.textTheme.bodySmall,
                  ),
                for (final d in localToday)
                  _ActivityRow(
                    key: Key('activity-local-${d.clientUuid}'),
                    tag: d.activity.kind?.tag ?? '?',
                    title: [d.activity.clientName, d.activity.docNo].where((e) => e.trim().isNotEmpty).join(' · '),
                    subtitle: d.activity.filledItems.map((i) => i.summary).join(', '),
                    state: d.syncState,
                    error: d.lastError,
                    onTap: () => context.push(
                      d.conflictCopy != null ? '/field/conflict/${d.clientUuid}' : '/field/draft/${d.clientUuid}',
                    ),
                  ),
                for (final r in serverToday)
                  _ActivityRow(
                    key: Key('activity-server-${r.id}'),
                    tag: r.kind?.tag ?? '?',
                    title: [r.clientName, r.docNo ?? ''].where((e) => e.isNotEmpty).join(' · '),
                    subtitle: [
                      r.parts.map((i) => i.summary).join(', '),
                      if (r.poStatus != null) r.poStatus!.label.toLowerCase(),
                      if (r.followUpDate != null) t.fieldFollowUpShort(fieldDateLabel(r.followUpDate!)),
                      if (r.value != null) formatRupiah(r.value!),
                    ].where((e) => e.isNotEmpty).join(' · '),
                  ),
              ],
            ),
            Card(
              key: const Key('activity-follow-ups'),
              elevation: 0,
              margin: EdgeInsets.zero,
              color: context.pk.warnBg,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(PkRadius.md)),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(color: context.pk.card, borderRadius: BorderRadius.circular(12)),
                      child: Icon(Icons.notifications_active_outlined, color: context.pk.warnOn, size: 20),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            t.fieldNeedsFollowUp,
                            style: theme.textTheme.titleMedium?.copyWith(
                              color: context.pk.warnOn,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            [
                              t.fieldOpenPosCount(allPos.length),
                              if (day?.value != null) t.fieldFollowUpsToday(day!.value!.followUpsDue),
                            ].join(' · '),
                            style: TextStyle(color: context.pk.warnOn),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({
    super.key,
    required this.tag,
    required this.title,
    required this.subtitle,
    this.state,
    this.error,
    this.onTap,
  });
  final String tag;
  final String title;
  final String subtitle;
  final FieldSyncState? state;
  final String? error;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              constraints: const BoxConstraints(minWidth: 36),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              alignment: Alignment.center,
              decoration: BoxDecoration(color: context.pk.infoBg, borderRadius: BorderRadius.circular(PkRadius.sm)),
              child: Text(
                tag,
                style: theme.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700, color: context.pk.infoOn),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title.isEmpty ? '-' : title, style: const TextStyle(fontWeight: FontWeight.w700)),
                  if (subtitle.isNotEmpty) Text(subtitle, style: theme.textTheme.bodySmall),
                  if (error != null)
                    Text(error!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
                ],
              ),
            ),
            if (state != null) ...[const SizedBox(width: 8), FieldStateChip(state: state!)],
          ],
        ),
      ),
    );
  }
}
