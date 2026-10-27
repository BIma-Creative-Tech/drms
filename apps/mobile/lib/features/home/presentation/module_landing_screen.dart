import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_akun.dart';
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

int localModuleBadge(WebModule m, Map<String, int> local) =>
    m.items.fold(0, (n, i) => n + (local[relativeWebHref(i.href)] ?? 0));

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
        AsyncData() when m != null => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: [
            _ModuleHeader(module: m),
            for (final s in m.sections)
              if (s.items.isNotEmpty)
                PkMenuGroup(
                  title: s.label,
                  children: [
                    for (final i in s.items)
                      _ItemTile(module: m, item: i, localBadge: local[relativeWebHref(i.href)] ?? 0),
                  ],
                ),
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
    final tile = PkMenuRow(
      key: Key('menu-item-${item.href}'),
      icon: item.label.startsWith('+') ? PkIcons.advance : module.icon,
      tone: ready ? PkTone.info : PkTone.neutral,
      title: item.label.replaceFirst(RegExp(r'^\+\s*'), ''),
      subtitle: ready ? null : t.menuComingSoonShort,
      badge: n,
      onTap: () => openWebMenuItem(context, item),
    );
    return ready ? tile : Opacity(opacity: 0.55, child: tile);
  }
}

/// Module glyph on its web gradient + the module name and hint (Banani "AppSideMenu" header, light card).
class _ModuleHeader extends StatelessWidget {
  const _ModuleHeader({required this.module});
  final WebModule module;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final g = context.pk.gradient(module.module);
    return PkCard(
      radius: PkRadius.lg,
      margin: const EdgeInsets.only(bottom: 20),
      child: Row(
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(PkRadius.md),
              gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [g.from, g.to]),
            ),
            child: SizedBox.square(
              dimension: 52,
              child: Center(child: PkIcon(module.icon, size: 28, color: const Color(0xFFFFFFFF))),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(module.label, style: theme.textTheme.titleLarge?.copyWith(fontSize: 19)),
                if (module.hint.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      module.hint,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
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
