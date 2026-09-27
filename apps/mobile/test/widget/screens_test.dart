import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/device/device_integrity.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/approvals/presentation/decision_sheet.dart';
import 'package:proyekkas/features/approvals/presentation/inbox_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/auth/presentation/login_screen.dart';
import 'package:proyekkas/features/dashboard/domain/dashboard.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';

import '../support/fixtures.dart';
import '../support/seed.dart';
import '../support/widget_harness.dart';

final masters = <String, List<MasterItem>>{
  MasterTypes.costCenters: [const MasterItem(7, 'OPS-PB — Ops Palangka Banjar')],
  MasterTypes.categories: [
    const MasterItem(1, 'BBM'),
    const MasterItem(2, 'Penginapan'),
    const MasterItem(3, 'Konsumsi'),
  ],
  MasterTypes.employees: [const MasterItem(11, 'Budi'), const MasterItem(12, 'Doni Pratama')],
  MasterTypes.bankAccounts: [
    const MasterItem(21, 'Mandiri · Doni Pratama · •••0123', extra: {'employee': 12}),
  ],
};

void main() {
  group('Pengajuan form (3 lines)', () {
    testWidgets('shows the seed lines and preview total Rp 1.447.500', (tester) async {
      await pumpScreen(tester, DraftEditorScreen(initial: seedDraft(), masters: masters, isNew: false));
      expect(find.byKey(const Key('line-1')), findsOneWidget);
      expect(find.byKey(const Key('line-2')), findsOneWidget);
      expect(find.byKey(const Key('line-3')), findsOneWidget);
      expect(find.text('Rp 677.000'), findsOneWidget);
      expect(find.text('Rp 170.500'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('preview-total'))).data, 'Rp 1.447.500');
      expect(find.text('Nilai final dihitung server.'), findsOneWidget);
    });

    testWidgets('offline: Ajukan disabled with "Butuh koneksi internet", save still enabled', (tester) async {
      await pumpScreen(tester, DraftEditorScreen(initial: seedDraft(), masters: masters, isNew: false), online: false);
      final submit = find.descendant(
        of: find.byKey(const Key('submit-draft')),
        matching: find.bySubtype<FilledButton>(),
      );
      expect(tester.widget<FilledButton>(submit).onPressed, isNull);
      expect(find.text('Butuh koneksi internet'), findsOneWidget);
      expect(tester.widget<ButtonStyleButton>(find.byKey(const Key('save-draft'))).onPressed, isNotNull);
    });

    testWidgets('online: Ajukan with a missing bank account lists the problem in Indonesian', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft().copyWith(bankAccountId: null), masters: masters, isNew: false),
      );
      await tester.tap(
        find.descendant(of: find.byKey(const Key('submit-draft')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Rekening tujuan wajib dipilih.'), findsWidgets);
      expect(find.byKey(const Key('submit-confirm')), findsNothing);
    });
  });

  group('Approval (Direktur)', () {
    testWidgets('inbox shows budget impact %, over-warn marker and flags', (tester) async {
      await pumpScreen(
        tester,
        const InboxScreen(),
        auth: AuthSignedIn(profile: profile({Role.owner}), sub: 's'),
        overrides: [
          inboxProvider.overrideWith(
            (ref) async => InboxPage([inboxItemFromJson(inboxJson()['items'][0] as Map<String, dynamic>)], 85),
          ),
        ],
      );
      expect(find.text('Service Tronton'), findsOneWidget);
      expect(find.textContaining('70,5% → 88,3%'), findsOneWidget);
      expect(find.textContaining('1 peringatan · 2 info'), findsOneWidget);
      expect(find.byIcon(Icons.warning_amber), findsOneWidget);
      expect(find.text('Rp 1.447.500'), findsOneWidget);
    });

    testWidgets('detail: Giliran, lines, flags and Setujui/Tolak for the approver', (tester) async {
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        auth: AuthSignedIn(profile: profile({Role.owner}), sub: 's'),
        overrides: [
          requestDetailProvider(42).overrideWith((ref) async => detailFromJson(detailJson())),
          receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(tester.widget<Text>(find.byKey(const Key('turn-text'))).data, 'Approval (Direktur)');
      expect(find.text('Satuan tidak wajar'), findsOneWidget);
      expect(find.byKey(const Key('action-approve')), findsOneWidget);
      expect(find.byKey(const Key('action-reject')), findsOneWidget);
    });

    testWidgets('reject requires a reason (≥ 3 characters)', (tester) async {
      final d = detailFromJson(detailJson());
      await pumpScreen(
        tester,
        Scaffold(
          body: DecisionSheet(detail: d, decision: Decision.reject),
        ),
      );
      await tester.tap(
        find.descendant(of: find.byKey(const Key('decision-confirm')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      expect(find.text('Alasan wajib diisi (minimal 3 karakter).'), findsOneWidget);
    });

    testWidgets('drawn signature must not be empty', (tester) async {
      final d = detailFromJson(detailJson());
      await pumpScreen(
        tester,
        Scaffold(
          body: DecisionSheet(detail: d, decision: Decision.approve),
        ),
      );
      await tester.tap(find.text('Tanda tangan di layar'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('signature-pad')), findsOneWidget);
      await tester.tap(
        find.descendant(of: find.byKey(const Key('decision-confirm')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      expect(find.text('Tanda tangan belum dibuat.'), findsOneWidget);
    });

    testWidgets('decisions are online-only', (tester) async {
      final d = detailFromJson(detailJson());
      await pumpScreen(
        tester,
        Scaffold(
          body: DecisionSheet(detail: d, decision: Decision.approve),
        ),
        online: false,
      );
      final btn = find.descendant(
        of: find.byKey(const Key('decision-confirm')),
        matching: find.bySubtype<FilledButton>(),
      );
      expect(tester.widget<FilledButton>(btn).onPressed, isNull);
      expect(find.text('Butuh koneksi internet'), findsOneWidget);
    });
  });

  group('Login / home / errors', () {
    testWidgets('session ended message after revoke; login disabled offline', (tester) async {
      await pumpScreen(tester, const LoginScreen(), online: false, auth: const AuthSignedOut(message: 'session_ended'));
      expect(find.text('Sesi berakhir atau perangkat dicabut. Silakan masuk kembali.'), findsOneWidget);
      expect(tester.widget<ButtonStyleButton>(find.byKey(const Key('login-button'))).onPressed, isNull);
      expect(find.text('Login pertama kali butuh koneksi internet.'), findsWidgets);
    });

    testWidgets('staff home: big create buttons, no approval inbox', (tester) async {
      await pumpScreen(tester, const HomeScreen());
      expect(find.byKey(const Key('home-new-advance')), findsOneWidget);
      expect(find.byKey(const Key('home-new-reimburse')), findsOneWidget);
      expect(find.byKey(const Key('home-inbox')), findsNothing);
    });

    testWidgets('rooted/emulator device: warning on home (Q-43: warn + flag, never block)', (tester) async {
      await pumpScreen(
        tester,
        const HomeScreen(),
        overrides: [
          integrityReportProvider.overrideWith(
            (ref) async =>
                const DeviceIntegrityReport(rooted: true, emulator: false, developerMode: false, adbEnabled: false),
          ),
        ],
      );
      expect(find.byKey(const Key('integrity-warning')), findsOneWidget);
      expect(find.byKey(const Key('home-new-advance')), findsOneWidget);
    });

    testWidgets('Direktur home: approval inbox with count, no create buttons', (tester) async {
      await pumpScreen(
        tester,
        const HomeScreen(),
        auth: AuthSignedIn(profile: profile({Role.owner}), sub: 's'),
        overrides: [
          direkturDashboardProvider.overrideWith((ref) async => DirekturDashboard.fromJson(direkturDashboardJson())),
          inboxProvider.overrideWith(
            (ref) async => InboxPage([inboxItemFromJson(inboxJson()['items'][0] as Map<String, dynamic>)], 85),
          ),
        ],
      );
      expect(find.byKey(const Key('home-inbox')), findsOneWidget);
      expect(find.text('1 menunggu'), findsOneWidget);
      expect(find.byKey(const Key('home-new-advance')), findsNothing);
    });

    testWidgets('network error is shown in Bahasa Indonesia with retry', (tester) async {
      await pumpScreen(
        tester,
        const InboxScreen(),
        auth: AuthSignedIn(profile: profile({Role.owner}), sub: 's'),
        overrides: [inboxProvider.overrideWith((ref) async => throw const NetworkException())],
      );
      expect(find.text('Tidak ada koneksi ke server. Periksa sinyal atau data internet.'), findsOneWidget);
      expect(find.text('Coba lagi'), findsOneWidget);
    });
  });
}
