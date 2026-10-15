import 'package:flutter/material.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/rupiah.dart';
import '../../../../l10n/gen/app_localizations.dart';
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

/// ADR 0029 §2 "Ketersediaan dana PT <code>" (web `FundPanel.tsx`): Saldo dana (n akun, tanpa akun site) − Komitmen
/// (expandable list) = Dana tersedia; Dibutuhkan; Kurang (red) or "Cukup" (green); other requests waiting at the final
/// step; linked inter-PT loans; the blocked text; "Perintahkan pinjaman antar-PT" ([onInstructLoan], Owner, short).
/// Read-only before the final step ("cek akhir di persetujuan Owner"). Shown on the request detail and in the decision
/// sheet ([compact]: no commitment list, no loans).
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
    final toneColor = short ? context.pk.badText : context.pk.okText;
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
    final site = f.excludedSiteCount > 0
        ? ' — ${t.fundSiteExcluded(f.excludedSiteCount, formatRupiah(f.excludedSiteBalance))}'
        : '';
    final blocked = f.blockedReason;
    final draft = detail.status == RequestStatus.draft;
    return Card(
      key: const Key('fund-check'),
      margin: const EdgeInsets.symmetric(vertical: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: short ? context.pk.badText : theme.colorScheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(Icons.account_balance_wallet_outlined, size: 20, color: toneColor),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    t.fundPanelTitle(f.code),
                    key: const Key('fund-title'),
                    style: theme.textTheme.titleSmall,
                  ),
                ),
              ],
            ),
            if (!f.enabled)
              Text(t.fundNotEnabled, key: const Key('fund-not-enabled'), style: muted)
            else if (!f.applies)
              Text(t.fundNotFinal, key: const Key('fund-not-final'), style: muted),
            const SizedBox(height: 6),
            row(
              t.fundBalance,
              Text(
                '${formatRupiah(f.balance)} (${t.fundAccounts(f.accountCount)}$site)',
                key: const Key('fund-balance'),
                style: money,
              ),
            ),
            row(
              t.fundCommitments,
              Text('− ${formatRupiah(f.commitments)}', key: const Key('fund-commitments'), style: money),
            ),
            if (!compact && f.commitmentItems.isNotEmpty)
              Theme(
                data: theme.copyWith(dividerColor: Colors.transparent),
                child: ExpansionTile(
                  key: const Key('fund-commitment-list'),
                  tilePadding: EdgeInsets.zero,
                  childrenPadding: const EdgeInsets.only(left: 8, bottom: 4),
                  dense: true,
                  title: Text(t.fundCommitmentDetails(f.commitmentItems.length), style: theme.textTheme.bodySmall),
                  children: [
                    for (final c in f.commitmentItems)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2),
                          child: Text(
                            '${c.label} · ${formatRupiah(c.amount)} · ${c.kindLabel}',
                            key: Key('fund-commitment-${c.kind}-${c.id}'),
                            style: theme.textTheme.bodySmall,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
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
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: toneColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    short ? t.fundGap(formatRupiah(f.gap)) : t.fundEnough,
                    key: const Key('fund-gap'),
                    style: theme.textTheme.labelMedium?.copyWith(color: toneColor, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
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
                  draft ? fundBlockedDraftText(f.gap) : blocked,
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
    final color = context.pk.badText;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
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
