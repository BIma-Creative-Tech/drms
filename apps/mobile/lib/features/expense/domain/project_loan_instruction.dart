import 'package:flutter/foundation.dart';

/// DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26) "Instruksi pinjam antar proyek" on the APK — the data of
/// `GET /expense-requests/{id}/project-loan-lenders` (web `ProjectLoanInstruct.tsx`): the request project's cash account
/// (dana bebas, shortfall = the minimum amount), the open projects of the same PT with their own account and its dana
/// bebas (not eligible ones carry the reason), the instructed loan waiting for Finance, and whether the caller (the
/// final decider, normally the Owner) may instruct now. Plain classes (no codegen); the server is the authority.

/// `allowedActions` value: the final decider may instruct an inter-project loan for this short request.
const instructProjectLoanAction = 'instruct_project_loan';

typedef _Json = Map<String, dynamic>;

int _int(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? 0 : 0);
int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
String? _strN(Object? v) => v?.toString();
_Json? _map(Object? v) => v is Map<String, dynamic> ? v : null;
List<dynamic> _list(Object? v) => v is List ? v : const [];

/// A project reference (`{ id, code, name }`).
@immutable
class PliProject {
  const PliProject({required this.id, this.code, this.name});
  final int id;
  final String? code;
  final String? name;

  /// "Q-B · Proyek B".
  String get label {
    final parts = [code, name].whereType<String>().where((s) => s.trim().isNotEmpty).toList();
    return parts.isEmpty ? '#$id' : parts.join(' · ');
  }

  static PliProject? fromJson(Object? v) {
    final m = _map(v);
    final id = _intN(m?['id']);
    if (m == null || id == null) return null;
    return PliProject(id: id, code: _strN(m['code']), name: _strN(m['name']));
  }

  @override
  bool operator ==(Object other) => other is PliProject && other.id == id && other.code == code && other.name == name;

  @override
  int get hashCode => Object.hash(id, code, name);
}

/// One lender candidate (`candidates[]`).
@immutable
class PliCandidate {
  const PliCandidate({
    required this.project,
    this.accountId,
    this.accountName,
    this.available,
    required this.eligible,
    this.reason,
    this.reasonText,
  });
  final PliProject project;
  final int? accountId;
  final String? accountName;

  /// Dana bebas of the project's account (null without account).
  final int? available;
  final bool eligible;

  /// no_account | inactive_account | same_account | insufficient.
  final String? reason;
  final String? reasonText;

  @override
  bool operator ==(Object other) =>
      other is PliCandidate &&
      other.project == project &&
      other.accountId == accountId &&
      other.available == available &&
      other.eligible == eligible &&
      other.reason == reason;

  @override
  int get hashCode => Object.hash(project, accountId, available, eligible, reason);
}

/// The instructed loan waiting for Finance's transfer (`pendingLoan`).
@immutable
class PliPendingLoan {
  const PliPendingLoan({required this.id, this.docNo, required this.amount, required this.statusLabel});
  final int id;
  final String? docNo;
  final int amount;
  final String statusLabel;

  String get label => docNo ?? '#$id';
}

/// `ProjectLoanInstructionInfo`.
@immutable
class ProjectLoanInstruction {
  const ProjectLoanInstruction({
    required this.requestId,
    this.docNo,
    required this.title,
    required this.borrowerProject,
    required this.borrowerAccountName,
    required this.borrowerAvailable,
    required this.needed,
    required this.shortfall,
    required this.minAmount,
    required this.loanDate,
    required this.defaultDueDate,
    required this.canInstruct,
    this.cannotReason,
    this.pendingLoan,
    this.candidates = const [],
  });
  final int requestId;
  final String? docNo;
  final String title;
  final PliProject borrowerProject;
  final String borrowerAccountName;
  final int borrowerAvailable;
  final int needed;
  final int shortfall;
  final int minAmount;
  final String loanDate;
  final String defaultDueDate;
  final bool canInstruct;
  final String? cannotReason;
  final PliPendingLoan? pendingLoan;
  final List<PliCandidate> candidates;

  String get docLabel => docNo ?? '#$requestId';

  /// The first eligible candidate (the server lists the eligible ones first, largest dana bebas first).
  PliCandidate? get firstEligible => candidates.where((c) => c.eligible).firstOrNull;

  static ProjectLoanInstruction fromJson(_Json j) {
    final acc = _map(j['borrowerAccount']);
    final pending = _map(j['pendingLoan']);
    return ProjectLoanInstruction(
      requestId: _int(j['requestId']),
      docNo: _strN(j['docNo']),
      title: '${j['title'] ?? ''}',
      borrowerProject: PliProject.fromJson(j['borrowerProject']) ?? const PliProject(id: 0),
      borrowerAccountName: _strN(acc?['name']) ?? '-',
      borrowerAvailable: _int(acc?['available']),
      needed: _int(j['needed']),
      shortfall: _int(j['shortfall']),
      minAmount: _int(j['minAmount']),
      loanDate: '${j['loanDate'] ?? ''}',
      defaultDueDate: '${j['defaultDueDate'] ?? ''}',
      canInstruct: j['canInstruct'] == true,
      cannotReason: _strN(j['cannotReason']),
      pendingLoan: pending == null || _intN(pending['id']) == null
          ? null
          : PliPendingLoan(
              id: _int(pending['id']),
              docNo: _strN(pending['docNo']),
              amount: _int(pending['amount']),
              statusLabel: '${pending['statusLabel'] ?? ''}',
            ),
      candidates: [
        for (final c in _list(j['candidates']))
          if (_map(c) case final x? when PliProject.fromJson(x['project']) != null)
            PliCandidate(
              project: PliProject.fromJson(x['project'])!,
              accountId: _intN(_map(x['account'])?['id']),
              accountName: _strN(_map(x['account'])?['name']),
              available: _intN(x['available']),
              eligible: x['eligible'] == true,
              reason: _strN(x['reason']),
              reasonText: _strN(x['reasonText']),
            ),
      ],
    );
  }
}

/// Why the amount cannot be sent (same rule as the server: shortfall ≤ amount ≤ the lender's dana bebas), else null.
/// The messages are the server's (`domain/loans/rules.ts` instructAmountError); [rupiah] formats the limits.
String? pliAmountError(int? amount, {required int min, int? max, required String Function(int) rupiah}) {
  if (amount == null || amount <= 0) return 'Nilai pinjaman wajib diisi (bilangan bulat Rupiah > 0).';
  if (amount < min) return 'Nilai pinjaman minimal ${rupiah(min)} (kekurangan dana akun kas pengajuan).';
  if (max != null && amount > max) return 'Nilai pinjaman melebihi dana bebas akun kas pemberi (${rupiah(max)}).';
  return null;
}

/// Digits of a Rupiah text field ("25.000.000" → 25000000), null when empty.
int? parseDigits(String s) {
  final d = s.replaceAll(RegExp(r'[^0-9]'), '');
  return d.isEmpty ? null : int.tryParse(d);
}
