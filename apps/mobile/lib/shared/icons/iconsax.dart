import 'package:flutter/widgets.dart';

import 'svg_path.dart';

/// Iconsax glyphs of the APK — the same artwork as the web admin (ADR 0014 / ADR 0015), drawn from SVG
/// path data by a small [CustomPainter]; no icon package.
///
/// Provenance: glyphs with a `webName` are verbatim copies of `apps/web/src/admin/modules/icons.ts`
/// (`test/unit/iconsax_test.dart` compares them at test time). The others were taken the way ADR 0014
/// describes: rendered once from `iconsax-reactjs@0.0.8` (`dist/cjs/<Name>.js`, npm tarball integrity
/// sha512-cb+uTMxb…qyslw==); nothing from that package is installed.
/// Licence: Iconsax by Vuesax, "Iconsax Free License" (docs.iconsax.io/license-and-terms/license) —
/// personal + commercial use integrated into a final product, no attribution required; redistributing
/// the icons as a loose icon set is not allowed → only the glyphs the app renders are listed here.
/// Accepted by the user for the web on 2026-09-27 (ADR 0014); ADR 0015 extends it to the APK.
///
/// All 24×24. Bulk = two-tone filled (secondary layer at opacity 0.4); Linear = 1.5 px stroke.
class PkIconPath {
  const PkIconPath(this.d, {this.opacity, this.stroke = false, this.strokeWidth = 1.5});
  final String d;
  final double? opacity;
  final bool stroke;
  final double strokeWidth;
}

class PkIconData {
  const PkIconData(this.name, this.paths, {this.webName});
  final String name;
  final List<PkIconPath> paths;

  /// Key of the same glyph in the web `ICONS` map, when it is shared.
  final String? webName;
}

/// Iconsax glyph in [color] (default: the ambient [IconTheme] colour), [size] logical pixels square.
/// Decorative unless [semanticLabel] is given (the surrounding control usually carries the name).
class PkIcon extends StatelessWidget {
  const PkIcon(this.icon, {super.key, this.size, this.color, this.semanticLabel});
  final PkIconData icon;
  final double? size;
  final Color? color;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final theme = IconTheme.of(context);
    final s = size ?? theme.size ?? 24;
    final c = color ?? theme.color ?? const Color(0xFF000000);
    final glyph = SizedBox.square(
      dimension: s,
      child: CustomPaint(painter: _IconPainter(icon, c)),
    );
    return semanticLabel == null ? ExcludeSemantics(child: glyph) : Semantics(label: semanticLabel, child: glyph);
  }
}

final Map<String, Path> _pathCache = {};

Path _path(String d) => _pathCache.putIfAbsent(d, () => parseSvgPath(d));

class _IconPainter extends CustomPainter {
  _IconPainter(this.icon, this.color);
  final PkIconData icon;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 24, size.height / 24);
    for (final p in icon.paths) {
      final paint = Paint()
        ..isAntiAlias = true
        ..color = color.withValues(alpha: color.a * (p.opacity ?? 1));
      if (p.stroke) {
        paint
          ..style = PaintingStyle.stroke
          ..strokeWidth = p.strokeWidth
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..strokeMiterLimit = 10;
      }
      canvas.drawPath(_path(p.d), paint);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_IconPainter old) => old.icon != icon || old.color != color;
}

abstract final class PkIcons {
  /// Iconsax Home2 (Bulk) — copy of web icons.ts `home`
  static const home = PkIconData('home', [
    PkIconPath(
      r'm20.04 6.822-5.76-4.03c-1.57-1.1-3.98-1.04-5.49.13l-5.01 3.91c-1 .78-1.79 2.38-1.79 3.64v6.9c0 2.55 2.07 4.63 4.62 4.63h10.78c2.55 0 4.62-2.07 4.62-4.62v-6.78c0-1.35-.87-3.01-1.97-3.78Z',
      opacity: 0.4,
    ),
    PkIconPath(r'M12 18.75c-.41 0-.75-.34-.75-.75v-3c0-.41.34-.75.75-.75s.75.34.75.75v3c0 .41-.34.75-.75.75Z'),
  ], webName: 'home');

  /// Iconsax ClipboardTick (Bulk) — copy of web icons.ts `approval`
  static const approval = PkIconData('approval', [
    PkIconPath(
      r'M16.24 3.648H7.76c-2.47 0-4.47 2.01-4.47 4.47v9.41c0 2.46 2.01 4.47 4.47 4.47h8.47c2.47 0 4.47-2.01 4.47-4.47v-9.41c.01-2.47-2-4.47-4.46-4.47Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M14.35 2h-4.7c-1.04 0-1.89.84-1.89 1.88v.94c0 1.04.84 1.88 1.88 1.88h4.71c1.04 0 1.88-.84 1.88-1.88v-.94C16.24 2.84 15.39 2 14.35 2ZM10.81 16.95c-.19 0-.38-.07-.53-.22l-1.5-1.5a.754.754 0 0 1 0-1.06c.29-.29.77-.29 1.06 0l.97.97 3.47-3.47c.29-.29.77-.29 1.06 0 .29.29.29.77 0 1.06l-4 4c-.14.15-.34.22-.53.22Z',
    ),
  ], webName: 'approval');

  /// Iconsax Buildings (Bulk) — copy of web icons.ts `project`
  static const project = PkIconData('project', [
    PkIconPath(r'M10.11 4c-.08.3-.11.63-.11 1v3H5V6c0-1.1.9-2 2-2h3.11Z', opacity: 0.6),
    PkIconPath(
      r'M10 19V8H5c-2 0-3 1-3 3v8c0 2 1 3 3 3h8c-2 0-3-1-3-3Zm-3.25-2c0 .41-.34.75-.75.75s-.75-.34-.75-.75v-4c0-.41.34-.75.75-.75s.75.34.75.75v4Z',
    ),
    PkIconPath(r'M14 22h-1c-2 0-3-1-3-3V5c0-2 1-3 3-3h6c2 0 3 1 3 3v14c0 2-1 3-3 3h-1', opacity: 0.4),
    PkIconPath(
      r'M18 18v4h-4v-4c0-.55.45-1 1-1h2c.55 0 1 .45 1 1ZM14 13.75c-.41 0-.75-.34-.75-.75V8c0-.41.34-.75.75-.75s.75.34.75.75v5c0 .41-.34.75-.75.75ZM18 13.75c-.41 0-.75-.34-.75-.75V8c0-.41.34-.75.75-.75s.75.34.75.75v5c0 .41-.34.75-.75.75Z',
    ),
  ], webName: 'project');

  /// Iconsax WalletMoney (Bulk) — copy of web icons.ts `finance`
  static const finance = PkIconData('finance', [
    PkIconPath(
      r'M17.48 10.55c-.42.41-.66 1-.6 1.63.09 1.08 1.08 1.87 2.16 1.87H21v1.45c0 3-2 5-5 5H7c-3 0-5-2-5-5v-7c0-2.72 1.64-4.62 4.19-4.94.26-.04.53-.06.81-.06h9c.26 0 .51.01.75.05C19.33 3.85 21 5.76 21 8.5v1.45h-2.08c-.56 0-1.07.22-1.44.6Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M22 10.97v2.06c0 .55-.44 1-1 1.02h-1.96c-1.08 0-2.07-.79-2.16-1.87-.06-.63.18-1.22.6-1.63.37-.38.88-.6 1.44-.6H21c.56.02 1 .47 1 1.02Z',
    ),
  ], webName: 'finance');

  /// Iconsax CalendarTick (Bulk) — copy of web icons.ts `attendance`
  static const attendance = PkIconData('attendance', [
    PkIconPath(
      r'M16.75 3.56V2c0-.41-.34-.75-.75-.75s-.75.34-.75.75v1.5h-6.5V2c0-.41-.34-.75-.75-.75s-.75.34-.75.75v1.56c-2.7.25-4.01 1.86-4.21 4.25-.02.29.22.53.5.53h16.92c.29 0 .53-.25.5-.53-.2-2.39-1.51-4-4.21-4.25Z',
    ),
    PkIconPath(
      r'M21 10.838v1.74c0 .61-.54 1.08-1.14.98-.28-.04-.57-.07-.86-.07a5.51 5.51 0 0 0-5.5 5.5c0 .46.18 1.1.37 1.68a.998.998 0 0 1-.95 1.32H8c-3.5 0-5-2-5-5v-6.16c0-.55.45-1 1-1h16c.55.01 1 .46 1 1.01Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M19 15c-2.21 0-4 1.79-4 4 0 .75.21 1.46.58 2.06A3.97 3.97 0 0 0 19 23c1.46 0 2.73-.78 3.42-1.94.37-.6.58-1.31.58-2.06 0-2.21-1.79-4-4-4Zm2.07 3.57-2.13 1.97c-.14.13-.33.2-.51.2-.19 0-.38-.07-.53-.22l-.99-.99a.754.754 0 0 1 0-1.06c.29-.29.77-.29 1.06 0l.48.48 1.6-1.48c.3-.28.78-.26 1.06.04s.26.77-.04 1.06ZM8.5 15c-.26 0-.52-.11-.71-.29-.18-.19-.29-.45-.29-.71 0-.26.11-.52.29-.71.23-.23.58-.34.91-.27.06.01.12.03.18.06.06.02.12.05.18.09l.15.12c.18.19.29.45.29.71 0 .26-.11.52-.29.71l-.15.12c-.06.04-.12.07-.18.09-.06.03-.12.05-.18.06-.07.01-.14.02-.2.02ZM12 15c-.26 0-.52-.11-.71-.29-.18-.19-.29-.45-.29-.71 0-.26.11-.52.29-.71.38-.37 1.05-.37 1.42 0 .18.19.29.45.29.71 0 .26-.11.52-.29.71-.19.18-.45.29-.71.29ZM8.5 18.499c-.26 0-.52-.11-.71-.29-.18-.19-.29-.45-.29-.71 0-.26.11-.52.29-.71.1-.09.2-.16.33-.21.37-.16.81-.07 1.09.21.18.19.29.45.29.71 0 .26-.11.52-.29.71-.19.18-.45.29-.71.29Z',
    ),
  ], webName: 'attendance');

  /// Iconsax Chart21 (Bulk) — copy of web icons.ts `report`
  static const report = PkIconData('report', [
    PkIconPath(r'M22 22H2c-.41 0-.75-.34-.75-.75s.34-.75.75-.75h20c.41 0 .75.34.75.75s-.34.75-.75.75Z'),
    PkIconPath(r'M9.75 4v18h4.5V4c0-1.1-.45-2-1.8-2h-.9c-1.35 0-1.8.9-1.8 2Z'),
    PkIconPath(
      r'M3 10v12h4V10c0-1.1-.4-2-1.6-2h-.8C3.4 8 3 8.9 3 10ZM17 15v7h4v-7c0-1.1-.4-2-1.6-2h-.8c-1.2 0-1.6.9-1.6 2Z',
      opacity: 0.4,
    ),
  ], webName: 'report');

  /// Iconsax Notification (Linear) — copy of web icons.ts `bell`
  static const bell = PkIconData('bell', [
    PkIconPath(
      r'M12.02 2.91c-3.31 0-6 2.69-6 6v2.89c0 .61-.26 1.54-.57 2.06L4.3 15.77c-.71 1.18-.22 2.49 1.08 2.93 4.31 1.44 8.96 1.44 13.27 0 1.21-.4 1.74-1.83 1.08-2.93l-1.15-1.91c-.3-.52-.56-1.45-.56-2.06V8.91c0-3.3-2.7-6-6-6Z',
      stroke: true,
    ),
    PkIconPath(r'M13.87 3.2a6.754 6.754 0 0 0-3.7 0c.29-.74 1.01-1.26 1.85-1.26.84 0 1.56.52 1.85 1.26Z', stroke: true),
    PkIconPath(r'M15.02 19.06c0 1.65-1.35 3-3 3-.82 0-1.58-.34-2.12-.88a3.01 3.01 0 0 1-.88-2.12', stroke: true),
  ], webName: 'bell');

  /// Iconsax Moon (Linear) — copy of web icons.ts `moon`
  static const moon = PkIconData('moon', [
    PkIconPath(
      r'M2.03 12.42c.36 5.15 4.73 9.34 9.96 9.57 3.69.16 6.99-1.56 8.97-4.27.82-1.11.38-1.85-.99-1.6-.67.12-1.36.17-2.08.14C13 16.06 9 11.97 8.98 7.14c-.01-1.3.26-2.53.75-3.65.54-1.24-.11-1.83-1.36-1.3C4.41 3.86 1.7 7.85 2.03 12.42Z',
      stroke: true,
    ),
  ], webName: 'moon');

  /// Iconsax Sun1 (Linear) — copy of web icons.ts `sun`
  static const sun = PkIconData('sun', [
    PkIconPath(r'M12 18.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z', stroke: true),
    PkIconPath(
      r'm19.14 19.14-.13-.13m0-14.02.13-.13-.13.13ZM4.86 19.14l.13-.13-.13.13ZM12 2.08V2v.08ZM12 22v-.08.08ZM2.08 12H2h.08ZM22 12h-.08.08ZM4.99 4.99l-.13-.13.13.13Z',
      stroke: true,
    ),
  ], webName: 'sun');

  /// Iconsax Home2 (Linear) — iconsax-reactjs@0.0.8 dist/cjs/Home2.js
  static const homeLinear = PkIconData('homeLinear', [
    PkIconPath(
      r'm9.02 2.84-5.39 4.2C2.73 7.74 2 9.23 2 10.36v7.41c0 2.32 1.89 4.22 4.21 4.22h11.58c2.32 0 4.21-1.9 4.21-4.21V10.5c0-1.21-.81-2.76-1.8-3.45l-6.18-4.33c-1.4-.98-3.65-.93-5 .12ZM12 17.99v-3',
      stroke: true,
    ),
  ]);

  /// Iconsax ClipboardTick (Linear) — iconsax-reactjs@0.0.8 dist/cjs/ClipboardTick.js
  static const approvalLinear = PkIconData('approvalLinear', [
    PkIconPath(r'm9.31 14.7 1.5 1.5 4-4', stroke: true),
    PkIconPath(r'M10 6h4c2 0 2-1 2-2 0-2-1-2-2-2h-4C9 2 8 2 8 4s1 2 2 2Z', stroke: true),
    PkIconPath(r'M16 4.02c3.33.18 5 1.41 5 5.98v6c0 4-1 6-6 6H9c-5 0-6-2-6-6v-6c0-4.56 1.67-5.8 5-5.98', stroke: true),
  ]);

  /// Iconsax MoneySend (Bulk) — iconsax-reactjs@0.0.8 dist/cjs/MoneySend.js
  static const advance = PkIconData('advance', [
    PkIconPath(
      r'M17 7.75c-.19 0-.38-.07-.53-.22a.754.754 0 0 1 0-1.06l2.05-2.05C16.76 2.92 14.49 2 12 2 6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10c0-2.49-.92-4.76-2.42-6.52l-2.05 2.05c-.15.15-.34.22-.53.22Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'm13.75 11.82-1-.35V9.25h.08c.51 0 .92.45.92 1 0 .41.34.75.75.75s.75-.34.75-.75c0-1.38-1.08-2.5-2.42-2.5h-.08V7.5c0-.41-.34-.75-.75-.75s-.75.34-.75.75v.25h-.3c-1.21 0-2.2 1.02-2.2 2.28 0 1.46.85 1.93 1.5 2.16l1 .35v2.22h-.08c-.51 0-.92-.45-.92-1 0-.41-.34-.75-.75-.75s-.75.34-.75.75c0 1.38 1.08 2.5 2.42 2.5h.08v.25c0 .41.34.75.75.75s.75-.34.75-.75v-.25h.3c1.21 0 2.2-1.02 2.2-2.28 0-1.47-.85-1.94-1.5-2.16Zm-3.01-1.06c-.34-.12-.49-.19-.49-.74 0-.43.32-.78.7-.78h.3v1.69l-.51-.17Zm2.31 3.99h-.3v-1.69l.51.18c.34.12.49.19.49.74 0 .42-.32.77-.7.77ZM22.688 1.708a.782.782 0 0 0-.41-.41.717.717 0 0 0-.29-.06h-4c-.41 0-.75.34-.75.75s.34.75.75.75h2.19l-1.67 1.67c.38.33.73.68 1.06 1.06l1.67-1.67v2.2c0 .41.34.75.75.75s.75-.34.75-.75v-4c.01-.1-.01-.19-.05-.29Z',
    ),
  ]);

  /// Iconsax ReceiptText (Bulk) — iconsax-reactjs@0.0.8 dist/cjs/ReceiptText.js
  static const reimburse = PkIconData('reimburse', [
    PkIconPath(
      r'M22 6v2.42C22 10 21 11 19.42 11H16V4.01C16 2.9 16.91 2 18.02 2c1.09.01 2.09.45 2.81 1.17C21.55 3.9 22 4.9 22 6Z',
    ),
    PkIconPath(
      r'M2 7v14c0 .83.94 1.3 1.6.8l1.71-1.28c.4-.3.96-.26 1.32.1l1.66 1.67c.39.39 1.03.39 1.42 0l1.68-1.68c.35-.35.91-.39 1.3-.09l1.71 1.28c.66.49 1.6.02 1.6-.8V4c0-1.1.9-2 2-2H6C3 2 2 3.79 2 6v1Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M12 9.75H6c-.41 0-.75-.34-.75-.75s.34-.75.75-.75h6c.41 0 .75.34.75.75s-.34.75-.75.75ZM11.25 13.75h-4.5c-.41 0-.75-.34-.75-.75s.34-.75.75-.75h4.5c.41 0 .75.34.75.75s-.34.75-.75.75Z',
    ),
  ]);

  /// Iconsax DocumentText (Bulk) — iconsax-reactjs@0.0.8 dist/cjs/DocumentText.js
  static const requests = PkIconData('requests', [
    PkIconPath(
      r'M20.5 10.19h-2.89c-2.37 0-4.3-1.93-4.3-4.3V3c0-.55-.45-1-1-1H8.07C4.99 2 2.5 4 2.5 7.57v8.86C2.5 20 4.99 22 8.07 22h7.86c3.08 0 5.57-2 5.57-5.57v-5.24c0-.55-.45-1-1-1Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M15.8 2.21c-.41-.41-1.12-.13-1.12.44v3.49c0 1.46 1.24 2.67 2.75 2.67.95.01 2.27.01 3.4.01.57 0 .87-.67.47-1.07-1.44-1.45-4.02-4.06-5.5-5.54ZM13.5 13.75h-6c-.41 0-.75-.34-.75-.75s.34-.75.75-.75h6c.41 0 .75.34.75.75s-.34.75-.75.75ZM11.5 17.75h-4c-.41 0-.75-.34-.75-.75s.34-.75.75-.75h4c.41 0 .75.34.75.75s-.34.75-.75.75Z',
    ),
  ]);

  /// Iconsax DocumentText (Linear) — iconsax-reactjs@0.0.8 dist/cjs/DocumentText.js
  static const requestsLinear = PkIconData('requestsLinear', [
    PkIconPath(r'M21 7v10c0 3-1.5 5-5 5H8c-3.5 0-5-2-5-5V7c0-3 1.5-5 5-5h8c3.5 0 5 2 5 5Z', stroke: true),
    PkIconPath(r'M14.5 4.5v2c0 1.1.9 2 2 2h2M8 13h4M8 17h8', stroke: true),
  ]);

  /// Iconsax StatusUp (Bulk) — iconsax-reactjs@0.0.8 dist/cjs/StatusUp.js
  static const progress = PkIconData('progress', [
    PkIconPath(
      r'M16.19 2H7.81C4.17 2 2 4.17 2 7.81v8.37C2 19.83 4.17 22 7.81 22h8.37c3.64 0 5.81-2.17 5.81-5.81V7.81C22 4.17 19.83 2 16.19 2Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M6.88 18.898c-.41 0-.75-.34-.75-.75v-2.07c0-.41.34-.75.75-.75s.75.34.75.75v2.07c0 .42-.34.75-.75.75ZM12 18.9c-.41 0-.75-.34-.75-.75V14c0-.41.34-.75.75-.75s.75.34.75.75v4.15c0 .42-.34.75-.75.75ZM17.12 18.9c-.41 0-.75-.34-.75-.75v-6.22c0-.41.34-.75.75-.75s.75.34.75.75v6.22c0 .42-.33.75-.75.75ZM17.871 5.822c0-.05-.02-.11-.03-.16l-.03-.13c-.02-.04-.05-.07-.07-.11-.03-.04-.06-.09-.1-.12-.01-.01-.01-.02-.02-.02-.03-.02-.06-.03-.09-.05a.638.638 0 0 0-.14-.08c-.05-.02-.1-.02-.15-.03-.04-.01-.07-.02-.11-.02h-2.93c-.41 0-.75.34-.75.75s.34.75.75.75h1.25c-2.38 2.5-5.38 4.26-8.75 5.11-.4.1-.65.51-.55.91.08.34.39.57.73.57.06 0 .12-.01.18-.02 3.57-.89 6.76-2.74 9.31-5.36v.97c0 .41.34.75.75.75s.75-.34.75-.75v-2.96Z',
    ),
  ]);

  /// Iconsax NoteAdd (Bulk) — iconsax-reactjs@0.0.8 dist/cjs/NoteAdd.js
  static const addendum = PkIconData('addendum', [
    PkIconPath(
      r'M7.37 22h9.25a4.87 4.87 0 0 0 4.87-4.87V8.37a4.87 4.87 0 0 0-4.87-4.87H7.37A4.87 4.87 0 0 0 2.5 8.37v8.75c0 2.7 2.18 4.88 4.87 4.88Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M8.29 6.29c-.42 0-.75-.34-.75-.75V2.75a.749.749 0 1 1 1.5 0v2.78c0 .42-.33.76-.75.76ZM15.71 6.29c-.42 0-.75-.34-.75-.75V2.75a.749.749 0 1 1 1.5 0v2.78c0 .42-.33.76-.75.76ZM12 14.75h-1.69V13c0-.41-.34-.75-.75-.75s-.75.34-.75.75v1.75H7c-.41 0-.75.34-.75.75s.34.75.75.75h1.81V18c0 .41.34.75.75.75s.75-.34.75-.75v-1.75H12c.41 0 .75-.34.75-.75s-.34-.75-.75-.75Z',
    ),
  ]);

  /// Iconsax CloudChange (Bulk) — iconsax-reactjs@0.0.8 dist/cjs/CloudChange.js
  static const queue = PkIconData('queue', [
    PkIconPath(
      r'M8.11 11.85c-2.82.2-2.81 4.3 0 4.5h6.67c.81.01 1.59-.3 2.19-.84 1.98-1.73.92-5.2-1.68-5.53-.93-5.64-9.08-3.5-7.15 1.87',
    ),
    PkIconPath(
      r'M9 22.75c-4.27 0-7.75-3.48-7.75-7.75 0-.41.34-.75.75-.75s.75.34.75.75c0 2.96 2.06 5.44 4.83 6.09l-.27-.45a.751.751 0 1 1 1.29-.77l1.05 1.75c.14.23.14.52.01.75-.14.23-.39.38-.66.38ZM22 9.75c-.41 0-.75-.34-.75-.75 0-2.96-2.06-5.44-4.83-6.09l.27.45a.751.751 0 1 1-1.29.77l-1.05-1.75a.745.745 0 0 1-.01-.75c.13-.24.38-.38.65-.38 4.27 0 7.75 3.48 7.75 7.75a.74.74 0 0 1-.74.75Z',
      opacity: 0.4,
    ),
  ]);

  /// Iconsax CloudChange (Linear) — iconsax-reactjs@0.0.8 dist/cjs/CloudChange.js
  static const queueLinear = PkIconData('queueLinear', [
    PkIconPath(
      r'M8.11 11.85c-2.82.2-2.81 4.3 0 4.5h6.67c.81.01 1.59-.3 2.19-.84 1.98-1.73.92-5.2-1.68-5.53-.93-5.64-9.08-3.5-7.15 1.87',
      stroke: true,
    ),
    PkIconPath(r'M2 15c0 3.87 3.13 7 7 7l-1.05-1.75M22 9c0-3.87-3.13-7-7-7l1.05 1.75', stroke: true),
  ]);

  /// Iconsax ProfileCircle (Bulk) — iconsax-reactjs@0.0.8 dist/cjs/ProfileCircle.js
  static const profile = PkIconData('profile', [
    PkIconPath(r'M12 22.012c5.523 0 10-4.477 10-10s-4.477-10-10-10-10 4.477-10 10 4.477 10 10 10Z', opacity: 0.4),
    PkIconPath(
      r'M12 6.941c-2.07 0-3.75 1.68-3.75 3.75 0 2.03 1.59 3.68 3.7 3.74h.18a3.743 3.743 0 0 0 3.62-3.74c0-2.07-1.68-3.75-3.75-3.75ZM18.779 19.358a9.976 9.976 0 0 1-6.78 2.65c-2.62 0-5-1.01-6.78-2.65.24-.91.89-1.74 1.84-2.38 2.73-1.82 7.17-1.82 9.88 0 .96.64 1.6 1.47 1.84 2.38Z',
    ),
  ]);

  /// Iconsax ProfileCircle (Linear) — iconsax-reactjs@0.0.8 dist/cjs/ProfileCircle.js
  static const profileLinear = PkIconData('profileLinear', [
    PkIconPath(
      r'M12.12 12.78a.963.963 0 0 0-.24 0 3.27 3.27 0 0 1-3.16-3.27c0-1.81 1.46-3.28 3.28-3.28a3.276 3.276 0 0 1 .12 6.55ZM18.74 19.38A9.934 9.934 0 0 1 12 22c-2.6 0-4.96-.99-6.74-2.62.1-.94.7-1.86 1.77-2.58 2.74-1.82 7.22-1.82 9.94 0 1.07.72 1.67 1.64 1.77 2.58Z',
      stroke: true,
    ),
    PkIconPath(r'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z', stroke: true),
  ]);

  /// Iconsax Monitor (Linear) — iconsax-reactjs@0.0.8 dist/cjs/Monitor.js
  static const monitor = PkIconData('monitor', [
    PkIconPath(
      r'M6.44 2h11.11C21.11 2 22 2.89 22 6.44v6.33c0 3.56-.89 4.44-4.44 4.44H6.44C2.89 17.22 2 16.33 2 12.78V6.44C2 2.89 2.89 2 6.44 2ZM12 17.22V22M2 13h20M7.5 22h9',
      stroke: true,
    ),
  ]);

  /// Iconsax Profile2User (Bulk) — copy of web icons.ts `users`
  static const users = PkIconData('users', [
    PkIconPath(
      r'M9 2C6.38 2 4.25 4.13 4.25 6.75c0 2.57 2.01 4.65 4.63 4.74.08-.01.16-.01.22 0h.07a4.738 4.738 0 0 0 4.58-4.74C13.75 4.13 11.62 2 9 2Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M14.08 14.149c-2.79-1.86-7.34-1.86-10.15 0-1.27.85-1.97 2-1.97 3.23s.7 2.37 1.96 3.21c1.4.94 3.24 1.41 5.08 1.41 1.84 0 3.68-.47 5.08-1.41 1.26-.85 1.96-1.99 1.96-3.23-.01-1.23-.7-2.37-1.96-3.21Z',
    ),
    PkIconPath(
      r'M19.99 7.338c.16 1.94-1.22 3.64-3.13 3.87h-.05c-.06 0-.12 0-.17.02-.97.05-1.86-.26-2.53-.83 1.03-.92 1.62-2.3 1.5-3.8a4.64 4.64 0 0 0-.77-2.18 3.592 3.592 0 0 1 5.15 2.92Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M21.988 16.59c-.08.97-.7 1.81-1.74 2.38-1 .55-2.26.81-3.51.78.72-.65 1.14-1.46 1.22-2.32.1-1.24-.49-2.43-1.67-3.38-.67-.53-1.45-.95-2.3-1.26 2.21-.64 4.99-.21 6.7 1.17.92.74 1.39 1.67 1.3 2.63Z',
    ),
  ], webName: 'users');

  /// Iconsax Box (Bulk) — copy of web icons.ts `master`
  static const master = PkIconData('master', [
    PkIconPath(
      r'M20.098 6.94c0 .54-.29 1.03-.75 1.28l-1.74.94-1.48.79-3.07 1.66c-.33.18-.69.27-1.06.27-.37 0-.73-.09-1.06-.27l-6.29-3.39c-.46-.25-.75-.74-.75-1.28s.29-1.03.75-1.28l1.97-1.06 1.57-.85 2.75-1.48c.66-.36 1.46-.36 2.12 0l6.29 3.39c.46.25.75.74.75 1.28ZM9.899 12.788l-5.85-2.93c-.45-.23-.97-.2-1.4.06-.43.26-.68.72-.68 1.22v5.53c0 .96.53 1.82 1.39 2.25l5.85 2.92c.2.1.42.15.64.15.26 0 .52-.07.75-.22.43-.26.68-.72.68-1.22v-5.53c.01-.94-.52-1.8-1.38-2.23ZM22.03 11.15v5.53c0 .95-.529 1.81-1.389 2.24l-5.85 2.93a1.433 1.433 0 0 1-1.4-.07c-.42-.26-.68-.72-.68-1.22v-5.52c0-.96.53-1.82 1.39-2.25l2.15-1.07 1.5-.75 2.2-1.1c.45-.23.97-.21 1.4.06.42.26.68.72.68 1.22Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'm17.611 9.16-1.48.79-9.51-5.35 1.57-.85 9.18 5.18c.1.06.18.14.24.23ZM17.75 10.969v2.27c0 .41-.34.75-.75.75s-.75-.34-.75-.75v-1.52l1.5-.75Z',
    ),
  ], webName: 'master');

  /// Iconsax Gallery (Bulk) — copy of web icons.ts `media`
  static const media = PkIconData('media', [
    PkIconPath(
      r'M22 7.81v6.09l-1.63-1.4c-.78-.67-2.04-.67-2.82 0l-4.16 3.57c-.78.67-2.04.67-2.82 0l-.34-.28c-.71-.62-1.84-.68-2.64-.14l-4.92 3.3-.11.08c-.37-.8-.56-1.75-.56-2.84V7.81C2 4.17 4.17 2 7.81 2h8.38C19.83 2 22 4.17 22 7.81Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M9.001 10.381a2.38 2.38 0 1 0 0-4.76 2.38 2.38 0 0 0 0 4.76ZM21.999 13.899v2.29c0 3.64-2.17 5.81-5.81 5.81h-8.38c-2.55 0-4.39-1.07-5.25-2.97l.11-.08 4.92-3.3c.8-.54 1.93-.48 2.64.14l.34.28c.78.67 2.04.67 2.82 0l4.16-3.57c.78-.67 2.04-.67 2.82 0l1.63 1.4Z',
    ),
  ], webName: 'media');

  /// Iconsax Setting2 (Bulk) — copy of web icons.ts `settings`
  static const settings = PkIconData('settings', [
    PkIconPath(
      r'M2 12.881v-1.76c0-1.04.85-1.9 1.9-1.9 1.81 0 2.55-1.28 1.64-2.85-.52-.9-.21-2.07.7-2.59l1.73-.99c.79-.47 1.81-.19 2.28.6l.11.19c.9 1.57 2.38 1.57 3.29 0l.11-.19c.47-.79 1.49-1.07 2.28-.6l1.73.99c.91.52 1.22 1.69.7 2.59-.91 1.57-.17 2.85 1.64 2.85 1.04 0 1.9.85 1.9 1.9v1.76c0 1.04-.85 1.9-1.9 1.9-1.81 0-2.55 1.28-1.64 2.85.52.91.21 2.07-.7 2.59l-1.73.99c-.79.47-1.81.19-2.28-.6l-.11-.19c-.9-1.57-2.38-1.57-3.29 0l-.11.19c-.47.79-1.49 1.07-2.28.6l-1.73-.99a1.899 1.899 0 0 1-.7-2.59c.91-1.57.17-2.85-1.64-2.85-1.05 0-1.9-.86-1.9-1.9Z',
      opacity: 0.4,
    ),
    PkIconPath(r'M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z'),
  ], webName: 'settings');

  /// Iconsax ShieldTick (Bulk) — copy of web icons.ts `system`
  static const system = PkIconData('system', [
    PkIconPath(
      r'm10.96 2.059-5.5 2.06c-1.05.4-1.91 1.64-1.91 2.77v8.1c0 .81.53 1.88 1.18 2.36l5.5 4.11c.97.73 2.56.73 3.53 0l5.5-4.11c.65-.49 1.18-1.55 1.18-2.36v-8.1c0-1.12-.86-2.37-1.91-2.76l-5.5-2.06c-.56-.22-1.5-.22-2.07-.01Z',
      opacity: 0.4,
    ),
    PkIconPath(
      r'M10.658 14.231c-.19 0-.38-.07-.53-.22l-1.61-1.61a.754.754 0 0 1 0-1.06c.29-.29.77-.29 1.06 0l1.08 1.08 3.77-3.77c.29-.29.77-.29 1.06 0 .29.29.29.77 0 1.06l-4.3 4.3c-.15.15-.34.22-.53.22Z',
    ),
  ], webName: 'system');

  static const all = <PkIconData>[
    home,
    approval,
    project,
    finance,
    attendance,
    report,
    bell,
    moon,
    sun,
    homeLinear,
    approvalLinear,
    advance,
    reimburse,
    requests,
    requestsLinear,
    progress,
    addendum,
    queue,
    queueLinear,
    profile,
    profileLinear,
    monitor,
    users,
    master,
    media,
    settings,
    system,
  ];
}
