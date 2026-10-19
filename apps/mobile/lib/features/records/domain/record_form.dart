// User 2026-10-19 (APK ↔ web parity, phase 5a): the web admin edit form of a collection, driven by the server
// (`GET /data/{collection}/form`) — the same fields, field-level access and validation as the web; writes through
// `POST/PATCH /data/{collection}` (Payload hooks + audit). Soft delete / deactivate via `/records/{collection}/{id}/…`.

Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];
num? _numN(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);

class RecordFieldDef {
  const RecordFieldDef({
    required this.key,
    required this.label,
    required this.type,
    this.required = false,
    this.readOnly = false,
    this.maxLength,
    this.min,
    this.max,
    this.help,
    this.options = const [],
    this.relationTo,
    this.value,
    this.valueLabels = const [],
  });
  final String key;
  final String label;

  /// text | textarea | email | number | money | date | datetime | checkbox | select | multiselect | relationship |
  /// relationships
  final String type;
  final bool required;
  final bool readOnly;
  final int? maxLength;
  final num? min;
  final num? max;
  final String? help;
  final List<(String, String)> options;
  final String? relationTo;
  final Object? value;

  /// Display titles of the current relationship value(s).
  final List<String> valueLabels;

  bool get isRelation => type == 'relationship' || type == 'relationships';

  factory RecordFieldDef.fromJson(Map<String, dynamic> j) {
    final vl = j['valueLabel'];
    return RecordFieldDef(
      key: '${j['key'] ?? ''}',
      label: '${j['label'] ?? ''}',
      type: '${j['type'] ?? 'text'}',
      required: j['required'] == true,
      readOnly: j['readOnly'] == true,
      maxLength: _numN(j['maxLength'])?.toInt(),
      min: _numN(j['min']),
      max: _numN(j['max']),
      help: j['help'] is String && (j['help'] as String).isNotEmpty ? j['help'] as String : null,
      options: [for (final o in _list(j['options'])) ('${_map(o)['value'] ?? ''}', '${_map(o)['label'] ?? ''}')],
      relationTo: j['relationTo'] is String ? j['relationTo'] as String : null,
      value: j['value'],
      valueLabels: vl is List ? [for (final x in vl) '$x'] : (vl == null ? const [] : ['$vl']),
    );
  }
}

class RecordFormDef {
  const RecordFormDef({
    required this.collection,
    required this.label,
    this.id,
    this.canCreate = false,
    this.canUpdate = false,
    this.canDelete = false,
    this.supported = true,
    this.reasonOnUpdate = false,
    this.reasonOnDeactivate = false,
    this.fields = const [],
  });
  final String collection;
  final String label;
  final String? id;
  final bool canCreate;
  final bool canUpdate;
  final bool canDelete;

  /// false = a required field the APK cannot edit (only on the web).
  final bool supported;

  /// The collection's audit rule: every change needs a reason / deactivating needs one.
  final bool reasonOnUpdate;
  final bool reasonOnDeactivate;
  final List<RecordFieldDef> fields;

  factory RecordFormDef.fromJson(Map<String, dynamic> j) => RecordFormDef(
    collection: '${j['collection'] ?? ''}',
    label: '${j['label'] ?? ''}',
    id: j['id'] == null ? null : '${j['id']}',
    canCreate: j['canCreate'] == true,
    canUpdate: j['canUpdate'] == true,
    canDelete: j['canDelete'] == true,
    supported: j['supported'] != false,
    reasonOnUpdate: _map(j['reason'])['onUpdate'] == true,
    reasonOnDeactivate: _map(j['reason'])['onDeactivate'] == true,
    fields: [for (final f in _list(j['fields'])) RecordFieldDef.fromJson(_map(f))],
  );
}

/// `GET /records/{collection}/{id}/delete-check`: what "Hapus" would do for the caller.
class RecordDeleteCheck {
  const RecordDeleteCheck({this.action, this.canDelete = false, this.blockedReason, this.usage = const []});

  /// hapus | batalkan | nonaktifkan | pulihkan | null
  final String? action;
  final bool canDelete;
  final String? blockedReason;
  final List<String> usage;

  factory RecordDeleteCheck.fromJson(Map<String, dynamic> j) => RecordDeleteCheck(
    action: j['action'] is String ? j['action'] as String : null,
    canDelete: j['canDelete'] == true,
    blockedReason: j['blockedReason'] is String ? j['blockedReason'] as String : null,
    usage: [for (final u in _list(j['usage'])) '${_map(u)['label'] ?? ''} (${_map(u)['count'] ?? 0})'],
  );
}

/// Client checks before sending (the server validates again): required fields and min / max / maxLength.
Map<String, String> validateRecord(List<RecordFieldDef> fields, Map<String, Object?> values) {
  final out = <String, String>{};
  for (final f in fields.where((f) => !f.readOnly)) {
    final v = values[f.key];
    final empty = v == null || (v is String && v.trim().isEmpty) || (v is List && v.isEmpty);
    if (f.required && empty && f.type != 'checkbox') {
      out[f.key] = '${f.label} wajib diisi.';
      continue;
    }
    if (v is String && f.maxLength != null && v.length > f.maxLength!) out[f.key] = 'Maksimal ${f.maxLength} karakter.';
    if (v is num) {
      if (f.min != null && v < f.min!) out[f.key] = 'Minimal ${f.min}.';
      if (f.max != null && v > f.max!) out[f.key] = 'Maksimal ${f.max}.';
    }
  }
  return out;
}
