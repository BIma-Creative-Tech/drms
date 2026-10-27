import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/logging/log.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../companies/application/company_selection.dart';
import '../data/menu_api.dart';
import '../domain/web_modules.dart';

final menuApiProvider = Provider((ref) => MenuApi(ref.watch(apiClientProvider)));

/// Beranda menu = the web launcher (user 2026-10-18). Online: `/me/modules`, stored per user + PT selection in the
/// encrypted local DB; offline: the stored copy, else [fallbackMenu] from the cached `/me`.
final menuProvider = FutureProvider.autoDispose<List<WebModule>>((ref) async {
  final profile = ref.watch(currentProfileProvider);
  if (profile == null) return const [];
  final sub = ref.watch(currentSubProvider) ?? '';
  final key = 'menu.modules.$sub.${ref.watch(companyHeaderProvider) ?? 'all'}';
  final db = ref.watch(databaseProvider);
  try {
    final raw = await ref.watch(menuApiProvider).raw();
    final modules = parseMenu(raw);
    await db.kvPut(key, jsonEncode(raw));
    return modules;
  } on Object catch (e) {
    Log.w('menu: /me/modules failed, using the stored copy', e);
    try {
      final cached = await db.kvGetJson(key);
      if (cached != null) return parseMenu(cached);
    } on Object catch (e) {
      Log.w('menu: stored copy unreadable', e);
    }
    return fallbackMenu(profile);
  }
});

/// First start without signal (no stored copy yet): the modules the APK already has, with the web labels and the same
/// role rules as `apps/web/src/admin/modules/registry.ts`. Replaced by the server menu on the next refresh.
List<WebModule> fallbackMenu(UserProfile p) {
  if (p.roles.isEmpty) return const [];
  final office = p.has(Role.owner) || p.has(Role.finance);
  final officePm = office || p.has(Role.pm);
  WebMenuItem item(String href, String label) => WebMenuItem(href: href, label: label);
  WebModule mod(String id, String label, List<WebMenuItem> items) => WebModule(
    id: id,
    label: label,
    sections: [WebMenuSection(items: items)],
  );
  return [
    mod('dashboard', 'Dashboard', [item('/dashboard', 'Dashboard')]),
    if (officePm)
      mod('persetujuan', 'Persetujuan', [
        item('/persetujuan', 'Persetujuan'),
        if (office) ...[item('/antrian-transfer', 'Antrian Transfer'), item('/verifikasi-lpj', 'Verifikasi LPJ')],
      ]),
    if (p.canSeeProjects)
      mod('proyek', 'Proyek', [
        item('/collections/projects', 'Project'),
        if (officePm) ...[
          item('/progress', 'Progress project'),
          item('/progress/laporan', 'Laporan progress'),
          item('/addendum', 'Addendum RAB'),
        ],
        if (p.hasFieldReports) item('/laporan-servis', 'Laporan servis'),
      ]),
    if (!p.isAttendanceOnly)
      mod('keuangan', 'Keuangan', [
        item('/collections/expense-requests', 'Pengajuan biaya'),
        if (p.canCreateRequests || p.has(Role.finance))
          item('/collections/expense-requests/create', '+ Buat pengajuan'),
      ]),
    mod('absensi', 'Absensi', [
      item('/absensi/absen', 'Absen'),
      if (p.canSeeTeamAttendance) item('/absensi', 'Tim hari ini'),
      if (p.has(Role.adminStaff)) item('/absensi/absenkan', 'Absenkan karyawan'),
      item(
        '/absensi/rekap',
        p.roles.every((r) => r == Role.staff || r == Role.operator) ? 'Rekap absensi saya' : 'Rekap bulanan',
      ),
    ]),
  ];
}
