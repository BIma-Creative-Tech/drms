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
import '../../../shared/widgets/async_body.dart';
import '../../app_config/application/app_config_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../application/attendance_providers.dart';
import '../domain/attendance.dart';
import '../domain/attendance_recap.dart';
import 'recap_view.dart';

({Color color, IconData icon, String label}) memberStatusVisual(MemberStatus s, AppLocalizations t, ColorScheme c) =>
    switch (s) {
      MemberStatus.belumAbsen => (color: StatusColors.warning, icon: Icons.schedule, label: t.teamStatusNotYet),
      MemberStatus.hadir => (color: const Color(0xFF2A78D6), icon: Icons.login, label: t.teamStatusPresent),
      MemberStatus.selesai => (color: StatusColors.ok, icon: Icons.check_circle, label: t.teamStatusDone),
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
    final attendanceOn = ref.watch(appConfigProvider).value?.syncAttendance ?? false;
    final canOnBehalf = (profile?.canAttendOnBehalf ?? false) && attendanceOn;
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
              Text(
                '${formatDateOnly(team.date)}${team.holidayName == null ? '' : ' · ${team.holidayName}'}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
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
                        final v = memberStatusVisual(s, t, Theme.of(context).colorScheme);
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
              if (canOnBehalf) ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  key: const Key('team-on-behalf'),
                  onPressed: () => context.push('/attendance/on-behalf'),
                  icon: const Icon(Icons.how_to_reg),
                  label: Text(t.onBehalfAction),
                ),
              ],
              const SizedBox(height: 12),
              if (members.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Center(child: Text(t.teamEmpty)),
                ),
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
    final v = memberStatusVisual(m.status, t, theme.colorScheme);
    final profile = ref.watch(currentProfileProvider);
    final attendanceOn = ref.watch(appConfigProvider).value?.syncAttendance ?? false;
    final isSelf = profile?.employee?.id == m.employee.id;
    final canCorrect = (profile?.canCorrectAttendance ?? false) && !isSelf;
    final canOnBehalf =
        (profile?.canAttendOnBehalf ?? false) && attendanceOn && !isSelf && m.status != MemberStatus.selesai;
    final marks = [
      for (final l in m.locations) ...[
        if (l.checkIn != null) (l, AttendanceKind.checkIn, l.checkIn!),
        if (l.checkOut != null) (l, AttendanceKind.checkOut, l.checkOut!),
      ],
    ];
    return Card(
      key: Key('team-member-${m.employee.id}'),
      child: InkWell(
        onTap: () => context.push('/attendance/recap/${m.employee.id}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor: v.color.withValues(alpha: 0.15),
                    child: Icon(v.icon, color: v.color),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(m.employee.name, style: theme.textTheme.titleSmall),
                        Text(
                          [
                            v.label,
                            if (m.checkInLocal != null) '${t.teamIn} ${m.checkInLocal}',
                            if (m.checkOutLocal != null) '${t.teamOut} ${m.checkOutLocal}',
                          ].join(' · '),
                        ),
                        if (m.assigned.isNotEmpty)
                          Text(
                            m.assigned.map((a) => a.label).join(', '),
                            style: theme.textTheme.bodySmall,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              if (m.lateMinutes > 0 || m.onBehalf || m.corrected)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Wrap(
                    spacing: 6,
                    children: [
                      if (m.lateMinutes > 0) _Tag(icon: Icons.alarm, text: t.recapLateBy(m.lateMinutes)),
                      if (m.onBehalf) _Tag(icon: Icons.how_to_reg, text: t.teamOnBehalfTag),
                      if (m.corrected) _Tag(icon: Icons.edit_calendar, text: t.teamCorrectedTag),
                    ],
                  ),
                ),
              if (canOnBehalf || (canCorrect && marks.isNotEmpty))
                Padding(
                  padding: const EdgeInsets.only(top: 8),
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
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) =>
      Chip(avatar: Icon(icon, size: 16), label: Text(text), visualDensity: VisualDensity.compact);
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
      showSnack(context, t.correctionSaved);
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
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
          child: Text(t.save),
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
