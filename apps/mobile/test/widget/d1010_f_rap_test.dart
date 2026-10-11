import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/draft_validation.dart';
import 'package:proyekkas/features/expense/presentation/draft_editor_screen.dart';
import 'package:proyekkas/features/expense/presentation/line_editor_screen.dart';
import 'package:proyekkas/features/projects/application/projects_providers.dart';
import 'package:proyekkas/features/projects/data/projects_api.dart';

import 'package:proyekkas/features/masters/domain/master_item.dart';

import '../support/seed.dart';
import '../support/widget_harness.dart';

/// DRMS 10/10 D4, owner 2026-10-11 "RAP wajib untuk semua proyek yang punya RAB": a project with a RAB but no RAP
/// cannot send requests — the requester sees "Project belum punya RAP — hubungi PM" (same text as the server and the
/// web); a project without RAB and without RAP does not ask for a RAP item.
const missing = 'Project belum punya RAP — hubungi PM';

final masters = <String, List<MasterItem>>{
  MasterTypes.projects: [const MasterItem(9, 'TRD-09 — Trading semen')],
  MasterTypes.categories: [
    const MasterItem(1, 'BBM'),
    const MasterItem(2, 'Penginapan'),
    const MasterItem(3, 'Konsumsi'),
  ],
  MasterTypes.uoms: [const MasterItem(3, 'liter'), const MasterItem(4, 'kamar')],
};

final rapMissingOverride = projectRapProvider.overrideWith((ref, id) async => const RapLoad([], required: true));
final rapOptionalOverride = projectRapProvider.overrideWith((ref, id) async => const RapLoad([]));

DraftRequest withoutRapItems() =>
    seedDraft().copyWith(lines: [for (final l in seedDraft().lines) l.copyWith(rapItemId: null)]);

Future<void> tapSubmit(WidgetTester tester) async {
  await tester.tap(
    find.descendant(of: find.byKey(const Key('submit-draft')), matching: find.bySubtype<FilledButton>()),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('D4 RAP required for every project with a RAB', () {
    test('the message is the server / web text', () {
      expect(rapMissingMessage, missing);
      // web + server constant (apps/web/src/domain/rap/rules.ts) — wording must stay identical
      final web = File('../web/src/domain/rap/rules.ts').readAsStringSync();
      expect(web, contains("export const RAP_MISSING_MESSAGE = '$missing'"));
    });

    test('validateForSubmit: missing → one project issue, no per-line RAP issue; optional → no RAP issue', () {
      final d = withoutRapItems();
      final strict = validateForSubmit(d);
      expect(strict.where((i) => i.field == 'rapItemId'), hasLength(3));
      final m = validateForSubmit(d, rap: RapCheck.missing);
      expect(m.where((i) => i.field == 'projectId').map((i) => i.message), [missing]);
      expect(m.where((i) => i.field == 'rapItemId'), isEmpty);
      final o = validateForSubmit(d, rap: RapCheck.optional);
      expect(o.where((i) => i.field == 'rapItemId' || i.field == 'projectId'), isEmpty);
    });

    test('project list / detail and RAP read carry rapRequired / rapMissing', () {
      final p = projectFromJson({
        'id': 3,
        'code': 'TRD-01',
        'name': 'Trading semen',
        'kind': 'trading',
        'rapRequired': true,
        'rapMissing': true,
      });
      expect((p.rapRequired, p.rapMissing), (true, true));
      final old = projectFromJson({'id': 3, 'code': 'TRD-01', 'name': 'Trading semen'});
      expect((old.rapRequired, old.rapMissing), (false, false), reason: 'older server: unknown = not required');
      expect(const RapLoad([], required: true).missing, isTrue);
      expect(const RapLoad([]).missing, isFalse);
    });

    testWidgets('draft editor: block card with the message; submit stops with it under the project', (tester) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: withoutRapItems(), masters: masters, isNew: false),
        stubRap: false,
        overrides: [rapMissingOverride],
      );
      expect(find.byKey(const Key('draft-rap-missing')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('draft-rap-missing')), matching: find.text(missing)),
        findsOneWidget,
      );
      // nothing to pick → no per-line "Pilih item RAP" nagging
      expect(find.byKey(const Key('draft-lines-need-rap')), findsNothing);
      expect(find.byKey(const Key('line-1-needs-rap')), findsNothing);
      await tapSubmit(tester);
      expect(find.byKey(const Key('submit-confirm')), findsNothing);
      expect(find.text(missing), findsNWidgets(2), reason: 'card + error under the project picker');
      expect(find.textContaining('Item RAP wajib dipilih.'), findsNothing);
    });

    testWidgets('project without RAB and without RAP: no card, lines need no RAP item, no RAP issue at submit', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        DraftEditorScreen(initial: withoutRapItems(), masters: masters, isNew: false),
        stubRap: false,
        overrides: [rapOptionalOverride],
      );
      expect(find.byKey(const Key('draft-rap-missing')), findsNothing);
      expect(find.byKey(const Key('draft-lines-need-rap')), findsNothing);
      await tapSubmit(tester);
      expect(find.textContaining('Item RAP wajib dipilih.'), findsNothing);
      expect(find.text(missing), findsNothing);
    });

    testWidgets('line editor: the RAP field says the same', (tester) async {
      await pumpScreen(
        tester,
        LineEditorScreen(
          line: const DraftLine(clientUuid: 'l-1', no: 1, uomId: 3, categoryId: 1),
          masters: masters,
          projectId: 9,
        ),
        stubRap: false,
        overrides: [rapMissingOverride],
      );
      expect(find.text(missing), findsOneWidget);
    });
  });
}
