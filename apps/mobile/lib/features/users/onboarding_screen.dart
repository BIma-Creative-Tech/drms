import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/format/dates.dart';
import '../../core/network/api_exception.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../shared/widgets/async_body.dart';
import '../../shared/widgets/online_only_button.dart';
import '../expense/presentation/widgets/master_picker.dart';
import '../masters/domain/master_item.dart';
import '../records/data/records_providers.dart';
import 'onboarding.dart';

/// `/users/new` and `/users/:id` (DRMS 13/10 W3 web "Pengguna" form, phase 6): Akun (email, nama, No. HP, aktif),
/// then per PT — peran, karyawan (pilih / baru), rekening, penugasan tim — and one save. A new account shows its
/// temporary password once (Keycloak asks for a new password at the first login).
class OnboardingScreen extends ConsumerWidget {
  const OnboardingScreen({super.key, this.id});
  final int? id;

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody<OnbDetail>(
    value: ref.watch(onboardingProvider(id)),
    onRetry: () => ref.invalidate(onboardingProvider(id)),
    data: (d) => _OnboardingForm(detail: d, id: id),
  );
}

class _OnboardingForm extends ConsumerStatefulWidget {
  const _OnboardingForm({required this.detail, this.id});
  final OnbDetail detail;
  final int? id;

  @override
  ConsumerState<_OnboardingForm> createState() => _OnboardingFormState();
}

class _OnboardingFormState extends ConsumerState<_OnboardingForm> {
  late final _u = widget.detail.user;
  late final _email = TextEditingController(text: '${_u?['email'] ?? ''}');
  late final _name = TextEditingController(text: '${_u?['name'] ?? ''}');
  late final _phone = TextEditingController(text: '${_u?['phone'] ?? ''}');
  final _reason = TextEditingController();
  late bool _active = _u?['active'] != false;
  bool _identityDirty = false;
  Map<String, String> _errors = const {};
  String? _summary;
  bool _busy = false;
  final _keys = <String, String>{};

  bool get _edit => widget.id != null;

  @override
  void dispose() {
    for (final c in [_email, _name, _phone, _reason]) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, Object?> _body() {
    final companies = [
      for (final c in widget.detail.companies)
        if (_edit ? c.dirty : c.roles.isNotEmpty)
          {
            'company': c.id,
            'roles': [
              for (final (r, _) in onboardingRoles)
                if (c.roles.contains(r)) r,
            ],
            if (c.employeeDirty && c.canManageEmployees) 'employee': c.employee?.toJson(),
            if (c.canManageEmployees && c.bankAccounts.any((b) => b.id == null || b.active == false || b.isDefault))
              'bankAccounts': [
                for (final b in c.bankAccounts)
                  b.id == null
                      ? {
                          'bank': b.bank,
                          'accountNo': b.accountNo,
                          'accountHolder': b.accountHolder,
                          'isDefault': b.isDefault,
                        }
                      : {'id': b.id, 'isDefault': b.isDefault, 'active': b.active},
              ],
            if (c.newAssignments.isNotEmpty)
              'assignments': [
                // `_label` is the screen's display text only (the body is strict)
                for (final a in c.newAssignments)
                  {
                    for (final e in a.entries)
                      if (e.key != '_label') e.key: e.value,
                  },
              ],
          },
    ];
    final user = {
      if (!_edit || _identityDirty) ...{
        'email': _email.text.trim(),
        'name': _name.text.trim(),
        'phone': _phone.text.trim().isEmpty ? null : _phone.text.trim(),
      },
      if (_edit && _active != (_u?['active'] != false)) 'active': _active,
    };
    return {
      if (!_edit || user.isNotEmpty) 'user': user,
      if (!_edit || companies.isNotEmpty) 'companies': companies,
      if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
    };
  }

  Future<void> _save() async {
    final t = AppLocalizations.of(context);
    final errors = <String, String>{
      if (_email.text.trim().isEmpty || !_email.text.contains('@')) 'user.email': t.onbEmailInvalid,
      if (_name.text.trim().isEmpty) 'user.name': t.clientNameRequired,
      if (!_edit && widget.detail.companies.every((c) => c.roles.isEmpty)) 'companies': t.onbPickPt,
      if (_edit && _u?['active'] != false && !_active && _reason.text.trim().length < 3) 'reason': t.reasonTooShort,
    };
    setState(() {
      _errors = errors;
      _summary = errors.isEmpty ? null : t.recordCheckFields;
    });
    if (errors.isNotEmpty) return;
    final body = _body();
    if (_edit && body.keys.every((k) => k == 'reason')) {
      setState(() => _summary = t.recordNoChanges);
      return;
    }
    setState(() => _busy = true);
    try {
      final key = _keys.putIfAbsent(jsonEncode(body), () => const Uuid().v4());
      final r = await ref.read(onboardingApiProvider).save(widget.id, body, idempotencyKey: key);
      ref.invalidate(onboardingProvider);
      ref.invalidate(recordPageProvider);
      if (!mounted) return;
      if (r.temporaryPassword case final pw?) {
        await showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (c) => AlertDialog(
            title: Text(t.onbTempPasswordTitle),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t.onbTempPasswordBody),
                const SizedBox(height: 12),
                SelectableText(pw, key: const Key('onb-temp-password'), style: Theme.of(c).textTheme.titleLarge),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Clipboard.setData(ClipboardData(text: pw)),
                child: Text(t.onbCopy),
              ),
              FilledButton(onPressed: () => Navigator.pop(c), child: Text(t.onbDone)),
            ],
          ),
        );
      } else if (r.linked && !_edit) {
        showSnack(context, t.onbLinked);
      } else {
        showSnack(context, t.recordSaved(_name.text.trim()));
      }
      if (mounted) context.pop('${r.id}');
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
    final identity = widget.detail.identityEditable;
    return Scaffold(
      appBar: AppBar(title: Text(_edit ? (_u?['name'] as String? ?? t.onbTitle) : t.onbNewTitle)),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          key: const Key('onb-form'),
          padding: const EdgeInsets.all(16),
          children: [
            Text(_edit ? '${_u?['email'] ?? ''}' : t.onbLead, style: theme.textTheme.bodySmall),
            if (_summary != null)
              Card(
                key: const Key('onb-error'),
                color: theme.colorScheme.errorContainer,
                margin: const EdgeInsets.symmetric(vertical: 12),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text([_summary!, ..._errors.entries.map((e) => '• ${e.value}')].join('\n')),
                ),
              ),
            const SizedBox(height: 8),
            Text(t.onbAccount, style: theme.textTheme.titleMedium),
            TextField(
              key: const Key('onb-email'),
              controller: _email,
              enabled: identity,
              keyboardType: TextInputType.emailAddress,
              onChanged: (_) => _identityDirty = true,
              decoration: InputDecoration(labelText: '${t.accountEmail} *', errorText: _errors['user.email']),
            ),
            TextField(
              key: const Key('onb-name'),
              controller: _name,
              enabled: identity,
              maxLength: 128,
              onChanged: (_) => _identityDirty = true,
              decoration: InputDecoration(labelText: '${t.clientName} *', errorText: _errors['user.name']),
            ),
            TextField(
              key: const Key('onb-phone'),
              controller: _phone,
              enabled: identity,
              maxLength: 32,
              keyboardType: TextInputType.phone,
              onChanged: (_) => _identityDirty = true,
              decoration: InputDecoration(labelText: t.accountPhone),
            ),
            if (!identity) Text(t.onbIdentityReadOnly, style: theme.textTheme.bodySmall),
            if (_edit)
              SwitchListTile(
                key: const Key('onb-active'),
                contentPadding: EdgeInsets.zero,
                title: Text(t.rapActive),
                subtitle: Text(t.onbActiveHint),
                value: _active,
                onChanged: (v) => setState(() => _active = v),
              ),
            const SizedBox(height: 12),
            Text(t.onbAccess, style: theme.textTheme.titleMedium),
            if (_errors['companies'] != null)
              Text(_errors['companies']!, style: TextStyle(color: theme.colorScheme.error)),
            for (final c in widget.detail.companies) _CompanyCard(company: c, onChanged: () => setState(() {})),
            TextField(
              key: const Key('onb-reason'),
              controller: _reason,
              maxLength: 1000,
              decoration: InputDecoration(
                labelText: t.cashReason,
                helperText: t.onbReasonHint,
                helperMaxLines: 3,
                errorText: _errors['reason'],
              ),
            ),
            const SizedBox(height: 12),
            OnlineOnlyButton(
              key: const Key('onb-save'),
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

/// One PT: peran (chips), karyawan (link / new / edit), rekening, penugasan tim.
class _CompanyCard extends ConsumerWidget {
  const _CompanyCard({required this.company, required this.onChanged});
  final OnbCompany company;
  final VoidCallback onChanged;

  Future<void> _employee(BuildContext context) async {
    final c = company;
    final e = await showModalBottomSheet<OnbEmployee?>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => _EmployeeSheet(company: c),
    );
    if (e == null) return;
    c.employee = e;
    c.employeeDirty = true;
    c.dirty = true;
    onChanged();
  }

  Future<void> _bank(BuildContext context) async {
    final b = await showModalBottomSheet<OnbBankAccount>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => const _BankSheet(),
    );
    if (b == null) return;
    company.bankAccounts.add(b);
    company.dirty = true;
    onChanged();
  }

  Future<void> _assignment(BuildContext context) async {
    final a = await showModalBottomSheet<Map<String, Object?>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => _AssignmentSheet(company: company),
    );
    if (a == null) return;
    company.newAssignments.add(a);
    company.dirty = true;
    onChanged();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final c = company;
    final e = c.employee;
    return Card(
      key: Key('onb-pt-${c.id}'),
      margin: const EdgeInsets.only(top: 8, bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(c.label, style: theme.textTheme.titleSmall),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final (code, label) in onboardingRoles)
                  FilterChip(
                    key: Key('onb-role-${c.id}-$code'),
                    label: Text(label),
                    selected: c.roles.contains(code),
                    onSelected: (on) {
                      on ? c.roles.add(code) : c.roles.remove(code);
                      c.dirty = true;
                      onChanged();
                    },
                  ),
              ],
            ),
            if (c.hasMembership && c.roles.isEmpty)
              Text(t.onbMembershipInactive, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
            if (c.canManageEmployees) ...[
              const Divider(height: 20),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      e == null
                          ? t.onbNoEmployee
                          : '${t.onbEmployee}: ${e.code} ${e.name}${e.active ? '' : ' (${t.rapInactive})'}',
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                  TextButton(
                    key: Key('onb-employee-${c.id}'),
                    onPressed: () => _employee(context),
                    child: Text(e == null ? t.recordPick : t.recordEdit),
                  ),
                ],
              ),
              Text(t.onbBankAccounts, style: theme.textTheme.labelLarge),
              for (final b in c.bankAccounts)
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
                      : (v) {
                          b.active = v;
                          c.dirty = true;
                          onChanged();
                        },
                ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: Key('onb-bank-add-${c.id}'),
                  onPressed: () => _bank(context),
                  icon: const Icon(Icons.add),
                  label: Text(t.onbAddBank),
                ),
              ),
            ],
            if (c.canManageAssignments && (e?.id != null || c.employeeDirty)) ...[
              const Divider(height: 20),
              Text(t.onbAssignments, style: theme.textTheme.labelLarge),
              for (final a in c.assignments)
                Text(
                  '• ${a.label} · ${a.role}${a.endDate == null ? '' : ' · s/d ${formatDateOnly(a.endDate)}'}',
                  style: theme.textTheme.bodySmall,
                ),
              for (final a in c.newAssignments)
                Text('+ ${a['_label']} · ${a['roleInProject']}', style: theme.textTheme.bodySmall),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: Key('onb-assignment-add-${c.id}'),
                  onPressed: () => _assignment(context),
                  icon: const Icon(Icons.add),
                  label: Text(t.onbAddAssignment),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Link an existing employee of the PT (not linked to another account) or create a new one; edit the linked one.
class _EmployeeSheet extends StatefulWidget {
  const _EmployeeSheet({required this.company});
  final OnbCompany company;

  @override
  State<_EmployeeSheet> createState() => _EmployeeSheetState();
}

class _EmployeeSheetState extends State<_EmployeeSheet> {
  late final OnbEmployee? _cur = widget.company.employee;
  late int? _pick = _cur?.id;
  late final _code = TextEditingController(text: _cur?.code ?? '');
  late final _name = TextEditingController(text: _cur?.name ?? '');
  late final _position = TextEditingController(text: _cur?.position ?? '');
  late final _phone = TextEditingController(text: _cur?.phone ?? '');
  late String _type = _cur?.attendanceType ?? 'onsite';
  late bool _active = _cur?.active ?? true;
  String? _error;

  @override
  void dispose() {
    for (final c in [_code, _name, _position, _phone]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final choices = widget.company.employeeChoices;
    final isNew = _pick == null;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: ListView(
        shrinkWrap: true,
        children: [
          Text(t.onbEmployee, style: Theme.of(context).textTheme.titleMedium),
          MasterPickerField(
            key: const Key('onb-employee-pick'),
            label: t.onbEmployeeExisting,
            hint: t.onbEmployeeNew,
            items: [for (final c in choices) MasterItem(c.id, c.label)],
            value: _pick,
            onChanged: (v) => setState(() => _pick = v),
          ),
          if (isNew) ...[
            TextField(
              key: const Key('onb-emp-code'),
              controller: _code,
              maxLength: 32,
              decoration: InputDecoration(labelText: '${t.onbEmployeeCode} *'),
            ),
            TextField(
              key: const Key('onb-emp-name'),
              controller: _name,
              maxLength: 128,
              decoration: InputDecoration(labelText: '${t.clientName} *'),
            ),
          ],
          TextField(
            controller: _position,
            maxLength: 128,
            decoration: InputDecoration(labelText: t.clientPosition),
          ),
          TextField(
            controller: _phone,
            maxLength: 32,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(labelText: t.accountPhone),
          ),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'onsite', label: Text(t.onbOnsite)),
              ButtonSegment(value: 'non_onsite', label: Text(t.onbNonOnsite)),
            ],
            selected: {_type},
            onSelectionChanged: (s) => setState(() => _type = s.first),
          ),
          if (!isNew)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(t.rapActive),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
          if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          const SizedBox(height: 8),
          FilledButton(
            key: const Key('onb-emp-save'),
            onPressed: () {
              if (isNew && (_code.text.trim().isEmpty || _name.text.trim().isEmpty)) {
                setState(() => _error = t.onbEmployeeRequired);
                return;
              }
              Navigator.pop(
                context,
                OnbEmployee(
                  id: _pick,
                  code: isNew ? _code.text : '',
                  name: isNew ? _name.text : '',
                  position: _position.text.trim().isEmpty ? null : _position.text.trim(),
                  phone: _phone.text.trim().isEmpty ? null : _phone.text.trim(),
                  attendanceType: _type,
                  active: _active,
                ),
              );
            },
            child: Text(t.save),
          ),
        ],
      ),
    );
  }
}

class _BankSheet extends ConsumerStatefulWidget {
  const _BankSheet();

  @override
  ConsumerState<_BankSheet> createState() => _BankSheetState();
}

class _BankSheetState extends ConsumerState<_BankSheet> {
  int? _bank;
  final _no = TextEditingController();
  final _holder = TextEditingController();
  bool _default = false;
  String? _error;

  @override
  void dispose() {
    _no.dispose();
    _holder.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final banks = ref.watch(banksProvider).value ?? const <OnbChoice>[];
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: ListView(
        shrinkWrap: true,
        children: [
          Text(t.onbAddBank, style: Theme.of(context).textTheme.titleMedium),
          MasterPickerField(
            key: const Key('onb-bank-pick'),
            label: t.onbBank,
            items: [for (final b in banks) MasterItem(b.id, b.label)],
            value: _bank,
            allowNone: false,
            onChanged: (v) => setState(() => _bank = v),
          ),
          TextField(
            key: const Key('onb-bank-no'),
            controller: _no,
            maxLength: 40,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: t.onbAccountNo),
          ),
          TextField(
            key: const Key('onb-bank-holder'),
            controller: _holder,
            maxLength: 128,
            decoration: InputDecoration(labelText: t.onbAccountHolder),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(t.onbDefault),
            value: _default,
            onChanged: (v) => setState(() => _default = v),
          ),
          if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          FilledButton(
            key: const Key('onb-bank-save'),
            onPressed: () {
              final digits = _no.text.replaceAll(RegExp(r'[\s.\-]'), '');
              if (_bank == null || !RegExp(r'^\d{5,34}$').hasMatch(digits) || _holder.text.trim().isEmpty) {
                setState(() => _error = t.onbBankInvalid);
                return;
              }
              Navigator.pop(
                context,
                OnbBankAccount(
                  bank: _bank,
                  bankName: banks.where((b) => b.id == _bank).firstOrNull?.label,
                  accountNo: digits,
                  accountHolder: _holder.text.trim(),
                  isDefault: _default,
                ),
              );
            },
            child: Text(t.save),
          ),
        ],
      ),
    );
  }
}

class _AssignmentSheet extends StatefulWidget {
  const _AssignmentSheet({required this.company});
  final OnbCompany company;

  @override
  State<_AssignmentSheet> createState() => _AssignmentSheetState();
}

class _AssignmentSheetState extends State<_AssignmentSheet> {
  String _kind = 'project';
  int? _target;
  String _role = 'staff';
  String? _error;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final c = widget.company;
    final options = switch (_kind) {
      'costCenter' => c.costCenters(),
      'site' => c.sites(),
      _ => c.projects(),
    };
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: ListView(
        shrinkWrap: true,
        children: [
          Text(t.onbAddAssignment, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'project', label: Text(t.cashProject)),
              ButtonSegment(value: 'costCenter', label: Text(t.cashCostCenter)),
              ButtonSegment(value: 'site', label: Text(t.onbSite)),
            ],
            selected: {_kind},
            onSelectionChanged: (s) => setState(() {
              _kind = s.first;
              _target = null;
            }),
          ),
          const SizedBox(height: 8),
          MasterPickerField(
            key: const Key('onb-assignment-target'),
            label: t.onbLocation,
            items: [for (final o in options) MasterItem(o.id, o.label)],
            value: _target,
            allowNone: false,
            onChanged: (v) => setState(() => _target = v),
          ),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'pm', label: Text('PM')),
              ButtonSegment(value: 'staff', label: Text('Staff')),
              ButtonSegment(value: 'mandor', label: Text('Mandor')),
            ],
            selected: {_role},
            onSelectionChanged: (s) => setState(() => _role = s.first),
          ),
          if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          const SizedBox(height: 8),
          FilledButton(
            key: const Key('onb-assignment-save'),
            onPressed: () {
              if (_target == null) {
                setState(() => _error = t.onbLocationRequired);
                return;
              }
              Navigator.pop(context, {
                _kind: _target,
                'roleInProject': _role,
                'startDate': toYmd(DateTime.now()),
                '_label': options.where((o) => o.id == _target).firstOrNull?.label ?? '#$_target',
              });
            },
            child: Text(t.save),
          ),
        ],
      ),
    );
  }
}
