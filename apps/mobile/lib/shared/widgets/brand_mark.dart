import 'package:flutter/material.dart';

import '../../app/theme.dart';
import '../icons/iconsax.dart';

/// Placeholder brand mark until the client logo exists (Q-32): the web "dashboard" tile gradient with the
/// white Iconsax WalletMoney glyph. Used on the splash and login screens only (the launcher icon and the
/// native splash assets are unchanged).
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 72, this.onHero = false});
  final double size;

  /// D2510: on the blue hero band — light-blue tile with the dark-blue glyph instead of the gradient.
  final bool onHero;

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    final g = pk.gradient(PkModule.dashboard);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.28),
        color: onHero ? pk.heroPill : null,
        gradient: onHero
            ? null
            : LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [g.from, g.to]),
        boxShadow: [
          BoxShadow(
            color: (onHero ? const Color(0xFF000000) : g.from).withValues(alpha: onHero ? 0.25 : 0.35),
            blurRadius: 24,
            offset: const Offset(0, 10),
            spreadRadius: -8,
          ),
        ],
      ),
      child: SizedBox.square(
        dimension: size,
        child: Center(
          child: PkIcon(PkIcons.finance, size: size * 0.54, color: onHero ? pk.onHeroPill : const Color(0xFFFFFFFF)),
        ),
      ),
    );
  }
}
