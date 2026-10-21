import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/domain/dashboard.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/draft_validation.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/domain/intercompany.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/expense/domain/turn_timeline.dart';
import 'package:proyekkas/features/finance/domain/transfer_queue.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

import '../support/d1010_c_fixtures.dart';
import '../support/fixtures.dart';
import '../support/harness.dart';

/// DRMS 13/10 Phase B (ADR 0028) "Pembayaran antar-PT" (payee "PT grup") on the APK: payee type, draft payee JSON (no
/// drift bump), create / sync payloads, validation (receiving PT + mandatory document), read model + stepper, who may
/// file, payee directory, intercompany refusals in Indonesian, transfer queue, cash list / cash flow "Antar PT".
/// Fictional PTs and numbers.
const sub = 'kc-sub-ic';

DraftRequest icDraft({String? invoiceMediaUuid = 'doc-photo-1', int? invoiceFileId}) => DraftRequest(
  clientUuid: '0192f2a0-2222-7000-8000-000000000001',
  type: RequestType.reimburse, // the payee type wins: a PT grup payment is always Pengajuan Baru
  companyId: 1,
  title: 'Jasa alat berat dari PT LAS',
  projectId: 9,
  requesterIds: const [12],
  bankAccountId: 21, // never sent for a PT grup payment
  payeeType: PayeeType.ptGrup,
  payeeCompanyId: 2,
  invoiceNo: ' TAG/LAS/2610/007 ',
  invoiceDate: '2026-10-10',
  invoiceMediaUuid: invoiceMediaUuid,
  invoiceFileId: invoiceFileId,
  lines: const [
    DraftLine(
      clientUuid: 'l-1',
      no: 1,
      description: 'Sewa excavator 3 hari',
      qty: 3,
      uomId: 3,
      unitPrice: 2500000,
      rapItemId: 501,
      categoryId: 1,
    ),
  ],
);

Map<String, dynamic> icDetailJson({String status = 'completed', bool transferred = true, bool voided = false}) => {
  ...detailJson(status: status, allowed: const []),
  'type': 'advance',
  'typeLabel': 'Pembayaran antar-PT',
  'payeeType': 'pt_grup',
  'vendor': null,
  'payeeCompany': {'id': 2, 'shortCode': 'LAS', 'name': 'PT Contoh Lestari'},
  'invoice': {
    'no': 'TAG/LAS/2610/007',
    'date': '2026-10-10',
    'dueDate': null,
    'fileId': 78,
    'fileName': 'tagihan.jpg',
    'mimeType': 'image/jpeg',
  },
  'bank': {'bankName': 'Mandiri', 'accountNo': '•••4321', 'accountHolder': 'PT Contoh Lestari'},
  'settlement': null,
  'intercompany': transferred
      ? {
          'status': voided ? 'void' : 'posted',
          'targetEntryNo': 'KM/LAS/2610/0003',
          'targetCompany': {'id': 2, 'shortCode': 'LAS', 'name': 'PT Contoh Lestari'},
          'transferId': 5,
        }
      : null,
  'transfers': transferred
      ? [
          {
            'id': 5,
            'docNo': 'TRF/DRMS/2610/0007',
            'kind': 'advance',
            'amount': 7500000,
            'transferDate': '2026-10-12',
            'status': voided ? 'void' : 'posted',
          },
        ]
      : const [],
};

void main() {
  test('payee type pt_grup: code, label, direct payment; unknown codes stay karyawan', () {
    expect(PayeeType.fromCode('pt_grup'), PayeeType.ptGrup);
    expect((PayeeType.ptGrup.code, PayeeType.ptGrup.label), ('pt_grup', 'PT grup'));
    expect(PayeeType.fromCode('vendor'), PayeeType.vendor);
    expect(PayeeType.fromCode('something_new'), PayeeType.karyawan);
    expect(PayeeType.fromCode(null), PayeeType.karyawan);
    expect([for (final p in PayeeType.values) p.isDirect], [false, true, true]);
    final d = icDraft();
    expect((d.isPtGrup, d.isVendor, d.isDirectPayment), (true, false, true));
    expect(d.mediaUuids, contains('doc-photo-1'));
    expect(icDraft(invoiceFileId: 78).mediaUuids, isNot(contains('doc-photo-1')), reason: 'already on the server');
  });

  test('local draft: payee JSON keeps the receiving PT (no drift schema bump); vendor JSON unchanged', () async {
    final db = memoryDb();
    addTearDown(db.close);
    final repo = DraftRepository(db);
    await repo.save(sub, icDraft());
    final back = (await repo.load(sub, icDraft().clientUuid))!;
    expect((back.payeeType, back.payeeCompanyId), (PayeeType.ptGrup, 2));
    expect(
      (back.invoiceNo, back.invoiceDate, back.invoiceMediaUuid),
      (' TAG/LAS/2610/007 ', '2026-10-10', 'doc-photo-1'),
    );
    expect(back.bankAccountId, isNull, reason: 'no employee account on a PT grup payment');
    expect(vendorToJson(icDraft()), contains('"payeeCompanyId":2'));
    final vendor = icDraft().copyWith(payeeType: PayeeType.vendor, vendorId: 3, vendorBankAccountId: 31);
    expect(vendorToJson(vendor), isNot(contains('payeeCompanyId')));
    // a payee JSON written before ADR 0028 (no key) reads as before
    expect(withVendorJson(icDraft(), '{"payeeType":"vendor","vendorId":3}').payeeCompanyId, isNull);
    // back to an employee payment: the payee data is gone
    await repo.save(sub, back.copyWith(payeeType: PayeeType.karyawan, payeeCompanyId: null, invoiceMediaUuid: null));
    final again = (await repo.load(sub, icDraft().clientUuid))!;
    expect((again.isPtGrup, again.payeeCompanyId, again.invoiceNo), (false, null, null));
  });

  test('sync payload: kind advance, payee_type pt_grup + payee_company_id, document photo placeholder', () {
    final p = draftToSyncPayload(icDraft());
    expect(p['kind'], 'advance');
    expect((p['payee_type'], p['payee_company_id']), ('pt_grup', 2));
    expect(p.containsKey('vendor_id'), isFalse);
    expect(p.containsKey('vendor_bank_account_id'), isFalse);
    expect((p['invoice_no'], p['invoice_date'], p['invoice_due_date']), ('TAG/LAS/2610/007', '2026-10-10', null));
    expect(p['bank_account_id'], isNull);
    expect(p[invoicePlaceholderKey], 'doc-photo-1');
    expect(resolveMediaIds(p, const {}), isNull, reason: 'the photo is not on the server yet');
    expect(resolveMediaIds(p, const {'doc-photo-1': 78})!['invoice_file_id'], 78);
    // ADR 0031: no project → no Pusat Biaya; a legacy cost center is never sent
    final onCc = icDraft().copyWith(projectId: null, costCenterId: 7);
    expect(draftToSyncPayload(onCc).containsKey('cost_center_id'), isFalse);
    expect(draftToCreateBody(onCc).containsKey('costCenterId'), isFalse);
  });

  test('create body (online "Ajukan"): payeeType pt_grup, payeeCompanyId, the uploaded document id', () {
    final b = draftToCreateBody(icDraft(invoiceMediaUuid: null, invoiceFileId: 78));
    expect(b['type'], 'advance');
    expect((b['payeeType'], b['payeeCompanyId'], b['invoiceFileId']), ('pt_grup', 2, 78));
    expect(b['invoiceNo'], 'TAG/LAS/2610/007');
    expect(b.containsKey('vendorId'), isFalse);
    expect(b['bankAccountId'], isNull);
  });

  test('validation: receiving PT + document number / date / file mandatory (owner 2026-10-14), due date optional', () {
    expect(validateForSubmit(icDraft()), isEmpty);
    final empty = icDraft(invoiceMediaUuid: null).copyWith(payeeCompanyId: null, invoiceNo: ' / ', invoiceDate: null);
    final issues = validateForSubmit(empty);
    expect(issues.map((i) => i.field).toSet(), {'payeeCompanyId', 'invoiceNo', 'invoiceDate', 'invoiceFile'});
    expect(issues.map((i) => i.message), contains('PT penerima wajib dipilih.'));
    expect(issues.map((i) => i.message), contains('Nomor dokumen harus memuat huruf atau angka.'));
    expect(
      validateForSubmit(icDraft().copyWith(invoiceNo: null)).single.message,
      'Nomor dokumen (tagihan / memo PT penerima) wajib diisi.',
    );
    expect(
      validateForSubmit(icDraft().copyWith(payeeCompanyId: 1)).single.message,
      'PT penerima harus PT lain di grup, bukan PT pengajuan ini.',
    );
    expect(
      validateForSubmit(icDraft().copyWith(invoiceDueDate: '2026-10-01')).single.message,
      'Jatuh tempo tidak boleh sebelum tanggal dokumen.',
    );
    // no employee account, no receipts needed; ADR 0031: the project is optional (no Pusat Biaya without one)
    expect(validateForSubmit(icDraft().copyWith(projectId: null, lines: const [])).map((i) => i.field), ['lines']);
    expect(validateForSubmit(icDraft().copyWith(projectId: null)), isEmpty);
    // the vendor wording is unchanged
    final vendor = icDraft().copyWith(
      payeeType: PayeeType.vendor,
      vendorId: 3,
      vendorBankAccountId: 31,
      invoiceNo: null,
    );
    expect(validateForSubmit(vendor).single.message, 'Nomor invoice wajib diisi.');
  });

  test('read model + stepper: receiving PT, document, KM number in the receiving PT, no LPJ step', () {
    final d = detailFromJson(icDetailJson());
    expect((d.isPtGrup, d.isDirectPayment, d.isVendor), (true, true, false));
    expect((d.payeeCompany?.id, d.payeeCompany?.code, d.payeeCompany?.name), (2, 'LAS', 'PT Contoh Lestari'));
    expect((d.invoiceNo, d.invoiceFileId, d.invoiceFileName), ('TAG/LAS/2610/007', 78, 'tagihan.jpg'));
    expect(d.intercompany, isNotNull);
    expect(
      (d.intercompany!.targetEntryNo, d.intercompany!.voided, d.intercompany!.companyCode),
      ('KM/LAS/2610/0003', false, 'LAS'),
    );
    final steps = buildRequestStepper(d);
    expect(steps.map((s) => s.title), isNot(contains(lpjStepTitle)));
    expect(steps.last.title, doneStepTitle);
    expect(steps.last.note, intercompanyDoneNote);
    final transfer = steps.firstWhere((s) => s.title == transferStepTitle);
    expect(transfer.note, 'TRF/DRMS/2610/0007 · Kas masuk di PT LAS: KM/LAS/2610/0003');
    final waiting = detailFromJson(icDetailJson(status: 'approved', transferred: false));
    expect(waiting.intercompany, isNull);
    expect(currentTurn(waiting), 'Finance — transfer ke rekening penerimaan antar-PT');
    expect(buildRequestStepper(waiting).map((s) => s.title), isNot(contains(lpjStepTitle)));
    // void of the transfer: the reversal is noted
    final voided = detailFromJson(icDetailJson(status: 'approved', voided: true));
    expect(voided.intercompany!.voided, isTrue);
    expect(intercompanyEntryNote(voided.intercompany!), endsWith('(dibatalkan — jurnal balik tercatat)'));
    // "Ajukan ulang" / withdraw → the local draft keeps the receiving PT and the document on the server
    final local = draftFromServer(
      detailFromJson(icDetailJson(status: 'draft', transferred: false)),
      clientUuid: 'x',
      receiptUuid: (i) => '$i',
    );
    expect((local.payeeType, local.payeeCompanyId, local.invoiceFileId), (PayeeType.ptGrup, 2, 78));
    expect(summaryFromJson({...icDetailJson(), 'payeeType': 'pt_grup'}).payeeType, PayeeType.ptGrup);
    // a server before ADR 0028: no payee company, no intercompany
    final old = detailFromJson(detailJson());
    expect((old.payeeCompany, old.intercompany, old.isPtGrup), (null, null, false));
  });

  test('who may file (owner decision 1): Finance, PM, Direktur — not an Owner-only user, Staff or Admin', () {
    bool may(Set<Role> r, {bool listed = false}) => mayFileIntercompanyPayment(r, directoryListed: listed);
    expect(may({Role.finance}), isTrue);
    expect(may({Role.pm}), isTrue);
    expect(may({Role.owner}), isTrue, reason: 'Direktur');
    expect(may({Role.staff}), isFalse);
    expect(may({Role.admin}), isFalse);
    expect(may({Role.operator}), isFalse);
    // /me lists effective roles: an Owner also carries pk-owner — the directory (listed only to a stored
    // Finance / PM / Direktur) decides
    expect(may(Role.effective({Role.principal})), isFalse);
    expect(may(Role.effective({Role.principal}), listed: true), isTrue);
    expect(may(Role.effective({Role.principal, Role.finance})), isTrue);
  });

  test(
    'who may file: the /me capability intercompanyPayment wins; the directory is only the older-server fallback',
    () {
      bool may(Set<Role> r, bool? cap, {bool listed = false}) =>
          mayFileIntercompanyPayment(r, capability: cap, directoryListed: listed);
      final ownerOnly = Role.effective({Role.principal});
      expect(may(ownerOnly, false, listed: true), isFalse, reason: 'a stale cached directory does not override it');
      expect(may(ownerOnly, true), isTrue, reason: 'Owner who also holds Direktur / Finance / PM');
      expect(may({Role.finance}, false), isFalse);
      expect(may({Role.staff}, true), isTrue, reason: 'the server answer, not the local role guess');
      expect(may(ownerOnly, null), isFalse);
      expect(may(ownerOnly, null, listed: true), isTrue);
    },
  );

  test('/me capability intercompanyPayment per PT: parsed (absent → null), PT scope = union, forCompany per PT', () {
    Map<String, dynamic> company(int id, List<String> roles, Object? may) => {
      'id': id,
      'code': 'PT$id',
      'name': 'PT Contoh $id',
      'roles': roles,
      'capabilities': {
        'approvalInbox': true,
        'teamMonitor': false,
        'progressReportCreate': true,
        'intercompanyPayment': ?may,
      },
    };
    final p = userProfileFromJson({
      ...meJson(roles: const ['pk-owner', 'pk-principal', 'pk-finance']),
      'capabilities': {'approvalInbox': true, 'intercompanyPayment': true},
      'companies': [
        company(1, const ['pk-owner', 'pk-principal'], false), // Owner only: effective pk-owner, but may not file
        company(2, const ['pk-finance'], true),
        company(3, const ['pk-owner'], null), // older server: field absent
      ],
    });
    expect(p.capabilities.intercompanyPayment, isTrue);
    expect([for (final c in p.companies) c.capabilities.intercompanyPayment], [false, true, null]);
    expect(p.company(1)!.roles, contains(Role.owner));
    expect(p.forCompany(1).capabilities.intercompanyPayment, isFalse);
    expect(p.forCompany(2).capabilities.intercompanyPayment, isTrue);
    expect(p.forCompany(3).capabilities.intercompanyPayment, isNull);
    expect(p.scopedTo(const [1, 3]).capabilities.intercompanyPayment, isFalse);
    expect(p.scopedTo(const [1, 2]).capabilities.intercompanyPayment, isTrue);
    expect(p.forCompany(99).capabilities.intercompanyPayment, isNull, reason: 'not a membership');
    // a cached /me from before E1 (no capabilities at all)
    expect(userProfileFromJson(meJson()).capabilities.intercompanyPayment, isNull);
  });

  test('payee directory: endpoint item, masters row (offline), never the paying PT itself', () {
    final api = IntercompanyPayee.fromApiJson({
      'companyId': 2,
      'shortCode': 'LAS',
      'name': 'PT Contoh Lestari',
      'bankName': 'Mandiri',
      'accountNoMasked': '••••4321',
      'accountHolder': 'PT Contoh Lestari',
    })!;
    expect(
      (api.label, api.accountTitle, api.accountNoMasked),
      ('LAS — PT Contoh Lestari', 'Mandiri · PT Contoh Lestari', '••••4321'),
    );
    expect(IntercompanyPayee.fromApiJson({'shortCode': 'X'}), isNull);
    final row = masterFromJson(MasterTypes.intercompanyPayees, {
      'id': 2,
      'company': 1,
      'payeeCompanyId': 2,
      'shortCode': 'LAS',
      'name': 'PT Contoh Lestari',
      'bankName': 'Mandiri',
      'accountNoMasked': '••••4321',
      'accountHolder': 'PT Contoh Lestari',
      'active': true,
    });
    expect(row.label, 'LAS — PT Contoh Lestari');
    expect(row.companyId, 1, reason: 'company = the PAYING PT');
    expect(IntercompanyPayee.fromMaster(row), api);
    final own = IntercompanyPayee.fromApiJson({'companyId': 1, 'shortCode': 'DRMS', 'name': 'PT Contoh Utama'})!;
    expect(payeesFor([own, api], 1), [api]);
    expect(MasterTypes.forExpense, contains(MasterTypes.intercompanyPayees));
    expect(MasterTypes.forApp, contains(MasterTypes.intercompanyPayees));
  });

  group('intercompany refusals in Indonesian', () {
    test('400 INTERCOMPANY_NO_ACCOUNT: the field message names the PT', () {
      final e = ProblemException.fromJson(400, {
        'title': 'Data pengajuan tidak valid.',
        'code': 'INTERCOMPANY_NO_ACCOUNT',
        'payeeCompanyId': 2,
        'errors': [
          {'path': 'payeeCompanyId', 'message': 'PT LAS belum menetapkan rekening penerimaan antar-PT.'},
        ],
      });
      expect(intercompanyProblemMessage(e), 'PT LAS belum menetapkan rekening penerimaan antar-PT.');
      final bare = ProblemException.fromJson(409, {'title': 'Conflict', 'code': 'INTERCOMPANY_NO_ACCOUNT'});
      expect(
        intercompanyProblemMessage(bare),
        startsWith('PT penerima belum menetapkan rekening penerimaan antar-PT.'),
      );
    });

    test('409 INTERCOMPANY_PERIOD_CLOSED: server sentence, else the local text with the lock date', () {
      const server =
          'Periode 2026-09 PT LAS sudah ditutup (tutup buku s/d 2026-09-30). Transfer antar-PT tidak dapat dicatat '
          'pada tanggal ini — minta Direktur PT LAS membuka kembali periode itu, atau catat transfer dengan tanggal di '
          'periode terbuka.';
      final e = ProblemException.fromJson(409, {
        'title': server,
        'code': 'INTERCOMPANY_PERIOD_CLOSED',
        'lockDate': '2026-09-30',
      });
      expect(intercompanyProblemMessage(e), server);
      final bare = ProblemException.fromJson(409, {
        'title': 'Conflict',
        'code': 'INTERCOMPANY_PERIOD_CLOSED',
        'lockDate': '2026-09-30',
      });
      expect(
        intercompanyProblemMessage(bare),
        contains('Periode PT penerima sudah ditutup (tutup buku s/d 2026-09-30)'),
      );
      expect(intercompanyProblemMessage(bare), contains('periode terbuka'));
    });

    test('409 INTERCOMPANY_ACCOUNT_CHANGED, duplicate document, 403 filer role; others untouched', () {
      final changed = ProblemException.fromJson(409, {'title': 'Conflict', 'code': 'INTERCOMPANY_ACCOUNT_CHANGED'});
      expect(intercompanyProblemMessage(changed), contains('Tarik dan ajukan ulang'));
      const dup =
          'Dokumen TAG/LAS/2610/007 dari PT penerima ini sudah dipakai di pengajuan PB/DRMS/2610/0012 — status '
          'Disetujui. Satu tagihan / memo hanya boleh dibayar sekali; batalkan pengajuan lama atau periksa nomornya.';
      final duplicate = ProblemException.fromJson(409, {
        'title': dup,
        'errors': [
          {'path': 'invoiceNo', 'message': dup},
        ],
      });
      expect(intercompanyProblemMessage(duplicate), dup);
      final filer = ProblemException.fromJson(403, {'title': intercompanyFilerMessage});
      expect(intercompanyProblemMessage(filer), intercompanyFilerMessage);
      expect(intercompanyProblemMessage(ProblemException.fromJson(403, {'title': 'Forbidden'})), isNull);
      expect(intercompanyProblemMessage(problem409('CASH_OVERDRAFT_CONFIRM_REQUIRED')), isNull);
      expect(intercompanyAwareError(const NetworkException(), (e) => 'fallback'), 'fallback');
    });

    test('offline sync rejections: no receiving account, filer role', () {
      expect(
        rejectionMessage(const [
          SyncError(code: 'INTERCOMPANY_NO_ACCOUNT', field: 'payload.title', message: 'Judul wajib diisi.'),
          SyncError(
            code: 'INTERCOMPANY_NO_ACCOUNT',
            field: 'payload.payee_company_id',
            message: 'PT LAS belum menetapkan rekening penerimaan antar-PT.',
          ),
        ]),
        'PT LAS belum menetapkan rekening penerimaan antar-PT.',
      );
      expect(
        rejectionMessage(const [SyncError(code: 'FORBIDDEN', message: intercompanyFilerMessage)]),
        intercompanyFilerMessage,
      );
      expect(
        rejectionMessage(const [SyncError(code: 'FORBIDDEN', message: 'Forbidden')]),
        'Anda tidak berhak mengubah draft ini.',
      );
    });
  });

  test('transfer queue: payee company of a PT grup payment (badge "Antar PT: LAS"), searchable', () {
    final it = transferQueueItemFromJson({
      ...queueJson(46, type: 'advance'),
      'typeLabel': 'Pembayaran antar-PT',
      'payeeType': 'pt_grup',
      'payeeCompany': {'id': 2, 'shortCode': 'LAS', 'name': 'PT Contoh Lestari'},
      'payeeCompanyName': 'PT Contoh Lestari',
    });
    expect((it.isPtGrup, it.payeeCompanyCode, it.payeeCompanyName), (true, 'LAS', 'PT Contoh Lestari'));
    expect(it.searchText, contains('LAS'));
    final emp = transferQueueItemFromJson({...queueJson(47), 'payeeCompany': null, 'payeeCompanyName': null});
    expect((emp.isPtGrup, emp.payeeCompanyCode), (false, null));
  });

  test('cash list "Antar PT" + counterpart; cash flow rows with masukAntarPt / keluarAntarPt', () {
    final rows = RecentCashEntry.listFromJson([
      {
        'id': 31,
        'entryNo': 'KM/LAS/2610/0003',
        'entryDate': '2026-10-12',
        'direction': 'in',
        'amount': 7500000,
        'status': 'posted',
        'sourceType': 'intercompany',
        'account': 'Bank Mandiri LAS',
        'label': 'Antar-PT dari DRMS: Jasa alat berat dari PT LAS',
        'requestDocNo': null,
        'intercompany': {
          'direction': 'in',
          'status': 'posted',
          'counterpartCompany': {'id': 1, 'shortCode': 'DRMS', 'name': 'PT Contoh Utama'},
          'sourceDocNo': 'PB/DRMS/2610/0012',
          'transferDocNo': 'TRF/DRMS/2610/0007',
          'counterpartEntryNo': 'KK/DRMS/2610/0009',
        },
      },
      {
        'id': 32,
        'entryNo': 'KK/DRMS/2610/0009',
        'direction': 'out',
        'status': 'void',
        'sourceType': 'transfer',
        'intercompany': {
          'direction': 'out',
          'status': 'void',
          'counterpartCompany': {'id': 2, 'shortCode': 'LAS', 'name': 'PT Contoh Lestari'},
          'counterpartEntryNo': 'KM/LAS/2610/0003',
        },
      },
      {'id': 33, 'sourceType': 'manual', 'direction': 'in'},
    ]);
    expect((rows[0].isIntercompany, rows[0].sourceLabel), (true, 'Antar PT'));
    expect(rows[0].counterpart!.text, 'Dari PT DRMS · PB/DRMS/2610/0012 · TRF/DRMS/2610/0007 · KK/DRMS/2610/0009');
    expect(rows[1].counterpart!.text, 'Ke PT LAS · KM/LAS/2610/0003 (dibatalkan)');
    // the paying PT's KK keeps source type `transfer` on the server; its counterpart makes it "Antar PT"
    expect((rows[1].sourceType, rows[1].isIntercompany, rows[1].sourceLabel), ('transfer', true, 'Antar PT'));
    expect(
      RecentCashEntry.listFromJson([
        {'id': 35, 'sourceType': 'transfer', 'direction': 'out', 'intercompany': null},
      ]).single.sourceLabel,
      'Transfer',
    );
    expect((rows[2].isIntercompany, rows[2].sourceLabel), (false, 'Manual'));
    // the server's recentCash without the counterpart object: still "Antar PT" from the source type
    final plain = RecentCashEntry.listFromJson([
      {'id': 34, 'sourceType': 'intercompany', 'direction': 'in'},
    ]).single;
    expect((plain.isIntercompany, plain.counterpart), (true, null));

    final d = FinanceDashboard.fromJson({
      'cashFlow': {
        'basis': 'K-02b',
        'months': 2,
        'rows': [
          {'period': '2026-09', 'masuk': 1000, 'keluar': 500},
          {'period': '2026-10', 'masuk': 9000, 'keluar': 8000, 'masukAntarPt': 7500, 'keluarAntarPt': 2500},
        ],
      },
    });
    expect([for (final r in d.cashFlow) r.hasAntarPt], [false, true]);
    expect((d.cashFlow.last.masukAntarPt, d.cashFlow.last.keluarAntarPt), (7500, 2500));
    // "tanpa antar-PT" (web Direktur card withoutIntercompany): both legs out, nothing else eliminated
    final without = withoutIntercompany(d.cashFlow);
    expect(
      [for (final r in without) (r.period, r.masuk, r.keluar, r.hasAntarPt)],
      [('2026-09', 1000, 500, false), ('2026-10', 1500, 5500, false)],
    );
  });
}
