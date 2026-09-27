import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../l10n/gen/app_localizations.dart';

String errorText(Object e) => e is ApiException ? e.message : 'Terjadi kesalahan. Coba lagi.';

/// Loading / error (with retry) / data for an [AsyncValue].
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.value, required this.data, this.onRetry});
  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return switch (value) {
      AsyncData(:final value) => data(value),
      AsyncError(:final error) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(error is NetworkException ? Icons.cloud_off : Icons.error_outline, size: 48),
              const SizedBox(height: 12),
              Text(errorText(error), textAlign: TextAlign.center),
              if (onRetry != null) ...[
                const SizedBox(height: 12),
                OutlinedButton(onPressed: onRetry, child: Text(t.retry)),
              ],
            ],
          ),
        ),
      ),
      _ => const Center(child: CircularProgressIndicator()),
    };
  }
}

void showSnack(BuildContext context, String msg) => ScaffoldMessenger.of(context)
  ..hideCurrentSnackBar()
  ..showSnackBar(SnackBar(content: Text(msg)));
