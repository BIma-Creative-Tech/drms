import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/line_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/lpj_submit_screen.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/requester_actions.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/expense/presentation/widgets/transfer_lpj.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';

import '../support/fixtures.dart';
import '../support/seed.dart';
import '../support/widget_harness.dart';
import 'requester_flow_test.dart' show FakeExpenseApi, advanceJson;

/// DRMS 10/10 Phase B-2 on the APK: D1 "Pengajuan Baru", D3 computed line total + "Nominal sesuai nota" +
/// "Selisih nota", point 13 LPJ photos (max 10, read-only after submit).
final _masters = <String, List<MasterItem>>{
  MasterTypes.categories: [const MasterItem(1, 'BBM'), const MasterItem(2, 'Penginapan')],
  MasterTypes.uoms: [const MasterItem(3, 'liter'), const MasterItem(4, 'kamar')],
};

/// 1×1 transparent PNG.
final _png = Uint8List.fromList(
  base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
);

String _text(WidgetTester tester, String key) => tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  test('D1: advance is "Pengajuan Baru", reimburse unchanged; the transfer kind follows', () {
    expect(RequestType.advance.label, 'Pengajuan Baru');
    expect(RequestType.reimburse.label, 'Reimburse');
    expect(const TransferInfo(id: 1, kind: 'advance', amount: 1, status: 'posted').kindLabel, 'Pengajuan Baru');
  });

  group('D3 line editor', () {
    testWidgets('total = qty × harga satuan, live and read-only; "Selisih nota" only when nota differs', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        LineEditorScreen(
          line: const DraftLine(clientUuid: 'l-new', no: 1),
          masters: _masters,
        ),
      );
      // Total is a display, not an input.
      expect(find.descendant(of: find.byType(TextField), matching: find.byKey(const Key('line-total'))), findsNothing);
      expect(_text(tester, 'line-total'), '-');
      await tester.enterText(find.byKey(const Key('line-qty')), '2');
      await tester.enterText(find.byKey(const Key('line-unit-price')), '338500');
      await tester.pump();
      expect(_text(tester, 'line-total'), 'Rp 677.000');
      expect(find.text('Rp 338.500'), findsNothing); // formatter groups the input as 338.500 (no "Rp" inside)
      expect(find.text('338.500'), findsOneWidget);
      expect(find.byKey(const Key('line-receipt-mismatch')), findsNothing);
      expect(find.textContaining('Persetujuan dan transfer tetap memakai Total'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('line-receipt-amount')), '676876');
      await tester.pump();
      expect(find.byKey(const Key('line-receipt-mismatch')), findsOneWidget);
      expect(find.text('Selisih nota'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('line-receipt-amount')), '677000');
      await tester.pump();
      expect(find.byKey(const Key('line-receipt-mismatch')), findsNothing);

      // Decimal qty: 24,8 × 15.000.
      await tester.enterText(find.byKey(const Key('line-qty')), '24,8');
      await tester.enterText(find.byKey(const Key('line-unit-price')), '15000');
      await tester.pump();
      expect(_text(tester, 'line-total'), 'Rp 372.000');
    });

    testWidgets('qty, satuan and harga satuan are required on save', (tester) async {
      await pumpScreen(
        tester,
        LineEditorScreen(
          line: const DraftLine(clientUuid: 'l-new', no: 1),
          masters: _masters,
        ),
      );
      await tester.enterText(find.byKey(const Key('line-description')), 'Solar');
      await tester.tap(find.byKey(const Key('line-save')));
      await tester.pump();
      // qty, satuan (picker) and harga satuan
      expect(find.text('Wajib diisi'), findsNWidgets(3));
      expect(find.byType(LineEditorScreen), findsOneWidget, reason: 'not saved');
    });

    testWidgets('pre-D3 line (typed total, no harga satuan) opens with a prompt to fill it', (tester) async {
      await pumpScreen(
        tester,
        LineEditorScreen(
          line: const DraftLine(clientUuid: 'l-old', no: 3, description: 'Makan siang', total: 170500, categoryId: 1),
          masters: _masters,
        ),
      );
      expect(find.byKey(const Key('line-needs-unit-price')), findsOneWidget);
      expect(find.textContaining('total lama: Rp 170.500'), findsOneWidget);
      expect(find.text('Makan siang'), findsOneWidget);
    });

    testWidgets('draft lines list: Qty Satuan × Harga satuan, computed total, Selisih nota + prompt', (tester) async {
      final old = seedDraft().lines[2].copyWith(qty: null, uomId: null, unitPrice: null);
      final d = seedDraft().copyWith(lines: [...seedDraft().lines.sublist(0, 2), old]);
      await pumpScreen(tester, DraftEditorScreen(initial: d, masters: _masters, isNew: false));
      expect(_text(tester, 'line-2-total'), 'Rp 677.000');
      expect(find.textContaining('2 kamar × Rp 338.500 · Penginapan · 1 nota'), findsOneWidget);
      expect(find.byKey(const Key('line-2-receipt-mismatch')), findsOneWidget);
      expect(find.byKey(const Key('line-1-receipt-mismatch')), findsNothing);
      expect(find.byKey(const Key('line-3-needs-unit-price')), findsOneWidget);
      expect(_text(tester, 'preview-total'), 'Rp 1.447.500');
    });
  });

  group('D3 request detail', () {
    Future<void> pump(WidgetTester tester, Map<String, dynamic> json) => pumpScreen(
      tester,
      const RequestDetailScreen(id: 42),
      overrides: [requestDetailProvider(42).overrideWith((ref) async => detailFromJson(json))],
    );

    testWidgets('receiptAmount ≠ total → line chip only (no header chip); nota amount shown', (tester) async {
      await pump(tester, detailJson());
      expect(find.byKey(const Key('detail-receipt-mismatch')), findsNothing);
      expect(find.byKey(const Key('line-2-receipt-mismatch')), findsOneWidget);
      expect(find.byKey(const Key('line-1-receipt-mismatch')), findsNothing);
      expect(_text(tester, 'line-2-receipt-amount'), 'Nominal sesuai nota: Rp 676.876');
    });

    testWidgets('server read model wins: receiptMismatch false hides it, a flag shows it', (tester) async {
      final json = detailJson();
      final lines = [for (final l in json['lines'] as List) Map<String, dynamic>.of(l as Map<String, dynamic>)];
      lines[1]['receiptMismatch'] = false;
      lines[0]['receiptAmount'] = null;
      await pump(tester, {
        ...json,
        'lines': lines,
        'flags': [
          {
            'id': 9,
            'code': 'receipt_amount_mismatch',
            'kindLabel': 'Selisih nota',
            'level': 'info',
            'status': 'open',
            'lineNo': 1,
            'message': 'Nominal sesuai nota berbeda dari total baris.',
          },
        ],
      });
      expect(find.byKey(const Key('line-2-receipt-mismatch')), findsNothing);
      expect(find.byKey(const Key('line-1-receipt-mismatch')), findsOneWidget);
    });
  });

  group('LPJ photos (point 13)', () {
    final settlement = {
      'id': 3,
      'docNo': 'LPJ/2026/IX/0003',
      'status': 'revision',
      'statusLabel': 'Revisi',
      'usageNotes': 'BBM dan penginapan',
      'submitCount': 1,
    };

    test('photos parsed from ids or objects; limit 10', () {
      final s = settlementFromJson({
        ...settlement,
        'photos': [
          801,
          {'id': 802},
          {'imageId': 803},
          'x',
        ],
      })!;
      expect(s.photos, [801, 802, 803]);
      expect(s.editable, isTrue);
      expect(maxLpjPhotos, 10);
      expect(lpjPhotoSlots(0), 10);
      expect(lpjPhotoSlots(9), 1);
      expect(lpjPhotoSlots(10), 0);
      expect(lpjPhotoSlots(12), 0);
    });

    testWidgets('submit screen: 10 photos = full (camera/gallery disabled); removing one frees a slot', (tester) async {
      final ids = [for (var i = 1; i <= 10; i++) 800 + i];
      final s = settlementFromJson({...settlement, 'photos': ids})!;
      await pumpScreen(
        tester,
        LpjSubmitScreen(settlement: s, first: false),
        overrides: [for (final id in ids) receiptThumbProvider(id).overrideWith((ref) async => _png)],
      );
      expect(_text(tester, 'lpj-photo-count'), '10 / 10 foto');
      expect(find.byKey(const Key('lpj-photos-full')), findsOneWidget);
      expect(tester.widget<OutlinedButton>(find.byKey(const Key('lpj-photo-camera'))).onPressed, isNull);
      expect(tester.widget<OutlinedButton>(find.byKey(const Key('lpj-photo-gallery'))).onPressed, isNull);
      await tester.tap(find.byKey(const Key('lpj-photo-remove-server-801')));
      await tester.pump();
      expect(_text(tester, 'lpj-photo-count'), '9 / 10 foto');
      expect(tester.widget<OutlinedButton>(find.byKey(const Key('lpj-photo-camera'))).onPressed, isNotNull);
    });

    testWidgets('LPJ detail shows the photos read-only; tap opens the shared viewer', (tester) async {
      final s = settlementFromJson({
        ...settlement,
        'status': 'submitted',
        'photos': [801, 802],
      })!;
      expect(s.editable, isFalse);
      await pumpScreen(
        tester,
        Scaffold(body: LpjSection(settlement: s)),
        overrides: [
          receiptThumbProvider(801).overrideWith((ref) async => _png),
          receiptThumbProvider(802).overrideWith((ref) async => _png),
          receiptFullProvider(801).overrideWith((ref) async => _png),
          receiptFullProvider(802).overrideWith((ref) async => _png),
        ],
      );
      expect(find.byKey(const Key('lpj-photos')), findsOneWidget);
      expect(find.byKey(const Key('lpj-photo-801')), findsOneWidget);
      expect(find.byIcon(Icons.close), findsNothing, reason: 'no remove button on the detail');
      await tester.tap(find.byKey(const Key('receipt-thumb-802')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('photo-viewer')), findsOneWidget);
      expect(find.text('Foto LPJ 2'), findsOneWidget);
      expect(_text(tester, 'photo-viewer-counter'), '2 / 2');
    });

    testWidgets('LPJ submitted (no lpj_submit allowed): no submit button, photos only shown', (tester) async {
      final json = advanceJson(
        status: 'lpj_submitted',
        allowed: const [],
        settlement: {
          ...settlement,
          'status': 'submitted',
          'photos': [801],
        },
      );
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        overrides: [
          requestDetailProvider(42).overrideWith((ref) async => detailFromJson({...detailJson(), ...json})),
          receiptThumbProvider(801).overrideWith((ref) async => _png),
          receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(find.byKey(const Key('action-lpj-submit')), findsNothing);
      expect(find.byKey(const Key('lpj-photo-801')), findsOneWidget);
    });
  });

  group('submitLpjWithPhotos', () {
    test('uploads the new photos (POST /media/receipts) then sends every id; capped at 10', () async {
      final api = _RecordingApi();
      await submitLpjWithPhotos(
        api,
        requestId: 42,
        submission: LpjSubmission(
          usageNotes: ' BBM tim ',
          keptPhotoIds: [for (var i = 1; i <= 8; i++) i],
          newPhotos: [_png, _png, _png],
          hadPhotos: true,
        ),
        idempotencyKey: 'k-1',
      );
      expect(api.uploads, ['receipts', 'receipts'], reason: '8 kept + 2 new = 10; the third is dropped');
      expect((api.sent?.$1, api.sent?.$2), (RequesterAction.lpjSubmit, 'BBM tim'));
      expect(api.sent?.$3, [1, 2, 3, 4, 5, 6, 7, 8, 501, 502]);
    });

    test('no photos at all → no `photos` field (pre-d1010 body); all removed → empty list', () async {
      final api = _RecordingApi();
      await submitLpjWithPhotos(
        api,
        requestId: 42,
        submission: const LpjSubmission(usageNotes: 'BBM', keptPhotoIds: [], newPhotos: []),
        idempotencyKey: 'k-2',
      );
      expect(api.sent?.$3, isNull);
      await submitLpjWithPhotos(
        api,
        requestId: 42,
        submission: const LpjSubmission(usageNotes: 'BBM', keptPhotoIds: [], newPhotos: [], hadPhotos: true),
        idempotencyKey: 'k-3',
      );
      expect(api.sent?.$3, isEmpty);
    });
  });
}

class _RecordingApi extends ExpenseApi {
  _RecordingApi() : super(FakeExpenseApi().api.client);
  final uploads = <String>[];
  (RequesterAction, String?, List<int>?)? sent;
  var _next = 500;

  @override
  Future<int> uploadMedia(String kind, Uint8List bytes, {required String filename, String mime = 'image/jpeg'}) async {
    expect(filename, startsWith('lpj-'));
    uploads.add(kind);
    return ++_next;
  }

  @override
  Future<ExpenseDetail> requesterAction(
    int requestId,
    RequesterAction action, {
    required String idempotencyKey,
    String? usageNotes,
    List<int>? photos,
  }) async {
    sent = (action, usageNotes, photos);
    return detailFromJson(detailJson());
  }
}
