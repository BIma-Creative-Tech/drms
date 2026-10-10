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

/// Not in the future, at most [fieldBackdateMaxDays] back (server `reportDateError`).
String? reportDateError(String date, String today) {
  if (!_ymdRe.hasMatch(date)) return 'Tanggal tidak valid.';
  if (date.compareTo(today) > 0) return 'Tanggal laporan tidak boleh di masa depan.';
  if (daysBetween(date, today) > fieldBackdateMaxDays) {
    return 'Tanggal laporan paling lama $fieldBackdateMaxDays hari ke belakang.';
  }
  return null;
}

/// Dates offered by the date pickers: today and up to 14 days back (newest first).
List<String> allowedReportDates(String today) => [for (var i = 0; i <= fieldBackdateMaxDays; i++) addDays(today, -i)];

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

/// HM awal prefill: HM akhir of the latest timesheet of the unit BEFORE [date] (local or server), else the
/// unit's last HM reading (when not after [date]).
({double? hm, String? date}) previousHmEnd({
  required int unitId,
  required String date,
  required Iterable<TimesheetMark> marks,
  double? lastHourMeter,
  String? lastHourMeterAt,
}) {
  TimesheetMark? prev;
  for (final m in marks) {
    if (m.unitId != unitId || m.reportDate.compareTo(date) >= 0) continue;
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

Map<String, String> _common(FieldDraft d, String today) {
  final e = <String, String>{};
  if (d.projectId <= 0) e['project'] = 'Pilih project / kontrak dulu.';
  if (!d.isEdit) {
    final de = reportDateError(d.reportDate, today);
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
  if (c.serviceType == null) e['serviceType'] = 'Pilih jenis servis.';
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

/// Timesheet Unit: HM akhir ≥ HM awal, hours 0–24 each and Σ ≤ 24, breakdown needs a reason, exactly one HM
/// photo on create.
Map<String, String> validateTimesheet(FieldDraft d, {required String today}) {
  final c = d.timesheet;
  final e = _common(d, today);
  if (c.unitId == null) e['unit'] = 'Pilih unit.';
  final s = c.hmStart, en = c.hmEnd;
  if (s == null) {
    e['hmStart'] = 'HM awal wajib diisi.';
  } else if (!_dec2(s, maxHourMeter)) {
    e['hmStart'] = 'HM awal ≥ 0 (maks. 2 desimal).';
  }
  if (en == null) {
    e['hmEnd'] = 'HM akhir wajib diisi.';
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
  if (!d.isEdit && c.hmPhoto == null) e['photos'] = 'Foto meter HM wajib (1 foto).';
  return e;
}

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

Map<String, String> validateField(FieldDraft d, {required String today, double? hmFloorValue}) => switch (d.type) {
  FieldReportType.serviceReport => validateService(d, today: today, floor: hmFloorValue),
  FieldReportType.unitTimesheet => validateTimesheet(d, today: today),
  FieldReportType.aftersalesActivity => validateActivity(d, today: today),
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
      return {
        ...head,
        if (!d.isEdit) ...{'unit_id': c.unitId, 'report_date': d.reportDate},
        'helpers': _t(c.helpers),
        'start_time': _t(c.startTime ?? ''),
        'end_time': _t(c.endTime ?? ''),
        'hour_meter': c.hourMeter == null ? null : _r2(c.hourMeter!),
        'service_type': c.serviceType?.code,
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
        'hm_start': _r2(c.hmStart ?? 0),
        'hm_end': _r2(c.hmEnd ?? 0),
        'work_hours': _r2(c.workHours ?? 0),
        'standby_hours': _r2(c.standbyHours ?? 0),
        'breakdown_hours': _r2(c.breakdownHours ?? 0),
        'breakdown_reason': (c.breakdownHours ?? 0) > 0 ? _t(c.breakdownReason) : null,
        'fuel_liters': c.fuelLiters == null ? null : _r2(c.fuelLiters!),
        'operator_name': _t(c.operatorName),
        'location': _t(c.location),
        'notes': _t(c.notes),
        'reason': ?reason,
        // The HM photo is fixed once the timesheet exists (server: "cannot change afterwards").
        if (!d.isEdit) hmPhotoPlaceholderKey: c.hmPhoto,
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
  }
}

/// Indonesian text for the FR1 sync / API error codes (requirements v1.3; the server message is kept for
/// codes without a fixed text).
String fieldErrorMessage(String? code, String? serverMessage) {
  final known = switch (code) {
    'FEATURE_DISABLED' => 'Laporan lapangan belum diaktifkan untuk PT ini. Hubungi Admin/Direktur.',
    'WRONG_PROJECT_KIND' => 'Jenis laporan ini tidak tersedia untuk jenis project tersebut (timesheet hanya kontrak unit, aktivitas hanya aftersales).',
    'HM_DECREASED' =>
      'HM lebih kecil dari HM terakhir unit. Periksa angka HM; HM lama hanya bisa dikoreksi PM/Direktur.',
    'NOT_IN_CONTRACT' => 'Unit tidak ada di kontrak aktif project ini pada tanggal tersebut.',
    'DUPLICATE_DATE' =>
      'Timesheet unit ini untuk tanggal tersebut sudah ada. Ubah timesheet yang ada (≤ 24 jam) atau minta koreksi PM.',
    'PO_CLOSED' => 'PO sudah terkirim semua atau dibatalkan; pengiriman tidak bisa dicatat lagi.',
    'CLIENT_UUID_CONFLICT' => 'ID laporan bentrok dengan data pengguna lain. Buat laporan baru.',
    'NOT_EDITABLE' => 'Laporan hanya bisa diubah pelapornya dalam 24 jam. Setelah itu minta koreksi PM/Direktur.',
    'FORBIDDEN' => 'Anda tidak ditugaskan ke project ini atau tidak berhak membuat laporan ini.',
    'PHOTO_LIMIT' => 'Jumlah foto melebihi batas (servis 10, timesheet 1 foto HM, aftersales 5).',
    'MEDIA_IN_USE' => 'Foto sudah dipakai di laporan lain. Ambil foto baru.',
    'MEDIA_MISSING' => 'Foto belum diterima server. Coba kirim lagi.',
    'NOT_FOUND' => 'Data (project/unit/pelanggan/PO) tidak ditemukan atau tidak bisa Anda akses.',
    _ => null,
  };
  if (known != null) return known;
  if (serverMessage != null && serverMessage.trim().isNotEmpty) return serverMessage.trim();
  return 'Ditolak server (${code ?? 'tanpa kode'}).';
}
