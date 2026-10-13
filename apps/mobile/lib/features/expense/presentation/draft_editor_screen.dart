import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../auth/domain/user_profile.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/form_grid.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../auth/application/auth_controller.dart';
import '../../masters/domain/master_item.dart';
import '../../projects/application/projects_providers.dart';
import '../../sync/application/sync_coordinator.dart';
import '../application/draft_service.dart';
import '../application/expense_providers.dart';
import '../domain/draft.dart';
import '../domain/draft_validation.dart';
import '../domain/request_status.dart';
import 'line_editor_screen.dart';
import 'receipt_capture.dart';
import 'requests_screen.dart' show syncStateLabel;
import 'widgets/master_picker.dart';
import 'widgets/rap_item_picker.dart';
import 'widgets/receipt_mismatch_chip.dart';
import '../../companies/presentation/company_chip.dart';
import '../../companies/presentation/company_switcher.dart';

final _draftLoadProvider = FutureProvider.autoDispose.family<DraftRequest?, String>((ref, uuid) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return null;
  return ref.watch(draftRepositoryProvider).load(sub, uuid);
});

/// Route entry: `/drafts/new?type=…` or `/drafts/:uuid`.
///
/// MC3: a draft belongs to ONE PT. New draft: the only PT of the scope in which the user may create
/// requests, or the PT the user picks first (wireframe §1b); the pickers then show that PT's masters only.
/// A draft written before the multi-PT update (no PT) of a multi-PT account asks for its PT before editing.
class DraftEditorRoute extends ConsumerStatefulWidget {
  const DraftEditorRoute({super.key, this.uuid, this.type});
  final String? uuid;
  final RequestType? type;

  @override
  ConsumerState<DraftEditorRoute> createState() => _DraftEditorRouteState();
}

class _DraftEditorRouteState extends ConsumerState<DraftEditorRoute> {
  int? _picked;
  DraftRequest? _new;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(currentProfileProvider);
    final multi = profile?.companies.isNotEmpty ?? false;
    if (widget.uuid == null) {
      int? company;
      if (multi) {
        final candidates = profile!.requestCompanies;
        if (candidates.isEmpty) {
          return Scaffold(
            appBar: AppBar(title: Text(t.editorNewTitle)),
            body: Padding(padding: const EdgeInsets.all(24), child: Text(t.companyPickNone)),
          );
        }
        company = candidates.length == 1 ? candidates.single.id : _picked;
        if (company == null) {
          return CompanyChoiceScreen(
            title: t.editorNewTitle,
            candidates: candidates,
            onPick: (c) => setState(() => _picked = c.id),
          );
        }
      }
      final employeeId = profile?.forCompany(company).employee?.id;
      final draft = _new ??= ref
          .read(draftServiceProvider)
          .newDraft(
            widget.type ?? RequestType.reimburse,
            requesterIds: employeeId == null ? const [] : [employeeId],
            companyId: company,
          );
      return _withMasters(
        ref.watch(mastersForCompanyProvider(draft.companyId)),
        (m) => DraftEditorScreen(initial: draft, masters: m, isNew: true),
      );
    }
    return AsyncBody(
      value: ref.watch(_draftLoadProvider(widget.uuid!)),
      data: (d) {
        if (d == null) return Scaffold(body: Center(child: Text(t.draftNotFound)));
        final account = ref.watch(accountProfileProvider);
        var draft = d;
        if (d.companyId == null && (account?.isMultiCompany ?? false)) {
          if (_picked == null) {
            return CompanyChoiceScreen(
              title: t.editorEditTitle,
              hint: t.companyNeedsChoiceHint,
              candidates: account!.companies,
              onPick: (c) => setState(() => _picked = c.id),
            );
          }
          draft = d.copyWith(companyId: _picked);
        }
        return _withMasters(
          ref.watch(mastersForCompanyProvider(draft.companyId)),
          (m) => DraftEditorScreen(initial: draft, masters: m, isNew: false),
        );
      },
    );
  }

  Widget _withMasters(AsyncValue<Map<String, List<MasterItem>>> v, Widget Function(Map<String, List<MasterItem>>) b) =>
      switch (v) {
        AsyncData(:final value) => b(value),
        AsyncError() => b(const {}),
        _ => const Scaffold(body: Center(child: CircularProgressIndicator())),
      };
}

class DraftEditorScreen extends ConsumerStatefulWidget {
  const DraftEditorScreen({super.key, required this.initial, required this.masters, required this.isNew});
  final DraftRequest initial;
  final Map<String, List<MasterItem>> masters;
  final bool isNew;

  @override
  ConsumerState<DraftEditorScreen> createState() => _DraftEditorScreenState();
}

class _DraftEditorScreenState extends ConsumerState<DraftEditorScreen> {
  late DraftRequest _d = widget.initial;
  late final _title = TextEditingController(text: widget.initial.title);
  late final _notes = TextEditingController(text: widget.initial.notes ?? '');
  // ADR 0027: invoice number of a vendor payment
  late final _invoiceNo = TextEditingController(text: widget.initial.invoiceNo ?? '');
  bool _busy = false;
  List<DraftIssue> _issues = const [];

  @override
  void dispose() {
    _title.dispose();
    _notes.dispose();
    _invoiceNo.dispose();
    super.dispose();
  }

  /// D2: the requester never chooses a cost center (Finance does at transfer); a pre-D2 draft drops it here.
  DraftRequest _collect() => _d.copyWith(
    title: _title.text,
    notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
    costCenterId: null,
    invoiceNo: _d.isVendor ? (_invoiceNo.text.trim().isEmpty ? null : _invoiceNo.text.trim()) : null,
  );

  /// ADR 0027 (D3): only Finance / PM of the draft's PT file a vendor payment (the server re-checks).
  bool _mayFileVendorPayment() {
    final roles = ref.read(currentProfileProvider)?.forCompany(_d.companyId).roles ?? const <Role>{};
    return roles.contains(Role.finance) || roles.contains(Role.pm);
  }

  /// ADR 0027: switching the payee type — vendor = Pengajuan Baru, Pemohon = the filer, no employee account;
  /// karyawan clears every vendor / invoice field.
  void _setPayee(Set<PayeeType> s) {
    final payee = s.first;
    if (payee == _d.payeeType) return;
    setState(() {
      if (payee == PayeeType.vendor) {
        final own = ref.read(currentProfileProvider)?.forCompany(_d.companyId).employee?.id;
        _d = _d.copyWith(
          payeeType: PayeeType.vendor,
          type: RequestType.advance,
          bankAccountId: null,
          requesterIds: own == null ? _d.requesterIds : [own],
        );
      } else {
        _invoiceNo.clear();
        _d = _d.copyWith(
          payeeType: PayeeType.karyawan,
          vendorId: null,
          vendorBankAccountId: null,
          invoiceNo: null,
          invoiceDate: null,
          invoiceDueDate: null,
          invoiceMediaUuid: null,
          invoiceFileId: null,
        );
      }
    });
  }

  Future<void> _pickInvoiceDate({required bool due}) async {
    final now = DateTime.now();
    final current = DateTime.tryParse((due ? _d.invoiceDueDate : _d.invoiceDate) ?? '');
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? now,
      firstDate: now.subtract(const Duration(days: 730)),
      // the invoice date is never in the future (server rule); a due date may be
      lastDate: due ? now.add(const Duration(days: 365)) : now,
    );
    if (picked == null) return;
    setState(() => _d = due ? _d.copyWith(invoiceDueDate: toYmd(picked)) : _d.copyWith(invoiceDate: toYmd(picked)));
  }

  /// ADR 0027: invoice photo (camera / gallery, compressed like a receipt photo), stored as media blob `invoice` and
  /// uploaded to `POST /media/attachments` by the sync / at "Ajukan".
  Future<void> _addInvoicePhoto({required bool fromCamera}) async {
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final raw = await pickReceiptImage(context, fromCamera: fromCamera);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final photo = await ref
          .read(photoCompressorProvider)
          .compress(raw, receiptTargetFor(ref.read(currentProfileProvider)));
      final uuid = ref.read(draftServiceProvider).newId();
      await ref
          .read(draftRepositoryProvider)
          .addMedia(sub, uuid: uuid, kind: 'invoice', bytes: photo.bytes, sha256: photo.sha256Hex);
      if (mounted) setState(() => _d = _d.copyWith(invoiceMediaUuid: uuid, invoiceFileId: null));
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// D4: RAP items belong to the project — a new project clears the RAP item of every line (after a confirm).
  Future<void> _setProject(int? id) async {
    if (id == _d.projectId) return;
    final linked = _d.lines.where((l) => l.rapItemId != null).length;
    if (linked > 0) {
      final t = AppLocalizations.of(context);
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          content: Text(t.projectChangeClearsRap(linked)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
            FilledButton(
              key: const Key('project-change-confirm'),
              onPressed: () => Navigator.pop(c, true),
              child: Text(t.projectChangeConfirm),
            ),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    setState(() => _d = _d.copyWith(projectId: id, lines: [for (final l in _d.lines) l.copyWith(rapItemId: null)]));
  }

  Future<void> _editLine(DraftLine line, {bool isNew = false}) async {
    final updated = await Navigator.of(context).push<DraftLine>(
      MaterialPageRoute(
        builder: (_) => LineEditorScreen(line: line, masters: widget.masters, projectId: _d.projectId),
      ),
    );
    if (updated == null) return;
    setState(() {
      final lines = [..._d.lines];
      final i = lines.indexWhere((l) => l.clientUuid == updated.clientUuid);
      if (i >= 0) {
        lines[i] = updated;
      } else {
        lines.add(updated);
      }
      _d = _d.copyWith(lines: renumber(lines));
    });
  }

  Future<bool> _save({bool quiet = false}) async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return false;
    final draft = _collect();
    setState(() => _issues = validateForSave(draft));
    if (_issues.isNotEmpty) return false;
    setState(() => _busy = true);
    try {
      final online = ref.read(connectivityProvider);
      final saved = await ref
          .read(draftServiceProvider)
          // MC3: dates in the time zone of the draft's PT (all PTs are Asia/Makassar today, ADR 0016 §9).
          .save(
            sub,
            draft,
            online: online,
            timezone: ref.read(currentProfileProvider)?.forCompany(draft.companyId).timezone ?? 'Asia/Makassar',
          );
      _d = saved;
      ref.read(syncCoordinatorProvider.notifier).requestSync();
      if (mounted && !quiet) showSnack(context, online ? t.draftSaved : t.draftSavedQueued);
      return true;
    } on DraftValidationException catch (e) {
      setState(() => _issues = e.issues);
      return false;
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// QA-15: own employee of a Staff-only user in the draft's PT (-1 without one), else null (no limit).
  int? _selfOnlyEmployee() {
    final p = ref.read(currentProfileProvider)?.forCompany(_d.companyId);
    if (p == null || !p.requestsForSelfOnly) return null;
    return p.employee?.id ?? -1;
  }

  /// D4: the RAP rule of the chosen project as far as the phone knows it (offline / not loaded → strict).
  RapCheck _rapCheck() {
    final pid = _d.projectId;
    final rap = pid == null ? null : ref.read(projectRapProvider(pid)).value;
    if (rap == null || rap.offline) return RapCheck.strict;
    if (rap.missing) return RapCheck.missing;
    return rap.pickable.isEmpty ? RapCheck.optional : RapCheck.strict;
  }

  Future<void> _submit() async {
    final t = AppLocalizations.of(context);
    final draft = _collect();
    final issues = validateForSubmit(draft, selfOnlyEmployee: _selfOnlyEmployee(), rap: _rapCheck());
    setState(() => _issues = issues);
    if (issues.isNotEmpty) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(t.submitConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
          FilledButton(
            key: const Key('submit-confirm'),
            onPressed: () => Navigator.pop(c, true),
            child: Text(t.submit),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    if (!await _save(quiet: true)) return;
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    setState(() => _busy = true);
    try {
      final detail = await ref.read(draftServiceProvider).submit(sub, _d, rap: _rapCheck());
      if (!mounted) return;
      showSnack(context, t.submitted);
      ref.invalidate(requestListProvider('mine'));
      context.pushReplacement('/requests/${detail.id}');
    } on DraftValidationException catch (e) {
      setState(() => _issues = e.issues);
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(t.deleteDraftConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(t.delete)),
        ],
      ),
    );
    if (ok != true || sub == null) return;
    await ref.read(draftServiceProvider).delete(sub, _d, online: ref.read(connectivityProvider));
    ref.read(syncCoordinatorProvider.notifier).requestSync();
    if (mounted) context.pop();
  }

  void _setType(Set<RequestType> s) => setState(() => _d = _d.copyWith(type: s.first));

  Future<void> _pickNeededDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_d.neededDate ?? '') ?? now,
      firstDate: now.subtract(const Duration(days: 60)),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked != null) setState(() => _d = _d.copyWith(neededDate: toYmd(picked)));
  }

  void _removeRequester(int id) {
    setState(() => _d = _d.copyWith(requesterIds: [..._d.requesterIds]..remove(id)));
  }

  Future<void> _addRequester(List<MasterItem> employees) async {
    final t = AppLocalizations.of(context);
    int? chosen;
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        content: MasterPickerField(
          label: t.fieldRequesters,
          hint: t.pickEmployee,
          items: employees,
          value: null,
          allowNone: false,
          onChanged: (v) {
            chosen = v;
            Navigator.pop(c);
          },
        ),
      ),
    );
    final id = chosen;
    if (id != null && !_d.requesterIds.contains(id)) {
      setState(() => _d = _d.copyWith(requesterIds: [..._d.requesterIds, id]));
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final m = widget.masters;
    final selfOnly = _selfOnlyEmployee();
    final allEmployees = m[MasterTypes.employees] ?? const <MasterItem>[];
    final ownEmployee = ref.read(currentProfileProvider)?.forCompany(_d.companyId).employee?.id;
    final employees = requesterChoices(
      allEmployees,
      (e) => e.id,
      selfOnlyEmployee: selfOnly,
      isDirektur: (e) => e.extra['direktur'] == true,
      ownEmployee: ownEmployee,
    );
    // ADR 0024: the Direktur's own request in a PT with the rule "Pengajuan Direktur" → straight to Finance.
    final account = ref.watch(accountProfileProvider);
    final membership =
        account?.company(_d.companyId) ?? ((account?.companies.length ?? 0) == 1 ? account!.companies.first : null);
    final direkturNoApproval =
        (membership?.ownRequestNoApproval ?? false) &&
        ownEmployee != null &&
        _d.requesterIds.length == 1 &&
        _d.requesterIds.single == ownEmployee;
    final accounts = (m[MasterTypes.bankAccounts] ?? const [])
        .where((a) => _d.requesterIds.isEmpty || _d.requesterIds.contains((a.extra['employee'] as num?)?.toInt()))
        .toList();
    final urgencies = _byRank(m[MasterTypes.urgencyLevels] ?? const <MasterItem>[]);
    // ADR 0027: Finance / PM may switch to "Vendor"; the chosen vendor's active accounts
    final mayVendor = _mayFileVendorPayment();
    final vendorAccounts = vendorAccountsOf(m, _d.vendorId);
    String? issueFor(String field) => _issues.where((i) => i.field == field && i.lineNo == null).firstOrNull?.message;
    final editableType = _d.serverId == null;
    // D4: RAP items of the chosen project (labels + live remaining budget on the line cards).
    final rap = _d.projectId == null ? null : ref.watch(projectRapProvider(_d.projectId!)).value;
    // a project without any RAP item (and not required to have one) has nothing to pick
    final rapPickable = rap == null || rap.pickable.isNotEmpty;
    final linesWithoutRap = rapPickable ? _d.lines.where((l) => l.needsRapItem).length : 0;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isNew ? t.editorNewTitle : t.editorEditTitle),
        actions: [
          if (!widget.isNew) IconButton(onPressed: _busy ? null : _delete, icon: const Icon(Icons.delete_outline)),
        ],
      ),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (m.isEmpty)
              Card(
                child: Padding(padding: const EdgeInsets.all(12), child: Text(t.mastersMissing)),
              ),
            if (!widget.isNew)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text('${syncStateLabel(t, _d.syncState)}${_d.lastError != null ? '\n${_d.lastError}' : ''}'),
              ),
            // MC3: the PT of this draft (fixed; the pickers below list that PT's data only). Persetujuan #8: a badge
            // (code + name), no "PT:" label.
            if ((ref.watch(accountProfileProvider)?.isMultiCompany ?? false) && _d.companyId != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  children: [
                    CompanyChip(key: const Key('draft-company'), companyId: _d.companyId, always: true),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        ref.watch(accountProfileProvider)?.company(_d.companyId)?.name ?? '',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
            if (direkturNoApproval)
              Card(
                key: const Key('draft-direktur-no-approval'),
                color: Theme.of(context).colorScheme.secondaryContainer,
                margin: const EdgeInsets.only(bottom: 12),
                child: ListTile(
                  leading: const Icon(Icons.info_outline),
                  title: Text(t.draftDirekturNoApprovalInfo),
                  subtitle: Text(t.draftDirekturNoApprovalHint),
                ),
              ),
            // DRMS 13/10 Umum #2 / D4: label left of the field, two columns on wide screens.
            if (_d.isVendor)
              Card(
                key: const Key('draft-vendor-hint'),
                color: Theme.of(context).colorScheme.secondaryContainer,
                margin: const EdgeInsets.only(bottom: 12),
                child: ListTile(leading: const Icon(Icons.storefront), title: Text(t.vendorPaymentHint)),
              ),
            FormGrid(
              children: [
                // ADR 0027 "Jenis penerima": only Finance / PM see "Vendor"; fixed once the server knows the draft
                if (mayVendor || _d.isVendor)
                  FormGridCell(
                    label: t.fieldPayeeType,
                    stackedLabel: true,
                    child: SegmentedButton<PayeeType>(
                      key: const Key('draft-payee-type'),
                      segments: [
                        ButtonSegment(value: PayeeType.karyawan, label: Text(t.payeeKaryawan)),
                        ButtonSegment(value: PayeeType.vendor, label: Text(t.payeeVendor)),
                      ],
                      selected: {_d.payeeType},
                      onSelectionChanged: editableType && mayVendor ? _setPayee : null,
                    ),
                  ),
                // a vendor payment is always Pengajuan Baru (no "Jenis" choice)
                if (!_d.isVendor)
                  FormGridCell(
                    label: t.fieldType,
                    stackedLabel: true,
                    child: SegmentedButton<RequestType>(
                      segments: [for (final ty in RequestType.values) ButtonSegment(value: ty, label: Text(ty.label))],
                      selected: {_d.type},
                      onSelectionChanged: editableType ? _setType : null,
                    ),
                  ),
                FormGridCell(
                  label: t.fieldTitle,
                  builder: (label) => TextField(
                    key: const Key('draft-title'),
                    controller: _title,
                    maxLength: 200,
                    decoration: InputDecoration(labelText: label, errorText: issueFor('title')),
                  ),
                ),
                // D2 (DRMS 10/10): project required, no cost center choice (Finance sets it at transfer).
                FormGridCell(
                  label: t.fieldProject,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      MasterPickerField(
                        key: const Key('draft-project'),
                        label: t.fieldProject,
                        items: m[MasterTypes.projects] ?? const [],
                        value: _d.projectId,
                        allowNone: false,
                        errorText: issueFor('projectId'),
                        onChanged: _setProject,
                      ),
                      // D4 (owner 2026-10-11): project with a RAB but no RAP → submit refused; same text as the web
                      if (rap != null && rap.missing) const _RapMissingCard(),
                      if (_d.projectId == null && widget.initial.costCenterId != null)
                        Padding(
                          key: const Key('draft-cost-center-legacy'),
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(t.draftCostCenterLegacy, style: TextStyle(color: context.pk.warnText)),
                        ),
                    ],
                  ),
                ),
                FormGridCell(
                  label: t.fieldNeededDate,
                  builder: (label) => InkWell(
                    key: const Key('draft-needed-date'),
                    onTap: _pickNeededDate,
                    child: InputDecorator(
                      decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.calendar_today)),
                      child: Text(formatDateOnly(_d.neededDate)),
                    ),
                  ),
                ),
                // Owner decision 2026-10-09: "Tingkat urgensi" (per-PT master, lowest rank first)
                FormGridCell(
                  label: t.fieldUrgency,
                  child: MasterPickerField(
                    key: const Key('draft-urgency'),
                    label: t.fieldUrgency,
                    items: urgencies,
                    value: _d.urgencyLevelId,
                    errorText: issueFor('urgencyLevelId'),
                    onChanged: (v) => setState(() => _d = _d.copyWith(urgencyLevelId: v)),
                  ),
                ),
                if (!_d.isVendor)
                  FormGridCell(
                    label: t.fieldRequesters,
                    stackedLabel: true,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(
                          spacing: 6,
                          children: [
                            for (final id in _d.requesterIds)
                              InputChip(
                                label: Text(allEmployees.where((e) => e.id == id).firstOrNull?.label ?? '#$id'),
                                onDeleted: _d.requesterIds.length > 1 ? () => _removeRequester(id) : null,
                              ),
                            // QA-15: a Staff-only user can add only themselves (no other requesters)
                            if (selfOnly == null || (selfOnly > 0 && !_d.requesterIds.contains(selfOnly)))
                              ActionChip(
                                avatar: const Icon(Icons.person_add, size: 18),
                                label: Text(t.choose),
                                onPressed: () => _addRequester(employees),
                              ),
                          ],
                        ),
                        if (issueFor('requesterIds') != null)
                          Padding(
                            key: const Key('requesters-issue'),
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              issueFor('requesterIds')!,
                              style: TextStyle(color: Theme.of(context).colorScheme.error),
                            ),
                          ),
                      ],
                    ),
                  ),
                if (!_d.isVendor)
                  FormGridCell(
                    label: t.fieldBankAccount,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        MasterPickerField(
                          label: t.fieldBankAccount,
                          items: accounts,
                          value: _d.bankAccountId,
                          errorText: issueFor('bankAccountId'),
                          onChanged: (v) => setState(() => _d = _d.copyWith(bankAccountId: v)),
                        ),
                        if (accounts.where((a) => a.id == _d.bankAccountId).firstOrNull case final acc?)
                          BankAccountPreview(
                            key: ValueKey('bank-preview-${acc.id}'),
                            account: acc,
                            banks: m[MasterTypes.banks] ?? const [],
                          ),
                      ],
                    ),
                  ),
                // ADR 0027: vendor → its account → invoice number / date / due date / photo
                if (_d.isVendor) ...[
                  FormGridCell(
                    label: t.fieldVendor,
                    child: MasterPickerField(
                      key: const Key('draft-vendor'),
                      label: t.fieldVendor,
                      items: m[MasterTypes.vendors] ?? const [],
                      value: _d.vendorId,
                      allowNone: false,
                      errorText: issueFor('vendorId'),
                      onChanged: (v) => setState(() {
                        if (v == _d.vendorId) return;
                        final accs = vendorAccountsOf(m, v);
                        // the vendor's default (else only) active account is preselected
                        final def =
                            accs.where((a) => a.extra['isDefault'] == true).firstOrNull ??
                            (accs.length == 1 ? accs.single : null);
                        _d = _d.copyWith(vendorId: v, vendorBankAccountId: def?.id);
                      }),
                    ),
                  ),
                  FormGridCell(
                    label: t.fieldVendorBankAccount,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        MasterPickerField(
                          key: const Key('draft-vendor-account'),
                          label: t.fieldVendorBankAccount,
                          items: vendorAccounts,
                          value: _d.vendorBankAccountId,
                          allowNone: false,
                          errorText: issueFor('vendorBankAccountId'),
                          onChanged: (v) => setState(() => _d = _d.copyWith(vendorBankAccountId: v)),
                        ),
                        if (_d.vendorId != null && vendorAccounts.isEmpty)
                          Padding(
                            key: const Key('draft-vendor-no-account'),
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(t.vendorAccountsNone, style: TextStyle(color: context.pk.warnText)),
                          ),
                        if (vendorAccounts.where((a) => a.id == _d.vendorBankAccountId).firstOrNull case final acc?)
                          BankAccountPreview(
                            key: ValueKey('vendor-bank-preview-${acc.id}'),
                            account: acc,
                            banks: m[MasterTypes.banks] ?? const [],
                          ),
                      ],
                    ),
                  ),
                  FormGridCell(
                    label: t.fieldInvoiceNo,
                    builder: (label) => TextField(
                      key: const Key('draft-invoice-no'),
                      controller: _invoiceNo,
                      maxLength: 64,
                      decoration: InputDecoration(labelText: label, errorText: issueFor('invoiceNo')),
                    ),
                  ),
                  FormGridCell(
                    label: t.fieldInvoiceDate,
                    builder: (label) => InkWell(
                      key: const Key('draft-invoice-date'),
                      onTap: () => _pickInvoiceDate(due: false),
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: label,
                          errorText: issueFor('invoiceDate'),
                          suffixIcon: const Icon(Icons.calendar_today),
                        ),
                        child: Text(formatDateOnly(_d.invoiceDate)),
                      ),
                    ),
                  ),
                  FormGridCell(
                    label: t.fieldInvoiceDueDate,
                    builder: (label) => InkWell(
                      key: const Key('draft-invoice-due-date'),
                      onTap: () => _pickInvoiceDate(due: true),
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: label,
                          errorText: issueFor('invoiceDueDate'),
                          suffixIcon: const Icon(Icons.event),
                        ),
                        child: Text(formatDateOnly(_d.invoiceDueDate)),
                      ),
                    ),
                  ),
                  FormGridCell(
                    label: t.fieldInvoiceFile,
                    stackedLabel: true,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _d.invoiceMediaUuid != null
                              ? t.invoiceAttached
                              : _d.invoiceFileId != null
                              ? t.invoiceOnServer
                              : t.invoiceMissing,
                          key: const Key('draft-invoice-state'),
                          style: issueFor('invoiceFile') == null
                              ? null
                              : TextStyle(color: Theme.of(context).colorScheme.error),
                        ),
                        Wrap(
                          spacing: 8,
                          children: [
                            OutlinedButton.icon(
                              key: const Key('draft-invoice-camera'),
                              onPressed: _busy ? null : () => _addInvoicePhoto(fromCamera: true),
                              icon: const Icon(Icons.photo_camera),
                              label: Text(t.invoiceCamera),
                            ),
                            OutlinedButton.icon(
                              key: const Key('draft-invoice-gallery'),
                              onPressed: _busy ? null : () => _addInvoicePhoto(fromCamera: false),
                              icon: const Icon(Icons.photo_library),
                              label: Text(t.invoiceGallery),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
                FormGridCell(
                  label: t.fieldNotes,
                  full: true,
                  builder: (label) => TextField(
                    controller: _notes,
                    maxLength: 2000,
                    maxLines: 3,
                    minLines: 1,
                    decoration: InputDecoration(labelText: label),
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            Row(
              children: [
                Expanded(child: Text(t.linesTitle, style: Theme.of(context).textTheme.titleMedium)),
                TextButton.icon(
                  key: const Key('add-line'),
                  onPressed: () => _editLine(ref.read(draftServiceProvider).newLine(_d.lines.length + 1), isNew: true),
                  icon: const Icon(Icons.add),
                  label: Text(t.addLine),
                ),
              ],
            ),
            if (linesWithoutRap > 0)
              Card(
                key: const Key('draft-lines-need-rap'),
                color: Theme.of(context).colorScheme.tertiaryContainer,
                child: ListTile(
                  leading: const Icon(Icons.info_outline),
                  title: Text(t.draftLinesNeedRap(linesWithoutRap)),
                ),
              ),
            if (issueFor('lines') != null)
              Text(issueFor('lines')!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            for (final l in _d.lines)
              Card(
                key: Key('line-${l.no}'),
                child: ListTile(
                  title: Text('${l.no}. ${l.description.isEmpty ? '-' : l.description}'),
                  // D3: same columns as the web lines table — Kategori · Qty Satuan × Harga satuan = Total.
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        [
                          ?lineQtyPriceText(l, m),
                          ?m[MasterTypes.categories]?.where((c) => c.id == l.categoryId).firstOrNull?.label,
                          '${l.receipts.length} nota',
                        ].join(' · '),
                      ),
                      // D4: RAP item of the line ("Pilih item RAP" until chosen).
                      if (l.rapItemId != null)
                        Text(
                          '${t.fieldRapItem}: ${rap?.byId(l.rapItemId)?.label ?? '#${l.rapItemId}'}',
                          key: Key('line-${l.no}-rap'),
                        )
                      else if (rapPickable)
                        Text(
                          t.lineNeedsRapItemShort,
                          key: Key('line-${l.no}-needs-rap'),
                          style: TextStyle(color: context.pk.warnText, fontWeight: FontWeight.w600),
                        ),
                      if (l.needsUnitPrice && l.total != null)
                        Text(
                          t.lineNeedsUnitPriceShort,
                          key: Key('line-${l.no}-needs-unit-price'),
                          style: TextStyle(color: context.pk.warnText, fontWeight: FontWeight.w600),
                        ),
                      if (rap?.byId(l.rapItemId)?.exceeds(l.computedTotal) ?? false)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: RapOverBudgetChip(key: Key('line-${l.no}-rap-over')),
                        ),
                      for (final i in _issues.where((i) => i.lineNo == l.no))
                        Text(i.message, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                      if (l.receiptMismatch)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: ReceiptMismatchChip(
                            key: Key('line-${l.no}-receipt-mismatch'),
                            receiptAmount: l.receiptAmount,
                            total: l.computedTotal ?? l.total,
                          ),
                        ),
                    ],
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        (l.computedTotal ?? l.total) == null ? '-' : formatRupiah(l.computedTotal ?? l.total!),
                        key: Key('line-${l.no}-total'),
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => setState(
                          () => _d = _d.copyWith(
                            lines: renumber([
                              for (final x in _d.lines)
                                if (x.clientUuid != l.clientUuid) x,
                            ]),
                          ),
                        ),
                      ),
                    ],
                  ),
                  onTap: () => _editLine(l),
                ),
              ),
            const SizedBox(height: 8),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(t.totalPreview),
              subtitle: Text(t.previewNote),
              trailing: Text(
                formatRupiah(_collect().previewGrandTotal),
                key: const Key('preview-total'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            if (_issues.isNotEmpty)
              Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(_issues.map((e) => '• $e').join('\n'), key: const Key('draft-issues')),
                ),
              ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              key: const Key('save-draft'),
              onPressed: _busy ? null : _save,
              icon: const Icon(Icons.save),
              label: Text(t.saveDraft),
            ),
            const SizedBox(height: 12),
            OnlineOnlyButton(
              key: const Key('submit-draft'),
              label: t.submit,
              icon: Icons.send,
              onPressed: _busy ? null : _submit,
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

/// ADR 0027: the active accounts of vendor [vendorId] (masters `vendor-bank-accounts`; none before a vendor is chosen).
List<MasterItem> vendorAccountsOf(Map<String, List<MasterItem>> masters, int? vendorId) => vendorId == null
    ? const []
    : (masters[MasterTypes.vendorBankAccounts] ?? const <MasterItem>[])
          .where((a) => (a.extra['vendor'] as num?)?.toInt() == vendorId)
          .toList();

/// Owner decision 2026-10-09: "Tingkat urgensi" of the PT, lowest rank first.
List<MasterItem> _byRank(List<MasterItem> items) {
  num rank(MasterItem i) => (i.extra['rank'] as num?) ?? 0;
  return [...items]..sort((a, b) => rank(a).compareTo(rank(b)));
}

/// D4 (owner 2026-10-11): a project with a RAB but no RAP → submit refused; same text as the web form.
class _RapMissingCard extends StatelessWidget {
  const _RapMissingCard();

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Card(
      key: const Key('draft-rap-missing'),
      margin: const EdgeInsets.only(top: 4),
      color: scheme.errorContainer,
      child: ListTile(
        leading: Icon(Icons.block, color: scheme.onErrorContainer),
        title: Text(
          t.rapMissingBlock,
          style: TextStyle(fontWeight: FontWeight.w600, color: scheme.onErrorContainer),
        ),
        subtitle: Text(t.rapMissingBlockDetail, style: TextStyle(color: scheme.onErrorContainer)),
      ),
    );
  }
}

/// "2 L × Rp 15.000" (Qty Satuan × Harga satuan) of a draft line; null while qty or the unit price is missing.
String? lineQtyPriceText(DraftLine l, Map<String, List<MasterItem>> masters) {
  if (l.qty == null || l.unitPrice == null) return null;
  final uom = masters[MasterTypes.uoms]?.where((u) => u.id == l.uomId).firstOrNull?.label;
  return '${formatQty(l.qty!)}${uom == null ? '' : ' $uom'} × ${formatRupiah(l.unitPrice!)}';
}

/// d1010 (8e / WA-04): the chosen account as bank · holder · masked number. The eye toggle reveals the full
/// number only when the masters gave it to this user (`bank-accounts` = `employee-bank-accounts` read access:
/// own accounts for Staff/PM, all for Finance/Direktur/Admin); a number that arrives masked keeps the toggle
/// hidden.
class BankAccountPreview extends StatefulWidget {
  const BankAccountPreview({super.key, required this.account, required this.banks});
  final MasterItem account;
  final List<MasterItem> banks;

  @override
  State<BankAccountPreview> createState() => _BankAccountPreviewState();
}

class _BankAccountPreviewState extends State<BankAccountPreview> {
  bool _show = false;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final x = widget.account.extra;
    final no = '${x['accountNo'] ?? ''}'.trim();
    final full = RegExp(r'^[0-9]{5,34}$').hasMatch(no);
    final masked = full ? '•••• ${no.substring(no.length - 4)}' : no;
    final bankId = (x['bank'] as num?)?.toInt();
    final bank = widget.banks.where((b) => b.id == bankId).firstOrNull;
    final bankName = bank == null ? '' : '${bank.extra['name'] ?? bank.label}';
    final holder = '${x['accountHolder'] ?? ''}';
    final title = [bankName, holder].where((e) => e.isNotEmpty).join(' · ');
    return Card(
      key: const Key('bank-preview'),
      margin: const EdgeInsets.only(top: 8),
      color: theme.colorScheme.surfaceContainerLow,
      child: ListTile(
        leading: const Icon(Icons.account_balance),
        // Masters cached before the bank fields were read: the picker label.
        title: Text(title.isEmpty ? widget.account.label : title, key: const Key('bank-preview-title')),
        subtitle: Text(
          _show && full ? no : (masked.isEmpty ? '-' : masked),
          key: const Key('bank-preview-number'),
          style: theme.textTheme.bodyLarge?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
        ),
        trailing: full
            ? IconButton(
                key: const Key('bank-preview-toggle'),
                tooltip: _show ? t.bankHideNumber : t.bankShowNumber,
                icon: Icon(_show ? Icons.visibility_off : Icons.visibility),
                onPressed: () => setState(() => _show = !_show),
              )
            : null,
      ),
    );
  }
}
