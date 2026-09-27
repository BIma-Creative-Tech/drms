import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:proyekkas/core/format/dates.dart';
import 'package:proyekkas/core/format/rupiah.dart';

void main() {
  setUpAll(() => initializeDateFormatting('id'));

  group('Rupiah', () {
    test('formats the seed grand total', () {
      expect(formatRupiah(1447500), 'Rp 1.447.500');
      expect(formatRupiah(0), 'Rp 0');
      expect(formatRupiah(170500), 'Rp 170.500');
      expect(formatRupiah(-124), '-Rp 124');
    });

    test('parses user input', () {
      expect(parseRupiah('1.447.500'), 1447500);
      expect(parseRupiah('Rp 677.000'), 677000);
      expect(parseRupiah('170500'), 170500);
      expect(parseRupiah(''), isNull);
      expect(parseRupiah('12,5'), isNull);
      expect(parseRupiah('abc'), isNull);
    });
  });

  group('dates', () {
    test('device_time carries the numeric offset', () {
      expect(formatWallClock(DateTime(2026, 9, 21, 7, 58, 31), const Duration(hours: 8)), '2026-09-21T07:58:31+08:00');
      expect(
        formatWallClock(DateTime(2026, 1, 2, 3, 4, 5), const Duration(hours: -3, minutes: -30)),
        '2026-01-02T03:04:05-03:30',
      );
    });

    test('server UTC shown in company zone (WITA default)', () {
      expect(formatServerDateTime('2026-09-21T04:05:11Z'), '21 Sep 2026 12.05 WITA');
      expect(formatServerDateTime('2026-09-21T04:05:11Z', zone: 'Asia/Jakarta'), '21 Sep 2026 11.05 WIB');
      expect(formatServerDateTime(null), '-');
    });

    test('date-only values are not shifted', () {
      expect(formatDateOnly('2026-09-22'), '22 Sep 2026');
      expect(toYmd(DateTime(2026, 9, 2)), '2026-09-02');
    });
  });
}
