/// Where a web menu item opens in the APK (user 2026-10-18: menus 1:1 with the web, every item native). [route] is a
/// go_router location; [pickRequestType] = the web "+ Buat pengajuan" (the web form asks Kasbon / Reimburse inside,
/// the APK asks first). Items without a target are listed as "Segera hadir di APK" until their phase ships.
class ApkTarget {
  const ApkTarget(this.route) : pickRequestType = false;
  const ApkTarget.pickRequestType() : route = null, pickRequestType = true;
  final String? route;
  final bool pickRequestType;
}

/// Bottom-bar branches (app/router.dart): opened with `go` (switch tab), every other route is pushed.
const shellRoutes = {'/home', '/dashboard', '/requests', '/inbox', '/profile'};

/// Web href (relative to /admin, `apps/web/src/admin/modules/registry.ts`) → APK screen.
const Map<String, String> webToApk = {
  '/dashboard': '/dashboard',
  // Persetujuan
  '/persetujuan': '/inbox',
  '/antrian-transfer': '/finance',
  '/verifikasi-lpj': '/finance?tab=lpj',
  // Proyek
  '/collections/projects': '/projects',
  // phase 5a (user 2026-10-19): the Proyek collections — generic web list / edit form
  '/collections/budget-lines': '/data/budget-lines',
  '/collections/rap-items': '/data/rap-items',
  '/collections/rap-templates': '/data/rap-templates',
  '/collections/project-stages': '/data/project-stages',
  '/collections/stage-templates': '/data/stage-templates',
  '/collections/clients': '/data/clients',
  '/collections/cost-centers': '/data/cost-centers',
  '/collections/team-assignments': '/data/team-assignments',
  '/collections/progress-reports': '/data/progress-reports',
  '/collections/budget-addenda': '/data/budget-addenda',
  '/collections/service-reports': '/data/service-reports',
  '/collections/unit-timesheets': '/data/unit-timesheets',
  '/collections/aftersales-activities': '/data/aftersales-activities',
  '/collections/contract-units': '/data/contract-units',
  '/collections/daily-reports': '/data/daily-reports',
  '/collections/daily-report-lines': '/data/daily-report-lines',
  '/collections/resource-types': '/data/resource-types',
  '/collections/service-types': '/data/service-types',
  '/klien/baru': '/clients/new',
  // phase 5b: RAP proyek (index = the project list; one project → its RAP), Rekap aftersales (the report)
  '/rap': '/projects',
  '/aftersales': '/reports/rekap-aftersales',
  '/unit-kontrak': '/contracts',
  '/progress': '/progress?tab=projects',
  '/progress/laporan': '/progress',
  '/addendum': '/addenda',
  '/laporan-servis': '/field',
  '/aftersales/aktivitas': '/field',
  '/laporan-harian': '/field',
  // Keuangan (phase 3, user 2026-10-19: Buku kas, Tutup buku, pinjaman, the "Data …" lists)
  '/collections/expense-requests': '/requests',
  '/collections/expense-line-snapshots': '/data/expense-line-snapshots',
  '/collections/receipts': '/data/receipts',
  '/collections/receipt-flags': '/data/receipt-flags',
  '/kas': '/cash',
  '/collections/cash-entries': '/data/cash-entries',
  '/collections/cash-accounts': '/data/cash-accounts',
  '/collections/cash-in-sources': '/data/cash-in-sources',
  '/collections/transfers': '/data/transfers',
  '/collections/settlements': '/data/settlements',
  '/pinjaman': '/loans',
  '/pinjaman-antar-pt': '/intercompany-loans',
  '/collections/project-loans': '/loans',
  '/collections/project-loan-repayments': '/data/project-loan-repayments',
  '/tutup-buku': '/closings',
  '/collections/period-closings': '/data/period-closings',
  // Laporan (phase 4, user 2026-10-19)
  '/laporan': '/reports',
  // Absensi
  '/absensi/absen': '/attendance',
  '/absensi': '/attendance?tab=team',
  '/absensi/rekap': '/attendance?tab=recap',
  // phase 6 (user 2026-10-19): Jadwal & hari libur, the attendance collections
  '/absensi/jadwal': '/attendance-schedule',
  '/collections/attendances': '/data/attendances',
  '/collections/attendance-corrections': '/data/attendance-corrections',
  '/collections/work-schedules': '/data/work-schedules',
  '/collections/holidays': '/data/holidays',
  // Pengguna & Akses / Sistem (personal)
  '/collections/users': '/profile',
  // phase 6: Akses PT (matriks), Pengguna baru, the access / employee / device collections
  '/akses-pt': '/access-matrix',
  '/pengguna/baru': '/users/new',
  '/collections/company-memberships': '/data/company-memberships',
  '/collections/employees': '/data/employees',
  '/collections/employee-bank-accounts': '/data/employee-bank-accounts',
  '/collections/devices': '/data/devices',
  '/collections/web-sessions': '/data/web-sessions',
  '/notifikasi': '/notifications',
  // Avatar menu (user 2026-10-19, phase 2)
  '/keamanan-akun': '/security',
  '/collections/notifications': '/notifications',
  // phase 7 (user 2026-10-19): Master Data, Media, Pengaturan, Sistem
  '/vendor/baru': '/vendors/new',
  '/globals/company-settings': '/settings/app',
  '/audit-log': '/reports/audit-log',
  '/collections/banks': '/data/banks',
  '/collections/uoms': '/data/uoms',
  '/collections/expense-categories': '/data/expense-categories',
  '/collections/urgency-levels': '/data/urgency-levels',
  '/collections/vehicles': '/data/vehicles',
  '/collections/vendors': '/data/vendors',
  '/collections/vendor-bank-accounts': '/data/vendor-bank-accounts',
  '/collections/sites': '/data/sites',
  '/collections/media-receipts': '/data/media-receipts',
  '/collections/media-transfer-proofs': '/data/media-transfer-proofs',
  '/collections/media-selfies': '/data/media-selfies',
  '/collections/media-progress-photos': '/data/media-progress-photos',
  '/collections/media-signatures': '/data/media-signatures',
  '/collections/media-company': '/data/media-company',
  '/collections/media-attachments': '/data/media-attachments',
  '/collections/companies': '/data/companies',
  '/collections/approval-rules': '/data/approval-rules',
  '/collections/notification-templates': '/data/notification-templates',
  '/collections/document-sequences': '/data/document-sequences',
  '/collections/audit-logs': '/data/audit-logs',
};

ApkTarget? apkTargetFor(String href) {
  if (href == '/collections/expense-requests/create') return const ApkTarget.pickRequestType();
  final r = webToApk[href];
  return r == null ? null : ApkTarget(r);
}

/// `go` for a bottom-bar branch, `push` for the rest (back returns to the menu).
bool isShellRoute(String route) => shellRoutes.contains(Uri.parse(route).path);
