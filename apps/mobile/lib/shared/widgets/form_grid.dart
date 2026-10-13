import 'package:flutter/material.dart';

/// DRMS 13/10 Umum #2 / D4: how a [FormGrid] lays out its cells for the window width.
enum FormGridLayout {
  /// < 600dp (phones): one column; the label stays on top (the input's own label).
  stacked,

  /// 600–899dp: one column; the label (≈35%) sits left of the input, top-aligned (Odoo style).
  labelLeft,

  /// ≥ 900dp: two columns of label-left cells; full-width cells span both columns.
  twoColumns;

  /// Window width (dp) from which labels move left of their inputs.
  static const labelLeftMinWidth = 600.0;

  /// Window width (dp) from which the cells are laid out in two columns.
  static const twoColumnsMinWidth = 900.0;

  static FormGridLayout forWidth(double width) {
    if (width >= twoColumnsMinWidth) return twoColumns;
    return width >= labelLeftMinWidth ? labelLeft : stacked;
  }

  /// Layout of the current window ([MediaQuery] width).
  static FormGridLayout of(BuildContext context) => forWidth(MediaQuery.sizeOf(context).width);

  bool get labelsLeft => this != stacked;
}

/// Shared responsive form layout (D4, same rules as the web `.document-fields` grid): [FormGridCell]s are
/// "label | input" pairs, two per row from 900dp, one per row below; on phones (< 600dp) the label goes back
/// on top of the input. Any other child (cards, notes, line tables) takes a full row. Cells keep their source
/// order for focus traversal (left cell before right cell, row by row).
class FormGrid extends StatelessWidget {
  const FormGrid({super.key, required this.children, this.rowGap = 12});

  final List<Widget> children;

  /// Vertical space between rows.
  final double rowGap;

  /// Horizontal space between the two columns.
  static const columnGap = 24.0;

  /// Share of a column taken by the label in label-left layouts.
  static const labelFraction = 0.35;

  @override
  Widget build(BuildContext context) {
    final layout = FormGridLayout.of(context);
    final rows = <Widget>[];
    Widget? pending;
    for (final child in children) {
      final half = layout == FormGridLayout.twoColumns && child is FormGridCell && !child.full;
      if (!half) {
        if (pending != null) rows.add(_pair(pending, const SizedBox.shrink()));
        pending = null;
        rows.add(child);
      } else if (pending == null) {
        pending = child;
      } else {
        rows.add(_pair(pending, child));
        pending = null;
      }
    }
    if (pending != null) rows.add(_pair(pending, const SizedBox.shrink()));
    return _FormGridScope(
      layout: layout,
      child: FocusTraversalGroup(
        policy: WidgetOrderTraversalPolicy(),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: rowGap, children: rows),
      ),
    );
  }

  static Widget _pair(Widget left, Widget right) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(child: left),
      const SizedBox(width: columnGap),
      Expanded(child: right),
    ],
  );
}

/// One "label | input" cell of a [FormGrid].
///
/// Inputs that have their own label (TextField, pickers) are built by [builder], which gets the label the
/// input should show: null while the cell shows it on the left, [label] on phones. Pickers built on
/// [inputLabel] (MasterPickerField, RapItemPickerField) adapt by themselves and can be passed as [child].
class FormGridCell extends StatelessWidget {
  const FormGridCell({super.key, this.label, this.child, this.builder, this.full = false, this.stackedLabel = false});

  /// Field label; null = no label column (the child spans the cell).
  final String? label;

  /// The field (pass [child] or [builder]).
  final Widget? child;
  final Widget Function(String? inputLabel)? builder;

  /// Spans both columns of the two-column layout (notes, line tables, photo pickers).
  final bool full;

  /// On phones, show [label] above [child]: for children without an input label of their own (segmented
  /// buttons, chips, photo pickers).
  final bool stackedLabel;

  /// The label an input shows itself: null when the enclosing cell already shows it left of the input.
  static String? inputLabel(BuildContext context, String label) {
    final scope = context.dependOnInheritedWidgetOfExactType<_CellLabelScope>();
    return (scope?.outside ?? false) ? null : label;
  }

  Widget _body(bool outside) {
    final inner = builder?.call(outside ? null : label) ?? child ?? const SizedBox.shrink();
    return _CellLabelScope(outside: outside, child: inner);
  }

  @override
  Widget build(BuildContext context) {
    final layout = _FormGridScope.maybeOf(context) ?? FormGridLayout.of(context);
    final text = label;
    if (text == null) return _body(false);
    final theme = Theme.of(context);
    final style = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
      fontWeight: FontWeight.w600,
    );
    if (!layout.labelsLeft) {
      if (!stackedLabel) return _body(false);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(text, style: style),
          const SizedBox(height: 4),
          _body(true),
        ],
      );
    }
    return LayoutBuilder(
      builder: (context, box) {
        // A full-width cell of the two-column grid keeps the label width of a half cell (labels line up).
        final twoColumns = full && layout == FormGridLayout.twoColumns;
        final column = twoColumns ? (box.maxWidth - FormGrid.columnGap) / 2 : box.maxWidth;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: column * FormGrid.labelFraction,
              child: Padding(
                // top-aligned with the text of a 56dp input; closer to the top for buttons / chips
                padding: EdgeInsets.only(top: stackedLabel ? 10 : 16, right: 12),
                child: Text(text, style: style),
              ),
            ),
            Expanded(child: _body(true)),
          ],
        );
      },
    );
  }
}

class _FormGridScope extends InheritedWidget {
  const _FormGridScope({required this.layout, required super.child});
  final FormGridLayout layout;

  static FormGridLayout? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_FormGridScope>()?.layout;

  @override
  bool updateShouldNotify(_FormGridScope oldWidget) => layout != oldWidget.layout;
}

class _CellLabelScope extends InheritedWidget {
  const _CellLabelScope({required this.outside, required super.child});

  /// The cell shows the label itself (left of the input, or above a child without an input label).
  final bool outside;

  @override
  bool updateShouldNotify(_CellLabelScope oldWidget) => outside != oldWidget.outside;
}
