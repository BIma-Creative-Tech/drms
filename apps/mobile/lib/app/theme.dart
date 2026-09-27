import 'package:flutter/material.dart';

/// Field-friendly theme: large touch targets and text (v1.0 #12 "tombol besar").
ThemeData buildTheme() {
  const seed = Color(0xFF0B6E4F);
  final scheme = ColorScheme.fromSeed(seedColor: seed);
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    visualDensity: VisualDensity.standard,
    appBarTheme: AppBarTheme(backgroundColor: scheme.primary, foregroundColor: scheme.onPrimary),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52), textStyle: const TextStyle(fontSize: 16)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
    ),
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
    listTileTheme: const ListTileThemeData(minVerticalPadding: 12),
  );
}

abstract final class StatusColors {
  static const warning = Color(0xFFB45309);
  static const danger = Color(0xFFB91C1C);
  static const ok = Color(0xFF15803D);
}
