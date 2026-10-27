import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/platform/report_files.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_akun.dart';
import '../../auth/application/auth_controller.dart';
import '../../home/domain/route_access.dart';
import '../../home/domain/web_route_map.dart';
import '../data/reports_providers.dart';
import '../domain/report.dart';

/// User 2026-10-19 (APK ↔ web parity, phase 4): the web "Laporan" index (`/admin/laporan`) — the reports of the
/// caller's roles with what they contain and their export formats.
class ReportListScreen extends ConsumerWidget {
  const ReportListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.reportsTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(reportIndexProvider.future),
        child: AsyncBody<({List<ReportSummary> items, bool auditLog})>(
          value: ref.watch(reportIndexProvider),
          onRetry: () => ref.invalidate(reportIndexProvider),
          data: (index) => _list(context, index.items, index.auditLog),
        ),
      ),
    );
  }

  Widget _list(BuildContext context, List<ReportSummary> items, bool auditLog) {
    final t = AppLocalizations.of(context);
    // phase 7: the web index links the global Audit Log for its roles
    final audit = auditLog
        ? PkMenuGroup(
            children: [
              PkMenuRow(
                key: const Key('report-audit-log'),
                icon: Icons.history_edu_outlined,
                tone: PkTone.neutral,
                title: t.reportsAuditLog,
                onTap: () => context.push('/reports/audit-log'),
              ),
            ],
          )
        : null;
    if (items.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          PkEmptyState(key: const Key('reports-none'), icon: PkIcons.report, message: t.reportsNone),
          ?audit,
        ],
      );
    }
    return ListView(
      key: const Key('reports-list'),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        PkMenuGroup(
          children: [
            for (final r in items)
              PkMenuRow(
                key: Key('report-${r.code}'),
                icon: PkIcons.report,
                title: r.title,
                subtitle: [
                  if (r.description.isNotEmpty) r.description,
                  t.reportsExportLine(r.formats.map((f) => reportFormatLabels[f] ?? f).join(' · ')),
                ].join('\n'),
                onTap: () => context.push('/reports/${r.code}'),
              ),
          ],
        ),
        ?audit,
      ],
    );
  }
}

/// `/reports/:code`: the web report page — filter form ("Terapkan" / "Reset"), letterhead, exports (CSV / Excel / PDF;
/// XLSX above 10 000 and PDF above 500 rows disabled like the web), the main table and the extra tables as cards
/// (long text wraps), totals, notes and the keyset pages ("Halaman pertama" / "Berikutnya"). A document number opens
/// its APK screen where there is one (D2510: a report → report link opens with its filters, [initialParams]).
class ReportScreen extends ConsumerStatefulWidget {
  const ReportScreen({super.key, required this.code, this.initialParams = const {}});
  final String code;

  /// Filters from the route query (`/reports/buku-kas?dari=…&akun=…`).
  final Map<String, List<String>> initialParams;

  @override
  ConsumerState<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends ConsumerState<ReportScreen> {
  late ReportQuery _q = ReportQuery(widget.code, params: widget.initialParams);
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
              child: Text(
                t.reportsDownloaded(name),
                key: const Key('report-file-name'),
                style: Theme.of(c).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            ListTile(
              key: const Key('report-file-open'),
              leading: const PkIconChip(icon: Icons.open_in_new),
              title: Text(t.reportsOpen),
              onTap: () async {
                Navigator.pop(c);
                if (!await files.open(name)) messenger.showSnackBar(SnackBar(content: Text(t.reportsNoApp)));
              },
            ),
            ListTile(
              key: const Key('report-file-share'),
              leading: const PkIconChip(icon: Icons.share_outlined),
              title: Text(t.reportsShare),
              onTap: () async {
                Navigator.pop(c);
                if (!await files.share(name)) messenger.showSnackBar(SnackBar(content: Text(t.reportsNoApp)));
              },
            ),
            ListTile(
              key: const Key('report-file-download'),
              leading: const PkIconChip(icon: Icons.download_outlined),
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

  /// D2510: the APK screen of a report link when there is one AND the user may open it (else the cell stays text).
  String? _route(String? href) {
    if (href == null) return null;
    final route = apkRouteForReportLink(href);
    return route != null && canOpenApkRoute(route, ref.read(currentProfileProvider)) ? route : null;
  }

  void _openLink(String route) {
    if (isShellRoute(route)) {
      context.go(route);
    } else {
      context.push(route);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(reportPageProvider(_q));
    final page = value.value;
    ref.watch(currentProfileProvider); // the links follow the roles ([_route])
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
    final muted = theme.colorScheme.onSurfaceVariant;
    final active = [
      for (final f in p.filters)
        if (f.values.isNotEmpty)
          '${f.label}: ${f.values.map((v) => f.options.where((o) => o.$1 == v).firstOrNull?.$2 ?? v).join(', ')}',
    ];
    return ListView(
      key: const Key('report-page'),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        // Header: letterhead, what the report contains, active filters, row count and the exports.
        PkCard(
          radius: PkRadius.lg,
          margin: const EdgeInsets.only(bottom: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const PkIconChip(icon: PkIcons.report, size: 40),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          p.letterheadPts.isEmpty
                              ? p.letterhead
                              : '${p.letterhead} · PT: ${p.letterheadPts.join(', ')}',
                          key: const Key('report-letterhead'),
                          style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        if (p.description.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(p.description, style: theme.textTheme.bodySmall?.copyWith(color: muted)),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              if (active.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 1, right: 6),
                        child: Icon(Icons.filter_list, size: 16, color: theme.colorScheme.primary),
                      ),
                      Expanded(
                        child: Text(
                          active.join(' · '),
                          key: const Key('report-active-filters'),
                          style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                ),
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(
                  [t.reportsRowCount(p.rowCount), if (p.team) t.reportsTeamScope].join(' · '),
                  key: const Key('report-row-count'),
                  style: theme.textTheme.bodySmall?.copyWith(color: muted),
                ),
              ),
              if (p.formats.isNotEmpty) ...[
                const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: PkRowDivider(indent: 0)),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    for (final f in p.formats)
                      OutlinedButton.icon(
                        key: Key('report-export-$f'),
                        style: OutlinedButton.styleFrom(visualDensity: VisualDensity.compact),
                        onPressed: _exporting != null || p.tooBig(f) ? null : () => _export(p, f),
                        icon: _exporting == f
                            ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.download, size: 18),
                        label: Text(
                          p.tooBig(f) ? t.reportsTooBig(reportFormatLabels[f] ?? f) : (reportFormatLabels[f] ?? f),
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
        _TableView(table: p.main, route: _route, onOpen: _openLink),
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
        for (final x in p.extra) ...[
          const SizedBox(height: 16),
          _TableView(table: x, route: _route, onOpen: _openLink),
        ],
        if (p.notes.isNotEmpty)
          PkCard(
            margin: const EdgeInsets.only(top: 8),
            color: context.pk.infoBg,
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final n in p.notes)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text('• $n', style: theme.textTheme.bodySmall?.copyWith(color: context.pk.infoOn)),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// One report table as cards: the row's title column, then "Label  value" per other column; totals in a last card.
class _TableView extends StatelessWidget {
  const _TableView({required this.table, required this.route, required this.onOpen});
  final ReportTableData table;

  /// The APK route of a link the user may open, else null.
  final String? Function(String? href) route;
  final void Function(String route) onOpen;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final pk = context.pk;
    final tc = table.titleColumn;
    Widget lines(Map<String, Object?> cells, {Map<String, String>? links, Color? labelColor, Color? valueColor}) =>
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final c in table.columns)
              if (c != tc && reportCellText(cells[c.key], c.type).isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        flex: 2,
                        child: Text(
                          c.label,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: labelColor ?? theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        flex: 3,
                        child: Text(
                          reportCellText(cells[c.key], c.type),
                          textAlign: c.numeric ? TextAlign.end : TextAlign.start,
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontWeight: c.numeric ? FontWeight.w700 : FontWeight.w500,
                            color: route(links?[c.key]) != null ? theme.colorScheme.primary : valueColor,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
          ],
        );
    return Column(
      key: Key('report-table-${table.key}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(2, 0, 2, 10),
          child: Text(table.title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        ),
        if (table.rows.isEmpty)
          PkCard(
            margin: const EdgeInsets.only(bottom: 10),
            child: Text(
              table.empty ?? t.reportsEmpty,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        for (final (i, r) in table.rows.indexed)
          Builder(
            builder: (context) {
              final links = i < table.rowLinks.length ? table.rowLinks[i] : null;
              // D2510: the FIRST link that opens an APK screen — the row, then the title cell, then any cell (an audit-log
              // row's only link is its "dokumen" cell).
              final target = [
                links?['_row'],
                if (tc != null) links?[tc.key],
                ...?links?.values,
              ].map(route).nonNulls.firstOrNull;
              return PkCard(
                key: Key('report-${table.key}-row-$i'),
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                onTap: target == null ? null : () => onOpen(target),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (tc != null)
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              reportCellText(r[tc.key], tc.type).isEmpty ? '—' : reportCellText(r[tc.key], tc.type),
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w700,
                                color: target != null ? theme.colorScheme.primary : null,
                              ),
                            ),
                          ),
                          if (target != null) Icon(Icons.chevron_right, size: 20, color: theme.colorScheme.outline),
                        ],
                      ),
                    lines(r, links: links),
                    if (tc == null && target != null)
                      Align(
                        alignment: Alignment.centerRight,
                        child: Icon(Icons.chevron_right, size: 20, color: theme.colorScheme.outline),
                      ),
                  ],
                ),
              );
            },
          ),
        if (table.totals != null && table.rows.isNotEmpty)
          PkCard(
            key: Key('report-${table.key}-totals'),
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            color: pk.infoBg,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  t.reportsTotal,
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, color: pk.infoOn),
                ),
                lines(table.totals!, labelColor: pk.infoOn, valueColor: pk.infoOn),
              ],
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
          Text(t.reportsFilter, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
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
