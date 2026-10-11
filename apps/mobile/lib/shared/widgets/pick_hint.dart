import '../../l10n/gen/app_localizations.dart';

/// d1010 (8d / WA-15): field-specific select placeholder, "Pilih <label>" with the label's first letter in
/// lower case (abbreviations such as PT / PO keep their capitals): "Pilih project", "Pilih tahapan".
String pickHintFor(AppLocalizations t, String label) {
  final l = label.trim();
  if (l.isEmpty) return t.pickHint('').trim();
  final second = l.length > 1 ? l[1] : '';
  final keep = second.isNotEmpty && second.toUpperCase() == second && second.toLowerCase() != second;
  return t.pickHint(keep ? l : '${l[0].toLowerCase()}${l.substring(1)}');
}
