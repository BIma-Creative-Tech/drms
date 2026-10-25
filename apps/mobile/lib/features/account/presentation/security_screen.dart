import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/dates.dart';
import '../../../core/platform/browser.dart';
import '../../../app/theme.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
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
              const SizedBox(height: 12),
              _TwoFactorCard(status: s, onOpenWeb: () => _openWeb(s.manageUrl)),
              const SizedBox(height: 12),
              PkSectionCard(
                title: t.securityTipsTitle,
                icon: Icons.lightbulb_outline,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final tip in [t.securityTip1, t.securityTip2, t.securityTip3]) _Bullet(tip),
                  ],
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
    final (label, tone, icon) = switch (status.state) {
      TwoFactorState.active => (t.security2faActive, PkTone.ok, Icons.verified_user_outlined),
      TwoFactorState.inactive => (t.security2faInactive, PkTone.neutral, Icons.shield_outlined),
      TwoFactorState.unknown => (t.security2faUnknown, PkTone.warn, Icons.warning_amber_outlined),
    };
    return PkCard(
      key: const Key('security-2fa'),
      radius: PkRadius.lg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PkIconChip(icon: icon, tone: tone == PkTone.neutral ? PkTone.info : tone, size: 44),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t.security2faTitle, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    PkPill(key: Key('security-2fa-${status.state.name}'), label: label, tone: tone, icon: icon),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(switch (status.state) {
            TwoFactorState.active => t.security2faActiveText,
            TwoFactorState.inactive => t.security2faInactiveText,
            TwoFactorState.unknown => t.security2faUnknownText,
          }),
          if (status.state == TwoFactorState.active)
            for (final a in status.authenticators)
              Padding(
                key: Key('security-authenticator-${a.id}'),
                padding: const EdgeInsets.only(top: 10),
                child: Row(
                  children: [
                    const PkIconChip(icon: Icons.phonelink_lock_outlined, tone: PkTone.neutral, size: 36),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            a.label ?? t.securityAuthenticatorDefault,
                            style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            t.securityRegisteredOn(formatServerDateTime(a.createdAt)),
                            style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          if (status.state == TwoFactorState.inactive) ...[
            const SizedBox(height: 8),
            for (final (i, step) in [t.securityStep1, t.securityStep2, t.securityStep3].indexed)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 22,
                      height: 22,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: context.pk.infoBg, shape: BoxShape.circle),
                      child: Text(
                        '${i + 1}',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: context.pk.infoOn,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: Text(step)),
                  ],
                ),
              ),
          ],
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: status.state == TwoFactorState.active
                ? OutlinedButton.icon(
                    key: const Key('security-manage'),
                    onPressed: onOpenWeb,
                    icon: const Icon(Icons.open_in_new),
                    label: Text(t.securityManage),
                  )
                : FilledButton.icon(
                    key: const Key('security-enable'),
                    onPressed: onOpenWeb,
                    icon: const Icon(Icons.open_in_new),
                    label: Text(t.securityEnable),
                  ),
          ),
          const SizedBox(height: 8),
          Text(t.securityWebNote, style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
        ],
      ),
    );
  }
}

/// Tip line with a small primary dot.
class _Bullet extends StatelessWidget {
  const _Bullet(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 6),
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
          Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}
