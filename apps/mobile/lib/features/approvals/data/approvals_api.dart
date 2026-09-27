import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../../expense/data/expense_mappers.dart';
import '../../expense/domain/expense_request.dart';

enum Decision { acknowledge, approve, reject }

class InboxPage {
  const InboxPage(this.items, this.budgetWarnPct);
  final List<InboxItem> items;
  final double budgetWarnPct;
}

/// Direktur/Finance inbox + decisions (US-26, US-42, US-43, ADR 0013). Online-only.
class ApprovalsApi {
  ApprovalsApi(this.client);
  final ApiClient client;

  Future<InboxPage> inbox() => client.run((d) => d.get<dynamic>('/approvals/inbox'), (data) {
    final m = data as Map<String, dynamic>;
    return InboxPage([
      for (final i in (m['items'] as List<dynamic>? ?? const [])) inboxItemFromJson(i as Map<String, dynamic>),
    ], (m['budgetWarnPct'] as num?)?.toDouble() ?? 85);
  });

  /// Signature drawn on screen → `media-signatures` id (PNG ≤ 800×300, ≤ 50 KB, requirements §9).
  Future<int> uploadSignature(Uint8List png) => client.run(
    (d) => d.post<dynamic>(
      '/media/signatures',
      data: FormData.fromMap({
        'file': MultipartFile.fromBytes(png, filename: 'signature.png', contentType: DioMediaType.parse('image/png')),
      }),
    ),
    (data) => ((data as Map<String, dynamic>)['id'] as num).toInt(),
  );

  /// `signatureMediaId` null → the server uses the profile signature (SignBody default).
  Future<ExpenseDetail> decide(
    int requestId,
    Decision decision, {
    required String idempotencyKey,
    int? signatureMediaId,
    String? reason,
  }) {
    final path = switch (decision) {
      Decision.acknowledge => 'acknowledge',
      Decision.approve => 'approve',
      Decision.reject => 'reject',
    };
    final body = <String, dynamic>{
      'signatureMediaId': ?signatureMediaId,
      if (decision == Decision.reject) 'reason': reason,
    };
    return client.run(
      (d) => d.post<dynamic>(
        '/expense-requests/$requestId/$path',
        data: body,
        options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      ),
      (data) => detailFromJson(data as Map<String, dynamic>),
    );
  }
}
