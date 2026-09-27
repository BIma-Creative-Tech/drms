import 'package:flutter/material.dart';

import '../../app/theme.dart';
import '../icons/iconsax.dart';

/// Placeholder brand mark until the client logo exists (Q-32): the web "dashboard" tile gradient with the
/// white Iconsax WalletMoney glyph. Used on the splash and login screens only (the launcher icon and the
/// native splash assets are unchanged).
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 72});
  final double size;

  @override
  Widget build(BuildContext context) {
    final g = context.pk.gradient(PkModule.dashboard);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.28),
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [g.from, g.to]),
        boxShadow: [
          BoxShadow(
            color: g.from.withValues(alpha: 0.35),
            blurRadius: 24,
            offset: const Offset(0, 10),
            spreadRadius: -8,
          ),
        ],
      ),
      child: SizedBox.square(
        dimension: size,
        child: Center(
          child: PkIcon(PkIcons.finance, size: size * 0.54, color: const Color(0xFFFFFFFF)),
        ),
      ),
    );
  }
}
