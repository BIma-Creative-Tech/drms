import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/shared/widgets/action_feedback.dart';

import '../support/widget_harness.dart';

/// D2410 (user decision 2026-10-24): every data-changing action asks "Yakin ingin …?" first and shows the result in a
/// popup afterwards (shared/widgets/action_feedback.dart).
class _Host extends StatelessWidget {
  const _Host({required this.onTap});
  final Future<void> Function(BuildContext context) onTap;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Builder(
          builder: (c) => FilledButton(key: const Key('go'), onPressed: () => onTap(c), child: const Text('Go')),
        ),
      ),
    );
  }
}

Future<void> _go(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('go')));
  await tester.pumpAndSettle();
}

void main() {
  test('action phrase: lower-case first letter, acronyms kept; destructive labels', () {
    expect(actionPhrase('Kirim pengajuan'), 'kirim pengajuan');
    expect(actionPhrase('LPJ kirim'), 'LPJ kirim');
    expect(actionPhrase('Void pengembalian'), 'void pengembalian');
    expect(isDestructiveAction('Tolak'), isTrue);
    expect(isDestructiveAction('Batalkan pengajuan'), isTrue);
    expect(isDestructiveAction('Hapus draft'), isTrue);
    expect(isDestructiveAction('Nonaktifkan'), isTrue);
    expect(isDestructiveAction('Void transfer'), isTrue);
    expect(isDestructiveAction('Setujui'), isFalse);
    expect(isDestructiveAction('Kirim LPJ'), isFalse);
  });

  testWidgets('confirm: title, summary, [Ya, <aksi>] / [Batal]; Batal → false, Ya → true', (tester) async {
    final answers = <bool>[];
    const summary = ['PB/DRMS/2610/0001', null, 'Rp 150.000'];
    Future<void> ask(BuildContext c) async {
      answers.add(await confirmAction(c, action: 'Kirim pengajuan', summary: summary));
    }

    await pumpScreen(tester, _Host(onTap: ask));
    await _go(tester);
    expect(find.text('Yakin ingin kirim pengajuan?'), findsOneWidget);
    expect(find.text('PB/DRMS/2610/0001'), findsOneWidget);
    expect(find.text('Rp 150.000'), findsOneWidget);
    expect(find.text('Ya, kirim pengajuan'), findsOneWidget);
    await tester.tap(find.byKey(const Key('confirm-cancel')));
    await tester.pumpAndSettle();
    await _go(tester);
    await confirmPopup(tester);
    expect(answers, [false, true]);
  });

  testWidgets('destructive action: the confirm button uses the error colour', (tester) async {
    Future<void> ask(BuildContext c) async {
      await confirmAction(c, action: 'Hapus draft');
    }

    await pumpScreen(tester, _Host(onTap: ask));
    await _go(tester);
    final button = tester.widget<FilledButton>(find.byKey(const Key('confirm-action')));
    final scheme = Theme.of(tester.element(find.byKey(const Key('confirm-action')))).colorScheme;
    expect(button.style?.backgroundColor?.resolve(const <WidgetState>{}), scheme.error);
  });

  testWidgets('result: success, failure (server text) and queued popups, each closed with OK', (tester) async {
    Future<void> report(BuildContext c) async {
      await showActionResult(c, message: 'Pengajuan terkirim.', action: 'Kirim pengajuan');
      if (!c.mounted) return;
      const refused = ProblemException(status: 409, detail: 'Status data sudah berubah.');
      await showActionError(c, refused, action: 'Setujui');
      if (!c.mounted) return;
      await showActionQueued(c, action: 'Absen masuk');
    }

    await pumpScreen(tester, _Host(onTap: report));
    await _go(tester);
    expect(find.byKey(const Key('result-success')), findsOneWidget);
    expect(find.text('Berhasil: kirim pengajuan'), findsOneWidget);
    expect(find.text('Pengajuan terkirim.'), findsOneWidget);
    await dismissResult(tester);
    expect(find.byKey(const Key('result-failed')), findsOneWidget);
    expect(find.text('Gagal: setujui'), findsOneWidget);
    expect(find.text('Status data sudah berubah.'), findsOneWidget);
    await dismissResult(tester);
    expect(find.byKey(const Key('result-queued')), findsOneWidget);
    expect(find.text('Tersimpan di antrian'), findsOneWidget);
    expect(find.text('Tersimpan di antrian, akan dikirim saat online.'), findsOneWidget);
    await dismissResult(tester);
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('runConfirmedAction: cancelled → nothing runs; confirmed → runs and reports', (tester) async {
    var runs = 0;
    Future<void> save(BuildContext c) async {
      await runConfirmedAction<int>(c, action: 'Simpan', run: () async => ++runs, success: (v) => 'Tersimpan $v.');
    }

    await pumpScreen(tester, _Host(onTap: save));
    await _go(tester);
    await tester.tap(find.byKey(const Key('confirm-cancel')));
    await tester.pumpAndSettle();
    expect(runs, 0);
    await _go(tester);
    await confirmPopup(tester);
    expect(runs, 1);
    expect(find.text('Tersimpan 1.'), findsOneWidget);
  });
}
