import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/providers.dart';
import '../../../../core/platform/report_files.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/async_body.dart';
import '../../domain/draft.dart';
import '../../domain/expense_request.dart';

/// D2410 (point 6): where a new general attachment comes from — camera / gallery photo or a JPG / PNG / PDF file.
enum AttachmentSource { camera, gallery, file }

/// D2410 (point 6): the "Lampiran" block of the draft editor — the attached files (photo / PDF, on the phone or already
/// on the server), "Kamera" / "Galeri" / "File" and the server's rule as a hint: optional for Pengajuan Baru, at least
/// one for a Reimburse ([mandatory]).
class DraftAttachmentsSection extends StatelessWidget {
  const DraftAttachmentsSection({
    super.key,
    required this.attachments,
    required this.mandatory,
    required this.enabled,
    required this.onAdd,
    required this.onRemove,
    this.error,
  });

  final List<DraftAttachment> attachments;
  final bool mandatory;
  final bool enabled;
  final void Function(AttachmentSource source) onAdd;
  final void Function(DraftAttachment attachment) onRemove;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final full = attachments.length >= maxDraftAttachments;
    return Column(
      key: const Key('draft-attachments'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          mandatory ? t.attachmentsRequired : t.attachmentsOptional,
          key: const Key('draft-attachments-label'),
          style: theme.textTheme.titleSmall,
        ),
        Text(t.attachmentsHint, style: theme.textTheme.bodySmall),
        for (final (i, a) in attachments.indexed)
          ListTile(
            key: Key('draft-attachment-$i'),
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(a.isPdf ? Icons.picture_as_pdf : Icons.image),
            title: Text(a.fileName),
            subtitle: Text(a.isLocal ? t.attachmentLocal : t.attachmentOnServer),
            trailing: IconButton(
              key: Key('draft-attachment-$i-remove'),
              tooltip: t.attachmentRemove,
              icon: const Icon(Icons.delete_outline),
              onPressed: enabled ? () => onRemove(a) : null,
            ),
          ),
        if (error != null)
          Text(error!, key: const Key('draft-attachments-error'), style: TextStyle(color: theme.colorScheme.error)),
        Wrap(
          spacing: 8,
          children: [
            OutlinedButton.icon(
              key: const Key('draft-attachment-camera'),
              onPressed: enabled && !full ? () => onAdd(AttachmentSource.camera) : null,
              icon: const Icon(Icons.photo_camera),
              label: Text(t.invoiceCamera),
            ),
            OutlinedButton.icon(
              key: const Key('draft-attachment-gallery'),
              onPressed: enabled && !full ? () => onAdd(AttachmentSource.gallery) : null,
              icon: const Icon(Icons.photo_library),
              label: Text(t.invoiceGallery),
            ),
            OutlinedButton.icon(
              key: const Key('draft-attachment-file'),
              onPressed: enabled && !full ? () => onAdd(AttachmentSource.file) : null,
              icon: const Icon(Icons.attach_file),
              label: Text(t.attachmentFile),
            ),
          ],
        ),
      ],
    );
  }
}

/// D2410 (point 6): the request's general attachments on the detail screen; a tap downloads the file through the
/// authorized endpoint and opens it in a viewer app (else the share sheet).
class RequestAttachmentList extends ConsumerStatefulWidget {
  const RequestAttachmentList({super.key, required this.attachments});
  final List<RequestAttachment> attachments;

  @override
  ConsumerState<RequestAttachmentList> createState() => _RequestAttachmentListState();
}

class _RequestAttachmentListState extends ConsumerState<RequestAttachmentList> {
  int? _opening;

  Future<void> _open(RequestAttachment a) async {
    final t = AppLocalizations.of(context);
    final files = ref.read(reportFilesProvider);
    setState(() => _opening = a.id);
    try {
      final bytes = await ref.read(expenseApiProvider).attachmentFile(a.id);
      final name = attachmentCacheName(a);
      if (!await files.save(name, bytes)) {
        if (mounted) showSnack(context, t.reportsSaveFailed);
        return;
      }
      if (!await files.open(name) && !await files.share(name) && mounted) showSnack(context, t.reportsNoApp);
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _opening = null);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (final a in widget.attachments)
        ListTile(
          key: Key('detail-attachment-${a.id}'),
          dense: true,
          contentPadding: EdgeInsets.zero,
          leading: Icon(a.isPdf ? Icons.picture_as_pdf : Icons.image),
          title: Text(a.label),
          trailing: _opening == a.id
              ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.open_in_new),
          onTap: _opening == null ? () => _open(a) : null,
        ),
    ],
  );
}

/// Cache file name of a downloaded attachment (ReportFileProvider name rule: letters, digits, `._-`), keeping a known
/// extension so the viewer app gets the right type.
String attachmentCacheName(RequestAttachment a) {
  final ext = a.label.contains('.') ? a.label.split('.').last.toLowerCase() : '';
  final format = const {'pdf', 'jpg', 'jpeg', 'png'}.contains(ext) ? ext : (a.isPdf ? 'pdf' : 'jpg');
  return reportFileName('filename="${a.label}"', fallback: 'lampiran-${a.id}', format: format);
}
