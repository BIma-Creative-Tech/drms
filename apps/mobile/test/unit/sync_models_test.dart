import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

QueuedItem item(int i, {int payloadBytes = 10}) => QueuedItem(
  clientUuid: 'op-$i',
  type: SyncItemType.expenseDraftUpsert,
  payload: {'pad': 'x' * payloadBytes},
  deviceTime: '2026-09-21T12:00:00+08:00',
  elapsedMs: i,
);

void main() {
  test('batches hold ≤ 50 items and keep order', () {
    final plan = planBatches([for (var i = 0; i < 120; i++) item(i)]);
    expect(plan.batches.map((b) => b.length), [50, 50, 20]);
    expect(plan.batches.expand((b) => b).map((q) => q.clientUuid).first, 'op-0');
    expect(plan.batches.last.last.clientUuid, 'op-119');
  });

  test('batches stay under 256 KB', () {
    final plan = planBatches([for (var i = 0; i < 10; i++) item(i, payloadBytes: 60 * 1024)]);
    expect(plan.batches.every((b) => b.length <= 4), isTrue);
    expect(plan.batches.expand((b) => b), hasLength(10));
  });

  test('an item above the limit is reported, never sent', () {
    final plan = planBatches([item(0), item(1, payloadBytes: 300 * 1024), item(2)]);
    expect(plan.oversized.single.clientUuid, 'op-1');
    expect(plan.batches.single.map((q) => q.clientUuid), ['op-0', 'op-2']);
  });

  test('item JSON follows the contract', () {
    final j = item(3).toJson();
    expect(j['schema_version'], 1);
    expect(j['offline'], isTrue);
    expect(
      j.keys,
      containsAll(['client_uuid', 'type', 'device_time', 'elapsed_ms', 'base_rev', 'depends_on', 'payload']),
    );
  });

  test('back-off grows 5 s → capped at 10 min with ±20 % jitter', () {
    final r = Random(1);
    final d1 = backoffFor(1, random: r);
    expect(d1.inMilliseconds, inInclusiveRange(4000, 6000));
    final d3 = backoffFor(3, random: r);
    expect(d3.inMilliseconds, inInclusiveRange(16000, 24000));
    for (final a in [8, 12, 20]) {
      expect(backoffFor(a, random: r).inMilliseconds, inInclusiveRange(480000, 720000));
    }
  });

  test('batch response parsing and rejection text', () {
    final res = BatchResponse.fromJson({
      'batch_id': 'b',
      'server_time': '2026-09-21T04:05:11Z',
      'results': [
        {
          'client_uuid': 'a',
          'status': 'applied',
          'server_id': 'er-1',
          'rev': 1,
          'flags': ['OFFLINE'],
        },
        {
          'client_uuid': 'b',
          'status': 'rejected',
          'errors': [
            {'code': 'NOT_EDITABLE'},
          ],
        },
        {'client_uuid': 'c', 'status': 'weird'},
      ],
    });
    expect(res.results.map((r) => r.status), [SyncItemStatus.applied, SyncItemStatus.rejected, SyncItemStatus.unknown]);
    expect(rejectionMessage(res.results[1].errors), contains('tidak bisa diubah'));
    expect(rejectionMessage(const [SyncError(code: 'X', message: 'Pesan server')]), 'Pesan server');
  });
}
