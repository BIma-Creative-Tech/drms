import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../application/app_config_providers.dart';

/// Blocking screen when the APK is below the minimum version (app config or HTTP 426).
class UpdateRequiredScreen extends ConsumerWidget {
  const UpdateRequiredScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final current = ref.watch(deviceIdentityProvider).appVersion;
    final cfg = ref.watch(appConfigProvider).value;
    final minimum = cfg?.minAppVersion ?? ref.watch(upgradeRequiredProvider) ?? '?';
    final url = cfg?.appDownloadUrl;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.system_update, size: 72),
              const SizedBox(height: 16),
              Text(
                t.updateRequiredTitle,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 12),
              Text(t.updateRequiredBody(current, minimum), textAlign: TextAlign.center),
              const SizedBox(height: 24),
              if (url != null) ...[
                Text(t.updateDownloadHint, textAlign: TextAlign.center),
                SelectableText(
                  url,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () => Clipboard.setData(ClipboardData(text: url)),
                  icon: const Icon(Icons.copy),
                  label: Text(t.copyLink),
                ),
              ] else
                Text(t.updateContactAdmin, textAlign: TextAlign.center),
            ],
          ),
        ),
      ),
    );
  }
}
