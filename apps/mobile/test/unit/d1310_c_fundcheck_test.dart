import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/format/rupiah.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/fund_check.dart';
import 'package:proyekkas/features/expense/presentation/widgets/fund_check_panel.dart';
import 'package:proyekkas/features/finance/domain/transfer_queue.dart';
import 'package:proyekkas/features/loans/data/intercompany_loans_api.dart';
import 'package:proyekkas/features/loans/domain/intercompany_loan.dart';
import 'package:proyekkas/features/notifications/domain/app_notification.dart';

import '../support/d1310_c_fixtures.dart';
import '../support/fake_dio_adapter.dart';
import '../support/fixtures.dart';
import '../support/harness.dart';

/// DRMS 13/10 Phase C (ADR 0029) on the APK: the request detail's `fundCheck`, the inbox `fundShort`, the `/me`
/// capabilities, the Indonesian texts of FUND_INSUFFICIENT and the loan refusals, the inter-PT loan read models
/// (detail, queue, lender options), the instruction / disbursement bodies and checks, the API paths and the
/// notification deep link. Fictional PTs and numbers.
void main() {
  group('fundCheck (request detail)', () {
    test('parsed with every figure, the commitments and the linked loans', () {
      final d = detailFromJson(fundDetailJson());
      final f = d.fundCheck!;
      expect(f.companyId, 1);
      expect(f.code, 'DRMS');
      expect(f.companyName, 'PT Contoh Dirgantara');
      expect(f.enabled, isTrue);
      expect(f.applies, isTrue);
      expect(f.status, FundCheckStatus.insufficient);
      expect(f.blocked, isTrue);
      expect([f.balance, f.commitments, f.available, f.needed, f.gap], [5000000, 4000000, 1000000, 1447500, 447500]);
      expect(f.accountCount, 2);
      expect([f.excludedSiteCount, f.excludedSiteBalance], [1, 750000]);
      expect([f.waitingCount, f.waitingAmount], [1, 2500000]);
      expect(f.commitmentItems.map((c) => '${c.kind}:${c.label}:${c.amount}'), [
        'request:PB/DRMS/2610/0009:3000000',
        'loan:PJA/DRMS/2610/0001:1000000',
      ]);
      expect(f.commitmentItems.last.kindLabel, 'Perintah pinjaman (PT ini pemberi), belum dicairkan');
      expect(f.loans.single.docNo, 'PJA/LAS/2610/0002');
      expect(f.loans.single.lenderCode, 'LAS');
      expect(f.loans.single.statusLabel, 'Menunggu pencairan');
      expect(f.short, isTrue);
      expect(f.blockedReason, 'Dana PT tidak cukup — kurang Rp 447.500. Tolak, atau perintahkan pinjaman antar-PT.');
      expect(d.allowedActions, contains(instructLoanAction));
    });

    test('absent / malformed → null (a server before ADR 0029, a Staff caller)', () {
      expect(detailFromJson(detailJson()).fundCheck, isNull);
      expect(detailFromJson({...detailJson(), 'fundCheck': null}).fundCheck, isNull);
      expect(fundCheckFromJson({'balance': 1}), isNull, reason: 'no companyId');
    });

    test('blocked without a server text: the web sentence built locally; not blocked: no reason', () {
      final blocked = fundCheckFromJson({...fundCheckJson(), 'blockedText': null})!;
      expect(blocked.blockedReason, fundBlockedText(447500));
      final open = fundCheckFromJson({...fundCheckJson(), 'blocked': false, 'enabled': false})!;
      expect(open.blockedReason, isNull);
      expect(open.short, isTrue, reason: 'still short: shown as "Kurang", only not refused');
      final ok = fundCheckFromJson({...fundCheckJson(), 'status': 'ok', 'gap': 0, 'blocked': false})!;
      expect(ok.short, isFalse);
      expect(FundCheckStatus.fromCode('weird'), FundCheckStatus.notApplicable);
    });

    test('ADR 0031 amendment: route, routeText and the Pusat Biaya with its commitments (project_loan)', () {
      final f = fundCheckFromJson(fundCheckPbJson())!;
      expect(f.route, FundCheckRoute.pusatBiaya);
      expect(f.routeText, 'Dana pusat biaya CSR SEPASO/KUTIM cukup — Finance membayar dari akun ini.');
      final pb = f.pusatBiaya!;
      expect([pb.accountId, pb.name], [12, 'CSR SEPASO/KUTIM']);
      expect([pb.balance, pb.commitments, pb.available], [3100000, 600000, 2500000]);
      expect(pb.commitmentItems.map((c) => '${c.kind}:${c.label}:${c.amount}'), [
        'project_loan:PJP/DRMS/2610/0003:400000',
        'request:PB/DRMS/2610/0010:200000',
      ]);
      expect(pb.commitmentItems.first.kindLabel, 'Pinjaman antar project disetujui, belum dicairkan');
      expect([f.available, f.gap, f.short, f.blockedReason], [1000000, 0, false, null], reason: 'available = the PT');
      expect(fundCheckFromJson(fundCheckPbJson(route: 'other_account'))!.route, FundCheckRoute.otherAccount);
      expect(FundCheckRoute.fromCode('pt'), FundCheckRoute.pt);
      expect(FundCheckRoute.fromCode('weird'), isNull);
    });

    test('ADR 0031 amendment: an older server (no route / routeText / pusatBiaya) or a malformed Pusat Biaya', () {
      final old = fundCheckFromJson(fundCheckJson())!;
      expect([old.route, old.routeText, old.pusatBiaya], [null, null, null]);
      final bad = fundCheckFromJson({
        ...fundCheckPbJson(),
        'route': 42,
        'pusatBiaya': {'name': 'Tanpa id'},
      })!;
      expect([bad.route, bad.pusatBiaya], [null, null]);
      final noName = fundCheckFromJson({
        ...fundCheckPbJson(),
        'pusatBiaya': {'accountId': 12, 'commitmentItems': 'x'},
      })!;
      expect(noName.pusatBiaya, const FundPusatBiaya(accountId: 12, name: '#12'));
    });

    test('ADR 0031 amendment: blocked with a Pusat Biaya names it (server text, else the local sentence)', () {
      final short = fundCheckFromJson(fundCheckPbJson(route: 'short'))!;
      expect(short.route, FundCheckRoute.short);
      expect(short.routeText, isNull);
      expect(short.short, isTrue);
      expect(
        short.blockedReason,
        'Dana pusat biaya CSR SEPASO/KUTIM maupun dana PT tidak cukup — kurang Rp 447.500. Tolak, atau perintahkan '
        'pinjaman antar-PT.',
      );
      final local = fundCheckFromJson({...fundCheckPbJson(route: 'short'), 'blockedText': null})!;
      expect(local.blockedReason, short.blockedReason);
      expect(fundBlockedText(447500, pbName: 'CSR SEPASO/KUTIM'), short.blockedReason);
      expect(fundBlockedText(447500, pbName: ''), fundBlockedText(447500));
      expect(
        fundBlockedDraftText(447500, pbName: 'CSR SEPASO/KUTIM'),
        'Dana pusat biaya CSR SEPASO/KUTIM maupun dana PT tidak cukup — kurang Rp 447.500. Pengajuan Anda tidak dapat '
        'dikirim sampai dana tersedia; perintahkan pinjaman antar-PT.',
      );
      expect(fundBlockedDraftText(447500), startsWith('Dana PT tidak cukup — kurang Rp 447.500. Pengajuan Anda'));
    });

    test('instruction route: borrower = the PT, the request pre-linked, amount = the gap', () {
      final d = detailFromJson(fundDetailJson());
      final uri = Uri.parse(icLoanInstructPath(d));
      expect(uri.path, '/intercompany-loans/new');
      expect(uri.queryParameters, {'borrower': '1', 'requests': '42', 'amount': '447500'});
    });
  });

  test('inbox fundShort: a positive gap only', () {
    Map<String, dynamic> row(Object? gap) => {
      ...(inboxJson()['items'] as List).first as Map<String, dynamic>,
      'fundShort': gap,
    };
    expect(inboxItemFromJson(row(447500)).fundShort, 447500);
    expect(inboxItemFromJson(row(null)).fundShort, isNull);
    expect(inboxItemFromJson(row(0)).fundShort, isNull);
    expect(inboxItemFromJson((inboxJson()['items'] as List).first as Map<String, dynamic>).fundShort, isNull);
  });

  test('/me capabilities of ADR 0029 per PT: parsed (absent → false), PT scope = union', () {
    Map<String, dynamic> company(int id, List<String> roles, Map<String, dynamic> caps) => {
      'id': id,
      'code': 'PT$id',
      'name': 'PT Contoh $id',
      'roles': roles,
      'capabilities': {'approvalInbox': true, ...caps},
    };
    final p = userProfileFromJson({
      ...meJson(roles: const ['pk-owner', 'pk-principal', 'pk-finance']),
      'capabilities': {'approvalInbox': true, 'instructIntercompanyLoan': true},
      'companies': [
        company(1, const ['pk-owner', 'pk-principal'], {'instructIntercompanyLoan': true, 'fundCheckEnabled': true}),
        company(2, const ['pk-finance'], {'disburseIntercompanyLoan': true}),
        company(3, const ['pk-owner'], const {}), // older server: fields absent
      ],
    });
    final caps = [for (final c in p.companies) c.capabilities];
    expect(caps.map((c) => c.instructIntercompanyLoan), [true, false, false]);
    expect(caps.map((c) => c.disburseIntercompanyLoan), [false, true, false]);
    expect(caps.map((c) => c.fundCheckEnabled), [true, false, false]);
    expect(p.forCompany(1).capabilities.instructIntercompanyLoan, isTrue);
    expect(p.forCompany(2).capabilities.instructIntercompanyLoan, isFalse);
    final s = p.scopedTo(const [1, 2]).capabilities;
    expect([s.instructIntercompanyLoan, s.disburseIntercompanyLoan, s.fundCheckEnabled], [true, true, true]);
    expect(p.scopedTo(const [3]).capabilities.disburseIntercompanyLoan, isFalse);
    expect(userProfileFromJson(meJson()).capabilities.instructIntercompanyLoan, isFalse);
  });

  group('409 FUND_INSUFFICIENT in Indonesian', () {
    test('the server sentence wins (it names the PT)', () {
      final e = ProblemException.fromJson(409, fundInsufficientProblem());
      expect(fundProblemMessage(e), startsWith('Dana PT DRMS tidak cukup: tersedia Rp 1.000.000'));
      expect(icLoanProblemMessage(e), fundProblemMessage(e));
    });

    test('a body with the code and figures only: the local sentence with the figures', () {
      final e = ProblemException.fromJson(409, {
        'title': 'Conflict',
        'code': 'FUND_INSUFFICIENT',
        'companyId': 1,
        'balance': 5000000,
        'commitments': 4000000,
        'available': 1000000,
        'needed': 1447500,
        'gap': 447500,
      });
      expect(
        fundProblemMessage(e),
        'Dana PT tidak cukup: tersedia Rp 1.000.000, dibutuhkan Rp 1.447.500, kurang Rp 447.500. Tolak, atau '
        'perintahkan pinjaman antar-PT.',
      );
      expect(
        fundProblemMessage(e, draft: true),
        endsWith('Pengajuan tetap Draft — perintahkan pinjaman antar-PT, lalu kirim lagi.'),
      );
      final bare = ProblemException.fromJson(409, {'code': 'FUND_INSUFFICIENT'});
      expect(
        fundProblemMessage(bare),
        'Dana PT tidak cukup untuk langkah ini. Tolak, atau perintahkan pinjaman antar-PT.',
      );
    });

    test('ADR 0031 amendment: a body with the Pusat Biaya and the figures only names it', () {
      final e = ProblemException.fromJson(409, {
        'title': 'Conflict',
        'code': 'FUND_INSUFFICIENT',
        'companyId': 1,
        'available': 1000000,
        'needed': 1447500,
        'gap': 447500,
        'pusatBiayaAccountId': 12,
        'pusatBiayaName': 'CSR SEPASO/KUTIM',
        'pusatBiayaAvailable': 400000,
      });
      expect(
        fundProblemMessage(e),
        'Dana pusat biaya CSR SEPASO/KUTIM maupun dana PT tidak cukup: tersedia Rp 1.000.000, dibutuhkan '
        'Rp 1.447.500, kurang Rp 447.500. Tolak, atau perintahkan pinjaman antar-PT.',
      );
    });

    test('other problems: null (the usual message)', () {
      expect(fundProblemMessage(ProblemException.fromJson(409, {'code': 'CASH_OVERDRAFT_CONFIRM_REQUIRED'})), isNull);
      expect(fundProblemMessage(const ProblemException(status: 403)), isNull);
    });
  });

  group('loan refusals in Indonesian', () {
    String? msg(Map<String, dynamic> body, [int status = 409]) =>
        icLoanProblemMessage(ProblemException.fromJson(status, body));

    test('LOAN_LENDER_INSUFFICIENT: server sentence, else the figures', () {
      expect(
        msg({
          'title': 'Dana tersedia PT LAS Rp 300.000 — kurang untuk pinjaman Rp 500.000. Pilih PT lain atau kurangi nilainya.',
          'code': 'LOAN_LENDER_INSUFFICIENT',
        }),
        startsWith('Dana tersedia PT LAS Rp 300.000'),
      );
      expect(
        msg({'code': 'LOAN_LENDER_INSUFFICIENT', 'available': 300000, 'needed': 500000, 'gap': 200000}),
        'Dana tersedia PT pemberi Rp 300.000 — kurang Rp 200.000 untuk pinjaman Rp 500.000. Pilih PT lain atau kurangi '
        'nilainya.',
      );
      expect(msg({'code': 'LOAN_LENDER_INSUFFICIENT'}), contains('tidak cukup'));
    });

    test('the other loan codes and the reused intercompany codes have a local text', () {
      for (final code in [
        loanHasRepaymentsCode,
        loanVoidBorrowerShortfallCode,
        loanRepaymentExceedsOutstandingCode,
        'INTERCOMPANY_NO_ACCOUNT',
        'INTERCOMPANY_PERIOD_CLOSED',
      ]) {
        final m = msg({'title': 'Conflict', 'code': code});
        expect(m, isNotNull, reason: code);
        expect(m, isNot(contains('Conflict')), reason: code);
      }
      expect(
        msg({'code': 'INTERCOMPANY_PERIOD_CLOSED', 'lockDate': '2026-10-31'}),
        contains('tutup buku s/d 2026-10-31'),
      );
      expect(
        msg({'code': 'LOAN_REPAYMENT_EXCEEDS_OUTSTANDING', 'amount': 600000, 'outstanding': 500000}),
        'Pengembalian Rp 600.000 melebihi sisa pinjaman Rp 500.000.',
      );
      expect(msg({'title': 'Forbidden'}, 403), isNull);
      expect(icLoanAwareError(const NetworkException(), (e) => 'fallback'), 'fallback');
    });
  });

  group('inter-PT loan read models', () {
    test('detail: figures, PTs, notes, linked requests, movements with KK / KM, actions', () {
      final l = IcLoan.fromJson(icLoanDetailJson(status: 'disbursed'));
      expect(l.docNo, 'PJA/LAS/2610/0002');
      expect(l.status, IcLoanStatus.disbursed);
      expect(l.status.active, isTrue);
      expect(l.label, 'Dicairkan');
      expect(l.lender?.label, 'LAS — PT Contoh Lestari');
      expect(l.borrowerCode, 'DRMS');
      expect([l.amount, l.repaidTotal, l.outstanding], [500000, 0, 500000]);
      expect(l.side, 'both');
      expect(l.ownRequestNote, isNotNull);
      expect(l.requests.single.label, 'PB/DRMS/2610/0012');
      expect(l.requests.single.statusLabel, 'Menunggu Approval Owner');
      final mv = l.disbursement!;
      expect(
        [mv.label, mv.kkNo, mv.kmNo, mv.toAccountNoMasked],
        ['Pencairan', 'KK/LAS/2610/0004', 'KM/DRMS/2610/0011', '••••0123'],
      );
      expect(l.allowedActions, {IcLoanAction.voidDisbursement});
      expect(l.canDisburse, isNull, reason: 'queue field');
    });

    test('a void movement is not the disbursement; unknown actions are ignored', () {
      final j = icLoanDetailJson(status: 'instructed');
      j['movements'] = [
        {
          ...(icLoanDetailJson(status: 'disbursed')['movements'] as List).single as Map<String, dynamic>,
          'status': 'void',
          'voidReason': 'salah rekening',
        },
      ];
      j['allowedActions'] = ['disburse', 'teleport'];
      final l = IcLoan.fromJson(j);
      expect(l.disbursement, isNull);
      expect(l.movements.single.posted, isFalse);
      expect(l.movements.single.voidReason, 'salah rekening');
      expect(l.allowedActions, {IcLoanAction.disburse});
    });

    test('queue: count, canDisburse (G1), destination', () {
      final q = IcLoanQueue.fromJson(icLoanQueueJson());
      expect(q.count, 2);
      expect(q.items.map((i) => i.canDisburse), [true, false]);
      expect(q.items.first.destination?.text, 'Mandiri · ••••0123 · PT Contoh Dirgantara');
      expect(q.items.last.destination, isNull);
      expect(q.items.last.g1Note, contains('G1'));
    });

    test('lender options: borrower funds, waiting requests, default due date, sufficiency for a typed amount', () {
      final o = IcLenderOptions.fromJson(icLenderOptionsJson());
      expect(o.borrower.company?.shortCode, 'DRMS');
      expect(o.borrower.available, 1000000);
      expect(o.borrower.hasReceivingAccount, isTrue);
      expect(o.borrower.waiting.map((w) => w.label), ['PB/DRMS/2610/0012', 'PB/DRMS/2610/0013']);
      expect(o.borrower.gapAll, 2947500);
      expect(o.defaultDueDate, '2026-11-13');
      expect(o.lenders.map((l) => l.company.shortCode), ['LAS', 'MKS']);
      final las = o.lenders.first;
      final mks = o.lenders.last;
      expect([las.sufficient, mks.sufficient], [true, false]);
      expect(las.sufficientFor(447500), isTrue);
      expect(las.sufficientFor(9000000), isFalse);
      expect(mks.sufficientFor(null), isTrue, reason: 'without an amount: available > 0');
      expect(mks.warning, contains('rekening penerimaan'));
    });
  });

  group('instruction form', () {
    const las = IcLenderOption(company: IcCompanyRef(id: 2, shortCode: 'LAS'), available: 300000);

    test('checks: lender, amount (> 0, ≤ the lender\'s funds), due date ≥ today, reason, borrower account', () {
      Map<String, String> v({
        int? lender = 2,
        int? amount = 200000,
        String? due = '2026-11-13',
        String reason = 'Dana proyek',
      }) => validateIcLoanInstruction(
        lenderId: lender,
        amount: amount,
        dueDate: due,
        reason: reason,
        today: '2026-10-14',
        lender: las,
      );
      expect(v(), isEmpty);
      expect(v(lender: null).keys, ['lender']);
      expect(v(amount: 500000)['lender'], contains('Rp 300.000'));
      expect(v(amount: 0)['amount'], 'Nilai harus lebih dari 0.');
      expect(v(amount: 2000000000000)['amount'], 'Nilai maksimal Rp 1 triliun.');
      expect(v(due: null)['dueDate'], 'Jatuh tempo wajib diisi.');
      expect(v(due: '2026-10-13')['dueDate'], 'Jatuh tempo tidak boleh sebelum tanggal perintah.');
      expect(v(reason: ' a ')['reason'], 'Alasan wajib diisi, minimal 3 karakter.');
      expect(
        validateIcLoanInstruction(
          lenderId: 2,
          amount: 1,
          dueDate: '2026-11-13',
          reason: 'abc',
          today: '2026-10-14',
          borrowerHasReceivingAccount: false,
        ).keys,
        ['borrower'],
      );
    });

    test('body: exactly the fields of IntercompanyLoanCreate, reason trimmed, requests unique', () {
      final b = icLoanCreateBody(
        borrowerCompanyId: 1,
        lenderCompanyId: 2,
        amount: 447500,
        dueDate: '2026-11-13',
        reason: ' Dana proyek ',
        requestIds: const [42, 42, 43],
      );
      expect(b, {
        'borrowerCompanyId': 1,
        'lenderCompanyId': 2,
        'amount': 447500,
        'dueDate': '2026-11-13',
        'reason': 'Dana proyek',
        'requestIds': [42, 43],
      });
      expect(
        icLoanCreateBody(
          borrowerCompanyId: 1,
          lenderCompanyId: 2,
          amount: 1,
          dueDate: '2026-11-13',
          reason: 'abc',
        ).containsKey('requestIds'),
        isFalse,
      );
    });
  });

  group('disbursement form (the transfer form without a cost center)', () {
    test('body of IntercompanyLoanDisburse: no amount, no cost center; confirmOverdraft only when confirmed', () {
      final b = icLoanDisburseBody(
        cashAccountId: 3,
        transferAt: transferAtString(DateTime(2026, 10, 14, 9, 5), const Duration(hours: 8)),
        bankRef: ' REF-9 ',
        proofMediaId: 9001,
      );
      expect(b, {'cashAccountId': 3, 'transferAt': '2026-10-14T09:05+08:00', 'bankRef': 'REF-9', 'proofMediaId': 9001});
      expect(
        icLoanDisburseBody(
          cashAccountId: 3,
          transferAt: 'x',
          bankRef: 'r',
          proofMediaId: 1,
          confirmOverdraft: true,
        )['confirmOverdraft'],
        isTrue,
      );
    });

    test('checks: no Pusat Biaya / loan reason asked', () {
      final now = DateTime.utc(2026, 10, 14, 4);
      final issues = validateTransferForm(
        cashAccountId: null,
        transferAt: null,
        zoneOffset: const Duration(hours: 8),
        bankRef: '',
        hasProof: false,
        nowUtc: now,
      );
      expect(issues.keys.toSet(), {'cashAccountId', 'transferAt', 'bankRef', 'proof'});
    });

    test('cash accounts carry the site flag (only accounts without a site pay a loan)', () {
      final a = cashAccountFromJson({
        'cashAccountId': 4,
        'companyId': 2,
        'siteId': 7,
        'name': 'Kas Kecil Site',
        'active': true,
        'balance': 100,
      });
      expect(a.siteId, 7);
      expect(cashAccountFromJson({'cashAccountId': 3, 'name': 'Bank', 'siteId': null}).siteId, isNull);
    });
  });

  group('API', () {
    late FakeDioAdapter adapter;
    late IntercompanyLoansApi api;
    setUp(() {
      adapter = FakeDioAdapter((c) {
        final p = c.uri.path;
        if (p.endsWith('/intercompany-loans/queue')) return (200, icLoanQueueJson());
        if (p.endsWith('/intercompany-loans/lenders')) return (200, icLenderOptionsJson());
        if (p.endsWith('/disburse')) return (200, icLoanDetailJson(status: 'disbursed'));
        if (p.endsWith('/intercompany-loans') && c.method == 'POST')
          return (201, icLoanDetailJson(status: 'instructed'));
        if (RegExp(r'/intercompany-loans/\d+$').hasMatch(p)) return (200, icLoanDetailJson(status: 'instructed'));
        return (404, {'title': 'Not Found'});
      });
      final client = testClient('https://example.test', StaticTokens(), reach: (_) {});
      client.dio.httpClientAdapter = adapter;
      api = IntercompanyLoansApi(client);
    });

    test('paths, query and idempotency keys', () async {
      expect((await api.queue()).count, 2);
      await api.lenders(1, amount: 447500);
      expect(adapter.calls.last.uri.queryParameters, {'borrower': '1', 'amount': '447500'});
      await api.lenders(1);
      expect(adapter.calls.last.uri.queryParameters, {'borrower': '1'});
      expect((await api.detail(77)).id, 77);
      expect(adapter.calls.last.uri.path, endsWith('/api/v1/intercompany-loans/77'));
      final made = await api.instruct(const {'borrowerCompanyId': 1}, idempotencyKey: 'k-i');
      expect(made.status, IcLoanStatus.instructed);
      expect([adapter.calls.last.method, adapter.calls.last.headers['Idempotency-Key']], ['POST', 'k-i']);
      final out = await api.disburse(77, const {'cashAccountId': 3}, idempotencyKey: 'k-d');
      expect(out.status, IcLoanStatus.disbursed);
      expect(adapter.calls.last.uri.path, endsWith('/intercompany-loans/77/disburse'));
      expect(adapter.calls.last.headers['Idempotency-Key'], 'k-d');
    });

    test('a refusal arrives as ProblemException with the code and figures', () async {
      adapter.respond = (_) =>
          (409, {'title': 'Conflict', 'code': 'LOAN_LENDER_INSUFFICIENT', 'available': 1, 'needed': 2, 'gap': 1});
      await expectLater(
        api.instruct(const {}, idempotencyKey: 'k'),
        throwsA(
          isA<ProblemException>()
              .having((e) => e.code, 'code', 'LOAN_LENDER_INSUFFICIENT')
              .having((e) => e.body['gap'], 'gap', 1),
        ),
      );
    });
  });

  test('notification deep link: intercompany_loan → the loan detail', () {
    AppNotification n(String? docType, String? docId) => AppNotification.fromJson({
      'id': 1,
      'uuid': 'u',
      'event': 'icloan.instructed',
      'title': 'Perintah pinjaman antar-PT: PJA/LAS/2610/0002',
      'body': '',
      'docType': docType,
      'docId': docId,
      'createdAt': '2026-10-14T01:00:00Z',
    });
    expect(n('intercompany_loan', '77').route(), '/intercompany-loans/77');
    expect(n('intercompany_loan', 'x').route(), isNull);
    expect(n('expense_request', '42').route(), '/requests/42', reason: 'expense.fund_shortfall opens the request');
  });

  test('statuses and labels follow the web vocabulary', () {
    expect(IcLoanStatus.values.map((s) => s.code), [
      'instructed',
      'disbursed',
      'partially_repaid',
      'repaid',
      'cancelled',
    ]);
    expect(IcLoanStatus.values.map((s) => s.label), [
      'Menunggu pencairan',
      'Dicairkan',
      'Sebagian dikembalikan',
      'Lunas',
      'Dibatalkan',
    ]);
    expect(IcLoanStatus.fromCode('repaid').active, isTrue);
    expect(IcLoanStatus.fromCode('cancelled').active, isFalse);
    expect(formatRupiah(447500), 'Rp 447.500');
  });
}
