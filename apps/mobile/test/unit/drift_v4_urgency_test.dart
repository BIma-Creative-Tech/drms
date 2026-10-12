import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';

import '../support/schema_v2.dart';

/// Owner decision 2026-10-09: "Tingkat urgensi" on expense drafts — drift schema v4 adds
/// `local_drafts.urgency_level_id` (nullable). A v3 phone (mobile-v0.3.x) keeps every draft.
const sub = 'kc-sub-v4';

void main() {
  test('v3 → v4: drafts survive with urgency NULL; the new value round-trips into the sync payload', () async {
    const ts = 1790000000;
    final db = oldPhoneDb(3, (raw) {
      raw.execute(
        'INSERT INTO local_drafts (client_uuid, user_sub, company_id, type, title, project_id, requester_ids_json, sync_state, '
        "created_at, updated_at) VALUES ('d-4', '$sub', 1, 'reimburse', 'Makan tukang', 70, '[12]', 'local', $ts, $ts)",
      );
    });
    addTearDown(db.close);
    expect(db.schemaVersion, 9); // v5 (FR1 field reports) + v6 (P3 RAP caches) + v7 (D3 receipt amount) + v8 (D4 RAP item) + v9 (ADR 0023 outbox site) on top; the v4 column is what this test checks
    final repo = DraftRepository(db);
    final before = await repo.load(sub, 'd-4');
    expect(before!.title, 'Makan tukang');
    expect(before.companyId, 1);
    expect(before.urgencyLevelId, isNull);
    await repo.save(sub, before.copyWith(urgencyLevelId: 3));
    final after = await repo.load(sub, 'd-4');
    expect(after!.urgencyLevelId, 3);
    expect(draftToSyncPayload(after)['urgency_level_id'], 3);
    expect(draftToCreateBody(after)['urgencyLevelId'], 3);
    expect(draftToSyncPayload(after).containsKey('period_from'), isFalse);
  });
}
