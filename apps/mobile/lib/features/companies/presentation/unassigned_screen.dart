import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../../sync/application/sync_coordinator.dart';
import '../application/company_providers.dart';
import '../data/company_backfill.dart';
import 'company_switcher.dart';

/// "Pilih PT untuk data offline" (MC3 migration of drift v2 rows, several PTs): one row per draft / report /
/// attendance item without PT; the user picks the PT, then the item is sent. Nothing is guessed.
class UnassignedScreen extends ConsumerWidget {
  const UnassignedScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.companyNeedsChoiceTitle)),
      body: AsyncBody<List<UnassignedItem>>(
        value: ref.watch(unassignedItemsProvider),
        onRetry: () => ref.invalidate(unassignedItemsProvider),
        data: (items) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(t.companyNeedsChoiceHint),
            const SizedBox(height: 12),
            for (final it in items)
              Card(
                child: ListTile(
                  key: Key('unassigned-${it.targetUuid}'),
                  leading: Icon(switch (it.kind) {
                    UnassignedKind.draft => Icons.receipt_long,
                    UnassignedKind.progress => Icons.construction,
                    UnassignedKind.attendance => Icons.how_to_reg,
                  }),
                  title: Text(it.label),
                  subtitle: Text(formatServerDateTime(it.createdAt.toUtc().toIso8601String())),
                  trailing: FilledButton.tonal(
                    key: Key('unassigned-pick-${it.targetUuid}'),
                    onPressed: () => _pick(context, ref, it),
                    child: Text(t.companyNeedsChoiceAction),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _pick(BuildContext context, WidgetRef ref, UnassignedItem it) async {
    final t = AppLocalizations.of(context);
    final account = ref.read(accountProfileProvider);
    final sub = ref.read(currentSubProvider);
    if (account == null || sub == null) return;
    final chosen = await pickCompany(context, account.companies, hint: t.companyNeedsChoiceHint);
    if (chosen == null) return;
    await ref.read(companyBackfillProvider).assign(sub, it.kind, it.targetUuid, chosen.id);
    ref.invalidate(unassignedItemsProvider);
    ref.read(syncCoordinatorProvider.notifier).requestSync();
    if (context.mounted) await showActionResult(context, message: t.companyAssigned);
  }
}

/// Home / queue banner while offline rows wait for a PT choice.
class UnassignedBanner extends ConsumerWidget {
  const UnassignedBanner({super.key, required this.onOpen});
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final n = ref.watch(unassignedCountProvider).value ?? 0;
    if (n == 0) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    return Card(
      key: const Key('unassigned-banner'),
      color: scheme.errorContainer,
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        onTap: onOpen,
        leading: Icon(Icons.business, color: scheme.onErrorContainer),
        title: Text(AppLocalizations.of(context).companyNeedsChoiceBanner(n)),
        textColor: scheme.onErrorContainer,
        trailing: Icon(Icons.chevron_right, color: scheme.onErrorContainer),
      ),
    );
  }
}
