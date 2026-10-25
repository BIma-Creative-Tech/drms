import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/dates.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../../companies/presentation/company_chip.dart';
import '../application/attendance_providers.dart';
import '../application/attendance_service.dart';
import '../domain/attendance.dart';
import '../domain/attendance_recap.dart';
import '../../../shared/widgets/pk_ui.dart';
import 'recap_view.dart';

({Color color, IconData icon, String label}) memberStatusVisual(MemberStatus s, AppLocalizations t, PkColors pk) =>
    switch (s) {
      MemberStatus.belumAbsen => (color: pk.warnText, icon: Icons.schedule, label: t.teamStatusNotYet),
      MemberStatus.hadir => (color: pk.info, icon: Icons.login, label: t.teamStatusPresent),
      MemberStatus.selesai => (color: pk.okText, icon: Icons.check_circle, label: t.teamStatusDone),
    };

/// US-13 "Tim hari ini": counts, members with status/time; PM actions: absenkan (US-14) and koreksi
/// (US-15, online only). Tap a member → their monthly recap.
class TeamTodayView extends ConsumerStatefulWidget {
  const TeamTodayView({super.key});

  @override
  ConsumerState<TeamTodayView> createState() => _TeamTodayViewState();
}

class _TeamTodayViewState extends ConsumerState<TeamTodayView> {
  MemberStatus? _filter;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(teamTodayProvider(null));
    final profile = ref.watch(currentProfileProvider);
    final attendanceOn = ref.watch(attendanceEnabledAnyProvider);
    final pmOnBehalf = profile?.canAttendOnBehalf ?? false;
    final canOnBehalf = pmOnBehalf && attendanceOn;
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(teamTodayProvider(null)),
      child: AsyncBody<TeamToday>(
        value: value,
        onRetry: () => ref.invalidate(teamTodayProvider(null)),
        data: (team) {
          final members = [
            for (final m in team.members)
              if (_filter == null || m.status == _filter) m,
          ];
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            children: [
              Row(
                children: [
                  const PkIconChip(icon: Icons.groups_outlined, tone: PkTone.primary, size: 40),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      '${formatDateOnly(team.date)}${team.holidayName == null ? '' : ' · ${team.holidayName}'}',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilterChip(
                    key: const Key('team-filter-all'),
                    label: Text(t.teamAll(team.total)),
                    selected: _filter == null,
                    onSelected: (_) => setState(() => _filter = null),
                  ),
                  for (final (s, n) in [
                    (MemberStatus.belumAbsen, team.belumAbsen),
                    (MemberStatus.hadir, team.hadir),
                    (MemberStatus.selesai, team.selesai),
                  ])
                    Builder(
                      builder: (context) {
                        final v = memberStatusVisual(s, t, context.pk);
                        return FilterChip(
                          key: Key('team-filter-${s.name}'),
                          avatar: Icon(v.icon, size: 18, color: v.color),
                          label: Text('${v.label} $n'),
                          selected: _filter == s,
                          onSelected: (sel) => setState(() => _filter = sel ? s : null),
                        );
                      },
                    ),
                ],
              ),
              if (pmOnBehalf) ...[
                const SizedBox(height: 12),
                // Flag "Absensi dari APK" off for the PT(s): the button stays visible but disabled, with the
                // reason, instead of disappearing (the server would reject an on-behalf check-in anyway).
                FilledButton.tonalIcon(
                  key: const Key('team-on-behalf'),
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                  onPressed: canOnBehalf ? () => context.push('/attendance/on-behalf') : null,
                  icon: const Icon(Icons.how_to_reg),
                  label: Text(t.onBehalfAction),
                ),
                if (!attendanceOn)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Row(
                      key: const Key('team-on-behalf-disabled'),
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.info_outline, size: 16, color: Theme.of(context).colorScheme.outline),
                        const SizedBox(width: 6),
                        Expanded(child: Text(t.onBehalfDisabled, style: Theme.of(context).textTheme.bodySmall)),
                      ],
                    ),
                  ),
              ],
              const SizedBox(height: 16),
              if (members.isEmpty) PkEmptyState(icon: Icons.group_off_outlined, message: t.teamEmpty),
              for (final m in members) _MemberCard(member: m, date: team.date, zone: team.timezone),
            ],
          );
        },
      ),
    );
  }
}

class _MemberCard extends ConsumerWidget {
  const _MemberCard({required this.member, required this.date, required this.zone});
  final TeamMember member;
  final String date;
  final String zone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final m = member;
    final v = memberStatusVisual(m.status, t, context.pk);
    // MC3: roles and the check-in flag of the member's PT; "self" = any of the user's employees.
    final profile = ref.watch(currentProfileProvider)?.forCompany(m.companyId);
    final attendanceOn = ref.watch(attendanceEnabledForProvider(m.companyId));
    final isSelf =
        (ref.watch(accountProfileProvider)?.employeeIds ?? const <int>{}).contains(m.employee.id) ||
        profile?.employee?.id == m.employee.id;
    final canCorrect = (profile?.canCorrectAttendance ?? false) && !isSelf;
    final canOnBehalf =
        (profile?.canAttendOnBehalf ?? false) && attendanceOn && !isSelf && m.status != MemberStatus.selesai;
    final marks = [
      for (final l in m.locations) ...[
        if (l.checkIn != null) (l, AttendanceKind.checkIn, l.checkIn!),
        if (l.checkOut != null) (l, AttendanceKind.checkOut, l.checkOut!),
      ],
    ];
    final tone = switch (m.status) {
      MemberStatus.belumAbsen => PkTone.warn,
      MemberStatus.hadir => PkTone.info,
      MemberStatus.selesai => PkTone.ok,
    };
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final times = [
      if (m.checkInLocal != null) '${t.teamIn} ${m.checkInLocal}',
      if (m.checkOutLocal != null) '${t.teamOut} ${m.checkOutLocal}',
    ];
    return PkCard(
      key: Key('team-member-${m.employee.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push('/attendance/recap/${m.employee.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PkAvatar(name: m.employee.name, size: 44),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CompanyChipLead(companyId: m.companyId),
                        Flexible(
                          child: Text(
                            m.employee.name,
                            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ),
                    if (times.isNotEmpty)
                      Text(times.join(' · '), style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                    if (m.assigned.isNotEmpty)
                      Text(
                        m.assigned.map((a) => a.label).join(', '),
                        style: muted,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              PkPill(label: v.label, tone: tone, icon: v.icon),
            ],
          ),
          if (m.lateMinutes > 0 || m.onBehalf || m.corrected)
            Padding(
              padding: const EdgeInsets.only(top: 8, left: 56),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  if (m.lateMinutes > 0)
                    PkPill(icon: Icons.alarm, label: t.recapLateBy(m.lateMinutes), tone: PkTone.warn),
                  if (m.onBehalf) PkPill(icon: Icons.how_to_reg, label: t.teamOnBehalfTag),
                  if (m.corrected) PkPill(icon: Icons.edit_calendar, label: t.teamCorrectedTag),
                ],
              ),
            ),
          if (canOnBehalf || (canCorrect && marks.isNotEmpty))
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (canOnBehalf)
                    FilledButton.tonalIcon(
                      key: Key('team-absenkan-${m.employee.id}'),
                      style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                      onPressed: () => context.push(
                        '/attendance/on-behalf?employee=${m.employee.id}'
                        '&kind=${m.status == MemberStatus.hadir ? 'check_out' : 'check_in'}',
                      ),
                      icon: const Icon(Icons.how_to_reg),
                      label: Text(m.status == MemberStatus.hadir ? t.onBehalfCheckOut : t.onBehalfCheckIn),
                    ),
                  if (canCorrect)
                    for (final (l, kind, mark) in marks)
                      OutlinedButton.icon(
                        key: Key('team-correct-${mark.id}'),
                        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
                        onPressed: () =>
                            showDialog<bool>(
                              context: context,
                              builder: (_) => CorrectionDialog(
                                attendanceId: mark.id,
                                kind: kind,
                                localDate: date,
                                currentIso: mark.time,
                                zone: zone,
                                title: '${m.employee.name} · ${l.location.label}',
                              ),
                            ).then((ok) {
                              if (ok == true) ref.invalidate(teamTodayProvider(null));
                            }),
                        icon: const Icon(Icons.edit_calendar),
                        label: Text(
                          '${kind == AttendanceKind.checkIn ? t.teamIn : t.teamOut} ${localHm(mark.time, zone)}',
                        ),
                      ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// US-15 (T10) correction of one time: same local date, reason mandatory, online only. The server
/// refuses own attendance, other teams, future times and other dates.
class CorrectionDialog extends ConsumerStatefulWidget {
  const CorrectionDialog({
    super.key,
    required this.attendanceId,
    required this.kind,
    required this.localDate,
    required this.currentIso,
    required this.zone,
    required this.title,
  });
  final int attendanceId;
  final AttendanceKind kind;
  final String localDate;
  final String currentIso;
  final String zone;
  final String title;

  @override
  ConsumerState<CorrectionDialog> createState() => _CorrectionDialogState();
}

class _CorrectionDialogState extends ConsumerState<CorrectionDialog> {
  final _reason = TextEditingController();
  late TimeOfDay _time;
  String? _error;
  bool _busy = false;
  final _key = const Uuid().v7();

  @override
  void initState() {
    super.initState();
    final t = DateTime.tryParse(widget.currentIso)?.toUtc().add(offsetForZone(widget.zone));
    _time = t == null ? const TimeOfDay(hour: 8, minute: 0) : TimeOfDay(hour: t.hour, minute: t.minute);
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final t = AppLocalizations.of(context);
    final reason = _reason.text.trim();
    if (reason.length < 3) {
      setState(() => _error = t.reasonTooShort);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(attendanceApiProvider)
          .correct(
            widget.attendanceId,
            newTimeUtc: localToUtcIso(widget.localDate, _time.hour, _time.minute, offsetForZone(widget.zone)),
            reason: reason,
            idempotencyKey: _key,
          );
      if (!mounted) return;
      await showActionResult(context, message: t.correctionSaved, action: t.correctionSaveAction);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
      await showActionError(context, e, action: t.correctionSaveAction);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final online = ref.watch(connectivityProvider);
    final hm = '${_time.hour.toString().padLeft(2, '0')}.${_time.minute.toString().padLeft(2, '0')}';
    return AlertDialog(
      title: Text(widget.kind == AttendanceKind.checkIn ? t.correctionTitleIn : t.correctionTitleOut),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.title, style: Theme.of(context).textTheme.bodySmall),
            Text(t.correctionOld(formatDateOnly(widget.localDate), localHm(widget.currentIso, widget.zone))),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              key: const Key('correction-time'),
              onPressed: _busy
                  ? null
                  : () async {
                      final picked = await showTimePicker(context: context, initialTime: _time);
                      if (picked != null) setState(() => _time = picked);
                    },
              icon: const Icon(Icons.schedule),
              label: Text(t.correctionNew('$hm ${zoneAbbrev(widget.zone)}')),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('correction-reason'),
              controller: _reason,
              maxLength: 500,
              decoration: InputDecoration(labelText: t.correctionReason, helperText: t.correctionReasonHelp),
            ),
            if (_error != null)
              Text(
                _error!,
                key: const Key('correction-error'),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            if (!online) Text(t.needsInternet, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: Text(t.cancel)),
        FilledButton(
          key: const Key('correction-save'),
          onPressed: _busy || !online ? null : _submit,
          child: Text(t.confirmActionYes(actionPhrase(t.correctionSaveAction))),
        ),
      ],
    );
  }
}

/// Monthly recap of a team member (route /attendance/recap/:employeeId).
class MemberRecapScreen extends StatelessWidget {
  const MemberRecapScreen({super.key, required this.employeeId});
  final int employeeId;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.recapMemberTitle)),
      body: RecapView(employeeId: employeeId),
    );
  }
}
