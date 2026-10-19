import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/home/domain/web_route_map.dart';
import 'package:proyekkas/features/records/domain/record_form.dart';
import 'package:proyekkas/features/records/domain/record_list.dart';

/// User 2026-10-19 (APK ↔ web parity, phase 7): Master Data, Media, Pengaturan, Sistem.
void main() {
  test('menu targets of phase 7', () {
    expect(apkTargetFor('/collections/banks')!.route, '/data/banks');
    expect(apkTargetFor('/vendor/baru')!.route, '/vendors/new');
    expect(apkTargetFor('/collections/media-receipts')!.route, '/data/media-receipts');
    expect(apkTargetFor('/collections/document-sequences')!.route, '/data/document-sequences');
    expect(apkTargetFor('/globals/company-settings')!.route, '/settings/app');
    expect(apkTargetFor('/audit-log')!.route, '/reports/audit-log');
  });

  test('media detail: the file path under /api/v1; images vs other files', () {
    final d = RecordDetail.fromJson({
      'collection': 'media-receipts',
      'label': 'Foto nota',
      'id': 12,
      'title': 'nota.jpg',
      'fields': [],
      'file': {'url': '/api/v1/media/receipts/12/file', 'mimeType': 'image/jpeg', 'filename': 'nota.jpg'},
    });
    expect(d.file!.path, '/media/receipts/12/file');
    expect(d.file!.isImage, isTrue);
    expect(
      RecordFile.fromJson({'url': '/api/v1/media/attachments/3/file', 'mimeType': 'application/pdf'})!.isImage,
      isFalse,
    );
    expect(RecordFile.fromJson(null), isNull);
  });

  test('global form (company-settings): update only, reason rule', () {
    final f = RecordFormDef.fromJson({
      'global': 'company-settings',
      'label': 'Setting aplikasi',
      'canUpdate': true,
      'reason': {'onUpdate': true},
      'fields': [
        {'key': 'timezone', 'label': 'Zona waktu', 'type': 'text', 'value': 'Asia/Makassar'},
      ],
    });
    expect(f.canUpdate, isTrue);
    expect(f.canCreate, isFalse);
    expect(f.reasonOnUpdate, isTrue);
    expect(f.fields.single.value, 'Asia/Makassar');
  });
}
