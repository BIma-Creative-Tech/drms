import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../../shared/widgets/reason_dialog.dart';
import '../../clients/client_form.dart';
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
    // clients: the web's own Klien page (`/client-form`: detail + Kontak PIC), not the generic form
    final clients = widget.collection == 'clients';
    final form = clients ? null : ref.watch(recordFormProvider((widget.collection, null))).value;
    final clientNew = clients ? ref.watch(clientFormProvider(null)).value : null;
    return Scaffold(
      appBar: AppBar(title: Text(value.value?.label ?? t.recordsTitle)),
      floatingActionButton:
          (form != null && form.canCreate && form.supported) ||
              (clientNew != null && clientNew.canEdit && clientNew.companies.isNotEmpty)
          ? FloatingActionButton.extended(
              key: const Key('records-new'),
              onPressed: () async {
                final id = await context.push<String>(clients ? '/clients/new' : '/data/${widget.collection}/new');
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
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(t.recordsCount(page.totalDocs), style: theme.textTheme.bodySmall),
                      ),
                      if (items.isEmpty)
                        Padding(
                          padding: const EdgeInsets.all(32),
                          child: Text(
                            _q.isEmpty ? t.recordsEmpty : t.recordsEmptySearch,
                            key: const Key('records-empty'),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      for (final r in items)
                        Card(
                          key: Key('record-${r.id}'),
                          margin: const EdgeInsets.only(bottom: 8),
                          clipBehavior: Clip.antiAlias,
                          child: InkWell(
                            onTap: () => context.push('/data/${widget.collection}/${r.id}'),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(r.title, style: theme.textTheme.titleSmall),
                                  for (final c in cols)
                                    if ((r.cells[c.key] ?? '').isNotEmpty && r.cells[c.key] != r.title)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 2),
                                        child: Text.rich(
                                          TextSpan(
                                            children: [
                                              TextSpan(
                                                text: '${c.label}: ',
                                                style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                                              ),
                                              TextSpan(text: r.cells[c.key]),
                                            ],
                                          ),
                                          style: theme.textTheme.bodySmall,
                                        ),
                                      ),
                                ],
                              ),
                            ),
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
                            style: theme.textTheme.bodySmall,
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
          showSnack(context, t.recordDeleted);
          context.pop();
        }
      } else if (c.action == 'nonaktifkan') {
        final ok = await showDialog<bool>(
          context: context,
          builder: (d) => AlertDialog(
            title: Text(t.recordDeactivateTitle),
            content: Text([c.blockedReason ?? '', ...c.usage].where((x) => x.isNotEmpty).join('\n')),
            actions: [
              TextButton(onPressed: () => Navigator.pop(d, false), child: Text(t.cancel)),
              FilledButton(
                key: const Key('record-deactivate-ok'),
                onPressed: () => Navigator.pop(d, true),
                child: Text(t.recordDeactivate),
              ),
            ],
          ),
        );
        if (ok != true || !context.mounted) return;
        final form = await api.form(collection, id: id);
        String? reason;
        if (form.reasonOnDeactivate || form.reasonOnUpdate) {
          if (!context.mounted) return;
          reason = await showReasonDialog(
            context,
            title: t.recordDeactivateTitle,
            description: t.cashReasonHelp,
            confirm: t.recordDeactivate,
            keyPrefix: 'record-deactivate',
          );
          if (reason == null) return;
        }
        await api.update(collection, id, {'active': false}, reason: reason, idempotencyKey: const Uuid().v4());
        ref.invalidate(recordDetailProvider((collection, id)));
        ref.invalidate(recordPageProvider);
        if (context.mounted) showSnack(context, t.recordDeactivated);
      } else {
        showSnack(context, c.blockedReason ?? t.recordNoRight);
      }
    } on Object catch (e) {
      if (context.mounted) showSnack(context, errorText(e));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final value = ref.watch(recordDetailProvider((collection, id)));
    final clients = collection == 'clients';
    final form = clients ? null : ref.watch(recordFormProvider((collection, id))).value;
    final client = clients ? ref.watch(clientFormProvider(int.tryParse(id))).value : null;
    return Scaffold(
      appBar: AppBar(
        title: Text(value.value?.title ?? t.recordsTitle),
        actions: [
          if ((form != null && form.canUpdate && form.supported) || (client != null && client.canEdit))
            IconButton(
              key: const Key('record-edit'),
              tooltip: t.recordEdit,
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => context.push(clients ? '/clients/$id' : '/data/$collection/$id/edit'),
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
            padding: const EdgeInsets.all(16),
            children: [
              Text(d.label, style: theme.textTheme.labelMedium),
              Text(d.title, style: theme.textTheme.titleLarge),
              const SizedBox(height: 12),
              for (final f in d.fields)
                Padding(
                  key: Key('record-field-${f.key}'),
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        f.label,
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                      Text(f.value == null || f.value!.isEmpty ? '—' : f.value!, style: theme.textTheme.bodyMedium),
                    ],
                  ),
                ),
              const SizedBox(height: 8),
              Text(t.recordsReadOnly, style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}
