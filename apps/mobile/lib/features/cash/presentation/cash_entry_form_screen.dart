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
import '../../../shared/widgets/pk_ui_proyek.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/presentation/receipt_capture.dart';
import '../../expense/presentation/widgets/master_picker.dart';
import '../../finance/application/finance_providers.dart';
import '../../finance/presentation/transfer_form_screen.dart';
import '../../masters/domain/master_item.dart';
import '../application/cash_providers.dart';
import '../domain/cash_book.dart';

/// `/cash/new?arah=masuk|keluar&pt=`: "Catat kas masuk / keluar" (Finance). Finance of several PTs picks the PT first
/// (web PtChooser): accounts, projects, cost centers, categories follow that PT.
class CashEntryCreateRoute extends ConsumerWidget {
  const CashEntryCreateRoute({super.key, required this.inbound, this.pt});
  final bool inbound;
  final int? pt;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(cashBookProvider(CashFilter(pt: pt)));
    return AsyncBody<CashBook>(
      value: value,
      onRetry: () => ref.invalidate(cashBookProvider(CashFilter(pt: pt))),
      data: (book) {
        final writable = book.writePts;
        final chosen = pt != null ? book.pt(pt) : (writable.length == 1 ? writable.single : null);
        if (writable.isEmpty || (chosen != null && !chosen.write)) {
          return Scaffold(
            appBar: AppBar(title: Text(t.cashNewTitle)),
            body: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(t.cashNoWrite, key: const Key('cash-no-write')),
            ),
          );
        }
        if (chosen == null) {
          final p = ref.watch(currentProfileProvider);
          return Scaffold(
            appBar: AppBar(title: Text(t.cashNewTitle)),
            body: ListView(
              key: const Key('cash-pt-chooser'),
              children: [
                Padding(padding: const EdgeInsets.all(16), child: Text(t.cashPickPt)),
                for (final x in writable)
                  ListTile(
                    key: Key('cash-pt-${x.companyId}'),
                    leading: const Icon(Icons.business),
                    title: Text('${p?.companyCode(x.companyId) ?? ''} — ${p?.company(x.companyId)?.name ?? ''}'),
                    subtitle: Text(
                      t.cashLockOne(x.lockDate == null ? t.cashLockNone : t.cashLockUntil(dayMonth(x.lockDate))),
                    ),
                    onTap: () =>
                        context.pushReplacement('/cash/new?arah=${inbound ? 'masuk' : 'keluar'}&pt=${x.companyId}'),
                  ),
              ],
            ),
          );
        }
        return CashEntryFormScreen(book: book, pt: chosen, inbound: inbound);
      },
    );
  }
}

/// `/cash/:id/edit` (opened from the book with the row as `extra`): the same layout, date / account / amount locked.
class CashEntryEditRoute extends ConsumerWidget {
  const CashEntryEditRoute({super.key, required this.row});
  final CashRow? row;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final r = row;
    if (r == null || r.companyId == null) {
      return Scaffold(
        appBar: AppBar(title: Text(t.cashEdit)),
        body: Padding(padding: const EdgeInsets.all(24), child: Text(t.cashEntryNotFound)),
      );
    }
    final filter = CashFilter(pt: r.companyId);
    return AsyncBody<CashBook>(
      value: ref.watch(cashBookProvider(filter)),
      onRetry: () => ref.invalidate(cashBookProvider(filter)),
      data: (book) {
        final pt = book.pt(r.companyId);
        if (pt == null || !pt.write || !r.canEdit) {
          return Scaffold(
            appBar: AppBar(title: Text(t.cashEditTitle(r.entryNo))),
            body: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                r.voided
                    ? t.cashNotEditableVoid
                    : r.sourceType != 'manual'
                    ? t.cashNotEditableSource
                    : t.cashNotEditableClosed(pt?.lockDate ?? '-'),
                key: const Key('cash-not-editable'),
              ),
            ),
          );
        }
        return CashEntryFormScreen(book: book, pt: pt, inbound: r.inbound, entry: r);
      },
    );
  }
}

/// The web CashEntryForm in its field order: Jenis transaksi, Tanggal, Akun kas, Nominal, Sumber / Kategori, Dibebankan
/// ke (Project · Tidak ada; ADR 0031: the account IS the Pusat Biaya — "Pusat biaya lama" only on a legacy entry that
/// has one), Kendaraan (keluar), Keterangan, Bukti, Alasan perubahan (edit). A confirmable 409 (overdraft, QA-04) asks
/// "Tetap simpan" and re-sends with `confirmOverdraft` (new body → new key).
class CashEntryFormScreen extends ConsumerStatefulWidget {
  const CashEntryFormScreen({super.key, required this.book, required this.pt, required this.inbound, this.entry});
  final CashBook book;
  final CashPt pt;
  final bool inbound;
  final CashRow? entry;

  @override
  ConsumerState<CashEntryFormScreen> createState() => _CashEntryFormScreenState();
}

class _CashEntryFormScreenState extends ConsumerState<CashEntryFormScreen> {
  late final _e = widget.entry;
  late bool _in = widget.inbound;
  late final _amount = TextEditingController(text: groupRupiah(_e?.amount));
  late final _description = TextEditingController(text: _e?.description ?? '');
  final _reason = TextEditingController();
  late String _date = _e?.entryDate ?? widget.pt.today;
  late int? _accountId = _e?.cashAccountId;
  late int? _categoryId = _e?.categoryId;
  late int? _sourceId = _e?.cashInSourceId;
  late int? _projectId = _e?.projectId;
  late int? _costCenterId = _e?.costCenterId;
  late int? _vehicleId = _e?.vehicleId;
  late CashScope _scope = _e?.projectId != null
      ? CashScope.project
      : _e?.costCenterId != null
      ? CashScope.costCenter
      : CashScope.none;
  Uint8List? _proof;
  int? _proofId;
  bool _busy = false;
  Map<String, String> _errors = const {};
  String? _summary;
  final _keys = <String, String>{};

  bool get _edit => _e != null;

  @override
  void dispose() {
    _amount.dispose();
    _description.dispose();
    _reason.dispose();
    super.dispose();
  }

  /// Active options of the PT, plus the entry's current (inactive) ones — "(nonaktif)".
  List<MasterItem> _items(List<CashOption> list, {List<int?> keep = const []}) {
    final t = AppLocalizations.of(context);
    return [
      for (final o in list)
        if (o.belongsTo(widget.pt.companyId) && (o.active || keep.contains(o.id)))
          MasterItem(o.id, o.active ? o.label : '${o.label} ${t.inactiveSuffix}'),
    ];
  }

  CashOption? get _account => widget.book.lookups.accounts.where((a) => a.id == _accountId).firstOrNull;

  Future<void> _pickDate() async {
    final today = DateTime.parse(widget.pt.today);
    final mins = [widget.pt.minDate, _account?.openingDate].whereType<String>().toList()..sort();
    final first = mins.isEmpty ? DateTime(today.year - 5) : DateTime.parse(mins.last);
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(_date).isBefore(first) ? first : DateTime.parse(_date),
      firstDate: first.isAfter(today) ? today : first,
      lastDate: today,
      helpText: AppLocalizations.of(context).cashDate,
    );
    if (d != null && mounted) setState(() => _date = toYmd(d));
  }

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
        _proofId = null;
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
    final e = _e;
    final projectId = _scope == CashScope.project ? _projectId : null;
    final costCenterId = _scope == CashScope.costCenter ? _costCenterId : null;
    final amount = parseRupiah(_amount.text);
    final found = validateCashEntry(
      edit: _edit,
      inbound: _in,
      cashAccountId: _accountId,
      amount: amount,
      description: _description.text,
      entryDate: _date,
      today: widget.pt.today,
      lockDate: widget.pt.lockDate,
      openingDate: _account?.openingDate,
      categoryId: _categoryId,
      cashInSourceId: _sourceId,
      scope: _scope,
      projectId: projectId,
      costCenterId: costCenterId,
      reason: _reason.text,
    );
    final description = _description.text.trim();
    final body = <String, dynamic>{};
    if (!_edit) {
      body.addAll({
        'direction': _in ? 'in' : 'out',
        'company': widget.pt.companyId,
        'entryDate': _date,
        'cashAccountId': _accountId,
        'amount': amount,
        'description': description,
      });
    } else {
      body['reason'] = _reason.text.trim();
      if (description != (e!.description ?? '')) body['description'] = description;
    }
    if (!_in) {
      if (!_edit || _categoryId != e!.categoryId) body['categoryId'] = _categoryId;
      if (!_edit || _vehicleId != e!.vehicleId) body['vehicleId'] = _vehicleId;
    } else if (!_edit || _sourceId != e!.cashInSourceId) {
      body['cashInSourceId'] = _sourceId;
    }
    if (!_edit || projectId != e!.projectId) body['projectId'] = projectId;
    if (!_edit || costCenterId != e!.costCenterId) body['costCenterId'] = costCenterId;
    setState(() {
      _errors = found;
      _summary = found.isEmpty ? null : t.cashCheckFields;
    });
    if (found.isNotEmpty) return;
    if (_edit && _proof == null && body.length == 1) {
      setState(() => _summary = t.cashNoChanges);
      return;
    }
    final label = _edit ? t.cashSaveChanges : (_in ? t.cashSaveIn : t.cashSaveOut);
    if (!confirmOverdraft) {
      final summary = [
        e?.entryNo,
        _account?.label,
        amount == null ? null : formatRupiah(amount),
        formatDateOnly(_date),
        description,
      ];
      if (!await confirmAction(context, action: label, summary: summary) || !mounted) return;
    }
    if (confirmOverdraft) body['confirmOverdraft'] = true;
    setState(() => _busy = true);
    final api = ref.read(cashApiProvider);
    try {
      if (_proof != null) {
        _proofId ??= await api.uploadAttachment(_proof!, filename: 'bukti-kas.jpg');
        body['proofId'] = _proofId;
      }
      final key = _keys.putIfAbsent(jsonEncode(body), () => const Uuid().v4());
      final String done;
      if (_edit) {
        final entry = e!;
        await api.update(entry.id, body, idempotencyKey: key);
        done = t.cashUpdated(entry.entryNo);
      } else {
        final no = await api.create(body, idempotencyKey: key);
        done = t.cashSaved(no, _in ? t.cashInLower : t.cashOutLower, formatRupiah(amount!));
      }
      ref.invalidate(cashBookProvider);
      if (!mounted) return;
      await showActionResult(context, message: done, action: label);
      if (mounted) context.pop(true);
    } on ProblemException catch (x) {
      final prompt = _edit ? null : transferOverridePrompt(t, x);
      if (!mounted) return;
      if (prompt == null || prompt.flag != 'confirmOverdraft') {
        setState(() {
          _errors = {for (final f in x.errors) f.path: f.message};
          _summary = x.message;
        });
        await showActionError(context, x, action: label);
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
              key: const Key('cash-override-confirm'),
              onPressed: () => Navigator.pop(c, true),
              child: Text(t.overrideConfirm),
            ),
          ],
        ),
      );
      if (!mounted) return;
      if (ok != true) {
        setState(() => _summary = t.cashOverdraftCancelled);
        return;
      }
      await _submit(confirmOverdraft: true);
    } on Object catch (x) {
      if (!mounted) return;
      setState(() => _summary = errorText(x));
      await showActionError(context, x, action: label);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final lk = widget.book.lookups;
    final e = _e;
    final p = ref.watch(currentProfileProvider);
    final accounts = _items(lk.accounts, keep: [e?.cashAccountId]);
    if (_accountId == null && accounts.length == 1) _accountId = accounts.single.id;
    final category = lk.categories.where((c) => c.id == _categoryId).firstOrNull;
    final lock = widget.pt.lockDate;
    final opening = _account?.openingDate;
    final multi = widget.book.writePts.length > 1 || p?.isMultiCompany == true;
    final amount = parseRupiah(_amount.text);
    return Scaffold(
      appBar: AppBar(title: Text(_edit ? t.cashEditTitle(e!.entryNo) : t.cashNewTitle)),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          key: const Key('cash-form'),
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              _edit
                  ? t.cashEditNote
                  : [
                      if (multi)
                        'PT ${p?.companyCode(widget.pt.companyId) ?? ''} — ${p?.company(widget.pt.companyId)?.name ?? ''}',
                      t.cashNewNote,
                    ].join(' · '),
              style: pkMetaStyle(context),
            ),
            const SizedBox(height: 12),
            if (_summary != null)
              PkCard(
                key: const Key('cash-form-error'),
                color: context.pk.badBg,
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(12),
                child: DefaultTextStyle.merge(
                  style: TextStyle(color: context.pk.badOn),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [Text(_summary!), for (final v in _errors.values) Text('• $v')],
                  ),
                ),
              ),
            PkSectionCard(
              title: t.cashKind,
              icon: _in ? Icons.south_west : Icons.north_east,
              child: SegmentedButton<bool>(
                key: const Key('cash-direction'),
                segments: [
                  ButtonSegment(value: true, icon: const Icon(Icons.south), label: Text(t.cashIn)),
                  ButtonSegment(value: false, icon: const Icon(Icons.north), label: Text(t.cashOut)),
                ],
                selected: {_in},
                onSelectionChanged: _edit ? null : (s) => setState(() => _in = s.first),
              ),
            ),
            PkCard(
              radius: PkRadius.lg,
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
              child: FormGrid(
                children: [
                  FormGridCell(
                    label: t.cashDate,
                    builder: (label) => InkWell(
                      key: const Key('cash-date'),
                      onTap: _edit ? null : _pickDate,
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: label,
                          enabled: !_edit,
                          errorText: _errors['entryDate'],
                          helperText: _edit
                              ? null
                              : [
                                  lock == null ? t.cashDateNoLock : t.cashDateLock(lock),
                                  if (opening != null) t.cashDateOpening(dmy(opening)),
                                  t.cashDateNoFuture,
                                ].join(' '),
                          helperMaxLines: 3,
                          suffixIcon: const Icon(Icons.event),
                        ),
                        child: Text(formatDateOnly(_date), key: const Key('cash-date-value')),
                      ),
                    ),
                  ),
                  FormGridCell(
                    label: t.cashAccountLabel,
                    // locked in edit mode (ADR 0005 §5: amount / date / account change = void + new entry)
                    child: IgnorePointer(
                      ignoring: _edit,
                      child: Opacity(
                        opacity: _edit ? 0.6 : 1,
                        child: MasterPickerField(
                          key: const Key('cash-account'),
                          label: t.cashAccountLabel,
                          items: accounts,
                          value: _accountId,
                          allowNone: false,
                          errorText: _errors['cashAccountId'],
                          onChanged: (v) => setState(() => _accountId = v),
                        ),
                      ),
                    ),
                  ),
                  FormGridCell(
                    label: t.cashAmount,
                    builder: (label) => TextField(
                      key: const Key('cash-amount'),
                      controller: _amount,
                      enabled: !_edit,
                      keyboardType: TextInputType.number,
                      inputFormatters: const [RupiahInputFormatter()],
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        labelText: label,
                        prefixText: 'Rp ',
                        errorText: _errors['amount'],
                        helperText: _edit
                            ? t.cashLockedHelp
                            : '${t.cashAmountHelp}${amount != null ? ' · ${formatRupiah(amount)}' : ''}',
                        helperMaxLines: 2,
                      ),
                    ),
                  ),
                  if (_in)
                    FormGridCell(
                      label: t.cashSourceIn,
                      child: MasterPickerField(
                        key: const Key('cash-source'),
                        label: t.cashSourceIn,
                        items: _items(lk.sources, keep: [e?.cashInSourceId]),
                        value: _sourceId,
                        errorText: _errors['cashInSourceId'],
                        onChanged: (v) => setState(() => _sourceId = v),
                      ),
                    )
                  else
                    FormGridCell(
                      label: t.cashCategory,
                      child: MasterPickerField(
                        key: const Key('cash-category'),
                        label: t.cashCategory,
                        items: _items(lk.categories, keep: [e?.categoryId]),
                        value: _categoryId,
                        errorText: _errors['categoryId'],
                        onChanged: (v) => setState(() => _categoryId = v),
                      ),
                    ),
                  FormGridCell(
                    label: t.cashScope,
                    full: true,
                    stackedLabel: true,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SegmentedButton<CashScope>(
                          key: const Key('cash-scope'),
                          segments: [
                            ButtonSegment(value: CashScope.project, label: Text(t.cashProject)),
                            // ADR 0031: the old cost-center option stays only on a legacy entry
                            if (e?.costCenterId != null)
                              ButtonSegment(value: CashScope.costCenter, label: Text(t.costCenterLegacyLabel)),
                            ButtonSegment(value: CashScope.none, label: Text(t.cashScopeNone)),
                          ],
                          selected: {_scope},
                          onSelectionChanged: (s) => setState(() => _scope = s.first),
                        ),
                        const SizedBox(height: 4),
                        Text(t.cashScopeHelp, style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                  if (_scope == CashScope.project)
                    FormGridCell(
                      label: t.cashProject,
                      child: MasterPickerField(
                        key: const Key('cash-project'),
                        label: t.cashProject,
                        items: _items(lk.projects, keep: [e?.projectId]),
                        value: _projectId,
                        allowNone: false,
                        errorText: _errors['projectId'],
                        onChanged: (v) => setState(() => _projectId = v),
                      ),
                    ),
                  if (_scope == CashScope.costCenter)
                    FormGridCell(
                      label: t.costCenterLegacyLabel,
                      child: MasterPickerField(
                        key: const Key('cash-cost-center'),
                        label: t.costCenterLegacyLabel,
                        items: _items(lk.costCenters, keep: [e?.costCenterId]),
                        value: _costCenterId,
                        allowNone: false,
                        errorText: _errors['costCenterId'],
                        onChanged: (v) => setState(() => _costCenterId = v),
                      ),
                    ),
                  if (!_in)
                    FormGridCell(
                      label: t.cashVehicleOptional,
                      child: MasterPickerField(
                        key: const Key('cash-vehicle'),
                        label: t.cashVehicleOptional,
                        hint: t.cashVehicleNone,
                        items: _items(lk.vehicles, keep: [e?.vehicleId]),
                        value: _vehicleId,
                        errorText: _errors['vehicleId'],
                        helperText: category?.requiresVehicle == true ? t.cashVehicleHint : null,
                        onChanged: (v) => setState(() => _vehicleId = v),
                      ),
                    ),
                  FormGridCell(
                    label: t.cashDescription,
                    full: true,
                    builder: (label) => TextField(
                      key: const Key('cash-description'),
                      controller: _description,
                      minLines: 2,
                      maxLines: 5,
                      maxLength: 1000,
                      decoration: InputDecoration(labelText: label, errorText: _errors['description']),
                    ),
                  ),
                  FormGridCell(
                    label: _edit && e!.proofId != null ? t.cashProofReplace : t.cashProofOptional,
                    full: true,
                    stackedLabel: true,
                    child: _ProofField(
                      proof: _proof,
                      currentId: e?.proofId,
                      onAdd: (fromCamera) => _addProof(fromCamera: fromCamera),
                    ),
                  ),
                  if (_edit)
                    FormGridCell(
                      label: t.cashReason,
                      full: true,
                      builder: (label) => TextField(
                        key: const Key('cash-reason'),
                        controller: _reason,
                        minLines: 2,
                        maxLines: 4,
                        maxLength: 1000,
                        decoration: InputDecoration(
                          labelText: label,
                          errorText: _errors['reason'],
                          helperText: t.cashReasonHelp,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            PkSectionCard(
              title: t.cashRulesTitle,
              icon: Icons.rule,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final rule in [
                    t.cashRule1,
                    t.cashRule2,
                    lock == null ? t.cashRule3 : t.cashRule3Lock(dayMonth(lock)),
                    t.cashRule4,
                  ])
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text('• $rule', style: pkMetaStyle(context)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            OnlineOnlyButton(
              key: const Key('cash-submit'),
              label: _busy
                  ? t.cashSaving
                  : _edit
                  ? t.cashSaveChanges
                  : _in
                  ? t.cashSaveIn
                  : t.cashSaveOut,
              icon: Icons.save_outlined,
              onPressed: _busy ? null : _submit,
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

/// "Bukti (opsional)": thumbnail of the new photo, "Lihat bukti saat ini" (edit), camera / gallery.
class _ProofField extends ConsumerWidget {
  const _ProofField({required this.proof, required this.currentId, required this.onAdd});
  final Uint8List? proof;
  final int? currentId;
  final void Function(bool fromCamera) onAdd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final photo = proof;
    final current = currentId;
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
                  key: const Key('cash-proof-thumb'),
                  onTap: () => showPhotoViewer(context, [
                    ViewerPhoto(
                      caption: t.cashProof,
                      builder: (_) => Image.memory(photo, fit: BoxFit.contain),
                    ),
                  ]),
                  child: Image.memory(photo, fit: BoxFit.cover),
                ),
              ),
            ),
          )
        else if (current != null)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              key: const Key('cash-proof-current'),
              onPressed: () => showPhotoViewer(context, [
                ViewerPhoto(
                  caption: t.cashProofCurrent,
                  builder: (_) => Consumer(
                    builder: (_, ref, _) => switch (ref.watch(cashAttachmentProvider(current))) {
                      AsyncData(:final value) => Image.memory(
                        value,
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) => Center(
                          child: Text(t.cashProofNotImage, style: const TextStyle(color: Colors.white)),
                        ),
                      ),
                      AsyncError(:final error) => Center(
                        child: Text(errorText(error), style: const TextStyle(color: Colors.white)),
                      ),
                      _ => const Center(child: CircularProgressIndicator()),
                    },
                  ),
                ),
              ]),
              icon: const Icon(Icons.image_outlined),
              label: Text(t.cashProofCurrent),
            ),
          ),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                key: const Key('cash-proof-camera'),
                onPressed: () => onAdd(true),
                icon: const Icon(Icons.photo_camera),
                label: Text(photo == null ? t.proofCamera : t.proofRetake),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: OutlinedButton.icon(
                key: const Key('cash-proof-gallery'),
                onPressed: () => onAdd(false),
                icon: const Icon(Icons.photo_library),
                label: Text(t.addReceiptGallery),
              ),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(t.cashProofHelp, style: Theme.of(context).textTheme.bodySmall),
        ),
      ],
    );
  }
}
