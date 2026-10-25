import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/db/app_database.dart';
import '../../../core/format/dates.dart';
import '../../../core/location/location_service.dart';
import '../../../core/logging/log.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_lapangan.dart';
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
      final label = kind == AttendanceKind.checkIn ? t.attendanceCheckIn : t.attendanceCheckOut;
      if (!await confirmAction(context, action: label, summary: [at.site.label]) || !mounted) return;
      final raw = await ref.read(selfieCaptureProvider)(context, t.attendanceSelfieTitle);
      if (raw == null || !mounted) return;
      final online = ref.read(connectivityProvider);
      await ref
          .read(attendanceServiceProvider)
          .record(sub: sub, kind: kind, site: at.site, fix: at.fix, rawSelfie: raw, online: online);
      ref.read(syncCoordinatorProvider.notifier).requestSync(delay: Duration.zero);
      if (!mounted) return;
      if (online) {
        await showActionResult(context, message: t.attendanceSavedOnline, action: label);
      } else {
        await showActionQueued(context, action: label, message: t.attendanceSavedOffline);
      }
    } on PrivacyNoticeRequiredException {
      if (mounted) await showActionFailure(context, t.privacyAttendanceBlocked);
    } on PhotoTooLargeException catch (e) {
      if (mounted) await showActionFailure(context, e.message);
    } on QueueFullException catch (e) {
      if (mounted) await showActionFailure(context, e.message);
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
        final sitesByKey = {for (final s in list) s.key: siteDisplayLabel(t, s)};
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            if (privacyBlocked) const PrivacyAttendanceBlock(from: 'attendance'),
            if (!enabled) InfoCard(text: t.attendanceDisabled, error: true),
            if (list.isEmpty)
              InfoCard(text: t.attendanceNoProjects, error: true)
            else ...[
              _TodayCard(site: site, sites: sitesByKey),
              const SizedBox(height: 12),
              if (area != null && area.overlap)
                PkSectionCard(
                  title: t.attendanceAreaChoice,
                  icon: Icons.layers_outlined,
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 6,
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
                ),
              PkCard(
                margin: const EdgeInsets.only(bottom: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
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
                    if (site != null) PkMetaLine(icon: Icons.radar, text: siteSubLabel(t, site)),
                    if (type != null)
                      PkMetaLine(
                        icon: Icons.badge_outlined,
                        textKey: const Key('attendance-type-hint'),
                        text: type == AttendanceType.nonOnsite ? t.attendanceTypeNonOnsite : t.attendanceTypeOnsite,
                      ),
                    if (site != null && !site.hasGeofence && !site.unrestricted)
                      InfoCard(text: t.attendanceNoGeofence, error: true),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      key: const Key('attendance-detect'),
                      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                      onPressed: !_busy && enabled && !privacyBlocked && detectable ? () => _detect(list) : null,
                      icon: const Icon(Icons.travel_explore),
                      label: Text(t.attendanceDetect),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      key: const Key('attendance-check-distance'),
                      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                      onPressed: !_busy && !privacyBlocked && site != null && site.hasGeofence
                          ? () => _checkDistance(site)
                          : null,
                      icon: const Icon(Icons.my_location),
                      label: Text(t.attendanceCheckDistance),
                    ),
                  ],
                ),
              ),
              if (dist != null) DistanceCard(site: dist.site, distanceM: dist.distanceM, accuracyM: dist.accuracyM),
              // Field-friendly: two full-width 60 dp buttons (gloves, sunlight); check-in solid, check-out tonal.
              for (final kind in AttendanceKind.values)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: kind == AttendanceKind.checkIn
                      ? FilledButton.icon(
                          key: Key('attendance-${kind.name}'),
                          style: _bigButton,
                          onPressed: ready ? () => _record(kind, site, list) : null,
                          icon: const Icon(Icons.login, size: 24),
                          label: Text(t.attendanceCheckIn),
                        )
                      : FilledButton.tonalIcon(
                          key: Key('attendance-${kind.name}'),
                          style: _bigButton,
                          onPressed: ready ? () => _record(kind, site, list) : null,
                          icon: const Icon(Icons.logout, size: 24),
                          label: Text(t.attendanceCheckOut),
                        ),
                ),
            ],
            if (_notice != null) InfoCard(key: const Key('attendance-notice'), text: _notice!, error: _noticeIsError),
            PkSectionHeader(title: t.attendanceHistory),
            _History(sites: sitesByKey),
          ],
        );
      },
    );
  }

  static final _bigButton = FilledButton.styleFrom(
    minimumSize: const Size.fromHeight(60),
    textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(PkRadius.md)),
  );
}

/// Own check-in / check-out of this phone (not on-behalf), not refused.
bool _ownMark(OutboxData r) =>
    AttendanceKind.fromItemType(r.type) != null && r.status != 'rejected' && r.status != 'failed';

/// Wall-clock of [iso] in the company [zone] (null = unparsable).
DateTime? _inZone(String iso, String? zone) => DateTime.tryParse(iso)?.toUtc().add(offsetForZone(zone));

/// D2510 hero: today's status from this phone's own marks as a soft-tone card — "Belum absen" (orange) /
/// "Hadir" (blue) / "Selesai" (green), check-in and check-out times and the location. Offline-safe (outbox rows);
/// the server's day status stays in "Rekap".
class _TodayCard extends ConsumerWidget {
  const _TodayCard({required this.site, required this.sites});
  final ProjectSite? site;
  final Map<String, String> sites;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final zone = ref.watch(currentProfileProvider)?.timezone;
    final items = ref.watch(attendanceItemsProvider).value ?? const <OutboxData>[];
    final today = DateTime.now().toUtc().add(offsetForZone(zone));
    bool isToday(OutboxData r) {
      final d = _inZone(r.deviceTime, zone);
      return d != null && d.year == today.year && d.month == today.month && d.day == today.day;
    }

    final marks = [
      for (final r in items)
        if (_ownMark(r) && isToday(r)) r,
    ]..sort((a, b) => a.deviceTime.compareTo(b.deviceTime));
    OutboxData? first(AttendanceKind k) => marks.where((r) => r.type == k.itemType).firstOrNull;
    OutboxData? last(AttendanceKind k) => marks.where((r) => r.type == k.itemType).lastOrNull;
    final checkIn = first(AttendanceKind.checkIn);
    final checkOut = last(AttendanceKind.checkOut);
    final latest = marks.lastOrNull;
    final (tone, icon, status) = checkOut != null
        ? (PkTone.ok, Icons.check_circle, t.recapStatusDone)
        : checkIn != null
        ? (PkTone.info, Icons.login, t.recapStatusPresent)
        : (PkTone.warn, Icons.schedule, t.recapStatusNotYet);
    final c = pkToneColors(context, tone);
    String hm(OutboxData? r) {
      final d = r == null ? null : _inZone(r.deviceTime, zone);
      return d == null ? '—' : '${d.hour.toString().padLeft(2, '0')}.${d.minute.toString().padLeft(2, '0')}';
    }

    final where = latest != null
        ? (sites[_History._siteOf(latest)] ?? '-')
        : (site == null ? null : siteLabel(t, site!));
    // queued on the phone / being sent: a cloud glyph beside the status (the history below has the text)
    final pendingIcon = latest == null || latest.status == 'applied'
        ? null
        : (latest.offline ? Icons.cloud_off : Icons.cloud_upload_outlined);
    return PkToneHeroCard(
      key: const Key('attendance-today'),
      tone: tone,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(color: context.pk.card, shape: BoxShape.circle),
                child: Icon(icon, size: 28, color: c.fg),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      DateFormat('EEEE, d MMMM yyyy', 'id').format(today),
                      style: theme.textTheme.labelLarge?.copyWith(color: c.fg, fontWeight: FontWeight.w600),
                    ),
                    Text(
                      status,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        color: c.fg,
                        fontFamily: PkFonts.heading,
                        fontWeight: FontWeight.w700,
                        height: 1.2,
                      ),
                    ),
                  ],
                ),
              ),
              if (pendingIcon != null) Icon(pendingIcon, size: 20, color: c.fg, semanticLabel: t.queueStatusPending),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _TimeTile(label: t.teamIn, value: hm(checkIn), color: c.fg),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _TimeTile(label: t.teamOut, value: hm(checkOut), color: c.fg),
              ),
            ],
          ),
          if (where != null) ...[
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.place_outlined, size: 18, color: c.fg),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    where,
                    style: theme.textTheme.bodyMedium?.copyWith(color: c.fg, fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _TimeTile extends StatelessWidget {
  const _TimeTile({required this.label, required this.value, required this.color});
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: context.pk.card.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(PkRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: theme.textTheme.labelMedium?.copyWith(color: color)),
            Text(
              value,
              style: theme.textTheme.titleLarge?.copyWith(
                color: color,
                fontFamily: PkFonts.heading,
                fontWeight: FontWeight.w700,
                height: 1.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _History extends ConsumerWidget {
  const _History({required this.sites});
  final Map<String, String> sites;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final items = ref.watch(attendanceItemsProvider).value ?? const <OutboxData>[];
    if (items.isEmpty) {
      return PkEmptyState(icon: Icons.history, message: t.attendanceHistoryEmpty);
    }
    final zone = ref.watch(currentProfileProvider)?.timezone;
    (String, PkTone, IconData) status(OutboxData r) => switch (r.status) {
      'pending' => (t.queueStatusPending, PkTone.info, Icons.schedule),
      'applied' => (t.queueStatusApplied, PkTone.ok, Icons.cloud_done),
      'rejected' => (t.queueStatusRejected, PkTone.bad, Icons.error),
      'failed' => (t.queueStatusFailed, PkTone.bad, Icons.error),
      _ => (r.status, PkTone.neutral, Icons.schedule),
    };
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return Column(
      children: [
        for (final r in items)
          Builder(
            builder: (context) {
              final (label, tone, icon) = status(r);
              final error = r.lastErrorMessage != null && r.status != 'applied' ? r.lastErrorMessage : null;
              return PkCard(
                key: Key('attendance-item-${r.opUuid}'),
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    PkIconChip(icon: icon, tone: tone, size: 40),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${_label(r)} · '
                            '${sites[_siteOf(r)] ?? '-'}${r.offline ? ' · ${t.attendanceOfflineTag}' : ''}',
                            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 2),
                          Text(formatServerDateTime(r.deviceTime, zone: zone), style: muted),
                          if (error != null) ...[
                            const SizedBox(height: 4),
                            Text(error, style: theme.textTheme.bodySmall?.copyWith(color: context.pk.badText)),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    PkPill(label: label, tone: tone),
                  ],
                ),
              );
            },
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
