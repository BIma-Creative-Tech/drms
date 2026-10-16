import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/draft_validation.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/expense/domain/turn_timeline.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

import '../support/fixtures.dart';
import '../support/schema_v2.dart';

/// DRMS 13/10 Wave 4a (ADR 0027) "Pembayaran vendor" on the APK: draft model + drift v10 (`vendor_json`), create /
/// sync payloads (invoice photo placeholder → `invoice_file_id`), validation, read model, stepper without LPJ.
/// Fictional data (example names, made-up numbers).
const sub = 'kc-sub-v10';

DraftRequest vendorDraft({String? invoiceMediaUuid = 'inv-photo-1', int? invoiceFileId}) => DraftRequest(
  clientUuid: '0192f2a0-1111-7000-8000-000000000001',
  type: RequestType.reimburse, // the payee type wins: a vendor payment is always Pengajuan Baru
  companyId: 1,
  title: 'Bayar invoice semen',
  projectId: 9,
  requesterIds: const [12],
  bankAccountId: 21, // never sent for a vendor payment
  payeeType: PayeeType.vendor,
  vendorId: 3,
  vendorBankAccountId: 31,
  invoiceNo: ' INV/2026/0012 ',
  invoiceDate: '2026-10-10',
  invoiceDueDate: '2026-10-31',
  invoiceMediaUuid: invoiceMediaUuid,
  invoiceFileId: invoiceFileId,
  lines: const [
    DraftLine(
      clientUuid: 'l-1',
      no: 1,
      description: 'Semen 50 sak',
      qty: 50,
      uomId: 3,
      unitPrice: 70000,
      rapItemId: 501,
      categoryId: 1,
    ),
  ],
);

Map<String, dynamic> vendorDetailJson({String status = 'completed'}) => {
  ...detailJson(status: status, allowed: const []),
  'type': 'advance',
  'typeLabel': 'Pembayaran vendor',
  'payeeType': 'vendor',
  'vendor': {'id': 3, 'code': null, 'name': 'CV Contoh Material'},
  'vendorBankAccountId': 31,
  'invoice': {
    'no': 'INV/2026/0012',
    'date': '2026-10-10',
    'dueDate': null,
    'fileId': 77,
    'fileName': 'invoice.jpg',
    'mimeType': 'image/jpeg',
  },
  'bank': {'bankName': 'Mandiri', 'accountNo': '•••4321', 'accountHolder': 'CV Contoh Material'},
  'settlement': null,
  'transfers': [
    {
      'id': 5,
      'docNo': 'TRF/CS1/2610/0001',
      'kind': 'advance',
      'amount': 3500000,
      'transferDate': '2026-10-12',
      'status': 'posted',
    },
  ],
};

void main() {
  test('drift v9 → v10: drafts survive as employee payments; vendor data round-trips through vendor_json', () async {
    const ts = 1790000000;
    final db = oldPhoneDb(9, (raw) {
      raw.execute(
        'INSERT INTO local_drafts (client_uuid, user_sub, company_id, type, title, project_id, requester_ids_json, '
        "bank_account_id, sync_state, created_at, updated_at) VALUES ('d-10', '$sub', 1, 'advance', 'Semen', 9, "
        "'[12]', 21, 'local', $ts, $ts)",
      );
    });
    addTearDown(db.close);
    expect(db.schemaVersion, 11);
    final repo = DraftRepository(db);
    final old = (await repo.load(sub, 'd-10'))!;
    expect((old.payeeType, old.isVendor, old.bankAccountId), (PayeeType.karyawan, false, 21));

    await repo.save(sub, vendorDraft().copyWith(clientUuid: 'd-10'));
    final back = (await repo.load(sub, 'd-10'))!;
    expect(back.payeeType, PayeeType.vendor);
    expect((back.vendorId, back.vendorBankAccountId, back.invoiceNo), (3, 31, ' INV/2026/0012 '));
    expect((back.invoiceDate, back.invoiceDueDate, back.invoiceMediaUuid), ('2026-10-10', '2026-10-31', 'inv-photo-1'));
    expect(back.bankAccountId, isNull, reason: 'no employee account on a vendor payment');
    expect(back.mediaUuids, contains('inv-photo-1'));

    // back to an employee payment: the vendor data is gone
    await repo.save(sub, back.copyWith(payeeType: PayeeType.karyawan, vendorId: null, invoiceMediaUuid: null));
    final again = (await repo.load(sub, 'd-10'))!;
    expect((again.isVendor, again.vendorId, again.invoiceNo), (false, null, null));
    expect(withVendorJson(again, 'not json'), again);
  });

  test('sync payload: kind advance, vendor fields, invoice photo placeholder → invoice_file_id', () {
    final p = draftToSyncPayload(vendorDraft());
    expect(p['kind'], 'advance');
    expect(p['payee_type'], 'vendor');
    expect((p['vendor_id'], p['vendor_bank_account_id'], p['invoice_no']), (3, 31, 'INV/2026/0012'));
    expect((p['invoice_date'], p['invoice_due_date']), ('2026-10-10', '2026-10-31'));
    expect(p['bank_account_id'], isNull);
    expect(p[invoicePlaceholderKey], 'inv-photo-1');
    expect(resolveMediaIds(p, const {}), isNull, reason: 'the photo is not on the server yet');
    final resolved = resolveMediaIds(p, const {'inv-photo-1': 77})!;
    expect(resolved['invoice_file_id'], 77);
    expect(resolved.containsKey(invoicePlaceholderKey), isFalse);
    // an employee draft stays as before (no payee keys — byte-compatible with older servers)
    final emp = draftToSyncPayload(vendorDraft().copyWith(payeeType: PayeeType.karyawan, type: RequestType.advance));
    expect(emp.containsKey('payee_type'), isFalse);
    expect(emp['bank_account_id'], 21);
    expect(mediaUploadPath('invoice'), 'attachments');
  });

  test('create body (online "Ajukan"): vendor fields with the uploaded invoice id', () {
    final b = draftToCreateBody(vendorDraft(invoiceMediaUuid: null, invoiceFileId: 77));
    expect(b['type'], 'advance');
    expect((b['payeeType'], b['vendorId'], b['vendorBankAccountId'], b['invoiceFileId']), ('vendor', 3, 31, 77));
    expect(b['invoiceNo'], 'INV/2026/0012');
    expect(b['bankAccountId'], isNull);
  });

  test('validation: vendor, account, invoice number / date / photo; no employee account needed', () {
    expect(validateForSubmit(vendorDraft()), isEmpty);
    final empty = vendorDraft(invoiceMediaUuid: null)
        .copyWith(vendorId: null, vendorBankAccountId: null, invoiceNo: ' / ', invoiceDate: null);
    expect(validateForSubmit(empty).map((i) => i.field).toSet(), {
      'vendorId',
      'vendorBankAccountId',
      'invoiceNo',
      'invoiceDate',
      'invoiceFile',
    });
    final due = vendorDraft().copyWith(invoiceDueDate: '2026-10-01');
    expect(validateForSubmit(due).map((i) => i.field), ['invoiceDueDate']);
    expect(normalizeInvoiceNo('inv/2026-01 '), 'INV202601');
  });

  test('read model + stepper: vendor and invoice, no LPJ step, "Selesai" after the transfer', () {
    final d = detailFromJson(vendorDetailJson());
    expect(d.isVendor, isTrue);
    expect(
      (d.vendor?.name, d.invoiceNo, d.invoiceFileId, d.invoiceFileName),
      ('CV Contoh Material', 'INV/2026/0012', 77, 'invoice.jpg'),
    );
    final steps = buildRequestStepper(d);
    expect(steps.map((s) => s.title), isNot(contains(lpjStepTitle)));
    expect(steps.last.title, doneStepTitle);
    expect(steps.last.note, vendorDoneNote);
    final waiting = detailFromJson(vendorDetailJson(status: 'approved')..['transfers'] = const []);
    expect(currentTurn(waiting), 'Finance — transfer ke rekening vendor');
    expect(
      draftFromServer(
        detailFromJson(vendorDetailJson(status: 'draft')),
        clientUuid: 'x',
        receiptUuid: (i) => '$i',
      ).invoiceFileId,
      77,
    );
    // an employee Pengajuan Baru keeps its LPJ step
    final emp = detailFromJson({...vendorDetailJson(status: 'transferred'), 'payeeType': 'karyawan'});
    expect(buildRequestStepper(emp).map((s) => s.title), contains(lpjStepTitle));
    expect(summaryFromJson({...vendorDetailJson(), 'payeeType': 'vendor'}).payeeType, PayeeType.vendor);
  });

  test('client 2026-10-14: a vendor payment on a cost center (no project) is sendable; employee drafts keep D2', () {
    final onCc = vendorDraft().copyWith(projectId: null, costCenterId: 7, lines: const []);
    expect(validateForSubmit(onCc).map((i) => i.field), isNot(contains('projectId')));
    expect(draftToSyncPayload(onCc)['cost_center_id'], 7);
    expect(draftToCreateBody(onCc)['costCenterId'], 7);
    final neither = onCc.copyWith(costCenterId: null);
    expect(validateForSubmit(neither).map((i) => i.field), contains('projectId'));
    final withProject = vendorDraft().copyWith(costCenterId: 7);
    expect(draftToSyncPayload(withProject).containsKey('cost_center_id'), isFalse, reason: 'project wins');
    final emp = onCc.copyWith(payeeType: PayeeType.karyawan);
    expect(draftToSyncPayload(emp).containsKey('cost_center_id'), isFalse);
    expect(validateForSubmit(emp).map((i) => i.field), contains('projectId'));
  });

  test('vendor accounts of the chosen vendor only', () {
    final masters = {
      MasterTypes.vendorBankAccounts: [
        masterFromJson(MasterTypes.vendorBankAccounts, {
          'id': 31,
          'vendor': 3,
          'bank': 1,
          'accountNo': '1234567890',
          'accountHolder': 'CV Contoh Material',
        }),
        masterFromJson(MasterTypes.vendorBankAccounts, {
          'id': 32,
          'vendor': 4,
          'bank': 1,
          'accountNo': '9876543210',
          'accountHolder': 'PT Contoh Alat',
        }),
      ],
    };
    expect(vendorAccountsOf(masters, 3).map((a) => a.id), [31]);
    expect(vendorAccountsOf(masters, null), isEmpty);
    expect(masters[MasterTypes.vendorBankAccounts]!.first.label, 'CV Contoh Material · •••7890');
    expect(MasterTypes.forExpense, containsAll([MasterTypes.vendors, MasterTypes.vendorBankAccounts]));
  });

  test('owner request 2026-10-16: Staff, Finance and PM file a vendor payment; Admin, Direktur, Owner do not', () {
    expect(vendorPaymentFilerRoles, {Role.staff, Role.finance, Role.pm});
    for (final r in [Role.staff, Role.finance, Role.pm]) {
      expect(mayFileVendorPayment({r}), isTrue, reason: r.code);
    }
    for (final r in [Role.admin, Role.owner, Role.principal, Role.operator]) {
      expect(mayFileVendorPayment({r}), isFalse, reason: r.code);
    }
    expect(mayFileVendorPayment(Role.effective({Role.principal})), isFalse, reason: 'Owner (+ implied Direktur)');
    expect(mayFileVendorPayment({Role.admin, Role.staff}), isTrue);
    expect(mayFileVendorPayment(const <Role>{}), isFalse);
  });
}
