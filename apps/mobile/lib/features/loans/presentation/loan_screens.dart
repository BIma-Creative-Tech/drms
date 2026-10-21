import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/doc_no_chip.dart';
import '../../../shared/widgets/form_grid.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../../shared/widgets/pick_hint.dart';
import '../../../shared/widgets/reason_dialog.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../finance/application/finance_providers.dart';
import '../../finance/presentation/transfer_form_screen.dart' show transferOverridePrompt;
import '../domain/loan.dart';
import 'loan_providers.dart';
import 'loan_widgets.dart';

/// ADR 0022 on the APK (online only): the "Pinjaman" tab of a project, the Draft form of the borrower PM and the
/// detail with the Direktur decision bar. Phase 3 (user 2026-10-19): "Catat pengembalian" (borrower PM / Finance) and
/// the void of a repayment (Direktur / Finance) as on the web. ADR 0031: Finance "Cairkan" of a cash-backed loan, the
/// KK / KM numbers, automatic loans of a transfer (lender = the paying account).

String _today() => toYmd(DateTime.now());

/// "Pinjaman" tab of the project screen: the project's loans as lender and as borrower; "Ajukan pinjaman" for the
/// PM of the project (it is in `options.borrowers`).
class ProjectLoansTab extends ConsumerWidget {
  const ProjectLoansTab({super.key, required this.projectId});
  final int projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final provider = projectLoansProvider(projectId);
    final canCreate = ref.watch(loanOptionsProvider).value?.canBorrowFor(projectId) ?? false;
    return RefreshIndicator(
      onRefresh: () {
        ref.invalidate(loanOptionsProvider);
        return ref.refresh(provider.future);
      },
      child: AsyncBody<LoanPage>(
        value: ref.watch(provider),
        onRetry: () => ref.invalidate(provider),
        data: (page) => ListView(
          key: const Key('project-loans'),
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
          children: [
            if (canCreate)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: OnlineOnlyButton(
                  key: const Key('loan-new'),
                  label: t.loanNew,
                  icon: Icons.add,
                  onPressed: () async {
                    await context.push('/loans/new?project=$projectId');
                    ref.invalidate(provider);
                  },
                ),
              ),
            if (page.items.isEmpty)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Center(
                  child: Text(t.loanEmpty, key: const Key('project-loans-empty'), textAlign: TextAlign.center),
                ),
              ),
            for (final l in page.items) LoanCard(loan: l, projectId: projectId),
          ],
        ),
      ),
    );
  }
}

/// `/loans/:id/edit`: the form in edit mode while the server still allows `edit` (Draft, creator PM).
class LoanEditRoute extends ConsumerStatefulWidget {
  const LoanEditRoute({super.key, required this.id});
  final int id;

  @override
  ConsumerState<LoanEditRoute> createState() => _LoanEditRouteState();
}

class _LoanEditRouteState extends ConsumerState<LoanEditRoute> {
  Loan? _editable;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    if (_editable case final l?) return LoanFormScreen(initial: l);
    final value = ref.watch(loanDetailProvider(widget.id));
    final l = value.value;
    if (l != null && l.allowedActions.contains(LoanAction.edit)) {
      _editable = l;
      return LoanFormScreen(initial: l);
    }
    return Scaffold(
      appBar: AppBar(title: Text(t.loanEditTitle)),
      body: AsyncBody<Loan>(
        value: value,
        onRetry: () => ref.invalidate(loanDetailProvider(widget.id)),
        data: (_) => Padding(
          padding: const EdgeInsets.all(24),
          child: Text(t.loanNotEditable, key: const Key('loan-not-editable')),
        ),
      ),
    );
  }
}

/// Create (PM of the borrower project) or edit a Draft. "Simpan draft" or "Ajukan ke Direktur" (confirmed).
class LoanFormScreen extends ConsumerStatefulWidget {
  const LoanFormScreen({super.key, this.initial, this.projectId});
  final Loan? initial;

  /// Opened from a project's "Pinjaman" tab: that project is the borrower (fixed).
  final int? projectId;

  @override
  ConsumerState<LoanFormScreen> createState() => _LoanFormScreenState();
}

class _LoanFormScreenState extends ConsumerState<LoanFormScreen> {
  late final _amount = TextEditingController(text: widget.initial == null ? '' : groupRupiah(widget.initial!.amount));
  late final _reason = TextEditingController(text: widget.initial?.reason ?? '');
  late int? _borrowerId = widget.initial?.borrower.id ?? widget.projectId;
  late int? _lenderId = widget.initial?.lender?.id;
  late String _kind = widget.initial?.kind ?? 'dana';
  late String? _loanDate = widget.initial?.loanDate ?? _today();
  late String? _dueDate = widget.initial?.dueDate;
  Map<String, String> _errors = const {};
  bool _busy = false;
  String? _error;
  final _createKey = const Uuid().v7();
  final _submitKey = const Uuid().v7();
  final Map<String, String> _patchKeys = {};

  bool get _editing => widget.initial != null;

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<bool> _confirmSubmit() async {
    final t = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t.loanSubmitConfirmTitle),
        content: Text(t.loanSubmitConfirmBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(t.cancel)),
          FilledButton(
            key: const Key('loan-submit-confirm'),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(t.loanSubmit),
          ),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _save({required bool submit}) async {
    final t = AppLocalizations.of(context);
    final amount = parseRupiah(_amount.text);
    final errors = validateLoan(
      borrowerId: _borrowerId,
      lenderId: _lenderId,
      amount: amount,
      reason: _reason.text,
      loanDate: _loanDate,
      dueDate: _dueDate,
      today: _today(),
    );
    setState(() {
      _errors = errors;
      _error = null;
    });
    if (errors.isNotEmpty) return;
    if (submit && !await _confirmSubmit()) return;
    final api = ref.read(loansApiProvider);
    setState(() => _busy = true);
    try {
      final Loan saved;
      if (_editing) {
        final i = widget.initial!;
        final body = '$_lenderId|$_kind|$amount|${_reason.text.trim()}|$_loanDate|$_dueDate';
        await api.update(
          i.id,
          lenderProjectId: _lenderId,
          kind: _kind,
          amount: amount,
          reason: _reason.text,
          loanDate: _loanDate,
          dueDate: _dueDate,
          idempotencyKey: _patchKeys.putIfAbsent(body, () => const Uuid().v7()),
        );
        saved = submit ? await api.submit(i.id, idempotencyKey: _submitKey) : i;
        ref.invalidate(loanDetailProvider(i.id));
      } else {
        saved = await api.create(
          borrowerProjectId: _borrowerId!,
          lenderProjectId: _lenderId!,
          kind: _kind,
          amount: amount!,
          reason: _reason.text,
          loanDate: _loanDate!,
          dueDate: _dueDate!,
          submit: submit,
          idempotencyKey: _createKey,
        );
      }
      if (_borrowerId != null) ref.invalidate(projectLoansProvider(_borrowerId!));
      if (!mounted) return;
      showSnack(context, submit ? t.loanSubmitted : t.loanSavedDraft);
      final router = GoRouter.maybeOf(context);
      if (_editing) {
        if (router != null && router.canPop()) {
          router.pop();
        } else {
          await Navigator.of(context).maybePop();
        }
      } else if (router != null) {
        unawaited(router.pushReplacement('/loans/${saved.id}'));
      } else {
        await Navigator.of(context).maybePop();
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickDate({required bool due}) async {
    final now = DateTime.now();
    final loan = DateTime.tryParse(_loanDate ?? '') ?? now;
    final picked = await showDatePicker(
      context: context,
      initialDate:
          DateTime.tryParse((due ? _dueDate : _loanDate) ?? '') ?? (due ? loan.add(const Duration(days: 30)) : now),
      firstDate: due ? loan : now.subtract(const Duration(days: 366)),
      lastDate: due ? now.add(const Duration(days: 365 * 5)) : now,
    );
    if (picked == null) return;
    setState(() {
      if (due) {
        _dueDate = toYmd(picked);
      } else {
        _loanDate = toYmd(picked);
        if (_dueDate != null && _dueDate!.compareTo(_loanDate!) < 0) _dueDate = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final initial = widget.initial;
    final canSubmit = initial == null || initial.allowedActions.contains(LoanAction.submit);
    final options = ref.watch(loanOptionsProvider);
    // D4: a date input (label left of it on wide screens) instead of a list tile; the error shows under it.
    Widget dateField(String? label, String? value, {required bool due, required String errorKey}) => InkWell(
      key: Key(due ? 'loan-due-date' : 'loan-date'),
      onTap: _busy ? null : () => _pickDate(due: due),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: _errors[errorKey],
          suffixIcon: const Icon(Icons.calendar_today),
        ),
        child: Text(formatDateOnly(value)),
      ),
    );
    return Scaffold(
      appBar: AppBar(title: Text(initial == null ? t.loanNewTitle : t.loanEditTitle)),
      body: AsyncBody<LoanOptions>(
        value: options,
        onRetry: () => ref.invalidate(loanOptionsProvider),
        data: (o) {
          if (initial == null && o.borrowers.isEmpty) {
            return Padding(
              padding: const EdgeInsets.all(24),
              child: Text(t.loanNoBorrower, key: const Key('loan-no-borrower')),
            );
          }
          final fixedBorrower = initial != null || (widget.projectId != null && o.canBorrowFor(widget.projectId!));
          final lenders = o.lendersFor(_borrowerId);
          final borrowerLabel =
              initial?.borrower.label ?? o.borrowers.where((b) => b.id == _borrowerId).firstOrNull?.label ?? '-';
          // An edited Draft keeps its lender even when the option list no longer has it (archived meanwhile).
          final kept = initial?.lender;
          final lenderItems = [
            ...lenders,
            if (kept != null && !lenders.any((l) => l.id == kept.id))
              LoanProjectOption(
                id: kept.id,
                code: kept.code ?? '',
                name: kept.name ?? '',
                companyId: initial?.companyId ?? 0,
              ),
          ];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // DRMS 13/10 Umum #2 / D4: label left of the field, two columns on wide screens.
              FormGrid(
                rowGap: 16,
                children: [
                  if (fixedBorrower)
                    FormGridCell(
                      label: t.loanBorrower,
                      builder: (label) => InputDecorator(
                        key: const Key('loan-borrower-fixed'),
                        decoration: InputDecoration(labelText: label, prefixIcon: const Icon(Icons.call_received)),
                        child: Text(borrowerLabel),
                      ),
                    )
                  else
                    FormGridCell(
                      label: t.loanBorrower,
                      builder: (label) => DropdownButtonFormField<int>(
                        key: const Key('loan-borrower'),
                        hint: Text(pickHintFor(t, t.loanBorrower)),
                        initialValue: _borrowerId,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: label,
                          prefixIcon: const Icon(Icons.call_received),
                          errorText: _errors['borrower'],
                        ),
                        items: [
                          for (final b in o.borrowers)
                            DropdownMenuItem(
                              value: b.id,
                              child: Text(b.label, overflow: TextOverflow.ellipsis),
                            ),
                        ],
                        onChanged: _busy
                            ? null
                            : (v) => setState(() {
                                _borrowerId = v;
                                if (!o.lendersFor(v).any((l) => l.id == _lenderId)) _lenderId = null;
                              }),
                      ),
                    ),
                  FormGridCell(
                    label: t.loanLender,
                    builder: (label) => DropdownButtonFormField<int>(
                      key: ValueKey('loan-lender-$_borrowerId'),
                      hint: Text(pickHintFor(t, t.loanLender)),
                      initialValue: lenderItems.any((l) => l.id == _lenderId) ? _lenderId : null,
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: label,
                        prefixIcon: const Icon(Icons.call_made),
                        errorText: _errors['lender'],
                      ),
                      items: [
                        for (final l in lenderItems)
                          DropdownMenuItem(
                            value: l.id,
                            child: Text(l.label, overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: _busy ? null : (v) => setState(() => _lenderId = v),
                    ),
                  ),
                  FormGridCell(
                    label: t.loanKind,
                    stackedLabel: true,
                    child: SegmentedButton<String>(
                      key: const Key('loan-kind'),
                      segments: [
                        ButtonSegment(
                          value: 'dana',
                          label: Text(t.loanKindDana),
                          icon: const Icon(Icons.payments_outlined),
                        ),
                        ButtonSegment(
                          value: 'barang',
                          label: Text(t.loanKindBarang),
                          icon: const Icon(Icons.inventory_2_outlined),
                        ),
                      ],
                      selected: {_kind},
                      onSelectionChanged: _busy ? null : (s) => setState(() => _kind = s.first),
                    ),
                  ),
                  FormGridCell(
                    label: t.loanAmount,
                    builder: (label) => TextField(
                      key: const Key('loan-amount'),
                      controller: _amount,
                      keyboardType: TextInputType.number,
                      inputFormatters: const [RupiahInputFormatter()],
                      decoration: InputDecoration(labelText: label, prefixText: 'Rp ', errorText: _errors['amount']),
                    ),
                  ),
                  FormGridCell(
                    label: t.loanReason,
                    full: true,
                    builder: (label) => TextField(
                      key: const Key('loan-reason'),
                      controller: _reason,
                      minLines: 2,
                      maxLines: 5,
                      maxLength: 1000,
                      decoration: InputDecoration(labelText: label, errorText: _errors['reason']),
                    ),
                  ),
                  FormGridCell(
                    label: t.loanDate,
                    builder: (label) => dateField(label, _loanDate, due: false, errorKey: 'loanDate'),
                  ),
                  FormGridCell(
                    label: t.loanDueDate,
                    builder: (label) => dateField(label, _dueDate, due: true, errorKey: 'dueDate'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    _error!,
                    key: const Key('loan-error'),
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ),
              if (canSubmit) ...[
                OnlineOnlyButton(
                  key: const Key('loan-submit'),
                  label: t.loanSubmit,
                  icon: Icons.send,
                  onPressed: _busy ? null : () => _save(submit: true),
                ),
                const SizedBox(height: 12),
              ],
              OnlineOnlyButton(
                key: const Key('loan-draft'),
                label: initial == null ? t.loanSaveDraft : t.loanSaveChanges,
                icon: Icons.save_outlined,
                outlined: true,
                onPressed: _busy ? null : () => _save(submit: false),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Loan detail: figures, notes, approval timeline, repayments (read-only) and the actions the server allows —
/// PM: Ubah draft / Ajukan ke Direktur / Batalkan; Direktur: the decision bar (Tolak · Setujui); Finance: Cairkan
/// (ADR 0031).
class LoanDetailScreen extends ConsumerStatefulWidget {
  const LoanDetailScreen({super.key, required this.id});
  final int id;

  @override
  ConsumerState<LoanDetailScreen> createState() => _LoanDetailScreenState();
}

class _LoanDetailScreenState extends ConsumerState<LoanDetailScreen> {
  bool _busy = false;
  final Map<LoanAction, String> _keys = {};

  Future<void> _run(Loan l, LoanAction action) async {
    final t = AppLocalizations.of(context);
    if (action == LoanAction.repay) {
      await _repay(l);
      return;
    }
    if (action == LoanAction.disburse) {
      await _disburse(l);
      return;
    }
    if (action == LoanAction.edit) {
      await GoRouter.maybeOf(context)?.push('/loans/${l.id}/edit');
      ref.invalidate(loanDetailProvider(l.id));
      return;
    }
    String? reason;
    if (action == LoanAction.reject || action == LoanAction.cancel) {
      reason = await showDialog<String>(
        context: context,
        builder: (_) => _ReasonDialog(
          title: action == LoanAction.reject ? t.loanRejectTitle(l.title) : t.loanCancelTitle,
          prompt: action == LoanAction.reject ? t.loanRejectPrompt : t.loanCancelPrompt,
          confirm: action == LoanAction.reject ? t.loanReject : t.loanCancel,
        ),
      );
      if (reason == null) return;
    } else {
      final approve = action == LoanAction.approve;
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(approve ? t.loanApproveTitle(l.title) : t.loanSubmitConfirmTitle),
          content: Text(
            approve
                ? t.loanApproveBody(l.borrower.label, formatRupiah(l.amount), l.lenderLabel)
                : t.loanSubmitConfirmBody,
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(t.cancel)),
            FilledButton(
              key: const Key('loan-confirm'),
              onPressed: () => Navigator.pop(ctx, true),
              child: Text(approve ? t.loanApprove : t.loanSubmit),
            ),
          ],
        ),
      );
      if (ok != true) return;
    }
    final key = _keys.putIfAbsent(action, () => const Uuid().v7());
    final api = ref.read(loansApiProvider);
    setState(() => _busy = true);
    try {
      await switch (action) {
        LoanAction.approve => api.approve(l.id, idempotencyKey: key),
        LoanAction.reject => api.reject(l.id, reason: reason!, idempotencyKey: key),
        LoanAction.cancel => api.cancel(l.id, reason: reason!, idempotencyKey: key),
        LoanAction.submit => api.submit(l.id, idempotencyKey: key),
        LoanAction.edit || LoanAction.repay || LoanAction.disburse => throw StateError('handled above'),
      };
      if (mounted) showSnack(context, action == LoanAction.submit ? t.loanSubmitted : t.loanDone);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message);
    } finally {
      // Also after a refusal (403/409): the buttons must follow the server's current allowedActions.
      ref.invalidate(loanDetailProvider(l.id));
      ref.invalidate(loanInboxProvider);
      ref.invalidate(projectLoansProvider(l.borrower.id));
      if (l.lender case final lender?) ref.invalidate(projectLoansProvider(lender.id));
      ref.invalidate(inboxProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  void _refreshAll(Loan l) {
    ref.invalidate(loanDetailProvider(l.id));
    ref.invalidate(projectLoansProvider(l.borrower.id));
    if (l.lender case final lender?) ref.invalidate(projectLoansProvider(lender.id));
    // ADR 0031: a cash-backed loan moved money between two accounts (balances of the transfer form)
    if (l.cashBacked) ref.invalidate(cashAccountsProvider);
  }

  /// ADR 0031: a cash move that takes the paying account below 0 (409 `CASH_OVERDRAFT_CONFIRM_REQUIRED`) asks
  /// "Tetap simpan" (same dialog as the transfer, QA-04) and is re-sent with `confirmOverdraft` (another body →
  /// another key, see [send]); null when the user keeps the refusal.
  Future<Loan?> _withOverdraftConfirm(Future<Loan> Function({bool confirm}) send) async {
    try {
      return await send();
    } on ProblemException catch (e) {
      if (!mounted) rethrow;
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

  /// "Catat pengembalian" (web RepaymentAction): nominal (≤ sisa), tanggal (loan date … today), catatan. ADR 0031: a
  /// cash-backed loan's repayment posts KK / KM (Finance) — an overdraft asks for the confirmation.
  Future<void> _repay(Loan l) async {
    final t = AppLocalizations.of(context);
    final input = await showModalBottomSheet<({int amount, String date, String note})>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _RepaymentSheet(loan: l),
    );
    if (input == null || !mounted) return;
    final key = _keys.putIfAbsent(LoanAction.repay, () => const Uuid().v7());
    final api = ref.read(loansApiProvider);
    Future<Loan> send({bool confirm = false}) => api.addRepayment(
      l.id,
      amount: input.amount,
      repayDate: input.date,
      note: input.note,
      confirmOverdraft: confirm,
      idempotencyKey: confirm ? '$key-c' : key,
    );
    setState(() => _busy = true);
    try {
      if (await _withOverdraftConfirm(send) == null) {
        if (mounted) showSnack(context, t.overrideCancelled);
        return;
      }
      _keys.remove(LoanAction.repay); // the next repayment is a new one
      if (mounted) showSnack(context, t.loanRepayDone(formatRupiah(input.amount)));
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message);
    } finally {
      _refreshAll(l);
      if (mounted) setState(() => _busy = false);
    }
  }

  /// ADR 0031 "Cairkan" (Finance, web ConfirmAction): KK on the lender's Pusat Biaya + KM on the borrower's for the
  /// loan amount, dated today (PT zone), once.
  Future<void> _disburse(Loan l) async {
    final t = AppLocalizations.of(context);
    final lenderAccount = l.lenderCashAccount?.label ?? '—';
    final borrowerAccount = l.borrowerCashAccount?.label ?? '—';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t.loanDisburseTitle(l.title)),
        content: Text(t.loanDisburseBody(formatRupiah(l.amount), lenderAccount, borrowerAccount)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(t.cancel)),
          FilledButton(
            key: const Key('loan-disburse-confirm'),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(t.loanDisburse),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final key = _keys.putIfAbsent(LoanAction.disburse, () => const Uuid().v7());
    final api = ref.read(loansApiProvider);
    Future<Loan> send({bool confirm = false}) =>
        api.disburse(l.id, confirmOverdraft: confirm, idempotencyKey: confirm ? '$key-c' : key);
    setState(() => _busy = true);
    try {
      final out = await _withOverdraftConfirm(send);
      if (!mounted) return;
      if (out == null) {
        showSnack(context, t.overrideCancelled);
        return;
      }
      final kk = out.disbursement?.kk;
      final km = out.disbursement?.km;
      showSnack(
        context,
        kk != null && km != null ? t.loanDisbursed(out.title, kk, km) : t.loanDisbursedShort(out.title),
      );
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message);
    } finally {
      _refreshAll(l);
      ref.invalidate(cashAccountsProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _voidRepayment(Loan l, LoanRepayment r) async {
    final t = AppLocalizations.of(context);
    final reason = await showReasonDialog(
      context,
      title: t.loanRepaymentVoidTitle(r.seq ?? 0),
      description: t.loanRepaymentVoidBody(formatRupiah(r.amount)),
      confirm: t.loanRepaymentVoidConfirm,
      keyPrefix: 'loan-repayment-void',
    );
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(loansApiProvider).voidRepayment(l.id, r.id, reason: reason, idempotencyKey: const Uuid().v7());
      if (mounted) showSnack(context, t.loanRepaymentVoided);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message);
    } finally {
      _refreshAll(l);
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(loanDetailProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: Text(value.value?.title ?? t.loanTitle, overflow: TextOverflow.ellipsis)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(loanDetailProvider(widget.id).future),
        child: AsyncBody<Loan>(
          value: value,
          onRetry: () => ref.invalidate(loanDetailProvider(widget.id)),
          data: (l) => _LoanBody(
            loan: l,
            busy: _busy,
            onAction: (a) => _run(l, a),
            onVoidRepayment: (r) => _voidRepayment(l, r),
          ),
        ),
      ),
      bottomNavigationBar: switch (value) {
        AsyncData(:final value) => _LoanDecisionBar(loan: value, busy: _busy, onAction: (a) => _run(value, a)),
        _ => null,
      },
    );
  }
}

class _LoanBody extends ConsumerWidget {
  const _LoanBody({required this.loan, required this.busy, required this.onAction, required this.onVoidRepayment});
  final Loan loan;
  final bool busy;
  final void Function(LoanAction) onAction;
  final void Function(LoanRepayment) onVoidRepayment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final zone = ref.watch(currentProfileProvider)?.timezone;
    final l = loan;
    final acts = l.allowedActions;
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
    final submitted = l.submittedAt != null;
    final decision = l.decisions.lastOrNull;
    final waiting = l.status == LoanStatus.pendingApproval;
    final active = const {LoanStatus.approved, LoanStatus.partiallyRepaid, LoanStatus.repaid}.contains(l.status);
    final cancelled = l.status == LoanStatus.cancelled;
    // ADR 0031 (web "Kas"): the disbursement's KK / KM when the loan moves cash between two different Pusat Biaya
    String cashText() {
      final d = l.disbursement;
      if (!l.cashBacked) return l.status == LoanStatus.draft || waiting ? t.loanCashTbd : t.loanCashNone;
      if (d == null) return cancelled ? t.loanCashCancelled : t.loanCashWaiting;
      final at = l.disbursedAt == null ? '-' : formatServerDateTime(l.disbursedAt, zone: zone);
      return t.loanCashDisbursed(at, d.kk ?? '—', d.km ?? '—');
    }

    return ListView(
      key: const Key('loan-detail'),
      padding: const EdgeInsets.all(16),
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (l.docNo != null) DocNoChip(docNo: l.docNo!),
            LoanStatusChip(loan: l),
            if (l.overdue) LoanOverdueChip(loan: l),
          ],
        ),
        const SizedBox(height: 8),
        Text(t.loanFlow(l.lenderLabel, l.borrower.label), style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        row(t.loanKind, l.kindLabel, key: const Key('loan-kind-value')),
        // ADR 0031: origin (manual / automatic of a transfer)
        if (l.originLabel.isNotEmpty)
          row(
            t.loanOrigin,
            l.transfer == null ? l.originLabel : t.loanOriginTransfer(l.originLabel, l.transfer!.label),
            key: const Key('loan-origin-value'),
          ),
        // ADR 0031: an automatic loan's lender is the paying account (no lender project)
        row(l.lender == null ? t.loanLenderAccount : t.loanLender, l.lenderLabel, key: const Key('loan-lender-value')),
        if (l.lender != null && l.lenderCashAccount != null)
          row(t.loanLenderPusatBiaya, l.lenderCashAccount!.label, key: const Key('loan-lender-pb-value')),
        row(t.loanBorrower, l.borrower.label, key: const Key('loan-borrower-value')),
        if (l.borrowerCashAccount != null)
          row(t.loanBorrowerPusatBiaya, l.borrowerCashAccount!.label, key: const Key('loan-borrower-pb-value')),
        row(t.loanAmount, formatRupiah(l.amount), key: const Key('loan-amount-value'), style: money),
        // Repaid / outstanding count from the Direktur's approval on (Draft / Menunggu: nothing is owed yet).
        if (active) ...[
          row(t.loanRepaid, formatRupiah(l.repaidTotal), key: const Key('loan-repaid-value'), style: money),
          row(
            t.loanOutstanding,
            formatRupiah(l.outstanding),
            key: const Key('loan-outstanding-value'),
            style: money?.copyWith(color: l.overdue ? context.pk.warnText : null),
          ),
        ],
        row(t.loanDate, formatDateOnly(l.loanDate)),
        row(t.loanDueDate, formatDateOnly(l.dueDate), key: const Key('loan-due-value')),
        row(t.loanCash, cashText(), key: const Key('loan-cash-value')),
        if (l.awaitingDisbursement)
          note(
            t.loanAwaitingDisbursement(l.lenderCashAccount?.label ?? '—', l.borrowerCashAccount?.label ?? '—'),
            key: const Key('loan-awaiting-disbursement'),
          ),
        section(t.loanReason),
        Text(l.reason),
        if (l.samePm) note(l.samePmNote ?? 'PM peminjam = PM pemberi', key: const Key('loan-same-pm')),
        if (l.g1Note != null) note(l.g1Note!, key: const Key('loan-g1-note'), color: context.pk.warnText),
        if (l.rejectReason != null)
          note(t.addendumRejectedBecause(l.rejectReason!), key: const Key('loan-rejected'), color: context.pk.badText),
        if (l.cancelReason != null) note(t.addendumCancelledBecause(l.cancelReason!), key: const Key('loan-cancelled')),
        section(t.loanTimeline),
        // ADR 0031: an automatic loan has one step (the transfer); a cash-backed manual loan adds the disbursement
        if (l.automatic)
          _Step(
            key: const Key('loan-step-transfer'),
            done: !cancelled,
            title: t.loanStepAutomatic(l.transfer?.label ?? '-'),
            subtitle: [
              cancelled ? t.loanStepCancelled : t.loanStepRecorded,
              if (l.createdBy?.name != null) l.createdBy!.name!,
              if (submitted) formatServerDateTime(l.submittedAt, zone: zone),
            ].join(' · '),
            last: true,
          ),
        if (!l.automatic) ...[
          _Step(
            key: const Key('loan-step-submit'),
            done: submitted,
            title: t.loanStepSubmitted,
            subtitle: [
              if (l.createdBy?.name != null) l.createdBy!.name!,
              if (submitted) formatServerDateTime(l.submittedAt, zone: zone) else t.loanStepNotYet,
            ].join(' · '),
          ),
          _Step(
            key: const Key('loan-step-direktur'),
            done: decision != null,
            bad: decision != null && !decision.approved,
            waiting: waiting,
            title: t.loanStepDirektur,
            subtitle: decision != null
                ? [
                    decision.approved ? t.loanDecApproved : t.loanDecRejected,
                    if (decision.actorName != null) decision.actorName!,
                    formatServerDateTime(decision.decidedAt, zone: zone),
                  ].join(' · ')
                : (waiting ? t.loanStepWaiting : t.loanStepNotYet),
            last: !l.cashBacked,
          ),
          if (l.cashBacked)
            _Step(
              key: const Key('loan-step-disburse'),
              done: l.disbursedAt != null,
              waiting: l.awaitingDisbursement,
              title: t.loanStepDisburse,
              subtitle: l.disbursedAt != null
                  ? [
                      t.loanStepDisbursed,
                      if (l.disbursedBy?.name != null) l.disbursedBy!.name!,
                      formatServerDateTime(l.disbursedAt, zone: zone),
                    ].join(' · ')
                  : (l.awaitingDisbursement ? t.loanStepWaiting : t.loanStepNotYet),
              last: true,
            ),
        ],
        if (active || l.repayments.isNotEmpty) ...[
          section(t.loanRepayments),
          if (l.repayments.isEmpty)
            Text(t.loanRepaymentsEmpty, style: theme.textTheme.bodySmall)
          else
            for (final r in l.repayments)
              _RepaymentTile(r: r, onVoid: l.mayVoidRepayment && r.posted && !busy ? () => onVoidRepayment(r) : null),
        ],
        const SizedBox(height: 16),
        if (acts.contains(LoanAction.disburse)) _action(LoanAction.disburse, t.loanDisburse, Icons.account_balance),
        if (acts.contains(LoanAction.repay)) _action(LoanAction.repay, t.loanRepay, Icons.payments_outlined),
        if (acts.contains(LoanAction.submit)) _action(LoanAction.submit, t.loanSubmit, Icons.send),
        if (acts.contains(LoanAction.edit)) _action(LoanAction.edit, t.loanEdit, Icons.edit_outlined, outlined: true),
        if (acts.contains(LoanAction.cancel)) _action(LoanAction.cancel, t.loanCancel, Icons.block, outlined: true),
      ],
    );
  }

  Widget _action(LoanAction a, String label, IconData icon, {bool outlined = false}) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: OnlineOnlyButton(
      key: Key('loan-action-${a.name}'),
      label: label,
      icon: icon,
      outlined: outlined,
      onPressed: busy ? null : () => onAction(a),
    ),
  );
}

class _Step extends StatelessWidget {
  const _Step({
    super.key,
    required this.done,
    required this.title,
    required this.subtitle,
    this.bad = false,
    this.waiting = false,
    this.last = false,
  });
  final bool done;
  final bool bad;
  final bool waiting;
  final bool last;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (IconData icon, Color color) = bad
        ? (Icons.cancel, context.pk.badText)
        : done
        ? (Icons.check_circle, context.pk.okText)
        : waiting
        ? (Icons.hourglass_top, context.pk.warnText)
        : (Icons.radio_button_unchecked, theme.colorScheme.outline);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Column(
            children: [
              Icon(icon, size: 20, color: color),
              if (!last) Expanded(child: Container(width: 2, color: theme.colorScheme.outlineVariant)),
            ],
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                  Text(subtitle, style: theme.textTheme.bodySmall),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RepaymentTile extends StatelessWidget {
  const _RepaymentTile({required this.r, this.onVoid});
  final LoanRepayment r;

  /// "Void" (Direktur / Finance, posted repayments only).
  final VoidCallback? onVoid;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final strike = r.posted ? null : const TextStyle(decoration: TextDecoration.lineThrough);
    return Card(
      key: Key('loan-repayment-${r.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    r.posted && r.seq != null ? t.loanRepaymentSeq(r.seq!) : t.loanRepayments,
                    style: theme.textTheme.labelLarge,
                  ),
                ),
                Text(
                  formatRupiah(r.amount),
                  style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700).merge(strike),
                ),
              ],
            ),
            Text(
              [
                formatDateOnly(r.repayDate),
                if (r.recordedByName != null) t.loanRecordedBy(r.recordedByName!),
              ].join(' · '),
              style: theme.textTheme.bodySmall?.merge(strike),
            ),
            if ((r.note ?? '').isNotEmpty) Text(r.note!, style: theme.textTheme.bodySmall?.merge(strike)),
            // ADR 0031: KK (borrower) / KM (lender) of a cash-backed loan's repayment
            if (r.cash case final c?)
              Text(
                t.loanRepaymentCash(c.kk ?? '—', c.km ?? '—'),
                key: Key('loan-repayment-cash-${r.id}'),
                style: theme.textTheme.bodySmall?.merge(strike),
              ),
            if (!r.posted)
              Text(
                r.voidReason == null ? t.loanRepaymentVoid : t.loanRepaymentVoidReason(r.voidReason!),
                key: Key('loan-repayment-void-${r.id}'),
                style: theme.textTheme.bodySmall?.copyWith(color: context.pk.badText),
              ),
            if (onVoid != null)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  key: Key('loan-repayment-${r.id}-void'),
                  onPressed: onVoid,
                  icon: const Icon(Icons.block, size: 18),
                  label: Text(t.cashVoid),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Direktur decision bar (same layout as the request detail): Tolak (outlined) · Setujui (filled). Server-driven.
class _LoanDecisionBar extends ConsumerWidget {
  const _LoanDecisionBar({required this.loan, required this.busy, required this.onAction});
  final Loan loan;
  final bool busy;
  final void Function(LoanAction) onAction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final a = loan.allowedActions;
    final canApprove = a.contains(LoanAction.approve);
    final canReject = a.contains(LoanAction.reject);
    if (!canApprove && !canReject) return const SizedBox.shrink();
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Row(
          children: [
            if (canReject)
              Expanded(
                child: OnlineOnlyButton(
                  key: const Key('loan-action-reject'),
                  label: t.loanReject,
                  icon: Icons.close,
                  outlined: true,
                  onPressed: busy ? null : () => onAction(LoanAction.reject),
                ),
              ),
            if (canReject && canApprove) const SizedBox(width: 12),
            if (canApprove)
              Expanded(
                child: OnlineOnlyButton(
                  key: const Key('loan-action-approve'),
                  label: t.loanApprove,
                  icon: Icons.check,
                  onPressed: busy ? null : () => onAction(LoanAction.approve),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({required this.title, required this.prompt, required this.confirm});
  final String title;
  final String prompt;
  final String confirm;
  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _c = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.prompt),
          const SizedBox(height: 8),
          TextField(
            key: const Key('loan-reason-field'),
            controller: _c,
            autofocus: true,
            maxLength: 1000,
            decoration: InputDecoration(labelText: t.loanReason, errorText: _error),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: const Key('loan-reason-ok'),
          onPressed: () {
            final v = _c.text.trim();
            if (v.length < 3) {
              setState(() => _error = t.reasonTooShort);
              return;
            }
            Navigator.pop(context, v);
          },
          child: Text(widget.confirm),
        ),
      ],
    );
  }
}

/// The web RepaymentAction dialog as a sheet: Nominal (default = sisa), Tanggal (loan date … today), Catatan.
class _RepaymentSheet extends StatefulWidget {
  const _RepaymentSheet({required this.loan});
  final Loan loan;

  @override
  State<_RepaymentSheet> createState() => _RepaymentSheetState();
}

class _RepaymentSheetState extends State<_RepaymentSheet> {
  late final _amount = TextEditingController(text: groupRupiah(widget.loan.outstanding));
  final _note = TextEditingController();
  late final String _today = widget.loan.today ?? toYmd(DateTime.now());
  late String _date = _today;
  Map<String, String> _errors = const {};

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final last = DateTime.parse(_today);
    final first = DateTime.tryParse(widget.loan.loanDate) ?? DateTime(last.year - 1);
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
    final l = widget.loan;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(t.loanRepayTitle(l.title), style: Theme.of(context).textTheme.titleMedium),
          Text(t.loanRepayOutstanding(formatRupiah(l.outstanding)), style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 12),
          TextField(
            key: const Key('loan-repay-amount'),
            controller: _amount,
            keyboardType: TextInputType.number,
            inputFormatters: const [RupiahInputFormatter()],
            decoration: InputDecoration(labelText: t.cashAmount, prefixText: 'Rp ', errorText: _errors['amount']),
          ),
          const SizedBox(height: 8),
          InkWell(
            key: const Key('loan-repay-date'),
            onTap: _pickDate,
            child: InputDecorator(
              decoration: InputDecoration(
                labelText: t.loanRepayDate,
                errorText: _errors['repayDate'],
                suffixIcon: const Icon(Icons.event),
              ),
              child: Text(formatDateOnly(_date)),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('loan-repay-note'),
            controller: _note,
            maxLength: 500,
            decoration: InputDecoration(labelText: t.loanRepayNote),
          ),
          const SizedBox(height: 8),
          FilledButton(
            key: const Key('loan-repay-save'),
            onPressed: () {
              final amount = parseRupiah(_amount.text);
              final errors = validateRepayment(amount: amount, outstanding: l.outstanding, repayDate: _date);
              if (errors.isNotEmpty) {
                setState(() => _errors = errors);
                return;
              }
              Navigator.pop(context, (amount: amount!, date: _date, note: _note.text));
            },
            child: Text(t.loanRepaySave),
          ),
          TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        ],
      ),
    );
  }
}
