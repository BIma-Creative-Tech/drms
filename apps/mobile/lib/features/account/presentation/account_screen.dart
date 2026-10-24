import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:signature/signature.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../application/account_providers.dart';
import '../domain/account.dart';

/// Server limit of a signature upload (media-signatures: PNG ≤ 2 MB, resized to ≤ 800×300).
const maxProfileSignatureBytes = 2 * 1024 * 1024;

/// "Profil & tanda tangan" (user 2026-10-19, web avatar menu → own user doc, F2c): account data read-only (Admin
/// manages it), profile signature drawn on screen or picked from the gallery, saved with `PUT /me/signature`.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final account = ref.watch(meAccountProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.accountTitle)),
      body: AsyncBody<MeAccount>(
        value: account,
        onRetry: () => ref.invalidate(meAccountProvider),
        data: (a) => RefreshIndicator(
          onRefresh: () => ref.refresh(meAccountProvider.future),
          child: ListView(
            padding: const EdgeInsets.only(bottom: 24),
            children: [
              ListTile(
                key: const Key('account-name'),
                leading: const Icon(Icons.person_outline),
                title: Text(t.accountName),
                subtitle: Text(a.name ?? '-'),
              ),
              ListTile(
                leading: const Icon(Icons.badge_outlined),
                title: Text(t.accountDisplayName),
                subtitle: Text(a.displayName),
              ),
              ListTile(
                key: const Key('account-email'),
                leading: const Icon(Icons.alternate_email),
                title: Text(t.accountEmail),
                subtitle: Text(a.email),
              ),
              ListTile(
                leading: const Icon(Icons.phone_outlined),
                title: Text(t.accountPhone),
                subtitle: Text(a.phone ?? '-'),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Text(
                  t.accountAdminManaged,
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ),
              const Divider(),
              _SignatureSection(account: a),
            ],
          ),
        ),
      ),
    );
  }
}

class _SignatureSection extends ConsumerStatefulWidget {
  const _SignatureSection({required this.account});
  final MeAccount account;

  @override
  ConsumerState<_SignatureSection> createState() => _SignatureSectionState();
}

class _SignatureSectionState extends ConsumerState<_SignatureSection> {
  bool _busy = false;

  Future<void> _run(Future<MeAccount> Function() action, String done, String label) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(meAccountProvider);
      if (mounted) await showActionResult(context, message: done, action: label);
    } on Object catch (e) {
      if (mounted) await showActionError(context, e, action: label);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save(Uint8List png) async {
    final t = AppLocalizations.of(context);
    final api = ref.read(accountApiProvider);
    final label = t.accountSignatureSaveAction;
    if (!await confirmAction(context, action: label) || !mounted) return;
    await _run(() async => api.setSignature(await api.uploadSignature(png)), t.accountSignatureSaved, label);
  }

  Future<void> _draw() async {
    final png = await showModalBottomSheet<Uint8List>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => const _DrawSignatureSheet(),
    );
    if (png != null && mounted) await _save(png);
  }

  Future<void> _pick() async {
    final t = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final file = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 800,
      maxHeight: 300,
      requestFullMetadata: false,
    );
    if (file == null) return;
    final png = await _asPng(await file.readAsBytes());
    if (!mounted) return;
    if (png == null || png.length > maxProfileSignatureBytes) {
      messenger.showSnackBar(SnackBar(content: Text(t.accountSignatureNotPng)));
      return;
    }
    await _save(png);
  }

  Future<void> _remove() async {
    final t = AppLocalizations.of(context);
    final label = t.accountSignatureRemoveAction;
    final ok = await confirmAction(
      context,
      action: label,
      note: t.accountSignatureRemoveConfirm,
      confirmKey: const Key('account-signature-remove-confirm'),
    );
    if (!ok || !mounted) return;
    await _run(() => ref.read(accountApiProvider).setSignature(null), t.accountSignatureRemoved, label);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final id = widget.account.signatureId;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t.accountSignature, style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            t.accountSignatureHint,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          Container(
            key: const Key('account-signature'),
            height: 120,
            width: double.infinity,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: theme.colorScheme.outlineVariant),
              borderRadius: BorderRadius.circular(12),
            ),
            child: id == null
                ? Text(
                    t.accountSignatureNone,
                    key: const Key('account-signature-none'),
                    style: theme.textTheme.bodyMedium?.copyWith(color: Colors.black54),
                  )
                : _SignatureImage(id: id),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                key: const Key('account-signature-draw'),
                onPressed: _busy ? null : _draw,
                icon: const Icon(Icons.draw_outlined),
                label: Text(t.accountSignatureDraw),
              ),
              OutlinedButton.icon(
                key: const Key('account-signature-upload'),
                onPressed: _busy ? null : _pick,
                icon: const Icon(Icons.image_outlined),
                label: Text(t.accountSignatureUpload),
              ),
              if (id != null)
                TextButton.icon(
                  key: const Key('account-signature-remove'),
                  onPressed: _busy ? null : _remove,
                  icon: const Icon(Icons.delete_outline),
                  label: Text(t.accountSignatureRemove),
                ),
            ],
          ),
          if (_busy) const Padding(padding: EdgeInsets.only(top: 12), child: LinearProgressIndicator()),
        ],
      ),
    );
  }
}

/// PNG file signature (`\x89PNG`).
bool isPng(Uint8List b) => b.length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47;

/// PNG as is; any other image (gallery JPG/HEIC) re-encoded as PNG on the phone. null = not decodable.
Future<Uint8List?> _asPng(Uint8List raw) async {
  if (isPng(raw)) return raw;
  try {
    return await FlutterImageCompress.compressWithList(raw, minWidth: 800, minHeight: 300, format: CompressFormat.png);
  } on Object {
    return null;
  }
}

class _SignatureImage extends ConsumerWidget {
  const _SignatureImage({required this.id});
  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) => switch (ref.watch(profileSignatureImageProvider(id))) {
    AsyncData(:final value) => Padding(
      padding: const EdgeInsets.all(8),
      child: Image.memory(value, key: const Key('account-signature-image'), fit: BoxFit.contain),
    ),
    AsyncError() => const Icon(Icons.broken_image_outlined, color: Colors.black38),
    _ => const SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 2)),
  };
}

/// Signature pad (same pen as the decision sheet, US-43) → PNG 800×300 on a transparent background.
class _DrawSignatureSheet extends StatefulWidget {
  const _DrawSignatureSheet();

  @override
  State<_DrawSignatureSheet> createState() => _DrawSignatureSheetState();
}

class _DrawSignatureSheetState extends State<_DrawSignatureSheet> {
  final _pad = SignatureController(penStrokeWidth: 2.5, exportBackgroundColor: Colors.transparent);
  String? _error;

  @override
  void dispose() {
    _pad.dispose();
    super.dispose();
  }

  Future<void> _done() async {
    final t = AppLocalizations.of(context);
    if (_pad.isEmpty) {
      setState(() => _error = t.signatureEmpty);
      return;
    }
    final png = await _pad.toPngBytes(width: 800, height: 300);
    if (!mounted) return;
    if (png == null || png.length > maxProfileSignatureBytes) {
      setState(() => _error = t.signatureTooLarge);
      return;
    }
    Navigator.of(context).pop(png);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(t.accountSignatureDrawTitle, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          AspectRatio(
            aspectRatio: 8 / 3,
            child: DecoratedBox(
              decoration: BoxDecoration(border: Border.all(color: Theme.of(context).colorScheme.outline)),
              child: Signature(
                key: const Key('account-signature-pad'),
                controller: _pad,
                backgroundColor: Colors.white,
              ),
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(onPressed: _pad.clear, child: Text(t.signatureClear)),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          FilledButton(key: const Key('account-signature-save'), onPressed: _done, child: Text(t.save)),
          TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(t.cancel)),
        ],
      ),
    );
  }
}
