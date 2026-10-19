import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/dates.dart';
import '../../../core/platform/report_files.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../data/reports_providers.dart';
import '../domain/report.dart';

/// User 2026-10-19 (APK ↔ web parity, phase 4): the web "Laporan" index (`/admin/laporan`) — the reports of the
/// caller's roles with what they contain and their export formats.
class ReportListScreen extends ConsumerWidget {
  const ReportListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.reportsTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(reportIndexProvider.future),
        child: AsyncBody<List<ReportSummary>>(
          value: ref.watch(reportIndexProvider),
          onRetry: () => ref.invalidate(reportIndexProvider),
          data: (items) => items.isEmpty
              ? ListView(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(32),
                      child: Text(t.reportsNone, key: const Key('reports-none'), textAlign: TextAlign.center),
                    ),
                  ],
                )
              : ListView.separated(
                  key: const Key('reports-list'),
                  padding: const EdgeInsets.only(bottom: 24),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final r = items[i];
                    return ListTile(
                      key: Key('report-${r.code}'),
                      leading: const Icon(Icons.assessment_outlined),
                      title: Text(r.title),
                      subtitle: Text(
                        [
                          if (r.description.isNotEmpty) r.description,
                          t.reportsExportLine(r.formats.map((f) => reportFormatLabels[f] ?? f).join(' · ')),
                        ].join('\n'),
                        style: theme.textTheme.bodySmall,
                      ),
                      isThreeLine: r.description.isNotEmpty,
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/reports/${r.code}'),
                    );
                  },
                ),
        ),
      ),
    );
  }
}

/// `/reports/:code`: the web report page — filter form ("Terapkan" / "Reset"), letterhead, exports (CSV / Excel / PDF;
/// XLSX above 10 000 and PDF above 500 rows disabled like the web), the main table and the extra tables as cards
/// (long text wraps), totals, notes and the keyset pages ("Halaman pertama" / "Berikutnya"). A document number opens
/// its APK screen where there is one.
class ReportScreen extends ConsumerStatefulWidget {
  const ReportScreen({super.key, required this.code});
  final String code;

  @override
  ConsumerState<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends ConsumerState<ReportScreen> {
  late ReportQuery _q = ReportQuery(widget.code);
  String? _exporting;

  Future<void> _editFilters(ReportPage page) async {
    final next = await showModalBottomSheet<Map<String, List<String>>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => _FilterSheet(fields: page.filters),
    );
    if (next != null && mounted) setState(() => _q = ReportQuery(widget.code, params: next));
  }

  Future<void> _export(ReportPage page, String format) async {
    final t = AppLocalizations.of(context);
    final files = ref.read(reportFilesProvider);
    setState(() => _exporting = format);
    try {
      final out = await ref.read(reportsApiProvider).export(_q, format);
      final name = reportFileName(out.disposition, fallback: '${page.code}-${toYmd(DateTime.now())}', format: format);
      if (!await files.save(name, out.bytes)) {
        if (mounted) showSnack(context, t.reportsSaveFailed);
        return;
      }
      if (!mounted) return;
      setState(() => _exporting = null); // the spinner stops while the file sheet is open
      await _fileActions(name);
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _exporting = null);
    }
  }

  /// "Buka" · "Bagikan" · "Simpan ke Unduhan" of a downloaded file.
  Future<void> _fileActions(String name) async {
    final t = AppLocalizations.of(context);
    final files = ref.read(reportFilesProvider);
    final messenger = ScaffoldMessenger.of(context);
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
              child: Text(t.reportsDownloaded(name), key: const Key('report-file-name')),
            ),
            ListTile(
              key: const Key('report-file-open'),
              leading: const Icon(Icons.open_in_new),
              title: Text(t.reportsOpen),
              onTap: () async {
                Navigator.pop(c);
                if (!await files.open(name)) messenger.showSnackBar(SnackBar(content: Text(t.reportsNoApp)));
              },
            ),
            ListTile(
              key: const Key('report-file-share'),
              leading: const Icon(Icons.share_outlined),
              title: Text(t.reportsShare),
              onTap: () async {
                Navigator.pop(c);
                if (!await files.share(name)) messenger.showSnackBar(SnackBar(content: Text(t.reportsNoApp)));
              },
            ),
            ListTile(
              key: const Key('report-file-download'),
              leading: const Icon(Icons.download_outlined),
              title: Text(t.reportsSaveDownloads),
              onTap: () async {
                Navigator.pop(c);
                final ok = await files.download(name);
                messenger.showSnackBar(
                  SnackBar(content: Text(ok ? t.reportsSavedDownloads : t.reportsSaveDownloadsFailed)),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  void _openLink(String? href) {
    if (href == null) return;
    final route = apkRouteForReportLink(href);
    if (route != null) context.push(route);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(reportPageProvider(_q));
    final page = value.value;
    return Scaffold(
      appBar: AppBar(
        title: Text(page?.title ?? t.reportsTitle),
        actions: [
          if (page != null && page.filters.isNotEmpty)
            IconButton(
              key: const Key('report-filters'),
              tooltip: t.reportsFilter,
              icon: Badge(
                isLabelVisible: _q.params.values.any((v) => v.any((x) => x.isNotEmpty)),
                child: const Icon(Icons.filter_list),
              ),
              onPressed: () => _editFilters(page),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(reportPageProvider(_q).future),
        child: AsyncBody<ReportPage>(value: value, onRetry: () => ref.invalidate(reportPageProvider(_q)), data: _body),
      ),
    );
  }

  Widget _body(ReportPage p) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final active = [
      for (final f in p.filters)
        if (f.values.isNotEmpty)
          '${f.label}: ${f.values.map((v) => f.options.where((o) => o.$1 == v).firstOrNull?.$2 ?? v).join(', ')}',
    ];
    return ListView(
      key: const Key('report-page'),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
      children: [
        if (p.description.isNotEmpty) Text(p.description, style: theme.textTheme.bodySmall),
        const SizedBox(height: 4),
        Text(
          p.letterheadPts.isEmpty ? p.letterhead : '${p.letterhead} · PT: ${p.letterheadPts.join(', ')}',
          key: const Key('report-letterhead'),
          style: theme.textTheme.labelMedium,
        ),
        if (active.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(active.join(' · '), key: const Key('report-active-filters'), style: theme.textTheme.bodySmall),
          ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            for (final f in p.formats)
              OutlinedButton.icon(
                key: Key('report-export-$f'),
                onPressed: _exporting != null || p.tooBig(f) ? null : () => _export(p, f),
                icon: _exporting == f
                    ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.download, size: 18),
                label: Text(p.tooBig(f) ? t.reportsTooBig(reportFormatLabels[f] ?? f) : (reportFormatLabels[f] ?? f)),
              ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            [t.reportsRowCount(p.rowCount), if (p.team) t.reportsTeamScope].join(' · '),
            key: const Key('report-row-count'),
            style: theme.textTheme.bodySmall,
          ),
        ),
        const SizedBox(height: 12),
        _TableView(table: p.main, onLink: _openLink),
        if (_q.cursor != null || p.nextCursor != null)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              if (_q.cursor != null)
                TextButton(
                  key: const Key('report-first-page'),
                  onPressed: () => setState(() => _q = ReportQuery(widget.code, params: _q.params)),
                  child: Text(t.reportsFirstPage),
                )
              else
                const SizedBox.shrink(),
              if (p.nextCursor != null)
                TextButton(
                  key: const Key('report-next-page'),
                  onPressed: () =>
                      setState(() => _q = ReportQuery(widget.code, params: _q.params, cursor: p.nextCursor)),
                  child: Text(t.reportsNextPage),
                ),
            ],
          ),
        for (final x in p.extra) ...[const SizedBox(height: 16), _TableView(table: x, onLink: _openLink)],
        if (p.notes.isNotEmpty) ...[
          const SizedBox(height: 16),
          for (final n in p.notes)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text('• $n', style: theme.textTheme.bodySmall),
            ),
        ],
      ],
    );
  }
}

/// One report table as cards: the row's title column, then "Label: value" per other column; totals in a last card.
class _TableView extends StatelessWidget {
  const _TableView({required this.table, required this.onLink});
  final ReportTableData table;
  final void Function(String? href) onLink;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final tc = table.titleColumn;
    Widget lines(Map<String, Object?> cells, {Map<String, String>? links}) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final c in table.columns)
          if (c != tc && reportCellText(cells[c.key], c.type).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '${c.label}: ',
                      style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                    ),
                    TextSpan(
                      text: reportCellText(cells[c.key], c.type),
                      style: TextStyle(
                        fontWeight: c.numeric ? FontWeight.w600 : null,
                        color: links?[c.key] != null && apkRouteForReportLink(links![c.key]!) != null
                            ? theme.colorScheme.primary
                            : null,
                      ),
                    ),
                  ],
                ),
                style: theme.textTheme.bodySmall,
              ),
            ),
      ],
    );
    return Column(
      key: Key('report-table-${table.key}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(table.title, style: theme.textTheme.titleMedium),
        const SizedBox(height: 6),
        if (table.rows.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text(table.empty ?? t.reportsEmpty, style: theme.textTheme.bodyMedium),
          ),
        for (final (i, r) in table.rows.indexed)
          Builder(
            builder: (context) {
              final links = i < table.rowLinks.length ? table.rowLinks[i] : null;
              final href = links?['_row'] ?? (tc == null ? null : links?[tc.key]) ?? links?.values.firstOrNull;
              final route = href == null ? null : apkRouteForReportLink(href);
              return Card(
                key: Key('report-${table.key}-row-$i'),
                margin: const EdgeInsets.only(bottom: 8),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: route == null ? null : () => onLink(href),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (tc != null)
                          Text(
                            reportCellText(r[tc.key], tc.type).isEmpty ? '—' : reportCellText(r[tc.key], tc.type),
                            style: theme.textTheme.titleSmall?.copyWith(
                              color: route != null ? theme.colorScheme.primary : null,
                            ),
                          ),
                        lines(r, links: links),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        if (table.totals != null && table.rows.isNotEmpty)
          Card(
            key: Key('report-${table.key}-totals'),
            margin: const EdgeInsets.only(bottom: 8),
            color: theme.colorScheme.secondaryContainer,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t.reportsTotal, style: theme.textTheme.titleSmall),
                  lines(table.totals!),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// The web FilterForm: one input per field (date, month, select "Semua", multiselect chips, text); "Terapkan" pops the
/// values, "Reset" pops an empty set.
class _FilterSheet extends StatefulWidget {
  const _FilterSheet({required this.fields});
  final List<ReportFilterField> fields;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late final Map<String, List<String>> _v = {
    for (final f in widget.fields) f.name: [...f.values],
  };
  late final Map<String, TextEditingController> _text = {
    for (final f in widget.fields)
      if (f.kind == 'text') f.name: TextEditingController(text: f.value),
  };

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  String _one(String name) => _v[name]?.firstOrNull ?? '';

  Future<void> _pickDate(ReportFilterField f) async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_one(f.name)) ?? now,
      firstDate: DateTime(now.year - 10),
      lastDate: DateTime(now.year + 1),
      helpText: f.label,
    );
    if (d != null && mounted) setState(() => _v[f.name] = [toYmd(d)]);
  }

  Future<void> _pickMonth(ReportFilterField f) async {
    final t = AppLocalizations.of(context);
    final now = DateTime.now();
    final months = [
      for (var i = 0; i < 36; i++)
        '${DateTime(now.year, now.month - i).year}-${DateTime(now.year, now.month - i).month.toString().padLeft(2, '0')}',
    ];
    final v = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(t.reportsAll), onTap: () => Navigator.pop(c, '')),
            for (final m in months)
              ListTile(
                key: Key('report-month-$m'),
                title: Text(_monthLabel(m)),
                trailing: m == _one(f.name) ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(c, m),
              ),
          ],
        ),
      ),
    );
    if (v != null && mounted) setState(() => _v[f.name] = v.isEmpty ? [] : [v]);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(t.reportsFilter, style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final f in widget.fields)
                  Padding(
                    key: Key('report-filter-${f.name}'),
                    padding: const EdgeInsets.only(bottom: 12),
                    child: switch (f.kind) {
                      'date' || 'month' => InkWell(
                        onTap: () => f.kind == 'date' ? _pickDate(f) : _pickMonth(f),
                        child: InputDecorator(
                          decoration: InputDecoration(
                            labelText: f.label,
                            suffixIcon: _one(f.name).isEmpty
                                ? const Icon(Icons.event)
                                : IconButton(
                                    icon: const Icon(Icons.clear),
                                    onPressed: () => setState(() => _v[f.name] = []),
                                  ),
                          ),
                          child: Text(
                            _one(f.name).isEmpty
                                ? t.reportsAll
                                : f.kind == 'date'
                                ? formatDateOnly(_one(f.name))
                                : _monthLabel(_one(f.name)),
                          ),
                        ),
                      ),
                      'select' => DropdownButtonFormField<String>(
                        initialValue: f.options.any((o) => o.$1 == _one(f.name)) ? _one(f.name) : '',
                        isExpanded: true,
                        decoration: InputDecoration(labelText: f.label),
                        items: [
                          DropdownMenuItem(value: '', child: Text(t.reportsAll)),
                          for (final (v, l) in f.options) DropdownMenuItem(value: v, child: Text(l)),
                        ],
                        onChanged: (v) => setState(() => _v[f.name] = v == null || v.isEmpty ? [] : [v]),
                      ),
                      'multiselect' => Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(f.label, style: theme.textTheme.labelLarge),
                          const SizedBox(height: 4),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              for (final (v, l) in f.options)
                                FilterChip(
                                  label: Text(l),
                                  selected: _v[f.name]?.contains(v) ?? false,
                                  onSelected: (on) => setState(() {
                                    final list = _v[f.name] ??= [];
                                    on ? list.add(v) : list.remove(v);
                                  }),
                                ),
                            ],
                          ),
                        ],
                      ),
                      _ => TextField(
                        controller: _text[f.name],
                        maxLength: 60,
                        decoration: InputDecoration(labelText: f.label),
                      ),
                    },
                  ),
              ],
            ),
          ),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: const Key('report-filter-reset'),
                  onPressed: () => Navigator.pop(context, <String, List<String>>{}),
                  child: Text(t.reportsReset),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  key: const Key('report-filter-apply'),
                  onPressed: () => Navigator.pop(context, {
                    ..._v,
                    for (final e in _text.entries) e.key: [e.value.text.trim()],
                  }),
                  child: Text(t.reportsApply),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

const _months = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

String _monthLabel(String ym) {
  final m = int.tryParse(ym.length >= 7 ? ym.substring(5, 7) : '');
  return m == null || m < 1 || m > 12 ? ym : '${_months[m - 1]} ${ym.substring(0, 4)}';
}
