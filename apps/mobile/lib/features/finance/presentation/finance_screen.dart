import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_keuangan.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../cash/presentation/voidable_transfers_view.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../companies/presentation/company_chip.dart';
import '../../expense/domain/expense_request.dart';
import '../../expense/domain/request_status.dart';
import '../../expense/presentation/widgets/receipt_mismatch_chip.dart';
import '../../expense/presentation/widgets/request_ui.dart';
import '../../loans/presentation/intercompany_loan_providers.dart';
import '../../loans/presentation/intercompany_loan_screens.dart';
import '../../loans/presentation/loan_providers.dart';
import '../../loans/presentation/loan_transfer_orders.dart';
import '../application/finance_providers.dart';
import '../domain/transfer_queue.dart';

/// DRMS 10/10 point 10 (WA-13): "Finance" on the APK — the web "Antrian Transfer" (search, jenis filter, SLA badge,
/// "Selisih nota (n)", pages) with "Catat transfer" per request for Finance of its PT, and the LPJ verification
/// list (read-only; the verification itself stays on the request detail / web) and (phase 3) the recorded transfers that
/// can still be voided. Online reads.
class FinanceScreen extends ConsumerWidget {
  const FinanceScreen({super.key, this.initialTab = 0});
  final int initialTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final n = ref.watch(transferQueueProvider).value?.length;
    final lpj = ref.watch(lpjQueueProvider).value?.length;
    return DefaultTabController(
      length: 3,
      initialIndex: initialTab.clamp(0, 2),
      child: Scaffold(
        appBar: AppBar(
          title: Text(t.financeTitle),
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              Tab(
                key: const Key('tab-transfer-queue'),
                text: n == null ? t.transferQueueTitle : '${t.transferQueueTitle} ($n)',
              ),
              Tab(key: const Key('tab-lpj-queue'), text: lpj == null ? t.lpjVerifyTitle : '${t.lpjVerifyTitle} ($lpj)'),
              // phase 3 (user 2026-10-19): the web "Transfer tercatat — dapat dibatalkan" below the queue
              Tab(key: const Key('tab-voidable-transfers'), text: t.voidTransferTab),
            ],
          ),
        ),
        body: const TabBarView(children: [TransferQueueView(), _LpjQueueView(), VoidableTransfersView()]),
      ),
    );
  }
}

/// SLA badge of a queue item (web SlaAgeBadge): "5 jam sejak disetujui", red + "· lewat SLA 24 jam" when over.
class SlaBadge extends StatelessWidget {
  const SlaBadge({super.key, required this.sla});
  final TransferSla sla;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    if (sla.ageHours == null) return Text(t.slaAgeUnknown, style: theme.textTheme.bodySmall);
    // D2510: soft pill (tone fill + readable text).
    final c = pkToneColors(context, sla.over ? PkTone.bad : PkTone.ok);
    final hours = sla.slaHours == sla.slaHours.roundToDouble() ? '${sla.slaHours.toInt()}' : '${sla.slaHours}';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.schedule, size: 13, color: c.fg),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              '${t.slaAge(formatSlaHours(sla.ageHours))}${sla.over ? ' · ${t.slaOver(hours)}' : ''}',
              style: theme.textTheme.labelSmall?.copyWith(color: c.fg, fontWeight: FontWeight.w700, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

/// "Antrian Transfer": search (nomor, judul, project, rekening), jenis + "Lewat SLA" filters, 20 per page.
class TransferQueueView extends ConsumerStatefulWidget {
  const TransferQueueView({super.key});

  @override
  ConsumerState<TransferQueueView> createState() => _TransferQueueViewState();
}

class _TransferQueueViewState extends ConsumerState<TransferQueueView> {
  static const _pageSize = 20;
  String _q = '';
  RequestType? _type;
  bool _overOnly = false;
  int _shown = _pageSize;

  void _filter(VoidCallback f) => setState(() {
    f();
    _shown = _pageSize;
  });

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(transferQueueProvider);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: ListSearchField(
            key: const Key('transfer-search'),
            hint: t.transferSearchHint,
            onChanged: (v) => _filter(() => _q = v),
          ),
        ),
        SizedBox(
          height: 48,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            children: [
              for (final ty in <RequestType?>[null, ...RequestType.values])
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: ChoiceChip(
                    key: Key('transfer-type-${ty?.code ?? 'all'}'),
                    label: Text(ty?.label ?? t.filterAllTypes),
                    selected: _type == ty,
                    onSelected: (_) => _filter(() => _type = ty),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: FilterChip(
                  key: const Key('transfer-sla-over'),
                  label: Text(t.slaOverFilter),
                  selected: _overOnly,
                  onSelected: (v) => _filter(() => _overOnly = v),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () {
              // ADR 0029: the "Pencairan pinjaman antar-PT" section above the queue reloads with it; user decision
              // 2026-10-24: so do the inter-project loan transfer orders
              ref.invalidate(icLoanQueueProvider);
              ref.invalidate(loanTransferOrdersProvider);
              return ref.refresh(transferQueueProvider.future);
            },
            child: AsyncBody(
              value: value,
              onRetry: () => ref.invalidate(transferQueueProvider),
              data: (all) {
                final words = _q.toLowerCase().split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
                final items = all
                    .where(
                      (i) =>
                          (_type == null || i.type == _type) &&
                          (!_overOnly || i.sla.over) &&
                          words.every((w) => i.searchText.toLowerCase().contains(w)),
                    )
                    .toList();
                if (items.isEmpty) {
                  return ListView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    children: [
                      const IcLoanQueueSection(),
                      const LoanTransferOrderSection(),
                      PkEmptyState(
                        icon: Icons.task_alt,
                        message: all.isEmpty ? t.transferQueueEmpty : t.projectsNoMatch,
                      ),
                    ],
                  );
                }
                final shown = items.take(_shown).toList();
                final more = shown.length < items.length;
                return ListView.builder(
                  key: const Key('transfer-queue'),
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  // ADR 0029: index 0 = "Pencairan pinjaman antar-PT" (Finance of a lender PT; hidden when empty)
                  // and the inter-project loan transfer orders (user decision 2026-10-24; hidden when empty)
                  itemCount: shown.length + 2,
                  itemBuilder: (_, j) => j == 0
                      ? const Column(children: [IcLoanQueueSection(), LoanTransferOrderSection()])
                      : _queueRow(j - 1, shown, items.length, more),
                );
              },
            ),
          ),
        ),
      ],
    );
  }

  Widget _queueRow(int i, List<TransferQueueItem> shown, int total, bool more) {
    final t = AppLocalizations.of(context);
    return i == shown.length
        ? more
              ? LoadMoreTrigger(
                  key: ValueKey('more-${shown.length}'),
                  onLoad: () => setState(() => _shown += _pageSize),
                )
              : Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    t.listShownOf(shown.length, total),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                )
        : TransferQueueCard(item: shown[i]);
  }
}

/// One queue item in the web column order: Dibutuhkan + SLA, Nomor / Judul (+ project, pusat biaya), Jenis,
/// Rekening tujuan (+ verifikasi), Nominal disetujui, Flag terbuka / "Selisih nota (n)" — then "Catat transfer".
class TransferQueueCard extends ConsumerWidget {
  const TransferQueueCard({super.key, required this.item});
  final TransferQueueItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final it = item;
    // MC3: "Catat transfer" only for Finance of the request's PT (the server checks it again).
    final canTransfer = ref.watch(accountProfileProvider)?.forCompany(it.companyId).has(Role.finance) ?? false;
    final flags = it.warningFlags + it.infoFlags;
    // ADR 0031: the project's Pusat Biaya (cash account) — the default paying account of the transfer
    final pb = it.pusatBiaya?.label ?? (it.pusatBiayaMissing ? t.pusatBiayaQueueMissing : t.costCenterByFinance);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant, height: 1.35);
    // D2510: a bordered card — type chip, number + title, bold amount; SLA pill; muted meta; the destination account
    // on a soft tile; pills; "Catat transfer".
    return PkCard(
      key: Key('tq-${it.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push('/requests/${it.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              requestTypeChip(it.type),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CompanyChipLead(companyId: it.companyId),
                        Flexible(
                          child: Text(
                            it.docNo ?? '#${it.id}',
                            style: theme.textTheme.labelMedium?.copyWith(
                              color: theme.colorScheme.primary,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      it.title,
                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, height: 1.3),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Text(
                formatRupiah(it.amount),
                key: Key('tq-${it.id}-amount'),
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SlaBadge(key: Key('tq-${it.id}-sla'), sla: it.sla),
              Text('${t.neededDate}: ${formatDateOnly(it.neededDate)}', style: muted),
            ],
          ),
          const SizedBox(height: 8),
          if (it.project != null) Text([?it.project!.code, ?it.project!.name].join(' '), style: muted),
          Text(
            '${t.fieldCostCenter}: $pb',
            key: Key('tq-${it.id}-cc'),
            style: muted?.copyWith(color: it.pusatBiayaMissing ? context.pk.warnText : null),
          ),
          Text(it.statusLabel, style: muted),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerLow,
              border: Border.all(color: context.pk.border),
              borderRadius: BorderRadius.circular(PkRadius.sm),
            ),
            child: Row(
              children: [
                Icon(Icons.account_balance_outlined, size: 18, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    it.bankText.isEmpty ? '-' : it.bankText,
                    style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              PkPill(
                label: it.bankVerified ? t.bankVerified : t.bankUnverified,
                tone: it.bankVerified ? PkTone.ok : PkTone.warn,
              ),
              if (flags > 0)
                PkPill(
                  key: Key('tq-${it.id}-flags'),
                  label: t.openFlags(flags),
                  tone: it.warningFlags > 0 ? PkTone.warn : PkTone.neutral,
                  icon: Icons.flag,
                ),
              if (it.receiptMismatch > 0)
                ReceiptMismatchChip(key: Key('tq-${it.id}-mismatch'), count: it.receiptMismatch),
              // ADR 0024: reached the queue without approval (web badge "Tanpa persetujuan (Direktur)")
              if (it.noApproval)
                PkPill(key: Key('tq-${it.id}-no-approval'), label: t.noApprovalBadge, tone: PkTone.warn),
              // ADR 0028: a PT grup payment (web badge "Antar PT: <PT>") — the transfer also posts its Kas Masuk
              if (it.payeeCompanyCode case final code?)
                PkPill(key: Key('tq-${it.id}-intercompany'), label: t.intercompanyBadge(code), tone: PkTone.info),
            ],
          ),
          if (canTransfer) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                key: Key('tq-${it.id}-transfer'),
                onPressed: () => context.push('/finance/transfer/${it.id}'),
                icon: const Icon(Icons.account_balance),
                label: Text(t.transferRecord),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// "Verifikasi LPJ" (`GET /lpj-queue`): read-only list; the request detail shows the LPJ.
class _LpjQueueView extends ConsumerStatefulWidget {
  const _LpjQueueView();

  @override
  ConsumerState<_LpjQueueView> createState() => _LpjQueueViewState();
}

class _LpjQueueViewState extends ConsumerState<_LpjQueueView> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: ListSearchField(
            key: const Key('lpj-search'),
            hint: t.requestsSearchHint,
            onChanged: (v) => setState(() => _q = v),
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => ref.refresh(lpjQueueProvider.future),
            child: AsyncBody(
              value: ref.watch(lpjQueueProvider),
              onRetry: () => ref.invalidate(lpjQueueProvider),
              data: (all) {
                final q = _q.toLowerCase();
                final items = all
                    .where((r) => q.isEmpty || '${r.docNo ?? ''} ${r.title}'.toLowerCase().contains(q))
                    .toList();
                if (items.isEmpty) {
                  return ListView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    children: [
                      const IcLoanQueueSection(),
                      PkEmptyState(
                        icon: Icons.assignment_turned_in_outlined,
                        message: all.isEmpty ? t.lpjQueueEmpty : t.projectsNoMatch,
                      ),
                    ],
                  );
                }
                return ListView.builder(
                  key: const Key('lpj-queue-list'),
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: items.length + 1,
                  itemBuilder: (_, i) => i == 0
                      ? PkNoticeCard(dense: true, icon: Icons.visibility_outlined, title: Text(t.lpjReadOnlyHint))
                      : _LpjTile(r: items[i - 1]),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}

class _LpjTile extends StatelessWidget {
  const _LpjTile({required this.r});
  final ExpenseSummary r;

  @override
  Widget build(BuildContext context) => PkListCard(
    key: Key('lpj-${r.id}'),
    leading: PkIconChip(icon: Icons.assignment_turned_in_outlined, tone: requestStatusTone(r.status), size: 40),
    title: Row(
      children: [
        CompanyChipLead(companyId: r.companyId),
        Expanded(child: Text(r.title, overflow: TextOverflow.ellipsis)),
      ],
    ),
    subtitle: Text('${r.docNo ?? '-'} · ${r.statusLabel}'),
    amount: formatRupiah(r.approvedAmount ?? r.grandTotal),
    onTap: () => context.push('/requests/${r.id}'),
  );
}
