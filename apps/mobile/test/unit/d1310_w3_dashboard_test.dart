import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/dashboard/domain/dashboard.dart';

import '../support/d1310_w3_fixtures.dart';
import '../support/fixtures.dart';

/// DRMS 13/10 Wave 3: the APK parses every block the web dashboard shows (same `/api/v1/dashboard/*` JSON).
void main() {
  group('Direktur (/dashboard/owner)', () {
    final d = DirekturDashboard.fromJson(ownerW3Json());

    test('SLA transfer, loans, RAP monitoring, projects without RAP', () {
      expect(d.sla!.text, '87,5%');
      expect(d.sla!.pctWithin, 87.5);
      expect(d.sla!.avgText, '1 hr 6 jam');
      expect(d.sla!.late, 1);
      expect(d.sla!.slaHours, [24]);

      expect(d.loans!.outstanding, 22500000);
      expect(d.loans!.overdueCount, 1);
      expect(d.loans!.pending, 1);
      expect(d.loans!.waitingForMe, 1);
      expect(d.loans!.projects.map((p) => (p.code, p.outstandingBorrowed, p.outstandingLent)), [
        ('PRJ-01', 15000000, 0),
        ('PRJ-02', 0, 15000000),
      ]);

      expect(d.rapMonitor!.overProjects, 1);
      expect(d.rapMonitor!.rows.single.percent, 105);
      expect(d.rapMonitor!.rows.single.overBudgetItems, 2);

      expect(d.rapMissing!.team, isFalse);
      expect(d.rapMissing!.total, 2);
      expect(d.rapMissing!.rows.map((r) => (r.kindLabel, r.budget)), [('Trading', 9000000), ('Konstruksi', null)]);
    });

    test('trend, accounts (highest first), completeness, pipeline, categories, recent cash, cost centers', () {
      expect(d.requestTrend.map((p) => (p.period, p.count, p.sum)), [
        ('2026-08', 4, 10000000),
        ('2026-09', 6, 18750000),
      ]);
      expect(d.accounts.map((a) => a.name), ['Bank Operasional', 'Kas Kecil']);
      expect(d.accounts.first.code, isNull, reason: 'one PT: no [PT] prefix');
      expect(d.completeness.ratioDone, 3);
      expect(d.completeness.ratioTotal, 5);
      expect(d.completeness.reimburseToVerify, 4);
      expect(d.pipeline.rows.map((s) => s.key), ['ack', 'approval', 'queue', 'lpj', 'done', 'exit']);
      expect(d.pipeline.count('lpj'), 3);
      expect(d.categories.items.last.other, isTrue);
      expect(d.recentCash.single.label, 'PB/DRMS/2609/0009');
      expect(d.recentCash.single.incoming, isFalse);
      expect(d.costCenters.map((c) => c.code), ['CC-1'], reason: 'zero rows are hidden like the web');
    });

    test('an older server without the new blocks: nulls / empties, no crash', () {
      final old = DirekturDashboard.fromJson(direkturDashboardJson());
      expect(old.sla, isNull);
      expect(old.loans, isNull);
      expect(old.rapMissing, isNull);
      expect(old.rapMonitor, isNull);
      expect(old.pipeline.rows, isEmpty);
      expect(old.accounts, isEmpty);
    });

    test('several PTs: accounts carry the PT short code', () {
      final j = ownerW3Json();
      j['companies'] = twoCompaniesJson;
      final two = DirekturDashboard.fromJson(j);
      expect(two.accounts.map((a) => a.code), ['DRMS', 'DRMS']);
    });
  });

  test('Finance: SLA + loans, accounts with month in/out, advances without LPJ, closing; no RAP blocks', () {
    final f = FinanceDashboard.fromJson(financeW3Json());
    expect(f.sla!.count, 8);
    expect(f.loans!.waitingForMe, 0);
    expect(f.accounts.single.monthIn, 12000000);
    expect(f.advancesWithoutLpj.map((a) => (a.docNo, a.overdue, a.ageDays)), [
      ('PB/DRMS/2609/0001', true, 20),
      ('PB/DRMS/2609/0002', false, 3),
    ]);
    expect(f.lpjDueDays, 14);
    expect(f.lastClosedPeriod, '2026-07');
    expect(f.nextClosable, '2026-08');
  });

  test('PM: team RAP nudge, loans, trend with sums, cost centers', () {
    final p = PmDashboard.fromJson(pmW3Json());
    expect(p.rapMissing!.team, isTrue);
    expect(p.loans!.projects, hasLength(2));
    expect(p.trend.last.sum, 18750000);
    expect(p.requestTrend.last.value, 6, reason: 'the sparkline series is unchanged');
    expect(p.pipeline.total, 15);
  });

  test('Staff (/dashboard/me): own requests with their amounts (owner 2026-10-13), counts unchanged', () {
    final s = StaffDashboard.fromJson(staffW3Json());
    expect(s.actions, 1);
    expect(s.inProcess, 2 + 1 + 1 + 3);
    expect(s.waitingDecision, 3);
    expect(s.done, 7);
    expect(s.exit, 1);
    expect(s.trend.map((p) => (p.period, p.count, p.sum)), [('2026-08', 4, 10000000), ('2026-09', 6, 18750000)]);
    expect((s.month!.count, s.month!.sum), (6, 18750000));
    expect(s.pipeline.rows.map((r) => r.sum), [5000000, 2250000, 1000000, 4500000, 21000000, 800000]);
    expect(s.latest.map((r) => (r.id, r.docNo, r.status, r.grandTotal)), [
      (1, null, 'draft', 1447500),
      (2, 'PB/DRMS/2609/0007', 'transferred', 2250000),
    ]);
    final empty = StaffDashboard.fromJson(const {});
    expect(empty.inProcess, 0, reason: 'tolerant parsing');
    expect(empty.month, isNull);
    expect(empty.latest, isEmpty);
  });

  test('Admin (/dashboard/admin): master-data gaps', () {
    final a = AdminDashboard.fromJson(adminW3Json());
    expect((a.usersIncomplete, a.projectsWithoutPm, a.projectsWithoutPusatBiaya), (2, 0, 1));
  });
}
