import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../app/theme.dart';
import '../../core/network/api_exception.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../shared/widgets/action_feedback.dart';
import '../../shared/widgets/async_body.dart';
import '../../shared/icons/iconsax.dart';
import '../../shared/widgets/online_only_button.dart';
import '../../shared/widgets/pk_ui.dart';
import '../../shared/widgets/pk_ui_akun.dart';
import '../records/data/records_providers.dart';
import '../users/onboarding_screen.dart' show FormErrorCard;
import 'client_form.dart';

/// `/clients/new` and `/clients/:id` (DRMS 16/10 web "Klien" page, phase 5a): PT (create, several PTs), Nama, Alamat,
/// Aktif (deactivating needs a reason), Kontak PIC (one "Utama"), and the client's projects. One save.
class ClientFormScreen extends ConsumerWidget {
  const ClientFormScreen({super.key, this.id});
  final int? id;

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody<ClientFormData>(
    value: ref.watch(clientFormProvider(id)),
    onRetry: () => ref.invalidate(clientFormProvider(id)),
    data: (d) => _ClientForm(data: d, id: id),
  );
}

class _ClientForm extends ConsumerStatefulWidget {
  const _ClientForm({required this.data, this.id});
  final ClientFormData data;
  final int? id;

  @override
  ConsumerState<_ClientForm> createState() => _ClientFormState();
}

class _ClientFormState extends ConsumerState<_ClientForm> {
  late final _name = TextEditingController(text: widget.data.name);
  late final _address = TextEditingController(text: widget.data.address ?? '');
  final _reason = TextEditingController();
  late bool _active = widget.data.active;
  late int? _company = widget.data.companies.length == 1 ? widget.data.companies.single.$1 : null;
  late final List<ClientContact> _contacts = [
    for (final c in widget.data.contacts) ClientContact.fromJson(c.toJson().map((k, v) => MapEntry(k, v))),
  ];
  Map<String, String> _errors = const {};
  String? _summary;
  bool _busy = false;
  final _keys = <String, String>{};

  bool get _edit => widget.id != null;
  bool get _needsReason => _edit && widget.data.active && !_active;

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _editContact([int? index]) async {
    final c = await showModalBottomSheet<ClientContact>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => PartnerContactSheet(contact: index == null ? null : _contacts[index]),
    );
    if (c == null || !mounted) return;
    setState(() {
      if (c.isPrimary) {
        for (final x in _contacts) {
          x.isPrimary = false;
        }
      }
      index == null ? _contacts.add(c) : _contacts[index] = c;
    });
  }

  Future<void> _save() async {
    final t = AppLocalizations.of(context);
    final errors = <String, String>{
      if (_name.text.trim().isEmpty) 'client.name': t.clientNameRequired,
      if (!_edit && _company == null && widget.data.companies.length > 1) 'client.company': t.clientPtRequired,
      if (_needsReason && _reason.text.trim().length < 3) 'reason': t.reasonTooShort,
    };
    setState(() {
      _errors = errors;
      _summary = errors.isEmpty ? null : t.recordCheckFields;
    });
    if (errors.isNotEmpty) return;
    final body = <String, Object?>{
      'client': {
        if (!_edit) 'company': ?_company,
        'name': _name.text.trim(),
        'address': _address.text.trim().isEmpty ? null : _address.text.trim(),
        if (_edit) 'active': _active,
      },
      'contacts': [for (final c in _contacts) c.toJson()],
      if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
    };
    final summary = [_name.text.trim(), _address.text.trim()];
    if (!await confirmAction(context, action: t.save, summary: summary) || !mounted) return;
    setState(() => _busy = true);
    try {
      final key = _keys.putIfAbsent(jsonEncode(body), () => const Uuid().v4());
      final id = await ref.read(clientFormApiProvider).save(widget.id, body, idempotencyKey: key);
      ref.invalidate(clientFormProvider);
      ref.invalidate(recordPageProvider);
      ref.invalidate(recordDetailProvider);
      if (!mounted) return;
      await showActionResult(context, message: t.recordSaved(_name.text.trim()), action: t.save);
      if (mounted) context.pop('$id');
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

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final d = widget.data;
    final readOnly = !d.canEdit;
    return Scaffold(
      appBar: AppBar(title: Text(_edit ? d.name : t.clientNewTitle)),
      body: AbsorbPointer(
        absorbing: _busy || readOnly,
        child: ListView(
          key: const Key('client-form'),
          padding: const EdgeInsets.all(16),
          children: [
            if (readOnly) PartnerReadOnlyNote(text: t.recordNoRight),
            if (_summary != null)
              FormErrorCard(
                key: const Key('client-form-error'),
                text: [_summary!, ..._errors.values.map((e) => '• $e')].join('\n'),
              ),
            PkCard(
              margin: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (!_edit && d.companies.length > 1) ...[
                    DropdownButtonFormField<int>(
                      key: const Key('client-company'),
                      initialValue: _company,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: '${t.cashPt} *', errorText: _errors['client.company']),
                      items: [for (final (id, name) in d.companies) DropdownMenuItem(value: id, child: Text(name))],
                      onChanged: (v) => setState(() => _company = v),
                    ),
                    const SizedBox(height: 12),
                  ],
                  TextField(
                    key: const Key('client-name'),
                    controller: _name,
                    maxLength: 160,
                    decoration: InputDecoration(labelText: '${t.clientName} *', errorText: _errors['client.name']),
                  ),
                  const SizedBox(height: 4),
                  TextField(
                    key: const Key('client-address'),
                    controller: _address,
                    maxLength: 500,
                    minLines: 1,
                    maxLines: 4,
                    decoration: InputDecoration(labelText: t.clientAddress),
                  ),
                  if (_edit)
                    SwitchListTile(
                      key: const Key('client-active'),
                      contentPadding: EdgeInsets.zero,
                      title: Text(t.rapActive),
                      value: _active,
                      onChanged: (v) => setState(() => _active = v),
                    ),
                  if (_needsReason)
                    TextField(
                      key: const Key('client-reason'),
                      controller: _reason,
                      maxLength: 1000,
                      decoration: InputDecoration(labelText: '${t.cashReason} *', errorText: _errors['reason']),
                    ),
                ],
              ),
            ),
            PkSectionCard(
              title: t.clientContacts,
              icon: PkIcons.users,
              trailing: TextButton.icon(
                key: const Key('client-contact-add'),
                onPressed: _contacts.length >= 20 ? null : () => _editContact(),
                icon: const Icon(Icons.person_add_alt),
                label: Text(t.recordAdd),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_contacts.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Text(
                        t.clientNoContacts,
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ),
                  for (final (i, c) in _contacts.indexed) ...[
                    if (i > 0) const PkRowDivider(indent: 52),
                    PartnerContactRow(
                      key: Key('client-contact-$i'),
                      contact: c,
                      onTap: () => _editContact(i),
                      onDelete: () => setState(() => _contacts.removeAt(i)),
                    ),
                  ],
                ],
              ),
            ),
            if (d.projects.isNotEmpty)
              PkSectionCard(
                title: t.clientProjects,
                icon: PkIcons.project,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final p in d.projects)
                      Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Text('• $p')),
                  ],
                ),
              ),
            const SizedBox(height: 4),
            if (!readOnly)
              OnlineOnlyButton(
                key: const Key('client-save'),
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

/// "Tidak ada hak" note above a read-only partner form.
class PartnerReadOnlyNote extends StatelessWidget {
  const PartnerReadOnlyNote({super.key, required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    return PkCard(
      color: pk.infoBg,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Icon(Icons.lock_outline, size: 18, color: pk.infoOn),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: TextStyle(color: pk.infoOn)),
          ),
        ],
      ),
    );
  }
}

/// One Kontak PIC row (client / vendor form): initials, name (+ "Utama"), jabatan · HP · email, delete.
class PartnerContactRow extends StatelessWidget {
  const PartnerContactRow({super.key, required this.contact, required this.onTap, required this.onDelete});
  final ClientContact contact;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final c = contact;
    final meta = [?c.position, ?c.phone, ?c.email].join(' · ');
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(PkRadius.sm),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            PkAvatar(name: c.name, size: 40),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    c.isPrimary ? '${c.name} · ${t.clientPrimary}' : c.name,
                    style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  if (meta.isNotEmpty)
                    Text(meta, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                ],
              ),
            ),
            IconButton(icon: const Icon(Icons.delete_outline), onPressed: onDelete),
          ],
        ),
      ),
    );
  }
}

class PartnerContactSheet extends StatefulWidget {
  const PartnerContactSheet({super.key, this.contact});
  final ClientContact? contact;

  @override
  State<PartnerContactSheet> createState() => _PartnerContactSheetState();
}

class _PartnerContactSheetState extends State<PartnerContactSheet> {
  late final _name = TextEditingController(text: widget.contact?.name ?? '');
  late final _position = TextEditingController(text: widget.contact?.position ?? '');
  late final _phone = TextEditingController(text: widget.contact?.phone ?? '');
  late final _email = TextEditingController(text: widget.contact?.email ?? '');
  late final _notes = TextEditingController(text: widget.contact?.notes ?? '');
  late bool _primary = widget.contact?.isPrimary ?? false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_name, _position, _phone, _email, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _v(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: ListView(
        shrinkWrap: true,
        children: [
          Text(t.clientContact, style: Theme.of(context).textTheme.titleMedium),
          TextField(
            key: const Key('contact-name'),
            controller: _name,
            maxLength: 128,
            decoration: InputDecoration(labelText: '${t.clientName} *', errorText: _error),
          ),
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
          TextField(
            controller: _email,
            maxLength: 254,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(labelText: t.accountEmail),
          ),
          TextField(
            controller: _notes,
            maxLength: 500,
            decoration: InputDecoration(labelText: t.clientNotes),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(t.clientPrimary),
            value: _primary,
            onChanged: (v) => setState(() => _primary = v),
          ),
          FilledButton(
            key: const Key('contact-save'),
            onPressed: () {
              if (_name.text.trim().isEmpty) {
                setState(() => _error = t.clientNameRequired);
                return;
              }
              Navigator.pop(
                context,
                ClientContact(
                  id: widget.contact?.id,
                  name: _name.text.trim(),
                  position: _v(_position),
                  phone: _v(_phone),
                  email: _v(_email),
                  notes: _v(_notes),
                  isPrimary: _primary,
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
