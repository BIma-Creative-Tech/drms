import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../../app/providers.dart';
import '../../../../app/theme.dart';
import '../../../../core/format/dates.dart';
import '../../../../core/format/rupiah.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/action_feedback.dart';
import '../../../../shared/widgets/async_body.dart';
import '../../../../shared/widgets/online_only_button.dart';
import '../../../../shared/widgets/pk_ui.dart';
import '../../../../shared/widgets/pk_ui_keuangan.dart';
import '../../../approvals/application/inbox_providers.dart';
import '../../application/expense_providers.dart';
import '../../domain/fund_check.dart';
import '../../domain/project_loan_instruction.dart';

/// DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26) "Instruksi pinjam antar proyek" — the APK sheet of the web dialog
/// (`ProjectLoanInstruct.tsx`): the request project's cash account (dana bebas, dibutuhkan, kurang), the open projects
/// of the same PT with their own account and its dana bebas (not eligible ones disabled with the reason), the amount
/// (default = the shortfall; min shortfall, max the chosen account's dana bebas), the due date and the reason;
/// "Lanjut" → the confirmation popup → `POST /expense-requests/{id}/project-loan` (one Idempotency-Key per opened
/// sheet + body) → the result popup. The request detail and the inbox are refreshed afterwards. Online-only.
Future<bool?> showProjectLoanInstructSheet(BuildContext context, {required int requestId, String? docNo}) =>
    showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => ProjectLoanInstructSheet(requestId: requestId, docNo: docNo),
    );

/// "Instruksi pinjam antar proyek" button (detail fund panel, Beranda / Persetujuan cards): opens the sheet and
/// refreshes the request and the inbox after it.
class ProjectLoanInstructButton extends ConsumerWidget {
  const ProjectLoanInstructButton({super.key, required this.requestId, this.docNo, this.filled = true});
  final int requestId;
  final String? docNo;
  final bool filled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    Future<void> open() async {
      await showProjectLoanInstructSheet(context, requestId: requestId, docNo: docNo);
      ref.invalidate(requestDetailProvider(requestId));
      ref.invalidate(inboxProvider);
    }

    const icon = Icon(Icons.swap_horiz);
    final label = Text(t.pliAction);
    return filled
        ? FilledButton.icon(key: Key('pli-open-$requestId'), onPressed: open, icon: icon, label: label)
        : OutlinedButton.icon(key: Key('pli-open-$requestId'), onPressed: open, icon: icon, label: label);
  }
}

class ProjectLoanInstructSheet extends ConsumerStatefulWidget {
  const ProjectLoanInstructSheet({super.key, required this.requestId, this.docNo});
  final int requestId;
  final String? docNo;

  @override
  ConsumerState<ProjectLoanInstructSheet> createState() => _ProjectLoanInstructSheetState();
}

class _ProjectLoanInstructSheetState extends ConsumerState<ProjectLoanInstructSheet> {
  final _amount = TextEditingController();
  final _reason = TextEditingController();
  ProjectLoanInstruction? _info;
  Object? _loadError;
  int? _lender;
  String _dueDate = '';
  bool _busy = false;
  String? _error;
  // One key per opened sheet + body: a retry after a network drop is replayed, not applied twice.
  String _key = const Uuid().v7();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  void _rotate() => _key = const Uuid().v7();

  Future<void> _load() async {
    setState(() {
      _loadError = null;
      _info = null;
    });
    try {
      final info = await ref.read(approvalsApiProvider).projectLoanLenders(widget.requestId);
      if (!mounted) return;
      final t = AppLocalizations.of(context);
      setState(() {
        _info = info;
        _lender = info.firstEligible?.project.id;
        _amount.text = '${info.minAmount}';
        _dueDate = info.defaultDueDate;
        _reason.text = t.pliReasonDefault(info.borrowerAccountName, info.docLabel);
      });
    } on Object catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  PliCandidate? get _chosen => _info?.candidates.where((c) => c.eligible && c.project.id == _lender).firstOrNull;

  Future<void> _pickDue() async {
    final info = _info;
    if (info == null) return;
    final first = DateTime.tryParse(info.loanDate) ?? DateTime.now();
    final current = DateTime.tryParse(_dueDate) ?? first;
    final d = await showDatePicker(
      context: context,
      initialDate: current.isBefore(first) ? first : current,
      firstDate: first,
      lastDate: DateTime(first.year + 5),
      helpText: AppLocalizations.of(context).pliDueDate,
    );
    if (d != null && mounted) {
      setState(() => _dueDate = toYmd(d));
      _rotate();
    }
  }

  Future<void> _submit() async {
    final t = AppLocalizations.of(context);
    final info = _info;
    final c = _chosen;
    if (info == null) return;
    if (c == null) {
      setState(() => _error = t.pliChooseLender);
      return;
    }
    final amount = parseDigits(_amount.text);
    final amountErr = pliAmountError(amount, min: info.minAmount, max: c.available, rupiah: formatRupiah);
    if (amountErr != null || amount == null) {
      setState(() => _error = amountErr);
      return;
    }
    final reason = _reason.text.trim();
    if (reason.length < 3) {
      setState(() => _error = t.pliReasonHint);
      return;
    }
    final yes = await confirmAction(
      context,
      action: t.pliAction,
      summary: [
        info.docLabel,
        t.pliConfirmFrom(c.project.label, c.accountName ?? '-'),
        t.pliConfirmTo(info.borrowerProject.label, info.borrowerAccountName),
        t.pliConfirmAmount(formatRupiah(amount)),
        t.pliConfirmDue(formatDateOnly(_dueDate)),
      ],
      note: t.pliConfirmNote,
      danger: false,
      confirmKey: const Key('pli-confirm'),
    );
    if (!yes || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(approvalsApiProvider)
          .instructProjectLoan(
            widget.requestId,
            lenderProjectId: c.project.id,
            amount: amount,
            reason: reason,
            dueDate: _dueDate.isEmpty ? null : _dueDate,
            idempotencyKey: _key,
          );
      if (!mounted) return;
      await showActionResult(context, message: t.pliDone(formatRupiah(amount), c.project.label), action: t.pliAction);
      if (mounted) Navigator.of(context).pop(true);
    } on ProblemException catch (e) {
      await _failed(fundProblemMessage(e) ?? errorText(e));
    } on Object catch (e) {
      await _failed(errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The refusal stays in the sheet (red text) AND pops up with an OK button (D2410).
  Future<void> _failed(String message) async {
    if (!mounted) return;
    setState(() => _error = message);
    await showActionFailure(context, message, action: AppLocalizations.of(context).pliAction);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final info = _info;
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final money = theme.textTheme.bodyMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
    Widget row(String label, String value, {bool strong = false, Key? key}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 130, child: Text(label)),
          Expanded(
            child: Text(
              value,
              key: key,
              style: strong ? money?.copyWith(fontWeight: FontWeight.w700) : money,
            ),
          ),
        ],
      ),
    );
    final c = _chosen;
    final amountErr = info == null || c == null
        ? null
        : pliAmountError(parseDigits(_amount.text), min: info.minAmount, max: c.available, rupiah: formatRupiah);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        key: const Key('pli-sheet'),
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              t.pliTitle(info?.docLabel ?? widget.docNo ?? '#${widget.requestId}'),
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            if (_loadError != null) ...[
              Text(
                errorText(_loadError!),
                key: const Key('pli-load-error'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
              TextButton(onPressed: _load, child: Text(t.retry)),
            ] else if (info == null)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              )
            else ...[
              PkTile(
                color: context.pk.card,
                radius: PkRadius.md,
                borderColor: context.pk.border,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      row(t.pliBorrowerAccount, '${info.borrowerAccountName} (${info.borrowerProject.label})'),
                      row(t.fundPbAvailable, formatRupiah(info.borrowerAvailable), key: const Key('pli-available')),
                      row(t.fundNeeded, formatRupiah(info.needed)),
                      row(
                        t.fundShortLabel,
                        formatRupiah(info.shortfall),
                        strong: true,
                        key: const Key('pli-shortfall'),
                      ),
                    ],
                  ),
                ),
              ),
              if (info.pendingLoan case final p?)
                PkNoticeCard(
                  key: const Key('pli-pending'),
                  dense: true,
                  icon: Icons.schedule,
                  margin: const EdgeInsets.only(top: 10),
                  title: Text(t.pliPending(p.label, formatRupiah(p.amount), p.statusLabel)),
                ),
              if (!info.canInstruct)
                PkNoticeCard(
                  key: const Key('pli-cannot'),
                  dense: true,
                  tone: PkTone.bad,
                  icon: Icons.block,
                  margin: const EdgeInsets.only(top: 10),
                  title: Text(info.cannotReason ?? '-'),
                )
              else ...[
                const SizedBox(height: 14),
                Text(t.pliLenders, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                if (info.candidates.isEmpty) Text(t.pliNoLenders, style: muted),
                for (final x in info.candidates) _candidate(context, x),
                const SizedBox(height: 12),
                TextField(
                  key: const Key('pli-amount'),
                  controller: _amount,
                  enabled: !_busy,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(
                    labelText: t.pliAmount,
                    prefixText: 'Rp ',
                    errorText: amountErr,
                    helperText: amountErr == null && c?.available != null
                        ? t.pliAmountHelp(formatRupiah(info.minAmount), formatRupiah(c!.available!))
                        : null,
                    helperMaxLines: 3,
                    errorMaxLines: 3,
                  ),
                  onChanged: (_) {
                    _rotate();
                    setState(() => _error = null);
                  },
                ),
                const SizedBox(height: 10),
                ListTile(
                  key: const Key('pli-due'),
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.event),
                  title: Text(t.pliDueDate),
                  subtitle: Text(formatDateOnly(_dueDate)),
                  onTap: _busy ? null : _pickDue,
                ),
                TextField(
                  key: const Key('pli-reason'),
                  controller: _reason,
                  enabled: !_busy,
                  maxLength: 900,
                  minLines: 2,
                  maxLines: 4,
                  decoration: InputDecoration(labelText: t.pliReason, helperText: t.pliReasonHint, helperMaxLines: 2),
                  onChanged: (_) => _rotate(),
                ),
              ],
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  _error!,
                  key: const Key('pli-error'),
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            const SizedBox(height: 12),
            if (info != null && info.canInstruct)
              OnlineOnlyButton(
                key: const Key('pli-submit'),
                label: t.pliContinue,
                icon: Icons.arrow_forward,
                onPressed: _busy || c == null ? null : _submit,
              ),
            TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: Text(t.cancel)),
          ],
        ),
      ),
    );
  }

  /// One lender project: name, its account, dana bebas; not eligible → disabled with the reason (wraps, no ellipsis).
  Widget _candidate(BuildContext context, PliCandidate x) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final selected = x.eligible && _lender == x.project.id;
    final enabled = x.eligible && !_busy;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: PkCard(
        key: Key('pli-candidate-${x.project.id}'),
        padding: const EdgeInsets.all(12),
        onTap: enabled
            ? () {
                setState(() {
                  _lender = x.project.id;
                  _error = null;
                });
                _rotate();
              }
            : null,
        child: Opacity(
          opacity: x.eligible ? 1 : 0.6,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                selected ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                color: selected ? theme.colorScheme.primary : theme.colorScheme.outline,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(x.project.label, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                    Text(t.pliAccount(x.accountName ?? '-'), style: theme.textTheme.bodySmall),
                    if (x.reasonText != null)
                      Text(
                        x.reasonText!,
                        key: Key('pli-candidate-reason-${x.project.id}'),
                        style: theme.textTheme.bodySmall?.copyWith(color: context.pk.badText),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                x.available == null ? '-' : formatRupiah(x.available!),
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
