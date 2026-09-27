import 'package:freezed_annotation/freezed_annotation.dart';

part 'user_profile.freezed.dart';

enum Role {
  staff('pk-staff'),
  pm('pk-pm'),
  finance('pk-finance'),
  owner('pk-owner'),
  admin('pk-admin');

  const Role(this.code);
  final String code;

  /// UI label (ADR 0013: `pk-owner` is shown as "Direktur"; no separate Keycloak role).
  String get label => switch (this) {
    staff => 'Staff',
    pm => 'PM',
    finance => 'Finance',
    owner => 'Direktur',
    admin => 'Admin',
  };

  static Role? fromCode(String code) {
    for (final r in Role.values) {
      if (r.code == code) return r;
    }
    return null;
  }
}

/// Home variant chosen from the roles (union of permissions; the server re-checks every action).
/// `direktur` = role `pk-owner` (ADR 0013 label).
enum HomeKind { direktur, finance, pm, staff }

/// `GET /api/v1/me` `capabilities` (E1, ADR 0013): UI hints only — the server guards stay authoritative.
@freezed
abstract class Capabilities with _$Capabilities {
  const factory Capabilities({
    /// Direktur (`pk-owner`) or Finance (`pk-finance`): "Persetujuan" inbox.
    @Default(false) bool approvalInbox,

    /// PM (`pk-pm`): team list / team dashboard, monitoring only (no decisions).
    @Default(false) bool teamMonitor,

    /// E4: PM (team projects) or Direktur (all) may create progress reports; Staff cannot.
    @Default(false) bool progressReportCreate,
  }) = _Capabilities;

  /// Fallback for a `/me` cached by an app version before E1 (no `capabilities` field): the same
  /// rule the server applies (`apps/web/src/api/v1/endpoints/me.ts`).
  factory Capabilities.fromRoles(Set<Role> roles) => Capabilities(
    approvalInbox: roles.contains(Role.owner) || roles.contains(Role.finance),
    teamMonitor: roles.contains(Role.pm),
    progressReportCreate: roles.contains(Role.pm) || roles.contains(Role.owner),
  );
}

@freezed
abstract class Employee with _$Employee {
  const factory Employee({required int id, required String code, required String name}) = _Employee;
}

@freezed
abstract class ImageTargets with _$ImageTargets {
  const factory ImageTargets({@Default(2000) int receiptsMaxPx, @Default(80) int jpegQuality}) = _ImageTargets;
}

/// `GET /api/v1/me` (openapi `Me`).
@freezed
abstract class UserProfile with _$UserProfile {
  const UserProfile._();
  const factory UserProfile({
    required int id,
    required String email,
    String? name,
    required Set<Role> roles,
    @Default(Capabilities()) Capabilities capabilities,
    Employee? employee,
    @Default('Asia/Makassar') String timezone,
    String? minAppVersion,
    @Default(ImageTargets()) ImageTargets imageTargets,
    String? serverTime,
  }) = _UserProfile;

  bool has(Role r) => roles.contains(r);

  String get displayName => (name == null || name!.trim().isEmpty) ? email : name!;

  /// Direktur first, then Finance (both: approval inbox + KPI home), PM (team monitor), Staff.
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

  /// Roles as UI labels ("Direktur", "Finance", …).
  String get roleLabels => [
    for (final r in Role.values)
      if (has(r)) r.label,
  ].join(', ');

  /// Who may create requests on the APK (requirements §4: Staff and PM create own requests).
  bool get canCreateRequests => has(Role.staff) || has(Role.pm) || has(Role.admin);

  /// E4: progress reports are readable by PM (team), Direktur and Finance (all); Staff/Admin none.
  bool get canReadProgress => has(Role.pm) || has(Role.owner) || has(Role.finance);

  /// E4: create a progress report (server capability `progressReportCreate`).
  bool get canCreateProgress => capabilities.progressReportCreate;

  /// E6: own check-in/out and own monthly recap (employees in the field: Staff and PM).
  bool get hasOwnAttendance => has(Role.staff) || has(Role.pm);

  /// E6: "Tim hari ini" (PM team; Admin/Direktur/Finance all).
  bool get canSeeTeamAttendance => has(Role.pm) || has(Role.owner) || has(Role.finance) || has(Role.admin);

  /// E6 US-14: record attendance on behalf of a team member (PM only).
  bool get canAttendOnBehalf => has(Role.pm);

  /// E6 US-15 (T10): correct a team member's attendance time (PM of the location or Admin).
  bool get canCorrectAttendance => has(Role.pm) || has(Role.admin);
}
