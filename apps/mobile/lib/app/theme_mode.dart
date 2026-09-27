import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/logging/log.dart';
import '../core/storage/secure_store.dart';
import 'providers.dart';

/// Profil → Tampilan (Sistem / Terang / Gelap). A display preference of this phone, not of the user:
/// kept in the existing [SecureStore] (no new storage package) and never cleared by logout.
const themeModeKey = 'pk.theme_mode';

ThemeMode themeModeFromStored(String? v) => switch (v) {
  'light' => ThemeMode.light,
  'dark' => ThemeMode.dark,
  _ => ThemeMode.system,
};

String themeModeToStored(ThemeMode m) => switch (m) {
  ThemeMode.light => 'light',
  ThemeMode.dark => 'dark',
  ThemeMode.system => 'system',
};

/// Read once in `main()` before the first frame (no light→dark flash); unset = follow the system.
Future<ThemeMode> loadThemeMode(SecureStore store) async {
  try {
    return themeModeFromStored(await store.read(themeModeKey));
  } on Object catch (e) {
    Log.w('theme: reading the preference failed', e);
    return ThemeMode.system;
  }
}

/// Value read at start-up (overridden in `main()`); tests start with the system mode.
final initialThemeModeProvider = Provider<ThemeMode>((ref) => ThemeMode.system);

final themeModeProvider = NotifierProvider<ThemeModeController, ThemeMode>(ThemeModeController.new);

class ThemeModeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() => ref.watch(initialThemeModeProvider);

  Future<void> set(ThemeMode mode) async {
    if (mode == state) return;
    state = mode;
    try {
      await ref.read(secureStoreProvider).write(themeModeKey, themeModeToStored(mode));
    } on Object catch (e) {
      // The choice still applies for this run; only persistence failed.
      Log.w('theme: saving the preference failed', e);
    }
  }
}
