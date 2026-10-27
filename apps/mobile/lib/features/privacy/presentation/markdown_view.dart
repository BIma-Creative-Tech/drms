import 'package:flutter/material.dart';

import '../domain/markdown.dart';

/// Renders the markdown subset of [parseMarkdown] with Text widgets only (no HTML, no links, no images). Tables are
/// shown as one card per row ("Kolom: nilai" lines) — readable on a phone.
class MarkdownView extends StatelessWidget {
  const MarkdownView({super.key, required this.blocks});
  final List<MdBlock> blocks;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final text = theme.textTheme;
    final children = <Widget>[];
    for (final b in blocks) {
      switch (b) {
        case MdHeading(:final level, :final inlines):
          final style = switch (level) {
            1 => text.headlineSmall,
            2 => text.titleMedium,
            _ => text.titleSmall,
          };
          children.add(
            Padding(
              padding: EdgeInsets.only(top: level == 1 ? 0 : 16, bottom: 8),
              child: Text.rich(_spans(context, inlines), style: style?.copyWith(fontWeight: FontWeight.w700)),
            ),
          );
        case MdParagraph(:final inlines):
          children.add(
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text.rich(_spans(context, inlines), style: text.bodyMedium),
            ),
          );
        case MdList(:final ordered, :final items):
          for (var i = 0; i < items.length; i++) {
            children.add(
              Padding(
                padding: const EdgeInsets.only(bottom: 6, left: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(width: 22, child: Text(ordered ? '${i + 1}.' : '•', style: text.bodyMedium)),
                    Expanded(child: Text.rich(_spans(context, items[i]), style: text.bodyMedium)),
                  ],
                ),
              ),
            );
          }
          children.add(const SizedBox(height: 4));
        case MdTable(:final head, :final rows):
          for (final row in rows) {
            children.add(
              Card(
                color: theme.colorScheme.surfaceContainer,
                margin: const EdgeInsets.only(bottom: 8),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var k = 0; k < row.length; k++)
                        if (mdInlineText(row[k]).trim().isNotEmpty)
                          Padding(
                            padding: EdgeInsets.only(bottom: k == row.length - 1 ? 0 : 4),
                            child: k == 0
                                ? Text.rich(_spans(context, row[k]), style: text.titleSmall)
                                : Text.rich(
                                    TextSpan(
                                      children: [
                                        TextSpan(
                                          text: '${mdInlineText(head[k])}: ',
                                          style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                                        ),
                                        _spans(context, row[k]),
                                      ],
                                    ),
                                    style: text.bodyMedium,
                                  ),
                          ),
                    ],
                  ),
                ),
              ),
            );
          }
          children.add(const SizedBox(height: 4));
        case MdRule():
          children.add(const Divider(height: 24));
      }
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
  }

  static TextSpan _spans(BuildContext context, List<MdInline> nodes) => TextSpan(
    children: [
      for (final n in nodes)
        switch (n) {
          MdText(:final text) => TextSpan(text: text),
          MdCode(:final text) => TextSpan(
            text: text,
            style: const TextStyle(fontFamily: 'monospace'),
          ),
          MdStrong(:final children) => TextSpan(
            children: [_spans(context, children)],
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          MdEm(:final children) => TextSpan(
            children: [_spans(context, children)],
            style: const TextStyle(fontStyle: FontStyle.italic),
          ),
        },
    ],
  );
}
