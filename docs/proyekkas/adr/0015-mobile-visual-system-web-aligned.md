# ADR 0015 — APK visual system aligned with the web admin: tokens, bundled OFL fonts, Iconsax glyphs

- **Status:** proposed (2026-09-27, awaiting user approval of the screenshots)
- **Date:** 2026-09-27
- **Related:** ADR 0014 (web admin "gaya Odoo", Iconsax licence accepted 2026-09-27), ADR 0010 (Flutter APK),
  plan `plans/mobile-ui-refresh.md`, /opt/infra CLAUDE.md §0.10 (trusted OSS, licence, < 6 months maintenance,
  exact pins), web v0.4.0 (`apps/web/src/theme/tokens.ts`, `fonts.ts`, `src/admin/modules/icons.ts`).

## Context

Web release v0.4.0 gave the admin a new look (web-starter design system: trust blue #2563EB, CTA orange #EA580C,
slate surfaces, Space Grotesk / DM Sans, radius 0.875rem, Odoo-style launcher with gradient tiles and Iconsax
glyphs). The APK (`apps/mobile` 0.1.0) still used a Material seed theme (green #0B6E4F), Roboto, Material icons and
a list of big buttons on the home screen. The user asked to align the APK look ("penyesuaian tampilan") without
changing behaviour, API, sync or DB.

## Decision

1. **Colours = web tokens, copied, drift-tested.** `lib/app/theme/tokens.dart` holds the web `semantic.light/dark`
   tokens, the 11 module gradients and the radius (14 dp). The Material 3 `ColorScheme` is built slot by slot from
   them (`pkColorScheme`, no seed generation); status colours the scheme has no slot for (ok/warn/bad filled + text
   variants, info, accent) live in a `ThemeExtension` `PkColors` (`context.pk`), replacing the old `StatusColors`
   constants (callers migrated: text/icons use `okText/warnText/badText`, which switch to the light variants in dark
   mode). `test/unit/theme_tokens_test.dart` parses `apps/web/src/theme/tokens.ts` at test time and fails when a value
   drifts, and repeats the WCAG pairs of `apps/web/tests/unit/theme.test.ts` (text ≥ 4.5:1, ring ≥ 3:1, white glyph
   ≥ 3:1 on every gradient stop) plus the derived Material pairs.
2. **Theme.** Light **and** dark; surface-style app bar (card colour + hairline, like the web top bar); radius 14 on
   cards, buttons, inputs, dialogs, sheets; field-friendly sizes kept (filled buttons 52 dp, touch targets ≥ 48 dp,
   `MaterialTapTargetSize.padded`). **Tampilan** in Profil: Sistem (default) / Terang / Gelap, stored in the existing
   `SecureStore` under `pk.theme_mode` (a phone preference; logout does not clear it) and read in `main()` before the
   first frame. No new storage package (`shared_preferences` not added).
3. **Fonts: bundled, OFL, no runtime download.** Space Grotesk (600, 700) and DM Sans (400, 500, 700) from
   `github.com/google/fonts` @ `23e54b51ddffbc7713c583748e3bd86f62b1fa4a` (`ofl/spacegrotesk/SpaceGrotesk[wght].ttf`,
   `ofl/dmsans/DMSans[opsz,wght].ttf`), cut into static instances with fontTools 4.60.1 `varLib.instancer --static`
   (DM Sans at opsz 14) so `FontWeight` picks the right face on every engine — ≈ 350 KB in the APK. SIL OFL 1.1, no
   Reserved Font Name in either `OFL.txt`, so modified (instanced) versions may keep the names. Both licence texts
   ship as assets and are registered in `LicenseRegistry` (`lib/app/fonts.dart`). `google_fonts` not used: it
   downloads at runtime by default and would need the same bundling anyway.
4. **Icons: same Iconsax artwork as the web, drawn by a ~150-line in-house SVG path parser + `CustomPainter`**
   (`lib/shared/icons/svg_path.dart`, `iconsax.dart`). Path data of the shared glyphs is copied verbatim from the web
   `icons.ts` (drift test `test/unit/iconsax_test.dart`); the APK-only glyphs (MoneySend, ReceiptText, DocumentText,
   StatusUp, NoteAdd, CloudChange, ProfileCircle, Home2/ClipboardTick Linear, Monitor) were taken exactly as ADR 0014
   describes: rendered once from `iconsax-reactjs@0.0.8` `dist/cjs/<Name>.js` (npm tarball, sha512 integrity
   verified), nothing installed. Arcs use `Path.arcToPoint` (SVG endpoint parameterisation). Other in-screen icons
   stay Material icons (no layout change).
5. **Iconsax licence covers the APK.** The user's acceptance of the *Iconsax Free License* in ADR 0014 (free
   commercial use integrated in a final product, no attribution required, no redistribution as a loose icon set) is
   applied to the APK: only the ~20 glyphs the app renders are embedded. Fallback if a strict OSI reading is ever
   required: swap the path data in `iconsax.dart` for an MIT/ISC set; no widget changes.
6. **Home = module launcher.** Greeting + role pill, then (below the KPI section for Direktur/Finance/PM) a grid of
   gradient tiles (2 columns on phones, 3 from 600 dp) — `ModuleTile` = white Iconsax Bulk glyph on a 135° web module
   gradient, label, secondary line, count badge. Mapping: Persetujuan → `persetujuan`; Ajukan uang muka / reimburse
   → `keuangan`; Semua/Pengajuan saya → `laporan`; Laporan progress and Addendum RAB → `proyek` (Addendum is a Proyek
   menu entry on the web); Absensi → `absensi`. Every visibility rule, badge, subtitle, route and widget key of the
   former `BigActionButton` list is kept (`home-requests` key added). Staggered entrance with built-in animation APIs
   (no motion package), skipped when `MediaQuery.disableAnimationsOf` is set. Bottom navigation: Iconsax Linear /
   Bulk (selected) on a primary-tint pill.
7. **Not changed:** behaviour, API, sync, DB, wording (new strings only: Tampilan, Sistem, Terang, Gelap + one hint),
   launcher icon and native splash (client logo pending, Q-32). Splash/login use a placeholder mark (dashboard
   gradient + WalletMoney glyph).

## Dependency evaluation (2026-09-27, pub.dev API)

| Candidate | Licence | Publisher / last release | What it brings | Verdict |
|---|---|---|---|---|
| `flutter_svg` 2.3.0 | MIT | flutter.dev, 2026-05-08 | `vector_graphics` + `_codec` + `_compiler` (→ `xml`, `path_parsing` 1.1.0 last released 2024-11-01), `http`; runtime SVG/XML parsing | **Rejected** — a whole SVG stack for ~20 path-only glyphs; transitive `path_parsing` fails the < 6 months rule |
| `path_drawing` 1.0.1 | MIT | dnfield.dev, 2022-08-04 | `parseSvgPathData` | **Rejected** — unmaintained (§0.10) |
| In-house parser + `CustomPainter` | own code | — | ~150 lines, unit-tested (compact numbers, packed arc flags, S/T reflection, malformed input) | **Chosen** |
| `google_fonts` 8.2.1 | Apache-2.0 | flutter.dev, 2026-07-31 | runtime font download (or bundled files) | **Not needed** — fonts bundled as assets |
| `shared_preferences` 2.5.5 | BSD-3 | flutter.dev, 2026-03-25 | key/value storage | **Not needed** — existing `SecureStore` holds the theme choice |

**No new package** in `pubspec.yaml` / `pubspec.lock`. New assets: 5 TTF files + 2 OFL texts (`assets/fonts/`).

## Consequences

- APK grows by ≈ 0.35 MB (fonts) — the arm64 split APK stays well under the 30 MB budget (checked on the CI
  artifact).
- Web token or glyph changes make the mobile tests fail until the Dart copy is updated (intended).
- Unsupported glyphs in DM Sans / Space Grotesk (e.g. emoji "⚠") fall back to the Android system font.
- Preview screenshots are produced without a device by `test_preview/screens_preview_test.dart` (not run in CI).
