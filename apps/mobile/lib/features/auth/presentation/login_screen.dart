import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/brand_mark.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../application/auth_controller.dart';
import '../data/password_login_client.dart' show PasswordLoginError;

/// Login. `PK_LOGIN_MODE=browser` (default): one button that opens the Keycloak page in a Custom Tab
/// (AppAuth). `PK_LOGIN_MODE=password` (staging, ADR 0012): in-app username/password form, no browser.
/// Optional 2FA (ADR 0017): Keycloak answers a missing/wrong authenticator code exactly like a wrong
/// password, so after such a failure the form reveals the optional field "Kode autentikator (bila 2FA
/// aktif)"; users without 2FA leave it empty (no `totp` is sent). The code is single-use: cleared after
/// every attempt, never stored or logged.
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
  final _totp = TextEditingController();
  final _totpFocus = FocusNode();
  bool _obscurePassword = true;
  bool _showTotp = false;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    _totp.dispose();
    _totpFocus.dispose();
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
    final codeShown = _showTotp;
    final res = await ref
        .read(authControllerProvider.notifier)
        .loginWithPassword(
          username: _username.text,
          password: _password.text,
          totp: codeShown && _totp.text.isNotEmpty ? _totp.text : null,
        );
    if (!mounted) return;
    // Let the platform password manager offer to save the credentials only after a successful login.
    if (res == null) TextInput.finishAutofillContext();
    // The password and the (single-use) authenticator code never outlive the attempt.
    _password.clear();
    _totp.clear();
    final badCredentials = res == PasswordLoginError.invalidCredentials.message;
    setState(() {
      _busy = false;
      _error = badCredentials && codeShown ? t.loginInvalidWithTotp : _messageFor(res, t);
      if (badCredentials) _showTotp = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final env = ref.watch(appEnvProvider);
    return Scaffold(body: env.usesPasswordLogin ? _passwordBody(context) : _browserBody(context));
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

  /// D2510: brand hero band (Banani splash look) — mark, title, staging pill, subtitle.
  Widget _hero(BuildContext context, String subtitle) {
    final t = AppLocalizations.of(context);
    final env = ref.watch(appEnvProvider);
    final pk = context.pk;
    final theme = Theme.of(context);
    return PkHeroHeader(
      padding: const EdgeInsets.fromLTRB(24, 40, 24, 56),
      child: Column(
        children: [
          const BrandMark(size: 76, onHero: true),
          const SizedBox(height: 20),
          Text(
            t.loginTitle,
            textAlign: TextAlign.center,
            style: theme.textTheme.headlineMedium?.copyWith(color: pk.onHero, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Text(
            subtitle,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyLarge?.copyWith(color: pk.onHero.withValues(alpha: 0.8)),
          ),
          if (!env.isProd) ...[const SizedBox(height: 14), PkHeroPill(label: t.stagingBadge, dot: true)],
        ],
      ),
    );
  }

  Widget _noticeCard(BuildContext context, String notice) => Card(
    color: Theme.of(context).colorScheme.errorContainer,
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Text(
        notice,
        key: const Key('login-notice'),
        style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer),
      ),
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _hero(context, t.loginSubtitle),
        const Spacer(),
        SafeArea(
          top: false,
          minimum: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
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
        ),
      ],
    );
  }

  Widget _passwordBody(BuildContext context) {
    final t = AppLocalizations.of(context);
    final online = ref.watch(connectivityProvider);
    final notice = _notice(t);
    // The form card overlaps the hero band by 32 dp (Banani card-on-hero look).
    return SingleChildScrollView(
      padding: EdgeInsets.only(bottom: 24 + MediaQuery.paddingOf(context).bottom),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _hero(context, t.loginSubtitlePassword),
          Transform.translate(
            offset: const Offset(0, -32),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 480),
                  child: PkCard(
                    radius: PkRadius.lg,
                    padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
                    child: _passwordForm(context, online: online, notice: notice),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _passwordForm(BuildContext context, {required bool online, required String? notice}) {
    final t = AppLocalizations.of(context);
    return AutofillGroup(
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
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
              textInputAction: _showTotp ? TextInputAction.next : TextInputAction.done,
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
                if (_showTotp) {
                  _totpFocus.requestFocus();
                } else if (online) {
                  _submitPassword();
                }
              },
            ),
            if (_showTotp) ...[
              const SizedBox(height: 16),
              TextFormField(
                key: const Key('login-totp'),
                controller: _totp,
                focusNode: _totpFocus,
                enabled: !_busy,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                autocorrect: false,
                enableSuggestions: false,
                maxLength: 6,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                decoration: InputDecoration(
                  labelText: t.loginTotpLabel,
                  helperText: t.loginTotpHelper,
                  helperMaxLines: 3,
                  prefixIcon: const Icon(Icons.pin_outlined),
                ),
                validator: (v) => (v == null || v.isEmpty || v.length == 6) ? null : t.loginTotpInvalidLength,
                onFieldSubmitted: (_) {
                  if (online) _submitPassword();
                },
              ),
            ],
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
    );
  }
}
