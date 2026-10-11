import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../l10n/gen/app_localizations.dart';

/// d1010 (12b / WA-12): a document number (`PB/…`, `TRF/…`, `LPJ/…`) as a tappable chip. With [onOpen]
/// a tap opens that document's screen; without one (no APK screen for it) a tap copies the number. A long
/// press always copies.
class DocNoChip extends StatelessWidget {
  const DocNoChip({super.key, required this.docNo, this.onOpen});
  final String docNo;
  final VoidCallback? onOpen;

  static Future<void> copy(BuildContext context, String docNo) async {
    final t = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.maybeOf(context);
    await Clipboard.setData(ClipboardData(text: docNo));
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(t.docNoCopied(docNo))));
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Semantics(
      hint: onOpen == null ? t.docNoCopyHint : t.docNoOpenHint,
      child: GestureDetector(
        onLongPress: () => copy(context, docNo),
        child: ActionChip(
          key: Key('docno-$docNo'),
          avatar: Icon(onOpen == null ? Icons.copy_rounded : Icons.open_in_new, size: 16),
          label: Text(docNo),
          tooltip: onOpen == null ? t.docNoCopyHint : t.docNoOpenHint,
          visualDensity: VisualDensity.compact,
          onPressed: onOpen ?? () => copy(context, docNo),
        ),
      ),
    );
  }
}
