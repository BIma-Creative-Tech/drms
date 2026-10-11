import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/approvals/presentation/inbox_screen.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/turn_timeline.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../support/fixtures.dart';
import '../support/widget_harness.dart';
import 'e1_e3_screens_test.dart' show inboxPage, signedIn;

/// DRMS 10/10 B-2 integration — web ↔ APK parity: ADR 0021 timeline (Diajukan → Persetujuan PM → Persetujuan
/// Direktur → Transfer Finance, like the web ApprovalTimeline), "Rincian item", inbox badge "Selisih nota (n)",
/// pre-D3 line in Revisi Nota ("Lengkapi Qty & Harga satuan", Kirim ulang nota blocked).
void main() {
  Map<String, dynamic> pmApproved({List<Map<String, dynamic>> transfers = const []}) => {
    ...pmDetailJson(
      status: 'approved',
      allowed: const [],
      approvals: [
        {'id': 1, 'cycle': 1, 'position': 'diajukan', 'level': 0, 'actorName': 'Budi', 'decision': 'signed'},
        {'id': 2, 'cycle': 1, 'position': 'dibuat', 'level': 0, 'actorName': 'Citra', 'decision': 'signed'},
        {'id': 3, 'cycle': 1, 'position': 'diketahui', 'level': 0, 'actorName': 'Pandu', 'decision': 'acknowledged'},
        {'id': 4, 'cycle': 1, 'position': 'approval', 'level': 1, 'actorName': 'Dedi', 'decision': 'approved'},
      ],
    ),
    'type': 'advance',
    'typeLabel': 'Pengajuan Baru',
    'transfers': transfers,
  };

  group('ADR 0021 timeline = web ApprovalTimeline', () {
    test('approved Pengajuan Baru: Transfer Finance is the current turn; creator named in the note', () {
      final steps = buildTimeline(detailFromJson(pmApproved()));
      expect(steps.map((s) => s.title), ['Diajukan', 'Persetujuan PM', 'Persetujuan Direktur', 'Transfer Finance']);
      expect(steps.map((s) => s.state), [TurnState.done, TurnState.done, TurnState.done, TurnState.current]);
      expect(steps.first.actor, 'Budi');
      expect(steps.first.note, 'dibuat oleh Citra');
    });

    test('posted transfer → done with its number; a voided one is listed in the note', () {
      final steps = buildTimeline(
        detailFromJson({
          ...pmApproved(
            transfers: [
              {'id': 1, 'docNo': 'TRF/DRMS/2610/0001', 'kind': 'advance', 'amount': 1, 'status': 'void'},
              {
                'id': 2,
                'docNo': 'TRF/DRMS/2610/0002',
                'kind': 'advance',
                'amount': 1,
                'status': 'posted',
                'transferDate': '2026-10-11',
              },
            ],
          ),
          'status': 'transferred',
        }),
      );
      expect(steps.last.state, TurnState.done);
      expect(steps.last.note, 'TRF/DRMS/2610/0002 · void: TRF/DRMS/2610/0001');
    });

    test('legacy snapshots keep their wording and no transfer step', () {
      final steps = buildTimeline(detailFromJson(detailJson()));
      expect(steps.map((s) => s.title), ['Diajukan Oleh', 'Dibuat Oleh', 'Diketahui Oleh', 'Approval (Direktur)']);
    });

    testWidgets('detail screen: "Rincian item" and the ADR 0021 timeline', (tester) async {
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        overrides: [requestDetailProvider(42).overrideWith((ref) async => detailFromJson(pmApproved()))],
      );
      final scroll = find.byType(Scrollable).first;
      await tester.scrollUntilVisible(find.text('Rincian item'), 300, scrollable: scroll);
      expect(find.text('Rincian item'), findsOneWidget);
      expect(find.text('Transfer Finance'), findsOneWidget);
      expect(find.text('Diketahui Oleh'), findsNothing);
    });
  });

  testWidgets('approval inbox: "Selisih nota (n)" badge like the web transfer queue', (tester) async {
    await pumpScreen(
      tester,
      const InboxScreen(),
      auth: signedIn({Role.owner}),
      overrides: [
        inboxProvider.overrideWith(
          (ref) async => inboxPage(
            extra: {
              'flags': {'warning': 1, 'info': 0, 'receiptMismatch': 2},
            },
          ),
        ),
      ],
    );
    expect(find.byKey(const Key('inbox-mismatch-42')), findsOneWidget);
    expect(find.text('Selisih nota (2)'), findsOneWidget);
  });

  testWidgets('inbox without a mismatch: no badge', (tester) async {
    await pumpScreen(
      tester,
      const InboxScreen(),
      auth: signedIn({Role.owner}),
      overrides: [
        inboxProvider.overrideWith(
          (ref) async => inboxPage(
            extra: {
              'flags': {'warning': 0, 'info': 0, 'receiptMismatch': 0},
            },
          ),
        ),
      ],
    );
    expect(find.byKey(const Key('inbox-mismatch-42')), findsNothing);
  });

  testWidgets('Revisi Nota with a pre-D3 line: "Lengkapi Qty & Harga satuan", Kirim ulang nota disabled', (
    tester,
  ) async {
    final json = detailJson(status: 'receipt_revision', allowed: const ['receipts_resubmit', 'edit']);
    final lines = [for (final l in json['lines'] as List) Map<String, dynamic>.of(l as Map<String, dynamic>)];
    lines[1]['unitPrice'] = null;
    await pumpScreen(
      tester,
      const RequestDetailScreen(id: 42),
      overrides: [
        requestDetailProvider(42)
            .overrideWith((ref) async => detailFromJson({...json, 'type': 'reimburse', 'lines': lines})),
      ],
    );
    final scroll = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(find.byKey(const Key('lines-incomplete-note')), 300, scrollable: scroll);
    final t = AppLocalizations.of(tester.element(find.byKey(const Key('lines-incomplete-note'))));
    expect(find.text(t.linesIncompleteResubmit('2')), findsOneWidget);
    final btn = find.descendant(
      of: find.byKey(const Key('action-receipts-resubmit')),
      matching: find.bySubtype<ButtonStyleButton>(),
    );
    expect(tester.widget<ButtonStyleButton>(btn).onPressed, isNull);
    await tester.scrollUntilVisible(find.byKey(const Key('line-2-needs-unit-price')), 300, scrollable: scroll);
    expect(find.byKey(const Key('line-1-needs-unit-price')), findsNothing);
  });
}
