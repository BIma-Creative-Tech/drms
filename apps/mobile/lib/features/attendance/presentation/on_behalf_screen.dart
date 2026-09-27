import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/location/location_service.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../app_config/application/app_config_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/data/draft_repository.dart';
import '../../sync/application/sync_coordinator.dart';
import '../application/attendance_service.dart';
import '../domain/attendance.dart';
import 'attendance_widgets.dart';

/// US-14 "Diabsenkan PM": for a team member without a phone. The PM picks the employee, the team location
/// and check-in/out, writes the reason, then GPS (PM's phone, geofence + mock checked on the phone and
/// again on the server) and a photo of the employee with the front or back camera. Queued like an own
/// check-in (works offline); the server records source = PM with the PM's name.
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

  Future<void> _record(OnBehalfCandidate who, ProjectSite site) async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
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
    final candidates = ref.watch(onBehalfCandidatesProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.onBehalfTitle)),
      body: AsyncBody<List<OnBehalfCandidate>>(
        value: candidates,
        onRetry: () => ref.invalidate(onBehalfCandidatesProvider),
        data: (list) {
          final who = list.where((c) => c.employeeId == _employeeId).firstOrNull;
          final site = who?.sites.where((s) => s.key == _siteKey).firstOrNull ?? who?.sites.firstOrNull;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (!enabled) InfoCard(text: t.attendanceDisabled, error: true),
              InfoCard(text: t.onBehalfIntro),
              if (list.isEmpty) InfoCard(text: t.onBehalfNoTeam, error: true),
              DropdownButtonFormField<int>(
                key: const Key('on-behalf-employee'),
                initialValue: who?.employeeId,
                isExpanded: true,
                decoration: InputDecoration(labelText: t.onBehalfEmployee, prefixIcon: const Icon(Icons.person)),
                items: [for (final c in list) DropdownMenuItem(value: c.employeeId, child: Text(c.name))],
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
              if (site != null && !site.hasGeofence) InfoCard(text: t.attendanceNoGeofence, error: true),
              const SizedBox(height: 16),
              FilledButton.icon(
                key: const Key('on-behalf-submit'),
                onPressed: enabled && !_busy && who != null && site != null && site.hasGeofence
                    ? () => _record(who, site)
                    : null,
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
