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
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/doc_no_chip.dart';
import '../../../shared/widgets/form_grid.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../../shared/widgets/pick_hint.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_proyek.dart';
import '../../../shared/widgets/reason_dialog.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../finance/application/finance_providers.dart';
import '../domain/loan.dart';
import 'loan_providers.dart';
import 'loan_transfer_orders.dart';
import 'loan_widgets.dart';

/// ADR 0022 on the APK (online only): the "Pinjaman" tab of a project, the Draft form of the borrower PM (user decision
/// 2026-10-24: or Finance) and the detail with the decision bar (Direktur, then Owner). Phase 3 (user 2026-10-19):
/// "Catat pengembalian" (borrower PM / Finance) and the void of a repayment (Direktur / Finance) as on the web. ADR
/// 0031: the KK / KM numbers, automatic loans of a transfer (lender = the paying account). User decision 2026-10-24:
/// the approved cash-backed loan / repayment request is executed by Finance in the "Antrian Transfer" (no "Cairkan").

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
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: [
            if (canCreate)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
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
              PkEmptyState(key: const Key('project-loans-empty'), icon: Icons.swap_horiz, message: t.loanEmpty),
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

/// Create (PM of the borrower project or Finance) or edit a Draft. "Simpan draft" or "Ajukan ke Direktur"
/// (confirmed).
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

  /// D2410: "Yakin ingin ajukan ke Direktur?" / "Yakin ingin simpan draft?" with the loan's figures.
  Future<bool> _confirmSave(String label, {required bool submit, int? amount}) {
    final t = AppLocalizations.of(context);
    return confirmAction(
      context,
      action: label,
      summary: [widget.initial?.docNo, amount == null ? null : formatRupiah(amount), _reason.text.trim()],
      note: submit ? t.loanSubmitConfirmBody : null,
      confirmKey: Key(submit ? 'loan-submit-confirm' : 'loan-draft-confirm'),
    );
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
    final label = submit ? t.loanSubmit : (_editing ? t.loanSaveChanges : t.loanSaveDraft);
    if (!await _confirmSave(label, submit: submit, amount: amount) || !mounted) return;
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
      await showActionResult(context, message: submit ? t.loanSubmitted : t.loanSavedDraft, action: label);
      if (!mounted) return;
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
      if (!mounted) return;
      setState(() => _error = e.message);
      await showActionError(context, e, action: label);
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
              padding: const EdgeInsets.all(16),
              child: PkNote(t.loanNoBorrower, key: const Key('loan-no-borrower'), margin: EdgeInsets.zero),
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
              PkCard(
                radius: PkRadius.lg,
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
                child: FormGrid(
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
              ),
              const SizedBox(height: 16),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: context.pk.badBg,
                      borderRadius: BorderRadius.circular(PkRadius.sm + 2),
                    ),
                    child: Text(
                      _error!,
                      key: const Key('loan-error'),
                      style: TextStyle(color: context.pk.badOn),
                    ),
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

/// Loan detail: figures, notes, approval timeline, repayments and the actions the server allows — PM / Finance:
/// Ubah draft / Ajukan ke Direktur / Batalkan; Direktur then Owner: the decision bar (Tolak · Setujui); Finance: "Buka
/// Antrian Transfer" (user decision 2026-10-24: the approved cash-backed loan is a transfer order executed there);
/// repayment requests with their row actions (Setujui / Tolak / Batalkan / Void).
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
      await _openTransferQueue(l);
      return;
    }
    if (action == LoanAction.edit) {
      await GoRouter.maybeOf(context)?.push('/loans/${l.id}/edit');
      ref.invalidate(loanDetailProvider(l.id));
      return;
    }
    String? reason;
    final label = switch (action) {
      LoanAction.reject => t.loanReject,
      LoanAction.cancel => t.loanCancel,
      LoanAction.approve => t.loanApprove,
      _ => t.loanSubmit,
    };
    final summary = [l.title, '${l.borrower.label} ← ${l.lenderLabel}', formatRupiah(l.amount)];
    if (action == LoanAction.reject || action == LoanAction.cancel) {
      reason = await showDialog<String>(
        context: context,
        builder: (_) => _ReasonDialog(
          title: action == LoanAction.reject ? t.loanRejectTitle(l.title) : t.loanCancelTitle,
          summary: summary,
          prompt: action == LoanAction.reject ? t.loanRejectPrompt : t.loanCancelPrompt,
          confirm: label,
        ),
      );
      if (reason == null) return;
    } else {
      final approve = action == LoanAction.approve;
      final ok = await confirmAction(
        context,
        action: label,
        summary: summary,
        note: approve
            ? t.loanApproveBody(l.borrower.label, formatRupiah(l.amount), l.lenderLabel)
            : t.loanSubmitConfirmBody,
        confirmKey: const Key('loan-confirm'),
      );
      if (!ok) return;
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
      final done = action == LoanAction.submit ? t.loanSubmitted : t.loanDone;
      if (mounted) await showActionResult(context, message: '${l.title}: $done', action: label);
    } on ApiException catch (e) {
      if (mounted) await showActionError(context, e, action: label);
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

  /// User decision 2026-10-24: Finance executes a loan's / repayment's transfer order in the "Antrian Transfer"
  /// (no "Cairkan" on the loan page any more).
  Future<void> _openTransferQueue(Loan l) async {
    await GoRouter.maybeOf(context)?.push('/finance');
    ref.invalidate(loanTransferOrdersProvider);
    _refreshAll(l);
  }

  /// "Catat pengembalian" of a claim (web RepaymentAction): nominal (≤ sisa), tanggal (loan date … today), catatan.
  /// User decision 2026-10-24: a cash-backed loan's repayment is a request ("Ajukan pengembalian": nominal ≤ the
  /// repayable amount, planned date) — Direktur → Owner → Antrian Transfer; no cash moves before Finance executes it.
  Future<void> _repay(Loan l) async {
    final t = AppLocalizations.of(context);
    final input = await showModalBottomSheet<({int amount, String date, String note})>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _RepaymentSheet(loan: l),
    );
    if (input == null || !mounted) return;
    final summary = [l.title, formatRupiah(input.amount), formatDateOnly(input.date), input.note];
    // DRMS 24/10: a cash-backed loan's repayment is a request ("Ajukan pengembalian"), a claim's is recorded
    final repayLabel = l.repaymentNeedsApproval ? t.loanRepayRequest : t.loanRepaySave;
    if (!await confirmAction(context, action: repayLabel, summary: summary) || !mounted) return;
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
      if (await withLoanOverdraftConfirm(context, send) == null) {
        if (mounted) showSnack(context, t.overrideCancelled);
        return;
      }
      _keys.remove(LoanAction.repay); // the next repayment is a new one
      final amount = formatRupiah(input.amount);
      final done = l.repaymentNeedsApproval ? t.loanRepayRequested(amount) : t.loanRepayDone(amount);
      if (mounted) await showActionResult(context, message: done, action: repayLabel);
    } on ApiException catch (e) {
      if (mounted) await showActionError(context, e, action: repayLabel);
    } finally {
      _refreshAll(l);
      ref.invalidate(loanInboxProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Row actions of a repayment: Setujui (confirmed) / Tolak / Batalkan (reason) of a request, Void of a posted one,
  /// execute → the "Antrian Transfer" (Finance).
  Future<void> _repaymentAction(Loan l, LoanRepayment r, LoanRepaymentAction a) async {
    if (a == LoanRepaymentAction.voidRepayment) return _voidRepayment(l, r);
    if (a == LoanRepaymentAction.execute) return _openTransferQueue(l);
    final t = AppLocalizations.of(context);
    final amount = formatRupiah(r.amount);
    final reject = a == LoanRepaymentAction.reject;
    final label = switch (a) {
      LoanRepaymentAction.approve => t.loanApprove,
      LoanRepaymentAction.reject => t.loanReject,
      _ => t.loanCancel,
    };
    String? reason;
    if (a == LoanRepaymentAction.approve) {
      final ok = await confirmAction(
        context,
        action: label,
        summary: [l.title, t.loanRepaymentApproveTitle(amount)],
        note: t.loanRepaymentApproveBody,
        confirmKey: const Key('loan-repayment-approve-confirm'),
      );
      if (!ok) return;
    } else {
      reason = await showReasonDialog(
        context,
        title: reject ? t.loanRepaymentRejectTitle(amount) : t.loanRepaymentCancelTitle(amount),
        description: reject ? t.loanRejectPrompt : t.loanRepaymentCancelBody,
        confirm: reject ? t.loanReject : t.loanCancel,
        keyPrefix: 'loan-repayment-${a.code}',
      );
      if (reason == null) return;
    }
    if (!mounted) return;
    final api = ref.read(loansApiProvider);
    final key = const Uuid().v7();
    setState(() => _busy = true);
    try {
      await switch (a) {
        LoanRepaymentAction.approve => api.approveRepayment(l.id, r.id, idempotencyKey: key),
        LoanRepaymentAction.reject => api.rejectRepayment(l.id, r.id, reason: reason!, idempotencyKey: key),
        LoanRepaymentAction.cancel => api.cancelRepayment(l.id, r.id, reason: reason!, idempotencyKey: key),
        LoanRepaymentAction.execute || LoanRepaymentAction.voidRepayment => throw StateError('handled above'),
      };
      if (mounted) await showActionResult(context, message: '${l.title}: ${t.loanDone}', action: label);
    } on ApiException catch (e) {
      if (mounted) await showActionError(context, e, action: label);
    } finally {
      _refreshAll(l);
      ref.invalidate(loanInboxProvider);
      ref.invalidate(inboxProvider);
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
      if (mounted) await showActionResult(context, message: t.loanRepaymentVoided, action: t.loanRepaymentVoidConfirm);
    } on ApiException catch (e) {
      if (mounted) await showActionError(context, e, action: t.loanRepaymentVoidConfirm);
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
            onRepaymentAction: (r, a) => _repaymentAction(l, r, a),
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
  const _LoanBody({required this.loan, required this.busy, required this.onAction, required this.onRepaymentAction});
  final Loan loan;
  final bool busy;
  final void Function(LoanAction) onAction;
  final void Function(LoanRepayment, LoanRepaymentAction) onRepaymentAction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final zone = ref.watch(currentProfileProvider)?.timezone;
    final l = loan;
    final acts = l.allowedActions;
    Widget row(String k, String v, {Key? key, TextStyle? style}) => PkKeyRow(k, v, valueKey: key, style: style);
    Widget note(String text, {Key? key, PkTone tone = PkTone.info}) => PkNote(text, key: key, tone: tone);
    final money = pkAmountStyle(context, base: theme.textTheme.bodyMedium);
    final submitted = l.submittedAt != null;
    final waiting = l.status == LoanStatus.pendingApproval;
    // user decision 2026-10-24: Direktur (level 1) then Owner (level 2); an older server's single decision is level 1
    final direktur = l.decisions.where((d) => d.level == 1).lastOrNull;
    final owner = l.decisions.where((d) => d.level == 2).lastOrNull;
    // a loan decided under the former one-level flow has no Owner step
    final ownerStep = owner != null || waiting || l.status == LoanStatus.draft;
    final active = const {LoanStatus.approved, LoanStatus.partiallyRepaid, LoanStatus.repaid}.contains(l.status);
    final cancelled = l.status == LoanStatus.cancelled;
    // ADR 0031 (web "Kas"): the disbursement's KK / KM when the loan moves cash between two Pusat Biaya
    String cashText() {
      final d = l.disbursement;
      if (!l.cashBacked) return l.status == LoanStatus.draft || waiting ? t.loanCashTbd : t.loanCashNone;
      if (d == null) return cancelled ? t.loanCashCancelled : t.loanCashWaiting;
      final at = l.disbursedAt == null ? '-' : formatServerDateTime(l.disbursedAt, zone: zone);
      return t.loanCashDisbursed(at, d.kk ?? '—', d.km ?? '—');
    }

    String decisionText(LoanDecision d) => [
      d.approved ? t.loanDecApproved : t.loanDecRejected,
      if (d.actorName != null) d.actorName!,
      formatServerDateTime(d.decidedAt, zone: zone),
    ].join(' · ');

    PkStepState step({required bool done, bool bad = false, bool waiting = false}) => bad
        ? PkStepState.bad
        : done
        ? PkStepState.done
        : waiting
        ? PkStepState.waiting
        : PkStepState.todo;
    final repaidShare = l.amount <= 0 ? 0.0 : l.repaidTotal / l.amount;

    return ListView(
      key: const Key('loan-detail'),
      padding: const EdgeInsets.all(16),
      children: [
        // headline card: number + status, lender → borrower, the amount (and the repaid share once approved)
        PkCard(
          radius: PkRadius.lg,
          padding: const EdgeInsets.all(16),
          margin: const EdgeInsets.only(bottom: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (l.docNo != null) DocNoChip(docNo: l.docNo!),
                  LoanStatusChip(loan: l),
                  if (l.overdue) LoanOverdueChip(loan: l),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const PkIconChip(icon: Icons.swap_horiz, tone: PkTone.primary, size: 40),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          t.loanFlow(l.lenderLabel, l.borrower.label),
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700, height: 1.3),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          formatRupiah(l.amount),
                          key: const Key('loan-amount-value'),
                          style: pkAmountStyle(context, base: theme.textTheme.headlineSmall, fontSize: 24),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (active) ...[const SizedBox(height: 12), PkProgressBar(value: repaidShare, color: context.pk.okText)],
            ],
          ),
        ),
        PkCard(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              row(t.loanKind, l.kindLabel, key: const Key('loan-kind-value')),
              // ADR 0031: origin (manual / automatic of a transfer)
              if (l.originLabel.isNotEmpty)
                row(
                  t.loanOrigin,
                  l.transfer == null ? l.originLabel : t.loanOriginTransfer(l.originLabel, l.transfer!.label),
                  key: const Key('loan-origin-value'),
                ),
              // ADR 0031: an automatic loan's lender is the paying account (no lender project)
              row(
                l.lender == null ? t.loanLenderAccount : t.loanLender,
                l.lenderLabel,
                key: const Key('loan-lender-value'),
              ),
              if (l.lender != null && l.lenderCashAccount != null)
                row(t.loanLenderPusatBiaya, l.lenderCashAccount!.label, key: const Key('loan-lender-pb-value')),
              row(t.loanBorrower, l.borrower.label, key: const Key('loan-borrower-value')),
              if (l.borrowerCashAccount != null)
                row(t.loanBorrowerPusatBiaya, l.borrowerCashAccount!.label, key: const Key('loan-borrower-pb-value')),
              // Repaid / outstanding count from the final approval on (Draft / Menunggu: nothing is owed yet).
              if (active) ...[
                row(t.loanRepaid, formatRupiah(l.repaidTotal), key: const Key('loan-repaid-value'), style: money),
                row(
                  t.loanOutstanding,
                  formatRupiah(l.outstanding),
                  key: const Key('loan-outstanding-value'),
                  style: money?.copyWith(color: l.overdue ? context.pk.badText : null),
                ),
              ],
              row(t.loanDate, formatDateOnly(l.loanDate)),
              row(t.loanDueDate, formatDateOnly(l.dueDate), key: const Key('loan-due-value')),
              row(t.loanCash, cashText(), key: const Key('loan-cash-value')),
              if (l.awaitingDisbursement)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: note(
                    t.loanAwaitingDisbursement(l.lenderCashAccount?.label ?? '—', l.borrowerCashAccount?.label ?? '—'),
                    key: const Key('loan-awaiting-disbursement'),
                  ),
                ),
            ],
          ),
        ),
        PkSectionCard(
          title: t.loanReason,
          icon: Icons.notes,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l.reason),
              if (l.samePm) note(l.samePmNote ?? 'PM peminjam = PM pemberi', key: const Key('loan-same-pm')),
              if (l.g1Note != null) note(l.g1Note!, key: const Key('loan-g1-note'), tone: PkTone.warn),
              if (l.rejectReason != null)
                note(t.addendumRejectedBecause(l.rejectReason!), key: const Key('loan-rejected'), tone: PkTone.bad),
              if (l.cancelReason != null)
                note(
                  t.addendumCancelledBecause(l.cancelReason!),
                  key: const Key('loan-cancelled'),
                  tone: PkTone.neutral,
                ),
            ],
          ),
        ),
        PkSectionCard(
          title: t.loanTimeline,
          icon: Icons.timeline,
          child: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ADR 0031: an automatic loan has one step (the transfer); a cash-backed manual loan adds Finance's
                // transfer
                if (l.automatic)
                  PkTimelineStep(
                    key: const Key('loan-step-transfer'),
                    state: step(done: !cancelled),
                    title: t.loanStepAutomatic(l.transfer?.label ?? '-'),
                    subtitle: [
                      cancelled ? t.loanStepCancelled : t.loanStepRecorded,
                      if (l.createdBy?.name != null) l.createdBy!.name!,
                      if (submitted) formatServerDateTime(l.submittedAt, zone: zone),
                    ].join(' · '),
                    last: true,
                  ),
                // DRMS 26/10 #1: an Owner-instructed loan has no Direktur / Owner level (instruction, then the transfer)
                if (l.submitterRole == 'owner' && !l.automatic) ...[
                  PkTimelineStep(
                    key: const Key('loan-step-instructed'),
                    state: step(done: submitted),
                    title: t.loanStepInstructedOwner,
                    subtitle: [
                      if (l.createdBy?.name != null) l.createdBy!.name!,
                      if (submitted) formatServerDateTime(l.submittedAt, zone: zone),
                    ].join(' · '),
                    last: !l.cashBacked,
                  ),
                  if (l.cashBacked)
                    PkTimelineStep(
                      key: const Key('loan-step-disburse'),
                      state: step(done: l.disbursedAt != null, waiting: l.awaitingDisbursement),
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
                if (!l.automatic && l.submitterRole != 'owner') ...[
                  PkTimelineStep(
                    key: const Key('loan-step-submit'),
                    state: step(done: submitted),
                    title: l.submitterRole == 'finance' ? t.loanStepSubmittedFinance : t.loanStepSubmitted,
                    subtitle: [
                      if (l.createdBy?.name != null) l.createdBy!.name!,
                      if (submitted) formatServerDateTime(l.submittedAt, zone: zone) else t.loanStepNotYet,
                    ].join(' · '),
                  ),
                  PkTimelineStep(
                    key: const Key('loan-step-direktur'),
                    state: step(
                      done: direktur != null,
                      bad: direktur != null && !direktur.approved,
                      waiting: waiting && !l.waitingOwner,
                    ),
                    title: t.loanStepDirektur,
                    subtitle: direktur != null
                        ? decisionText(direktur)
                        : (waiting && !l.waitingOwner ? t.loanStepWaiting : t.loanStepNotYet),
                    last: !ownerStep && !l.cashBacked,
                  ),
                  if (ownerStep)
                    PkTimelineStep(
                      key: const Key('loan-step-owner'),
                      state: step(done: owner != null, bad: owner != null && !owner.approved, waiting: l.waitingOwner),
                      title: t.loanStepOwner,
                      subtitle: owner != null
                          ? decisionText(owner)
                          : (l.waitingOwner ? t.loanStepWaiting : t.loanStepNotYet),
                      last: !l.cashBacked,
                    ),
                  if (l.cashBacked)
                    PkTimelineStep(
                      key: const Key('loan-step-disburse'),
                      state: step(done: l.disbursedAt != null, waiting: l.awaitingDisbursement),
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
              ],
            ),
          ),
        ),
        if (active || l.repayments.isNotEmpty)
          PkSectionCard(
            key: const Key('loan-repayments'),
            title: t.loanRepayments,
            icon: Icons.keyboard_return,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (l.repayments.isEmpty)
                  Text(t.loanRepaymentsEmpty, style: pkMetaStyle(context))
                else
                  for (final r in l.repayments)
                    _RepaymentTile(
                      r: r,
                      // an older server offers the void on the loan only (`mayVoidRepayment`)
                      actions: {
                        ...r.allowedActions,
                        if (l.mayVoidRepayment && r.posted) LoanRepaymentAction.voidRepayment,
                      },
                      onAction: busy ? null : (a) => onRepaymentAction(r, a),
                    ),
              ],
            ),
          ),
        const SizedBox(height: 4),
        if (acts.contains(LoanAction.disburse))
          _action(LoanAction.disburse, t.loanOpenTransferQueue, Icons.account_balance),
        if (acts.contains(LoanAction.repay))
          _action(
            LoanAction.repay,
            l.repaymentNeedsApproval ? t.loanRepayRequest : t.loanRepay,
            Icons.payments_outlined,
          ),
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

class _RepaymentTile extends StatelessWidget {
  const _RepaymentTile({required this.r, required this.actions, this.onAction});
  final LoanRepayment r;

  /// Row actions offered (the server's `allowedActions`, plus the loan-level void of an older server).
  final Set<LoanRepaymentAction> actions;

  /// Null while an action runs.
  final void Function(LoanRepaymentAction)? onAction;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final strike = r.status.closed ? const TextStyle(decoration: TextDecoration.lineThrough) : null;
    final by = r.recordedByName;
    // a request names its submitter; a claim's repayment (no decision) its recorder
    final submitted = r.decisions.isNotEmpty || !(r.posted || r.status == LoanRepaymentStatus.voided);
    (IconData, String) button(LoanRepaymentAction a) => switch (a) {
      LoanRepaymentAction.approve => (Icons.check, t.loanApprove),
      LoanRepaymentAction.reject => (Icons.close, t.loanReject),
      LoanRepaymentAction.cancel => (Icons.block_outlined, t.loanCancel),
      LoanRepaymentAction.execute => (Icons.account_balance, t.loanOpenTransferQueue),
      LoanRepaymentAction.voidRepayment => (Icons.block, t.cashVoid),
    };
    return Container(
      key: Key('loan-repayment-${r.id}'),
      margin: const EdgeInsets.only(top: 4, bottom: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: r.status.closed ? theme.colorScheme.surfaceContainerHighest : null,
        border: Border.all(color: context.pk.border),
        borderRadius: BorderRadius.circular(PkRadius.sm + 2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  r.posted && r.seq != null ? t.loanRepaymentSeq(r.seq!) : t.loanRepayments,
                  style: theme.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              Text(
                formatRupiah(r.amount),
                style: pkAmountStyle(context, base: theme.textTheme.bodyMedium)?.merge(strike),
              ),
            ],
          ),
          // user decision 2026-10-24: a request waits for the Direktur / Owner, then for Finance's transfer
          if (r.open)
            Text(
              r.statusLabel.isEmpty ? r.status.code : r.statusLabel,
              key: Key('loan-repayment-status-${r.id}'),
              style: theme.textTheme.bodySmall?.copyWith(color: context.pk.warnText, fontWeight: FontWeight.w600),
            ),
          Text(
            [
              if (r.open) t.loanRepayPlannedOn(formatDateOnly(r.plannedDate ?? r.repayDate)),
              if (!r.open) formatDateOnly(r.repayDate),
              if (by != null) submitted ? t.loanSubmittedBy(by) : t.loanRecordedBy(by),
              if (r.executedByName != null) t.loanRepaymentExecutedBy(r.executedByName!),
            ].join(' · '),
            style: theme.textTheme.bodySmall?.merge(strike),
          ),
          if ((r.note ?? '').isNotEmpty) Text(r.note!, style: theme.textTheme.bodySmall?.merge(strike)),
          for (final d in r.decisions)
            Text(
              [
                d.levelLabel ?? (d.level == 2 ? t.loanStepOwner : t.loanStepDirektur),
                d.approved ? t.loanDecApproved : t.loanDecRejected,
                if (d.actorName != null) d.actorName!,
              ].join(' · '),
              key: Key('loan-repayment-${r.id}-decision-${d.level}'),
              style: theme.textTheme.bodySmall,
            ),
          // ADR 0031: KK (borrower) / KM (lender) of a cash-backed loan's repayment
          if (r.cash case final c?)
            Text(
              t.loanRepaymentCash(c.kk ?? '—', c.km ?? '—'),
              key: Key('loan-repayment-cash-${r.id}'),
              style: theme.textTheme.bodySmall?.merge(strike),
            ),
          if (r.status == LoanRepaymentStatus.voided)
            Text(
              r.voidReason == null ? t.loanRepaymentVoid : t.loanRepaymentVoidReason(r.voidReason!),
              key: Key('loan-repayment-void-${r.id}'),
              style: theme.textTheme.bodySmall?.copyWith(color: context.pk.badText),
            ),
          if (r.status == LoanRepaymentStatus.rejected)
            Text(
              t.loanRepaymentRejected(r.rejectReason ?? '—'),
              key: Key('loan-repayment-rejected-${r.id}'),
              style: theme.textTheme.bodySmall?.copyWith(color: context.pk.badText),
            ),
          if (r.status == LoanRepaymentStatus.cancelled)
            Text(
              t.loanRepaymentCancelled(r.cancelReason ?? '—'),
              key: Key('loan-repayment-cancelled-${r.id}'),
              style: theme.textTheme.bodySmall,
            ),
          if (actions.isNotEmpty && onAction != null)
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 4,
                children: [
                  for (final a in LoanRepaymentAction.values)
                    if (actions.contains(a))
                      TextButton.icon(
                        key: Key('loan-repayment-${r.id}-${a.code}'),
                        onPressed: () => onAction!(a),
                        icon: Icon(button(a).$1, size: 18),
                        label: Text(button(a).$2),
                      ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Decision bar of the caller's level (same layout as the request detail): "Persetujuan Direktur" / "Persetujuan
/// Owner", then Tolak (outlined) · Setujui (filled). Server-driven.
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
    return DecoratedBox(
      decoration: BoxDecoration(
        color: context.pk.card,
        border: Border(top: BorderSide(color: context.pk.border)),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                loan.waitingOwner ? t.loanStepOwner : t.loanStepDirektur,
                key: const Key('loan-decision-step'),
                style: Theme.of(context).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Row(
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
            ],
          ),
        ),
      ),
    );
  }
}

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({required this.title, required this.prompt, required this.confirm, this.summary = const []});
  final String title;
  final List<String> summary;
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
    final scheme = Theme.of(context).colorScheme;
    final style = isDestructiveAction(widget.confirm)
        ? FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError)
        : null;
    return AlertDialog(
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final s in widget.summary) Text(s, style: const TextStyle(fontWeight: FontWeight.w600)),
          if (widget.summary.isNotEmpty) const SizedBox(height: 8),
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
          style: style,
          onPressed: () {
            final v = _c.text.trim();
            if (v.length < 3) {
              setState(() => _error = t.reasonTooShort);
              return;
            }
            Navigator.pop(context, v);
          },
          child: Text(t.confirmActionYes(actionPhrase(widget.confirm))),
        ),
      ],
    );
  }
}

/// The web RepaymentAction dialog as a sheet: Nominal (default = what may still be repaid), Tanggal, Catatan. A claim
/// records the repayment (date loan date … today); a cash-backed loan submits a request with a PLANNED date (loan date
/// … one year ahead) — user decision 2026-10-24.
class _RepaymentSheet extends StatefulWidget {
  const _RepaymentSheet({required this.loan});
  final Loan loan;

  @override
  State<_RepaymentSheet> createState() => _RepaymentSheetState();
}

class _RepaymentSheetState extends State<_RepaymentSheet> {
  late final _amount = TextEditingController(text: groupRupiah(widget.loan.repayableAmount));
  final _note = TextEditingController();
  late final String _today = widget.loan.today ?? toYmd(DateTime.now());
  late String _date = _today;
  Map<String, String> _errors = const {};

  bool get _request => widget.loan.repaymentNeedsApproval;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final today = DateTime.parse(_today);
    final last = _request ? today.add(const Duration(days: 365)) : today;
    final first = DateTime.tryParse(widget.loan.loanDate) ?? DateTime(today.year - 1);
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(_date),
      firstDate: first.isAfter(today) ? today : first,
      lastDate: last,
    );
    if (d != null && mounted) setState(() => _date = toYmd(d));
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final l = widget.loan;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _request ? t.loanRepayRequestTitle(l.title) : t.loanRepayTitle(l.title),
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            _request
                ? t.loanRepayable(formatRupiah(l.repayableAmount))
                : t.loanRepayOutstanding(formatRupiah(l.outstanding)),
            style: theme.textTheme.bodySmall,
          ),
          if (_request)
            Text(t.loanRepayRequestHint, key: const Key('loan-repay-request-hint'), style: theme.textTheme.bodySmall),
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
                labelText: _request ? t.loanRepayPlannedDate : t.loanRepayDate,
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
              final errors = validateRepayment(amount: amount, outstanding: l.repayableAmount, repayDate: _date);
              if (errors.isNotEmpty) {
                setState(() => _errors = errors);
                return;
              }
              Navigator.pop(context, (amount: amount!, date: _date, note: _note.text));
            },
            child: Text(_request ? t.loanRepayRequest : t.loanRepaySave),
          ),
          TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        ],
      ),
    );
  }
}
