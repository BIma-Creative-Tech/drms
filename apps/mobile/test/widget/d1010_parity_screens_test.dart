import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/attendance/domain/attendance_recap.dart';
import 'package:proyekkas/features/attendance/presentation/recap_view.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/field_reports/presentation/widgets/field_widgets.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/shared/widgets/media_thumb.dart';

import '../support/fixtures.dart';
import '../support/seed.dart';
import '../support/widget_harness.dart';

/// 1×1 transparent PNG (a decodable image for Image.memory).
final _png = Uint8List.fromList(
  base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
);

/// Fictional two-PT account (CS6 Staff, CS7 Finance).
UserProfile _multi() => UserProfile(
  id: 5,
  email: 'rina@example.test',
  name: 'Rina Contoh',
  roles: const {Role.staff, Role.finance},
  capabilities: Capabilities.fromRoles(const {Role.staff, Role.finance}),
  employee: const Employee(id: 12, code: 'E12', name: 'Rina Contoh'),
  companies: const [
    CompanyMembership(id: 1, code: 'CS6', name: 'PT Contoh Enam', roles: {Role.staff}),
    CompanyMembership(id: 2, code: 'CS7', name: 'PT Contoh Tujuh', roles: {Role.finance}),
  ],
);

Map<String, dynamic> _twoReceipts() {
  final j = detailJson();
  return {
    ...j,
    'companyId': 1,
    'receipts': [
      ...(j['receipts'] as List),
      {
        'id': 502,
        'lineId': 'l2',
        'lineNo': 2,
        'receiptNo': 'INV-9',
        'vendorName': 'Hotel Contoh',
        'receiptDate': '2026-09-21',
        'amount': 677000,
        'imageId': 902,
        'status': 'pending',
      },
    ],
  };
}

Future<void> _pumpDetail(WidgetTester tester, Map<String, dynamic> json) => pumpScreen(
  tester,
  const RequestDetailScreen(id: 42),
  auth: AuthSignedIn(profile: _multi(), sub: 'user-sub-1'),
  overrides: [
    requestDetailProvider(42).overrideWith((ref) async => detailFromJson(json)),
    for (final id in [901, 902]) ...[
      receiptThumbProvider(id).overrideWith((ref) async => _png),
      receiptFullProvider(id).overrideWith((ref) async => _png),
    ],
  ],
);

void main() {
  group('request detail parity (WA-08/09/12)', () {
    testWidgets('section titles, PT inline "code — name", masked bank number', (tester) async {
      await _pumpDetail(tester, _twoReceipts());
      expect(find.text('Rincian pengajuan'), findsOneWidget);
      expect(find.text('Pemohon'), findsOneWidget);
      expect(find.text('Rekening tujuan'), findsOneWidget);
      expect(find.text('Alur pengajuan'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('detail-company'))).data, 'CS6 — PT Contoh Enam');
      expect(tester.widget<Text>(find.byKey(const Key('detail-bank-no'))).data, '•••0123');
      expect(find.text('Atas nama'), findsOneWidget);
    });

    testWidgets('docNo chip copies the number', (tester) async {
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') copied = (call.arguments as Map)['text'] as String?;
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      await _pumpDetail(tester, _twoReceipts());
      await tester.tap(find.byKey(const Key('docno-228/PB-DRMS/20/IX/2026')));
      await tester.pumpAndSettle();
      expect(copied, '228/PB-DRMS/20/IX/2026');
      expect(find.text('Nomor 228/PB-DRMS/20/IX/2026 disalin.'), findsOneWidget);
    });
  });

  group('image viewer (12c / WA-11)', () {
    testWidgets('receipt thumbnail opens the fullscreen viewer; swipe to the next receipt', (tester) async {
      await _pumpDetail(tester, _twoReceipts());
      // DRMS 13/10: on a tablet the stepper has its own column — scroll the main list.
      final main = find.descendant(of: find.byKey(const Key('detail-main')), matching: find.byType(Scrollable));
      await tester.scrollUntilVisible(find.byKey(const Key('receipt-thumb-901')), 200, scrollable: main.first);
      await tester.tap(find.byKey(const Key('receipt-thumb-901')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('photo-viewer')), findsOneWidget);
      expect(find.byType(InteractiveViewer), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('photo-viewer-counter'))).data, '1 / 2');
      expect(
        tester.widget<Text>(find.byKey(const Key('photo-viewer-caption'))).data,
        'Baris 1 · SPBU · No. 7654321 · Rp 600.000',
      );
      await tester.fling(find.byType(PageView), const Offset(-600, 0), 1000);
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(find.byKey(const Key('photo-viewer-counter'))).data, '2 / 2');
      expect(find.textContaining('Hotel Contoh'), findsWidgets);
      await tester.tap(find.byKey(const Key('photo-viewer-close')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('photo-viewer')), findsNothing);
    });

    testWidgets('attendance day: check-in / check-out selfies in the viewer', (tester) async {
      const day = AttendanceDay(
        date: '2026-10-05',
        weekday: 1,
        kind: 'workday',
        status: DayStatus.selesai,
        checkInLocal: '07:58',
        checkOutLocal: '17:02',
        locations: [
          LocationDay(
            location: LocationRef(kind: SiteKind.project, id: 7, code: 'P-07', name: 'Gudang Contoh'),
            checkIn: AttendanceMark(id: 301, time: '2026-10-04T23:58:00Z', source: 'self', corrected: false),
            checkOut: AttendanceMark(id: 302, time: '2026-10-05T09:02:00Z', source: 'self', corrected: false),
          ),
        ],
      );
      await pumpScreen(
        tester,
        const Scaffold(
          body: DayDetailSheet(day: day, zone: 'Asia/Makassar'),
        ),
        overrides: [
          for (final id in [301, 302])
            mediaImageProvider(('/attendance/$id/selfie', false)).overrideWith((ref) async => _png),
        ],
      );
      // D2510: both selfies are thumbnails on the location card; the first opens the viewer at 1 / 2
      expect(
        find.descendant(of: find.byKey(const Key('selfie-project-7')), matching: find.byType(MediaThumb)),
        findsNWidgets(2),
      );
      await tester.tap(find.byKey(const Key('media-thumb-/attendance/301/selfie')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('photo-viewer')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('photo-viewer-counter'))).data, '1 / 2');
      expect(tester.widget<Text>(find.byKey(const Key('photo-viewer-caption'))).data, contains('Absen masuk'));
    });
  });

  group('bank account preview (8e / WA-04)', () {
    final banks = [
      const MasterItem(4, 'MDR — Mandiri', extra: {'name': 'Mandiri'}),
    ];

    testWidgets('full number from the masters: masked first, eye reveals it', (tester) async {
      final masters = <String, List<MasterItem>>{
        MasterTypes.banks: banks,
        MasterTypes.employees: [const MasterItem(11, 'Budi'), const MasterItem(12, 'Doni Pratama')],
        MasterTypes.bankAccounts: [
          const MasterItem(
            21,
            'Mandiri · Doni Pratama · •••0123',
            extra: {'employee': 12, 'bank': 4, 'accountHolder': 'Doni Pratama', 'accountNo': '1234567890123'},
          ),
        ],
      };
      await pumpScreen(tester, DraftEditorScreen(initial: seedDraft(), masters: masters, isNew: false));
      expect(tester.widget<Text>(find.byKey(const Key('bank-preview-title'))).data, 'Mandiri · Doni Pratama');
      expect(tester.widget<Text>(find.byKey(const Key('bank-preview-number'))).data, '•••• 0123');
      await tester.tap(find.byKey(const Key('bank-preview-toggle')));
      await tester.pump();
      expect(tester.widget<Text>(find.byKey(const Key('bank-preview-number'))).data, '1234567890123');
    });

    testWidgets('number already masked: no eye toggle', (tester) async {
      final masters = <String, List<MasterItem>>{
        MasterTypes.banks: banks,
        MasterTypes.employees: [const MasterItem(11, 'Budi'), const MasterItem(12, 'Doni Pratama')],
        MasterTypes.bankAccounts: [
          const MasterItem(
            21,
            'Mandiri · Doni Pratama · •••0123',
            extra: {'employee': 12, 'bank': 4, 'accountHolder': 'Doni Pratama', 'accountNo': '••••0123'},
          ),
        ],
      };
      await pumpScreen(tester, DraftEditorScreen(initial: seedDraft(), masters: masters, isNew: false));
      expect(tester.widget<Text>(find.byKey(const Key('bank-preview-number'))).data, '••••0123');
      expect(find.byKey(const Key('bank-preview-toggle')), findsNothing);
    });
  });

  testWidgets('select placeholder is field-specific (WA-15)', (tester) async {
    final masters = <String, List<MasterItem>>{
      MasterTypes.employees: [const MasterItem(11, 'Budi'), const MasterItem(12, 'Doni Pratama')],
    };
    await pumpScreen(
      tester,
      DraftEditorScreen(
        initial: seedDraft().copyWith(bankAccountId: null, urgencyLevelId: null),
        masters: masters,
        isNew: false,
      ),
    );
    expect(find.text('Pilih tingkat urgensi'), findsOneWidget);
    expect(find.text('Pilih rekening tujuan'), findsOneWidget);
  });

  testWidgets('field-report date is a date picker limited to the allowed dates (WA-01)', (tester) async {
    String? chosen;
    await pumpScreen(
      tester,
      Scaffold(
        body: FieldDateField(
          key: const Key('daily-date'),
          value: '2026-10-11',
          dates: const ['2026-10-11', '2026-10-10', '2026-10-09'],
          label: 'Tanggal',
          onChanged: (v) => chosen = v,
        ),
      ),
    );
    await tester.tap(find.byKey(const Key('daily-date')));
    await tester.pumpAndSettle();
    expect(find.byType(DatePickerDialog), findsOneWidget);
    await tester.tap(find.text('10'));
    await tester.tap(find.text(MaterialLocalizations.of(tester.element(find.byType(DatePickerDialog))).okButtonLabel));
    await tester.pumpAndSettle();
    expect(chosen, '2026-10-10');
  });
}
