import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/db/app_database.dart';
import '../../../core/format/dates.dart';
import '../../../core/location/location_service.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../app_config/application/app_config_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/draft_repository.dart';
import '../../sync/application/sync_coordinator.dart';
import '../../sync/domain/sync_models.dart';
import '../application/attendance_service.dart';
import '../domain/attendance.dart';
import 'attendance_widgets.dart';
import 'recap_view.dart';
import 'team_view.dart';

/// Tabs of the attendance hub (by role).
enum AttendanceTab { check, recap, team }

/// E6 attendance hub. "Absen": own check-in/out at a project OR a cost center (US-01/02, Q-40) with
/// geofence distance feedback — works offline; GPS + front-camera selfie are captured on the phone and
/// queued; the server decides. "Rekap": own month (US-09). "Tim": team today (US-13) with on-behalf
/// (US-14) and corrections (US-15). Check-in / on-behalf follow `features.syncAttendance`; the recap and
/// team views are online reads and work with the flag off.
class AttendanceScreen extends ConsumerWidget {
  const AttendanceScreen({super.key, this.initialTab});
  final AttendanceTab? initialTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(currentProfileProvider);
    final tabs = <AttendanceTab>[
      if (profile?.hasOwnAttendance ?? true) ...[AttendanceTab.check, AttendanceTab.recap],
      if (profile?.canSeeTeamAttendance ?? false) AttendanceTab.team,
    ];
    if (tabs.isEmpty) tabs.add(AttendanceTab.recap);
    final initial = initialTab == null ? 0 : tabs.indexOf(initialTab!).clamp(0, tabs.length - 1);
    String label(AttendanceTab tab) => switch (tab) {
      AttendanceTab.check => t.attendanceTabCheck,
      AttendanceTab.recap => t.attendanceTabRecap,
      AttendanceTab.team => t.attendanceTabTeam,
    };
    Widget body(AttendanceTab tab) => switch (tab) {
      AttendanceTab.check => const _CheckTab(),
      AttendanceTab.recap => const RecapView(),
      AttendanceTab.team => const TeamTodayView(),
    };
    final onPrimary = Theme.of(context).colorScheme.onPrimary;
    return DefaultTabController(
      length: tabs.length,
      initialIndex: initial,
      child: Scaffold(
        appBar: AppBar(
          title: Text(t.attendanceTitle),
          bottom: tabs.length < 2
              ? null
              : TabBar(
                  labelColor: onPrimary,
                  unselectedLabelColor: onPrimary.withValues(alpha: 0.75),
                  indicatorColor: onPrimary,
                  tabs: [for (final tab in tabs) Tab(key: Key('attendance-tab-${tab.name}'), text: label(tab))],
                ),
        ),
        body: TabBarView(children: [for (final tab in tabs) body(tab)]),
      ),
    );
  }
}

class _CheckTab extends ConsumerStatefulWidget {
  const _CheckTab();

  @override
  ConsumerState<_CheckTab> createState() => _CheckTabState();
}

class _CheckTabState extends ConsumerState<_CheckTab> {
  String? _siteKey;
  bool _busy = false;
  String? _notice;
  bool _noticeIsError = false;
  ({ProjectSite site, int distanceM, double accuracyM})? _distance;

  /// GPS fix + client geofence check (only enables the action; the server re-checks). Null = refused.
  Future<LocationFix?> _locate(ProjectSite site) async {
    final t = AppLocalizations.of(context);
    setState(() {
      _notice = t.attendanceLocating;
      _noticeIsError = false;
    });
    try {
      final fix = await ref.read(locationServiceProvider).current();
      final res = checkSite(site, fix);
      final problem = siteProblem(t, site, res);
      setState(() {
        if (res.distanceM != null) _distance = (site: site, distanceM: res.distanceM!, accuracyM: fix.accuracyM);
        _notice = problem ?? t.attendanceInside(res.distanceM ?? 0, site.radiusM?.round() ?? 0);
        _noticeIsError = problem != null;
      });
      return problem == null ? fix : null;
    } on LocationException catch (e) {
      setState(() {
        _notice = e.message;
        _noticeIsError = true;
      });
      return null;
    }
  }

  Future<void> _checkDistance(ProjectSite site) async {
    setState(() => _busy = true);
    try {
      await _locate(site);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _record(AttendanceKind kind, ProjectSite site) async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    setState(() => _busy = true);
    try {
      final fix = await _locate(site);
      if (fix == null || !mounted) return;
      final raw = await ref.read(selfieCaptureProvider)(context, t.attendanceSelfieTitle);
      if (raw == null || !mounted) return;
      final online = ref.read(connectivityProvider);
      await ref
          .read(attendanceServiceProvider)
          .record(sub: sub, kind: kind, site: site, fix: fix, rawSelfie: raw, online: online);
      ref.read(syncCoordinatorProvider.notifier).requestSync(delay: Duration.zero);
      if (mounted) showSnack(context, online ? t.attendanceSavedOnline : t.attendanceSavedOffline);
    } on PhotoTooLargeException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on QueueFullException catch (e) {
      if (mounted) showSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final enabled = ref.watch(appConfigProvider).value?.syncAttendance ?? false;
    final sites = ref.watch(attendanceSitesProvider);
    return AsyncBody(
      value: sites,
      onRetry: () => ref.invalidate(attendanceSitesProvider),
      data: (list) {
        final site = list.where((s) => s.key == _siteKey).firstOrNull ?? list.firstOrNull;
        final ready = enabled && !_busy && site != null && site.hasGeofence;
        final d = _distance;
        final dist = d != null && site != null && d.site.key == site.key ? d : null;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (!enabled) InfoCard(text: t.attendanceDisabled, error: true),
            if (list.isEmpty)
              InfoCard(text: t.attendanceNoProjects, error: true)
            else ...[
              DropdownButtonFormField<String>(
                key: const Key('attendance-project'),
                initialValue: site?.key,
                isExpanded: true,
                decoration: InputDecoration(labelText: t.attendanceLocation, prefixIcon: const Icon(Icons.place)),
                items: [
                  for (final s in list)
                    DropdownMenuItem(
                      value: s.key,
                      child: Row(
                        children: [
                          Icon(s.kind == SiteKind.project ? Icons.apartment : Icons.business, size: 18),
                          const SizedBox(width: 8),
                          Expanded(child: Text(s.label, overflow: TextOverflow.ellipsis)),
                        ],
                      ),
                    ),
                ],
                onChanged: _busy
                    ? null
                    : (v) => setState(() {
                        _siteKey = v;
                        _notice = null;
                      }),
              ),
              if (site != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4, left: 12),
                  child: Text(
                    '${site.kind == SiteKind.project ? t.siteProject : t.siteCostCenter}'
                    '${site.radiusM == null ? '' : ' · ${t.attendanceRadius(site.radiusM!.round())}'}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              if (site != null && !site.hasGeofence) InfoCard(text: t.attendanceNoGeofence, error: true),
              const SizedBox(height: 12),
              if (dist != null) DistanceCard(site: dist.site, distanceM: dist.distanceM, accuracyM: dist.accuracyM),
              OutlinedButton.icon(
                key: const Key('attendance-check-distance'),
                onPressed: !_busy && site != null && site.hasGeofence ? () => _checkDistance(site) : null,
                icon: const Icon(Icons.my_location),
                label: Text(t.attendanceCheckDistance),
              ),
              const SizedBox(height: 12),
              for (final kind in AttendanceKind.values)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: FilledButton.icon(
                    key: Key('attendance-${kind.name}'),
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
                    onPressed: ready ? () => _record(kind, site) : null,
                    icon: Icon(kind == AttendanceKind.checkIn ? Icons.login : Icons.logout),
                    label: Text(kind == AttendanceKind.checkIn ? t.attendanceCheckIn : t.attendanceCheckOut),
                  ),
                ),
            ],
            if (_notice != null) InfoCard(key: const Key('attendance-notice'), text: _notice!, error: _noticeIsError),
            const Divider(height: 32),
            Text(t.attendanceHistory, style: Theme.of(context).textTheme.titleMedium),
            _History(sites: {for (final s in list) s.key: s.label}),
          ],
        );
      },
    );
  }
}

class _History extends ConsumerWidget {
  const _History({required this.sites});
  final Map<String, String> sites;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final items = ref.watch(attendanceItemsProvider).value ?? const <OutboxData>[];
    if (items.isEmpty) return Padding(padding: const EdgeInsets.all(8), child: Text(t.attendanceHistoryEmpty));
    final zone = ref.watch(currentProfileProvider)?.timezone;
    String status(OutboxData r) => switch (r.status) {
      'pending' => t.queueStatusPending,
      'applied' => t.queueStatusApplied,
      'rejected' => t.queueStatusRejected,
      'failed' => t.queueStatusFailed,
      _ => r.status,
    };
    return Column(
      children: [
        for (final r in items)
          ListTile(
            key: Key('attendance-item-${r.opUuid}'),
            leading: Icon(
              r.status == 'applied'
                  ? Icons.cloud_done
                  : (r.status == 'rejected' || r.status == 'failed' ? Icons.error : Icons.schedule),
              color: r.status == 'applied'
                  ? StatusColors.ok
                  : (r.status == 'rejected' || r.status == 'failed' ? StatusColors.danger : null),
            ),
            title: Text(
              '${_label(r)} · '
              '${sites[_siteOf(r)] ?? '-'}${r.offline ? ' · ${t.attendanceOfflineTag}' : ''}',
            ),
            subtitle: Text(
              [
                '${formatServerDateTime(r.deviceTime, zone: zone)} · ${status(r)}',
                if (r.lastErrorMessage != null && r.status != 'applied') r.lastErrorMessage!,
              ].join('\n'),
            ),
          ),
      ],
    );
  }

  static Map<String, dynamic> _payload(OutboxData r) {
    final p = jsonDecode(r.payloadJson);
    return p is Map<String, dynamic> ? p : const {};
  }

  static String _label(OutboxData r) {
    if (r.type != SyncItemType.attendanceOnBehalf) return AttendanceKind.fromItemType(r.type)?.label ?? r.type;
    final kind = _payload(r)['kind'] == 'check_out' ? AttendanceKind.checkOut : AttendanceKind.checkIn;
    return '${kind.label} (${SyncItemType.label(r.type)})';
  }

  static String? _siteOf(OutboxData r) {
    final p = _payload(r);
    final project = (p['project_id'] as num?)?.toInt();
    if (project != null) return 'p$project';
    final cc = (p['cost_center_id'] as num?)?.toInt();
    return cc == null ? null : 'c$cc';
  }
}
