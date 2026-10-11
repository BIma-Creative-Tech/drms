import '../../expense/domain/expense_request.dart';

/// DRMS 10/10 point 6 / point 7: the "Proyek" menu of the APK, same data as the web project page (tabs
/// Proyek / RAP / Pengajuan). Read-only on the phone; online reads (the server scopes the projects: PM team,
/// Direktur / Finance / Admin all of their PTs).

/// Project status codes (web `PROJECT_STATUSES`); the server's `statusLabel` wins when present.
enum ProjectStatus {
  perencanaan('perencanaan', 'Perencanaan'),
  berjalan('berjalan', 'Berjalan'),
  ditunda('ditunda', 'Ditunda'),
  selesai('selesai', 'Selesai'),
  arsip('arsip', 'Arsip');

  const ProjectStatus(this.code, this.label);
  final String code;
  final String label;

  static ProjectStatus? fromCode(String? c) => ProjectStatus.values.where((s) => s.code == c).firstOrNull;

  /// Label of a status code (unknown codes as they are).
  static String labelOf(String? code) => fromCode(code)?.label ?? (code ?? '-');
}

/// `GET /projects` `docs[]` and the header of `GET /projects/{id}`.
class ProjectSummary {
  const ProjectSummary({
    required this.id,
    required this.code,
    required this.name,
    this.companyId,
    this.pm,
    this.status,
    this.statusLabel,
    this.contractValue,
    this.rapPlanned,
    this.rapRealised,
  });

  final int id;
  final String code;
  final String name;

  /// PT of the project (chip when the scope spans several PTs).
  final int? companyId;
  final RefItem? pm;
  final String? status;
  final String? statusLabel;

  /// Nilai kontrak (null when the server withholds it from this role).
  final int? contractValue;

  /// RAP total planned / realised (money; null when not visible to this role).
  final int? rapPlanned;
  final int? rapRealised;

  String get label => code.isEmpty ? name : '$code — $name';
  String get statusText => statusLabel ?? ProjectStatus.labelOf(status);

  /// Realisation vs plan in % (null without a plan).
  double? get rapPercent =>
      rapPlanned == null || rapPlanned == 0 || rapRealised == null ? null : rapRealised! * 100 / rapPlanned!;
}

/// `GET /projects/{id}`: summary + cost center + RAP summary.
class ProjectDetail {
  const ProjectDetail({required this.project, this.companyName, this.costCenter, this.rapRemaining, this.rapItems});

  final ProjectSummary project;

  /// PT name as the server sends it (`company.name`); the membership name is used when absent.
  final String? companyName;

  /// Pusat biaya of the project (`costCenter {id, name}` or null).
  final RefItem? costCenter;

  /// RAP summary: remaining budget and number of items (null when not sent / not visible).
  final int? rapRemaining;
  final int? rapItems;
}

/// One RAP item with its cost realisation (D4): `GET /projects/{id}/rap` `items[]`. Money fields are null when
/// the server withholds prices from this role or when the item comes from the offline cache (no money is cached
/// on the phone).
class RapBudgetItem {
  const RapBudgetItem({
    required this.id,
    required this.code,
    required this.name,
    this.uom = '',
    this.qty,
    this.unitPrice,
    this.planned,
    this.realised,
    this.remaining,
    this.percent,
  });

  final int id;
  final String code;
  final String name;
  final String uom;
  final double? qty;
  final int? unitPrice;
  final int? planned;
  final int? realised;
  final int? remaining;
  final double? percent;

  String get label => code.isEmpty ? name : '$code — $name';

  /// Realisation above the plan (red bar / "Melebihi RAP").
  bool get overBudget => remaining != null ? remaining! < 0 : (planned != null && (realised ?? 0) > planned!);

  /// Progress-bar value 0…1 (null without money figures).
  double? get progress {
    final p = percent ?? (planned == null || planned == 0 ? null : (realised ?? 0) * 100 / planned!);
    return p == null ? null : (p / 100).clamp(0, 1).toDouble();
  }

  /// Would [amount] go above the remaining budget? (null when the remaining budget is unknown.)
  bool? exceeds(int? amount) => remaining == null || amount == null ? null : amount > remaining!;

  /// Offline cache row: no money (ADR 0010 / P3 policy — prices are never stored on the phone).
  Map<String, dynamic> toCacheJson() => {'id': id, 'code': code, 'name': name, 'uom': uom};
}

/// One page of a server list (`{docs, totalDocs, page, totalPages}`).
class PageResult<T> {
  const PageResult({required this.items, required this.page, required this.hasMore, this.total, this.nextCursor});
  final List<T> items;
  final int page;
  final bool hasMore;
  final int? total;

  /// Cursor of the next page when the server pages by cursor (`/expense-requests` before `page` support).
  final String? nextCursor;
}
