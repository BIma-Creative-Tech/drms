// User 2026-10-19 (APK ↔ web parity, phase 4 Laporan): `GET /reports` (the web /admin/laporan list) and
// `GET /reports/{code}` (one report page: filter form, tables, notes, letterhead, export formats and limits).
// Parsing is tolerant (unknown fields ignored, missing ones defaulted).

import '../../home/domain/web_route_map.dart';

int _int(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
String? _strN(Object? v) => v == null ? null : '$v';
Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];

/// Web FORMAT_LABEL.
const reportFormatLabels = {'csv': 'CSV', 'xlsx': 'Excel (.xlsx)', 'pdf': 'PDF'};

class ReportSummary {
  const ReportSummary({
    required this.code,
    required this.title,
    this.description = '',
    this.kpi = '',
    this.paged = false,
    this.formats = const [],
  });
  final String code;
  final String title;
  final String description;
  final String kpi;
  final bool paged;
  final List<String> formats;

  factory ReportSummary.fromJson(Map<String, dynamic> j) => ReportSummary(
    code: '${j['code'] ?? ''}',
    title: '${j['title'] ?? ''}',
    description: '${j['description'] ?? ''}',
    kpi: '${j['kpi'] ?? ''}',
    paged: j['paged'] == true,
    formats: [for (final f in _list(j['formats'])) '$f'],
  );
}

class ReportColumn {
  const ReportColumn({required this.key, required this.label, this.type = 'text', this.primary = false});
  final String key;
  final String label;

  /// text | money | int | date | datetime | pct
  final String type;
  final bool primary;

  bool get numeric => type == 'money' || type == 'int' || type == 'pct';

  factory ReportColumn.fromJson(Map<String, dynamic> j) => ReportColumn(
    key: '${j['key'] ?? ''}',
    label: '${j['label'] ?? ''}',
    type: '${j['type'] ?? 'text'}',
    primary: j['primary'] == true,
  );
}

final _thousands = RegExp(r'\B(?=(\d{3})+(?!\d))');

/// Web `cellText` (domain/reports/export.ts): money/int with `.` thousands (money without "Rp"), pct `12,50`,
/// dates `dd/mm/yyyy` (+ ` HH:mm`); null → empty.
String reportCellText(Object? v, String type) {
  if (v == null || v == '') return '';
  if (type == 'money' && v is num) {
    final n = v.round();
    return '${n < 0 ? '-' : ''}${n.abs().toString().replaceAll(_thousands, '.')}';
  }
  if (type == 'int' && v is num) {
    if (v == v.roundToDouble()) return v.toInt().toString().replaceAll(_thousands, '.');
    final parts = v.toStringAsFixed(2).replaceAll(RegExp(r'\.?0+$'), '').split('.');
    return parts[0].replaceAll(_thousands, '.') + (parts.length > 1 ? ',${parts[1]}' : '');
  }
  if (type == 'pct' && v is num) {
    final parts = v.toStringAsFixed(2).split('.');
    return '${parts[0]},${parts[1]}';
  }
  final s = '$v';
  if (type == 'date' && RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) {
    return '${s.substring(8, 10)}/${s.substring(5, 7)}/${s.substring(0, 4)}';
  }
  if (type == 'datetime' && RegExp(r'^\d{4}-\d{2}-\d{2} ').hasMatch(s)) {
    return '${s.substring(8, 10)}/${s.substring(5, 7)}/${s.substring(0, 4)} ${s.substring(11, 16)}';
  }
  return s;
}

class ReportTableData {
  const ReportTableData({
    required this.key,
    required this.title,
    this.columns = const [],
    this.rows = const [],
    this.totals,
    this.rowLinks = const [],
    this.empty,
  });
  final String key;
  final String title;
  final List<ReportColumn> columns;
  final List<Map<String, Object?>> rows;
  final Map<String, Object?>? totals;

  /// Per row: web admin hrefs of the row (`_row`) and of document cells.
  final List<Map<String, String>?> rowLinks;
  final String? empty;

  /// The card title of a row: the first primary data column (never the PT column), else the first data column.
  ReportColumn? get titleColumn =>
      columns.where((c) => c.primary && c.key != 'pt').firstOrNull ?? columns.where((c) => c.key != 'pt').firstOrNull;

  factory ReportTableData.fromJson(Map<String, dynamic> j) => ReportTableData(
    key: '${j['key'] ?? ''}',
    title: '${j['title'] ?? ''}',
    columns: [for (final c in _list(j['columns'])) ReportColumn.fromJson(_map(c))],
    rows: [for (final r in _list(j['rows'])) Map<String, Object?>.from(_map(r))],
    totals: j['totals'] is Map<String, dynamic> ? Map<String, Object?>.from(j['totals'] as Map<String, dynamic>) : null,
    rowLinks: [
      for (final l in _list(j['rowLinks'])) l is Map ? {for (final e in l.entries) '${e.key}': '${e.value}'} : null,
    ],
    empty: _strN(j['empty']),
  );
}

class ReportFilterField {
  const ReportFilterField({
    required this.name,
    required this.label,
    required this.kind,
    this.options = const [],
    this.values = const [],
  });
  final String name;
  final String label;

  /// date | month | select | multiselect | text
  final String kind;
  final List<(String, String)> options;

  /// Current value(s) (one for every kind but multiselect).
  final List<String> values;

  String get value => values.firstOrNull ?? '';

  factory ReportFilterField.fromJson(Map<String, dynamic> j) {
    final v = j['value'];
    return ReportFilterField(
      name: '${j['name'] ?? ''}',
      label: '${j['label'] ?? ''}',
      kind: '${j['kind'] ?? 'text'}',
      options: [for (final o in _list(j['options'])) ('${_map(o)['value'] ?? ''}', '${_map(o)['label'] ?? ''}')],
      values: v is List ? [for (final x in v) '$x'] : (v == null || '$v'.isEmpty ? const [] : ['$v']),
    );
  }
}

class ReportPage {
  const ReportPage({
    required this.code,
    required this.title,
    this.kpi = '',
    this.description = '',
    this.team = false,
    this.count = 0,
    this.nextCursor,
    required this.main,
    this.extra = const [],
    this.notes = const [],
    this.formats = const [],
    this.filters = const [],
    this.letterhead = '',
    this.letterheadPts = const [],
    this.rowCount = 0,
    this.limitXlsx = 10000,
    this.limitPdf = 500,
  });
  final String code;
  final String title;
  final String kpi;
  final String description;

  /// The PM's team scope ("cakupan tim saya").
  final bool team;
  final int count;
  final String? nextCursor;
  final ReportTableData main;
  final List<ReportTableData> extra;
  final List<String> notes;
  final List<String> formats;
  final List<ReportFilterField> filters;
  final String letterhead;

  /// Short codes when the letterhead is the group's (several PTs).
  final List<String> letterheadPts;
  final int rowCount;
  final int limitXlsx;
  final int limitPdf;

  /// Web rule: XLSX above 10 000 rows / PDF above 500 rows is refused ("terlalu banyak baris").
  bool tooBig(String format) => (format == 'xlsx' && rowCount > limitXlsx) || (format == 'pdf' && rowCount > limitPdf);

  factory ReportPage.fromJson(Map<String, dynamic> j) {
    final lh = _map(j['letterhead']);
    final limits = _map(j['limits']);
    return ReportPage(
      code: '${j['code'] ?? ''}',
      title: '${j['title'] ?? ''}',
      kpi: '${j['kpi'] ?? ''}',
      description: '${j['description'] ?? ''}',
      team: j['scope'] == 'team',
      count: _int(j['count']),
      nextCursor: _strN(j['nextCursor']),
      main: ReportTableData.fromJson(_map(j['main'])),
      extra: [for (final t in _list(j['extra'])) ReportTableData.fromJson(_map(t))],
      notes: [for (final n in _list(j['notes'])) '$n'],
      formats: [for (final f in _list(j['formats'])) '$f'],
      filters: [for (final f in _list(j['filters'])) ReportFilterField.fromJson(_map(f))],
      letterhead: '${lh['name'] ?? ''}',
      letterheadPts: lh['kind'] == 'group'
          ? [for (final c in _list(lh['companies'])) '${_map(c)['shortCode'] ?? ''}']
          : const [],
      rowCount: _int(j['rowCount']),
      limitXlsx: _int(limits['xlsx'], 10000),
      limitPdf: _int(limits['pdf'], 500),
    );
  }
}

/// A report request: code + filter values (multiselect = several values) + keyset cursor.
class ReportQuery {
  const ReportQuery(this.code, {this.params = const {}, this.cursor});
  final String code;
  final Map<String, List<String>> params;
  final String? cursor;

  Map<String, dynamic> get query => {
    for (final e in params.entries)
      if (e.value.where((v) => v.isNotEmpty).isNotEmpty) e.key: e.value.where((v) => v.isNotEmpty).toList(),
    'cursor': ?cursor,
  };

  @override
  bool operator ==(Object other) =>
      other is ReportQuery &&
      other.code == code &&
      other.cursor == cursor &&
      _paramsKey(other.params) == _paramsKey(params);

  @override
  int get hashCode => Object.hash(code, cursor, _paramsKey(params));
}

String _paramsKey(Map<String, List<String>> p) =>
    (p.entries.map((e) => '${e.key}=${e.value.join(',')}').toList()..sort()).join('&');

/// Web admin href of a report row / cell → the APK screen (null = no APK screen; the cell is plain text). D2510: also
/// the history tab, the field-report detail pages, every web collection document whose list is the APK `/data` list,
/// report → report links WITH their filters, an employee's attendance recap and the web menu pages with an APK screen
/// (Verifikasi LPJ, Antrian Transfer, Unit & kontrak, …). Whether the user may open it: `canOpenApkRoute`.
String? apkRouteForReportLink(String href) {
  final uri = Uri.tryParse(href);
  if (uri == null) return null;
  final m = RegExp(r'^/admin/(.+?)/?$').firstMatch(uri.path);
  if (m == null) return null;
  final p = m.group(1)!;
  final q = uri.queryParametersAll;
  for (final (re, to) in [
    (r'^collections/expense-requests/(\d+)$', '/requests/#'),
    (r'^collections/expense-requests/(\d+)/riwayat$', '/requests/#/history'),
    (r'^pinjaman/detail/(\d+)$', '/loans/#'),
    (r'^collections/project-loans/(\d+)$', '/loans/#'),
    (r'^pinjaman-antar-pt/detail/(\d+)$', '/intercompany-loans/#'),
    (r'^collections/projects/(\d+)$', '/projects/#'),
    (r'^progress/project/(\d+)$', '/projects/#'),
    (r'^collections/budget-addenda/(\d+)$', '/addenda/#'),
    (r'^addendum/detail/(\d+)$', '/addenda/#'),
    (r'^progress/laporan/(\d+)$', '/progress/report/#'),
    // field reports: the web detail views (ADR 0020) → the generic APK record detail
    (r'^unit-kontrak/timesheet/detail/(\d+)$', '/data/unit-timesheets/#'),
    (r'^aftersales/aktivitas/detail/(\d+)$', '/data/aftersales-activities/#'),
    (r'^laporan-servis/detail/(\d+)$', '/data/service-reports/#'),
    (r'^laporan-harian/detail/(\d+)$', '/data/daily-reports/#'),
  ]) {
    final x = RegExp(re).firstMatch(p);
    if (x != null) return to.replaceFirst('#', x.group(1)!);
  }
  // A web collection document whose list the APK shows as `/data/<slug>` (cash-entries, receipts, daily-reports, …).
  final doc = RegExp(r'^collections/([a-z0-9-]+)/(\d+)$').firstMatch(p);
  if (doc != null) {
    final slug = doc.group(1)!;
    return webToApk['/collections/$slug'] == '/data/$slug' ? '/data/$slug/${doc.group(2)}' : null;
  }
  // Report → report: the filters travel along (`/reports/buku-kas?dari=…&akun=…`).
  final report = RegExp(r'^laporan/([a-z0-9-]+)$').firstMatch(p);
  if (report != null) {
    return Uri(path: '/reports/${report.group(1)}', queryParameters: q.isEmpty ? null : q).toString();
  }
  // "Rekap absensi" of one employee (the recap screen has its own month picker).
  if (p == 'absensi/rekap') {
    final employee = int.tryParse(q['karyawan']?.firstOrNull ?? '');
    if (employee != null) return '/attendance/recap/$employee';
  }
  // The contract matrix of one project → the APK "Unit & kontrak" page.
  if (RegExp(r'^unit-kontrak/kontrak/\d+$').hasMatch(p)) return '/contracts';
  // A web menu page with an APK screen (verifikasi-lpj, antrian-transfer, unit-kontrak, …).
  return apkTargetFor('/$p')?.route;
}
