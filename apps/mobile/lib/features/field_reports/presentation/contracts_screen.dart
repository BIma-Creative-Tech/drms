import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../companies/presentation/company_chip.dart';

// User 2026-10-19 (APK ↔ web parity, phase 5b): the web "Unit & kontrak" page (/admin/unit-kontrak) —
// `GET /field/contracts`: projects of kind kontrak unit with today's timesheet status, this month's totals and their
// unit contracts, plus the "Unit alat berat" list. No rates on the phone.

Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];
int _int(Object? v) => v is num ? v.toInt() : 0;
double _dbl(Object? v) => v is num ? v.toDouble() : 0;

class ContractRow {
  const ContractRow(this.j);
  final Map<String, dynamic> j;
  int get projectId => _int(j['projectId']);
  String get title => [j['code'], j['name']].whereType<String>().join(' ');
  int? get companyId => j['companyId'] is num ? (j['companyId'] as num).toInt() : null;
  int get active => _int(j['unitsActiveToday']);
  int get filled => _int(j['filledToday']);
  bool get canCreate => j['canCreateTimesheet'] == true;
  Map<String, dynamic> get totals => _map(j['monthTotals']);
  List<Map<String, dynamic>> get contracts => [for (final c in _list(j['contracts'])) _map(c)];
}

class ContractsPage {
  const ContractsPage(this.j);
  final Map<String, dynamic> j;
  String get today => '${j['today'] ?? ''}';
  List<ContractRow> get items => [for (final i in _list(j['items'])) ContractRow(_map(i))];
  List<Map<String, dynamic>> get units => [for (final u in _list(j['units'])) _map(u)];
  int get page => _int(j['page']);
  int get totalPages => _int(j['totalPages']);
}

final fieldContractsProvider = FutureProvider.autoDispose.family<ContractsPage, String>(
  (ref, q) => ref
      .watch(apiClientProvider)
      .run(
        (d) => d.get<dynamic>('/field/contracts', queryParameters: {if (q.isNotEmpty) 'q': q, 'per': 100}),
        (data) => ContractsPage(data as Map<String, dynamic>),
      ),
);

class ContractsScreen extends ConsumerStatefulWidget {
  const ContractsScreen({super.key});

  @override
  ConsumerState<ContractsScreen> createState() => _ContractsScreenState();
}

class _ContractsScreenState extends ConsumerState<ContractsScreen> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.contractsTitle)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: ListSearchField(key: const Key('contracts-search'), onChanged: (v) => setState(() => _q = v)),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => ref.refresh(fieldContractsProvider(_q).future),
              child: AsyncBody<ContractsPage>(
                value: ref.watch(fieldContractsProvider(_q)),
                onRetry: () => ref.invalidate(fieldContractsProvider(_q)),
                data: (p) => ListView(
                  key: const Key('contracts-list'),
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                  children: [
                    if (p.items.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(t.contractsEmpty, textAlign: TextAlign.center),
                      ),
                    for (final r in p.items)
                      Card(
                        key: Key('contract-project-${r.projectId}'),
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ExpansionTile(
                          title: Row(
                            children: [
                              CompanyChipLead(companyId: r.companyId),
                              Expanded(child: Text(r.title)),
                            ],
                          ),
                          subtitle: Text(
                            [
                              t.contractsToday(r.filled, r.active),
                              t.contractsMonth(
                                formatDecimal(_dbl(r.totals['work']), digits: 1),
                                _int(r.totals['missing']),
                              ),
                              if (_int(r.totals['gaps']) > 0) t.contractsGaps(_int(r.totals['gaps'])),
                            ].join('\n'),
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: r.filled < r.active ? context.pk.warnText : null,
                            ),
                          ),
                          children: [
                            for (final c in r.contracts)
                              ListTile(
                                dense: true,
                                leading: Icon(
                                  c['filledToday'] == true ? Icons.check_circle : Icons.radio_button_unchecked,
                                  color: c['filledToday'] == true ? context.pk.okText : theme.colorScheme.outline,
                                ),
                                title: Text('${c['unitLabel'] ?? ''}'),
                                subtitle: Text(
                                  [
                                    ?(c['unitType'] as String?),
                                    '${formatDateOnly('${c['startDate'] ?? ''}')} – ${c['endDate'] == null ? '…' : formatDateOnly('${c['endDate']}')}',
                                    if (c['active'] != true) t.rapInactive,
                                  ].join(' · '),
                                ),
                              ),
                            if (r.canCreate)
                              Padding(
                                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                                child: Align(
                                  alignment: Alignment.centerLeft,
                                  child: FilledButton.icon(
                                    key: Key('contract-timesheet-${r.projectId}'),
                                    onPressed: () => context.push('/field/timesheet/new?project=${r.projectId}'),
                                    icon: const Icon(Icons.timer_outlined),
                                    label: Text(t.contractsFillTimesheet),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    if (p.units.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(t.contractsUnits, style: theme.textTheme.titleMedium),
                      for (final u in p.units)
                        ListTile(
                          key: Key('unit-${u['id']}'),
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.precision_manufacturing_outlined),
                          title: Text('${u['label'] ?? ''}'),
                          subtitle: Text(
                            [
                              ?(u['type'] as String?),
                              ?(u['brandModel'] as String?),
                              ?(u['clientName'] as String?),
                              if (u['lastHourMeter'] is num)
                                'HM ${formatDecimal(u['lastHourMeter'] as num, digits: 1)}',
                            ].join(' · '),
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
