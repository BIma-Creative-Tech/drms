import 'package:freezed_annotation/freezed_annotation.dart';

import '../../privacy/domain/privacy.dart';

part 'user_profile.freezed.dart';

enum Role {
  staff('pk-staff'),
  pm('pk-pm'),
  finance('pk-finance'),
  owner('pk-owner'),

  /// ADR 0026 (owner decision 2026-10-13): "Owner", the approval level above the Direktur (key `pk-principal`;
  /// `owner` above stays the Direktur). Same view and permissions as the Direktur — see [effective].
  principal('pk-principal'),
  admin('pk-admin'),

  /// Owner decision 2026-10-09: attendance only ("Operator/Anggota").
  operator('pk-operator');

  const Role(this.code);
  final String code;

  /// UI label (ADR 0013: `pk-owner` is shown as "Direktur"; no separate Keycloak role).
  String get label => switch (this) {
    staff => 'Staff',
    pm => 'PM',
    finance => 'Finance',
    owner => 'Direktur',
    principal => 'Owner',
    admin => 'Admin',
    operator => 'Operator/Anggota',
  };

  static Role? fromCode(String code) {
    for (final r in Role.values) {
      if (r.code == code) return r;
    }
    return null;
  }

  /// ADR 0026: roles + the roles they imply — an Owner ([principal]) has every Direktur ([owner]) view and permission
  /// (the server lists both in `/me`; older caches may hold only `pk-principal`). Deciding stays the server's.
  static Set<Role> effective(Iterable<Role> roles) => {...roles, if (roles.contains(principal)) owner};

  /// UI labels of [roles]: the Direktur implied by the Owner role is not repeated ("Owner", not "Direktur, Owner").
  static String labelsOf(Set<Role> roles) => [
    for (final r in Role.values)
      if (roles.contains(r) && !(r == owner && roles.contains(principal))) r.label,
  ].join(', ');
}

/// Home variant chosen from the roles (union of permissions; the server re-checks every action).
/// `direktur` = role `pk-owner` (ADR 0013 label).
enum HomeKind { direktur, finance, pm, staff }

/// `GET /api/v1/me` `capabilities` (E1, ADR 0013): UI hints only — the server guards stay authoritative.
@freezed
abstract class Capabilities with _$Capabilities {
  const Capabilities._();
  const factory Capabilities({
    /// Direktur (`pk-owner`) or Finance (`pk-finance`): "Persetujuan" inbox.
    @Default(false) bool approvalInbox,

    /// PM (`pk-pm`): team list / team dashboard, monitoring only (no decisions).
    @Default(false) bool teamMonitor,

    /// E4: PM (team projects) or Direktur (all) may create progress reports; Staff cannot.
    @Default(false) bool progressReportCreate,

    /// FR1 (ADR 0020): field reports on for the PT and Staff (assigned) / PM (team) / Direktur → service
    /// reports on kontrak_unit / aftersales projects. The server already folds the PT flag in.
    @Default(false) bool serviceReportCreate,

    /// FR1: unit timesheets on kontrak_unit projects (same rule).
    @Default(false) bool unitTimesheetCreate,

    /// FR1: aftersales activities on aftersales projects (same rule).
    @Default(false) bool aftersalesActivityCreate,

    /// P3: Laporan Harian on konstruksi projects (same rule; server ≥ 0.8 — older servers omit it → false).
    @Default(false) bool dailyReportCreate,

    /// ADR 0028: may file a "PT grup" payment — the server's filer rule on the STORED roles (Finance / PM / Direktur).
    /// Unlike the effective [UserProfile.roles] it is false for an Owner (`pk-principal`) without one of those roles.
    /// null = a server before this field (the APK then falls back to the payee directory, see
    /// `mayFileIntercompanyPayment`).
    bool? intercompanyPayment,
  }) = _Capabilities;

  /// FR1: any field-report create right.
  bool get anyField => serviceReportCreate || unitTimesheetCreate || aftersalesActivityCreate || dailyReportCreate;

  /// Fallback for a `/me` cached by an app version before E1 (no `capabilities` field): the same
  /// rule the server applies (`apps/web/src/api/v1/endpoints/me.ts`).
  factory Capabilities.fromRoles(Set<Role> roles) => Capabilities(
    // ADR 0021: the PM project approves the first step of his project's requests.
    approvalInbox: roles.contains(Role.owner) || roles.contains(Role.finance) || roles.contains(Role.pm),
    teamMonitor: roles.contains(Role.pm),
    progressReportCreate: roles.contains(Role.pm) || roles.contains(Role.owner),
  );
}

@freezed
abstract class Employee with _$Employee {
  const factory Employee({
    required int id,
    required String code,
    required String name,

    /// ADR 0023: "Site penempatan" (`/me` employee.homeSite) — id and `KODE — Nama`; null = none / older server.
    int? homeSiteId,
    String? homeSiteLabel,
  }) = _Employee;
}

@freezed
abstract class ImageTargets with _$ImageTargets {
  const factory ImageTargets({@Default(2000) int receiptsMaxPx, @Default(80) int jpegQuality}) = _ImageTargets;
}

/// MC3: per-PT operational settings of `GET /api/v1/me` `companies[].settings` (openapi `MeCompany`).
@freezed
abstract class CompanySettings with _$CompanySettings {
  const factory CompanySettings({
    @Default(100) int defaultGeofenceRadiusM,
    @Default(0) int receiptRoundingTolerance,
    @Default(0) int receiptMaxAgeDays,
    @Default(85) double budgetWarnPct,
    @Default(true) bool syncExpenseDraftsEnabled,
    @Default(false) bool syncAttendanceEnabled,
    @Default(false) bool syncProgressReportsEnabled,

    /// FR1 (ADR 0020 §10): "Laporan lapangan per jenis project" switched on for this PT (default off).
    @Default(false) bool fieldReportsEnabled,
  }) = _CompanySettings;
}

/// MC3 (ADR 0016 §8): one active membership of the user = one PT with its own roles, employee,
/// capabilities and settings (`GET /api/v1/me` `companies[]`).
@freezed
abstract class CompanyMembership with _$CompanyMembership {
  const CompanyMembership._();
  const factory CompanyMembership({
    required int id,

    /// PT short code (e.g. `DRMS`), shown on chips.
    required String code,
    required String name,
    @Default('Asia/Makassar') String timezone,
    @Default(<Role>{}) Set<Role> roles,
    Employee? employee,
    @Default(Capabilities()) Capabilities capabilities,
    @Default(CompanySettings()) CompanySettings settings,

    /// ADR 0024: Direktur in this PT and the PT has the zero-step rule "Pengajuan Direktur" — the Direktur's own
    /// requests go straight to the Finance transfer queue (hint for the request form; the server decides at submit).
    @Default(false) bool ownRequestNoApproval,
  }) = _CompanyMembership;

  bool has(Role r) => roles.contains(r);

  /// FR1: field reports on in this PT and at least one create capability here.
  bool get hasFieldReports => settings.fieldReportsEnabled && capabilities.anyField;

  /// Same rule as [UserProfile.canCreateRequests], applied to the roles IN this PT.
  /// ADR 0024 (owner 2026-10-11): the Direktur files his own requests (straight to the Finance transfer queue).
  bool get canCreateRequests => has(Role.staff) || has(Role.pm) || has(Role.admin) || has(Role.owner);

  /// Same rule as [UserProfile.seesProjectMoney], applied to the roles IN this PT.
  bool get seesProjectMoney => has(Role.pm) || has(Role.owner) || has(Role.finance) || has(Role.admin);

  /// Only role Staff IN this PT (same rule as [UserProfile.requestsForSelfOnly]).
  bool get staffOnly => roles.isNotEmpty && roles.every((r) => r == Role.staff);

  /// "DRMS — Direktur, Finance" (switcher rows).
  String get roleLabels => Role.labelsOf(roles);
}

/// `GET /api/v1/me` (openapi `Me`).
///
/// MC3: [companies] holds every active membership. The top-level [roles] / [capabilities] /
/// [employee] / [timezone] describe the current **scope** (the PTs chosen in the PT switcher, see
/// [scopedTo]): roles and capabilities are the union over the scope (navigation), employee and time
/// zone come from the first PT of the scope that has an employee. Every action on a document checks
/// the roles IN the document's PT ([forCompany]); the server re-checks anyway.
@freezed
abstract class UserProfile with _$UserProfile {
  const UserProfile._();
  const factory UserProfile({
    required int id,
    required String email,
    String? name,

    /// d1010 (WA-14): greeting name resolved by the server (`/me` `displayName`); null on older servers.
    String? serverDisplayName,
    required Set<Role> roles,
    @Default(Capabilities()) Capabilities capabilities,
    Employee? employee,
    @Default('Asia/Makassar') String timezone,
    String? minAppVersion,
    @Default(ImageTargets()) ImageTargets imageTargets,
    String? serverTime,

    /// MC3: every active membership (ascending id). Empty = server before MC3 (single-PT behaviour).
    @Default(<CompanyMembership>[]) List<CompanyMembership> companies,

    /// MC3: ids of the PTs the top-level fields were computed for ([scopedTo]); empty = not scoped.
    @Default(<int>[]) List<int> scopeCompanyIds,

    /// ADR 0018: privacy-notice acknowledgement (`/me` `privacy`); null = server without the feature.
    PrivacyStatus? privacy,
  }) = _UserProfile;

  /// More than one active PT: the PT switcher and PT chips are shown, new data asks for its PT.
  bool get isMultiCompany => companies.length > 1;

  /// The PT with [id] among the memberships (null for an unknown / removed PT).
  CompanyMembership? company(int? id) => id == null ? null : companies.where((c) => c.id == id).firstOrNull;

  /// Short code of PT [id] for chips (`#id` when the PT is not (any more) a membership).
  String companyCode(int? id) => company(id)?.code ?? (id == null ? '' : '#$id');

  /// Memberships inside the current scope (all memberships when not scoped).
  List<CompanyMembership> get scopedCompanies =>
      scopeCompanyIds.isEmpty ? companies : companies.where((c) => scopeCompanyIds.contains(c.id)).toList();

  /// Lists show a PT chip when the scope spans several PTs (wireframe §1b).
  bool get showCompanyChips => scopedCompanies.length > 1;

  /// Profile narrowed to the PTs [ids] (null or no overlap with the memberships = all PTs): roles and
  /// capabilities = union over those PTs, employee / time zone of the first PT with an employee. A profile
  /// without [companies] (server before MC3) is returned unchanged.
  UserProfile scopedTo(Iterable<int>? ids) {
    if (companies.isEmpty) return this;
    final wanted = ids?.toSet();
    var scope = wanted == null ? companies : companies.where((c) => wanted.contains(c.id)).toList();
    if (scope.isEmpty) scope = companies;
    final roles = {for (final c in scope) ...c.roles};
    final primary = scope.where((c) => c.employee != null).firstOrNull ?? scope.first;
    return copyWith(
      roles: roles,
      capabilities: Capabilities(
        approvalInbox: scope.any((c) => c.capabilities.approvalInbox),
        teamMonitor: scope.any((c) => c.capabilities.teamMonitor),
        progressReportCreate: scope.any((c) => c.capabilities.progressReportCreate),
        serviceReportCreate: scope.any((c) => c.capabilities.serviceReportCreate),
        unitTimesheetCreate: scope.any((c) => c.capabilities.unitTimesheetCreate),
        aftersalesActivityCreate: scope.any((c) => c.capabilities.aftersalesActivityCreate),
        dailyReportCreate: scope.any((c) => c.capabilities.dailyReportCreate),
        intercompanyPayment: _anyFlag([for (final c in scope) c.capabilities.intercompanyPayment]),
      ),
      employee: primary.employee,
      timezone: primary.timezone,
      scopeCompanyIds: [for (final c in scope) c.id],
    );
  }

  /// Profile with the roles IN PT [companyId] only (action buttons of a document of that PT). An
  /// unknown PT (not a membership) yields no roles; null (legacy data / server before MC3) = unchanged.
  UserProfile forCompany(int? companyId) {
    if (companies.isEmpty || companyId == null) return this;
    final c = company(companyId);
    if (c == null) {
      return copyWith(roles: const {}, capabilities: const Capabilities(), employee: null, scopeCompanyIds: const []);
    }
    return scopedTo([companyId]);
  }

  /// PTs of the scope in which the user may create expense requests (Staff / PM / Admin there).
  List<CompanyMembership> get requestCompanies => scopedCompanies.where((c) => c.canCreateRequests).toList();

  /// PTs of the scope in which the user may create progress reports (capability per PT).
  List<CompanyMembership> get progressCompanies =>
      scopedCompanies.where((c) => c.capabilities.progressReportCreate).toList();

  /// Every employee id of the user (one per PT, ADR 0016 D1) — "own" checks across PTs.
  Set<int> get employeeIds => {
    if (employee != null) employee!.id,
    for (final c in companies)
      if (c.employee != null) c.employee!.id,
  };

  bool has(Role r) => roles.contains(r);

  /// Greeting / profile name (d1010 WA-14). Never the full e-mail address: `/me` `displayName` → `name` →
  /// employee name (scope first, then any PT) → e-mail local part → "Pengguna".
  String get displayName {
    // A "name" that is itself an e-mail address is skipped (WA-14: the full address is never shown).
    final full = [
      serverDisplayName,
      name,
      employee?.name,
      for (final c in companies) c.employee?.name,
    ].map((v) => v?.trim() ?? '').where((s) => s.isNotEmpty && !s.contains('@')).firstOrNull;
    if (full != null) return full;
    final at = email.indexOf('@');
    final local = (at < 0 ? email : email.substring(0, at)).trim();
    return local.isEmpty ? 'Pengguna' : local;
  }

  /// Direktur first, then Finance (both: approval inbox + KPI home), PM (team monitor), Staff. ADR 0026: the Owner gets
  /// the Direktur home (his roles carry `pk-owner`, [Role.effective]).
  HomeKind get homeKind {
    if (has(Role.owner)) return HomeKind.direktur;
    if (has(Role.finance)) return HomeKind.finance;
    if (has(Role.pm)) return HomeKind.pm;
    return HomeKind.staff;
  }

  /// Who sees the "Persetujuan" inbox: server capability (ADR 0013: Direktur + Finance; PM monitors only).
  bool get hasApprovalInbox => capabilities.approvalInbox;

  /// PM team list / team dashboard (US-17, read-only).
  bool get hasTeamMonitor => capabilities.teamMonitor;

  /// Roles as UI labels ("Direktur", "Finance", "Owner", …).
  String get roleLabels => Role.labelsOf(roles);

  /// Who may create requests on the APK (requirements §4: Staff and PM create own requests).
  /// ADR 0024 (owner 2026-10-11): the Direktur files his own requests (straight to the Finance transfer queue).
  bool get canCreateRequests => has(Role.staff) || has(Role.pm) || has(Role.admin) || has(Role.owner);

  /// QA-15 (owner decision 2026-10-08): only role Staff (use on [forCompany] of the draft's PT) → requests
  /// for themselves only ("Diajukan Oleh" = own employee). PM / Admin / Finance may add others (Q-09).
  bool get requestsForSelfOnly => roles.isNotEmpty && roles.every((r) => r == Role.staff);

  /// E4: progress reports are readable by PM (team), Direktur and Finance (all); Staff/Admin none.
  bool get canReadProgress => has(Role.pm) || has(Role.owner) || has(Role.finance);

  /// DRMS 10/10 point 6: "Proyek" menu — PM (team projects), Direktur, Finance, Admin (all projects of their PTs)
  /// and, owner decision 2026-10-11, Staff (their assigned projects, read-only, without money); the same roles as the
  /// web Proyek module. The server scopes the list and withholds the money.
  bool get canSeeProjects => has(Role.staff) || seesProjectMoney;

  /// Owner decision 2026-10-11: project money (contract value / RAB, RAP prices and amounts, RAB %, loans) — Direktur,
  /// Admin, Finance, PM only. UI hint (use [CompanyMembership.seesProjectMoney] for one PT); the server withholds it.
  bool get seesProjectMoney => has(Role.pm) || has(Role.owner) || has(Role.finance) || has(Role.admin);

  /// DRMS 10/10 point 10: "Finance" menu (transfer queue, Catat transfer, LPJ list) — role Finance.
  bool get hasFinanceMenu => has(Role.finance);

  /// E4: create a progress report (server capability `progressReportCreate`).
  bool get canCreateProgress => capabilities.progressReportCreate;

  /// FR1: PTs of the scope where the user may create at least one field report (flag on + capability).
  List<CompanyMembership> get fieldCompanies => scopedCompanies.where((c) => c.hasFieldReports).toList();

  /// FR1 "Laporan Lapangan" tile: a field-report capability in the scope (the server folds the PT flag into
  /// the capabilities; the flag is checked too when the PT is known). Never for an Operator-only account.
  bool get hasFieldReports {
    if (isOperatorOnly) return false;
    if (companies.isEmpty) return capabilities.anyField;
    return fieldCompanies.isNotEmpty;
  }

  /// E6: own check-in/out and own monthly recap. Owner decision 2026-10-09: every role (the server
  /// still requires an employee with a team assignment at a geofenced location).
  bool get hasOwnAttendance => roles.isNotEmpty;

  /// Owner decision 2026-10-09: "Operator/Anggota" only — attendance, nothing else on the home screen.
  bool get isOperatorOnly => roles.isNotEmpty && roles.every((r) => r == Role.operator);

  /// E6: "Tim hari ini" (PM team; Admin/Direktur/Finance all).
  bool get canSeeTeamAttendance => has(Role.pm) || has(Role.owner) || has(Role.finance) || has(Role.admin);

  /// E6 US-14: record attendance on behalf of a team member (PM only).
  bool get canAttendOnBehalf => has(Role.pm);

  /// E6 US-15 (T10): correct a team member's attendance time (PM of the location or Admin).
  bool get canCorrectAttendance => has(Role.pm) || has(Role.admin);
}

/// Union of an optional capability over several PTs: true when any PT says true, false when every PT that sends it
/// says false, null when no PT sends it (server before the field).
bool? _anyFlag(Iterable<bool?> flags) {
  if (flags.any((f) => f == true)) return true;
  return flags.any((f) => f != null) ? false : null;
}
