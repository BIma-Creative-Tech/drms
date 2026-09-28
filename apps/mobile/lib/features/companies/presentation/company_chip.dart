import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_controller.dart';

/// PT short code on a list item / card (wireframe §1b: chip top-left) — only when the PT switcher scope
/// spans several PTs ([always] = show whenever the account has several PTs, e.g. drafts / queue items).
/// Pill in the primary tint of the role pill (ADR 0015).
class CompanyChip extends ConsumerWidget {
  const CompanyChip({super.key, required this.companyId, this.always = false});
  final int? companyId;
  final bool always;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(currentProfileProvider);
    final id = companyId;
    if (p == null || id == null) return const SizedBox.shrink();
    if (!(always ? p.isMultiCompany : p.showCompanyChips)) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final name = p.company(id)?.name;
    return Tooltip(
      message: name ?? p.companyCode(id),
      child: Container(
        key: Key('pt-chip-$id'),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: scheme.primary.withValues(alpha: theme.brightness == Brightness.dark ? 0.18 : 0.10),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          p.companyCode(id),
          style: theme.textTheme.labelSmall?.copyWith(color: scheme.primary, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

/// [CompanyChip] followed by a small gap, or nothing — for rows that prepend it to a title.
class CompanyChipLead extends ConsumerWidget {
  const CompanyChipLead({super.key, required this.companyId, this.always = false});
  final int? companyId;
  final bool always;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(currentProfileProvider);
    final show = p != null && companyId != null && (always ? p.isMultiCompany : p.showCompanyChips);
    if (!show) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: CompanyChip(companyId: companyId, always: always),
    );
  }
}
