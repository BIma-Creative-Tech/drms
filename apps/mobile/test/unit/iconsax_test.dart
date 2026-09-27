import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/shared/icons/iconsax.dart';
import 'package:proyekkas/shared/icons/svg_path.dart';

/// ADR 0015: the APK draws the same Iconsax glyphs as the web admin. Glyphs with a `webName` must equal
/// the entry of `apps/web/src/admin/modules/icons.ts` (parsed at test time); every glyph must parse and
/// stay inside its 24×24 box.
const _webIcons = '../web/src/admin/modules/icons.ts';

void main() {
  group('svg path parser', () {
    test('absolute + relative lines, H/V, close', () {
      final b = parseSvgPath('M2 2h20v20H2z').getBounds();
      expect(b, const Rect.fromLTRB(2, 2, 22, 22));
      final r = parseSvgPath('m4 4 16 0 0 16-16 0Z').getBounds();
      expect(r, const Rect.fromLTRB(4, 4, 20, 20));
    });

    test('compact numbers (.75.75, 0-1.06, exponent) and implicit lineto', () {
      final p = parseSvgPath('M1 1L.5.5 2-1.06 1e1 1E0');
      expect(p.getBounds().left, closeTo(.5, 1e-4));
      expect(p.getBounds().top, closeTo(-1.06, 1e-4));
      expect(p.getBounds().right, closeTo(10, 1e-4));
    });

    test('arcs with packed flags', () {
      // Half circle of radius 5 from (2,12) to (12,12) via the top: flags written without separators.
      final p = parseSvgPath('M2 12a5 5 0 015-5 5 5 0 015 5');
      final b = p.getBounds();
      expect(b.top, closeTo(7, 0.01));
      expect(b.left, closeTo(2, 0.01));
      expect(b.right, closeTo(12, 0.01));
    });

    test('smooth cubic / quadratic reflect the previous control point', () {
      final s = parseSvgPath('M0 0C0 10 10 10 10 0S20-10 20 0').getBounds();
      expect(s.top, lessThan(0));
      expect(s.bottom, greaterThan(0));
      final q = parseSvgPath('M0 0Q5 10 10 0T20 0').getBounds();
      expect(q.top, lessThan(0));
    });

    test('malformed data throws a FormatException', () {
      expect(() => parseSvgPath('10 10'), throwsFormatException);
      expect(() => parseSvgPath('M1 1 L'), throwsFormatException);
      expect(() => parseSvgPath('M1 1a1 1 0 2 1 3 3'), throwsFormatException);
    });
  });

  group('Iconsax glyphs', () {
    test('every glyph parses and fits its 24×24 box', () {
      for (final icon in PkIcons.all) {
        for (final p in icon.paths) {
          final b = parseSvgPath(p.d).getBounds();
          expect(b.isEmpty && b.width == 0 && b.height == 0, isFalse, reason: '${icon.name} path is empty');
          expect(
            b.left >= -0.5 && b.top >= -0.5 && b.right <= 24.5 && b.bottom <= 24.5,
            isTrue,
            reason: '${icon.name} path escapes the 24×24 box: $b',
          );
        }
      }
    });

    test('names are unique', () {
      final names = [for (final i in PkIcons.all) i.name];
      expect(names.toSet().length, names.length);
    });

    test('shared glyphs equal the web icons.ts path data', () {
      final f = File(_webIcons);
      expect(f.existsSync(), isTrue, reason: '$_webIcons not found (run from apps/mobile in the monorepo)');
      final src = f.readAsStringSync();
      final shared = PkIcons.all.where((i) => i.webName != null).toList();
      expect(shared, isNotEmpty);
      for (final icon in shared) {
        final m = RegExp("  ${icon.webName}: \\{ style: '(\\w+)', paths: \\[(.*?)\\] \\},").firstMatch(src);
        expect(m, isNotNull, reason: 'web icon ${icon.webName} missing');
        final style = m!.group(1)!;
        final web = [
          for (final p in RegExp(r'\{ d: "([^"]*)"(?:, o: ([\d.]+))? \}').allMatches(m.group(2)!))
            (d: p.group(1)!, o: p.group(2) == null ? null : double.parse(p.group(2)!)),
        ];
        expect([for (final p in icon.paths) (d: p.d, o: p.opacity)], web, reason: icon.name);
        expect(icon.paths.every((p) => p.stroke == (style == 'stroke')), isTrue, reason: '${icon.name} style');
      }
    });
  });

  testWidgets('PkIcon paints at the requested size and colour, decorative by default', (tester) async {
    await tester.pumpWidget(
      const Directionality(
        textDirection: TextDirection.ltr,
        child: Center(
          child: IconTheme(
            data: IconThemeData(color: Color(0xFF2563EB), size: 32),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                PkIcon(PkIcons.home),
                PkIcon(PkIcons.bell, size: 20, semanticLabel: 'Notifikasi'),
              ],
            ),
          ),
        ),
      ),
    );
    expect(tester.getSize(find.byType(PkIcon).first), const Size(32, 32));
    expect(tester.getSize(find.byType(PkIcon).last), const Size(20, 20));
    expect(find.bySemanticsLabel('Notifikasi'), findsOneWidget);
  });
}
