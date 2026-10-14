import '../../expense/data/expense_mappers.dart';
import '../../expense/domain/expense_request.dart';
import '../../expense/domain/request_status.dart';

/// DRMS 10/10 point 10: Finance menu on the APK — "Antrian Transfer" like the web (`GET /transfer-queue`) and the
/// transfer form (cash account, transfer date + time of the bank proof, cost center D2, bank reference, proof).

int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
double? _dblN(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);
String? _strN(Object? v) => v == null ? null : '$v';
Map<String, dynamic>? _map(Object? v) => v is Map<String, dynamic> ? v : null;

/// Item 11: age since the final approval vs the PT's transfer SLA (`sla`).
class TransferSla {
  const TransferSla({this.approvedAt, this.slaHours = 24, this.ageHours, this.over = false});
  final String? approvedAt;
  final double slaHours;
  final double? ageHours;
  final bool over;
}

/// Web `formatHours` (domain/expense/sla.ts): `< 1 jam`, `5 jam`, `2 hr 3 jam`, `—`.
String formatSlaHours(double? h) {
  if (h == null || !h.isFinite) return '—';
  if (h < 0) return '${h.toStringAsFixed(1)} jam';
  if (h < 1) return '< 1 jam';
  final whole = h.floor();
  if (whole < 24) return '$whole jam';
  final days = whole ~/ 24;
  final rest = whole % 24;
  return rest > 0 ? '$days hr $rest jam' : '$days hr';
}

/// `GET /transfer-queue` `items[]` (openapi `TransferQueueItem`).
class TransferQueueItem {
  const TransferQueueItem({
    required this.id,
    required this.type,
    required this.typeLabel,
    required this.status,
    required this.statusLabel,
    required this.title,
    required this.grandTotal,
    this.docNo,
    this.approvedAmount,
    this.neededDate,
    this.companyId,
    this.project,
    this.costCenter,
    this.bankName,
    this.bankAccountNo,
    this.bankAccountHolder,
    this.bankVerified = false,
    this.warningFlags = 0,
    this.infoFlags = 0,
    this.receiptMismatch = 0,
    this.sla = const TransferSla(),
    this.noApproval = false,
    this.payeeType = PayeeType.karyawan,
    this.payeeCompany,
    this.payeeCompanyName,
  });

  final int id;
  final String? docNo;
  final RequestType type;
  final String typeLabel;
  final RequestStatus status;
  final String statusLabel;
  final String title;
  final int grandTotal;
  final int? approvedAmount;
  final String? neededDate;
  final int? companyId;
  final RefItem? project;

  /// D2: suggested cost center (project default); null = Finance must pick one.
  final RefItem? costCenter;
  final String? bankName;
  final String? bankAccountNo;
  final String? bankAccountHolder;

  /// QA-17: unverified → the server asks for a confirmation before the transfer.
  final bool bankVerified;
  final int warningFlags;
  final int infoFlags;

  /// D3 lines whose "Nominal sesuai nota" ≠ total → "Selisih nota (n)".
  final int receiptMismatch;
  final TransferSla sla;

  /// ADR 0024: a Direktur's own request without any approval (kebijakan PT) — Finance is the only check.
  final bool noApproval;

  /// ADR 0027 / 0028: payee type; for a PT grup payment the receiving PT (`payeeCompany {id, shortCode → code, name}`,
  /// badge "Antar PT: <PT>") — the transfer also posts that PT's Kas Masuk.
  final PayeeType payeeType;
  final RefItem? payeeCompany;
  final String? payeeCompanyName;

  bool get isPtGrup => payeeType == PayeeType.ptGrup;

  /// Short code of the receiving PT of a PT grup payment ("LAS"), else null.
  String? get payeeCompanyCode =>
      isPtGrup ? (payeeCompany?.code ?? payeeCompany?.name ?? payeeCompanyName ?? '-') : null;

  /// What Finance transfers: the approved amount (server-set, G3).
  int get amount => approvedAmount ?? grandTotal;

  String get bankText => [bankName, bankAccountHolder, bankAccountNo].whereType<String>().join(' · ');

  /// Text matched by the search box (same columns as the web: nomor, judul, project, status, bank, pemilik).
  String get searchText => [
    docNo,
    title,
    project?.code,
    project?.name,
    statusLabel,
    bankName,
    bankAccountHolder,
    payeeCompany?.code,
    payeeCompanyName,
  ].whereType<String>().join(' ');
}

TransferQueueItem transferQueueItemFromJson(Map<String, dynamic> j) {
  final s = summaryFromJson(j);
  final bank = _map(j['bank']);
  final flags = _map(j['flags']);
  final sla = _map(j['sla']);
  return TransferQueueItem(
    id: s.id,
    docNo: s.docNo,
    type: s.type,
    typeLabel: s.typeLabel,
    status: s.status,
    statusLabel: s.statusLabel,
    title: s.title,
    grandTotal: s.grandTotal,
    approvedAmount: s.approvedAmount,
    neededDate: s.neededDate,
    companyId: s.companyId,
    project: refFromJson(j['project']),
    costCenter: refFromJson(j['costCenter']),
    bankName: _strN(bank?['bankName']),
    bankAccountNo: _strN(bank?['accountNo']),
    bankAccountHolder: _strN(bank?['accountHolder']),
    bankVerified: j['bankVerification'] == 'verified',
    // older servers: `openWarningFlags` only
    warningFlags: _intN(flags?['warning']) ?? s.openWarningFlags,
    infoFlags: _intN(flags?['info']) ?? 0,
    receiptMismatch: _intN(flags?['receiptMismatch']) ?? 0,
    sla: TransferSla(
      approvedAt: _strN(sla?['approvedAt']),
      slaHours: _dblN(sla?['slaHours']) ?? 24,
      ageHours: _dblN(sla?['ageHours']),
      over: sla?['over'] == true,
    ),
    noApproval: j['noApproval'] == true,
    payeeType: s.payeeType,
    payeeCompany: companyRefFromJson(j['payeeCompany']),
    payeeCompanyName: _strN(j['payeeCompanyName']) ?? _strN(_map(j['payeeCompany'])?['name']),
  );
}

/// Cash account of a PT (`GET /cash-accounts/balances` items).
class CashAccountOption {
  const CashAccountOption({required this.id, required this.name, this.companyId, this.balance, this.active = true});
  final int id;
  final String name;
  final int? companyId;
  final int? balance;

  /// Inactive accounts keep their balance in the list but take no new transfer (server 400 `cashAccountId`);
  /// a server without the field lists active ones only as far as the APK knows → true.
  final bool active;
}

CashAccountOption cashAccountFromJson(Map<String, dynamic> j) => CashAccountOption(
  id: _intN(j['cashAccountId'] ?? j['id']) ?? 0,
  name: '${j['name'] ?? ''}',
  companyId: _intN(j['companyId']),
  balance: _intN(j['balance']),
  active: j['active'] != false,
);

/// `GET /cost-centers` `docs[]`.
class CostCenterOption {
  const CostCenterOption({required this.id, required this.code, required this.name, this.companyId});
  final int id;
  final String code;
  final String name;
  final int? companyId;

  String get label => '$code $name'.trim();
}

CostCenterOption costCenterFromJson(Map<String, dynamic> j) => CostCenterOption(
  id: _intN(j['id']) ?? 0,
  code: '${j['code'] ?? ''}',
  name: '${j['name'] ?? ''}',
  companyId: _intN(j['companyId']),
);

/// Body of `POST /expense-requests/{id}/transfer` (openapi `TransferCreate`). The amount is never sent: the
/// server copies the approved amount (G3).
Map<String, dynamic> transferBody({
  required int cashAccountId,
  required int costCenterId,
  required String transferAt,
  required String bankRef,
  required int proofMediaId,
  bool confirmOverdraft = false,
  bool confirmUnverifiedAccount = false,
}) => {
  'cashAccountId': cashAccountId,
  'costCenterId': costCenterId,
  'transferAt': transferAt,
  'bankRef': bankRef.trim(),
  'proofMediaId': proofMediaId,
  if (confirmOverdraft) 'confirmOverdraft': true,
  if (confirmUnverifiedAccount) 'confirmUnverifiedAccount': true,
};

/// Wall clock in the PT zone, `YYYY-MM-DDTHH:MM` + the zone offset (`+08:00` WITA) — the server reads it in the PT
/// zone (item 11: date + time of the bank proof).
String transferAtString(DateTime wall, Duration zoneOffset) {
  String two(int v) => v.toString().padLeft(2, '0');
  final sign = zoneOffset.isNegative ? '-' : '+';
  final a = zoneOffset.abs();
  return '${wall.year.toString().padLeft(4, '0')}-${two(wall.month)}-${two(wall.day)}T${two(wall.hour)}:${two(wall.minute)}'
      '$sign${two(a.inHours)}:${two(a.inMinutes % 60)}';
}

/// Instant of a PT wall clock (UTC).
DateTime wallToUtc(DateTime wall, Duration zoneOffset) =>
    DateTime.utc(wall.year, wall.month, wall.day, wall.hour, wall.minute).subtract(zoneOffset);

/// Client checks of the transfer form (the server re-checks everything): field → message.
Map<String, String> validateTransferForm({
  required int? cashAccountId,
  required int? costCenterId,
  required DateTime? transferAt,
  required Duration zoneOffset,
  required String bankRef,
  required bool hasProof,
  required DateTime nowUtc,
}) => {
  if (cashAccountId == null) 'cashAccountId': 'Pilih akun kas.',
  if (transferAt == null)
    'transferAt': 'Isi tanggal & jam transfer sesuai bukti.'
  // server: "not in the future" with 2 minutes of clock skew
  else if (wallToUtc(transferAt, zoneOffset).isAfter(nowUtc.add(const Duration(minutes: 2))))
    'transferAt': 'Tanggal & jam transfer tidak boleh di masa depan.',
  if (costCenterId == null) 'costCenterId': 'Pilih pusat biaya.',
  if (bankRef.trim().isEmpty)
    'bankRef': 'No. referensi bank wajib diisi.'
  else if (bankRef.trim().length > 64)
    'bankRef': 'No. referensi bank maksimal 64 karakter.',
  if (!hasProof) 'proof': 'Bukti wajib diunggah.',
};
