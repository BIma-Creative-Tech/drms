/// Master row from `GET /api/v1/masters` (whitelisted fields per type, masters.ts).
class MasterItem {
  const MasterItem(this.id, this.label, {this.code, this.extra = const {}});
  final int id;
  final String label;
  final String? code;
  final Map<String, dynamic> extra;

  bool get active => extra['active'] != false;
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

  static const forExpense = [projects, costCenters, categories, uoms, vehicles, employees, bankAccounts, banks];

  /// Everything the APK caches (expense pickers + E4 stages + E6 team assignments for on-behalf offline).
  static const forApp = [...forExpense, projectStages, teamAssignments];
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
    MasterTypes.bankAccounts => () {
      final acc = s('accountNo');
      final masked = acc.length > 4 ? '•••${acc.substring(acc.length - 4)}' : acc;
      final bankId = (j['bank'] as num?)?.toInt();
      final bank = bankId == null ? '' : (bankNames[bankId] ?? '');
      return [bank, s('accountHolder'), masked].where((e) => e.isNotEmpty).join(' · ');
    }(),
    MasterTypes.projectStages => s('name'),
    MasterTypes.teamAssignments => '#$id',
    MasterTypes.employees => s('nickname').isNotEmpty ? '${s('name')} (${s('nickname')})' : s('name'),
    _ => s('code').isNotEmpty ? '${s('code')} — ${s('name')}' : s('name'),
  };
  return MasterItem(id, label.isEmpty ? '#$id' : label, code: j['code'] as String?, extra: j);
}
