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

/// Project kind labels (web `PROJECT_KIND_LABELS`).
String projectKindLabel(String? kind) => switch (kind) {
  'umum' => 'Umum',
  'konstruksi' => 'Konstruksi',
  'kontrak_unit' => 'Kontrak unit (sewa alat)',
  'aftersales' => 'Aftersales (servis & sparepart)',
  'trading' => 'Trading',
  _ => kind ?? '-',
};

/// `GET /projects` `docs[]` (openapi `ProjectListItem`).
class ProjectSummary {
  const ProjectSummary({
    required this.id,
    required this.code,
    required this.name,
    this.kind,
    this.companyId,
    this.pm,
    this.status,
    this.statusLabel,
    this.contractValue,
    this.progressPct,
    this.costCenter,
    this.rapPlanned,
    this.rapRealised,
    this.rapPercentServer,
    this.rapOverBudgetItems,
    this.rapItems = 0,
    this.rapRequired = false,
    this.rapMissing = false,
  });

  final int id;
  final String code;
  final String name;
  final String? kind;

  /// PT of the project (chip when the scope spans several PTs).
  final int? companyId;
  final RefItem? pm;
  final String? status;
  final String? statusLabel;

  /// Nilai kontrak = RAB of the project (null when the server withholds it).
  final int? contractValue;

  /// Physical progress % (E4).
  final double? progressPct;

  /// D2: default cost center of the project (proposed to Finance at the transfer).
  final RefItem? costCenter;

  /// D4: Σ planned / realised RAP money and % (price roles only; null otherwise).
  final int? rapPlanned;
  final int? rapRealised;
  final double? rapPercentServer;
  final int? rapOverBudgetItems;
  final int rapItems;

  /// D4 (owner 2026-10-11): the project has a RAB (or is konstruksi) → a RAP is required before requests can be sent.
  final bool rapRequired;

  /// [rapRequired] and no active RAP item yet → requests cannot be submitted ("Project belum punya RAP — hubungi PM").
  final bool rapMissing;

  String get label => code.isEmpty ? name : '$code — $name';
  String get statusText => statusLabel ?? ProjectStatus.labelOf(status);

  /// Realisation vs plan in % (null without a plan).
  double? get rapPercent =>
      rapPercentServer ??
      (rapPlanned == null || rapPlanned == 0 || rapRealised == null ? null : rapRealised! * 100 / rapPlanned!);
}

/// RAP money summary of a project (openapi `ProjectRapSummary`; money null without a price role).
class RapSummary {
  const RapSummary({
    this.items = 0,
    this.planned,
    this.realised,
    this.transferred,
    this.remaining,
    this.percent,
    this.overBudgetItems,
  });
  final int items;
  final int? planned;
  final int? realised;
  final int? transferred;
  final int? remaining;
  final double? percent;
  final int? overBudgetItems;
}

/// `GET /projects/{id}` (openapi `ProjectDetail`).
class ProjectDetail {
  const ProjectDetail({
    required this.project,
    this.client,
    this.address,
    this.startDate,
    this.targetDate,
    this.rap = const RapSummary(),
  });

  final ProjectSummary project;
  final RefItem? client;
  final String? address;
  final String? startDate;
  final String? targetDate;
  final RapSummary rap;

  RefItem? get costCenter => project.costCenter;
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
    this.active = true,
  });

  final int id;
  final String code;
  final String name;

  /// Deactivated items still come with their realisation (RAP tab); the line picker offers active ones only.
  final bool active;
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
