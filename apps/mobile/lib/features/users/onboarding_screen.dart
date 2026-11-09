import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../app/theme.dart';
import '../../core/format/dates.dart';
import '../../core/network/api_exception.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../shared/widgets/action_feedback.dart';
import '../../shared/widgets/async_body.dart';
import '../../shared/icons/iconsax.dart';
import '../../shared/widgets/online_only_button.dart';
import '../../shared/widgets/pk_ui.dart';
import '../../shared/widgets/pk_ui_akun.dart';
import '../auth/application/auth_controller.dart';
import '../expense/presentation/widgets/master_picker.dart';
import '../masters/domain/master_item.dart';
import '../records/data/records_providers.dart';
import 'onboarding.dart';

/// `/users/new` and `/users/:id` (DRMS 13/10 W3 web "Pengguna" form, phase 6): Akun (email, nama, No. HP, aktif),
/// then per PT — peran, karyawan (pilih / baru), rekening, penugasan tim — and one save. A new account shows its
/// temporary password once (Keycloak asks for a new password at the first login); an existing one can get a new
/// temporary password with "Reset password" (DRMS 27/10).
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
    final summary = [_name.text.trim(), _email.text.trim()];
    if (!await confirmAction(context, action: t.save, summary: summary) || !mounted) return;
    setState(() => _busy = true);
    try {
      final key = _keys.putIfAbsent(jsonEncode(body), () => const Uuid().v4());
      final r = await ref.read(onboardingApiProvider).save(widget.id, body, idempotencyKey: key);
      ref.invalidate(onboardingProvider);
      ref.invalidate(recordPageProvider);
      if (!mounted) return;
      if (r.temporaryPassword case final pw?) {
        await _showTemporaryPassword(pw, t.onbTempPasswordBody);
      } else {
        final done = r.linked && !_edit ? t.onbLinked : t.recordSaved(_name.text.trim());
        await showActionResult(context, message: done, action: t.save);
      }
      if (mounted) context.pop('${r.id}');
    } on ProblemException catch (e) {
      if (!mounted) return;
      setState(() {
        _errors = {for (final x in e.errors) x.path: x.message};
        _summary = e.message;
      });
      await showActionError(context, e, action: t.save);
    } on Object catch (e) {
      if (!mounted) return;
      setState(() => _summary = errorText(e));
      await showActionError(context, e, action: t.save);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// A temporary password, shown once (new account, or a reset): [body], the password, Salin, Selesai.
  Future<void> _showTemporaryPassword(String pw, String body) {
    final t = AppLocalizations.of(context);
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (c) => AlertDialog(
        title: Text(t.onbTempPasswordTitle),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(body),
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
  }

  /// DRMS 27/10 (web "Reset password", server 0.23.0): same rule as editing the identity — not the own account, not
  /// an inactive one (the stored state, not the unsaved switch); the server re-checks.
  bool _mayResetPassword(int? selfId) =>
      _edit && widget.detail.identityEditable && _u?['active'] != false && widget.detail.id != selfId;

  /// Confirm → `POST /user-onboarding/{id}/reset-password` → the new temporary password, shown once. The old password
  /// stops working; open sessions stay.
  Future<void> _resetPassword() async {
    final t = AppLocalizations.of(context);
    final id = widget.detail.id;
    if (id == null || _busy) return;
    final yes = await confirmAction(
      context,
      action: t.onbResetPasswordAction,
      summary: ['${_u?['name'] ?? ''}', '${_u?['email'] ?? ''}'],
      note: t.onbResetPasswordNote,
      confirmKey: const Key('onb-reset-password-confirm'),
    );
    if (!yes || !mounted) return;
    setState(() => _busy = true);
    try {
      final pw = await ref.read(onboardingApiProvider).resetPassword(id);
      if (mounted) await _showTemporaryPassword(pw, t.onbResetPasswordBody);
    } on Object catch (e) {
      if (mounted) await showActionError(context, e, action: t.onbResetPasswordAction);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final identity = widget.detail.identityEditable;
    final pk = context.pk;
    final mayReset = _mayResetPassword(ref.watch(currentProfileProvider)?.id);
    return Scaffold(
      appBar: AppBar(title: Text(_edit ? (_u?['name'] as String? ?? t.onbTitle) : t.onbNewTitle)),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          key: const Key('onb-form'),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          children: [
            // header: who (edit) or what this form does (new)
            if (_edit)
              PkCard(
                margin: const EdgeInsets.only(bottom: 12),
                child: Row(
                  children: [
                    PkAvatar(name: '${_u?['name'] ?? _u?['email'] ?? ''}', size: 44),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        '${_u?['email'] ?? ''}',
                        style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                    const SizedBox(width: 8),
                    PkPill(
                      label: _u?['active'] != false ? t.rapActive : t.rapInactive,
                      tone: _u?['active'] != false ? PkTone.ok : PkTone.bad,
                    ),
                  ],
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
                child: Text(
                  t.onbLead,
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
            if (_summary != null)
              FormErrorCard(
                key: const Key('onb-error'),
                text: [_summary!, ..._errors.entries.map((e) => '• ${e.value}')].join('\n'),
              ),
            PkSectionCard(
              title: t.onbAccount,
              icon: PkIcons.profile,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 4),
                  TextField(
                    key: const Key('onb-email'),
                    controller: _email,
                    enabled: identity,
                    keyboardType: TextInputType.emailAddress,
                    onChanged: (_) => _identityDirty = true,
                    decoration: InputDecoration(labelText: '${t.accountEmail} *', errorText: _errors['user.email']),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    key: const Key('onb-name'),
                    controller: _name,
                    enabled: identity,
                    maxLength: 128,
                    onChanged: (_) => _identityDirty = true,
                    decoration: InputDecoration(labelText: '${t.clientName} *', errorText: _errors['user.name']),
                  ),
                  const SizedBox(height: 4),
                  TextField(
                    key: const Key('onb-phone'),
                    controller: _phone,
                    enabled: identity,
                    maxLength: 32,
                    keyboardType: TextInputType.phone,
                    onChanged: (_) => _identityDirty = true,
                    decoration: InputDecoration(labelText: t.accountPhone),
                  ),
                  if (!identity)
                    Text(
                      t.onbIdentityReadOnly,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  if (_edit)
                    SwitchListTile(
                      key: const Key('onb-active'),
                      contentPadding: EdgeInsets.zero,
                      title: Text(t.rapActive),
                      subtitle: Text(t.onbActiveHint),
                      value: _active,
                      onChanged: (v) => setState(() => _active = v),
                    ),
                  if (mayReset) ...[
                    const Divider(height: 24),
                    Text(t.onbPassword, style: theme.textTheme.labelLarge),
                    const SizedBox(height: 4),
                    Text(
                      t.onbResetPasswordHint,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 8),
                    OnlineOnlyButton(
                      key: const Key('onb-reset-password'),
                      label: t.onbResetPassword,
                      icon: Icons.lock_reset,
                      outlined: true,
                      onPressed: _busy ? null : _resetPassword,
                    ),
                    const SizedBox(height: 8),
                  ],
                ],
              ),
            ),
            PkSectionHeader(title: t.onbAccess, padding: const EdgeInsets.only(top: 8, bottom: 10)),
            if (_errors['companies'] != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(_errors['companies']!, style: TextStyle(color: pk.badText)),
              ),
            for (final c in widget.detail.companies) _CompanyCard(company: c, onChanged: () => setState(() {})),
            PkCard(
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: TextField(
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
            ),
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

/// Error summary above a form (server / validation messages), soft red card.
class FormErrorCard extends StatelessWidget {
  const FormErrorCard({super.key, required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    return PkCard(
      color: pk.badBg,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, color: pk.badOn, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: TextStyle(color: pk.badOn)),
          ),
        ],
      ),
    );
  }
}

/// Bank account row (onboarding, vendor): icon chip, "Bank No · Atas nama", Utama / Terverifikasi, active switch.
class BankAccountRow extends StatelessWidget {
  const BankAccountRow({super.key, required this.account, required this.onActive});
  final ({String? bankName, String accountNo, String accountHolder, bool isDefault, bool verified, bool active})
  account;

  /// null = not switchable (a new, unsaved account).
  final ValueChanged<bool>? onActive;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final b = account;
    return SwitchListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      secondary: PkIconChip(
        icon: PkIcons.finance,
        tone: !b.active ? PkTone.neutral : (b.verified ? PkTone.ok : PkTone.warn),
        size: 36,
      ),
      title: Text(
        '${b.bankName ?? ''} ${b.accountNo} · ${b.accountHolder}'.trim(),
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
      ),
      subtitle: Text([if (b.isDefault) t.onbDefault, if (b.verified) t.onbVerified else t.bankUnverified].join(' · ')),
      value: b.active,
      onChanged: onActive,
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
      builder: (_) => const BankAccountSheet(),
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
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return PkSectionCard(
      key: Key('onb-pt-${c.id}'),
      title: c.label,
      icon: Icons.business_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 4),
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
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                t.onbMembershipInactive,
                style: theme.textTheme.bodySmall?.copyWith(color: context.pk.badText),
              ),
            ),
          if (c.canManageEmployees) ...[
            const PkRowDivider(indent: 0),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  PkIconChip(icon: PkIcons.profile, tone: e == null ? PkTone.neutral : PkTone.info, size: 36),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      e == null
                          ? t.onbNoEmployee
                          : '${t.onbEmployee}: ${e.code} ${e.name}${e.active ? '' : ' (${t.rapInactive})'}',
                      style: theme.textTheme.bodyMedium?.copyWith(fontWeight: e == null ? null : FontWeight.w600),
                    ),
                  ),
                  TextButton(
                    key: Key('onb-employee-${c.id}'),
                    onPressed: () => _employee(context),
                    child: Text(e == null ? t.recordPick : t.recordEdit),
                  ),
                ],
              ),
            ),
            const PkRowDivider(indent: 0),
            _SubTitle(t.onbBankAccounts),
            for (final b in c.bankAccounts)
              BankAccountRow(
                account: (
                  bankName: b.bankName,
                  accountNo: b.accountNo,
                  accountHolder: b.accountHolder,
                  isDefault: b.isDefault,
                  verified: b.verified,
                  active: b.active,
                ),
                onActive: b.id == null
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
            const PkRowDivider(indent: 0),
            _SubTitle(t.onbAssignments),
            for (final a in c.assignments)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  '• ${a.label} · ${a.role}${a.endDate == null ? '' : ' · s/d ${formatDateOnly(a.endDate)}'}',
                  style: muted,
                ),
              ),
            for (final a in c.newAssignments)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  '+ ${a['_label']} · ${a['roleInProject']}',
                  style: theme.textTheme.bodySmall?.copyWith(color: context.pk.okText, fontWeight: FontWeight.w600),
                ),
              ),
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
    );
  }
}

/// Sub-heading inside a PT card ("Rekening", "Penugasan tim").
class _SubTitle extends StatelessWidget {
  const _SubTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 10, bottom: 4),
    child: Text(
      text,
      style: Theme.of(context).textTheme.labelLarge?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
    ),
  );
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

class BankAccountSheet extends ConsumerStatefulWidget {
  const BankAccountSheet({super.key});

  @override
  ConsumerState<BankAccountSheet> createState() => _BankAccountSheetState();
}

class _BankAccountSheetState extends ConsumerState<BankAccountSheet> {
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
              // ADR 0032: no site option any more (sites removed from the product)
              ButtonSegment(value: 'costCenter', label: Text(t.cashCostCenter)),
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
