import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/network/api_exception.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../shared/widgets/async_body.dart';
import '../../shared/widgets/online_only_button.dart';
import '../records/data/records_providers.dart';
import '../users/onboarding.dart';
import '../users/onboarding_screen.dart';
import 'client_form.dart';
import 'client_form_screen.dart';
import 'vendor_form.dart';

/// `/vendors/new` and `/vendors/:id` (DRMS 16/10 web "Vendor" page, phase 7): PT (create, several PTs), Nama, Alamat,
/// NPWP, Aktif (reason when deactivating), Kontak PIC and bank accounts (Admin / Finance of the vendor's PT) — one save.
class VendorFormScreen extends ConsumerWidget {
  const VendorFormScreen({super.key, this.id});
  final int? id;

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody<VendorFormData>(
    value: ref.watch(vendorFormProvider(id)),
    onRetry: () => ref.invalidate(vendorFormProvider(id)),
    data: (d) => _VendorForm(data: d, id: id),
  );
}

class _VendorForm extends ConsumerStatefulWidget {
  const _VendorForm({required this.data, this.id});
  final VendorFormData data;
  final int? id;

  @override
  ConsumerState<_VendorForm> createState() => _VendorFormState();
}

class _VendorFormState extends ConsumerState<_VendorForm> {
  late final _name = TextEditingController(text: widget.data.name);
  late final _address = TextEditingController(text: widget.data.address ?? '');
  late final _npwp = TextEditingController(text: widget.data.npwp ?? '');
  final _reason = TextEditingController();
  late bool _active = widget.data.active;
  late int? _company = widget.data.companies.length == 1 ? widget.data.companies.single.id : null;
  late final List<ClientContact> _contacts = widget.data.contacts;
  late final List<VendorBank> _banks = widget.data.bankAccounts;
  Map<String, String> _errors = const {};
  String? _summary;
  bool _busy = false;
  final _keys = <String, String>{};

  bool get _edit => widget.id != null;
  bool get _canBanks =>
      widget.data.companies.any((c) => c.canManageBankAccounts && (_company == null || c.id == _company));

  @override
  void dispose() {
    for (final c in [_name, _address, _npwp, _reason]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _contact([int? i]) async {
    final c = await showModalBottomSheet<ClientContact>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => PartnerContactSheet(contact: i == null ? null : _contacts[i]),
    );
    if (c == null || !mounted) return;
    setState(() {
      if (c.isPrimary) {
        for (final x in _contacts) {
          x.isPrimary = false;
        }
      }
      i == null ? _contacts.add(c) : _contacts[i] = c;
    });
  }

  Future<void> _bank() async {
    final b = await showModalBottomSheet<OnbBankAccount>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => const BankAccountSheet(),
    );
    if (b == null || !mounted) return;
    setState(
      () => _banks.add(
        VendorBank(
          bank: b.bank,
          bankName: b.bankName,
          accountNo: b.accountNo,
          accountHolder: b.accountHolder,
          isDefault: b.isDefault,
        )..dirty = true,
      ),
    );
  }

  Future<void> _save() async {
    final t = AppLocalizations.of(context);
    final deactivating = _edit && widget.data.active && !_active;
    final errors = <String, String>{
      if (_name.text.trim().isEmpty) 'vendor.name': t.clientNameRequired,
      if (!_edit && _company == null && widget.data.companies.length > 1) 'vendor.company': t.clientPtRequired,
      if ((deactivating || _banks.any((b) => b.id != null && b.dirty && !b.active)) && _reason.text.trim().length < 3)
        'reason': t.reasonTooShort,
    };
    setState(() {
      _errors = errors;
      _summary = errors.isEmpty ? null : t.recordCheckFields;
    });
    if (errors.isNotEmpty) return;
    final body = <String, Object?>{
      'vendor': {
        if (!_edit) 'company': ?_company,
        'name': _name.text.trim(),
        'address': _address.text.trim().isEmpty ? null : _address.text.trim(),
        'npwp': _npwp.text.trim().isEmpty ? null : _npwp.text.trim(),
        if (_edit) 'active': _active,
      },
      'contacts': [for (final c in _contacts) c.toJson()],
      if (_canBanks && _banks.any((b) => b.dirty))
        'bankAccounts': [
          for (final b in _banks.where((b) => b.dirty))
            b.id == null
                ? {'bank': b.bank, 'accountNo': b.accountNo, 'accountHolder': b.accountHolder, 'isDefault': b.isDefault}
                : {'id': b.id, 'isDefault': b.isDefault, 'active': b.active},
        ],
      if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
    };
    setState(() => _busy = true);
    try {
      final key = _keys.putIfAbsent(jsonEncode(body), () => const Uuid().v4());
      final id = await ref.read(vendorFormApiProvider).save(widget.id, body, idempotencyKey: key);
      ref.invalidate(vendorFormProvider);
      ref.invalidate(recordPageProvider);
      ref.invalidate(recordDetailProvider);
      if (!mounted) return;
      showSnack(context, t.recordSaved(_name.text.trim()));
      context.pop('$id');
    } on ProblemException catch (e) {
      if (mounted) {
        setState(() {
          _errors = {for (final x in e.errors) x.path: x.message};
          _summary = e.message;
        });
      }
    } on Object catch (e) {
      if (mounted) setState(() => _summary = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final d = widget.data;
    final readOnly = !d.canEdit;
    return Scaffold(
      appBar: AppBar(title: Text(_edit ? d.name : t.vendorNewTitle)),
      body: AbsorbPointer(
        absorbing: _busy || readOnly,
        child: ListView(
          key: const Key('vendor-form'),
          padding: const EdgeInsets.all(16),
          children: [
            if (readOnly) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(t.recordNoRight)),
            if (_summary != null)
              Card(
                color: theme.colorScheme.errorContainer,
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text([_summary!, ..._errors.values.map((e) => '• $e')].join('\n')),
                ),
              ),
            if (!_edit && d.companies.length > 1)
              DropdownButtonFormField<int>(
                key: const Key('vendor-company'),
                initialValue: _company,
                isExpanded: true,
                decoration: InputDecoration(labelText: '${t.cashPt} *', errorText: _errors['vendor.company']),
                items: [for (final c in d.companies) DropdownMenuItem(value: c.id, child: Text(c.label))],
                onChanged: (v) => setState(() => _company = v),
              ),
            TextField(
              key: const Key('vendor-name'),
              controller: _name,
              maxLength: 160,
              decoration: InputDecoration(labelText: '${t.clientName} *', errorText: _errors['vendor.name']),
            ),
            TextField(
              controller: _address,
              maxLength: 500,
              minLines: 1,
              maxLines: 4,
              decoration: InputDecoration(labelText: t.clientAddress),
            ),
            TextField(
              key: const Key('vendor-npwp'),
              controller: _npwp,
              maxLength: 32,
              decoration: const InputDecoration(labelText: 'NPWP'),
            ),
            if (_edit)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(t.rapActive),
                value: _active,
                onChanged: (v) => setState(() => _active = v),
              ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(child: Text(t.clientContacts, style: theme.textTheme.titleMedium)),
                TextButton.icon(
                  onPressed: () => _contact(),
                  icon: const Icon(Icons.person_add_alt),
                  label: Text(t.recordAdd),
                ),
              ],
            ),
            if (_contacts.isEmpty) Text(t.clientNoContacts, style: theme.textTheme.bodySmall),
            for (final (i, c) in _contacts.indexed)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(c.isPrimary ? '${c.name} · ${t.clientPrimary}' : c.name),
                subtitle: Text([?c.position, ?c.phone, ?c.email].join(' · ')),
                onTap: () => _contact(i),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => setState(() => _contacts.removeAt(i)),
                ),
              ),
            if (_canBanks) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: Text(t.onbBankAccounts, style: theme.textTheme.titleMedium)),
                  TextButton.icon(
                    key: const Key('vendor-bank-add'),
                    onPressed: _bank,
                    icon: const Icon(Icons.add),
                    label: Text(t.onbAddBank),
                  ),
                ],
              ),
              for (final b in _banks)
                SwitchListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text('${b.bankName ?? ''} ${b.accountNo} · ${b.accountHolder}'.trim()),
                  subtitle: Text(
                    [if (b.isDefault) t.onbDefault, if (b.verified) t.onbVerified else t.bankUnverified].join(' · '),
                  ),
                  value: b.active,
                  onChanged: b.id == null
                      ? null
                      : (v) => setState(() {
                          b.active = v;
                          b.dirty = true;
                        }),
                ),
            ],
            TextField(
              key: const Key('vendor-reason'),
              controller: _reason,
              maxLength: 1000,
              decoration: InputDecoration(
                labelText: t.cashReason,
                helperText: t.vendorReasonHint,
                helperMaxLines: 2,
                errorText: _errors['reason'],
              ),
            ),
            const SizedBox(height: 12),
            if (!readOnly)
              OnlineOnlyButton(
                key: const Key('vendor-save'),
                label: _busy ? t.cashSaving : t.save,
                icon: Icons.save_outlined,
                onPressed: _busy ? null : _save,
              ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
