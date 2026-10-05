/// Minimal markdown subset for the privacy notice (same subset as the server's `apps/web/src/legal/markdown.ts`):
/// ATX headings, paragraphs (soft breaks joined with a space), `-`/`*` and `1.` lists with indented continuation
/// lines, pipe tables, `---` rules, inline `**strong**`, `*em*` / `_em_`, `` `code` `` and backslash escapes.
/// Everything else (raw HTML, links, images) stays literal TEXT — the APK only ever builds Text widgets from it.
/// Pure Dart (unit-tested).
library;

sealed class MdInline {
  const MdInline();
}

class MdText extends MdInline {
  const MdText(this.text);
  final String text;
}

class MdStrong extends MdInline {
  const MdStrong(this.children);
  final List<MdInline> children;
}

class MdEm extends MdInline {
  const MdEm(this.children);
  final List<MdInline> children;
}

class MdCode extends MdInline {
  const MdCode(this.text);
  final String text;
}

sealed class MdBlock {
  const MdBlock();
}

class MdHeading extends MdBlock {
  const MdHeading(this.level, this.inlines);
  final int level;
  final List<MdInline> inlines;
}

class MdParagraph extends MdBlock {
  const MdParagraph(this.inlines);
  final List<MdInline> inlines;
}

class MdList extends MdBlock {
  const MdList({required this.ordered, required this.items});
  final bool ordered;
  final List<List<MdInline>> items;
}

class MdTable extends MdBlock {
  const MdTable({required this.head, required this.rows});
  final List<List<MdInline>> head;
  final List<List<List<MdInline>>> rows;
}

class MdRule extends MdBlock {
  const MdRule();
}

final _heading = RegExp(r'^(#{1,6})\s+(.*?)\s*#*\s*$');
final _bullet = RegExp(r'^\s{0,3}[-*+]\s+(.*)$');
final _ordered = RegExp(r'^\s{0,3}\d{1,9}[.)]\s+(.*)$');
final _rule = RegExp(r'^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$');
final _tableSep = RegExp(r'^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$');
final _escapable = RegExp(r'[\\`*_{}\[\]()#+\-.!|>~]');
final _emOpenBefore = RegExp(r'''[\s(\[{"'—-]''');
final _emCloseAfter = RegExp(r'''[\s.,;:!?)\]}"'—-]''');

bool _isTableRow(String line) => line.trimLeft().startsWith('|');

List<String> _splitRow(String line) {
  var s = line.trim();
  if (s.startsWith('|')) s = s.substring(1);
  if (s.endsWith('|') && !s.endsWith(r'\|')) s = s.substring(0, s.length - 1);
  final cells = <String>[];
  final cur = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (s[i] == r'\' && i + 1 < s.length && s[i + 1] == '|') {
      cur.write('|');
      i++;
    } else if (s[i] == '|') {
      cells.add(cur.toString().trim());
      cur.clear();
    } else {
      cur.write(s[i]);
    }
  }
  cells.add(cur.toString().trim());
  return cells;
}

/// Inline parser; an unmatched marker is literal text.
List<MdInline> parseMdInline(String src) {
  final out = <MdInline>[];
  final text = StringBuffer();
  void flush() {
    if (text.isNotEmpty) out.add(MdText(text.toString()));
    text.clear();
  }

  var i = 0;
  while (i < src.length) {
    final ch = src[i];
    if (ch == r'\' && i + 1 < src.length && _escapable.hasMatch(src[i + 1])) {
      text.write(src[i + 1]);
      i += 2;
      continue;
    }
    if (ch == '`') {
      final end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.add(MdCode(src.substring(i + 1, end)));
        i = end + 1;
        continue;
      }
    }
    if (ch == '*' && i + 1 < src.length && src[i + 1] == '*') {
      final end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.add(MdStrong(parseMdInline(src.substring(i + 2, end))));
        i = end + 2;
        continue;
      }
      text.write('**');
      i += 2;
      continue;
    }
    if ((ch == '*' || ch == '_') && i + 1 < src.length && src[i + 1] != ch && src[i + 1] != ' ') {
      final boundary = ch == '*' || i == 0 || _emOpenBefore.hasMatch(src[i - 1]);
      final end = src.indexOf(ch, i + 1);
      final closes =
          end > i + 1 &&
          src[end - 1] != ' ' &&
          (ch == '*' || end + 1 >= src.length || _emCloseAfter.hasMatch(src[end + 1]));
      if (boundary && closes) {
        flush();
        out.add(MdEm(parseMdInline(src.substring(i + 1, end))));
        i = end + 1;
        continue;
      }
    }
    text.write(ch);
    i++;
  }
  flush();
  return out;
}

/// Block parser (line based); never throws.
List<MdBlock> parseMarkdown(String md) {
  final lines = md.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  final blocks = <MdBlock>[];
  final para = <String>[];
  bool? listOrdered;
  final listItems = <String>[];
  void endPara() {
    if (para.isNotEmpty) blocks.add(MdParagraph(parseMdInline(para.join(' '))));
    para.clear();
  }

  void endList() {
    if (listOrdered != null) {
      blocks.add(MdList(ordered: listOrdered!, items: [for (final it in listItems) parseMdInline(it)]));
    }
    listOrdered = null;
    listItems.clear();
  }

  for (var i = 0; i < lines.length; i++) {
    final line = lines[i];
    if (line.trim().isEmpty) {
      endPara();
      endList();
      continue;
    }
    if (_rule.hasMatch(line)) {
      endPara();
      endList();
      blocks.add(const MdRule());
      continue;
    }
    final h = _heading.firstMatch(line);
    if (h != null) {
      endPara();
      endList();
      final level = h.group(1)!.length;
      blocks.add(MdHeading(level > 4 ? 4 : level, parseMdInline(h.group(2)!)));
      continue;
    }
    if (_isTableRow(line) && i + 1 < lines.length && _tableSep.hasMatch(lines[i + 1])) {
      endPara();
      endList();
      final head = _splitRow(line);
      final rows = <List<List<MdInline>>>[];
      i += 2;
      while (i < lines.length && _isTableRow(lines[i])) {
        final cells = _splitRow(lines[i]);
        rows.add([for (var k = 0; k < head.length; k++) parseMdInline(k < cells.length ? cells[k] : '')]);
        i++;
      }
      i--;
      blocks.add(MdTable(head: [for (final c in head) parseMdInline(c)], rows: rows));
      continue;
    }
    final b = _bullet.firstMatch(line);
    final o = b == null ? _ordered.firstMatch(line) : null;
    if (b != null || o != null) {
      endPara();
      final ordered = b == null;
      if (listOrdered != null && listOrdered != ordered) endList();
      listOrdered = ordered;
      listItems.add((b ?? o)!.group(1)!.trim());
      continue;
    }
    if (listOrdered != null && RegExp(r'^\s+\S').hasMatch(line)) {
      listItems[listItems.length - 1] = '${listItems.last} ${line.trim()}';
      continue;
    }
    endList();
    para.add(line.trim());
  }
  endPara();
  endList();
  return blocks;
}

/// Plain text of inline nodes.
String mdInlineText(List<MdInline> nodes) => nodes
    .map(
      (n) => switch (n) {
        MdText(:final text) => text,
        MdCode(:final text) => text,
        MdStrong(:final children) => mdInlineText(children),
        MdEm(:final children) => mdInlineText(children),
      },
    )
    .join();
