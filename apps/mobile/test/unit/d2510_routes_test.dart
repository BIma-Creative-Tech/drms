import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/domain/dashboard.dart';
import 'package:proyekkas/features/home/domain/route_access.dart';
import 'package:proyekkas/features/notifications/domain/app_notification.dart';
import 'package:proyekkas/features/reports/domain/report.dart';

import '../support/widget_harness.dart' show profile;

/// D2510 (user 2026-10-25): rows that could not be tapped — report links, notification targets, access guard.
void main() {
  group('apkRouteForReportLink', () {
    String? r(String href) => apkRouteForReportLink(href);

    test('document pages (existing mappings unchanged)', () {
      expect(r('/admin/collections/expense-requests/88'), '/requests/88');
      expect(r('/admin/pinjaman/detail/4'), '/loans/4');
      expect(r('/admin/pinjaman-antar-pt/detail/6'), '/intercompany-loans/6');
      expect(r('/admin/collections/projects/3'), '/projects/3');
      expect(r('/admin/collections/budget-addenda/61'), '/addenda/61');
      expect(r('/admin/progress/laporan/501'), '/progress/report/501');
      expect(r('/admin/collections/transfers/15'), '/data/transfers/15');
      expect(r('/admin/collections/users/2'), isNull, reason: 'no APK record screen for users');
      expect(r('/elsewhere/collections/projects/3'), isNull);
    });

    test('history tab, field-report details, web notification pages', () {
      expect(r('/admin/collections/expense-requests/88/riwayat'), '/requests/88/history');
      expect(r('/admin/unit-kontrak/timesheet/detail/12'), '/data/unit-timesheets/12');
      expect(r('/admin/aftersales/aktivitas/detail/13'), '/data/aftersales-activities/13');
      expect(r('/admin/laporan-servis/detail/14'), '/data/service-reports/14');
      expect(r('/admin/laporan-harian/detail/15'), '/data/daily-reports/15');
      expect(r('/admin/addendum/detail/61'), '/addenda/61');
      expect(r('/admin/progress/project/7'), '/projects/7');
      expect(r('/admin/collections/project-loans/4'), '/loans/4');
    });

    test('every web collection document whose list is the APK /data list', () {
      for (final slug in [
        'daily-reports',
        'service-reports',
        'unit-timesheets',
        'aftersales-activities',
        'contract-units',
        'cash-entries',
        'receipts',
        'period-closings',
        'vehicles',
      ]) {
        expect(r('/admin/collections/$slug/9'), '/data/$slug/9', reason: slug);
      }
    });

    test('report → report keeps its filters', () {
      expect(r('/admin/laporan/anggaran-project?project=7'), '/reports/anggaran-project?project=7');
      final buku = Uri.parse(r('/admin/laporan/buku-kas?dari=2026-10-01&sampai=2026-10-31&akun=3')!);
      expect(buku.path, '/reports/buku-kas');
      expect(buku.queryParameters, {'dari': '2026-10-01', 'sampai': '2026-10-31', 'akun': '3'});
      expect(r('/admin/laporan/rekap-pengajuan'), '/reports/rekap-pengajuan');
    });

    test('attendance recap of an employee, web menu pages with an APK screen', () {
      expect(r('/admin/absensi/rekap?karyawan=12&bulan=2026-10'), '/attendance/recap/12');
      expect(r('/admin/absensi/rekap'), '/attendance?tab=recap');
      expect(r('/admin/verifikasi-lpj'), '/finance?tab=lpj');
      expect(r('/admin/antrian-transfer'), '/finance');
      expect(r('/admin/unit-kontrak'), '/contracts');
      expect(r('/admin/unit-kontrak/kontrak/41?tab=rekap&bulan=2026-10'), '/contracts');
      expect(r('/admin/tidak-ada'), isNull);
    });
  });

  group('AppNotification.route', () {
    String? route(
      String docType,
      String? docId, {
      String event = 'x',
      bool progress = true,
      bool projects = true,
      bool Function(String)? canOpen,
    }) => AppNotification.fromJson({
      'id': 1,
      'uuid': 'u',
      'event': event,
      'title': 't',
      'body': 'b',
      'docType': docType,
      'docId': docId,
      'createdAt': '2026-10-25T00:00:00Z',
    }).route(canReadProgress: progress, canSeeProjects: projects, canOpen: canOpen);

    test('new doc types → their APK screens', () {
      expect(route('project_loan', '4'), '/loans/4');
      expect(route('cash_entry', '5'), '/data/cash-entries/5');
      expect(route('service_report', '14'), '/data/service-reports/14');
      expect(route('daily_report', '15'), '/data/daily-reports/15');
      expect(route('aftersales_activity', '13'), '/data/aftersales-activities/13');
      expect(route('unit_timesheet', '12'), '/data/unit-timesheets/12');
      expect(route('cash_entry', null), isNull);
      expect(route('unit_timesheet', 'x'), isNull);
    });

    test('project without progress access → the project (when projects are visible)', () {
      expect(route('project', '7', progress: false), '/projects/7');
      expect(route('project', '7', progress: false, projects: false), isNull);
      expect(route('project', '7', event: 'progress.late_report'), '/progress?project=7');
    });

    test('a target the user cannot open is not linked', () {
      final staff = profile({Role.staff});
      expect(route('cash_entry', '5', canOpen: (r) => canOpenApkRoute(r, staff)), isNull);
      expect(route('expense_request', '42', canOpen: (r) => canOpenApkRoute(r, staff)), '/requests/42');
      expect(
        route('cash_entry', '5', canOpen: (r) => canOpenApkRoute(r, profile({Role.finance}))),
        '/data/cash-entries/5',
      );
    });
  });

  group('canOpenApkRoute', () {
    test('the role rules of the target screens', () {
      final staff = profile({Role.staff});
      final finance = profile({Role.finance});
      final pm = profile({Role.pm});
      final operator = profile({Role.operator});
      expect(canOpenApkRoute('/data/cash-entries/5', staff), isFalse);
      expect(canOpenApkRoute('/data/cash-entries/5', finance), isTrue);
      expect(canOpenApkRoute('/data/period-closings/2', pm), isFalse);
      expect(canOpenApkRoute('/finance?tab=lpj', finance), isTrue);
      expect(canOpenApkRoute('/finance', pm), isFalse);
      expect(canOpenApkRoute('/cash?akun=3', finance), isTrue);
      expect(canOpenApkRoute('/cash?akun=3', staff), isFalse);
      expect(canOpenApkRoute('/progress/report/1', staff), isFalse);
      expect(canOpenApkRoute('/progress/report/1', pm), isTrue);
      expect(canOpenApkRoute('/projects/7', staff), isTrue);
      expect(canOpenApkRoute('/projects/7', operator), isFalse);
      expect(canOpenApkRoute('/loans/4', pm), isTrue);
      expect(canOpenApkRoute('/loans/4', staff), isFalse);
      expect(canOpenApkRoute('/data/daily-reports/15', staff), isTrue);
      expect(canOpenApkRoute('/data/daily-reports/15', operator), isFalse);
      expect(canOpenApkRoute('/attendance/recap/12', pm), isTrue);
      expect(canOpenApkRoute('/attendance/recap/12', staff), isFalse);
      expect(canOpenApkRoute('/requests/42', staff), isTrue);
      expect(canOpenApkRoute('/requests/42', null), isFalse);
    });
  });

  test('dashboard "Kas terbaru": a row opens its request, else the cash entry', () {
    final rows = RecentCashEntry.listFromJson([
      {'id': 31, 'entryNo': 'KK/1', 'direction': 'out', 'amount': 5, 'requestId': 42, 'requestDocNo': 'PB/1'},
      {'id': 32, 'entryNo': 'KM/1', 'direction': 'in', 'amount': 7, 'requestId': null},
    ]);
    expect(rows.first.route, '/requests/42');
    expect(rows.last.route, '/data/cash-entries/32');
  });
}
