import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/location/location_service.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/draft_repository.dart';
import '../../privacy/application/privacy_providers.dart';
import '../../privacy/domain/privacy.dart';
import '../../privacy/presentation/privacy_notice_screen.dart';
import '../../sync/application/sync_coordinator.dart';
import '../application/attendance_service.dart';
import '../domain/attendance.dart';
import 'attendance_widgets.dart';

/// US-14 "Diabsenkan PM": for a team member without a phone. The PM picks the employee, the team location
/// and check-in/out, writes the reason, then GPS (PM's phone, geofence + mock checked on the phone and
/// again on the server) and a photo of the employee with the front or back camera. Queued like an own
/// check-in (works offline); the server records source = PM with the PM's name. ADR 0032: an Admin Staff picks ANY
/// employee of its PT (also without an account) and any registered location of it; a Non-OnSite employee is recorded at
/// the location containing the fix; the server records source = Admin Staff with the user's name.
class OnBehalfScreen extends ConsumerStatefulWidget {
  const OnBehalfScreen({super.key, this.employeeId, this.kind});
  final int? employeeId;
  final AttendanceKind? kind;

  @override
  ConsumerState<OnBehalfScreen> createState() => _OnBehalfScreenState();
}

class _OnBehalfScreenState extends ConsumerState<OnBehalfScreen> {
  late int? _employeeId = widget.employeeId;
  String? _siteKey;
  late AttendanceKind _kind = widget.kind ?? AttendanceKind.checkIn;
  CameraLens _lens = CameraLens.back;
  final _reason = TextEditingController();
  String? _reasonError;
  String? _notice;
  bool _noticeError = false;
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _record(OnBehalfCandidate who, ProjectSite picked) async {
    final t = AppLocalizations.of(context);
    var site = picked;
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    // ADR 0018: the PM's own acknowledgement gates on-behalf attendance (GPS of the PM's phone + a photo).
    if (ref.read(attendanceBlockedByPrivacyProvider)) {
      showSnack(context, t.privacyAttendanceBlocked);
      return;
    }
    final reason = _reason.text.trim();
    if (reason.length < 3) {
      setState(() => _reasonError = t.reasonTooShort);
      return;
    }
    setState(() {
      _reasonError = null;
      _busy = true;
      _notice = t.attendanceLocating;
      _noticeError = false;
    });
    try {
      final fix = await ref.read(locationServiceProvider).current();
      if (site.unrestricted && !fix.isMocked) {
        // ADR 0032 (Non-OnSite employee): the registered location of the PT containing the fix, nearest first
        final d = detectArea(who.sites, fix);
        final hit = d.inside.where((m) => m.site.key == site.key).firstOrNull ?? d.inside.firstOrNull;
        if (hit == null) {
          setState(() {
            _notice = t.attendanceNonOnsiteOutside;
            _noticeError = true;
          });
          return;
        }
        site = hit.site;
        setState(() => _notice = t.attendanceInside(hit.distanceM, hit.site.radiusM?.round() ?? 0));
      } else {
        final res = checkSite(site, fix);
        final problem = siteProblem(t, site, res);
        if (problem != null) {
          setState(() {
            _notice = problem;
            _noticeError = true;
          });
          return;
        }
        setState(() => _notice = t.attendanceInside(res.distanceM ?? 0, site.radiusM?.round() ?? 0));
      }
      if (!mounted) return;
      final raw = await ref.read(onBehalfCaptureProvider)(context, t.onBehalfPhotoTitle(who.name), _lens);
      if (raw == null || !mounted) return;
      final online = ref.read(connectivityProvider);
      await ref
          .read(attendanceServiceProvider)
          .recordOnBehalf(
            sub: sub,
            employeeId: who.employeeId,
            kind: _kind,
            site: site,
            fix: fix,
            rawPhoto: raw,
            lens: _lens,
            reason: reason,
            online: online,
          );
      ref.read(syncCoordinatorProvider.notifier).requestSync(delay: Duration.zero);
      if (!mounted) return;
      showSnack(context, online ? t.onBehalfSavedOnline(who.name) : t.onBehalfSavedOffline(who.name));
      Navigator.of(context).maybePop();
    } on LocationException catch (e) {
      setState(() {
        _notice = e.message;
        _noticeError = true;
      });
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
    final candidates = ref.watch(onBehalfCandidatesProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.onBehalfTitle)),
      body: AsyncBody<List<OnBehalfCandidate>>(
        value: candidates,
        onRetry: () => ref.invalidate(onBehalfCandidatesProvider),
        data: (list) {
          final who = list.where((c) => c.employeeId == _employeeId).firstOrNull;
          final site = who?.sites.where((s) => s.key == _siteKey).firstOrNull ?? who?.sites.firstOrNull;
          // MC3: the flag of the location's PT (any scoped PT before a location is known).
          final enabled = site == null
              ? ref.watch(attendanceEnabledAnyProvider)
              : ref.watch(attendanceEnabledForProvider(site.companyId));
          final privacyBlocked = ref.watch(attendanceBlockedByPrivacyProvider);
          // ADR 0032: a Non-OnSite employee (Admin Staff list) needs no point on the chosen location
          final usable = site != null && (site.hasGeofence || site.unrestricted);
          final canSubmit = enabled && !privacyBlocked && !_busy && who != null && usable;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (privacyBlocked) const PrivacyAttendanceBlock(from: 'on-behalf'),
              if (!enabled) InfoCard(text: t.attendanceDisabled, error: true),
              InfoCard(text: t.onBehalfIntro),
              if (list.isEmpty) InfoCard(text: t.onBehalfNoTeam, error: true),
              DropdownButtonFormField<int>(
                hint: Text(t.pickEmployee),
                key: const Key('on-behalf-employee'),
                initialValue: who?.employeeId,
                isExpanded: true,
                decoration: InputDecoration(labelText: t.onBehalfEmployee, prefixIcon: const Icon(Icons.person)),
                items: [
                  for (final c in list)
                    DropdownMenuItem(
                      value: c.employeeId,
                      child: Text(c.hasAccount ? c.name : '${c.name} · ${t.onBehalfNoAccount}'),
                    ),
                ],
                onChanged: _busy
                    ? null
                    : (v) => setState(() {
                        _employeeId = v;
                        _siteKey = null;
                      }),
              ),
              const SizedBox(height: 12),
              if (who != null)
                DropdownButtonFormField<String>(
                  hint: Text(t.pickLocation),
                  key: const Key('on-behalf-site'),
                  initialValue: site?.key,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: t.attendanceLocation, prefixIcon: const Icon(Icons.place)),
                  items: [for (final s in who.sites) DropdownMenuItem(value: s.key, child: Text(siteLabel(t, s)))],
                  onChanged: _busy ? null : (v) => setState(() => _siteKey = v),
                ),
              const SizedBox(height: 12),
              SegmentedButton<AttendanceKind>(
                key: const Key('on-behalf-kind'),
                segments: [
                  ButtonSegment(
                    value: AttendanceKind.checkIn,
                    icon: const Icon(Icons.login),
                    label: Text(t.attendanceCheckIn),
                  ),
                  ButtonSegment(
                    value: AttendanceKind.checkOut,
                    icon: const Icon(Icons.logout),
                    label: Text(t.attendanceCheckOut),
                  ),
                ],
                selected: {_kind},
                onSelectionChanged: _busy ? null : (s) => setState(() => _kind = s.first),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('on-behalf-reason'),
                controller: _reason,
                maxLength: 500,
                decoration: InputDecoration(
                  labelText: t.onBehalfReason,
                  hintText: t.onBehalfReasonHint,
                  errorText: _reasonError,
                ),
              ),
              Text(t.onBehalfCamera, style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              SegmentedButton<CameraLens>(
                key: const Key('on-behalf-lens'),
                segments: [
                  ButtonSegment(
                    value: CameraLens.back,
                    icon: const Icon(Icons.photo_camera_back),
                    label: Text(t.lensBack),
                  ),
                  ButtonSegment(
                    value: CameraLens.front,
                    icon: const Icon(Icons.photo_camera_front),
                    label: Text(t.lensFront),
                  ),
                ],
                selected: {_lens},
                onSelectionChanged: _busy ? null : (s) => setState(() => _lens = s.first),
              ),
              if (site != null && !site.hasGeofence && !site.unrestricted)
                InfoCard(text: t.attendanceNoGeofence, error: true),
              const SizedBox(height: 16),
              FilledButton.icon(
                key: const Key('on-behalf-submit'),
                onPressed: canSubmit ? () => _record(who, site) : null,
                icon: _busy
                    ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.how_to_reg),
                label: Text(_kind == AttendanceKind.checkIn ? t.onBehalfCheckIn : t.onBehalfCheckOut),
              ),
              if (_notice != null) InfoCard(key: const Key('on-behalf-notice'), text: _notice!, error: _noticeError),
            ],
          );
        },
      ),
    );
  }
}
