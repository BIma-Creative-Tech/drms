import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../domain/app_config.dart';

/// "Yang baru di versi X" + bullets from `GET /app/config` `releaseNotes` (plain text, rendered as text).
class ReleaseNotesList extends StatelessWidget {
  const ReleaseNotesList({super.key, required this.version, required this.notes});
  final String version;
  final List<String> notes;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      key: const Key('release-notes'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(AppLocalizations.of(context).releaseNotesTitle(version), style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final n in notes)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 7, right: 10),
                  child: Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(color: theme.colorScheme.primary, shape: BoxShape.circle),
                  ),
                ),
                Expanded(child: Text(n, style: theme.textTheme.bodyMedium)),
              ],
            ),
          ),
      ],
    );
  }
}

/// Download link as on the blocking update screen (no browser package: the link is shown + copyable), or
/// "hubungi admin" when the server has no download URL.
class UpdateDownloadLink extends StatelessWidget {
  const UpdateDownloadLink({super.key, required this.url});
  final String? url;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final url = this.url;
    if (url == null) return Text(t.updateContactAdmin, textAlign: TextAlign.center);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(t.updateDownloadHint, textAlign: TextAlign.center),
        SelectableText(
          url,
          textAlign: TextAlign.center,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          key: const Key('update-copy-link'),
          onPressed: () => Clipboard.setData(ClipboardData(text: url)),
          icon: const Icon(Icons.copy),
          label: Text(t.copyLink),
        ),
      ],
    );
  }
}

/// Home banner → this sheet: latest version, its release notes (when the server sends them) and the link.
Future<void> showUpdateAvailableSheet(BuildContext context, AppConfig cfg) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (_) => UpdateAvailableSheet(cfg: cfg),
);

class UpdateAvailableSheet extends StatelessWidget {
  const UpdateAvailableSheet({super.key, required this.cfg});
  final AppConfig cfg;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final latest = cfg.latestAppVersion ?? '?';
    return SingleChildScrollView(
      key: const Key('update-sheet'),
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(Icons.system_update, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 12),
              Expanded(child: Text(t.updateAvailable(latest), style: Theme.of(context).textTheme.titleLarge)),
            ],
          ),
          const SizedBox(height: 16),
          if (cfg.releaseNotes.isNotEmpty && cfg.latestAppVersion != null) ...[
            ReleaseNotesList(version: latest, notes: cfg.releaseNotes),
            const SizedBox(height: 16),
          ],
          Text(t.updateHowTo),
          const SizedBox(height: 16),
          UpdateDownloadLink(url: cfg.appDownloadUrl),
        ],
      ),
    );
  }
}
