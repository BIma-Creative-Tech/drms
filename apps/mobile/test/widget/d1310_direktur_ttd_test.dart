import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/approvals/presentation/decision_sheet.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';

import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/widget_harness.dart';

/// Records the decision call (and refuses it, so the sheet stays open for the assertions).
class RecordingApprovalsApi extends ApprovalsApi {
  RecordingApprovalsApi() : super(testClient('http://127.0.0.1:9', StaticTokens()));
  final calls = <String>[];

  @override
  Future<int> uploadSignature(Uint8List png) async {
    calls.add('upload');
    return 1;
  }

  @override
  Future<ExpenseDetail> decide(
    int requestId,
    Decision decision, {
    required String idempotencyKey,
    int? signatureMediaId,
    String? reason,
  }) async {
    calls.add('decide:${decision.name}:$signatureMediaId');
    throw const ProblemException(status: 409, title: 'Conflict');
  }
}

/// ADR 0025: the caller is a designated representative deciding the Direktur step of a PT with a definitive Direktur.
Map<String, dynamic> representativeDetailJson() => {
  ...pmDetailJson(status: 'pending_approval', allowed: const ['approve', 'reject']),
  'direkturSignature': {'name': 'Direktur Contoh', 'title': 'Direktur Utama', 'signatureId': 77},
};

void main() {
  group('ADR 0025 definitive Direktur signature', () {
    test('mapper: direkturSignature parsed; absent or malformed → null', () {
      expect(
        detailFromJson(representativeDetailJson()).direkturSignature,
        const DirekturSignature(name: 'Direktur Contoh', title: 'Direktur Utama', signatureId: 77),
      );
      expect(detailFromJson(pmDetailJson()).direkturSignature, isNull);
      expect(direkturSignatureFromJson({'name': 'Direktur Contoh'}), isNull);
      expect(direkturSignatureFromJson(null), isNull);
      expect(const DirekturSignature(name: 'Direktur Contoh', signatureId: 1).label, 'Direktur Contoh');
    });

    testWidgets('representative: PT signature read-only, no profile/draw choice, no signature id sent', (tester) async {
      final api = RecordingApprovalsApi();
      await pumpScreen(
        tester,
        Scaffold(
          body: DecisionSheet(detail: detailFromJson(representativeDetailJson()), decision: Decision.approve),
        ),
        overrides: [
          approvalsApiProvider.overrideWithValue(api),
          direkturSignatureImageProvider(77).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(find.byKey(const Key('direktur-signature')), findsOneWidget);
      expect(find.text('Tanda tangan Direktur PT'), findsOneWidget);
      expect(find.text('Direktur Contoh (Direktur Utama)'), findsOneWidget);
      expect(find.byType(SegmentedButton<SignatureMode>), findsNothing);
      expect(find.byKey(const Key('signature-pad')), findsNothing);
      await tester.tap(
        find.descendant(of: find.byKey(const Key('decision-confirm')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      expect(api.calls, ['decide:approve:null']);
    });

    testWidgets('anyone else keeps the profile / draw choice', (tester) async {
      await pumpScreen(
        tester,
        Scaffold(
          body: DecisionSheet(
            detail: detailFromJson(pmDetailJson(status: 'pending_approval', allowed: const ['approve', 'reject'])),
            decision: Decision.approve,
          ),
        ),
      );
      expect(find.byKey(const Key('direktur-signature')), findsNothing);
      expect(find.byType(SegmentedButton<SignatureMode>), findsOneWidget);
    });
  });
}
