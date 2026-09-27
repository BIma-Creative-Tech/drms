import 'package:camera/camera.dart' show CameraLensDirection;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../app/providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/draft_repository.dart';
import '../../expense/presentation/camera_capture_screen.dart';
import '../../masters/domain/master_item.dart';
import '../../sync/application/sync_coordinator.dart';
import '../application/progress_providers.dart';
import '../application/progress_service.dart';
import '../domain/progress.dart';
import 'widgets/progress_widgets.dart';

typedef ProgressPhotoCapture = Future<Uint8List?> Function(BuildContext context);

/// Rear camera, no gallery (ADR 0010 decision 11). Overridden in widget tests.
final progressPhotoCaptureProvider = Provider<ProgressPhotoCapture>(
  (ref) =>
      (context) => Navigator.of(context).push<Uint8List>(
        MaterialPageRoute(
          builder: (_) => CameraCaptureScreen(
            lens: CameraLensDirection.back,
            title: AppLocalizations.of(context).progressPhotoTitle,
          ),
        ),
      ),
);

final _editorSourceProvider = FutureProvider.autoDispose.family<ProgressDraft?, (String, String?, int?)>((
  ref,
  key,
) async {
  final (sub, localUuid, reportId) = key;
  if (localUuid != null) return ref.read(progressRepositoryProvider).load(sub, localUuid);
  final r = await ref.read(progressApiProvider).detail(reportId!);
  return ref.read(progressServiceProvider).startEdit(sub, r);
});

/// Resolves what the editor edits: a new report, a local draft, or an edit of server report [reportId].
class ProgressEditorRoute extends ConsumerWidget {
  const ProgressEditorRoute({super.key, this.localUuid, this.reportId, this.projectId});
  final String? localUuid;
  final int? reportId;
  final int? projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final sub = ref.watch(currentSubProvider);
    if (sub == null) return const SizedBox.shrink();
    if (localUuid == null && reportId == null) return ProgressEditorScreen(projectId: projectId);
    final source = ref.watch(_editorSourceProvider((sub, localUuid, reportId)));
    return Builder(
      builder: (context) {
        if (source.hasError) {
          return Scaffold(
            appBar: AppBar(title: Text(t.progressEditTitle)),
            body: AsyncBody<ProgressDraft?>(
              value: source,
              onRetry: () => ref.invalidate(_editorSourceProvider((sub, localUuid, reportId))),
              data: (_) => const SizedBox(),
            ),
          );
        }
        if (!source.hasValue) return const Scaffold(body: Center(child: CircularProgressIndicator()));
        final d = source.value;
        if (d == null) {
          return Scaffold(
            appBar: AppBar(title: Text(t.progressEditTitle)),
            body: Center(child: Text(t.progressNotFound)),
          );
        }
        return ProgressEditorScreen(initial: d);
      },
    );
  }
}

class ProgressEditorScreen extends ConsumerStatefulWidget {
  const ProgressEditorScreen({super.key, this.initial, this.projectId});
  final ProgressDraft? initial;
  final int? projectId;

  @override
  ConsumerState<ProgressEditorScreen> createState() => _ProgressEditorScreenState();
}

class _ProgressEditorScreenState extends ConsumerState<ProgressEditorScreen> {
  final _work = TextEditingController();
  final _issues = TextEditingController();
  final _reason = TextEditingController();
  final _pctText = TextEditingController();
  int? _projectId;
  String _projectLabel = '';
  int? _stageId;
  String _stageLabel = '';
  double? _pctBefore;
  double _pctAfter = 0;
  List<String> _photos = [];
  Map<String, String> _errors = const {};
  bool _busy = false;
  late final String _uuid;
  ProgressDraft? _base;

  bool get _isEdit => _base?.isEdit ?? false;

  @override
  void initState() {
    super.initState();
    final d = widget.initial;
    _base = d;
    _uuid = d?.clientUuid ?? ref.read(progressServiceProvider).newDraft(projectId: 0, stageId: 0).clientUuid;
    if (d != null) {
      _projectId = d.projectId;
      _projectLabel = d.projectLabel;
      _stageId = d.stageId;
      _stageLabel = d.stageLabel;
      _pctBefore = d.pctBefore;
      _pctAfter = d.pctAfter;
      _work.text = d.work;
      _issues.text = d.issues ?? '';
      _reason.text = d.reason ?? '';
      _photos = [...d.photoUuids];
    } else {
      _projectId = widget.projectId;
    }
    _pctText.text = _fmtInput(_pctAfter);
  }

  @override
  void dispose() {
    _work.dispose();
    _issues.dispose();
    _reason.dispose();
    _pctText.dispose();
    super.dispose();
  }

  static String _fmtInput(double v) => fmtPct(v).replaceAll('%', '');

  ProgressDraft _current() => ProgressDraft(
    clientUuid: _uuid,
    projectId: _projectId ?? 0,
    projectLabel: _projectLabel,
    stageId: _stageId ?? 0,
    stageLabel: _stageLabel,
    pctBefore: _pctBefore,
    pctAfter: _pctAfter,
    work: _work.text,
    issues: _issues.text,
    photoUuids: _photos,
    serverPhotoCount: _base?.serverPhotoCount ?? 0,
    reason: _isEdit ? _reason.text : null,
    serverId: _base?.serverId,
    serverRev: _base?.serverRev,
    serverPctAfter: _base?.serverPctAfter,
    docNo: _base?.docNo,
    editableUntil: _base?.editableUntil,
  );

  void _selectStage(ProjectStage s) {
    setState(() {
      _stageId = s.id;
      _stageLabel = s.name;
      _pctBefore = s.progressPct;
      if (_pctAfter < s.progressPct) _pctAfter = s.progressPct;
      _pctText.text = _fmtInput(_pctAfter);
      _errors = {..._errors}..remove('pctAfter');
    });
  }

  void _setPct(double v, {bool fromText = false}) {
    setState(() {
      _pctAfter = roundPct(v);
      if (!fromText) _pctText.text = _fmtInput(_pctAfter);
      _errors = {..._errors}..remove('pctAfter');
    });
  }

  Future<void> _addPhoto() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final raw = await ref.read(progressPhotoCaptureProvider)(context);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final uuid = await ref.read(progressServiceProvider).addPhoto(sub, raw);
      if (mounted) setState(() => _photos = [..._photos, uuid]);
    } on PhotoTooLargeException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on QueueFullException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on Object {
      if (mounted) showSnack(context, t.progressPhotoFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save(ProjectStageSet? stages) async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final d = _current();
    final errors = validateProgress(d, stages: stages);
    if (_projectId == null) errors['project'] = t.progressPickProject;
    if (_stageId == null) errors['stage'] = t.progressPickStage;
    setState(() => _errors = errors);
    if (errors.isNotEmpty) return;
    final online = ref.read(connectivityProvider);
    final queue = ref.read(progressQueueEnabledProvider);
    setState(() => _busy = true);
    try {
      final outcome = await ref.read(progressServiceProvider).save(sub, d, online: online, queueEnabled: queue);
      if (outcome == ProgressSaveOutcome.queued) {
        ref.read(syncCoordinatorProvider.notifier).requestSync(delay: Duration.zero);
      } else {
        ref.invalidate(progressReportsProvider);
        ref.invalidate(projectProgressProvider);
      }
      if (!mounted) return;
      showSnack(
        context,
        outcome == ProgressSaveOutcome.sent
            ? t.progressSent
            : (online ? t.progressQueuedOnline : t.progressQueuedOffline),
      );
      Navigator.of(context).maybePop();
    } on NetworkException {
      if (mounted) {
        showSnack(context, t.progressKeptLocal);
        Navigator.of(context).maybePop();
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _discard() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t.progressDiscardTitle),
        content: Text(t.progressDiscardBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(t.cancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(t.delete)),
        ],
      ),
    );
    if (ok != true) return;
    await ref.read(progressServiceProvider).discard(sub, _uuid);
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final projects = ref.watch(progressProjectsProvider);
    final queue = ref.watch(progressQueueEnabledProvider);
    final online = ref.watch(connectivityProvider);
    final stagesAsync = _projectId == null ? null : ref.watch(stageSetProvider(_projectId!));
    final stages = stagesAsync?.value;
    final remaining = maxProgressPhotos - (_base?.serverPhotoCount ?? 0) - _photos.length;
    final lockedPlace = _isEdit;
    final canSave = !_busy && (queue || online);

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? t.progressEditTitle : t.progressNewTitle),
        actions: [
          if (widget.initial != null && !_isEdit)
            IconButton(
              key: const Key('progress-discard'),
              tooltip: t.delete,
              icon: const Icon(Icons.delete_outline),
              onPressed: _busy ? null : _discard,
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (!queue) _Info(text: online ? t.progressOnlineOnlyNote : t.progressOnlineOnlyOffline, warn: !online),
          if (_isEdit && _base?.editableUntil != null)
            _Info(
              text: t.progressEditWindow(reportTime(_base!.editableUntil, ref.watch(currentProfileProvider)?.timezone)),
            ),
          // 1. Project
          AsyncBody<List<MasterItem>>(
            value: projects,
            data: (list) => DropdownButtonFormField<int>(
              key: const Key('progress-project'),
              initialValue: list.any((p) => p.id == _projectId) ? _projectId : null,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: t.progressProject,
                prefixIcon: const Icon(Icons.apartment),
                errorText: _errors['project'],
                helperText: list.isEmpty ? t.progressNoProjects : null,
              ),
              items: [
                for (final p in list)
                  DropdownMenuItem(
                    value: p.id,
                    child: Text(p.label, overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: lockedPlace || _busy
                  ? null
                  : (v) => setState(() {
                      _projectId = v;
                      _projectLabel = list.firstWhere((p) => p.id == v).label;
                      _stageId = null;
                      _stageLabel = '';
                      _pctBefore = null;
                      _errors = {..._errors}..remove('project');
                    }),
            ),
          ),
          const SizedBox(height: 16),
          // 2. Stage
          if (_projectId != null)
            AsyncBody<ProjectStageSet>(
              value: stagesAsync!,
              onRetry: () => ref.invalidate(stageSetProvider(_projectId!)),
              data: (set) {
                final active = set.activeStages;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (set.fromCache) _Info(text: t.progressStagesCached),
                    if (!set.fromCache && !set.complete && !_isEdit)
                      _Info(text: t.progressStagesIncomplete(fmtPct(set.weightSum)), warn: true),
                    DropdownButtonFormField<int>(
                      key: const Key('progress-stage'),
                      initialValue: active.any((s) => s.id == _stageId) ? _stageId : null,
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: t.progressStage,
                        prefixIcon: const Icon(Icons.stairs),
                        errorText: _errors['stage'],
                      ),
                      items: [
                        for (final s in active)
                          DropdownMenuItem(
                            value: s.id,
                            child: Text(
                              t.progressStageOption(s.name, fmtPct(s.weightPct), fmtPct(s.progressPct)),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: lockedPlace || _busy ? null : (v) => _selectStage(active.firstWhere((s) => s.id == v)),
                    ),
                  ],
                );
              },
            ),
          const SizedBox(height: 16),
          // 3. Percentage (never below the stage % before this report)
          if (_stageId != null) _pctCard(t),
          const SizedBox(height: 16),
          TextField(
            key: const Key('progress-work'),
            controller: _work,
            minLines: 3,
            maxLines: 6,
            maxLength: 2000,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              labelText: t.progressWork,
              hintText: t.progressWorkHint,
              errorText: _errors['work'],
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('progress-issues'),
            controller: _issues,
            minLines: 2,
            maxLines: 5,
            maxLength: 2000,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              labelText: t.progressIssues,
              errorText: _errors['issues'],
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            t.progressPhotosTitle(_photos.length + (_base?.serverPhotoCount ?? 0), maxProgressPhotos),
            style: Theme.of(context).textTheme.titleSmall,
          ),
          if (_isEdit && (_base?.serverPhotoCount ?? 0) > 0)
            Text(t.progressPhotosOnServer(_base!.serverPhotoCount), style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              for (final p in _photos)
                LocalPhotoThumb(
                  uuid: p,
                  onRemove: _busy ? null : () => setState(() => _photos = [..._photos]..remove(p)),
                ),
              if (remaining > 0)
                SizedBox.square(
                  dimension: 88,
                  child: OutlinedButton(
                    key: const Key('progress-add-photo'),
                    style: OutlinedButton.styleFrom(
                      padding: EdgeInsets.zero,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: _busy ? null : _addPhoto,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.add_a_photo),
                        Text(t.progressAddPhoto, textAlign: TextAlign.center),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          if (_errors['photos'] != null)
            Text(_errors['photos']!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          if (_isEdit) ...[
            const SizedBox(height: 16),
            TextField(
              key: const Key('progress-reason'),
              controller: _reason,
              maxLength: 1000,
              decoration: InputDecoration(
                labelText: t.progressReason,
                helperText: t.progressReasonHelp,
                errorText: _errors['reason'],
              ),
            ),
          ],
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const Key('progress-save'),
            onPressed: canSave ? () => _save(stages) : null,
            icon: _busy
                ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(queue ? Icons.send : Icons.cloud_upload),
            label: Text(queue ? t.progressSaveQueue : (online ? t.progressSendOnline : t.needsInternet)),
          ),
        ],
      ),
    );
  }

  Widget _pctCard(AppLocalizations t) {
    final theme = Theme.of(context);
    final before = _pctBefore ?? 0;
    final delta = _pctAfter - before;
    return Card(
      elevation: 0,
      color: theme.colorScheme.surfaceContainerLow,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t.progressPctTitle(_stageLabel), style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: Text(
                    t.progressPctBefore(_pctBefore == null ? '—' : fmtPct(before)),
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
                SizedBox(
                  width: 120,
                  child: TextField(
                    key: const Key('progress-pct'),
                    controller: _pctText,
                    textAlign: TextAlign.end,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
                    decoration: const InputDecoration(suffixText: '%', isDense: true),
                    onChanged: (s) {
                      final v = double.tryParse(s.replaceAll(',', '.'));
                      if (v != null) _setPct(v, fromText: true);
                    },
                  ),
                ),
              ],
            ),
            Slider(
              key: const Key('progress-slider'),
              value: _pctAfter.clamp(before, 100).toDouble(),
              min: before.clamp(0, 100).toDouble(),
              max: 100,
              divisions: before >= 100 ? null : ((100 - before) * 2).round().clamp(1, 200),
              label: fmtPct(_pctAfter),
              onChanged: before >= 100 || _busy ? null : (v) => _setPct(v),
            ),
            PctBar(label: t.progressPctAfterLabel, value: _pctAfter, color: progressSeriesPhysical),
            const SizedBox(height: 6),
            Text(
              _errors['pctAfter'] ?? t.progressPctDelta('${delta >= 0 ? '+' : '−'}${fmtPct(delta.abs())}'),
              key: const Key('progress-pct-message'),
              style: _errors['pctAfter'] == null
                  ? theme.textTheme.bodySmall
                  : theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
            ),
          ],
        ),
      ),
    );
  }
}

class _Info extends StatelessWidget {
  const _Info({required this.text, this.warn = false});
  final String text;
  final bool warn;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      elevation: 0,
      color: warn ? scheme.errorContainer : scheme.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(warn ? Icons.warning_amber_rounded : Icons.info_outline, size: 20),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
          ],
        ),
      ),
    );
  }
}
