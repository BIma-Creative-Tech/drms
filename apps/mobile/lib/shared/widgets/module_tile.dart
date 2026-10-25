import 'package:flutter/material.dart';

import '../../app/theme.dart';
import '../icons/iconsax.dart';

/// Home launcher tile (web `LauncherGrid` / `.pk-tile`, ADR 0015): white Iconsax Bulk glyph on the 135°
/// gradient of a web module, label, optional secondary line and a count badge. Replaces the former
/// BigActionButton list; the whole card is one ≥ 48 dp touch target. [compact] (D2510 Beranda, Banani
/// "MenuButtonGrid"): centred glyph over a short label, three per row.
class ModuleTile extends StatelessWidget {
  const ModuleTile({
    super.key,
    required this.module,
    required this.icon,
    required this.label,
    this.subtitle,
    this.badge,
    this.onPressed,
    this.compact = false,
  });

  final PkModule module;
  final PkIconData icon;
  final String label;
  final String? subtitle;
  final String? badge;
  final VoidCallback? onPressed;
  final bool compact;

  Widget _glyph(BuildContext context, double size) {
    final theme = Theme.of(context);
    final pk = context.pk;
    final g = pk.gradient(module);
    return Stack(
      clipBehavior: Clip.none,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(PkTokens.radius),
            gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [g.from, g.to]),
            boxShadow: [
              BoxShadow(
                color: g.from.withValues(alpha: pk.brightness == Brightness.dark ? 0.25 : 0.35),
                blurRadius: 14,
                offset: const Offset(0, 6),
                spreadRadius: -6,
              ),
            ],
          ),
          child: SizedBox.square(
            dimension: size,
            child: Center(
              child: PkIcon(icon, size: size * 0.54, color: const Color(0xFFFFFFFF)),
            ),
          ),
        ),
        if (badge != null)
          Positioned(
            top: -6,
            right: -10,
            child: Container(
              constraints: const BoxConstraints(minWidth: 24),
              height: 24,
              padding: const EdgeInsets.symmetric(horizontal: 7),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: pk.bad,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: pk.card, width: 2),
              ),
              child: Text(
                badge!,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: const Color(0xFFFFFFFF),
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                  height: 1,
                ),
              ),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: compact
            ? Padding(
                padding: const EdgeInsets.fromLTRB(6, 14, 6, 12),
                child: Column(
                  children: [
                    _glyph(context, 46),
                    const SizedBox(height: 10),
                    Text(
                      label,
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.labelLarge?.copyWith(fontSize: 13, height: 1.2),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: muted?.copyWith(fontSize: 11, height: 1.2),
                      ),
                    ],
                  ],
                ),
              )
            : Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 12, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _glyph(context, 52),
                    const SizedBox(height: 12),
                    Text(
                      label,
                      style: theme.textTheme.titleMedium?.copyWith(fontSize: 15, height: 1.25),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 4),
                      Text(subtitle!, style: muted, maxLines: 3, overflow: TextOverflow.ellipsis),
                    ],
                  ],
                ),
              ),
      ),
    );
  }
}

/// Launcher grid: 2 columns on phones, 3 from 600 dp ([compact]: 3, 4 from 600 dp); tiles of a row share the row
/// height. Staggered entrance (fade + rise, built-in animation APIs) that is skipped when the system asks for reduced
/// motion ([MediaQuery.disableAnimationsOf]).
class ModuleGrid extends StatefulWidget {
  const ModuleGrid({super.key, required this.children, this.spacing = 12, this.compact = false});
  final List<Widget> children;
  final double spacing;
  final bool compact;

  @override
  State<ModuleGrid> createState() => _ModuleGridState();
}

class _ModuleGridState extends State<ModuleGrid> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 560));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _c.value = 1;
    } else if (_c.status == AnimationStatus.dismissed) {
      _c.forward();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Widget _animated(int index, int count, Widget child) {
    // Web: stagger 35 ms, rise 14 px; here each tile gets a 40 % slice of the run.
    final start = count <= 1 ? 0.0 : (index / count) * 0.6;
    final curve = CurvedAnimation(
      parent: _c,
      curve: Interval(start, start + 0.4, curve: Curves.easeOutCubic),
    );
    return FadeTransition(
      opacity: curve,
      child: AnimatedBuilder(
        animation: curve,
        builder: (context, c) => Transform.translate(
          offset: Offset(0, 14 * (1 - curve.value)),
          child: Transform.scale(scale: 0.96 + 0.04 * curve.value, child: c),
        ),
        child: child,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final wide = box.maxWidth >= 600;
      final cols = widget.compact ? (wide ? 4 : 3) : (wide ? 3 : 2);
      final items = widget.children;
      final rows = <Widget>[];
      for (var r = 0; r * cols < items.length; r++) {
        final cells = <Widget>[];
        for (var k = 0; k < cols; k++) {
          final i = r * cols + k;
          if (k > 0) cells.add(SizedBox(width: widget.spacing));
          cells.add(Expanded(child: i < items.length ? _animated(i, items.length, items[i]) : const SizedBox()));
        }
        if (r > 0) rows.add(SizedBox(height: widget.spacing));
        rows.add(
          IntrinsicHeight(
            child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: cells),
          ),
        );
      }
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
    },
  );
}

/// Non-production marker (staging APK) in the accent tint — app bar and login.
class StagingBadge extends StatelessWidget {
  const StagingBadge({super.key, required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: scheme.tertiaryContainer, borderRadius: BorderRadius.circular(999)),
      child: Text(
        label,
        style: theme.textTheme.labelSmall?.copyWith(
          color: scheme.onTertiaryContainer,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.8,
        ),
      ),
    );
  }
}
