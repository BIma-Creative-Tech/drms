import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/connectivity/connectivity_controller.dart';
import '../../features/sync/application/sync_coordinator.dart';
import '../../l10n/gen/app_localizations.dart';

/// Always-visible offline / queue indicator above every tab.
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final online = ref.watch(connectivityProvider);
    final counts = ref.watch(outboxCountsProvider).value;
    final sync = ref.watch(syncCoordinatorProvider);
    final lines = <String>[
      if (!online) '${t.offlineBanner} ${t.offlineRecheck}',
      if (counts != null && counts.pending > 0) t.pendingQueue(counts.pending),
      if (counts != null && counts.attention > 0) t.failedQueue(counts.attention),
      if (online && sync.serverUnsupported) t.syncServerUnsupported,
    ];
    if (lines.isEmpty) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    return Material(
      key: const Key('offline-banner'),
      color: online ? scheme.secondaryContainer : scheme.errorContainer,
      child: InkWell(
        // Offline: probe GET /api/v1/health now instead of waiting for the next automatic probe.
        onTap: online ? null : () => ref.read(connectivityProvider.notifier).recheck(),
        child: SafeArea(
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Icon(online ? Icons.cloud_queue : Icons.cloud_off, size: 20),
                const SizedBox(width: 8),
                Expanded(child: Text(lines.join('\n'))),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
