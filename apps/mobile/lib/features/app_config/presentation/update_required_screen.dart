import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../application/app_config_providers.dart';
import 'release_notes.dart';

/// Blocking screen when the APK is below the minimum version (app config or HTTP 426). Shows the release
/// notes of the latest version when the server sends them (`releaseNotes`, web with the /unduh manifest).
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
    final theme = Theme.of(context);
    final pk = context.pk;
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
                  Center(
                    child: Container(
                      width: 88,
                      height: 88,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: pk.infoBg, shape: BoxShape.circle),
                      child: Icon(Icons.system_update, size: 44, color: pk.infoOn),
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    t.updateRequiredTitle,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    t.updateRequiredBody(current, minimum),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 24),
                  if (latest != null && notes.isNotEmpty) ...[
                    PkCard(
                      radius: PkRadius.lg,
                      child: ReleaseNotesList(version: latest, notes: notes),
                    ),
                    const SizedBox(height: 16),
                  ],
                  PkCard(
                    radius: PkRadius.lg,
                    child: UpdateDownloadLink(url: cfg?.appDownloadUrl),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
