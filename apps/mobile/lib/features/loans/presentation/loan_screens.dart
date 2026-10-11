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
import '../../../shared/widgets/online_only_button.dart';
import '../../../shared/widgets/pick_hint.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../domain/loan.dart';
import 'loan_providers.dart';
import 'loan_widgets.dart';

/// ADR 0022 on the APK (online only): the "Pinjaman" tab of a project, the Draft form of the borrower PM and the
/// detail with the Direktur decision bar. Repayments are shown read-only (recorded on the web in v1).

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
  late int? _lenderId = widget.initial?.lender.id;
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
    Widget dateTile(String label, String? value, {required bool due, required String errorKey}) => ListTile(
      key: Key(due ? 'loan-due-date' : 'loan-date'),
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      subtitle: Text(
        _errors[errorKey] ?? formatDateOnly(value),
        style: _errors[errorKey] == null ? null : TextStyle(color: theme.colorScheme.error),
      ),
      trailing: const Icon(Icons.calendar_today),
      onTap: _busy ? null : () => _pickDate(due: due),
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
          final lenderItems = [
            ...lenders,
            if (initial != null && !lenders.any((l) => l.id == initial.lender.id))
              LoanProjectOption(
                id: initial.lender.id,
                code: initial.lender.code ?? '',
                name: initial.lender.name ?? '',
                companyId: initial.companyId ?? 0,
              ),
          ];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (fixedBorrower)
                InputDecorator(
                  key: const Key('loan-borrower-fixed'),
                  decoration: InputDecoration(labelText: t.loanBorrower, prefixIcon: const Icon(Icons.call_received)),
                  child: Text(borrowerLabel),
                )
              else
                DropdownButtonFormField<int>(
                  key: const Key('loan-borrower'),
                  hint: Text(pickHintFor(t, t.loanBorrower)),
                  initialValue: _borrowerId,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: t.loanBorrower,
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
              const SizedBox(height: 16),
              DropdownButtonFormField<int>(
                key: ValueKey('loan-lender-$_borrowerId'),
                hint: Text(pickHintFor(t, t.loanLender)),
                initialValue: lenderItems.any((l) => l.id == _lenderId) ? _lenderId : null,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: t.loanLender,
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
              const SizedBox(height: 16),
              Text(t.loanKind, style: theme.textTheme.bodySmall),
              const SizedBox(height: 6),
              SegmentedButton<String>(
                key: const Key('loan-kind'),
                segments: [
                  ButtonSegment(value: 'dana', label: Text(t.loanKindDana), icon: const Icon(Icons.payments_outlined)),
                  ButtonSegment(
                    value: 'barang',
                    label: Text(t.loanKindBarang),
                    icon: const Icon(Icons.inventory_2_outlined),
                  ),
                ],
                selected: {_kind},
                onSelectionChanged: _busy ? null : (s) => setState(() => _kind = s.first),
              ),
              const SizedBox(height: 16),
              TextField(
                key: const Key('loan-amount'),
                controller: _amount,
                keyboardType: TextInputType.number,
                inputFormatters: const [RupiahInputFormatter()],
                decoration: InputDecoration(labelText: t.loanAmount, prefixText: 'Rp ', errorText: _errors['amount']),
              ),
              const SizedBox(height: 16),
              TextField(
                key: const Key('loan-reason'),
                controller: _reason,
                minLines: 2,
                maxLines: 5,
                maxLength: 1000,
                decoration: InputDecoration(labelText: t.loanReason, errorText: _errors['reason']),
              ),
              dateTile(t.loanDate, _loanDate, due: false, errorKey: 'loanDate'),
              dateTile(t.loanDueDate, _dueDate, due: true, errorKey: 'dueDate'),
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
/// PM: Ubah draft / Ajukan ke Direktur / Batalkan; Direktur: the decision bar (Tolak · Setujui).
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
                ? t.loanApproveBody(l.borrower.label, formatRupiah(l.amount), l.lender.label)
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
        LoanAction.edit || LoanAction.repay => throw StateError('not an APK action'),
      };
      if (mounted) showSnack(context, action == LoanAction.submit ? t.loanSubmitted : t.loanDone);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message);
    } finally {
      // Also after a refusal (403/409): the buttons must follow the server's current allowedActions.
      ref.invalidate(loanDetailProvider(l.id));
      ref.invalidate(loanInboxProvider);
      ref.invalidate(projectLoansProvider(l.borrower.id));
      ref.invalidate(projectLoansProvider(l.lender.id));
      ref.invalidate(inboxProvider);
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
          data: (l) => _LoanBody(loan: l, busy: _busy, onAction: (a) => _run(l, a)),
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
  const _LoanBody({required this.loan, required this.busy, required this.onAction});
  final Loan loan;
  final bool busy;
  final void Function(LoanAction) onAction;

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
        Text(t.loanFlow(l.lender.label, l.borrower.label), style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        row(t.loanKind, l.kindLabel, key: const Key('loan-kind-value')),
        row(t.loanLender, l.lender.label, key: const Key('loan-lender-value')),
        row(t.loanBorrower, l.borrower.label, key: const Key('loan-borrower-value')),
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
        section(t.loanReason),
        Text(l.reason),
        if (l.samePm) note(l.samePmNote ?? 'PM peminjam = PM pemberi', key: const Key('loan-same-pm')),
        if (l.g1Note != null) note(l.g1Note!, key: const Key('loan-g1-note'), color: context.pk.warnText),
        if (l.rejectReason != null)
          note(t.addendumRejectedBecause(l.rejectReason!), key: const Key('loan-rejected'), color: context.pk.badText),
        if (l.cancelReason != null) note(t.addendumCancelledBecause(l.cancelReason!), key: const Key('loan-cancelled')),
        section(t.loanTimeline),
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
          last: true,
        ),
        if (active || l.repayments.isNotEmpty) ...[
          section(t.loanRepayments),
          if (l.repayments.isEmpty)
            Text(t.loanRepaymentsEmpty, style: theme.textTheme.bodySmall)
          else
            for (final r in l.repayments) _RepaymentTile(r: r),
          note(t.loanRepaymentsWebHint, key: const Key('loan-repay-web-hint')),
        ],
        const SizedBox(height: 16),
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
  const _RepaymentTile({required this.r});
  final LoanRepayment r;

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
            if (!r.posted)
              Text(
                r.voidReason == null ? t.loanRepaymentVoid : t.loanRepaymentVoidReason(r.voidReason!),
                key: Key('loan-repayment-void-${r.id}'),
                style: theme.textTheme.bodySmall?.copyWith(color: context.pk.badText),
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
