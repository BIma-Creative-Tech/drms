import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/platform/report_files.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/presentation/widgets/attachments.dart';
import 'package:proyekkas/features/field_reports/domain/field_models.dart';
import 'package:proyekkas/features/field_reports/presentation/field_hub_screen.dart';
import 'package:proyekkas/shared/widgets/media_thumb.dart';

import '../support/widget_harness.dart';

/// D2510 (user 2026-10-25): every image link of the APK has a thumbnail that opens the fullscreen viewer.
final _png = Uint8List.fromList(
  base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
);
final _pdf = Uint8List.fromList(utf8.encode('%PDF-1.4 bukti'));

class _Files implements ReportFiles {
  final calls = <String>[];
  @override
  Future<bool> save(String name, Uint8List bytes) async {
    calls.add('save:$name');
    return true;
  }

  @override
  Future<bool> open(String name) async {
    calls.add('open:$name');
    return true;
  }

  @override
  Future<bool> share(String name) async => true;

  @override
  Future<bool> download(String name) async => true;
}

void main() {
  test('paths: media file endpoint (thumb variant) and the attendance selfie endpoint', () {
    final m = MediaPhoto.media('transfer-proofs', 9);
    expect(m.path, '/media/transfer-proofs/9/file');
    expect(m.thumbVariant, isTrue);
    final s = MediaPhoto.selfie(301);
    expect(s.path, '/attendance/301/selfie');
    expect(s.thumbVariant, isFalse);
    expect(isPdfBytes(_pdf), isTrue);
    expect(isPdfBytes(_png), isFalse);
  });

  testWidgets('strip: thumbnail → viewer with caption, swipe, close', (tester) async {
    final photos = [
      MediaPhoto.selfie(301, caption: 'Absen masuk 07.58'),
      MediaPhoto.selfie(302, caption: 'Absen pulang'),
    ];
    await pumpScreen(
      tester,
      Scaffold(body: MediaThumbStrip(photos: photos)),
      overrides: [for (final p in photos) mediaImageProvider((p.path, false)).overrideWith((ref) async => _png)],
    );
    expect(find.byType(MediaThumb), findsNWidgets(2));
    await tester.tap(find.byKey(const Key('media-thumb-/attendance/302/selfie')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photo-viewer')), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('photo-viewer-counter'))).data, '2 / 2');
    expect(tester.widget<Text>(find.byKey(const Key('photo-viewer-caption'))).data, 'Absen pulang');
    expect(find.byType(InteractiveViewer), findsWidgets, reason: 'pinch zoom');
    await tester.tap(find.byKey(const Key('photo-viewer-close')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photo-viewer')), findsNothing);
  });

  testWidgets('a PDF stays a file link: saved and opened in the viewer app', (tester) async {
    final files = _Files();
    final proof = MediaPhoto.media('transfer-proofs', 9, fileName: 'bukti-transfer-TRF/1');
    await pumpScreen(
      tester,
      Scaffold(body: MediaThumb(photo: proof)),
      overrides: [
        // a PDF has no thumbnail variant: the server answers 404, the tile then loads the file itself
        mediaImageProvider((proof.path, true)).overrideWith((ref) async => throw const ProblemException(status: 404)),
        mediaImageProvider((proof.path, false)).overrideWith((ref) async => _pdf),
        reportFilesProvider.overrideWithValue(files),
      ],
    );
    expect(find.byIcon(Icons.picture_as_pdf), findsOneWidget);
    await tester.tap(find.byKey(Key('media-thumb-${proof.path}')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photo-viewer')), findsNothing);
    expect(files.calls, ['save:bukti-transfer-TRF_1.pdf', 'open:bukti-transfer-TRF_1.pdf']);
  });

  testWidgets('field report sheet: its photos as thumbnails', (tester) async {
    final record = FieldRecord(FieldReportType.serviceReport, {
      'id': 14,
      'docNo': 'SRV/1',
      'reportDate': '2026-10-25',
      'project': {'id': 41, 'code': 'P-41', 'name': 'Kontrak'},
      'photos': [
        {'id': 501},
        {'id': 502},
      ],
    });
    await pumpScreen(
      tester,
      Scaffold(body: FieldRecordSheet(record: record)),
      overrides: [
        for (final id in [501, 502])
          mediaImageProvider(('/media/progress-photos/$id/file', true)).overrideWith((ref) async => _png),
        for (final id in [501, 502])
          mediaImageProvider(('/media/progress-photos/$id/file', false)).overrideWith((ref) async => _png),
      ],
    );
    final strip = find.byKey(const Key('field-record-photos'));
    expect(find.descendant(of: strip, matching: find.byType(MediaThumb)), findsNWidgets(2));
    await tester.tap(find.byKey(const Key('media-thumb-/media/progress-photos/501/file')));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const Key('photo-viewer-counter'))).data, '1 / 2');
  });

  testWidgets('request attachments: a photo opens the in-app viewer, a PDF keeps its file link', (tester) async {
    await pumpScreen(
      tester,
      const Scaffold(
        body: RequestAttachmentList(
          attachments: [
            RequestAttachment(id: 7, fileName: 'foto-lokasi.jpg', mimeType: 'image/jpeg'),
            RequestAttachment(id: 8, fileName: 'invoice.pdf', mimeType: 'application/pdf'),
          ],
        ),
      ),
      overrides: [
        mediaImageProvider(('/media/attachments/7/file', true)).overrideWith((ref) async => _png),
        mediaImageProvider(('/media/attachments/7/file', false)).overrideWith((ref) async => _png),
      ],
    );
    expect(
      find.descendant(of: find.byKey(const Key('detail-attachment-7')), matching: find.byType(MediaThumb)),
      findsOneWidget,
    );
    expect(
      find.descendant(of: find.byKey(const Key('detail-attachment-8')), matching: find.byType(MediaThumb)),
      findsNothing,
    );
    await tester.tap(find.byKey(const Key('detail-attachment-7')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photo-viewer')), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('photo-viewer-caption'))).data, 'foto-lokasi.jpg');
  });
}
