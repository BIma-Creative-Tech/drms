/// Master row from `GET /api/v1/masters` (whitelisted fields per type, masters.ts).
class MasterItem {
  const MasterItem(this.id, this.label, {this.code, this.extra = const {}});
  final int id;
  final String label;
  final String? code;
  final Map<String, dynamic> extra;

  bool get active => extra['active'] != false;

  /// MC3: PT of the row (`company`); null for shared masters (`uoms`, `banks`, `holidays`) and from a
  /// server before MC3.
  int? get companyId => (extra['company'] as num?)?.toInt();

  /// MC3: shared by every PT (`shared: true`).
  bool get shared => extra['shared'] == true;
}

abstract final class MasterTypes {
  static const projects = 'projects';
  static const costCenters = 'cost-centers';
  static const categories = 'expense-categories';
  static const uoms = 'uoms';
  static const vehicles = 'vehicles';
  static const employees = 'employees';
  static const bankAccounts = 'bank-accounts';
  static const banks = 'banks';

  static const projectStages = 'project-stages';
  static const teamAssignments = 'team-assignments';

  /// Owner decision 2026-10-09: "Tingkat urgensi" of an expense draft (server ≥ 0.7 knows this type).
  static const urgencyLevels = 'urgency-levels';

  /// ADR 0027 "Pembayaran vendor": vendors of the PT and their accounts (Finance / PM / Direktur / Admin read them;
  /// Staff get none). `vendor-bank-accounts` needs a server with ADR 0027 (an older one answers 400 for the type) —
  /// the APK with this change is released after that server.
  static const vendors = 'vendors';
  static const vendorBankAccounts = 'vendor-bank-accounts';

  static const forExpense = [
    projects,
    costCenters,
    categories,
    uoms,
    vehicles,
    employees,
    bankAccounts,
    banks,
    urgencyLevels,
    vendors,
    vendorBankAccounts,
  ];

  /// Everything the APK caches (expense pickers + E4 stages + E6 team assignments for on-behalf offline + FR1
  /// customers).
  /// FR1: customers of the PT for the aftersales activity picker (server ≥ 0.7; Staff get rows only when
  /// assigned to an aftersales project of the PT).
  static const clients = 'clients';

  /// ADR 0023: sites (kantor cabang) of the PT — attendance locations (own: `home` / `assigned`; on-behalf: `team`).
  /// Projects carry `site`, employees `homeSite`, team assignments `site` (server ≥ the sites release).
  static const sites = 'sites';

  static const forApp = [...forExpense, projectStages, teamAssignments, clients, sites];
}

/// Label per type (codes + names; bank accounts masked to the last 4 digits for display).
MasterItem masterFromJson(String type, Map<String, dynamic> j, {Map<int, String> bankNames = const {}}) {
  final id = (j['id'] as num?)?.toInt() ?? 0;
  String s(String k) => j[k] == null ? '' : '${j[k]}';
  final label = switch (type) {
    MasterTypes.vehicles => [
      s('plateDisplay').isNotEmpty ? s('plateDisplay') : s('plateNo'),
      s('type'),
    ].where((e) => e.isNotEmpty).join(' · '),
    MasterTypes.bankAccounts || MasterTypes.vendorBankAccounts => () {
      final acc = s('accountNo');
      final masked = acc.length > 4 ? '•••${acc.substring(acc.length - 4)}' : acc;
      final bankId = (j['bank'] as num?)?.toInt();
      final bank = bankId == null ? '' : (bankNames[bankId] ?? '');
      return [bank, s('accountHolder'), masked].where((e) => e.isNotEmpty).join(' · ');
    }(),
    MasterTypes.projectStages => s('name'),
    MasterTypes.urgencyLevels => s('name'),
    MasterTypes.clients => s('name'),
    MasterTypes.teamAssignments => '#$id',
    MasterTypes.employees => s('nickname').isNotEmpty ? '${s('name')} (${s('nickname')})' : s('name'),
    _ => s('code').isNotEmpty ? '${s('code')} — ${s('name')}' : s('name'),
  };
  return MasterItem(id, label.isEmpty ? '#$id' : label, code: j['code'] as String?, extra: j);
}
