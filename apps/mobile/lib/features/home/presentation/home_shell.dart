import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/offline_banner.dart';
import '../../auth/application/auth_controller.dart';

/// Branch indices of the StatefulShellRoute (see app/router.dart).
abstract final class Tabs {
  static const home = 0;
  static const requests = 1;
  static const inbox = 2;
  static const queue = 3;
  static const profile = 4;
}

/// Bottom navigation per role; only the tabs a role needs are shown (branches stay the same).
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(currentProfileProvider);
    final tabs = <(int, NavigationDestination)>[
      (
        Tabs.home,
        NavigationDestination(
          icon: const Icon(Icons.home_outlined),
          selectedIcon: const Icon(Icons.home),
          label: t.navHome,
        ),
      ),
      (
        Tabs.requests,
        NavigationDestination(
          icon: const Icon(Icons.receipt_long_outlined),
          selectedIcon: const Icon(Icons.receipt_long),
          label: t.navRequests,
        ),
      ),
      if (profile?.hasApprovalInbox ?? false)
        (
          Tabs.inbox,
          NavigationDestination(
            icon: const Icon(Icons.fact_check_outlined),
            selectedIcon: const Icon(Icons.fact_check),
            label: t.navInbox,
          ),
        ),
      if (profile?.canCreateRequests ?? false)
        (
          Tabs.queue,
          NavigationDestination(
            icon: const Icon(Icons.cloud_sync_outlined),
            selectedIcon: const Icon(Icons.cloud_sync),
            label: t.navQueue,
          ),
        ),
      (
        Tabs.profile,
        NavigationDestination(
          icon: const Icon(Icons.person_outline),
          selectedIcon: const Icon(Icons.person),
          label: t.navProfile,
        ),
      ),
    ];
    var selected = tabs.indexWhere((e) => e.$1 == shell.currentIndex);
    if (selected < 0) selected = 0;
    return Scaffold(
      body: Column(
        children: [
          const OfflineBanner(),
          Expanded(child: shell),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: selected,
        destinations: [for (final e in tabs) e.$2],
        onDestinationSelected: (i) => shell.goBranch(tabs[i].$1, initialLocation: tabs[i].$1 == shell.currentIndex),
      ),
    );
  }
}
