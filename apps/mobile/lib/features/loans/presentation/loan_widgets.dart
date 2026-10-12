import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../companies/presentation/company_chip.dart';
import '../domain/loan.dart';
import 'loan_providers.dart';

/// Status chip: icon + the server's label (never colour alone).
class LoanStatusChip extends StatelessWidget {
  const LoanStatusChip({super.key, required this.loan});
  final Loan loan;

  @override
  Widget build(BuildContext context) {
    final (IconData icon, Color? color) = switch (loan.status) {
      LoanStatus.draft => (Icons.edit_note, null),
      LoanStatus.pendingApproval => (Icons.hourglass_top, context.pk.warnText),
      LoanStatus.approved || LoanStatus.partiallyRepaid => (Icons.check_circle_outline, context.pk.okText),
      LoanStatus.repaid => (Icons.check_circle, context.pk.okText),
      LoanStatus.rejected => (Icons.cancel, context.pk.badText),
      LoanStatus.cancelled => (Icons.block, null),
    };
    return Chip(
      key: Key('loan-status-${loan.id}'),
      avatar: Icon(icon, size: 18, color: color),
      label: Text(loan.statusLabel.isEmpty ? loan.status.code : loan.statusLabel, overflow: TextOverflow.ellipsis),
      visualDensity: VisualDensity.compact,
    );
  }
}

/// "Terlambat · n hari" (derived by the server, ADR 0022 §2).
class LoanOverdueChip extends StatelessWidget {
  const LoanOverdueChip({super.key, required this.loan});
  final Loan loan;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Chip(
      key: Key('loan-overdue-${loan.id}'),
      avatar: Icon(Icons.warning_amber, size: 18, color: context.pk.warnText),
      label: Text(t.loanOverdueDays(loan.daysOverdue), style: TextStyle(color: context.pk.warnText)),
      visualDensity: VisualDensity.compact,
    );
  }
}

/// One loan in a list. With [projectId] (project tab) a chip says whether that project borrows or lends.
class LoanCard extends StatelessWidget {
  const LoanCard({super.key, required this.loan, this.projectId});
  final Loan loan;
  final int? projectId;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final l = loan;
    final pid = projectId;
    final money = theme.textTheme.titleMedium?.copyWith(
      fontWeight: FontWeight.w700,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    return Card(
      key: Key('loan-${l.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/loans/${l.id}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CompanyChipLead(companyId: l.companyId),
                  Expanded(
                    child: Text(l.title, style: theme.textTheme.labelLarge, overflow: TextOverflow.ellipsis),
                  ),
                  Text(formatRupiah(l.amount), style: money),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                t.loanFlow(l.lender.label, l.borrower.label),
                key: Key('loan-flow-${l.id}'),
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (pid != null)
                    Chip(
                      key: Key('loan-role-${l.id}'),
                      avatar: Icon(l.borrowedBy(pid) ? Icons.call_received : Icons.call_made, size: 18),
                      label: Text(l.borrowedBy(pid) ? t.loanRoleBorrower : t.loanRoleLender),
                      visualDensity: VisualDensity.compact,
                    ),
                  LoanStatusChip(loan: l),
                  if (l.overdue) LoanOverdueChip(loan: l),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                [
                  l.kindLabel,
                  t.loanDueOn(formatDateOnly(l.dueDate)),
                  if (l.status == LoanStatus.approved || l.status == LoanStatus.partiallyRepaid)
                    t.loanOutstandingOf(formatRupiah(l.outstanding)),
                ].where((e) => e.isNotEmpty).join(' · '),
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Inbox section (Direktur): loans waiting for the caller's decision. An unreachable endpoint (older server)
/// hides the section so the expense inbox below stays usable.
class LoanInboxSection extends ConsumerWidget {
  const LoanInboxSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(loanInboxProvider);
    if (value.hasError || !value.hasValue) return const SizedBox.shrink();
    final items = value.value!;
    // Only a Direktur decides loans: other inbox users never see an (always empty) loan section.
    final direktur = ref.watch(currentProfileProvider)?.has(Role.owner) ?? false;
    if (items.isEmpty && !direktur) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        key: const Key('loan-inbox'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
            child: Text(
              items.isEmpty ? t.loanTitle : t.loanInboxTitle(items.length),
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          if (items.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 4),
              child: Text(
                t.loanInboxEmpty,
                key: const Key('loan-inbox-empty'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          for (final l in items) LoanCard(loan: l),
          const Divider(height: 16),
        ],
      ),
    );
  }
}
