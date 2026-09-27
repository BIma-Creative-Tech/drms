import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/db/app_database.dart';
import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/draft_repository.dart';
import '../application/sync_coordinator.dart';
import '../application/sync_engine.dart';
import '../domain/sync_models.dart';

final _queueRowsProvider = FutureProvider.autoDispose<(List<OutboxData>, int)>((ref) async {
  ref.watch(outboxCountsProvider);
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return (const <OutboxData>[], 0);
  final rows = await ref.watch(outboxRepositoryProvider).all(sub);
  final bytes = await ref.watch(draftRepositoryProvider).queueBytes(sub);
  return (rows.where((r) => r.status != 'superseded').toList(), bytes);
});

/// "Antrean kirim": what is waiting, what failed and why; manual send / retry.
class QueueScreen extends ConsumerWidget {
  const QueueScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final online = ref.watch(connectivityProvider);
    final sync = ref.watch(syncCoordinatorProvider);
    final rows = ref.watch(_queueRowsProvider);

    String statusLabel(String s) => switch (s) {
      'pending' => t.queueStatusPending,
      'applied' => t.queueStatusApplied,
      'rejected' => t.queueStatusRejected,
      'conflict' => t.queueStatusConflict,
      'failed' => t.queueStatusFailed,
      _ => t.queueStatusSuperseded,
    };

    Future<void> runSync() async {
      final r = await ref.read(syncCoordinatorProvider.notifier).runNow();
      if (!context.mounted || r == null) return;
      showSnack(context, r.outcome == SyncRunOutcome.serverUnsupported ? t.syncServerUnsupported : t.syncDone);
    }

    return Scaffold(
      appBar: AppBar(title: Text(t.queueTitle)),
      body: AsyncBody(
        value: rows,
        onRetry: () => ref.invalidate(_queueRowsProvider),
        data: (data) {
          final (items, bytes) = data;
          final mb = (bytes / (1024 * 1024)).toStringAsFixed(1);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                t.queueUsage('$mb MB'),
                style: TextStyle(
                  color: bytes > DraftRepository.warnQueueBytes ? Theme.of(context).colorScheme.error : null,
                ),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const Key('sync-now'),
                onPressed: online && !sync.running ? runSync : null,
                icon: sync.running
                    ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.cloud_upload),
                label: Text(online ? t.syncNow : t.needsInternet),
              ),
              if (items.any((r) => r.status == 'failed')) ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () async {
                    final sub = ref.read(currentSubProvider);
                    if (sub == null) return;
                    await ref.read(outboxRepositoryProvider).retryFailed(sub);
                    ref.read(syncCoordinatorProvider.notifier).requestSync();
                  },
                  child: Text(t.retryFailed),
                ),
              ],
              const SizedBox(height: 16),
              if (items.isEmpty) Center(child: Text(t.queueEmpty)),
              for (final r in items)
                Card(
                  child: ListTile(
                    leading: Icon(switch (r.status) {
                      'applied' => Icons.check_circle,
                      'pending' => Icons.schedule,
                      _ => Icons.error,
                    }),
                    title: Text(
                      '${SyncItemType.label(r.type)}'
                      ' · ${statusLabel(r.status)}',
                    ),
                    subtitle: Text(
                      [
                        formatServerDateTime(r.createdAt.toUtc().toIso8601String()),
                        if (r.attempts > 0) 'Percobaan: ${r.attempts}',
                        if (r.lastErrorMessage != null) r.lastErrorMessage!,
                      ].join('\n'),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
