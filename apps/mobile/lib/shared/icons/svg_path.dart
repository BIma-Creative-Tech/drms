import 'dart:ui';

/// Minimal SVG path-data parser (`d` attribute, SVG 1.1 §8.3) → [Path], for the Iconsax glyphs of
/// `iconsax.dart`. Covers every command (M L H V C S Q T A Z, absolute + relative) and the compact
/// number syntax of minified SVG (`.75.75`, `0-1.06`, `1e-3`, arc flags without separators).
/// Arcs use [Path.arcToPoint], which implements the SVG endpoint parameterisation. No package needed
/// (ADR 0015: flutter_svg would add a whole SVG/XML stack for ~25 path-only glyphs).
Path parseSvgPath(String d) => _SvgPathParser(d).parse();

class _SvgPathParser {
  _SvgPathParser(this.src);
  final String src;
  int i = 0;

  static bool _isCommand(int c) => 'MmLlHhVvCcSsQqTtAaZz'.codeUnits.contains(c);

  void _skipSeparators() {
    while (i < src.length) {
      final c = src.codeUnitAt(i);
      if (c == 0x20 || c == 0x2C || c == 0x09 || c == 0x0A || c == 0x0D) {
        i++;
      } else {
        break;
      }
    }
  }

  bool get _hasNumber {
    _skipSeparators();
    if (i >= src.length) return false;
    final c = src.codeUnitAt(i);
    return (c >= 0x30 && c <= 0x39) || c == 0x2D || c == 0x2B || c == 0x2E;
  }

  double _number() {
    _skipSeparators();
    final start = i;
    if (i < src.length && (src[i] == '-' || src[i] == '+')) i++;
    var seenDot = false, seenExp = false;
    while (i < src.length) {
      final ch = src[i];
      final c = ch.codeUnitAt(0);
      if (c >= 0x30 && c <= 0x39) {
        i++;
      } else if (ch == '.' && !seenDot && !seenExp) {
        seenDot = true;
        i++;
      } else if ((ch == 'e' || ch == 'E') && !seenExp) {
        seenExp = true;
        i++;
        if (i < src.length && (src[i] == '-' || src[i] == '+')) i++;
      } else {
        break;
      }
    }
    if (start == i) throw FormatException('number expected', src, i);
    return double.parse(src.substring(start, i));
  }

  /// Arc flags are a single `0`/`1` and may be written without a separator (`a1 1 0 011 1`).
  bool _flag() {
    _skipSeparators();
    if (i >= src.length || (src[i] != '0' && src[i] != '1')) throw FormatException('flag expected', src, i);
    return src[i++] == '1';
  }

  Path parse() {
    final path = Path();
    var cur = Offset.zero, start = Offset.zero;
    Offset? lastCubicCtrl, lastQuadCtrl;
    String? cmd;
    while (true) {
      _skipSeparators();
      if (i >= src.length) break;
      final c = src.codeUnitAt(i);
      if (_isCommand(c)) {
        cmd = src[i++];
      } else if (cmd == null) {
        throw FormatException('command expected', src, i);
      } else if (cmd == 'M') {
        cmd = 'L'; // implicit lineto after moveto
      } else if (cmd == 'm') {
        cmd = 'l';
      } else if (cmd == 'Z' || cmd == 'z') {
        throw FormatException('unexpected data after Z', src, i);
      }
      final rel = cmd == cmd.toLowerCase();
      Offset pt() {
        final x = _number(), y = _number();
        return rel ? cur + Offset(x, y) : Offset(x, y);
      }

      var keepCubic = false, keepQuad = false;
      switch (cmd.toUpperCase()) {
        case 'M':
          cur = pt();
          start = cur;
          path.moveTo(cur.dx, cur.dy);
        case 'L':
          cur = pt();
          path.lineTo(cur.dx, cur.dy);
        case 'H':
          final x = _number();
          cur = Offset(rel ? cur.dx + x : x, cur.dy);
          path.lineTo(cur.dx, cur.dy);
        case 'V':
          final y = _number();
          cur = Offset(cur.dx, rel ? cur.dy + y : y);
          path.lineTo(cur.dx, cur.dy);
        case 'C':
          final c1 = pt(), c2 = pt(), p = pt();
          path.cubicTo(c1.dx, c1.dy, c2.dx, c2.dy, p.dx, p.dy);
          lastCubicCtrl = c2;
          keepCubic = true;
          cur = p;
        case 'S':
          final c1 = lastCubicCtrl == null ? cur : cur * 2 - lastCubicCtrl;
          final c2 = pt(), p = pt();
          path.cubicTo(c1.dx, c1.dy, c2.dx, c2.dy, p.dx, p.dy);
          lastCubicCtrl = c2;
          keepCubic = true;
          cur = p;
        case 'Q':
          final c1 = pt(), p = pt();
          path.quadraticBezierTo(c1.dx, c1.dy, p.dx, p.dy);
          lastQuadCtrl = c1;
          keepQuad = true;
          cur = p;
        case 'T':
          final c1 = lastQuadCtrl == null ? cur : cur * 2 - lastQuadCtrl;
          final p = pt();
          path.quadraticBezierTo(c1.dx, c1.dy, p.dx, p.dy);
          lastQuadCtrl = c1;
          keepQuad = true;
          cur = p;
        case 'A':
          final rx = _number().abs(), ry = _number().abs(), rot = _number();
          final large = _flag(), sweep = _flag();
          final p = pt();
          if (rx == 0 || ry == 0) {
            path.lineTo(p.dx, p.dy);
          } else {
            path.arcToPoint(p, radius: Radius.elliptical(rx, ry), rotation: rot, largeArc: large, clockwise: sweep);
          }
          cur = p;
        case 'Z':
          path.close();
          cur = start;
      }
      if (!keepCubic) lastCubicCtrl = null;
      if (!keepQuad) lastQuadCtrl = null;
      // A command letter followed by no numbers (other than Z) is malformed.
      if (cmd.toUpperCase() != 'Z' && !_hasNumber && i < src.length && !_isCommand(src.codeUnitAt(i))) {
        throw FormatException('unexpected character', src, i);
      }
    }
    return path;
  }
}
