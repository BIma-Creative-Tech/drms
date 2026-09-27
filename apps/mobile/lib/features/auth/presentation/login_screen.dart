import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../application/auth_controller.dart';

/// Login. `PK_LOGIN_MODE=browser` (default): one button that opens the Keycloak page in a Custom Tab
/// (AppAuth). `PK_LOGIN_MODE=password` (staging, ADR 0012): in-app username/password form, no browser.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  bool _busy = false;
  String? _error;

  final _formKey = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _passwordFocus = FocusNode();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  String? _messageFor(String? res, AppLocalizations t) => switch (res) {
    null => null,
    'cancelled' => t.loginCancelled,
    'network' => t.loginNeedsInternet,
    'failed' => t.loginFailed,
    final String msg => msg,
  };

  Future<void> _login() async {
    final t = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    final res = await ref.read(authControllerProvider.notifier).login();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = _messageFor(res, t);
    });
  }

  Future<void> _submitPassword() async {
    if (_busy) return;
    final t = AppLocalizations.of(context);
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final res = await ref
        .read(authControllerProvider.notifier)
        .loginWithPassword(username: _username.text, password: _password.text);
    if (!mounted) return;
    // Let the platform password manager offer to save the credentials only after a successful login.
    if (res == null) TextInput.finishAutofillContext();
    // The password never outlives the attempt, successful or not.
    _password.clear();
    setState(() {
      _busy = false;
      _error = _messageFor(res, t);
    });
  }

  @override
  Widget build(BuildContext context) {
    final env = ref.watch(appEnvProvider);
    return Scaffold(body: SafeArea(child: env.usesPasswordLogin ? _passwordBody(context) : _browserBody(context)));
  }

  String? _notice(AppLocalizations t) {
    final auth = ref.watch(authControllerProvider);
    return auth is AuthSignedOut
        ? (switch (auth.message) {
            'session_ended' => t.sessionEnded,
            signedOutDeviceRevoked => t.deviceRevoked,
            final m => m,
          })
        : null;
  }

  List<Widget> _header(BuildContext context, String subtitle) {
    final t = AppLocalizations.of(context);
    final env = ref.watch(appEnvProvider);
    return [
      const Icon(Icons.account_balance_wallet, size: 80),
      const SizedBox(height: 16),
      Text(t.loginTitle, textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall),
      if (!env.isProd)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Center(child: Chip(label: Text(t.stagingBadge))),
        ),
      const SizedBox(height: 12),
      Text(subtitle, textAlign: TextAlign.center),
    ];
  }

  Widget _noticeCard(BuildContext context, String notice) => Card(
    color: Theme.of(context).colorScheme.errorContainer,
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Text(notice, key: const Key('login-notice')),
    ),
  );

  Widget _errorText(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Text(
      _error!,
      key: const Key('login-error'),
      textAlign: TextAlign.center,
      style: TextStyle(color: Theme.of(context).colorScheme.error),
    ),
  );

  Widget _submitButton(AppLocalizations t, {required bool online, required VoidCallback onPressed}) =>
      FilledButton.icon(
        key: const Key('login-button'),
        onPressed: _busy || !online ? null : onPressed,
        icon: _busy
            ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : const Icon(Icons.login),
        label: Text(t.loginButton),
      );

  Widget _browserBody(BuildContext context) {
    final t = AppLocalizations.of(context);
    final online = ref.watch(connectivityProvider);
    final notice = _notice(t);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Spacer(),
          ..._header(context, t.loginSubtitle),
          const Spacer(),
          if (notice != null) _noticeCard(context, notice),
          if (_error != null) _errorText(context),
          _submitButton(t, online: online, onPressed: _login),
          if (!online)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(t.loginNeedsInternet, textAlign: TextAlign.center),
            ),
        ],
      ),
    );
  }

  Widget _passwordBody(BuildContext context) {
    final t = AppLocalizations.of(context);
    final online = ref.watch(connectivityProvider);
    final notice = _notice(t);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: AutofillGroup(
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  ..._header(context, t.loginSubtitlePassword),
                  const SizedBox(height: 24),
                  if (notice != null) ...[_noticeCard(context, notice), const SizedBox(height: 12)],
                  TextFormField(
                    key: const Key('login-username'),
                    controller: _username,
                    enabled: !_busy,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    autocorrect: false,
                    enableSuggestions: false,
                    autofillHints: const [AutofillHints.username, AutofillHints.email],
                    decoration: InputDecoration(
                      labelText: t.loginUsernameLabel,
                      prefixIcon: const Icon(Icons.person_outline),
                    ),
                    validator: (v) => (v == null || v.trim().isEmpty) ? t.loginUsernameRequired : null,
                    onFieldSubmitted: (_) => _passwordFocus.requestFocus(),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    key: const Key('login-password'),
                    controller: _password,
                    focusNode: _passwordFocus,
                    enabled: !_busy,
                    obscureText: _obscurePassword,
                    keyboardType: TextInputType.visiblePassword,
                    textInputAction: TextInputAction.done,
                    autocorrect: false,
                    enableSuggestions: false,
                    autofillHints: const [AutofillHints.password],
                    decoration: InputDecoration(
                      labelText: t.loginPasswordLabel,
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        key: const Key('login-password-toggle'),
                        tooltip: _obscurePassword ? t.loginShowPassword : t.loginHidePassword,
                        icon: Icon(_obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                        onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                      ),
                    ),
                    validator: (v) => (v == null || v.isEmpty) ? t.loginPasswordRequired : null,
                    onFieldSubmitted: (_) {
                      if (online) _submitPassword();
                    },
                  ),
                  if (_error != null) _errorText(context) else const SizedBox(height: 16),
                  _submitButton(t, online: online, onPressed: _submitPassword),
                  if (!online)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(t.loginNeedsInternet, textAlign: TextAlign.center),
                    ),
                  const SizedBox(height: 16),
                  Text(t.loginForgotPassword, key: const Key('login-forgot'), textAlign: TextAlign.center),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
