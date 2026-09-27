import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/connectivity/connectivity_controller.dart';
import '../../l10n/gen/app_localizations.dart';

/// Online-only action (ADR 0010 decision 5): disabled offline with "Butuh koneksi internet".
class OnlineOnlyButton extends ConsumerWidget {
  const OnlineOnlyButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.danger = false,
    this.outlined = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool danger;
  final bool outlined;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final online = ref.watch(connectivityProvider);
    final t = AppLocalizations.of(context);
    final action = online ? onPressed : null;
    final scheme = Theme.of(context).colorScheme;
    final style = danger
        ? FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError)
        : null;
    final child = Text(label);
    final button = outlined
        ? OutlinedButton.icon(onPressed: action, icon: Icon(icon ?? Icons.cloud_upload), label: child)
        : FilledButton.icon(onPressed: action, style: style, icon: Icon(icon ?? Icons.cloud_upload), label: child);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        button,
        if (!online)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              t.needsInternet,
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.error),
            ),
          ),
      ],
    );
  }
}
