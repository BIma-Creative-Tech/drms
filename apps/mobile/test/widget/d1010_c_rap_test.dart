import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/line_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/projects/application/projects_providers.dart';
import 'package:proyekkas/features/projects/domain/project.dart';

import '../support/fixtures.dart';
import '../support/seed.dart';
import '../support/widget_harness.dart';

/// DRMS 10/10 Phase C on the APK — D4 (line → RAP item, required, remaining budget, "Melebihi RAP") and D2
/// (project required, no cost center choice for the requester).
final masters = <String, List<MasterItem>>{
  MasterTypes.projects: [
    const MasterItem(9, 'PRJ-09 — Jalan Tambang Blok B'),
    const MasterItem(10, 'PRJ-10 — Workshop'),
  ],
  MasterTypes.costCenters: [const MasterItem(7, 'OPS-PB — Ops Palangka Banjar')],
  MasterTypes.categories: [
    const MasterItem(1, 'BBM'),
    const MasterItem(2, 'Penginapan'),
    const MasterItem(3, 'Konsumsi'),
  ],
  MasterTypes.uoms: [const MasterItem(3, 'liter'), const MasterItem(4, 'kamar')],
};

const rapItems = [
  RapBudgetItem(
    id: 501,
    code: 'A.1',
    name: 'Solar alat berat',
    uom: 'liter',
    planned: 15000000,
    realised: 14700000,
    remaining: 300000,
    percent: 98,
  ),
  RapBudgetItem(
    id: 502,
    code: 'A.2',
    name: 'Akomodasi tim',
    uom: 'malam',
    planned: 5000000,
    realised: 1000000,
    remaining: 4000000,
    percent: 20,
  ),
  RapBudgetItem(id: 503, code: 'A.3', name: 'Konsumsi lapangan', planned: 2000000, realised: 0, remaining: 2000000),
];

final rapOverride = projectRapProvider.overrideWith((ref, id) async => const RapLoad(rapItems));

void main() {
  group('D4 line editor: Item RAP', () {
    testWidgets('required when the project has RAP items; picker searches and shows the remaining budget', (
      tester,
    ) async {
      DraftLine? saved;
      await pumpScreen(
        tester,
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                key: const Key('open-line'),
                onPressed: () async {
                  saved = await Navigator.of(context).push<DraftLine>(
                    MaterialPageRoute(
                      builder: (_) => LineEditorScreen(
                        line: const DraftLine(clientUuid: 'l-1', no: 1, uomId: 3, categoryId: 1),
                        masters: masters,
                        projectId: 9,
                      ),
                    ),
                  );
                },
                child: const Text('open'),
              ),
            ),
          ),
        ),
        stubRap: false,
        overrides: [rapOverride],
      );
      await tester.tap(find.byKey(const Key('open-line')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('line-description')), 'Solar genset');
      await tester.enterText(find.byKey(const Key('line-qty')), '30');
      await tester.enterText(find.byKey(const Key('line-unit-price')), '15000');
      await tester.pump();
      await tester.tap(find.byKey(const Key('line-save')));
      await tester.pumpAndSettle();
      expect(find.byType(LineEditorScreen), findsOneWidget, reason: 'no RAP item yet → not saved');
      expect(find.text('Wajib diisi'), findsOneWidget);

      await tester.tap(find.byKey(const Key('line-rap-item')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('rap-option-501')), findsOneWidget);
      expect(find.textContaining('Sisa Rp 300.000 dari Rp 15.000.000 · 98%'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('rap-search')), 'akomodasi');
      await tester.pump();
      expect(find.byKey(const Key('rap-option-501')), findsNothing);
      await tester.enterText(find.byKey(const Key('rap-search')), 'solar');
      await tester.pump();
      await tester.tap(find.byKey(const Key('rap-option-501')));
      await tester.pumpAndSettle();
      expect(find.text('A.1 — Solar alat berat'), findsOneWidget);
      // 30 × 15.000 = 450.000 > sisa 300.000
      expect(find.byKey(const Key('line-rap-over')), findsOneWidget);
      expect(find.text('Melebihi RAP'), findsOneWidget);

      await tester.tap(find.byKey(const Key('line-save')));
      await tester.pumpAndSettle();
      expect(find.byType(LineEditorScreen), findsNothing);
      expect((saved?.rapItemId, saved?.computedTotal), (501, 450000));
    });

    testWidgets('offline without a cached list: the line can be saved, the field says why', (tester) async {
      await pumpScreen(
        tester,
        LineEditorScreen(
          line: const DraftLine(clientUuid: 'l-1', no: 1, description: 'Solar', categoryId: 1),
          masters: masters,
          projectId: 9,
        ),
      );
      expect(find.textContaining('Tidak ada koneksi'), findsOneWidget);
      expect(find.byKey(const Key('line-needs-rap-item')), findsOneWidget, reason: 'pre-D4 line: prompt to pick');
    });

    testWidgets('no project yet: picker disabled with "Pilih project pengajuan dulu."', (tester) async {
      await pumpScreen(
        tester,
        LineEditorScreen(
          line: const DraftLine(clientUuid: 'l-1', no: 1),
          masters: masters,
        ),
      );
      expect(find.text('Pilih project pengajuan dulu.'), findsOneWidget);
    });
  });

  group('D2 + D4 draft editor', () {
    testWidgets('project required, no cost-center choice; RAP item on each line card', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: masters, isNew: false),
        stubRap: false,
        overrides: [rapOverride],
      );
      expect(find.text('Pusat biaya'), findsNothing);
      expect(find.byType(SegmentedButton<bool>), findsNothing);
      expect(find.text('PRJ-09 — Jalan Tambang Blok B'), findsOneWidget);
      expect(find.text('Item RAP: A.2 — Akomodasi tim'), findsOneWidget);
      expect(find.byKey(const Key('draft-lines-need-rap')), findsNothing);
    });

    testWidgets('pre-D4 lines: banner + "Pilih item RAP"; submit lists the missing item', (tester) async {
      final d = seedDraft().copyWith(
        lines: [for (final l in seedDraft().lines) l.no == 3 ? l.copyWith(rapItemId: null) : l],
      );
      await pumpScreen(tester, DraftEditorScreen(initial: d, masters: masters, isNew: false));
      expect(find.byKey(const Key('draft-lines-need-rap')), findsOneWidget);
      expect(find.text('1 baris belum memilih item RAP — lengkapi sebelum diajukan.'), findsOneWidget);
      expect(find.byKey(const Key('line-3-needs-rap')), findsOneWidget);
      await tester.tap(
        find.descendant(of: find.byKey(const Key('submit-draft')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Baris 3: Item RAP wajib dipilih.'), findsOneWidget);
      expect(find.byKey(const Key('submit-confirm')), findsNothing);
    });

    testWidgets('pre-D2 draft with a cost center: asks for a project', (tester) async {
      final d = seedDraft().copyWith(projectId: null, costCenterId: 7);
      await pumpScreen(tester, DraftEditorScreen(initial: d, masters: masters, isNew: false));
      expect(find.byKey(const Key('draft-cost-center-legacy')), findsOneWidget);
      await tester.tap(
        find.descendant(of: find.byKey(const Key('submit-draft')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Project wajib dipilih.'), findsWidgets);
    });

    testWidgets('changing the project clears the RAP items after a confirmation', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: seedDraft(), masters: masters, isNew: false),
        stubRap: false,
        overrides: [rapOverride],
      );
      await tester.tap(find.byKey(const Key('draft-project')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('PRJ-10 — Workshop'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Item RAP pada 3 baris'), findsOneWidget);
      await tester.tap(find.byKey(const Key('project-change-confirm')));
      await tester.pumpAndSettle();
      expect(find.text('PRJ-10 — Workshop'), findsOneWidget);
      expect(find.byKey(const Key('draft-lines-need-rap')), findsOneWidget);
      expect(find.byKey(const Key('line-1-needs-rap')), findsOneWidget);
    });
  });

  group('D4 request detail', () {
    testWidgets('RAP item per line, "Melebihi RAP" on the flagged line + header; cost center row only when set', (
      tester,
    ) async {
      final j = detailJson(status: 'approved', allowed: const []);
      final lines = [for (final l in j['lines'] as List) Map<String, dynamic>.of(l as Map<String, dynamic>)];
      lines[0]['rapItem'] = {'id': 501, 'code': 'A.1', 'name': 'Solar alat berat'};
      lines[1]['rapItem'] = {'id': 502, 'code': 'A.2', 'name': 'Akomodasi tim'};
      final json = {
        ...j,
        'project': {'id': 9, 'code': 'PRJ-09', 'name': 'Jalan Tambang Blok B'},
        'costCenter': null,
        'lines': lines,
        'flags': [
          {
            'id': 77,
            'kind': rapOverBudgetFlag,
            'kindLabel': 'Melebihi RAP',
            'level': 'warning',
            'status': 'open',
            'lineNo': 1,
            'message': 'Total baris melebihi sisa RAP A.1',
          },
        ],
      };
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        overrides: [requestDetailProvider(42).overrideWith((ref) async => detailFromJson(json))],
      );
      expect(find.text('Item RAP: A.1 — Solar alat berat'), findsOneWidget);
      expect(find.text('Item RAP: A.2 — Akomodasi tim'), findsOneWidget);
      expect(find.byKey(const Key('line-1-rap-over')), findsOneWidget);
      expect(find.byKey(const Key('line-2-rap-over')), findsNothing);
      // DRMS 13/10 Persetujuan #11: no summary in the header — the chip is on the line.
      expect(find.byKey(const Key('detail-rap-over')), findsNothing);
      expect(find.byKey(const Key('detail-cost-center')), findsNothing);
      expect(tester.widget<Text>(find.byKey(const Key('detail-project'))).data, 'PRJ-09 Jalan Tambang Blok B');
    });
  });
}
