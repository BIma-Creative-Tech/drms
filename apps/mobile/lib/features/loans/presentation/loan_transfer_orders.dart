import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_proyek.dart';
import '../../companies/presentation/company_chip.dart';
import '../../finance/application/finance_providers.dart';
import '../../finance/presentation/transfer_form_screen.dart' show transferOverridePrompt;
import '../domain/loan.dart';
import 'loan_providers.dart';

/// User decision 2026-10-24 on the APK: the approved cash-backed loans (disbursement) and repayments are transfer
/// orders in Finance's "Antrian Transfer" — listed above the request queue next to "Pencairan pinjaman antar-PT".
/// Finance executes one (date between the loan date and today, optional note): the server posts KK + KM on the frozen
/// Pusat Biaya accounts, each tagged with its project, in one transaction. The APK executes WITHOUT a transfer proof
/// (optional on the server; attached on the web). A submitter who is Finance may execute his own order (audited).

/// A loan cash move that takes the paying account below 0 (409 `CASH_OVERDRAFT_CONFIRM_REQUIRED`) asks "Tetap simpan"
/// (same dialog as the transfer, QA-04) and is re-sent with `confirmOverdraft` (another body → another key, see
/// [send]); null when the user keeps the refusal.
Future<Loan?> withLoanOverdraftConfirm(BuildContext context, Future<Loan> Function({bool confirm}) send) async {
  try {
    return await send();
  } on ProblemException catch (e) {
    if (!context.mounted) rethrow;
    final t = AppLocalizations.of(context);
    final prompt = transferOverridePrompt(t, e);
    if (prompt == null || prompt.flag != 'confirmOverdraft') rethrow;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(prompt.title),
        content: Text(prompt.lines.join('\n\n')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
          FilledButton(
            key: const Key('loan-override-confirm'),
            onPressed: () => Navigator.pop(c, true),
            child: Text(t.overrideConfirm),
          ),
        ],
      ),
    );
    if (ok != true) return null;
    return send(confirm: true);
  }
}

/// "Transfer pinjaman antar project (n)" above the transfer queue. Hidden when empty, when the server is older or the
/// list cannot be loaded (the transfer queue below stays usable).
class LoanTransferOrderSection extends ConsumerWidget {
  const LoanTransferOrderSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(loanTransferOrdersProvider);
    final items = value.value?.items ?? const <LoanTransferOrder>[];
    if (value.hasError || items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        key: const Key('loan-transfer-orders'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PkListTitle(t.loanTransferOrdersTitle(items.length), padding: const EdgeInsets.only(bottom: 10)),
          for (final o in items) LoanTransferOrderCard(order: o),
        ],
      ),
    );
  }
}

/// One transfer order: title + PJ number, amount, paying → receiving account, projects, date, submitter, the
/// "self" note and "Catat transfer" (Finance of the PT, `canExecute`). The card opens the loan detail.
class LoanTransferOrderCard extends ConsumerStatefulWidget {
  const LoanTransferOrderCard({super.key, required this.order});
  final LoanTransferOrder order;

  @override
  ConsumerState<LoanTransferOrderCard> createState() => _LoanTransferOrderCardState();
}

class _LoanTransferOrderCardState extends ConsumerState<LoanTransferOrderCard> {
  bool _busy = false;
  final _key = const Uuid().v7();

  Future<void> _execute() async {
    final t = AppLocalizations.of(context);
    final o = widget.order;
    final input = await showModalBottomSheet<({String date, String note})>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ExecuteSheet(order: o),
    );
    if (input == null || !mounted) return;
    // D2410: "Yakin ingin catat transfer?" with the order (PJ, nominal, accounts, date) before, the result popup after
    final label = t.loanTransferOrderExecute;
    final docNo = o.docNo ?? '#${o.loanId}';
    final summary = [
      '$docNo · ${o.title}',
      formatRupiah(o.amount),
      t.loanFlow(o.fromAccount?.label ?? '—', o.toAccount?.label ?? '—'),
      formatDateOnly(input.date),
      input.note,
    ];
    final ok = await confirmAction(
      context,
      action: label,
      summary: summary,
      confirmKey: const Key('loan-order-execute-confirm'),
    );
    if (!ok || !mounted) return;
    final api = ref.read(loansApiProvider);
    Future<Loan> send({bool confirm = false}) {
      final key = confirm ? '$_key-c' : _key;
      return o.repayment
          ? api.executeRepayment(
              o.loanId,
              o.id,
              executeDate: input.date,
              note: input.note,
              confirmOverdraft: confirm,
              idempotencyKey: key,
            )
          : api.execute(
              o.loanId,
              executeDate: input.date,
              note: input.note,
              confirmOverdraft: confirm,
              idempotencyKey: key,
            );
    }

    setState(() => _busy = true);
    try {
      final out = await withLoanOverdraftConfirm(context, send);
      if (!mounted) return;
      if (out == null) {
        showSnack(context, t.overrideCancelled);
      } else {
        await showActionResult(context, message: t.loanTransferOrderDone(docNo), action: label);
      }
    } on ApiException catch (e) {
      if (mounted) await showActionError(context, e, action: label);
    } finally {
      // also after a refusal: the list follows the server
      ref.invalidate(loanTransferOrdersProvider);
      ref.invalidate(loanDetailProvider(o.loanId));
      ref.invalidate(cashAccountsProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final o = widget.order;
    final from = o.fromAccount?.label ?? '—';
    final to = o.toAccount?.label ?? '—';
    return PkCard(
      key: Key('loan-order-${o.key}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push('/loans/${o.loanId}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PkIconChip(
                icon: o.repayment ? Icons.keyboard_return : Icons.swap_horiz,
                tone: o.repayment ? PkTone.ok : PkTone.info,
                size: 38,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CompanyChipLead(companyId: o.companyId),
                        Flexible(
                          child: Text(
                            o.docNo ?? '#${o.loanId}',
                            style: theme.textTheme.labelMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    Text(o.title, style: pkTitleStyle(context)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                formatRupiah(o.amount),
                key: Key('loan-order-${o.key}-amount'),
                style: pkMoneyStyle(context, base: theme.textTheme.titleMedium),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(t.loanFlow(from, to), key: Key('loan-order-${o.key}-accounts'), style: theme.textTheme.bodyMedium),
          if (o.fromProject != null || o.toProject != null)
            Text(t.loanFlow(o.fromProject?.label ?? '—', o.toProject?.label ?? '—'), style: pkMetaStyle(context)),
          Text(
            [
              if (o.date != null) formatDateOnly(o.date),
              if (o.submittedBy?.name != null) t.loanSubmittedBy(o.submittedBy!.name!),
            ].join(' · '),
            style: pkMetaStyle(context),
          ),
          if ((o.note ?? o.reason).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(o.note ?? o.reason, maxLines: 2, overflow: TextOverflow.ellipsis),
            ),
          if (o.selfSubmitted)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                t.loanTransferOrderSelf,
                key: Key('loan-order-${o.key}-self'),
                style: theme.textTheme.bodySmall?.copyWith(color: context.pk.warnText, fontWeight: FontWeight.w600),
              ),
            ),
          if (o.canExecute) ...[
            const SizedBox(height: 12),
            OnlineOnlyButton(
              key: Key('loan-order-${o.key}-execute'),
              label: t.loanTransferOrderExecute,
              icon: Icons.account_balance,
              onPressed: _busy ? null : _execute,
            ),
          ],
        ],
      ),
    );
  }
}

/// "Catat transfer": the frozen accounts and the amount (read-only), the transfer date (loan date … today), a note.
class _ExecuteSheet extends StatefulWidget {
  const _ExecuteSheet({required this.order});
  final LoanTransferOrder order;

  @override
  State<_ExecuteSheet> createState() => _ExecuteSheetState();
}

class _ExecuteSheetState extends State<_ExecuteSheet> {
  final _note = TextEditingController();
  late final String _today = widget.order.today ?? toYmd(DateTime.now());
  late String _date = _today;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final last = DateTime.parse(_today);
    final first = DateTime.tryParse(widget.order.minDate ?? '') ?? DateTime(last.year - 1);
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(_date),
      firstDate: first.isAfter(last) ? last : first,
      lastDate: last,
    );
    if (d != null && mounted) setState(() => _date = toYmd(d));
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final o = widget.order;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            t.loanTransferOrderExecuteTitle(o.docNo ?? '#${o.loanId}'),
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            t.loanTransferOrderExecuteBody(
              formatRupiah(o.amount),
              o.fromAccount?.label ?? '—',
              o.toAccount?.label ?? '—',
            ),
            key: const Key('loan-order-execute-body'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          InkWell(
            key: const Key('loan-order-execute-date'),
            onTap: _pickDate,
            child: InputDecorator(
              decoration: InputDecoration(labelText: t.loanTransferOrderDate, suffixIcon: const Icon(Icons.event)),
              child: Text(formatDateOnly(_date)),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('loan-order-execute-note'),
            controller: _note,
            maxLength: 500,
            decoration: InputDecoration(labelText: t.loanRepayNote),
          ),
          const SizedBox(height: 8),
          FilledButton(
            key: const Key('loan-order-execute-save'),
            onPressed: () => Navigator.pop(context, (date: _date, note: _note.text)),
            child: Text(t.loanTransferOrderExecute),
          ),
          TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        ],
      ),
    );
  }
}
