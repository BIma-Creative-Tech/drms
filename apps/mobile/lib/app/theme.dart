import 'package:flutter/material.dart';

import 'theme/tokens.dart';

export 'theme/tokens.dart' show PkModule, PkTokens, PkGradients, PkGradient;

/// Bundled font families (pubspec `fonts:`; SIL OFL 1.1, see assets/fonts/ and app/fonts.dart).
abstract final class PkFonts {
  /// Headings / titles (web `--font-brand-heading`), weights 600 + 700.
  static const heading = 'SpaceGrotesk';

  /// Body / labels (web `--font-brand-body`), weights 400, 500, 700.
  static const body = 'DMSans';
}

/// Status + brand colours that Material's [ColorScheme] has no slot for (ADR 0015). Read with
/// `context.pk`; falls back to the tokens of the current brightness when a widget is pumped in a bare
/// [MaterialApp] without [buildTheme].
@immutable
class PkColors extends ThemeExtension<PkColors> {
  const PkColors({
    required this.ok,
    required this.warn,
    required this.bad,
    required this.okText,
    required this.warnText,
    required this.badText,
    required this.info,
    required this.accent,
    required this.onAccent,
    required this.card,
    required this.border,
    required this.muted,
    required this.brightness,
  });

  factory PkColors.of(Brightness b) {
    final t = PkTokens.of(b);
    return PkColors(
      ok: t.ok,
      warn: t.warn,
      bad: t.bad,
      okText: t.okText,
      warnText: t.warnText,
      badText: t.badText,
      info: t.primary,
      accent: t.accent,
      onAccent: t.accentForeground,
      card: t.card,
      border: t.border,
      muted: t.muted,
      brightness: b,
    );
  }

  /// Filled badges / chips with white text.
  final Color ok;
  final Color warn;
  final Color bad;

  /// Status text and icons on the page background or a card.
  final Color okText;
  final Color warnText;
  final Color badText;

  /// Neutral "in progress" status (e.g. attendance "Hadir") = primary.
  final Color info;
  final Color accent;
  final Color onAccent;
  final Color card;
  final Color border;
  final Color muted;
  final Brightness brightness;

  /// Launcher tile gradient of a web module for this brightness.
  PkGradient gradient(PkModule m) => PkGradients.of(m, brightness);

  @override
  PkColors copyWith() => this;

  @override
  PkColors lerp(PkColors? other, double t) => t < 0.5 || other == null ? this : other;
}

extension PkThemeContext on BuildContext {
  PkColors get pk {
    final theme = Theme.of(this);
    return theme.extension<PkColors>() ?? PkColors.of(theme.brightness);
  }
}

/// Material 3 scheme built slot by slot from the web tokens (no seed generation).
ColorScheme pkColorScheme(Brightness b) {
  final t = PkTokens.of(b);
  final dark = b == Brightness.dark;
  const white = Color(0xFFFFFFFF);
  return ColorScheme(
    brightness: b,
    primary: t.primary,
    onPrimary: t.primaryForeground,
    primaryContainer: dark ? const Color(0xFF172554) : const Color(0xFFDBEAFE),
    onPrimaryContainer: dark ? const Color(0xFFDBEAFE) : const Color(0xFF1E3A8A),
    // Material uses secondaryContainer for selected chips / segmented buttons: the same primary tint.
    secondary: t.mutedForeground,
    onSecondary: dark ? t.background : white,
    secondaryContainer: dark ? const Color(0xFF172554) : const Color(0xFFDBEAFE),
    onSecondaryContainer: dark ? const Color(0xFFDBEAFE) : const Color(0xFF1E3A8A),
    tertiary: t.accent,
    onTertiary: t.accentForeground,
    tertiaryContainer: dark ? const Color(0xFF431407) : const Color(0xFFFFEDD5),
    onTertiaryContainer: dark ? const Color(0xFFFFEDD5) : const Color(0xFF7C2D12),
    error: t.destructive,
    onError: dark ? t.background : white,
    errorContainer: dark ? const Color(0xFF450A0A) : const Color(0xFFFEE2E2),
    onErrorContainer: dark ? const Color(0xFFFEE2E2) : const Color(0xFF7F1D1D),
    surface: t.background,
    onSurface: t.foreground,
    onSurfaceVariant: t.mutedForeground,
    surfaceDim: dark ? const Color(0xFF070B16) : const Color(0xFFE2E8F0),
    surfaceBright: dark ? const Color(0xFF1E293B) : white,
    surfaceContainerLowest: dark ? const Color(0xFF070B16) : white,
    surfaceContainerLow: t.card,
    surfaceContainer: dark ? const Color(0xFF111A2E) : const Color(0xFFF1F5F9),
    surfaceContainerHigh: t.muted,
    surfaceContainerHighest: dark ? const Color(0xFF253247) : const Color(0xFFE2E8F0),
    // Neutral icons in this app use `outline` → ≥ 3:1 on background and card (theme test).
    outline: dark ? const Color(0xFF8494A9) : const Color(0xFF64748B),
    outlineVariant: t.border,
    shadow: const Color(0xFF000000),
    scrim: const Color(0xFF000000),
    inverseSurface: dark ? const Color(0xFFE2E8F0) : const Color(0xFF1E293B),
    onInverseSurface: dark ? const Color(0xFF0B1120) : const Color(0xFFF1F5F9),
    inversePrimary: dark ? const Color(0xFF2563EB) : const Color(0xFF93C5FD),
    surfaceTint: Colors.transparent,
  );
}

TextTheme _textTheme(ColorScheme scheme) {
  // Geometry (sizes) merged in here so component styles taken from this theme carry their font size.
  final m3 = Typography.material2021();
  final base = m3.englishLike
      .merge(scheme.brightness == Brightness.dark ? m3.white : m3.black)
      .apply(fontFamily: PkFonts.body, bodyColor: scheme.onSurface, displayColor: scheme.onSurface);
  TextStyle? heading(TextStyle? s, FontWeight w) => s?.copyWith(fontFamily: PkFonts.heading, fontWeight: w);
  return base.copyWith(
    displayLarge: heading(base.displayLarge, FontWeight.w700),
    displayMedium: heading(base.displayMedium, FontWeight.w700),
    displaySmall: heading(base.displaySmall, FontWeight.w700),
    headlineLarge: heading(base.headlineLarge, FontWeight.w700),
    headlineMedium: heading(base.headlineMedium, FontWeight.w700),
    headlineSmall: heading(base.headlineSmall, FontWeight.w600),
    titleLarge: heading(base.titleLarge, FontWeight.w600),
    titleMedium: heading(base.titleMedium, FontWeight.w600),
    titleSmall: base.titleSmall?.copyWith(fontWeight: FontWeight.w700),
    labelLarge: base.labelLarge?.copyWith(fontWeight: FontWeight.w700),
  );
}

/// Field-friendly theme (v1.0 #12 "tombol besar": filled buttons 52 dp, touch targets ≥ 48 dp) in the web
/// admin look (ADR 0015): token colours, Space Grotesk / DM Sans, radius 14, surface-style app bar.
ThemeData buildTheme([Brightness brightness = Brightness.light]) {
  final scheme = pkColorScheme(brightness);
  final t = PkTokens.of(brightness);
  final text = _textTheme(scheme);
  const radius = BorderRadius.all(Radius.circular(PkTokens.radius));
  const shape = RoundedRectangleBorder(borderRadius: radius);
  OutlineInputBorder inputBorder(Color c, [double w = 1]) => OutlineInputBorder(
    borderRadius: radius,
    borderSide: BorderSide(color: c, width: w),
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    textTheme: text,
    primaryTextTheme: text,
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    scaffoldBackgroundColor: t.background,
    canvasColor: t.background,
    dividerColor: t.border,
    extensions: [PkColors.of(brightness)],
    appBarTheme: AppBarTheme(
      // Web top bar: card surface with a hairline, not a solid brand colour.
      backgroundColor: t.card,
      foregroundColor: t.foreground,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      shape: Border(bottom: BorderSide(color: t.border)),
      titleTextStyle: text.titleLarge?.copyWith(fontSize: 20, color: t.foreground),
      iconTheme: IconThemeData(color: t.foreground),
      actionsIconTheme: IconThemeData(color: t.foreground),
    ),
    cardTheme: CardThemeData(
      color: t.card,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: BorderSide(color: t.border),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: shape,
        textStyle: text.labelLarge?.copyWith(fontSize: 16),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        shape: shape,
        side: BorderSide(color: t.input),
        textStyle: text.labelLarge?.copyWith(fontSize: 15),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(minimumSize: const Size(48, 48), shape: shape, textStyle: text.labelLarge),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(minimumSize: const Size(48, 48), shape: shape),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        minimumSize: const Size(48, 48),
        side: BorderSide(color: t.input),
        textStyle: text.labelLarge,
      ).copyWith(shape: const WidgetStatePropertyAll(shape)),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: t.primary,
      foregroundColor: t.primaryForeground,
      shape: shape,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: t.card,
      border: inputBorder(t.input),
      enabledBorder: inputBorder(t.input),
      focusedBorder: inputBorder(t.ring, 2),
      errorBorder: inputBorder(t.destructive),
      focusedErrorBorder: inputBorder(t.destructive, 2),
      disabledBorder: inputBorder(t.border),
    ),
    listTileTheme: ListTileThemeData(minVerticalPadding: 12, iconColor: t.mutedForeground),
    chipTheme: ChipThemeData(
      side: BorderSide(color: t.border),
      shape: const StadiumBorder(),
      labelStyle: text.labelLarge?.copyWith(fontWeight: FontWeight.w500, color: t.foreground),
    ),
    badgeTheme: BadgeThemeData(backgroundColor: t.bad, textColor: const Color(0xFFFFFFFF)),
    dialogTheme: DialogThemeData(
      backgroundColor: t.card,
      surfaceTintColor: Colors.transparent,
      shape: shape,
      titleTextStyle: text.titleLarge?.copyWith(color: t.foreground),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: t.card,
      surfaceTintColor: Colors.transparent,
      modalBackgroundColor: t.card,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(PkTokens.radius))),
    ),
    popupMenuTheme: PopupMenuThemeData(color: t.card, surfaceTintColor: Colors.transparent, shape: shape),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: shape,
      backgroundColor: scheme.inverseSurface,
      contentTextStyle: text.bodyMedium?.copyWith(color: scheme.onInverseSurface),
    ),
    tabBarTheme: TabBarThemeData(
      labelColor: t.primary,
      unselectedLabelColor: t.mutedForeground,
      indicatorColor: t.primary,
      dividerColor: t.border,
      labelStyle: text.labelLarge,
      unselectedLabelStyle: text.labelLarge?.copyWith(fontWeight: FontWeight.w500),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: t.card,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      height: 72,
      // Web active menu entry: pill in a primary tint.
      indicatorColor: t.primary.withValues(alpha: brightness == Brightness.dark ? 0.20 : 0.12),
      indicatorShape: const StadiumBorder(),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(size: 24, color: s.contains(WidgetState.selected) ? t.primary : t.mutedForeground),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => text.labelMedium?.copyWith(
          color: s.contains(WidgetState.selected) ? t.primary : t.mutedForeground,
          fontWeight: s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: t.primary, linearTrackColor: t.muted),
    dividerTheme: DividerThemeData(color: t.border, space: 1),
  );
}
