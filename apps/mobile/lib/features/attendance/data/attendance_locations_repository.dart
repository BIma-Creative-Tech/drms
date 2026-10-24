import 'dart:convert';

import '../../../core/db/app_database.dart';
import '../../../core/network/api_exception.dart';
import '../domain/attendance.dart';
import 'attendance_api.dart';

/// DRMS 13/10 A2: the user's eligible check-in locations (`GET /attendance/locations`) and the attendance type per
/// PT, as last received from the server.
class EligibleLocations {
  const EligibleLocations({this.types = const {}, this.sites = const []});

  /// Attendance type of the user's employee per PT id.
  final Map<int, AttendanceType> types;

  /// Registered locations (projects, then cost centers — server order). ADR 0032: no site and no "Di luar area"
  /// entry any more (an old cache's `referenceSite` is ignored).
  final List<ProjectSite> sites;

  factory EligibleLocations.fromJson(Map<String, dynamic> j) {
    final employees = (j['employees'] as List<dynamic>? ?? const []).whereType<Map<String, dynamic>>().toList();
    final types = {
      for (final e in employees)
        if (e['company'] is num) (e['company'] as num).toInt(): AttendanceType.fromCode(e['attendanceType'] as String?),
    };
    return EligibleLocations(
      types: types,
      sites: [
        for (final i in (j['items'] as List<dynamic>? ?? const []).whereType<Map<String, dynamic>>())
          // ADR 0032: a site item of an old cache is no longer a location
          if (i['kind'] != 'site') ProjectSite.fromEligible(i, type: types[(i['company'] as num?)?.toInt()]),
      ],
    );
  }

  /// Only the PTs in [companyIds] (switcher scope); null = all.
  EligibleLocations scoped(Iterable<int>? companyIds) {
    if (companyIds == null) return this;
    final keep = companyIds.toSet();
    return EligibleLocations(
      types: {
        for (final e in types.entries)
          if (keep.contains(e.key)) e.key: e.value,
      },
      sites: [
        for (final s in sites)
          if (s.companyId == null || keep.contains(s.companyId)) s,
      ],
    );
  }
}

/// Cache of [EligibleLocations] per user in the encrypted DB (`attendance-locations:<sub>`), refreshed together with
/// the masters: the APK recognises the area offline and queues the check-in; the server re-validates it at sync.
/// A server before A2 answers 404 → nothing is cached and the picker keeps the assignment-based masters list.
class AttendanceLocationsRepository {
  AttendanceLocationsRepository(this.api, this.db);
  final AttendanceApi api;
  final AppDatabase db;

  static String key(String sub) => 'attendance-locations:$sub';

  /// Fetches and caches the list. False when offline or the server does not know the endpoint (the cache is kept).
  Future<bool> refresh(String sub) async {
    try {
      final data = await api.locations();
      await db.kvPut(key(sub), jsonEncode(data));
      return true;
    } on NetworkException {
      return false;
    } on ProblemException catch (e) {
      if (e.status == 404) return false;
      rethrow;
    }
  }

  /// The cached list of [sub]; null = never received (offline since install, or a server before A2).
  Future<EligibleLocations?> cached(String sub) => readCached(db, sub);

  /// Same, without the API client (cache readers: providers, tests).
  static Future<EligibleLocations?> readCached(AppDatabase db, String sub) async {
    final j = await db.kvGetJson(key(sub));
    return j == null ? null : EligibleLocations.fromJson(j);
  }
}
