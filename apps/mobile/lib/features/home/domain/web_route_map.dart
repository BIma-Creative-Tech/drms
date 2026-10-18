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
  '/progress': '/progress?tab=projects',
  '/progress/laporan': '/progress',
  '/addendum': '/addenda',
  '/laporan-servis': '/field',
  '/aftersales/aktivitas': '/field',
  '/laporan-harian': '/field',
  // Keuangan
  '/collections/expense-requests': '/requests',
  // Absensi
  '/absensi/absen': '/attendance',
  '/absensi': '/attendance?tab=team',
  '/absensi/rekap': '/attendance?tab=recap',
  // Pengguna & Akses / Sistem (personal)
  '/collections/users': '/profile',
  '/notifikasi': '/notifications',
  // Avatar menu (user 2026-10-19, phase 2)
  '/keamanan-akun': '/security',
  '/collections/notifications': '/notifications',
};

ApkTarget? apkTargetFor(String href) {
  if (href == '/collections/expense-requests/create') return const ApkTarget.pickRequestType();
  final r = webToApk[href];
  return r == null ? null : ApkTarget(r);
}

/// `go` for a bottom-bar branch, `push` for the rest (back returns to the menu).
bool isShellRoute(String route) => shellRoutes.contains(Uri.parse(route).path);
