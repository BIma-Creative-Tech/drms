import 'package:flutter/material.dart';

import '../../app/theme.dart';
import 'pk_ui.dart';

/// D2510 "akun" group (Profil, Pengguna, Klien/Vendor, Laporan, master data, module landing pages): grouped menu rows
/// after the Banani reference "AppSideMenu" — a muted group label above a white card of rows, each row a tonal icon
/// chip, bold title, muted subtitle and a chevron or count bubble. Colours come from the theme only.

/// Group of [PkMenuRow]s (or any rows): optional label, then one bordered card with hairline dividers between rows.
/// Pass only the rows that are shown (no empty placeholders: each child gets a divider).
class PkMenuGroup extends StatelessWidget {
  const PkMenuGroup({
    super.key,
    this.title,
    required this.children,
    this.trailing,
    this.padding = const EdgeInsets.only(bottom: 16),
  });
  final String? title;
  final List<Widget> children;

  /// Next to the label (e.g. a count).
  final Widget? trailing;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final rows = children;
    if (rows.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null) PkGroupLabel(title!, trailing: trailing),
          PkCard(
            padding: EdgeInsets.zero,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final (i, r) in rows.indexed) ...[if (i > 0) const PkRowDivider(), r],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Muted bold label above a group of rows / cards ("Akun", "Aplikasi", a module section).
class PkGroupLabel extends StatelessWidget {
  const PkGroupLabel(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.labelLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.2,
              ),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Hairline between rows of a card, inset past the icon chip.
class PkRowDivider extends StatelessWidget {
  const PkRowDivider({super.key, this.indent = 64});
  final double indent;

  @override
  Widget build(BuildContext context) =>
      Divider(height: 1, thickness: 1, indent: indent, endIndent: 0, color: context.pk.border);
}

/// One menu / list row: tonal icon chip, bold title, muted subtitle (wraps), then [trailing], a count bubble
/// ([badge] > 0) or a chevron when tappable. The whole row is one touch target (≥ 56 dp).
class PkMenuRow extends StatelessWidget {
  const PkMenuRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.tone = PkTone.info,
    this.badge = 0,
    this.trailing,
    this.onTap,
    this.chevron,
    this.titleStyle,
    this.subtitleColor,
  });
  final Object icon;
  final String title;
  final String? subtitle;
  final PkTone tone;
  final int badge;
  final Widget? trailing;
  final VoidCallback? onTap;

  /// Defaults to "tappable and no badge".
  final bool? chevron;
  final TextStyle? titleStyle;
  final Color? subtitleColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final showChevron = chevron ?? (onTap != null && badge == 0);
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 60),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 11, 12, 11),
          child: Row(
            children: [
              PkIconChip(icon: icon, tone: tone, size: 38),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      style:
                          titleStyle ??
                          theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, fontSize: 15, height: 1.25),
                    ),
                    if (subtitle != null && subtitle!.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          subtitle!,
                          style: theme.textTheme.bodySmall?.copyWith(color: subtitleColor ?? muted, height: 1.3),
                        ),
                      ),
                  ],
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 8), trailing!],
              if (badge > 0) ...[const SizedBox(width: 8), PkCountBadge(badge)],
              if (showChevron) ...[const SizedBox(width: 4), Icon(Icons.chevron_right, size: 20, color: muted)],
            ],
          ),
        ),
      ),
    );
  }
}

/// Label above value (stacked; long values wrap) — record / report detail fields where values are long text.
class PkStackedField extends StatelessWidget {
  const PkStackedField({super.key, required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 2),
          Text(value, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
