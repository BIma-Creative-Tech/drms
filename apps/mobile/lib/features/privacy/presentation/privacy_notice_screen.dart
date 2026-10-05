import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../attendance/presentation/attendance_widgets.dart';
import '../../auth/application/auth_controller.dart';
import '../application/privacy_providers.dart';
import '../domain/markdown.dart';
import '../domain/privacy.dart';
import 'markdown_view.dart';

/// Path of the notice. Without `?from=` it is the full-screen prompt the router shows after login / at app start
/// while the notice is not acknowledged ("Nanti" leaves it for this app run); with `?from=…` it was opened on
/// purpose (profile, attendance) and closes back to where it came from.
const privacyRoute = '/privacy';

/// Full-screen employee privacy notice (Q-46, ADR 0018), rendered from the server's markdown (stored copy when
/// offline). "Saya mengerti" posts the acknowledgement; until the SERVER confirms it, attendance stays blocked.
class PrivacyNoticeScreen extends ConsumerWidget {
  const PrivacyNoticeScreen({super.key, this.pushed = false});

  /// Opened on purpose (profile / attendance) instead of by the start-up prompt.
  final bool pushed;

  void _leave(BuildContext context) {
    if (pushed && context.canPop()) {
      context.pop();
    } else {
      context.go('/home');
    }
  }

  Future<void> _acknowledge(BuildContext context, WidgetRef ref, PrivacyNotice notice) async {
    final t = AppLocalizations.of(context);
    final ok = await ref.read(privacyAckControllerProvider.notifier).acknowledge(notice.version);
    if (!ok || !context.mounted) return;
    showSnack(context, t.privacyAckDone);
    _leave(context);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final notice = ref.watch(privacyNoticeProvider);
    final gate = ref.watch(privacyGateProvider);
    final account = ref.watch(accountProfileProvider);
    final status = account?.privacy;
    final ack = ref.watch(privacyAckControllerProvider);
    final loaded = notice.value;
    return Scaffold(
      appBar: AppBar(title: Text(t.privacyTitle), automaticallyImplyLeading: pushed),
      body: AsyncBody<PrivacyNotice?>(
        value: notice,
        onRetry: () => ref.invalidate(privacyNoticeProvider),
        data: (n) => n == null
            ? Padding(
                padding: const EdgeInsets.all(16),
                child: InfoCard(key: const Key('privacy-not-available'), text: t.privacyNotAvailable),
              )
            : ListView(
                key: const Key('privacy-notice-body'),
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                children: [MarkdownView(blocks: parseMarkdown(n.markdown))],
              ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (notice.hasError && loaded == null)
                InfoCard(key: const Key('privacy-offline'), text: t.privacyNoticeOffline, error: true),
              if (gate == PrivacyGate.required) ...[
                if (_ackMessage(t, ack) case final msg?)
                  InfoCard(
                    key: Key('privacy-ack-${ack.phase.name}'),
                    text: msg,
                    error: ack.phase != PrivacyAckPhase.unavailable,
                  ),
                FilledButton.icon(
                  key: const Key('privacy-ack'),
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                  onPressed: loaded == null || ack.phase == PrivacyAckPhase.sending
                      ? null
                      : () => _acknowledge(context, ref, loaded),
                  icon: ack.phase == PrivacyAckPhase.sending
                      ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.check),
                  label: Text(ack.phase == PrivacyAckPhase.sending ? t.privacySending : t.privacyAcknowledge),
                ),
                if (!pushed) ...[
                  const SizedBox(height: 4),
                  TextButton(
                    key: const Key('privacy-later'),
                    onPressed: () {
                      ref.read(privacyPromptDismissedProvider.notifier).dismiss();
                      _leave(context);
                    },
                    child: Text(t.privacyLater),
                  ),
                  Text(t.privacyLaterHint, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
                ],
              ] else ...[
                if (status != null && status.acknowledged)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      t.privacyAcknowledgedOn(
                        status.ackVersion ?? status.currentVersion,
                        formatServerDateTime(status.ackAt, zone: account?.timezone),
                      ),
                      key: const Key('privacy-acknowledged'),
                      textAlign: TextAlign.center,
                    ),
                  ),
                FilledButton(
                  key: const Key('privacy-close'),
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                  onPressed: () => _leave(context),
                  child: Text(pushed ? t.privacyClose : t.privacyContinue),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  static String? _ackMessage(AppLocalizations t, PrivacyAckState s) => switch (s.phase) {
    PrivacyAckPhase.waitingForNetwork => t.privacyAckOffline,
    PrivacyAckPhase.versionChanged => t.privacyAckVersionChanged,
    PrivacyAckPhase.unavailable => t.privacyAckUnavailable,
    PrivacyAckPhase.failed => s.message,
    _ => null,
  };
}

/// Attendance screens: shown instead of enabled check-in/out buttons while the notice is not acknowledged.
class PrivacyAttendanceBlock extends StatelessWidget {
  const PrivacyAttendanceBlock({super.key, required this.from});

  /// `?from=` value (the screen pops back to the attendance screen after "Saya mengerti").
  final String from;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Column(
      key: const Key('privacy-attendance-block'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InfoCard(text: t.privacyAttendanceBlocked, error: true),
        OutlinedButton.icon(
          key: const Key('privacy-attendance-read'),
          onPressed: () => context.push('$privacyRoute?from=$from'),
          icon: const Icon(Icons.privacy_tip_outlined),
          label: Text(t.privacyRead),
        ),
        const SizedBox(height: 12),
      ],
    );
  }
}
