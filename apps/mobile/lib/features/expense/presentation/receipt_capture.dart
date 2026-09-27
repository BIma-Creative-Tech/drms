import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/media/compress_plan.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../auth/domain/user_profile.dart';
import 'camera_capture_screen.dart';

/// Receipt photo target: requirements §9 (1600 px, q≈80, ≤ 400 KB), never above the server's
/// `imageTargets.receiptsMaxPx` (the server re-encodes anyway, ADR 0004).
PhotoTarget receiptTargetFor(UserProfile? profile) {
  final serverMax = profile?.imageTargets.receiptsMaxPx ?? PhotoTarget.receipt.maxSide;
  return PhotoTarget(
    maxSide: serverMax < PhotoTarget.receipt.maxSide ? serverMax : PhotoTarget.receipt.maxSide,
    quality: PhotoTarget.receipt.quality,
    maxBytes: PhotoTarget.receipt.maxBytes,
  );
}

/// Rear camera (full-screen capture) or gallery (Q-41 default: allowed for receipts, e.g. booking
/// screenshots; never for selfies). Returns the RAW bytes; callers compress on the device.
Future<Uint8List?> pickReceiptImage(BuildContext context, {required bool fromCamera}) async {
  if (fromCamera) {
    return Navigator.of(context).push<Uint8List>(MaterialPageRoute(builder: (_) => const CameraCaptureScreen()));
  }
  final file = await ImagePicker().pickImage(source: ImageSource.gallery, requestFullMetadata: false);
  return file?.readAsBytes();
}

/// Data typed by the user for one receipt (openapi `ReceiptCreate` without `lineId`/`imageId`).
class ReceiptFields {
  const ReceiptFields({
    required this.vendorName,
    this.receiptNo,
    required this.receiptDate,
    this.receiptTime,
    required this.amount,
  });
  final String vendorName;
  final String? receiptNo;
  final String receiptDate; // YYYY-MM-DD
  final String? receiptTime; // HH:MM
  final int amount;
}

class ReceiptDetailsDialog extends StatefulWidget {
  const ReceiptDetailsDialog({super.key, required this.photo, this.defaultAmount});
  final Uint8List photo;
  final int? defaultAmount;

  @override
  State<ReceiptDetailsDialog> createState() => _ReceiptDetailsDialogState();
}

class _ReceiptDetailsDialogState extends State<ReceiptDetailsDialog> {
  final _form = GlobalKey<FormState>();
  final _no = TextEditingController();
  final _vendor = TextEditingController();
  late final _amount = TextEditingController(text: widget.defaultAmount?.toString() ?? '');
  DateTime _date = DateTime.now();
  TimeOfDay? _time;

  @override
  void dispose() {
    _no.dispose();
    _vendor.dispose();
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(t.receiptDetailsTitle),
      content: SingleChildScrollView(
        child: Form(
          key: _form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(height: 140, child: Image.memory(widget.photo, fit: BoxFit.contain)),
              TextFormField(
                key: const Key('receipt-vendor'),
                controller: _vendor,
                maxLength: 160,
                decoration: InputDecoration(labelText: t.receiptVendor),
                validator: (v) => (v == null || v.trim().isEmpty) ? t.required : null,
              ),
              TextFormField(
                controller: _no,
                maxLength: 64,
                decoration: InputDecoration(labelText: t.receiptNo),
              ),
              TextFormField(
                key: const Key('receipt-amount'),
                controller: _amount,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(labelText: t.receiptAmount, prefixText: 'Rp '),
                validator: (v) => (parseRupiah(v ?? '') ?? 0) <= 0 ? t.invalidAmount : null,
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(t.receiptDate),
                subtitle: Text(formatDateOnly(toYmd(_date))),
                trailing: const Icon(Icons.calendar_today),
                onTap: () async {
                  final d = await showDatePicker(
                    context: context,
                    initialDate: _date,
                    firstDate: DateTime(2020),
                    lastDate: DateTime.now(),
                  );
                  if (d != null) setState(() => _date = d);
                },
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(t.receiptTime),
                subtitle: Text(_time == null ? '-' : _time!.format(context)),
                trailing: const Icon(Icons.schedule),
                onTap: () async {
                  final tm = await showTimePicker(context: context, initialTime: _time ?? TimeOfDay.now());
                  if (tm != null) setState(() => _time = tm);
                },
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: const Key('receipt-save'),
          onPressed: () {
            if (!(_form.currentState?.validate() ?? false)) return;
            String two(int v) => v.toString().padLeft(2, '0');
            Navigator.pop(
              context,
              ReceiptFields(
                receiptNo: _no.text.trim().isEmpty ? null : _no.text.trim(),
                vendorName: _vendor.text.trim(),
                receiptDate: toYmd(_date),
                receiptTime: _time == null ? null : '${two(_time!.hour)}:${two(_time!.minute)}',
                amount: parseRupiah(_amount.text)!,
              ),
            );
          },
          child: Text(t.save),
        ),
      ],
    );
  }
}
