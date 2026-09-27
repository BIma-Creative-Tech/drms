import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
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
    setState(() => _busy = true);
    await ref.read(progressServiceProvider).useServerVersion(sub, widget.uuid);
    ref.invalidate(progressReportsProvider);
    if (!mounted) return;
    showSnack(context, t.progressUsedServer);
    Navigator.of(context).maybePop();
  }

  Future<void> _resend() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final reason = await showDialog<String>(context: context, builder: (_) => const _ReasonDialog());
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    final online = ref.read(connectivityProvider);
    final queue = ref.read(progressQueueEnabledProvider);
    try {
      await ref
          .read(progressServiceProvider)
          .resendMine(sub, widget.uuid, reason: reason, online: online, queueEnabled: queue);
      ref.read(syncCoordinatorProvider.notifier).requestSync(delay: Duration.zero);
      if (!mounted) return;
      showSnack(context, t.progressResent);
      Navigator.of(context).maybePop();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message);
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
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(padding: const EdgeInsets.all(12), child: Text(d.lastError ?? t.progressConflictHint)),
              ),
              const SizedBox(height: 8),
              Text(d.projectLabel, style: Theme.of(context).textTheme.titleMedium),
              if (d.stageLabel.isNotEmpty) Text(d.stageLabel),
              const SizedBox(height: 12),
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
              const SizedBox(height: 16),
              FilledButton.icon(
                key: const Key('conflict-use-server'),
                onPressed: _busy ? null : _useServer,
                icon: const Icon(Icons.cloud_done),
                label: Text(t.progressUseServer),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const Key('conflict-resend'),
                onPressed: _busy || !editable ? null : _resend,
                icon: const Icon(Icons.upload),
                label: Text(t.progressResendMine),
              ),
              if (!editable)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(t.progressNotEditableAnymore, textAlign: TextAlign.center),
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
    Widget cell(String title, String text, IconData icon) => Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
          border: differs ? Border.all(color: theme.colorScheme.outline) : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 16),
                const SizedBox(width: 4),
                Text(title, style: theme.textTheme.labelSmall),
              ],
            ),
            const SizedBox(height: 4),
            Text(text),
          ],
        ),
      ),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$label${differs ? ' · ${t.progressDiffers}' : ''}', style: theme.textTheme.titleSmall),
          const SizedBox(height: 4),
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
          child: Text(t.next),
        ),
      ],
    );
  }
}
