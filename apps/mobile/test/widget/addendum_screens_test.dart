import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/addendum/data/addendum_api.dart';
import 'package:proyekkas/features/addendum/domain/addendum.dart';
import 'package:proyekkas/features/addendum/presentation/addendum_providers.dart';
import 'package:proyekkas/features/addendum/presentation/addendum_screens.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/approvals/presentation/inbox_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/progress/application/progress_providers.dart';

import '../support/e4_e6_fixtures.dart';
import '../support/widget_harness.dart';

/// E5 APK: addendum inbox for Direktur/Finance, decisions from the detail, PM create/submit.
class FakeAddendumApi extends Fake implements AddendumApi {
  final calls = <String>[];
  @override
  Future<Addendum> acknowledge(int id, {required String idempotencyKey}) async {
    calls.add('ack:$id');
    return Addendum.fromJson(addendumJson());
  }

  @override
  Future<Addendum> reject(int id, {required String reason, required String idempotencyKey}) async {
    calls.add('reject:$id:$reason');
    return Addendum.fromJson(addendumJson());
  }

  @override
  Future<Addendum> create({
    required int projectId,
    required int addition,
    required String reason,
    required bool submit,
    required String idempotencyKey,
  }) async {
    calls.add('create:$projectId:$addition:$submit');
    return Addendum.fromJson(addendumJson());
  }
}

AuthSignedIn _as(Set<Role> roles) => AuthSignedIn(profile: profile(roles), sub: 'user-sub-1');

void main() {
  testWidgets('Direktur inbox: addendum section above the expense requests', (tester) async {
    await pumpScreen(
      tester,
      const InboxScreen(),
      auth: _as({Role.owner}),
      stubProgress: false,
      overrides: [
        inboxProvider.overrideWith((ref) async => const InboxPage([], 85)),
        addendumInboxProvider.overrideWith((ref) async => [Addendum.fromJson(addendumJson())]),
      ],
    );
    expect(find.byKey(const Key('addendum-inbox')), findsOneWidget);
    expect(find.text('Addendum RAB menunggu Anda (1)'), findsOneWidget);
    expect(find.text('+Rp 250.000.000'), findsOneWidget);
    expect(find.text('RAB Rp 1.500.000.000 → Rp 1.750.000.000'), findsOneWidget);
    expect(find.text('Komitmen terhadap RAB 52% → 44,57%'), findsOneWidget);
  });

  testWidgets('detail: only the allowed actions; Setujui confirms; reject needs a reason', (tester) async {
    final api = FakeAddendumApi();
    await pumpScreen(
      tester,
      const AddendumDetailScreen(id: 61),
      auth: _as({Role.owner}),
      overrides: [
        addendumApiProvider.overrideWithValue(api),
        addendumDetailProvider.overrideWith((ref, id) async => Addendum.fromJson(addendumJson())),
      ],
    );
    expect(find.text('Menunggu: Direktur'), findsOneWidget);
    expect(find.byKey(const Key('addendum-action-acknowledge')), findsOneWidget);
    expect(find.byKey(const Key('addendum-action-reject')), findsOneWidget);
    expect(find.byKey(const Key('addendum-action-approve')), findsNothing);
    expect(find.byKey(const Key('addendum-action-cancel')), findsNothing);
    await tester.tap(find.text('Setujui (Direktur)'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('addendum-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, ['ack:61']);
    await tester.tap(find.text('Tolak'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('addendum-reason-ok')));
    await tester.pumpAndSettle();
    expect(find.text('Wajib diisi (minimal 3 karakter).'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('addendum-reason-field')), 'Belum ada BoQ');
    await tester.tap(find.byKey(const Key('addendum-reason-ok')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'reject:61:Belum ada BoQ');
  });

  testWidgets('offline: decision buttons disabled with "Butuh koneksi internet"', (tester) async {
    await pumpScreen(
      tester,
      const AddendumDetailScreen(id: 61),
      auth: _as({Role.finance}),
      online: false,
      overrides: [
        addendumDetailProvider.overrideWith(
          (ref, id) async => Addendum.fromJson(
            addendumJson(status: 'pending_approval', step: 'approve', actions: ['approve', 'reject']),
          ),
        ),
      ],
    );
    expect(find.text('Disetujui Direktur · Direktur Contoh'), findsOneWidget);
    expect(find.text('Butuh koneksi internet'), findsNWidgets(2));
    expect(
      tester
          .widget<FilledButton>(
            find.descendant(of: find.byKey(const Key('addendum-action-approve')), matching: find.byType(FilledButton)),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets('PM create: validation, then "Ajukan" posts submit=true with the parsed amount', (tester) async {
    final api = FakeAddendumApi();
    await pumpScreen(
      tester,
      const AddendumCreateScreen(),
      auth: _as({Role.pm}),
      overrides: [
        addendumApiProvider.overrideWithValue(api),
        progressProjectsProvider.overrideWith(
          (ref) async => const [
            MasterItem(7, 'P-07 — Gudang Contoh', extra: {'status': 'berjalan'}),
          ],
        ),
      ],
    );
    await tester.tap(find.text('Ajukan'));
    await tester.pumpAndSettle();
    expect(find.text('Pilih project.'), findsOneWidget);
    expect(find.text('Tambahan RAB harus lebih dari Rp 0.'), findsOneWidget);
    expect(api.calls, isEmpty);
    await tester.tap(find.byKey(const Key('addendum-project')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('P-07 — Gudang Contoh').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('addendum-amount')), '250.000.000');
    await tester.enterText(find.byKey(const Key('addendum-reason')), 'Tambahan pondasi');
    await tester.tap(find.text('Ajukan'));
    await tester.pump();
    expect(api.calls, ['create:7:250000000:true']);
  });
}
