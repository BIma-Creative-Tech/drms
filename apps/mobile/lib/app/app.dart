import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/sync/application/sync_coordinator.dart';
import '../l10n/gen/app_localizations.dart';
import 'router.dart';
import 'theme.dart';

class ProyekKasApp extends ConsumerWidget {
  const ProyekKasApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(syncCoordinatorProvider); // keeps sync triggers alive for the app lifetime
    return MaterialApp.router(
      onGenerateTitle: (c) => AppLocalizations.of(c).appTitle,
      theme: buildTheme(),
      routerConfig: ref.watch(routerProvider),
      locale: const Locale('id'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      debugShowCheckedModeBanner: false,
    );
  }
}
