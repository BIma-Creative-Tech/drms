import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../dashboard/presentation/charts.dart' show periodLong;
import '../application/attendance_providers.dart';
import '../domain/attendance.dart';
import '../domain/attendance_recap.dart';

/// Visual of a day status: colour + icon + short text (never colour alone).
({Color color, IconData icon, String label}) dayStatusVisual(DayStatus s, AppLocalizations t, ColorScheme scheme) =>
    switch (s) {
      DayStatus.selesai => (color: StatusColors.ok, icon: Icons.check_circle, label: t.recapStatusDone),
      DayStatus.hadir => (color: const Color(0xFF2A78D6), icon: Icons.login, label: t.recapStatusPresent),
      DayStatus.belumAbsen => (color: scheme.outline, icon: Icons.schedule, label: t.recapStatusNotYet),
      DayStatus.tidakHadir => (color: StatusColors.danger, icon: Icons.cancel, label: t.recapStatusAbsent),
      DayStatus.libur => (color: scheme.outline, icon: Icons.beach_access, label: t.recapStatusHoliday),
      DayStatus.tanpaJadwal => (color: scheme.outlineVariant, icon: Icons.remove, label: t.recapStatusNoSchedule),
    };

/// US-09 monthly recap: month switcher, totals and a Monday-first calendar grid. [employeeId] null =
/// own recap (GET /attendance/me); otherwise a team member's (GET /attendance/recap).
class RecapView extends ConsumerStatefulWidget {
  const RecapView({super.key, this.employeeId, this.initialMonth});
  final int? employeeId;
  final String? initialMonth;

  @override
  ConsumerState<RecapView> createState() => _RecapViewState();
}

class _RecapViewState extends ConsumerState<RecapView> {
  late String _month = widget.initialMonth ?? monthOf(DateTime.now());

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final key = (widget.employeeId, _month);
    final value = ref.watch(attendanceRecapProvider(key));
    final isCurrent = _month == monthOf(DateTime.now());
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(attendanceRecapProvider(key)),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              IconButton.filledTonal(
                key: const Key('recap-prev'),
                tooltip: t.recapPrevMonth,
                onPressed: () => setState(() => _month = shiftMonth(_month, -1)),
                icon: const Icon(Icons.chevron_left),
              ),
              Expanded(
                child: Text(
                  periodLong(_month),
                  key: const Key('recap-month'),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              IconButton.filledTonal(
                key: const Key('recap-next'),
                tooltip: t.recapNextMonth,
                onPressed: isCurrent ? null : () => setState(() => _month = shiftMonth(_month, 1)),
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
          const SizedBox(height: 12),
          AsyncBody<AttendanceRecap>(
            value: value,
            onRetry: () => ref.invalidate(attendanceRecapProvider(key)),
            data: (r) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.employeeId != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(r.employee.name, style: Theme.of(context).textTheme.titleMedium),
                  ),
                if (r.scheduleStart != null)
                  Text(
                    t.recapSchedule(r.scheduleName ?? '-', r.scheduleStart!, r.scheduleEnd ?? '-', r.toleranceMin),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                const SizedBox(height: 8),
                _SummaryGrid(s: r.summary),
                const SizedBox(height: 16),
                RecapCalendar(recap: r),
                const SizedBox(height: 8),
                const _Legend(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryGrid extends StatelessWidget {
  const _SummaryGrid({required this.s});
  final AttendanceSummary s;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final tiles = <(IconData, String, String, String?)>[
      (Icons.event_available, t.recapPresent, '${s.presentDays}/${s.workingDays}', t.recapWorkingDays),
      (Icons.timer, t.recapWorkHours, hoursMinutes(s.workMinutes), null),
      (Icons.alarm, t.recapLate, t.recapDays(s.lateDays), s.lateMinutes > 0 ? t.recapMinutes(s.lateMinutes) : null),
      (
        Icons.directions_walk,
        t.recapEarlyLeave,
        t.recapDays(s.earlyLeaveDays),
        s.earlyLeaveMinutes > 0 ? t.recapMinutes(s.earlyLeaveMinutes) : null,
      ),
      (Icons.event_busy, t.recapAbsent, t.recapDays(s.absentDays), null),
      (Icons.pending_actions, t.recapIncomplete, t.recapDays(s.incompleteDays), null),
    ];
    return LayoutBuilder(
      builder: (context, c) {
        final cols = c.maxWidth >= 520 ? 3 : 2;
        final w = (c.maxWidth - (cols - 1) * 8) / cols;
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final (icon, label, value, sub) in tiles)
              SizedBox(
                width: w,
                child: Card(
                  elevation: 0,
                  margin: EdgeInsets.zero,
                  color: Theme.of(context).colorScheme.surfaceContainerLow,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(icon, size: 18, color: Theme.of(context).colorScheme.primary),
                            const SizedBox(width: 6),
                            Expanded(child: Text(label, style: Theme.of(context).textTheme.labelMedium)),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          value,
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        if (sub != null) Text(sub, style: Theme.of(context).textTheme.bodySmall),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// Monday-first month grid; each cell = day number, status icon and the check-in time. Tap → details.
class RecapCalendar extends StatelessWidget {
  const RecapCalendar({super.key, required this.recap});
  final AttendanceRecap recap;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final byDay = {for (final d in recap.days) d.dayOfMonth: d};
    final blanks = leadingBlanks(recap.month);
    final count = daysInMonth(recap.month);
    final cells = blanks + count;
    final rows = (cells / 7).ceil();
    final weekdays = [t.dowMon, t.dowTue, t.dowWed, t.dowThu, t.dowFri, t.dowSat, t.dowSun];
    return Column(
      children: [
        Row(
          children: [
            for (final w in weekdays)
              Expanded(
                child: Text(w, textAlign: TextAlign.center, style: theme.textTheme.labelSmall),
              ),
          ],
        ),
        const SizedBox(height: 4),
        for (var r = 0; r < rows; r++)
          Row(
            children: [
              for (var c = 0; c < 7; c++)
                Expanded(
                  child: Builder(
                    builder: (context) {
                      final dayNo = r * 7 + c - blanks + 1;
                      if (dayNo < 1 || dayNo > count) return const SizedBox(height: 64);
                      return _DayCell(dayNo: dayNo, day: byDay[dayNo], zone: recap.timezone);
                    },
                  ),
                ),
            ],
          ),
      ],
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({required this.dayNo, this.day, this.zone});
  final int dayNo;
  final AttendanceDay? day;
  final String? zone;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final d = day;
    if (d == null) {
      // Future day of the current month: not in the recap yet.
      return SizedBox(
        height: 64,
        child: Center(
          child: Text('$dayNo', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
        ),
      );
    }
    final v = dayStatusVisual(d.status, t, theme.colorScheme);
    final marks = d.lateMinutes > 0 || d.onBehalf || d.corrected;
    return Padding(
      padding: const EdgeInsets.all(2),
      child: Semantics(
        button: true,
        label: '${formatDateOnly(d.date)}: ${v.label}${d.checkInLocal == null ? '' : ', ${d.checkInLocal}'}',
        excludeSemantics: true,
        child: Material(
          color: v.color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(10),
          child: InkWell(
            key: Key('recap-day-${d.date}'),
            borderRadius: BorderRadius.circular(10),
            onTap: () => showModalBottomSheet<void>(
              context: context,
              showDragHandle: true,
              isScrollControlled: true,
              builder: (_) => DayDetailSheet(day: d, zone: zone),
            ),
            child: SizedBox(
              height: 60,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('$dayNo', style: theme.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700)),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(v.icon, size: 14, color: v.color),
                      if (marks) Icon(Icons.circle, size: 5, color: StatusColors.warning),
                    ],
                  ),
                  if (d.checkInLocal != null)
                    FittedBox(child: Text(d.checkInLocal!, style: theme.textTheme.labelSmall)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend();
  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Wrap(
      spacing: 12,
      runSpacing: 6,
      children: [
        for (final s in DayStatus.values)
          Builder(
            builder: (context) {
              final v = dayStatusVisual(s, t, theme.colorScheme);
              return Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(v.icon, size: 14, color: v.color),
                  const SizedBox(width: 4),
                  Text(v.label, style: theme.textTheme.bodySmall),
                ],
              );
            },
          ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.circle, size: 6, color: StatusColors.warning),
            const SizedBox(width: 4),
            Text(t.recapLegendMark, style: theme.textTheme.bodySmall),
          ],
        ),
      ],
    );
  }
}

/// Details of one day: per location check-in / check-out, late / early minutes, on-behalf, corrections.
class DayDetailSheet extends StatelessWidget {
  const DayDetailSheet({super.key, required this.day, this.zone});
  final AttendanceDay day;
  final String? zone;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final d = day;
    final v = dayStatusVisual(d.status, t, theme.colorScheme);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(formatDateOnly(d.date), style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Row(
              children: [
                Icon(v.icon, color: v.color, size: 18),
                const SizedBox(width: 6),
                Text(v.label),
                if (d.holidayName != null) Text(' · ${d.holidayName}'),
              ],
            ),
            const SizedBox(height: 8),
            if (d.checkInLocal != null || d.checkOutLocal != null)
              Text(t.recapInOut(d.checkInLocal ?? '—', d.checkOutLocal ?? '—')),
            if (d.workMinutes != null) Text(t.recapWorked(hoursMinutes(d.workMinutes!))),
            if (d.lateMinutes > 0)
              Text(t.recapLateBy(d.lateMinutes), style: const TextStyle(color: StatusColors.warning)),
            if (d.earlyLeaveMinutes > 0)
              Text(t.recapEarlyBy(d.earlyLeaveMinutes), style: const TextStyle(color: StatusColors.warning)),
            if (d.onBehalf) Text(t.recapOnBehalf(d.onBehalfBy.join(', '))),
            if (d.corrected) Text(t.recapCorrected),
            if (d.flags.isNotEmpty) Text(t.recapFlags(d.flags.join(', ')), style: theme.textTheme.bodySmall),
            for (final l in d.locations)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(l.location.kind == SiteKind.project ? Icons.apartment : Icons.business),
                title: Text(l.location.label),
                subtitle: Text(
                  '${t.attendanceCheckIn}: ${localHm(l.checkIn?.time, zone)} · ${t.attendanceCheckOut}: ${localHm(l.checkOut?.time, zone)}',
                ),
              ),
          ],
        ),
      ),
    );
  }
}
