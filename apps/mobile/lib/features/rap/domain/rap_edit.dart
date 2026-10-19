// User 2026-10-19 (APK ↔ web parity, phase 5b): the web "RAP proyek" page (/admin/rap/<project>) — `GET
// /projects/{id}/rap` with the edit rights, item create / update (`POST /projects/{id}/rap/items`, `PATCH
// /rap-items/{id}`), Excel import (preview → commit), templates. Parsing is tolerant.

int _int(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
double? _dblN(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);
Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];

class RapEditItem {
  const RapEditItem({
    required this.id,
    required this.code,
    required this.description,
    required this.kind,
    this.stageId,
    this.stageName,
    required this.uomId,
    required this.uomCode,
    required this.volume,
    this.unitPrice,
    this.weightPct,
    this.sortOrder = 0,
    this.active = true,
    this.realised = 0,
    this.received = 0,
    this.used = 0,
    this.realisedAmount = 0,
  });
  final int id;
  final String code;
  final String description;

  /// pekerjaan | material
  final String kind;
  final int? stageId;
  final String? stageName;
  final int uomId;
  final String uomCode;
  final double volume;

  /// Null = no price, or the caller has no price role.
  final int? unitPrice;
  final double? weightPct;
  final int sortOrder;
  final bool active;
  final double realised;
  final double received;
  final double used;
  final int realisedAmount;

  /// Web `rapItemUsed` ("Sudah terpakai"): any change needs a reason.
  bool get inUse => realisedAmount > 0 || realised > 0 || received > 0 || used > 0;

  factory RapEditItem.fromJson(Map<String, dynamic> j) => RapEditItem(
    id: _int(j['id']),
    code: '${j['code'] ?? ''}',
    description: '${j['description'] ?? ''}',
    kind: '${j['kind'] ?? 'pekerjaan'}',
    stageId: _intN(_map(j['stage'])['id']),
    stageName: _map(j['stage'])['name'] as String?,
    uomId: _int(_map(j['uom'])['id']),
    uomCode: '${_map(j['uom'])['code'] ?? ''}',
    volume: _dblN(j['volume']) ?? 0,
    unitPrice: _intN(j['unitPrice']),
    weightPct: _dblN(j['weightPct']),
    sortOrder: _int(j['sortOrder']),
    active: j['active'] != false,
    realised: _dblN(j['realised']) ?? 0,
    received: _dblN(j['received']) ?? 0,
    used: _dblN(j['used']) ?? 0,
    realisedAmount: _int(j['realisedAmount']),
  );
}

class RapEditData {
  const RapEditData({
    required this.projectId,
    this.kind = '',
    this.locked = false,
    this.canEdit = false,
    this.needsReason = false,
    this.stageRequired = false,
    this.prices = false,
    this.items = const [],
    this.stages = const [],
    this.rapValue,
    this.budget,
  });
  final int projectId;
  final String kind;
  final bool locked;
  final bool canEdit;
  final bool needsReason;

  /// konstruksi: work items drive the stage progress — a stage is required.
  final bool stageRequired;

  /// The caller sees prices (office roles + PM).
  final bool prices;
  final List<RapEditItem> items;
  final List<(int, String)> stages;
  final int? rapValue;
  final int? budget;

  factory RapEditData.fromJson(Map<String, dynamic> j) {
    final totals = j['totals'] is Map<String, dynamic> ? j['totals'] as Map<String, dynamic> : null;
    return RapEditData(
      projectId: _int(j['projectId']),
      kind: '${j['kind'] ?? ''}',
      locked: j['locked'] == true,
      canEdit: j['canEdit'] == true,
      needsReason: j['needsReason'] == true,
      stageRequired: j['drivesProgress'] == true,
      prices: totals != null,
      items: [for (final i in _list(j['items'])) RapEditItem.fromJson(_map(i))],
      stages: [
        for (final s in _list(j['stages']))
          if (_map(s)['active'] != false) (_int(_map(s)['id']), '${_map(s)['name'] ?? ''}'),
      ],
      rapValue: _intN(totals?['rapValue']),
      budget: _intN(totals?['budget']),
    );
  }
}

/// `POST /projects/{id}/rap/import/preview` result.
class RapPreviewData {
  const RapPreviewData({
    required this.fileHash,
    this.locked = false,
    this.counts = const {},
    this.issues = const [],
    this.deactivated = const [],
    this.usedChanged = const [],
    this.newStages = const [],
  });
  final String fileHash;
  final bool locked;
  final Map<String, int> counts;
  final List<String> issues;
  final List<String> deactivated;
  final List<String> usedChanged;
  final List<String> newStages;

  bool get needsReason => locked || usedChanged.isNotEmpty;

  factory RapPreviewData.fromJson(Map<String, dynamic> j) => RapPreviewData(
    fileHash: '${j['fileHash'] ?? ''}',
    locked: j['locked'] == true,
    counts: {for (final e in _map(j['counts']).entries) e.key: _int(e.value)},
    issues: [
      for (final i in _list(j['issues']))
        [
          if (_map(i)['row'] != null) 'Baris ${_map(i)['row']}',
          if (_map(i)['column'] != null) '${_map(i)['column']}',
          '${_map(i)['message'] ?? ''}',
        ].join(' · '),
    ],
    deactivated: [for (final d in _list(j['deactivated'])) '${_map(d)['code']} ${_map(d)['description']}'.trim()],
    usedChanged: [for (final c in _list(j['usedChanged'])) '$c'],
    newStages: [for (final s in _list(j['newStages'])) '$s'],
  );
}

/// Client checks of an item (the server re-checks with the same messages where possible).
Map<String, String> validateRapItem({
  required String code,
  required String description,
  required int? uomId,
  required double? volume,
  required int? stageId,
  required bool stageRequired,
  required double? weightPct,
  required bool needsReason,
  required String reason,
}) => {
  if (code.trim().isEmpty) 'code': 'Kode wajib diisi.',
  if (code.trim().length > 32) 'code': 'Kode maks. 32 karakter.',
  if (description.trim().isEmpty) 'description': 'Uraian wajib diisi.',
  if (uomId == null) 'uomId': 'Satuan wajib dipilih.',
  if (volume == null || volume < 0.01) 'volume': 'Volume wajib diisi (≥ 0,01).',
  if (stageRequired && stageId == null) 'stageId': 'Tahapan wajib dipilih.',
  if (weightPct != null && (weightPct < 0 || weightPct > 100)) 'weightPct': 'Bobot 0–100.',
  if (needsReason && reason.trim().length < 3) 'reason': 'Alasan wajib diisi (minimal 3 karakter).',
};
