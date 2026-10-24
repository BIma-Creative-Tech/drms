import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/network/api_client.dart';

// DRMS 13/10 W3 "Pengguna baru" / "Pengguna" on the APK (user 2026-10-19, phase 6): `GET|POST /user-onboarding`,
// `GET|PATCH /user-onboarding/{id}` — account, access per PT, employee, bank accounts and team assignments in one save
// (Keycloak first, then the DB; the server rolls Keycloak back on a failed save).

Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];
int _int(Object? v) => v is num ? v.toInt() : 0;
String? _s(Object? v) => v is String && v.isNotEmpty ? v : null;

/// Web role labels of the onboarding form (ADR 0026: pk-owner = Direktur, pk-principal = Owner).
const onboardingRoles = [
  ('pk-staff', 'Staff'),
  ('pk-pm', 'PM'),
  ('pk-finance', 'Finance'),
  ('pk-owner', 'Direktur'),
  ('pk-principal', 'Owner'),
  ('pk-admin', 'Admin'),
  ('pk-operator', 'Operator / Anggota'),
  // ADR 0032: attendance administration of the PT
  ('pk-admin-staff', 'Admin Staff'),
];

class OnbEmployee {
  OnbEmployee({
    this.id,
    this.code = '',
    this.name = '',
    this.nickname,
    this.position,
    this.phone,
    this.attendanceType = 'onsite',
    this.active = true,
  });
  final int? id;
  String code;
  String name;
  String? nickname;
  String? position;
  String? phone;
  String attendanceType;
  bool active;

  factory OnbEmployee.fromJson(Map<String, dynamic> j) => OnbEmployee(
    id: _int(j['id']),
    code: '${j['code'] ?? ''}',
    name: '${j['name'] ?? ''}',
    nickname: _s(j['nickname']),
    position: _s(j['position']),
    phone: _s(j['phone']),
    attendanceType: '${j['attendanceType'] ?? 'onsite'}',
    active: j['active'] != false,
  );

  Map<String, Object?> toJson() => {
    'id': ?id,
    if (code.trim().isNotEmpty) 'code': code.trim(),
    if (name.trim().isNotEmpty) 'name': name.trim(),
    'nickname': nickname,
    'position': position,
    'phone': phone,
    'attendanceType': attendanceType,
    'active': active,
  };
}

class OnbBankAccount {
  OnbBankAccount({
    this.id,
    this.bank,
    this.bankName,
    this.accountNo = '',
    this.accountHolder = '',
    this.isDefault = false,
    this.verified = false,
    this.active = true,
  });
  final int? id;
  int? bank;
  String? bankName;
  String accountNo;
  String accountHolder;
  bool isDefault;
  bool verified;
  bool active;

  factory OnbBankAccount.fromJson(Map<String, dynamic> j) => OnbBankAccount(
    id: _int(j['id']),
    bank: j['bank'] is num ? (j['bank'] as num).toInt() : null,
    bankName: _s(j['bankName']),
    accountNo: '${j['accountNo'] ?? ''}',
    accountHolder: '${j['accountHolder'] ?? ''}',
    isDefault: j['isDefault'] == true,
    verified: j['verificationStatus'] == 'verified',
    active: j['active'] != false,
  );
}

class OnbAssignment {
  const OnbAssignment({required this.id, this.label = '', this.role = '', this.startDate, this.endDate});
  final int id;
  final String label;
  final String role;
  final String? startDate;
  final String? endDate;

  factory OnbAssignment.fromJson(Map<String, dynamic> j) => OnbAssignment(
    id: _int(j['id']),
    label: '${j['label'] ?? ''}',
    role: '${j['roleInProject'] ?? ''}',
    startDate: _s(j['startDate']),
    endDate: _s(j['endDate']),
  );
}

typedef OnbChoice = ({int id, String label});

List<OnbChoice> _choices(Object? v) => [
  for (final c in _list(v))
    (
      id: _int(_map(c)['id']),
      label: [_map(c)['code'], _map(c)['name']].whereType<String>().where((x) => x.isNotEmpty).join(' '),
    ),
];

class OnbCompany {
  OnbCompany(this.j)
    : roles = {for (final r in _list(_map(j['membership'])['roles'])) '$r'},
      employee = j['employee'] is Map<String, dynamic>
          ? OnbEmployee.fromJson(j['employee'] as Map<String, dynamic>)
          : null,
      bankAccounts = [for (final b in _list(j['bankAccounts'])) OnbBankAccount.fromJson(_map(b))];
  final Map<String, dynamic> j;
  int get id => _int(j['id']);
  String get label => '${j['shortCode'] ?? ''} — ${j['name'] ?? ''}';
  bool get canManageEmployees => j['canManageEmployees'] == true;
  bool get canManageAssignments => j['canManageAssignments'] == true;
  bool get hasMembership => j['membership'] is Map;
  List<OnbChoice> get employeeChoices => _choices(j['employeeChoices']);
  List<OnbAssignment> get assignments => [for (final a in _list(j['assignments'])) OnbAssignment.fromJson(_map(a))];
  List<OnbChoice> projects() => _choices(_map(j['assignmentChoices'])['projects']);
  List<OnbChoice> costCenters() => _choices(_map(j['assignmentChoices'])['costCenters']);
  List<OnbChoice> sites() => _choices(_map(j['assignmentChoices'])['sites']);

  // editable state
  Set<String> roles;
  OnbEmployee? employee;
  final List<OnbBankAccount> bankAccounts;
  final List<Map<String, Object?>> newAssignments = [];
  bool dirty = false;
  bool employeeDirty = false;
}

class OnbDetail {
  OnbDetail(Map<String, dynamic> j)
    : user = j['user'] is Map<String, dynamic> ? j['user'] as Map<String, dynamic> : null,
      companies = [for (final c in _list(j['companies'])) OnbCompany(_map(c))];
  final Map<String, dynamic>? user;
  final List<OnbCompany> companies;

  int? get id => user == null ? null : _int(user!['id']);
  bool get identityEditable => user == null || user!['identityEditable'] == true;
}

class OnboardingApi {
  OnboardingApi(this.client);
  final ApiClient client;

  Future<OnbDetail> load(int? id) => client.run(
    (d) => d.get<dynamic>(id == null ? '/user-onboarding' : '/user-onboarding/$id', options: ApiClient.allCompanies()),
    (data) => OnbDetail(data as Map<String, dynamic>),
  );

  /// → (userId, temporaryPassword shown once on create, linkedExistingAccount).
  Future<({int id, String? temporaryPassword, bool linked})> save(
    int? id,
    Map<String, Object?> body, {
    required String idempotencyKey,
  }) => client.run(
    (d) {
      final o = ApiClient.allCompanies(Options(headers: {'Idempotency-Key': idempotencyKey}));
      return id == null
          ? d.post<dynamic>('/user-onboarding', data: body, options: o)
          : d.patch<dynamic>('/user-onboarding/$id', data: body, options: o);
    },
    (data) {
      final j = data as Map<String, dynamic>;
      return (
        id: _int(j['userId'] ?? _map(_map(j['detail'])['user'])['id']),
        temporaryPassword: _s(j['temporaryPassword']),
        linked: j['linkedExistingAccount'] == true,
      );
    },
  );

  /// Banks (`GET /masters?types=banks`, shared master).
  Future<List<OnbChoice>> banks() => client.run(
    (d) => d.get<dynamic>('/masters', queryParameters: {'types': 'banks'}, options: ApiClient.allCompanies()),
    (data) => [
      for (final b in _list(_map(_map(data)['types'])['banks']))
        if (_map(b)['active'] != false)
          (id: _int(_map(b)['id']), label: [_map(b)['code'], _map(b)['name']].whereType<String>().join(' — ')),
    ],
  );
}

final onboardingApiProvider = Provider((ref) => OnboardingApi(ref.watch(apiClientProvider)));
final onboardingProvider = FutureProvider.autoDispose.family<OnbDetail, int?>(
  (ref, id) => ref.watch(onboardingApiProvider).load(id),
);
final banksProvider = FutureProvider.autoDispose<List<OnbChoice>>((ref) => ref.watch(onboardingApiProvider).banks());
