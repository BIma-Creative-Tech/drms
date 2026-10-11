import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

final NumberFormat _grouping = NumberFormat.decimalPattern('id_ID');

/// `Rp 1.447.500` (requirements §9 "Format angka"). Money is always integer rupiah.
String formatRupiah(int amount) {
  final sign = amount < 0 ? '-' : '';
  return '${sign}Rp ${_grouping.format(amount.abs())}';
}

/// Line quantity without a trailing ".0", decimal comma (`2`, `24,8`).
String formatQty(double q) => q.toString().replaceAll(RegExp(r'\.0$'), '').replaceAll('.', ',');

/// Parses user input such as `1.447.500`, `Rp 1.447.500` or `1447500` into integer rupiah.
/// Returns null for empty/invalid input or fractions (rupiah has no decimals in ProyekKas).
int? parseRupiah(String input) {
  final cleaned = input.replaceAll(RegExp(r'[Rr]p|\s|\.'), '');
  if (cleaned.isEmpty || cleaned.contains(',')) return null;
  if (!RegExp(r'^\d{1,14}$').hasMatch(cleaned)) return null;
  return int.parse(cleaned);
}

/// `1447500` → `1.447.500` (grouping only, no `Rp`; empty for null). Initial text of a Rupiah input.
String groupRupiah(int? amount) => amount == null ? '' : _grouping.format(amount);

/// d1010 (8c / WA-02): Rupiah input — digits only, thousands grouped with `.` while typing
/// (`1447500` → `1.447.500`); [parseRupiah] reads the value back. Use with `prefixText: 'Rp '` and
/// `TextInputType.number`.
class RupiahInputFormatter extends TextInputFormatter {
  const RupiahInputFormatter();

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    var digits = newValue.text.replaceAll(RegExp(r'\D'), '');
    digits = digits.replaceFirst(RegExp(r'^0+(?=\d)'), '');
    if (digits.length > 14) digits = digits.substring(0, 14);
    if (digits.isEmpty) return const TextEditingValue();
    // Digits left of the cursor in the new text: the cursor keeps its place relative to them.
    final cursor = newValue.selection.baseOffset.clamp(0, newValue.text.length);
    final digitsBefore = newValue.text.substring(0, cursor).replaceAll(RegExp(r'\D'), '').length;
    final text = _grouping.format(int.parse(digits));
    var offset = text.length;
    for (var i = 0, seen = 0; i < text.length; i++) {
      if (seen == digitsBefore) {
        offset = i;
        break;
      }
      if (text[i] != '.') seen++;
    }
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: offset),
    );
  }
}
