import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/doc_no_chip.dart';
import '../../../shared/widgets/form_grid.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../expense/application/expense_providers.dart';
import '../../expense/presentation/receipt_capture.dart';
import '../../expense/presentation/widgets/master_picker.dart';
import '../../finance/application/finance_providers.dart';
import '../../finance/domain/transfer_queue.dart';
import '../../finance/presentation/transfer_form_screen.dart';
import '../../masters/domain/master_item.dart';
import '../domain/intercompany_loan.dart';
import 'intercompany_loan_providers.dart';

/// ADR 0029 "Pinjaman antar-PT" on the APK (online only): the Owner's instruction form (opened from the fund panel of
/// a short request), the read-only loan detail (notifications `icloan.*` deep-link here; repayments and voids are shown,
/// recorded on the web) and Finance's disbursement form (reusing the transfer form: source account without site, date +
/// time of the bank proof, bank reference, proof photo, overdraft confirmation).

String _today() => toYmd(DateTime.now());

/// Route of the loan detail.
String icLoanPath(int id) => '/intercompany-loans/$id';

/// Status chip: icon + label (never colour alone).
class IcLoanStatusChip extends StatelessWidget {
  const IcLoanStatusChip({super.key, required this.loan});
  final IcLoan loan;

  @override
  Widget build(BuildContext context) {
    final (IconData icon, Color? color) = switch (loan.status) {
      IcLoanStatus.instructed => (Icons.hourglass_top, context.pk.warnText),
      IcLoanStatus.disbursed || IcLoanStatus.partiallyRepaid => (Icons.check_circle_outline, context.pk.okText),
      IcLoanStatus.repaid => (Icons.check_circle, context.pk.okText),
      IcLoanStatus.cancelled => (Icons.block, null),
    };
    return Chip(
      key: Key('icloan-status-${loan.id}'),
      avatar: Icon(icon, size: 18, color: color),
      label: Text(loan.label, overflow: TextOverflow.ellipsis),
      visualDensity: VisualDensity.compact,
    );
  }
}

// ---------------------------------------------------------------------------------------------------- instruction

/// `/intercompany-loans/new?borrower=&amount=&requests=`: the Owner orders PT X (lender) to lend to the short PT
/// (borrower). Lender list from `GET /intercompany-loans/lenders` (each PT's "Dana tersedia"; PTs short of the amount are
/// disabled), amount default = the gap, due date default = `defaultDueDate` (+30 days), reason required, the requests
/// waiting at their final step as optional links (pre-ticked: the request the form was opened from).
class IcLoanInstructScreen extends ConsumerStatefulWidget {
  const IcLoanInstructScreen({super.key, required this.borrowerId, this.amount, this.requestIds = const []});
  final int borrowerId;

  /// The gap of the request the form was opened from (fund panel); null = computed from the ticked requests.
  final int? amount;
  final List<int> requestIds;

  @override
  ConsumerState<IcLoanInstructScreen> createState() => _IcLoanInstructScreenState();
}

class _IcLoanInstructScreenState extends ConsumerState<IcLoanInstructScreen> {
  late final _amount = TextEditingController(text: widget.amount == null ? '' : groupRupiah(widget.amount));
  final _reason = TextEditingController();
  late final Set<int> _requestIds = {...widget.requestIds};
  int? _lenderId;
  String? _dueDate;
  bool _seeded = false;
  bool _busy = false;
  Map<String, String> _errors = const {};
  String? _error;

  /// One idempotency key per distinct body (a retry of the same body replays; another body needs a new key).
  final _keys = <String, String>{};

  ({int borrower, int? amount}) get _query => (borrower: widget.borrowerId, amount: widget.amount);

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  /// First data: due date default and — opened without an amount — the gap of the pre-ticked requests.
  void _seed(IcLenderOptions o) {
    if (_seeded) return;
    _seeded = true;
    _dueDate = o.defaultDueDate.isEmpty ? null : o.defaultDueDate;
    if (widget.amount == null && _requestIds.isNotEmpty) {
      final gap = _gapOf(o, _requestIds);
      if (gap > 0) _amount.text = groupRupiah(gap);
    }
  }

  /// Σ needed of [ids] − the borrower's availability (≥ 0) — the web's "Hitung" for a selection.
  static int _gapOf(IcLenderOptions o, Set<int> ids) {
    final need = o.borrower.waiting.where((w) => ids.contains(w.id)).fold<int>(0, (s, w) => s + w.needed);
    final gap = need - o.borrower.available;
    return gap < 0 ? 0 : gap;
  }

  void _calcAll(IcLenderOptions o) => setState(() {
    _requestIds
      ..clear()
      ..addAll(o.borrower.waiting.map((w) => w.id));
    _amount.text = groupRupiah(o.borrower.gapAll);
  });

  Future<void> _pickDue() async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_dueDate ?? '') ?? today.add(const Duration(days: 30)),
      firstDate: today,
      lastDate: today.add(const Duration(days: 365 * 5)),
    );
    if (picked != null) setState(() => _dueDate = toYmd(picked));
  }

  Future<void> _submit(IcLenderOptions o) async {
    final t = AppLocalizations.of(context);
    final amount = parseRupiah(_amount.text);
    final lender = o.lenders.where((l) => l.company.id == _lenderId).firstOrNull;
    final errors = validateIcLoanInstruction(
      lenderId: _lenderId,
      amount: amount,
      dueDate: _dueDate,
      reason: _reason.text,
      today: _today(),
      lender: lender,
      borrowerHasReceivingAccount: o.borrower.hasReceivingAccount,
    );
    setState(() {
      _errors = errors;
      _error = null;
    });
    if (errors.isNotEmpty || lender == null || amount == null) return;
    final borrowerCode = o.borrower.company?.shortCode ?? '#${widget.borrowerId}';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t.icLoanConfirmTitle),
        content: Text(t.icLoanConfirmBody(lender.company.shortCode, formatRupiah(amount), borrowerCode)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(t.cancel)),
          FilledButton(
            key: const Key('icloan-confirm'),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(t.icLoanSubmit),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final body = icLoanCreateBody(
      borrowerCompanyId: widget.borrowerId,
      lenderCompanyId: lender.company.id,
      amount: amount,
      dueDate: _dueDate!,
      reason: _reason.text,
      requestIds: [
        for (final w in o.borrower.waiting)
          if (_requestIds.contains(w.id)) w.id,
        // a pre-linked request that is no longer listed as waiting (e.g. the Owner's own Draft) stays linked
        for (final id in widget.requestIds)
          if (!o.borrower.waiting.any((w) => w.id == id) && _requestIds.contains(id)) id,
      ],
    );
    setState(() => _busy = true);
    try {
      final key = _keys.putIfAbsent(jsonEncode(body), () => const Uuid().v7());
      final loan = await ref.read(intercompanyLoansApiProvider).instruct(body, idempotencyKey: key);
      for (final id in _requestIds) {
        ref.invalidate(requestDetailProvider(id));
      }
      ref.invalidate(inboxProvider);
      if (!mounted) return;
      showSnack(context, t.icLoanInstructed(loan.docNo));
      final router = GoRouter.maybeOf(context);
      if (router != null) {
        unawaited(router.pushReplacement(icLoanPath(loan.id)));
      } else {
        await Navigator.of(context).maybePop(true);
      }
    } on ProblemException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = icLoanAwareError(e, errorText);
        _errors = {
          ..._errors,
          for (final f in e.errors)
            if (_fieldOf(f.path) case final k?) k: f.message,
        };
      });
      // the lender's availability may have changed meanwhile (409 LOAN_LENDER_INSUFFICIENT)
      if (e.code == loanLenderInsufficientCode) ref.invalidate(icLenderOptionsProvider(_query));
    } on Object catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  static String? _fieldOf(String path) => switch (path.split('.').first) {
    'lenderCompanyId' => 'lender',
    'borrowerCompanyId' => 'borrower',
    'amount' => 'amount',
    'dueDate' => 'dueDate',
    'reason' => 'reason',
    'requestIds' => 'requests',
    _ => null,
  };

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final provider = icLenderOptionsProvider(_query);
    return Scaffold(
      appBar: AppBar(title: Text(t.icLoanInstructTitle)),
      body: AsyncBody<IcLenderOptions>(
        value: ref.watch(provider),
        onRetry: () => ref.invalidate(provider),
        data: (o) {
          _seed(o);
          return AbsorbPointer(absorbing: _busy, child: _form(context, o));
        },
      ),
    );
  }

  Widget _form(BuildContext context, IcLenderOptions o) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final amount = parseRupiah(_amount.text);
    final b = o.borrower;
    final borrowerCode = b.company?.shortCode ?? '#${widget.borrowerId}';
    final selectedGap = _requestIds.isEmpty ? null : _gapOf(o, _requestIds);
    final money = theme.textTheme.bodyMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
    return ListView(
      key: const Key('icloan-form'),
      padding: const EdgeInsets.all(16),
      children: [
        Text(t.icLoanInstructNote, style: theme.textTheme.bodySmall),
        const SizedBox(height: 12),
        // PT peminjam: its availability (same §1 definition) and the receiving account check
        Card(
          key: const Key('icloan-borrower'),
          margin: EdgeInsets.zero,
          child: ListTile(
            leading: const Icon(Icons.call_received),
            title: Text('${t.icLoanBorrower}: ${b.company?.label ?? borrowerCode}'),
            subtitle: Text(t.icLoanAvailable(formatRupiah(b.available)), style: money),
          ),
        ),
        if (!b.hasReceivingAccount || _errors['borrower'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _errors['borrower'] ?? t.icLoanBorrowerNoAccount,
              key: const Key('icloan-borrower-no-account'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
        const SizedBox(height: 16),
        Text(t.icLoanLender, style: theme.textTheme.titleSmall),
        const SizedBox(height: 4),
        if (o.lenders.isEmpty)
          Text(t.icLoanNoLenders, key: const Key('icloan-no-lenders'))
        else
          for (final l in o.lenders) _lenderTile(context, l, amount),
        if (_errors['lender'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              _errors['lender']!,
              key: const Key('icloan-lender-error'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
        const SizedBox(height: 16),
        FormGrid(
          rowGap: 16,
          children: [
            FormGridCell(
              label: t.icLoanAmount,
              builder: (label) => TextField(
                key: const Key('icloan-amount'),
                controller: _amount,
                keyboardType: TextInputType.number,
                inputFormatters: const [RupiahInputFormatter()],
                decoration: InputDecoration(
                  labelText: label,
                  prefixText: 'Rp ',
                  errorText: _errors['amount'],
                  helperText: _amountHint(t, amount, widget.amount ?? selectedGap),
                  helperMaxLines: 3,
                ),
                onChanged: (_) => setState(() {}),
              ),
            ),
            FormGridCell(
              label: t.icLoanDueDate,
              builder: (label) => InkWell(
                key: const Key('icloan-due-date'),
                onTap: _busy ? null : _pickDue,
                child: InputDecorator(
                  decoration: InputDecoration(
                    labelText: label,
                    helperText: t.icLoanDueHelp,
                    errorText: _errors['dueDate'],
                    suffixIcon: const Icon(Icons.calendar_today),
                  ),
                  child: Text(formatDateOnly(_dueDate), key: const Key('icloan-due-value')),
                ),
              ),
            ),
            FormGridCell(
              label: t.icLoanReason,
              full: true,
              builder: (label) => TextField(
                key: const Key('icloan-reason'),
                controller: _reason,
                minLines: 2,
                maxLines: 5,
                maxLength: 1000,
                decoration: InputDecoration(labelText: label, errorText: _errors['reason']),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(child: Text(t.icLoanRequests, style: theme.textTheme.titleSmall)),
            if (b.waiting.length > 1 && b.gapAll > 0)
              TextButton(
                key: const Key('icloan-calc-all'),
                onPressed: () => _calcAll(o),
                child: Text(t.icLoanCalcAll(formatRupiah(b.gapAll))),
              ),
          ],
        ),
        if (b.waiting.isEmpty)
          Text(t.icLoanRequestsNone, style: theme.textTheme.bodySmall)
        else
          for (final w in b.waiting)
            CheckboxListTile(
              key: Key('icloan-request-${w.id}'),
              contentPadding: EdgeInsets.zero,
              dense: true,
              value: _requestIds.contains(w.id),
              onChanged: (v) => setState(() => v == true ? _requestIds.add(w.id) : _requestIds.remove(w.id)),
              title: Text('${w.label} · ${w.title}', overflow: TextOverflow.ellipsis),
              subtitle: Text(
                '${t.fundNeeded} ${formatRupiah(w.needed)}${w.gap > 0 ? ' · ${t.fundGap(formatRupiah(w.gap))}' : ''}',
              ),
            ),
        if (_errors['requests'] != null) Text(_errors['requests']!, style: TextStyle(color: theme.colorScheme.error)),
        if (_error != null)
          Card(
            key: const Key('icloan-error'),
            color: theme.colorScheme.errorContainer,
            margin: const EdgeInsets.only(top: 16),
            child: Padding(padding: const EdgeInsets.all(12), child: Text(_error!)),
          ),
        const SizedBox(height: 20),
        OnlineOnlyButton(
          key: const Key('icloan-submit'),
          label: _busy ? t.processing : t.icLoanSubmit,
          icon: Icons.send,
          onPressed: _busy || !b.hasReceivingAccount ? null : () => _submit(o),
        ),
        const SizedBox(height: 32),
      ],
    );
  }

  /// "Default = kekurangan dana Rp X"; above / below the gap: a warning only (ADR 0029 §3.2 — several lenders, or a
  /// buffer, are allowed).
  String? _amountHint(AppLocalizations t, int? amount, int? gap) {
    if (gap == null || gap <= 0) return null;
    if (amount == null || amount == gap) return t.icLoanAmountGap(formatRupiah(gap));
    return amount > gap ? t.icLoanAmountAbove : t.icLoanAmountBelow(formatRupiah(gap - amount));
  }

  Widget _lenderTile(BuildContext context, IcLenderOption l, int? amount) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final enough = l.sufficientFor(amount);
    final selected = _lenderId == l.company.id;
    return Card(
      key: Key('icloan-lender-${l.company.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: selected ? theme.colorScheme.primary : theme.colorScheme.outlineVariant),
      ),
      child: ListTile(
        enabled: enough,
        selected: selected,
        leading: Icon(selected ? Icons.radio_button_checked : Icons.radio_button_unchecked),
        title: Text(l.company.label),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t.icLoanAvailable(formatRupiah(l.available)), key: Key('icloan-lender-${l.company.id}-available')),
            if (!enough)
              Text(
                t.icLoanLenderShort,
                key: Key('icloan-lender-${l.company.id}-short'),
                style: TextStyle(color: context.pk.badText),
              ),
            if (l.warning != null || !l.hasReceivingAccount)
              Text(
                l.warning ?? t.icLoanLenderNoAccount,
                key: Key('icloan-lender-${l.company.id}-warning'),
                style: TextStyle(color: context.pk.warnText),
              ),
          ],
        ),
        onTap: enough ? () => setState(() => _lenderId = l.company.id) : null,
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------------- detail

/// `/intercompany-loans/:id`: figures, notes, linked requests, movements (read-only; repayments and voids are recorded on
/// the web) and — for Finance of the lender while it waits — "Catat pencairan".
class IcLoanDetailScreen extends ConsumerWidget {
  const IcLoanDetailScreen({super.key, required this.id});
  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(icLoanDetailProvider(id));
    return Scaffold(
      appBar: AppBar(title: Text(value.value?.docNo ?? t.icLoanTitle, overflow: TextOverflow.ellipsis)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(icLoanDetailProvider(id).future),
        child: AsyncBody<IcLoan>(
          value: value,
          onRetry: () => ref.invalidate(icLoanDetailProvider(id)),
          data: (l) => _IcLoanBody(loan: l),
        ),
      ),
      bottomNavigationBar: switch (value) {
        AsyncData(:final value) when value.allowedActions.contains(IcLoanAction.disburse) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: OnlineOnlyButton(
              key: const Key('icloan-action-disburse'),
              label: t.icLoanDisburse,
              icon: Icons.account_balance,
              onPressed: () async {
                await GoRouter.maybeOf(context)?.push('${icLoanPath(id)}/disburse');
                ref.invalidate(icLoanDetailProvider(id));
              },
            ),
          ),
        ),
        _ => null,
      },
    );
  }
}

class _IcLoanBody extends ConsumerWidget {
  const _IcLoanBody({required this.loan});
  final IcLoan loan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final zone = ref.watch(currentProfileProvider)?.timezone;
    final l = loan;
    Widget row(String k, String v, {Key? key, TextStyle? style}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 140, child: Text(k, style: theme.textTheme.bodySmall)),
          Expanded(
            child: Text(v, key: key, style: style),
          ),
        ],
      ),
    );
    Widget section(String title) => Padding(
      padding: const EdgeInsets.only(top: 16, bottom: 4),
      child: Text(title, style: theme.textTheme.titleMedium),
    );
    Widget note(String text, {Key? key, Color? color}) => Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        key: key,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 18, color: color ?? theme.colorScheme.primary),
          const SizedBox(width: 6),
          Expanded(
            child: Text(text, style: theme.textTheme.bodySmall?.copyWith(color: color)),
          ),
        ],
      ),
    );
    final money = theme.textTheme.bodyMedium?.copyWith(
      fontWeight: FontWeight.w600,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    final side = switch (l.side) {
      'lender' => t.icLoanSideLender,
      'borrower' => t.icLoanSideBorrower,
      _ => null,
    };
    return ListView(
      key: const Key('icloan-detail'),
      padding: const EdgeInsets.all(16),
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            DocNoChip(docNo: l.docNo),
            IcLoanStatusChip(loan: l),
            if (l.overdue)
              Chip(
                key: Key('icloan-overdue-${l.id}'),
                avatar: Icon(Icons.warning_amber, size: 18, color: context.pk.warnText),
                label: Text(t.loanOverdueDays(l.daysOverdue), style: TextStyle(color: context.pk.warnText)),
                visualDensity: VisualDensity.compact,
              ),
            if (side != null) Chip(label: Text(side), visualDensity: VisualDensity.compact),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          t.icLoanFlow(l.lenderCode, l.borrowerCode),
          key: const Key('icloan-flow'),
          style: theme.textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        row(t.icLoanLender, l.lender?.label ?? '-', key: const Key('icloan-lender-value')),
        row(t.icLoanBorrower, l.borrower?.label ?? '-', key: const Key('icloan-borrower-value')),
        row(t.icLoanAmount, formatRupiah(l.amount), key: const Key('icloan-amount-value'), style: money),
        if (l.status.active) ...[
          row(t.icLoanRepaid, formatRupiah(l.repaidTotal), key: const Key('icloan-repaid-value'), style: money),
          row(
            t.icLoanOutstanding,
            formatRupiah(l.outstanding),
            key: const Key('icloan-outstanding-value'),
            style: money?.copyWith(color: l.overdue ? context.pk.warnText : null),
          ),
        ],
        row(t.icLoanInstructionDate, formatDateOnly(l.instructionDate)),
        row(
          t.icLoanDueDate,
          '${formatDateOnly(l.dueDate)} · ${t.icLoanNoInterest}',
          key: const Key('icloan-due-value'),
        ),
        if (l.createdByName != null) row(t.icLoanCreatedBy, l.createdByName!),
        section(t.icLoanReason),
        Text(l.reason, key: const Key('icloan-reason-value')),
        if (l.ownRequestNote != null) note(l.ownRequestNote!, key: const Key('icloan-own-request')),
        if (l.droppedRequestNote != null)
          note(l.droppedRequestNote!, key: const Key('icloan-dropped-request'), color: context.pk.warnText),
        if (l.disburseBlockedByG1) note(t.icLoanG1Blocked, key: const Key('icloan-g1'), color: context.pk.warnText),
        if (!l.lenderHasReceivingAccount && l.status.active)
          note(
            t.icLoanNoLenderAccount(l.lenderCode),
            key: const Key('icloan-lender-no-account'),
            color: context.pk.warnText,
          ),
        if (l.cancelReason != null)
          note(
            t.icLoanCancelledBecause(l.cancelReason!),
            key: const Key('icloan-cancelled'),
            color: context.pk.badText,
          ),
        if (l.requests.isNotEmpty) ...[
          section(t.icLoanRequests),
          for (final r in l.requests)
            ListTile(
              key: Key('icloan-request-${r.id}'),
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: const Icon(Icons.receipt_long_outlined),
              title: Text([r.label, ?r.title].join(' · '), overflow: TextOverflow.ellipsis),
              subtitle: r.statusLabel == null && r.grandTotal == null
                  ? null
                  : Text([?r.statusLabel, if (r.grandTotal != null) formatRupiah(r.grandTotal!)].join(' · ')),
              // only the borrower's people get the title: they may open the request
              trailing: r.title == null ? null : const Icon(Icons.chevron_right),
              onTap: r.title == null ? null : () => GoRouter.maybeOf(context)?.push('/requests/${r.id}'),
            ),
        ],
        section(t.icLoanMovements),
        if (l.movements.isEmpty)
          Text(t.icLoanMovementsEmpty, key: const Key('icloan-movements-empty'), style: theme.textTheme.bodySmall)
        else
          for (final m in l.movements) _MovementTile(m: m, zone: zone),
        note(t.icLoanWebOnlyHint, key: const Key('icloan-web-hint')),
        const SizedBox(height: 80),
      ],
    );
  }
}

class _MovementTile extends StatelessWidget {
  const _MovementTile({required this.m, this.zone});
  final IcLoanMovement m;
  final String? zone;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final strike = m.posted ? null : const TextStyle(decoration: TextDecoration.lineThrough);
    final when = m.transferAt != null ? formatServerDateTime(m.transferAt, zone: zone) : formatDateOnly(m.transferDate);
    final entries = [if (m.kkNo != null) 'KK ${m.kkNo}', if (m.kmNo != null) 'KM ${m.kmNo}'].join(' · ');
    return Card(
      key: Key('icloan-movement-${m.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(m.label, style: theme.textTheme.labelLarge)),
                Text(
                  formatRupiah(m.amount),
                  style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700).merge(strike),
                ),
              ],
            ),
            Text([when, ?m.executedByName].join(' · '), style: theme.textTheme.bodySmall?.merge(strike)),
            if (entries.isNotEmpty)
              Text(
                entries,
                key: Key('icloan-movement-${m.id}-entries'),
                style: theme.textTheme.bodySmall?.merge(strike),
              ),
            if (m.fromAccountName != null || m.toAccountNoMasked != null)
              Text(
                [
                  ?m.fromAccountName,
                  if (m.toAccountNoMasked != null) '→ ${m.toAccountName ?? ''} ${m.toAccountNoMasked}'.trim(),
                ].join(' '),
                style: theme.textTheme.bodySmall?.merge(strike),
              ),
            if (m.bankRef != null)
              Text('${t.bankRefLabel}: ${m.bankRef}', style: theme.textTheme.bodySmall?.merge(strike)),
            if (!m.posted)
              Text(
                m.voidReason == null ? t.icLoanMovementVoid : t.icLoanMovementVoidReason(m.voidReason!),
                key: Key('icloan-movement-void-${m.id}'),
                style: theme.textTheme.bodySmall?.copyWith(color: context.pk.badText),
              ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------------- disbursement

/// `/intercompany-loans/:id/disburse`: the loan (detail) while the server offers `disburse` to the caller, with the
/// borrower's receiving account from the disbursement queue when it is loaded.
class IcLoanDisburseRoute extends ConsumerWidget {
  const IcLoanDisburseRoute({super.key, required this.id});
  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final queued = ref.watch(icLoanQueueProvider).value?.items.where((i) => i.id == id).firstOrNull;
    return AsyncBody<IcLoan>(
      value: ref.watch(icLoanDetailProvider(id)),
      onRetry: () => ref.invalidate(icLoanDetailProvider(id)),
      data: (loan) {
        if (!loan.allowedActions.contains(IcLoanAction.disburse)) {
          return Scaffold(
            appBar: AppBar(title: Text(t.icLoanDisburseTitle)),
            body: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                loan.disburseBlockedByG1 ? t.icLoanG1Blocked : t.icLoanNotInQueue,
                key: const Key('icloan-not-disbursable'),
              ),
            ),
          );
        }
        return IcLoanDisburseScreen(loan: loan, destination: queued?.destination, destinationKnown: queued != null);
      },
    );
  }
}

/// "Catat pencairan" (Finance of the LENDER): the transfer form without a cost center — source account of the lender
/// WITHOUT a site (the fund pool), date + time of the bank proof (lender zone), bank reference, proof photo; a
/// confirmable 409 (overdraft, QA-04) asks "Tetap simpan". The amount is the loan amount (server-set).
class IcLoanDisburseScreen extends ConsumerStatefulWidget {
  const IcLoanDisburseScreen({super.key, required this.loan, this.destination, this.destinationKnown = true});
  final IcLoan loan;
  final IcLoanDestination? destination;

  /// The queue was loaded: a null [destination] then means "none designated" (the disbursement will be refused).
  final bool destinationKnown;

  @override
  ConsumerState<IcLoanDisburseScreen> createState() => _IcLoanDisburseScreenState();
}

class _IcLoanDisburseScreenState extends ConsumerState<IcLoanDisburseScreen> {
  final _bankRef = TextEditingController();
  int? _cashAccountId;
  DateTime? _at;
  Uint8List? _proof;
  int? _proofMediaId;
  bool _busy = false;
  bool _tried = false;
  String? _error;
  final _keys = <String, String>{};

  int? get _lenderId => widget.loan.lender?.id;

  Duration get _zoneOffset => offsetForZone(ref.read(accountProfileProvider)?.forCompany(_lenderId).timezone);

  @override
  void dispose() {
    _bankRef.dispose();
    super.dispose();
  }

  Map<String, String> _issues() => validateTransferForm(
    cashAccountId: _cashAccountId,
    costCenterId: null,
    requireCostCenter: false,
    transferAt: _at,
    zoneOffset: _zoneOffset,
    bankRef: _bankRef.text,
    hasProof: _proof != null,
    nowUtc: DateTime.now().toUtc(),
  );

  Future<void> _addProof({required bool fromCamera}) async {
    final t = AppLocalizations.of(context);
    final raw = await ref.read(proofPickerProvider)(context, fromCamera: fromCamera);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final photo = await ref
          .read(photoCompressorProvider)
          .compress(raw, receiptTargetFor(ref.read(currentProfileProvider)));
      setState(() {
        _proof = photo.bytes;
        _proofMediaId = null;
      });
    } on PhotoTooLargeException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on Object {
      if (mounted) showSnack(context, t.cameraUnavailable);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit({bool confirmOverdraft = false}) async {
    final t = AppLocalizations.of(context);
    setState(() {
      _tried = true;
      _error = null;
    });
    if (_issues().isNotEmpty) return;
    setState(() => _busy = true);
    final loan = widget.loan;
    try {
      _proofMediaId ??= await ref
          .read(financeApiProvider)
          .uploadProof(_proof!, filename: 'bukti-pencairan-${loan.id}.jpg');
      final body = icLoanDisburseBody(
        cashAccountId: _cashAccountId!,
        transferAt: transferAtString(_at!, _zoneOffset),
        bankRef: _bankRef.text,
        proofMediaId: _proofMediaId!,
        confirmOverdraft: confirmOverdraft,
      );
      final key = _keys.putIfAbsent(jsonEncode(body), () => const Uuid().v7());
      final out = await ref.read(intercompanyLoansApiProvider).disburse(loan.id, body, idempotencyKey: key);
      ref.invalidate(icLoanQueueProvider);
      ref.invalidate(icLoanDetailProvider(loan.id));
      if (_lenderId != null) ref.invalidate(cashAccountsProvider(_lenderId));
      if (!mounted) return;
      final kk = out.disbursement?.kkNo;
      final km = out.disbursement?.kmNo;
      showSnack(
        context,
        kk != null && km != null ? t.icLoanDisbursed(out.docNo, kk, km) : t.icLoanDisbursedShort(out.docNo),
      );
      final router = GoRouter.maybeOf(context);
      if (router != null && router.canPop()) {
        router.pop(true);
      } else {
        await Navigator.of(context).maybePop(true);
      }
    } on ProblemException catch (e) {
      final prompt = transferOverridePrompt(t, e);
      if (!mounted) return;
      if (prompt == null || prompt.flag != 'confirmOverdraft') {
        setState(() => _error = icLoanAwareError(e, errorText));
        if (e.code == loanLenderInsufficientCode) ref.invalidate(icLoanQueueProvider);
        return;
      }
      setState(() => _busy = false);
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(prompt.title),
          content: Text(prompt.lines.join('\n\n')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
            FilledButton(
              key: const Key('icloan-override-confirm'),
              onPressed: () => Navigator.pop(c, true),
              child: Text(t.overrideConfirm),
            ),
          ],
        ),
      );
      if (!mounted) return;
      if (ok != true) {
        setState(() => _error = t.overrideCancelled);
        return;
      }
      await _submit(confirmOverdraft: true);
    } on Object catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final loan = widget.loan;
    final issues = _tried ? _issues() : const <String, String>{};
    final accounts = ref.watch(cashAccountsProvider(_lenderId));
    // ADR 0029 §3.5: only active accounts WITHOUT a site (the PT's fund pool) pay an inter-PT loan
    final pool = (accounts.value ?? const <CashAccountOption>[]).where((a) => a.active && a.siteId == null).toList();
    if (_cashAccountId == null && pool.isNotEmpty) _cashAccountId = pool.first.id;
    final zone = zoneAbbrev(ref.watch(accountProfileProvider)?.forCompany(_lenderId).timezone);
    final destination = widget.destination;
    return Scaffold(
      appBar: AppBar(title: Text(t.icLoanDisburseTitle)),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              key: const Key('icloan-disburse-amount-card'),
              color: theme.colorScheme.primaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      t.icLoanDisburseAmount(formatRupiah(loan.amount), loan.lenderCode, loan.borrowerCode),
                      key: const Key('icloan-disburse-amount'),
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    Text(t.icLoanDisburseHelp, style: theme.textTheme.bodySmall),
                    const Divider(height: 20),
                    Text(
                      '${loan.docNo} · ${t.loanDueOn(formatDateOnly(loan.dueDate))}',
                      style: theme.textTheme.bodyMedium,
                    ),
                    if (destination != null)
                      Text(
                        '${t.bankDestination}: ${destination.text}',
                        key: const Key('icloan-destination'),
                        style: theme.textTheme.bodySmall,
                      )
                    else if (widget.destinationKnown)
                      Text(
                        t.icLoanDestinationNone,
                        key: const Key('icloan-destination-none'),
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            FormGrid(
              children: [
                FormGridCell(
                  label: t.cashAccountLabel,
                  child: switch (accounts) {
                    AsyncError(:final error) => Text(
                      errorText(error),
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                    AsyncData() when pool.isEmpty => Text(
                      t.icLoanNoAccounts,
                      key: const Key('icloan-no-accounts'),
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                    _ => MasterPickerField(
                      key: const Key('icloan-cash-account'),
                      label: t.cashAccountLabel,
                      items: [
                        for (final a in pool)
                          MasterItem(a.id, a.balance == null ? a.name : '${a.name} · ${formatRupiah(a.balance!)}'),
                      ],
                      value: _cashAccountId,
                      allowNone: false,
                      errorText: issues['cashAccountId'],
                      helperText: t.icLoanAccountHelp,
                      onChanged: (v) => setState(() => _cashAccountId = v),
                    ),
                  },
                ),
                FormGridCell(
                  label: t.transferAtLabel,
                  builder: (label) => InkWell(
                    key: const Key('transfer-at'),
                    onTap: () async {
                      final at = await pickTransferAt(context, zoneOffset: _zoneOffset, current: _at);
                      if (at != null && mounted) setState(() => _at = at);
                    },
                    child: InputDecorator(
                      decoration: InputDecoration(
                        labelText: label,
                        helperText: t.transferAtHelp,
                        errorText: issues['transferAt'],
                        suffixIcon: const Icon(Icons.event),
                      ),
                      child: Text(
                        _at == null ? t.transferAtHint : transferAtText(_at!, zone),
                        style: _at == null ? theme.textTheme.bodyLarge?.copyWith(color: theme.hintColor) : null,
                      ),
                    ),
                  ),
                ),
                FormGridCell(
                  label: t.bankRefLabel,
                  builder: (label) => TextField(
                    key: const Key('transfer-bank-ref'),
                    controller: _bankRef,
                    maxLength: 64,
                    decoration: InputDecoration(
                      labelText: label,
                      hintText: t.bankRefHint,
                      errorText: issues['bankRef'],
                    ),
                    onChanged: (_) => _tried ? setState(() {}) : null,
                  ),
                ),
                FormGridCell(
                  label: t.transferProofLabel,
                  full: true,
                  stackedLabel: true,
                  child: TransferProofPicker(
                    proof: _proof,
                    error: issues['proof'],
                    onAdd: (fromCamera) => _addProof(fromCamera: fromCamera),
                  ),
                ),
              ],
            ),
            if (_error != null)
              Card(
                key: const Key('icloan-disburse-error'),
                color: theme.colorScheme.errorContainer,
                margin: const EdgeInsets.only(top: 16),
                child: Padding(padding: const EdgeInsets.all(12), child: Text(_error!)),
              ),
            const SizedBox(height: 20),
            OnlineOnlyButton(
              key: const Key('icloan-disburse-submit'),
              label: _busy ? t.processing : t.icLoanDisburse,
              icon: Icons.account_balance,
              onPressed: _busy ? null : _submit,
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------------- Finance queue

/// "Pencairan pinjaman antar-PT" above the transfer queue (Finance with `disburseIntercompanyLoan` in the selection):
/// instructed loans whose LENDER is a PT where the caller is Finance. Hidden when empty, when the server is older or
/// the queue cannot be loaded (the transfer queue below stays usable).
class IcLoanQueueSection extends ConsumerWidget {
  const IcLoanQueueSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final allowed = ref.watch(currentProfileProvider)?.capabilities.disburseIntercompanyLoan ?? false;
    if (!allowed) return const SizedBox.shrink();
    final t = AppLocalizations.of(context);
    final value = ref.watch(icLoanQueueProvider);
    final items = value.value?.items ?? const <IcLoan>[];
    if (value.hasError || items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        key: const Key('icloan-queue'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
            child: Text(t.icLoanQueueTitle(items.length), style: Theme.of(context).textTheme.titleMedium),
          ),
          for (final l in items) IcLoanQueueCard(loan: l),
          const Divider(height: 16),
        ],
      ),
    );
  }
}

/// One instructed loan: PJA number, lender → borrower, amount, due date, destination, G1 note, "Catat pencairan".
class IcLoanQueueCard extends ConsumerWidget {
  const IcLoanQueueCard({super.key, required this.loan});
  final IcLoan loan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final l = loan;
    // Finance IN the lender PT (the server re-checks; G1: never the instruction's creator)
    final finance = ref.watch(accountProfileProvider)?.forCompany(l.lender?.id).has(Role.finance) ?? false;
    final can = finance && l.canDisburse != false;
    return Card(
      key: Key('icloan-q-${l.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push(icLoanPath(l.id)),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l.docNo, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary)),
                        Text(t.icLoanFlow(l.lenderCode, l.borrowerCode), style: theme.textTheme.titleMedium),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    formatRupiah(l.amount),
                    key: Key('icloan-q-${l.id}-amount'),
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
              Text(
                '${formatDateOnly(l.instructionDate)} · ${t.loanDueOn(formatDateOnly(l.dueDate))}',
                style: theme.textTheme.bodySmall,
              ),
              if (l.reason.isNotEmpty) Text(l.reason, maxLines: 2, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 4),
              Text(
                l.destination == null ? t.icLoanDestinationNone : '${t.bankDestination}: ${l.destination!.text}',
                key: Key('icloan-q-${l.id}-destination'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: l.destination == null ? theme.colorScheme.error : null,
                ),
              ),
              if (l.g1Note != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    l.g1Note!,
                    key: Key('icloan-q-${l.id}-g1'),
                    style: theme.textTheme.bodySmall?.copyWith(color: context.pk.warnText, fontWeight: FontWeight.w600),
                  ),
                ),
              if (can) ...[
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    key: Key('icloan-q-${l.id}-disburse'),
                    onPressed: () => context.push('${icLoanPath(l.id)}/disburse'),
                    icon: const Icon(Icons.account_balance),
                    label: Text(t.icLoanDisburse),
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
