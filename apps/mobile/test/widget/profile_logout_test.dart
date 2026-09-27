import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/settings/presentation/profile_screen.dart';
import 'package:proyekkas/features/sync/application/sync_coordinator.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';

import '../support/widget_harness.dart';

/// Records logout calls; completes when the test says so (shows the progress state meanwhile).
class _RecordingAuth extends FakeAuth {
  _RecordingAuth() : super(AuthSignedIn(profile: profile({Role.staff}), sub: 'user-sub-1'));
  int logouts = 0;
  Future<void> Function()? gate;

  @override
  Future<void> logout() async {
    logouts++;
    await gate?.call();
    state = const AuthSignedOut();
  }
}

void main() {
  testWidgets('no unsent data: plain confirmation, then logout', (tester) async {
    final auth = _RecordingAuth();
    await pumpScreen(
      tester,
      const ProfileScreen(),
      authController: () => auth,
      overrides: [outboxCountsProvider.overrideWith((ref) => Stream.value(const OutboxCounts()))],
    );
    await tester.tap(find.byKey(const Key('logout-button')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('logout-pending-warning')), findsNothing);
    expect(find.descendant(of: find.byKey(const Key('logout-confirm')), matching: find.text('Keluar')), findsOneWidget);
    await tester.tap(find.byKey(const Key('logout-confirm')));
    await tester.pumpAndSettle();
    expect(auth.logouts, 1);
  });

  testWidgets('unsent data: warns in Indonesian that nothing is deleted; cancel keeps the session', (tester) async {
    final auth = _RecordingAuth();
    await pumpScreen(
      tester,
      const ProfileScreen(),
      authController: () => auth,
      // 1 pending + 1 failed item of this user.
      overrides: [outboxCountsProvider.overrideWith((ref) => Stream.value(const OutboxCounts(pending: 1, failed: 1)))],
    );
    await tester.tap(find.byKey(const Key('logout-button')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('logout-pending-warning')), findsOneWidget);
    expect(find.textContaining('2 data belum terkirim'), findsOneWidget);
    expect(find.textContaining('TIDAK dihapus'), findsOneWidget);
    expect(find.text('Tetap keluar'), findsOneWidget);
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    expect(auth.logouts, 0);
  });

  testWidgets('shows progress while logging out and ignores a second tap', (tester) async {
    final auth = _RecordingAuth();
    auth.gate = () => Future<void>.delayed(const Duration(seconds: 1));
    await pumpScreen(
      tester,
      const ProfileScreen(),
      authController: () => auth,
      overrides: [outboxCountsProvider.overrideWith((ref) => Stream.value(const OutboxCounts()))],
    );
    await tester.tap(find.byKey(const Key('logout-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('logout-confirm')));
    await tester.pump();
    await tester.pump();
    expect(find.text('Sedang keluar…'), findsOneWidget);
    await tester.tap(find.byKey(const Key('logout-button')), warnIfMissed: false);
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(auth.logouts, 1);
  });
}
