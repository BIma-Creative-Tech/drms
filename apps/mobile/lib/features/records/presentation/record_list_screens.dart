import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
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
    return Scaffold(
      appBar: AppBar(title: Text(value.value?.label ?? t.recordsTitle)),
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final value = ref.watch(recordDetailProvider((collection, id)));
    return Scaffold(
      appBar: AppBar(title: Text(value.value?.title ?? t.recordsTitle)),
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
