import 'package:flutter/material.dart';

import '../../app/theme.dart';
import 'pk_ui.dart';

/// D2510 keuangan (requests, approvals, Finance, addenda) additions to the UI kit ([PkCard] & co.): a soft tinted
/// notice card and a list row card. Colours come from the theme only.

/// Soft tinted notice ("Menunggu keputusan Anda", policy notes, Finance revision notes): round icon on the tone fill,
/// bold title in the tone's text colour, optional body below.
class PkNoticeCard extends StatelessWidget {
  const PkNoticeCard({
    super.key,
    required this.icon,
    required this.title,
    this.body,
    this.tone = PkTone.info,
    this.trailing,
    this.margin = const EdgeInsets.only(bottom: 12),
    this.dense = false,
  });
  final Object icon;
  final Widget title;
  final Widget? body;
  final PkTone tone;
  final Widget? trailing;
  final EdgeInsets margin;

  /// Smaller icon and padding for one-line notes.
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = pkToneColors(context, tone == PkTone.primary ? PkTone.info : tone);
    final iconSize = dense ? 28.0 : 36.0;
    return Container(
      margin: margin,
      padding: EdgeInsets.all(dense ? 10 : 14),
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: BorderRadius.circular(PkRadius.md),
        border: Border.all(color: c.fg.withValues(alpha: 0.18)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: iconSize,
            height: iconSize,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: context.pk.card.withValues(alpha: 0.85), shape: BoxShape.circle),
            child: pkGlyph(icon, size: iconSize * 0.55, color: c.fg),
          ),
          SizedBox(width: dense ? 10 : 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(top: dense ? 4 : 1),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DefaultTextStyle.merge(
                    style: (dense ? theme.textTheme.bodyMedium : theme.textTheme.titleSmall)?.copyWith(
                      color: c.fg,
                      fontWeight: dense ? FontWeight.w500 : FontWeight.w700,
                    ),
                    child: title,
                  ),
                  if (body != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: DefaultTextStyle.merge(
                        style: theme.textTheme.bodyMedium?.copyWith(color: c.fg.withValues(alpha: 0.9)),
                        child: body!,
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 8), trailing!],
        ],
      ),
    );
  }
}

/// One list row as a [PkCard] (the whole card is the tap target): optional leading chip / avatar, bold [title] with
/// the amount right-aligned in bold, muted [subtitle], a wrap of [badges] (pills) and an optional [footer].
class PkListCard extends StatelessWidget {
  const PkListCard({
    super.key,
    required this.title,
    this.leading,
    this.subtitle,
    this.badges = const [],
    this.amount,
    this.amountKey,
    this.trailing,
    this.footer,
    this.onTap,
    this.margin = const EdgeInsets.only(bottom: 10),
  });
  final Widget title;
  final Widget? leading;
  final Widget? subtitle;
  final List<Widget> badges;
  final String? amount;
  final Key? amountKey;
  final Widget? trailing;
  final Widget? footer;
  final VoidCallback? onTap;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant, height: 1.35);
    return PkCard(
      margin: margin,
      onTap: onTap,
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: 12)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: DefaultTextStyle.merge(
                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, height: 1.3),
                        child: title,
                      ),
                    ),
                    if (amount != null) ...[
                      const SizedBox(width: 10),
                      Text(
                        amount!,
                        key: amountKey,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          height: 1.3,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ],
                ),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: DefaultTextStyle.merge(style: muted, child: subtitle!),
                  ),
                if (badges.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: badges,
                    ),
                  ),
                if (footer != null) Padding(padding: const EdgeInsets.only(top: 10), child: footer),
              ],
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 8), trailing!],
        ],
      ),
    );
  }
}

/// Bold right-aligned money text with tabular figures (amounts in info rows and footers).
TextStyle? pkMoneyStyle(BuildContext context, {bool large = false}) {
  final theme = Theme.of(context);
  return (large ? theme.textTheme.titleMedium : theme.textTheme.bodyMedium)?.copyWith(
    fontWeight: FontWeight.w700,
    fontFeatures: const [FontFeature.tabularFigures()],
  );
}
