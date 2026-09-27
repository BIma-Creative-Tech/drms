import 'dart:convert';
import 'dart:math';

/// Item types of the sync contract (ADR 0010 "Sync contract", schema_version 1): drafts (F4a), own
/// attendance check-in/out (F4b), PM on-behalf attendance (E6, US-14) and progress reports (E4, US-10).
abstract final class SyncItemType {
  static const expenseDraftUpsert = 'expense_request.draft_upsert';
  static const expenseDraftDelete = 'expense_request.draft_delete';
  static const attendanceCheckIn = 'attendance.check_in';
  static const attendanceCheckOut = 'attendance.check_out';
  static const attendanceOnBehalf = 'attendance.on_behalf';
  static const progressReportUpsert = 'progress_report.draft_upsert';

  static bool isAttendance(String type) =>
      type == attendanceCheckIn || type == attendanceCheckOut || type == attendanceOnBehalf;

  static bool isProgress(String type) => type == progressReportUpsert;

  /// Short Indonesian label for the queue screen.
  static String label(String type) => switch (type) {
    attendanceCheckIn => 'Absen masuk',
    attendanceCheckOut => 'Absen pulang',
    attendanceOnBehalf => 'Absen oleh PM',
    progressReportUpsert => 'Laporan progress',
    expenseDraftDelete => 'Hapus draft',
    _ => 'Draft pengajuan',
  };
}

enum SyncItemStatus {
  applied,
  duplicate,
  rejected,
  conflict,
  deferred,
  unsupported,
  unknown;

  static SyncItemStatus fromCode(String? c) =>
      SyncItemStatus.values.firstWhere((s) => s.name == c, orElse: () => SyncItemStatus.unknown);
}

class SyncError {
  const SyncError({this.code, this.field, this.message});
  final String? code;
  final String? field;
  final String? message;
}

class SyncItemResult {
  const SyncItemResult({
    required this.clientUuid,
    required this.status,
    this.serverId,
    this.rev,
    this.receivedAt,
    this.flags = const [],
    this.errors = const [],
    this.serverCopy,
    this.serverReport,
  });

  final String clientUuid;
  final SyncItemStatus status;
  final String? serverId;
  final int? rev;
  final String? receivedAt;
  final List<String> flags;
  final List<SyncError> errors;
  final Map<String, dynamic>? serverCopy;

  /// E4: server version of a progress report (`server_report`, on conflict / NOT_EDITABLE / applied).
  final Map<String, dynamic>? serverReport;

  /// A `duplicate` replays the first result; a replayed rejection/conflict keeps that meaning.
  factory SyncItemResult.fromJson(Map<String, dynamic> j) => SyncItemResult(
    clientUuid: '${j['client_uuid']}',
    status: switch ((j['status'], j['original_status'])) {
      ('duplicate', 'rejected') => SyncItemStatus.rejected,
      ('duplicate', 'conflict') => SyncItemStatus.conflict,
      (final String s, _) => SyncItemStatus.fromCode(s),
      _ => SyncItemStatus.unknown,
    },
    serverId: j['server_id']?.toString(),
    rev: (j['rev'] as num?)?.toInt(),
    receivedAt: j['received_at'] as String?,
    flags: [for (final f in (j['flags'] as List<dynamic>? ?? const [])) '$f'],
    errors: [
      for (final e in (j['errors'] as List<dynamic>? ?? const []))
        if (e is Map<String, dynamic>)
          SyncError(code: e['code'] as String?, field: e['field'] as String?, message: e['message'] as String?),
    ],
    serverCopy: j['server_copy'] is Map<String, dynamic> ? j['server_copy'] as Map<String, dynamic> : null,
    serverReport: j['server_report'] is Map<String, dynamic> ? j['server_report'] as Map<String, dynamic> : null,
  );
}

class BatchResponse {
  const BatchResponse({required this.batchId, required this.serverTime, required this.results});
  final String batchId;
  final String serverTime;
  final List<SyncItemResult> results;

  factory BatchResponse.fromJson(Map<String, dynamic> j) => BatchResponse(
    batchId: '${j['batch_id']}',
    serverTime: '${j['server_time']}',
    results: [
      for (final r in (j['results'] as List<dynamic>? ?? const []))
        if (r is Map<String, dynamic>) SyncItemResult.fromJson(r),
    ],
  );
}

/// One queued item ready to be sent.
class QueuedItem {
  const QueuedItem({
    required this.clientUuid,
    required this.type,
    required this.payload,
    required this.deviceTime,
    required this.elapsedMs,
    this.bootId,
    this.offline = true,
    this.baseRev,
    this.dependsOn = const [],
  });

  final String clientUuid;
  final String type;
  final Map<String, dynamic> payload;
  final String deviceTime;
  final int elapsedMs;
  final String? bootId;
  final bool offline;
  final int? baseRev;
  final List<String> dependsOn;

  Map<String, dynamic> toJson() => {
    'client_uuid': clientUuid,
    'type': type,
    'schema_version': 1,
    'offline': offline,
    'device_time': deviceTime,
    'elapsed_ms': elapsedMs,
    'boot_id': ?bootId,
    'base_rev': baseRev,
    'depends_on': dependsOn,
    'payload': payload,
  };
}

class ClockInfo {
  const ClockInfo({
    required this.deviceTime,
    required this.elapsedMs,
    required this.bootId,
    this.lastServerTime,
    this.lastServerElapsedMs,
  });
  final String deviceTime;
  final int elapsedMs;
  final String bootId;
  final String? lastServerTime;
  final int? lastServerElapsedMs;

  Map<String, dynamic> toJson() => {
    'device_time': deviceTime,
    'elapsed_ms': elapsedMs,
    'boot_id': bootId,
    'last_server_time': lastServerTime,
    'last_server_elapsed_ms': lastServerElapsedMs,
  };
}

/// Contract limits (ADR 0010 decision 14): ≤ 50 items and ≤ 256 KB JSON per batch.
const maxBatchItems = 50;
const maxBatchBytes = 256 * 1024;

/// Splits items (already in queue order) into batches within the limits. The envelope overhead is
/// reserved so the encoded request stays below [maxBytes]. A single item larger than the limit is
/// returned alone in [oversized] (it can never be sent and is rejected locally).
({List<List<QueuedItem>> batches, List<QueuedItem> oversized}) planBatches(
  List<QueuedItem> items, {
  int maxItems = maxBatchItems,
  int maxBytes = maxBatchBytes,
  int envelopeReserve = 1024,
}) {
  final batches = <List<QueuedItem>>[];
  final oversized = <QueuedItem>[];
  var current = <QueuedItem>[];
  var size = envelopeReserve;
  for (final item in items) {
    final itemBytes = utf8.encode(jsonEncode(item.toJson())).length + 1;
    if (itemBytes + envelopeReserve > maxBytes) {
      oversized.add(item);
      continue;
    }
    if (current.length >= maxItems || size + itemBytes > maxBytes) {
      batches.add(current);
      current = <QueuedItem>[];
      size = envelopeReserve;
    }
    current.add(item);
    size += itemBytes;
  }
  if (current.isNotEmpty) batches.add(current);
  return (batches: batches, oversized: oversized);
}

/// Exponential back-off 5 s → 10 min with ±20 % jitter (ADR 0010 decision 12).
Duration backoffFor(int attempt, {Random? random}) {
  final a = attempt < 1 ? 1 : attempt;
  const base = 5;
  const cap = 600;
  final raw = a >= 8 ? cap : min(cap, base * (1 << (a - 1)));
  final r = random ?? Random();
  final jitter = 0.8 + r.nextDouble() * 0.4;
  return Duration(milliseconds: (raw * 1000 * jitter).round());
}

/// After this many attempts an item is shown as "Gagal dikirim" with a manual retry.
const maxSyncAttempts = 20;

/// Bahasa Indonesia text for rejection codes (ADR 0010 "Per-item rules").
/// For attendance and progress items the server's own (Indonesian) message is preferred: the draft
/// texts below speak about expense drafts.
String rejectionMessage(List<SyncError> errors, {String? type}) {
  if (errors.isEmpty) return 'Ditolak server.';
  final e = errors.first;
  if (type != null && (SyncItemType.isAttendance(type) || SyncItemType.isProgress(type))) {
    final m = e.message;
    if (m != null && m.isNotEmpty && e.code != 'MOCK_LOCATION') return m;
  }
  final known = switch (e.code) {
    'NOT_EDITABLE' => 'Draft sudah tidak bisa diubah (sudah diajukan atau bukan milik Anda).',
    'MEDIA_MISSING' => 'Foto (nota/selfie) belum diterima server.',
    'MOCK_LOCATION' => 'Lokasi palsu (mock location) terdeteksi. Absensi ditolak.',
    'VALIDATION' => null,
    'FORBIDDEN' => 'Anda tidak berhak mengubah draft ini.',
    'NOT_FOUND' => 'Draft tidak ditemukan di server.',
    'CLIENT_UUID_CONFLICT' => 'ID data bentrok dengan data lain. Buat draft baru.',
    'NOT_ASSIGNED' => 'Anda tidak ditugaskan di project/pusat biaya ini.',
    'FEATURE_DISABLED' => 'Sinkronisasi offline sedang dinonaktifkan. Kirim saat online.',
    'OUTSIDE_GEOFENCE' || 'NO_GEOFENCE' || 'ALREADY_CHECKED_IN' || 'NO_CHECK_IN' || 'ALREADY_CHECKED_OUT' => null,
    'WEIGHTS_INCOMPLETE' => 'Bobot tahapan project belum 100%. Minta Direktur/PM melengkapi tahapan.',
    'PROGRESS_DECREASED' => 'Progress tahapan tidak boleh turun dari nilai sebelumnya.',
    'PHOTO_LIMIT' => 'Maksimal 5 foto per laporan.',
    'MEDIA_IN_USE' => 'Foto sudah dipakai di laporan lain. Ambil foto baru.',
    _ => null,
  };
  return known ?? (e.message?.isNotEmpty == true ? e.message! : 'Ditolak server (${e.code ?? 'tanpa kode'}).');
}

/// Local media kind (`media_blobs.kind`) → `POST /api/v1/media/{kind}` path segment (openapi MediaKind).
String mediaUploadPath(String localKind) => switch (localKind) {
  'selfie' => 'selfies',
  'progress' => 'progress-photos',
  _ => 'receipts',
};
