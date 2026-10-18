import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/module_tile.dart';
import '../../addendum/presentation/addendum_providers.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/domain/request_status.dart';
import '../../field_reports/application/field_providers.dart';
import '../../progress/application/progress_providers.dart';
import '../application/menu_providers.dart';
import '../domain/web_modules.dart';
import '../domain/web_route_map.dart';

/// Counts the APK knows locally (not in the web badges): approval steps waiting for me, and reports of this phone not
/// yet on the server. Keyed by web href.
final localMenuBadgesProvider = Provider.autoDispose<Map<String, int>>((ref) {
  final p = ref.watch(currentProfileProvider);
  if (p == null) return const {};
  final out = <String, int>{};
  if (p.hasApprovalInbox) {
    final n =
        (ref.watch(inboxProvider).value?.items.length ?? 0) + (ref.watch(addendumInboxProvider).value?.length ?? 0);
    if (n > 0) out['/persetujuan'] = n;
  }
  if (p.canReadProgress) {
    final n = ref.watch(openProgressDraftsProvider).value?.length ?? 0;
    if (n > 0) out['/progress/laporan'] = n;
  }
  if (p.hasFieldReports) {
    final n = ref.watch(openFieldDraftsProvider).value?.length ?? 0;
    if (n > 0) out['/laporan-servis'] = n;
  }
  return out;
});

int localModuleBadge(WebModule m, Map<String, int> local) => m.items.fold(0, (n, i) => n + (local[i.href] ?? 0));

/// A module tile: its landing page, or its only item directly (web `ResolvedModule.landing`: ≥ 2 items).
void openWebModule(BuildContext context, WebModule m) {
  final items = m.items;
  if (items.length == 1) {
    openWebMenuItem(context, items.single);
  } else {
    context.push('/modul/${m.id}');
  }
}

/// Opens the APK screen of a web menu item; items without one yet say so.
void openWebMenuItem(BuildContext context, WebMenuItem item) {
  final target = apkTargetFor(item.href);
  if (target == null) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(AppLocalizations.of(context).menuComingSoon(item.label))));
    return;
  }
  if (target.pickRequestType) {
    _pickRequestType(context);
    return;
  }
  final route = target.route!;
  if (isShellRoute(route)) {
    context.go(route);
  } else {
    context.push(route);
  }
}

void _pickRequestType(BuildContext context) {
  final t = AppLocalizations.of(context);
  showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheet) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            key: const Key('menu-new-advance'),
            leading: const PkIcon(PkIcons.advance),
            title: Text(t.actionNewAdvance),
            onTap: () {
              Navigator.of(sheet).pop();
              context.push('/drafts/new?type=${RequestType.advance.code}');
            },
          ),
          ListTile(
            key: const Key('menu-new-reimburse'),
            leading: const PkIcon(PkIcons.reimburse),
            title: Text(t.actionNewReimburse),
            onTap: () {
              Navigator.of(sheet).pop();
              context.push('/drafts/new?type=${RequestType.reimburse.code}');
            },
          ),
        ],
      ),
    ),
  );
}

/// `/modul/:id` — web `ModuleLanding.tsx`: the sections of one module with a tile per item (same labels and order as
/// `/admin/modul/<id>`). Items the APK does not have yet are shown greyed out ("Segera hadir di APK").
class ModuleLandingScreen extends ConsumerWidget {
  const ModuleLandingScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final menu = ref.watch(menuProvider);
    final local = ref.watch(localMenuBadgesProvider);
    final m = menu.value?.where((x) => x.id == id).firstOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(m?.label ?? '')),
      body: switch (menu) {
        AsyncData() when m == null => Center(child: Text(t.homeMenuEmpty)),
        AsyncData() => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: [
            for (final s in m!.sections) ...[
              if (s.label != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8, bottom: 10),
                  child: Text(s.label!, style: Theme.of(context).textTheme.titleMedium),
                ),
              ModuleGrid(
                children: [for (final i in s.items) _ItemTile(module: m, item: i, localBadge: local[i.href] ?? 0)],
              ),
              const SizedBox(height: 16),
            ],
          ],
        ),
        AsyncError() => Center(child: Text(t.homeMenuEmpty)),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.module, required this.item, required this.localBadge});
  final WebModule module;
  final WebMenuItem item;
  final int localBadge;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final ready = apkTargetFor(item.href) != null;
    final n = item.badge + localBadge;
    final tile = ModuleTile(
      key: Key('menu-item-${item.href}'),
      module: module.module,
      icon: item.label.startsWith('+') ? PkIcons.advance : module.icon,
      label: item.label.replaceFirst(RegExp(r'^\+\s*'), ''),
      subtitle: ready ? null : t.menuComingSoonShort,
      badge: n > 0 ? '$n' : null,
      onPressed: () => openWebMenuItem(context, item),
    );
    return ready ? tile : Opacity(opacity: 0.55, child: tile);
  }
}
