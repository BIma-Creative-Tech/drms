import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/db/app_database.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../auth/application/auth_controller.dart';
import '../../companies/presentation/company_chip.dart';
import '../../companies/presentation/unassigned_screen.dart';
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
      if (r.outcome == SyncRunOutcome.serverUnsupported) {
        await showActionFailure(context, t.syncServerUnsupported, action: t.syncNow);
      } else {
        await showActionResult(context, message: t.syncDone, action: t.syncNow);
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(t.queueTitle)),
      body: AsyncBody(
        value: rows,
        onRetry: () => ref.invalidate(_queueRowsProvider),
        data: (data) {
          final (items, bytes) = data;
          final mb = formatDecimal(bytes / (1024 * 1024));
          final pk = context.pk;
          final theme = Theme.of(context);
          final heavy = bytes > DraftRepository.warnQueueBytes;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            children: [
              UnassignedBanner(onOpen: () => context.push('/companies/unassigned')),
              PkCard(
                radius: PkRadius.lg,
                margin: const EdgeInsets.only(bottom: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        PkIconChip(icon: PkIcons.queue, tone: heavy ? PkTone.bad : PkTone.info, size: 44),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            t.queueUsage('$mb MB'),
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                              color: heavy ? theme.colorScheme.error : null,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    FilledButton.icon(
                      key: const Key('sync-now'),
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                      onPressed: online && !sync.running ? runSync : null,
                      icon: sync.running
                          ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.cloud_upload),
                      label: Text(online ? t.syncNow : t.needsInternet),
                    ),
                    if (items.any((r) => r.status == 'failed')) ...[
                      const SizedBox(height: 8),
                      OutlinedButton(
                        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                        onPressed: () async {
                          final sub = ref.read(currentSubProvider);
                          if (sub == null) return;
                          final failed = items.where((r) => r.status == 'failed').length;
                          final ok = await confirmAction(
                            context,
                            action: t.retryFailed,
                            summary: [t.pendingQueue(failed)],
                          );
                          if (!ok) return;
                          await ref.read(outboxRepositoryProvider).retryFailed(sub);
                          ref.read(syncCoordinatorProvider.notifier).requestSync();
                          if (context.mounted) await showActionQueued(context, action: t.retryFailed);
                        },
                        child: Text(t.retryFailed),
                      ),
                    ],
                  ],
                ),
              ),
              if (items.isEmpty) PkEmptyState(icon: Icons.cloud_done_outlined, message: t.queueEmpty),
              for (final r in items)
                PkCard(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      PkIconChip(
                        icon: switch (r.status) {
                          'applied' => Icons.check_circle_outline,
                          'pending' => Icons.schedule,
                          _ => Icons.error_outline,
                        },
                        tone: _tone(r.status),
                        size: 40,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                CompanyChipLead(companyId: r.companyId, always: true),
                                Expanded(
                                  child: Text(
                                    SyncItemType.label(r.type),
                                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                PkPill(label: statusLabel(r.status), tone: _tone(r.status)),
                              ],
                            ),
                            const SizedBox(height: 3),
                            Text(
                              [
                                formatServerDateTime(r.createdAt.toUtc().toIso8601String()),
                                if (r.attempts > 0) 'Percobaan: ${r.attempts}',
                              ].join(' · '),
                              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                            ),
                            if (r.lastErrorMessage != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(
                                  r.lastErrorMessage!,
                                  style: theme.textTheme.bodySmall?.copyWith(color: pk.badText),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  static PkTone _tone(String status) => switch (status) {
    'applied' => PkTone.ok,
    'pending' => PkTone.info,
    'superseded' => PkTone.neutral,
    _ => PkTone.bad,
  };
}
