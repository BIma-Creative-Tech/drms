import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/format/rupiah.dart';
import '../domain/dashboard.dart';

/// Chart colours (dataviz reference palette, light mode, categorical slots 1 and 2 — the validated
/// adjacent pair). Text never wears these colours; values/labels use the theme's ink.
abstract final class VizColors {
  static const series1 = Color(0xFF2A78D6); // masuk / main series
  static const series2 = Color(0xFFEB6834); // keluar
}

/// Web `shortRupiah` (`apps/web/src/domain/reports/rules.ts`): `Rp 1,2 jt`, `Rp 3 M`, `−Rp 250 rb`.
String formatRupiahShort(int v) {
  final a = v.abs();
  final sign = v < 0 ? '−' : '';
  String trim1(double x) {
    final s = ((x * 10).round() / 10).toStringAsFixed(1);
    return (s.endsWith('.0') ? s.substring(0, s.length - 2) : s).replaceAll('.', ',');
  }

  final body = a >= 1000000000
      ? '${trim1(a / 1000000000)} M'
      : a >= 1000000
      ? '${trim1(a / 1000000)} jt'
      : a >= 1000
      ? '${trim1(a / 1000)} rb'
      : '$a';
  return '${sign}Rp $body';
}

/// `2026-09` → `Sep 26` (axis) — full month name in the readout.
String periodShort(String period) {
  final d = DateTime.tryParse('$period-01');
  return d == null ? period : DateFormat('MMM yy', 'id').format(d);
}

String periodLong(String period) {
  final d = DateTime.tryParse('$period-01');
  return d == null ? period : DateFormat('MMMM yyyy', 'id').format(d);
}

/// Percent with one decimal and a comma (`88,3%`), `—` when unknown.
String pctText(double? v) => v == null ? '—' : '${v.toStringAsFixed(1).replaceAll('.', ',')}%';

/// Small trend line inside a KPI card (no axes; the card states the value). Decorative for screen
/// readers: [semanticsLabel] carries first → last.
class Sparkline extends StatelessWidget {
  const Sparkline({super.key, required this.values, required this.semanticsLabel, this.height = 36});
  final List<int> values;
  final String semanticsLabel;
  final double height;

  @override
  Widget build(BuildContext context) {
    if (values.length < 2) return SizedBox(height: height);
    return Semantics(
      label: semanticsLabel,
      child: SizedBox(
        height: height,
        width: double.infinity,
        child: CustomPaint(painter: _SparkPainter(values, VizColors.series1, Theme.of(context).colorScheme.surface)),
      ),
    );
  }
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.values, this.color, this.surface);
  final List<int> values;
  final Color color;
  final Color surface;

  @override
  void paint(Canvas canvas, Size size) {
    final lo = values.reduce(math.min).toDouble();
    final hi = values.reduce(math.max).toDouble();
    final span = hi - lo == 0 ? 1.0 : hi - lo;
    const pad = 5.0;
    Offset at(int i) => Offset(
      pad + (size.width - 2 * pad) * i / (values.length - 1),
      pad + (size.height - 2 * pad) * (1 - (values[i] - lo) / span),
    );
    final path = Path()..moveTo(at(0).dx, at(0).dy);
    for (var i = 1; i < values.length; i++) {
      path.lineTo(at(i).dx, at(i).dy);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round,
    );
    // Current period: 8px dot with a 2px surface ring.
    final last = at(values.length - 1);
    canvas.drawCircle(last, 5, Paint()..color = surface);
    canvas.drawCircle(last, 4, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_SparkPainter old) => old.values != values || old.color != color;
}

/// Progress of [value] against [max] (e.g. realisasi vs RAB). The number is always shown beside it.
class Meter extends StatelessWidget {
  const Meter({super.key, required this.value, required this.max, this.color});
  final int value;
  final int max;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final f = max <= 0 ? 0.0 : (value / max).clamp(0, 1).toDouble();
    return ExcludeSemantics(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(4),
        child: LinearProgressIndicator(
          value: f,
          minHeight: 8,
          color: color ?? VizColors.series1,
          backgroundColor: scheme.surfaceContainerHighest,
        ),
      ),
    );
  }
}

/// Monthly cash in vs out as paired columns (one axis, rupiah). Tap a month to read its values; the
/// latest month is selected by default. Legend always visible; the readout doubles as the table view.
class CashFlowChart extends StatefulWidget {
  const CashFlowChart({super.key, required this.rows, required this.labelIn, required this.labelOut});
  final List<CashFlowPoint> rows;
  final String labelIn;
  final String labelOut;

  @override
  State<CashFlowChart> createState() => _CashFlowChartState();
}

class _CashFlowChartState extends State<CashFlowChart> {
  int? _selected;

  @override
  Widget build(BuildContext context) {
    final rows = widget.rows;
    final theme = Theme.of(context);
    if (rows.isEmpty) return const SizedBox.shrink();
    final sel = (_selected ?? rows.length - 1).clamp(0, rows.length - 1);
    final r = rows[sel];
    Widget legend(Color c, String label) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 12,
          height: 12,
          decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3)),
        ),
        const SizedBox(width: 6),
        Text(label, style: theme.textTheme.bodySmall),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 16,
          children: [legend(VizColors.series1, widget.labelIn), legend(VizColors.series2, widget.labelOut)],
        ),
        const SizedBox(height: 8),
        LayoutBuilder(
          builder: (context, c) {
            final slot = c.maxWidth / rows.length;
            return GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTapDown: (d) =>
                  setState(() => _selected = (d.localPosition.dx / slot).floor().clamp(0, rows.length - 1)),
              child: SizedBox(
                key: const Key('cashflow-chart'),
                height: 140,
                width: c.maxWidth,
                child: CustomPaint(
                  painter: _CashFlowPainter(
                    rows,
                    sel,
                    theme.colorScheme.outlineVariant,
                    theme.colorScheme.primary.withValues(alpha: 0.08),
                  ),
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 4),
        Row(
          children: [
            for (final (i, p) in rows.indexed)
              Expanded(
                child: Text(
                  periodShort(p.period),
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelSmall?.copyWith(fontWeight: i == sel ? FontWeight.bold : null),
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Semantics(
          liveRegion: true,
          child: Text(
            '${periodLong(r.period)}: ${widget.labelIn} ${formatRupiah(r.masuk)} · '
            '${widget.labelOut} ${formatRupiah(r.keluar)}',
            key: const Key('cashflow-readout'),
            style: theme.textTheme.bodyMedium,
          ),
        ),
      ],
    );
  }
}

class _CashFlowPainter extends CustomPainter {
  _CashFlowPainter(this.rows, this.selected, this.grid, this.highlight);
  final List<CashFlowPoint> rows;
  final int selected;
  final Color grid;
  final Color highlight;

  @override
  void paint(Canvas canvas, Size size) {
    final maxV = rows.fold<int>(1, (m, r) => math.max(m, math.max(r.masuk, r.keluar))).toDouble();
    final slot = size.width / rows.length;
    final bar = math.min(16.0, (slot - 12) / 2).clamp(4.0, 16.0);
    const gap = 2.0;
    final base = size.height;
    // Selected month band (behind the marks) and a recessive baseline.
    canvas.drawRRect(
      RRect.fromRectAndRadius(Rect.fromLTWH(slot * selected + 2, 0, slot - 4, size.height), const Radius.circular(6)),
      Paint()..color = highlight,
    );
    canvas.drawLine(Offset(0, base - 0.5), Offset(size.width, base - 0.5), Paint()..color = grid);
    void column(double x, int v, Color c) {
      final h = (v / maxV) * (size.height - 8);
      if (h <= 0) return;
      canvas.drawRRect(
        RRect.fromRectAndCorners(
          Rect.fromLTWH(x, base - h, bar, h),
          topLeft: const Radius.circular(4),
          topRight: const Radius.circular(4),
        ),
        Paint()..color = c,
      );
    }

    for (final (i, r) in rows.indexed) {
      final cx = slot * i + slot / 2;
      column(cx - bar - gap / 2, r.masuk, VizColors.series1);
      column(cx + gap / 2, r.keluar, VizColors.series2);
    }
  }

  @override
  bool shouldRepaint(_CashFlowPainter old) => old.rows != rows || old.selected != selected;
}
