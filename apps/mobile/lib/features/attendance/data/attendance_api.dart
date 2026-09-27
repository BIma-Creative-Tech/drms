import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/attendance_recap.dart';

/// E6 online endpoints (openapi /attendance/*). Check-in/out and on-behalf go through the sync queue.
class AttendanceApi {
  AttendanceApi(this.client);
  final ApiClient client;

  /// US-09 own monthly recap.
  Future<AttendanceRecap> me({String? month}) => client.run(
    (d) => d.get<dynamic>('/attendance/me', queryParameters: {'month': ?month}),
    (data) => AttendanceRecap.fromJson(data as Map<String, dynamic>),
  );

  /// Monthly recap of one employee (PM team, Admin/Direktur/Finance all).
  Future<AttendanceRecap> recap(int employeeId, {String? month}) => client.run(
    (d) => d.get<dynamic>('/attendance/recap', queryParameters: {'employee_id': '$employeeId', 'month': ?month}),
    (data) => AttendanceRecap.fromJson(data as Map<String, dynamic>),
  );

  /// US-13 team presence for a date (default today, company TZ).
  Future<TeamToday> teamToday({String? date}) => client.run(
    (d) => d.get<dynamic>('/attendance/team-today', queryParameters: {'date': ?date}),
    (data) => TeamToday.fromJson(data as Map<String, dynamic>),
  );

  /// US-15 (T10) correction: same local date, reason 3–500 characters. Online only.
  Future<void> correct(
    int attendanceId, {
    required String newTimeUtc,
    required String reason,
    required String idempotencyKey,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/attendance/$attendanceId/correct',
      data: {'new_time': newTimeUtc, 'reason': reason.trim()},
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
    ),
    (_) {},
  );

  /// Selfie of a visible attendance (viewing another person's is audited on the server).
  Future<Uint8List> selfie(int attendanceId) => client.run(
    (d) => d.get<dynamic>('/attendance/$attendanceId/selfie', options: Options(responseType: ResponseType.bytes)),
    (data) => Uint8List.fromList(data as List<int>),
  );
}
