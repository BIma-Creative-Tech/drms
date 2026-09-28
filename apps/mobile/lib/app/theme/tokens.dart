import 'dart:math' as math;

import 'dart:ui' show Brightness, Color;

/// ProyekKas visual tokens = the web admin tokens (`apps/web/src/theme/tokens.ts`, web v0.4.0, ADR 0014/0015):
/// trust blue #2563EB, CTA orange #EA580C, slate surfaces, radius 0.875rem (= 14 dp).
///
/// Copied by hand; `test/unit/theme_tokens_test.dart` parses `tokens.ts` at test time and fails when the
/// two drift apart, and checks the WCAG contrast pairs of `apps/web/tests/unit/theme.test.ts`.
class PkSemantic {
  const PkSemantic({
    required this.background,
    required this.foreground,
    required this.card,
    required this.cardForeground,
    required this.primary,
    required this.primaryHover,
    required this.primaryForeground,
    required this.primarySoft,
    required this.accent,
    required this.accentHover,
    required this.accentForeground,
    required this.muted,
    required this.mutedForeground,
    required this.border,
    required this.input,
    required this.ring,
    required this.destructive,
    required this.ok,
    required this.warn,
    required this.bad,
    required this.okText,
    required this.warnText,
    required this.badText,
  });

  final Color background;
  final Color foreground;
  final Color card;
  final Color cardForeground;
  final Color primary;
  final Color primaryHover;
  final Color primaryForeground;
  /// Pale primary (web `primarySoft`, loader dots / soft fills).
  final Color primarySoft;
  final Color accent;
  final Color accentHover;
  final Color accentForeground;
  final Color muted;
  final Color mutedForeground;
  final Color border;
  final Color input;
  final Color ring;
  final Color destructive;

  /// Filled status badges (white text on top).
  final Color ok;
  final Color warn;
  final Color bad;

  /// Status text / icons on the page background or a card.
  final Color okText;
  final Color warnText;
  final Color badText;

  /// Name → value, same keys as the web `SemanticTokens` type (used by the drift test).
  Map<String, Color> toMap() => {
    'background': background,
    'foreground': foreground,
    'card': card,
    'cardForeground': cardForeground,
    'primary': primary,
    'primaryHover': primaryHover,
    'primaryForeground': primaryForeground,
    'primarySoft': primarySoft,
    'accent': accent,
    'accentHover': accentHover,
    'accentForeground': accentForeground,
    'muted': muted,
    'mutedForeground': mutedForeground,
    'border': border,
    'input': input,
    'ring': ring,
    'destructive': destructive,
    'ok': ok,
    'warn': warn,
    'bad': bad,
    'okText': okText,
    'warnText': warnText,
    'badText': badText,
  };
}

abstract final class PkTokens {
  static const light = PkSemantic(
    background: Color(0xFFF8FAFC),
    foreground: Color(0xFF1E293B),
    card: Color(0xFFFFFFFF),
    cardForeground: Color(0xFF1E293B),
    primary: Color(0xFF2563EB),
    primaryHover: Color(0xFF1D4ED8),
    primaryForeground: Color(0xFFFFFFFF),
    primarySoft: Color(0xFFBFDBFE),
    accent: Color(0xFFEA580C),
    accentHover: Color(0xFFF97316),
    accentForeground: Color(0xFF000000),
    muted: Color(0xFFE9EFF8),
    mutedForeground: Color(0xFF475569),
    border: Color(0xFFE2E8F0),
    input: Color(0xFFCBD5E1),
    ring: Color(0xFF2563EB),
    destructive: Color(0xFFDC2626),
    ok: Color(0xFF15803D),
    warn: Color(0xFFC2410C),
    bad: Color(0xFFB91C1C),
    okText: Color(0xFF15803D),
    warnText: Color(0xFFC2410C),
    badText: Color(0xFFB91C1C),
  );

  static const dark = PkSemantic(
    background: Color(0xFF0B1120),
    foreground: Color(0xFFE2E8F0),
    card: Color(0xFF111A2E),
    cardForeground: Color(0xFFE2E8F0),
    primary: Color(0xFF60A5FA),
    primaryHover: Color(0xFF93C5FD),
    primaryForeground: Color(0xFF0B1120),
    primarySoft: Color(0xFF1E40AF),
    accent: Color(0xFFFB923C),
    accentHover: Color(0xFFFDBA74),
    accentForeground: Color(0xFF0B1120),
    muted: Color(0xFF1E293B),
    mutedForeground: Color(0xFF94A3B8),
    border: Color(0xFF1E293B),
    input: Color(0xFF334155),
    ring: Color(0xFF60A5FA),
    destructive: Color(0xFFF87171),
    ok: Color(0xFF15803D),
    warn: Color(0xFFC2410C),
    bad: Color(0xFFB91C1C),
    okText: Color(0xFF4ADE80),
    warnText: Color(0xFFFB923C),
    badText: Color(0xFFF87171),
  );

  static PkSemantic of(Brightness b) => b == Brightness.dark ? dark : light;

  /// Web `radius` 0.875rem at 16 px/rem.
  static const double radius = 14;
}

/// Module ids of the web registry (`apps/web/src/admin/modules/registry.ts`) that the APK uses.
enum PkModule {
  dashboard,
  persetujuan,
  proyek,
  keuangan,
  absensi,
  laporan,
  pengguna,
  master,
  media,
  pengaturan,
  sistem,
}

/// Launcher tile gradient: [from, to] at 135°, white Iconsax Bulk glyph on top (web `moduleGradients`).
typedef PkGradient = ({Color from, Color to});

abstract final class PkGradients {
  static const Map<PkModule, ({PkGradient light, PkGradient dark})> all = {
    PkModule.dashboard: (
      light: (from: Color(0xFF2563EB), to: Color(0xFF1E40AF)),
      dark: (from: Color(0xFF1D4ED8), to: Color(0xFF1E3A8A)),
    ),
    PkModule.persetujuan: (
      light: (from: Color(0xFFEA580C), to: Color(0xFFB91C1C)),
      dark: (from: Color(0xFFC2410C), to: Color(0xFF991B1B)),
    ),
    PkModule.proyek: (
      light: (from: Color(0xFF4F46E5), to: Color(0xFF3730A3)),
      dark: (from: Color(0xFF4338CA), to: Color(0xFF312E81)),
    ),
    PkModule.keuangan: (
      light: (from: Color(0xFF059669), to: Color(0xFF065F46)),
      dark: (from: Color(0xFF047857), to: Color(0xFF064E3B)),
    ),
    PkModule.absensi: (
      light: (from: Color(0xFF0284C7), to: Color(0xFF075985)),
      dark: (from: Color(0xFF0369A1), to: Color(0xFF0C4A6E)),
    ),
    PkModule.laporan: (
      light: (from: Color(0xFF7C3AED), to: Color(0xFF5B21B6)),
      dark: (from: Color(0xFF6D28D9), to: Color(0xFF4C1D95)),
    ),
    PkModule.pengguna: (
      light: (from: Color(0xFFDB2777), to: Color(0xFF9D174D)),
      dark: (from: Color(0xFFBE185D), to: Color(0xFF831843)),
    ),
    PkModule.master: (
      light: (from: Color(0xFFB45309), to: Color(0xFF78350F)),
      dark: (from: Color(0xFF92400E), to: Color(0xFF78350F)),
    ),
    PkModule.media: (
      light: (from: Color(0xFFC026D3), to: Color(0xFF86198F)),
      dark: (from: Color(0xFFA21CAF), to: Color(0xFF701A75)),
    ),
    PkModule.pengaturan: (
      light: (from: Color(0xFF475569), to: Color(0xFF1E293B)),
      dark: (from: Color(0xFF334155), to: Color(0xFF0F172A)),
    ),
    PkModule.sistem: (
      light: (from: Color(0xFF0F766E), to: Color(0xFF134E4A)),
      dark: (from: Color(0xFF115E59), to: Color(0xFF042F2E)),
    ),
  };

  static PkGradient of(PkModule m, Brightness b) {
    final g = all[m]!;
    return b == Brightness.dark ? g.dark : g.light;
  }
}

/// WCAG 2.x contrast ratio (same formula as the web `contrastRatio`).
double contrastRatio(Color a, Color b) {
  double lum(Color c) {
    double f(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  final la = lum(a), lb = lum(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}
