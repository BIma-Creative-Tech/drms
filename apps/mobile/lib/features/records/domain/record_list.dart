// User 2026-10-19 (APK ↔ web parity, phase 3): the web collection lists of the menu ("Data transfer", "Nota", "Data
// LPJ", …) — `GET /data/{collection}` / `GET /data/{collection}/{id}`: the web list's columns and values as display text
// (the server applies the same read access, field rules and PT selection as the web list). Read-only.

Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];
int _int(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);

class RecordColumn {
  const RecordColumn(this.key, this.label);
  final String key;
  final String label;
}

class RecordRow {
  const RecordRow({required this.id, required this.title, this.cells = const {}});
  final String id;
  final String title;
  final Map<String, String?> cells;
}

class RecordPage {
  const RecordPage({
    required this.collection,
    required this.label,
    this.columns = const [],
    this.items = const [],
    this.totalDocs = 0,
    this.page = 1,
    this.totalPages = 0,
  });
  final String collection;
  final String label;
  final List<RecordColumn> columns;
  final List<RecordRow> items;
  final int totalDocs;
  final int page;
  final int totalPages;

  factory RecordPage.fromJson(Map<String, dynamic> j) => RecordPage(
    collection: '${j['collection'] ?? ''}',
    label: '${j['label'] ?? ''}',
    columns: [
      for (final c in _list(j['columns'])) RecordColumn('${_map(c)['key'] ?? ''}', '${_map(c)['label'] ?? ''}'),
    ],
    items: [
      for (final i in _list(j['items']))
        RecordRow(
          id: '${_map(i)['id'] ?? ''}',
          title: '${_map(i)['title'] ?? ''}',
          cells: {for (final e in _map(_map(i)['cells']).entries) e.key: e.value?.toString()},
        ),
    ],
    totalDocs: _int(j['totalDocs']),
    page: _int(j['page'], 1),
    totalPages: _int(j['totalPages']),
  );
}

class RecordField {
  const RecordField(this.key, this.label, this.value);
  final String key;
  final String label;
  final String? value;
}

class RecordDetail {
  const RecordDetail({
    required this.collection,
    required this.label,
    required this.id,
    required this.title,
    this.fields = const [],
  });
  final String collection;
  final String label;
  final String id;
  final String title;
  final List<RecordField> fields;

  factory RecordDetail.fromJson(Map<String, dynamic> j) => RecordDetail(
    collection: '${j['collection'] ?? ''}',
    label: '${j['label'] ?? ''}',
    id: '${j['id'] ?? ''}',
    title: '${j['title'] ?? ''}',
    fields: [
      for (final f in _list(j['fields']))
        RecordField('${_map(f)['key'] ?? ''}', '${_map(f)['label'] ?? ''}', _map(f)['value']?.toString()),
    ],
  );
}

/// Query of one list (search text + page).
class RecordQuery {
  const RecordQuery(this.collection, {this.q = ''});
  final String collection;
  final String q;

  @override
  bool operator ==(Object other) => other is RecordQuery && other.collection == collection && other.q == q;

  @override
  int get hashCode => Object.hash(collection, q);
}
