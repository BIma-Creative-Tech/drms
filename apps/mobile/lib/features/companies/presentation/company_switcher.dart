import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_akun.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../application/company_selection.dart';

/// Label of the selection: "Semua PT", "DRMS" or "DRMS+1".
String companySelectionLabel(AppLocalizations t, UserProfile account, Set<int>? selection) {
  if (selection == null) return t.companyAll;
  final codes = [
    for (final c in account.companies)
      if (selection.contains(c.id)) c.code,
  ];
  if (codes.isEmpty) return t.companyAll;
  return codes.length == 1 ? codes.single : t.companySwitcherMore(codes.first, codes.length - 1);
}

/// App bar PT switcher (MC3, wireframe §1b): one membership = static label (no menu), several = button
/// that opens [showCompanySwitcherSheet]. Nothing for a server before MC3.
class CompanySwitcherButton extends ConsumerWidget {
  const CompanySwitcherButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final account = ref.watch(accountProfileProvider);
    if (account == null || account.companies.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    if (!account.isMultiCompany) {
      final c = account.companies.single;
      return Tooltip(
        message: c.name,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            c.code,
            key: const Key('pt-switcher-static'),
            style: theme.textTheme.labelLarge?.copyWith(color: scheme.primary, fontWeight: FontWeight.w700),
          ),
        ),
      );
    }
    final label = companySelectionLabel(t, account, ref.watch(companySelectionProvider));
    return TextButton.icon(
      key: const Key('pt-switcher'),
      onPressed: () => showCompanySwitcherSheet(context),
      icon: const Icon(Icons.business, size: 18),
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
          const Icon(Icons.arrow_drop_down, size: 20),
        ],
      ),
      style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
    );
  }
}

/// Bottom sheet: "Semua PT saya" + one checkbox per membership (code — name, roles there). "Terapkan"
/// stores the choice for this user and re-loads every server list; at least one PT stays checked.
Future<void> showCompanySwitcherSheet(BuildContext context) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => const _CompanySwitcherSheet(),
);

class _CompanySwitcherSheet extends ConsumerStatefulWidget {
  const _CompanySwitcherSheet();

  @override
  ConsumerState<_CompanySwitcherSheet> createState() => _CompanySwitcherSheetState();
}

class _CompanySwitcherSheetState extends ConsumerState<_CompanySwitcherSheet> {
  late Set<int> _checked = {
    ...(ref.read(companySelectionProvider) ??
        {for (final c in ref.read(accountProfileProvider)?.companies ?? const <CompanyMembership>[]) c.id}),
  };

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final account = ref.watch(accountProfileProvider);
    if (account == null) return const SizedBox.shrink();
    final all = {for (final c in account.companies) c.id};
    final allChecked = _checked.length == all.length;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Row(
                children: [
                  const PkIconChip(icon: Icons.business_outlined, size: 40),
                  const SizedBox(width: 12),
                  Expanded(child: Text(t.companySwitcherTitle, style: theme.textTheme.titleLarge)),
                ],
              ),
            ),
            PkCard(
              padding: EdgeInsets.zero,
              margin: const EdgeInsets.symmetric(horizontal: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  CheckboxListTile(
                    key: const Key('pt-option-all'),
                    value: allChecked ? true : (_checked.isEmpty ? false : null),
                    tristate: true,
                    title: Text(t.companyAllMine, style: const TextStyle(fontWeight: FontWeight.w700)),
                    onChanged: (_) => setState(() => _checked = allChecked ? <int>{} : {...all}),
                  ),
                  for (final c in account.companies) ...[
                    const PkRowDivider(indent: 16),
                    CheckboxListTile(
                      key: Key('pt-option-${c.id}'),
                      value: _checked.contains(c.id),
                      secondary: _CompanyBadge(code: c.code),
                      title: Text('${c.code} — ${c.name}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: c.roles.isEmpty ? null : Text(c.roleLabels),
                      onChanged: (v) => setState(() {
                        _checked = {..._checked};
                        v == true ? _checked.add(c.id) : _checked.remove(c.id);
                      }),
                    ),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Text(
                _checked.isEmpty ? t.companySwitcherNone : t.companySwitcherHint,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: _checked.isEmpty ? theme.colorScheme.error : theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: FilledButton(
                key: const Key('pt-apply'),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
                onPressed: _checked.isEmpty
                    ? null
                    : () async {
                        final navigator = Navigator.of(context);
                        await ref
                            .read(companySelectionProvider.notifier)
                            .select(allChecked ? null : {..._checked}, account, sub: ref.read(currentSubProvider));
                        navigator.pop();
                      },
                child: Text(t.companySwitcherApply),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Asks for the PT of a new record when the scope holds several candidate PTs (wireframe §1b: first step
/// of "+ Pengajuan" under "Semua PT"). One candidate → returned at once; none → null.
Future<CompanyMembership?> pickCompany(
  BuildContext context,
  List<CompanyMembership> candidates, {
  String? title,
  String? hint,
}) async {
  if (candidates.isEmpty) return null;
  if (candidates.length == 1) return candidates.single;
  final t = AppLocalizations.of(context);
  return showModalBottomSheet<CompanyMembership>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (c) => SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.only(bottom: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Text(title ?? t.companyPickTitle, style: Theme.of(c).textTheme.titleLarge),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 4, 24, 8),
              child: Text(hint ?? t.companyPickHint, style: Theme.of(c).textTheme.bodySmall),
            ),
            for (final m in candidates)
              ListTile(
                key: Key('pt-pick-${m.id}'),
                contentPadding: const EdgeInsets.symmetric(horizontal: 24),
                leading: _CompanyBadge(code: m.code),
                title: Text('${m.code} — ${m.name}', style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: m.roles.isEmpty ? null : Text(m.roleLabels),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.pop(c, m),
              ),
          ],
        ),
      ),
    ),
  );
}

/// Full-screen "Untuk PT mana?" step before a form (new draft under several PTs, or a draft written before
/// the multi-PT update). Same rows as [pickCompany].
class CompanyChoiceScreen extends StatelessWidget {
  const CompanyChoiceScreen({
    super.key,
    required this.title,
    required this.candidates,
    required this.onPick,
    this.hint,
  });
  final String title;
  final String? hint;
  final List<CompanyMembership> candidates;
  final ValueChanged<CompanyMembership> onPick;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            t.companyPickTitle,
            key: const Key('pt-choice'),
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            hint ?? t.companyPickHint,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 14),
          for (final m in candidates)
            PkCard(
              padding: EdgeInsets.zero,
              margin: const EdgeInsets.only(bottom: 10),
              child: ListTile(
                key: Key('pt-pick-${m.id}'),
                leading: _CompanyBadge(code: m.code),
                title: Text('${m.code} — ${m.name}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: m.roles.isEmpty ? null : Text(m.roleLabels),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => onPick(m),
              ),
            ),
        ],
      ),
    );
  }
}

/// First letter of the PT code on a tonal square (switcher / picker rows).
class _CompanyBadge extends StatelessWidget {
  const _CompanyBadge({required this.code});
  final String code;

  @override
  Widget build(BuildContext context) {
    final pk = context.pk;
    return Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: pk.infoBg, borderRadius: BorderRadius.circular(PkRadius.sm + 2)),
      child: Text(
        code.isEmpty ? '?' : code.characters.first.toUpperCase(),
        style: TextStyle(fontFamily: PkFonts.heading, fontWeight: FontWeight.w700, fontSize: 17, color: pk.infoOn),
      ),
    );
  }
}
