import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/platform/report_files.dart';
import 'package:proyekkas/features/home/domain/web_route_map.dart';
import 'package:proyekkas/features/reports/data/reports_api.dart';
import 'package:proyekkas/features/reports/data/reports_providers.dart';
import 'package:proyekkas/features/reports/domain/report.dart';
import 'package:proyekkas/features/reports/presentation/report_screens.dart';

import '../support/widget_harness.dart';

Map<String, dynamic> _pageJson({int rowCount = 2, String? next}) => {
  'code': 'rekap-pengajuan',
  'title': 'Rekap pengajuan',
  'kpi': 'K-10',
  'description': 'Pengajuan per status',
  'scope': 'all',
  'count': rowCount,
  'nextCursor': next,
  'main': {
    'key': 'main',
    'title': 'Daftar pengajuan',
    'columns': [
      {'key': 'docNo', 'label': 'Nomor', 'type': 'text', 'primary': true},
      {'key': 'tanggal', 'label': 'Tanggal', 'type': 'date'},
      {'key': 'nominal', 'label': 'Nominal', 'type': 'money'},
    ],
    'rows': [
      {'docNo': 'PB/CS1/2026/10/0003', 'tanggal': '2026-10-02', 'nominal': 1250000},
      {'docNo': 'PB/CS1/2026/10/0004', 'tanggal': '2026-10-03', 'nominal': 50000},
    ],
    'totals': {'docNo': null, 'nominal': 1300000},
    'rowLinks': [
      {'docNo': '/admin/collections/expense-requests/88'},
      null,
    ],
    'empty': null,
  },
  'extra': [],
  'notes': ['Draft tidak dihitung.'],
  'formats': ['csv', 'xlsx', 'pdf'],
  'filters': [
    {'name': 'dari', 'label': 'Dari', 'kind': 'date', 'value': '2026-10-01'},
    {
      'name': 'jenis',
      'label': 'Jenis',
      'kind': 'select',
      'value': '',
      'options': [
        {'value': 'advance', 'label': 'Pengajuan Baru'},
        {'value': 'reimburse', 'label': 'Reimburse'},
      ],
    },
  ],
  'letterhead': {'kind': 'company', 'name': 'PT Contoh Satu', 'companies': []},
  'rowCount': rowCount,
  'limits': {'xlsx': 10000, 'pdf': 500},
};

class _FakeApi implements ReportsApi {
  final queries = <ReportQuery>[];
  final exports = <String>[];

  @override
  ApiClient get client => throw UnimplementedError();

  @override
  Future<({List<ReportSummary> items, bool auditLog})> index() async => (
    items: [
      ReportSummary.fromJson({
        'code': 'rekap-pengajuan',
        'title': 'Rekap pengajuan',
        'description': 'Pengajuan per status',
        'formats': ['csv', 'pdf'],
      }),
    ],
    auditLog: true,
  );

  @override
  Future<ReportPage> page(ReportQuery q) async {
    queries.add(q);
    return ReportPage.fromJson(_pageJson(rowCount: q.params.isEmpty ? 2 : 900));
  }

  @override
  Future<({Uint8List bytes, String? disposition})> export(ReportQuery q, String format) async {
    exports.add(format);
    return (
      bytes: Uint8List.fromList([1, 2, 3]),
      disposition: 'attachment; filename="rekap-pengajuan-2026-10.$format"',
    );
  }
}

class _FakeFiles implements ReportFiles {
  final calls = <String>[];

  @override
  Future<bool> save(String name, Uint8List bytes) async {
    calls.add('save:$name:${bytes.length}');
    return true;
  }

  @override
  Future<bool> open(String name) async => true;

  @override
  Future<bool> share(String name) async {
    calls.add('share:$name');
    return true;
  }

  @override
  Future<bool> download(String name) async => true;
}

/// User 2026-10-19 (APK ↔ web parity, phase 4 Laporan).
void main() {
  group('domain', () {
    test('cell text = web cellText, file names, links', () {
      expect(reportCellText(1250000, 'money'), '1.250.000');
      expect(reportCellText(-5000, 'money'), '-5.000');
      expect(reportCellText(12.5, 'pct'), '12,50');
      expect(reportCellText(1031.5, 'int'), '1.031,5');
      expect(reportCellText('2026-10-02', 'date'), '02/10/2026');
      expect(reportCellText(null, 'money'), '');
      expect(
        reportFileName('attachment; filename="Rekap-Kas-2026-10.pdf"', fallback: 'x', format: 'pdf'),
        'Rekap-Kas-2026-10.pdf',
      );
      expect(reportFileName(null, fallback: 'rekap kas', format: 'csv'), 'rekap_kas.csv');
      expect(apkRouteForReportLink('/admin/collections/expense-requests/88'), '/requests/88');
      expect(apkRouteForReportLink('/admin/pinjaman/detail/4'), '/loans/4');
      expect(apkRouteForReportLink('/admin/collections/transfers/15'), '/data/transfers/15');
      expect(apkRouteForReportLink('/admin/collections/users/2'), isNull);
      expect(apkTargetFor('/laporan')!.route, '/reports');
      expect(
        const ReportQuery(
          'x',
          params: {
            'status': ['a', 'b'],
            'jenis': [''],
          },
          cursor: 'c1',
        ).query,
        {
          'status': ['a', 'b'],
          'cursor': 'c1',
        },
      );
      expect(ReportPage.fromJson(_pageJson(rowCount: 900)).tooBig('pdf'), isTrue);
      expect(ReportPage.fromJson(_pageJson(rowCount: 900)).tooBig('xlsx'), isFalse);
    });
  });

  testWidgets('list: the caller\'s reports with their formats', (tester) async {
    await pumpScreen(tester, const ReportListScreen(), overrides: [reportsApiProvider.overrideWithValue(_FakeApi())]);
    expect(find.byKey(const Key('report-rekap-pengajuan')), findsOneWidget);
    expect(find.textContaining('Export: CSV · PDF'), findsOneWidget);
    expect(find.byKey(const Key('report-audit-log')), findsOneWidget, reason: 'phase 7: web index link');
  });

  testWidgets('report: letterhead, cards with totals, filter → new query, too many rows disables PDF', (tester) async {
    final api = _FakeApi();
    await pumpScreen(
      tester,
      const ReportScreen(code: 'rekap-pengajuan'),
      overrides: [reportsApiProvider.overrideWithValue(api), reportFilesProvider.overrideWithValue(_FakeFiles())],
    );
    expect(find.text('PT Contoh Satu'), findsOneWidget);
    expect(find.text('PB/CS1/2026/10/0003'), findsOneWidget);
    expect(find.textContaining('1.250.000'), findsOneWidget);
    expect(find.byKey(const Key('report-main-totals')), findsOneWidget);
    expect(find.text('• Draft tidak dihitung.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('report-filters')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('report-filter-apply')));
    await tester.pumpAndSettle();
    expect(api.queries.last.params['dari'], ['2026-10-01']);
    final pdf = tester.widget<OutlinedButton>(find.byKey(const Key('report-export-pdf')));
    expect(pdf.onPressed, isNull, reason: '900 rows > PDF limit');
    expect(find.text('PDF (terlalu banyak baris)'), findsOneWidget);
  });

  testWidgets('export: CSV downloaded, saved, then shared', (tester) async {
    final api = _FakeApi();
    final files = _FakeFiles();
    await pumpScreen(
      tester,
      const ReportScreen(code: 'rekap-pengajuan'),
      overrides: [reportsApiProvider.overrideWithValue(api), reportFilesProvider.overrideWithValue(files)],
    );
    await tester.tap(find.byKey(const Key('report-export-csv')));
    await tester.pumpAndSettle();
    expect(api.exports, ['csv']);
    expect(files.calls, ['save:rekap-pengajuan-2026-10.csv:3']);
    await tester.tap(find.byKey(const Key('report-file-share')));
    await tester.pumpAndSettle();
    expect(files.calls.last, 'share:rekap-pengajuan-2026-10.csv');
  });
}
