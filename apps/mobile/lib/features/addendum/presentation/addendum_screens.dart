import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../masters/domain/master_item.dart';
import '../../progress/application/progress_providers.dart';
import '../domain/addendum.dart';
import 'addendum_providers.dart';
import 'addendum_widgets.dart';

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
        Text(t.addendumInboxTitle(items.length), style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final a in items) AddendumCard(a: a),
        const Divider(height: 24),
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
              if (page.items.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Text(t.addendumEmpty)),
              for (final a in page.items) AddendumCard(a: a),
            ],
          ),
        ),
      ),
    );
  }
}

/// US-18: PM creates an addendum for a team project (online only; Draft or "Ajukan" at once).
class AddendumCreateScreen extends ConsumerStatefulWidget {
  const AddendumCreateScreen({super.key});

  @override
  ConsumerState<AddendumCreateScreen> createState() => _AddendumCreateScreenState();
}

class _AddendumCreateScreenState extends ConsumerState<AddendumCreateScreen> {
  final _amount = TextEditingController();
  final _reason = TextEditingController();
  final _key = const Uuid().v7();
  int? _projectId;
  Map<String, String> _errors = const {};
  bool _busy = false;
  String? _error;

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
    setState(() => _busy = true);
    try {
      final a = await ref
          .read(addendumApiProvider)
          .create(
            projectId: _projectId!,
            addition: addition!,
            reason: _reason.text,
            submit: submit,
            idempotencyKey: _key,
          );
      ref.invalidate(addendumListProvider);
      if (!mounted) return;
      showSnack(context, submit ? t.addendumSubmitted : t.addendumSavedDraft);
      final router = GoRouter.maybeOf(context);
      if (router != null) {
        unawaited(router.pushReplacement('/addenda/${a.id}'));
      } else {
        await Navigator.of(context).maybePop();
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final projects = ref.watch(progressProjectsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.addendumNewTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          AsyncBody<List<MasterItem>>(
            value: projects,
            data: (list) => DropdownButtonFormField<int>(
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
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          OnlineOnlyButton(
            key: const Key('addendum-submit'),
            label: t.addendumSubmit,
            icon: Icons.send,
            onPressed: _busy ? null : () => _save(submit: true),
          ),
          const SizedBox(height: 12),
          OnlineOnlyButton(
            key: const Key('addendum-draft'),
            label: t.addendumSaveDraft,
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
    String? reason;
    if (action == AddendumAction.reject || action == AddendumAction.cancel) {
      reason = await showDialog<String>(
        context: context,
        builder: (_) => _ReasonDialog(title: action == AddendumAction.reject ? t.addendumReject : t.addendumCancel),
      );
      if (reason == null) return;
    } else if (action != AddendumAction.submit) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(action == AddendumAction.acknowledge ? t.addendumAcknowledge : t.addendumApprove),
          content: Text(t.addendumConfirmBody),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(t.cancel)),
            FilledButton(
              key: const Key('addendum-confirm'),
              onPressed: () => Navigator.pop(ctx, true),
              child: Text(t.yes),
            ),
          ],
        ),
      );
      if (ok != true) return;
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
        AddendumAction.submit || AddendumAction.edit => api.submit(widget.id, idempotencyKey: key),
      };
      ref.invalidate(addendumDetailProvider(widget.id));
      ref.invalidate(addendumInboxProvider);
      ref.invalidate(addendumListProvider);
      ref.invalidate(inboxProvider);
      if (mounted) showSnack(context, t.addendumDone);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message);
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
              Row(
                children: [
                  Expanded(child: Text(a.projectLabel, style: theme.textTheme.titleMedium)),
                  AddendumStatusChip(a: a),
                ],
              ),
              if (a.stepLabel != null && a.status.isOpen) Text(t.addendumWaiting(a.stepLabel!)),
              const SizedBox(height: 12),
              Card(
                elevation: 0,
                color: theme.colorScheme.surfaceContainerLow,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: AddendumImpact(a: a),
                ),
              ),
              const SizedBox(height: 12),
              Text(t.addendumReason, style: theme.textTheme.titleSmall),
              Text(a.reason),
              if (a.rejectReason != null) Text(t.addendumRejectedBecause(a.rejectReason!)),
              if (a.cancelReason != null) Text(t.addendumCancelledBecause(a.cancelReason!)),
              const SizedBox(height: 8),
              Text(
                [
                  if (a.createdByName != null) t.addendumBy(a.createdByName!),
                  if (a.submittedAt != null) t.addendumSubmittedAt(formatServerDateTime(a.submittedAt, zone: zone)),
                ].join(' · '),
                style: theme.textTheme.bodySmall,
              ),
              if (a.decisions.isNotEmpty) ...[
                const Divider(height: 24),
                Text(t.addendumTimeline, style: theme.textTheme.titleSmall),
                for (final d in a.decisions)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(d.decision == 'rejected' ? Icons.cancel : Icons.check_circle),
                    title: Text('${decisionLabel(d)} · ${d.actorName ?? '-'}'),
                    subtitle: Text(
                      [
                        formatServerDateTime(d.decidedAt, zone: zone),
                        if ((d.reason ?? '').isNotEmpty) d.reason!,
                      ].join('\n'),
                    ),
                  ),
              ],
              const SizedBox(height: 16),
              if (acts.contains(AddendumAction.acknowledge))
                _action(AddendumAction.acknowledge, t.addendumAcknowledge, Icons.verified),
              if (acts.contains(AddendumAction.approve))
                _action(AddendumAction.approve, t.addendumApprove, Icons.task_alt),
              if (acts.contains(AddendumAction.submit)) _action(AddendumAction.submit, t.addendumSubmit, Icons.send),
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
  const _ReasonDialog({required this.title});
  final String title;
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
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        key: const Key('addendum-reason-field'),
        controller: _c,
        autofocus: true,
        maxLength: 1000,
        decoration: InputDecoration(labelText: t.addendumReason, errorText: _error),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: const Key('addendum-reason-ok'),
          onPressed: () {
            final v = _c.text.trim();
            if (v.length < 3) {
              setState(() => _error = t.reasonTooShort);
              return;
            }
            Navigator.pop(context, v);
          },
          child: Text(t.next),
        ),
      ],
    );
  }
}
