import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/providers.dart';
import '../../../../core/platform/report_files.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/async_body.dart';
import '../../../../shared/widgets/media_thumb.dart';
import '../../../../shared/widgets/pk_ui.dart';
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
    // D2510: a titled card like the other form sections.
    return PkCard(
      key: const Key('draft-attachments'),
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const PkIconChip(icon: Icons.attach_file, size: 30),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  mandatory ? t.attachmentsRequired : t.attachmentsOptional,
                  key: const Key('draft-attachments-label'),
                  style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            t.attachmentsHint,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          for (final (i, a) in attachments.indexed)
            ListTile(
              key: Key('draft-attachment-$i'),
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: PkIconChip(
                icon: a.isPdf ? Icons.picture_as_pdf : Icons.image,
                tone: a.isPdf ? PkTone.bad : PkTone.info,
                size: 34,
              ),
              title: Text(a.fileName, style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(a.isLocal ? t.attachmentLocal : t.attachmentOnServer),
              trailing: IconButton(
                key: Key('draft-attachment-$i-remove'),
                tooltip: t.attachmentRemove,
                icon: const Icon(Icons.delete_outline),
                onPressed: enabled ? () => onRemove(a) : null,
              ),
            ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                error!,
                key: const Key('draft-attachments-error'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
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
      ),
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
  Widget build(BuildContext context) {
    // D2510 (user 2026-10-25): a photo attachment shows its thumbnail and opens in the in-app viewer (swiping through
    // the request's photo attachments); a PDF stays a file link (viewer app / share sheet).
    final photos = [
      for (final a in widget.attachments)
        if (!a.isPdf) MediaPhoto.media('attachments', a.id, caption: a.label),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final a in widget.attachments)
          ListTile(
            key: Key('detail-attachment-${a.id}'),
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: a.isPdf
                ? const PkIconChip(icon: Icons.picture_as_pdf, tone: PkTone.bad, size: 34)
                : MediaThumb(
                    photo: MediaPhoto.media('attachments', a.id, caption: a.label),
                    group: photos,
                    size: 40,
                  ),
            title: Text(a.label, style: const TextStyle(fontWeight: FontWeight.w600)),
            trailing: _opening == a.id
                ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(a.isPdf ? Icons.open_in_new : Icons.zoom_in),
            onTap: _opening != null
                ? null
                : a.isPdf
                ? () => _open(a)
                : () {
                    final p = MediaPhoto.media('attachments', a.id, caption: a.label);
                    showMediaViewer(context, photos, initialIndex: photos.indexOf(p));
                  },
          ),
      ],
    );
  }
}

/// Cache file name of a downloaded attachment (ReportFileProvider name rule: letters, digits, `._-`), keeping a known
/// extension so the viewer app gets the right type.
String attachmentCacheName(RequestAttachment a) {
  final ext = a.label.contains('.') ? a.label.split('.').last.toLowerCase() : '';
  final format = const {'pdf', 'jpg', 'jpeg', 'png'}.contains(ext) ? ext : (a.isPdf ? 'pdf' : 'jpg');
  return reportFileName('filename="${a.label}"', fallback: 'lampiran-${a.id}', format: format);
}
