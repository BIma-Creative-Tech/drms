import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../companies/presentation/company_chip.dart';
import '../application/attendance_providers.dart';
import '../domain/attendance_recap.dart';
import 'recap_view.dart';

/// Roles of a PT with a team / office attendance scope (server `attendanceScope`: PM team; Admin, Admin Staff,
/// Direktur — also via Owner —, Finance the whole PT).
bool _teamAttendanceIn(CompanyMembership c) =>
    c.has(Role.pm) ||
    c.has(Role.owner) ||
    c.has(Role.principal) ||
    c.has(Role.finance) ||
    c.has(Role.admin) ||
    c.has(Role.adminStaff);

enum _RecapMode { own, team }

/// DRMS 26/10 #3: the "Rekap" tab / "Rekap bulanan" menu. Office users (Owner, Direktur, Finance, Admin, Admin Staff)
/// usually have no own employee, and `GET /attendance/me` answered 409 after a long retry loop — like the web
/// `/admin/absensi/rekap` they now get the team month ([TeamRecapView]); a user with an own employee AND a team
/// scope (e.g. a PM) switches "Tim" / "Saya" (team first, like the web); own employee only → own recap; neither → the
/// message at once, no network call.
class RecapHub extends ConsumerStatefulWidget {
  const RecapHub({super.key});

  @override
  ConsumerState<RecapHub> createState() => _RecapHubState();
}

class _RecapHubState extends ConsumerState<RecapHub> {
  _RecapMode _mode = _RecapMode.team;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(currentProfileProvider);
    // No profile (should not happen behind the login gate): the previous behaviour, own recap.
    final own = profile?.hasOwnEmployee ?? true;
    final team = profile?.canSeeTeamAttendance ?? false;
    if (!own && !team) {
      return ListView(
        children: [
          PkEmptyState(
            key: const Key('recap-no-employee'),
            icon: Icons.person_off_outlined,
            message: t.recapNoEmployee,
          ),
        ],
      );
    }
    if (!team) return const RecapView();
    if (!own) return const TeamRecapView();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: SegmentedButton<_RecapMode>(
            key: const Key('recap-mode'),
            showSelectedIcon: false,
            segments: [
              ButtonSegment(
                value: _RecapMode.team,
                icon: const Icon(Icons.groups_outlined),
                label: Text(t.recapViewTeam, key: const Key('recap-mode-team')),
              ),
              ButtonSegment(
                value: _RecapMode.own,
                icon: const Icon(Icons.person_outline),
                label: Text(t.recapViewOwn, key: const Key('recap-mode-own')),
              ),
            ],
            selected: {_mode},
            onSelectionChanged: (s) => setState(() => _mode = s.first),
          ),
        ),
        Expanded(child: _mode == _RecapMode.team ? const TeamRecapView() : const RecapView()),
      ],
    );
  }
}

/// DRMS 26/10 #3: "Rekap bulanan tim" — month switcher, PT filter (when the team scope spans several selected PTs),
/// name search and per employee present / absent / late of the month (`GET /attendance/team-month`, same list and
/// numbers as the web team grid). Tap → the employee's recap of that month.
class TeamRecapView extends ConsumerStatefulWidget {
  const TeamRecapView({super.key, this.initialMonth});
  final String? initialMonth;

  @override
  ConsumerState<TeamRecapView> createState() => _TeamRecapViewState();
}

class _TeamRecapViewState extends ConsumerState<TeamRecapView> {
  late String _month = widget.initialMonth ?? monthOf(DateTime.now());
  int? _company;
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(currentProfileProvider);
    final pts = [
      for (final c in profile?.scopedCompanies ?? const <CompanyMembership>[])
        if (_teamAttendanceIn(c)) c,
    ];
    // A PT no longer in the selection (switcher changed) falls back to the whole selection.
    final company = pts.any((c) => c.id == _company) ? _company : null;
    final key = (_month, company);
    final value = ref.watch(teamMonthProvider(key));
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(teamMonthProvider(key)),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          RecapMonthSwitcher(month: _month, keyPrefix: 'team-recap', onChanged: (m) => setState(() => _month = m)),
          if (pts.length > 1)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  ChoiceChip(
                    key: const Key('team-recap-pt-all'),
                    label: Text(t.companyAll),
                    selected: company == null,
                    onSelected: (_) => setState(() => _company = null),
                  ),
                  for (final c in pts)
                    ChoiceChip(
                      key: Key('team-recap-pt-${c.id}'),
                      label: Text(c.code),
                      tooltip: c.name,
                      selected: c.id == company,
                      onSelected: (_) => setState(() => _company = c.id),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 12),
          ListSearchField(key: const Key('team-recap-search'), onChanged: (q) => setState(() => _query = q)),
          const SizedBox(height: 12),
          AsyncBody<TeamMonth>(
            value: value,
            onRetry: () => ref.invalidate(teamMonthProvider(key)),
            data: (m) {
              final q = _query.toLowerCase();
              final rows = [
                for (final e in m.employees)
                  if (q.isEmpty ||
                      e.employee.name.toLowerCase().contains(q) ||
                      e.employee.code.toLowerCase().contains(q))
                    e,
              ];
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      t.teamRecapCount(rows.length),
                      key: const Key('team-recap-count'),
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                  ),
                  if (rows.isEmpty) PkEmptyState(icon: Icons.group_off_outlined, message: t.teamRecapEmpty),
                  for (final e in rows) _TeamRecapCard(entry: e, month: m.month.isEmpty ? _month : m.month),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _TeamRecapCard extends StatelessWidget {
  const _TeamRecapCard({required this.entry, required this.month});
  final TeamMonthEntry entry;
  final String month;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = entry.summary;
    final e = entry.employee;
    return PkCard(
      key: Key('team-recap-${e.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push('/attendance/recap/${e.id}?month=$month'),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PkAvatar(name: e.name, size: 44),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CompanyChipLead(companyId: entry.companyId),
                    // Grids wrap long text, no ellipsis (owner 2026-10-16).
                    Flexible(
                      child: Text(e.name, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                    ),
                  ],
                ),
                if (e.code.isNotEmpty)
                  Text(e.code, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    PkPill(
                      icon: Icons.event_available,
                      tone: PkTone.ok,
                      label: '${t.recapPresent} ${s.presentDays}/${s.workingDays}',
                    ),
                    PkPill(
                      icon: Icons.event_busy,
                      tone: s.absentDays > 0 ? PkTone.bad : PkTone.neutral,
                      label: '${t.recapAbsent} ${t.recapDays(s.absentDays)}',
                    ),
                    PkPill(
                      icon: Icons.alarm,
                      tone: s.lateDays > 0 ? PkTone.warn : PkTone.neutral,
                      label: '${t.recapLate} ${t.recapDays(s.lateDays)}',
                    ),
                    if (s.incompleteDays > 0)
                      PkPill(
                        icon: Icons.pending_actions,
                        label: '${t.recapIncomplete} ${t.recapDays(s.incompleteDays)}',
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 4),
          Icon(Icons.chevron_right, color: theme.colorScheme.outline),
        ],
      ),
    );
  }
}
