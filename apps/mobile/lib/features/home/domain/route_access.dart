import '../../auth/domain/user_profile.dart';

/// Web collections the field reports live in (`fieldReportRead`: Admin, Direktur, Finance, PM of the team, Staff of the
/// assigned projects or the reporter).
const _fieldReportCollections = {'daily-reports', 'service-reports', 'unit-timesheets', 'aftersales-activities'};

/// Web collections read by the office only (Finance, Direktur, Admin — `cash-entries`, `period-closings`, the web
/// "Buku kas" / "Tutup buku" data).
const _officeCollections = {'cash-entries', 'period-closings', 'cash-in-sources'};

/// D2510: may [p] open the APK [route] a link points at (a report row, a notification, a dashboard row)? The same role
/// rules as the target screens and their web pages (`apps/web/src/admin/modules/registry.ts`, the collection read
/// access); a row whose target the user cannot read is not linked. Unknown routes are allowed — the server still
/// re-checks every read ("Tidak ada akses").
bool canOpenApkRoute(String route, UserProfile? p) {
  if (p == null) return false;
  final path = Uri.parse(route).path;
  final office = p.has(Role.owner) || p.has(Role.finance);
  final officeAdmin = office || p.has(Role.admin);
  final fieldReader = officeAdmin || p.has(Role.pm) || p.has(Role.staff);
  if (path.startsWith('/finance')) return office;
  if (path.startsWith('/cash') || path.startsWith('/closings')) return office;
  if (path.startsWith('/progress')) return p.canReadProgress;
  if (path.startsWith('/projects')) return p.canSeeProjects;
  if (path.startsWith('/loans')) return officeAdmin || p.has(Role.pm);
  if (path.startsWith('/attendance/recap/')) return p.canSeeTeamAttendance;
  if (path.startsWith('/contracts')) return fieldReader;
  if (path.startsWith('/field')) return p.hasFieldReports;
  final data = RegExp(r'^/data/([a-z0-9-]+)').firstMatch(path);
  if (data != null) {
    final slug = data.group(1)!;
    if (_fieldReportCollections.contains(slug) || slug == 'contract-units') return fieldReader;
    if (_officeCollections.contains(slug)) return officeAdmin;
  }
  return true;
}
