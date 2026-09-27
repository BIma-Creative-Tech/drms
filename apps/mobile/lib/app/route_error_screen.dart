import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../l10n/gen/app_localizations.dart';

/// Shown by GoRouter for any location it cannot match (e.g. an unexpected deep link such as an OIDC
/// callback URL). Replaces the default English error page / a blank screen with a way back; the
/// location itself is not shown or logged because it may carry an authorization code.
class RouteErrorScreen extends StatelessWidget {
  const RouteErrorScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(Icons.error_outline, size: 72, color: Theme.of(context).colorScheme.error),
              const SizedBox(height: 16),
              Text(t.routeErrorTitle, textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 12),
              Text(t.routeErrorBody, key: const Key('route-error-body'), textAlign: TextAlign.center),
              const SizedBox(height: 24),
              FilledButton.icon(
                key: const Key('route-error-home'),
                onPressed: () => context.go('/home'),
                icon: const Icon(Icons.home),
                label: Text(t.routeErrorHome),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Release-mode replacement for Flutter's grey [ErrorWidget] so an exception while building a screen
/// shows readable text instead of an empty screen. It may sit above [Localizations], so the text is
/// fixed Indonesian and the widget brings its own [Directionality].
class FatalBuildErrorView extends StatelessWidget {
  const FatalBuildErrorView({super.key});

  @override
  Widget build(BuildContext context) => const ColoredBox(
    color: Color(0xFFFFFFFF),
    child: Directionality(
      textDirection: TextDirection.ltr,
      child: Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Terjadi kesalahan saat menampilkan layar ini. Tutup lalu buka lagi aplikasi ProyekKas.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFF212121), fontSize: 16),
          ),
        ),
      ),
    ),
  );
}
