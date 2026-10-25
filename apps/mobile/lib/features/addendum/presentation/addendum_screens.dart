import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_keuangan.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../masters/domain/master_item.dart';
import '../../progress/application/progress_providers.dart';
import '../domain/addendum.dart';
import 'addendum_providers.dart';
import 'addendum_widgets.dart';
import '../../../shared/widgets/pick_hint.dart';

/// Inbox section (Direktur / Finance): addenda waiting for the caller. Hidden when empty or unreachable (an
/// older server without E5 answers 404) so the expense inbox below stays usable.
class AddendumInboxSection extends ConsumerWidget {
  const AddendumInboxSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final items = ref.watch(addendumInboxProvider).value ?? const <Addendum>[];
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(
      key: const Key('addendum-inbox'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          t.addendumInboxTitle(items.length),
          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 10),
        for (final a in items) AddendumCard(a: a),
        const SizedBox(height: 12),
      ],
    );
  }
}

/// Addendum RAB list (PM: team projects + own, Direktur/Finance: all). PM creates new ones here.
class AddendumListScreen extends ConsumerWidget {
  const AddendumListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final isPm = ref.watch(currentProfileProvider)?.has(Role.pm) ?? false;
    final list = ref.watch(addendumListProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.addendumTitle)),
      floatingActionButton: isPm
          ? FloatingActionButton.extended(
              key: const Key('addendum-new'),
              onPressed: () => context.push('/addenda/new'),
              icon: const Icon(Icons.add),
              label: Text(t.addendumNew),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(addendumListProvider.future),
        child: AsyncBody<AddendumPage>(
          value: list,
          onRetry: () => ref.invalidate(addendumListProvider),
          data: (page) => ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            children: [
              if (page.items.isEmpty) PkEmptyState(icon: PkIcons.addendum, message: t.addendumEmpty),
              for (final a in page.items) AddendumCard(a: a),
            ],
          ),
        ),
      ),
    );
  }
}

/// `/addenda/:id/edit`: loads the addendum and opens the form in edit mode while the server still allows
/// `edit` (Draft, creator PM); otherwise a notice (e.g. it was submitted from the web meanwhile).
class AddendumEditRoute extends ConsumerStatefulWidget {
  const AddendumEditRoute({super.key, required this.id});
  final int id;

  @override
  ConsumerState<AddendumEditRoute> createState() => _AddendumEditRouteState();
}

class _AddendumEditRouteState extends ConsumerState<AddendumEditRoute> {
  /// First editable snapshot: the form keeps it while saving refreshes the detail (no flash of the notice).
  Addendum? _editable;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final id = widget.id;
    if (_editable case final a?) return AddendumCreateScreen(initial: a);
    final value = ref.watch(addendumDetailProvider(id));
    final a = value.value;
    if (a != null && a.allowedActions.contains(AddendumAction.edit)) {
      _editable = a;
      return AddendumCreateScreen(initial: a);
    }
    return Scaffold(
      appBar: AppBar(title: Text(t.addendumEditTitle)),
      body: AsyncBody<Addendum>(
        value: value,
        onRetry: () => ref.invalidate(addendumDetailProvider(id)),
        data: (_) => Padding(
          padding: const EdgeInsets.all(24),
          child: Text(t.addendumNotEditable, key: const Key('addendum-not-editable')),
        ),
      ),
    );
  }
}

/// US-18: PM creates an addendum for a team project (online only; Draft or "Ajukan" at once).
/// With [initial] (a Draft whose `allowedActions` contain `edit`) the same form edits it:
/// `PATCH /budget-addenda/{id}` (nominal + alasan; the project stays fixed), optionally followed by "Ajukan".
class AddendumCreateScreen extends ConsumerStatefulWidget {
  const AddendumCreateScreen({super.key, this.initial});
  final Addendum? initial;

  @override
  ConsumerState<AddendumCreateScreen> createState() => _AddendumCreateScreenState();
}

class _AddendumCreateScreenState extends ConsumerState<AddendumCreateScreen> {
  late final _amount = TextEditingController(
    text: widget.initial == null ? '' : formatRupiah(widget.initial!.addition).replaceFirst('Rp ', ''),
  );
  late final _reason = TextEditingController(text: widget.initial?.reason ?? '');
  final _key = const Uuid().v7();
  late int? _projectId = widget.initial?.projectId;
  Map<String, String> _errors = const {};
  bool _busy = false;
  String? _error;

  /// Edit: one Idempotency-Key per PATCH body (the server answers 422 to a reused key with another body).
  final Map<String, String> _patchKeys = {};
  final _submitKey = const Uuid().v7();

  bool get _editing => widget.initial != null;

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _save({required bool submit}) async {
    final t = AppLocalizations.of(context);
    final addition = parseRupiah(_amount.text);
    final errors = validateAddendum(projectId: _projectId, addition: addition, reason: _reason.text);
    setState(() {
      _errors = errors;
      _error = null;
    });
    if (errors.isNotEmpty) return;
    final label = _label(t, submit: submit);
    final amountRab = addition!;
    final summary = [widget.initial?.docNo, formatRupiah(amountRab), _reason.text.trim()];
    if (!await confirmAction(context, action: label, summary: summary) || !mounted) return;
    if (_editing) return _saveEdit(addition: amountRab, submit: submit);
    setState(() => _busy = true);
    try {
      final a = await ref
          .read(addendumApiProvider)
          .create(
            projectId: _projectId!,
            addition: amountRab,
            reason: _reason.text,
            submit: submit,
            idempotencyKey: _key,
          );
      ref.invalidate(addendumListProvider);
      if (!mounted) return;
      await showActionResult(context, message: submit ? t.addendumSubmitted : t.addendumSavedDraft, action: label);
      if (!mounted) return;
      final router = GoRouter.maybeOf(context);
      if (router != null) {
        unawaited(router.pushReplacement('/addenda/${a.id}'));
      } else {
        await Navigator.of(context).maybePop();
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
      await showActionError(context, e, action: label);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _label(AppLocalizations t, {required bool submit}) {
    if (submit) return _editing ? t.addendumSaveAndSubmit : t.addendumSubmit;
    return _editing ? t.addendumSaveChanges : t.addendumSaveDraft;
  }

  Future<void> _saveEdit({required int addition, required bool submit}) async {
    final t = AppLocalizations.of(context);
    final a = widget.initial!;
    final api = ref.read(addendumApiProvider);
    final reason = _reason.text.trim();
    setState(() => _busy = true);
    try {
      final key = _patchKeys.putIfAbsent('$addition|$reason', () => const Uuid().v7());
      await api.update(a.id, addition: addition, reason: reason, idempotencyKey: key);
      if (submit) await api.submit(a.id, idempotencyKey: _submitKey);
      ref.invalidate(addendumDetailProvider(a.id));
      ref.invalidate(addendumListProvider);
      if (!mounted) return;
      final label = _label(t, submit: submit);
      await showActionResult(context, message: submit ? t.addendumSubmitted : t.addendumEdited, action: label);
      if (!mounted) return;
      final router = GoRouter.maybeOf(context);
      if (router != null && router.canPop()) {
        router.pop();
      } else {
        await Navigator.of(context).maybePop();
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
      await showActionError(context, e, action: _label(t, submit: submit));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final initial = widget.initial;
    final projects = ref.watch(progressProjectsProvider);
    // Edit: "Ajukan" only when the server also allows submit on this Draft.
    final canSubmit = initial == null || initial.allowedActions.contains(AddendumAction.submit);
    return Scaffold(
      appBar: AppBar(title: Text(initial == null ? t.addendumNewTitle : t.addendumEditTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // D2510: the fields in one card.
          PkCard(
            radius: PkRadius.lg,
            margin: const EdgeInsets.only(bottom: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (initial != null)
                  InputDecorator(
                    key: const Key('addendum-project-fixed'),
                    decoration: InputDecoration(labelText: t.progressProject, prefixIcon: const Icon(Icons.apartment)),
                    child: Text(initial.projectLabel.isEmpty ? '#${initial.projectId}' : initial.projectLabel),
                  )
                else
                  AsyncBody<List<MasterItem>>(
                    value: projects,
                    data: (list) => DropdownButtonFormField<int>(
                      hint: Text(pickHintFor(t, t.progressProject)),
                      key: const Key('addendum-project'),
                      initialValue: _projectId,
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: t.progressProject,
                        prefixIcon: const Icon(Icons.apartment),
                        errorText: _errors['project'],
                      ),
                      items: [
                        for (final p in list)
                          DropdownMenuItem(
                            value: p.id,
                            child: Text(p.label, overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: _busy ? null : (v) => setState(() => _projectId = v),
                    ),
                  ),
                const SizedBox(height: 16),
                TextField(
                  key: const Key('addendum-amount'),
                  controller: _amount,
                  keyboardType: TextInputType.number,
                  inputFormatters: const [RupiahInputFormatter()],
                  decoration: InputDecoration(
                    labelText: t.addendumAddition,
                    prefixText: 'Rp ',
                    errorText: _errors['addition'],
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  key: const Key('addendum-reason'),
                  controller: _reason,
                  minLines: 2,
                  maxLines: 5,
                  maxLength: 1000,
                  decoration: InputDecoration(labelText: t.addendumReason, errorText: _errors['reason']),
                ),
              ],
            ),
          ),
          if (_error != null)
            PkNoticeCard(tone: PkTone.bad, dense: true, icon: Icons.error_outline, title: Text(_error!)),
          if (canSubmit) ...[
            OnlineOnlyButton(
              key: const Key('addendum-submit'),
              label: initial == null ? t.addendumSubmit : t.addendumSaveAndSubmit,
              icon: Icons.send,
              onPressed: _busy ? null : () => _save(submit: true),
            ),
            const SizedBox(height: 12),
          ],
          OnlineOnlyButton(
            key: const Key('addendum-draft'),
            label: initial == null ? t.addendumSaveDraft : t.addendumSaveChanges,
            icon: Icons.save_outlined,
            outlined: true,
            onPressed: _busy ? null : () => _save(submit: false),
          ),
        ],
      ),
    );
  }
}

/// Detail with RAB impact, timeline and the actions the server allows (online only).
class AddendumDetailScreen extends ConsumerStatefulWidget {
  const AddendumDetailScreen({super.key, required this.id});
  final int id;

  @override
  ConsumerState<AddendumDetailScreen> createState() => _AddendumDetailScreenState();
}

class _AddendumDetailScreenState extends ConsumerState<AddendumDetailScreen> {
  bool _busy = false;

  /// One idempotency key per action while this screen is open (a retry is not applied twice).
  final Map<AddendumAction, String> _keys = {};

  Future<void> _run(AddendumAction action) async {
    final t = AppLocalizations.of(context);
    if (action == AddendumAction.edit) {
      await GoRouter.maybeOf(context)?.push('/addenda/${widget.id}/edit');
      ref.invalidate(addendumDetailProvider(widget.id));
      return;
    }
    String? reason;
    final label = switch (action) {
      AddendumAction.acknowledge => t.addendumAcknowledge,
      AddendumAction.approve => t.addendumApprove,
      AddendumAction.reject => t.addendumReject,
      AddendumAction.cancel => t.addendumCancel,
      _ => t.addendumSubmit,
    };
    final a = ref.read(addendumDetailProvider(widget.id)).value;
    final summary = [a?.docNo, a?.projectLabel, a == null ? null : formatRupiah(a.addition)];
    if (action == AddendumAction.reject || action == AddendumAction.cancel) {
      reason = await showDialog<String>(
        context: context,
        builder: (_) =>
            _ReasonDialog(title: t.confirmActionTitle(actionPhrase(label)), summary: summary, confirm: label),
      );
      if (reason == null) return;
    } else {
      final ok = await confirmAction(
        context,
        action: label,
        summary: summary,
        note: action == AddendumAction.submit ? null : t.addendumConfirmBody,
        confirmKey: const Key('addendum-confirm'),
      );
      if (!ok) return;
    }
    final key = _keys.putIfAbsent(action, () => const Uuid().v7());
    final api = ref.read(addendumApiProvider);
    setState(() => _busy = true);
    try {
      await switch (action) {
        AddendumAction.acknowledge => api.acknowledge(widget.id, idempotencyKey: key),
        AddendumAction.approve => api.approve(widget.id, idempotencyKey: key),
        AddendumAction.reject => api.reject(widget.id, reason: reason!, idempotencyKey: key),
        AddendumAction.cancel => api.cancel(widget.id, reason: reason!, idempotencyKey: key),
        AddendumAction.submit => api.submit(widget.id, idempotencyKey: key),
        AddendumAction.edit => throw StateError('edit opens the form'),
      };
      ref.invalidate(addendumDetailProvider(widget.id));
      ref.invalidate(addendumInboxProvider);
      ref.invalidate(addendumListProvider);
      ref.invalidate(inboxProvider);
      final done = '${a?.docNo ?? ''} ${t.addendumDone}'.trim();
      if (mounted) await showActionResult(context, message: done, action: label);
    } on ApiException catch (e) {
      if (mounted) await showActionError(context, e, action: label);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final zone = ref.watch(currentProfileProvider)?.timezone;
    final value = ref.watch(addendumDetailProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: Text(value.value?.docNo ?? t.addendumTitle)),
      body: AsyncBody<Addendum>(
        value: value,
        onRetry: () => ref.invalidate(addendumDetailProvider(widget.id)),
        data: (a) {
          final theme = Theme.of(context);
          final acts = a.allowedActions;
          String decisionLabel(AddendumDecision d) => switch (d.decision) {
            'acknowledged' => t.addendumDecAck,
            'approved' => t.addendumDecApproved,
            _ => t.addendumDecRejected,
          };
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // D2510: header card (addendum chip, project, status pill, waiting step) with the RAB impact.
              PkCard(
                radius: PkRadius.lg,
                margin: const EdgeInsets.only(bottom: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const PkIconChip(icon: PkIcons.addendum, size: 44),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                a.projectLabel,
                                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(height: 6),
                              AddendumStatusChip(a: a),
                            ],
                          ),
                        ),
                      ],
                    ),
                    Divider(height: 24, color: context.pk.border),
                    AddendumImpact(a: a),
                  ],
                ),
              ),
              if (a.stepLabel != null && a.status.isOpen)
                PkNoticeCard(icon: Icons.hourglass_top, dense: true, title: Text(t.addendumWaiting(a.stepLabel!))),
              PkSectionCard(
                title: t.addendumReason,
                icon: Icons.notes,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(a.reason),
                    if (a.rejectReason != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          t.addendumRejectedBecause(a.rejectReason!),
                          style: TextStyle(color: context.pk.badText),
                        ),
                      ),
                    if (a.cancelReason != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(t.addendumCancelledBecause(a.cancelReason!)),
                      ),
                    const SizedBox(height: 8),
                    Text(
                      [
                        if (a.createdByName != null) t.addendumBy(a.createdByName!),
                        if (a.submittedAt != null)
                          t.addendumSubmittedAt(formatServerDateTime(a.submittedAt, zone: zone)),
                      ].join(' · '),
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
              if (a.decisions.isNotEmpty)
                PkSectionCard(
                  title: t.addendumTimeline,
                  icon: Icons.timeline,
                  child: Column(
                    children: [
                      for (final d in a.decisions)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: PkIconChip(
                            icon: d.decision == 'rejected' ? Icons.cancel : Icons.check_circle,
                            tone: d.decision == 'rejected' ? PkTone.bad : PkTone.ok,
                            round: true,
                            size: 34,
                          ),
                          title: Text(
                            '${decisionLabel(d)} · ${d.actorName ?? '-'}',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text(
                            [
                              formatServerDateTime(d.decidedAt, zone: zone),
                              if ((d.reason ?? '').isNotEmpty) d.reason!,
                            ].join('\n'),
                          ),
                        ),
                    ],
                  ),
                ),
              const SizedBox(height: 4),
              if (acts.contains(AddendumAction.acknowledge))
                _action(AddendumAction.acknowledge, t.addendumAcknowledge, Icons.verified),
              if (acts.contains(AddendumAction.approve))
                _action(AddendumAction.approve, t.addendumApprove, Icons.task_alt),
              if (acts.contains(AddendumAction.submit)) _action(AddendumAction.submit, t.addendumSubmit, Icons.send),
              if (acts.contains(AddendumAction.edit))
                _action(AddendumAction.edit, t.addendumEdit, Icons.edit_outlined, outlined: true),
              if (acts.contains(AddendumAction.reject))
                _action(AddendumAction.reject, t.addendumReject, Icons.cancel, danger: true),
              if (acts.contains(AddendumAction.cancel))
                _action(AddendumAction.cancel, t.addendumCancel, Icons.block, outlined: true),
            ],
          );
        },
      ),
    );
  }

  Widget _action(AddendumAction a, String label, IconData icon, {bool danger = false, bool outlined = false}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: OnlineOnlyButton(
          key: Key('addendum-action-${a.name}'),
          label: label,
          icon: icon,
          danger: danger,
          outlined: outlined,
          onPressed: _busy ? null : () => _run(a),
        ),
      );
}

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({required this.title, required this.summary, required this.confirm});
  final String title;
  final List<String?> summary;
  final String confirm;
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
    final scheme = Theme.of(context).colorScheme;
    final style = isDestructiveAction(widget.confirm)
        ? FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError)
        : null;
    final lines = [
      for (final s in widget.summary)
        if (s != null && s.isNotEmpty) s,
    ];
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final l in lines) Text(l, style: const TextStyle(fontWeight: FontWeight.w600)),
            if (lines.isNotEmpty) const SizedBox(height: 8),
            TextField(
              key: const Key('addendum-reason-field'),
              controller: _c,
              autofocus: true,
              maxLength: 1000,
              decoration: InputDecoration(labelText: t.addendumReason, errorText: _error),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: const Key('addendum-reason-ok'),
          style: style,
          onPressed: () {
            final v = _c.text.trim();
            if (v.length < 3) {
              setState(() => _error = t.reasonTooShort);
              return;
            }
            Navigator.pop(context, v);
          },
          child: Text(t.confirmActionYes(actionPhrase(widget.confirm))),
        ),
      ],
    );
  }
}
