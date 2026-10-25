import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_keuangan.dart';
import '../../auth/application/auth_controller.dart';
import '../../companies/presentation/company_chip.dart';
import '../../auth/domain/user_profile.dart';
import '../application/expense_providers.dart';
import '../domain/draft.dart';
import '../domain/request_status.dart';
import 'widgets/request_ui.dart';

String syncStateLabel(AppLocalizations t, DraftSyncState s) => switch (s) {
  DraftSyncState.local => t.syncStateLocal,
  DraftSyncState.queued => t.syncStateQueued,
  DraftSyncState.synced => t.syncStateSynced,
  DraftSyncState.conflict => t.syncStateConflict,
  DraftSyncState.rejected => t.syncStateRejected,
  DraftSyncState.submitted => t.syncStateSubmitted,
};

/// "Pengajuan": local drafts (offline-capable) + server list (scope mine; Direktur/Finance: all) and, for a
/// PM, the team list (scope `team`, read-only monitoring — US-17, ADR 0013). `?tab=team` opens the team tab.
class RequestsScreen extends ConsumerWidget {
  const RequestsScreen({super.key, this.initialTab});
  final String? initialTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(currentProfileProvider);
    final canCreate = profile?.canCreateRequests ?? false;
    final team = profile?.hasTeamMonitor ?? false;
    final scope = (profile?.homeKind == HomeKind.direktur || profile?.homeKind == HomeKind.finance) ? 'all' : 'mine';
    final tabs = <(String, Tab, Widget)>[
      if (canCreate) ('drafts', Tab(text: t.tabDrafts), const _DraftList()),
      if (canCreate || team) ('sent', Tab(text: t.tabSent), _SentList(scope: scope)),
      if (team)
        ('team', Tab(key: const Key('tab-team'), text: t.tabTeam), const _SentList(scope: 'team', teamHint: true)),
    ];
    if (tabs.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: Text(t.requestsTitle)),
        body: _SentList(scope: scope),
      );
    }
    final start = tabs.indexWhere((e) => e.$1 == initialTab);
    return DefaultTabController(
      key: ValueKey('tabs-${tabs.length}-$initialTab'),
      length: tabs.length,
      initialIndex: start < 0 ? 0 : start,
      child: Scaffold(
        appBar: AppBar(
          title: Text(t.requestsTitle),
          bottom: tabs.length > 1 ? TabBar(tabs: [for (final e in tabs) e.$2]) : null,
        ),
        floatingActionButton: canCreate
            ? FloatingActionButton.extended(
                key: const Key('fab-new-request'),
                onPressed: () => context.push('/drafts/new?type=${RequestType.reimburse.code}'),
                icon: const Icon(Icons.add),
                label: Text(t.editorNewTitle),
              )
            : null,
        body: tabs.length > 1 ? TabBarView(children: [for (final e in tabs) e.$3]) : tabs.single.$3,
      ),
    );
  }
}

class _DraftList extends ConsumerWidget {
  const _DraftList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return AsyncBody(
      value: ref.watch(openDraftsProvider),
      data: (drafts) => drafts.isEmpty
          ? ListView(
              children: [PkEmptyState(icon: Icons.phone_android, message: t.noDrafts)],
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              itemCount: drafts.length,
              itemBuilder: (_, i) {
                final d = drafts[i];
                final warn = d.syncState == DraftSyncState.rejected || d.syncState == DraftSyncState.conflict;
                final synced = d.syncState == DraftSyncState.synced;
                return PkListCard(
                  key: Key('draft-${d.clientUuid}'),
                  leading: PkIconChip(
                    icon: synced ? Icons.cloud_done : Icons.phone_android,
                    tone: warn ? PkTone.bad : (synced ? PkTone.ok : PkTone.neutral),
                    size: 40,
                  ),
                  title: Row(
                    children: [
                      CompanyChipLead(companyId: d.companyId, always: true),
                      Expanded(child: Text(d.title.isEmpty ? t.draftUntitled : d.title)),
                    ],
                  ),
                  amount: formatRupiah(d.previewGrandTotal),
                  subtitle: Text(d.type.label),
                  badges: [
                    PkPill(
                      label: syncStateLabel(t, d.syncState),
                      tone: warn ? PkTone.bad : (synced ? PkTone.ok : PkTone.neutral),
                    ),
                  ],
                  footer: d.lastError == null
                      ? null
                      : Text(
                          d.lastError!,
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: context.pk.badText),
                        ),
                  onTap: () => context.push('/drafts/${d.clientUuid}'),
                );
              },
            ),
    );
  }
}

class _SentList extends ConsumerWidget {
  const _SentList({required this.scope, this.teamHint = false});
  final String scope;
  final bool teamHint;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final provider = requestListProvider(scope);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(provider.future),
      child: AsyncBody(
        value: ref.watch(provider),
        onRetry: () => ref.invalidate(provider),
        data: (s) => s.items.isEmpty
            ? ListView(
                children: [PkEmptyState(icon: PkIcons.requests, message: t.noRequests)],
              )
            : ListView.builder(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                itemCount: s.items.length + (s.nextCursor != null ? 1 : 0) + (teamHint ? 1 : 0),
                itemBuilder: (_, index) {
                  if (teamHint && index == 0) {
                    return PkNoticeCard(
                      key: const Key('team-readonly-hint'),
                      dense: true,
                      icon: Icons.visibility_outlined,
                      title: Text(t.teamReadOnlyHint),
                    );
                  }
                  final i = teamHint ? index - 1 : index;
                  if (i == s.items.length) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: OutlinedButton(
                        onPressed: s.loadingMore ? null : () => ref.read(provider.notifier).loadMore(),
                        child: Text(t.loadMore),
                      ),
                    );
                  }
                  final r = s.items[i];
                  return PkListCard(
                    key: Key('request-${r.id}'),
                    leading: requestTypeChip(r.type, payee: r.payeeType),
                    title: Row(
                      children: [
                        CompanyChipLead(companyId: r.companyId),
                        Expanded(child: Text(r.title)),
                      ],
                    ),
                    amount: formatRupiah(r.grandTotal),
                    subtitle: Text(
                      [r.docNo ?? '-', r.typeLabel, if (r.neededDate != null) formatDateOnly(r.neededDate)].join(' · '),
                    ),
                    badges: [
                      PkPill(label: r.statusLabel, tone: requestStatusTone(r.status)),
                      if (r.openWarningFlags > 0) Icon(Icons.flag, size: 16, color: context.pk.badText),
                    ],
                    onTap: () => context.push('/requests/${r.id}'),
                  );
                },
              ),
      ),
    );
  }
}
