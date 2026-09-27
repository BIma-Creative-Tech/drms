import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../application/app_config_providers.dart';
import 'release_notes.dart';

/// Blocking screen when the APK is below the minimum version (app config or HTTP 426). Shows the release
/// notes of the latest version when the server sends them (`releaseNotes`, web ≥ 0.4.2).
class UpdateRequiredScreen extends ConsumerWidget {
  const UpdateRequiredScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final current = ref.watch(deviceIdentityProvider).appVersion;
    final cfg = ref.watch(appConfigProvider).value;
    final minimum = cfg?.minAppVersion ?? ref.watch(upgradeRequiredProvider) ?? '?';
    final latest = cfg?.latestAppVersion;
    final notes = cfg?.releaseNotes ?? const <String>[];
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          // Centred like before; scrolls once the notes make it taller than the screen.
          builder: (context, box) => SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: box.maxHeight > 48 ? box.maxHeight - 48 : 0),
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
                  if (latest != null && notes.isNotEmpty) ...[
                    Card(
                      margin: EdgeInsets.zero,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: ReleaseNotesList(version: latest, notes: notes),
                      ),
                    ),
                    const SizedBox(height: 24),
                  ],
                  UpdateDownloadLink(url: cfg?.appDownloadUrl),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
