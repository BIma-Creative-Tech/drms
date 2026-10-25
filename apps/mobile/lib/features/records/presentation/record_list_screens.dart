import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/theme.dart';
import '../../../core/platform/report_files.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../../shared/widgets/photo_viewer.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_akun.dart';
import '../../../shared/widgets/reason_dialog.dart';
import '../../clients/client_form.dart';
import '../../clients/vendor_form.dart';
import '../data/records_providers.dart';
import '../domain/record_list.dart';

/// `/data/:collection`: one web collection list (user 2026-10-19, phase 3 — "Data transfer", "Nota", "Data LPJ", …)
/// as cards: the title, then the web list's columns as "Label: value" lines (long text wraps, never cut). Search and
/// load-more; tap = the read-only detail.
class RecordListScreen extends ConsumerStatefulWidget {
  const RecordListScreen({super.key, required this.collection});
  final String collection;

  @override
  ConsumerState<RecordListScreen> createState() => _RecordListScreenState();
}

class _RecordListScreenState extends ConsumerState<RecordListScreen> {
  String _q = '';
  final List<RecordRow> _more = [];
  int _page = 1;
  bool _loadingMore = false;

  RecordQuery get _query => RecordQuery(widget.collection, q: _q);

  Future<void> _loadMore(RecordPage first) async {
    if (_loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = await ref.read(recordsApiProvider).list(widget.collection, q: _q, page: _page + 1);
      if (!mounted) return;
      setState(() {
        _page = next.page;
        _more.addAll(next.items.where((r) => !first.items.any((x) => x.id == r.id)));
      });
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final value = ref.watch(recordPageProvider(_query));
    // phase 5a: "Tambah" when the caller may create here through the APK (server form; read-only lists 404 → none)
    // clients / vendors: the web's own Klien / Vendor pages (`/client-form`, `/vendor-form`), not the generic form
    final partner = _partnerRoute[widget.collection];
    final form = partner != null ? null : ref.watch(recordFormProvider((widget.collection, null))).value;
    final partnerNew = switch (widget.collection) {
      'clients' => ref.watch(clientFormProvider(null)).value?.let((c) => c.canEdit && c.companies.isNotEmpty),
      'vendors' => ref.watch(vendorFormProvider(null)).value?.let((v) => v.canEdit && v.companies.isNotEmpty),
      _ => null,
    };
    return Scaffold(
      appBar: AppBar(title: Text(value.value?.label ?? t.recordsTitle)),
      floatingActionButton: (form != null && form.canCreate && form.supported) || partnerNew == true
          ? FloatingActionButton.extended(
              key: const Key('records-new'),
              onPressed: () async {
                final id = await context.push<String>(
                  partner != null ? '$partner/new' : '/data/${widget.collection}/new',
                );
                if (id != null && context.mounted) await context.push('/data/${widget.collection}/$id');
              },
              icon: const Icon(Icons.add),
              label: Text(t.recordAdd),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: ListSearchField(
              key: const Key('records-search'),
              onChanged: (v) => setState(() {
                _q = v;
                _more.clear();
                _page = 1;
              }),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () {
                setState(() {
                  _more.clear();
                  _page = 1;
                });
                return ref.refresh(recordPageProvider(_query).future);
              },
              child: AsyncBody<RecordPage>(
                value: value,
                onRetry: () => ref.invalidate(recordPageProvider(_query)),
                data: (page) {
                  final items = [...page.items, ..._more];
                  final cols = page.columns;
                  return ListView(
                    key: const Key('records-list'),
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(4, 4, 4, 10),
                        child: Text(
                          t.recordsCount(page.totalDocs),
                          style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                        ),
                      ),
                      if (items.isEmpty)
                        PkEmptyState(
                          key: const Key('records-empty'),
                          icon: Icons.inventory_2_outlined,
                          message: _q.isEmpty ? t.recordsEmpty : t.recordsEmptySearch,
                        ),
                      for (final r in items)
                        PkCard(
                          key: Key('record-${r.id}'),
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
                          onTap: () => context.push('/data/${widget.collection}/${r.id}'),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const PkIconChip(icon: Icons.description_outlined, size: 38),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      r.title,
                                      style: theme.textTheme.titleSmall?.copyWith(
                                        fontWeight: FontWeight.w700,
                                        fontSize: 15,
                                      ),
                                    ),
                                    for (final c in cols)
                                      if ((r.cells[c.key] ?? '').isNotEmpty && r.cells[c.key] != r.title)
                                        Padding(
                                          padding: const EdgeInsets.only(top: 3),
                                          child: Text.rich(
                                            TextSpan(
                                              children: [
                                                TextSpan(
                                                  text: '${c.label}: ',
                                                  style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                                                ),
                                                TextSpan(
                                                  text: r.cells[c.key],
                                                  style: const TextStyle(fontWeight: FontWeight.w600),
                                                ),
                                              ],
                                            ),
                                            style: theme.textTheme.bodySmall,
                                          ),
                                        ),
                                  ],
                                ),
                              ),
                              Icon(Icons.chevron_right, size: 20, color: theme.colorScheme.onSurfaceVariant),
                            ],
                          ),
                        ),
                      if (_page < page.totalPages)
                        _loadingMore
                            ? const Padding(
                                padding: EdgeInsets.all(16),
                                child: Center(child: CircularProgressIndicator()),
                              )
                            : LoadMoreTrigger(
                                key: ValueKey('records-more-${items.length}'),
                                onLoad: () => _loadMore(page),
                              )
                      else if (items.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text(
                            t.recordsShownOf(items.length, page.totalDocs),
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                          ),
                        ),
                    ],
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// `/data/:collection/:id`: every readable field of the document (web edit view, read-only on the APK).
class RecordDetailScreen extends ConsumerWidget {
  const RecordDetailScreen({super.key, required this.collection, required this.id});
  final String collection;
  final String id;

  Future<void> _revoke(BuildContext context, WidgetRef ref) async {
    final t = AppLocalizations.of(context);
    final reason = await showReasonDialog(
      context,
      title: t.recordRevokeDevice,
      description: t.recordRevokeBody,
      confirm: t.recordRevoke,
      keyPrefix: 'record-revoke',
    );
    if (reason == null) return;
    try {
      await ref.read(recordsApiProvider).revokeDevice(id, reason, idempotencyKey: const Uuid().v4());
      ref.invalidate(recordDetailProvider((collection, id)));
      ref.invalidate(recordPageProvider);
      if (context.mounted) await showActionResult(context, message: t.recordRevoked, action: t.recordRevoke);
    } on Object catch (e) {
      if (context.mounted) await showActionError(context, e, action: t.recordRevoke);
    }
  }

  /// The web row action (D1610): delete-check first — "Hapus" (reason, soft delete), "Nonaktifkan" when the row is
  /// used (sets `active` false), or why nothing is possible.
  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final t = AppLocalizations.of(context);
    final api = ref.read(recordsApiProvider);
    try {
      final c = await api.deleteCheck(collection, id);
      if (!context.mounted) return;
      if (c.action == 'hapus' && c.canDelete) {
        final reason = await showReasonDialog(
          context,
          title: t.recordDeleteTitle,
          description: t.recordDeleteBody,
          confirm: t.recordDelete,
          keyPrefix: 'record-delete',
        );
        if (reason == null) return;
        await api.softDelete(collection, id, reason, idempotencyKey: const Uuid().v4());
        ref.invalidate(recordPageProvider);
        if (context.mounted) {
          await showActionResult(context, message: t.recordDeleted, action: t.recordDelete);
          if (context.mounted) context.pop();
        }
      } else if (c.action == 'nonaktifkan') {
        final usage = [c.blockedReason ?? '', ...c.usage].where((x) => x.isNotEmpty).join('\n');
        final form = await api.form(collection, id: id);
        if (!context.mounted) return;
        String? reason;
        // D2410: the reason dialog (when the collection asks one) IS the confirmation — never two popups
        if (form.reasonOnDeactivate || form.reasonOnUpdate) {
          reason = await showReasonDialog(
            context,
            title: t.recordDeactivateTitle,
            description: [usage, t.cashReasonHelp].where((x) => x.isNotEmpty).join('\n\n'),
            confirm: t.recordDeactivate,
            keyPrefix: 'record-deactivate',
          );
          if (reason == null) return;
        } else {
          final ok = await confirmAction(
            context,
            action: t.recordDeactivate,
            note: usage,
            confirmKey: const Key('record-deactivate-ok'),
          );
          if (!ok) return;
        }
        await api.update(collection, id, {'active': false}, reason: reason, idempotencyKey: const Uuid().v4());
        ref.invalidate(recordDetailProvider((collection, id)));
        ref.invalidate(recordPageProvider);
        if (context.mounted) await showActionResult(context, message: t.recordDeactivated, action: t.recordDeactivate);
      } else {
        showSnack(context, c.blockedReason ?? t.recordNoRight);
      }
    } on Object catch (e) {
      if (context.mounted) await showActionError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final value = ref.watch(recordDetailProvider((collection, id)));
    final partner = _partnerRoute[collection];
    final form = partner != null ? null : ref.watch(recordFormProvider((collection, id))).value;
    final partnerEdit = switch (collection) {
      'clients' => ref.watch(clientFormProvider(int.tryParse(id))).value?.canEdit,
      'vendors' => ref.watch(vendorFormProvider(int.tryParse(id))).value?.canEdit,
      _ => null,
    };
    return Scaffold(
      appBar: AppBar(
        title: Text(value.value?.title ?? t.recordsTitle),
        actions: [
          if ((form != null && form.canUpdate && form.supported) || partnerEdit == true)
            IconButton(
              key: const Key('record-edit'),
              tooltip: t.recordEdit,
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => context.push(partner != null ? '$partner/$id' : '/data/$collection/$id/edit'),
            ),
          // phase 6: "Cabut perangkat" (web Perangkat & sesi; the server checks who may revoke)
          if (collection == 'devices')
            IconButton(
              key: const Key('record-revoke'),
              tooltip: t.recordRevokeDevice,
              icon: const Icon(Icons.phonelink_erase),
              onPressed: () => _revoke(context, ref),
            ),
          if (form != null && form.canDelete)
            IconButton(
              key: const Key('record-delete'),
              tooltip: t.recordDelete,
              icon: const Icon(Icons.delete_outline),
              onPressed: () => _delete(context, ref),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(recordDetailProvider((collection, id)).future),
        child: AsyncBody<RecordDetail>(
          value: value,
          onRetry: () => ref.invalidate(recordDetailProvider((collection, id))),
          data: (d) => ListView(
            key: const Key('record-detail'),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            children: [
              PkCard(
                radius: PkRadius.lg,
                margin: const EdgeInsets.only(bottom: 12),
                child: Row(
                  children: [
                    const PkIconChip(icon: Icons.description_outlined, size: 44),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            d.label,
                            style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                          ),
                          Text(d.title, style: theme.textTheme.titleLarge),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (d.file != null) _FilePreview(file: d.file!),
              if (d.fields.isNotEmpty)
                PkCard(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final (i, f) in d.fields.indexed) ...[
                        if (i > 0) const PkRowDivider(indent: 0),
                        PkStackedField(
                          key: Key('record-field-${f.key}'),
                          label: f.label,
                          value: f.value == null || f.value!.isEmpty ? '—' : f.value!,
                        ),
                      ],
                    ],
                  ),
                ),
              Row(
                children: [
                  Icon(Icons.lock_outline, size: 16, color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      t.recordsReadOnly,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Collections the web edits on their own tabbed page (DRMS 16/10) → the APK route of that page.
const _partnerRoute = {'clients': '/clients', 'vendors': '/vendors'};

extension<T> on T {
  R let<R>(R Function(T) f) => f(this);
}

/// Phase 7 (Media): an image inline (tap = full screen), any other file → open / share through the report files
/// channel.
class _FilePreview extends ConsumerWidget {
  const _FilePreview({required this.file});
  final RecordFile file;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    if (file.isImage) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: switch (ref.watch(recordFileProvider(file.path))) {
          AsyncData(:final value) => GestureDetector(
            key: const Key('record-file-image'),
            onTap: () => showPhotoViewer(context, [
              ViewerPhoto(
                caption: file.filename ?? '',
                builder: (_) => Image.memory(value, fit: BoxFit.contain),
              ),
            ]),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(PkRadius.md),
              child: Image.memory(value, height: 220, fit: BoxFit.cover),
            ),
          ),
          AsyncError(:final error) => Text(errorText(error)),
          _ => const SizedBox(height: 220, child: Center(child: CircularProgressIndicator())),
        },
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: OutlinedButton.icon(
        key: const Key('record-file-open'),
        icon: const Icon(Icons.attach_file),
        label: Text(file.filename ?? t.recordFile),
        onPressed: () async {
          final files = ref.read(reportFilesProvider);
          try {
            final bytes = await ref.read(recordFileProvider(file.path).future);
            final ext = (file.filename ?? '').contains('.') ? file.filename!.split('.').last : 'bin';
            final name = reportFileName('filename="${file.filename ?? 'file'}"', fallback: 'file', format: ext);
            if (await files.save(name, bytes) && !await files.open(name) && context.mounted) {
              await files.share(name);
            }
          } on Object catch (e) {
            if (context.mounted) showSnack(context, errorText(e));
          }
        },
      ),
    );
  }
}
