import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_proyek.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../companies/presentation/company_chip.dart';
import '../domain/loan.dart';
import 'loan_providers.dart';

/// Soft tone of a loan status: Draft neutral, waiting warn, approved awaiting Finance info, approved / repaid ok,
/// rejected / cancelled bad.
PkTone loanStatusTone(Loan loan) => switch (loan.status) {
  LoanStatus.draft => PkTone.neutral,
  LoanStatus.pendingApproval => PkTone.warn,
  LoanStatus.approved when loan.awaitingDisbursement => PkTone.info,
  LoanStatus.approved || LoanStatus.partiallyRepaid || LoanStatus.repaid => PkTone.ok,
  LoanStatus.rejected || LoanStatus.cancelled => PkTone.bad,
};

/// Status pill: icon + the server's label (never colour alone).
class LoanStatusChip extends StatelessWidget {
  const LoanStatusChip({super.key, required this.loan});
  final Loan loan;

  @override
  Widget build(BuildContext context) {
    final icon = switch (loan.status) {
      LoanStatus.draft => Icons.edit_note,
      LoanStatus.pendingApproval => Icons.hourglass_top,
      // ADR 0031: "Disetujui – menunggu pencairan" (Finance has not disbursed the cash-backed loan yet)
      LoanStatus.approved when loan.awaitingDisbursement => Icons.hourglass_top,
      LoanStatus.approved || LoanStatus.partiallyRepaid => Icons.check_circle_outline,
      LoanStatus.repaid => Icons.check_circle,
      LoanStatus.rejected => Icons.cancel,
      LoanStatus.cancelled => Icons.block,
    };
    return PkPill(
      key: Key('loan-status-${loan.id}'),
      icon: icon,
      tone: loanStatusTone(loan),
      label: loan.statusLabel.isEmpty ? loan.status.code : loan.statusLabel,
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
    return PkPill(
      key: Key('loan-overdue-${loan.id}'),
      icon: Icons.warning_amber_rounded,
      tone: PkTone.bad,
      label: t.loanOverdueDays(loan.daysOverdue),
    );
  }
}

/// One loan in a list (icon chip, title + amount, lender → borrower, pills, kind · due · sisa). With [projectId]
/// (project tab) a pill says whether that project borrows or lends.
class LoanCard extends StatelessWidget {
  const LoanCard({super.key, required this.loan, this.projectId});
  final Loan loan;
  final int? projectId;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final l = loan;
    final pid = projectId;
    final borrows = pid != null && l.borrowedBy(pid);
    return PkCard(
      key: Key('loan-${l.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push('/loans/${l.id}'),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PkIconChip(
            icon: pid == null ? Icons.swap_horiz : (borrows ? Icons.call_received : Icons.call_made),
            tone: l.overdue ? PkTone.bad : PkTone.info,
            size: 38,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CompanyChipLead(companyId: l.companyId),
                    Expanded(
                      child: Text(l.title, style: pkTitleStyle(context), overflow: TextOverflow.ellipsis),
                    ),
                    const SizedBox(width: 8),
                    Text(formatRupiah(l.amount), style: pkMoneyStyle(context)),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  t.loanFlow(l.lenderLabel, l.borrower.label),
                  key: Key('loan-flow-${l.id}'),
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (pid != null)
                      PkPill(
                        key: Key('loan-role-${l.id}'),
                        icon: borrows ? Icons.call_received : Icons.call_made,
                        tone: PkTone.primary,
                        label: borrows ? t.loanRoleBorrower : t.loanRoleLender,
                      ),
                    LoanStatusChip(loan: l),
                    if (l.overdue) LoanOverdueChip(loan: l),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  [
                    l.kindLabel,
                    t.loanDueOn(formatDateOnly(l.dueDate)),
                    if (l.status == LoanStatus.approved || l.status == LoanStatus.partiallyRepaid)
                      t.loanOutstandingOf(formatRupiah(l.outstanding)),
                  ].where((e) => e.isNotEmpty).join(' · '),
                  style: pkMetaStyle(context),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Inbox section (Direktur, Owner): loans and cash-backed repayment requests waiting for the caller's decision (user
/// decision 2026-10-24: Direktur level 1, then Owner level 2). An unreachable endpoint (older server) hides the section
/// so the expense inbox below stays usable.
class LoanInboxSection extends ConsumerWidget {
  const LoanInboxSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(loanInboxProvider);
    if (value.hasError || !value.hasValue) return const SizedBox.shrink();
    final inbox = value.value!;
    // Only a Direktur / Owner decides loans: other inbox users never see an (always empty) loan section.
    final p = ref.watch(currentProfileProvider);
    final decider = (p?.has(Role.owner) ?? false) || (p?.has(Role.principal) ?? false);
    if (inbox.count == 0 && !decider) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        key: const Key('loan-inbox'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PkSectionHeader(
            title: inbox.count == 0 ? t.loanTitle : t.loanInboxTitle(inbox.count),
            padding: const EdgeInsets.only(bottom: 10),
          ),
          if (inbox.count == 0)
            PkCard(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  const PkIconChip(icon: Icons.swap_horiz, tone: PkTone.ok, size: 34, round: true),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(t.loanInboxEmpty, key: const Key('loan-inbox-empty'), style: pkMetaStyle(context)),
                  ),
                ],
              ),
            ),
          for (final l in inbox.loans) LoanCard(loan: l),
          for (final r in inbox.repayments) LoanRepaymentInboxCard(item: r),
        ],
      ),
    );
  }
}

/// A repayment request in the inbox: loan number, amount, borrower → lender (the money goes back), level label,
/// planned date, submitter. Opens the loan detail, where the caller decides the request.
class LoanRepaymentInboxCard extends StatelessWidget {
  const LoanRepaymentInboxCard({super.key, required this.item});
  final LoanRepaymentInboxItem item;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final r = item;
    return PkCard(
      key: Key('loan-repayment-inbox-${r.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push('/loans/${r.loanId}'),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const PkIconChip(icon: Icons.keyboard_return, tone: PkTone.warn, size: 38),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CompanyChipLead(companyId: r.companyId),
                    Expanded(
                      child: Text(
                        t.loanRepaymentInboxTitle(r.loanDocNo ?? '#${r.loanId}'),
                        style: pkTitleStyle(context),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(formatRupiah(r.amount), style: pkMoneyStyle(context)),
                  ],
                ),
                const SizedBox(height: 2),
                // the money goes back: borrower → lender
                Text(
                  t.loanFlow(r.borrower.label, r.lender?.label ?? '—'),
                  key: Key('loan-repayment-inbox-flow-${r.id}'),
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(height: 8),
                PkPill(icon: Icons.hourglass_top, tone: PkTone.warn, label: r.statusLabel),
                const SizedBox(height: 6),
                Text(
                  [
                    if (r.plannedDate != null) t.loanRepayPlannedOn(formatDateOnly(r.plannedDate)),
                    if (r.submittedBy?.name != null) t.loanSubmittedBy(r.submittedBy!.name!),
                    if ((r.note ?? '').isNotEmpty) r.note!,
                  ].join(' · '),
                  style: pkMetaStyle(context),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
