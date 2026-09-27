import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../domain/attendance_recap.dart';

/// Monthly recap: own (`employeeId` null → GET /attendance/me) or of a team member (/attendance/recap).
final attendanceRecapProvider = FutureProvider.autoDispose.family<AttendanceRecap, (int?, String?)>((ref, key) {
  final (employeeId, month) = key;
  final api = ref.watch(attendanceApiProvider);
  return employeeId == null ? api.me(month: month) : api.recap(employeeId, month: month);
});

/// US-13 team presence (today by default).
final teamTodayProvider = FutureProvider.autoDispose.family<TeamToday, String?>(
  (ref, date) => ref.watch(attendanceApiProvider).teamToday(date: date),
);
