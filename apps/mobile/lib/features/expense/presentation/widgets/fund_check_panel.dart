import 'package:flutter/material.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/rupiah.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/pk_ui.dart';
import '../../domain/expense_request.dart';
import '../../domain/fund_check.dart';
import '../../domain/request_status.dart';

/// `allowedActions` value of ADR 0029: the Owner may order an inter-PT loan for this short request.
const instructLoanAction = 'instruct_loan';

/// Route of the instruction form for request [d]: borrower = the request's PT, the request pre-linked, amount = the gap
/// (web `FundPanel.tsx` href).
String icLoanInstructPath(ExpenseDetail d) {
  final f = d.fundCheck;
  final borrower = f?.companyId ?? d.companyId;
  return Uri(
    path: '/intercompany-loans/new',
    queryParameters: {'borrower': '$borrower', 'requests': '${d.id}', if (f != null && f.gap > 0) 'amount': '${f.gap}'},
  ).toString();
}

/// ADR 0029 §2 "Ketersediaan dana PT <code>" (web `FundPanel.tsx`): Saldo dana (n akun, every active account) − Komitmen
/// (expandable list) = Dana tersedia; Dibutuhkan; Kurang (red) or "Cukup" (green); other requests waiting at the final
/// step; linked inter-PT loans; the blocked text; "Perintahkan pinjaman antar-PT" ([onInstructLoan], Owner, short).
/// Read-only before the final step ("cek akhir di persetujuan Owner"). Shown on the request detail and in the decision
/// sheet ([compact]: no commitment lists, no loans).
/// ADR 0031 amendment (user 2026-10-22, "PB dulu, lalu PT"): a mapped project shows its Pusat Biaya first (Saldo akun −
/// Komitmen = Dana bebas), then "Seluruh PT <code>" with the PT figures; `routeText` says which account Finance pays from.
class FundCheckPanel extends StatelessWidget {
  const FundCheckPanel({super.key, required this.detail, this.onInstructLoan, this.compact = false});
  final ExpenseDetail detail;
  final VoidCallback? onInstructLoan;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final f = detail.fundCheck;
    if (f == null) return const SizedBox.shrink();
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final short = f.short;
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final money = theme.textTheme.bodyMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
    final bold = money?.copyWith(fontWeight: FontWeight.w700);
    Widget row(String label, Widget value, {Key? key, bool strong = false}) => Padding(
      key: key,
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(
              label,
              style: strong ? theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700) : null,
            ),
          ),
          Expanded(child: value),
        ],
      ),
    );
    Widget commitmentList(List<FundCommitmentItem> items, String keyPrefix) => Theme(
      data: theme.copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        key: Key('$keyPrefix-list'),
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(left: 8, bottom: 4),
        dense: true,
        title: Text(t.fundCommitmentDetails(items.length), style: theme.textTheme.bodySmall),
        children: [
          for (final c in items)
            Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(
                  '${c.label} · ${formatRupiah(c.amount)} · ${c.kindLabel}',
                  key: Key('$keyPrefix-${c.kind}-${c.id}'),
                  style: theme.textTheme.bodySmall,
                ),
              ),
            ),
        ],
      ),
    );
    Widget heading(String text, Key key) => Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 2),
      child: Text(
        text,
        key: key,
        style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
      ),
    );
    final pb = f.pusatBiaya;
    final routeText = f.routeText?.trim() ?? '';
    final blocked = f.blockedReason;
    final draft = detail.status == RequestStatus.draft;
    // D2510: a bordered card like the other sections (red border while the PT is short).
    return Container(
      key: const Key('fund-check'),
      margin: compact ? const EdgeInsets.symmetric(vertical: 8) : const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: context.pk.card,
        borderRadius: BorderRadius.circular(PkRadius.md),
        border: Border.all(color: short ? context.pk.badText.withValues(alpha: 0.6) : context.pk.border),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                PkIconChip(icon: Icons.account_balance_wallet_outlined, tone: short ? PkTone.bad : PkTone.ok, size: 30),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    t.fundPanelTitle(f.code),
                    key: const Key('fund-title'),
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            if (!f.enabled)
              Text(t.fundNotEnabled, key: const Key('fund-not-enabled'), style: muted)
            else if (!f.applies)
              Text(t.fundNotFinal, key: const Key('fund-not-final'), style: muted),
            const SizedBox(height: 6),
            if (pb != null) ...[
              heading(t.fundPbTitle(pb.name), const Key('fund-pb-title')),
              row(t.fundPbBalance, Text(formatRupiah(pb.balance), key: const Key('fund-pb-balance'), style: money)),
              row(
                t.fundCommitments,
                Text('− ${formatRupiah(pb.commitments)}', key: const Key('fund-pb-commitments'), style: money),
              ),
              if (!compact && pb.commitmentItems.isNotEmpty) commitmentList(pb.commitmentItems, 'fund-pb-commitment'),
              row(
                t.fundPbAvailable,
                Text(formatRupiah(pb.available), key: const Key('fund-pb-available'), style: bold),
                strong: true,
              ),
              const SizedBox(height: 4),
              heading(t.fundPtSection(f.code), const Key('fund-pt-title')),
            ],
            row(
              t.fundBalance,
              Text(
                '${formatRupiah(f.balance)} (${t.fundAccounts(f.accountCount)})',
                key: const Key('fund-balance'),
                style: money,
              ),
            ),
            row(
              t.fundCommitments,
              Text('− ${formatRupiah(f.commitments)}', key: const Key('fund-commitments'), style: money),
            ),
            if (!compact && f.commitmentItems.isNotEmpty) commitmentList(f.commitmentItems, 'fund-commitment'),
            row(
              t.fundAvailable,
              Text(formatRupiah(f.available), key: const Key('fund-available'), style: bold),
              strong: true,
            ),
            row(t.fundNeeded, Text(formatRupiah(f.needed), key: const Key('fund-needed'), style: money)),
            row(
              short ? t.fundShortLabel : t.fundStatusLabel,
              Align(
                alignment: Alignment.centerLeft,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: short ? context.pk.badBg : context.pk.okBg,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    short ? t.fundGap(formatRupiah(f.gap)) : t.fundEnough,
                    key: const Key('fund-gap'),
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: short ? context.pk.badOn : context.pk.okOn,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
            if (routeText.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(routeText, key: const Key('fund-route'), style: theme.textTheme.bodyMedium),
              ),
            if (f.waitingCount > 0)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  t.fundWaiting(f.waitingCount, formatRupiah(f.waitingAmount)),
                  key: const Key('fund-waiting'),
                  style: theme.textTheme.bodySmall,
                ),
              ),
            if (!compact && f.loans.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(t.fundLoansTitle, style: theme.textTheme.labelLarge),
              for (final l in f.loans)
                Text(
                  '${l.docNo} · ${l.lenderCode ?? '—'} · ${formatRupiah(l.amount)} · ${l.statusLabel}',
                  key: Key('fund-loan-${l.id}'),
                  style: theme.textTheme.bodySmall,
                ),
            ],
            if (blocked != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  draft ? fundBlockedDraftText(f.gap, pbName: pb?.name) : blocked,
                  key: const Key('fund-blocked-text'),
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
                ),
              ),
            if (onInstructLoan != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: FilledButton.icon(
                  key: const Key('fund-instruct-loan'),
                  onPressed: onInstructLoan,
                  icon: const Icon(Icons.swap_horiz),
                  label: Text(t.fundInstructLoan),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Inbox badge "Dana kurang Rp X" (ADR 0029, `fundShort`).
class FundShortBadge extends StatelessWidget {
  const FundShortBadge({super.key, required this.gap});
  final int gap;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final color = context.pk.badOn;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: context.pk.badBg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.account_balance_wallet_outlined, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            t.fundShortBadge(formatRupiah(gap)),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}
