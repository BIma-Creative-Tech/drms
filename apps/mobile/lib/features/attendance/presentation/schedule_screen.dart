import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../core/format/dates.dart';
import '../../../core/network/api_client.dart';
import '../../../core/platform/browser.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_lapangan.dart';
import '../../records/data/records_providers.dart';

// User 2026-10-19 (APK ↔ web parity, phase 6): the web "Jadwal & hari libur" (/admin/absensi/jadwal) —
// `GET /attendance/schedule?tahun=`; edits through the generic web form (`/data/work-schedules|holidays|cost-centers`),
// the PT default schedule (`PATCH /attendance/default-schedule`) and an employee's schedule (`PATCH /data/employees`).

Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];
int _int(Object? v) => v is num ? v.toInt() : 0;

const _dayShort = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

final attendanceScheduleProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, int?>(
  (ref, year) => ref
      .watch(apiClientProvider)
      .run(
        (d) => d.get<dynamic>('/attendance/schedule', queryParameters: {'tahun': ?year}),
        (data) => data as Map<String, dynamic>,
      ),
);

class AttendanceScheduleScreen extends ConsumerStatefulWidget {
  const AttendanceScheduleScreen({super.key});

  @override
  ConsumerState<AttendanceScheduleScreen> createState() => _AttendanceScheduleScreenState();
}

class _AttendanceScheduleScreenState extends ConsumerState<AttendanceScheduleScreen> {
  int? _year;

  void _reload() {
    ref.invalidate(attendanceScheduleProvider);
    ref.invalidate(recordPageProvider);
  }

  Future<void> _open(String route) async {
    await context.push(route);
    _reload();
  }

  Future<void> _setDefault(int companyId, int? scheduleId, String name) async {
    final t = AppLocalizations.of(context);
    if (!await confirmAction(context, action: t.scheduleMakeDefault, summary: [name]) || !mounted) return;
    try {
      await ref
          .read(apiClientProvider)
          .run(
            (d) => d.patch<dynamic>(
              '/attendance/default-schedule',
              data: {'companyId': companyId, 'scheduleId': scheduleId},
              options: ApiClient.allCompanies(Options(headers: {'Idempotency-Key': const Uuid().v4()})),
            ),
            (_) {},
          );
      _reload();
      if (mounted) await showActionResult(context, message: t.scheduleDefaultSet, action: t.scheduleMakeDefault);
    } on Object catch (e) {
      if (mounted) await showActionError(context, e, action: t.scheduleMakeDefault);
    }
  }

  Future<void> _assign(Map<String, dynamic> emp, List<Map<String, dynamic>> schedules, int? defaultId) async {
    final t = AppLocalizations.of(context);
    final picked = await showModalBottomSheet<int>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(t.scheduleUseDefault), onTap: () => Navigator.pop(c, 0)),
            for (final s in schedules.where((s) => s['active'] != false))
              ListTile(
                key: Key('schedule-pick-${s['id']}'),
                title: Text('${s['name']}'),
                subtitle: Text('${s['start']}–${s['end']}'),
                trailing: emp['scheduleId'] == s['id'] ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(c, _int(s['id'])),
              ),
          ],
        ),
      ),
    );
    if (picked == null || !mounted) return;
    final name = picked == 0
        ? t.scheduleUseDefault
        : '${schedules.where((s) => s['id'] == picked).firstOrNull?['name'] ?? picked}';
    final summary = ['${emp['code']} ${emp['name']}', name];
    if (!await confirmAction(context, action: t.scheduleAssignAction, summary: summary) || !mounted) return;
    try {
      await ref.read(recordsApiProvider).update('employees', '${emp['id']}', {
        'workSchedule': picked == 0 ? null : picked,
      }, idempotencyKey: const Uuid().v4());
      _reload();
      if (mounted) await showActionResult(context, message: t.scheduleAssigned, action: t.scheduleAssignAction);
    } on Object catch (e) {
      if (mounted) await showActionError(context, e, action: t.scheduleAssignAction);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.scheduleTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(attendanceScheduleProvider(_year).future),
        child: AsyncBody<Map<String, dynamic>>(
          value: ref.watch(attendanceScheduleProvider(_year)),
          onRetry: () => ref.invalidate(attendanceScheduleProvider(_year)),
          data: (j) {
            final year = _int(j['year']);
            final canWrite = j['canWrite'] == true;
            final canCreate = j['canCreate'] == true;
            final defaultId = j['defaultScheduleId'] is num ? _int(j['defaultScheduleId']) : null;
            final companyId = _int(j['companyId']);
            final schedules = [for (final s in _list(j['schedules'])) _map(s)];
            final holidays = [for (final h in _list(j['holidays'])) _map(h)];
            final centers = [for (final c in _list(j['costCenters'])) _map(c)];
            final employees = [for (final e in _list(j['employees'])) _map(e)];
            String nameOf(int? id) => '${schedules.where((s) => s['id'] == id).firstOrNull?['name'] ?? t.scheduleNone}';
            Widget header(String title, {String? addKey, VoidCallback? onAdd}) => Padding(
              padding: const EdgeInsets.only(top: 20, bottom: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                  ),
                  if (onAdd != null)
                    TextButton.icon(
                      key: Key(addKey!),
                      onPressed: onAdd,
                      icon: const Icon(Icons.add),
                      label: Text(t.recordAdd),
                    ),
                ],
              ),
            );
            return ListView(
              key: const Key('schedule-page'),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              children: [
                PkNotice(text: canWrite ? t.scheduleLeadWrite : t.scheduleLeadRead, dense: true),
                header(
                  t.scheduleWork,
                  addKey: 'schedule-add',
                  onAdd: canCreate ? () => _open('/data/work-schedules/new') : null,
                ),
                for (final s in schedules)
                  PkCard(
                    key: Key('schedule-${s['id']}'),
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: EdgeInsets.zero,
                    child: ListTile(
                      contentPadding: const EdgeInsets.fromLTRB(14, 6, 8, 6),
                      leading: PkIconChip(
                        icon: Icons.schedule,
                        tone: s['active'] == false ? PkTone.neutral : (s['id'] == defaultId ? PkTone.ok : PkTone.info),
                      ),
                      titleTextStyle: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                      title: Text(
                        [
                          '${s['name']}',
                          if (s['id'] == defaultId) '· ${t.scheduleDefault}',
                          if (s['active'] == false) '· ${t.rapInactive}',
                        ].join(' '),
                      ),
                      subtitle: Text(
                        [
                          '${s['start']}–${s['end']}',
                          t.scheduleTolerance(_int(s['tol'])),
                          [for (final d in _list(s['days'])) _dayShort[(_int(d) - 1).clamp(0, 6)]].join(' '),
                          t.scheduleUsed(_int(s['used'])),
                        ].join(' · '),
                      ),
                      onTap: canWrite ? () => _open('/data/work-schedules/${s['id']}/edit') : null,
                      trailing: canWrite && s['id'] != defaultId && s['active'] != false
                          ? TextButton(
                              key: Key('schedule-default-${s['id']}'),
                              onPressed: () => _setDefault(companyId, _int(s['id']), '${s['name']}'),
                              child: Text(t.scheduleMakeDefault),
                            )
                          : null,
                    ),
                  ),
                header(
                  t.scheduleHolidays(year),
                  addKey: 'holiday-add',
                  onAdd: canCreate ? () => _open('/data/holidays/new') : null,
                ),
                Wrap(
                  spacing: 6,
                  children: [
                    for (final y in [year - 1, year, year + 1])
                      ChoiceChip(
                        key: Key('schedule-year-$y'),
                        label: Text('$y'),
                        selected: y == year,
                        onSelected: (_) => setState(() => _year = y),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                if (holidays.isEmpty) PkEmptyState(icon: Icons.event_available_outlined, message: t.scheduleNoHolidays),
                if (holidays.isNotEmpty)
                  _ListCard(
                    children: [
                      for (final h in holidays)
                        ListTile(
                          key: Key('holiday-${h['id']}'),
                          dense: true,
                          leading: const PkIconChip(icon: Icons.event_busy_outlined, tone: PkTone.warn, size: 32),
                          title: Text('${h['name']}'),
                          subtitle: Text(formatDateOnly('${h['date']}')),
                          onTap: canWrite ? () => _open('/data/holidays/${h['id']}/edit') : null,
                        ),
                    ],
                  ),
                header(t.scheduleGeofence),
                Text(
                  t.scheduleGeofenceHint(_int(j['defaultRadius'])),
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
                const SizedBox(height: 8),
                if (centers.isNotEmpty)
                  _ListCard(
                    children: [
                      for (final c in centers)
                        ListTile(
                          key: Key('geofence-${c['id']}'),
                          dense: true,
                          leading: PkIconChip(
                            icon: c['lat'] == null ? Icons.location_off_outlined : Icons.location_on_outlined,
                            tone: c['lat'] == null ? PkTone.neutral : PkTone.info,
                            size: 32,
                          ),
                          title: Text('${c['code']} ${c['name']}'),
                          subtitle: Text(
                            c['lat'] == null
                                ? t.scheduleNoLocation
                                : '${c['lat']}, ${c['lng']} · ${t.scheduleRadius(_int(c['radiusM'] ?? j['defaultRadius']))}',
                          ),
                          onTap: canWrite ? () => _open('/data/cost-centers/${c['id']}/edit') : null,
                          trailing: c['lat'] == null
                              ? null
                              : IconButton(
                                  tooltip: t.scheduleOpenMap,
                                  icon: const Icon(Icons.map_outlined),
                                  onPressed: () => ref
                                      .read(browserProvider)
                                      .open('https://www.google.com/maps?q=${c['lat']},${c['lng']}'),
                                ),
                        ),
                    ],
                  ),
                header(t.scheduleEmployees),
                if (employees.isNotEmpty)
                  _ListCard(
                    children: [
                      for (final e in employees)
                        ListTile(
                          key: Key('schedule-emp-${e['id']}'),
                          dense: true,
                          leading: PkAvatar(name: '${e['name']}', size: 32),
                          title: Text('${e['code']} ${e['name']}'),
                          subtitle: Text(
                            e['scheduleId'] == null
                                ? '${nameOf(defaultId)} (${t.scheduleDefault})'
                                : nameOf(_int(e['scheduleId'])),
                          ),
                          trailing: canWrite ? const Icon(Icons.edit_calendar_outlined) : null,
                          onTap: canWrite ? () => _assign(e, schedules, defaultId) : null,
                        ),
                    ],
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Hairline card holding a list of rows separated by dividers.
class _ListCard extends StatelessWidget {
  const _ListCard({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => PkCard(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Column(
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const Divider(height: 1, indent: 16, endIndent: 16),
          children[i],
        ],
      ],
    ),
  );
}
