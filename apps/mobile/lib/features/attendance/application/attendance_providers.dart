import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../companies/application/company_selection.dart';
import '../domain/attendance_recap.dart';

/// MC3: PT of the own recap (one employee per PT); null = the server default (first selected PT with an
/// employee). Chosen in the recap when the user has an employee in several selected PTs.
final ownRecapCompanyProvider = NotifierProvider<OwnRecapCompany, int?>(OwnRecapCompany.new);

class OwnRecapCompany extends Notifier<int?> {
  @override
  int? build() {
    // A new PT selection starts again from the server default.
    ref.watch(companySelectionProvider);
    return null;
  }

  void set(int? companyId) => state = companyId;
}

/// Monthly recap: own (`employeeId` null → GET /attendance/me[?company=]) or of a team member
/// (/attendance/recap).
final attendanceRecapProvider = FutureProvider.autoDispose.family<AttendanceRecap, (int?, String?)>((ref, key) {
  final (employeeId, month) = key;
  final api = ref.watch(attendanceApiProvider);
  if (employeeId != null) return api.recap(employeeId, month: month);
  return api.me(month: month, company: ref.watch(ownRecapCompanyProvider));
});

/// US-13 team presence (today by default).
final teamTodayProvider = FutureProvider.autoDispose.family<TeamToday, String?>(
  (ref, date) => ref.watch(attendanceApiProvider).teamToday(date: date),
);
