import 'package:flutter/material.dart';

/// Large home action (icon + label + optional badge), ≥ 72 dp tall.
class BigActionButton extends StatelessWidget {
  const BigActionButton({
    super.key,
    required this.icon,
    required this.label,
    this.onPressed,
    this.badge,
    this.subtitle,
  });

  final IconData icon;
  final String label;
  final String? subtitle;
  final String? badge;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final enabled = onPressed != null;
    return Card(
      clipBehavior: Clip.antiAlias,
      color: enabled ? scheme.primaryContainer : scheme.surfaceContainerHighest,
      child: InkWell(
        onTap: onPressed,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 76),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Icon(icon, size: 36, color: enabled ? scheme.onPrimaryContainer : scheme.outline),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(label, style: Theme.of(context).textTheme.titleMedium),
                      if (subtitle != null) Text(subtitle!, style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
                if (badge != null) Badge(label: Text(badge!), largeSize: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
