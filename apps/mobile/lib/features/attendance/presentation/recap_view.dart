import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/photo_viewer.dart';
import '../../dashboard/presentation/charts.dart' show periodLong;
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../application/attendance_providers.dart';
import '../domain/attendance_recap.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_lapangan.dart';
import 'attendance_widgets.dart' show flagsText, siteKindIcon;

/// Visual of a day status: colour + icon + short text (never colour alone).
({Color color, IconData icon, String label}) dayStatusVisual(
  DayStatus s,
  AppLocalizations t,
  ColorScheme scheme,
  PkColors pk,
) => switch (s) {
  DayStatus.selesai => (color: pk.okText, icon: Icons.check_circle, label: t.recapStatusDone),
  DayStatus.hadir => (color: pk.info, icon: Icons.login, label: t.recapStatusPresent),
  DayStatus.belumAbsen => (color: scheme.outline, icon: Icons.schedule, label: t.recapStatusNotYet),
  DayStatus.tidakHadir => (color: pk.badText, icon: Icons.cancel, label: t.recapStatusAbsent),
  DayStatus.libur => (color: scheme.outline, icon: Icons.beach_access, label: t.recapStatusHoliday),
  DayStatus.tanpaJadwal => (color: scheme.outlineVariant, icon: Icons.remove, label: t.recapStatusNoSchedule),
};

/// Soft fill of a day status (calendar cells, day sheet pill).
PkTone dayStatusTone(DayStatus s) => switch (s) {
  DayStatus.selesai => PkTone.ok,
  DayStatus.hadir => PkTone.info,
  DayStatus.tidakHadir => PkTone.bad,
  DayStatus.belumAbsen || DayStatus.libur || DayStatus.tanpaJadwal => PkTone.neutral,
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
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          PkCard(
            padding: const EdgeInsets.all(8),
            child: Row(
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
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
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
          ),
          if (widget.employeeId == null) const _OwnRecapCompanyPicker(),
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
                    child: Row(
                      children: [
                        PkAvatar(name: r.employee.name, size: 40),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            r.employee.name,
                            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ),
                  ),
                if (r.scheduleStart != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: PkMetaLine(
                      icon: Icons.schedule,
                      text: t.recapSchedule(
                        r.scheduleName ?? '-',
                        r.scheduleStart!,
                        r.scheduleEnd ?? '-',
                        r.toleranceMin,
                      ),
                    ),
                  ),
                const SizedBox(height: 8),
                _SummaryGrid(s: r.summary),
                const SizedBox(height: 6),
                PkCard(
                  padding: const EdgeInsets.fromLTRB(10, 14, 10, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      RecapCalendar(recap: r),
                      const SizedBox(height: 10),
                      const Divider(height: 1),
                      const SizedBox(height: 10),
                      const _Legend(),
                    ],
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

class _SummaryGrid extends StatelessWidget {
  const _SummaryGrid({required this.s});
  final AttendanceSummary s;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final tiles = <(IconData, PkTone, String, String, String?)>[
      (Icons.event_available, PkTone.ok, t.recapPresent, '${s.presentDays}/${s.workingDays}', t.recapWorkingDays),
      (Icons.timer, PkTone.info, t.recapWorkHours, hoursMinutes(s.workMinutes), null),
      (
        Icons.alarm,
        PkTone.warn,
        t.recapLate,
        t.recapDays(s.lateDays),
        s.lateMinutes > 0 ? t.recapMinutes(s.lateMinutes) : null,
      ),
      (
        Icons.directions_walk,
        PkTone.warn,
        t.recapEarlyLeave,
        t.recapDays(s.earlyLeaveDays),
        s.earlyLeaveMinutes > 0 ? t.recapMinutes(s.earlyLeaveMinutes) : null,
      ),
      (Icons.event_busy, PkTone.bad, t.recapAbsent, t.recapDays(s.absentDays), null),
      (Icons.pending_actions, PkTone.neutral, t.recapIncomplete, t.recapDays(s.incompleteDays), null),
    ];
    return LayoutBuilder(
      builder: (context, c) {
        final cols = c.maxWidth >= 520 ? 3 : 2;
        final w = (c.maxWidth - (cols - 1) * 10) / cols;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            for (final (icon, tone, label, value, sub) in tiles)
              SizedBox(
                width: w,
                child: _RecapTile(icon: icon, tone: tone, label: label, value: value, sub: sub),
              ),
          ],
        );
      },
    );
  }
}

/// Compact KPI tile of the month: tone chip, label, bold value, supporting line.
class _RecapTile extends StatelessWidget {
  const _RecapTile({required this.icon, required this.tone, required this.label, required this.value, this.sub});
  final IconData icon;
  final PkTone tone;
  final String label;
  final String value;
  final String? sub;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return PkCard(
      padding: const EdgeInsets.all(12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PkIconChip(icon: icon, tone: tone, size: 34),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: theme.textTheme.labelMedium?.copyWith(color: muted)),
                Text(
                  value,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontFamily: PkFonts.heading,
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                  ),
                ),
                if (sub != null) Text(sub!, style: theme.textTheme.labelSmall?.copyWith(color: muted)),
              ],
            ),
          ),
        ],
      ),
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
                child: Text(
                  w,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
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
    final v = dayStatusVisual(d.status, t, theme.colorScheme, context.pk);
    final tone = dayStatusTone(d.status);
    final c = pkToneColors(context, tone);
    final iconColor = tone == PkTone.neutral ? v.color : c.fg;
    final marks = d.lateMinutes > 0 || d.onBehalf || d.corrected;
    return Padding(
      padding: const EdgeInsets.all(2),
      child: Semantics(
        button: true,
        label: '${formatDateOnly(d.date)}: ${v.label}${d.checkInLocal == null ? '' : ', ${d.checkInLocal}'}',
        excludeSemantics: true,
        child: Material(
          color: c.bg,
          borderRadius: BorderRadius.circular(PkRadius.sm + 2),
          child: InkWell(
            key: Key('recap-day-${d.date}'),
            borderRadius: BorderRadius.circular(PkRadius.sm + 2),
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
                  Text(
                    '$dayNo',
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: tone == PkTone.neutral ? null : c.fg,
                    ),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(v.icon, size: 14, color: iconColor),
                      if (marks) Icon(Icons.circle, size: 5, color: context.pk.warnText),
                    ],
                  ),
                  if (d.checkInLocal != null)
                    FittedBox(
                      child: Text(
                        d.checkInLocal!,
                        style: theme.textTheme.labelSmall?.copyWith(color: tone == PkTone.neutral ? null : c.fg),
                      ),
                    ),
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
              final v = dayStatusVisual(s, t, theme.colorScheme, context.pk);
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
            Icon(Icons.circle, size: 6, color: context.pk.warnText),
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
    final v = dayStatusVisual(d.status, t, theme.colorScheme, context.pk);
    final muted = theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              formatDateOnly(d.date),
              style: theme.textTheme.titleLarge?.copyWith(fontFamily: PkFonts.heading, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                PkPill(label: v.label, tone: dayStatusTone(d.status), icon: v.icon),
                if (d.holidayName != null) Text('· ${d.holidayName}', style: muted),
              ],
            ),
            const SizedBox(height: 12),
            if (d.checkInLocal != null || d.checkOutLocal != null)
              Text(
                t.recapInOut(d.checkInLocal ?? '—', d.checkOutLocal ?? '—'),
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
            if (d.workMinutes != null) Text(t.recapWorked(hoursMinutes(d.workMinutes!)), style: muted),
            if (d.lateMinutes > 0 || d.earlyLeaveMinutes > 0 || d.onBehalf || d.corrected) const SizedBox(height: 6),
            if (d.lateMinutes > 0) Text(t.recapLateBy(d.lateMinutes), style: TextStyle(color: context.pk.warnText)),
            if (d.earlyLeaveMinutes > 0)
              Text(t.recapEarlyBy(d.earlyLeaveMinutes), style: TextStyle(color: context.pk.warnText)),
            if (d.onBehalf) Text(t.recapOnBehalf(d.onBehalfBy.join(', '))),
            if (d.corrected) Text(t.recapCorrected),
            if (d.flags.isNotEmpty) Text(t.recapFlags(flagsText(t, d.flags)), style: theme.textTheme.bodySmall),
            if (d.locations.isNotEmpty) const SizedBox(height: 12),
            for (final l in d.locations)
              PkCard(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
                child: Row(
                  children: [
                    PkIconChip(
                      icon: l.outsideArea ? Icons.explore : siteKindIcon(l.location.kind),
                      tone: l.outsideArea ? PkTone.warn : PkTone.info,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l.outsideArea ? '${t.attendanceOutsideArea} (ref. ${l.location.label})' : l.location.label,
                            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            '${t.attendanceCheckIn}: ${localHm(l.checkIn?.time, zone)} · ${t.attendanceCheckOut}: ${localHm(l.checkOut?.time, zone)}',
                            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                    // d1010 (12c): check-in / check-out selfies of this location in the shared viewer.
                    if (l.checkIn != null || l.checkOut != null)
                      IconButton(
                        key: Key('selfie-${l.location.kind.name}-${l.location.id}'),
                        tooltip: t.attendanceSelfieView,
                        icon: const Icon(Icons.photo_outlined),
                        onPressed: () => showPhotoViewer(context, [
                          for (final (label, mark) in [
                            (t.attendanceCheckIn, l.checkIn),
                            (t.attendanceCheckOut, l.checkOut),
                          ])
                            if (mark != null)
                              ViewerPhoto(
                                caption: '$label ${localHm(mark.time, zone)} · ${l.location.label}',
                                builder: (_) => _SelfieFull(attendanceId: mark.id),
                              ),
                        ]),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SelfieFull extends ConsumerWidget {
  const _SelfieFull({required this.attendanceId});
  final int attendanceId;
  @override
  Widget build(BuildContext context, WidgetRef ref) => switch (ref.watch(attendanceSelfieProvider(attendanceId))) {
    AsyncData(:final value) => Image.memory(value, fit: BoxFit.contain),
    AsyncError() => Padding(
      padding: const EdgeInsets.all(24),
      child: Text(
        AppLocalizations.of(context).attendanceSelfieUnavailable,
        style: const TextStyle(color: Colors.white),
        textAlign: TextAlign.center,
      ),
    ),
    _ => const CircularProgressIndicator(),
  };
}

/// MC3: own recap of which PT (the user has one employee per PT) — shown only with employees in several
/// selected PTs.
class _OwnRecapCompanyPicker extends ConsumerWidget {
  const _OwnRecapCompanyPicker();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(currentProfileProvider);
    final pts = [
      for (final c in profile?.scopedCompanies ?? const <CompanyMembership>[])
        if (c.employee != null) c,
    ];
    if (pts.length < 2) return const SizedBox.shrink();
    final chosen = ref.watch(ownRecapCompanyProvider) ?? pts.first.id;
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Wrap(
        spacing: 8,
        runSpacing: 4,
        children: [
          for (final c in pts)
            ChoiceChip(
              key: Key('recap-pt-${c.id}'),
              label: Text(c.code),
              tooltip: c.name,
              selected: c.id == chosen,
              onSelected: (_) => ref.read(ownRecapCompanyProvider.notifier).set(c.id),
            ),
        ],
      ),
    );
  }
}
