import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/format/rupiah.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/domain/dashboard.dart';
import 'package:proyekkas/features/dashboard/presentation/charts.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/domain/intercompany.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/finance/application/finance_providers.dart';
import 'package:proyekkas/features/finance/domain/transfer_queue.dart';
import 'package:proyekkas/features/finance/presentation/finance_screen.dart';
import 'package:proyekkas/features/finance/presentation/transfer_form_screen.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';

import '../support/d1010_c_fixtures.dart';
import '../support/fixtures.dart';
import '../support/seed.dart';
import '../support/widget_harness.dart';

/// DRMS 13/10 Phase B (ADR 0028) on the APK: "PT grup" in the draft editor (who sees it, receiving PT picker with the
/// masked account, document fields), the request detail, the transfer queue badge and the transfer form's 409 for a
/// closed period in the receiving PT. Fictional PTs and numbers.

const _las = IntercompanyPayee(
  companyId: 2,
  shortCode: 'LAS',
  name: 'PT Contoh Lestari',
  bankName: 'Mandiri',
  accountNoMasked: '••••4321',
  accountHolder: 'PT Contoh Lestari',
);

/// 1×1 transparent PNG.
final _png = Uint8List.fromList(
  base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
);

final _masters = <String, List<MasterItem>>{
  MasterTypes.employees: [const MasterItem(11, 'Budi'), const MasterItem(12, 'Doni Pratama')],
};

/// The payee directory as the server lists it to a Finance / PM / Direktur of the PT (masters `intercompany-payees`).
final _mastersWithDirectory = <String, List<MasterItem>>{
  ..._masters,
  MasterTypes.intercompanyPayees: [
    masterFromJson(MasterTypes.intercompanyPayees, {
      'id': 2,
      'payeeCompanyId': 2,
      'shortCode': 'LAS',
      'name': 'PT Contoh Lestari',
      'active': true,
    }),
  ],
};

Map<String, dynamic> _icDetail() => {
  ...detailJson(status: 'completed', allowed: const []),
  'type': 'advance',
  'typeLabel': 'Pembayaran antar-PT',
  'statusLabel': 'Selesai',
  'payeeType': 'pt_grup',
  'payeeCompany': {'id': 2, 'shortCode': 'LAS', 'name': 'PT Contoh Lestari'},
  'invoice': {'no': 'TAG/LAS/2610/007', 'date': '2026-10-10', 'dueDate': null, 'fileId': 78, 'fileName': 'tagihan.jpg'},
  'bank': {'bankName': 'Mandiri', 'accountNo': '•••4321', 'accountHolder': 'PT Contoh Lestari'},
  'settlement': null,
  'intercompany': {
    'status': 'posted',
    'targetEntryNo': 'KM/LAS/2610/0003',
    'targetCompany': {'id': 2, 'shortCode': 'LAS', 'name': 'PT Contoh Lestari'},
    'transferId': 5,
  },
  'transfers': [
    {
      'id': 5,
      'docNo': 'TRF/DRMS/2610/0007',
      'kind': 'advance',
      'amount': 1447500,
      'transferDate': '2026-10-12',
      'status': 'posted',
    },
  ],
};

TransferQueueItem _icQueueItem() => transferQueueItemFromJson({
  ...queueJson(46, type: 'advance'),
  'typeLabel': 'Pembayaran antar-PT',
  'payeeType': 'pt_grup',
  'payeeCompany': {'id': 2, 'shortCode': 'LAS', 'name': 'PT Contoh Lestari'},
  'payeeCompanyName': 'PT Contoh Lestari',
});

/// Finance API whose transfer is refused because the receiving PT closed the period (as the server answers).
class _ClosedPeriodFinanceApi extends FakeFinanceApi {
  @override
  Future<ExpenseDetail> recordTransfer(
    int requestId,
    Map<String, dynamic> body, {
    required String idempotencyKey,
  }) async {
    transfers.add((id: requestId, body: body, key: idempotencyKey));
    throw ProblemException.fromJson(409, {
      'title':
          'Periode 2026-10 PT LAS sudah ditutup (tutup buku s/d 2026-10-31). Transfer antar-PT tidak dapat dicatat pada '
          'tanggal ini — minta Direktur PT LAS membuka kembali periode itu, atau catat transfer dengan tanggal di periode '
          'terbuka.',
      'code': 'INTERCOMPANY_PERIOD_CLOSED',
      'payeeCompanyId': 2,
      'lockDate': '2026-10-31',
    });
  }
}

/// [profile] with the server's ADR 0028 `/me` capability `intercompanyPayment` (null = a server before the field).
UserProfile _withIcCapability(Set<Role> roles, bool? may) {
  final p = profile(roles);
  return p.copyWith(capabilities: p.capabilities.copyWith(intercompanyPayment: may));
}

/// Direktur dashboard whose latest month carries "Antar PT" parts and whose recent cash lists both legs of a payment
/// between PTs: the paying PT's KK (source type `transfer`, counterpart set) and a receiving PT's KM.
Map<String, dynamic> _icOwnerJson() {
  final j = direkturDashboardJson();
  return {
    ...j,
    'cashFlow': {
      'basis': 'K-02b',
      'months': 2,
      'rows': [
        {'period': '2026-09', 'masuk': 30000000, 'keluar': 20000000},
        {'period': '2026-10', 'masuk': 40000000, 'keluar': 12500000, 'masukAntarPt': 7500000, 'keluarAntarPt': 2500000},
      ],
    },
    'viz': {
      ...(j['viz'] as Map<String, dynamic>),
      'recentCash': [
        {
          'id': 32,
          'companyId': 1,
          'entryNo': 'KK/DRMS/2610/0009',
          'entryDate': '2026-10-12',
          'direction': 'out',
          'amount': 2500000,
          'status': 'posted',
          'sourceType': 'transfer',
          'account': 'Bank Operasional',
          'label': 'Transfer TRF/DRMS/2610/0007',
          'requestId': 46,
          'requestDocNo': 'PB/DRMS/2610/0012',
          'intercompany': {
            'direction': 'out',
            'status': 'posted',
            'counterpartCompany': {'id': 2, 'shortCode': 'LAS', 'name': 'PT Contoh Lestari'},
            'sourceDocNo': 'PB/DRMS/2610/0012',
            'sourceDocId': 46,
            'transferDocNo': 'TRF/DRMS/2610/0007',
            'counterpartEntryNo': 'KM/LAS/2610/0003',
            'counterpartEntryId': 31,
            'canOpenCounterpart': false,
            'canOpenSourceDoc': true,
          },
        },
        {
          'id': 33,
          'companyId': 1,
          'entryNo': 'KK/DRMS/2610/0010',
          'entryDate': '2026-10-12',
          'direction': 'out',
          'amount': 900000,
          'status': 'posted',
          'sourceType': 'transfer',
          'account': 'Kas Kecil',
          'label': 'Transfer pengajuan',
          'requestId': 47,
          'requestDocNo': 'PB/DRMS/2610/0013',
          'intercompany': null,
        },
      ],
    },
  };
}

Finder _submitButton() =>
    find.descendant(of: find.byKey(const Key('submit-draft')), matching: find.bySubtype<FilledButton>());

void main() {
  group('draft editor "PT grup"', () {
    testWidgets('Finance: PT grup → receiving PT with the masked account, document fields required', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: _masters, isNew: false),
        auth: AuthSignedIn(profile: profile(const {Role.finance}), sub: 's'),
        overrides: [
          intercompanyPayeesProvider.overrideWith((ref, companyId) async => const [_las]),
        ],
      );
      expect(find.byKey(const Key('draft-payee-type')), findsOneWidget);
      expect(find.text('Vendor'), findsOneWidget);
      await tester.tap(find.byKey(const Key('draft-payee-pt-grup')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('draft-intercompany-hint')), findsOneWidget);
      // Pengajuan Baru, Pemohon = the filer, no employee account (as a vendor payment)
      expect(find.text('Diajukan oleh (pemohon)'), findsNothing);
      expect(find.byKey(const Key('draft-payee-company')), findsOneWidget);
      expect(find.text('Nomor dokumen'), findsWidgets);
      expect(find.text('Tagihan / memo dari PT penerima'), findsOneWidget);

      await tester.tap(find.byKey(const Key('draft-payee-company')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, 'LAS — PT Contoh Lestari'));
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(find.byKey(const Key('ic-account-title'))).data, 'Mandiri · PT Contoh Lestari');
      expect(
        tester.widget<Text>(find.byKey(const Key('ic-account-number'))).data,
        '••••4321 · Rekening penerimaan antar-PT',
      );

      await tester.ensureVisible(_submitButton());
      await tester.tap(_submitButton());
      await tester.pumpAndSettle();
      final issues = tester.widget<Text>(find.byKey(const Key('draft-issues'))).data!;
      expect(issues, contains('Nomor dokumen (tagihan / memo PT penerima) wajib diisi.'));
      expect(issues, contains('Tanggal dokumen wajib diisi.'));
      expect(issues, contains('Foto dokumen (tagihan / memo PT penerima) wajib dilampirkan.'));
      expect(issues, isNot(contains('PT penerima wajib dipilih.')));
      expect(find.byKey(const Key('submit-confirm')), findsNothing);
    });

    testWidgets('empty directory: a hint instead of a silent empty picker', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: _masters, isNew: false),
        auth: AuthSignedIn(profile: profile(const {Role.pm}), sub: 's'),
        overrides: [intercompanyPayeesProvider.overrideWith((ref, companyId) async => const [])],
      );
      await tester.tap(find.byKey(const Key('draft-payee-pt-grup')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('draft-payee-company-none')), findsOneWidget);
    });

    testWidgets('Direktur: "PT grup" but no "Vendor" (owner decision 1)', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: _masters, isNew: false),
        auth: AuthSignedIn(profile: profile(const {Role.owner}), sub: 's'),
      );
      expect(find.byKey(const Key('draft-payee-pt-grup')), findsOneWidget);
      expect(find.text('Vendor'), findsNothing);
    });

    testWidgets('Owner-only (pk-principal): no "PT grup" (the directory is not listed to him)', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: _masters, isNew: false),
        auth: AuthSignedIn(profile: profile(Role.effective({Role.principal})), sub: 's'),
      );
      expect(find.byKey(const Key('draft-payee-type')), findsNothing);
      expect(find.byKey(const Key('draft-payee-pt-grup')), findsNothing);
    });

    testWidgets('Staff: no payee choice at all', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: _masters, isNew: false),
        auth: AuthSignedIn(profile: profile(const {Role.staff}), sub: 's'),
      );
      expect(find.byKey(const Key('draft-payee-type')), findsNothing);
    });

    testWidgets('/me capability intercompanyPayment false (Owner-only): no "PT grup" even with a cached directory', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: _mastersWithDirectory, isNew: false),
        auth: AuthSignedIn(profile: _withIcCapability(Role.effective({Role.principal}), false), sub: 's'),
      );
      expect(find.byKey(const Key('draft-payee-pt-grup')), findsNothing);
      expect(find.byKey(const Key('draft-payee-type')), findsNothing);
    });

    testWidgets('/me capability intercompanyPayment true (Owner + Direktur): "PT grup" without a cached directory', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: _masters, isNew: false),
        auth: AuthSignedIn(profile: _withIcCapability(Role.effective({Role.principal}), true), sub: 's'),
      );
      expect(find.byKey(const Key('draft-payee-pt-grup')), findsOneWidget);
      expect(find.text('Vendor'), findsNothing, reason: 'vendor payments stay Finance / PM');
    });

    testWidgets('capability false wins over the roles: Finance keeps "Vendor" but no "PT grup"', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: _mastersWithDirectory, isNew: false),
        auth: AuthSignedIn(profile: _withIcCapability(const {Role.finance}, false), sub: 's'),
      );
      expect(find.text('Vendor'), findsOneWidget);
      expect(find.byKey(const Key('draft-payee-pt-grup')), findsNothing);
    });

    testWidgets('Owner who also holds Direktur (directory listed by the server): "PT grup"', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: _mastersWithDirectory, isNew: false),
        auth: AuthSignedIn(profile: profile(Role.effective({Role.principal})), sub: 's'),
      );
      expect(find.byKey(const Key('draft-payee-pt-grup')), findsOneWidget);
    });
  });

  testWidgets('detail: receiving PT, document, KM number in the receiving PT, receiving account, no LPJ', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      const RequestDetailScreen(id: 42),
      auth: AuthSignedIn(profile: profile(const {Role.finance}), sub: 's'),
      overrides: [
        requestDetailProvider(42).overrideWith((ref) async => detailFromJson(_icDetail())),
        receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
      ],
    );
    expect(find.byKey(const Key('section-intercompany')), findsOneWidget);
    String? text(String key) => tester.widget<Text>(find.byKey(Key(key))).data;
    expect(text('detail-payee-company'), 'LAS — PT Contoh Lestari');
    expect(text('detail-invoice-no'), 'TAG/LAS/2610/007');
    expect(text('detail-invoice-file'), 'tagihan.jpg');
    expect(text('detail-intercompany-entry'), 'KM/LAS/2610/0003');
    expect(find.text('Kas masuk di PT LAS'), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('section-bank')), matching: find.text('Rekening penerimaan antar-PT')),
      findsOneWidget,
    );
    expect(find.text('LPJ'), findsNothing, reason: 'a PT grup payment has no LPJ step');
    expect(find.textContaining('pembayaran antar-PT selesai saat ditransfer'), findsOneWidget);
  });

  testWidgets('transfer queue: badge "Antar PT: LAS"', (tester) async {
    await pumpScreen(
      tester,
      const FinanceScreen(),
      auth: AuthSignedIn(profile: profile(const {Role.finance}), sub: 's'),
      overrides: [
        transferQueueProvider.overrideWith((ref) async => [_icQueueItem(), transferQueueItemFromJson(queueJson(45))]),
        lpjQueueProvider.overrideWith((ref) async => const []),
      ],
    );
    expect(find.byKey(const Key('tq-46-intercompany')), findsOneWidget);
    expect(find.text('Antar PT: LAS'), findsOneWidget);
    expect(find.byKey(const Key('tq-45-intercompany')), findsNothing);
  });

  testWidgets('transfer form: Antar PT note; the receiving PT\'s closed period → its message, nothing recorded', (
    tester,
  ) async {
    final api = _ClosedPeriodFinanceApi();
    await pumpScreen(
      tester,
      TransferFormScreen(item: _icQueueItem()),
      auth: AuthSignedIn(profile: profile(const {Role.finance}), sub: 's'),
      overrides: [
        financeApiProvider.overrideWithValue(api),
        photoCompressorProvider.overrideWithValue(FakeCompressor()),
        proofPickerProvider.overrideWithValue((context, {required fromCamera}) async => _png),
      ],
    );
    expect(
      tester.widget<Text>(find.byKey(const Key('transfer-intercompany-note'))).data,
      'Antar PT: kas masuk di PT LAS tercatat otomatis dengan tanggal transfer ini.',
    );
    await tester.tap(find.byKey(const Key('transfer-at')));
    await tester.pumpAndSettle();
    final ok = MaterialLocalizations.of(tester.element(find.byType(TransferFormScreen))).okButtonLabel;
    await tester.tap(find.text(ok));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ok));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('transfer-bank-ref')), 'REF-1001');
    await tester.tap(find.byKey(const Key('transfer-proof-gallery')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(of: find.byKey(const Key('transfer-submit')), matching: find.bySubtype<FilledButton>()),
    );
    await tester.pumpAndSettle();
    expect(api.transfers, hasLength(1));
    expect(find.byKey(const Key('transfer-error')), findsOneWidget);
    expect(find.textContaining('Periode 2026-10 PT LAS sudah ditutup (tutup buku s/d 2026-10-31)'), findsOneWidget);
    expect(find.byType(TransferFormScreen), findsOneWidget, reason: 'stays on the form');
  });

  group('dashboard "Antar PT"', () {
    testWidgets('recent cash: the paying PT\'s KK (source type transfer) is labelled "Antar PT" with its counterpart', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        const Scaffold(body: SingleChildScrollView(child: DirekturKpis())),
        auth: AuthSignedIn(profile: profile(const {Role.owner}), sub: 's'),
        overrides: [direkturDashboardProvider.overrideWith((ref) async => DirekturDashboard.fromJson(_icOwnerJson()))],
      );
      final kk = find.byKey(const Key('dash-cash-32-ic'));
      await tester.ensureVisible(kk);
      expect(tester.widget<Text>(kk).data, 'Antar PT · Ke PT LAS · KM/LAS/2610/0003');
      expect(find.byKey(const Key('dash-cash-33-ic')), findsNothing, reason: 'an ordinary transfer');
    });

    testWidgets('Direktur cash flow: "Tanpa antar-PT" leaves both legs out of the readout (web toggle); off again '
        'restores', (tester) async {
      await pumpScreen(
        tester,
        const Scaffold(body: SingleChildScrollView(child: DirekturKpis())),
        auth: AuthSignedIn(profile: profile(const {Role.owner}), sub: 's'),
        overrides: [direkturDashboardProvider.overrideWith((ref) async => DirekturDashboard.fromJson(_icOwnerJson()))],
      );
      String readout() => tester.widget<Text>(find.byKey(const Key('cashflow-readout'))).data!;
      final chip = find.byKey(const Key('cashflow-without-antar-pt'));
      expect(chip, findsOneWidget);
      expect(find.descendant(of: chip, matching: find.text('Tanpa antar-PT')), findsOneWidget);
      expect(readout(), allOf(contains(formatRupiah(40000000)), contains(formatRupiah(12500000))));
      expect(find.byKey(const Key('cashflow-antar-pt')), findsOneWidget);

      await tester.ensureVisible(chip);
      await tester.tap(chip);
      await tester.pumpAndSettle();
      expect(readout(), allOf(contains(formatRupiah(32500000)), contains(formatRupiah(10000000))));
      expect(find.byKey(const Key('cashflow-antar-pt')), findsNothing);
      expect(
        tester.widget<Text>(find.byKey(const Key('cashflow-antar-pt-excluded'))).data,
        'Tanpa antar-PT: masuk ${formatRupiah(7500000)} · keluar ${formatRupiah(2500000)} tidak dihitung',
      );

      await tester.tap(chip);
      await tester.pumpAndSettle();
      expect(readout(), contains(formatRupiah(40000000)));
      expect(find.byKey(const Key('cashflow-antar-pt-excluded')), findsNothing);
    });

    testWidgets('no "Antar PT" figures in the range: no toggle', (tester) async {
      await pumpScreen(
        tester,
        Scaffold(
          body: CashFlowChart(
            rows: const [CashFlowPoint('2026-10', 1000, 500)],
            labelIn: 'Masuk',
            labelOut: 'Keluar',
            withoutIntercompanyToggle: (label: 'Tanpa antar-PT', excludedNote: (m, k) => '$m $k'),
          ),
        ),
      );
      expect(find.byKey(const Key('cashflow-readout')), findsOneWidget);
      expect(find.byKey(const Key('cashflow-without-antar-pt')), findsNothing);
    });
  });
}
