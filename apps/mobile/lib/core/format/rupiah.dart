import 'package:intl/intl.dart';

final NumberFormat _grouping = NumberFormat.decimalPattern('id_ID');

/// `Rp 1.447.500` (requirements §9 "Format angka"). Money is always integer rupiah.
String formatRupiah(int amount) {
  final sign = amount < 0 ? '-' : '';
  return '${sign}Rp ${_grouping.format(amount.abs())}';
}

/// Parses user input such as `1.447.500`, `Rp 1.447.500` or `1447500` into integer rupiah.
/// Returns null for empty/invalid input or fractions (rupiah has no decimals in ProyekKas).
int? parseRupiah(String input) {
  final cleaned = input.replaceAll(RegExp(r'[Rr]p|\s|\.'), '');
  if (cleaned.isEmpty || cleaned.contains(',')) return null;
  if (!RegExp(r'^\d{1,14}$').hasMatch(cleaned)) return null;
  return int.parse(cleaned);
}
