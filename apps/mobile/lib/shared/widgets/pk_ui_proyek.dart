import 'package:flutter/material.dart';

import '../../app/theme.dart';
import 'pk_ui.dart';

/// D2510 restyle, group "proyek" (projects, RAP, cash, loans): small building blocks on top of the kit in
/// [pk_ui.dart] that these screens share — money text style, label/value rows with a keyed value, soft notes,
/// a timeline step and the compact KPI tiles of the list headers. Colours from the theme only.

/// Bold, tabular-figure money style on top of [base] (default `titleSmall`).
TextStyle? pkAmountStyle(BuildContext context, {TextStyle? base, Color? color, double? fontSize}) =>
    (base ?? Theme.of(context).textTheme.titleSmall)?.copyWith(
      fontWeight: FontWeight.w700,
      color: color,
      fontSize: fontSize,
      fontFeatures: const [FontFeature.tabularFigures()],
    );

/// Muted secondary line ("PJ/… · 12 Okt · Budi").
TextStyle? pkMetaStyle(BuildContext context) {
  final theme = Theme.of(context);
  return theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
}

/// Bold card title (Space Grotesk via the theme's title styles).
TextStyle? pkTitleStyle(BuildContext context) =>
    Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, fontSize: 15, height: 1.3);

/// [PkInfoRow] whose value is one [Text] carrying [valueKey] (tests read the value by key).
class PkKeyRow extends StatelessWidget {
  const PkKeyRow(this.label, this.value, {super.key, this.valueKey, this.style});
  final String label;
  final String value;
  final Key? valueKey;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) => PkInfoRow(
    label: label,
    value: Text(value, key: valueKey, style: style),
  );
}

/// Thin divider between the rows of a detail card.
class PkListDivider extends StatelessWidget {
  const PkListDivider({super.key});

  @override
  Widget build(BuildContext context) => Divider(height: 1, color: context.pk.border);
}

/// Soft tinted note (info / warn / bad) with an icon: hints, rejection reasons, "same PM" notes.
class PkNote extends StatelessWidget {
  const PkNote(this.text, {super.key, this.tone = PkTone.info, this.icon, this.margin = const EdgeInsets.only(top: 8)});
  final String text;
  final PkTone tone;
  final IconData? icon;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    final c = pkToneColors(context, tone == PkTone.primary ? PkTone.info : tone);
    final glyph =
        icon ??
        switch (tone) {
          PkTone.warn => Icons.warning_amber_rounded,
          PkTone.bad => Icons.error_outline,
          PkTone.ok => Icons.check_circle_outline,
          _ => Icons.info_outline,
        };
    return Padding(
      padding: margin,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(PkRadius.sm + 2)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(glyph, size: 18, color: c.fg),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                text,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: c.fg, fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// State of a [PkTimelineStep].
enum PkStepState { todo, waiting, done, bad }

/// One step of an approval timeline: tinted round icon, connector line to the next step, title + subtitle.
class PkTimelineStep extends StatelessWidget {
  const PkTimelineStep({
    super.key,
    required this.title,
    required this.subtitle,
    this.state = PkStepState.todo,
    this.last = false,
  });
  final String title;
  final String subtitle;
  final PkStepState state;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (IconData icon, PkTone tone) = switch (state) {
      PkStepState.bad => (Icons.close_rounded, PkTone.bad),
      PkStepState.done => (Icons.check_rounded, PkTone.ok),
      PkStepState.waiting => (Icons.hourglass_top_rounded, PkTone.warn),
      PkStepState.todo => (Icons.more_horiz_rounded, PkTone.neutral),
    };
    final line = state == PkStepState.done ? context.pk.okText.withValues(alpha: 0.5) : context.pk.border;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 28,
            child: Column(
              children: [
                PkIconChip(icon: icon, tone: tone, size: 28, round: true),
                if (!last)
                  Expanded(
                    child: Container(width: 2, margin: const EdgeInsets.symmetric(vertical: 2), color: line),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(top: 3, bottom: last ? 0 : 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: pkMetaStyle(context)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact KPI tile of a list header (Pinjaman, Tutup buku): icon chip, label, value, supporting line.
class PkMiniKpi extends StatelessWidget {
  const PkMiniKpi({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.sub,
    this.tone = PkTone.info,
    this.onTap,
  });
  final Object icon;
  final String label;
  final String value;
  final String? sub;
  final PkTone tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return PkCard(
      onTap: onTap,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              PkIconChip(icon: icon, tone: tone, size: 30),
              const Spacer(),
              if (onTap != null) Icon(Icons.chevron_right, size: 18, color: theme.colorScheme.outline),
            ],
          ),
          const SizedBox(height: 8),
          Text(label, style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 2),
          Text(value, style: pkAmountStyle(context, base: theme.textTheme.titleMedium, fontSize: 16)),
          if (sub != null && sub!.isNotEmpty) ...[const SizedBox(height: 2), Text(sub!, style: pkMetaStyle(context))],
        ],
      ),
    );
  }
}

/// Header KPIs: the first two side by side (same height), the rest full width below.
class PkKpiRow extends StatelessWidget {
  const PkKpiRow({super.key, required this.children, this.spacing = 10});
  final List<Widget> children;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    if (children.length < 2) return Column(children: children);
    final twoCols = MediaQuery.textScalerOf(context).scale(16) <= 20;
    final pair = twoCols
        ? IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: children[0]),
                SizedBox(width: spacing),
                Expanded(child: children[1]),
              ],
            ),
          )
        : Column(
            children: [
              children[0],
              SizedBox(height: spacing),
              children[1],
            ],
          );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        pair,
        for (final w in children.skip(2)) ...[SizedBox(height: spacing), w],
      ],
    );
  }
}

/// Section title inside a list page (bold, with an optional muted line under it).
class PkListTitle extends StatelessWidget {
  const PkListTitle(this.title, {super.key, this.sub, this.padding = const EdgeInsets.only(top: 16, bottom: 8)});
  final String title;
  final String? sub;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700, fontSize: 17)),
          if (sub != null) ...[const SizedBox(height: 2), Text(sub!, style: pkMetaStyle(context))],
        ],
      ),
    );
  }
}
