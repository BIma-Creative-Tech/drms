import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/draft_validation.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';

/// QA report 2026-10-08 "alur & nota" (APK 0.3.4): QA-15 Staff requests for themselves only, QA-27 valid
/// receipts are locked, and the server's Indonesian refusal text is shown (409 / 403 without `detail`).
void main() {
  UserProfile twoPts(Set<Role> rolesInA) => UserProfile(
    id: 5,
    email: 'doni@example.test',
    roles: {...rolesInA, Role.pm},
    employee: const Employee(id: 12, code: 'E12', name: 'Doni'),
    companies: [
      CompanyMembership(
        id: 1,
        code: 'DRMS',
        name: 'PT DRMS',
        roles: rolesInA,
        employee: const Employee(id: 12, code: 'E12', name: 'Doni'),
      ),
      const CompanyMembership(
        id: 2,
        code: 'LAS',
        name: 'PT LAS',
        roles: {Role.pm},
        employee: Employee(id: 30, code: 'E30', name: 'Doni'),
      ),
    ],
  );

  group('QA-15 requestsForSelfOnly (roles IN the draft PT)', () {
    test('only Staff → self only; Staff + another role, PM, Admin → not', () {
      expect(twoPts({Role.staff}).forCompany(1).requestsForSelfOnly, isTrue);
      expect(twoPts({Role.staff}).forCompany(2).requestsForSelfOnly, isFalse); // PM in PT 2
      expect(twoPts({Role.staff, Role.pm}).forCompany(1).requestsForSelfOnly, isFalse);
      expect(twoPts({Role.admin}).forCompany(1).requestsForSelfOnly, isFalse);
      expect(twoPts({Role.staff}).forCompany(99).requestsForSelfOnly, isFalse); // no roles at all
    });
  });

  group('QA-15 requester rules', () {
    const d = DraftRequest(clientUuid: 'c-1', type: RequestType.advance, title: 'x', requesterIds: [12, 13]);
    test('self-only: exactly the own employee, else an issue with the server wording', () {
      expect(requesterIssues(d, selfOnlyEmployee: 12).single.field, 'requesterIds');
      expect(requesterIssues(d, selfOnlyEmployee: 12).single.message, staffSelfOnlyMessage);
      expect(requesterIssues(d.copyWith(requesterIds: [12]), selfOnlyEmployee: 12), isEmpty);
      expect(requesterIssues(d.copyWith(requesterIds: [13]), selfOnlyEmployee: 12), hasLength(1));
      expect(requesterIssues(d.copyWith(requesterIds: const []), selfOnlyEmployee: -1), hasLength(1));
      expect(requesterIssues(d), isEmpty); // PM / Admin / Finance: no restriction
      expect(validateForSubmit(d, selfOnlyEmployee: 12).map((i) => i.field), contains('requesterIds'));
      expect(validateForSubmit(d).map((i) => i.field), isNot(contains('requesterIds')));
    });
    test('picker: own employee only for a Staff-only user', () {
      final all = [(id: 12, name: 'Doni'), (id: 13, name: 'Rivaldo'), (id: 14, name: 'PM')];
      expect(requesterChoices(all, (e) => e.id, selfOnlyEmployee: 12).map((e) => e.id), [12]);
      expect(requesterChoices(all, (e) => e.id, selfOnlyEmployee: -1), isEmpty);
      expect(requesterChoices(all, (e) => e.id), all);
    });
  });

  test('QA-27 receiptRemovable: valid (locked) and removed → false', () {
    expect(receiptRemovable('pending'), isTrue);
    expect(receiptRemovable('rejected'), isTrue);
    expect(receiptRemovable('valid'), isFalse);
    expect(receiptRemovable('removed'), isFalse);
  });

  group('server refusal text (problem `title`)', () {
    test('domain sentence in title is shown; reason phrases fall back to the generic text', () {
      expect(
        ProblemException.fromJson(409, {
          'title': 'Nota sudah divalidasi Finance; nota tidak dapat dihapus.',
          'status': 409,
        }).message,
        'Nota sudah divalidasi Finance; nota tidak dapat dihapus.',
      );
      expect(
        ProblemException.fromJson(409, {'title': 'Conflict', 'status': 409}).message,
        'Data sudah berubah. Muat ulang lalu coba lagi.',
      );
      expect(
        ProblemException.fromJson(403, {'title': 'Forbidden', 'status': 403}).message,
        'Anda tidak berhak melakukan aksi ini.',
      );
      // detail and field errors keep priority (QA-07: "Tanggal nota tidak boleh di masa depan (hari ini …).")
      expect(
        ProblemException.fromJson(400, {
          'title': 'Tanggal nota tidak boleh di masa depan.',
          'errors': [
            {'path': 'receiptDate', 'message': 'Tanggal nota tidak boleh di masa depan (hari ini 2026-10-08).'},
          ],
        }).message,
        'Tanggal nota tidak boleh di masa depan (hari ini 2026-10-08).',
      );
      expect(
        ProblemException.fromJson(409, {'title': 'Ditolak.', 'detail': 'Sudah diproses.'}).message,
        'Sudah diproses.',
      );
    });
  });
}
