import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../app/providers.dart';
import '../../app/theme.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../shared/widgets/action_feedback.dart';
import '../../shared/widgets/async_body.dart';
import '../../shared/widgets/list_search.dart';
import '../../shared/widgets/reason_dialog.dart';

// MC2-4 "Akses PT (matriks)" on the APK (user 2026-10-19, phase 6): `GET /company-memberships/matrix` and the atomic
// `POST /company-memberships/batch` — the rules of the web client (role-matrix.ts): a cell is editable for a group admin
// or an Admin of that PT; the Owner (pk-principal) only for a group admin (a PT admin sees it locked); no role left =
// inactive; one employee per account and PT; coverage warnings never block.

Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];
int _int(Object? v) => v is num ? v.toInt() : 0;

const _principal = 'pk-principal';

class MxCell {
  MxCell({
    this.id,
    required this.user,
    required this.company,
    required this.roles,
    this.employee,
    required this.active,
  });
  final int? id;
  final int user;
  final int company;
  List<String> roles;
  int? employee;
  bool active;

  MxCell copy() => MxCell(id: id, user: user, company: company, roles: [...roles], employee: employee, active: active);

  factory MxCell.fromJson(Map<String, dynamic> j) => MxCell(
    id: _int(j['id']),
    user: _int(j['user']),
    company: _int(j['company']),
    roles: [for (final r in _list(j['roles'])) '$r'],
    employee: j['employee'] is num ? _int(j['employee']) : null,
    active: j['active'] != false,
  );
}

class MatrixQuery {
  const MatrixQuery({this.q = '', this.inactive = false, this.page = 1});
  final String q;
  final bool inactive;
  final int page;

  @override
  bool operator ==(Object other) =>
      other is MatrixQuery && other.q == q && other.inactive == inactive && other.page == page;

  @override
  int get hashCode => Object.hash(q, inactive, page);
}

final accessMatrixProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, MatrixQuery>(
  (ref, m) => ref
      .watch(apiClientProvider)
      .run(
        (d) => d.get<dynamic>(
          '/company-memberships/matrix',
          queryParameters: {if (m.q.isNotEmpty) 'q': m.q, if (m.inactive) 'nonaktif': '1', 'hal': m.page},
        ),
        (data) => data as Map<String, dynamic>,
      ),
);

class AccessMatrixScreen extends ConsumerStatefulWidget {
  const AccessMatrixScreen({super.key});

  @override
  ConsumerState<AccessMatrixScreen> createState() => _AccessMatrixScreenState();
}

class _AccessMatrixScreenState extends ConsumerState<AccessMatrixScreen> {
  MatrixQuery _m = const MatrixQuery();

  /// Pending edits by "user:company".
  final Map<String, MxCell> _drafts = {};
  Map<String, String> _cellErrors = const {};
  bool _busy = false;

  String _k(int user, int company) => '$user:$company';

  void _query(MatrixQuery m) => setState(() => _m = m);

  bool _changed(MxCell d, MxCell? s) {
    String r(List<String> x) => ([...x]..sort()).join(',');
    if (s == null) return d.roles.isNotEmpty;
    return r(d.roles) != r(s.roles) || d.employee != s.employee || d.active != s.active;
  }

  Future<void> _save(Map<String, MxCell> stored, List<Map<String, dynamic>> companies, List<String> roleOrder) async {
    final t = AppLocalizations.of(context);
    final ops = [
      for (final e in (_drafts.entries.toList()..sort((a, b) => a.key.compareTo(b.key))))
        if (_changed(e.value, stored[e.key])) e,
    ];
    if (ops.isEmpty) return;
    // one employee per account and PT (the unique index would refuse the whole batch)
    final all = {...stored, ..._drafts};
    final seen = <String, int>{};
    for (final c in all.values) {
      if (c.employee == null || !c.active) continue;
      final k = '${c.company}:${c.employee}';
      if (seen[k] != null && seen[k] != c.user) {
        showSnack(context, t.matrixDuplicateEmployee);
        return;
      }
      seen[k] = c.user;
    }
    final reason = await showReasonDialog(
      context,
      title: t.matrixSaveTitle(ops.length),
      description: t.matrixSaveBody,
      confirm: t.save,
      keyPrefix: 'matrix-reason',
    );
    if (reason == null || !mounted) return;
    List<String> sorted(List<String> r) => [
      for (final x in roleOrder)
        if (r.contains(x)) x,
    ];
    final items = [
      for (final e in ops)
        {
          'user': e.value.user,
          'company': e.value.company,
          'roles': sorted(e.value.roles),
          'employee': e.value.employee,
          'active': stored[e.key] == null ? true : e.value.active && e.value.roles.isNotEmpty,
        },
    ];
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .run(
            (d) => d.post<dynamic>(
              '/company-memberships/batch',
              data: {'reason': reason, 'items': items},
              options: ApiClient.allCompanies(Options(headers: {'Idempotency-Key': const Uuid().v4()})),
            ),
            (_) {},
          );
      _drafts.clear();
      _cellErrors = const {};
      ref.invalidate(accessMatrixProvider);
      if (mounted) await showActionResult(context, message: t.matrixSaved(ops.length), action: t.save);
    } on ProblemException catch (e) {
      // errors[].path = items.<i> → that op's cell (all-or-nothing: nothing was saved)
      final cells = <String, String>{};
      for (final x in e.errors) {
        final i = int.tryParse(x.path.replaceFirst('items.', '').split('.').first);
        if (i != null && i < ops.length) cells[ops[i].key] = x.message;
      }
      if (mounted) {
        setState(() => _cellErrors = cells);
        await showActionError(context, e, action: t.save);
      }
    } on Object catch (e) {
      if (mounted) await showActionError(context, e, action: t.save);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(accessMatrixProvider(_m));
    final j = value.value;
    final stored = <String, MxCell>{
      for (final c in _list(j?['cells'])) _k(_int(_map(c)['user']), _int(_map(c)['company'])): MxCell.fromJson(_map(c)),
    };
    final pending = _drafts.entries.where((e) => _changed(e.value, stored[e.key])).length;
    final roleOrder = [for (final r in _list(j?['roles'])) '${_map(r)['value']}'];
    return Scaffold(
      appBar: AppBar(
        title: Text(t.matrixTitle),
        actions: [
          IconButton(
            key: const Key('matrix-new-user'),
            tooltip: t.onbNewTitle,
            icon: const Icon(Icons.person_add_alt),
            onPressed: () async {
              await context.push('/users/new');
              ref.invalidate(accessMatrixProvider);
            },
          ),
        ],
      ),
      bottomNavigationBar: pending == 0 || j == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    TextButton(onPressed: () => setState(_drafts.clear), child: Text(t.cancel)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        key: const Key('matrix-save'),
                        onPressed: _busy
                            ? null
                            : () => _save(stored, [for (final c in _list(j['companies'])) _map(c)], roleOrder),
                        icon: const Icon(Icons.save_outlined),
                        label: Text(t.matrixSaveN(pending)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: ListSearchField(
              key: const Key('matrix-search'),
              onChanged: (v) => _query(MatrixQuery(q: v, inactive: _m.inactive)),
            ),
          ),
          SwitchListTile(
            key: const Key('matrix-inactive'),
            dense: true,
            title: Text(t.matrixShowInactive),
            value: _m.inactive,
            onChanged: (v) => _query(MatrixQuery(q: _m.q, inactive: v)),
          ),
          Expanded(
            child: AsyncBody<Map<String, dynamic>>(
              value: value,
              onRetry: () => ref.invalidate(accessMatrixProvider(_m)),
              data: (j) => _body(context, j, stored),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, Map<String, dynamic> j, Map<String, MxCell> stored) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final viewer = _map(j['viewer']);
    final groupAdmin = viewer['groupAdmin'] == true;
    final adminOf = {for (final c in _list(viewer['adminOf'])) _int(c)};
    final companies = [for (final c in _list(j['companies'])) _map(c)];
    final roles = [
      for (final r in _list(j['roles']))
        (value: '${_map(r)['value']}', label: '${_map(r)['short'] ?? _map(r)['label']}'),
    ];
    final users = _map(j['users']);
    final employees = [for (final e in _list(j['employees'])) _map(e)];
    final all = {...stored, ..._drafts};
    final page = _int(users['page']);
    final totalPages = _int(users['totalPages']);
    return ListView(
      key: const Key('matrix-list'),
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
      children: [
        for (final w in _list(j['warnings']))
          Card(
            color: theme.colorScheme.errorContainer,
            margin: const EdgeInsets.only(bottom: 6),
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Text('$w', style: theme.textTheme.bodySmall),
            ),
          ),
        for (final u in _list(users['items']).map(_map))
          Card(
            key: Key('matrix-user-${u['id']}'),
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${u['name']}${u['active'] == false ? ' · ${t.rapInactive}' : ''}',
                          style: theme.textTheme.titleSmall,
                        ),
                      ),
                      IconButton(
                        key: Key('matrix-open-${u['id']}'),
                        tooltip: t.recordEdit,
                        icon: const Icon(Icons.manage_accounts_outlined),
                        onPressed: () async {
                          await context.push('/users/${u['id']}');
                          ref.invalidate(accessMatrixProvider);
                        },
                      ),
                    ],
                  ),
                  Text('${u['email']}', style: theme.textTheme.bodySmall),
                  for (final c in companies)
                    _cellRow(context, u, c, all, stored, roles, employees, groupAdmin, adminOf),
                ],
              ),
            ),
          ),
        if (totalPages > 1)
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                onPressed: page > 1 ? () => _query(MatrixQuery(q: _m.q, inactive: _m.inactive, page: page - 1)) : null,
                icon: const Icon(Icons.chevron_left),
              ),
              Text('$page / $totalPages'),
              IconButton(
                onPressed: page < totalPages
                    ? () => _query(MatrixQuery(q: _m.q, inactive: _m.inactive, page: page + 1))
                    : null,
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
      ],
    );
  }

  Widget _cellRow(
    BuildContext context,
    Map<String, dynamic> u,
    Map<String, dynamic> c,
    Map<String, MxCell> all,
    Map<String, MxCell> stored,
    List<({String value, String label})> roles,
    List<Map<String, dynamic>> employees,
    bool groupAdmin,
    Set<int> adminOf,
  ) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final user = _int(u['id']);
    final company = _int(c['id']);
    final key = _k(user, company);
    final editable = groupAdmin || adminOf.contains(company);
    final cell = all[key] ?? MxCell(user: user, company: company, roles: const [], active: false);
    final held = stored[key]?.roles ?? const <String>[];
    MxCell draft() =>
        _drafts[key] ??= (stored[key]?.copy() ?? MxCell(user: user, company: company, roles: [], active: false));
    final taken = {
      for (final x in all.values)
        if (x.company == company && x.user != user && x.employee != null) x.employee,
    };
    final choices = [
      for (final e in employees)
        if (_int(e['company']) == company &&
            (_int(e['id']) == cell.employee || (e['active'] != false && !taken.contains(_int(e['id'])))))
          e,
    ];
    final err = _cellErrors[key];
    return Padding(
      key: Key('matrix-cell-$key'),
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${c['shortCode']}${cell.roles.isEmpty && stored[key] != null ? ' · ${t.rapInactive}' : ''}',
            style: theme.textTheme.labelLarge,
          ),
          Wrap(
            spacing: 4,
            runSpacing: 4,
            children: [
              for (final r in roles)
                // ADR 0026: the Owner only for a group admin; a PT admin sees it where held, locked
                if (r.value != _principal || groupAdmin || held.contains(r.value))
                  FilterChip(
                    key: Key('matrix-role-$key-${r.value}'),
                    label: Text(r.label),
                    selected: cell.roles.contains(r.value),
                    visualDensity: VisualDensity.compact,
                    onSelected: !editable || (r.value == _principal && !groupAdmin)
                        ? null
                        : (on) => setState(() {
                            final d = draft();
                            on
                                ? d.roles = [...d.roles, r.value]
                                : d.roles = d.roles.where((x) => x != r.value).toList();
                            d.active = d.roles.isNotEmpty;
                          }),
                  ),
            ],
          ),
          if (editable && cell.roles.isNotEmpty)
            DropdownButton<int?>(
              key: Key('matrix-employee-$key'),
              isExpanded: true,
              value: choices.any((e) => _int(e['id']) == cell.employee) ? cell.employee : null,
              hint: Text(t.matrixNoEmployee),
              items: [
                DropdownMenuItem<int?>(child: Text(t.matrixNoEmployee)),
                for (final e in choices)
                  DropdownMenuItem<int?>(value: _int(e['id']), child: Text('${e['code']} ${e['name']}')),
              ],
              onChanged: (v) => setState(() => draft().employee = v),
            ),
          if (err != null) Text(err, style: TextStyle(color: context.pk.badText)),
        ],
      ),
    );
  }
}
