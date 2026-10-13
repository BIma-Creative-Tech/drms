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
/// its layout, full Rupiah on cards (#10). Staff (owner 2026-10-13): the amounts of its OWN requests like the web Staff
/// home, and no other money (no project budgets, no cash, no other people's requests).
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

  testWidgets('Staff home: own requests with their amounts in full Rupiah — no project / cash money', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      auth: signedIn({Role.staff}),
      overrides: [staffDashboardProvider.overrideWith((ref) async => StaffDashboard.fromJson(staffW3Json()))],
    );
    // every Rupiah figure on the Staff home is one of the caller's own request amounts (/dashboard/me)
    const own = {
      'Rp 18.750.000', // September Σ (KPI + trend)
      'Rp 10.000.000', // August Σ (trend)
      'Rp 5.000.000', 'Rp 2.250.000', 'Rp 1.000.000', 'Rp 4.500.000', 'Rp 21.000.000', 'Rp 800.000', // stages
      'Rp 1.447.500', // own draft (latest)
    };
    final amount = RegExp(r'Rp\s?[\d.]+');
    void onlyOwnMoney(String where) {
      for (final t in tester.widgetList<Text>(find.textContaining(_money, skipOffstage: false))) {
        for (final m in amount.allMatches(t.data ?? '')) {
          expect(own, contains(m.group(0)), reason: '$where: "${t.data}" is not an own request amount');
        }
      }
      expect(find.textContaining(_compact, skipOffstage: false), findsNothing, reason: 'DRMS 13/10 #10: full Rupiah');
      for (final k in [
        'dash-sla',
        'dash-loans',
        'dash-rap-missing',
        'dash-rap-monitor',
        'dash-accounts',
        'dash-recent-cash',
        'dash-categories',
        'dash-cost-centers',
        'dash-completeness',
        'kpi-by-company',
      ]) {
        expect(find.byKey(Key(k), skipOffstage: false), findsNothing, reason: '$where: $k');
      }
    }

    expect(find.text('Pengajuan saya'), findsOneWidget, reason: 'section title');
    expect(find.byKey(const Key('kpi-staff')), findsOneWidget);
    expect(find.byKey(const Key('kpi-my-actions')), findsOneWidget);
    expect(find.text('Sedang diproses'), findsOneWidget);
    expect(find.text('menunggu persetujuan 3'), findsOneWidget);
    expect(find.text('1 ditolak/dibatalkan'), findsOneWidget);
    // KPI "Pengajuan Sep": count + Σ of the own requests this month (web: count, then the Rupiah line)
    expect(tester.widget<Text>(find.byKey(const Key('kpi-my-month-sum'))).data, 'Rp 18.750.000');
    onlyOwnMoney('KPIs');

    await tester.scrollUntilVisible(find.byKey(const Key('dash-pipeline')), 300);
    expect(find.text('2 · Rp 5.000.000'), findsOneWidget, reason: 'stage: count · Σ grand total of own requests');
    onlyOwnMoney('pipeline');

    await tester.scrollUntilVisible(find.byKey(const Key('dash-my-request-2')), 300);
    expect(find.text('Pengajuan terbaru saya'), findsOneWidget);
    expect(find.text('Draft "Semen"'), findsOneWidget);
    expect(find.text('PB/DRMS/2609/0007'), findsOneWidget);
    expect(find.text('Besi beton · Ditransfer'), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('dash-my-request-2')), matching: find.text('Rp 2.250.000')),
      findsOneWidget,
    );
    onlyOwnMoney('latest');

    await tester.scrollUntilVisible(find.byKey(const Key('trend-readout')), 300);
    expect(
      tester.widget<Text>(find.byKey(const Key('trend-readout'))).data,
      'September 2026: 6 pengajuan · Rp 18.750.000',
    );
    onlyOwnMoney('trend');
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
