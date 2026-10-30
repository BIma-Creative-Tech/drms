import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/attendance/presentation/schedule_screen.dart';
import 'package:proyekkas/features/home/domain/web_route_map.dart';
import 'package:proyekkas/features/users/access_matrix_screen.dart';
import 'package:proyekkas/features/users/onboarding.dart';
import 'package:proyekkas/features/users/onboarding_screen.dart';

import '../support/widget_harness.dart';

const _schedule = {
  'year': 2026,
  'today': '2026-10-19',
  'companyId': 1,
  'canWrite': true,
  'canCreate': true,
  'defaultScheduleId': 1,
  'defaultRadius': 100,
  'schedules': [
    {
      'id': 1,
      'name': 'Kantor',
      'start': '08:00',
      'end': '17:00',
      'tol': 15,
      'days': [1, 2, 3, 4, 5],
      'active': true,
      'used': 12,
    },
    {
      'id': 2,
      'name': 'Lapangan',
      'start': '07:00',
      'end': '16:00',
      'tol': 10,
      'days': [1, 2, 3, 4, 5, 6],
      'active': true,
      'used': 3,
    },
  ],
  'holidays': [
    {'id': 5, 'date': '2026-12-25', 'name': 'Natal'},
  ],
  'costCenters': [
    {'id': 7, 'code': 'KTR', 'name': 'Kantor pusat', 'lat': -1.26, 'lng': 116.83, 'radiusM': 150, 'active': true},
  ],
  'employees': [
    {'id': 9, 'code': 'E09', 'name': 'Budi', 'scheduleId': null},
  ],
};

Map<String, dynamic> _matrix({bool groupAdmin = false}) => {
  'viewer': {
    'groupAdmin': groupAdmin,
    'adminOf': [1],
  },
  'narrowed': false,
  'roles': [
    {'value': 'pk-staff', 'label': 'Staff', 'short': 'Staff'},
    {'value': 'pk-finance', 'label': 'Finance', 'short': 'Fin'},
    {'value': 'pk-principal', 'label': 'Owner', 'short': 'Own'},
    {'value': 'pk-operator', 'label': 'Operator', 'short': 'Opr'},
  ],
  'reasonMin': 3,
  'companies': [
    {'id': 1, 'shortCode': 'CS1', 'name': 'PT Contoh Satu'},
  ],
  'users': {
    'items': [
      {'id': 21, 'name': 'Sari', 'email': 'sari@x.test', 'active': true},
    ],
    'page': 1,
    'totalPages': 1,
    'totalDocs': 1,
  },
  'cells': [
    {
      'id': 3,
      'user': 21,
      'company': 1,
      'roles': ['pk-staff'],
      'employee': null,
      'active': true,
    },
  ],
  'employees': [],
  'activeUserIds': [21],
  'warnings': ['PT CS1 tidak punya Direktur aktif — pengajuan CS1 tidak bisa diajukan (409).'],
};

class _FakeOnb implements OnboardingApi {
  _FakeOnb({this.user, this.resetError});

  /// `null` = the "Pengguna baru" form; otherwise the stored account of `/users/:id`.
  final Map<String, Object?>? user;
  final Object? resetError;
  final saved = <Map<String, Object?>>[];
  final resets = <int>[];

  @override
  ApiClient get client => throw UnimplementedError();

  @override
  Future<OnbDetail> load(int? id) async => OnbDetail({
    'user': user,
    'companies': [
      {
        'id': 1,
        'shortCode': 'CS1',
        'name': 'PT Contoh Satu',
        'canManageEmployees': true,
        'membership': null,
        'employee': null,
        'bankAccounts': [],
        'employeeChoices': [],
        'canManageAssignments': true,
        'assignments': [],
        'assignmentChoices': {'projects': [], 'costCenters': [], 'sites': []},
      },
    ],
  });

  @override
  Future<({int id, String? temporaryPassword, bool linked})> save(
    int? id,
    Map<String, Object?> body, {
    required String idempotencyKey,
  }) async {
    saved.add(body);
    return (id: 77, temporaryPassword: 'Tmp-123-abc', linked: false);
  }

  @override
  Future<String> resetPassword(int id) async {
    resets.add(id);
    if (resetError case final e?) throw e;
    return 'Rst-456-xyz';
  }

  @override
  Future<List<OnbChoice>> banks() async => const [];
}

/// An existing account (`GET /user-onboarding/{id}` `user`); the harness profile (the caller) is user 5.
Map<String, Object?> _user({int id = 21, bool active = true, bool identityEditable = true}) => {
  'id': id,
  'email': 'sari@x.test',
  'name': 'Sari',
  'phone': null,
  'active': active,
  'groupAdmin': false,
  'identityEditable': identityEditable,
};

/// User 2026-10-19 (APK ↔ web parity, phase 6): Jadwal & hari libur, Akses PT, Pengguna.
void main() {
  test('menu targets', () {
    expect(apkTargetFor('/absensi/jadwal')!.route, '/attendance-schedule');
    expect(apkTargetFor('/akses-pt')!.route, '/access-matrix');
    expect(apkTargetFor('/pengguna/baru')!.route, '/users/new');
    expect(apkTargetFor('/collections/devices')!.route, '/data/devices');
    expect(apkTargetFor('/collections/holidays')!.route, '/data/holidays');
  });

  testWidgets('schedule: schedules with default, holidays, geofence, employees on the default', (tester) async {
    await pumpScreen(
      tester,
      const AttendanceScheduleScreen(),
      overrides: [attendanceScheduleProvider.overrideWith((ref, year) async => _schedule)],
    );
    expect(find.textContaining('Kantor · default PT'), findsOneWidget);
    expect(find.byKey(const Key('schedule-default-2')), findsOneWidget);
    expect(find.byKey(const Key('schedule-default-1')), findsNothing);
    expect(find.text('Natal'), findsOneWidget);
    expect(find.textContaining('radius 150 m'), findsOneWidget);
    expect(find.text('Kantor (default PT)'), findsOneWidget);
    expect(find.byKey(const Key('schedule-add')), findsOneWidget);
  });

  testWidgets('matrix: a PT admin toggles a role (pending save), the Owner is not offered; warnings shown', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      const AccessMatrixScreen(),
      overrides: [accessMatrixProvider.overrideWith((ref, m) async => _matrix())],
    );
    expect(find.textContaining('tidak punya Direktur'), findsOneWidget);
    expect(find.byKey(const Key('matrix-role-21:1-pk-principal')), findsNothing, reason: 'PT admin, Owner not held');
    expect(find.byKey(const Key('matrix-save')), findsNothing);
    await tester.tap(find.byKey(const Key('matrix-role-21:1-pk-operator')));
    await tester.pumpAndSettle();
    expect(find.text('Simpan (1)'), findsOneWidget);
    await tester.tap(find.byKey(const Key('matrix-role-21:1-pk-operator')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('matrix-save')), findsNothing, reason: 'back to the stored roles');
  });

  testWidgets('matrix: a group admin may grant the Owner', (tester) async {
    await pumpScreen(
      tester,
      const AccessMatrixScreen(),
      overrides: [accessMatrixProvider.overrideWith((ref, m) async => _matrix(groupAdmin: true))],
    );
    expect(find.byKey(const Key('matrix-role-21:1-pk-principal')), findsOneWidget);
  });

  testWidgets('new user: account + roles of a PT → one save, temporary password shown once', (tester) async {
    final api = _FakeOnb();
    await pumpScreen(tester, const OnboardingScreen(), overrides: [onboardingApiProvider.overrideWithValue(api)]);
    await tester.tap(find.byKey(const Key('onb-save')));
    await tester.pumpAndSettle();
    expect(api.saved, isEmpty);
    expect(find.text('Pilih minimal satu PT dan peran.'), findsWidgets);
    await tester.enterText(find.byKey(const Key('onb-email')), 'baru@x.test');
    await tester.enterText(find.byKey(const Key('onb-name')), 'Pengguna Baru');
    await tester.tap(find.byKey(const Key('onb-role-1-pk-staff')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('onb-save')));
    await tester.pumpAndSettle();
    await confirmPopup(tester);
    expect(api.saved.single, {
      'user': {'email': 'baru@x.test', 'name': 'Pengguna Baru', 'phone': null},
      'companies': [
        {
          'company': 1,
          'roles': ['pk-staff'],
        },
      ],
    });
    expect(find.text('Tmp-123-abc'), findsOneWidget);
    expect(find.byKey(const Key('onb-reset-password')), findsNothing, reason: 'new account: no reset');
  });

  testWidgets('DRMS 27/10: Reset password → confirm → new temporary password shown once', (tester) async {
    final api = _FakeOnb(user: _user());
    await pumpScreen(tester, const OnboardingScreen(id: 21), overrides: [onboardingApiProvider.overrideWithValue(api)]);
    await tester.tap(find.byKey(const Key('onb-reset-password')));
    await tester.pumpAndSettle();
    expect(find.text('Yakin ingin reset kata sandi?'), findsOneWidget);
    expect(find.textContaining('Kata sandi lama tidak berlaku lagi'), findsOneWidget);
    expect(api.resets, isEmpty, reason: 'nothing sent before the confirmation');
    await confirmPopup(tester, key: const Key('onb-reset-password-confirm'));
    expect(api.resets, [21]);
    expect(find.text('Rst-456-xyz'), findsOneWidget);
    expect(find.textContaining('saat login berikutnya'), findsWidgets);
    expect(api.saved, isEmpty, reason: 'the reset is not a form save');
  });

  testWidgets('DRMS 27/10: a refused reset shows the server message', (tester) async {
    final api = _FakeOnb(
      user: _user(),
      resetError: const ProblemException(
        status: 409,
        detail: 'Akun nonaktif — aktifkan dulu sebelum mereset kata sandi.',
      ),
    );
    await pumpScreen(tester, const OnboardingScreen(id: 21), overrides: [onboardingApiProvider.overrideWithValue(api)]);
    await tester.tap(find.byKey(const Key('onb-reset-password')));
    await tester.pumpAndSettle();
    await confirmPopup(tester, key: const Key('onb-reset-password-confirm'));
    expect(find.textContaining('Akun nonaktif'), findsOneWidget);
    expect(find.byKey(const Key('onb-temp-password')), findsNothing);
  });

  for (final (why, user) in [
    ('own account', _user(id: 5)),
    ('inactive account', _user(active: false)),
    ('account of a PT the caller does not manage', _user(identityEditable: false)),
  ]) {
    testWidgets('DRMS 27/10: no Reset password for the $why', (tester) async {
      final api = _FakeOnb(user: user);
      final id = user['id']! as int;
      await pumpScreen(tester, OnboardingScreen(id: id), overrides: [onboardingApiProvider.overrideWithValue(api)]);
      expect(find.byKey(const Key('onb-email')), findsOneWidget);
      expect(find.byKey(const Key('onb-reset-password')), findsNothing);
    });
  }
}
