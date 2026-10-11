import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/field_reports/application/field_providers.dart';
import 'package:proyekkas/features/field_reports/application/field_service.dart';
import 'package:proyekkas/features/field_reports/domain/field_models.dart';
import 'package:proyekkas/features/field_reports/presentation/daily_report_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/field_hub_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/widgets/field_widgets.dart';
import 'package:proyekkas/features/progress/application/progress_providers.dart';

import '../support/widget_harness.dart';

/// P3 Laporan Harian screen (APK 0.5.0): the konstruksi project offers "Laporan Harian" in the hub, the editor
/// lists the RAP work items per stage with their realisation, warns above the RAP volume (notes required) and
/// queues ONE report with the volumes / manpower. The service is a fake; caches are provider overrides.
const today = '2026-10-10';

class FakeFieldService extends Fake implements FieldService {
  final submitted = <FieldDraft>[];
  int uuids = 0;

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
    content: content ?? const DailyContent(),
  );

  @override
  Future<void> saveDraft(String sub, FieldDraft d) async {}

  @override
  Future<void> submit(String sub, FieldDraft d, {required bool online}) async => submitted.add(d);

  @override
  Future<String> addPhoto(String sub, Uint8List raw) async => 'ph-1';
}

UserProfile profile({bool daily = true}) => UserProfile(
  id: 6,
  email: 'mandor@example.test',
  name: 'Budi Mandor',
  roles: const {Role.staff},
  employee: const Employee(id: 13, code: 'E13', name: 'Budi Mandor'),
  timezone: 'Asia/Makassar',
  companies: [
    CompanyMembership(
      id: 3,
      code: 'DRMS',
      name: 'PT Contoh DRMS',
      roles: const {Role.staff},
      capabilities: Capabilities(dailyReportCreate: daily),
      settings: const CompanySettings(fieldReportsEnabled: true),
    ),
  ],
).scopedTo(null);

const gudang = FieldProject(
  id: 51,
  label: 'KS-01 — Gudang beton',
  code: 'KS-01',
  kind: ProjectKind.konstruksi,
  companyId: 3,
);

const rap = [
  RapItem(
    id: 11,
    companyId: 3,
    projectId: 51,
    code: 'A.1',
    description: 'Galian tanah',
    kind: 'pekerjaan',
    uom: 'M3',
    stageName: 'Pekerjaan tanah',
    volume: 100,
    realised: 60,
  ),
  RapItem(
    id: 12,
    companyId: 3,
    projectId: 51,
    code: 'B.1',
    description: 'Beton K-250',
    kind: 'pekerjaan',
    uom: 'M3',
    stageName: 'Struktur',
    volume: 20,
  ),
  RapItem(
    id: 13,
    companyId: 3,
    projectId: 51,
    code: 'M.1',
    description: 'Semen',
    kind: 'material',
    uom: 'SAK',
    stageName: 'Struktur',
    volume: 300,
    received: 100,
    used: 40,
  ),
];

const resources = [
  ResourceType(id: 1, companyId: 3, kind: 'tenaga', code: 'MANDOR', name: 'Mandor'),
  ResourceType(id: 2, companyId: 3, kind: 'tenaga', code: 'TK-BATU', name: 'Tukang batu'),
  ResourceType(id: 9, companyId: 3, kind: 'alat', code: 'EXCAVATOR', name: 'Excavator'),
];

void main() {
  late FakeFieldService service;
  setUp(() => service = FakeFieldService());

  Future<void> pump(WidgetTester tester, Widget child, {UserProfile? p}) => pumpScreen(
    tester,
    child,
    auth: AuthSignedIn(profile: p ?? profile(), sub: 'user-sub-6'),
    overrides: [
      fieldServiceProvider.overrideWithValue(service),
      fieldTodayProvider.overrideWithValue(today),
      fieldProjectsProvider.overrideWith((ref) async => const [gudang]),
      fieldCacheRefreshProvider.overrideWith((ref) async => true),
      fieldRapItemsProvider.overrideWith((ref, id) async => rap),
      fieldResourceTypesProvider.overrideWith((ref, c) async => resources),
      openFieldDraftsProvider.overrideWith((ref) => Stream.value(const [])),
      myFieldRecordsProvider.overrideWith((ref) async => const []),
      fieldPhotoCaptureProvider.overrideWithValue((context, title) async => Uint8List.fromList([1, 2, 3])),
      localPhotoProvider.overrideWith((ref, uuid) async => null),
    ],
  );

  testWidgets('hub: konstruksi project offers Laporan Harian only with the capability', (tester) async {
    await pump(tester, const FieldHubScreen());
    expect(find.byKey(const Key('field-new-daily-51')), findsOneWidget);
  });

  testWidgets('RAP items per stage with realisation; over-RAP warns and needs notes; submit queues volumes', (
    tester,
  ) async {
    await pump(tester, const DailyReportScreen(projectId: 51));
    await tester.pumpAndSettle();
    expect(find.text('Pekerjaan tanah'), findsOneWidget);
    expect(find.text('Realisasi 60 / 100 M3'), findsOneWidget);
    await tester.enterText(
      find.descendant(of: find.byKey(const Key('daily-work-A.1')), matching: find.byType(TextField)),
      '45',
    );
    await tester.enterText(
      find.descendant(of: find.byKey(const Key('daily-men-TK-BATU')), matching: find.byType(TextField)),
      '4',
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Melebihi RAP: 105'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('daily-submit')));
    await tester.tap(find.byKey(const Key('daily-submit')));
    await tester.pumpAndSettle();
    expect(service.submitted, isEmpty, reason: 'notes required above the RAP volume');
    await tester.enterText(find.byKey(const Key('daily-notes')), 'Galian diperdalam sesuai instruksi konsultan');
    await tester.ensureVisible(find.byKey(const Key('daily-submit')));
    await tester.tap(find.byKey(const Key('daily-submit')));
    await tester.pumpAndSettle();
    final d = service.submitted.single;
    expect(d.type, FieldReportType.dailyReport);
    expect(d.projectId, 51);
    expect(d.daily.work, {11: 45.0});
    expect(d.daily.manpower, {2: 4});
    expect(d.daily.notes, contains('konsultan'));
  });
}
