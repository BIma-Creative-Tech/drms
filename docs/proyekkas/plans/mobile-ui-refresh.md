# ProyekKas APK — Penyesuaian tampilan dengan web admin (mobile 0.2.0)

- **Status:** DRAFT untuk persetujuan user (scope default disetujui 2026-09-27; hasil = screenshot + APK staging CI)
- **Tanggal:** 2026-09-27 · **Branch:** `feat/mobile-ui-refresh` (dari `develop` @ `272bf38`, web v0.4.0)
- **ADR:** `adr/0015-mobile-visual-system-web-aligned.md` (status *proposed*)
- **Permintaan user:** "buat scopenya dan develop lakukan penyesuaian tampilan" — APK `apps/mobile` mengikuti tampilan
  baru web admin (ADR 0014): warna, font, ikon Iconsax, beranda gaya launcher modul.

## 1. Sumber kebenaran (web)

| Aspek | File web | Di APK |
|---|---|---|
| Warna semantik light/dark, gradien modul, radius | `apps/web/src/theme/tokens.ts` | `lib/app/theme/tokens.dart` (diuji drift) |
| Font Space Grotesk + DM Sans | `apps/web/src/theme/fonts.ts` | `assets/fonts/*.ttf` (OFL, dibundel) |
| Ikon Iconsax Bulk/Linear | `apps/web/src/admin/modules/icons.ts` | `lib/shared/icons/iconsax.dart` (diuji drift) |
| Launcher + animasi | `apps/web/src/admin/views/LauncherGrid.tsx`, `custom.scss` `.pk-tile` | `lib/shared/widgets/module_tile.dart` |

## 2. Scope — IN

1. **Tema** (`lib/app/theme.dart`): ColorScheme Material 3 dibangun langsung dari token web (primary #2563EB,
   aksen/tertiary #EA580C, permukaan slate, destructive, status ok/warn/bad + varian teks mode gelap), light **dan**
   dark; radius 14 pada kartu/tombol/input/sheet/dialog; AppBar gaya permukaan (bukan solid primary). Ukuran ramah
   lapangan tetap (tombol 52 dp, target sentuh ≥ 48 dp). `StatusColors` diganti `context.pk` (ThemeExtension).
   **Tampilan** di Profil: Sistem (default) / Terang / Gelap, disimpan lokal di `SecureStore` yang sudah ada.
2. **Font**: Space Grotesk (judul, 600/700) + DM Sans (isi, 400/500/700) sebagai aset TTF, SIL OFL 1.1, teks lisensi
   ikut di aset dan terdaftar di `LicenseRegistry`. Tanpa unduh saat runtime, tanpa paket `google_fonts`.
3. **Ikon**: glyph Iconsax sama dengan web (path data dari `icons.ts`), dirender dengan parser path SVG kecil +
   `CustomPainter` (tanpa paket baru). Glyph tambahan APK: Pengajuan, Riwayat/Semua pengajuan, Antrean sinkron,
   Profil, Uang muka, Reimburse, Progress, Addendum, Sistem/Terang/Gelap.
4. **Beranda = launcher modul**: sapaan + peran, lalu grid tile gradien (glyph Bulk putih pada gradien 135°, label,
   teks sekunder, badge jumlah), 2 kolom di HP (3 kolom ≥ 600 dp). KPI (Direktur/Finance/PM) tetap di atas sebagai
   seksi; ProjectProgressSummary tetap. Semua aturan visibilitas, badge, subtitle, tujuan navigasi dan widget key
   (`home-inbox`, `home-new-advance`, …) tetap. Animasi masuk bertahap dengan API bawaan Flutter, mati bila sistem
   meminta animasi dikurangi. Peringatan integritas, info update, badge STAGING, lonceng notifikasi tetap.
   Pemetaan gradien: Persetujuan → `persetujuan`; Ajukan uang muka/reimburse → `keuangan`; Pengajuan saya / Semua
   pengajuan → `laporan`; Laporan progress, Addendum RAB → `proyek`; Absensi → `absensi`.
5. **Navigasi bawah**: tab dan aturan peran sama; NavigationBar dengan pill indikator warna primary tipis, ikon
   Iconsax Linear (tidak aktif) / Bulk (aktif), light dan dark.
6. **Layar lain**: tanpa perubahan layout/alur; warna keras (`Colors.*`, `StatusColors`, warna TabBar untuk AppBar
   solid lama, bentuk kartu radius 16) diganti token tema; chip/badge status memakai token ok/warn/bad. Login dan
   splash memakai palet + font baru dengan tanda sementara (logo klien menunggu Q-32).
7. **Versi/dokumen**: `pubspec` 0.2.0 (build number tetap dari CI), CHANGELOG `[Unreleased]`, ADR 0015, dokumen ini.

## 3. Scope — OUT

Perilaku, API, sync, DB, teks l10n yang sudah ada (hanya string baru Tampilan/Sistem/Terang/Gelap + satu petunjuk),
ikon launcher dan splash native (menunggu logo klien, Q-32), web.

## 4. Acceptance criteria

| # | Kriteria | Bukti |
|---|---|---|
| AC-1 | Token Dart = token web (semantik light/dark, 11 gradien, radius) | `test/unit/theme_tokens_test.dart` (parse `tokens.ts`) |
| AC-2 | Kontras: teks ≥ 4.5:1, ring ≥ 3:1, glyph putih ≥ 3:1 di setiap stop gradien, slot Material turunan | `theme_tokens_test.dart` |
| AC-3 | Glyph bersama = path data web; semua glyph ter-parse dan muat di kotak 24×24 | `test/unit/iconsax_test.dart` |
| AC-4 | Tampilan Sistem/Terang/Gelap berlaku langsung dan tersimpan di HP; default ikut sistem | `test/widget/ui_refresh_test.dart` |
| AC-5 | Beranda: tile per aksi dengan gradien modul, 2 kolom, key lama tetap; tanpa animasi bila reduced motion | `ui_refresh_test.dart` + test beranda lama |
| AC-6 | Semua test lama lulus tanpa melemahkan asersi perilaku; `flutter analyze` bersih; `dart format` | CI `mobile` job verify |
| AC-7 | Tidak ada paket baru; font dibundel dengan lisensi OFL terdaftar | `pubspec.lock` tidak berubah; `lib/app/fonts.dart` |
| AC-8 | Screenshot 390×844 light + dark: Beranda Direktur/PM/Staff, Pengajuan, Detail, Persetujuan, Absensi (+Rekap/Tim), Profil, Login — tanpa overflow/teks terpotong/font kotak | `test_preview/screens_preview_test.dart` (manual, tidak di CI) |
| AC-9 | APK staging dibangun CI; split arm64 < 30 MB | artefak CI `proyekkas-staging-*-apk` |

## 5. Risiko / catatan

- Tile beranda Direktur/Finance/PM berada di bawah seksi KPI (sesuai scope); bila user ingin launcher di atas,
  cukup menukar urutan di `home_screen.dart`.
- Glyph yang tidak ada di DM Sans (mis. emoji "⚠") memakai font sistem Android sebagai fallback.
- Tidak ada gate coverage mobile di CI saat ini (hanya artefak `mobile-coverage`); test baru menambah cakupan tema,
  ikon dan beranda.
