import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/expense_request.dart';
import 'expense_mappers.dart';

/// Requester transitions after approval (state table `apps/web/src/domain/expense/state.ts`).
enum RequesterAction {
  receiptsComplete('receipts_complete', 'receipts-complete'),
  lpjSubmit('lpj_submit', 'lpj/submit'),
  receiptsResubmit('receipts_resubmit', 'receipts-resubmit'),
  complete('complete', 'complete');

  const RequesterAction(this.code, this.path);

  /// `allowedActions` value.
  final String code;
  final String path;
}

class ExpensePage {
  const ExpensePage(this.items, this.nextCursor);
  final List<ExpenseSummary> items;
  final String? nextCursor;
}

/// `/api/v1/expense-requests*` + `/media/*` (online operations).
class ExpenseApi {
  ExpenseApi(this.client);
  final ApiClient client;

  /// Writes on ONE existing document: the server checks the role IN the document's PT, whatever the PT
  /// switcher says (MC3) — no `X-Company-Ids`, so a document opened from a notification of another PT works.
  Options _idem(String key) => ApiClient.allCompanies(Options(headers: {'Idempotency-Key': key}));

  /// Reads of one document by id (same reason as [_idem]).
  static Options get _doc => ApiClient.allCompanies();

  /// Server list of the PT switcher selection (`X-Company-Ids`, MC3).
  Future<ExpensePage> list({String scope = 'mine', String? cursor, int limit = 30}) => client.run(
    (d) => d.get<dynamic>('/expense-requests', queryParameters: {'scope': scope, 'limit': limit, 'cursor': ?cursor}),
    (data) {
      final m = data as Map<String, dynamic>;
      return ExpensePage([
        for (final i in (m['items'] as List<dynamic>? ?? const [])) summaryFromJson(i as Map<String, dynamic>),
      ], m['nextCursor'] as String?);
    },
  );

  Future<ExpenseDetail> detail(int id) => client.run(
    (d) => d.get<dynamic>('/expense-requests/$id', options: _doc),
    (data) => detailFromJson(data as Map<String, dynamic>),
  );

  /// Create a server draft; `clientUuid` makes a retry return the existing draft. MC3: the draft's PT
  /// is sent as `X-Company-Ids` (the server derives it from the project / cost center, else the sole
  /// selected PT); null = legacy draft of a single-PT account.
  Future<ExpenseDetail> create(Map<String, dynamic> body, {required String idempotencyKey, int? companyId}) =>
      client.run(
        (d) => d.post<dynamic>(
          '/expense-requests',
          data: body,
          options: companyId == null
              ? Options(headers: {'Idempotency-Key': idempotencyKey})
              : ApiClient.forCompany(companyId, Options(headers: {'Idempotency-Key': idempotencyKey})),
        ),
        (data) => detailFromJson(data as Map<String, dynamic>),
      );

  /// Upload one compressed image (`POST /media/{kind}`, multipart field `file`) → media id.
  Future<int> uploadMedia(String kind, Uint8List bytes, {required String filename, String mime = 'image/jpeg'}) =>
      client.run(
        (d) => d.post<dynamic>(
          '/media/$kind',
          data: FormData.fromMap({
            'file': MultipartFile.fromBytes(bytes, filename: filename, contentType: DioMediaType.parse(mime)),
          }),
          // Own upload (MC3 route class "own"): independent of the PT selection.
          options: _doc,
        ),
        (data) => ((data as Map<String, dynamic>)['id'] as num).toInt(),
      );

  Future<ExpenseDetail> addReceipt(int requestId, Map<String, dynamic> body, {required String idempotencyKey}) =>
      client.run(
        (d) => d.post<dynamic>('/expense-requests/$requestId/receipts', data: body, options: _idem(idempotencyKey)),
        (data) => detailFromJson(data as Map<String, dynamic>),
      );

  Future<ExpenseDetail> submit(int requestId, {required String idempotencyKey, int? signatureMediaId}) => client.run(
    (d) => d.post<dynamic>(
      '/expense-requests/$requestId/submit',
      data: {'signatureMediaId': ?signatureMediaId},
      options: _idem(idempotencyKey),
    ),
    (data) => detailFromJson(data as Map<String, dynamic>),
  );

  /// Soft-removes one receipt (`POST …/receipts/{rid}/remove`, reason required; US-38/T4). Allowed
  /// while `add_receipt` is (Pengajuan Baru after transfer / LPJ revision, Reimburse receipt revision).
  Future<ExpenseDetail> removeReceipt(int requestId, int receiptId, String reason, {required String idempotencyKey}) =>
      client.run(
        (d) => d.post<dynamic>(
          '/expense-requests/$requestId/receipts/$receiptId/remove',
          data: {'reason': reason},
          options: _idem(idempotencyKey),
        ),
        (data) => detailFromJson(data as Map<String, dynamic>),
      );

  /// Requester-side transitions without a body field besides the optional LPJ notes:
  /// `receipts-complete` (Pengajuan Baru: nota lengkap), `lpj/submit` (usageNotes required at the first
  /// submit; [photos] = LPJ photo media ids), `receipts-resubmit` (Reimburse after receipt revision), `complete` (Reimburse done).
  Future<ExpenseDetail> requesterAction(
    int requestId,
    RequesterAction action, {
    required String idempotencyKey,
    String? usageNotes,
    List<int>? photos,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/expense-requests/$requestId/${action.path}',
      data: {
        if (action == RequesterAction.lpjSubmit) ...{
          'usageNotes': ?usageNotes,
          // d1010 (13): LPJ photos (media ids from `POST /media/receipts`, max 10) — the full set kept on the LPJ.
          'photos': ?photos,
        },
      },
      options: _idem(idempotencyKey),
    ),
    (data) => detailFromJson(data as Map<String, dynamic>),
  );

  /// `POST …/withdraw` (US-04): back to Draft before any decision; reason ≥ 3 chars (ReasonBody, audited).
  Future<ExpenseDetail> withdraw(int requestId, String reason, {required String idempotencyKey}) =>
      _reasonAction(requestId, 'withdraw', reason, idempotencyKey);

  /// `POST …/cancel` (US-04): cancel with a reason (audited; the server decides when it is allowed).
  Future<ExpenseDetail> cancel(int requestId, String reason, {required String idempotencyKey}) =>
      _reasonAction(requestId, 'cancel', reason, idempotencyKey);

  Future<ExpenseDetail> _reasonAction(int requestId, String path, String reason, String idempotencyKey) => client.run(
    (d) =>
        d.post<dynamic>('/expense-requests/$requestId/$path', data: {'reason': reason}, options: _idem(idempotencyKey)),
    (data) => detailFromJson(data as Map<String, dynamic>),
  );

  /// `POST …/resubmit` (US-06): clones a rejected request into a NEW Draft (201) — returns the new draft.
  Future<ExpenseDetail> resubmit(int requestId, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>(
      '/expense-requests/$requestId/resubmit',
      data: const <String, dynamic>{},
      options: _idem(idempotencyKey),
    ),
    (data) => detailFromJson(data as Map<String, dynamic>),
  );

  /// `GET …/history` — "Riwayat" (US-35), the same rows as the web Riwayat tab (`domain/history.ts`).
  Future<List<HistoryEntry>> history(int requestId) => client.run(
    (d) => d.get<dynamic>('/expense-requests/$requestId/history', options: _doc),
    (data) => [
      for (final i in ((data as Map<String, dynamic>)['items'] as List<dynamic>? ?? const []))
        historyFromJson(i as Map<String, dynamic>),
    ],
  );

  /// Receipt image (thumbnail variant) via the authorized file endpoint (ADR 0004 §4a).
  Future<Uint8List> receiptImage(int imageId, {bool thumb = true}) => client.run(
    (d) => d.get<dynamic>(
      '/media/receipts/$imageId/file',
      queryParameters: {if (thumb) 'variant': 'thumb'},
      options: ApiClient.allCompanies(Options(responseType: ResponseType.bytes)),
    ),
    (data) => Uint8List.fromList(data as List<int>),
  );
}
