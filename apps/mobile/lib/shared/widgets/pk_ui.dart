import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/theme.dart';
import '../icons/iconsax.dart';

/// D2510 UI kit (Banani reference "Project Monitoring Hub", web palette kept): hero band, surface cards, icon chips,
/// status pills, KPI tiles, section headers, progress bars and quick actions. Every screen builds on these so the
/// restyle stays consistent; colours come from the theme only ([PkColors], [ColorScheme]).

/// Colour role of a pill, icon chip or progress bar.
enum PkTone { primary, info, ok, warn, bad, neutral }

/// Background / foreground pair of a [PkTone] (soft fill + readable text, solid for [PkTone.primary]).
({Color bg, Color fg}) pkToneColors(BuildContext context, PkTone tone) {
  final pk = context.pk;
  final scheme = Theme.of(context).colorScheme;
  return switch (tone) {
    PkTone.primary => (bg: scheme.primary, fg: scheme.onPrimary),
    PkTone.info => (bg: pk.infoBg, fg: pk.infoOn),
    PkTone.ok => (bg: pk.okBg, fg: pk.okOn),
    PkTone.warn => (bg: pk.warnBg, fg: pk.warnOn),
    PkTone.bad => (bg: pk.badBg, fg: pk.badOn),
    PkTone.neutral => (bg: scheme.surfaceContainerHigh, fg: scheme.onSurface),
  };
}

/// Glyph of a chip / action: a Material [IconData] or an Iconsax [PkIconData].
Widget pkGlyph(Object icon, {required double size, required Color color}) => switch (icon) {
  final PkIconData d => PkIcon(d, size: size, color: color),
  final IconData d => Icon(d, size: size, color: color),
  _ => SizedBox.square(dimension: size),
};

/// Deep-blue band at the top of the main screens (Beranda, Dashboard): rounded bottom corners, light status bar
/// icons, content padded below the status bar.
class PkHeroHeader extends StatelessWidget {
  const PkHeroHeader({super.key, required this.child, this.padding = const EdgeInsets.fromLTRB(20, 16, 20, 20)});
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    final top = MediaQuery.paddingOf(context).top;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [pk.hero, pk.heroEnd]),
          borderRadius: const BorderRadius.vertical(bottom: Radius.circular(PkRadius.lg)),
        ),
        child: Padding(
          padding: padding.copyWith(top: padding.top + top),
          child: DefaultTextStyle.merge(
            style: TextStyle(color: pk.onHero),
            child: IconTheme.merge(
              data: IconThemeData(color: pk.onHero),
              child: child,
            ),
          ),
        ),
      ),
    );
  }
}

/// Round translucent button on the hero band (bell, switcher).
class PkHeroIconButton extends StatelessWidget {
  const PkHeroIconButton({super.key, required this.child, required this.onPressed, this.tooltip});
  final Widget child;
  final VoidCallback? onPressed;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    final button = Material(
      color: pk.onHero.withValues(alpha: 0.15),
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: SizedBox.square(
          dimension: 44,
          child: Center(
            child: IconTheme.merge(
              data: IconThemeData(color: pk.onHero, size: 22),
              child: child,
            ),
          ),
        ),
      ),
    );
    return tooltip == null ? button : Tooltip(message: tooltip, child: button);
  }
}

/// Pill on the hero band: [strong] = light-blue fill with dark text (role), otherwise translucent outline.
class PkHeroPill extends StatelessWidget {
  const PkHeroPill({super.key, required this.label, this.icon, this.strong = false, this.dot = false});
  final String label;
  final IconData? icon;
  final bool strong;
  final bool dot;

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    final fg = strong ? pk.onHeroPill : pk.onHero;
    return Container(
      padding: EdgeInsets.fromLTRB(icon != null && strong ? 4 : 10, 4, 10, 4),
      decoration: BoxDecoration(
        color: strong ? pk.heroPill : pk.onHero.withValues(alpha: 0.12),
        border: strong ? null : Border.all(color: pk.onHero.withValues(alpha: 0.22)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null && strong)
            Container(
              width: 20,
              height: 20,
              margin: const EdgeInsets.only(right: 6),
              decoration: BoxDecoration(color: pk.onHeroPill, shape: BoxShape.circle),
              child: Icon(icon, size: 12, color: pk.heroPill),
            )
          else if (icon != null) ...[
            Icon(icon, size: 14, color: fg),
            const SizedBox(width: 6),
          ] else if (dot) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(color: pk.heroPill, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(color: fg, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

/// White card with a hairline border; tappable when [onTap] is given (the whole card is one target).
class PkCard extends StatelessWidget {
  const PkCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
    this.radius = PkRadius.md,
    this.color,
    this.margin = EdgeInsets.zero,
  });
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final double radius;
  final Color? color;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radius),
      side: BorderSide(color: pk.border),
    );
    return Padding(
      padding: margin,
      child: Material(
        color: color ?? pk.card,
        shape: shape,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// Square (radius 8) or round icon badge in a [PkTone].
class PkIconChip extends StatelessWidget {
  const PkIconChip({super.key, required this.icon, this.tone = PkTone.info, this.size = 36, this.round = false});
  final Object icon;
  final PkTone tone;
  final double size;
  final bool round;

  @override
  Widget build(BuildContext context) {
    final c = pkToneColors(context, tone);
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: c.bg,
        shape: round ? BoxShape.circle : BoxShape.rectangle,
        borderRadius: round ? null : BorderRadius.circular(size >= 40 ? 12 : PkRadius.sm),
      ),
      child: pkGlyph(icon, size: size * 0.5, color: c.fg),
    );
  }
}

/// Small rounded status label ("On track", "Mendesak", "Menunggu Direktur").
class PkPill extends StatelessWidget {
  const PkPill({super.key, required this.label, this.tone = PkTone.neutral, this.icon});
  final String label;
  final PkTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = pkToneColors(context, tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 13, color: c.fg), const SizedBox(width: 3)],
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall
                  ?.copyWith(color: c.fg, fontWeight: FontWeight.w700, fontSize: 12, height: 1.3),
            ),
          ),
        ],
      ),
    );
  }
}

/// Red count bubble (approvals waiting, badges on menu entries).
class PkCountBadge extends StatelessWidget {
  const PkCountBadge(this.count, {super.key});
  final int count;

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    return Container(
      constraints: const BoxConstraints(minWidth: 22),
      height: 22,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      alignment: Alignment.center,
      decoration: BoxDecoration(color: pk.bad, borderRadius: BorderRadius.circular(11)),
      child: Text(
        count > 99 ? '99+' : '$count',
        style: Theme.of(context).textTheme.labelSmall
            ?.copyWith(color: const Color(0xFFFFFFFF), fontWeight: FontWeight.w700, fontSize: 12, height: 1),
      ),
    );
  }
}

/// Section title row: heading, optional count bubble, optional "Lihat semua ›" link.
class PkSectionHeader extends StatelessWidget {
  const PkSectionHeader({
    super.key,
    required this.title,
    this.count,
    this.actionLabel,
    this.onAction,
    this.padding = const EdgeInsets.only(top: 20, bottom: 10),
  });
  final String title;
  final int? count;
  final String? actionLabel;
  final VoidCallback? onAction;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: padding,
      child: Row(
        children: [
          Flexible(
            child: Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700, fontSize: 17)),
          ),
          if (count != null && count! > 0) ...[const SizedBox(width: 8), PkCountBadge(count!)],
          const Spacer(),
          if (actionLabel != null)
            InkWell(
              onTap: onAction,
              borderRadius: BorderRadius.circular(PkRadius.sm),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 40),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(actionLabel!, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary)),
                      Icon(Icons.chevron_right, size: 18, color: theme.colorScheme.primary),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Compact KPI tile: icon chip, label, big value, supporting line.
class PkKpiTile extends StatelessWidget {
  const PkKpiTile({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.tone = PkTone.info,
    this.sub,
    this.subColor,
    this.onTap,
    this.footer,
  });
  final Object icon;
  final String label;
  final String value;
  final PkTone tone;
  final String? sub;
  final Color? subColor;
  final VoidCallback? onTap;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return PkCard(
      onTap: onTap,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              PkIconChip(icon: icon, tone: tone, size: 34),
              const Spacer(),
              if (onTap != null) Icon(Icons.chevron_right, size: 18, color: theme.colorScheme.outline),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700, fontSize: 19, height: 1.2),
          ),
          if (sub != null)
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Text(
                sub!,
                style: theme.textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                  color: subColor ?? theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          if (footer != null) Padding(padding: const EdgeInsets.only(top: 8), child: footer),
        ],
      ),
    );
  }
}

/// Two equal columns on phones (one column for very large text); cells of a row share the row height.
class PkTwoColumnGrid extends StatelessWidget {
  const PkTwoColumnGrid({super.key, required this.children, this.spacing = 10});
  final List<Widget> children;
  final double spacing;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, c) {
      final twoCols = c.maxWidth >= 300 && MediaQuery.textScalerOf(context).scale(16) <= 20;
      if (!twoCols) {
        return Column(
          children: [
            for (final w in children)
              Padding(
                padding: EdgeInsets.only(bottom: spacing),
                child: w,
              ),
          ],
        );
      }
      return Column(
        children: [
          for (var i = 0; i < children.length; i += 2)
            Padding(
              padding: EdgeInsets.only(bottom: spacing),
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(child: children[i]),
                    SizedBox(width: spacing),
                    Expanded(child: i + 1 < children.length ? children[i + 1] : const SizedBox.shrink()),
                  ],
                ),
              ),
            ),
        ],
      );
    },
  );
}

/// Rounded progress bar (budget used, physical progress); [value] 0..1.
class PkProgressBar extends StatelessWidget {
  const PkProgressBar({super.key, required this.value, this.color, this.height = 8});
  final double value;
  final Color? color;
  final double height;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ClipRRect(
      borderRadius: BorderRadius.circular(height),
      child: LinearProgressIndicator(
        value: value.clamp(0, 1).toDouble(),
        minHeight: height,
        color: color ?? scheme.primary,
        backgroundColor: scheme.surfaceContainerHighest,
      ),
    );
  }
}

/// One quick action: round tonal icon over a short bold label, in a bordered card.
class PkQuickAction extends StatelessWidget {
  const PkQuickAction({super.key, required this.icon, required this.label, required this.onTap, this.badge = 0});
  final Object icon;
  final String label;
  final VoidCallback onTap;
  final int badge;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return PkCard(
      onTap: onTap,
      padding: const EdgeInsets.fromLTRB(4, 12, 4, 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: scheme.secondaryContainer, shape: BoxShape.circle),
                child: pkGlyph(icon, size: 20, color: scheme.onSecondaryContainer),
              ),
              if (badge > 0) Positioned(top: -6, right: -10, child: PkCountBadge(badge)),
            ],
          ),
          const SizedBox(height: 8),
          PkWordFitText(
            label,
            maxLines: 2,
            maxWidth: _PkQuickCell.labelWidthOf(context),
            style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700, height: 1.2),
          ),
        ],
      ),
    );
  }
}

/// Centred label that never breaks inside a word: when its longest word is wider than the box, the font shrinks
/// (down to 75 %) until that word fits ("Persetujuan" in a quarter-width tile). Give [maxWidth] when the widget sits
/// under an [IntrinsicHeight] (it then measures without a LayoutBuilder).
class PkWordFitText extends StatelessWidget {
  const PkWordFitText(this.text, {super.key, this.style, this.maxLines = 2, this.maxWidth});
  final String text;
  final TextStyle? style;
  final int maxLines;
  final double? maxWidth;

  Widget _fitted(BuildContext context, double width) {
    final base = DefaultTextStyle.of(context).style.merge(style);
    final scaler = MediaQuery.textScalerOf(context);
    var widest = 0.0;
    for (final word in text.split(RegExp(r'\s+'))) {
      final tp = TextPainter(
        text: TextSpan(text: word, style: base),
        textDirection: Directionality.of(context),
        textScaler: scaler,
        maxLines: 1,
      )..layout();
      if (tp.width > widest) widest = tp.width;
      tp.dispose();
    }
    final size = base.fontSize ?? 14;
    final fitted = widest > width && width.isFinite && width > 0
        ? (size * width / widest).clamp(size * 0.75, size).toDouble()
        : size;
    return Text(
      text,
      textAlign: TextAlign.center,
      maxLines: maxLines,
      overflow: TextOverflow.ellipsis,
      style: base.copyWith(fontSize: fitted),
    );
  }

  @override
  Widget build(BuildContext context) {
    final w = maxWidth;
    if (w != null) return _fitted(context, w);
    return LayoutBuilder(builder: (context, box) => _fitted(context, box.maxWidth));
  }
}

/// Row of up to four [PkQuickAction]s of equal width and height. The cell width is measured here, outside the
/// [IntrinsicHeight] (a LayoutBuilder cannot report intrinsic sizes), and handed to the labels via [_PkQuickCell].
class PkQuickActions extends StatelessWidget {
  const PkQuickActions({super.key, required this.children});
  final List<Widget> children;

  static const _gap = 10.0;

  @override
  Widget build(BuildContext context) {
    if (children.isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, box) => _PkQuickCell(
        width: (box.maxWidth - 3 * _gap) / 4,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < 4; i++) ...[
                if (i > 0) const SizedBox(width: _gap),
                Expanded(child: i < children.length ? children[i] : const SizedBox.shrink()),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _PkQuickCell extends InheritedWidget {
  const _PkQuickCell({required this.width, required super.child});
  final double width;

  /// Label width inside a [PkQuickAction] (cell minus its 2 × 4 dp padding), null outside [PkQuickActions].
  static double? labelWidthOf(BuildContext context) {
    final w = context.dependOnInheritedWidgetOfExactType<_PkQuickCell>()?.width;
    return w == null ? null : w - 8;
  }

  @override
  bool updateShouldNotify(_PkQuickCell old) => old.width != width;
}

/// Initials in a circle (no photos in the app).
class PkAvatar extends StatelessWidget {
  const PkAvatar({super.key, required this.name, this.size = 40, this.onHero = false});
  final String name;
  final double size;
  final bool onHero;

  static String initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    final first = parts.first.characters.first;
    final last = parts.length > 1 ? parts.last.characters.first : '';
    return (first + last).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    final scheme = Theme.of(context).colorScheme;
    final bg = onHero ? pk.heroPill : scheme.secondaryContainer;
    final fg = onHero ? pk.onHeroPill : scheme.onSecondaryContainer;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
      child: Text(
        initials(name),
        style: TextStyle(
          fontFamily: PkFonts.heading,
          fontWeight: FontWeight.w700,
          fontSize: size * 0.38,
          color: fg,
          height: 1,
        ),
      ),
    );
  }
}

/// Label / value row inside a detail card (label left, value right-aligned, wraps).
class PkInfoRow extends StatelessWidget {
  const PkInfoRow({super.key, required this.label, required this.value, this.valueStyle});
  final String label;
  final Widget value;
  final TextStyle? valueStyle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 2,
            child: Text(label, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 3,
            child: DefaultTextStyle.merge(
              textAlign: TextAlign.end,
              style: (valueStyle ?? theme.textTheme.bodyMedium)?.copyWith(fontWeight: FontWeight.w600),
              child: Align(alignment: Alignment.centerRight, child: value),
            ),
          ),
        ],
      ),
    );
  }
}

/// Titled white card for a detail screen section ("Rincian pengajuan", "Pemohon").
class PkSectionCard extends StatelessWidget {
  const PkSectionCard({super.key, required this.title, required this.child, this.trailing, this.icon});
  final String title;
  final Widget child;
  final Widget? trailing;
  final Object? icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return PkCard(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (icon != null) ...[PkIconChip(icon: icon!, size: 30), const SizedBox(width: 10)],
              Expanded(
                child: Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              ),
              ?trailing,
            ],
          ),
          const SizedBox(height: 8),
          child,
        ],
      ),
    );
  }
}

/// Empty / nothing-to-do state: tinted icon, message, optional action.
class PkEmptyState extends StatelessWidget {
  const PkEmptyState({super.key, required this.icon, required this.message, this.action});
  final Object icon;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          PkIconChip(icon: icon, size: 64, round: true),
          const SizedBox(height: 14),
          Text(
            message,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    );
  }
}
