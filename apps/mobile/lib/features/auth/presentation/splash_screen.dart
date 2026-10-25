import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../app/theme.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/brand_mark.dart';

/// D2510 (Banani "Splash"): full-screen brand gradient, mark, app name and a thin progress bar.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final pk = context.pk;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        body: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [pk.hero, pk.heroEnd],
            ),
          ),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const BrandMark(size: 88, onHero: true),
                const SizedBox(height: 24),
                Text(
                  t.appTitle,
                  style: Theme.of(context).textTheme.headlineMedium
                      ?.copyWith(color: pk.onHero, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 28),
                SizedBox(
                  width: 180,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      minHeight: 6,
                      color: pk.heroPill,
                      backgroundColor: pk.onHero.withValues(alpha: 0.18),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
