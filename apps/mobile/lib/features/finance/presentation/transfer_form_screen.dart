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
import '../../../shared/widgets/form_grid.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../../shared/widgets/photo_viewer.dart';
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
/// approved amount, server-set, G3), Akun kas, Tanggal & jam transfer (item 11 / D11), Pusat biaya (D2, project
/// default pre-selected), No. referensi bank, Bukti (camera / gallery, compressed like receipts). Online only;
/// a confirmable 409 (overdraft QA-04, unverified account QA-17) asks "Tetap simpan".
class TransferFormScreen extends ConsumerStatefulWidget {
  const TransferFormScreen({super.key, required this.item});
  final TransferQueueItem item;

  @override
  ConsumerState<TransferFormScreen> createState() => _TransferFormScreenState();
}

class _TransferFormScreenState extends ConsumerState<TransferFormScreen> {
  final _bankRef = TextEditingController();
  int? _cashAccountId;
  late int? _costCenterId = widget.item.costCenter?.id;
  DateTime? _at;
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
    super.dispose();
  }

  Duration get _zoneOffset =>
      offsetForZone(ref.read(accountProfileProvider)?.forCompany(widget.item.companyId).timezone);

  Map<String, String> _issues() => validateTransferForm(
    cashAccountId: _cashAccountId,
    costCenterId: _costCenterId,
    transferAt: _at,
    zoneOffset: _zoneOffset,
    bankRef: _bankRef.text,
    hasProof: _proof != null,
    nowUtc: DateTime.now().toUtc(),
  );

  Future<void> _pickAt() async {
    // Now in the PT zone (the picker shows the PT wall clock).
    final now = DateTime.now().toUtc().add(_zoneOffset);
    final today = DateTime(now.year, now.month, now.day);
    final date = await showDatePicker(
      context: context,
      initialDate: _at ?? today,
      firstDate: today.subtract(const Duration(days: 90)),
      lastDate: today,
      helpText: AppLocalizations.of(context).transferAtLabel,
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_at ?? now),
      builder: (c, child) => MediaQuery(data: MediaQuery.of(c).copyWith(alwaysUse24HourFormat: true), child: child!),
    );
    if (time == null) return;
    setState(() => _at = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  /// "22 Sep 2026 14.05 WITA" of the picked transfer time.
  String _atText(String zone) {
    final at = _at!;
    final hh = at.hour.toString().padLeft(2, '0');
    final mm = at.minute.toString().padLeft(2, '0');
    return '${formatDateOnly(toYmd(at))} $hh.$mm $zone';
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
    setState(() => _busy = true);
    final api = ref.read(financeApiProvider);
    try {
      _proofMediaId ??= await api.uploadProof(_proof!, filename: 'bukti-transfer-${widget.item.id}.jpg');
      final body = transferBody(
        cashAccountId: _cashAccountId!,
        costCenterId: _costCenterId!,
        transferAt: transferAtString(_at!, _zoneOffset),
        bankRef: _bankRef.text,
        proofMediaId: _proofMediaId!,
        confirmOverdraft: confirmOverdraft,
        confirmUnverifiedAccount: confirmUnverified,
      );
      final key = _keys.putIfAbsent(jsonEncode(body), () => const Uuid().v4());
      final detail = await api.recordTransfer(widget.item.id, body, idempotencyKey: key);
      ref.invalidate(transferQueueProvider);
      ref.invalidate(requestDetailProvider(widget.item.id));
      ref.invalidate(inboxProvider);
      if (!mounted) return;
      final trf = detail.transfers.where((x) => !x.isVoid).lastOrNull?.docNo;
      // ADR 0028: a PT grup transfer also posted the receiving PT's Kas Masuk (number + PT from the request)
      final km = detail.intercompany;
      showSnack(
        context,
        km != null && !km.voided
            ? t.transferRecordedIntercompany(
                trf ?? '-',
                km.targetEntryNo,
                km.companyCode ?? widget.item.payeeCompanyCode ?? '-',
              )
            : trf == null
            ? t.transferRecorded
            : t.transferRecordedNo(trf),
      );
      context.pop(true);
    } on ProblemException catch (e) {
      final prompt = _overridePrompt(t, e);
      if (!mounted) return;
      if (prompt == null) {
        // ADR 0028: the receiving PT's closed period / changed account / no account in Indonesian
        setState(() => _error = intercompanyProblemMessage(e) ?? e.message);
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
      if (mounted) setState(() => _error = errorText(e));
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
    final centers = ref.watch(costCentersProvider(it.companyId));
    // Default: the PT's first cash account (web: first option selected).
    final accountList = accounts.value ?? const <CashAccountOption>[];
    if (_cashAccountId == null && accountList.isNotEmpty) _cashAccountId = accountList.first.id;
    final zone = zoneAbbrev(ref.watch(accountProfileProvider)?.forCompany(it.companyId).timezone);
    final accountItems = [
      for (final a in accountList)
        MasterItem(a.id, a.balance == null ? a.name : '${a.name} · ${formatRupiah(a.balance!)}'),
    ];
    final centerList = centers.value ?? const <CostCenterOption>[];
    final suggested = it.costCenter;
    final centerItems = [
      for (final c in centerList) MasterItem(c.id, c.label),
      // the suggestion may be missing from the list (deactivated): keep it visible
      if (suggested != null && !centerList.any((c) => c.id == suggested.id))
        MasterItem(suggested.id, '${suggested.code ?? ''} ${suggested.name ?? ''}'.trim()),
    ];
    Widget loadError(Object error) => Text(errorText(error), style: TextStyle(color: theme.colorScheme.error));
    return Scaffold(
      appBar: AppBar(title: Text(t.transferRecord)),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              key: const Key('transfer-amount-card'),
              color: theme.colorScheme.primaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(14),
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
                    Text(t.transferAmountHelp, style: theme.textTheme.bodySmall),
                    const Divider(height: 20),
                    Text('${it.docNo ?? '#${it.id}'} · ${it.title}', style: theme.textTheme.bodyMedium),
                    const SizedBox(height: 4),
                    Text(
                      '${t.bankDestination}: ${it.bankText.isEmpty ? '-' : it.bankText}',
                      style: theme.textTheme.bodySmall,
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
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        SlaBadge(sla: it.sla),
                        if (!it.bankVerified)
                          Text(
                            t.bankUnverified,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: context.pk.warnText,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        if (it.receiptMismatch > 0) ReceiptMismatchChip(count: it.receiptMismatch),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            // DRMS 13/10 Umum #2 / D4: label left of the field, two columns on wide screens (web field order).
            FormGrid(
              children: [
                // 1. Akun kas
                FormGridCell(
                  label: t.cashAccountLabel,
                  child: switch (accounts) {
                    AsyncError(:final error) => loadError(error),
                    _ => MasterPickerField(
                      key: const Key('transfer-cash-account'),
                      label: t.cashAccountLabel,
                      items: accountItems,
                      value: _cashAccountId,
                      allowNone: false,
                      errorText: issues['cashAccountId'],
                      onChanged: (v) => setState(() => _cashAccountId = v),
                    ),
                  },
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
                        _at == null ? t.transferAtHint : _atText(zone),
                        key: const Key('transfer-at-value'),
                        style: _at == null ? theme.textTheme.bodyLarge?.copyWith(color: theme.hintColor) : null,
                      ),
                    ),
                  ),
                ),
                // 3. Pusat biaya (D2)
                FormGridCell(
                  label: t.fieldCostCenter,
                  child: switch (centers) {
                    AsyncError(:final error) => loadError(error),
                    _ => MasterPickerField(
                      key: const Key('transfer-cost-center'),
                      label: t.fieldCostCenter,
                      hint: t.costCenterPickHint,
                      items: centerItems,
                      value: _costCenterId,
                      allowNone: false,
                      errorText: issues['costCenterId'],
                      helperText: it.costCenter != null ? t.costCenterSuggested : t.costCenterNoDefault,
                      onChanged: (v) => setState(() => _costCenterId = v),
                    ),
                  },
                ),
                // 4. No. referensi bank
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
                // 5. Bukti
                FormGridCell(
                  label: t.transferProofLabel,
                  full: true,
                  stackedLabel: true,
                  child: _ProofPicker(
                    proof: _proof,
                    error: issues['proof'],
                    onAdd: (fromCamera) => _addProof(fromCamera: fromCamera),
                  ),
                ),
              ],
            ),
            if (_error != null)
              Card(
                key: const Key('transfer-error'),
                color: theme.colorScheme.errorContainer,
                margin: const EdgeInsets.only(top: 16),
                child: Padding(padding: const EdgeInsets.all(12), child: Text(_error!)),
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

/// 5. Bukti transfer: thumbnail (tap = viewer), camera / gallery, help line.
class _ProofPicker extends StatelessWidget {
  const _ProofPicker({required this.proof, required this.error, required this.onAdd});
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
                borderRadius: BorderRadius.circular(8),
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
({String flag, String title, List<String> lines})? _overridePrompt(AppLocalizations t, ProblemException e) {
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
