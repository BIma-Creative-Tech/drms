import '../../auth/domain/user_profile.dart';
import '../../privacy/domain/privacy.dart';
import '../domain/draft.dart';
import '../domain/expense_request.dart';
import '../domain/fund_check.dart';
import '../domain/request_status.dart';

/// JSON (openapi v1) → domain. Tolerant: unknown/missing optional fields never crash the app.
typedef Json = Map<String, dynamic>;

int _int(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
double? _dblN(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);
String? _strN(Object? v) => v?.toString();
List<dynamic> _list(Object? v) => v is List ? v : const [];
Json? _map(Object? v) => v is Map<String, dynamic> ? v : null;

/// MC3: PT of a list item / document — `companyId` (expense, cash, notifications, addenda, progress) or
/// `company {id, shortCode, name}` (approval inbox, LPJ queue). Null from a server before MC3.
int? companyIdOf(Json j) => _intN(j['companyId']) ?? _intN(_map(j['company'])?['id']) ?? _intN(j['company']);

RefItem? refFromJson(Object? v) {
  final m = _map(v);
  if (m == null || _intN(m['id']) == null) return null;
  return RefItem(id: _int(m['id']), code: _strN(m['code']), name: _strN(m['name']));
}

/// A PT reference `{id, shortCode, name}` (ADR 0028 `payeeCompany`, `targetCompany`) — the short code as [RefItem.code].
RefItem? companyRefFromJson(Object? v) {
  final m = _map(v);
  if (m == null || _intN(m['id']) == null) return null;
  return RefItem(id: _int(m['id']), code: _strN(m['shortCode'] ?? m['code']), name: _strN(m['name']));
}

/// ADR 0031 `{id, name}` of a cash account (`pusatBiaya`, `transfers[].cashAccount` / `paidFromCashAccount`); null when
/// absent or malformed.
AccountRef? accountRefFromJson(Object? v) {
  final m = _map(v);
  if (m == null || _intN(m['id']) == null) return null;
  return AccountRef(id: _int(m['id']), name: _strN(m['name']));
}

/// ADR 0031 `transfers[].projectLoan {id, docNo, status}` (null when the transfer was paid from the Pusat Biaya).
TransferLoanRef? transferLoanFromJson(Object? v) {
  final m = _map(v);
  if (m == null || _intN(m['id']) == null) return null;
  return TransferLoanRef(id: _int(m['id']), docNo: _strN(m['docNo']), status: _strN(m['status']));
}

/// ADR 0028 `intercompany {status, targetEntryNo, targetCompany, transferId}` (null before the transfer / otherwise).
RequestIntercompany? requestIntercompanyFromJson(Object? v) {
  final m = _map(v);
  final no = _strN(m?['targetEntryNo']);
  if (m == null || no == null || no.isEmpty) return null;
  return RequestIntercompany(
    targetEntryNo: no,
    voided: m['status'] == 'void',
    targetCompany: companyRefFromJson(m['targetCompany']),
    transferId: _intN(m['transferId']),
  );
}

BudgetImpact budgetFromJson(Object? v) {
  final m = _map(v);
  if (m == null) return const BudgetImpact(basis: 'none');
  return BudgetImpact(
    basis: '${m['basis'] ?? 'none'}',
    pctBefore: _dblN(m['pctBefore']),
    pctAfter: _dblN(m['pctAfter']),
  );
}

UserProfile userProfileFromJson(Json j) {
  final settings = _map(j['settings']) ?? const {};
  final targets = _map(settings['imageTargets']);
  final emp = _map(j['employee']);
  final roles = Role.effective({for (final r in _list(j['roles'])) ?Role.fromCode('$r')});
  final caps = _map(j['capabilities']);
  return UserProfile(
    id: _int(j['id']),
    email: '${j['email'] ?? ''}',
    name: _strN(j['name']),
    // d1010 (WA-14): optional — servers before the greeting resolver omit it.
    serverDisplayName: _strN(j['displayName']),
    roles: roles,
    capabilities: _capabilities(caps, roles),
    employee: emp == null ? null : _employee(emp),
    timezone: '${settings['timezone'] ?? 'Asia/Makassar'}',
    minAppVersion: _strN(settings['minAppVersion']),
    imageTargets: targets == null
        ? const ImageTargets()
        : ImageTargets(
            receiptsMaxPx: _int(targets['receiptsMaxPx'], 2000),
            jpegQuality: _int(targets['jpegQuality'], 80),
          ),
    serverTime: _strN(j['serverTime']),
    companies: [
      for (final c in _list(j['companies']))
        if (_map(c) case final m? when _intN(m['id']) != null) companyMembershipFromJson(m),
    ],
    // ADR 0018: absent on servers before the privacy notice (→ null = nothing is blocked)
    privacy: PrivacyStatus.fromJson(j['privacy']),
  );
}

Capabilities _capabilities(Json? caps, Set<Role> roles) => caps == null
    ? Capabilities.fromRoles(roles)
    : Capabilities(
        approvalInbox: caps['approvalInbox'] == true,
        teamMonitor: caps['teamMonitor'] == true,
        progressReportCreate: caps['progressReportCreate'] == true,
        serviceReportCreate: caps['serviceReportCreate'] == true,
        unitTimesheetCreate: caps['unitTimesheetCreate'] == true,
        aftersalesActivityCreate: caps['aftersalesActivityCreate'] == true,
        dailyReportCreate: caps['dailyReportCreate'] == true,
        // ADR 0028: absent on a server before the field → null (fallback in mayFileIntercompanyPayment)
        intercompanyPayment: caps['intercompanyPayment'] is bool ? caps['intercompanyPayment'] as bool : null,
        // ADR 0029: absent on a server before the fields → false (no instruction / disbursement UI)
        instructIntercompanyLoan: caps['instructIntercompanyLoan'] == true,
        disburseIntercompanyLoan: caps['disburseIntercompanyLoan'] == true,
        fundCheckEnabled: caps['fundCheckEnabled'] == true,
      );

/// `GET /me` `companies[]` item (openapi `MeCompany`, MC3).
CompanyMembership companyMembershipFromJson(Json j) {
  final roles = Role.effective({for (final r in _list(j['roles'])) ?Role.fromCode('$r')});
  final emp = _map(j['employee']);
  final s = _map(j['settings']) ?? const {};
  final empId = _intN(j['employeeId']);
  return CompanyMembership(
    id: _int(j['id']),
    code: '${j['code'] ?? j['shortCode'] ?? '#${j['id']}'}',
    name: '${j['name'] ?? ''}',
    timezone: '${j['timezone'] ?? 'Asia/Makassar'}',
    roles: roles,
    employee: emp != null ? _employee(emp) : (empId == null ? null : Employee(id: empId, code: '', name: '')),
    capabilities: _capabilities(_map(j['capabilities']), roles),
    ownRequestNoApproval: j['ownRequestNoApproval'] == true,
    settings: CompanySettings(
      defaultGeofenceRadiusM: _int(s['defaultGeofenceRadiusM'], 100),
      receiptRoundingTolerance: _int(s['receiptRoundingTolerance']),
      receiptMaxAgeDays: _int(s['receiptMaxAgeDays']),
      budgetWarnPct: _dblN(s['budgetWarnPct']) ?? 85,
      syncExpenseDraftsEnabled: s['syncExpenseDraftsEnabled'] != false,
      syncAttendanceEnabled: s['syncAttendanceEnabled'] == true,
      syncProgressReportsEnabled: s['syncProgressReportsEnabled'] == true,
      fieldReportsEnabled: s['fieldReportsEnabled'] == true,
    ),
  );
}

ExpenseSummary summaryFromJson(Json j) {
  final status = RequestStatus.fromCode(j['status'] as String?);
  final type = RequestType.fromCode(j['type'] as String?);
  return ExpenseSummary(
    id: _int(j['id']),
    docNo: _strN(j['docNo']),
    type: type,
    typeLabel: '${j['typeLabel'] ?? type.label}',
    status: status,
    statusLabel: '${j['statusLabel'] ?? status.label}',
    title: '${j['title'] ?? ''}',
    grandTotal: _int(j['grandTotal']),
    approvedAmount: _intN(j['approvedAmount']),
    requestDate: _strN(j['requestDate']),
    neededDate: _strN(j['neededDate']),
    updatedAt: _strN(j['updatedAt']),
    openWarningFlags: _int(j['openWarningFlags']),
    companyId: companyIdOf(j),
    payeeType: PayeeType.fromCode(_strN(j['payeeType'])),
  );
}

SignPosition _position(Object? v) => switch (v) {
  'diajukan' => SignPosition.diajukan,
  'dibuat' => SignPosition.dibuat,
  'diketahui' => SignPosition.diketahui,
  _ => SignPosition.approval,
};

/// ADR 0025 `direkturSignature` (null when absent, malformed, or from a server before ADR 0025).
DirekturSignature? direkturSignatureFromJson(Object? v) {
  final m = _map(v);
  final name = _strN(m?['name']);
  final id = _intN(m?['signatureId']);
  if (name == null || name.isEmpty || id == null) return null;
  return DirekturSignature(name: name, title: _strN(m?['title']), signatureId: id);
}

/// ADR 0029 `fundCheck` (null when absent / malformed, or from a server before ADR 0029).
FundCheck? fundCheckFromJson(Object? v) {
  final m = _map(v);
  final companyId = _intN(m?['companyId']);
  if (m == null || companyId == null) return null;
  final company = _map(m['company']);
  final excluded = _map(m['excludedSiteAccounts']);
  final waiting = _map(m['waitingAtOwner']);
  return FundCheck(
    companyId: companyId,
    companyCode: _strN(company?['shortCode'] ?? company?['code']),
    companyName: _strN(company?['name']),
    enabled: m['enabled'] == true,
    applies: m['applies'] == true,
    status: FundCheckStatus.fromCode(_strN(m['status'])),
    blocked: m['blocked'] == true,
    blockedText: _strN(m['blockedText']),
    balance: _int(m['balance']),
    commitments: _int(m['commitments']),
    available: _int(m['available']),
    needed: _int(m['needed']),
    gap: _int(m['gap']),
    accountCount: _int(m['accountCount']),
    excludedSiteCount: _int(excluded?['count']),
    excludedSiteBalance: _int(excluded?['balance']),
    waitingCount: _int(waiting?['count']),
    waitingAmount: _int(waiting?['amount']),
    commitmentItems: _fundCommitmentItems(m['commitmentItems']),
    loans: [
      for (final l in _list(m['loans']))
        if (_map(l) case final x? when _intN(x['id']) != null)
          FundLoanRef(
            id: _int(x['id']),
            docNo: '${x['docNo'] ?? '#${x['id']}'}',
            status: '${x['status'] ?? ''}',
            amount: _int(x['amount']),
            lenderCode: _strN(_map(x['lender'])?['shortCode']),
            serverStatusLabel: _strN(x['statusLabel']),
          ),
    ],
    route: FundCheckRoute.fromCode(_strN(m['route'])),
    routeText: _strN(m['routeText']),
    pusatBiaya: _fundPusatBiaya(m['pusatBiaya']),
  );
}

/// `fundCheck.commitmentItems[]` / `fundCheck.pusatBiaya.commitmentItems[]` (rows without an id are skipped).
List<FundCommitmentItem> _fundCommitmentItems(Object? v) => [
  for (final c in _list(v))
    if (_map(c) case final x? when _intN(x['id']) != null)
      FundCommitmentItem(
        kind: '${x['kind'] ?? ''}',
        id: _int(x['id']),
        docNo: _strN(x['docNo']),
        amount: _int(x['amount']),
        status: '${x['status'] ?? ''}',
      ),
];

/// ADR 0031 amendment `fundCheck.pusatBiaya` (null when absent / malformed: not mapped, or an older server).
FundPusatBiaya? _fundPusatBiaya(Object? v) {
  final m = _map(v);
  final accountId = _intN(m?['accountId']);
  if (m == null || accountId == null) return null;
  return FundPusatBiaya(
    accountId: accountId,
    name: _strN(m['name']) ?? '#$accountId',
    balance: _int(m['balance']),
    commitments: _int(m['commitments']),
    available: _int(m['available']),
    commitmentItems: _fundCommitmentItems(m['commitmentItems']),
  );
}

ExpenseDetail detailFromJson(Json j) {
  final status = RequestStatus.fromCode(j['status'] as String?);
  final type = RequestType.fromCode(j['type'] as String?);
  final bank = _map(j['bank']);
  final rule = _map(j['approvalRule']);
  final invoice = _map(j['invoice']);
  return ExpenseDetail(
    id: _int(j['id']),
    docNo: _strN(j['docNo']),
    clientUuid: _strN(j['clientUuid']),
    type: type,
    typeLabel: '${j['typeLabel'] ?? type.label}',
    status: status,
    statusLabel: '${j['statusLabel'] ?? status.label}',
    title: '${j['title'] ?? ''}',
    grandTotal: _int(j['grandTotal']),
    approvedAmount: _intN(j['approvedAmount']),
    requestDate: _strN(j['requestDate']),
    neededDate: _strN(j['neededDate']),
    notes: _strN(j['notes']),
    project: refFromJson(j['project']),
    costCenter: refFromJson(j['costCenter']),
    requesters: [for (final r in _list(j['requesters'])) ?refFromJson(r)],
    createdByName: _strN(_map(j['createdBy'])?['name']),
    bankName: _strN(bank?['bankName']),
    bankAccountNo: _strN(bank?['accountNo']),
    bankAccountHolder: _strN(bank?['accountHolder']),
    lines: [
      for (final l in _list(j['lines']))
        if (_map(l) case final m?)
          ExpenseLine(
            id: '${m['id']}',
            no: _int(m['no']),
            description: _strN(m['description']),
            qty: _dblN(m['qty']),
            uom: refFromJson(m['uom']),
            unitPrice: _intN(m['unitPrice']),
            unitPriceDisplay: _intN(m['unitPriceDisplay']),
            total: _int(m['total']),
            notes: _strN(m['notes']),
            category: refFromJson(m['category']),
            vehiclePlate: _strN(_map(m['vehicle'])?['plateDisplay'] ?? _map(m['vehicle'])?['plateNo']),
            vehicleId: _intN(_map(m['vehicle'])?['id']),
            receiptAmount: _intN(m['receiptAmount']),
            receiptMismatch: m['receiptMismatch'] is bool ? m['receiptMismatch'] as bool : null,
            // D4: `rapItem {id, code, name}`; a bare `rapItemId` from a server without the read model.
            rapItem:
                refFromJson(m['rapItem']) ?? (_intN(m['rapItemId']) == null ? null : RefItem(id: _int(m['rapItemId']))),
            rapOverBudget: m['rapOverBudget'] is bool ? m['rapOverBudget'] as bool : null,
          ),
    ],
    receipts: [
      for (final r in _list(j['receipts']))
        if (_map(r) case final m?)
          ReceiptInfo(
            id: _int(m['id']),
            lineId: '${m['lineId']}',
            lineNo: _intN(m['lineNo']),
            receiptNo: _strN(m['receiptNo']),
            vendorName: '${m['vendorName'] ?? ''}',
            receiptDate: '${m['receiptDate'] ?? ''}',
            amount: _int(m['amount']),
            imageId: _intN(m['imageId']),
            status: '${m['status'] ?? 'pending'}',
          ),
    ],
    approvals: [
      for (final a in _list(j['approvals']))
        if (_map(a) case final m?)
          ApprovalEntry(
            id: _int(m['id']),
            cycle: _int(m['cycle'], 1),
            position: _position(m['position']),
            level: _int(m['level']),
            actorName: _strN(m['actorName']),
            onBehalf: m['onBehalf'] == true,
            decision: '${m['decision'] ?? ''}',
            reason: _strN(m['reason']),
            decidedAt: _strN(m['decidedAt']),
          ),
    ],
    approvalRule: rule == null
        ? null
        : ApprovalRuleInfo(
            name: '${rule['name'] ?? ''}',
            acknowledge: '${rule['acknowledge'] ?? 'none'}',
            acknowledgeDelegatedTo: _strN(rule['acknowledgeDelegatedTo']),
            acknowledgeBy: _strN(rule['acknowledgeBy']),
            acknowledgeRole: _strN(rule['acknowledgeRole']),
            decisionRoles: [for (final r in _list(rule['decisionRoles'])) '$r'],
            selfApproval: _strN(rule['selfApproval']),
            skipped: [
              for (final k in _list(rule['skipped']))
                if (_map(k) case final m?)
                  SkippedPosition(
                    position: m['position'] == 'diketahui' ? SignPosition.diketahui : SignPosition.approval,
                    level: _int(m['level']),
                    role: _strN(m['role']),
                    reason: _strN(m['reason']),
                  ),
            ],
            steps: [
              for (final s in _list(rule['steps']))
                if (_map(s) case final m?)
                  RuleStep(
                    level: _int(m['level'], 1),
                    approverRole: _strN(m['approverRole']),
                    approverUserId: _intN(m['approverUserId']),
                  ),
            ],
          ),
    approvalCycle: _int(j['approvalCycle'], 1),
    currentLevel: _intN(j['currentLevel']),
    flags: [
      for (final f in _list(j['flags']))
        if (_map(f) case final m?)
          FlagInfo(
            id: _int(m['id']),
            kind: '${m['kind'] ?? m['code'] ?? ''}',
            kindLabel: '${m['kindLabel'] ?? m['kind'] ?? m['code'] ?? ''}',
            level: '${m['level'] ?? 'info'}',
            status: '${m['status'] ?? ''}',
            lineNo: _intN(m['lineNo']),
            message: '${m['message'] ?? ''}',
          ),
    ],
    budget: budgetFromJson(j['budget']),
    transfers: [
      for (final t in _list(j['transfers']))
        if (_map(t) case final m?)
          TransferInfo(
            id: _int(m['id']),
            docNo: _strN(m['docNo']),
            kind: '${m['kind'] ?? ''}',
            amount: _int(m['amount']),
            transferDate: _strN(m['transferDate']),
            transferAt: _strN(m['transferAt']),
            costCenter: refFromJson(m['costCenter']),
            bankRef: _strN(m['bankRef']),
            status: '${m['status'] ?? 'posted'}',
            voidReason: _strN(m['voidReason']),
            cashAccount: accountRefFromJson(m['cashAccount']),
            paidFromCashAccount: accountRefFromJson(m['paidFromCashAccount']),
            projectLoan: transferLoanFromJson(m['projectLoan']),
          ),
    ],
    transferredTotal: _int(j['transferredTotal']),
    settlement: settlementFromJson(j['settlement']),
    allowedActions: {for (final a in _list(j['allowedActions'])) '$a'},
    direkturSignature: direkturSignatureFromJson(j['direkturSignature']),
    fundCheck: fundCheckFromJson(j['fundCheck']),
    pusatBiaya: accountRefFromJson(j['pusatBiaya']),
    companyId: companyIdOf(j),
    rejectReason: _strN(j['rejectReason']),
    cancelReason: _strN(j['cancelReason']),
    submittedAt: _strN(j['submittedAt']),
    updatedAt: _strN(j['updatedAt']),
    rev: _intN(j['rev']),
    resubmitOfId: _intN(j['resubmitOfId']),
    createdById: _intN(j['createdById']),
    urgencyLevel: refFromJson(j['urgencyLevel']),
    bankAccountId: _intN(j['bankAccountId']),
    // ADR 0027 (absent on servers before Wave 4 → an employee payment)
    payeeType: PayeeType.fromCode(_strN(j['payeeType'])),
    vendor: refFromJson(j['vendor']),
    vendorBankAccountId: _intN(j['vendorBankAccountId']),
    invoiceNo: _strN(invoice?['no']),
    invoiceDate: _strN(invoice?['date']),
    invoiceDueDate: _strN(invoice?['dueDate']),
    invoiceFileId: _intN(invoice?['fileId']),
    invoiceFileName: _strN(invoice?['fileName']),
    // ADR 0028 (absent on servers before Phase B)
    payeeCompany: companyRefFromJson(j['payeeCompany']),
    intercompany: requestIntercompanyFromJson(j['intercompany']),
  );
}

HistoryEntry historyFromJson(Json j) => HistoryEntry(
  serverTime: '${j['serverTime'] ?? ''}',
  action: '${j['action'] ?? ''}',
  field: _strN(j['field']),
  lineNo: _intN(j['lineNo']),
  oldValue: j['oldValue'],
  newValue: j['newValue'],
  statusFrom: _strN(j['statusFrom']),
  statusTo: _strN(j['statusTo']),
  reason: _strN(j['reason']),
  userId: _intN(j['userId']),
  userName: _strN(j['userName']),
  source: _strN(j['source']),
  appVersion: _strN(j['appVersion']),
  deviceId: _strN(j['deviceId']),
  docType: '${j['docType'] ?? 'expense_request'}',
  docNo: _strN(j['docNo']),
);

SettlementInfo? settlementFromJson(Object? v) {
  final m = _map(v);
  if (m == null || _intN(m['id']) == null) return null;
  return SettlementInfo(
    id: _int(m['id']),
    docNo: _strN(m['docNo']),
    status: '${m['status'] ?? ''}',
    statusLabel: '${m['statusLabel'] ?? m['status'] ?? ''}',
    usageNotes: _strN(m['usageNotes']),
    transferredTotal: _intN(m['transferredTotal']),
    receiptsTotal: _intN(m['receiptsTotal']),
    verifiedReceiptsTotal: _intN(m['verifiedReceiptsTotal']),
    difference: _intN(m['difference']),
    settlementType: _strN(m['settlementType']),
    financeNotes: _strN(m['financeNotes']),
    submitCount: _int(m['submitCount']),
    submittedAt: _strN(m['submittedAt']),
    verifiedAt: _strN(m['verifiedAt']),
    settledAt: _strN(m['settledAt']),
    // d1010 (13): LPJ photos — media ids, or objects with `id` / `imageId`.
    photos: [
      for (final p in _list(m['photos'])) ?(p is num ? p.toInt() : _intN(_map(p)?['id'] ?? _map(p)?['imageId'])),
    ],
  );
}

InboxItem inboxItemFromJson(Json j) {
  final status = RequestStatus.fromCode(j['status'] as String?);
  final type = RequestType.fromCode(j['type'] as String?);
  final budget = _map(j['budget']);
  final flags = _map(j['flags']);
  return InboxItem(
    id: _int(j['id']),
    docNo: _strN(j['docNo']),
    type: type,
    typeLabel: '${j['typeLabel'] ?? type.label}',
    status: status,
    statusLabel: '${j['statusLabel'] ?? status.label}',
    title: '${j['title'] ?? ''}',
    scope: '${j['scope'] ?? ''}',
    requesters: '${j['requesters'] ?? ''}',
    grandTotal: _int(j['grandTotal']),
    neededDate: _strN(j['neededDate']),
    step: '${j['step'] ?? 'approve'}',
    level: _intN(j['level']),
    stepLabel: _strN(j['stepLabel']),
    decisionFlow: j['decisionFlow'] == true,
    budget: budgetFromJson(budget),
    budgetOverWarn: budget?['overWarn'] == true,
    warningFlags: _int(flags?['warning']),
    infoFlags: _int(flags?['info']),
    receiptMismatchFlags: _int(flags?['receiptMismatch']),
    companyId: companyIdOf(j),
    // ADR 0029: positive gap only (null / 0 = no badge)
    fundShort: switch (_intN(j['fundShort'])) {
      final g? when g > 0 => g,
      _ => null,
    },
  );
}

/// ADR 0027 / 0028: payee fields of the create body (`invoiceFileId` = the uploaded invoice / document; DraftService
/// uploads it first).
Json _vendorCreateFields(DraftRequest d) => switch (d.payeeType) {
  PayeeType.karyawan => const {},
  PayeeType.vendor => {
    'payeeType': PayeeType.vendor.code,
    'vendorId': d.vendorId,
    'vendorBankAccountId': d.vendorBankAccountId,
    ..._invoiceCreateFields(d),
  },
  PayeeType.ptGrup => {
    'payeeType': PayeeType.ptGrup.code,
    'payeeCompanyId': d.payeeCompanyId,
    ..._invoiceCreateFields(d),
  },
};

Json _invoiceCreateFields(DraftRequest d) => {
  'invoiceNo': _trimmed(d.invoiceNo),
  'invoiceDate': d.invoiceDate,
  'invoiceDueDate': d.invoiceDueDate,
  'invoiceFileId': d.invoiceFileId,
};

String? _trimmed(String? v) => (v == null || v.trim().isEmpty) ? null : v.trim();

/// Local draft → `POST /api/v1/expense-requests` body (openapi `ExpenseRequestCreate`).
Json draftToCreateBody(DraftRequest d) => {
  // ADR 0027 / 0028: a vendor / PT grup payment is always Pengajuan Baru (the server sets it too)
  'type': d.isDirectPayment ? RequestType.advance.code : d.type.code,
  'title': d.title.trim(),
  // D2 / ADR 0031 (DRMS 21/10): project only — the requester never sends a cost center (the Pusat Biaya is the
  // project's cash account); a vendor / PT grup payment without a project has none.
  'projectId': d.projectId,
  'neededDate': d.neededDate,
  'urgencyLevelId': d.urgencyLevelId,
  'notes': (d.notes == null || d.notes!.trim().isEmpty) ? null : d.notes!.trim(),
  if (d.requesterIds.isNotEmpty) 'requesterIds': d.requesterIds,
  'bankAccountId': d.isDirectPayment ? null : d.bankAccountId,
  ..._vendorCreateFields(d),
  'lines': [for (final l in d.lines) lineToInput(l)],
  'clientUuid': d.clientUuid,
};

/// D3: `total` is qty × unitPrice (the server recomputes it; a pre-D3 line without unit price sends its
/// typed total until the user completes it).
Json lineToInput(DraftLine l) => {
  'description': l.description.trim(),
  'qty': l.qty,
  'uomId': l.uomId,
  'unitPrice': l.unitPrice,
  'total': l.computedTotal ?? l.total,
  'receiptAmount': l.receiptAmount,
  'rapItemId': l.rapItemId,
  'notes': (l.notes == null || l.notes!.trim().isEmpty) ? null : l.notes!.trim(),
  'categoryId': l.categoryId,
  'vehicleId': l.vehicleId,
};

/// Local draft → `expense_request.draft_upsert` payload (openapi `SyncDraftUpsertPayload`, backend
/// 0.2.1). Receipts carry the local photo id in [mediaPlaceholderKey]; the sync engine uploads the photo
/// (`POST /media/receipts`) and replaces it with `media_id` just before sending.
/// [includeDraftId]: edits queued after the first upsert use a new item `client_uuid`, so the draft is
/// identified by `draft_client_uuid` (backend default = the item that created it).
Json draftToSyncPayload(DraftRequest d, {bool includeDraftId = false}) => {
  if (includeDraftId) 'draft_client_uuid': d.clientUuid,
  // A draft imported from the server (withdrawn / "Ajukan ulang" clone, E3-d) may have been created on
  // the web without this phone's id: the server id then identifies it (SyncDraftUpsertPayload.request_id).
  if (d.serverId != null) 'request_id': d.serverId,
  'kind': d.isDirectPayment ? RequestType.advance.code : d.type.code,
  'title': d.title.trim(),
  'project_id': d.projectId,
  'needed_date': d.neededDate,
  'urgency_level_id': d.urgencyLevelId,
  'notes': (d.notes == null || d.notes!.trim().isEmpty) ? null : d.notes!.trim(),
  'requester_ids': d.requesterIds,
  'bank_account_id': d.isDirectPayment ? null : d.bankAccountId,
  // ADR 0027 / 0028: vendor / PT grup payment only (an employee draft stays byte-compatible with servers before Wave 4;
  // the payee type of a draft the server knows is fixed in the editor)
  if (d.isDirectPayment) ...{
    'payee_type': d.payeeType.code,
    if (d.isVendor) ...{'vendor_id': d.vendorId, 'vendor_bank_account_id': d.vendorBankAccountId},
    if (d.isPtGrup) 'payee_company_id': d.payeeCompanyId,
    'invoice_no': _trimmed(d.invoiceNo),
    'invoice_date': d.invoiceDate,
    'invoice_due_date': d.invoiceDueDate,
    if (d.invoiceFileId != null) 'invoice_file_id': d.invoiceFileId,
    // local invoice / document photo: uploaded by the sync engine (POST /media/attachments), replaced by
    // `invoice_file_id`
    if (d.invoiceFileId == null && d.invoiceMediaUuid != null) invoicePlaceholderKey: d.invoiceMediaUuid,
  },
  'client_grand_total': d.previewGrandTotal,
  'lines': [
    for (final l in d.lines)
      {
        // Lines from the server keep their server id (not a UUID when created on the web).
        if (isUuid(l.clientUuid)) 'client_uuid': l.clientUuid else 'id': l.clientUuid,
        'description': l.description.trim(),
        'qty': l.qty,
        'uom_id': l.uomId,
        'unit_price': l.unitPrice,
        'total': l.computedTotal ?? l.total,
        'receipt_amount': l.receiptAmount,
        'rap_item_id': l.rapItemId,
        'notes': (l.notes == null || l.notes!.trim().isEmpty) ? null : l.notes!.trim(),
        'category_id': l.categoryId,
        'vehicle_id': l.vehicleId,
        if (d.type == RequestType.reimburse)
          'receipts': [
            for (final r in l.receipts)
              if (!r.isServerReceipt)
                {
                  'client_uuid': r.clientUuid,
                  'receipt_no': (r.receiptNo == null || r.receiptNo!.trim().isEmpty) ? null : r.receiptNo!.trim(),
                  'vendor_name': r.vendorName.trim(),
                  'receipt_date': r.receiptDate,
                  'receipt_time': r.receiptTime,
                  'amount': r.amount,
                  mediaPlaceholderKey: r.mediaUuid,
                },
          ],
      },
  ],
};

final _uuidRe = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false);

bool isUuid(String s) => _uuidRe.hasMatch(s);

/// Server Draft (withdrawn request or the new draft of "Ajukan ulang", US-04/US-06) → local draft for the
/// offline editor. Lines keep their server id; receipts stay on the server and are shown read-only
/// ([serverMediaPrefix]). [clientUuid]: the request's own `clientUuid` when it has one (made on a phone).
DraftRequest draftFromServer(
  ExpenseDetail d, {
  required String clientUuid,
  required String Function(int) receiptUuid,
}) => DraftRequest(
  clientUuid: clientUuid,
  type: d.type,
  companyId: d.companyId,
  title: d.title,
  projectId: d.project?.id,
  costCenterId: d.costCenter?.id,
  neededDate: d.neededDate,
  urgencyLevelId: d.urgencyLevel?.id,
  notes: d.notes,
  requesterIds: [for (final r in d.requesters) r.id],
  bankAccountId: d.bankAccountId,
  // ADR 0027 / 0028: vendor / PT grup payment — the invoice / document stays on the server (its media id)
  payeeType: d.payeeType,
  vendorId: d.vendor?.id,
  vendorBankAccountId: d.vendorBankAccountId,
  payeeCompanyId: d.payeeCompany?.id,
  invoiceNo: d.invoiceNo,
  invoiceDate: d.invoiceDate,
  invoiceDueDate: d.invoiceDueDate,
  invoiceFileId: d.invoiceFileId,
  serverId: d.id,
  serverRev: d.rev,
  syncState: DraftSyncState.synced,
  lines: [
    for (final l in d.lines)
      DraftLine(
        clientUuid: l.id,
        no: l.no,
        description: l.description ?? '',
        qty: l.qty,
        uomId: l.uom?.id,
        unitPrice: l.unitPrice,
        total: l.total,
        receiptAmount: l.receiptAmount,
        rapItemId: l.rapItem?.id,
        categoryId: l.category?.id,
        vehicleId: l.vehicleId,
        notes: l.notes,
        receipts: [
          for (final r in d.receipts)
            if (r.lineId == l.id && r.status != 'removed')
              DraftReceipt(
                clientUuid: receiptUuid(r.id),
                receiptNo: r.receiptNo,
                vendorName: r.vendorName,
                receiptDate: r.receiptDate,
                amount: r.amount,
                mediaUuid: '$serverMediaPrefix${r.imageId ?? r.id}',
                serverReceiptId: r.id,
              ),
        ],
      ),
  ],
);

/// Local-only key inside a queued payload; never sent (replaced by `media_id`).
const mediaPlaceholderKey = 'pk_media_uuid';

/// Local-only key of an attendance item's selfie (replaced by `selfie_media_id`).
const selfiePlaceholderKey = 'pk_selfie_uuid';

/// Local-only key of a "Di luar area" attendance item (DRMS 13/10 A2, history label); removed before sending.
const outsideAreaHintKey = 'pk_outside_area';

/// Local-only key of a progress report item: local photo ids, replaced by `photo_media_ids` (E4). FR1 service
/// reports and aftersales activities use it too (same `photo_media_ids` field).
const progressPhotosPlaceholderKey = 'pk_photo_uuids';

/// Local-only key of a `unit_timesheet.upsert` item (FR1): the HM meter photo, replaced by `hm_photo_media_id`.
const hmPhotoPlaceholderKey = 'pk_hm_photo_uuid';

/// ADR 0027 / 0028: local-only key of a vendor / PT grup payment draft item: the invoice / document photo, replaced by
/// `invoice_file_id`.
const invoicePlaceholderKey = 'pk_invoice_uuid';

/// Replaces [mediaPlaceholderKey] by `media_id` using [mediaIds] (local uuid → server id).
/// Returns null when a photo has no server id yet.
Json? resolveMediaIds(Json payload, Map<String, int> mediaIds) {
  // ADR 0027: the invoice photo of a vendor-payment draft (then the draft's receipts as usual).
  if (payload.containsKey(invoicePlaceholderKey)) {
    final out = Map<String, dynamic>.of(payload);
    final local = out.remove(invoicePlaceholderKey);
    if (local != null) {
      final id = mediaIds['$local'];
      if (id == null) return null;
      out['invoice_file_id'] = id;
    }
    return resolveMediaIds(out, mediaIds);
  }
  // Progress report: local photos are appended to the ids already known on the server.
  if (payload.containsKey(progressPhotosPlaceholderKey)) {
    final out = Map<String, dynamic>.of(payload);
    final locals = (out.remove(progressPhotosPlaceholderKey) as List<dynamic>? ?? const []).map((e) => '$e');
    final ids = <int>[for (final e in (out['photo_media_ids'] as List<dynamic>? ?? const [])) (e as num).toInt()];
    for (final l in locals) {
      final id = mediaIds[l];
      if (id == null) return null;
      ids.add(id);
    }
    if (ids.isEmpty) {
      out.remove('photo_media_ids');
    } else {
      out['photo_media_ids'] = ids;
    }
    return out;
  }
  // FR1 timesheet: exactly one HM photo (`hm_photo_media_id`, SyncUnitTimesheetPayload).
  if (payload.containsKey(hmPhotoPlaceholderKey)) {
    final out = Map<String, dynamic>.of(payload);
    final local = out.remove(hmPhotoPlaceholderKey);
    if (local == null) return out;
    final id = mediaIds['$local'];
    if (id == null) return null;
    out['hm_photo_media_id'] = id;
    return out;
  }
  // Attendance: the selfie sits at the top level (`selfie_media_id`, SyncAttendancePayload).
  if (payload.containsKey(selfiePlaceholderKey)) {
    final out = Map<String, dynamic>.of(payload)..remove(outsideAreaHintKey);
    final id = mediaIds[out.remove(selfiePlaceholderKey)];
    if (id == null) return null;
    out['selfie_media_id'] = id;
    return out;
  }
  final lines = payload['lines'];
  if (lines is! List) return payload;
  final out = Map<String, dynamic>.of(payload);
  final newLines = <Json>[];
  for (final l in lines.cast<Json>()) {
    final line = Map<String, dynamic>.of(l);
    final rs = line['receipts'];
    if (rs is List) {
      final newRs = <Json>[];
      for (final r in rs.cast<Json>()) {
        final rr = Map<String, dynamic>.of(r);
        final local = rr.remove(mediaPlaceholderKey);
        if (local != null) {
          final id = mediaIds[local];
          if (id == null) return null;
          rr['media_id'] = id;
        }
        newRs.add(rr);
      }
      line['receipts'] = newRs;
    }
    newLines.add(line);
  }
  out['lines'] = newLines;
  return out;
}

/// `expense_request.draft_delete` payload (soft delete = cancel on the server).
Json draftDeletePayload(DraftRequest d) => {
  'draft_client_uuid': d.clientUuid,
  if (d.serverId != null) 'request_id': d.serverId,
  'reason': 'Draft dihapus dari aplikasi',
};

String offsetString(Duration d) {
  final sign = d.isNegative ? '-' : '+';
  final a = d.abs();
  return '$sign${a.inHours.toString().padLeft(2, '0')}:${(a.inMinutes % 60).toString().padLeft(2, '0')}';
}

/// `/me` `EmployeeRef` (+ ADR 0023 `homeSite: {id, code, name} | null`; absent on servers before sites).
Employee _employee(Map<String, dynamic> emp) {
  final site = _map(emp['homeSite']);
  final code = '${site?['code'] ?? ''}';
  final name = '${site?['name'] ?? ''}';
  return Employee(
    id: _int(emp['id']),
    code: '${emp['code'] ?? ''}',
    name: '${emp['name'] ?? ''}',
    homeSiteId: site == null ? null : _intN(site['id']),
    homeSiteLabel: site == null ? null : (code.isEmpty ? name : (name.isEmpty ? code : '$code — $name')),
  );
}
