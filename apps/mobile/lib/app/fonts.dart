import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Bundled OFL fonts (pubspec `fonts:`, ADR 0015). The SIL OFL 1.1 asks that the licence travels with
/// the fonts: both texts ship as assets and appear on Flutter's licence page.
const fontLicenses = <(String package, String asset)>[
  ('Space Grotesk (font)', 'assets/fonts/OFL-SpaceGrotesk.txt'),
  ('DM Sans (font)', 'assets/fonts/OFL-DMSans.txt'),
];

void registerFontLicenses() {
  LicenseRegistry.addLicense(() async* {
    for (final (name, asset) in fontLicenses) {
      yield LicenseEntryWithLineBreaks([name], await rootBundle.loadString(asset));
    }
  });
}
