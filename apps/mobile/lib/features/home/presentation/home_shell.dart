import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/offline_banner.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../finance/application/finance_providers.dart';

/// Branch indices of the StatefulShellRoute (see app/router.dart).
abstract final class Tabs {
  static const home = 0;
  static const dashboard = 1;
  static const requests = 2;
  static const inbox = 3;
  static const transfer = 4;
  static const attendance = 5;
  static const projects = 6;
  static const profile = 7;
}

/// Bottom bar per role (user 2026-10-18), highest role of the selected PTs ([UserProfile.navKind]).
List<int> tabsFor(NavKind kind) => switch (kind) {
  NavKind.owner || NavKind.admin => const [Tabs.home, Tabs.dashboard, Tabs.projects, Tabs.profile],
  NavKind.direktur ||
  NavKind.pm => const [Tabs.home, Tabs.dashboard, Tabs.requests, Tabs.inbox, Tabs.projects, Tabs.profile],
  NavKind.finance => const [Tabs.home, Tabs.dashboard, Tabs.requests, Tabs.transfer, Tabs.profile],
  NavKind.staff => const [Tabs.home, Tabs.requests, Tabs.attendance, Tabs.projects, Tabs.profile],
  NavKind.operator => const [Tabs.home, Tabs.attendance, Tabs.profile],
};

/// Bottom navigation: only the tabs of the role (branches stay the same). Iconsax glyphs on the primary-tint pill of
/// the theme (ADR 0015); labels always shown (up to six tabs).
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final kind = ref.watch(currentProfileProvider)?.navKind ?? NavKind.operator;
    final tabs = tabsFor(kind);
    // D2510: waiting counts on the Persetujuan / Antrian Transfer tabs (Banani BottomNav badge).
    final inboxCount = tabs.contains(Tabs.inbox) ? ref.watch(inboxProvider).value?.items.length ?? 0 : 0;
    final transferCount = tabs.contains(Tabs.transfer) ? ref.watch(transferQueueProvider).value?.length ?? 0 : 0;
    NavigationDestination dest(int tab) {
      final (PkIconData icon, PkIconData selected, String label) = switch (tab) {
        Tabs.home => (PkIcons.homeLinear, PkIcons.home, t.navHome),
        Tabs.dashboard => (PkIcons.report, PkIcons.report, t.navDashboard),
        Tabs.requests => (PkIcons.requestsLinear, PkIcons.requests, t.navRequests),
        Tabs.inbox => (PkIcons.approvalLinear, PkIcons.approval, t.navInbox),
        Tabs.transfer => (PkIcons.finance, PkIcons.finance, t.navTransfer),
        Tabs.attendance => (PkIcons.attendance, PkIcons.attendance, t.navAttendance),
        Tabs.projects => (PkIcons.project, PkIcons.project, t.navProjects),
        _ => (PkIcons.profileLinear, PkIcons.profile, t.navProfile),
      };
      final count = switch (tab) {
        Tabs.inbox => inboxCount,
        Tabs.transfer => transferCount,
        _ => 0,
      };
      Widget glyph(PkIconData d) => count > 0
          ? Badge(key: Key('nav-badge-$tab'), label: Text(count > 99 ? '99+' : '$count'), child: PkIcon(d))
          : PkIcon(d);
      return NavigationDestination(
        key: Key('nav-tab-$tab'),
        icon: glyph(icon),
        selectedIcon: glyph(selected),
        label: label,
      );
    }

    // A branch outside the role's bar (e.g. the inbox opened from a Beranda tile) keeps Beranda highlighted.
    var selected = tabs.indexOf(shell.currentIndex);
    if (selected < 0) selected = 0;
    return Scaffold(
      body: Column(
        children: [
          const OfflineBanner(),
          Expanded(child: shell),
        ],
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant)),
        ),
        // Up to six tabs on a 360 dp phone: a smaller label that may wrap to two lines ("Antrian / Transfer").
        child: NavigationBarTheme(
          data: _compact(NavigationBarTheme.of(context), tabs.length),
          child: NavigationBar(
            selectedIndex: selected,
            labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
            destinations: [for (final tab in tabs) dest(tab)],
            onDestinationSelected: (i) => shell.goBranch(tabs[i], initialLocation: tabs[i] == shell.currentIndex),
          ),
        ),
      ),
    );
  }

  static NavigationBarThemeData _compact(NavigationBarThemeData base, int count) {
    if (count < 5) return base;
    return base.copyWith(
      height: 76,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => base.labelTextStyle?.resolve(s)?.copyWith(fontSize: 11, height: 1.15),
      ),
    );
  }
}
