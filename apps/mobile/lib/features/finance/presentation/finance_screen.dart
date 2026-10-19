import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../cash/presentation/voidable_transfers_view.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../companies/presentation/company_chip.dart';
import '../../expense/domain/expense_request.dart';
import '../../expense/domain/request_status.dart';
import '../../expense/presentation/widgets/receipt_mismatch_chip.dart';
import '../../loans/presentation/intercompany_loan_providers.dart';
import '../../loans/presentation/intercompany_loan_screens.dart';
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
    final color = sla.over ? context.pk.badText : context.pk.okText;
    final hours = sla.slaHours == sla.slaHours.roundToDouble() ? '${sla.slaHours.toInt()}' : '${sla.slaHours}';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
      child: Text(
        '${t.slaAge(formatSlaHours(sla.ageHours))}${sla.over ? ' · ${t.slaOver(hours)}' : ''}',
        style: theme.textTheme.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w700),
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
              // ADR 0029: the "Pencairan pinjaman antar-PT" section above the queue reloads with it
              ref.invalidate(icLoanQueueProvider);
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
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                    children: [
                      const IcLoanQueueSection(),
                      Padding(
                        padding: const EdgeInsets.all(32),
                        child: Column(
                          children: [
                            Icon(Icons.task_alt, size: 48, color: Theme.of(context).colorScheme.primary),
                            const SizedBox(height: 12),
                            Text(all.isEmpty ? t.transferQueueEmpty : t.projectsNoMatch, textAlign: TextAlign.center),
                          ],
                        ),
                      ),
                    ],
                  );
                }
                final shown = items.take(_shown).toList();
                final more = shown.length < items.length;
                return ListView.builder(
                  key: const Key('transfer-queue'),
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                  // ADR 0029: index 0 = "Pencairan pinjaman antar-PT" (Finance of a lender PT; hidden when empty)
                  itemCount: shown.length + 2,
                  itemBuilder: (_, j) =>
                      j == 0 ? const IcLoanQueueSection() : _queueRow(j - 1, shown, items.length, more),
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
    final cc = it.costCenter;
    return Card(
      key: Key('tq-${it.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/requests/${it.id}'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CompanyChipLead(companyId: it.companyId),
                  Expanded(
                    child: Text(
                      '${t.neededDate}: ${formatDateOnly(it.neededDate)}',
                      style: theme.textTheme.labelMedium,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              SlaBadge(key: Key('tq-${it.id}-sla'), sla: it.sla),
              const SizedBox(height: 8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          it.docNo ?? '#${it.id}',
                          style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary),
                        ),
                        Text(it.title, style: theme.textTheme.titleMedium),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    formatRupiah(it.amount),
                    key: Key('tq-${it.id}-amount'),
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
              if (it.project != null)
                Text([?it.project!.code, ?it.project!.name].join(' '), style: theme.textTheme.bodySmall),
              Text(
                '${t.fieldCostCenter}: ${cc == null ? t.costCenterByFinance : '${cc.code ?? ''} ${cc.name ?? ''}'.trim()}',
                key: Key('tq-${it.id}-cc'),
                style: theme.textTheme.bodySmall,
              ),
              Text(it.statusLabel, style: theme.textTheme.bodySmall),
              const SizedBox(height: 6),
              Text(it.bankText.isEmpty ? '-' : it.bankText, style: theme.textTheme.bodyMedium),
              const SizedBox(height: 4),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  _Pill(
                    text: it.bankVerified ? t.bankVerified : t.bankUnverified,
                    color: it.bankVerified ? context.pk.okText : context.pk.warnText,
                  ),
                  if (flags > 0)
                    _Pill(
                      key: Key('tq-${it.id}-flags'),
                      text: t.openFlags(flags),
                      color: it.warningFlags > 0 ? context.pk.warnText : theme.colorScheme.outline,
                    ),
                  if (it.receiptMismatch > 0)
                    ReceiptMismatchChip(key: Key('tq-${it.id}-mismatch'), count: it.receiptMismatch),
                  // ADR 0024: reached the queue without approval (web badge "Tanpa persetujuan (Direktur)")
                  if (it.noApproval)
                    _Pill(key: Key('tq-${it.id}-no-approval'), text: t.noApprovalBadge, color: context.pk.warnText),
                  // ADR 0028: a PT grup payment (web badge "Antar PT: <PT>") — the transfer also posts its Kas Masuk
                  if (it.payeeCompanyCode case final code?)
                    _Pill(
                      key: Key('tq-${it.id}-intercompany'),
                      text: t.intercompanyBadge(code),
                      color: theme.colorScheme.primary,
                    ),
                ],
              ),
              if (canTransfer) ...[
                const SizedBox(height: 10),
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
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({super.key, required this.text, required this.color});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
    child: Text(
      text,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w600),
    ),
  );
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
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                    children: [
                      const IcLoanQueueSection(),
                      Padding(
                        padding: const EdgeInsets.all(32),
                        child: Center(child: Text(all.isEmpty ? t.lpjQueueEmpty : t.projectsNoMatch)),
                      ),
                    ],
                  );
                }
                return ListView.separated(
                  key: const Key('lpj-queue-list'),
                  padding: const EdgeInsets.only(bottom: 24),
                  itemCount: items.length + 1,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, i) => i == 0
                      ? Padding(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                          child: Text(t.lpjReadOnlyHint, style: Theme.of(context).textTheme.bodySmall),
                        )
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
  Widget build(BuildContext context) => ListTile(
    key: Key('lpj-${r.id}'),
    title: Row(
      children: [
        CompanyChipLead(companyId: r.companyId),
        Expanded(child: Text(r.title, overflow: TextOverflow.ellipsis)),
      ],
    ),
    subtitle: Text('${r.docNo ?? '-'} · ${r.statusLabel}'),
    trailing: Text(formatRupiah(r.approvedAmount ?? r.grandTotal)),
    onTap: () => context.push('/requests/${r.id}'),
  );
}
