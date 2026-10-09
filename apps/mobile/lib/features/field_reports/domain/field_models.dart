import '../../expense/data/expense_mappers.dart' show Json;

/// FR1 "Laporan lapangan per jenis project" (ADR 0020, requirements v1.3): service reports, unit timesheets
/// and the aftersales activity log. JSON = openapi v1 (`ServiceReport`, `UnitTimesheet`, `AftersalesActivity`,
/// `Unit`, `ContractUnit`, `OpenPo`, `Sync*Copy`). Parsing is tolerant. Contract rates and billing estimates are
/// never read into these models (Staff never stores or shows them); an aftersales value only when the server
/// says the caller may see it (`valueVisible`).

int fInt(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
int? fIntN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
double? fDblN(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);
String? fStrN(Object? v) => v == null ? null : '$v';
String fStr(Object? v) => v == null ? '' : '$v';
Json fMap(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> fList(Object? v) => v is List ? v : const [];

/// Report dates: never in the future, at most this many days back (server BACKDATE_MAX_DAYS).
const fieldBackdateMaxDays = 14;

/// Breakdown hours from which the app suggests a service report (server BREAKDOWN_SUGGEST_SERVICE_HOURS).
const breakdownSuggestServiceHours = 4.0;

/// Σ work + standby + breakdown per day.
const maxHoursPerDay = 24.0;

/// Highest hour-meter reading the server accepts.
const maxHourMeter = 10000000.0;

/// Spare-part / item rows per report (server MAX_SPAREPART_LINES / MAX_ACTIVITY_ITEMS).
const maxPartLines = 50;

/// `projects.kind` (ADR 0020 §1): the project kind decides which field reports exist.
enum ProjectKind {
  umum('umum'),
  konstruksi('konstruksi'),
  kontrakUnit('kontrak_unit'),
  aftersales('aftersales'),
  trading('trading');

  const ProjectKind(this.code);
  final String code;

  static ProjectKind fromCode(Object? c) => values.firstWhere((k) => k.code == c, orElse: () => umum);

  /// kontrak_unit → Timesheet Unit + Servis; aftersales → Servis + Aktivitas; others: none (konstruksi: P3).
  List<FieldReportType> get reportTypes => switch (this) {
    kontrakUnit => const [FieldReportType.unitTimesheet, FieldReportType.serviceReport],
    aftersales => const [FieldReportType.serviceReport, FieldReportType.aftersalesActivity],
    _ => const [],
  };

  String get label => switch (this) {
    kontrakUnit => 'Kontrak unit',
    aftersales => 'Aftersales',
    konstruksi => 'Konstruksi',
    trading => 'Trading',
    umum => 'Umum',
  };
}

enum FieldReportType {
  serviceReport('service_report', 'service_report.upsert', 'Laporan Servis Unit', 10),
  unitTimesheet('unit_timesheet', 'unit_timesheet.upsert', 'Timesheet Unit', 1),
  aftersalesActivity('aftersales_activity', 'aftersales_activity.upsert', 'Aktivitas Aftersales', 5);

  const FieldReportType(this.code, this.syncType, this.label, this.maxPhotos);

  /// `service_report` | `unit_timesheet` | `aftersales_activity` (server FieldReportType).
  final String code;

  /// Item type of `POST /sync/batch`.
  final String syncType;
  final String label;

  /// Photos per record (server MAX_PHOTOS: 10 / exactly 1 HM photo / 5).
  final int maxPhotos;

  static FieldReportType? fromCode(String? c) => values.where((t) => t.code == c).firstOrNull;
  static FieldReportType? fromSyncType(String? t) => values.where((v) => v.syncType == t).firstOrNull;

  /// Result key of the server version in a sync result (`server_service_report`, …).
  String get copyKey => 'server_$code';

  /// Payload key of the server id of an edit.
  String get idKey => switch (this) {
    serviceReport => 'report_id',
    unitTimesheet => 'timesheet_id',
    aftersalesActivity => 'activity_id',
  };

  /// Payload key of the APK id of the record.
  String get uuidKey => switch (this) {
    serviceReport => 'report_client_uuid',
    unitTimesheet => 'timesheet_client_uuid',
    aftersalesActivity => 'activity_client_uuid',
  };

  /// `/api/v1` collection path.
  String get path => switch (this) {
    serviceReport => '/service-reports',
    unitTimesheet => '/unit-timesheets',
    aftersalesActivity => '/aftersales-activities',
  };

  /// Route segment of the editor (`/field/<segment>/new`).
  String get segment => switch (this) {
    serviceReport => 'service',
    unitTimesheet => 'timesheet',
    aftersalesActivity => 'aftersales',
  };

  static FieldReportType? fromSegment(String? s) => values.where((t) => t.segment == s).firstOrNull;
}

enum ServiceType {
  servisBerkala('servis_berkala', 'Servis berkala'),
  perbaikan('perbaikan', 'Perbaikan'),
  inspeksi('inspeksi', 'Inspeksi'),
  pemasangan('pemasangan', 'Pemasangan');

  const ServiceType(this.code, this.label);
  final String code;
  final String label;
  static ServiceType? fromCode(Object? c) => values.where((v) => v.code == c).firstOrNull;
}

enum UnitStatus {
  siap('siap', 'Siap operasi'),
  rusak('rusak', 'Rusak'),
  menungguPart('menunggu_part', 'Menunggu part');

  const UnitStatus(this.code, this.label);
  final String code;
  final String label;
  static UnitStatus? fromCode(Object? c) => values.where((v) => v.code == c).firstOrNull;
}

enum ActivityKind {
  penawaran('penawaran', 'Penawaran', 'PNW'),
  poMasuk('po_masuk', 'PO masuk', 'PO'),
  pengiriman('pengiriman', 'Pengiriman', 'KIRIM'),
  penagihan('penagihan', 'Penagihan', 'TAGIH'),
  kunjungan('kunjungan', 'Kunjungan', 'KUNJ'),
  lainnya('lainnya', 'Lainnya', 'LAIN');

  const ActivityKind(this.code, this.label, this.tag);
  final String code;
  final String label;

  /// Short tag of the "Hari ini" list.
  final String tag;
  static ActivityKind? fromCode(Object? c) => values.where((v) => v.code == c).firstOrNull;

  /// Pengiriman / penagihan refer to an incoming PO of the same customer (pengiriman: required).
  bool get refersToPo => this == pengiriman || this == penagihan;
}

enum PoStatus {
  belumKirim('belum_kirim', 'Belum kirim'),
  sebagian('sebagian', 'Terkirim sebagian'),
  terkirim('terkirim', 'Terkirim'),
  batal('batal', 'Batal');

  const PoStatus(this.code, this.label);
  final String code;
  final String label;
  static PoStatus? fromCode(Object? c) => values.where((v) => v.code == c).firstOrNull;
  bool get open => this == belumKirim || this == sebagian;
}

/// Local state of a field report on the phone. `local` = autosaved draft (not yet sent).
enum FieldSyncState {
  local,
  queued,
  synced,
  conflict,
  rejected;

  static FieldSyncState fromCode(String? c) =>
      FieldSyncState.values.firstWhere((s) => s.name == c, orElse: () => FieldSyncState.local);
}

/// One spare-part (service report) or item (aftersales activity) row: text only, no stock (ADR 0020 §9).
class PartLine {
  const PartLine({this.name = '', this.partNo, this.qty, this.uom, this.note});
  final String name;
  final String? partNo;
  final double? qty;
  final String? uom;
  final String? note;

  bool get isBlank => name.trim().isEmpty && (partNo ?? '').trim().isEmpty && qty == null && (uom ?? '').trim().isEmpty;

  PartLine copyWith({String? name, String? partNo, double? qty, bool clearQty = false, String? uom, String? note}) =>
      PartLine(
        name: name ?? this.name,
        partNo: partNo ?? this.partNo,
        qty: clearQty ? null : (qty ?? this.qty),
        uom: uom ?? this.uom,
        note: note ?? this.note,
      );

  /// Local / REST shape (camelCase).
  Json toJson() => {'name': name, 'partNo': partNo, 'qty': qty, 'uom': uom, 'note': note};

  factory PartLine.fromJson(Object? v) {
    final j = fMap(v);
    return PartLine(
      name: fStr(j['name']),
      partNo: fStrN(j['partNo'] ?? j['part_no']),
      qty: fDblN(j['qty']),
      uom: fStrN(j['uom']),
      note: fStrN(j['note']),
    );
  }

  /// `SyncSparepartLine` / `SyncActivityItem` (no `note` on items).
  Json toSync({bool withNote = true}) => {
    'name': name.trim(),
    'part_no': _blankToNull(partNo),
    'qty': qty,
    'uom': _blankToNull(uom),
    if (withNote) 'note': _blankToNull(note),
  };

  /// "Seal kit 1 set".
  String get summary =>
      [name.trim(), if (qty != null) fmtNum(qty!), (uom ?? '').trim()].where((e) => e.isNotEmpty).join(' ');
}

String? _blankToNull(String? v) => (v ?? '').trim().isEmpty ? null : v!.trim();

/// `1023.5` → `1.023,5`, `8` → `8` (Indonesian grouping, up to 2 decimals).
String fmtNum(num v) {
  final neg = v < 0;
  final abs = v.abs();
  final rounded = (abs * 100).round() / 100;
  final whole = rounded.truncate();
  final frac = ((rounded - whole) * 100).round();
  final digits = whole.toString();
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write('.');
    buf.write(digits[i]);
  }
  var s = buf.toString();
  if (frac != 0) s += ',${frac.toString().padLeft(2, '0').replaceAll(RegExp(r'0$'), '')}';
  return neg ? '-$s' : s;
}

/// User input `1.023,5` / `1023.5` / `1023,50` → 1023.5 (null when empty / not a number).
double? parseDec(String? s) {
  var t = (s ?? '').trim().replaceAll(' ', '');
  if (t.isEmpty) return null;
  if (t.contains(',')) {
    t = t.replaceAll('.', '').replaceAll(',', '.');
  } else if (RegExp(r'^\d{1,3}(\.\d{3})+$').hasMatch(t)) {
    t = t.replaceAll('.', ''); // 1.023 = thousands grouping
  }
  return double.tryParse(t);
}

/// Value of a numeric input field (no grouping, decimal comma): `1023.5` → `1023,5`.
String decInput(double? v) {
  if (v == null) return '';
  final r = (v * 100).round() / 100;
  final s = r == r.roundToDouble() ? r.toStringAsFixed(0) : r.toString();
  return s.replaceAll('.', ',');
}

/// Type-specific part of a local field report (`local_field_reports.content_json`).
sealed class FieldContent {
  const FieldContent();
  Json toJson();

  /// Local photo ids (media_blobs) of this content, in upload order.
  List<String> get photoUuids;

  static FieldContent fromJson(FieldReportType type, Json j) => switch (type) {
    FieldReportType.serviceReport => ServiceContent.fromJson(j),
    FieldReportType.unitTimesheet => TimesheetContent.fromJson(j),
    FieldReportType.aftersalesActivity => ActivityContent.fromJson(j),
  };
}

List<String> _strings(Object? v) => [for (final e in fList(v)) '$e'];
List<PartLine> _lines(Object? v) => [for (final e in fList(v)) PartLine.fromJson(e)];

class ServiceContent extends FieldContent {
  const ServiceContent({
    this.unitId,
    this.unitLabel = '',
    this.hourMeter,
    this.startTime,
    this.endTime,
    this.serviceType,
    this.complaint = '',
    this.action = '',
    this.helpers = '',
    this.spareparts = const [],
    this.unitStatusAfter,
    this.notes = '',
    this.beforePhotos = const [],
    this.afterPhotos = const [],
  });
  final int? unitId;
  final String unitLabel;
  final double? hourMeter;
  final String? startTime;
  final String? endTime;
  final ServiceType? serviceType;
  final String complaint;
  final String action;
  final String helpers;
  final List<PartLine> spareparts;
  final UnitStatus? unitStatusAfter;
  final String notes;

  /// Before / after photos (the server keeps one list: before first, then after).
  final List<String> beforePhotos;
  final List<String> afterPhotos;

  @override
  List<String> get photoUuids => [...beforePhotos, ...afterPhotos];

  List<PartLine> get filledParts => [
    for (final p in spareparts)
      if (!p.isBlank) p,
  ];

  @override
  Json toJson() => {
    'unitId': unitId,
    'unitLabel': unitLabel,
    'hourMeter': hourMeter,
    'startTime': startTime,
    'endTime': endTime,
    'serviceType': serviceType?.code,
    'complaint': complaint,
    'action': action,
    'helpers': helpers,
    'spareparts': [for (final p in spareparts) p.toJson()],
    'unitStatusAfter': unitStatusAfter?.code,
    'notes': notes,
    'beforePhotos': beforePhotos,
    'afterPhotos': afterPhotos,
  };

  factory ServiceContent.fromJson(Json j) => ServiceContent(
    unitId: fIntN(j['unitId']),
    unitLabel: fStr(j['unitLabel']),
    hourMeter: fDblN(j['hourMeter']),
    startTime: fStrN(j['startTime']),
    endTime: fStrN(j['endTime']),
    serviceType: ServiceType.fromCode(j['serviceType']),
    complaint: fStr(j['complaint']),
    action: fStr(j['action']),
    helpers: fStr(j['helpers']),
    spareparts: _lines(j['spareparts']),
    unitStatusAfter: UnitStatus.fromCode(j['unitStatusAfter']),
    notes: fStr(j['notes']),
    beforePhotos: _strings(j['beforePhotos']),
    afterPhotos: _strings(j['afterPhotos']),
  );
}

class TimesheetContent extends FieldContent {
  const TimesheetContent({
    this.unitId,
    this.unitLabel = '',
    this.hmStart,
    this.hmEnd,
    this.workHours,
    this.standbyHours,
    this.breakdownHours,
    this.breakdownReason = '',
    this.fuelLiters,
    this.operatorName = '',
    this.location = '',
    this.notes = '',
    this.hmPhoto,
    this.previousHmEnd,
    this.previousHmDate,
  });
  final int? unitId;
  final String unitLabel;
  final double? hmStart;
  final double? hmEnd;
  final double? workHours;
  final double? standbyHours;
  final double? breakdownHours;
  final String breakdownReason;
  final double? fuelLiters;
  final String operatorName;
  final String location;
  final String notes;

  /// Local id of the HM meter photo (exactly one, required on create).
  final String? hmPhoto;

  /// HM akhir of the previous timesheet of the unit (prefill source; HM_GAP when HM awal differs).
  final double? previousHmEnd;
  final String? previousHmDate;

  @override
  List<String> get photoUuids => [?hmPhoto];

  double get totalHours => (workHours ?? 0) + (standbyHours ?? 0) + (breakdownHours ?? 0);

  @override
  Json toJson() => {
    'unitId': unitId,
    'unitLabel': unitLabel,
    'hmStart': hmStart,
    'hmEnd': hmEnd,
    'workHours': workHours,
    'standbyHours': standbyHours,
    'breakdownHours': breakdownHours,
    'breakdownReason': breakdownReason,
    'fuelLiters': fuelLiters,
    'operatorName': operatorName,
    'location': location,
    'notes': notes,
    'hmPhoto': hmPhoto,
    'previousHmEnd': previousHmEnd,
    'previousHmDate': previousHmDate,
  };

  factory TimesheetContent.fromJson(Json j) => TimesheetContent(
    unitId: fIntN(j['unitId']),
    unitLabel: fStr(j['unitLabel']),
    hmStart: fDblN(j['hmStart']),
    hmEnd: fDblN(j['hmEnd']),
    workHours: fDblN(j['workHours']),
    standbyHours: fDblN(j['standbyHours']),
    breakdownHours: fDblN(j['breakdownHours']),
    breakdownReason: fStr(j['breakdownReason']),
    fuelLiters: fDblN(j['fuelLiters']),
    operatorName: fStr(j['operatorName']),
    location: fStr(j['location']),
    notes: fStr(j['notes']),
    hmPhoto: fStrN(j['hmPhoto']),
    previousHmEnd: fDblN(j['previousHmEnd']),
    previousHmDate: fStrN(j['previousHmDate']),
  );
}

class ActivityContent extends FieldContent {
  const ActivityContent({
    this.clientId,
    this.clientName = '',
    this.kind,
    this.docNo = '',
    this.items = const [],
    this.value,
    this.relatesTo,
    this.relatesToLabel = '',
    this.poDelivered = false,
    this.followUpDate,
    this.receiver = '',
    this.notes = '',
    this.photos = const [],
  });
  final int? clientId;
  final String clientName;
  final ActivityKind? kind;
  final String docNo;
  final List<PartLine> items;

  /// Nilai (Rp), optional. Readable afterwards only by Direktur/Finance/Admin and the reporter.
  final int? value;

  /// Incoming PO (server id) of a pengiriman / penagihan.
  final int? relatesTo;
  final String relatesToLabel;

  /// Pengiriman: "PO ini sudah terkirim semua" → PO terkirim (else sebagian).
  final bool poDelivered;

  /// Penawaran: follow-up date (reminder to the reporter + PM).
  final String? followUpDate;
  final String receiver;
  final String notes;
  final List<String> photos;

  @override
  List<String> get photoUuids => photos;

  List<PartLine> get filledItems => [
    for (final p in items)
      if (!p.isBlank) p,
  ];

  @override
  Json toJson() => {
    'clientId': clientId,
    'clientName': clientName,
    'kind': kind?.code,
    'docNo': docNo,
    'items': [for (final p in items) p.toJson()],
    'value': value,
    'relatesTo': relatesTo,
    'relatesToLabel': relatesToLabel,
    'poDelivered': poDelivered,
    'followUpDate': followUpDate,
    'receiver': receiver,
    'notes': notes,
    'photos': photos,
  };

  factory ActivityContent.fromJson(Json j) => ActivityContent(
    clientId: fIntN(j['clientId']),
    clientName: fStr(j['clientName']),
    kind: ActivityKind.fromCode(j['kind']),
    docNo: fStr(j['docNo']),
    items: _lines(j['items']),
    value: fIntN(j['value']),
    relatesTo: fIntN(j['relatesTo']),
    relatesToLabel: fStr(j['relatesToLabel']),
    poDelivered: j['poDelivered'] == true,
    followUpDate: fStrN(j['followUpDate']),
    receiver: fStr(j['receiver']),
    notes: fStr(j['notes']),
    photos: _strings(j['photos']),
  );
}

/// A field report written or edited on the phone (row of `local_field_reports`).
class FieldDraft {
  const FieldDraft({
    required this.clientUuid,
    required this.type,
    required this.projectId,
    this.projectLabel = '',
    required this.reportDate,
    required this.content,
    this.companyId,
    this.serverPhotoCount = 0,
    this.reason,
    this.serverId,
    this.serverRev,
    this.docNo,
    this.editableUntil,
    this.syncState = FieldSyncState.local,
    this.lastError,
    this.lastErrorCode,
    this.conflictCopy,
    this.offline = false,
    this.updatedAt,
  });

  final String clientUuid;
  final FieldReportType type;

  /// PT of the report (= PT of its project).
  final int? companyId;
  final int projectId;
  final String projectLabel;

  /// `YYYY-MM-DD` (company TZ).
  final String reportDate;
  final FieldContent content;

  /// Photos already on the server record (edit: the limit counts them).
  final int serverPhotoCount;

  /// Reason of an own edit (optional ≤ 24 h) or of "kirim ulang versi saya" (required).
  final String? reason;
  final int? serverId;
  final int? serverRev;
  final String? docNo;
  final String? editableUntil;
  final FieldSyncState syncState;
  final String? lastError;
  final String? lastErrorCode;

  /// Server version (`server_service_report` / …) of a conflict or NOT_EDITABLE.
  final Json? conflictCopy;
  final bool offline;
  final DateTime? updatedAt;

  /// The server knows this record → an edit (only the reporter, ≤ 24 h).
  bool get isEdit => serverId != null;

  int? get unitId => switch (content) {
    ServiceContent(:final unitId) || TimesheetContent(:final unitId) => unitId,
    ActivityContent() => null,
  };

  int? get clientId => switch (content) {
    ActivityContent(:final clientId) => clientId,
    _ => null,
  };

  /// Timesheet HM akhir / service HM (stored in its own column for the HM prefill).
  double? get hourMeter => switch (content) {
    ServiceContent(:final hourMeter) => hourMeter,
    TimesheetContent(:final hmEnd) => hmEnd,
    ActivityContent() => null,
  };

  int get photoTotal => serverPhotoCount + content.photoUuids.length;

  ServiceContent get service => content as ServiceContent;
  TimesheetContent get timesheet => content as TimesheetContent;
  ActivityContent get activity => content as ActivityContent;

  FieldDraft copyWith({
    FieldContent? content,
    int? projectId,
    String? projectLabel,
    int? companyId,
    String? reportDate,
    String? reason,
    FieldSyncState? syncState,
    bool? offline,
    int? serverId,
    int? serverRev,
    int? serverPhotoCount,
    String? docNo,
    String? editableUntil,
    bool clearConflict = false,
  }) => FieldDraft(
    clientUuid: clientUuid,
    type: type,
    companyId: companyId ?? this.companyId,
    projectId: projectId ?? this.projectId,
    projectLabel: projectLabel ?? this.projectLabel,
    reportDate: reportDate ?? this.reportDate,
    content: content ?? this.content,
    serverPhotoCount: serverPhotoCount ?? this.serverPhotoCount,
    reason: reason ?? this.reason,
    serverId: serverId ?? this.serverId,
    serverRev: serverRev ?? this.serverRev,
    docNo: docNo ?? this.docNo,
    editableUntil: editableUntil ?? this.editableUntil,
    syncState: syncState ?? this.syncState,
    lastError: lastError,
    lastErrorCode: lastErrorCode,
    conflictCopy: clearConflict ? null : conflictCopy,
    offline: offline ?? this.offline,
    updatedAt: updatedAt,
  );

  /// One line for lists: "EX-01 · HM 1.025" / "CV Maju Jaya · Pengiriman SJ-0441".
  String get summary => switch (content) {
    final ServiceContent c => [
      c.unitLabel,
      c.serviceType?.label ?? '',
      if (c.hourMeter != null) 'HM ${fmtNum(c.hourMeter!)}',
    ].where((e) => e.isNotEmpty).join(' · '),
    final TimesheetContent c => [
      c.unitLabel,
      if (c.hmStart != null && c.hmEnd != null) 'HM ${fmtNum(c.hmStart!)} → ${fmtNum(c.hmEnd!)}',
      if (c.workHours != null) 'kerja ${fmtNum(c.workHours!)} j',
    ].where((e) => e.isNotEmpty).join(' · '),
    final ActivityContent c => [
      c.clientName,
      [c.kind?.label ?? '', c.docNo.trim()].where((e) => e.isNotEmpty).join(' '),
    ].where((e) => e.isNotEmpty).join(' · '),
  };
}

/// Project that has field reports (masters `projects` with `kind`, `client`).
class FieldProject {
  const FieldProject({
    required this.id,
    required this.label,
    required this.kind,
    this.code,
    this.name = '',
    this.companyId,
    this.clientId,
  });
  final int id;
  final String label;
  final String? code;
  final String name;
  final ProjectKind kind;
  final int? companyId;

  /// Customer of the project (nullable): a customer-owned unit must belong to it.
  final int? clientId;
}

/// Unit & Kendaraan (`Unit` of `GET /units`, cached in `field_units`).
class FieldUnit {
  const FieldUnit({
    required this.id,
    required this.companyId,
    this.kind = 'alat_berat',
    this.label = '',
    this.unitCode,
    this.plateDisplay,
    this.type,
    this.brandModel,
    this.serialNo,
    this.owner = 'sendiri',
    this.clientId,
    this.clientName,
    this.status = UnitStatus.siap,
    this.lastHourMeter,
    this.lastHourMeterAt,
    this.active = true,
    this.updatedAt,
  });
  final int id;
  final int companyId;
  final String kind;
  final String label;
  final String? unitCode;
  final String? plateDisplay;
  final String? type;
  final String? brandModel;
  final String? serialNo;
  final String owner;
  final int? clientId;
  final String? clientName;
  final UnitStatus status;
  final double? lastHourMeter;
  final String? lastHourMeterAt;
  final bool active;
  final String? updatedAt;

  bool get customerOwned => owner == 'pelanggan';

  /// "EX-01" / plate / label.
  String get code =>
      (unitCode ?? '').isNotEmpty ? unitCode! : ((plateDisplay ?? '').isNotEmpty ? plateDisplay! : label);

  /// "EX-01 · Excavator PC200-8".
  String get title {
    final desc = [type, brandModel].where((e) => (e ?? '').trim().isNotEmpty).join(' ');
    return [code, desc].where((e) => e.isNotEmpty).join(' · ');
  }

  /// Search by unit code, plate, type or brand (case-insensitive, spaces ignored).
  bool matches(String query) {
    final q = query.toLowerCase().replaceAll(RegExp(r'[\s-]'), '');
    if (q.isEmpty) return true;
    return [
      unitCode,
      plateDisplay,
      label,
      type,
      brandModel,
      serialNo,
    ].any((v) => (v ?? '').toLowerCase().replaceAll(RegExp(r'[\s-]'), '').contains(q));
  }

  factory FieldUnit.fromJson(Json j) => FieldUnit(
    id: fInt(j['id']),
    companyId: fInt(j['companyId'] ?? j['company']),
    kind: fStrN(j['kind']) ?? 'alat_berat',
    label: fStr(j['label'] ?? j['displayName']),
    unitCode: fStrN(j['unitCode']),
    plateDisplay: fStrN(j['plateDisplay'] ?? j['plateNo']),
    type: fStrN(j['type']),
    brandModel: fStrN(j['brandModel']),
    serialNo: fStrN(j['serialNo']),
    owner: fStrN(j['owner']) ?? 'sendiri',
    clientId: fIntN(fMap(j['client'])['id']) ?? fIntN(j['client']),
    clientName: fStrN(fMap(j['client'])['name']),
    status: UnitStatus.fromCode(j['status']) ?? UnitStatus.siap,
    lastHourMeter: fDblN(j['lastHourMeter']),
    lastHourMeterAt: fStrN(j['lastHourMeterAt']),
    active: j['active'] != false,
    updatedAt: fStrN(j['updatedAt']),
  );
}

/// Contract unit of a kontrak_unit project WITHOUT rate / basis / minimum hours (they never reach the phone).
class FieldContractUnit {
  const FieldContractUnit({
    required this.id,
    required this.companyId,
    required this.projectId,
    required this.unitId,
    this.unitLabel = '',
    this.unitCode,
    required this.startDate,
    this.endDate,
    this.active = true,
  });
  final int id;
  final int companyId;
  final int projectId;
  final int unitId;
  final String unitLabel;
  final String? unitCode;
  final String startDate;
  final String? endDate;
  final bool active;

  String get code => (unitCode ?? '').isNotEmpty ? unitCode! : unitLabel;

  /// Active contract unit on [date] (`YYYY-MM-DD`): start ≤ date ≤ end (open end = running).
  bool activeOn(String date) =>
      active && startDate.compareTo(date) <= 0 && (endDate == null || endDate!.compareTo(date) >= 0);

  /// `ContractUnit` JSON; `rate`, `rateBasis`, `minHoursPerMonth` are deliberately ignored.
  factory FieldContractUnit.fromJson(Json j, {int? projectId}) {
    final unit = fMap(j['unit']);
    return FieldContractUnit(
      id: fInt(j['id']),
      companyId: fInt(j['companyId']),
      projectId: fIntN(j['projectId']) ?? projectId ?? 0,
      unitId: fInt(unit['id'] ?? j['unitId']),
      unitLabel: fStr(unit['label']),
      unitCode: fStrN(unit['unitCode']),
      startDate: fStr(j['startDate']),
      endDate: fStrN(j['endDate']),
      active: j['active'] != false,
    );
  }
}

/// Incoming PO still to deliver (`OpenPo`, cached without its value).
class FieldOpenPo {
  const FieldOpenPo({
    required this.id,
    required this.companyId,
    required this.projectId,
    required this.clientId,
    this.clientName = '',
    required this.activityDate,
    this.docNo,
    this.items = const [],
    this.poStatus = PoStatus.belumKirim,
    this.ageDays = 0,
    this.deliveries = 0,
  });
  final int id;
  final int companyId;
  final int projectId;
  final int clientId;
  final String clientName;
  final String activityDate;
  final String? docNo;
  final List<PartLine> items;
  final PoStatus poStatus;
  final int ageDays;
  final int deliveries;

  /// "PO-0907 · Seal kit 1 set, Filter 4 pcs (5 hari)".
  String get label {
    final its = items.map((i) => i.summary).where((e) => e.isNotEmpty).join(', ');
    final head = [docNo ?? 'PO #$id', if (its.isNotEmpty) its].join(' · ');
    return '$head ($ageDays hari)';
  }

  factory FieldOpenPo.fromJson(Json j) => FieldOpenPo(
    id: fInt(j['id']),
    companyId: fInt(j['companyId']),
    projectId: fInt(fMap(j['project'])['id'] ?? j['projectId']),
    clientId: fInt(fMap(j['client'])['id'] ?? j['clientId']),
    clientName: fStr(fMap(j['client'])['name'] ?? j['clientName']),
    activityDate: fStr(j['activityDate']),
    docNo: fStrN(j['docNo']),
    items: _lines(j['items']),
    poStatus: PoStatus.fromCode(j['poStatus']) ?? PoStatus.belumKirim,
    ageDays: fInt(j['ageDays']),
    deliveries: fInt(j['deliveries']),
  );
}

class FieldClient {
  const FieldClient({required this.id, required this.companyId, this.name = ''});
  final int id;
  final int companyId;
  final String name;
}

/// A timesheet known on the phone (server cache or local) — HM prefill and the unit tabs.
class TimesheetMark {
  const TimesheetMark({
    required this.unitId,
    required this.reportDate,
    required this.hmStart,
    required this.hmEnd,
    this.operatorName,
    this.location,
    this.fuelLiters,
    this.local = false,
  });
  final int unitId;
  final String reportDate;
  final double hmStart;
  final double hmEnd;
  final String? operatorName;
  final String? location;
  final double? fuelLiters;

  /// Written on this phone, not yet confirmed by the server.
  final bool local;
}

/// A field record from the server (`ServiceReport` / `UnitTimesheet` / `AftersalesActivity`), kept as its raw
/// JSON with typed getters for lists, detail and "edit ≤ 24 h".
class FieldRecord {
  const FieldRecord(this.type, this.raw);
  final FieldReportType type;
  final Json raw;

  int get id => fInt(raw['id']);
  int? get companyId => fIntN(raw['companyId']);
  Json get _project => fMap(raw['project']);
  int get projectId => fInt(_project['id']);
  String get projectLabel {
    final code = fStr(_project['code']);
    final name = fStr(_project['name']);
    return [code, name].where((e) => e.isNotEmpty).join(' — ');
  }

  String get date => fStr(type == FieldReportType.aftersalesActivity ? raw['activityDate'] : raw['reportDate']);
  String? get docNo => fStrN(raw['docNo']);
  String? get clientUuid => fStrN(raw['clientUuid']);
  int get rev => fInt(raw['rev'], 1);
  bool get editable => raw['editable'] == true;
  String? get editableUntil => fStrN(raw['editableUntil']);
  bool get offline => raw['offline'] == true;
  List<String> get flags => _strings(raw['flags']);
  String? get reporterName => fStrN(fMap(raw['reporter'])['name']);
  String? get createdAt => fStrN(raw['createdAt']);

  Json get _unit => fMap(raw['unit']);
  int? get unitId => fIntN(_unit['id']);
  String get unitCode {
    final u = _unit;
    return fStrN(u['unitCode']) ?? fStrN(u['plateDisplay']) ?? fStr(u['label']);
  }

  int? get clientId => fIntN(fMap(raw['client'])['id']);
  String get clientName => fStr(fMap(raw['client'])['name']);
  ActivityKind? get kind => ActivityKind.fromCode(raw['kind']);
  PoStatus? get poStatus => PoStatus.fromCode(raw['poStatus']);
  String? get followUpDate => fStrN(raw['followUpDate']);
  bool get valueVisible => raw['valueVisible'] == true;

  /// Only when the server shows it to the caller (Direktur/Finance/Admin or the reporter).
  int? get value => valueVisible ? fIntN(raw['value']) : null;

  List<int> get photoIds => [
    for (final p in fList(raw['photos'])) ?fIntN(fMap(p)['id']),
    if (fIntN(fMap(raw['hmPhoto'])['id']) case final int hm) hm,
  ];

  List<PartLine> get parts => _lines(raw[type == FieldReportType.serviceReport ? 'spareparts' : 'items']);

  /// Title line of lists.
  String get title => switch (type) {
    FieldReportType.serviceReport => [
      unitCode,
      ServiceType.fromCode(raw['serviceType'])?.label ?? '',
    ].where((e) => e.isNotEmpty).join(' · '),
    FieldReportType.unitTimesheet => unitCode,
    FieldReportType.aftersalesActivity => [clientName, kind?.label ?? ''].where((e) => e.isNotEmpty).join(' · '),
  };

  /// Second line of lists.
  String get subtitle => switch (type) {
    FieldReportType.serviceReport => [
      if (fDblN(raw['hourMeter']) case final double hm) 'HM ${fmtNum(hm)}',
      UnitStatus.fromCode(raw['unitStatusAfter'])?.label ?? '',
      fStr(raw['action']),
    ].where((e) => e.isNotEmpty).join(' · '),
    FieldReportType.unitTimesheet => [
      'HM ${fmtNum(fDblN(raw['hmStart']) ?? 0)} → ${fmtNum(fDblN(raw['hmEnd']) ?? 0)}',
      'kerja ${fmtNum(fDblN(raw['workHours']) ?? 0)} j',
      if ((fDblN(raw['standbyHours']) ?? 0) > 0) 'standby ${fmtNum(fDblN(raw['standbyHours'])!)} j',
      if ((fDblN(raw['breakdownHours']) ?? 0) > 0) 'breakdown ${fmtNum(fDblN(raw['breakdownHours'])!)} j',
    ].join(' · '),
    FieldReportType.aftersalesActivity => [
      docNo ?? '',
      parts.map((p) => p.summary).where((e) => e.isNotEmpty).join(', '),
      if (poStatus != null) poStatus!.label,
      if (followUpDate != null) 'follow-up $followUpDate',
    ].where((e) => e.isNotEmpty).join(' · '),
  };

  /// Local draft to edit this record (only the reporter, ≤ 24 h; the server re-checks).
  FieldDraft toDraft({required String clientUuid}) {
    final FieldContent content = switch (type) {
      FieldReportType.serviceReport => ServiceContent(
        unitId: unitId,
        unitLabel: unitCode,
        hourMeter: fDblN(raw['hourMeter']),
        startTime: fStrN(raw['startTime']),
        endTime: fStrN(raw['endTime']),
        serviceType: ServiceType.fromCode(raw['serviceType']),
        complaint: fStr(raw['complaint']),
        action: fStr(raw['action']),
        helpers: fStr(raw['helpers']),
        spareparts: parts,
        unitStatusAfter: UnitStatus.fromCode(raw['unitStatusAfter']),
        notes: fStr(raw['notes']),
      ),
      FieldReportType.unitTimesheet => TimesheetContent(
        unitId: unitId,
        unitLabel: unitCode,
        hmStart: fDblN(raw['hmStart']),
        hmEnd: fDblN(raw['hmEnd']),
        workHours: fDblN(raw['workHours']),
        standbyHours: fDblN(raw['standbyHours']),
        breakdownHours: fDblN(raw['breakdownHours']),
        breakdownReason: fStr(raw['breakdownReason']),
        fuelLiters: fDblN(raw['fuelLiters']),
        operatorName: fStr(raw['operatorName']),
        location: fStr(raw['location']),
        notes: fStr(raw['notes']),
      ),
      FieldReportType.aftersalesActivity => ActivityContent(
        clientId: clientId,
        clientName: clientName,
        kind: kind,
        docNo: docNo ?? '',
        items: parts,
        value: value,
        relatesTo: fIntN(fMap(raw['relatesTo'])['id']),
        relatesToLabel: fStr(fMap(raw['relatesTo'])['docNo']),
        followUpDate: followUpDate,
        receiver: fStr(raw['receiver']),
        notes: fStr(raw['notes']),
      ),
    };
    return FieldDraft(
      clientUuid: clientUuid,
      type: type,
      companyId: companyId,
      projectId: projectId,
      projectLabel: projectLabel,
      reportDate: date,
      content: content,
      serverPhotoCount: photoIds.length,
      serverId: id,
      serverRev: rev,
      docNo: docNo,
      editableUntil: editableUntil,
    );
  }
}

class FieldRecordPage {
  const FieldRecordPage({required this.items, this.nextCursor});
  final List<FieldRecord> items;
  final String? nextCursor;

  factory FieldRecordPage.fromJson(FieldReportType type, Json j) => FieldRecordPage(
    items: [for (final i in fList(j['items'])) FieldRecord(type, fMap(i))],
    nextCursor: fStrN(j['nextCursor']),
  );
}
