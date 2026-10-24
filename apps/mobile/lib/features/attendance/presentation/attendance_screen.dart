import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/db/app_database.dart';
import '../../../core/format/dates.dart';
import '../../../core/location/location_service.dart';
import '../../../core/logging/log.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/draft_repository.dart';
import '../../sync/application/sync_coordinator.dart';
import '../../sync/domain/sync_models.dart';
import '../../companies/presentation/company_chip.dart';
import '../../privacy/application/privacy_providers.dart';
import '../../privacy/domain/privacy.dart';
import '../../privacy/presentation/privacy_notice_screen.dart';
import '../application/attendance_service.dart';
import '../domain/attendance.dart';
import 'attendance_widgets.dart';
import 'recap_view.dart';
import 'team_view.dart';

/// Tabs of the attendance hub (by role).
enum AttendanceTab { check, recap, team }

/// E6 attendance hub. "Absen": own check-in/out at a project OR a cost center (US-01/02, Q-40; ADR 0032: no site) with
/// geofence distance feedback. DRMS 13/10 A2: the locations are the user's eligible ones by attendance type (OnSite /
/// Non-OnSite, cached for offline use); on open the GPS fix selects the location whose geofence contains it (nearest
/// when several overlap → the user picks among them; none → manual picker as fallback) — works offline; GPS +
/// front-camera selfie are captured on the phone and
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
    return DefaultTabController(
      length: tabs.length,
      initialIndex: initial,
      child: Scaffold(
        appBar: AppBar(
          title: Text(t.attendanceTitle),
          bottom: tabs.length < 2
              ? null
              : TabBar(
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

  /// DRMS 13/10 A2: last automatic area detection (null = not run yet) and whether it ran on open.
  AreaDetection? _area;
  bool _autoDetected = false;

  /// DRMS 13/10 A2: GPS fix → the location whose geofence contains it (nearest when several overlap, the user may
  /// pick another of those); none → the manual picker stays (fallback) with the nearest one as a hint. Only a hint:
  /// the buttons re-check the selected location and the server decides.
  Future<void> _detect(List<ProjectSite> list, {bool auto = false}) async {
    final t = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _notice = t.attendanceLocating;
      _noticeIsError = false;
    });
    try {
      final fix = await ref.read(locationServiceProvider).current();
      if (!mounted) return;
      if (fix.isMocked) {
        setState(() {
          _area = null;
          _notice = t.attendanceMocked;
          _noticeIsError = true;
        });
        return;
      }
      final d = detectArea(list, fix);
      final pick = d.inside.firstOrNull;
      final nearest = d.nearest;
      setState(() {
        _area = d;
        if (pick != null) {
          _siteKey = pick.site.key;
          _distance = (site: pick.site, distanceM: pick.distanceM, accuracyM: fix.accuracyM);
          _notice = d.overlap
              ? t.attendanceDetectedOverlap(d.inside.length)
              : t.attendanceDetected(pick.site.label, pick.distanceM);
          _noticeIsError = false;
        } else if (nearest != null) {
          _distance = (site: nearest.site, distanceM: nearest.distanceM, accuracyM: fix.accuracyM);
          // ADR 0032: Non-OnSite outside every registered location cannot check in either
          _notice = nearest.site.unrestricted
              ? t.attendanceNonOnsiteOutside
              : t.attendanceDetectNone(nearest.site.label, nearest.distanceM);
          _noticeIsError = true;
        } else {
          _notice = t.attendanceDetectNoPoint;
          _noticeIsError = true;
        }
      });
    } on LocationException catch (e) {
      if (mounted) {
        setState(() {
          _notice = e.message;
          _noticeIsError = true;
        });
      }
    } on Object catch (e) {
      // best effort (e.g. no location plugin): the manual picker stays usable
      Log.w('attendance: area detection failed', e);
      if (mounted) setState(() => _notice = auto ? null : const LocationException(LocationProblem.unavailable).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

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

  /// Non-OnSite (ADR 0032): the selected location when the fix is inside it, else the registered location of the same
  /// PT containing the fix (nearest); outside all → refused (no "Di luar area" any more). A mocked fix is refused; the
  /// server re-checks and decides where the record belongs.
  Future<({LocationFix fix, ProjectSite site})?> _locateUnrestricted(ProjectSite site, List<ProjectSite> list) async {
    final t = AppLocalizations.of(context);
    setState(() {
      _notice = t.attendanceLocating;
      _noticeIsError = false;
    });
    try {
      final fix = await ref.read(locationServiceProvider).current();
      if (!mounted) return null;
      if (fix.isMocked) {
        setState(() {
          _notice = t.attendanceMocked;
          _noticeIsError = true;
        });
        return null;
      }
      final same = [
        for (final s in list)
          if (s.companyId == site.companyId) s,
      ];
      final d = detectArea(same, fix);
      final hit = d.inside.where((m) => m.site.key == site.key).firstOrNull ?? d.inside.firstOrNull;
      setState(() {
        if (hit != null) {
          _siteKey = hit.site.key;
          _distance = (site: hit.site, distanceM: hit.distanceM, accuracyM: fix.accuracyM);
          _notice = t.attendanceInside(hit.distanceM, hit.site.radiusM?.round() ?? 0);
          _noticeIsError = false;
        } else {
          _notice = t.attendanceNonOnsiteOutside;
          _noticeIsError = true;
        }
      });
      return hit == null ? null : (fix: fix, site: hit.site);
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

  Future<void> _record(AttendanceKind kind, ProjectSite site, List<ProjectSite> list) async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    // ADR 0018: no GPS, no camera, nothing queued before the privacy notice is acknowledged on the server.
    if (ref.read(attendanceBlockedByPrivacyProvider)) {
      showSnack(context, t.privacyAttendanceBlocked);
      return;
    }
    setState(() => _busy = true);
    try {
      final ({LocationFix fix, ProjectSite site})? at;
      if (site.unrestricted) {
        at = await _locateUnrestricted(site, list);
      } else {
        final fix = await _locate(site);
        at = fix == null ? null : (fix: fix, site: site);
      }
      if (at == null || !mounted) return;
      final raw = await ref.read(selfieCaptureProvider)(context, t.attendanceSelfieTitle);
      if (raw == null || !mounted) return;
      final online = ref.read(connectivityProvider);
      await ref
          .read(attendanceServiceProvider)
          .record(sub: sub, kind: kind, site: at.site, fix: at.fix, rawSelfie: raw, online: online);
      ref.read(syncCoordinatorProvider.notifier).requestSync(delay: Duration.zero);
      if (mounted) showSnack(context, online ? t.attendanceSavedOnline : t.attendanceSavedOffline);
    } on PrivacyNoticeRequiredException {
      if (mounted) showSnack(context, t.privacyAttendanceBlocked);
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
    final sites = ref.watch(attendanceSitesProvider);
    final profile = ref.watch(currentProfileProvider);
    return AsyncBody(
      value: sites,
      onRetry: () => ref.invalidate(attendanceSitesProvider),
      data: (list) {
        final site = list.where((s) => s.key == _siteKey).firstOrNull ?? list.firstOrNull;
        // MC3: the flag of the location's PT.
        final enabled = ref.watch(attendanceEnabledForProvider(site?.companyId));
        // ADR 0018: blocked until the current privacy notice is acknowledged (selfie + GPS)
        final privacyBlocked = ref.watch(attendanceBlockedByPrivacyProvider);
        // DRMS 13/10 A2: attendance type of the PT of the selected location (eligible list only)
        final type = site?.attendanceType;
        // DRMS 13/10 A2: recognise the area once on open (not while blocked: no GPS before the privacy ack)
        final detectable = list.any((s) => s.hasGeofence);
        if (!_autoDetected && enabled && !privacyBlocked && detectable) {
          _autoDetected = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _detect(list, auto: true);
          });
        }
        final area = _area;
        // ADR 0032: Non-OnSite is not bound to the chosen location (the containing one is picked when recording)
        final ready = enabled && !privacyBlocked && !_busy && site != null && (site.hasGeofence || site.unrestricted);
        final d = _distance;
        final dist = d != null && site != null && d.site.key == site.key ? d : null;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (privacyBlocked) const PrivacyAttendanceBlock(from: 'attendance'),
            if (!enabled) InfoCard(text: t.attendanceDisabled, error: true),
            if (list.isEmpty)
              InfoCard(text: t.attendanceNoProjects, error: true)
            else ...[
              if (area != null && area.overlap) ...[
                Text(t.attendanceAreaChoice, style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    for (final m in area.inside)
                      ChoiceChip(
                        key: Key('attendance-area-${m.site.key}'),
                        avatar: Icon(siteKindIcon(m.site.kind), size: 18),
                        label: Text('${m.site.label} · ${m.distanceM} m'),
                        selected: site?.key == m.site.key,
                        onSelected: _busy
                            ? null
                            : (_) => setState(() {
                                _siteKey = m.site.key;
                                _distance = null;
                              }),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
              ],
              DropdownButtonFormField<String>(
                hint: Text(t.pickLocation),
                // keyed by the selection: the auto-detected area (DRMS 13/10 A2) re-initialises the field
                key: ValueKey('attendance-project:${site?.key}'),
                initialValue: site?.key,
                isExpanded: true,
                decoration: InputDecoration(labelText: t.attendanceLocation, prefixIcon: const Icon(Icons.place)),
                items: [
                  for (final s in list)
                    DropdownMenuItem(
                      value: s.key,
                      child: Row(
                        children: [
                          Icon(siteKindIcon(s.kind), size: 18),
                          const SizedBox(width: 8),
                          if ((profile?.showCompanyChips ?? false) && s.companyId != null) ...[
                            CompanyChip(companyId: s.companyId),
                            const SizedBox(width: 6),
                          ],
                          Expanded(child: Text(siteDisplayLabel(t, s), overflow: TextOverflow.ellipsis)),
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
                  child: Text(siteSubLabel(t, site), style: Theme.of(context).textTheme.bodySmall),
                ),
              if (type != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2, left: 12),
                  child: Text(
                    type == AttendanceType.nonOnsite ? t.attendanceTypeNonOnsite : t.attendanceTypeOnsite,
                    key: const Key('attendance-type-hint'),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              if (site != null && !site.hasGeofence && !site.unrestricted)
                InfoCard(text: t.attendanceNoGeofence, error: true),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const Key('attendance-detect'),
                onPressed: !_busy && enabled && !privacyBlocked && detectable ? () => _detect(list) : null,
                icon: const Icon(Icons.travel_explore),
                label: Text(t.attendanceDetect),
              ),
              const SizedBox(height: 8),
              if (dist != null) DistanceCard(site: dist.site, distanceM: dist.distanceM, accuracyM: dist.accuracyM),
              OutlinedButton.icon(
                key: const Key('attendance-check-distance'),
                onPressed: !_busy && !privacyBlocked && site != null && site.hasGeofence
                    ? () => _checkDistance(site)
                    : null,
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
                    onPressed: ready ? () => _record(kind, site, list) : null,
                    icon: Icon(kind == AttendanceKind.checkIn ? Icons.login : Icons.logout),
                    label: Text(kind == AttendanceKind.checkIn ? t.attendanceCheckIn : t.attendanceCheckOut),
                  ),
                ),
            ],
            if (_notice != null) InfoCard(key: const Key('attendance-notice'), text: _notice!, error: _noticeIsError),
            const Divider(height: 32),
            Text(t.attendanceHistory, style: Theme.of(context).textTheme.titleMedium),
            _History(sites: {for (final s in list) s.key: siteDisplayLabel(t, s)}),
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
                  ? context.pk.okText
                  : (r.status == 'rejected' || r.status == 'failed' ? context.pk.badText : null),
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
    // ADR 0023 (schema v9): a (legacy) site item carries its site in the outbox column
    if (r.siteId != null) return '${SiteKind.site.prefix}${r.siteId}';
    final project = (p['project_id'] as num?)?.toInt();
    if (project != null) return 'p$project';
    final cc = (p['cost_center_id'] as num?)?.toInt();
    if (cc != null) return 'c$cc';
    final site = (p['site_id'] as num?)?.toInt();
    return site == null ? null : 's$site';
  }
}
