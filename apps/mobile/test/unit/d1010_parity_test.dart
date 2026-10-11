import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/format/rupiah.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';
import 'package:proyekkas/shared/widgets/pick_hint.dart';

/// d1010 Phase A (APK parity): greeting name (WA-14), Rupiah input (8c / WA-02), select hints (8d / WA-15).
void main() {
  group('displayName (WA-14): never the full e-mail', () {
    UserProfile p({String email = 'budi.santoso@example.test', String? server, String? name, String? emp}) =>
        UserProfile(
          id: 1,
          email: email,
          serverDisplayName: server,
          name: name,
          roles: const {Role.staff},
          employee: emp == null ? null : Employee(id: 3, code: 'E3', name: emp),
        );

    test('/me displayName wins', () {
      expect(p(server: 'Budi S.', name: 'Budi Santoso', emp: 'Budi').displayName, 'Budi S.');
    });
    test('then the user name, then the employee name', () {
      expect(p(name: 'Budi Santoso', emp: 'Budi').displayName, 'Budi Santoso');
      expect(p(name: '  ', emp: 'Budi Karyawan').displayName, 'Budi Karyawan');
    });
    test('a name that is an e-mail address is skipped', () {
      expect(p(server: 'x@example.test', name: 'budi@example.test', emp: 'Budi Karyawan').displayName, 'Budi Karyawan');
    });
    test('employee of another PT when the scope has none', () {
      final u = p().copyWith(
        companies: const [
          CompanyMembership(id: 1, code: 'CS1', name: 'PT Satu'),
          CompanyMembership(
            id: 2,
            code: 'CS2',
            name: 'PT Dua',
            employee: Employee(id: 9, code: 'E9', name: 'Budi Dua'),
          ),
        ],
      );
      expect(u.displayName, 'Budi Dua');
    });
    test('then the e-mail local part, then "Pengguna"', () {
      expect(p().displayName, 'budi.santoso');
      expect(p(email: '').displayName, 'Pengguna');
      expect(p(email: '@example.test').displayName, 'Pengguna');
    });
    test('/me displayName is optional in the mapper', () {
      final withName = userProfileFromJson({
        'id': 1,
        'email': 'budi@example.test',
        'name': null,
        'displayName': 'Budi',
        'roles': ['pk-staff'],
      });
      expect(withName.serverDisplayName, 'Budi');
      expect(withName.displayName, 'Budi');
      final legacy = userProfileFromJson({
        'id': 1,
        'email': 'budi@example.test',
        'roles': ['pk-staff'],
        'employee': {'id': 4, 'code': 'E4', 'name': 'Budi Karyawan'},
      });
      expect(legacy.serverDisplayName, isNull);
      expect(legacy.displayName, 'Budi Karyawan');
    });
  });

  group('RupiahInputFormatter (8c)', () {
    const f = RupiahInputFormatter();
    TextEditingValue type(String text, [int? cursor]) => f.formatEditUpdate(
      TextEditingValue.empty,
      TextEditingValue(
        text: text,
        selection: TextSelection.collapsed(offset: cursor ?? text.length),
      ),
    );

    test('groups thousands with a dot while typing; parseRupiah reads it back', () {
      expect(type('1447500').text, '1.447.500');
      expect(parseRupiah(type('1447500').text), 1447500);
      expect(type('1.447.5009').text, '14.475.009');
      expect(type('600').text, '600');
    });
    test('drops non-digits, leading zeros and empties', () {
      expect(type('Rp 12a3').text, '123');
      expect(type('007').text, '7');
      expect(type('0').text, '0');
      expect(type('').text, '');
      expect(type('abc').text, '');
    });
    test('cursor stays behind the same digit', () {
      // "1.000|" → typing a digit at the end keeps the cursor at the end
      final end = type('10000');
      expect(end.selection.baseOffset, end.text.length);
      // cursor after the first digit of "12345" → after "1" in "12.345"
      expect(type('12345', 1).selection.baseOffset, 1);
      // cursor after "123" of "123456" → "123.|456"
      expect(type('123456', 3).selection.baseOffset, 3);
    });
    test('groupRupiah formats an initial value', () {
      expect(groupRupiah(1447500), '1.447.500');
      expect(groupRupiah(null), '');
    });
  });

  group('pickHintFor (8d / WA-15)', () {
    final t = lookupAppLocalizations(const Locale('id'));
    test('field-specific placeholder', () {
      expect(pickHintFor(t, 'Project'), 'Pilih project');
      expect(pickHintFor(t, 'Rekening tujuan'), 'Pilih rekening tujuan');
      expect(pickHintFor(t, 'PT'), 'Pilih PT');
    });
  });
}
