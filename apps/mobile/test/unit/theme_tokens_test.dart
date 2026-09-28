import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/theme.dart';
import 'package:proyekkas/app/theme/tokens.dart';

/// ADR 0015: the APK colours are the web admin tokens. Two guards:
/// 1. drift — `apps/web/src/theme/tokens.ts` is parsed at test time (monorepo checkout) and every
///    semantic token, module gradient and the radius must equal the Dart copy in `lib/app/theme/tokens.dart`;
/// 2. WCAG — the same pairs as `apps/web/tests/unit/theme.test.ts` (text ≥ 4.5:1, focus ring ≥ 3:1, white
///    glyph ≥ 3:1 on every gradient stop) plus the Material slots the APK derives from them.
const _webTokens = '../web/src/theme/tokens.ts';
const white = Color(0xFFFFFFFF);

String _hex(Color c) => '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';

Map<String, String> _hexPairs(String block) => {
  for (final m in RegExp(r"(\w+): '(#[0-9A-Fa-f]{6})'").allMatches(block)) m.group(1)!: m.group(2)!.toUpperCase(),
};

void main() {
  group('web token drift', () {
    late String src;
    setUpAll(() {
      final f = File(_webTokens);
      expect(f.existsSync(), isTrue, reason: '$_webTokens not found (run from apps/mobile in the monorepo)');
      src = f.readAsStringSync();
    });

    for (final mode in ['light', 'dark']) {
      test('semantic.$mode equals the web tokens', () {
        final sem = src.substring(src.indexOf('export const semantic'), src.indexOf('/** Payload palette steps'));
        final lightAt = sem.indexOf('light: {'), darkAt = sem.indexOf('dark: {');
        final block = mode == 'light' ? sem.substring(lightAt, darkAt) : sem.substring(darkAt);
        final web = _hexPairs(block);
        final dart = (mode == 'light' ? PkTokens.light : PkTokens.dark).toMap().map((k, v) => MapEntry(k, _hex(v)));
        expect(web.length, 23, reason: 'parser found every SemanticTokens key');
        expect(dart, web);
      });
    }

    test('module gradients equal the web moduleGradients', () {
      final block = src.substring(src.indexOf('export const moduleGradients'), src.indexOf('/** Base radius'));
      final re = RegExp(r"(\w+): \{ light: \['(#\w{6})', '(#\w{6})'\], dark: \['(#\w{6})', '(#\w{6})'\] \}");
      final web = {
        for (final m in re.allMatches(block)) m.group(1)!: [for (var i = 2; i <= 5; i++) m.group(i)!.toUpperCase()],
      };
      final dart = {
        for (final e in PkGradients.all.entries)
          e.key.name: [
            _hex(e.value.light.from),
            _hex(e.value.light.to),
            _hex(e.value.dark.from),
            _hex(e.value.dark.to),
          ],
      };
      expect(web.length, 11);
      expect(dart, web);
    });

    test('radius 0.875rem = 14 dp', () {
      expect(src, contains("export const radius = '0.875rem'"));
      expect(PkTokens.radius, 14);
    });
  });

  group('WCAG contrast (mirror of apps/web/tests/unit/theme.test.ts)', () {
    for (final b in Brightness.values) {
      final c = PkTokens.of(b);
      final mode = b.name;
      final pairs = <(String, Color, Color)>[
        ('foreground/background', c.foreground, c.background),
        ('cardForeground/card', c.cardForeground, c.card),
        ('mutedForeground/background', c.mutedForeground, c.background),
        ('mutedForeground/card', c.mutedForeground, c.card),
        ('mutedForeground/muted', c.mutedForeground, c.muted),
        ('primaryForeground/primary', c.primaryForeground, c.primary),
        ('primaryForeground/primaryHover', c.primaryForeground, c.primaryHover),
        ('primary/background', c.primary, c.background),
        ('primary/card', c.primary, c.card),
        ('accentForeground/accent', c.accentForeground, c.accent),
        ('accentForeground/accentHover', c.accentForeground, c.accentHover),
        ('destructive/background', c.destructive, c.background),
        ('white/ok badge', white, c.ok),
        ('white/warn badge', white, c.warn),
        ('white/bad badge', white, c.bad),
        ('okText/background', c.okText, c.background),
        ('warnText/background', c.warnText, c.background),
        ('badText/background', c.badText, c.background),
        ('okText/card', c.okText, c.card),
        ('warnText/card', c.warnText, c.card),
        ('badText/card', c.badText, c.card),
      ];
      for (final (name, fg, bg) in pairs) {
        test('$mode: $name ≥ 4.5', () => expect(contrastRatio(fg, bg), greaterThanOrEqualTo(4.5)));
      }
      test('$mode: focus ring vs background/card ≥ 3', () {
        expect(contrastRatio(c.ring, c.background), greaterThanOrEqualTo(3));
        expect(contrastRatio(c.ring, c.card), greaterThanOrEqualTo(3));
      });

      test('$mode: Material slots derived from the tokens', () {
        final s = pkColorScheme(b);
        for (final (name, fg, bg, min) in <(String, Color, Color, double)>[
          ('onSurface/surface', s.onSurface, s.surface, 4.5),
          ('onSurfaceVariant/surfaceContainerLow', s.onSurfaceVariant, s.surfaceContainerLow, 4.5),
          ('onSurfaceVariant/surfaceContainerHigh', s.onSurfaceVariant, s.surfaceContainerHigh, 4.5),
          ('onPrimaryContainer/primaryContainer', s.onPrimaryContainer, s.primaryContainer, 4.5),
          ('onSecondaryContainer/secondaryContainer', s.onSecondaryContainer, s.secondaryContainer, 4.5),
          ('onTertiary/tertiary', s.onTertiary, s.tertiary, 4.5),
          ('onTertiaryContainer/tertiaryContainer', s.onTertiaryContainer, s.tertiaryContainer, 4.5),
          ('onError/error', s.onError, s.error, 4.5),
          ('onErrorContainer/errorContainer', s.onErrorContainer, s.errorContainer, 4.5),
          ('onInverseSurface/inverseSurface', s.onInverseSurface, s.inverseSurface, 4.5),
          ('secondary/surface', s.secondary, s.surface, 4.5),
          ('outline (icons)/surface', s.outline, s.surface, 3),
          ('outline (icons)/card', s.outline, s.surfaceContainerLow, 3),
        ]) {
          expect(contrastRatio(fg, bg), greaterThanOrEqualTo(min), reason: name);
        }
      });
    }
  });

  group('module launcher gradients', () {
    test('one gradient per web registry module', () {
      expect(PkGradients.all.keys.toSet(), PkModule.values.toSet());
    });
    for (final e in PkGradients.all.entries) {
      for (final b in Brightness.values) {
        test('${b.name}: white icon on ${e.key.name} gradient ≥ 3:1 at both stops', () {
          final g = PkGradients.of(e.key, b);
          expect(contrastRatio(white, g.from), greaterThanOrEqualTo(3));
          expect(contrastRatio(white, g.to), greaterThanOrEqualTo(3));
        });
      }
    }
  });

  group('buildTheme', () {
    for (final b in Brightness.values) {
      test('${b.name}: field-friendly sizes, radius 14, surface app bar, bundled fonts', () {
        final t = buildTheme(b);
        final tok = PkTokens.of(b);
        expect(t.brightness, b);
        expect(t.colorScheme.primary, tok.primary);
        expect(t.colorScheme.tertiary, tok.accent);
        expect(t.scaffoldBackgroundColor, tok.background);
        expect(t.appBarTheme.backgroundColor, tok.card);
        expect(t.appBarTheme.foregroundColor, tok.foreground);
        expect(t.filledButtonTheme.style!.minimumSize!.resolve({})!.height, 52);
        expect(t.outlinedButtonTheme.style!.minimumSize!.resolve({})!.height, greaterThanOrEqualTo(48));
        expect(t.materialTapTargetSize, MaterialTapTargetSize.padded);
        final card = t.cardTheme.shape! as RoundedRectangleBorder;
        expect(card.borderRadius, BorderRadius.circular(14));
        expect((t.inputDecorationTheme.border! as OutlineInputBorder).borderRadius, BorderRadius.circular(14));
        expect(t.textTheme.titleLarge!.fontFamily, PkFonts.heading);
        expect(t.textTheme.bodyMedium!.fontFamily, PkFonts.body);
        expect(t.extension<PkColors>()!.okText, tok.okText);
      });
    }
  });
}
