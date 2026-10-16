import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/field_reports/application/field_providers.dart';
import 'package:proyekkas/features/field_reports/application/field_service.dart';
import 'package:proyekkas/features/field_reports/domain/field_models.dart';
import 'package:proyekkas/features/field_reports/presentation/aftersales_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/field_conflict_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/field_hub_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/service_report_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/timesheet_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/widgets/field_widgets.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';
import 'package:proyekkas/features/progress/application/progress_providers.dart';

import '../support/widget_harness.dart';

/// FR1 APK screens (mockups Android-Servis / Android-Timesheet / Android-Aftersales). The service is a fake and
/// the caches are provider overrides, so no drift / HTTP work runs in the fake-async widget zone; the queue and
/// sync side is covered by test/unit/field_sync_test.dart. Fictional data only.
const today = '2026-10-09';

class FakeFieldService extends Fake implements FieldService {
  final submitted = <(FieldDraft, bool online)>[];
  final autosaved = <FieldDraft>[];
  final usedServer = <String>[];
  final resent = <(String, String)>[];
  final discarded = <String>[];
  int photos = 0;
  int uuids = 0;
  FieldDraft? localTimesheet;
  double? prevHm = 1023;
  List<TimesheetMark> marks = const [];

  @override
  FieldDraft newDraft(
    FieldReportType type, {
    required int projectId,
    String projectLabel = '',
    int? companyId,
    required String reportDate,
    FieldContent? content,
  }) => FieldDraft(
    clientUuid: 'new-${++uuids}',
    type: type,
    projectId: projectId,
    reportDate: reportDate,
    content: content ?? const ServiceContent(),
  );

  @override
  Future<String> addPhoto(String sub, Uint8List raw) async => 'ph-${++photos}';

  @override
  Future<void> saveDraft(String sub, FieldDraft d) async => autosaved.add(d);

  @override
  Future<void> submit(String sub, FieldDraft d, {required bool online}) async => submitted.add((d, online));

  @override
  Future<List<(String, double)>> hmReadings(String sub, int unitId, {String? excludeUuid}) async => const [];

  @override
  Future<({FieldDraft? local, double? prevHm, String? prevDate, List<TimesheetMark> marks})> timesheetStart(
    String sub, {
    required int projectId,
    required int unitId,
    required String date,
  }) async => (local: localTimesheet, prevHm: prevHm, prevDate: '2026-10-08', marks: marks);

  @override
  Future<void> discard(String sub, String uuid) async => discarded.add(uuid);

  @override
  Future<void> useServerVersion(String sub, String uuid) async => usedServer.add(uuid);

  @override
  Future<void> resendMine(String sub, String uuid, {required String reason, required bool online}) async =>
      resent.add((uuid, reason));
}

UserProfile fieldProfile({
  Set<Role> roles = const {Role.staff},
  bool flag = true,
  bool service = true,
  bool timesheet = true,
  bool aftersales = true,
}) => UserProfile(
  id: 5,
  email: 'mekanik@example.test',
  name: 'Agus Mekanik',
  roles: roles,
  employee: const Employee(id: 12, code: 'E12', name: 'Agus Mekanik'),
  timezone: 'Asia/Makassar',
  companies: [
    CompanyMembership(
      id: 3,
      code: 'DRMS',
      name: 'PT Contoh DRMS',
      roles: roles,
      capabilities: Capabilities(
        serviceReportCreate: service,
        unitTimesheetCreate: timesheet,
        aftersalesActivityCreate: aftersales,
      ),
      settings: CompanySettings(fieldReportsEnabled: flag),
    ),
  ],
).scopedTo(null);

const kontrak = FieldProject(
  id: 41,
  label: 'K-001 — Sewa Kalteng Coal',
  code: 'K-001',
  kind: ProjectKind.kontrakUnit,
  companyId: 3,
);
const aftersalesProject = FieldProject(
  id: 52,
  label: 'AS-2026 — Aftersales Sparepart',
  code: 'AS-2026',
  kind: ProjectKind.aftersales,
  companyId: 3,
);

const ex01 = FieldUnit(
  id: 9,
  companyId: 3,
  label: 'EX-01',
  unitCode: 'EX-01',
  type: 'Excavator',
  brandModel: 'PC200-8',
  serialNo: 'KMTPC123',
  lastHourMeter: 1023,
  lastHourMeterAt: '2026-10-08',
);
const ex02 = FieldUnit(id: 10, companyId: 3, label: 'EX-02', unitCode: 'EX-02', type: 'Excavator');
const dz01 = FieldUnit(id: 11, companyId: 3, label: 'DZ-01', unitCode: 'DZ-01', type: 'Dozer');

/// "Jenis servis" master of PT 3 (Las deactivated on the web).
const serviceTypes = [
  ServiceType(id: 7, companyId: 3, code: 'perbaikan', name: 'Perbaikan'),
  ServiceType(id: 8, companyId: 3, code: 'inspeksi', name: 'Inspeksi'),
  ServiceType(id: 9, companyId: 3, code: 'las', name: 'Las', active: false),
];

FieldContractUnit cu(FieldUnit u) => FieldContractUnit(
  id: u.id + 100,
  companyId: 3,
  projectId: 41,
  unitId: u.id,
  unitCode: u.unitCode,
  startDate: '2026-10-01',
);

void main() {
  late FakeFieldService service;
  setUp(() => service = FakeFieldService());

  Future<void> pump(
    WidgetTester tester,
    Widget child, {
    UserProfile? profile,
    List<FieldDraft> local = const [],
    List<TimesheetMark> marks = const [],
    List<Override> extra = const [],
    bool online = true,
  }) => pumpScreen(
    tester,
    child,
    online: online,
    auth: AuthSignedIn(profile: profile ?? fieldProfile(), sub: 'user-sub-1'),
    overrides: [
      fieldServiceProvider.overrideWithValue(service),
      fieldTodayProvider.overrideWithValue(today),
      fieldProjectsProvider.overrideWith((ref) async => const [kontrak, aftersalesProject]),
      fieldCacheRefreshProvider.overrideWith((ref) async => true),
      fieldUnitsProvider.overrideWith((ref, key) async => const [ex01, ex02, dz01]),
      fieldContractUnitsProvider.overrideWith((ref, id) async => [cu(ex01), cu(ex02), cu(dz01)]),
      fieldTimesheetMarksProvider.overrideWith((ref, id) async => marks),
      openFieldDraftsProvider.overrideWith((ref) => Stream.value(local)),
      fieldClientsProvider.overrideWith(
        (ref, c) async => const [
          FieldClient(id: 4, companyId: 3, name: 'CV Maju Jaya'),
          FieldClient(id: 5, companyId: 3, name: 'PT Sumber Tambang'),
        ],
      ),
      fieldOpenPosProvider.overrideWith(
        (ref, key) async => [
          if (key.$2 == null || key.$2 == 4)
            const FieldOpenPo(
              id: 907,
              companyId: 3,
              projectId: 52,
              clientId: 4,
              clientName: 'CV Maju Jaya',
              activityDate: '2026-10-04',
              docNo: 'PO-0907',
              items: [
                PartLine(name: 'Seal kit', qty: 1, uom: 'set'),
                PartLine(name: 'Filter', qty: 4, uom: 'pcs'),
              ],
              ageDays: 5,
            ),
          if (key.$2 == null)
            const FieldOpenPo(
              id: 912,
              companyId: 3,
              projectId: 52,
              clientId: 5,
              activityDate: '2026-10-09',
              docNo: 'PO-0912',
            ),
        ],
      ),
      aftersalesDayProvider.overrideWith(
        (ref, key) async => (
          today: [
            const FieldRecord(FieldReportType.aftersalesActivity, {
              'id': 3,
              'kind': 'penawaran',
              'client': {'id': 6, 'name': 'PT Kalteng Coal'},
              'docNo': 'Q-0388',
              'followUpDate': today,
              'value': 1000000,
              'valueVisible': false,
            }),
          ],
          followUpsDue: 1,
        ),
      ),
      myFieldRecordsProvider.overrideWith((ref) async => const []),
      fieldServiceTypesProvider.overrideWith((ref, c) async => c == 3 ? serviceTypes : const <ServiceType>[]),
      fieldServiceTypeNamesProvider.overrideWith((ref) async => {for (final t in serviceTypes) t.id: t.name}),
      fieldPhotoCaptureProvider.overrideWithValue((context, title) async => Uint8List.fromList([1, 2, 3])),
      localPhotoProvider.overrideWith((ref, uuid) async => null),
      ...extra,
    ],
  );

  group('home tile "Laporan Lapangan"', () {
    Future<void> pumpHome(WidgetTester tester, UserProfile p) => pump(
      tester,
      const HomeScreen(),
      profile: p,
      extra: [
        appConfigProvider.overrideWith((ref) async => const AppConfig()),
        integrityReportProvider.overrideWith((ref) async => null),
        pmDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
        financeDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
        direkturDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
        inboxProvider.overrideWith((ref) async => throw const NetworkException()),
      ],
    );

    testWidgets('Staff with a field capability and the PT flag on: tile shown', (tester) async {
      await pumpHome(tester, fieldProfile());
      expect(find.byKey(const Key('home-field')), findsOneWidget);
      expect(find.text('Laporan Lapangan'), findsOneWidget);
    });

    testWidgets('flag off / no capability / Operator-only: no tile', (tester) async {
      await pumpHome(tester, fieldProfile(flag: false));
      expect(find.byKey(const Key('home-field')), findsNothing);
      await pumpHome(tester, fieldProfile(service: false, timesheet: false, aftersales: false));
      expect(find.byKey(const Key('home-field')), findsNothing);
      await pumpHome(tester, fieldProfile(roles: const {Role.operator}));
      expect(find.byKey(const Key('home-field')), findsNothing);
      expect(find.byKey(const Key('home-attendance')), findsOneWidget);
    });
  });

  group('hub', () {
    testWidgets('report types by project kind and capability; "Riwayat saya" with local states', (tester) async {
      await pump(
        tester,
        const FieldHubScreen(),
        profile: fieldProfile(aftersales: false),
        local: [
          FieldDraft(
            clientUuid: 'q-1',
            type: FieldReportType.unitTimesheet,
            projectId: 41,
            reportDate: today,
            content: const TimesheetContent(unitId: 9, unitLabel: 'EX-01', hmStart: 1023, hmEnd: 1031),
            syncState: FieldSyncState.queued,
          ),
          FieldDraft(
            clientUuid: 'r-1',
            type: FieldReportType.serviceReport,
            projectId: 41,
            reportDate: today,
            content: const ServiceContent(unitId: 9, unitLabel: 'EX-01'),
            syncState: FieldSyncState.rejected,
            lastError: 'HM lebih kecil dari HM terakhir unit.',
          ),
        ],
      );
      expect(find.byKey(const Key('field-new-timesheet-41')), findsOneWidget);
      expect(find.byKey(const Key('field-new-service-41')), findsOneWidget);
      expect(find.byKey(const Key('field-new-service-52')), findsOneWidget);
      expect(find.byKey(const Key('field-new-aftersales-52')), findsNothing, reason: 'no aftersales capability');
      expect(find.text('Riwayat saya (2)'), findsOneWidget);
      await tester.tap(find.byKey(const Key('field-tab-history')));
      await tester.pumpAndSettle();
      expect(find.text('Menunggu sinyal'), findsOneWidget);
      expect(find.text('Ditolak'), findsOneWidget);
      expect(find.text('HM lebih kecil dari HM terakhir unit.'), findsOneWidget);
    });
  });

  group('Laporan Servis Unit', () {
    testWidgets('mockup fields; HM below the last HM blocked; menunggu part hint; submit queues the report', (
      tester,
    ) async {
      await pump(tester, const ServiceReportScreen(projectId: 41, unitId: 9));
      expect(find.text('Laporan Servis Unit'), findsOneWidget);
      expect(find.text('EX-01 · Excavator PC200-8'), findsOneWidget);
      expect(find.textContaining('HM terakhir 1.023'), findsWidgets);
      expect(find.text('Catatan saja — stok sparepart tidak dikelola di aplikasi.'), findsOneWidget);
      expect(find.text('Maksimal 25 foto per laporan.'), findsOneWidget);
      expect(find.byKey(const Key('service-type-las')), findsNothing, reason: 'inactive types are not offered');
      await tester.enterText(find.byKey(const Key('service-hm')), '1020');
      await tester.pump();
      expect(find.textContaining('Lebih kecil dari HM terakhir unit (1.023)'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('service-hm')), '1025');
      await tester.tap(find.byKey(const Key('service-type-perbaikan')));
      await tester.enterText(find.byKey(const Key('service-complaint')), 'Boom turun sendiri');
      await tester.enterText(find.byKey(const Key('service-action')), 'Ganti seal kit boom');
      await tester.enterText(find.byKey(const Key('service-helpers')), 'Joko');
      await tester.ensureVisible(find.byKey(const Key('part-add')));
      await tester.tap(find.byKey(const Key('part-add')));
      await tester.pump();
      await tester.enterText(find.byKey(const Key('part-name-0')), 'Seal kit boom');
      await tester.enterText(find.byKey(const Key('part-qty-0')), '1');
      await tester.enterText(find.byKey(const Key('part-uom-0')), 'set');
      expect(find.byKey(const Key('part-partno-0')), findsNothing, reason: 'no "No. part" on the service report');
      await tester.ensureVisible(find.byKey(const Key('unit-status-menunggu_part')));
      await tester.tap(find.byKey(const Key('unit-status-menunggu_part')));
      await tester.pump();
      expect(find.text('PM akan diberi notifikasi: unit EX-01 menunggu part.'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('service-add-before')));
      await tester.tap(find.byKey(const Key('service-add-before')));
      await tester.pumpAndSettle();
      expect(find.text('Sebelum (1)'), findsOneWidget);
      expect(find.byKey(const Key('service-summary')), findsOneWidget);
      expect(find.text('EX-01 · HM 1.023 → 1.025 · 1 sparepart · 1 foto'), findsOneWidget);
      await tester.tap(find.byKey(const Key('service-submit')));
      await tester.pumpAndSettle();
      final (d, online) = service.submitted.single;
      expect(online, isTrue);
      final c = d.service;
      expect((d.projectId, d.companyId, d.reportDate), (41, 3, today));
      expect((c.unitId, c.hourMeter, c.unitStatusAfter), (9, 1025.0, UnitStatus.menungguPart));
      expect(c.serviceTypeIds, [7]);
      expect(c.serviceTypeNames, {7: 'Perbaikan'});
      expect(c.filledParts.single.summary, 'Seal kit boom 1 set');
      expect(c.beforePhotos, ['ph-1']);
      expect(service.autosaved, isNotEmpty, reason: 'draft autosaved while typing');
    });

    testWidgets('missing fields are marked; nothing is sent', (tester) async {
      await pump(tester, const ServiceReportScreen(projectId: 41));
      await tester.tap(find.byKey(const Key('service-submit')));
      await tester.pumpAndSettle();
      expect(service.submitted, isEmpty);
      expect(find.text('Pilih unit.'), findsOneWidget);
      expect(find.text('Pilih minimal satu jenis servis.'), findsOneWidget);
      expect(find.text('Pilih status unit setelah servis.'), findsOneWidget);
    });

    testWidgets('unit picker searches by code / plate', (tester) async {
      await pump(tester, const ServiceReportScreen(projectId: 41));
      await tester.tap(find.byKey(const Key('field-unit-pick')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('unit-option-11')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('unit-search')), 'dz');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('unit-option-9')), findsNothing);
      await tester.tap(find.byKey(const Key('unit-option-11')));
      await tester.pumpAndSettle();
      expect(find.text('DZ-01 · Dozer'), findsOneWidget);
    });
  });

  group('Laporan Servis Unit — jenis servis per PT, no part no., 25 photos (owner 2026-10-17)', () {
    FieldDraft draft(ServiceContent c) => FieldDraft(
      clientUuid: 'sv-local',
      type: FieldReportType.serviceReport,
      companyId: 3,
      projectId: 41,
      projectLabel: 'K-001 — Sewa Kalteng Coal',
      reportDate: today,
      content: c,
    );

    testWidgets('several types; a chosen type deactivated later stays "(nonaktif)"; loaded part no. kept', (
      tester,
    ) async {
      final d = draft(
        const ServiceContent(
          unitId: 9,
          unitLabel: 'EX-01',
          hourMeter: 1025,
          serviceTypeIds: [9],
          serviceTypeNames: {9: 'Las'},
          action: 'Las bucket',
          unitStatusAfter: UnitStatus.siap,
          spareparts: [PartLine(name: 'Kawat las', partNo: 'KL-26', qty: 1, uom: 'kg')],
        ),
      );
      await pump(tester, ServiceReportScreen(initial: d));
      expect(find.text('Las (nonaktif)'), findsOneWidget);
      expect(find.text('Boleh pilih lebih dari satu.'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('service-type-perbaikan')));
      await tester.tap(find.byKey(const Key('service-type-perbaikan')));
      await tester.tap(find.byKey(const Key('service-type-inspeksi')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('service-type-inspeksi'))); // toggled off again
      await tester.pump();
      expect(find.byKey(const Key('part-partno-0')), findsNothing);
      await tester.ensureVisible(find.byKey(const Key('part-qty-0')));
      await tester.enterText(find.byKey(const Key('part-qty-0')), '2');
      await tester.pump();
      await tester.tap(find.byKey(const Key('service-submit')));
      await tester.pumpAndSettle();
      final c = service.submitted.single.$1.service;
      expect(c.serviceTypeIds, [9, 7]);
      expect(c.serviceTypeNames, {9: 'Las', 7: 'Perbaikan'});
      expect((c.spareparts.single.qty, c.spareparts.single.partNo), (2.0, 'KL-26'));
    });

    testWidgets('all types toggled off → "Pilih minimal satu jenis servis."', (tester) async {
      final d = draft(
        const ServiceContent(
          unitId: 9,
          hourMeter: 1025,
          serviceTypeIds: [7],
          action: 'Ganti seal',
          unitStatusAfter: UnitStatus.siap,
        ),
      );
      await pump(tester, ServiceReportScreen(initial: d));
      await tester.ensureVisible(find.byKey(const Key('service-type-perbaikan')));
      await tester.tap(find.byKey(const Key('service-type-perbaikan')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('service-submit')));
      await tester.pumpAndSettle();
      expect(service.submitted, isEmpty);
      expect(find.text('Pilih minimal satu jenis servis.'), findsOneWidget);
    });

    testWidgets('draft of an APK < 0.8.0: legacy code → the PT type of that code; unknown code kept as legacy', (
      tester,
    ) async {
      // content_json as the old APK stored it: the single enum code under `serviceType`
      final old = ServiceContent.fromJson({
        'unitId': 9,
        'hourMeter': 1025,
        'serviceType': 'perbaikan',
        'action': 'Ganti seal',
        'unitStatusAfter': 'siap',
      });
      await pump(tester, ServiceReportScreen(initial: draft(old)));
      await tester.tap(find.byKey(const Key('service-submit')));
      await tester.pumpAndSettle();
      final mapped = service.submitted.single.$1.service;
      expect(mapped.serviceTypeIds, [7]);
      expect(mapped.legacyServiceType, isNull);
    });

    testWidgets('unknown legacy code stays chosen (sent as the legacy code)', (tester) async {
      final d = draft(
        const ServiceContent(
          unitId: 9,
          hourMeter: 1025,
          legacyServiceType: 'pemasangan',
          action: 'Pasang GPS',
          unitStatusAfter: UnitStatus.siap,
        ),
      );
      await pump(tester, ServiceReportScreen(initial: d));
      expect(find.byKey(const Key('service-type-pemasangan')), findsOneWidget);
      await tester.tap(find.byKey(const Key('service-submit')));
      await tester.pumpAndSettle();
      final c = service.submitted.single.$1.service;
      expect(c.serviceTypeIds, isEmpty);
      expect(c.legacyServiceType, 'pemasangan');
    });

    testWidgets('aftersales items keep the "No. part" input', (tester) async {
      await pump(
        tester,
        Scaffold(
          body: PartLinesEditor(
            lines: const [PartLine(name: 'Filter', partNo: 'F-1', qty: 4, uom: 'pcs')],
            onChanged: (_) {},
            nameHeader: 'Item',
            addLabel: 'Tambah',
          ),
        ),
      );
      expect(find.byKey(const Key('part-partno-0')), findsOneWidget);
    });
  });

  group('Timesheet Unit', () {
    testWidgets('unit tabs ✓/belum, HM awal prefilled, 24 h bar validation, breakdown ≥ 4 h, save & next', (
      tester,
    ) async {
      await pump(
        tester,
        const TimesheetScreen(projectId: 41),
        marks: const [TimesheetMark(unitId: 11, reportDate: today, hmStart: 500, hmEnd: 508)],
      );
      // DZ-01 already has today's timesheet; the first unit without one is opened
      expect(find.text('EX-01 ✓'), findsNothing);
      expect(find.text('EX-02 belum'), findsOneWidget);
      expect(find.text('DZ-01 terisi'), findsOneWidget);
      final hmStart = tester.widget<TextField>(find.byKey(const Key('timesheet-hm-start')));
      expect(hmStart.controller!.text, '1023');
      expect(find.textContaining('HM awal diisi otomatis dari HM akhir'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('timesheet-hm-end')), '1031,5');
      await tester.pump();
      expect(find.textContaining('Selisih HM: 8,5 jam'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('timesheet-work')), '20');
      await tester.enterText(find.byKey(const Key('timesheet-standby')), '5');
      await tester.pump();
      expect(find.text('Total 25 jam — melebihi 24 jam'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('timesheet-work')), '4');
      await tester.enterText(find.byKey(const Key('timesheet-standby')), '1,5');
      await tester.enterText(find.byKey(const Key('timesheet-breakdown')), '4');
      await tester.pump();
      expect(find.text('Total 9,5 dari 24 jam'), findsOneWidget);
      expect(find.byKey(const Key('timesheet-suggest-service')), findsOneWidget);
      // submit without photo / breakdown reason → refused locally
      await tester.ensureVisible(find.byKey(const Key('timesheet-submit')));
      await tester.tap(find.byKey(const Key('timesheet-submit')));
      await tester.pumpAndSettle();
      expect(service.submitted, isEmpty);
      expect(find.text('Foto meter HM wajib (1 foto).'), findsOneWidget);
      expect(find.text('Alasan breakdown wajib bila ada jam breakdown.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('timesheet-breakdown-reason')), 'Hidrolik bocor');
      await tester.ensureVisible(find.byKey(const Key('timesheet-hm-photo')));
      await tester.tap(find.byKey(const Key('timesheet-hm-photo')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('timesheet-operator')), 'Slamet');
      await tester.pump();
      expect(find.text('Simpan & lanjut ke EX-02'), findsOneWidget);
      await tester.tap(find.byKey(const Key('timesheet-submit')));
      await tester.pumpAndSettle();
      final (d, _) = service.submitted.single;
      final c = d.timesheet;
      expect(
        (c.unitId, c.hmStart, c.hmEnd, c.workHours, c.standbyHours, c.breakdownHours),
        (9, 1023.0, 1031.5, 4.0, 1.5, 4.0),
      );
      expect(
        (c.breakdownReason, c.operatorName, c.hmPhoto, c.previousHmEnd),
        ('Hidrolik bocor', 'Slamet', 'ph-1', 1023.0),
      );
      // next unit opened, empty, HM awal prefilled again
      expect(tester.widget<TextField>(find.byKey(const Key('timesheet-operator'))).controller!.text, '');
      await tester.pump(const Duration(seconds: 1));
    });

    testWidgets('"Salin dari kemarin" copies operator and location', (tester) async {
      await pump(
        tester,
        const TimesheetScreen(projectId: 41),
        marks: const [
          TimesheetMark(
            unitId: 9,
            reportDate: '2026-10-08',
            hmStart: 1015,
            hmEnd: 1023,
            operatorName: 'Slamet',
            location: 'Pit 3',
          ),
        ],
      );
      await tester.ensureVisible(find.byKey(const Key('timesheet-copy')));
      await tester.tap(find.byKey(const Key('timesheet-copy')));
      await tester.pump();
      expect(tester.widget<TextField>(find.byKey(const Key('timesheet-operator'))).controller!.text, 'Slamet');
      expect(tester.widget<TextField>(find.byKey(const Key('timesheet-location'))).controller!.text, 'Pit 3');
      await tester.pump(const Duration(seconds: 1));
    });
  });

  group('Aktivitas Aftersales', () {
    testWidgets('pengiriman: open PO of the customer copies its items; "terkirim semua"; quick reset after save', (
      tester,
    ) async {
      await pump(tester, const AftersalesScreen(projectId: 52));
      expect(find.text('Aktivitas baru'), findsOneWidget);
      expect(find.text('Hari ini (1)'), findsOneWidget);
      expect(find.text('Rp 1.000.000'), findsNothing, reason: 'value hidden from the caller (valueVisible false)');
      expect(find.text('2 PO belum terkirim · 1 penawaran follow-up hari ini'), findsOneWidget);
      await tester.tap(find.byKey(const Key('activity-client')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('CV Maju Jaya').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('activity-kind-pengiriman')));
      await tester.pumpAndSettle();
      expect(find.text('No. surat jalan'), findsOneWidget);
      await tester.tap(find.byKey(const Key('activity-po')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('PO-0907 · Seal kit 1 set, Filter 4 pcs (5 hari)').last);
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byKey(const Key('item-name-1'))).controller!.text, 'Filter');
      await tester.enterText(find.byKey(const Key('activity-doc')), 'SJ-0441');
      await tester.tap(find.byKey(const Key('activity-po-delivered')));
      await tester.enterText(find.byKey(const Key('activity-receiver')), 'Budi');
      // d1010 (8c): Rupiah input — raw digits are grouped while typing, `Rp` prefix
      await tester.enterText(find.byKey(const Key('activity-value')), '3100000');
      await tester.pump();
      final value = tester.widget<TextField>(find.byKey(const Key('activity-value')));
      expect(value.controller!.text, '3.100.000');
      expect(value.decoration!.prefixText, 'Rp ');
      await tester.ensureVisible(find.byKey(const Key('activity-add-photo')));
      await tester.tap(find.byKey(const Key('activity-add-photo')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('activity-submit')));
      await tester.tap(find.byKey(const Key('activity-submit')));
      await tester.pumpAndSettle();
      final (d, _) = service.submitted.single;
      final c = d.activity;
      expect(
        (d.projectId, c.clientId, c.kind, c.relatesTo, c.poDelivered),
        (52, 4, ActivityKind.pengiriman, 907, true),
      );
      expect((c.docNo, c.receiver, c.value), ('SJ-0441', 'Budi', 3100000));
      expect(c.photos, ['ph-1']);
      expect(c.filledItems.map((i) => i.summary), ['Seal kit 1 set', 'Filter 4 pcs']);
      // ready for the next activity (customer kept)
      expect(tester.widget<TextField>(find.byKey(const Key('activity-doc'))).controller!.text, '');
      await tester.pump(const Duration(seconds: 1));
    });

    testWidgets('penawaran shows the follow-up date, not the PO picker', (tester) async {
      await pump(tester, const AftersalesScreen(projectId: 52));
      await tester.tap(find.byKey(const Key('activity-kind-penawaran')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('activity-follow-up')), findsOneWidget);
      expect(find.byKey(const Key('activity-po')), findsNothing);
      expect(find.text('No. penawaran'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('activity-submit')));
      await tester.tap(find.byKey(const Key('activity-submit')));
      await tester.pumpAndSettle();
      expect(find.text('Pilih pelanggan.'), findsOneWidget);
      expect(service.submitted, isEmpty);
      await tester.pump(const Duration(seconds: 1));
    });
  });

  group('conflict', () {
    final conflict = FieldDraft(
      clientUuid: 'c-1',
      type: FieldReportType.unitTimesheet,
      projectId: 41,
      projectLabel: 'K-001',
      reportDate: today,
      content: const TimesheetContent(unitId: 9, hmStart: 1023, hmEnd: 1031, workHours: 8),
      serverId: 77,
      serverRev: 1,
      syncState: FieldSyncState.conflict,
      lastError: 'Laporan ini sudah ada/diubah di server. Pilih versi yang dipakai.',
      conflictCopy: const {
        'id': 77,
        'rev': 2,
        'hm_start': 1023,
        'hm_end': 1033,
        'work_hours': 9,
        'standby_hours': 0,
        'breakdown_hours': 0,
        'editable_until': '2099-01-01T00:00:00Z',
      },
    );

    testWidgets('side by side; use the server version / resend mine with a reason', (tester) async {
      await pump(tester, const FieldConflictScreen(uuid: 'c-1'), local: [conflict]);
      expect(find.text('HM akhir · berbeda'), findsOneWidget);
      expect(find.text('1.033'), findsOneWidget);
      await tester.tap(find.byKey(const Key('field-conflict-resend')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('field-reason-input')), 'HM foto benar');
      await tester.tap(find.byKey(const Key('field-reason-ok')));
      await tester.pumpAndSettle();
      expect(service.resent.single, ('c-1', 'HM foto benar'));
    });

    testWidgets('after 24 h only the server version can be kept', (tester) async {
      final old = FieldDraft(
        clientUuid: 'c-2',
        type: FieldReportType.serviceReport,
        projectId: 41,
        reportDate: today,
        content: const ServiceContent(unitId: 9, action: 'Ganti seal'),
        syncState: FieldSyncState.rejected,
        conflictCopy: const {'id': 78, 'rev': 2, 'action': 'Versi web', 'editable_until': '2020-01-01T00:00:00Z'},
      );
      await pump(tester, const FieldConflictScreen(uuid: 'c-2'), local: [old]);
      expect(tester.widget<OutlinedButton>(find.byKey(const Key('field-conflict-resend'))).onPressed, isNull);
      await tester.tap(find.byKey(const Key('field-conflict-use-server')));
      await tester.pumpAndSettle();
      expect(service.usedServer, ['c-2']);
    });
  });
}
