import '../../../core/format/dates.dart';
import 'attendance.dart';

/// E6 read models (openapi `AttendanceRecap`, `AttendanceDay`, `AttendanceSummary`, `TeamToday`).

int _int(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
String? _strN(Object? v) => v == null ? null : '$v';
Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];

class PersonRef {
  const PersonRef({required this.id, required this.code, required this.name});
  final int id;
  final String code;
  final String name;
  factory PersonRef.fromJson(Map<String, dynamic> j) =>
      PersonRef(id: _int(j['id']), code: '${j['code'] ?? ''}', name: '${j['name'] ?? ''}');
}

class LocationRef {
  const LocationRef({required this.kind, required this.id, required this.code, required this.name});
  final SiteKind kind;
  final int id;
  final String code;
  final String name;
  String get label => code.isEmpty ? name : '$code — $name';
  factory LocationRef.fromJson(Map<String, dynamic> j) => LocationRef(
    kind: SiteKind.fromCode(_strN(j['type'])),
    id: _int(j['id']),
    code: '${j['code'] ?? ''}',
    name: '${j['name'] ?? ''}',
  );
}

/// One attendance row of a location/day (id is needed for corrections and the selfie viewer).
class AttendanceMark {
  const AttendanceMark({required this.id, required this.time, required this.source, required this.corrected});
  final int id;
  final String time; // UTC ISO
  final String source; // self | pm
  final bool corrected;
  static AttendanceMark? fromJson(Object? v) {
    final j = _map(v);
    if (_intN(j['id']) == null) return null;
    return AttendanceMark(
      id: _int(j['id']),
      time: '${j['time'] ?? ''}',
      source: '${j['source'] ?? 'self'}',
      corrected: j['corrected'] == true,
    );
  }
}

class LocationDay {
  const LocationDay({required this.location, this.checkIn, this.checkOut});
  final LocationRef location;
  final AttendanceMark? checkIn;
  final AttendanceMark? checkOut;
  factory LocationDay.fromJson(Map<String, dynamic> j) => LocationDay(
    location: LocationRef.fromJson(_map(j['location'])),
    checkIn: AttendanceMark.fromJson(j['checkIn']),
    checkOut: AttendanceMark.fromJson(j['checkOut']),
  );
}

/// Day status (server): selesai, hadir, belum_absen, tidak_hadir, libur, tanpa_jadwal.
enum DayStatus {
  selesai,
  hadir,
  belumAbsen,
  tidakHadir,
  libur,
  tanpaJadwal;

  static DayStatus fromCode(String? c) => switch (c) {
    'selesai' => selesai,
    'hadir' => hadir,
    'belum_absen' => belumAbsen,
    'tidak_hadir' => tidakHadir,
    'libur' => libur,
    _ => tanpaJadwal,
  };
}

class AttendanceDay {
  const AttendanceDay({
    required this.date,
    required this.weekday,
    required this.kind,
    this.holidayName,
    required this.status,
    this.checkInLocal,
    this.checkOutLocal,
    this.workMinutes,
    this.lateMinutes = 0,
    this.earlyLeaveMinutes = 0,
    this.onBehalf = false,
    this.onBehalfBy = const [],
    this.corrected = false,
    this.flags = const [],
    this.locations = const [],
  });
  final String date;
  final int weekday;
  final String kind; // workday | holiday | off | unscheduled
  final String? holidayName;
  final DayStatus status;
  final String? checkInLocal;
  final String? checkOutLocal;
  final int? workMinutes;
  final int lateMinutes;
  final int earlyLeaveMinutes;
  final bool onBehalf;
  final List<String> onBehalfBy;
  final bool corrected;
  final List<String> flags;
  final List<LocationDay> locations;

  int get dayOfMonth => int.tryParse(date.length >= 10 ? date.substring(8, 10) : '') ?? 0;

  factory AttendanceDay.fromJson(Map<String, dynamic> j) => AttendanceDay(
    date: '${j['date'] ?? ''}',
    weekday: _int(j['weekday'], 1),
    kind: '${j['kind'] ?? 'workday'}',
    holidayName: _strN(j['holidayName']),
    status: DayStatus.fromCode(_strN(j['status'])),
    checkInLocal: _strN(j['checkInLocal']),
    checkOutLocal: _strN(j['checkOutLocal']),
    workMinutes: _intN(j['workMinutes']),
    lateMinutes: _int(j['lateMinutes']),
    earlyLeaveMinutes: _int(j['earlyLeaveMinutes']),
    onBehalf: j['onBehalf'] == true,
    onBehalfBy: [for (final e in _list(j['onBehalfBy'])) '$e'],
    corrected: j['corrected'] == true,
    flags: [for (final e in _list(j['flags'])) '$e'],
    locations: [for (final l in _list(j['locations'])) LocationDay.fromJson(_map(l))],
  );
}

class AttendanceSummary {
  const AttendanceSummary({
    this.presentDays = 0,
    this.workingDays = 0,
    this.absentDays = 0,
    this.lateDays = 0,
    this.lateMinutes = 0,
    this.earlyLeaveDays = 0,
    this.earlyLeaveMinutes = 0,
    this.workMinutes = 0,
    this.holidayWorkDays = 0,
    this.offDayWorkDays = 0,
    this.incompleteDays = 0,
    this.onBehalfDays = 0,
    this.correctedDays = 0,
  });
  final int presentDays;
  final int workingDays;
  final int absentDays;
  final int lateDays;
  final int lateMinutes;
  final int earlyLeaveDays;
  final int earlyLeaveMinutes;
  final int workMinutes;
  final int holidayWorkDays;
  final int offDayWorkDays;
  final int incompleteDays;
  final int onBehalfDays;
  final int correctedDays;

  factory AttendanceSummary.fromJson(Map<String, dynamic> j) => AttendanceSummary(
    presentDays: _int(j['presentDays']),
    workingDays: _int(j['workingDays']),
    absentDays: _int(j['absentDays']),
    lateDays: _int(j['lateDays']),
    lateMinutes: _int(j['lateMinutes']),
    earlyLeaveDays: _int(j['earlyLeaveDays']),
    earlyLeaveMinutes: _int(j['earlyLeaveMinutes']),
    workMinutes: _int(j['workMinutes']),
    holidayWorkDays: _int(j['holidayWorkDays']),
    offDayWorkDays: _int(j['offDayWorkDays']),
    incompleteDays: _int(j['incompleteDays']),
    onBehalfDays: _int(j['onBehalfDays']),
    correctedDays: _int(j['correctedDays']),
  );
}

class AttendanceRecap {
  const AttendanceRecap({
    required this.employee,
    required this.month,
    required this.timezone,
    this.scheduleName,
    this.scheduleStart,
    this.scheduleEnd,
    this.toleranceMin = 0,
    required this.days,
    required this.summary,
  });
  final PersonRef employee;
  final String month; // YYYY-MM
  final String timezone;
  final String? scheduleName;
  final String? scheduleStart;
  final String? scheduleEnd;
  final int toleranceMin;
  final List<AttendanceDay> days;
  final AttendanceSummary summary;

  factory AttendanceRecap.fromJson(Map<String, dynamic> j) {
    final s = _map(j['schedule']);
    return AttendanceRecap(
      employee: PersonRef.fromJson(_map(j['employee'])),
      month: '${j['month'] ?? ''}',
      timezone: '${j['timezone'] ?? 'Asia/Makassar'}',
      scheduleName: _strN(s['name']),
      scheduleStart: _strN(s['start']),
      scheduleEnd: _strN(s['end']),
      toleranceMin: _int(s['toleranceMin']),
      days: [for (final d in _list(j['days'])) AttendanceDay.fromJson(_map(d))],
      summary: AttendanceSummary.fromJson(_map(j['summary'])),
    );
  }
}

enum MemberStatus {
  belumAbsen,
  hadir,
  selesai;

  static MemberStatus fromCode(String? c) => switch (c) {
    'hadir' => hadir,
    'selesai' => selesai,
    _ => belumAbsen,
  };
}

class TeamMember {
  const TeamMember({
    required this.employee,
    this.assigned = const [],
    required this.status,
    this.checkInLocal,
    this.checkOutLocal,
    this.lateMinutes = 0,
    this.onBehalf = false,
    this.corrected = false,
    this.locations = const [],
  });
  final PersonRef employee;
  final List<LocationRef> assigned;
  final MemberStatus status;
  final String? checkInLocal;
  final String? checkOutLocal;
  final int lateMinutes;
  final bool onBehalf;
  final bool corrected;
  final List<LocationDay> locations;

  factory TeamMember.fromJson(Map<String, dynamic> j) => TeamMember(
    employee: PersonRef.fromJson(_map(j['employee'])),
    assigned: [for (final a in _list(j['assigned'])) LocationRef.fromJson(_map(a))],
    status: MemberStatus.fromCode(_strN(j['status'])),
    checkInLocal: _strN(j['checkInLocal']),
    checkOutLocal: _strN(j['checkOutLocal']),
    lateMinutes: _int(j['lateMinutes']),
    onBehalf: j['onBehalf'] == true,
    corrected: j['corrected'] == true,
    locations: [for (final l in _list(j['locations'])) LocationDay.fromJson(_map(l))],
  );
}

class TeamToday {
  const TeamToday({
    required this.date,
    required this.timezone,
    this.holidayName,
    required this.scope,
    required this.total,
    required this.belumAbsen,
    required this.hadir,
    required this.selesai,
    required this.members,
  });
  final String date;
  final String timezone;
  final String? holidayName;
  final String scope; // all | team
  final int total;
  final int belumAbsen;
  final int hadir;
  final int selesai;
  final List<TeamMember> members;

  factory TeamToday.fromJson(Map<String, dynamic> j) {
    final c = _map(j['counts']);
    return TeamToday(
      date: '${j['date'] ?? ''}',
      timezone: '${j['timezone'] ?? 'Asia/Makassar'}',
      holidayName: _strN(j['holidayName']),
      scope: '${j['scope'] ?? 'team'}',
      total: _int(c['total']),
      belumAbsen: _int(c['belum_absen']),
      hadir: _int(c['hadir']),
      selesai: _int(c['selesai']),
      members: [for (final m in _list(j['members'])) TeamMember.fromJson(_map(m))],
    );
  }
}

/// `YYYY-MM` of [d].
String monthOf(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}';

/// `2026-09` + [delta] months.
String shiftMonth(String month, int delta) {
  final y = int.parse(month.substring(0, 4));
  final m = int.parse(month.substring(5, 7));
  final total = y * 12 + (m - 1) + delta;
  return monthOf(DateTime(total ~/ 12, total % 12 + 1));
}

/// Leading empty cells before day 1 in a Monday-first grid.
int leadingBlanks(String month) {
  final first = DateTime(int.parse(month.substring(0, 4)), int.parse(month.substring(5, 7)));
  return first.weekday - 1;
}

int daysInMonth(String month) {
  final y = int.parse(month.substring(0, 4));
  final m = int.parse(month.substring(5, 7));
  return DateTime(y, m + 1, 0).day;
}

/// `125` → `2 j 5 m`.
String hoursMinutes(int minutes) {
  final h = minutes ~/ 60;
  final m = minutes % 60;
  if (h == 0) return '$m m';
  return m == 0 ? '$h j' : '$h j $m m';
}

/// Correction time: [localDate] (YYYY-MM-DD) + `HH:mm` in the company zone ([offset]) → UTC ISO-8601.
String localToUtcIso(String localDate, int hour, int minute, Duration offset) {
  final y = int.parse(localDate.substring(0, 4));
  final mo = int.parse(localDate.substring(5, 7));
  final d = int.parse(localDate.substring(8, 10));
  final utc = DateTime.utc(y, mo, d, hour, minute).subtract(offset);
  return utc.toIso8601String();
}

/// UTC instant → `HH.mm` in the company zone ([zone], Indonesian zones have fixed offsets).
String localHm(String? iso, String? zone) {
  final t = iso == null ? null : DateTime.tryParse(iso);
  if (t == null) return '—';
  final l = t.toUtc().add(offsetForZone(zone));
  return '${l.hour.toString().padLeft(2, '0')}.${l.minute.toString().padLeft(2, '0')}';
}
