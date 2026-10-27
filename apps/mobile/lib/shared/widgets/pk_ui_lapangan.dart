import 'package:flutter/material.dart';

import '../../app/theme.dart';
import 'pk_ui.dart';

/// D2510 kit additions of the field-work screens (Absensi, Laporan Lapangan, Progress). Built on [pk_ui.dart];
/// colours only from the theme ([PkTone] soft fills).

/// Soft-tone notice line in a rounded box: icon + text (never colour alone). [PkTone.info] for hints,
/// [PkTone.warn] for "check this", [PkTone.bad] for refusals / errors.
class PkNotice extends StatelessWidget {
  const PkNotice({
    super.key,
    required this.text,
    this.tone = PkTone.info,
    this.icon,
    this.margin = const EdgeInsets.symmetric(vertical: 6),
    this.dense = false,
  });
  final String text;
  final PkTone tone;
  final IconData? icon;
  final EdgeInsets margin;

  /// Smaller text and padding (helper lines inside a form section).
  final bool dense;

  static IconData defaultIcon(PkTone tone) => switch (tone) {
    PkTone.bad => Icons.error_outline,
    PkTone.warn => Icons.warning_amber_rounded,
    PkTone.ok => Icons.check_circle_outline,
    _ => Icons.info_outline,
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = pkToneColors(context, tone);
    final style = dense ? theme.textTheme.bodySmall : theme.textTheme.bodyMedium;
    return Padding(
      padding: margin,
      child: DecoratedBox(
        decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(dense ? PkRadius.sm + 2 : 12)),
        child: Padding(
          padding: dense ? const EdgeInsets.symmetric(horizontal: 10, vertical: 8) : const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: Icon(icon ?? defaultIcon(tone), size: dense ? 16 : 20, color: c.fg),
              ),
              SizedBox(width: dense ? 8 : 10),
              Expanded(
                child: Text(text, style: style?.copyWith(color: c.fg, height: 1.35)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Muted helper line with a leading glyph (radius, attendance type, schedule): no box.
class PkMetaLine extends StatelessWidget {
  const PkMetaLine({super.key, required this.icon, required this.text, this.textKey});
  final IconData icon;
  final String text;
  final Key? textKey;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = theme.colorScheme.onSurfaceVariant;
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(icon, size: 16, color: color),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              key: textKey,
              style: theme.textTheme.bodySmall?.copyWith(color: color, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

/// Soft-tone headline card (today's attendance status): tone fill, radius 20, no border.
class PkToneHeroCard extends StatelessWidget {
  const PkToneHeroCard({super.key, required this.tone, required this.child, this.padding = const EdgeInsets.all(18)});
  final PkTone tone;
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final c = pkToneColors(context, tone);
    return DecoratedBox(
      decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(PkRadius.lg)),
      child: Padding(
        padding: padding,
        child: DefaultTextStyle.merge(
          style: TextStyle(color: c.fg),
          child: IconTheme.merge(
            data: IconThemeData(color: c.fg),
            child: child,
          ),
        ),
      ),
    );
  }
}
