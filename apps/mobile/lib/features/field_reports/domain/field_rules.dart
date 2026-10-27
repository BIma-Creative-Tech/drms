import '../../../core/format/dates.dart';
import '../../expense/data/expense_mappers.dart' show Json, progressPhotosPlaceholderKey, hmPhotoPlaceholderKey;
import 'field_models.dart';

/// Client-side rules of the field reports (ADR 0020, requirements v1.3 §3). The server re-checks everything;
/// these give the field user the answer before the report leaves the phone. Messages are Indonesian; map
/// keys are the field names of the editors.

/// "Today" in the company time zone (Indonesia: fixed offsets, no DST) as `YYYY-MM-DD`.
String todayIn(String? zone, {DateTime? now}) => toYmd((now ?? DateTime.now()).toUtc().add(offsetForZone(zone)));

DateTime _ymd(String d) =>
    DateTime.utc(int.parse(d.substring(0, 4)), int.parse(d.substring(5, 7)), int.parse(d.substring(8, 10)));

/// Calendar days b − a between two business dates.
int daysBetween(String a, String b) => _ymd(b).difference(_ymd(a)).inDays;

String addDays(String d, int n) => toYmd(_ymd(d).add(Duration(days: n)));

final _ymdRe = RegExp(r'^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$');
final _hhmmRe = RegExp(r'^([01]\d|2[0-3]):[0-5]\d$');

/// Not in the future, at most [fieldBackdateMaxDays] back (server `reportDateError`). [minDate] = the caller's own
/// earliest date when the server gave one (timesheet: `timesheetMinDate` of `GET /projects/{id}/contract-units` —
/// the project's PM and the PT's Direktur may fill any date of the unit's contract period, user 2026-10-24).
String? reportDateError(String date, String today, {String? minDate}) {
  if (!_ymdRe.hasMatch(date)) return 'Tanggal tidak valid.';
  if (date.compareTo(today) > 0) return 'Tanggal laporan tidak boleh di masa depan.';
  if (minDate != null) {
    return date.compareTo(minDate) < 0 ? 'Tanggal laporan paling awal $minDate.' : null;
  }
  if (daysBetween(date, today) > fieldBackdateMaxDays) {
    return 'Tanggal laporan paling lama $fieldBackdateMaxDays hari ke belakang.';
  }
  return null;
}

/// Earliest report date of a timesheet: the server's `timesheetMinDate` (never after today), else today − 14.
String timesheetMinDate(String today, String? serverMin) {
  if (serverMin == null || !_ymdRe.hasMatch(serverMin)) return addDays(today, -fieldBackdateMaxDays);
  return serverMin.compareTo(today) > 0 ? today : serverMin;
}

/// Dates offered by the date pickers: today and up to 14 days back, or back to [minDate] (newest first).
List<String> allowedReportDates(String today, {String? minDate}) {
  final back = minDate == null ? fieldBackdateMaxDays : daysBetween(minDate, today);
  return [for (var i = 0; i <= back; i++) addDays(today, -i)];
}

bool _dec2(double v, double max) => v >= 0 && v <= max && ((v * 100).round() - v * 100).abs() < 1e-6;
String? _len(String v, int max, String label) => v.trim().length > max ? '$label maks. $max karakter.' : null;

/// The latest hour-meter reading known on/before [date] for a unit: the unit's `lastHourMeter` (when its date is
/// not after [date]) and every known timesheet HM akhir / service HM on or before [date]. A new service reading
/// below it is refused by the server (`HM_DECREASED`).
double? hmFloor({
  double? lastHourMeter,
  String? lastHourMeterAt,
  required String date,
  Iterable<(String date, double hm)> readings = const [],
}) {
  double? best;
  void take(double v) => best = best == null || v > best! ? v : best;
  if (lastHourMeter != null && (lastHourMeterAt == null || lastHourMeterAt.substring(0, 10).compareTo(date) <= 0)) {
    take(lastHourMeter);
  }
  for (final (d, hm) in readings) {
    if (d.compareTo(date) <= 0) take(hm);
  }
  return best;
}

/// HM awal prefill: HM akhir of the latest timesheet of the unit BEFORE [date] that HAS HM (local or server; HM is
/// recorded about once a week — user 2026-10-24), else the unit's last HM reading (when not after [date]).
({double? hm, String? date}) previousHmEnd({
  required int unitId,
  required String date,
  required Iterable<TimesheetMark> marks,
  double? lastHourMeter,
  String? lastHourMeterAt,
}) {
  TimesheetMark? prev;
  for (final m in marks) {
    if (m.unitId != unitId || m.hmEnd == null || m.reportDate.compareTo(date) >= 0) continue;
    if (prev == null || m.reportDate.compareTo(prev.reportDate) > 0) prev = m;
  }
  if (prev != null) return (hm: prev.hmEnd, date: prev.reportDate);
  if (lastHourMeter != null && (lastHourMeterAt == null || lastHourMeterAt.substring(0, 10).compareTo(date) < 0)) {
    return (hm: lastHourMeter, date: lastHourMeterAt?.substring(0, 10));
  }
  return (hm: null, date: null);
}

/// "Salin dari kemarin": operator, location and fuel of the unit's latest timesheet before [date].
TimesheetMark? copySource({required int unitId, required String date, required Iterable<TimesheetMark> marks}) {
  TimesheetMark? prev;
  for (final m in marks) {
    if (m.unitId != unitId || m.reportDate.compareTo(date) >= 0) continue;
    if (prev == null || m.reportDate.compareTo(prev.reportDate) > 0) prev = m;
  }
  return prev;
}

Map<String, String> _common(FieldDraft d, String today, {String? minDate}) {
  final e = <String, String>{};
  if (d.projectId <= 0) e['project'] = 'Pilih project / kontrak dulu.';
  if (!d.isEdit) {
    final de = reportDateError(d.reportDate, today, minDate: minDate);
    if (de != null) e['date'] = de;
  }
  if (d.photoTotal > d.type.maxPhotos) e['photos'] = 'Maksimal ${d.type.maxPhotos} foto.';
  final r = (d.reason ?? '').trim();
  if (r.isNotEmpty && r.length < 3) e['reason'] = 'Alasan min. 3 karakter.';
  if (r.length > 1000) e['reason'] = 'Alasan maks. 1000 karakter.';
  return e;
}

Map<String, String> _parts(List<PartLine> lines, {required bool items}) {
  final e = <String, String>{};
  final filled = [
    for (final p in lines)
      if (!p.isBlank) p,
  ];
  if (filled.length > maxPartLines) e['parts'] = 'Maksimal $maxPartLines baris.';
  for (final p in filled) {
    if (p.name.trim().isEmpty) {
      e['parts'] = items ? 'Nama item wajib diisi.' : 'Nama sparepart wajib diisi.';
    } else if (p.name.trim().length > 160) {
      e['parts'] = 'Nama maks. 160 karakter.';
    } else if (p.qty == null || p.qty! <= 0 || p.qty! > 1e6) {
      e['parts'] = 'Jumlah "${p.name.trim()}" harus lebih dari 0.';
    } else if (((p.qty! * 1000).round() - p.qty! * 1000).abs() > 1e-6) {
      e['parts'] = 'Jumlah maks. 3 desimal.';
    } else if ((p.uom ?? '').trim().length > 16) {
      e['parts'] = 'Satuan maks. 16 karakter.';
    } else if ((p.partNo ?? '').trim().length > 64) {
      e['parts'] = 'No. part maks. 64 karakter.';
    }
    if (e.isNotEmpty) break;
  }
  return e;
}

/// Laporan Servis Unit. [floor] = [hmFloor] of the chosen unit (HM below it is blocked: HM_DECREASED).
Map<String, String> validateService(FieldDraft d, {required String today, double? floor}) {
  final c = d.service;
  final e = _common(d, today);
  if (c.unitId == null) e['unit'] = 'Pilih unit.';
  final hm = c.hourMeter;
  if (hm != null) {
    if (!_dec2(hm, maxHourMeter)) {
      e['hourMeter'] = 'HM harus angka ≥ 0 (maks. 2 desimal).';
    } else if (floor != null && hm < floor - 0.005 && !d.isEdit) {
      e['hourMeter'] = 'HM tidak boleh lebih kecil dari HM terakhir unit (${fmtNum(floor)}).';
    }
  }
  final st = c.startTime, en = c.endTime;
  if (st != null && st.isNotEmpty && !_hhmmRe.hasMatch(st)) e['startTime'] = 'Jam mulai HH:MM.';
  if (en != null && en.isNotEmpty && !_hhmmRe.hasMatch(en)) e['endTime'] = 'Jam selesai HH:MM.';
  if ((st ?? '').isNotEmpty && (en ?? '').isNotEmpty && !e.containsKey('startTime') && !e.containsKey('endTime')) {
    if (en!.compareTo(st!) <= 0) e['endTime'] = 'Jam selesai harus setelah jam mulai.';
  }
  if (!c.hasServiceType) e['serviceType'] = 'Pilih minimal satu jenis servis.';
  final action = c.action.trim();
  if (action.length < 3) e['action'] = 'Tindakan / pekerjaan wajib diisi (min. 3 karakter).';
  final lenErrors = {
    'action': _len(c.action, 4000, 'Tindakan'),
    'complaint': _len(c.complaint, 2000, 'Keluhan'),
    'helpers': _len(c.helpers, 200, 'Helper'),
    'notes': _len(c.notes, 2000, 'Catatan'),
  };
  lenErrors.forEach((k, v) {
    if (v != null) e[k] = v;
  });
  if (c.unitStatusAfter == null) e['unitStatusAfter'] = 'Pilih status unit setelah servis.';
  e.addAll(_parts(c.spareparts, items: false));
  return e;
}

/// Timesheet Unit: HM optional (user 2026-10-24, recorded about once a week) but both-or-none, HM akhir ≥ HM awal,
/// hours 0–24 each and Σ ≤ 24, breakdown needs a reason, the HM photo only when HM is filled (an edit keeps or adds
/// the one photo). [minDate] = [timesheetMinDate] of the project (PM / Direktur: the whole contract period).
Map<String, String> validateTimesheet(FieldDraft d, {required String today, String? minDate}) {
  final c = d.timesheet;
  final e = _common(d, today, minDate: minDate);
  if (c.unitId == null) e['unit'] = 'Pilih unit.';
  final s = c.hmStart, en = c.hmEnd;
  if (s == null) {
    if (en != null) e['hmStart'] = 'HM awal wajib bila HM akhir diisi.';
  } else if (!_dec2(s, maxHourMeter)) {
    e['hmStart'] = 'HM awal ≥ 0 (maks. 2 desimal).';
  }
  if (en == null) {
    if (s != null) e['hmEnd'] = 'HM akhir wajib bila HM awal diisi.';
  } else if (!_dec2(en, maxHourMeter)) {
    e['hmEnd'] = 'HM akhir ≥ 0 (maks. 2 desimal).';
  } else if (s != null && en < s) {
    e['hmEnd'] = 'HM akhir tidak boleh lebih kecil dari HM awal.';
  }
  if (c.workHours == null) e['workHours'] = 'Jam kerja wajib diisi (0 bila tidak bekerja).';
  for (final (k, v, label) in [
    ('workHours', c.workHours, 'Jam kerja'),
    ('standbyHours', c.standbyHours, 'Jam standby'),
    ('breakdownHours', c.breakdownHours, 'Jam breakdown'),
  ]) {
    if (v != null && !_dec2(v, maxHoursPerDay)) e[k] = '$label 0–24 (maks. 2 desimal).';
  }
  final total = c.totalHours;
  if (total > maxHoursPerDay + 1e-9) e['hours'] = 'Total jam ${fmtNum(total)} melebihi 24 jam.';
  if ((c.breakdownHours ?? 0) > 0 && c.breakdownReason.trim().isEmpty) {
    e['breakdownReason'] = 'Alasan breakdown wajib bila ada jam breakdown.';
  }
  if (c.fuelLiters != null && !_dec2(c.fuelLiters!, 100000)) e['fuelLiters'] = 'BBM (liter) ≥ 0 (maks. 2 desimal).';
  final lenErrors = {
    'breakdownReason': _len(c.breakdownReason, 500, 'Alasan breakdown'),
    'operatorName': _len(c.operatorName, 128, 'Nama operator'),
    'location': _len(c.location, 200, 'Lokasi'),
    'notes': _len(c.notes, 2000, 'Catatan'),
  };
  lenErrors.forEach((k, v) {
    if (v != null) e[k] = v;
  });
  if (c.hasHm && c.hmPhoto == null && d.serverPhotoCount == 0) e['photos'] = 'Foto meter HM wajib bila HM diisi.';
  return e;
}

/// HM awal that counts: a PREFILLED HM awal the user did not touch is dropped while HM akhir is empty — a day
/// without an HM reading sends no HM at all (same rule as the web form; user 2026-10-24).
double? effectiveHmStart({required double? hmStart, required double? hmEnd, required bool touched}) =>
    touched || hmEnd != null ? hmStart : null;

/// Non-blocking hints of a timesheet: HM gap against the previous HM akhir (server flag HM_GAP) and the
/// "breakdown ≥ 4 jam → buat laporan servis" suggestion.
({bool hmGap, bool suggestService}) timesheetHints(TimesheetContent c) => (
  hmGap: c.hmStart != null && c.previousHmEnd != null && (c.hmStart! - c.previousHmEnd!).abs() > 0.005,
  suggestService: (c.breakdownHours ?? 0) >= breakdownSuggestServiceHours,
);

/// Aktivitas Aftersales.
Map<String, String> validateActivity(FieldDraft d, {required String today}) {
  final c = d.activity;
  final e = _common(d, today);
  if (c.clientId == null) e['client'] = 'Pilih pelanggan.';
  if (c.kind == null) e['kind'] = 'Pilih jenis aktivitas.';
  if (c.kind == ActivityKind.pengiriman && c.relatesTo == null && !d.isEdit) {
    e['relatesTo'] = 'Pengiriman harus memilih PO terbuka pelanggan ini.';
  }
  final f = c.followUpDate;
  if (c.kind == ActivityKind.penawaran && f != null && f.isNotEmpty) {
    if (!_ymdRe.hasMatch(f)) {
      e['followUpDate'] = 'Tanggal follow-up tidak valid.';
    } else if (f.compareTo(d.reportDate) < 0) {
      e['followUpDate'] = 'Tanggal follow-up tidak boleh sebelum tanggal aktivitas.';
    }
  }
  if (c.value != null && (c.value! < 0 || c.value! > 1e13)) e['value'] = 'Nilai harus Rupiah ≥ 0.';
  final lenErrors = {
    'docNo': _len(c.docNo, 64, 'No. dokumen'),
    'receiver': _len(c.receiver, 128, 'Penerima'),
    'notes': _len(c.notes, 2000, 'Catatan'),
  };
  lenErrors.forEach((k, v) {
    if (v != null) e[k] = v;
  });
  e.addAll(_parts(c.items, items: true));
  return e;
}

/// Work items of [c] that go above their RAP volume with this report (realisation − the report's booked value +
/// the new value > volume, and the value grew). Allowed by the server, but only with notes (OVER_RAP_NOTE_REQUIRED).
List<RapItem> overRapItems(DailyContent c, Map<int, RapItem> items) => [
  for (final MapEntry(key: id, value: qty) in c.work.entries)
    if (items[id] case final RapItem it
        when it.isWork && qty > (c.baseWork[id] ?? 0) && it.realised - (c.baseWork[id] ?? 0) + qty > it.volume + 1e-9)
      it,
];

/// Laporan Harian (P3): hours 0–24, volumes ≥ 0 (2 decimals) on items of the right kind, manpower / equipment
/// 1–9999, notes required above the RAP volume, at least something to report on create.
Map<String, String> validateDaily(FieldDraft d, {required String today, Map<int, RapItem> items = const {}}) {
  final c = d.daily;
  final e = _common(d, today);
  if (c.rainHours != null && !_dec2(c.rainHours!, maxHoursPerDay)) e['rainHours'] = 'Jam hujan 0–24 (maks. 2 desimal).';
  if (c.stopHours != null && !_dec2(c.stopHours!, maxHoursPerDay)) {
    e['stopHours'] = 'Jam berhenti 0–24 (maks. 2 desimal).';
  }
  for (final MapEntry(key: id, value: v) in c.work.entries) {
    final it = items[id];
    if (!_dec2(v, 1e8)) {
      e['work'] = 'Volume ${it?.code ?? ''} harus angka ≥ 0 (maks. 2 desimal).'.replaceAll('  ', ' ');
    } else if (it != null && !it.isWork) {
      e['work'] = '${it.code} adalah material, bukan pekerjaan.';
    }
  }
  for (final MapEntry(key: id, value: m) in c.materials.entries) {
    final it = items[id];
    for (final v in [m.received, m.used]) {
      if (v != null && !_dec2(v, 1e8)) {
        e['materials'] = 'Material ${it?.code ?? ''}: angka ≥ 0 (maks. 2 desimal).'.replaceAll('  ', ' ');
      }
    }
  }
  for (final v in c.manpower.values) {
    if (v < 0 || v > 9999) e['manpower'] = 'Jumlah tenaga 0–9999.';
  }
  for (final v in c.equipment.values) {
    if ((v.count ?? 0) < 0 || (v.count ?? 0) > 9999) e['equipment'] = 'Jumlah alat 0–9999.';
    if (v.hours != null && !_dec2(v.hours!, maxHoursPerDay)) e['equipment'] = 'Jam alat 0–24 (maks. 2 desimal).';
  }
  final over = overRapItems(c, items);
  if (over.isNotEmpty && c.notes.trim().isEmpty) {
    e['notes'] = 'Volume melebihi RAP (${over.map((i) => i.code).join(', ')}): isi catatan penjelasan.';
  }
  final empty =
      c.workItems == 0 &&
      c.materials.values.every((m) => m.isBlank) &&
      c.workerCount == 0 &&
      c.issues.trim().isEmpty &&
      c.notes.trim().isEmpty;
  if (!d.isEdit && empty) e['work'] = 'Isi minimal satu volume pekerjaan, material, tenaga, kendala atau catatan.';
  final lenErrors = {'issues': _len(c.issues, 2000, 'Kendala'), 'notes': _len(c.notes, 2000, 'Catatan')};
  lenErrors.forEach((k, v) {
    if (v != null) e[k] = v;
  });
  return e;
}

Map<String, String> validateField(
  FieldDraft d, {
  required String today,
  double? hmFloorValue,
  Map<int, RapItem> rapItems = const {},
  String? timesheetMinDateValue,
}) => switch (d.type) {
  FieldReportType.serviceReport => validateService(d, today: today, floor: hmFloorValue),
  FieldReportType.unitTimesheet => validateTimesheet(d, today: today, minDate: timesheetMinDateValue),
  FieldReportType.aftersalesActivity => validateActivity(d, today: today),
  FieldReportType.dailyReport => validateDaily(d, today: today, items: rapItems),
};

String? _t(String v) => v.trim().isEmpty ? null : v.trim();
double _r2(double v) => (v * 100).round() / 100;

/// `SyncServiceReportPayload` / `SyncUnitTimesheetPayload` / `SyncAftersalesActivityPayload` of the report. Local
/// photo ids ride in [progressPhotosPlaceholderKey] (→ `photo_media_ids`) or [hmPhotoPlaceholderKey]
/// (→ `hm_photo_media_id`); the sync engine uploads them first (`POST /media/progress-photos`). A new record
/// carries its identity (project, unit / customer, date, kind) and the APK id; an edit carries the server id,
/// the editable fields and the (optional) reason — identity fields never change by sync.
Json fieldSyncPayload(FieldDraft d) {
  final reason = _t(d.reason ?? '');
  final head = d.isEdit
      ? <String, dynamic>{d.type.idKey: d.serverId}
      : <String, dynamic>{d.type.uuidKey: d.clientUuid, 'project_id': d.projectId};
  switch (d.content) {
    case final ServiceContent c:
      // ≥ 1 master id; only a report of an APK before 0.8.0 that the cache could not map yet sends its legacy code
      final typeIds = c.serviceTypeIds.isEmpty ? null : [...c.serviceTypeIds];
      final legacyType = typeIds == null ? c.legacyServiceType : null;
      return {
        ...head,
        if (!d.isEdit) ...{'unit_id': c.unitId, 'report_date': d.reportDate},
        'helpers': _t(c.helpers),
        'start_time': _t(c.startTime ?? ''),
        'end_time': _t(c.endTime ?? ''),
        'hour_meter': c.hourMeter == null ? null : _r2(c.hourMeter!),
        'service_type_ids': ?typeIds,
        'service_type': ?legacyType,
        'complaint': _t(c.complaint),
        'action': c.action.trim(),
        'unit_status_after': c.unitStatusAfter?.code,
        'spareparts': [for (final p in c.filledParts) p.toSync()],
        'notes': _t(c.notes),
        'reason': ?reason,
        progressPhotosPlaceholderKey: c.photoUuids,
      };
    case final TimesheetContent c:
      return {
        ...head,
        if (!d.isEdit) ...{'unit_id': c.unitId, 'report_date': d.reportDate},
        // HM optional (user 2026-10-24): a new timesheet sends it only when filled; an edit always sends it (null
        // clears HM the user emptied — the server takes both or none).
        if (d.isEdit || c.hasHm) ...{
          'hm_start': c.hmStart == null ? null : _r2(c.hmStart!),
          'hm_end': c.hmEnd == null ? null : _r2(c.hmEnd!),
        },
        'work_hours': _r2(c.workHours ?? 0),
        'standby_hours': _r2(c.standbyHours ?? 0),
        'breakdown_hours': _r2(c.breakdownHours ?? 0),
        'breakdown_reason': (c.breakdownHours ?? 0) > 0 ? _t(c.breakdownReason) : null,
        'fuel_liters': c.fuelLiters == null ? null : _r2(c.fuelLiters!),
        'operator_name': _t(c.operatorName),
        'location': _t(c.location),
        'notes': _t(c.notes),
        'reason': ?reason,
        // The HM photo is fixed once the timesheet has one; an edit may only ADD it to a timesheet without photo.
        if (!d.isEdit || d.serverPhotoCount == 0) hmPhotoPlaceholderKey: c.hmPhoto,
      };
    case final ActivityContent c:
      final kind = c.kind;
      return {
        ...head,
        if (!d.isEdit) ...{
          'client_id': c.clientId,
          'activity_date': d.reportDate,
          'kind': kind?.code,
          if (kind != null && kind.refersToPo) 'relates_to': c.relatesTo,
          if (kind == ActivityKind.pengiriman) 'po_delivered': c.poDelivered,
        },
        'doc_no': _t(c.docNo),
        'items': [for (final p in c.filledItems) p.toSync(withNote: false)],
        'value': c.value,
        'follow_up_date': kind == ActivityKind.penawaran ? _t(c.followUpDate ?? '') : null,
        'receiver': _t(c.receiver),
        'notes': _t(c.notes),
        'reason': ?reason,
        progressPhotosPlaceholderKey: c.photoUuids,
      };
    case final DailyContent c:
      return {
        ...head,
        if (!d.isEdit) 'report_date': d.reportDate,
        'weather_morning': c.weatherMorning?.code,
        'weather_noon': c.weatherNoon?.code,
        'weather_afternoon': c.weatherAfternoon?.code,
        'rain_hours': c.rainHours == null ? null : _r2(c.rainHours!),
        'stop_hours': c.stopHours == null ? null : _r2(c.stopHours!),
        // new report: only booked values; edit: every value that is or was booked (0 removes it)
        'work': [
          for (final MapEntry(key: id, value: v) in c.work.entries)
            if (v > 0 || (c.baseWork[id] ?? 0) != 0) {'rap_item_id': id, 'qty': _r2(v)},
          for (final MapEntry(key: id, value: v) in c.baseWork.entries)
            if (v != 0 && !c.work.containsKey(id)) {'rap_item_id': id, 'qty': 0},
        ],
        'materials': [
          for (final MapEntry(key: id, value: m) in c.materials.entries)
            if (!m.isBlank || d.isEdit) {'rap_item_id': id, 'received': _r2(m.received ?? 0), 'used': _r2(m.used ?? 0)},
        ],
        'manpower': [
          for (final MapEntry(key: id, value: n) in c.manpower.entries)
            if (n > 0) {'resource_type_id': id, 'count': n},
        ],
        'equipment': [
          for (final MapEntry(key: id, value: q) in c.equipment.entries)
            if ((q.count ?? 0) > 0)
              {'resource_type_id': id, 'count': q.count, 'hours': q.hours == null ? null : _r2(q.hours!)},
        ],
        'issues': _t(c.issues),
        'notes': _t(c.notes),
        'reason': ?reason,
        progressPhotosPlaceholderKey: c.photoUuids,
      };
  }
}

/// A `service_report.upsert` queued by an APK before 0.8.0 carries the single legacy `service_type` code and no
/// `service_type_ids`: it is sent with the id of the PT's type of the same code once the cache knows one ([types] =
/// the types of the item's PT), else unchanged (the server still accepts the legacy code).
Json mapLegacyServiceType(Json payload, Iterable<ServiceType> types) {
  final code = payload['service_type'];
  if (code is! String || payload['service_type_ids'] is List) return payload;
  final match = matchLegacyServiceType(types, code);
  if (match == null) return payload;
  return {
    for (final e in payload.entries)
      if (e.key != 'service_type') e.key: e.value,
    'service_type_ids': [match.id],
  };
}

/// Indonesian text for the FR1 sync / API error codes (requirements v1.3; the server message is kept for
/// codes without a fixed text).
String fieldErrorMessage(String? code, String? serverMessage) {
  final known = switch (code) {
    'FEATURE_DISABLED' => 'Laporan lapangan belum diaktifkan untuk PT ini. Hubungi Admin/Direktur.',
    'WRONG_PROJECT_KIND' => 'Jenis laporan ini tidak tersedia untuk jenis project tersebut (timesheet hanya kontrak unit, aktivitas hanya aftersales, laporan harian hanya konstruksi).',
    'HM_DECREASED' =>
      'HM lebih kecil dari HM terakhir unit. Periksa angka HM; HM lama hanya bisa dikoreksi PM/Direktur.',
    'NOT_IN_CONTRACT' => 'Unit tidak ada di kontrak aktif project ini pada tanggal tersebut.',
    'DUPLICATE_DATE' =>
      'Timesheet unit ini untuk tanggal tersebut sudah ada. Ubah timesheet yang ada (≤ 24 jam) atau minta koreksi PM.',
    'PO_CLOSED' => 'PO sudah terkirim semua atau dibatalkan; pengiriman tidak bisa dicatat lagi.',
    'CLIENT_UUID_CONFLICT' => 'ID laporan bentrok dengan data pengguna lain. Buat laporan baru.',
    'NOT_EDITABLE' => 'Laporan hanya bisa diubah pelapornya dalam 24 jam. Setelah itu minta koreksi PM/Direktur.',
    'FORBIDDEN' => 'Anda tidak ditugaskan ke project ini atau tidak berhak membuat laporan ini.',
    'PHOTO_LIMIT' => 'Jumlah foto melebihi batas (servis 25, laporan harian 10, timesheet 1 foto HM, aftersales 5).',
    'MEDIA_IN_USE' => 'Foto sudah dipakai di laporan lain. Ambil foto baru.',
    'MEDIA_MISSING' => 'Foto belum diterima server. Coba kirim lagi.',
    'NOT_FOUND' => 'Data (project/unit/pelanggan/PO) tidak ditemukan atau tidak bisa Anda akses.',
    'DAILY_EXISTS' =>
      'Laporan harian Anda untuk project dan tanggal ini sudah ada. Ubah laporan itu (≤ 24 jam) atau minta koreksi PM.',
    'OVER_RAP_NOTE_REQUIRED' => 'Volume melebihi RAP: isi catatan penjelasan lalu kirim lagi.',
    _ => null,
  };
  if (known != null) return known;
  if (serverMessage != null && serverMessage.trim().isNotEmpty) return serverMessage.trim();
  return 'Ditolak server (${code ?? 'tanpa kode'}).';
}
