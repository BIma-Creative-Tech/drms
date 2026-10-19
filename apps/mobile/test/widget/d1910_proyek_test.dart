import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/home/domain/web_route_map.dart';
import 'package:proyekkas/features/rap/data/rap_api.dart';
import 'package:proyekkas/features/rap/data/rap_providers.dart';
import 'package:proyekkas/features/rap/domain/rap_edit.dart';
import 'package:proyekkas/features/rap/presentation/rap_manage_screen.dart';
import 'package:proyekkas/features/records/data/records_api.dart';
import 'package:proyekkas/features/records/data/records_providers.dart';
import 'package:proyekkas/features/records/domain/record_form.dart';
import 'package:proyekkas/features/records/domain/record_list.dart';
import 'package:proyekkas/features/records/presentation/record_form_screen.dart';

import '../support/widget_harness.dart';

const _formJson = {
  'collection': 'clients',
  'label': 'Klien',
  'id': null,
  'canCreate': true,
  'canUpdate': false,
  'canDelete': false,
  'supported': true,
  'fields': [
    {'key': 'name', 'label': 'Nama', 'type': 'text', 'required': true, 'maxLength': 120},
    {
      'key': 'kind',
      'label': 'Jenis',
      'type': 'select',
      'required': false,
      'options': [
        {'value': 'swasta', 'label': 'Swasta'},
        {'value': 'pemerintah', 'label': 'Pemerintah'},
      ],
    },
    {'key': 'active', 'label': 'Aktif', 'type': 'checkbox', 'value': true},
    {'key': 'company', 'label': 'PT', 'type': 'relationship', 'required': true, 'relationTo': 'companies'},
    {'key': 'code', 'label': 'Kode', 'type': 'text', 'readOnly': true, 'value': 'KL-01'},
  ],
};

class _FakeRecords implements RecordsApi {
  final created = <Map<String, Object?>>[];

  @override
  ApiClient get client => throw UnimplementedError();

  @override
  Future<RecordPage> list(String collection, {String q = '', int page = 1, int limit = 20}) async =>
      RecordPage.fromJson({'collection': collection, 'label': 'Klien', 'columns': [], 'items': [], 'totalDocs': 0});

  @override
  Future<RecordDetail> detail(String collection, String id) async =>
      RecordDetail.fromJson({'collection': collection, 'label': 'Klien', 'id': id, 'title': 'PT Maju', 'fields': []});

  @override
  Future<RecordFormDef> form(String collection, {String? id}) async => RecordFormDef.fromJson(_formJson);

  @override
  Future<List<(String, String)>> options(String collection, String field, {String q = '', String? id}) async => [
    ('1', 'CS1 — PT Contoh Satu'),
    ('2', 'LAS — PT Lain'),
  ];

  @override
  Future<RecordDetail> create(
    String collection,
    Map<String, Object?> data, {
    String? reason,
    required String idempotencyKey,
  }) async {
    created.add(data);
    return RecordDetail.fromJson({
      'collection': collection,
      'label': 'Klien',
      'id': 9,
      'title': 'PT Maju',
      'fields': [],
    });
  }

  @override
  Future<RecordDetail> update(
    String collection,
    String id,
    Map<String, Object?> data, {
    String? reason,
    required String idempotencyKey,
  }) async => throw const ProblemException(status: 403);

  @override
  Future<RecordDeleteCheck> deleteCheck(String collection, String id) async => const RecordDeleteCheck();

  @override
  Future<void> softDelete(String collection, String id, String reason, {required String idempotencyKey}) async {}

  @override
  Future<void> revokeDevice(String id, String reason, {required String idempotencyKey}) async {}

  @override
  Future<Uint8List> fileBytes(String path) async => Uint8List(0);

  @override
  Future<RecordFormDef> globalForm(String slug) async => RecordFormDef.fromJson(_formJson);

  @override
  Future<RecordDetail> updateGlobal(
    String slug,
    Map<String, Object?> data, {
    String? reason,
    required String idempotencyKey,
  }) async => throw const ProblemException(status: 403);
}

Map<String, dynamic> _rapJson({bool locked = false}) => {
  'projectId': 10,
  'kind': 'konstruksi',
  'locked': locked,
  'canEdit': true,
  'needsReason': locked,
  'drivesProgress': true,
  'items': [
    {
      'id': 5,
      'code': 'A.1',
      'description': 'Galian tanah',
      'kind': 'pekerjaan',
      'stage': {'id': 2, 'name': 'Persiapan'},
      'uom': {'id': 3, 'code': 'm3'},
      'volume': 120,
      'unitPrice': 85000,
      'weightPct': 10,
      'active': true,
      'realised': 20,
    },
  ],
  'stages': [
    {'id': 2, 'name': 'Persiapan', 'active': true},
  ],
  'totals': {'rapValue': 10200000, 'budget': 9000000, 'overBudget': true},
};

class _FakeRap implements RapApi {
  final calls = <String>[];

  @override
  ApiClient get client => throw UnimplementedError();

  @override
  Future<RapEditData> load(int projectId) async => RapEditData.fromJson(_rapJson());

  @override
  Future<List<(int, String)>> uoms() async => [(3, 'm3 — meter kubik'), (4, 'kg — kilogram')];

  @override
  Future<void> createItem(int projectId, Map<String, Object?> body, {required String idempotencyKey}) async =>
      calls.add('create:${body['code']}:${body['kind']}:${body['uomId']}:${body['volume']}:${body['stageId']}');

  @override
  Future<void> updateItem(int itemId, Map<String, Object?> body, {required String idempotencyKey}) async =>
      calls.add('update:$itemId:${body['reason']}');

  @override
  Future<RapPreviewData> preview(int projectId, Uint8List bytes, String name) async => throw UnimplementedError();

  @override
  Future<void> commit(int projectId, Uint8List bytes, String name, {required String fileHash, String? reason}) async {}

  @override
  Future<List<(int, String)>> templates() async => const [];

  @override
  Future<void> applyTemplate(int projectId, int templateId, {required String idempotencyKey}) async {}

  @override
  Future<void> saveTemplate(int projectId, String name, {required String idempotencyKey}) async {}

  @override
  Future<Uint8List> xlsx(String path) async => Uint8List(0);
}

/// User 2026-10-19 (APK ↔ web parity, phase 5): the generic web edit form and "RAP proyek".
void main() {
  test('domain: form JSON, client checks, Proyek menu targets', () {
    final def = RecordFormDef.fromJson(_formJson);
    expect(def.fields.map((f) => f.key), ['name', 'kind', 'active', 'company', 'code']);
    final errs = validateRecord(def.fields, {'name': ' ', 'company': null, 'code': ''});
    expect(errs.keys, containsAll(['name', 'company']));
    expect(errs.containsKey('code'), isFalse, reason: 'read-only fields are not checked');
    expect(apkTargetFor('/collections/clients')!.route, '/data/clients');
    expect(apkTargetFor('/klien/baru')!.route, '/clients/new');
    expect(apkTargetFor('/collections/stage-templates')!.route, '/data/stage-templates');
    expect(apkTargetFor('/rap')!.route, '/projects');
    expect(apkTargetFor('/aftersales')!.route, '/reports/rekap-aftersales');
    expect(
      validateRapItem(
        code: 'A',
        description: 'x',
        uomId: 1,
        volume: 1,
        stageId: null,
        stageRequired: true,
        weightPct: null,
        needsReason: true,
        reason: '',
      ).keys,
      containsAll(['stageId', 'reason']),
    );
  });

  testWidgets('generic form: required check, select, relationship picker, then POST with the values', (tester) async {
    final api = _FakeRecords();
    await pumpScreen(
      tester,
      const RecordFormScreen(collection: 'clients'),
      overrides: [recordsApiProvider.overrideWithValue(api)],
    );
    expect(find.text('Klien baru'), findsOneWidget);
    await tester.tap(find.byKey(const Key('record-save')));
    await tester.pumpAndSettle();
    expect(find.text('Nama wajib diisi.'), findsOneWidget);
    expect(api.created, isEmpty);

    await tester.enterText(find.byKey(const Key('record-field-name')), 'PT Maju');
    await tester.tap(find.byKey(const Key('record-field-company')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('record-picker-1')));
    await tester.pumpAndSettle();
    expect(find.text('CS1 — PT Contoh Satu'), findsOneWidget);
    await tester.tap(find.byKey(const Key('record-save')));
    await tester.pumpAndSettle();
    expect(api.created.single, {'name': 'PT Maju', 'kind': null, 'active': true, 'company': 1});
  });

  group('Kelola RAP', () {
    Future<_FakeRap> pump(WidgetTester tester) async {
      final api = _FakeRap();
      await pumpScreen(
        tester,
        const RapManageScreen(projectId: 10),
        auth: AuthSignedIn(profile: profile({Role.owner}), sub: 'user-sub-1'),
        overrides: [rapApiProvider.overrideWithValue(api)],
      );
      return api;
    }

    testWidgets('items, value vs RAB, add an item (stage required)', (tester) async {
      final api = await pump(tester);
      expect(find.text('A.1 · Galian tanah'), findsOneWidget);
      expect(find.byKey(const Key('rap-value')), findsOneWidget);
      expect(find.textContaining('Sudah terpakai'), findsOneWidget);
      await tester.tap(find.byKey(const Key('rap-add')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('rap-item-code')), 'B.1');
      await tester.enterText(find.byKey(const Key('rap-item-description')), 'Besi beton');
      await tester.enterText(find.byKey(const Key('rap-item-volume')), '2,5');
      await tester.tap(find.byKey(const Key('rap-item-save')));
      await tester.pumpAndSettle();
      expect(api.calls, isEmpty, reason: 'stage + uom missing');
      expect(find.text('Tahapan wajib dipilih.'), findsOneWidget);
    });

    testWidgets('editing a used item asks for a reason', (tester) async {
      final api = await pump(tester);
      await tester.tap(find.byKey(const Key('rap-item-5')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('rap-item-reason')), findsOneWidget);
      await tester.tap(find.byKey(const Key('rap-item-save')));
      await tester.pumpAndSettle();
      expect(api.calls, isEmpty);
      await tester.enterText(find.byKey(const Key('rap-item-reason')), 'koreksi volume');
      await tester.tap(find.byKey(const Key('rap-item-save')));
      await tester.pumpAndSettle();
      expect(api.calls, ['update:5:koreksi volume']);
    });
  });
}
