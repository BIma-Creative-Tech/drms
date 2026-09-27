import 'package:intl/intl.dart';

/// Display time zone from company-settings (`Asia/Makassar` default). Indonesia has no DST, so the
/// three national zones map to fixed offsets without a tz database package.
Duration offsetForZone(String? zone) => switch (zone) {
  'Asia/Jakarta' || 'Asia/Pontianak' => const Duration(hours: 7),
  'Asia/Jayapura' => const Duration(hours: 9),
  _ => const Duration(hours: 8), // Asia/Makassar (WITA) default
};

String zoneAbbrev(String? zone) => switch (zone) {
  'Asia/Jakarta' || 'Asia/Pontianak' => 'WIB',
  'Asia/Jayapura' => 'WIT',
  _ => 'WITA',
};

/// Server timestamps are UTC ISO-8601; show them in the company zone, e.g. `21 Sep 2026 12.05 WITA`.
String formatServerDateTime(String? iso, {String? zone}) {
  if (iso == null || iso.isEmpty) return '-';
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return '-';
  final local = parsed.toUtc().add(offsetForZone(zone));
  return '${DateFormat('d MMM yyyy HH.mm', 'id').format(local)} ${zoneAbbrev(zone)}';
}

/// `2026-09-22` → `22 Sep 2026` (date-only values are not shifted).
String formatDateOnly(String? ymd) {
  if (ymd == null || ymd.isEmpty) return '-';
  final d = DateTime.tryParse(ymd.length >= 10 ? ymd.substring(0, 10) : ymd);
  return d == null ? '-' : DateFormat('d MMM yyyy', 'id').format(d);
}

String toYmd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// ISO-8601 with the device's numeric offset (`2026-09-21T12:05:10+08:00`), as the sync contract
/// requires for `device_time` (ADR 0010). Dart's toIso8601String() omits the offset for local times.
String isoWithOffset(DateTime t) {
  final local = t.isUtc ? t.toLocal() : t;
  return formatWallClock(local, local.timeZoneOffset);
}

/// Formats wall-clock fields of [wall] followed by [offset] (pure; used by [isoWithOffset]).
String formatWallClock(DateTime wall, Duration offset) {
  final sign = offset.isNegative ? '-' : '+';
  final abs = offset.abs();
  String two(int v) => v.toString().padLeft(2, '0');
  final base =
      '${wall.year.toString().padLeft(4, '0')}-${two(wall.month)}-${two(wall.day)}'
      'T${two(wall.hour)}:${two(wall.minute)}:${two(wall.second)}';
  return '$base$sign${two(abs.inHours)}:${two(abs.inMinutes % 60)}';
}
