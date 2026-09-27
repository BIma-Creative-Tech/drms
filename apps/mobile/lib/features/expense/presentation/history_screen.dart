import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../domain/expense_request.dart';

/// Same action labels as the web "Riwayat" tab (`apps/web/src/admin/views/RiwayatView.tsx`).
const historyActionLabels = <String, String>{
  'create': 'dibuat',
  'update': 'diubah',
  'status_change': 'status',
  'void': 'void',
  'sign': 'tanda tangan',
  'acknowledge': 'disetujui Direktur (Diketahui)',
  'approve': 'disetujui',
  'reject': 'ditolak',
  'verify': 'diverifikasi',
  'number_issued': 'nomor terbit',
  'flag_raised': 'flag muncul',
  'flag_reviewed': 'flag diperiksa',
  'export': 'PDF/ekspor',
  'print': 'cetak',
  'view_sensitive': 'dilihat (sensitif)',
  'delete_attempt': 'percobaan hapus',
  'acknowledge_delegated': 'Diketahui dilimpahkan',
  'access_denied': 'aksi ditolak (hak akses)',
  'approval_skipped': 'posisi dilewati (tidak berlaku — pemohon)',
};

const historyDocLabels = <String, String>{
  'expense_request': 'Pengajuan',
  'receipt': 'Nota',
  'transfer': 'Transfer',
  'settlement': 'LPJ',
  'cash_entry': 'Kas',
};

/// Web `show()`: null → "—", strings as-is, everything else as JSON, cut at 160 characters.
String historyValue(Object? v) {
  if (v == null) return '—';
  final s = v is String ? v : jsonEncode(v);
  return s.length > 160 ? '${s.substring(0, 157)}…' : s;
}

/// "Lama → Baru" column of the web view: status change when present, else old → new value.
String historyChange(HistoryEntry e) => (e.statusFrom != null || e.statusTo != null)
    ? '${e.statusFrom ?? '—'} → ${e.statusTo ?? '—'}'
    : '${historyValue(e.oldValue)} → ${historyValue(e.newValue)}';

String historyActor(HistoryEntry e) =>
    e.userName ?? (e.source == 'job' ? 'sistem (job)' : (e.userId != null ? 'user#${e.userId}' : 'sistem'));

final requestHistoryProvider = FutureProvider.autoDispose.family<List<HistoryEntry>, int>(
  (ref, id) => ref.watch(expenseApiProvider).history(id),
);

/// "Riwayat" (US-35): who, when (server time, company zone), what (field / line, old → new, status),
/// why (reason) and from where (web / apk + version + device). Newest first. Online only.
class HistoryScreen extends ConsumerWidget {
  const HistoryScreen({super.key, required this.id});
  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final zone = ref.watch(currentProfileProvider)?.timezone;
    return Scaffold(
      appBar: AppBar(title: Text(t.historyTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(requestHistoryProvider(id).future),
        child: AsyncBody(
          value: ref.watch(requestHistoryProvider(id)),
          onRetry: () => ref.invalidate(requestHistoryProvider(id)),
          data: (rows) => rows.isEmpty
              ? ListView(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(32),
                      child: Center(child: Text(t.historyEmpty)),
                    ),
                  ],
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                  itemCount: rows.length,
                  itemBuilder: (_, i) => _HistoryCard(entry: rows[rows.length - 1 - i], zone: zone),
                ),
        ),
      ),
    );
  }
}

class _HistoryCard extends StatelessWidget {
  const _HistoryCard({required this.entry, this.zone});
  final HistoryEntry entry;
  final String? zone;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final e = entry;
    final doc = historyDocLabels[e.docType] ?? e.docType;
    final field = e.field == null ? null : '${e.field}${e.lineNo != null ? ' (baris ${e.lineNo})' : ''}';
    final source = [
      e.source ?? '—',
      if (e.appVersion != null) e.appVersion!,
      if (e.deviceId != null) 'perangkat ${e.deviceId!.length > 8 ? '${e.deviceId!.substring(0, 8)}…' : e.deviceId}',
    ].join(' · ');
    Widget kv(String k, String v) => Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 96, child: Text(k, style: theme.textTheme.bodySmall)),
          Expanded(child: Text(v, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    historyActionLabels[e.action] ?? e.action,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                Chip(
                  label: Text(e.docNo != null && e.docType != 'expense_request' ? '$doc ${e.docNo}' : doc),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            Text(
              '${formatServerDateTime(e.serverTime, zone: zone)} · ${historyActor(e)}',
              style: theme.textTheme.bodySmall,
            ),
            if (field != null) kv(t.historyField, field),
            if (e.statusFrom != null || e.statusTo != null || e.oldValue != null || e.newValue != null)
              kv(t.historyChange, historyChange(e)),
            if (e.reason != null) kv(t.historyReason, e.reason!),
            kv(t.historySource, source),
          ],
        ),
      ),
    );
  }
}
