import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/domain/dashboard.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';

import '../support/d1310_w3_fixtures.dart';
import '../support/widget_harness.dart';

/// DRMS 13/10 Wave 3 — "Dashboard di APK belum ada: SLA transfer, Pinjaman antar project, Project ber-RAB tanpa RAP,
/// Tren pengajuan, Saldo per akun, Kelengkapan nota/LPJ. Samakan dengan web.": every role home shows the web cards of
/// its layout, full Rupiah on cards (#10), and Staff sees no money at all.
AuthSignedIn signedIn(Set<Role> roles) => AuthSignedIn(profile: profile(roles), sub: 's');

final _compact = RegExp(r'Rp [\d,]+ (jt|rb|M)\b');
final _money = RegExp(r'Rp\s?\d');

Future<void> pumpKpis(WidgetTester tester, Widget kpis, Set<Role> roles, List<Override> overrides) => pumpScreen(
  tester,
  Scaffold(body: SingleChildScrollView(child: kpis)),
  auth: signedIn(roles),
  overrides: overrides,
);

void main() {
  testWidgets('Direktur: SLA, RAP monitoring, loans, RAB without RAP, trend, accounts, completeness — full Rupiah', (
    tester,
  ) async {
    await pumpKpis(
      tester,
      const DirekturKpis(),
      {Role.owner},
      [direkturDashboardProvider.overrideWith((ref) async => DirekturDashboard.fromJson(ownerW3Json()))],
    );
    for (final k in [
      'dash-pipeline',
      'dash-categories',
      'dash-sla',
      'dash-rap-monitor',
      'dash-loans',
      'dash-rap-missing',
      'dash-trend',
      'dash-accounts',
      'dash-completeness',
      'dash-recent-cash',
      'dash-cost-centers',
    ]) {
      expect(find.byKey(Key(k)), findsOneWidget, reason: k);
    }
    // web order: SLA → Monitoring RAP → Pinjaman → RAB tanpa RAP → Tren → Saldo per akun → Kelengkapan
    final ys = [
      for (final k in ['dash-sla', 'dash-rap-monitor', 'dash-loans', 'dash-rap-missing', 'dash-trend', 'dash-accounts'])
        tester.getTopLeft(find.byKey(Key(k))).dy,
    ];
    expect([...ys]..sort(), ys);

    expect(find.text('Rp 152.500.000'), findsOneWidget, reason: 'cash KPI: full Rupiah');
    expect(tester.widget<Text>(find.byKey(const Key('dash-sla-pct'))).data, '87,5%');
    expect(find.text('Disetujui → ditransfer, bulan ini · target 24 jam'), findsOneWidget);
    expect(find.text('Rata-rata 1 hr 6 jam · terlambat 1'), findsOneWidget);
    expect(find.text('Sisa Rp 22.500.000 · 1 terlambat · 1 menunggu persetujuan'), findsOneWidget);
    expect(find.text('1 pinjaman menunggu keputusan Anda'), findsOneWidget);
    expect(find.text('Project ber-RAB belum punya RAP'), findsOneWidget);
    expect(find.text('Trading · RAB Rp 9.000.000'), findsOneWidget);
    expect(find.text('2 item melebihi RAP'), findsOneWidget);
    expect(find.text('Rp 150.000.000'), findsOneWidget, reason: 'account balance');
    expect(find.text('3 / 5'), findsOneWidget);
    expect(find.text('1 LPJ terlambat'), findsOneWidget);
    expect(find.text('4 nota reimburse menunggu verifikasi'), findsOneWidget);
    expect(find.text('2 · Rp 5.000.000'), findsOneWidget, reason: 'pipeline: count · Σ grand total');
    expect(find.textContaining(_compact), findsNothing, reason: 'DRMS 13/10 #10: no compact amounts on cards');

    final readout = find.byKey(const Key('trend-readout'));
    expect(tester.widget<Text>(readout).data, 'September 2026: 6 pengajuan · Rp 18.750.000');
    await tester.ensureVisible(find.byKey(const Key('trend-chart')));
    final chart = tester.getRect(find.byKey(const Key('trend-chart')));
    await tester.tapAt(Offset(chart.left + 10, chart.center.dy));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(readout).data, 'Agustus 2026: 4 pengajuan · Rp 10.000.000');
  });

  testWidgets('Finance: SLA + loans, accounts, advances without LPJ, closing — no RAP cards', (tester) async {
    await pumpKpis(
      tester,
      const FinanceKpis(),
      {Role.finance},
      [financeDashboardProvider.overrideWith((ref) async => FinanceDashboard.fromJson(financeW3Json()))],
    );
    for (final k in [
      'dash-accounts',
      'dash-pipeline',
      'dash-advances',
      'dash-sla',
      'dash-loans',
      'dash-period-close',
    ]) {
      expect(find.byKey(Key(k)), findsOneWidget, reason: k);
    }
    expect(find.byKey(const Key('dash-rap-missing')), findsNothing);
    expect(find.byKey(const Key('dash-rap-monitor')), findsNothing);
    expect(find.byKey(const Key('dash-loans-waiting')), findsNothing, reason: 'Finance decides no loans');
    expect(find.text('Bulan ini masuk Rp 12.000.000 · keluar Rp 9.500.000'), findsOneWidget);
    expect(find.text('20 hr terlambat'), findsOneWidget);
    expect(find.text('Bulan terakhir ditutup: 2026-07'), findsOneWidget);
    expect(find.text('Rp 98.000.000'), findsWidgets);
    expect(find.textContaining(_compact), findsNothing);
  });

  testWidgets('PM: team RAP nudge, trend, loans, cost centers — no SLA', (tester) async {
    await pumpKpis(
      tester,
      const PmTeamKpis(),
      {Role.pm},
      [pmDashboardProvider.overrideWith((ref) async => PmDashboard.fromJson(pmW3Json()))],
    );
    for (final k in ['dash-rap-missing', 'dash-pipeline', 'dash-trend', 'dash-categories', 'dash-loans']) {
      expect(find.byKey(Key(k)), findsOneWidget, reason: k);
    }
    expect(find.text('Project Anda belum punya RAP'), findsOneWidget);
    expect(find.byKey(const Key('dash-sla')), findsNothing);
    expect(find.byKey(const Key('dash-rap-monitor')), findsNothing);
    expect(find.text('Pusat biaya saya bulan ini'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('trend-readout'))).data, contains('Rp 18.750.000'));
  });

  testWidgets('Staff home: own request counts from /dashboard/me, never a Rupiah amount', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      auth: signedIn({Role.staff}),
      overrides: [staffDashboardProvider.overrideWith((ref) async => StaffDashboard.fromJson(staffW3Json()))],
    );
    expect(find.text('Pengajuan saya'), findsOneWidget, reason: 'section title');
    expect(find.byKey(const Key('kpi-staff')), findsOneWidget);
    expect(find.byKey(const Key('kpi-my-actions')), findsOneWidget);
    expect(find.text('Sedang diproses'), findsOneWidget);
    expect(find.text('menunggu persetujuan 3'), findsOneWidget);
    expect(find.text('1 ditolak/dibatalkan'), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const Key('trend-readout')), 300);
    expect(tester.widget<Text>(find.byKey(const Key('trend-readout'))).data, 'September 2026: 6 pengajuan');
    expect(find.textContaining(_money), findsNothing, reason: 'Staff never sees money');
    for (final k in ['dash-sla', 'dash-loans', 'dash-rap-missing', 'dash-accounts']) {
      expect(find.byKey(Key(k), skipOffstage: false), findsNothing, reason: k);
    }
  });

  testWidgets('Admin home: master-data gaps from /dashboard/admin', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      auth: signedIn({Role.admin}),
      overrides: [adminDashboardProvider.overrideWith((ref) async => AdminDashboard.fromJson(adminW3Json()))],
    );
    await tester.scrollUntilVisible(find.byKey(const Key('kpi-admin')), 300);
    expect(find.byKey(const Key('kpi-admin')), findsOneWidget);
    expect(find.text('Perlu dilengkapi'), findsNWidgets(2));
    expect(find.text('Lengkap'), findsOneWidget);
    expect(find.byKey(const Key('kpi-staff')), findsNothing);
  });
}
