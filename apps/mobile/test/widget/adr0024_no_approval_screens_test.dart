import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/master_picker.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/finance/application/finance_providers.dart';
import 'package:proyekkas/features/finance/domain/transfer_queue.dart';
import 'package:proyekkas/features/finance/presentation/finance_screen.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';

import '../support/d1010_c_fixtures.dart';
import '../support/fixtures.dart';
import '../support/seed.dart';
import '../support/widget_harness.dart';

/// ADR 0024 (owner 2026-10-11) on the APK: a Direktur's own request goes straight to the Finance transfer queue.

const _dirEmployee = Employee(id: 15, code: 'E15', name: 'Dedi Direktur');

UserProfile direkturProfile({bool noApprovalRule = true}) => UserProfile(
  id: 5,
  email: 'dedi@example.test',
  name: 'Dedi Direktur',
  roles: const {Role.owner},
  capabilities: Capabilities.fromRoles(const {Role.owner}),
  employee: _dirEmployee,
  companies: [
    CompanyMembership(
      id: 1,
      code: 'DRMS',
      name: 'PT DRMS',
      roles: const {Role.owner},
      employee: _dirEmployee,
      capabilities: Capabilities.fromRoles(const {Role.owner}),
      ownRequestNoApproval: noApprovalRule,
    ),
  ],
);

final _masters = <String, List<MasterItem>>{
  MasterTypes.categories: [const MasterItem(1, 'BBM')],
  MasterTypes.employees: [
    const MasterItem(11, 'Budi'),
    const MasterItem(15, 'Dedi Direktur', extra: {'direktur': true}),
  ],
  MasterTypes.bankAccounts: [
    const MasterItem(25, 'Mandiri · Dedi Direktur · •••0456', extra: {'employee': 15}),
  ],
};

void main() {
  testWidgets('detail: note + timeline step "Persetujuan — Dilewati — Tanpa persetujuan …", no decision bar', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      const RequestDetailScreen(id: 42),
      auth: AuthSignedIn(profile: direkturProfile(), sub: 's'),
      overrides: [
        requestDetailProvider(42).overrideWith((ref) async => detailFromJson(noApprovalDetailJson())),
        receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
      ],
    );
    expect(find.byKey(const Key('no-approval-note')), findsOneWidget);
    expect(find.text('Tanpa persetujuan — pengajuan Direktur (kebijakan PT)'), findsWidgets);
    expect(find.text('Persetujuan'), findsWidgets);
    expect(find.text('Transfer Finance'), findsWidgets);
    expect(find.text('Tanpa persetujuan (Antri Transfer)'), findsWidgets);
    expect(find.byKey(const Key('action-approve')), findsNothing);
    expect(find.byKey(const Key('direktur-via-pm-note')), findsNothing);
  });

  testWidgets('new request of a Direktur: info "Pengajuan Anda langsung ke antrian transfer Finance"', (tester) async {
    final draft = seedDraft(type: RequestType.advance)
        .copyWith(companyId: 1, requesterIds: const [15], bankAccountId: 25);
    await pumpScreen(
      tester,
      DraftEditorScreen(initial: draft, masters: _masters, isNew: true),
      auth: AuthSignedIn(profile: direkturProfile(), sub: 's'),
    );
    expect(find.byKey(const Key('draft-direktur-no-approval')), findsOneWidget);
    expect(find.text('Pengajuan Anda langsung ke antrian transfer Finance'), findsOneWidget);
  });

  testWidgets('no info without the PT rule, or when someone else is a requester', (tester) async {
    final draft = seedDraft(type: RequestType.advance)
        .copyWith(companyId: 1, requesterIds: const [15], bankAccountId: 25);
    await pumpScreen(
      tester,
      DraftEditorScreen(initial: draft, masters: _masters, isNew: true),
      auth: AuthSignedIn(profile: direkturProfile(noApprovalRule: false), sub: 's'),
    );
    expect(find.byKey(const Key('draft-direktur-no-approval')), findsNothing);
    await pumpScreen(
      tester,
      DraftEditorScreen(
        initial: draft.copyWith(requesterIds: const [15, 11]),
        masters: _masters,
        isNew: true,
      ),
      auth: AuthSignedIn(profile: direkturProfile(), sub: 's'),
    );
    expect(find.byKey(const Key('draft-direktur-no-approval')), findsNothing);
  });

  testWidgets('PM: the requester picker does not offer the Direktur', (tester) async {
    await pumpScreen(
      tester,
      DraftEditorScreen(
        initial: seedDraft().copyWith(requesterIds: const [12]),
        masters: _masters,
        isNew: true,
      ),
      auth: AuthSignedIn(profile: profile({Role.pm}), sub: 's'),
    );
    await tester.tap(find.widgetWithText(ActionChip, 'Pilih…'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(MasterPickerField).last);
    await tester.pumpAndSettle();
    expect(find.widgetWithText(ListTile, 'Budi'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'Dedi Direktur'), findsNothing);
  });

  testWidgets('Finance queue: badge "Tanpa persetujuan (Direktur)"', (tester) async {
    await pumpScreen(
      tester,
      const FinanceScreen(),
      auth: AuthSignedIn(profile: profile({Role.finance}), sub: 's'),
      overrides: [
        transferQueueProvider.overrideWith(
          (ref) async => [
            transferQueueItemFromJson({
              ...queueJson(44, type: 'advance'),
              'statusLabel': 'Tanpa persetujuan (Antri Transfer)',
              'noApproval': true,
            }),
            transferQueueItemFromJson(queueJson(45)),
          ],
        ),
        lpjQueueProvider.overrideWith((ref) async => const []),
      ],
    );
    expect(find.byKey(const Key('tq-44-no-approval')), findsOneWidget);
    expect(find.text('Tanpa persetujuan (Direktur)'), findsOneWidget);
    expect(find.text('Tanpa persetujuan (Antri Transfer)'), findsOneWidget);
    expect(find.byKey(const Key('tq-45-no-approval')), findsNothing);
  });
}
