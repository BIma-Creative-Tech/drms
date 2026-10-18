import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/dates.dart';
import '../../../core/platform/browser.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../application/account_providers.dart';
import '../domain/account.dart';

/// "Keamanan akun" (user 2026-10-19, web avatar menu, ADR 0017): own 2FA status and authenticators, same texts as
/// the web page. Enabling/disabling runs on that web page in the browser (Keycloak re-login + audit); the status is
/// re-read when the user comes back to the app.
class SecurityScreen extends ConsumerStatefulWidget {
  const SecurityScreen({super.key});

  @override
  ConsumerState<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends ConsumerState<SecurityScreen> with WidgetsBindingObserver {
  bool _openedWeb = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _openedWeb) {
      _openedWeb = false;
      ref.invalidate(meSecurityProvider);
    }
  }

  Future<void> _openWeb(String url) async {
    final t = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final ok = await ref.read(browserProvider).open(url);
    if (ok) {
      _openedWeb = true;
    } else {
      messenger.showSnackBar(SnackBar(content: Text(t.securityBrowserFailed(url))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final email = ref.watch(currentProfileProvider)?.email;
    return Scaffold(
      appBar: AppBar(title: Text(t.securityTitle)),
      body: AsyncBody<MeSecurity>(
        value: ref.watch(meSecurityProvider),
        onRetry: () => ref.invalidate(meSecurityProvider),
        data: (s) => RefreshIndicator(
          onRefresh: () => ref.refresh(meSecurityProvider.future),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                email == null || email.isEmpty ? t.securityLead : '${t.securityLead} ($email)',
                style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 16),
              _TwoFactorCard(status: s, onOpenWeb: () => _openWeb(s.manageUrl)),
              const SizedBox(height: 16),
              Card(
                margin: EdgeInsets.zero,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t.securityTipsTitle, style: theme.textTheme.titleSmall),
                      const SizedBox(height: 6),
                      for (final tip in [t.securityTip1, t.securityTip2, t.securityTip3])
                        Padding(padding: const EdgeInsets.only(top: 4), child: Text('• $tip')),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TwoFactorCard extends StatelessWidget {
  const _TwoFactorCard({required this.status, required this.onOpenWeb});
  final MeSecurity status;
  final VoidCallback onOpenWeb;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final (label, color, icon) = switch (status.state) {
      TwoFactorState.active => (t.security2faActive, Colors.green.shade700, Icons.verified_user_outlined),
      TwoFactorState.inactive => (t.security2faInactive, scheme.onSurfaceVariant, Icons.shield_outlined),
      TwoFactorState.unknown => (t.security2faUnknown, Colors.orange.shade800, Icons.warning_amber_outlined),
    };
    return Card(
      key: const Key('security-2fa'),
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 12,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(t.security2faTitle, style: theme.textTheme.titleMedium),
                Chip(
                  key: Key('security-2fa-${status.state.name}'),
                  avatar: Icon(icon, size: 18, color: color),
                  label: Text(
                    label,
                    style: TextStyle(color: color, fontWeight: FontWeight.w700),
                  ),
                  side: BorderSide(color: color),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(switch (status.state) {
              TwoFactorState.active => t.security2faActiveText,
              TwoFactorState.inactive => t.security2faInactiveText,
              TwoFactorState.unknown => t.security2faUnknownText,
            }),
            if (status.state == TwoFactorState.active)
              for (final a in status.authenticators)
                ListTile(
                  key: Key('security-authenticator-${a.id}'),
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.phonelink_lock_outlined),
                  title: Text(a.label ?? t.securityAuthenticatorDefault),
                  subtitle: Text(t.securityRegisteredOn(formatServerDateTime(a.createdAt))),
                ),
            if (status.state == TwoFactorState.inactive) ...[
              const SizedBox(height: 8),
              for (final (i, step) in [t.securityStep1, t.securityStep2, t.securityStep3].indexed)
                Padding(padding: const EdgeInsets.only(top: 4), child: Text('${i + 1}. $step')),
            ],
            const SizedBox(height: 16),
            if (status.state == TwoFactorState.active)
              OutlinedButton.icon(
                key: const Key('security-manage'),
                onPressed: onOpenWeb,
                icon: const Icon(Icons.open_in_new),
                label: Text(t.securityManage),
              )
            else
              FilledButton.icon(
                key: const Key('security-enable'),
                onPressed: onOpenWeb,
                icon: const Icon(Icons.open_in_new),
                label: Text(t.securityEnable),
              ),
            const SizedBox(height: 8),
            Text(t.securityWebNote, style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }
}
