import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_lapangan.dart';
import '../../auth/application/auth_controller.dart';
import '../../sync/application/sync_coordinator.dart';
import '../application/progress_providers.dart';
import '../domain/progress.dart';

final _draftProvider = Provider.autoDispose.family<AsyncValue<ProgressDraft?>, String>(
  (ref, uuid) =>
      ref.watch(openProgressDraftsProvider).whenData((l) => l.where((d) => d.clientUuid == uuid).firstOrNull),
);

/// Conflict resolution (ADR 0010: server wins by default). The server version and the phone's version
/// are shown side by side; the user keeps the server version (local copy deleted) or sends the phone's
/// version again as an edit of the current server version (reason required, only within 24 h).
class ProgressConflictScreen extends ConsumerStatefulWidget {
  const ProgressConflictScreen({super.key, required this.uuid});
  final String uuid;

  @override
  ConsumerState<ProgressConflictScreen> createState() => _ProgressConflictScreenState();
}

class _ProgressConflictScreenState extends ConsumerState<ProgressConflictScreen> {
  bool _busy = false;

  Future<void> _useServer() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    if (!await confirmAction(context, action: t.progressUseServer, note: t.progressUsedServer) || !mounted) return;
    setState(() => _busy = true);
    await ref.read(progressServiceProvider).useServerVersion(sub, widget.uuid);
    ref.invalidate(progressReportsProvider);
    if (!mounted) return;
    await showActionResult(context, message: t.progressUsedServer, action: t.progressUseServer);
    if (mounted) Navigator.of(context).maybePop();
  }

  Future<void> _resend() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final reason = await showDialog<String>(context: context, builder: (_) => const _ReasonDialog());
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    final online = ref.read(connectivityProvider);
    final pt = ref.read(openProgressDraftsProvider).value?.where((d) => d.clientUuid == widget.uuid).firstOrNull;
    final queue = ref.read(progressQueueEnabledForProvider(pt?.companyId));
    try {
      await ref
          .read(progressServiceProvider)
          .resendMine(sub, widget.uuid, reason: reason, online: online, queueEnabled: queue);
      ref.read(syncCoordinatorProvider.notifier).requestSync(delay: Duration.zero);
      if (!mounted) return;
      await showActionResult(context, message: t.progressResent, action: t.progressResendAction);
      if (mounted) Navigator.of(context).maybePop();
    } on ApiException catch (e) {
      if (mounted) await showActionError(context, e, action: t.progressResendAction);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(_draftProvider(widget.uuid));
    return Scaffold(
      appBar: AppBar(title: Text(t.progressConflictTitle)),
      body: AsyncBody<ProgressDraft?>(
        value: value,
        data: (d) {
          final c = d?.conflictCopy;
          if (d == null || c == null) return Center(child: Text(t.progressConflictGone));
          final editable = c.editableAt(DateTime.now());
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              PkNotice(text: d.lastError ?? t.progressConflictHint, tone: PkTone.warn, icon: Icons.call_split),
              const SizedBox(height: 6),
              Row(
                children: [
                  const PkIconChip(icon: Icons.apartment, tone: PkTone.primary, size: 40),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          d.projectLabel,
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        if (d.stageLabel.isNotEmpty)
                          Text(
                            d.stageLabel,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _Compare(label: t.progressPctAfterLabel, server: fmtPct(c.pctAfter), mine: fmtPct(d.pctAfter)),
              _Compare(label: t.progressWork, server: c.work, mine: d.work),
              _Compare(
                label: t.progressIssues,
                server: c.issues ?? '-',
                mine: (d.issues ?? '').isEmpty ? '-' : d.issues!,
              ),
              _Compare(
                label: t.progressPhotosLabel,
                server: '${c.photoCount}',
                mine: t.progressNewPhotos(d.photoUuids.length),
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                key: const Key('conflict-use-server'),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                onPressed: _busy ? null : _useServer,
                icon: const Icon(Icons.cloud_done),
                label: Text(t.progressUseServer),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const Key('conflict-resend'),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                onPressed: _busy || !editable ? null : _resend,
                icon: const Icon(Icons.upload),
                label: Text(t.progressResendMine),
              ),
              if (!editable)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    t.progressNotEditableAnymore,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _Compare extends StatelessWidget {
  const _Compare({required this.label, required this.server, required this.mine});
  final String label;
  final String server;
  final String mine;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final differs = server.trim() != mine.trim();
    final pk = context.pk;
    Widget cell(String title, String text, IconData icon) => Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: differs ? pk.warnBg : theme.colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(PkRadius.sm + 2),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 16, color: differs ? pk.warnOn : theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    title,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: differs ? pk.warnOn : theme.colorScheme.onSurfaceVariant,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(text, style: TextStyle(color: differs ? pk.warnOn : null)),
          ],
        ),
      ),
    );
    return PkCard(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$label${differs ? ' · ${t.progressDiffers}' : ''}',
            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                cell(t.progressServerVersion, server, Icons.cloud),
                const SizedBox(width: 8),
                cell(t.progressMyVersion, mine, Icons.phone_android),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog();
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
      title: Text(t.progressReason),
      content: TextField(
        key: const Key('reason-field'),
        controller: _c,
        autofocus: true,
        maxLength: 1000,
        decoration: InputDecoration(helperText: t.progressReasonHelp, errorText: _error),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: const Key('reason-ok'),
          onPressed: () {
            final v = _c.text.trim();
            if (v.length < 3) {
              setState(() => _error = t.reasonTooShort);
              return;
            }
            Navigator.pop(context, v);
          },
          child: Text(t.confirmActionYes(actionPhrase(t.progressResendAction))),
        ),
      ],
    );
  }
}
