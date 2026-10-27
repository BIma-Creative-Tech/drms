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
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/form_grid.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../../shared/widgets/photo_viewer.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_keuangan.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/application/expense_providers.dart';
import '../../expense/domain/intercompany.dart';
import '../../expense/presentation/receipt_capture.dart';
import '../../expense/presentation/widgets/receipt_mismatch_chip.dart';
import '../../masters/domain/master_item.dart';
import '../../expense/presentation/widgets/master_picker.dart';
import '../application/finance_providers.dart';
import '../domain/transfer_queue.dart';
import 'finance_screen.dart';

/// Route `/finance/transfer/:id`: the queue item of request [id] (from `GET /transfer-queue`), then the form.
class TransferFormRoute extends ConsumerWidget {
  const TransferFormRoute({super.key, required this.id});
  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return AsyncBody(
      value: ref.watch(transferQueueProvider),
      onRetry: () => ref.invalidate(transferQueueProvider),
      data: (items) {
        final item = items.where((i) => i.id == id).firstOrNull;
        if (item == null) {
          return Scaffold(
            appBar: AppBar(title: Text(t.transferRecord)),
            body: Padding(padding: const EdgeInsets.all(24), child: Text(t.transferNotInQueue)),
          );
        }
        return TransferFormScreen(item: item);
      },
    );
  }
}

/// DRMS 10/10 point 10: "Catat transfer" on the APK, the web money form in the same field order — amount (the
/// approved amount, server-set, G3), Dibayar dari akun (ADR 0031: the project's Pusat Biaya pre-selected; another
/// account opens the automatic inter-project loan panel — reason required, due date optional), Tanggal & jam transfer
/// (item 11 / D11), No. referensi bank, Bukti (camera / gallery, compressed like receipts). Online only; a confirmable
/// 409 (overdraft QA-04, unverified account QA-17) asks "Tetap simpan".
class TransferFormScreen extends ConsumerStatefulWidget {
  const TransferFormScreen({super.key, required this.item});
  final TransferQueueItem item;

  @override
  ConsumerState<TransferFormScreen> createState() => _TransferFormScreenState();
}

class _TransferFormScreenState extends ConsumerState<TransferFormScreen> {
  final _bankRef = TextEditingController();
  final _loanReason = TextEditingController();
  int? _cashAccountId;
  DateTime? _at;

  /// ADR 0031: due date of the automatic loan (YYYY-MM-DD); null = server default (transfer date + 30 days).
  String? _loanDue;
  Uint8List? _proof;
  int? _proofMediaId;
  bool _busy = false;
  bool _tried = false;
  String? _error;

  /// One idempotency key per distinct body (a retry of the same body replays; another body needs a new key).
  final _keys = <String, String>{};

  @override
  void dispose() {
    _bankRef.dispose();
    _loanReason.dispose();
    super.dispose();
  }

  Duration get _zoneOffset =>
      offsetForZone(ref.read(accountProfileProvider)?.forCompany(widget.item.companyId).timezone);

  /// ADR 0031: paid from another account than the project's Pusat Biaya → automatic inter-project loan.
  bool get _loan => transferNeedsLoan(pusatBiayaId: widget.item.pusatBiaya?.id, cashAccountId: _cashAccountId);

  Map<String, String> _issues() => validateTransferForm(
    cashAccountId: _cashAccountId,
    pusatBiayaId: widget.item.pusatBiaya?.id,
    pusatBiayaMissing: widget.item.pusatBiayaMissing,
    loanReason: _loanReason.text,
    loanDueDate: _loanDue,
    transferAt: _at,
    zoneOffset: _zoneOffset,
    bankRef: _bankRef.text,
    hasProof: _proof != null,
    nowUtc: DateTime.now().toUtc(),
  );

  Future<void> _pickAt() async {
    final at = await pickTransferAt(context, zoneOffset: _zoneOffset, current: _at);
    if (at != null && mounted) setState(() => _at = at);
  }

  /// ADR 0031: "Jatuh tempo pinjaman" — from the transfer date (or today) on; empty = 30 days after the transfer.
  Future<void> _pickLoanDue() async {
    final now = DateTime.now().toUtc().add(_zoneOffset);
    final first = _at ?? DateTime(now.year, now.month, now.day);
    final from = DateTime(first.year, first.month, first.day);
    final current = _loanDue == null ? null : DateTime.tryParse(_loanDue!);
    final d = await showDatePicker(
      context: context,
      initialDate: current != null && !current.isBefore(from) ? current : from.add(const Duration(days: 30)),
      firstDate: from,
      lastDate: from.add(const Duration(days: 3650)),
      helpText: AppLocalizations.of(context).transferLoanDueLabel,
    );
    if (d != null && mounted) setState(() => _loanDue = toYmd(d));
  }

  Future<void> _addProof({required bool fromCamera}) async {
    final t = AppLocalizations.of(context);
    final raw = await ref.read(proofPickerProvider)(context, fromCamera: fromCamera);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      // Same compression as receipts (server image targets).
      final photo = await ref
          .read(photoCompressorProvider)
          .compress(raw, receiptTargetFor(ref.read(currentProfileProvider)));
      setState(() {
        _proof = photo.bytes;
        _proofMediaId = null; // a new photo is uploaded again
      });
    } on PhotoTooLargeException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on Object {
      if (mounted) showSnack(context, t.cameraUnavailable);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit({bool confirmOverdraft = false, bool confirmUnverified = false}) async {
    final t = AppLocalizations.of(context);
    setState(() {
      _tried = true;
      _error = null;
    });
    if (_issues().isNotEmpty) return;
    final it = widget.item;
    if (!confirmOverdraft && !confirmUnverified) {
      final summary = [it.docNo, it.title, formatRupiah(it.amount), it.bankText, _bankRef.text.trim()];
      if (!await confirmAction(context, action: t.transferRecord, summary: summary) || !mounted) return;
    }
    setState(() => _busy = true);
    final api = ref.read(financeApiProvider);
    try {
      _proofMediaId ??= await api.uploadProof(_proof!, filename: 'bukti-transfer-${widget.item.id}.jpg');
      final body = transferBody(
        cashAccountId: _cashAccountId!,
        transferAt: transferAtString(_at!, _zoneOffset),
        loanReason: _loan ? _loanReason.text : null,
        loanDueDate: _loan ? _loanDue : null,
        bankRef: _bankRef.text,
        proofMediaId: _proofMediaId!,
        confirmOverdraft: confirmOverdraft,
        confirmUnverifiedAccount: confirmUnverified,
      );
      final key = _keys.putIfAbsent(jsonEncode(body), () => const Uuid().v4());
      final out = await api.recordTransfer(widget.item.id, body, idempotencyKey: key);
      ref.invalidate(transferQueueProvider);
      ref.invalidate(requestDetailProvider(widget.item.id));
      ref.invalidate(inboxProvider);
      if (!mounted) return;
      final detail = out.request;
      final trf = detail.transfers.where((x) => !x.isVoid).lastOrNull?.docNo;
      // ADR 0028: a PT grup transfer also posted the receiving PT's Kas Masuk (number + PT from the request)
      final km = detail.intercompany;
      // ADR 0031: paid from another account → the automatic inter-project loan (its number)
      final loanNo = out.loanNo;
      final done = km != null && !km.voided
          ? t.transferRecordedIntercompany(
              trf ?? '-',
              km.targetEntryNo,
              km.companyCode ?? widget.item.payeeCompanyCode ?? '-',
            )
          : loanNo != null
          ? t.transferRecordedLoan(trf ?? '-', loanNo)
          : trf == null
          ? t.transferRecorded
          : t.transferRecordedNo(trf);
      await showActionResult(context, message: done, action: t.transferRecord);
      if (mounted) context.pop(true);
    } on ProblemException catch (e) {
      final prompt = transferOverridePrompt(t, e);
      if (!mounted) return;
      if (prompt == null) {
        // ADR 0028: the receiving PT's closed period / changed account / no account in Indonesian
        final message = intercompanyProblemMessage(e) ?? e.message;
        setState(() => _error = message);
        await showActionFailure(context, message, action: t.transferRecord);
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
              key: const Key('transfer-override-confirm'),
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
      await _submit(
        confirmOverdraft: confirmOverdraft || prompt.flag == 'confirmOverdraft',
        confirmUnverified: confirmUnverified || prompt.flag == 'confirmUnverifiedAccount',
      );
    } on Object catch (e) {
      if (!mounted) return;
      setState(() => _error = errorText(e));
      await showActionError(context, e, action: t.transferRecord);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final it = widget.item;
    final issues = _tried ? _issues() : const <String, String>{};
    final accounts = ref.watch(cashAccountsProvider(it.companyId));
    // ADR 0031: default = the project's Pusat Biaya when it is an active account of the PT, else the PT's first account
    // (web: first option selected).
    final accountList = accounts.value ?? const <CashAccountOption>[];
    final pb = it.pusatBiaya;
    if (_cashAccountId == null && accountList.isNotEmpty) {
      _cashAccountId = pb != null && accountList.any((a) => a.id == pb.id) ? pb.id : accountList.first.id;
    }
    final zone = zoneAbbrev(ref.watch(accountProfileProvider)?.forCompany(it.companyId).timezone);
    String accountLabel(CashAccountOption a) {
      final name = a.balance == null ? a.name : '${a.name} · ${formatRupiah(a.balance!)}';
      return a.id == pb?.id ? '$name${t.transferPusatBiayaSuffix}' : name;
    }

    final accountItems = [for (final a in accountList) MasterItem(a.id, accountLabel(a))];
    final loan = _loan;
    Widget loadError(Object error) => Text(errorText(error), style: TextStyle(color: theme.colorScheme.error));
    return Scaffold(
      appBar: AppBar(title: Text(t.transferRecord)),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // D2510: summary card — icon chip + amount, the request, the destination account on a soft tile, pills.
            PkCard(
              key: const Key('transfer-amount-card'),
              radius: PkRadius.lg,
              margin: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const PkIconChip(icon: Icons.account_balance, size: 44),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              t.transferAmountText(formatRupiah(it.amount)),
                              key: const Key('transfer-amount'),
                              style: theme.textTheme.titleLarge?.copyWith(
                                fontWeight: FontWeight.w700,
                                fontFeatures: const [FontFeature.tabularFigures()],
                              ),
                            ),
                            Text(
                              t.transferAmountHelp,
                              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  Divider(height: 24, color: context.pk.border),
                  Text(
                    '${it.docNo ?? '#${it.id}'} · ${it.title}',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerLow,
                      border: Border.all(color: context.pk.border),
                      borderRadius: BorderRadius.circular(PkRadius.sm),
                    ),
                    child: Text(
                      '${t.bankDestination}: ${it.bankText.isEmpty ? '-' : it.bankText}',
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                  // ADR 0028: Antar PT — the transfer also records the Kas Masuk in the receiving PT
                  if (it.payeeCompanyCode case final code?)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        t.transferIntercompanyNote(code),
                        key: const Key('transfer-intercompany-note'),
                        style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      SlaBadge(sla: it.sla),
                      if (!it.bankVerified) PkPill(label: t.bankUnverified, tone: PkTone.warn),
                      if (it.receiptMismatch > 0) ReceiptMismatchChip(count: it.receiptMismatch),
                    ],
                  ),
                ],
              ),
            ),
            // DRMS 13/10 Umum #2 / D4: label left of the field, two columns on wide screens (web field order).
            // D2510: the form fields in one card.
            PkCard(
              child: FormGrid(
                children: [
                  // 1. Dibayar dari akun (ADR 0031: default = the project's Pusat Biaya)
                  FormGridCell(
                    label: t.paidFromAccountLabel,
                    child: switch (accounts) {
                      AsyncError(:final error) => loadError(error),
                      _ => MasterPickerField(
                        key: const Key('transfer-cash-account'),
                        label: t.paidFromAccountLabel,
                        items: accountItems,
                        value: _cashAccountId,
                        allowNone: false,
                        errorText: issues['cashAccountId'] ?? issues['pusatBiaya'],
                        helperText: it.pusatBiayaMissing
                            ? t.transferPusatBiayaMissingHelp
                            : (pb == null ? null : t.transferPusatBiayaHelp(pb.label)),
                        onChanged: (v) => setState(() => _cashAccountId = v),
                      ),
                    },
                  ),
                  // ADR 0031 #4–#5: paid from another account → the automatic inter-project loan (KK on that account,
                  // KM on the project's Pusat Biaya) — reason required, due date optional (server default +30 days)
                  if (loan)
                    FormGridCell(
                      full: true,
                      child: _LoanPanel(
                        pusatBiaya: pb?.label ?? '-',
                        reason: _loanReason,
                        reasonError: issues['loanReason'],
                        due: _loanDue,
                        dueError: issues['loanDueDate'],
                        onPickDue: _pickLoanDue,
                        onClearDue: () => setState(() => _loanDue = null),
                        onChanged: () => _tried ? setState(() {}) : null,
                      ),
                    ),
                  // 2. Tanggal & jam transfer (item 11 / D11)
                  FormGridCell(
                    label: t.transferAtLabel,
                    builder: (label) => InkWell(
                      key: const Key('transfer-at'),
                      onTap: _pickAt,
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: label,
                          helperText: t.transferAtHelp,
                          errorText: issues['transferAt'],
                          suffixIcon: const Icon(Icons.event),
                        ),
                        child: Text(
                          _at == null ? t.transferAtHint : transferAtText(_at!, zone),
                          key: const Key('transfer-at-value'),
                          style: _at == null ? theme.textTheme.bodyLarge?.copyWith(color: theme.hintColor) : null,
                        ),
                      ),
                    ),
                  ),
                  // 3. No. referensi bank
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
                  // 4. Bukti
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
            ),
            if (_error != null)
              PkNoticeCard(
                key: const Key('transfer-error'),
                tone: PkTone.bad,
                margin: const EdgeInsets.only(top: 16),
                icon: Icons.error_outline,
                title: Text(_error!),
              ),
            const SizedBox(height: 20),
            OnlineOnlyButton(
              key: const Key('transfer-submit'),
              label: _busy ? t.processing : t.transferRecord,
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

/// ADR 0031: the automatic inter-project loan panel of "Catat transfer" (web MoneyForm `data-pk-transfer-loan`): the
/// required reason, the note, the optional due date.
class _LoanPanel extends StatelessWidget {
  const _LoanPanel({
    required this.pusatBiaya,
    required this.reason,
    required this.reasonError,
    required this.due,
    required this.dueError,
    required this.onPickDue,
    required this.onClearDue,
    required this.onChanged,
  });
  final String pusatBiaya;
  final TextEditingController reason;
  final String? reasonError;
  final String? due;
  final String? dueError;
  final VoidCallback onPickDue;
  final VoidCallback onClearDue;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final warn = context.pk.warnText;
    // D2510: a soft warn tile (the automatic loan needs a reason).
    return Container(
      key: const Key('transfer-loan-panel'),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
      decoration: BoxDecoration(
        color: context.pk.warnBg.withValues(alpha: 0.5),
        border: Border.all(color: warn.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(PkRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('transfer-loan-reason'),
            controller: reason,
            maxLength: 1000,
            decoration: InputDecoration(
              labelText: t.transferLoanReasonLabel,
              hintText: t.transferLoanReasonHint,
              errorText: reasonError,
            ),
            onChanged: (_) => onChanged(),
          ),
          Text(
            t.transferLoanNote(pusatBiaya),
            key: const Key('transfer-loan-note'),
            style: theme.textTheme.bodySmall?.copyWith(color: warn),
          ),
          const SizedBox(height: 12),
          InkWell(
            key: const Key('transfer-loan-due'),
            onTap: onPickDue,
            child: InputDecorator(
              decoration: InputDecoration(
                labelText: t.transferLoanDueLabel,
                helperText: t.transferLoanDueHelp,
                errorText: dueError,
                suffixIcon: due == null
                    ? const Icon(Icons.event)
                    : IconButton(
                        key: const Key('transfer-loan-due-clear'),
                        icon: const Icon(Icons.clear),
                        tooltip: t.delete,
                        onPressed: onClearDue,
                      ),
              ),
              child: Text(due == null ? t.transferLoanDueDefault : formatDateOnly(due)),
            ),
          ),
        ],
      ),
    );
  }
}

/// Date + time of the bank proof in the paying PT's zone (the picker shows the PT wall clock), at most 90 days back;
/// null when cancelled. Shared by "Catat transfer" and the inter-PT loan disbursement (ADR 0029).
Future<DateTime?> pickTransferAt(BuildContext context, {required Duration zoneOffset, DateTime? current}) async {
  final now = DateTime.now().toUtc().add(zoneOffset);
  final today = DateTime(now.year, now.month, now.day);
  final date = await showDatePicker(
    context: context,
    initialDate: current ?? today,
    firstDate: today.subtract(const Duration(days: 90)),
    lastDate: today,
    helpText: AppLocalizations.of(context).transferAtLabel,
  );
  if (date == null || !context.mounted) return null;
  final time = await showTimePicker(
    context: context,
    initialTime: TimeOfDay.fromDateTime(current ?? now),
    builder: (c, child) => MediaQuery(data: MediaQuery.of(c).copyWith(alwaysUse24HourFormat: true), child: child!),
  );
  if (time == null) return null;
  return DateTime(date.year, date.month, date.day, time.hour, time.minute);
}

/// "22 Sep 2026 14.05 WITA" of a picked transfer time.
String transferAtText(DateTime at, String zone) {
  final hh = at.hour.toString().padLeft(2, '0');
  final mm = at.minute.toString().padLeft(2, '0');
  return '${formatDateOnly(toYmd(at))} $hh.$mm $zone';
}

/// 5. Bukti transfer: thumbnail (tap = viewer), camera / gallery, help line. Also the proof of an inter-PT loan
/// disbursement (ADR 0029).
class TransferProofPicker extends StatelessWidget {
  const TransferProofPicker({super.key, required this.proof, required this.error, required this.onAdd});
  final Uint8List? proof;
  final String? error;
  final void Function(bool fromCamera) onAdd;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final photo = proof;
    final issue = error;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (photo != null)
          Align(
            alignment: Alignment.centerLeft,
            child: SizedBox.square(
              dimension: 96,
              child: Material(
                borderRadius: BorderRadius.circular(PkRadius.sm),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  key: const Key('transfer-proof-thumb'),
                  onTap: () => showPhotoViewer(context, [
                    ViewerPhoto(
                      caption: t.transferProofLabel,
                      builder: (_) => Image.memory(photo, fit: BoxFit.contain),
                    ),
                  ]),
                  child: Image.memory(photo, fit: BoxFit.cover),
                ),
              ),
            ),
          ),
        if (issue != null) Text(issue, style: TextStyle(color: theme.colorScheme.error)),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                key: const Key('transfer-proof-camera'),
                onPressed: () => onAdd(true),
                icon: const Icon(Icons.photo_camera),
                label: Text(photo == null ? t.proofCamera : t.proofRetake),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: OutlinedButton.icon(
                key: const Key('transfer-proof-gallery'),
                onPressed: () => onAdd(false),
                icon: const Icon(Icons.photo_library),
                label: Text(t.addReceiptGallery),
              ),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(t.transferProofHelp, style: theme.textTheme.bodySmall),
        ),
      ],
    );
  }
}

/// Dialog of a confirmable 409 (same texts as the web OverrideDialog, QA-04 / QA-17); null for other problems.
({String flag, String title, List<String> lines})? transferOverridePrompt(AppLocalizations t, ProblemException e) {
  if (e.status != 409) return null;
  final b = e.body;
  int? n(Object? v) => v is num ? v.toInt() : null;
  String? s(Object? v) => v is String && v.trim().isNotEmpty ? v : null;
  if (e.code == 'CASH_OVERDRAFT_CONFIRM_REQUIRED') {
    final balance = n(b['balance']);
    final after = n(b['after']);
    return (
      flag: 'confirmOverdraft',
      title: t.overdraftTitle,
      lines: [
        balance != null && after != null
            ? t.overdraftFigures(formatRupiah(balance), formatRupiah(after))
            : (s(b['title']) ?? t.overdraftGeneric),
        t.overdraftNote,
      ],
    );
  }
  if (e.code == 'BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED') {
    final acct = [s(b['bankName']), s(b['accountNo']), s(b['accountHolder'])].whereType<String>().join(' · ');
    return (
      flag: 'confirmUnverifiedAccount',
      title: t.unverifiedTitle,
      lines: [t.unverifiedLine(acct.isEmpty ? t.unverifiedDestination : acct), t.unverifiedNote],
    );
  }
  return null;
}
