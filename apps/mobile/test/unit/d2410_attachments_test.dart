import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/draft_validation.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/expense/presentation/widgets/attachments.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/seed.dart';

/// D2410 (point 6, user 2026-10-24) "Lampiran" on the APK: general attachments of a draft (photo / PDF) — required for
/// a Reimburse, optional for Pengajuan Baru — stored in `local_drafts.vendor_json`, sent as `attachment_ids` (local
/// files uploaded first), shown / opened on the detail screen. Fictional data.
const sub = 'kc-sub-d2410';

const local = DraftAttachment(fileName: 'kwitansi.pdf', mimeType: 'application/pdf', mediaUuid: 'att-1');
const onServer = DraftAttachment(fileName: 'rekap.jpg', mimeType: 'image/jpeg', serverFileId: 55);

void main() {
  group('validation', () {
    test('Reimburse without attachment: the server text; Pengajuan Baru stays optional', () {
      final r = validateForSubmit(seedDraft().copyWith(attachments: const []));
      expect(r.where((i) => i.field == 'attachments').map((i) => i.message), [reimburseAttachmentRequiredMessage]);
      expect(
        reimburseAttachmentRequiredMessage,
        'Lampiran wajib untuk Reimburse: unggah minimal 1 lampiran (foto/PDF).',
      );
      expect(validateForSubmit(seedDraft().copyWith(attachments: const [local])), isEmpty);
      final a = validateForSubmit(seedDraft(type: RequestType.advance));
      expect(a.where((i) => i.field == 'attachments'), isEmpty);
    });

    test('at most 20 attachments', () {
      final many = [
        for (var i = 0; i < 21; i++) DraftAttachment(fileName: 'f$i.jpg', mimeType: 'image/jpeg', mediaUuid: 'm$i'),
      ];
      final issues = validateForSubmit(seedDraft().copyWith(attachments: many));
      expect(issues.where((i) => i.field == 'attachments').map((i) => i.message), ['Maksimal 20 lampiran.']);
    });
  });

  group('model', () {
    test('local files are upload dependencies; server ones are not', () {
      final d = seedDraft().copyWith(attachments: const [local, onServer]);
      expect(d.mediaUuids, contains('att-1'));
      expect(d.mediaUuids, isNot(contains('55')));
      expect((local.isLocal, local.isPdf, onServer.isLocal), (true, true, false));
      final up = local.uploaded(91);
      expect((up.serverFileId, up.mediaUuid, up.fileName, up.isLocal), (91, 'att-1', 'kwitansi.pdf', false));
    });

    test('JSON round trip; unreadable entries are skipped', () {
      expect(DraftAttachment.fromJson(local.toJson()), local);
      expect(DraftAttachment.fromJson(onServer.toJson()), onServer);
      expect(DraftAttachment.fromJson({'fileName': 'x'}), isNull);
      expect(DraftAttachment.fromJson('nope'), isNull);
    });

    test('file type by name, PDF signature', () {
      expect(attachmentMimeOf('Nota.JPG'), 'image/jpeg');
      expect(attachmentMimeOf('a.jpeg'), 'image/jpeg');
      expect(attachmentMimeOf('scan.png'), 'image/png');
      expect(attachmentMimeOf('kwitansi.pdf'), 'application/pdf');
      expect(attachmentMimeOf('tabel.xlsx'), isNull);
      expect(attachmentMimeOf('tanpa-ekstensi'), isNull);
      expect(isPdfFile(Uint8List.fromList('%PDF-1.7'.codeUnits)), isTrue);
      expect(isPdfFile(Uint8List.fromList('GIF89a'.codeUnits)), isFalse);
      expect(attachmentMimeTypes, ['image/jpeg', 'image/png', 'application/pdf']);
    });
  });

  group('local storage (vendor_json)', () {
    test('an employee draft keeps its attachments; without any the column stays null', () async {
      final db = memoryDb();
      addTearDown(db.close);
      final repo = DraftRepository(db);
      final d = seedDraft().copyWith(attachments: const [local, onServer]);
      await repo.save(sub, d);
      final back = (await repo.load(sub, d.clientUuid))!;
      expect(back.attachments, const [local, onServer]);
      expect(back.payeeType, PayeeType.karyawan);
      expect(vendorToJson(seedDraft(type: RequestType.advance)), isNull);
      expect(withVendorJson(back, vendorToJson(back)).attachments, back.attachments);
    });

    test('a dropped local file is removed from the phone when the draft is saved', () async {
      final db = memoryDb();
      addTearDown(db.close);
      final repo = DraftRepository(db);
      final pdf = Uint8List.fromList('%PDF-1.7'.codeUnits);
      await repo.addMedia(sub, uuid: 'att-1', kind: 'attachment', bytes: pdf, sha256: 'x', mime: 'application/pdf');
      final d = seedDraft().copyWith(attachments: const [local]);
      await repo.save(sub, d);
      expect(await repo.media('att-1'), isNotNull);
      await repo.save(sub, d.copyWith(attachments: const [onServer]));
      expect(await repo.media('att-1'), isNull);
    });
  });

  group('payloads', () {
    test('sync: server ids + local placeholders → attachment_ids once uploaded', () {
      final p = draftToSyncPayload(seedDraft().copyWith(attachments: const [onServer, local]));
      expect(p['attachment_ids'], [55]);
      expect(p[attachmentsPlaceholderKey], ['att-1']);
      final ids = {for (final m in seedDraft().mediaUuids) m: 900};
      expect(resolveMediaIds(p, ids), isNull, reason: 'the PDF is not on the server yet');
      final resolved = resolveMediaIds(p, {...ids, 'att-1': 91})!;
      expect(resolved['attachment_ids'], [55, 91]);
      expect(resolved.containsKey(attachmentsPlaceholderKey), isFalse);
      final r1 = (((resolved['lines'] as List).first as Map)['receipts'] as List).single as Map;
      expect(r1['media_id'], 900, reason: 'the receipts are resolved as before');
      // no attachment: an empty list (the server list is replaced)
      final none = draftToSyncPayload(seedDraft(type: RequestType.advance));
      expect(none['attachment_ids'], isEmpty);
      expect(none.containsKey(attachmentsPlaceholderKey), isFalse);
    });

    test('create body (online "Ajukan"): the uploaded ids', () {
      final b = draftToCreateBody(seedDraft().copyWith(attachments: [onServer, local.uploaded(91)]));
      expect(b['attachmentIds'], [55, 91]);
      expect(draftToCreateBody(seedDraft(type: RequestType.advance)).containsKey('attachmentIds'), isFalse);
    });

    test('upload kind and file name', () {
      expect(mediaUploadPath('attachment'), 'attachments');
      expect(mediaFileName('u1', 'application/pdf'), 'u1.pdf');
      expect(mediaFileName('u1', 'image/png'), 'u1.png');
      expect(mediaFileName('u1', 'image/jpeg'), 'u1.jpg');
    });
  });

  group('detail', () {
    Map<String, dynamic> withAttachments() => {
      ...detailJson(status: 'draft', allowed: const ['edit', 'submit']),
      'attachments': [
        {'id': 55, 'fileName': 'rekap.jpg', 'mimeType': 'image/jpeg'},
        {'id': 56, 'fileName': null, 'mimeType': 'application/pdf'},
        {'fileName': 'tanpa id'},
      ],
    };

    test('attachments[] parsed (absent on older servers = empty)', () {
      final d = detailFromJson(withAttachments());
      expect(d.attachments, hasLength(2), reason: 'an entry without id is skipped');
      expect((d.attachments.first.id, d.attachments.first.label, d.attachments.first.isPdf), (55, 'rekap.jpg', false));
      expect((d.attachments.last.id, d.attachments.last.label, d.attachments.last.isPdf), (56, 'Lampiran #56', true));
      expect(detailFromJson(detailJson()).attachments, isEmpty);
      expect(attachmentCacheName(d.attachments.first), 'rekap.jpg');
      expect(attachmentCacheName(d.attachments.last), 'lampiran-56.pdf');
    });

    test('a server draft keeps its attachments on the server', () {
      final detail = detailFromJson(withAttachments());
      final d = draftFromServer(detail, clientUuid: 'c-1', receiptUuid: (i) => 'r-$i');
      expect(d.attachments.map((a) => a.serverFileId), [55, 56]);
      expect(d.attachments.map((a) => a.fileName), ['rekap.jpg', 'Lampiran #56']);
      expect(d.attachments.any((a) => a.isLocal), isFalse);
      expect(d.mediaUuids.where((m) => m.startsWith('att')), isEmpty);
    });
  });

  group('editor block', () {
    Future<void> pump(WidgetTester tester, Widget child) => tester.pumpWidget(
      MaterialApp(
        locale: const Locale('id'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(body: child),
      ),
    );

    testWidgets('label follows the rule; add / remove call back; the error is shown', (tester) async {
      final added = <AttachmentSource>[];
      final removed = <DraftAttachment>[];
      await pump(
        tester,
        DraftAttachmentsSection(
          attachments: const [local],
          mandatory: true,
          enabled: true,
          onAdd: added.add,
          onRemove: removed.add,
          error: reimburseAttachmentRequiredMessage,
        ),
      );
      expect(find.text('Lampiran (wajib untuk Reimburse)'), findsOneWidget);
      expect(find.text('kwitansi.pdf'), findsOneWidget);
      expect(find.byKey(const Key('draft-attachments-error')), findsOneWidget);
      await tester.tap(find.byKey(const Key('draft-attachment-file')));
      await tester.tap(find.byKey(const Key('draft-attachment-0-remove')));
      expect(added, [AttachmentSource.file]);
      expect(removed, [local]);

      await pump(
        tester,
        DraftAttachmentsSection(
          attachments: const [],
          mandatory: false,
          enabled: true,
          onAdd: added.add,
          onRemove: removed.add,
        ),
      );
      expect(find.text('Lampiran (opsional)'), findsOneWidget);
      expect(find.byKey(const Key('draft-attachments-error')), findsNothing);
    });
  });
}
